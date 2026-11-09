/**
 * =============================================================================
 * CONFIRMAR UN PEDIDO DE CATÁLOGO EXTERNO — `confirmarPedidoExterno` (B5b, NovuTienda)
 * =============================================================================
 *
 * Una callable del módulo Pedidos. Una persona del negocio (administrador u operador, con contraseña y correo
 * verificado) pulsa «Confirmar» sobre un pedido `recibido` de catálogo externo; el servidor llama FIRMADO a
 * NovuTienda para que descuente el stock y, solo si NovuTienda responde 200, pasa el pedido a `confirmado`.
 *
 * CONTRATO NovuTienda v1 (fijo):
 *   POST {baseUrl}/api/novuchat/v1/pedidos/confirmar
 *   cuerpo EXACTO  {"pedidoId":…, "items":[{"productoId":…, "cantidad":…}], "confirmadoEn":…}
 *   X-Marca-Tiempo (ms) y X-Firma = HMAC-SHA256 hex de "{marca}.{cuerpo exacto enviado}" (ventana de 5 min)
 *   Authorization: Bearer del tenant. Idempotente por `pedidoId`.
 *   200 ok · 400, 401, 405 (no se reintentan) · 409 faltantes (no se reintenta) · 429, 503 (se reintentan).
 *
 * LO QUE ESTA FUNCIÓN GARANTIZA, y cada línea tiene una prueba que la niega
 * (`pruebas/modulos/pedidos/confirmar-externo.test.ts`):
 *  - El comercio sale del TOKEN (el único comercio en que la sesión es admin u oper), nunca del cuerpo: un
 *    cuerpo con cualquier clave que no sea `pedidoId` se rechaza. Además la cuenta se vuelve a leer
 *    (`cuentaVigenteDe`), el comercio debe estar activo, con el módulo Pedidos y con el catálogo externo
 *    habilitado.
 *  - Lo que sale a NovuTienda se arma desde el pedido guardado y SOLO lleva `productoId` y `cantidad` por línea:
 *    nunca precios, nombres, teléfono ni nada del cliente. Una clave extra no puede salir.
 *  - Estado: solo `recibido` se confirma. `confirmado` devuelve OK SIN llamar de nuevo (idempotente); cualquier
 *    otro estado, y todo pedido que no sea de catálogo externo, se rechaza. El pedido cambia a `confirmado`
 *    SOLO tras un 200. 409, 429/503 agotados, errores de red o de contrato dejan el pedido SIN cambiar.
 *  - Si NovuTienda dijo 200 y la escritura local falla, el operador ve «no disponible» y puede volver a pulsar:
 *    NovuTienda es idempotente por `pedidoId`, así que repetir no descuenta dos veces.
 *  - SECRETO: un solo secreto de Secret Manager (`NOVUTIENDA_CONFIRMAR`) con el mapa
 *      { "<tenantId>": { "baseUrl": "https://…", "bearer": "…", "firmaSecreto": "…" } }
 *    Nunca en el repositorio, en Firestore ni en un log. Ausente, ilegible o sin la entrada del comercio:
 *    falla CERRADO (nada sale). La URL debe ser https, sin usuario ni parámetros; no se siguen redirecciones
 *    (llevarían el Bearer a otro destino).
 *  - Reintento acotado: hasta `MAX_INTENTOS` en 429/503, con espera creciente; cada intento lleva su propia marca
 *    de tiempo y su firma (el cuerpo es el mismo, byte a byte). Cada intento tiene un tope de tiempo.
 *  - Los logs llevan solo el código y el estado HTTP: ni cuerpo, ni URL, ni secreto, ni teléfono.
 *
 * Mensajes de WhatsApp por conversación: 0. Escrituras: una transacción sobre el pedido.
 */
import { createHmac } from 'node:crypto';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { ID_COMERCIO } from '../../core/conversacion/acceso.js';
import { claimsDe, esAdminDe, esOperDe, exigirAutenticado } from '../../core/seguridad/autorizacion.js';
import { cuentaVigenteDe, type RolVerificado } from '../../core/seguridad/vigencia.js';
import { tieneModulo, type FichaConCapacidades } from '../../registro.js';
import { configExternaDe, idExternoValido } from './pedidoDelQr.js';

