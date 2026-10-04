import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { SECRETOS_POR_ALIAS, enmascarar, rutaAutenticada } from '../../core/seguridad/firma.js';
import { registrar } from '../../core/turno/bitacora.js';
import { periodoDe } from '../../central/cuenta/planes.js';
import {
  calificarComprobante, parsearMonto, type Calificacion, type Leido,
} from './cotejo.js';
import {
  MAX_INTENTOS_INVALIDOS, detalleDeLaVentaCalificada, esperadoDeLaVenta, esReglaDos, idDeCierreDeVenta,
  solicitudDeCobroTras, totalUtilizable, type ComprobanteAnotado, type EfectoDeCobro, type TransicionDeCobro,
} from './cobroVenta.js';
import { rutaValidaDe } from './comprobantes.js';

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
export type Rechazo = 'sin_cobro_pendiente' | 'cobro_cancelado' | 'sin_total' | 'regla_1' | 'cobro_simulado';

export interface RespuestaDelCotejo {
  estado: EstadoDeRespuesta;
  motivo: string;
  intentos: number;
  intentosRestantes: number;
  importe: number | null;
  moneda: string;
  montoLeido: number | null;
  montoDistinto: boolean;
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
    const rutaImagen = rutaValidaDe(cuerpo['ruta'], ruta.tenantId, idMeta);

    const db = getFirestore();
    const { tenantId } = ruta;
    const idConversacion = `wa_${telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodoDe()}`);
    const ahoraMs = Date.now();

    const [venta, negocio] = await Promise.all([
      db.doc(`tenants/${tenantId}/config/venta`).get(),
      db.doc(`tenants/${tenantId}/config/negocio`).get(),
    ]);
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
        const n = typeof solicitud['intentosInvalidos'] === 'number' ? (solicitud['intentosInvalidos'] as number) : 0;
        return {
          codigo: 200,
          cuerpo: {
            estado: estadoRepetido, motivo: previoAnotado.motivo,
            intentos: n, intentosRestantes: Math.max(0, MAX_INTENTOS_INVALIDOS - n),
            importe: previoAnotado.importe ?? totalUtilizable(solicitud['monto']), moneda,
            montoLeido: previoAnotado.montoLeido ?? null, montoDistinto: previoAnotado.montoDistinto ?? false,
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
        previo = (await tx.get(refCierre)).exists;
        const qrEnviadoEn = typeof (solicitud['qrEnviadoEn'] as { toMillis?: unknown } | undefined)?.toMillis === 'function'
          ? (solicitud['qrEnviadoEn'] as Timestamp).toMillis() : ahoraMs;
        cal = legible
          ? calificarComprobante(
              esperadoDeLaVenta(esperado, cobroReal, qrEnviadoEn, ahoraMs, MINUTOS_TOLERANCIA_RELOJ), leido)
          : { estado: 'no_es_comprobante', motivo: 'ilegible', motivos: ['ilegible'], montoLeido: null, montoDistinto: false };
      }

      const transicion = solicitudDeCobroTras(solicitud, {
        tipo: 'comprobante',
        // Para la máquina de estados, «no es comprobante» es un inválido más.
        estado: cal === null ? 'invalido' : cal.estado === 'no_es_comprobante' ? 'invalido' : cal.estado,
        motivo: cal?.motivo ?? 'tardio',
        idMeta, ruta: rutaImagen,
        importe: esperado > 0 ? esperado : null, montoLeido: cal?.montoLeido ?? null,
        montoDistinto: cal?.montoDistinto ?? false,
      }, ahoraMs);

      const estado = estadoDeRespuesta(transicion, etapa, cal);
      if (estado === 'sin_cobro_pendiente' || estado === 'cobro_cancelado' || estado === 'regla_1' || estado === 'sin_total' || estado === 'cobro_simulado') {
        // Aunque se rechace, un vencimiento perezoso que se descubrió se anota (una sola vez).
        if (transicion.cambios) tx.set(refConversacion, { solicitud: transicion.cambios }, { merge: true });
        if (Object.keys(transicion.metricas).length > 0) escribirMetricas(tx, refMetricas, transicion.metricas, false);
        return { codigo: 409, cuerpo: { error: estado } };
      }

      const cerrado = transicion.efecto === 'cerrado';
      const idCierre = cerrado ? idDeCierreDeVenta(referencia)
        : estado === 'ya_resuelto' && pedidoId ? idDeCierreDeVenta(pedidoId) : null;

      if (transicion.cambios) tx.set(refConversacion, { solicitud: transicion.cambios }, { merge: true });

      if (cerrado && refCierre && cal && (cal.estado === 'valido' || cal.estado === 'aproximado')) {
        const registroCotejo = {
          // `cuadra` por compatibilidad con la pantalla de Cobros; `calidad` distingue.
          resultado: 'cuadra', calidad: cal.estado, motivo: cal.motivo, diferencias: [] as string[],
          montoLeido: cal.montoLeido, montoDistinto: cal.montoDistinto,
          banco: texto((cuerpo['leido'] as Record<string, unknown> | undefined)?.['banco'], 80),
          idMeta, intentos: transicion.intentosInvalidos + 1, en: Timestamp.fromMillis(ahoraMs),
        };
        if (previo) {
          // El cierre ya existía (lo registró otro camino): se reescribe el cotejo, no se cuenta de nuevo.
          tx.update(refCierre, { cotejo: registroCotejo });
        } else {
          tx.set(refCierre, {
            tipo: 'venta', ocurridoEn: Timestamp.fromMillis(ahoraMs), referencia,
            telefonoEnmascarado: enmascarar(telefono), monto: esperado, moneda, cotejo: registroCotejo,
          });
          const nombre = texto(conversacion.get('nombreContacto'), 120);
          tx.set(refCierre.collection('privado').doc('datos'), {
            telefono, conversacionId: idConversacion,
            ...(nombre ? { nombreCliente: nombre } : {}),
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
          intentos: transicion.intentosInvalidos, intentosRestantes: transicion.intentosRestantes,
          importe, moneda,
          montoLeido: cal?.montoLeido ?? (legible ? parsearMonto(leido.monto as string) : null),
          montoDistinto: cal?.montoDistinto ?? false,
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

function escribirMetricas(
  tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference,
  incrementos: Record<string, number>, sumaCierre: boolean,
): void {
  const datos: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(incrementos)) datos[k] = FieldValue.increment(v);
  if (sumaCierre) datos['cierres'] = FieldValue.increment(1);
  tx.set(ref, datos, { merge: true });
}
