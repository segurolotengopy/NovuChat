/**
 * =============================================================================
 * FUENTE EXTERNA DE CATÁLOGO — lectura en vivo (B3, 24/11/2026)
 * =============================================================================
 *
 * Un comercio con `tenants/{t}/config/pedidos.catalogoExterno.activo === true` no vende desde su colección
 * `catalogo` de Firestore: su catálogo vive en otra plataforma y se lee EN VIVO, sin sincronizar. La primera
 * implementación es NovuTienda v1; el módulo no conoce el nombre de ningún comercio.
 *
 * CONTRATO NovuTienda v1 (fijo):
 *   GET {baseUrl}/api/novuchat/v1/catalogo?mercado=BO|AR   con   Authorization: Bearer <token del comercio>
 *   200 {version:1, mercado, moneda:'BOB'|'ARS', items:[{id, nombre, precioCentavos, moneda, stock, disponible,
 *        foto, fotos[], area, descripcion, …}]}   (hasta 200 ítems; ETag y max-age=60)
 *   401 sin credencial · 429 límite · 503 sin cotización · cualquier otro: no disponible.
 *
 * LO QUE ESTA PIEZA GARANTIZA, y cada línea tiene una prueba que la niega
 * (`pruebas/modulos/catalogo-web/fuente-externa.test.ts`):
 *  - SECRETO: un solo secreto de Secret Manager (`NOVUTIENDA_CATALOGO`) con el mapa
 *      { "<tenantId>": { "baseUrl": "https://…", "bearer": "…" } }
 *    Nunca en el repositorio, en Firestore ni en un registro. Ausente, ilegible, sin la entrada del comercio, con
 *    una clave de más o con una `baseUrl` que no sea https público sin usuario, clave, parámetros ni ancla: falla
 *    CERRADO (no sale ninguna llamada).
 *  - La llamada espera 8 s como máximo y NO sigue redirecciones (llevarían el Bearer a otro destino).
 *  - Falla cerrada: 401, 429, 503, cualquier otro estado, red, tiempo agotado o un cuerpo que no cumple el contrato
 *    devuelven `{ok:false, motivo}`. NUNCA un catálogo vacío presentado como real.
 *  - Cada ítem se valida: id `^[A-Za-z0-9_-]{1,80}$` (sin repetidos), precio entero positivo acotado, moneda igual
 *    a la del catálogo, stock entero ≥ 0 o `null` (sin control), `disponible:false` MANDA (aunque el stock sea 3),
 *    foto https pública, descripción ≤ 300 y área ≤ 40 recortadas. Máximo 200 ítems.
 *  - Caché en memoria de 60 s por comercio y mercado: una carga de página o un checkout dentro de esa ventana no
 *    vuelve a llamar. Solo se guardan las respuestas buenas.
 *  - Los registros llevan SOLO el código y el estado HTTP: ni URL, ni cuerpo, ni secreto, ni comercio, ni teléfono.
 *
 * Mensajes de WhatsApp por conversación: 0. Nube: una llamada saliente por carga de página y una por checkout (menos
 * si el caché de 60 s la absorbe).
 */
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { urlImagenValida } from './urlImagen.js';
import { lineaLimpia } from '../pedidos/comprable.js';

export const SECRETO_CATALOGO = defineSecret('NOVUTIENDA_CATALOGO');

export type Mercado = 'BO' | 'AR';
export type MonedaExterna = 'BOB' | 'ARS';

export const RUTA_DEL_CATALOGO = '/api/novuchat/v1/catalogo';
export const ESPERA_MAXIMA_MS = 8000;
export const VIDA_DEL_CACHE_MS = 60_000;
export const MAX_ITEMS_EXTERNOS = 200;
/** Lo máximo de cuerpo que se acepta leer (200 ítems con fotos caben de sobra). */
const MAX_CUERPO = 2_000_000;
const MAX_PRECIO_CENTAVOS = 100_000_000_000; // 1.000 millones de unidades: los pesos argentinos llegan a millones
const ID_EXTERNO = /^[A-Za-z0-9_-]{1,80}$/;
const MONEDA_DEL_MERCADO: Readonly<Record<Mercado, MonedaExterna>> = { BO: 'BOB', AR: 'ARS' };