/** Los estados que un pedido de Pedidos puede tener. `confirmado` lo escribe esta callable (B5b). */
export const ESTADOS_DE_PEDIDO = ['recibido', 'confirmado', 'reemplazado', 'cancelado'] as const;

export const SECRETO_NOVUTIENDA = defineSecret('NOVUTIENDA_CONFIRMAR');

export const RUTA_DE_CONFIRMACION = '/api/novuchat/v1/pedidos/confirmar';
export const MAX_INTENTOS = 3;
export const ESPERAS_ENTRE_INTENTOS_MS: readonly number[] = [500, 1500];
export const ESPERA_POR_INTENTO_MS = 8000;
/** Lo máximo de una respuesta 409 que se lee (los faltantes caben de sobra). */
const MAX_RESPUESTA_409 = 16 * 1024;
export const MAX_CANTIDAD_CONTRATO = 1_000_000;
const MAX_FALTANTES = 30;

/** El contrato de NovuTienda: 1 a 100 caracteres, sin `__`. */
export const idDePedidoParaNovuTienda = (id: unknown): id is string => idExternoValido(id);

export const MENSAJES = {
  noAutorizado: 'No tiene permiso para confirmar pedidos de este negocio.',
  invalido: 'La solicitud no es válida.',
  noExiste: 'El pedido no existe.',
  noElegible: 'Este pedido no se puede confirmar.',
  noConfigurado: 'La confirmación con NovuTienda no está configurada para este negocio.',
  noDisponible: 'No se pudo completar la confirmación. Intente de nuevo en unos minutos.',
  rechazado: 'NovuTienda rechazó la confirmación. Avise a NovuChat.',
  faltantes: 'NovuTienda no tiene stock suficiente para este pedido.',
} as const;

// ---------------------------------------------------------------------------
// PIEZAS PURAS
// ---------------------------------------------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ItemParaNovuTienda { productoId: string; cantidad: number }
export interface CuerpoDeConfirmacion { pedidoId: string; items: ItemParaNovuTienda[]; confirmadoEn: string }

/**
 * El cuerpo EXACTO del contrato, armado desde el pedido guardado. Devuelve `null` si algo no cumple el
 * contrato (id, cantidad, ítems repetidos o vacíos, ítem que no es externo). Solo `productoId` y `cantidad`
 * salen por línea: se copian a mano, jamás se esparce el ítem guardado.
 * `confirmadoEn`: instante ISO 8601 en UTC (el contrato no fija otra forma; ver el informe del bloque).
 */
export function armarCuerpo(pedidoId: string, items: unknown, ahoraMs: number): CuerpoDeConfirmacion | null {
  if (!idDePedidoParaNovuTienda(pedidoId)) return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  const vistos = new Set<string>();
  const salida: ItemParaNovuTienda[] = [];
  for (const i of items) {
    if (!esObjeto(i) || i['externa'] !== true) return null;
    const id = i['id'];
    const cant = i['cantidad'];
    if (!idExternoValido(id) || vistos.has(id)) return null;
    if (typeof cant !== 'number' || !Number.isInteger(cant) || cant < 1 || cant > MAX_CANTIDAD_CONTRATO) return null;
    vistos.add(id);
    salida.push({ productoId: id, cantidad: cant });
  }
  return { pedidoId, items: salida, confirmadoEn: new Date(ahoraMs).toISOString() };
}

/** `HMAC-SHA256(firmaSecreto, "{marca}." + cuerpo exacto)` en hexa. */
export const firmaDeConfirmacion = (secreto: string, marcaMs: number | string, cuerpoExacto: string): string =>
  createHmac('sha256', secreto).update(`${marcaMs}.`).update(cuerpoExacto).digest('hex');

export interface DestinoNovuTienda { url: string; bearer: string; firmaSecreto: string }

/**
 * El destino de un comercio, o `null`. No se fía de la forma del secreto: JSON roto, comercio ausente, URL que
 * no sea https (o con usuario, contraseña, parámetros o ancla) o claves cortas dan `null`.
 */
