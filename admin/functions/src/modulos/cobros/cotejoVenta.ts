import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { SECRETOS_POR_ALIAS, enmascarar, rutaAutenticada } from '../../core/seguridad/firma.js';
import { registrar } from '../../core/turno/bitacora.js';
import { periodoDe } from '../../central/cuenta/planes.js';
import {
  escribirCorrelativo, formarCodigo, leerCorrelativo, prefijoDeCodigo, type Correlativo,
} from '../../core/turno/correlativo.js';
import { ultimoPedidoAlCerrar } from '../../core/turno/facturaPedido.js';
import {
  calificarComprobante, motivosParaElCliente, parsearMonto, type Calificacion, type Leido,
} from './cotejo.js';
import {
  MAX_INTENTOS_INVALIDOS, detalleDeLaVentaCalificada, esperadoDeLaVenta, esReglaDos, idDeCierreDeVenta,
  solicitudDeCobroTras, totalUtilizable, type ComprobanteAnotado, type EfectoDeCobro, type TransicionDeCobro,
} from './cobroVenta.js';
import { nombreDeObjeto, rutaValidaDe } from './comprobantes.js';

/**
 * =============================================================================
 * EL COTEJO DEL COMPROBANTE DE UNA VENTA CON REGLA 2 — `cotejarComprobanteVenta`
 * =============================================================================
 *
 * ENDPOINT NUEVO, y no un cambio de `cotejarComprobante` (D2): esa Function, en
 * `modulos/agenda/sena.ts`, atiende seña y venta a la vez, y tocarla toca el
 * camino de Platinum y del Demo A. Acá solo entra el flujo que mandó
 * `reglaCobro: 2`; la seña no cambia ni una línea.
 *
 * QUIÉN DECIDE QUÉ, igual que en la seña: el flujo lee la imagen con el modelo y
 * manda lo leído; el SERVIDOR califica (`calificarComprobante`) y decide el
 * estado del cobro (`solicitudDeCobroTras`). El flujo traduce el estado y el
 * motivo —códigos fijos— a una frase fija. NADA de lo leído de la imagen vuelve
 * al cliente, salvo el monto leído cuando es distinto del pedido, que es la
 * diferencia que se le avisa.
 *
 * LO QUE CAMBIA RESPECTO DE LA SEÑA, y es lo que pidió Andres (03/10/2026):
 *  - un comprobante INVÁLIDO ya no crea cierre ni suma `cierres`: un cierre es
 *    el registro de lo que terminó bien. Suma `cobrosInvalidos`;
 *  - el tercer inválido pasa el cobro a una persona (`en_revision`);
 *  - un comprobante tardío (hasta 24 h después del límite) no cierra la venta:
 *    se deriva al comercio;
 *  - nunca responde `sin_sena_pendiente`: cada situación tiene su código.
 *
 * TODO EN UNA TRANSACCIÓN: el cierre, su detalle privado, los contadores del
 * mes y la solicitud. Si se escribiera el cierre y fallara la solicitud, el
 * siguiente archivo del cliente se volvería a cotejar como pago.
 */

const TELEFONO = /^[0-9]{8,15}$/;
/** Minutos de gracia por desfase de relojes entre el banco y nosotros. */
const MINUTOS_TOLERANCIA_RELOJ = 10;

function texto(valor: unknown, maxLargo: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maxLargo) : '';
}

/** Lo que leyó el modelo, saneado: dato no confiable, recortado y tipado. */
export function leidoDeLaVenta(crudo: unknown): Leido {
  const l = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Record<string, unknown>;
  const monto = typeof l['monto'] === 'number' && Number.isFinite(l['monto']) ? l['monto'] : texto(l['monto'], 40);
  return {
    monto,
    cuentaDestino: texto(l['cuentaDestino'], 60),
    nombreCuenta: texto(l['nombreCuenta'], 120),
    fecha: texto(l['fecha'], 40),
    hora: texto(l['hora'], 20),
  };
}

export type EstadoDeRespuesta = 'valido' | 'aproximado' | 'reintentar' | 'en_revision' | 'tardio' | 'ya_resuelto';
export type Rechazo = 'sin_cobro_pendiente' | 'cobro_cancelado' | 'sin_total' | 'regla_1';