export interface ItemExterno {
  id: string;
  nombre: string;
  descripcion: string;
  area: string;
  precioCentavos: number;
  moneda: MonedaExterna;
  /** `null` = el producto no controla stock. */
  stock: number | null;
  disponible: boolean;
  imagenUrl: string;
}

export type MotivoSinCatalogo =
  | 'sin_secreto' | 'sin_destino' | 'no_autorizado' | 'limite' | 'no_disponible' | 'tiempo' | 'red' | 'contrato';

export type ResultadoCatalogoExterno =
  | { ok: true; moneda: MonedaExterna; items: ItemExterno[] }
  | { ok: false; motivo: MotivoSinCatalogo };

export interface DependenciasDeLaFuente {
  leerSecreto: () => string;
  http: typeof fetch;
  ahora: () => number;
}

const dependenciasReales = (): DependenciasDeLaFuente => ({
  leerSecreto: () => SECRETO_CATALOGO.value(),
  http: (...a) => fetch(...a),
  ahora: () => Date.now(),
});

/** El mercado de una ficha, por el prefijo de su teléfono: 591 → BO, 54 → AR, otro → `null`. */
export function mercadoDeTelefono(telefono: unknown): Mercado | null {
  if (typeof telefono !== 'string') return null;
  if (/^591[0-9]{6,12}$/.test(telefono)) return 'BO';
  if (/^54[0-9]{8,13}$/.test(telefono)) return 'AR';
  return null;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface DestinoDelCatalogo { base: string; bearer: string }

/**
 * El destino de un comercio, o `null`. No se fía de la forma del secreto: JSON roto, comercio ausente, clave de más
 * (una mal escrita no se acepta en silencio), `bearer` corto o `baseUrl` que no sea https público sin usuario, clave,
 * parámetros ni ancla dan `null`.
 */
export function destinoDelCatalogo(secretoCrudo: unknown, tenantId: string): DestinoDelCatalogo | null {
  if (typeof secretoCrudo !== 'string' || secretoCrudo === '') return null;
  let mapa: unknown;
  try { mapa = JSON.parse(secretoCrudo); } catch { return null; }
  if (!esObjeto(mapa) || !Object.hasOwn(mapa, tenantId)) return null;
  const d = mapa[tenantId];
  if (!esObjeto(d)) return null;
  if (Object.keys(d).some((k) => k !== 'baseUrl' && k !== 'bearer')) return null;
  const { baseUrl, bearer } = d;
  if (typeof baseUrl !== 'string' || baseUrl.length > 500) return null;
  if (typeof bearer !== 'string' || bearer.length < 8) return null;
  let u: URL;
  try { u = new URL(baseUrl); } catch { return null; }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname === ''
    || u.search !== '' || u.hash !== '') return null;
  // Mismo criterio que las URL de imagen: nada que resuelva dentro de la red privada.
  if (!urlImagenValida(`${u.origin}/`)) return null;
  return { base: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, bearer };
}

const entero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;

/** Un ítem de la respuesta, o `null` si no cumple el contrato (se descarta ESE ítem, no el catálogo). */
export function itemExternoDe(crudo: unknown, moneda: MonedaExterna): ItemExterno | null {
  if (!esObjeto(crudo)) return null;
  const id = crudo['id'];
  if (typeof id !== 'string' || !ID_EXTERNO.test(id)) return null;
  const nombre = lineaLimpia(crudo['nombre'], 80);
  if (nombre === '') return null;
  const precio = entero(crudo['precioCentavos']);
  if (precio === null || precio <= 0 || precio > MAX_PRECIO_CENTAVOS) return null;
  if (crudo['moneda'] !== moneda) return null;
  const stockCrudo = crudo['stock'];
  let stock: number | null;
  if (stockCrudo === null || stockCrudo === undefined) stock = null;
  else {
    const s = entero(stockCrudo);
    if (s === null || s < 0) return null;
    stock = s;
  }
  // `disponible` MANDA: solo `true` estricto vende. Cualquier otra cosa (falso, ausente, «true» como texto) no.
  const disponible = crudo['disponible'] === true;
  const fotos = Array.isArray(crudo['fotos']) ? crudo['fotos'] : [];
  const candidatas = [crudo['foto'], ...fotos.slice(0, 5)];
  const imagenUrl = candidatas.find((f): f is string => typeof f === 'string' && urlImagenValida(f)) ?? '';
  return {
    id, nombre,
    descripcion: lineaLimpia(crudo['descripcion'], 300),
    area: lineaLimpia(crudo['area'], 40),
    precioCentavos: precio, moneda, stock, disponible, imagenUrl,
  };
}