export function destinoDeNovuTienda(secretoCrudo: unknown, tenantId: string): DestinoNovuTienda | null {
  if (typeof secretoCrudo !== 'string' || secretoCrudo === '') return null;
  let mapa: unknown;
  try { mapa = JSON.parse(secretoCrudo); } catch { return null; }
  if (!esObjeto(mapa) || !Object.hasOwn(mapa, tenantId)) return null;
  const d = mapa[tenantId];
  if (!esObjeto(d)) return null;
  const { baseUrl, bearer, firmaSecreto } = d;
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048) return null;
  if (typeof bearer !== 'string' || bearer.length < 8 || typeof firmaSecreto !== 'string' || firmaSecreto.length < 8) return null;
  let u: URL;
  try { u = new URL(baseUrl); } catch { return null; }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hostname === '' || u.search !== '' || u.hash !== '') return null;
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, '')}${RUTA_DE_CONFIRMACION}`, bearer, firmaSecreto };
}

export interface Faltante { productoId: string; nombre?: string; solicitado?: number; disponible?: number }

const entero = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CANTIDAD_CONTRATO * 10 ? v : undefined;

/**
 * Los faltantes de un 409, legibles: solo ids que ESTE pedido tiene (el nombre sale del pedido, no de la
 * respuesta), y números acotados. Acepta `faltantes: [{productoId|id, solicitado|cantidad, disponible}]`;
 * cualquier otra forma da una lista vacía (el mensaje general igual sale).
 */
export function faltantesLegibles(crudo: string, items: unknown): Faltante[] {
  let r: unknown;
  try { r = JSON.parse(crudo.slice(0, MAX_RESPUESTA_409)); } catch { return []; }
  const lista = esObjeto(r) ? r['faltantes'] : undefined;
  if (!Array.isArray(lista)) return [];
  const nombres = new Map<string, string>();
  for (const i of Array.isArray(items) ? items : []) {
    if (esObjeto(i) && typeof i['id'] === 'string') nombres.set(i['id'], typeof i['nombre'] === 'string' ? i['nombre'] : '');
  }
  const salida: Faltante[] = [];
  for (const f of lista.slice(0, MAX_FALTANTES)) {
    if (!esObjeto(f)) continue;
    const id = typeof f['productoId'] === 'string' ? f['productoId'] : f['id'];
    if (typeof id !== 'string' || !nombres.has(id)) continue;
    const nombre = nombres.get(id);
    const solicitado = entero(f['solicitado'] ?? f['cantidad']);
    const disponible = entero(f['disponible']);
    salida.push({
      productoId: id,
      ...(nombre ? { nombre } : {}),
      ...(solicitado !== undefined ? { solicitado } : {}),
      ...(disponible !== undefined ? { disponible } : {}),
    });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// LA LLAMADA FIRMADA
// ---------------------------------------------------------------------------

export type ResultadoDeLlamada =
  | { tipo: 'ok' }
  | { tipo: 'faltantes'; crudo: string }
  | { tipo: 'rechazado'; estado: number }
  | { tipo: 'agotado'; estado: number }
  | { tipo: 'red' };

export interface DependenciasDeLlamada {
  http: typeof fetch;
  dormir: (ms: number) => Promise<void>;
  ahora: () => number;
}

/**
 * Llama a NovuTienda. 429/503 se reintentan hasta `MAX_INTENTOS`; todo lo demás se responde de inmediato.
 * Nunca lanza: un error de red o un tiempo agotado es `red`.
 */
export async function llamarANovuTienda(
  destino: DestinoNovuTienda, cuerpoExacto: string, d: DependenciasDeLlamada,
): Promise<ResultadoDeLlamada> {
  let ultimo = 0;
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    if (intento > 0) await d.dormir(ESPERAS_ENTRE_INTENTOS_MS[Math.min(intento - 1, ESPERAS_ENTRE_INTENTOS_MS.length - 1)]!);
    const marca = String(d.ahora());
    let r: Response;
    try {
      r = await d.http(destino.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${destino.bearer}`,
          'X-Marca-Tiempo': marca,
          'X-Firma': firmaDeConfirmacion(destino.firmaSecreto, marca, cuerpoExacto),
        },
        body: cuerpoExacto,
        redirect: 'error', // un redirect llevaría el Bearer a otro destino
        signal: AbortSignal.timeout(ESPERA_POR_INTENTO_MS),
      });
    } catch {
      return { tipo: 'red' };
    }
    const estado = r.status;
    if (estado === 200) { vaciar(r); return { tipo: 'ok' }; }
    if (estado === 409) {
      let crudo = '';
      try { crudo = (await r.text()).slice(0, MAX_RESPUESTA_409); } catch { /* sin detalle */ }
      return { tipo: 'faltantes', crudo };
    }
    vaciar(r);
    if (estado === 429 || estado === 503) { ultimo = estado; continue; }
    return { tipo: 'rechazado', estado };
  }
  return { tipo: 'agotado', estado: ultimo };
}

