import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from './firma.js';
import { ETAPAS_PENDIENTES, milisegundosDe, registrar, type Solicitud } from './ingesta.js';
import { documentoDeVertical } from './prompt.js';
import { periodoDe } from './planes.js';

/**
 * =============================================================================
 * RECORDATORIO DE SOLICITUD PENDIENTE — a quién se le escribe, y a quién no
 * =============================================================================
 *
 * EL PROBLEMA (`Analisis/31` §4). De cada diez personas que le escriben a la
 * clínica, cuatro no terminan de reservar: pidieron horarios y no eligieron, o
 * recibieron el QR de la seña y no volvieron. Un recordatorio —UNO— recupera a
 * una parte de ellas. Dos recordatorios, o uno a quien pidió que lo dejen en
 * paz, cuestan el número de WhatsApp del cliente.
 *
 * LAS CUATRO REGLAS, Y DÓNDE SE HACEN CUMPLIR (`CLAUDE.md` §7: en el servidor,
 * nunca en la pantalla ni en un nodo de n8n):
 *
 *   1. UNA SOLA VEZ POR SOLICITUD. `solicitud.seguimientos === 0` al listar, y
 *      `seguimientoEnviado` incrementa DENTRO de una transacción que vuelve a
 *      mirarlo. Dos corridas simultáneas del flujo no pueden mandar dos.
 *   2. NUNCA A QUIEN PIDIÓ QUE NO LE ESCRIBAN, ni a quien pasó a una persona:
 *      `noContactar !== true`. Lo enciende la ingesta (`evento: 'no_contactar'`)
 *      y lo apaga una persona del negocio desde la consola.
 *   3. NUNCA A UN TELÉFONO EN OPERADOR O BLOQUEADO. Esa conversación ya la está
 *      atendiendo alguien, o el asistente dejó de responderle por uso extendido:
 *      un recordatorio automático encima sería el peor mensaje posible.
 *   4. NUNCA A QUIEN YA AGENDÓ. La solicitud tiene que estar en una etapa
 *      PENDIENTE (`horarios` o `qr_enviado`); `agendada` y `vencida` no entran.
 *
 * LA MARCA VA ANTES DEL ENVÍO, y es deliberado: el flujo llama primero a
 * `seguimientoEnviado` y recién después manda el mensaje. Si el envío falla, la
 * solicitud queda marcada y nadie reintenta. **Un seguimiento perdido es mejor
 * que dos seguimientos mandados**, porque el segundo es el que hace que la
 * persona bloquee el número.
 *
 * QUÉ CUESTA (`CLAUDE.md` «Base comercial» §1). El de modo `texto` cae dentro
 * de la ventana de 24 h: **+1 mensaje, solo en las conversaciones que quedaron
 * a medio camino**. El de modo `plantilla` cae fuera: la ingesta no cuenta un
 * saliente sobre ventana vencida como conversación, así que no se le factura
 * nada al comercio (`Analisis/31` §2). La respuesta del paciente sí abre una
 * conversación nueva, y es exactamente lo que se busca.
 */

/** Recorta y normaliza un texto que vino de afuera. Igual que en `sena.ts`. */
function texto(valor: unknown, maxLargo: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maxLargo) : '';
}

const TELEFONO = /^[0-9]{8,15}$/;
const HORA = 60 * 60 * 1000;

/**
 * LAS DOS VENTANAS, en horas desde el último mensaje de la conversación.
 *
 * Entre 2 y 4 h la ventana de 24 h sigue abierta: se manda TEXTO libre, que es
 * lo que el paciente espera leer («te dejé los horarios…»). Entre 24 y 48 h la
 * ventana ya venció: Meta solo deja entrar una PLANTILLA aprobada, y tiene que
 * ser de utilidad —el estado de una solicitud que la persona hizo—, nunca una
 * promoción (`Analisis/31` §1).
 *
 * Y NO SE MANDA NADA ENTRE LAS 4 Y LAS 24 HORAS: ahí la ventana está por
 * vencer o recién venció, el texto ya no entra y la plantilla llegaría de
 * madrugada. Tampoco después de las 48: a los dos días un recordatorio de una
 * solicitud ya no es una actualización, es publicidad.
 */
export const VENTANAS = {
  texto: { desde: 2 * HORA, hasta: 4 * HORA },
  plantilla: { desde: 24 * HORA, hasta: 48 * HORA },
} as const;

/** Lo máximo que sale en una corrida del barrido. */
export const TOPE_POR_CORRIDA = 50;

/**
 * Cuántas conversaciones se leen de la base por corrida. La consulta ya viene
 * acotada a las últimas 48 h, así que para un comercio de 500 conversaciones
 * al mes son ~30 documentos; 200 es holgura, no un límite que se vaya a tocar.
 */
const TOPE_DE_LECTURA = 200;

export type ModoSeguimiento = 'texto' | 'plantilla';