function registrar(codigo: string, estado?: number): void {
  // Solo códigos y estados HTTP: jamás cuerpo, URL, secreto, comercio ni teléfono.
  logger.warn('catalogoExterno', { codigo, ...(estado !== undefined ? { estado } : {}) });
}

const falla = (motivo: MotivoSinCatalogo, estado?: number): { ok: false; motivo: MotivoSinCatalogo } => {
  registrar(motivo, estado);
  return { ok: false, motivo };
};

const cache = new Map<string, { vence: number; resultado: Extract<ResultadoCatalogoExterno, { ok: true }> }>();
/** Para las pruebas: vacía el caché en memoria. */
export const vaciarCacheDelCatalogoExterno = (): void => { cache.clear(); };

export async function leerCatalogoExterno(
  tenantId: string, mercado: Mercado, d: DependenciasDeLaFuente = dependenciasReales(),
): Promise<ResultadoCatalogoExterno> {
  const clave = `${tenantId}|${mercado}`;
  const guardado = cache.get(clave);
  if (guardado && guardado.vence > d.ahora()) return guardado.resultado;

  let secreto: string;
  try { secreto = d.leerSecreto(); } catch { return falla('sin_secreto'); }
  const destino = destinoDelCatalogo(secreto, tenantId);
  if (!destino) return falla('sin_destino');

  let r: Response;
  try {
    r = await d.http(`${destino.base}${RUTA_DEL_CATALOGO}?mercado=${mercado}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${destino.bearer}` },
      redirect: 'error', // un redirect llevaría el Bearer a otro destino
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
  } catch (e) {
    const nombre = (e as { name?: unknown } | null)?.name;
    return nombre === 'TimeoutError' || nombre === 'AbortError' ? falla('tiempo') : falla('red');
  }
  const estado = r.status;
  if (estado !== 200) {
    try { void r.body?.cancel().catch(() => undefined); } catch { /* nada que liberar */ }
    if (estado === 401 || estado === 403) return falla('no_autorizado', estado);
    if (estado === 429) return falla('limite', estado);
    return falla('no_disponible', estado);
  }

  let cuerpo: unknown;
  try {
    const texto = await r.text();
    if (texto.length > MAX_CUERPO) return falla('contrato', estado);
    cuerpo = JSON.parse(texto);
  } catch { return falla('contrato', estado); }
  if (!esObjeto(cuerpo) || cuerpo['version'] !== 1 || !Array.isArray(cuerpo['items'])) return falla('contrato', estado);
  const moneda = MONEDA_DEL_MERCADO[mercado];
  if (cuerpo['moneda'] !== moneda || (cuerpo['mercado'] !== undefined && cuerpo['mercado'] !== mercado)) {
    return falla('contrato', estado);
  }

  const vistos = new Set<string>();
  const items: ItemExterno[] = [];
  for (const crudo of cuerpo['items'].slice(0, MAX_ITEMS_EXTERNOS)) {
    const it = itemExternoDe(crudo, moneda);
    if (!it || vistos.has(it.id)) continue;
    vistos.add(it.id);
    items.push(it);
  }
  const resultado = { ok: true as const, moneda, items };
  cache.set(clave, { vence: d.ahora() + VIDA_DEL_CACHE_MS, resultado });
  return resultado;
}

/** ¿Se puede vender ahora? `disponible` manda; con control de stock hace falta al menos la cantidad pedida. */
export const hayParaVenderExterno = (it: ItemExterno, cantidad = 1): boolean =>
  it.disponible && (it.stock === null || it.stock >= cantidad);