/** Libera la conexión sin esperar: no hace falta leer el cuerpo de una respuesta que no se usa. */
function vaciar(r: Response): void {
  try { void r.body?.cancel().catch(() => undefined); } catch { /* nada que liberar */ }
}

// ---------------------------------------------------------------------------
// LA CALLABLE
// ---------------------------------------------------------------------------

export interface DependenciasDeConfirmacion extends DependenciasDeLlamada {
  leerSecreto: () => string;
  cuentaVigente: typeof cuentaVigenteDe;
  db: () => Firestore;
}

const dependenciasReales = (): DependenciasDeConfirmacion => ({
  leerSecreto: () => SECRETO_NOVUTIENDA.value(),
  cuentaVigente: cuentaVigenteDe,
  db: () => getFirestore(),
  http: (...a) => fetch(...a),
  dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)),
  ahora: () => Date.now(),
});

/** El único comercio en que la sesión es administrador u operador. Ninguno, o más de uno: no hay comercio. */
export function comercioDelToken(p: CallableRequest): { tenantId: string; rol: 'admin' | 'oper' } | null {
  const candidatos = Object.keys(claimsDe(p).t).filter((t) => ID_COMERCIO.test(t) && (esAdminDe(p, t) || esOperDe(p, t)));
  if (candidatos.length !== 1) return null;
  const tenantId = candidatos[0]!;
  return { tenantId, rol: esAdminDe(p, tenantId) ? 'admin' : 'oper' };
}

function registrar(codigo: string, extra: { estado?: number } = {}): void {
  // Solo códigos y estados HTTP: jamás cuerpo, URL, secreto, comercio ni teléfono.
  logger.warn('confirmarPedidoExterno', { codigo, ...(extra.estado !== undefined ? { estado: extra.estado } : {}) });
}

const rechazo = (codigo: ConstructorParameters<typeof HttpsError>[0], mensaje: string, motivo: string, extra?: { estado?: number }): HttpsError => {
  registrar(motivo, extra);
  return new HttpsError(codigo, mensaje);
};

export interface RespuestaDeConfirmacion { pedidoId: string; estado: 'confirmado'; yaConfirmado: boolean }