export interface RespuestaDelCotejo {
  estado: EstadoDeRespuesta;
  motivo: string;
  /**
   * TODOS los motivos que aplican, con el destinatario primero (`motivosParaElCliente`). ADITIVO: `motivo` sigue siendo el primario de siempre, así que un flujo que no lo lea
   * no cambia. Solo viene en la respuesta de un cotejo nuevo (no en la de un comprobante repetido, que repite lo que se contestó entonces).
   */
  motivos?: string[];
  intentos: number;
  intentosRestantes: number;
  importe: number | null;
  moneda: string;
  montoLeido: number | null;
  montoDistinto: boolean;
  /**
   * `<PREFIJO>-AAMMDD-NNN`. ADITIVO: solo viene cuando la venta cierra (válido, aproximado o su repetición) Y el comercio
   * tiene `config/pedidos.prefijoCodigo`; sin prefijo la respuesta es la de siempre. Idempotente por pedido: el mismo
   * pedido devuelve el mismo código y no consume otro correlativo.
   */
  codigoPedido?: string;
  /**
   * OBSERVADO POR MONTO (PR-S, decisión 8). ADITIVO: solo viene si el comercio tiene `config/pedidos.montoExacto === true` y
   * el comprobante dio `aproximado`. Entonces la venta NO se cierra (`estado: 'reintentar'`, `motivo: 'monto_distinto'`, con el
   * tope de intentos de siempre), sin cierre, correlativo ni código. `montoLeido` ya viaja; acá `montoEsperado` (el total del
   * pedido) y `diferencia` (leído − esperado, con signo) para nombrarla. Un comprobante nuevo del mismo pedido se cotejará otra vez.
   */
  montoEsperado?: number;
  diferencia?: number;
  cierreId: string | null;
  evento: { id: string; calendario: string } | null;
  avisarComercio: boolean;
  /** Es el mismo comprobante otra vez (reintento de n8n): se repite lo que se contestó, sin contar. */
  repetido: boolean;
}

/** De lo que decidió la máquina de estados, el estado que se le contesta al flujo. */
export function estadoDeRespuesta(t: TransicionDeCobro, etapaPrevia: string, calificacion: Calificacion | null): EstadoDeRespuesta | Rechazo {
  const porEfecto: Partial<Record<EfectoDeCobro, EstadoDeRespuesta | Rechazo>> = {
    cerrado: calificacion?.estado === 'aproximado' ? 'aproximado' : 'valido',
    reintentar: 'reintentar', en_revision: 'en_revision', tardio: 'tardio',
    ya_resuelto: 'ya_resuelto', sin_cobro: 'sin_cobro_pendiente',
    cobro_cancelado: 'cobro_cancelado', regla_1: 'regla_1',
  };
  return porEfecto[t.efecto] ?? 'sin_cobro_pendiente';
}

