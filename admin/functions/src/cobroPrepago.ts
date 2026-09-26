/**
 * =============================================================================
 * COBRO DEL PREPAGO POR QR — NovuChat le cobra al comercio, por el cobrador
 * =============================================================================
 *
 * LA DIRECCIÓN DEL DINERO, antes que nada. Esto NO es la seña de `cobro.ts`
 * ni de `sena.ts`: allá el comercio le cobra a su cliente con la cuenta del
 * comercio y NovuChat no toca la plata. Acá **NovuChat le cobra al comercio**
 * la mensualidad, la bolsa o la instalación, con la cuenta de cobro de
 * NovuChat en el proyecto de cobros. Credenciales, colecciones, pantallas y
 * textos separados (decisión 2 del frente); este archivo no importa `cobro.ts`,
 * `sena.ts`, `cotejo.ts` ni `qrSimple.ts`, y `pruebas/prepago-separacion.test.ts`
 * lo exige leyendo la fuente.
 *
 * QUIÉN CONFIRMA UN PAGO, y es la regla que gobierna todo (decisión 5): el
 * banco, a través de la consulta autenticada `estadoCobro` al cobrador, o el
 * propietario con evidencia y auditoría (`pagos.ts`, bloque A-1). **El aviso
 * del cobrador no confirma nada**: se verifica su firma, y después se le
 * pregunta al cobrador, con nuestro token, en qué estado está el cobro. Solo
 * si esa respuesta dice `CONFIRMADO` se suman meses. Aunque el secreto del
 * aviso se filtrara, nadie acredita un mes sin que el cobrador, autenticado,
 * lo afirme. El barrido horario llega al mismo resultado sin aviso.
 *
 * LAS CUATRO PUERTAS DE ESTE ARCHIVO (DISENO.md §4undecies.5 y .7):
 *
 *   - `crearCobroPrepago` (callable; admin del comercio o propietario): TCO
 *     del día, un solo pendiente por cuenta, `pagoId` opaco que es también la
 *     referencia externa, QR como PNG en Storage, índice `/cobrosPendientes`.
 *   - `avisoCobrador` (HTTP, sin CORS): firma → consulta autenticada → aplica.
 *     Idempotente: un aviso repetido no suma nada.
 *   - `sondeoCobros` (cada 5 minutos): mientras el cobrador no mande aviso
 *     (bloque 2 de C), es lo que acredita rápido. Consulta solo los
 *     pendientes con el QR vivo (`QR_ACTIVO`, `PAGO_DETECTADO`, sin vencer);
 *     si no hay ninguno, no llama al cobrador (`Prompts/prepago-estricto.md`,
 *     bloque 2, según el #134).
 *   - `barridoCobros` (cada hora): recorre `/cobrosPendientes`, consulta y
 *     aplica la tabla de estados. Anula lo que venció hace más de un día:
 *     el banco vence los QR por día, y uno «olvidado» sigue pagable.
 *   - `imagenDePago` (HTTP pública, por ficha al azar): el PNG para que Meta
 *     lo descargue; 404 si el pago ya no está pendiente.
 *
 * LA TABLA DE ESTADOS del cobrador → pago de NovuChat, aplicada literal:
 *
 *   BORRADOR        → sigue pendiente; se reintenta con la MISMA referencia
 *   QR_ACTIVO       → pendiente
 *   PAGO_DETECTADO  → pendiente (se anota `cobro.estado`; no se acredita nada)
 *   CONFIRMADO      → confirmado: LA ÚNICA transición que suma meses
 *   EN_REVISION     → pendiente; auditoría
 *   VENCIDO         → vencido; se limpia `pagoPendienteId`
 *   ANULADO/RECHAZADO → anulado
 *
 * COSTO EN MENSAJES: 0. La confirmación por WhatsApp solo se ENCOLA en
 * `cuenta.confirmacionesPendientes`; la manda el módulo de A-4.
 *
 * La puerta que suma meses es `pagos.ts` (A-1): `aplicarPagoEnTransaccion`.
 * El `pagos-stub.ts` provisorio se borró al integrar A-1 (21/09).
 */
import { onCall, onRequest, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp, getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomBytes } from 'node:crypto';
import { REGION } from './region.js';
import { registrar } from './ingesta.js';
import {
  COBRADOR_AVISO_SECRETO, COBRADOR_TOKEN, ErrorCobrador, CobradorNoResponde,
  configCobradorDe, montoDesdeTexto, resolverCobrador, verificarAviso,
  VIGENCIA_HORAS_POR_DEFECTO, type AvisoDeConfirmacion, type Cobrador, type CobroDelCobrador, type RespuestaCrear,
} from './cobrador.js';
import {
  MONEDA_COBRO, MONEDA_LISTA, descripcionDe, importeBs, modalidadDe, montoFueraDeContrato, montoUsdDe, type CuentaCruda,
} from './prepago.js';
import { SinTipoDeCambio, tipoCambioDe } from './tipoCambio.js';
import { planQuePuedePedir, precioMensualDe } from './planes.js';
import { exigirSesionReciente } from './autorizacion.js';
import {
  auditoriaDeLimites, cambioAutorizado, conceptoDe, esPedidoDePago, puertaDePagos,
  type Confirmacion, type PedidoDePago, type PuertaDePagos,
} from './pagos.js';

const db = () => getFirestore();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** `randomBytes(16).toString('base64url')`: 22 caracteres del juego `[A-Za-z0-9_-]`. */
const ID_PAGO = /^[A-Za-z0-9_-]{22}$/;
const FICHA = /^[0-9a-f]{32}$/;
const HORA = 3_600_000;
const DIA = 24 * HORA;
/** Un pendiente que nunca llegó a emitir su QR se cierra pasado este plazo. */
const RESERVA_SIN_EMITIR_MS = 4 * DIA;
/** Cuántos pendientes revisa el barrido por corrida. */
export const TOPE_BARRIDO = 500;
/**
 * Cuántas consultas hace el sondeo por corrida. `estadoCobro` no toca el banco
 * (lee el estado que mantiene el satélite del cobrador), pero cada consulta es
 * una petición autenticada más: con 100 por corrida y una corrida cada 5
 * minutos, el techo es 1.200 por hora, y en la práctica son tantas como QR
 * vivos haya. Lo que no entra en una corrida entra en la siguiente, o en el
 * barrido horario.
 */
export const TOPE_SONDEO = 100;
/** Los estados del cobrador que el sondeo vigila: el QR está vivo y puede pagarse. */
export const ESTADOS_SONDEABLES = ['QR_ACTIVO', 'PAGO_DETECTADO'] as const;
const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_MAXIMO = 512 * 1024;

const texto = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const ultimos4 = (v: string) => v.slice(-4);

// ---------------------------------------------------------------------------
// STORAGE, inyectable: el emulador de Firestore no trae Storage
// ---------------------------------------------------------------------------

export interface Almacen {
  guardar(ruta: string, bytes: Buffer, contentType: string): Promise<void>;
  leer(ruta: string): Promise<Buffer | null>;
}

const almacenDeStorage: Almacen = {
  async guardar(ruta, bytes, contentType) {
    await getStorage().bucket().file(ruta).save(bytes, {
      contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' },
    });
  },
  async leer(ruta) {
    const archivo = getStorage().bucket().file(ruta);
    const [existe] = await archivo.exists();
    if (!existe) return null;
    const [bytes] = await archivo.download();
    return bytes;
  },
};

let almacenDePrueba: Almacen | null = null;
/** Solo con `COBRADOR_DOBLE` en el entorno, como `registrarCobradorDoble`. */
export function fijarAlmacenDePrueba(a: Almacen | null): void {
  if (!process.env['COBRADOR_DOBLE']) throw new Error('fijarAlmacenDePrueba exige COBRADOR_DOBLE en el entorno');
  almacenDePrueba = a;
}
const almacen = (): Almacen => almacenDePrueba ?? almacenDeStorage;

/** Dependencias inyectables de cada operación; en producción, todas por defecto. */
export interface Deps {
  cobrador?: Cobrador;
  puerta?: PuertaDePagos;
  ahoraMs?: number;
}

// ---------------------------------------------------------------------------
// AUTORIZACIÓN — las Functions se saltan las reglas; se comprueba a mano
// ---------------------------------------------------------------------------

type Quien = { uid: string; rol: 'admin' | 'propietario' };