/** La forma mínima de la conversación que esta decisión mira. */
export interface ConversacionParaSeguimiento {
  solicitud?: unknown;
  noContactar?: unknown;
  atencionEstado?: unknown;
  ultimoEn?: unknown;
}

/**
 * ¿A esta conversación le toca el recordatorio, y de qué modo?
 *
 * ES PURA Y ESTÁ PROBADA APARTE, caso negativo por caso negativo. Sobre esto se
 * decide mandarle un mensaje no solicitado a una persona que no escribió: la
 * decisión no puede vivir dentro de una consulta a Firestore que solo se puede
 * probar con emulador, ni dentro de un nodo de n8n que nadie prueba.
 *
 * Devuelve `null` —no se le escribe— cuando pasa cualquiera de estas:
 *
 *   · no hay solicitud, o su etapa no es PENDIENTE (`agendada`, `vencida`, o
 *     una etapa que no existe);
 *   · ya salió un seguimiento para esta solicitud (`seguimientos` distinto de 0,
 *     y también si el campo viniera con basura: ante la duda, no se escribe);
 *   · `noContactar === true`;
 *   · el teléfono está en `operador` o `bloqueado`;
 *   · no se sabe cuándo fue el último mensaje;
 *   · el último mensaje cae fuera de las dos ventanas.
 */
export function esPendienteDeSeguimiento(
  conversacion: ConversacionParaSeguimiento | null | undefined,
  ahoraMs: number,
): ModoSeguimiento | null {
  if (!conversacion || typeof conversacion !== 'object') return null;
  if (conversacion.noContactar === true) return null;
  const estado = typeof conversacion.atencionEstado === 'string' ? conversacion.atencionEstado : '';
  if (estado === 'operador' || estado === 'bloqueado') return null;

  const s = typeof conversacion.solicitud === 'object' && conversacion.solicitud !== null
    ? (conversacion.solicitud as Partial<Solicitud>) : null;
  if (!s) return null;
  if (typeof s.etapa !== 'string' || !ETAPAS_PENDIENTES.has(s.etapa)) return null;
  // El cero tiene que estar escrito: un campo ausente o con otro tipo no es
  // «todavía ninguno», es una solicitud que no entiendo, y no se le escribe.
  if (s.seguimientos !== 0) return null;

  const ultimoMs = milisegundosDe(conversacion.ultimoEn);
  if (ultimoMs === null) return null;
  const silencio = ahoraMs - ultimoMs;
  if (silencio >= VENTANAS.texto.desde && silencio < VENTANAS.texto.hasta) return 'texto';
  if (silencio >= VENTANAS.plantilla.desde && silencio < VENTANAS.plantilla.hasta) return 'plantilla';
  return null;
}

// ---------------------------------------------------------------------------
// QUIÉN ESTÁ PENDIENTE
// ---------------------------------------------------------------------------

/**
 * La lista para el barrido de la hora. El flujo no filtra nada: manda lo que
 * este endpoint devuelve, y nada más.
 *
 * POR QUÉ LA CONSULTA VA POR `ultimoEn` Y NO POR `solicitud.etapa`, que es lo
 * que parecería natural. Una solicitud en `horarios` se queda en `horarios`
 * para siempre si el paciente nunca vuelve: consultar por la etapa devuelve un
 * conjunto que CRECE SIN TECHO con los meses, y el `limit` empezaría a
 * devolver las viejas y a tapar las de hoy. `ultimoEn` entre 2 y 48 horas
 * atrás está acotado por construcción —son las conversaciones de los últimos
 * dos días— y el resto se filtra en memoria con la función pura de arriba, que
 * es donde se puede probar.
 *
 * Y ADEMÁS NO NECESITA ÍNDICE COMPUESTO: es un único campo con dos extremos de
 * rango y el orden sobre ese mismo campo, que Firestore resuelve con el índice
 * de campo simple que mantiene solo. Un índice compuesto declarado de más se
 * paga en cada escritura de cada conversación (`indices.test.ts` explica por
 * qué no se declaran a ciegas).
 */
