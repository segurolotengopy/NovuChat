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
 *  - Entrada `{tenantId, pedidoId}` (ninguna otra clave). Se exige `esAdminDe` / `esOperDe` de ESE `tenantId`
 *    (contraseña y correo verificado; el soporte no cuenta): un comercio ajeno es `permission-denied`. Además la
 *    cuenta se vuelve a leer (`cuentaVigenteDe`), el comercio debe estar activo, con el módulo Pedidos y con el
 *    catálogo externo habilitado. No se exige sesión reciente: esa barrera es para mover dinero a mano.
 *  - Lo que sale a NovuTienda se arma desde el pedido guardado y SOLO lleva `productoId` y `cantidad` por línea:
 *    nunca precios, nombres, teléfono ni nada del cliente. Una clave extra no puede salir.
 *  - Estados: `recibido` -> `confirmando` (transacción, ANTES de llamar) -> `confirmado` (solo tras un 200).
 *    Mientras está `confirmando`, `cerrarPedidoWa` (solo actúa sobre `recibido`) no puede reemplazarlo ni cancelarlo,
 *    y una segunda confirmación simultánea no llama (hace UNA sola llamada). 409, 429/503 agotados, red, tiempo o
 *    contrato devuelven el pedido a `recibido` en transacción. Un `confirmando` de más de 2 min (la Function murió a
 *    medias) se puede retomar. `confirmado` devuelve OK SIN llamar de nuevo; cualquier otro estado, y todo pedido
 *    que no sea de catálogo externo, se rechaza.
 *  - `confirmadoEn` guardado es EXACTAMENTE el instante enviado (se parsea del cuerpo). Si el pedido se borró
 *    durante la llamada, `not-found`. Si la escritura final falla tras el 200, queda `confirmando` y se puede
 *    retomar pasados 2 min; NovuTienda es idempotente por `pedidoId`, así que repetir no descuenta dos veces.
 *  - App Check por ambiente (producción sí, staging y emulador no) y concurrencia explícita baja (10).
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
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { ID_COMERCIO } from '../../core/conversacion/acceso.js';
import { esAdminDe, esOperDe, exigirAutenticado } from '../../core/seguridad/autorizacion.js';
import { cuentaVigenteDe, type RolVerificado } from '../../core/seguridad/vigencia.js';
import { tieneModulo, type FichaConCapacidades } from '../../registro.js';
import { configExternaDe, idExternoValido } from './pedidoDelQr.js';

/** Los estados que un pedido de Pedidos puede tener. `confirmado` lo escribe esta callable (B5b). */
export const ESTADOS_DE_PEDIDO = ['recibido', 'confirmando', 'confirmado', 'reemplazado', 'cancelado'] as const;
export type EstadoDePedido = typeof ESTADOS_DE_PEDIDO[number];
/** El estado guardado, o `null` si no es uno conocido (un valor ajeno nunca se confirma). */
export const estadoDelPedido = (v: unknown): EstadoDePedido | null =>
  ESTADOS_DE_PEDIDO.find((e) => e === v) ?? null;
/** Un `confirmando` más viejo que esto se da por abandonado (la Function murió a medias) y se puede retomar. */
export const CONFIRMANDO_MAXIMO_MS = 2 * 60_000;

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
  enCurso: 'Este pedido ya se está confirmando. Espere unos segundos.',
} as const;

// ---------------------------------------------------------------------------
// PIEZAS PURAS
// ---------------------------------------------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Milisegundos de un Timestamp de Firestore (o `null` si no lo es). */
const milisegundosDe = (v: unknown): number | null =>
  typeof v === 'object' && v !== null && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : null;

export interface ItemParaNovuTienda { productoId: string; cantidad: number }
export interface CuerpoDeConfirmacion { pedidoId: string; items: ItemParaNovuTienda[]; confirmadoEn: string }