export async function atenderConfirmacion(p: CallableRequest, d: DependenciasDeConfirmacion): Promise<RespuestaDeConfirmacion> {
  // 1. Quién: sesión, comercio del token, rol.
  const uid = exigirAutenticado(p);
  const quien = comercioDelToken(p);
  if (!quien) throw rechazo('permission-denied', MENSAJES.noAutorizado, 'sin_comercio_en_el_token');
  const { tenantId } = quien;

  // 2. La entrada: SOLO `pedidoId`. Un `tenantId` (o cualquier otra clave) en el cuerpo se rechaza.
  const datos = p.data;
  if (!esObjeto(datos) || Object.keys(datos).some((k) => k !== 'pedidoId') || !idDePedidoParaNovuTienda(datos['pedidoId'])) {
    throw rechazo('invalid-argument', MENSAJES.invalido, 'entrada_invalida');
  }
  const pedidoId = datos['pedidoId'];

  // 3. El token no basta: la cuenta sigue habilitada, con el rol, y la sesión es posterior a la última revocación.
  const authTime = p.auth?.token?.['auth_time'];
  let vigente: boolean;
  try {
    vigente = await d.cuentaVigente(uid, typeof authTime === 'number' ? authTime : Number.NaN, quien.rol as RolVerificado, tenantId);
  } catch {
    throw rechazo('unavailable', MENSAJES.noDisponible, 'cuenta_no_verificable');
  }
  if (!vigente) throw rechazo('permission-denied', MENSAJES.noAutorizado, 'cuenta_no_vigente');

  // 4. El comercio, el pedido y el estado.
  const db = d.db();
  const refPedido = db.doc(`tenants/${tenantId}/pedidos/${pedidoId}`);
  let pedido: Record<string, unknown> | undefined;
  try {
    const [ficha, config, snap] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/config/pedidos`).get(), refPedido.get(),
    ]);
    if (!ficha.exists || ficha.get('estado') !== 'activo' || !tieneModulo(ficha.data() as FichaConCapacidades, 'pedidos')) {
      throw rechazo('permission-denied', MENSAJES.noAutorizado, 'comercio_no_habilitado');
    }
    if (configExternaDe(config.exists ? config.data() : undefined) === null) {
      throw rechazo('failed-precondition', MENSAJES.noElegible, 'sin_catalogo_externo');
    }
    if (!snap.exists) throw rechazo('not-found', MENSAJES.noExiste, 'pedido_inexistente');
    pedido = snap.data();
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw rechazo('unavailable', MENSAJES.noDisponible, 'lectura_fallida');
  }
  if (!pedido || pedido['catalogo'] !== 'externo') throw rechazo('failed-precondition', MENSAJES.noElegible, 'pedido_no_externo');
  if (pedido['estado'] === 'confirmado') return { pedidoId, estado: 'confirmado', yaConfirmado: true };
  if (pedido['estado'] !== 'recibido') throw rechazo('failed-precondition', MENSAJES.noElegible, 'estado_no_confirmable');

  // 5. El cuerpo del contrato y el destino. Sin destino válido no sale nada (falla cerrado).
  const cuerpo = armarCuerpo(pedidoId, pedido['items'], d.ahora());
  if (!cuerpo) throw rechazo('failed-precondition', MENSAJES.noElegible, 'pedido_fuera_de_contrato');
  let secreto: string;
  try { secreto = d.leerSecreto(); } catch { throw rechazo('failed-precondition', MENSAJES.noConfigurado, 'secreto_ausente'); }
  const destino = destinoDeNovuTienda(secreto, tenantId);
  if (!destino) throw rechazo('failed-precondition', MENSAJES.noConfigurado, 'destino_invalido');

  // 6. La llamada firmada.
  const r = await llamarANovuTienda(destino, JSON.stringify(cuerpo), d);
  if (r.tipo === 'faltantes') {
    registrar('stock_insuficiente', { estado: 409 });
    throw new HttpsError('failed-precondition', MENSAJES.faltantes, {
      motivo: 'stock_insuficiente', faltantes: faltantesLegibles(r.crudo, pedido['items']),
    });
  }
  if (r.tipo === 'rechazado') throw rechazo('internal', MENSAJES.rechazado, 'novutienda_rechazo', { estado: r.estado });
  if (r.tipo === 'agotado') throw rechazo('unavailable', MENSAJES.noDisponible, 'novutienda_no_disponible', { estado: r.estado });
  if (r.tipo === 'red') throw rechazo('unavailable', MENSAJES.noDisponible, 'novutienda_sin_respuesta');

  // 7. NovuTienda aceptó (200): recién ahora cambia el estado, solo si sigue en `recibido`.
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(refPedido);
      if (!s.exists || s.get('estado') === 'confirmado') return;
      if (s.get('estado') !== 'recibido') throw new HttpsError('failed-precondition', MENSAJES.noElegible);
      tx.update(refPedido, { estado: 'confirmado', confirmadoEn: Timestamp.fromMillis(d.ahora()), confirmadoPor: uid });
    });
  } catch (e) {
    if (e instanceof HttpsError) throw rechazo(e.code, e.message, 'estado_cambio_durante_la_llamada');
    throw rechazo('unavailable', MENSAJES.noDisponible, 'escritura_fallida');
  }
  return { pedidoId, estado: 'confirmado', yaConfirmado: false };
}

export function crearConfirmarPedidoExterno(d: DependenciasDeConfirmacion) {
  return onCall(
    { region: REGION, memory: '256MiB', maxInstances: 3, timeoutSeconds: 60, secrets: [SECRETO_NOVUTIENDA] },
    async (p: CallableRequest) => {
      try {
        return await atenderConfirmacion(p, d);
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        registrar('error_no_previsto');
        throw new HttpsError('unavailable', MENSAJES.noDisponible);
      }
    },
  );
}

export const confirmarPedidoExterno = crearConfirmarPedidoExterno({
  ...dependenciasReales(),
});