/**
 * Administrador del comercio (sesión de contraseña con correo verificado, como
 * `esAdmin()` de las reglas) o propietario (sesión de Google, T-19). El vínculo
 * rol ↔ proveedor va acá porque `index.ts:exigirAdminDe` todavía no lo mira
 * (lo agrega A-1); un claim de admin en una sesión de Google es inerte en las
 * reglas y tiene que serlo también acá.
 */
function exigirAdminOPropietario(p: CallableRequest, tenantId: string): Quien {
  const uid = p.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicie sesión.');
  const token = (p.auth?.token ?? {}) as Record<string, unknown>;
  const nc = (typeof token['nc'] === 'object' && token['nc'] !== null ? token['nc'] : {}) as Record<string, unknown>;
  const proveedor = (token['firebase'] as { sign_in_provider?: unknown } | undefined)?.sign_in_provider;
  if (nc['p'] === true && proveedor === 'google.com') return { uid, rol: 'propietario' };
  const roles = (typeof nc['t'] === 'object' && nc['t'] !== null ? nc['t'] : {}) as Record<string, unknown>;
  if (roles[tenantId] === 'admin' && proveedor === 'password' && token['email_verified'] === true) {
    return { uid, rol: 'admin' };
  }
  throw new HttpsError('permission-denied', 'Solo el administrador del negocio o NovuChat.');
}

const auditar = (tenantId: string, accion: string, quien: string, detalle: object = {}) =>
  db().collection(`tenants/${tenantId}/auditoria`).add({ accion, uid: quien, en: Timestamp.now(), ...detalle })
    .catch(() => console.error(`No se pudo auditar ${accion} en ${tenantId}`));

// ---------------------------------------------------------------------------
// EL PAGO EN FIRESTORE
// ---------------------------------------------------------------------------

/** Lo que `pago.cobro` guarda del cobrador. `SIN_EMITIR`: reservado acá, todavía sin pedir el QR. */
interface CobroGuardado {
  id: string | null;
  estado: string;   // EstadoCobrador | 'SIN_EMITIR' | 'QR_SUELTO'
  venceEn: Timestamp | null;
  creadoEn: Timestamp | null;
  fichaQr: string;
  qrRuta: string | null;
}

const cobroGuardadoDe = (datos: Record<string, unknown> | undefined): CobroGuardado | null => {
  const c = datos?.['cobro'];
  if (typeof c !== 'object' || c === null) return null;
  const r = c as Record<string, unknown>;
  return {
    id: typeof r['id'] === 'string' ? r['id'] : null,
    estado: typeof r['estado'] === 'string' ? r['estado'] : 'SIN_EMITIR',
    venceEn: r['venceEn'] instanceof Timestamp ? r['venceEn'] : null,
    creadoEn: r['creadoEn'] instanceof Timestamp ? r['creadoEn'] : null,
    fichaQr: typeof r['fichaQr'] === 'string' ? r['fichaQr'] : '',
    qrRuta: typeof r['qrRuta'] === 'string' ? r['qrRuta'] : null,
  };
};

const refs = (tenantId: string, pagoId: string) => ({
  pago: db().doc(`tenants/${tenantId}/pagos/${pagoId}`),
  cuenta: db().doc(`tenants/${tenantId}/cuenta/estado`),
  ficha: db().doc(`tenants/${tenantId}`),
  cobroPendiente: db().doc(`cobrosPendientes/${pagoId}`),
  cobroResuelto: db().doc(`cobrosResueltos/${pagoId}`),
});

const rutaQr = (tenantId: string, pagoId: string) => `tenants/${tenantId}/pagos/${pagoId}/qr.png`;

const milis = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null);
const fechaIso = (v: unknown): Timestamp | null => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Timestamp.fromMillis(ms) : null;
};

/** Decodifica el PNG del cobrador; `null` si no es PNG o pesa más de 512 KiB. */
export function decodificarPng(base64: string | null): Buffer | null {
  if (!base64 || base64.length > PNG_MAXIMO * 2) return null;
  let bytes: Buffer;
  try { bytes = Buffer.from(base64, 'base64'); } catch { return null; }
  if (bytes.length < 8 || bytes.length > PNG_MAXIMO) return null;
  return bytes.subarray(0, 8).equals(PNG_FIRMA) ? bytes : null;
}

export interface PagoEmitido {
  pagoId: string;
  estado: 'pendiente';
  tipo: PedidoDePago['tipo'];
  descripcion: string;
  montoUsd: number;
  monto: number;
  moneda: 'BOB';
  tcoAplicado: number;
  tcoFuente: string;
  tcoFecha: string;
  venceEn: number;
  fichaQr: string;
  cobro: { id: string; estado: string };
  /** `true` si se retomó una reserva anterior con la misma referencia. */
  reutilizado: boolean;
}

// ---------------------------------------------------------------------------
// CREAR: reservar → pedir el QR → registrar
// ---------------------------------------------------------------------------

/**
 * La función interna que comparten la callable de la consola y, cuando
 * exista, `pagoPorWhatsapp` (A-4). Tres pasos, y el orden importa:
 *
 *  1. UNA TRANSACCIÓN RESERVA. Lee la cuenta; si hay un pendiente vivo (QR
 *     emitido y sin vencer) rechaza y lo devuelve; si el pendiente nunca llegó
 *     a emitir su QR —falló el banco, o quedó `BORRADOR`— lo RETOMA: misma
 *     referencia, mismo pedido. Si no hay nada, crea el pago, escribe
 *     `pagoPendienteId` y `/cobrosPendientes`. Dos llamadas simultáneas chocan
 *     en la cuenta y la segunda relee y encuentra el pendiente de la primera.
 *  2. SE LE PIDE EL QR AL COBRADOR con esa referencia. Es idempotente allá:
 *     un reintento devuelve el mismo cobro y el mismo QR, nunca dos.
 *  3. OTRA TRANSACCIÓN ANOTA el cobro. Si el cobrador no respondió, la reserva
 *     queda: la próxima llamada la retoma. Si dijo `QR_SUELTO_EN_EL_PROVEEDOR`,
 *     la reserva se marca y NO se reintenta con esa referencia hasta revisar.
 */