/**
 * El cuerpo EXACTO del contrato, armado desde el pedido guardado. Devuelve `null` si algo no cumple el
 * contrato (id, cantidad, ítems repetidos o vacíos, ítem que no es externo). Solo `productoId` y `cantidad`
 * salen por línea: se copian a mano, jamás se esparce el ítem guardado.
 * SUPUESTO (contrato v1 no lo fija): `confirmadoEn` es el instante ISO 8601 en UTC (`toISOString()`). El contrato
 * solo dice que existe la clave; si NovuTienda espera ms u otro formato, se cambia SOLO esta línea.
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
 * respuesta), y números acotados.
 * SUPUESTO (contrato v1 no lo fija): el cuerpo del 409 es `{"faltantes":[{"productoId","solicitado","disponible"}]}`.
 * No se aceptan alias. Cualquier otra forma da una lista vacía (el mensaje general igual sale).
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
    const id = f['productoId'];
    if (typeof id !== 'string' || !nombres.has(id)) continue;
    const nombre = nombres.get(id);
    const solicitado = entero(f['solicitado']);
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

function registrar(codigo: string, extra: { estado?: number } = {}): void {
  // Solo códigos y estados HTTP: jamás cuerpo, URL, secreto, comercio ni teléfono.
  logger.warn('confirmarPedidoExterno', { codigo, ...(extra.estado !== undefined ? { estado: extra.estado } : {}) });
}

const rechazo = (codigo: ConstructorParameters<typeof HttpsError>[0], mensaje: string, motivo: string, extra?: { estado?: number }): HttpsError => {
  registrar(motivo, extra);
  return new HttpsError(codigo, mensaje);
};

export interface RespuestaDeConfirmacion { pedidoId: string; estado: 'confirmado'; yaConfirmado: boolean }

/** Lo que la transacción de reclamo entrega: el cuerpo ya armado y el instante (ms) que lo ata al reclamo. */
interface Reclamo { cuerpo: CuerpoDeConfirmacion; instanteMs: number; items: unknown; destino: DestinoNovuTienda }
type ResultadoDeReclamo = { ya: true } | ({ ya: false } & Reclamo);