export const seguimientosPendientes = onRequest(
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

    const db = getFirestore();
    const { tenantId } = ruta;
    const ahoraMs = Date.now();

    // El importe de la seña viaja con cada pendiente en etapa `qr_enviado`:
    // el texto del recordatorio lo nombra («…a la espera de la seña de 50 Bs»)
    // y el flujo no tiene de dónde sacarlo. Una lectura por corrida.
    const docVertical = documentoDeVertical(ruta.flujo || 'agendamiento') ?? 'agendamiento';
    const especifica = await db.doc(`tenants/${tenantId}/config/${docVertical}`).get();
    const importeCrudo = especifica.get('senaImporte');
    const importe = typeof importeCrudo === 'number' && Number.isInteger(importeCrudo) && importeCrudo > 0
      ? importeCrudo : 0;

    const candidatas = await db.collection(`tenants/${tenantId}/conversaciones`)
      .where('ultimoEn', '>=', Timestamp.fromMillis(ahoraMs - VENTANAS.plantilla.hasta))
      .where('ultimoEn', '<=', Timestamp.fromMillis(ahoraMs - VENTANAS.texto.desde))
      .orderBy('ultimoEn', 'desc')
      .limit(TOPE_DE_LECTURA)
      .get();

    const pendientes: Record<string, unknown>[] = [];
    for (const doc of candidatas.docs) {
      if (pendientes.length >= TOPE_POR_CORRIDA) break;
      const datos = doc.data() as ConversacionParaSeguimiento & Record<string, unknown>;
      const modo = esPendienteDeSeguimiento(datos, ahoraMs);
      if (!modo) continue;
      const solicitud = datos.solicitud as Partial<Solicitud>;
      const telefono = texto(datos['telefono'], 25);
      if (!TELEFONO.test(telefono)) continue;   // documento viejo o a medio escribir
      const ultimoMs = milisegundosDe(datos.ultimoEn);
      pendientes.push({
        telefono,
        nombreContacto: texto(datos['nombreContacto'], 120),
        etapa: solicitud.etapa,
        modo,
        ultimoEn: ultimoMs === null ? null : new Date(ultimoMs).toISOString(),
        ...(solicitud.evento ? { evento: solicitud.evento } : {}),
        ...(solicitud.etapa === 'qr_enviado' && importe > 0 ? { importe } : {}),
      });
    }

    // Sin bitácora: listar no le hace nada a nadie, y un renglón por hora y por
    // comercio sería ruido que tapa los eventos que sí explican algo.
    respuesta.status(200).json({ pendientes });
  },
);

// ---------------------------------------------------------------------------
// SE MANDÓ (Y SE MARCA ANTES DE MANDAR)
// ---------------------------------------------------------------------------

export const seguimientoEnviado = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const cuerpo = (typeof peticion.body === 'object' && peticion.body !== null
      ? peticion.body : {}) as Record<string, unknown>;
    const telefono = texto(cuerpo['telefono'], 25);
    if (!TELEFONO.test(telefono)) { respuesta.status(400).json({ error: 'telefono invalido' }); return; }
    const modoCrudo = texto(cuerpo['modo'], 20);
    if (modoCrudo !== 'texto' && modoCrudo !== 'plantilla') {
      respuesta.status(400).json({ error: 'modo invalido' }); return;
    }
    const modo: ModoSeguimiento = modoCrudo;
    const idMeta = texto(cuerpo['idMeta'], 120);

    const db = getFirestore();
    const { tenantId } = ruta;
    const idConversacion = `wa_${telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodoDe()}`);
    const ahoraMs = Date.now();

    // IDEMPOTENTE POR CONSTRUCCIÓN, y es la mitad del candado: el barrido corre
    // cada hora y n8n reintenta una petición que se cortó. Solo la PRIMERA
    // marca mueve algo; la segunda ve `seguimientos` distinto de cero y
    // contesta `repetido`, sin contar de nuevo y sin dejar mandar otra vez.
    const salida = await db.runTransaction(async (tx) => {
      const conversacion = await tx.get(refConversacion);
      const s = conversacion.get('solicitud');
      const solicitud = typeof s === 'object' && s !== null ? (s as Partial<Solicitud>) : null;
      if (!conversacion.exists || !solicitud) {
        return { marcado: false, repetido: false, motivo: 'sin_solicitud' as const };
      }
      const previos = typeof solicitud.seguimientos === 'number' ? solicitud.seguimientos : 0;
      if (previos !== 0) return { marcado: false, repetido: true };

      tx.set(refConversacion, {
        solicitud: {
          ...solicitud,
          seguimientos: previos + 1,
          seguimientoEn: Timestamp.fromMillis(ahoraMs),
          // La reactivación se mide desde CERO para este seguimiento: si la
          // solicitud arrastrara la marca de una anterior, el paciente que
          // vuelve a escribir no se contaría como recuperado.
          reactivadaEn: null,
        },
      }, { merge: true });
      // NO se cuenta como mensaje ni como conversación: eso lo hace la ingesta
      // cuando el flujo reporte el saliente, con la misma regla que el resto.
      // Acá solo se cuenta el HECHO del seguimiento.
      tx.set(refMetricas, { seguimientos: FieldValue.increment(1) }, { merge: true });
      return { marcado: true, repetido: false };
    });

    if (salida.marcado) {
      await registrar(tenantId, {
        tipo: 'seguimiento_enviado', resultado: 'ok', telefono, conversacionId: idConversacion,
        codigo: modo, ...(idMeta ? { detalle: idMeta } : {}),
      });
    }
    respuesta.status(200).json(salida);
  },
);