export async function crearCobroInterno(
  tenantId: string,
  pedido: PedidoDePago,
  quien: {
    uid: string; creadoPor: string; canal: 'consola' | 'whatsapp' | 'manual'; rol?: 'admin' | 'propietario';
    /**
     * La sesión del propietario tiene menos de media hora (`exigirSesionReciente`).
     * Solo se mira si el pedido es una mensualidad de OTRO plan: eso deja la
     * firma `cambioAutorizadoPor`, que después cambia el plan sin más control.
     * Sin el dato, se toma como NO reciente: ante la duda, no se firma.
     */
    sesionReciente?: boolean;
  },
  deps: Deps = {},
): Promise<PagoEmitido> {
  const ahoraMs = deps.ahoraMs ?? Date.now();
  const ahora = Timestamp.fromMillis(ahoraMs);
  const [tcDoc, plataformaDoc] = await Promise.all([
    db().doc('plataforma/tipoCambio').get(), db().doc('plataforma/prepago').get(),
  ]);
  let tc;
  try { tc = tipoCambioDe(tcDoc.data(), ahoraMs); } catch (e) {
    if (e instanceof SinTipoDeCambio) throw new HttpsError('failed-precondition', 'No hay tipo de cambio del día: no se puede emitir el cobro.');
    throw e;
  }
  // EL IMPORTE SE DECIDE EN LA RESERVA, contra la cuenta leída en la
  // transacción (F1b): una mensualidad cuesta `precioMensualDe(cuenta)`, el
  // precio por contrato si la cuenta tiene uno. Nadie lo manda desde afuera:
  // ni la consola ni el WhatsApp pueden pedir un QR por otro importe.
  const tco = tc.tco;
  const vigenciaHoras = configCobradorDe(plataformaDoc.data())?.vigenciaHoras ?? VIGENCIA_HORAS_POR_DEFECTO;
  const descripcion = descripcionDe(pedido);

  const refCuenta = db().doc(`tenants/${tenantId}/cuenta/estado`);
  const refFicha = db().doc(`tenants/${tenantId}`);

  // 0. HAY CON QUIÉN COBRAR, ANTES DE RESERVAR NADA. Se resolvía después de la
  // reserva: sin `plataforma/prepago.cobrador` el pago quedaba `pendiente`, con
  // `pagoPendienteId` y en `cobrosPendientes`, y no se podía anular desde la
  // consola --anular también necesita el cobrador--; el barrido horario volvía
  // a fallar por ese pendiente. Con «Pagar» a la vista de todo administrador,
  // bastaba apretar el botón antes de que existiera el cobrador (24/09/2026).
  let cobrador: Cobrador;
  try { cobrador = await resolverCobrador(deps.cobrador); } catch {
    throw new HttpsError('failed-precondition', 'El pago por QR todavía no está habilitado. Escríbale a NovuChat para pagar.');
  }

  // 1. Reservar (o retomar).
  const reserva = await db().runTransaction(async (tx) => {
    const [fichaDoc, cuentaDoc] = await Promise.all([tx.get(refFicha), tx.get(refCuenta)]);
    if (!fichaDoc.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    // Un comercio dado de baja no tiene nada que pagar; uno suspendido sí
    // (la suspensión es justamente lo que un pago levanta).
    if (!['activo', 'suspendido'].includes(String(fichaDoc.get('estado') ?? ''))) {
      throw new HttpsError('failed-precondition', 'Este comercio no está en condiciones de emitir un cobro.');
    }
    const cuenta = cuentaDoc.data() ?? {};
    // UNA CUENTA EN DEMOSTRACIÓN NO EMITE COBROS (Andres, 26/09/2026, opción
    // B): en demostración el precio es cero y un pago ya no cambia la
    // modalidad, así que el comercio pagaría por nada. Tampoco el propietario:
    // primero la pasa a prueba o a producción en Negocios. Antes de reservar.
    if (modalidadDe(cuenta as CuentaCruda) === 'demostracion') {
      throw new HttpsError('failed-precondition',
        'La cuenta está en demostración: NovuChat la pasa a prueba o producción antes de cobrar.');
    }
    // EL COMERCIO RENUEVA SU PLAN; EL CAMBIO LO HACE NOVUCHAT (Andres,
    // 26/09/2026): pagar una mensualidad fija el plan, así que un plan
    // distinto del que tiene —más grande o más chico— se rechaza acá, antes
    // de reservar nada. Sin `rol` --la entrada por WhatsApp-- vale lo mismo
    // que un administrador. Se mira DENTRO de la transacción, contra la cuenta
    // leída acá, no contra lo que dijo la pantalla. El propietario sí puede.
    if (pedido.tipo === 'mensualidad' && quien.rol !== 'propietario'
        && !planQuePuedePedir(cuenta['plan'], pedido.plan)) {
      throw new HttpsError('permission-denied',
        'El cambio de plan lo hace NovuChat: desde acá se paga el plan que la cuenta ya tiene.');
    }
    // LA FIRMA PIDE SESIÓN RECIENTE (revisión de seguridad de #212, tercera
    // vuelta, LOW 3). Un QR de otro plan pedido por el propietario queda
    // firmado (`cambioAutorizadoPor`) y, al confirmarlo el banco, cambia el
    // plan y la mensualidad sin otro control: es lo mismo que cambiar el plan
    // en Negocios, que ya exige una sesión de menos de media hora
    // (`actualizarEstadoCuenta`). Sin esto, un token robado del propietario
    // firmaba cambios de plan por la puerta de Pagar. Se mira acá, contra la
    // cuenta leída en la transacción, y ANTES de reservar: no queda pago,
    // pendiente ni llamada al cobrador. La pantalla responde con
    // `reauthenticateWithPopup` y repite.
    const firma = pedido.tipo === 'mensualidad' && quien.rol === 'propietario' && pedido.plan !== cuenta['plan'];
    if (firma && quien.sesionReciente !== true) {
      throw new HttpsError('unauthenticated',
        'Por seguridad, vuelva a iniciar sesión para emitir el cobro de otro plan: ese pago cambia el plan de la cuenta.');
    }
    const pendienteId = typeof cuenta['pagoPendienteId'] === 'string' && ID_PAGO.test(cuenta['pagoPendienteId'])
      ? cuenta['pagoPendienteId'] : null;
    const montoUsd = montoUsdDe(pedido, cuenta);
    const monto = importeBs(montoUsd, tco);

    if (pendienteId) {
      const pDoc = await tx.get(db().doc(`tenants/${tenantId}/pagos/${pendienteId}`));
      const p = pDoc.data();
      if (p && p['estado'] === 'pendiente') {
        const cobro = cobroGuardadoDe(p);
        // Un QR que el banco ya confirmó no viaja en los detalles del error
        // (revisión de seguridad del #217): lo mismo que `consultarPagoPendiente`
        // e `imagenDePago`, para que ninguna puerta invite a pagarlo dos veces.
        const vivo = {
          pagoId: pendienteId, monto: p['monto'], descripcion: p['descripcion'],
          ...(cobro?.estado === 'CONFIRMADO' ? {} : { fichaQr: cobro?.fichaQr ?? '' }),
          venceEn: milis(p['venceEn']), cobroEstado: cobro?.estado ?? 'SIN_EMITIR',
        };
        if (cobro?.estado === 'QR_SUELTO') {
          throw new HttpsError('failed-precondition', 'El último cobro quedó suelto en el banco: NovuChat lo tiene que revisar antes de emitir otro.', vivo);
        }
        const emitido = cobro?.id && cobro.estado !== 'BORRADOR';
        // Emitido allá pero sin imagen acá (falló Storage): se retoma y se
        // vuelve a pedir SOLO la imagen, con el mismo pedido.
        const sinImagen = emitido && cobro.qrRuta === null;
        if (!emitido || sinImagen) {
          // Retomar solo si es el MISMO pedido: la referencia ya está reservada
          // allá con este importe, y otro importe sería un 409 del cobrador.
          const mismo = p['tipo'] === pedido.tipo && p['monto'] === monto
            && (pedido.tipo !== 'mensualidad' || (p['plan'] === pedido.plan && p['meses'] === pedido.meses))
            && (pedido.tipo !== 'bolsa' || p['cantidad'] === pedido.cantidad);
          if (!mismo) throw new HttpsError('failed-precondition', 'Hay un cobro reservado con otro pedido. Cancélelo antes de emitir otro.', vivo);
          return {
            pagoId: pendienteId, fichaQr: cobro?.fichaQr ?? '', reutilizado: true, cobroId: sinImagen ? cobro.id : null,
            montoUsd, monto,
          };
        }
        // QR vivo, o vencido según el reloj: en los dos casos hay que cerrarlo
        // antes (lo cierra el barrido, o `anularPagoPendiente` de A-1).
        throw new HttpsError('failed-precondition', 'Ya hay un cobro pendiente para esta cuenta.', vivo);
      }
      // `pagoPendienteId` apunta a un pago cerrado: se limpia con la reserva nueva.
    }

    const pagoId = randomBytes(16).toString('base64url');
    const fichaQr = randomBytes(16).toString('hex');
    const refPago = db().doc(`tenants/${tenantId}/pagos/${pagoId}`);
    // EL PROPIETARIO QUE PIDE OTRO PLAN LO DEJA FIRMADO (LOW 2 de #212): al
    // confirmar el banco, un plan distinto del vigente solo se aplica con esta
    // marca; sin ella, el pago queda en revisión.
    const autoriza = firma;
    tx.create(refPago, {
      tipo: pedido.tipo,
      ...(pedido.tipo === 'mensualidad' ? { plan: pedido.plan, meses: pedido.meses } : {}),
      ...(autoriza ? { cambioAutorizadoPor: quien.uid } : {}),
      ...(pedido.tipo === 'bolsa' ? { cantidad: pedido.cantidad } : {}),
      montoUsd, monto, moneda: MONEDA_COBRO, monedaLista: MONEDA_LISTA,
      tcoAplicado: tc.tco, tcoFuente: tc.fuente, tcoFecha: tc.fecha,
      montoRecibidoBs: null,
      estado: 'pendiente', medio: 'qr', canal: quien.canal,
      referencia: pagoId,
      descripcion,
      cobro: { id: null, estado: 'SIN_EMITIR', venceEn: null, creadoEn: null, fichaQr, qrRuta: null },
      creadoEn: ahora, creadoPor: quien.creadoPor, actualizadoEn: ahora,
    });
    tx.set(refCuenta, { pagoPendienteId: pagoId, actualizadoEn: ahora }, { merge: true });
    // `estado` es el último estado del cobrador visto: lo que el sondeo filtra
    // sin tener que preguntarle nada a nadie.
    tx.create(db().doc(`cobrosPendientes/${pagoId}`), {
      tenantId, pagoId, cobroId: null, estado: 'SIN_EMITIR', fichaQr, venceEn: null, creadoEn: ahora,
    });
    return { pagoId, fichaQr, reutilizado: false, cobroId: null as string | null, montoUsd, monto };
  });

  const { pagoId, fichaQr, reutilizado, montoUsd, monto } = reserva;
  const r = refs(tenantId, pagoId);

  // 2. Pedir el QR (o solo su imagen, si el cobro ya existe y lo que faltó fue guardarla).
  let respuesta: RespuestaCrear;
  try {
    if (reserva.cobroId) {
      const [estado, imagen] = await Promise.all([cobrador.estadoCobro(reserva.cobroId), cobrador.imagenQr(reserva.cobroId)]);
      respuesta = { creado: false, cobro: estado, imagenQrBase64: imagen.imagenQrBase64 };
    } else {
      respuesta = await cobrador.crearCobro({
        referenciaExterna: pagoId, concepto: conceptoDe(pedido), montoBs: monto, horasDeVigencia: vigenciaHoras,
      });
    }
  } catch (e) {
    if (e instanceof ErrorCobrador) {
      if (e.codigo === 'QR_SUELTO_EN_EL_PROVEEDOR') {
        await r.pago.set({ cobro: { estado: 'QR_SUELTO' }, actualizadoEn: Timestamp.now() }, { merge: true });
        await auditar(tenantId, 'cobro_suelto_en_el_proveedor', quien.uid, { pagoId, codigo: e.codigo });
        throw new HttpsError('aborted', 'El banco no confirmó la emisión del QR. NovuChat lo revisa; no se emitió ningún cobro.');
      }
      if (e.codigo === 'CUPO_POR_HORA_AGOTADO') throw new HttpsError('resource-exhausted', 'Demasiados cobros en la última hora. Vuelva a intentar más tarde.');
      if (e.codigo === 'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA') {
        await auditar(tenantId, 'cobro_referencia_en_conflicto', quien.uid, { pagoId, codigo: e.codigo });
        throw new HttpsError('internal', 'La referencia del cobro ya existe con otro importe.');
      }
      console.error(`cobrador ${e.status} ${e.codigo} al crear el cobro …${ultimos4(pagoId)}`);
      throw new HttpsError('unavailable', 'El cobrador rechazó la operación. Vuelva a intentar.');
    }
    if (e instanceof CobradorNoResponde) throw new HttpsError('unavailable', 'El cobrador no respondió. Vuelva a intentar en unos minutos.');
    throw e;
  }

  const cobro = respuesta.cobro;
  if (cobro.estado === 'BORRADOR') {
    await r.pago.set({ cobro: { id: cobro.id, estado: 'BORRADOR' }, actualizadoEn: Timestamp.now() }, { merge: true });
    await r.cobroPendiente.set({ cobroId: cobro.id, estado: 'BORRADOR' }, { merge: true });
    throw new HttpsError('unavailable', 'El banco no emitió el QR. Vuelva a intentar en unos minutos: se retoma el mismo cobro.');
  }
  if (cobro.estado !== 'QR_ACTIVO' && cobro.estado !== 'PAGO_DETECTADO' && cobro.estado !== 'EN_REVISION') {
    // Una reserva retomada cuyo cobro ya terminó allá (pagado, vencido o
    // anulado): se aplica lo que el cobrador dice y no se muestra ningún QR.
    const resultado = await aplicarEstadoDelCobrador(tenantId, pagoId, cobro, { via: 'creacion' }, deps);
    throw new HttpsError('failed-precondition', `El cobro anterior ya está ${resultado.estado}. Emita uno nuevo.`, { pagoId, estado: resultado.estado });
  }

  // 3. Guardar el PNG y anotar el cobro.
  const png = decodificarPng(respuesta.imagenQrBase64);
  const ruta = rutaQr(tenantId, pagoId);
  const venceEn = fechaIso(cobro.qr?.venceEn) ?? Timestamp.fromMillis(ahoraMs + vigenciaHoras * HORA);
  const creadoEnCobrador = fechaIso(cobro.creadoEn) ?? ahora;
  let qrRuta: string | null = null;
  if (png) {
    try { await almacen().guardar(ruta, png, 'image/png'); qrRuta = ruta; } catch (e) {
      console.error(`No se pudo guardar el QR de …${ultimos4(pagoId)}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }
  await db().runTransaction(async (tx) => {
    const pDoc = await tx.get(r.pago);
    if (pDoc.data()?.['estado'] !== 'pendiente') return;
    tx.update(r.pago, {
      cobro: { id: cobro.id, estado: cobro.estado, venceEn, creadoEn: creadoEnCobrador, fichaQr, qrRuta },
      venceEn, actualizadoEn: Timestamp.now(),
    });
    tx.set(r.cobroPendiente, { cobroId: cobro.id, estado: cobro.estado, venceEn }, { merge: true });
  });
  await auditar(tenantId, 'cobro_emitido', quien.uid, {
    pagoId, cobroId: cobro.id, monto, montoUsd, tcoAplicado: tc.tco, tcoFecha: tc.fecha, descripcion,
    canal: quien.canal, reutilizado, conQr: qrRuta !== null,
  });
  if (!qrRuta) {
    // El cobro existe y es pagable; sin imagen no se puede mostrar. Un reintento
    // vuelve a pedirla (200 del cobrador, mismo QR) y la guarda.
    throw new HttpsError('unavailable', 'El cobro se emitió pero la imagen del QR no se pudo guardar. Vuelva a intentar.');
  }
  return {
    pagoId, estado: 'pendiente', tipo: pedido.tipo, descripcion,
    montoUsd, monto, moneda: MONEDA_COBRO,
    tcoAplicado: tc.tco, tcoFuente: tc.fuente, tcoFecha: tc.fecha,
    venceEn: venceEn.toMillis(), fichaQr,
    cobro: { id: cobro.id, estado: cobro.estado }, reutilizado,
  };
}

export const crearCobroPrepago = onCall(
  { region: REGION, secrets: [COBRADOR_TOKEN] },
  async (peticion: CallableRequest) => {
    const datos = (peticion.data ?? {}) as Record<string, unknown>;
    const tenantId = texto(datos['tenantId'], 60);
    if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
    const quien = exigirAdminOPropietario(peticion, tenantId);
    const pedido = {
      tipo: datos['tipo'], plan: datos['plan'], meses: datos['meses'], cantidad: datos['cantidad'],
    };
    if (!esPedidoDePago(pedido)) {
      throw new HttpsError('invalid-argument', 'Pedido inválido: mensualidad (plan y 1 a 6 meses), bolsa (1 a 12) o instalación.');
    }
    const limpio: PedidoDePago = pedido.tipo === 'mensualidad'
      ? { tipo: 'mensualidad', plan: pedido.plan, meses: pedido.meses }
      : pedido.tipo === 'bolsa' ? { tipo: 'bolsa', cantidad: pedido.cantidad } : { tipo: 'instalacion' };
    // Si la sesión es reciente se decide acá, con el token; si hace falta
    // (otro plan, pedido por el propietario) se decide en la reserva, contra
    // la cuenta leída. Un administrador nunca firma: da igual.
    let sesionReciente = false;
    try { exigirSesionReciente(peticion, Date.now()); sesionReciente = true; } catch { /* solo cuenta si hay firma */ }
    return crearCobroInterno(tenantId, limpio, {
      uid: quien.uid, creadoPor: quien.uid, canal: 'consola', rol: quien.rol, sesionReciente,
    });
  },
);

// ---------------------------------------------------------------------------
// APLICAR LO QUE EL COBRADOR DICE — la tabla de estados, en una transacción
// ---------------------------------------------------------------------------

export type EstadoPago = 'pendiente' | 'confirmado' | 'vencido' | 'anulado';
export interface ResultadoAplicacion {
  aplicado: boolean;
  estado: EstadoPago | 'desconocido';
  /** `true` si el pago ya estaba cerrado al llegar. */
  ya?: boolean;
}

type Origen = { via: 'aviso' | 'sondeo' | 'barrido' | 'consulta' | 'creacion' | 'anulacion'; avisoId?: string };

/**
 * Aplica al pago de NovuChat el estado que el cobrador informó por la
 * consulta autenticada. Es la ÚNICA función que cambia el estado de un pago
 * por QR, y la llaman el aviso, el barrido, la consulta puntual y la creación.
 */
export async function aplicarEstadoDelCobrador(
  tenantId: string, pagoId: string, cobro: CobroDelCobrador, origen: Origen, deps: Deps = {},
): Promise<ResultadoAplicacion> {
  const ahoraMs = deps.ahoraMs ?? Date.now();
  const ahora = Timestamp.fromMillis(ahoraMs);
  const puerta = deps.puerta ?? puertaDePagos;
  const r = refs(tenantId, pagoId);

  const salida = await db().runTransaction(async (tx): Promise<ResultadoAplicacion & {
    bitacora?: { descripcion: string; corteEstabaAplicado: boolean; cubiertoHasta: string };
    auditoria?: { accion: string; detalle: object };
  }> => {
    const [pDoc, cuentaDoc, fichaDoc, indiceDoc] = await Promise.all([
      tx.get(r.pago), tx.get(r.cuenta), tx.get(r.ficha), tx.get(r.cobroPendiente),
    ]);
    const p = pDoc.data();
    if (!p) return { aplicado: false, estado: 'desconocido' };
    /** Anota en el índice el último estado visto (solo si el índice existe: nunca uno a medias). */
    const anotarIndice = (estado: string) => {
      if (indiceDoc.exists && (indiceDoc.get('estado') !== estado || indiceDoc.get('cobroId') !== cobro.id)) {
        tx.update(r.cobroPendiente, { estado, cobroId: cobro.id });
      }
    };
    const estadoActual = String(p['estado'] ?? '');
    if (estadoActual !== 'pendiente') {
      return { aplicado: false, estado: estadoActual as EstadoPago, ya: true };
    }
    const guardado = cobroGuardadoDe(p);
    const cierre = (estadoFinal: EstadoPago) => {
      const cuenta = cuentaDoc.data() ?? {};
      const escrituraCuenta: Record<string, unknown> = { actualizadoEn: ahora };
      if (cuenta['pagoPendienteId'] === pagoId) {
        escrituraCuenta['pagoPendienteId'] = FieldValue.delete();
        const sinPendiente = { ...cuenta }; delete sinPendiente['pagoPendienteId'];
        Object.assign(escrituraCuenta, puerta.camposDerivados(sinPendiente,
          typeof cuenta['corte'] === 'object' && cuenta['corte'] !== null ? cuenta['corte'] as Record<string, unknown> : null, ahoraMs));
      }
      tx.set(r.cuenta, escrituraCuenta, { merge: true });
      tx.delete(r.cobroPendiente);
      tx.set(r.cobroResuelto, { tenantId, pagoId, cobroId: cobro.id, estado: estadoFinal, cerradoEn: ahora });
    };

    switch (cobro.estado) {
      case 'CONFIRMADO': {
        const informado = montoDesdeTexto(cobro.pago?.monto);
        const montoRecibidoBs = informado !== null ? Math.round(informado) : Number(p['monto'] ?? 0);
        const esperado = Number(p['monto'] ?? 0);
        if (informado !== null && montoRecibidoBs < esperado) {
          // Entró MENOS de lo que dice el QR: no se acredita nada solo. Queda
          // pendiente, con lo recibido anotado, para el camino manual del
          // propietario (`registrarPagoManual`), que exige `motivoDiferencia`:
          // un descuento tiene nombre y firma. La auditoría sale una vez.
          const yaVisto = guardado?.estado === 'CONFIRMADO';
          tx.update(r.pago, { 'cobro.estado': 'CONFIRMADO', 'cobro.id': cobro.id, montoRecibidoBs, actualizadoEn: ahora });
          // Fuera del sondeo: ya no hay nada que esperar del cobrador, espera al propietario.
          anotarIndice('CONFIRMADO');
          return {
            aplicado: false, estado: 'pendiente',
            ...(yaVisto ? {} : { auditoria: { accion: 'pago_importe_menor', detalle: { pagoId, cobroId: cobro.id, via: origen.via, esperado, recibido: montoRecibidoBs } } }),
          };
        }
        // UN PLAN DISTINTO DEL VIGENTE, SIN AUTORIZACIÓN DEL PROPIETARIO, NO
        // SE APLICA SOLO (revisión de seguridad de #212, LOW 2). Pasa con un
        // QR emitido antes de un cambio de plan en Negocios, o antes del
        // 26/09, cuando el comercio podía elegir otro plan. Mismo patrón que
        // el importe menor: queda pendiente con el cobro CONFIRMADO, y el
        // propietario lo resuelve con `registrarPagoManual({ confirmarPendiente })`.
        const planPedido = p['tipo'] === 'mensualidad' ? p['plan'] : null;
        const planVigente = (cuentaDoc.data() ?? {})['plan'];
        if (planPedido !== null && planPedido !== planVigente && !cambioAutorizado(p)) {
          const yaVisto = guardado?.estado === 'CONFIRMADO';
          tx.update(r.pago, {
            'cobro.estado': 'CONFIRMADO', 'cobro.id': cobro.id, montoRecibidoBs, revision: 'plan_distinto', actualizadoEn: ahora,
          });
          anotarIndice('CONFIRMADO');
          return {
            aplicado: false, estado: 'pendiente',
            ...(yaVisto ? {} : { auditoria: { accion: 'pago_plan_distinto', detalle: {
              pagoId, cobroId: cobro.id, via: origen.via, planPedido, planVigente: planVigente ?? null, recibido: montoRecibidoBs,
            } } }),
          };
        }
        // UN PRECIO FUERA DE CONTRATO NO SE APLICA SOLO (F1b). El QR se emitió
        // a un importe que la cuenta ya no cobra: se le fijó o quitó un precio
        // por contrato después de emitirlo, o cambió la lista. El mismo patrón
        // que el plan distinto: queda pendiente con el cobro CONFIRMADO y
        // `revision: 'precio_distinto'`, y lo resuelve el propietario desde
        // Negocios (`confirmarPendiente`, con motivo). La plata entró; lo que
        // no se hace es darle a la cuenta un mes a un precio que no pactó.
        if (montoFueraDeContrato(p, cuentaDoc.data())) {
          const yaVisto = guardado?.estado === 'CONFIRMADO';
          tx.update(r.pago, {
            'cobro.estado': 'CONFIRMADO', 'cobro.id': cobro.id, montoRecibidoBs, revision: 'precio_distinto', actualizadoEn: ahora,
          });
          anotarIndice('CONFIRMADO');
          return {
            aplicado: false, estado: 'pendiente',
            ...(yaVisto ? {} : { auditoria: { accion: 'pago_precio_distinto', detalle: {
              pagoId, cobroId: cobro.id, via: origen.via, montoUsd: p['montoUsd'] ?? null,
              precioVigenteUsd: precioMensualDe(cuentaDoc.data() ?? {}, p['plan']), recibido: montoRecibidoBs,
            } } }),
          };
        }
        const confirmadoEn = fechaIso(cobro.pago?.confirmadoEn) ?? ahora;
        const descripcion = String(p['descripcion'] ?? '');
        const confirmacion: Confirmacion = {
          origen: 'banco', cobroId: cobro.id, riel: cobro.pago?.riel ?? null,
          confirmadoPorCobrador: cobro.pago?.confirmadoPor ?? 'automatico',
          ...(origen.avisoId ? { avisoId: origen.avisoId } : {}),
          montoRecibidoBs, confirmadoEn, ahoraMs,
          ademas: {
            pago: { cobro: { ...(guardado ?? { fichaQr: '', qrRuta: null, venceEn: null, creadoEn: null }), id: cobro.id, estado: 'CONFIRMADO' } },
            cuenta: {},
          },
        };
        const resultado = puerta.aplicarPagoEnTransaccion(tx, r, {
          id: pagoId, datos: p, cuenta: cuentaDoc.data() ?? {}, ficha: fichaDoc.data() ?? {},
        }, confirmacion);
        // La confirmación por WhatsApp se ENCOLA: la manda A-4 (0 mensajes acá).
        // Va en su propia escritura porque `aplicarPagoEnTransaccion` ya escribió
        // la cuenta; Firestore acepta más de una escritura al mismo documento
        // en una transacción y las aplica en orden.
        tx.set(r.cuenta, {
          confirmacionesPendientes: {
            [pagoId]: { plantilla: 'pago_confirmado', descripcion, cubiertoHasta: resultado.cubiertoHasta, encoladoEn: ahora },
          },
        }, { merge: true });
        tx.delete(r.cobroPendiente);
        tx.set(r.cobroResuelto, { tenantId, pagoId, cobroId: cobro.id, estado: 'confirmado', cerradoEn: ahora });
        return {
          aplicado: true, estado: 'confirmado',
          bitacora: { descripcion, corteEstabaAplicado: resultado.corteEstabaAplicado, cubiertoHasta: resultado.cubiertoHasta },
          auditoria: { accion: 'pago_aplicado', detalle: {
            pagoId, cobroId: cobro.id, via: origen.via, riel: cobro.pago?.riel ?? null,
            confirmadoPorCobrador: cobro.pago?.confirmadoPor ?? null, montoRecibidoBs,
            cubiertoHasta: resultado.cubiertoHasta, plan: resultado.plan, bolsa: resultado.bolsa,
            // Si el pago cambió el plan: la copia antes y después y lo
            // conservado por contrato, como `cambiar_plan` (LOW 1 de #212).
            ...auditoriaDeLimites(resultado.cambioDeLimites),
          } },
        };
      }
      case 'VENCIDO': {
        tx.update(r.pago, { estado: 'vencido', 'cobro.estado': 'VENCIDO', 'cobro.id': cobro.id, vencidoEn: ahora, actualizadoEn: ahora });
        cierre('vencido');
        return { aplicado: true, estado: 'vencido', auditoria: { accion: 'pago_vencido', detalle: { pagoId, cobroId: cobro.id, via: origen.via } } };
      }
      case 'ANULADO':
      case 'RECHAZADO': {
        tx.update(r.pago, {
          estado: 'anulado', 'cobro.estado': cobro.estado, 'cobro.id': cobro.id,
          anuladoEn: ahora, anuladoPor: 'cobrador', motivoAnulacion: `cobrador:${cobro.estado}`, actualizadoEn: ahora,
        });
        cierre('anulado');
        return { aplicado: true, estado: 'anulado', auditoria: { accion: 'pago_anulado', detalle: { pagoId, cobroId: cobro.id, via: origen.via, motivo: cobro.estado } } };
      }
      default: {
        // BORRADOR, QR_ACTIVO, PAGO_DETECTADO, EN_REVISION: sigue pendiente. Se
        // anota el último estado visto para que la consola pueda decir «el
        // banco detectó un pago y lo está conciliando», y nada más.
        if (guardado?.estado !== cobro.estado || guardado?.id !== cobro.id) {
          tx.update(r.pago, { 'cobro.estado': cobro.estado, 'cobro.id': cobro.id, actualizadoEn: ahora });
        }
        anotarIndice(cobro.estado);
        const revisionNueva = cobro.estado === 'EN_REVISION' && guardado?.estado !== 'EN_REVISION';
        return {
          aplicado: false, estado: 'pendiente',
          ...(revisionNueva ? { auditoria: { accion: 'cobro_en_revision', detalle: { pagoId, cobroId: cobro.id, via: origen.via } } } : {}),
        };
      }
    }
  });

  if (salida.bitacora) {
    await registrar(tenantId, {
      tipo: 'pago_registrado', resultado: 'ok', canal: 'sistema', codigo: 'banco',
      detalle: `${salida.bitacora.descripcion} · hasta ${salida.bitacora.cubiertoHasta}`.slice(0, 120),
    });
    // Cuando A-0 traiga `reanudacion_servicio` a `TipoEvento`, acá va ese
    // renglón si `salida.bitacora.corteEstabaAplicado`.
  }
  if (salida.auditoria) await auditar(tenantId, salida.auditoria.accion, `cobrador:${origen.via}`, salida.auditoria.detalle);
  return { aplicado: salida.aplicado, estado: salida.estado, ...(salida.ya ? { ya: true } : {}) };
}

/** Consulta al cobrador por la referencia y aplica. Para la pantalla al abrirse (A-1 la expone como callable). */
export async function consultarYAplicar(tenantId: string, pagoId: string, origen: Origen, deps: Deps = {}): Promise<ResultadoAplicacion> {
  if (!ID_PAGO.test(pagoId)) return { aplicado: false, estado: 'desconocido' };
  const cobrador = await resolverCobrador(deps.cobrador);
  let cobro: CobroDelCobrador;
  try { cobro = await cobrador.estadoPorReferencia(pagoId); } catch (e) {
    if (e instanceof ErrorCobrador && e.status === 404) return { aplicado: false, estado: 'desconocido' };
    throw e;
  }
  return aplicarEstadoDelCobrador(tenantId, pagoId, cobro, origen, deps);
}

// ---------------------------------------------------------------------------
// ANULAR EL QR VIVO — lo que `registrarPagoManual` (A-1) llama antes de cargar
// ---------------------------------------------------------------------------

export type ResultadoAnulacion =
  | { resultado: 'anulado' }
  | { resultado: 'sin_cobro' }
  /** Había plata: se aplicó el cobro del banco. El manual NO se carga. */
  | { resultado: 'pagado'; estado: ResultadoAplicacion['estado'] }
  /** Pago sobre QR vencido: lo decide una persona en el cobrador. El manual NO se carga. */
  | { resultado: 'en_revision' };

/**
 * Anula el cobro del pago pendiente, en el cobrador y acá. Es la inyección
 * `anular` que A-1 enchufa en `registrarPagoManual` (§4undecies.7). Si el
 * cobrador responde `PAGADO_NO_SE_ANULA`, se consulta y se aplica el pago del
 * banco: nunca dos pagos vivos por el mismo mes. Si no responde, lanza: no se
 * carga nada.
 */
export async function anularCobroVivo(tenantId: string, pagoId: string, motivo: string, deps: Deps = {}): Promise<ResultadoAnulacion> {
  if (!ID_PAGO.test(pagoId)) return { resultado: 'sin_cobro' };
  const r = refs(tenantId, pagoId);
  const pDoc = await r.pago.get();
  const p = pDoc.data();
  if (!p || p['estado'] !== 'pendiente') return { resultado: 'sin_cobro' };
  const guardado = cobroGuardadoDe(p);
  const cobrador = await resolverCobrador(deps.cobrador);
  const ahoraMs = deps.ahoraMs ?? Date.now();

  // Sin id guardado no se supone «sin emitir»: se pregunta por la referencia.
  // Si el cobro existe allá (se emitió y la respuesta se perdió), hay un QR
  // vivo que anular; 404 es la única prueba de que no lo hay.
  let cobroId = guardado?.id ?? null;
  if (!cobroId) {
    try { cobroId = (await cobrador.estadoPorReferencia(pagoId)).id; } catch (e) {
      if (!(e instanceof ErrorCobrador && e.status === 404)) throw e;
    }
  }

  if (cobroId) {
    try {
      await cobrador.anularCobro(cobroId, motivo.slice(0, 200));
    } catch (e) {
      if (e instanceof ErrorCobrador && e.codigo === 'PAGADO_NO_SE_ANULA') {
        const aplicado = await consultarYAplicar(tenantId, pagoId, { via: 'anulacion' }, deps);
        return { resultado: 'pagado', estado: aplicado.estado };
      }
      if (e instanceof ErrorCobrador && e.codigo === 'PAGO_TARDIO_EN_REVISION') {
        await auditar(tenantId, 'cobro_en_revision', 'cobrador:anulacion', { pagoId, cobroId, motivo: 'pago_tardio' });
        return { resultado: 'en_revision' };
      }
      if (e instanceof ErrorCobrador && e.status === 404) {
        // El cobrador no lo conoce: no hay QR vivo que anular allá.
      } else {
        throw e;
      }
    }
  }
  const ahora = Timestamp.fromMillis(ahoraMs);
  await db().runTransaction(async (tx) => {
    const [pd, cd] = await Promise.all([tx.get(r.pago), tx.get(r.cuenta)]);
    if (pd.data()?.['estado'] !== 'pendiente') return;
    tx.update(r.pago, {
      estado: 'anulado', 'cobro.estado': 'ANULADO', anuladoEn: ahora, anuladoPor: 'novuchat',
      motivoAnulacion: motivo.slice(0, 300), actualizadoEn: ahora,
    });
    const cuenta = cd.data() ?? {};
    const escritura: Record<string, unknown> = { actualizadoEn: ahora };
    if (cuenta['pagoPendienteId'] === pagoId) {
      escritura['pagoPendienteId'] = FieldValue.delete();
      const sin = { ...cuenta }; delete sin['pagoPendienteId'];
      Object.assign(escritura, (deps.puerta ?? puertaDePagos).camposDerivados(sin, null, ahoraMs));
    }
    tx.set(r.cuenta, escritura, { merge: true });
    tx.delete(r.cobroPendiente);
    tx.set(r.cobroResuelto, { tenantId, pagoId, cobroId, estado: 'anulado', cerradoEn: ahora });
  });
  await auditar(tenantId, 'pago_anulado', 'novuchat', { pagoId, cobroId, motivo: motivo.slice(0, 300) });
  return { resultado: 'anulado' };
}

// ---------------------------------------------------------------------------
// EL AVISO — verificar la firma, y después preguntarle al cobrador
// ---------------------------------------------------------------------------

export interface RespuestaAviso { recibido: true; aplicado: boolean; estado: ResultadoAplicacion['estado'] }

/**
 * Qué se hace con un aviso ya verificado. `referenciaExterna` es nuestro
 * `pagoId`: se resuelve el comercio por `/cobrosPendientes` (o por
 * `/cobrosResueltos` si el pago ya se cerró: un aviso repetido responde
 * `aplicado: false` con el estado real y no suma nada). Y ANTES de aplicar se
 * consulta `estadoCobro` con el token de salida: el aviso solo dispara la
 * consulta. Si el cobrador no responde se lanza, para que el llamador
 * conteste 503 y el cobrador reintente.
 */
export async function procesarAviso(aviso: AvisoDeConfirmacion, deps: Deps = {}): Promise<RespuestaAviso> {
  const pagoId = aviso.referenciaExterna;
  if (!ID_PAGO.test(pagoId)) return { recibido: true, aplicado: false, estado: 'desconocido' };
  const pendiente = await db().doc(`cobrosPendientes/${pagoId}`).get();
  if (!pendiente.exists) {
    const resuelto = await db().doc(`cobrosResueltos/${pagoId}`).get();
    if (resuelto.exists) {
      return { recibido: true, aplicado: false, estado: String(resuelto.get('estado') ?? 'desconocido') as ResultadoAplicacion['estado'] };
    }
    console.warn(`aviso del cobrador para una referencia desconocida: cobro …${ultimos4(aviso.cobroId)}`);
    return { recibido: true, aplicado: false, estado: 'desconocido' };
  }
  const tenantId = String(pendiente.get('tenantId') ?? '');
  if (!ID_TENANT.test(tenantId)) return { recibido: true, aplicado: false, estado: 'desconocido' };
  const resultado = await consultarYAplicar(tenantId, pagoId, { via: 'aviso', avisoId: aviso.idEvento }, deps);
  return { recibido: true, aplicado: resultado.aplicado, estado: resultado.estado };
}

export const avisoCobrador = onRequest(
  { region: REGION, cors: false, secrets: [COBRADOR_TOKEN, COBRADOR_AVISO_SECRETO], maxInstances: 5 },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send(''); return; }
    const secreto = COBRADOR_AVISO_SECRETO.value();
    if (!secreto || secreto.length < 32) {
      // Misma exigencia que `resolverCobrador` con el token: un secreto corto
      // es un error de configuración, y se contesta como si no hubiera firma.
      console.error('COBRADOR_AVISO_SECRETO ausente o demasiado corto: el aviso se rechaza');
      respuesta.status(401).send(''); return;
    }
    const v = verificarAviso(peticion, secreto);
    if (v.estado === 'no_firmado') { respuesta.status(401).send(''); return; }
    if (v.estado === 'mal_formado') { respuesta.status(400).json({ recibido: false }); return; }
    try {
      const r = await procesarAviso(v.aviso);
      respuesta.status(200).json(r);
    } catch (e) {
      if (e instanceof CobradorNoResponde || (e instanceof ErrorCobrador && e.status >= 500)) {
        respuesta.status(503).json({ recibido: false, reintentar: true }); return;
      }
      console.error(`aviso del cobrador: ${e instanceof Error ? e.message : 'error'}`);
      respuesta.status(500).json({ recibido: false });
    }
  },
);

// ---------------------------------------------------------------------------
// EL BARRIDO HORARIO — sin aviso se llega al mismo lugar, más lento
// ---------------------------------------------------------------------------

export interface ResumenBarrido {
  revisados: number; confirmados: number; vencidos: number; anulados: number; sinCambio: number; errores: number;
}

/**
 * Recorre `/cobrosPendientes` (≤ 500), consulta cada uno y aplica la tabla.
 * Un `QR_ACTIVO` cuyo vencimiento pasó hace más de 24 h se ANULA en el
 * cobrador antes de cerrarse: el banco vence por día, y un QR olvidado sigue
 * pagable hasta la medianoche. Si al anular hay plata (`PAGADO_NO_SE_ANULA`),
 * se vuelve a consultar y se aplica el pago. Un pendiente que nunca emitió su
 * QR se cierra a los cuatro días. Un error en uno no frena a los demás.
 */
export async function barrerCobrosPendientes(ahoraMs: number = Date.now(), deps: Deps = {}): Promise<ResumenBarrido> {
  const resumen: ResumenBarrido = { revisados: 0, confirmados: 0, vencidos: 0, anulados: 0, sinCambio: 0, errores: 0 };
  const lista = await db().collection('cobrosPendientes').orderBy('creadoEn', 'asc').limit(TOPE_BARRIDO).get();
  // Sin pendientes no se resuelve el cobrador, igual que en el sondeo: mientras
  // no esté configurado (así quedó v0.7.0, sin URL pública), resolverlo lanza y
  // el trabajo horario fallaba en cada corrida con un error en producción que
  // no le pasaba nada a nadie. Verificado el 23/09 sobre el despliegue real.
  if (lista.empty) return resumen;
  const cobrador = await resolverCobrador(deps.cobrador);
  const depsConCobrador: Deps = { ...deps, cobrador, ahoraMs };

  for (const doc of lista.docs) {
    resumen.revisados += 1;
    const tenantId = String(doc.get('tenantId') ?? ''); const pagoId = doc.id;
    if (!ID_TENANT.test(tenantId) || !ID_PAGO.test(pagoId)) { resumen.errores += 1; continue; }
    try {
      // Se consulta SIEMPRE por la referencia, tenga o no `cobroId` el índice:
      // un cobro emitido allá cuya respuesta se perdió acá tiene que
      // acreditarse igual. Solo un 404 dice «sin emitir».
      let cobro: CobroDelCobrador;
      try {
        cobro = await cobrador.estadoPorReferencia(pagoId);
      } catch (e) {
        if (!(e instanceof ErrorCobrador && e.status === 404)) throw e;
        const creadoEn = milis(doc.get('creadoEn')) ?? ahoraMs;
        if (ahoraMs - creadoEn > RESERVA_SIN_EMITIR_MS) {
          await anularCobroVivo(tenantId, pagoId, 'reserva sin emitir', depsConCobrador);
          resumen.anulados += 1;
        } else {
          resumen.sinCambio += 1;
        }
        continue;
      }
      if (doc.get('cobroId') !== cobro.id) {
        await doc.ref.set({ cobroId: cobro.id, estado: cobro.estado, ...(cobro.qr ? { venceEn: fechaIso(cobro.qr.venceEn) } : {}) }, { merge: true });
      }
      if (cobro.estado === 'QR_ACTIVO' || cobro.estado === 'BORRADOR') {
        const venceEn = cobro.qr ? Date.parse(cobro.qr.venceEn) : (milis(doc.get('venceEn')) ?? Number.NaN);
        if (Number.isFinite(venceEn) && ahoraMs - venceEn > DIA) {
          try {
            await cobrador.anularCobro(cobro.id, 'vencido sin pago');
            cobro = { ...cobro, estado: 'VENCIDO' };
          } catch (e) {
            if (e instanceof ErrorCobrador && e.codigo === 'PAGADO_NO_SE_ANULA') {
              cobro = await cobrador.estadoPorReferencia(pagoId);
            } else if (e instanceof ErrorCobrador && e.codigo === 'PAGO_TARDIO_EN_REVISION') {
              cobro = { ...cobro, estado: 'EN_REVISION' };
            } else {
              throw e;
            }
          }
        }
      }
      const resultado = await aplicarEstadoDelCobrador(tenantId, pagoId, cobro, { via: 'barrido' }, depsConCobrador);
      if (resultado.estado === 'confirmado' && resultado.aplicado) resumen.confirmados += 1;
      else if (resultado.estado === 'vencido' && resultado.aplicado) resumen.vencidos += 1;
      else if (resultado.estado === 'anulado' && resultado.aplicado) resumen.anulados += 1;
      else resumen.sinCambio += 1;
    } catch (e) {
      resumen.errores += 1;
      console.error(`barrido: pago …${ultimos4(pagoId)} de …${ultimos4(tenantId)}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }
  return resumen;
}

// ---------------------------------------------------------------------------
// EL SONDEO — cada 5 minutos, solo lo que puede pagarse ahora
// ---------------------------------------------------------------------------

export interface ResumenSondeo { consultados: number; confirmados: number; cerrados: number; sinCambio: number; errores: number }

/**
 * Mientras el cobrador no mande aviso, esto es lo que hace que un pago se
 * vea en minutos y no en una hora. NO es otra tabla: consulta
 * `estadoPorReferencia` y llama a `aplicarEstadoDelCobrador`, la misma que
 * usan el aviso y el barrido; solo `CONFIRMADO` acredita.
 *
 * Qué recorre: los pendientes cuyo último estado visto es `QR_ACTIVO` o
 * `PAGO_DETECTADO` y cuyo `venceEn` no pasó, hasta `TOPE_SONDEO`, los que
 * vencen antes primero. Lo demás —anular lo vencido, cerrar reservas sin
 * emitir, reintentar `EN_REVISION` y `BORRADOR`, completar índices— es del
 * barrido horario. Sin pendientes vivos, **no resuelve el cliente ni llama al
 * cobrador**: una corrida vacía cuesta una consulta a Firestore.
 */
export async function sondearCobrosPendientes(ahoraMs: number = Date.now(), deps: Deps = {}): Promise<ResumenSondeo> {
  const resumen: ResumenSondeo = { consultados: 0, confirmados: 0, cerrados: 0, sinCambio: 0, errores: 0 };
  // Un solo filtro de igualdad múltiple (`in`), sin orden: no exige índice
  // compuesto. El vencimiento se filtra y se ordena en memoria, y la lista
  // es la de los QR vivos de NovuChat: decenas, no miles.
  const lista = await db().collection('cobrosPendientes')
    .where('estado', 'in', [...ESTADOS_SONDEABLES]).limit(TOPE_BARRIDO).get();
  const vivos = lista.docs
    .filter((d) => { const v = milis(d.get('venceEn')); return v !== null && v > ahoraMs; })
    .sort((a, b) => (milis(a.get('venceEn')) ?? 0) - (milis(b.get('venceEn')) ?? 0))
    .slice(0, TOPE_SONDEO);
  if (vivos.length === 0) return resumen;

  const cobrador = await resolverCobrador(deps.cobrador);
  const depsConCobrador: Deps = { ...deps, cobrador, ahoraMs };
  for (const doc of vivos) {
    const tenantId = String(doc.get('tenantId') ?? ''); const pagoId = doc.id;
    if (!ID_TENANT.test(tenantId) || !ID_PAGO.test(pagoId)) { resumen.errores += 1; continue; }
    resumen.consultados += 1;
    try {
      const cobro = await cobrador.estadoPorReferencia(pagoId);
      const resultado = await aplicarEstadoDelCobrador(tenantId, pagoId, cobro, { via: 'sondeo' }, depsConCobrador);
      if (resultado.aplicado && resultado.estado === 'confirmado') resumen.confirmados += 1;
      else if (resultado.aplicado) resumen.cerrados += 1;
      else resumen.sinCambio += 1;
    } catch (e) {
      // Un 404 o un cobrador caído no frenan a los demás; el barrido lo revisa.
      resumen.errores += 1;
      console.error(`sondeo: pago …${ultimos4(pagoId)} de …${ultimos4(tenantId)}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }
  return resumen;
}

/**
 * Cada 5 minutos. Exige Cloud Scheduler habilitado (paso de nube tras la
 * compuerta del demo). COSTO: Cloud Scheduler cobra por trabajo y por mes
 * —los 3 primeros de la cuenta de facturación son gratis y cada uno más
 * cuesta USD 0,10 al mes—, no por ejecución: este y el barrido son 2
 * trabajos. Las 8.640 ejecuciones al mes entran holgadas en la franquicia de
 * invocaciones de Cloud Functions, y cada corrida vacía es 1 lectura de
 * Firestore. `maxInstances: 1` evita dos corridas superpuestas.
 */
export const sondeoCobros = onSchedule(
  { schedule: 'every 5 minutes', region: REGION, secrets: [COBRADOR_TOKEN], timeoutSeconds: 240, maxInstances: 1 },
  async () => {
    const r = await sondearCobrosPendientes(Date.now());
    if (r.consultados > 0) console.info(`sondeo de cobros: ${JSON.stringify(r)}`);
  },
);

/** Exige Cloud Scheduler habilitado: paso de nube tras la compuerta del demo. */
export const barridoCobros = onSchedule(
  { schedule: 'every 60 minutes', region: REGION, secrets: [COBRADOR_TOKEN], timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const r = await barrerCobrosPendientes(Date.now());
    console.info(`barrido de cobros: ${JSON.stringify(r)}`);
  },
);

// ---------------------------------------------------------------------------
// LA IMAGEN — la descarga Meta, con una ficha al azar de 128 bits
// ---------------------------------------------------------------------------

/**
 * Pública a propósito: los servidores de Meta no traen credencial nuestra.
 * La protege la ficha al azar (nadie recorre la cartera probando nombres) y
 * que del otro lado hay un QR que solo sirve para pagarle a NovuChat. 404 si
 * el pago ya no está `pendiente`: un QR de un cobro cerrado no se muestra.
 * Se sirve desde Storage, no al vuelo desde el cobrador: cada descarga de Meta
 * sería una llamada autenticada más.
 */
export const imagenDePago = onRequest(
  { region: REGION, cors: false, maxInstances: 10 },
  async (peticion, respuesta) => {
    const ficha = String(peticion.query['f'] ?? '').trim();
    if (!FICHA.test(ficha)) { respuesta.status(404).send('no encontrado'); return; }
    const encontrados = await db().collection('cobrosPendientes').where('fichaQr', '==', ficha).limit(1).get();
    const indice = encontrados.docs[0];
    const tenantId = String(indice?.get('tenantId') ?? ''); const pagoId = indice?.id ?? '';
    if (!indice || !ID_TENANT.test(tenantId) || !ID_PAGO.test(pagoId)) { respuesta.status(404).send('no encontrado'); return; }
    const pago = (await db().doc(`tenants/${tenantId}/pagos/${pagoId}`).get()) as DocumentSnapshot;
    const guardado = cobroGuardadoDe(pago.data());
    // 404 TAMBIÉN SI EL BANCO YA CONFIRMÓ ESE QR (tercera vuelta de #212,
    // LOW 1). Un pago en revisión (importe menor, o `plan_distinto`) sigue
    // `pendiente` hasta que el propietario lo confirma, y el índice sigue
    // existiendo; servir la imagen invitaría a pagar dos veces el mismo QR.
    if (pago.get('estado') !== 'pendiente' || guardado?.fichaQr !== ficha || !guardado.qrRuta
      || guardado.estado === 'CONFIRMADO') {
      respuesta.status(404).send('no encontrado'); return;
    }
    const png = await almacen().leer(guardado.qrRuta);
    if (!png) { respuesta.status(404).send('no encontrado'); return; }
    respuesta.set('Content-Type', 'image/png');
    respuesta.set('Cache-Control', 'public, max-age=300');
    respuesta.set('X-Content-Type-Options', 'nosniff');
    respuesta.status(200).send(png);
  },
);