export async function atenderConfirmacion(p: CallableRequest, d: DependenciasDeConfirmacion): Promise<RespuestaDeConfirmacion> {
  // 1. Quién: sesión, forma de la entrada y rol DE ESE comercio (esAdminDe / esOperDe; el soporte no cuenta).
  const uid = exigirAutenticado(p);
  const datos = p.data;
  if (!esObjeto(datos) || Object.keys(datos).some((k) => k !== 'tenantId' && k !== 'pedidoId')
    || typeof datos['tenantId'] !== 'string' || !ID_COMERCIO.test(datos['tenantId']) || !idDePedidoParaNovuTienda(datos['pedidoId'])) {
    throw rechazo('invalid-argument', MENSAJES.invalido, 'entrada_invalida');
  }
  const tenantId = datos['tenantId'];
  const pedidoId = datos['pedidoId'];
  const rol: 'admin' | 'oper' | null = esAdminDe(p, tenantId) ? 'admin' : esOperDe(p, tenantId) ? 'oper' : null;
  if (rol === null) throw rechazo('permission-denied', MENSAJES.noAutorizado, 'sin_rol_en_el_comercio');

  // 2. El token no basta: la cuenta sigue habilitada, con el rol, y la sesión es posterior a la última revocación.
  // No se exige SESIÓN RECIENTE (`exigirSesionReciente`): esa barrera es para mover dinero a mano; acá el operador
  // confirma el pedido de su propio comercio y NovuTienda es idempotente por `pedidoId`, así que repetir no daña.
  const authTime = p.auth?.token?.['auth_time'];
  let vigente: boolean;
  try {
    vigente = await d.cuentaVigente(uid, typeof authTime === 'number' ? authTime : Number.NaN, rol as RolVerificado, tenantId);
  } catch {
    throw rechazo('unavailable', MENSAJES.noDisponible, 'cuenta_no_verificable');
  }
  if (!vigente) throw rechazo('permission-denied', MENSAJES.noAutorizado, 'cuenta_no_vigente');

  // 3. El destino se resuelve DENTRO del reclamo, después de las comprobaciones de estado y ANTES de escribir: sin
  // destino válido no sale nada ni cambia nada (falla cerrado), y un pedido ya confirmado responde sin necesitarlo.
  const destinoDeEsteComercio = (): DestinoNovuTienda => {
    let secreto: string;
    try { secreto = d.leerSecreto(); } catch { throw rechazo('failed-precondition', MENSAJES.noConfigurado, 'secreto_ausente'); }
    const destino = destinoDeNovuTienda(secreto, tenantId);
    if (!destino) throw rechazo('failed-precondition', MENSAJES.noConfigurado, 'destino_invalido');
    return destino;
  };

  // 4. El reclamo: en UNA transacción se relee todo y el pedido pasa de `recibido` a `confirmando`. Mientras está
  // `confirmando`, `cerrarPedidoWa` (solo actúa sobre `recibido`) no puede reemplazarlo ni cancelarlo, y una segunda
  // confirmación simultánea no pasa. Un `confirmando` de más de `CONFIRMANDO_MAXIMO_MS` se puede retomar.
  const db = d.db();
  const refPedido = db.doc(`tenants/${tenantId}/pedidos/${pedidoId}`);
  let reclamo: ResultadoDeReclamo;
  try {
    reclamo = await db.runTransaction(async (tx): Promise<ResultadoDeReclamo> => {
      const [ficha, config, snap] = await Promise.all([
        tx.get(db.doc(`tenants/${tenantId}`)), tx.get(db.doc(`tenants/${tenantId}/config/pedidos`)), tx.get(refPedido),
      ]);
      if (!ficha.exists || ficha.get('estado') !== 'activo' || !tieneModulo(ficha.data() as FichaConCapacidades, 'pedidos')) {
        throw rechazo('permission-denied', MENSAJES.noAutorizado, 'comercio_no_habilitado');
      }
      if (configExternaDe(config.exists ? config.data() : undefined) === null) {
        throw rechazo('failed-precondition', MENSAJES.noElegible, 'sin_catalogo_externo');
      }
      if (!snap.exists) throw rechazo('not-found', MENSAJES.noExiste, 'pedido_inexistente');
      const pedido = snap.data() as Record<string, unknown>;
      if (pedido['catalogo'] !== 'externo') throw rechazo('failed-precondition', MENSAJES.noElegible, 'pedido_no_externo');
      const ahora = d.ahora();
      const estado = estadoDelPedido(pedido['estado']);
      if (estado === 'confirmado') return { ya: true };
      if (estado === 'confirmando') {
        const desde = milisegundosDe(pedido['confirmandoEn']);
        if (desde !== null && ahora - desde <= CONFIRMANDO_MAXIMO_MS) throw rechazo('failed-precondition', MENSAJES.enCurso, 'ya_se_esta_confirmando');
      } else if (estado !== 'recibido') {
        throw rechazo('failed-precondition', MENSAJES.noElegible, 'estado_no_confirmable');
      }
      const cuerpo = armarCuerpo(pedidoId, pedido['items'], ahora);
      if (!cuerpo) throw rechazo('failed-precondition', MENSAJES.noElegible, 'pedido_fuera_de_contrato');
      const destino = destinoDeEsteComercio();
      // El instante que se ENVÍA es el que se guarda: se toma del propio cuerpo.
      const instanteMs = Date.parse(cuerpo.confirmadoEn);
      tx.update(refPedido, { estado: 'confirmando', confirmandoEn: Timestamp.fromMillis(instanteMs), confirmandoPor: uid });
      return { ya: false, cuerpo, instanteMs, items: pedido['items'], destino };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw rechazo('unavailable', MENSAJES.noDisponible, 'lectura_fallida');
  }
  if (reclamo.ya) return { pedidoId, estado: 'confirmado', yaConfirmado: true };
  const { cuerpo, instanteMs, items, destino } = reclamo;

  // 5. Desde acá el pedido está `confirmando`: TODO camino que no termine en 200 lo devuelve a `recibido`.
  const devolver = async (): Promise<void> => {
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(refPedido);
        // Solo el reclamo propio: si otro lo retomó (pasados 2 min) o ya está confirmado, no se toca.
        if (!s.exists || s.get('estado') !== 'confirmando' || s.get('confirmandoPor') !== uid || milisegundosDe(s.get('confirmandoEn')) !== instanteMs) return;
        tx.update(refPedido, { estado: 'recibido', confirmandoEn: FieldValue.delete(), confirmandoPor: FieldValue.delete() });
      });
    } catch {
      // Si ni esto se pudo, el pedido queda `confirmando` y se puede retomar pasados CONFIRMANDO_MAXIMO_MS.
      registrar('no_se_pudo_devolver_a_recibido');
    }
  };

  let fallo: HttpsError | null = null;
  try {
    const r = await llamarANovuTienda(destino, JSON.stringify(cuerpo), d);
    if (r.tipo === 'faltantes') {
      registrar('stock_insuficiente', { estado: 409 });
      fallo = new HttpsError('failed-precondition', MENSAJES.faltantes, { motivo: 'stock_insuficiente', faltantes: faltantesLegibles(r.crudo, items) });
    } else if (r.tipo === 'rechazado') fallo = rechazo('internal', MENSAJES.rechazado, 'novutienda_rechazo', { estado: r.estado });
    else if (r.tipo === 'agotado') fallo = rechazo('unavailable', MENSAJES.noDisponible, 'novutienda_no_disponible', { estado: r.estado });
    else if (r.tipo === 'red') fallo = rechazo('unavailable', MENSAJES.noDisponible, 'novutienda_sin_respuesta');
  } catch {
    fallo = rechazo('unavailable', MENSAJES.noDisponible, 'error_no_previsto_en_la_llamada');
  }
  if (fallo) {
    await devolver();
    throw fallo;
  }

  // 6. NovuTienda aceptó (200): `confirmando` pasa a `confirmado` con EXACTAMENTE el instante enviado.
  // Si el pedido ya no existe (borrado durante la llamada), not-found: no se inventa un documento.
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(refPedido);
      if (!s.exists) throw rechazo('not-found', MENSAJES.noExiste, 'pedido_borrado_tras_el_200');
      const estado = estadoDelPedido(s.get('estado'));
      if (estado === 'confirmado') return;
      if (estado !== 'confirmando' && estado !== 'recibido') throw rechazo('failed-precondition', MENSAJES.noElegible, 'estado_cambio_durante_la_llamada');
      tx.update(refPedido, {
        estado: 'confirmado', confirmadoEn: Timestamp.fromMillis(Date.parse(cuerpo.confirmadoEn)), confirmadoPor: uid,
        confirmandoEn: FieldValue.delete(), confirmandoPor: FieldValue.delete(),
      });
    });
  } catch (e) {
    // Con la escritura caída el pedido queda `confirmando`: se puede volver a pulsar pasados 2 min (o antes no:
    // otro intento ve «se está confirmando»). NovuTienda es idempotente por `pedidoId`.
    if (e instanceof HttpsError) throw e;
    throw rechazo('unavailable', MENSAJES.noDisponible, 'escritura_fallida');
  }
  return { pedidoId, estado: 'confirmado', yaConfirmado: false };
}