export const cotejarComprobanteVenta = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Servidor a servidor, como la ingesta: sin CORS.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // El comercio sale de la firma o del token del número, NUNCA del cuerpo.
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const cuerpo = (typeof peticion.body === 'object' && peticion.body !== null
      ? peticion.body : {}) as Record<string, unknown>;
    const telefono = texto(cuerpo['telefono'], 25);
    if (!TELEFONO.test(telefono)) { respuesta.status(400).json({ error: 'telefono invalido' }); return; }
    const idMeta = texto(cuerpo['idMeta'], 120);
    if (idMeta === '') { respuesta.status(400).json({ error: 'falta_idmeta' }); return; }
    const legible = cuerpo['legible'] === true;
    const leido = leidoDeLaVenta(cuerpo['leido']);
    // El monto que se leyó, en toda respuesta con un comprobante legible (tardío
    // e inválido incluidos): el flujo decide qué decirle al cliente.
    const montoDeLoLeido = legible ? parsearMonto(leido.monto as string) : null;
    const rutaImagen = rutaValidaDe(cuerpo['ruta'], ruta.tenantId, idMeta);

    const db = getFirestore();
    const { tenantId } = ruta;
    const idConversacion = `wa_${telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodoDe()}`);
    const ahoraMs = Date.now();
    // El registro de TODO comprobante recibido (fase 2): su id es el nombre del objeto de Storage.
    const refRecibido = db.doc(`tenants/${tenantId}/comprobantesRecibidos/${nombreDeObjeto(idMeta)}`);

    const [venta, negocio, configPedidos] = await Promise.all([
      db.doc(`tenants/${tenantId}/config/venta`).get(),
      db.doc(`tenants/${tenantId}/config/negocio`).get(),
      db.doc(`tenants/${tenantId}/config/pedidos`).get(),
    ]);
    // COSTO (PR-S): 1 lectura de `config/pedidos` por cotejo de TODOS los comercios (fuera de la transacción, junto a las
    // otras dos; no se difiere a «solo si va a cerrar» porque eso se sabe dentro de la transacción y una lectura
    // nueva ahí chocaría con el orden lecturas-antes-de-escrituras). Con prefijo, además, 1 lectura + 1 escritura del
    // contador del día, solo en el cotejo que cierra. Sin prefijo: ninguna escritura nueva, ningún contador.
    // Sin prefijo no hay código ni contador: los demás comercios no notan nada.
    const prefijo = prefijoDeCodigo(configPedidos.data());
    // `montoExacto`: booleano estricto. Ausente o cualquier otro valor (incluida la cadena 'true') = el comportamiento de siempre.
    const montoExacto = configPedidos.data()?.['montoExacto'] === true;
    const moneda = String(negocio.get('moneda') ?? 'BOB');
    const cobroReal = venta.get('cobroReal') as Record<string, unknown> | undefined;
    // EL COTEJO ES DEL COBRO REAL. En modo simulado no hay intentos ni
    // validación (P2): el flujo no debería llamar, y si llama se le dice que no.
    // Mismo criterio que `configuracionFlujo`: encendido y con ficha y código.
    const cobroRealActivo = cobroReal?.['activo'] === true
      && String(cobroReal?.['ficha'] ?? '') !== '' && String(cobroReal?.['cargaUtil'] ?? '') !== '';
    if (!cobroRealActivo) { respuesta.status(409).json({ error: 'cobro_simulado' }); return; }

    const salida = await db.runTransaction(async (tx): Promise<
      { codigo: 200; cuerpo: RespuestaDelCotejo } | { codigo: 409 | 400; cuerpo: { error: string } }
    > => {
      // TODAS LAS LECTURAS PRIMERO (Firestore no admite leer después de escribir).
      const conversacion = await tx.get(refConversacion);
      const solicitud = conversacion.get('solicitud') as Record<string, unknown> | undefined;
      if (!conversacion.exists || !solicitud || typeof solicitud['etapa'] !== 'string') {
        return { codigo: 409, cuerpo: { error: 'sin_cobro_pendiente' } };
      }
      if (!esReglaDos(solicitud)) return { codigo: 409, cuerpo: { error: 'regla_1' } };
      const etapa = solicitud['etapa'] as string;
      const evento = solicitud['evento'] as { id?: unknown; calendario?: unknown } | null | undefined;
      const pedidoId = typeof evento?.id === 'string' ? evento.id.trim() : '';
      const eventoDevuelto = pedidoId ? { id: pedidoId, calendario: String(evento?.calendario ?? '') } : null;

      // EL MISMO COMPROBANTE OTRA VEZ (reintento de n8n, porque la primera
      // respuesta se perdió): se repite lo que se contestó, con su aviso
      // original, y no se cuenta ni se escribe nada.
      const anotados = Array.isArray(solicitud['comprobantes']) ? (solicitud['comprobantes'] as ComprobanteAnotado[]) : [];
      const previoAnotado = anotados.find((c) => c.idMeta === idMeta);
      if (previoAnotado) {
        const estadoRepetido: EstadoDeRespuesta = previoAnotado.estado === 'invalido' ? 'reintentar' : previoAnotado.estado;
        const conCierre = previoAnotado.estado === 'valido' || previoAnotado.estado === 'aproximado';
        const actuales = typeof solicitud['intentosInvalidos'] === 'number' ? (solicitud['intentosInvalidos'] as number) : 0;
        const nAnotado = typeof previoAnotado.intentos === 'number' ? previoAnotado.intentos : actuales;
        // El código del pedido que se dio entonces, tal cual (no consume otro correlativo).
        const codigoAnotado = conCierre
          ? (await tx.get(db.doc(`tenants/${tenantId}/cierres/${idDeCierreDeVenta(pedidoId || idMeta)}`))).get('codigoPedido') : undefined;
        return {
          codigo: 200,
          cuerpo: {
            estado: estadoRepetido, motivo: previoAnotado.motivo,
            // Los intentos de ENTONCES (lo que se contestó), no los de ahora.
            intentos: nAnotado, intentosRestantes: Math.max(0, MAX_INTENTOS_INVALIDOS - nAnotado),
            importe: previoAnotado.importe ?? totalUtilizable(solicitud['monto']), moneda,
            montoLeido: previoAnotado.montoLeido ?? null, montoDistinto: previoAnotado.montoDistinto ?? false,
            ...(typeof codigoAnotado === 'string' && codigoAnotado !== '' ? { codigoPedido: codigoAnotado } : {}),
            ...(montoExacto && estadoRepetido === 'reintentar' ? diferenciaDe(previoAnotado.importe ?? totalUtilizable(solicitud['monto']), previoAnotado.montoLeido, previoAnotado.motivo) : {}),
            cierreId: conCierre ? idDeCierreDeVenta(pedidoId || idMeta) : null, evento: eventoDevuelto,
            avisarComercio: previoAnotado.avisar === true, repetido: true,
          },
        };
      }

      // ¿Corre en plazo? Solo entonces hace falta el total, el cierre y calificar.
      const probe = solicitudDeCobroTras(solicitud, { tipo: 'lectura' }, ahoraMs);
      const enPlazo = etapa === 'qr_enviado' && probe.efecto !== 'vencido';

      let esperado = 0;
      let cal: Calificacion | null = null;
      let referencia = '';
      let refCierre = null as ReturnType<typeof db.doc> | null;
      let previo = false;
      let cierrePrevio: FirebaseFirestore.DocumentSnapshot | null = null;
      if (enPlazo) {
        // El total del pedido: el del servidor si vino del carrito web; si no,
        // el que se cotizó al mandar el QR. Nunca contra cero.
        let delPedido: number | null = null;
        if (pedidoId.startsWith('cat_')) {
          const pedido = await tx.get(db.doc(`tenants/${tenantId}/pedidos/${pedidoId}`));
          delPedido = pedido.exists ? totalUtilizable(pedido.get('total')) : null;
        }
        esperado = delPedido ?? totalUtilizable(solicitud['monto']) ?? 0;
        if (esperado <= 0) return { codigo: 409, cuerpo: { error: 'sin_total' } };
        referencia = pedidoId || idMeta;
        refCierre = db.doc(`tenants/${tenantId}/cierres/${idDeCierreDeVenta(referencia)}`);
        cierrePrevio = await tx.get(refCierre);
        previo = cierrePrevio.exists;
        const qrEnviadoEn = typeof (solicitud['qrEnviadoEn'] as { toMillis?: unknown } | undefined)?.toMillis === 'function'
          ? (solicitud['qrEnviadoEn'] as Timestamp).toMillis() : ahoraMs;
        cal = legible
          ? calificarComprobante(
              esperadoDeLaVenta(esperado, cobroReal, qrEnviadoEn, ahoraMs, MINUTOS_TOLERANCIA_RELOJ), leido)
          : { estado: 'no_es_comprobante', motivo: 'ilegible', motivos: ['ilegible'], montoLeido: null, montoDistinto: false };
      }

      // Lectura del registro de recibidos: junto con las demás, antes de toda escritura.
      const recibidoPrevio = await tx.get(refRecibido);

      const transicion = solicitudDeCobroTras(solicitud, {
        tipo: 'comprobante',
        // Para la máquina de estados, «no es comprobante» es un inválido más.
        // Con `montoExacto`, un aproximado es un observado: cuenta como inválido (reintentar, con su tope de intentos).
        estado: cal === null ? 'invalido' : cal.estado === 'no_es_comprobante' || (montoExacto && cal.estado === 'aproximado') ? 'invalido' : cal.estado,
        motivo: cal?.motivo ?? 'tardio',
        idMeta, ruta: rutaImagen,
        importe: esperado > 0 ? esperado : null, montoLeido: cal?.montoLeido ?? montoDeLoLeido,
        montoDistinto: cal?.montoDistinto ?? false,
      }, ahoraMs);

      const estado = estadoDeRespuesta(transicion, etapa, cal);
      if (estado === 'sin_cobro_pendiente' || estado === 'cobro_cancelado' || estado === 'regla_1' || estado === 'sin_total') {
        // Aunque se rechace, un vencimiento perezoso que se descubrió se anota (una sola vez).
        if (transicion.cambios) tx.set(refConversacion, { solicitud: transicion.cambios }, { merge: true });
        if (Object.keys(transicion.metricas).length > 0) escribirMetricas(tx, refMetricas, transicion.metricas, false);
        return { codigo: 409, cuerpo: { error: estado } };
      }

      const cerrado = transicion.efecto === 'cerrado';
      const idCierre = cerrado ? idDeCierreDeVenta(referencia)
        : estado === 'ya_resuelto' && pedidoId ? idDeCierreDeVenta(pedidoId) : null;

      // EL CÓDIGO DEL PEDIDO (PR-S). Última lectura de la transacción: antes de cualquier escritura.
      // Idempotente por pedido: si el cierre ya lo tiene, se repite ese y no se consume otro correlativo.
      let codigoPedido: string | null = null;
      let correlativoNuevo: Correlativo | null = null;
      if (idCierre) {
        const existente = (cierrePrevio && cerrado ? cierrePrevio : await tx.get(db.doc(`tenants/${tenantId}/cierres/${idCierre}`)))
          .get('codigoPedido');
        if (typeof existente === 'string' && existente !== '') codigoPedido = existente;
        else if (cerrado && prefijo && cal && (cal.estado === 'valido' || cal.estado === 'aproximado')) {
          correlativoNuevo = await leerCorrelativo(tx, db, tenantId, ahoraMs);
          codigoPedido = formarCodigo(prefijo, correlativoNuevo.dia, correlativoNuevo.n);
        }
      }

      // LA FACTURA DEL PEDIDO (PR-F): SOLO cuando este cotejo le dio el código (un comercio sin prefijo no
      // escribe nada nuevo; el reintento o un cierre que ya tenía código no vuelve la factura a 'pedida').
      // Va en la MISMA escritura de la conversación: 0 escrituras nuevas. `facturaEnMs` del pedido anterior se borra.
      const ultimoPedido = correlativoNuevo && codigoPedido && idCierre
        ? { ...ultimoPedidoAlCerrar(codigoPedido, idCierre, ahoraMs, configPedidos.data()), facturaEnMs: FieldValue.delete() }
        : null;
      if (transicion.cambios || ultimoPedido) {
        tx.set(refConversacion, {
          ...(transicion.cambios ? { solicitud: transicion.cambios } : {}),
          ...(ultimoPedido ? { ultimoPedido } : {}),
        }, { merge: true });
      }

      // EL REGISTRO DE RECIBIDOS, en ESTA transacción: si esta escritura falla, el cotejo entero
      // se aborta y no queda la conversación, el cierre ni las métricas a medias.
      if (transicion.anotado) {
        const nombre = texto(conversacion.get('nombreContacto'), 120);
        tx.set(refRecibido, documentoDeRecibido(
          transicion.anotado, idConversacion, nombre, moneda, recibidoPrevio.exists ? recibidoPrevio.data() : undefined,
        ));
      }

      if (cerrado && refCierre && cal && (cal.estado === 'valido' || cal.estado === 'aproximado')) {
        const registroCotejo = {
          // `cuadra` por compatibilidad con la pantalla de Cobros; `calidad` distingue.
          resultado: 'cuadra', calidad: cal.estado, motivo: cal.motivo, diferencias: [] as string[],
          montoLeido: cal.montoLeido, montoDistinto: cal.montoDistinto,
          banco: texto((cuerpo['leido'] as Record<string, unknown> | undefined)?.['banco'], 80),
          idMeta, intentos: transicion.intentosInvalidos + 1, en: Timestamp.fromMillis(ahoraMs),
        };
        if (correlativoNuevo) escribirCorrelativo(tx, correlativoNuevo);
        if (previo) {
          // El cierre ya existía (lo registró otro camino): se reescribe el cotejo, no se cuenta de nuevo.
          tx.update(refCierre, { cotejo: registroCotejo, ...(codigoPedido ? { codigoPedido } : {}) });
          // La ruta de la imagen (ya validada contra ESTE comercio y ESTE idMeta) se agrega con
          // merge: sin ella el visor tendría que derivarla. Sin imagen, nada cambia.
          if (rutaImagen) tx.set(refCierre.collection('privado').doc('datos'), { rutaComprobante: rutaImagen }, { merge: true });
        } else {
          tx.set(refCierre, {
            tipo: 'venta', ocurridoEn: Timestamp.fromMillis(ahoraMs), referencia,
            telefonoEnmascarado: enmascarar(telefono), monto: esperado, moneda, cotejo: registroCotejo,
            ...(codigoPedido ? { codigoPedido } : {}),
          });
          const nombre = texto(conversacion.get('nombreContacto'), 120);
          tx.set(refCierre.collection('privado').doc('datos'), {
            telefono, conversacionId: idConversacion,
            ...(nombre ? { nombreCliente: nombre } : {}),
            // Lo lee `verComprobante` (en nombre del administrador, el operador o el soporte);
            // solo si la ruta es la de ESTE comercio y ESTE mensaje (`rutaValidaDe`).
            ...(rutaImagen ? { rutaComprobante: rutaImagen } : {}),
            detalle: detalleDeLaVentaCalificada(esperado, moneda, cal.estado, cal.motivo),
          });
        }
        escribirMetricas(tx, refMetricas, transicion.metricas, !previo);
      } else if (Object.keys(transicion.metricas).length > 0) {
        // Un inválido NO crea cierre ni suma `cierres`.
        escribirMetricas(tx, refMetricas, transicion.metricas, false);
      }

      const importe = esperado > 0 ? esperado : totalUtilizable(solicitud['monto']);
      const motivo = estado === 'valido' || estado === 'aproximado' || estado === 'reintentar'
        ? (cal?.motivo ?? 'ok')
        : estado === 'en_revision' && cal ? cal.motivo : estado;
      return {
        codigo: 200,
        cuerpo: {
          estado, motivo,
          ...(cal && (estado === 'valido' || estado === 'aproximado' || estado === 'reintentar') ? { motivos: motivosParaElCliente(cal.motivos) } : {}),
          intentos: transicion.intentosInvalidos, intentosRestantes: transicion.intentosRestantes,
          importe, moneda,
          montoLeido: cal?.montoLeido ?? montoDeLoLeido,
          montoDistinto: cal?.montoDistinto ?? false,
          ...(montoExacto && cal?.estado === 'aproximado' && estado === 'reintentar' ? diferenciaDe(importe, cal.montoLeido, 'monto_distinto') : {}),
          ...(codigoPedido ? { codigoPedido } : {}),
          cierreId: idCierre, evento: eventoDevuelto,
          avisarComercio: transicion.avisarComercio, repetido: false,
        },
      };
    });

    if (salida.codigo === 200) {
      await registrar(tenantId, {
        tipo: 'cobro_cotejado', resultado: 'ok', telefono, conversacionId: idConversacion,
        codigo: salida.cuerpo.estado,
      });
    }
    respuesta.status(salida.codigo).json(salida.cuerpo);
  },
);

