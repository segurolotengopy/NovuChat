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
 *    vuelve a llamar. Una FALLA de la fuente se recuerda 10 s (caché negativo), y mientras una llamada está en curso
 *    las demás de la misma clave esperan la MISMA promesa (nunca dos llamadas simultáneas iguales).
 *  - El cuerpo se rechaza si `Content-Length` pasa de 2 MB y se lee en flujo con tope de bytes.
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
/** La misma forma que `idDeItemValido` y que NovuTienda: empieza con letra o dígito. */
const ID_EXTERNO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
/** Una falla de la red se recuerda este rato: sin esto, cada visita a una fuente caída sería otra llamada de 8 s. */
export const VIDA_DEL_CACHE_NEGATIVO_MS = 10_000;
const MONEDA_DEL_MERCADO: Readonly<Record<Mercado, MonedaExterna>> = { BO: 'BOB', AR: 'ARS' };

export interface ItemExterno {
  id: string;
  nombre: string;
  descripcion: string;
  area: string;
  /** Clave estable del área (NovuTienda `areaClave`); `''` si no viene. */
  areaClave: string;
  /** Orden de la categoría, entero 0 a 39 (NovuTienda `ordenArea`); `null` si no viene. */
  ordenArea: number | null;
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

/** ¿Es una IPv4 de las que no se llaman nunca (0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16)? */
function ipv4Reservada(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/**
 * ¿El host es uno al que NUNCA se debe llamar con un Bearer? `localhost`, `metadata` y todo nombre sin punto,
 * los sufijos `.local`, `.internal` y `.localhost`, las IPv4 reservadas, y de IPv6: `::`, `::1`, ULA (fc00::/7),
 * link-local (fe80::/10) y las mapeadas o compatibles con IPv4. (`URL` ya normaliza `2130706433` o `0x7f.1` a
 * `127.0.0.1` y `::ffff:127.0.0.1` a `::ffff:7f00:1`, así que se mira la forma normalizada.)
 */
export function hostProhibido(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
      || v6.startsWith('::ffff:') || /^::[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v6) || /^::\d+\.\d+\.\d+\.\d+$/.test(v6);
  }
  if (!h.includes('.') || h === 'localhost' || h === 'metadata' || h.endsWith('.localhost')
    || h.endsWith('.local') || h.endsWith('.internal') || h.startsWith('metadata.')) return true;
  return ipv4Reservada(h);
}

/**
 * El destino de un comercio, o `null`. No se fía de la forma del secreto: JSON roto, comercio ausente, clave de más
 * (una mal escrita no se acepta en silencio), `bearer` corto o `baseUrl` que no sea https público (puerto 443 o
 * ausente; sin usuario, clave, parámetros ni ancla; host no prohibido) dan `null`.
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
  // `URL` deja `port` vacío para 443: cualquier otro puerto se rechaza.
  if (u.port !== '' || hostProhibido(u.hostname)) return null;
  if (!urlImagenValida(`${u.origin}/`)) return null;
  return { base: `${u.origin}${u.pathname.replace(/\/+$/, '')}`, bearer };
}

const entero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;

/** `ordenArea`: entero de 0 a 39, o `null` (ausente o fuera de rango: la categoría va al final). */
const ordenDeArea = (v: unknown): number | null => {
  const n = entero(v);
  return n !== null && n >= 0 && n <= 39 ? n : null;
};

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
    areaClave: lineaLimpia(crudo['areaClave'], 40),
    ordenArea: ordenDeArea(crudo['ordenArea']),
    precioCentavos: precio, moneda, stock, disponible, imagenUrl,
  };
}

function registrar(codigo: string, extra: { estado?: number; descartados?: number } = {}): void {
  // Solo códigos, estados HTTP y una cuenta: jamás cuerpo, URL, secreto, comercio ni teléfono.
  logger.warn('catalogoExterno', { codigo, ...extra });
}

type Falla = { ok: false; motivo: MotivoSinCatalogo };
const falla = (motivo: MotivoSinCatalogo, extra: { estado?: number; descartados?: number } = {}): Falla => {
  registrar(motivo, extra);
  return { ok: false, motivo };
};

type Bueno = Extract<ResultadoCatalogoExterno, { ok: true }>;
const cache = new Map<string, { vence: number; resultado: Bueno; etag: string }>();
const cacheNegativo = new Map<string, { vence: number; resultado: Falla }>();
const enCurso = new Map<string, Promise<ResultadoCatalogoExterno>>();
/** Para las pruebas: vacía los cachés y las llamadas en curso. */
export const vaciarCacheDelCatalogoExterno = (): void => { cache.clear(); cacheNegativo.clear(); enCurso.clear(); };

/** Lee el cuerpo EN FLUJO con tope de bytes; `null` si lo pasa (o si `Content-Length` ya lo declara). */
async function leerAcotado(r: Response): Promise<string | null> {
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_CUERPO) {
    try { void r.body?.cancel().catch(() => undefined); } catch { /* nada que liberar */ }
    return null;
  }
  const lector = r.body?.getReader();
  if (!lector) return '';
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CUERPO) { void lector.cancel().catch(() => undefined); return null; }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let desde = 0;
  for (const t of trozos) { todo.set(t, desde); desde += t.byteLength; }
  return new TextDecoder().decode(todo);
}