/** ¿Se exige App Check? Producción sí; staging no (el build de staging no lleva la clave del sitio); emulador tampoco. */
export const APP_CHECK_DE_CONFIRMAR = { produccion: true, staging: false } as const;
/** Concurrencia explícita y baja; en staging (CPU fraccionaria) no se fija. */
export const CONCURRENCIA_DE_CONFIRMAR = 10;

export function opcionesDeConfirmar(env: Record<string, string | undefined>): CallableOptions {
  const staging = env['CPU_FRACCIONARIA'] === 'si';
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  return {
    region: REGION,
    memory: '256MiB',
    maxInstances: 3,
    ...(staging ? {} : { concurrency: CONCURRENCIA_DE_CONFIRMAR }),
    timeoutSeconds: 60,
    enforceAppCheck: emulador ? false : staging ? APP_CHECK_DE_CONFIRMAR.staging : APP_CHECK_DE_CONFIRMAR.produccion,
    secrets: [SECRETO_NOVUTIENDA],
  };
}

export function crearConfirmarPedidoExterno(d: DependenciasDeConfirmacion) {
  return onCall(opcionesDeConfirmar(process.env), async (p: CallableRequest) => {
    try {
      return await atenderConfirmacion(p, d);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      registrar('error_no_previsto');
      throw new HttpsError('unavailable', MENSAJES.noDisponible);
    }
  });
}

export const confirmarPedidoExterno = crearConfirmarPedidoExterno({
  ...dependenciasReales(),
});