/** `montoEsperado` y `diferencia` (leído − esperado) de un observado por monto; nada si falta algún dato. */
function diferenciaDe(esperado: number | null | undefined, leido: number | null | undefined, motivo: string | undefined): { montoEsperado?: number; diferencia?: number } {
  if (motivo !== 'monto_distinto' || typeof esperado !== 'number' || typeof leido !== 'number') return {};
  return { montoEsperado: esperado, diferencia: Math.round((leido - esperado) * 100) / 100 };
}

/** Días que vive un registro de recibidos antes de que el TTL de Firestore lo borre. */
export const DIAS_DE_RECIBIDOS = 90;

/**
 * El documento de `comprobantesRecibidos/{nombreDeObjeto(idMeta)}`. NO lleva el
 * teléfono (sale de `conversacionId`), ni lo leído de la imagen, ni `avisar`.
 * Si ya existía (el mismo comprobante contado otra vez, por ejemplo el séptimo
 * que el arreglo de la conversación ya no guarda), conserva `en` y `vence`.
 */
export function documentoDeRecibido(
  a: ComprobanteAnotado, conversacionId: string, nombreContacto: string, moneda: string,
  previo?: FirebaseFirestore.DocumentData,
): Record<string, unknown> {
  const enPrevio = previo?.['en'] instanceof Timestamp ? (previo['en'] as Timestamp) : null;
  const vencePrevio = previo?.['vence'] instanceof Timestamp ? (previo['vence'] as Timestamp) : null;
  const en = enPrevio ?? a.en;
  return {
    idMeta: a.idMeta.slice(0, 120), conversacionId, estado: a.estado, motivo: a.motivo,
    en, vence: vencePrevio ?? Timestamp.fromMillis(en.toMillis() + DIAS_DE_RECIBIDOS * 86_400_000),
    moneda: /^[A-Z]{3}$/.test(moneda) ? moneda : 'BOB',
    importe: a.importe ?? null, montoLeido: a.montoLeido ?? null, montoDistinto: a.montoDistinto ?? false,
    intentos: typeof a.intentos === 'number' ? a.intentos : 0,
    ruta: a.ruta ?? (typeof previo?.['ruta'] === 'string' ? (previo['ruta'] as string) : null),
    ...(nombreContacto ? { nombreContacto } : {}),
  };
}

function escribirMetricas(
  tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference,
  incrementos: Record<string, number>, sumaCierre: boolean,
): void {
  const datos: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(incrementos)) datos[k] = FieldValue.increment(v);
  if (sumaCierre) datos['cierres'] = FieldValue.increment(1);
  tx.set(ref, datos, { merge: true });
}