export function leerCatalogoExterno(
  tenantId: string, mercado: Mercado, d: DependenciasDeLaFuente = dependenciasReales(),
): Promise<ResultadoCatalogoExterno> {
  const clave = `${tenantId}|${mercado}`;
  const ahora = d.ahora();
  const bueno = cache.get(clave);
  if (bueno && bueno.vence > ahora) return Promise.resolve(bueno.resultado);
  // (Un caché vencido NO se borra: su ETag permite preguntar «¿cambió?» y renovarlo con un 304.)
  const malo = cacheNegativo.get(clave);
  if (malo && malo.vence > ahora) return Promise.resolve(malo.resultado);
  // Una sola llamada por clave a la vez: las demás esperan la misma promesa.
  const previa = enCurso.get(clave);
  if (previa) return previa;
  const promesa = cargar(tenantId, mercado, d, clave).finally(() => { enCurso.delete(clave); });
  enCurso.set(clave, promesa);
  return promesa;
}

async function cargar(
  tenantId: string, mercado: Mercado, d: DependenciasDeLaFuente, clave: string,
): Promise<ResultadoCatalogoExterno> {
  // Las fallas de CONFIGURACIÓN no se recuerdan (no hay red de por medio y arreglarlas no tiene que esperar).
  let secreto: string;
  try { secreto = d.leerSecreto(); } catch { return falla('sin_secreto'); }
  const destino = destinoDelCatalogo(secreto, tenantId);
  if (!destino) return falla('sin_destino');

  // Las de la FUENTE se recuerdan 10 s: una fuente caída no se golpea en cada visita.
  const recordar = (f: Falla): Falla => {
    cacheNegativo.set(clave, { vence: d.ahora() + VIDA_DEL_CACHE_NEGATIVO_MS, resultado: f });
    return f;
  };

  const viejo = cache.get(clave);
  let r: Response;
  try {
    r = await d.http(`${destino.base}${RUTA_DEL_CATALOGO}?mercado=${mercado}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json', 'Authorization': `Bearer ${destino.bearer}`,
        ...(viejo && viejo.etag !== '' ? { 'If-None-Match': viejo.etag } : {}),
      },
      redirect: 'error', // un redirect llevaría el Bearer a otro destino
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
  } catch (e) {
    const nombre = (e as { name?: unknown } | null)?.name;
    return recordar(nombre === 'TimeoutError' || nombre === 'AbortError' ? falla('tiempo') : falla('red'));
  }
  const estado = r.status;
  // 304: nada cambió. Se renueva el caché SIN releer el cuerpo. Sin caché propio, un 304 no tiene sentido.
  if (estado === 304) {
    if (!viejo) return recordar(falla('contrato', { estado }));
    cache.set(clave, { ...viejo, vence: d.ahora() + VIDA_DEL_CACHE_MS });
    return viejo.resultado;
  }
  if (estado !== 200) {
    try { void r.body?.cancel().catch(() => undefined); } catch { /* nada que liberar */ }
    if (estado === 401 || estado === 403) return recordar(falla('no_autorizado', { estado }));
    if (estado === 429) return recordar(falla('limite', { estado }));
    return recordar(falla('no_disponible', { estado }));
  }

  let cuerpo: unknown;
  try {
    const texto = await leerAcotado(r);
    if (texto === null) return recordar(falla('contrato', { estado }));
    cuerpo = JSON.parse(texto);
  } catch { return recordar(falla('contrato', { estado })); }
  if (!esObjeto(cuerpo) || cuerpo['version'] !== 1 || !Array.isArray(cuerpo['items'])) {
    return recordar(falla('contrato', { estado }));
  }
  const moneda = MONEDA_DEL_MERCADO[mercado];
  if (cuerpo['moneda'] !== moneda || (cuerpo['mercado'] !== undefined && cuerpo['mercado'] !== mercado)) {
    return recordar(falla('contrato', { estado }));
  }

  const crudos = cuerpo['items'].slice(0, MAX_ITEMS_EXTERNOS);
  const vistos = new Set<string>();
  const items: ItemExterno[] = [];
  for (const crudo of crudos) {
    const it = itemExternoDe(crudo, moneda);
    if (!it || vistos.has(it.id)) continue;
    vistos.add(it.id);
    items.push(it);
  }
  const descartados = crudos.length - items.length;
  // Había ítems y NINGUNO sirve: la fuente cambió de forma. Es un error, no un catálogo vacío.
  if (crudos.length > 0 && items.length === 0) return recordar(falla('contrato', { estado, descartados }));
  if (descartados > 0) registrar('items_descartados', { descartados });
  const resultado: Bueno = { ok: true, moneda, items };
  const etagCrudo = r.headers.get('etag') ?? '';
  const etag = /^(W\/)?"[\x21\x23-\x7e]{0,190}"$/.test(etagCrudo) ? etagCrudo : '';
  cache.set(clave, { vence: d.ahora() + VIDA_DEL_CACHE_MS, resultado, etag });
  return resultado;
}

/** ¿Se puede vender ahora? `disponible` manda; con control de stock hace falta al menos la cantidad pedida. */
export const hayParaVenderExterno = (it: ItemExterno, cantidad = 1): boolean =>
  it.disponible && (it.stock === null || it.stock >= cantidad);
