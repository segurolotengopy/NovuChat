import { REGION } from './region.js';
import { senaVencidaPorTiempo } from './retencion.js';
import { existencias } from './inventario.js';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { defineInt } from 'firebase-functions/params';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from './firma.js';
import { sanearCaptacion } from './captacion.js';
import { vozFija } from './prompt.js';
import {
  HORAS_VENTANA_ATENCION, MS_VENTANA_ATENCION, RESPUESTAS_POR_CONVERSACION, avisoDeTransicion,
  estadoDeAtencion, umbralesDeAtencion, ventanaVencida,
} from './atencion.js';
// Los valores comerciales viven en `atencion.ts` (puro, compartido con la
// consola). Se reexportan para que quien ya los importaba de acá no cambie.
export { HORAS_VENTANA_ATENCION, RESPUESTAS_POR_CONVERSACION };
// El aviso de consumo al 80 % se decide en `planes.ts`, también puro.
import { avisoConsumoPendiente, avisoDeConsumo, limiteDeCampanas, periodoDe } from './planes.js';
import { campanasParaElFlujo } from './campanas.js';
// EL PREPAGO se decide en `prepago.ts`, puro: cobertura del mes, gracia,
// saldo de conversaciones y si el corte SE APLICA o solo se observa. Acá se
// aplica lo que decidió, dentro de la transacción que ya existía.
import {
  camposDerivados, consumidasDe, consumoDeConversacion, corteAplicable, corteDe, estadoDeServicio,
  mensajeCortesia, modalidadDe, periodosIncoherentes, rechazoPorPrepago, type CuentaCruda,
  type EstadoServicio, type MotivoCorte,
} from './prepago.js';
import {
  CAMPOS_LIBRES_AL_PROMPT, datosQueNoTenemos, horarioAtencion, instruccionesDeVoz,
  resolverFuncionarios, documentoDeVertical, rotulosCobroSimulado,
  resumirCatalogo, UMBRAL_CATALOGO_AL_PROMPT, enlaceDeMapaValido, ubicacionDe,
} from './prompt.js';
// El cobro de una VENTA: el importe no vive en la configuración, se fija cuando
// sale el QR. `cobroVenta.ts` no importa nada de acá en tiempo de ejecución
// (sus dos importaciones son de tipo), así que no hay ciclo.
import { cobroParaElFlujo, totalUtilizable } from './cobroVenta.js';

/**
 * =========================================================================
 * PUENTE n8n -> FIRESTORE
 * =========================================================================
 *
 * EL PROBLEMA
 * -----------
 * n8n corre en una VM propia en OCI, fuera de Google Cloud. Necesita escribir
 * las conversaciones de cada negocio en Firestore. La salida "fácil" sería
 * darle una clave JSON de cuenta de servicio: PROHIBIDO. Esa clave es de larga
 * duración, no caduca sola, tiene alcance de PROYECTO ENTERO —o sea, todos los
 * tenants— y si la VM se compromete se lleva puestos a todos los clientes de
 * una. Es exactamente la credencial compartida que el diseño debe evitar.
 *
 * LA SALIDA, EN DOS TRAMOS
 * ------------------------
 * 1) n8n firma cada petición con HMAC-SHA256 usando un secreto POR NÚMERO DE
 *    WHATSAPP que vive en Secret Manager y en las credenciales de n8n.
 *    El secreto NO viaja en la petición: viaja una firma. Un `Authorization:
 *    Bearer <clave>` quedaría en los logs del proxy inverso; una firma, no.
 *    La verificación NO vive acá: vive en `firma.ts`, y este archivo la usa a
 *    través de `rutaAutenticada()`. Ver ahí por qué el secreto se nombra por un
 *    ALIAS (`demoA`) y no por el identificador del número.
 *
 * 2) El tenant se DERIVA de la clave que valida la firma, nunca del cuerpo de la
 *    petición. Este es el control anti-"diputado confundido": aunque n8n mande
 *    `{"tenantId": "otro-negocio"}`, ese campo se ignora: el comercio sale del
 *    índice /rutasWhatsApp, resuelto desde el número que valida la firma.
 *    Sin esto, cualquier tenant con una clave válida escribiría en cualquier
 *    otro, y el aislamiento se cae por el lado del backend.
 *
 * 3) La escritura no la hace el SDK Admin a lo bruto: la función emite un token
 *    de Firebase Auth EFÍMERO (1 h) para el principal `svc_<tenantId>`, con el
 *    claim `{ nc: { t: { "<tenantId>": "ingesta" } } }`. Así la escritura pasa
 *    igual por `firestore.rules` y queda acotada por la misma regla que protege
 *    al navegador. Es defensa en profundidad: un error de programación en esta
 *    función no puede cruzar tenants, porque el token no alcanza.
 *
 * Por qué HMAC y no OIDC: la federación de identidades (Workload Identity
 * Federation) necesita que el emisor tenga una identidad OIDC propia. GitHub
 * Actions la tiene, y por eso el despliegue SÍ usa OIDC. Una VM de OCI corriendo
 * n8n no la tiene sin montar un emisor adicional. Ver admin/DISENO.md,
 * §Alternativas descartadas para la ingesta.
 */

// LA AUTENTICACIÓN VIVE EN `firma.ts`, NO ACÁ.
//
// Este archivo tenía su propia copia de todo: el mapa de secretos, la ventana de
// tolerancia, el tope de cuerpo, la comparación en tiempo constante y la
// verificación de la firma. Esa copia quedó INSERVIBLE: el mapa se indexaba por
// `phone_number_id`, `defineSecret` exige un nombre fijo escrito en el código, y
// un identificador de número no puede escribirse en un repositorio público. El
// mapa nunca se pudo llenar, así que ningún número autenticaba y la ingesta no
// recibía nada. `firma.ts` lo resolvió con un ALIAS guardado en
// /rutasWhatsApp/{numero}; acá se usa esa implementación y se borra la propia.
//
// Un comercio con dos números (por ejemplo agendamiento y venta) sigue teniendo
// dos secretos: comprometer uno no alcanza al otro ni a ningún otro comercio.

interface Entrante {
  telefono: string;
  direccion: 'entrante' | 'saliente';
  tipo: string;
  texto: string;
  idMeta?: string;
  nombreContacto?: string;
  /** `anuncio` o `directo` (`ORIGENES`). Solo se guarda al ABRIR la ventana. */
  origen?: string;
  /**
   * HECHO DEL FLUJO que acompaña al mensaje, además del mensaje en sí. Hoy el
   * único es `qr_enviado` —el flujo de reservas mandó el QR de la seña—, y
   * con él viajan `referencia` (el evento del calendario que quedó retenido)
   * y `calendario` (en cuál). Se reporta en la MISMA petición que el mensaje
   * saliente del QR para que el estado de la seña y el conteo del mensaje se
   * escriban en la misma transacción: si uno entra, el otro también.
   *
   * BLOQUE 4 (seguimientos, `Analisis/31` §4) agrega dos hechos más:
   *  - `horarios_ofrecidos` (saliente): en este turno corrió
   *    `consultar_disponibilidad` y NO corrió `agendar_cita`. Es el paciente
   *    que recibió horarios y todavía no eligió: abre (o mantiene) la
   *    solicitud en etapa `horarios`, que es lo que el flujo de seguimientos
   *    busca. Por hecho, no por lo que el modelo escribió.
   *  - `no_contactar` (entrante o saliente): el paciente pidió que no le
   *    escriban (regex fija en el flujo sobre su texto, en el reporte del
   *    entrante) o el turno terminó pasando a una persona (`transferir`, en
   *    el reporte del saliente). Marca `noContactar: true` en la conversación
   *    y desde ahí ningún seguimiento automático le llega. Es UN solo hecho
   *    con dos orígenes; la dirección del mensaje que lo trae no importa.
   */
  evento?: 'qr_enviado' | 'horarios_ofrecidos' | 'no_contactar' | 'cita_cancelada' | 'adelanto_aplicado' | 'reprogramada';
  referencia?: string;
  calendario?: string;
  /**
   * EL TOTAL QUE SE COTIZÓ AL MANDAR EL QR, solo con `qr_enviado` y solo en
   * venta (`cobroVenta.ts`). En una reserva el importe es fijo y vive en la
   * configuración; en una venta cambia con cada pedido, así que se fija acá,
   * en el mismo mensaje que reporta el QR, y se guarda en `solicitud.monto`.
   *
   * Es lo que hace que el cotejo sea «por hecho, no por dicho»: el número
   * contra el que se compara el comprobante quedó escrito cuando salió el QR,
   * y nada de lo que el modelo escriba después lo mueve.
   */
  monto?: number;
  /**
   * EL ADELANTO A FAVOR (Andres, 21/09/2026). `cita_cancelada` trae en
   * `referencia` la cita que se canceló y en `inicio` cuándo era (ISO): con eso
   * el servidor decide si hubo anticipación suficiente. `adelanto_aplicado`
   * trae en `referencia` la cita nueva a la que se aplicó. `reprogramada` es
   * las dos cosas en el MISMO turno —«cambiá mi cita al martes»: cancela y
   * agenda a la vez—: `referencia` e `inicio` de la cancelada, `nueva` la nueva.
   */
  inicio?: string;
  nueva?: string;
}

const TIPOS = new Set([
  'text', 'interactive', 'image', 'audio', 'document', 'order', 'location', 'otro',
]);

/**
 * DE DÓNDE NACIÓ LA CONVERSACIÓN (`Analisis/38` §2, `Analisis/39`).
 *
 * `anuncio` = el cliente escribió desde un anuncio de clic a WhatsApp, que es
 * lo que Meta avisa mandando `referral` en el mensaje. Esa conversación abre la
 * VENTANA DE PUNTO DE ENTRADA GRATUITO: Meta no cobra ningún mensaje de la
 * empresa durante 72 horas, y esos mensajes tampoco gastan franquicia.
 *
 * POR QUÉ SE MIDE. El margen de un contrato como el de Dhermacore depende de
 * qué fracción del tráfico entra por campaña —a 14 mensajes por conversación,
 * con 30 % no se pierde y con 0 % se pierden 38 USD al mes—, y hasta hoy ese
 * número NO SE PODÍA SABER: el flujo leía el `referral` y no lo reportaba. Un
 * contrato cuyo margen depende de un supuesto que no se mide es un contrato que
 * se renegocia a ciegas. En la modalidad BYOC (`Analisis/39`) importa todavía
 * más, porque esa varianza la absorbe el comercio y no NovuChat.
 *
 * LISTA CERRADA, como `TIPOS`: lo manda el flujo, o sea dato no confiable. Un
 * valor desconocido —o ausente— cae en `directo`, que es el caso conservador:
 * ante la duda se cuenta como tráfico que SÍ le cuesta a alguien. Nunca al
 * revés, porque sobreestimar la fracción por anuncio infla el margen esperado.
 */
const ORIGENES = new Set(['anuncio', 'directo']);

/** Los hechos del flujo que la ingesta entiende. Uno desconocido se ignora:
 *  el mensaje se cuenta igual y el campo no se guarda. */
const EVENTOS = new Set(['qr_enviado', 'horarios_ofrecidos', 'no_contactar', 'cita_cancelada', 'adelanto_aplicado', 'reprogramada']);

/**
 * Normaliza el mensaje entrante. TODO lo de acá es DATO NO CONFIABLE: lo escribió
 * un cliente final de WhatsApp. No se interpola en ninguna consulta, no se
 * evalúa, no se usa para armar una ruta. Solo se valida, se recorta y se guarda.
 */
function normalizar(cuerpo: unknown): Entrante | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const c = cuerpo as Record<string, unknown>;

  const telefono = typeof c['telefono'] === 'string' ? c['telefono'].trim() : '';
  if (!/^[0-9]{8,15}$/.test(telefono)) return null;

  const direccion = c['direccion'] === 'saliente' ? 'saliente' : 'entrante';
  const tipo = typeof c['tipo'] === 'string' && TIPOS.has(c['tipo']) ? c['tipo'] : 'otro';
  const texto = typeof c['texto'] === 'string' ? c['texto'].slice(0, 4096) : '';
  const idMeta = typeof c['idMeta'] === 'string' ? c['idMeta'].slice(0, 120) : undefined;
  const nombreContacto = typeof c['nombreContacto'] === 'string'
    ? c['nombreContacto'].slice(0, 120) : undefined;
  // Lista cerrada: lo desconocido cae en `directo`, no en `anuncio` (`ORIGENES`).
  const origen = typeof c['origen'] === 'string' && ORIGENES.has(c['origen'])
    ? c['origen'] : 'directo';
  // El hecho del flujo y sus identificadores. Los dos son datos que n8n copia
  // de la respuesta de Google Calendar; igual se recortan y no se interpolan.
  const evento = typeof c['evento'] === 'string' && EVENTOS.has(c['evento'])
    ? (c['evento'] as Entrante['evento']) : undefined;
  const referencia = typeof c['referencia'] === 'string'
    ? c['referencia'].trim().slice(0, 200) : '';
  const calendario = typeof c['calendario'] === 'string'
    ? c['calendario'].trim().slice(0, 200) : '';
  const inicio = typeof c['inicio'] === 'string' ? c['inicio'].trim().slice(0, 40) : '';
  const nueva = typeof c['nueva'] === 'string' ? c['nueva'].trim().slice(0, 200) : '';
  // EL TOTAL DEL PEDIDO. Dato no confiable como todo lo de acá: se acepta solo
  // como número finito y positivo dentro de un techo. Lo que no pase no se
  // guarda, y sin total el cotejo no compara nada (no lo toma por cero).
  const monto = totalUtilizable(c['monto']);

  return { telefono, direccion, tipo, texto, origen, ...(idMeta ? { idMeta } : {}),
           ...(nombreContacto ? { nombreContacto } : {}),
           ...(evento ? { evento } : {}),
           ...(referencia ? { referencia } : {}),
           ...(calendario ? { calendario } : {}),
           ...(inicio ? { inicio } : {}),
           ...(nueva ? { nueva } : {}),
           ...(monto !== null ? { monto } : {}) };
}

/**
 * ===========================================================================
 * LA SEÑA EN CURSO DE UN TELÉFONO — `solicitud` en la conversación
 * ===========================================================================
 *
 * Es el estado que le dice al flujo qué hacer con el próximo archivo que manda
 * el paciente: si hay un QR enviado y sin comprobante, una imagen o un PDF se
 * lee como comprobante y se coteja; si no, es una imagen cualquiera. Y es lo
 * que `senaVencida` mira para saber qué cita borrar.
 *
 * Vive en el documento de la conversación —que ya está indexado por teléfono
 * y ya se escribe con cada mensaje— por la misma razón que las marcas de
 * conteo: no crea ningún registro nuevo de teléfonos y se escribe en la
 * transacción que ya existe. Cero lecturas y cero escrituras extra.
 *
 * ETAPAS: `horarios` (bloque 4: el asistente ofreció horarios y el paciente
 * no eligió), `qr_enviado` (retenida, esperando el comprobante), `agendada`
 * (el comprobante cuadró, o `registrarCierre` registró la cita), `vencida`
 * (pasaron los minutos de retención sin comprobante y la cita se borró).
 *
 * Las dos PENDIENTES son `horarios` y `qr_enviado`: sobre ellas corre el
 * recordatorio de solicitud pendiente (`seguimientos.ts`), una sola vez.
 */
export interface Solicitud {
  etapa: 'horarios' | 'qr_enviado' | 'agendada' | 'vencida' | 'a_favor';
  /** Cuándo entró en esta etapa. */
  desde: Timestamp;
  qrEnviadoEn: Timestamp | null;
  /** La cita retenida en el calendario: su identificador y en qué calendario. */
  evento: { id: string; calendario: string } | null;
  /** Comprobantes recibidos para esta solicitud. */
  cotejos: number;
  /** Seguimientos enviados sobre ESTA solicitud. El tope es uno (bloque 4). */
  seguimientos: number;
  /** Cuándo salió el seguimiento; `null` mientras no salió. */
  seguimientoEn: Timestamp | null;
  /**
   * Cuándo el paciente volvió a escribir dentro de las 24 h del seguimiento;
   * `null` si no volvió. Es la marca que hace que `reactivadas` cuente UNA
   * vez por solicitud y no una por cada mensaje que siga.
   */
  reactivadaEn: Timestamp | null;
  /**
   * ADELANTO A FAVOR (Andres, 21/09/2026): hasta cuándo vale el adelanto de una
   * cita pagada que se canceló, y de qué cita venía. `null` fuera de `a_favor`.
   */
  aFavorHasta?: Timestamp | null;
  aFavorDe?: { id: string; calendario: string } | null;
  /**
   * EL TOTAL COTIZADO AL MANDAR EL QR, solo en venta (`cobroVenta.ts`).
   *
   * En una reserva el importe esperado se lee de `config/agendamiento`; en una
   * venta cambia con cada pedido y por eso se guarda acá, en el mismo instante
   * en que el QR salió. Es el número contra el que se coteja el comprobante, y
   * nada de lo que el modelo escriba después lo mueve.
   *
   * `null` en las reservas y cuando el flujo no lo mandó. Sin él no se coteja
   * el importe: se manda a una persona, que es lo honesto.
   */
  monto?: number | null;
}

/**
 * LA REGLA DEL ADELANTO A FAVOR (Andres, 21/09/2026). El asistente ya le decía
 * al paciente «para cancelar o reprogramar, escríbenos con al menos 2 horas de
 * anticipación y lo resolvemos sin costo», y el sistema le cobraba otra seña
 * al reagendar. Ahora: el adelanto de una cita PAGADA que se cancela con esa
 * anticipación queda a favor del paciente por siete días, y se aplica a la
 * próxima cita que agende en ese plazo. Con menos anticipación no hay crédito
 * automático: lo decide recepción, que recibe el aviso.
 */
export const DIAS_ADELANTO_A_FAVOR = 7;
export const HORAS_ANTICIPACION_PARA_CANCELAR = 2;

export const ETAPAS_PENDIENTES: ReadonlySet<string> = new Set(['horarios', 'qr_enviado']);

/** Milisegundos de un Timestamp (o de algo que se le parezca), o `null`. */
export function milisegundosDe(v: unknown): number | null {
  const t = v as { toMillis?: () => number; seconds?: unknown } | null | undefined;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  return null;
}

/** Una solicitud nueva, con todos los contadores y marcas en cero. */
function solicitudNueva(etapa: Solicitud['etapa'], ahora: Timestamp): Solicitud {
  return {
    etapa, desde: ahora, qrEnviadoEn: null, evento: null, cotejos: 0, seguimientos: 0,
    seguimientoEn: null, reactivadaEn: null, aFavorHasta: null, aFavorDe: null, monto: null,
  };
}

/**
 * Qué `solicitud` queda guardada después de este mensaje. `null` = no se toca.
 *
 * ES PURA Y ESTÁ PROBADA APARTE, como `contadoresDelMensaje`: sobre esto se
 * decide si el próximo archivo del paciente se coteja como pago y si le llega
 * un recordatorio, y la decisión separada de la base se prueba sin emulador.
 *
 * `previa` es lo que hay guardado. Por evento:
 *
 *  - `qr_enviado` SIEMPRE abre una solicitud nueva, aunque hubiera una: el
 *    flujo manda el QR cuando acaba de retener una cita, y esa cita nueva es
 *    la que hay que seguir, no la de hace dos días que venció o ya se pagó.
 *  - `horarios_ofrecidos` abre una solicitud `horarios` SOLO si no hay
 *    ninguna, o si la que hay está cerrada (`agendada` o `vencida`) desde hace
 *    más de 24 h: el paciente que agendó ayer y hoy pregunta por otro horario
 *    no es una solicitud pendiente nueva, es el mismo asunto. Sobre una
 *    `horarios` ya abierta NO cambia `desde` ni los contadores —si cambiara,
 *    cada turno con horarios reiniciaría el reloj del seguimiento y el
 *    recordatorio no saldría nunca—, y sobre un `qr_enviado` no toca nada: la
 *    seña pendiente manda.
 *  - `cita_agendada` (lo llama `registrarCierre` tipo cita, con la cita ya en
 *    el calendario) cierra la solicitud pendiente como `agendada`. Sin
 *    solicitud, la crea ya `agendada`: así un `horarios_ofrecidos` de la
 *    misma conversación en las 24 h siguientes no abre una pendiente que no
 *    existe. Sobre una `agendada` no mueve nada (idempotente).
 *
 * `merge: true` de Firestore fusiona los mapas campo a campo, así que una
 * solicitud nueva escribe TODOS sus campos, incluidos los nulos: si no, el
 * `seguimientoEn` de la solicitud anterior sobreviviría en la nueva.
 */
export function solicitudTras(
  previa: unknown,
  evento: string | undefined,
  ahoraMs: number,
  datos: { referencia?: string; calendario?: string; inicio?: string; nueva?: string; monto?: number },
): Solicitud | null {
  const ahora = Timestamp.fromMillis(ahoraMs);
  const p = typeof previa === 'object' && previa !== null ? (previa as Partial<Solicitud>) : null;
  const etapaPrevia = typeof p?.etapa === 'string' ? p.etapa : '';

  if (evento === 'qr_enviado') {
    const id = (datos.referencia ?? '').trim();
    return {
      ...solicitudNueva('qr_enviado', ahora),
      qrEnviadoEn: ahora,
      // Sin identificador de la cita no hay cita que seguir: el cotejo igual
      // corre (el cierre se referencia con el mensaje del comprobante), pero
      // `senaVencida` no tiene qué borrar. El flujo siempre lo manda.
      //
      // EN VENTA, `referencia` es el PEDIDO (el `cat_…` del carrito web, o el
      // id del mensaje del QR) y `calendario` no viene: no hay agenda. La forma
      // del campo no cambia porque lo que significa es lo mismo —qué quedó
      // reservado esperando este pago— y duplicarlo por vertical partiría en
      // dos una regla que es una sola.
      evento: id ? { id, calendario: (datos.calendario ?? '').trim() } : null,
      // EL TOTAL COTIZADO, en venta. Se escribe acá y no se vuelve a tocar: es
      // el número contra el que se cotejará el comprobante (`cobroVenta.ts`).
      monto: totalUtilizable(datos.monto),
    };
  }

  if (evento === 'horarios_ofrecidos') {
    if (!p || etapaPrevia === '') return solicitudNueva('horarios', ahora);
    if (ETAPAS_PENDIENTES.has(etapaPrevia)) return null;
    const desdeMs = milisegundosDe(p.desde);
    const cerradaHaceMas24h = desdeMs === null || ahoraMs - desdeMs >= MS_VENTANA_ATENCION;
    return cerradaHaceMas24h ? solicitudNueva('horarios', ahora) : null;
  }

  // CANCELÓ UNA CITA PAGADA: el adelanto queda a su favor, si hubo anticipación.
  // Solo la cita de ESTA solicitud, ya pagada (`agendada` con cotejo): una cita
  // sin seña, o de otra solicitud, no deja ningún crédito. Sin anticipación —o
  // sin saber cuándo era— no se da: lo resuelve recepción.
  if (evento === 'cita_cancelada') {
    const id = (datos.referencia ?? '').trim();
    const pagada = etapaPrevia === 'agendada' && typeof p?.cotejos === 'number' && p.cotejos > 0
      && !!p?.evento && p.evento.id === id && id !== '';
    if (!pagada) return null;
    const inicioMs = Date.parse(datos.inicio ?? '');
    const conAnticipacion = Number.isFinite(inicioMs)
      && inicioMs - ahoraMs >= HORAS_ANTICIPACION_PARA_CANCELAR * 3_600_000;
    if (!conAnticipacion) return null;
    return {
      ...solicitudNueva('a_favor', ahora), ...p, etapa: 'a_favor', desde: ahora, evento: null,
      aFavorHasta: Timestamp.fromMillis(ahoraMs + DIAS_ADELANTO_A_FAVOR * 24 * 3_600_000),
      aFavorDe: p!.evento ?? null,
    };
  }

  // REPROGRAMADA EN UN SOLO TURNO: la cancelación y la aplicación juntas. Misma
  // regla que las dos por separado —cita pagada de esta solicitud, con
  // anticipación—, y el adelanto pasa directo a la cita nueva, sin quedar «a
  // favor» en el medio. Si la regla no se cumple, no se toca nada.
  if (evento === 'reprogramada') {
    const nueva = (datos.nueva ?? '').trim();
    if (!nueva) return null;
    const aFavor = solicitudTras(previa, 'cita_cancelada', ahoraMs, datos);
    if (!aFavor) return null;
    return solicitudTras(aFavor, 'adelanto_aplicado', ahoraMs, { referencia: nueva, calendario: datos.calendario });
  }

  // SE APLICÓ EL ADELANTO A UNA CITA NUEVA: vuelve a `agendada`, con la cita
  // nueva. Una sola vez, y solo dentro del plazo: vencido, no se aplica nada.
  if (evento === 'adelanto_aplicado') {
    const id = (datos.referencia ?? '').trim();
    const hasta = milisegundosDe(p?.aFavorHasta);
    if (etapaPrevia !== 'a_favor' || !id || hasta === null || ahoraMs >= hasta) return null;
    return {
      ...solicitudNueva('agendada', ahora), ...p, etapa: 'agendada', desde: ahora,
      evento: { id, calendario: (datos.calendario ?? '').trim() }, aFavorHasta: null,
    };
  }

  if (evento === 'cita_agendada') {
    if (etapaPrevia === 'agendada') return null;
    if (!p || etapaPrevia === '') return solicitudNueva('agendada', ahora);
    return { ...solicitudNueva('agendada', ahora), ...p, etapa: 'agendada', desde: ahora };
  }

  return null;
}

/**
 * ¿Este mensaje REACTIVA una solicitud que recibió seguimiento? Sí cuando es
 * del cliente, hay un seguimiento enviado hace menos de 24 h y es el primer
 * mensaje suyo después de ese seguimiento (`reactivadaEn` todavía vacío).
 * Cuenta `reactivadas` en el mes: es la cifra que dice si el recordatorio
 * recupera a alguien o solo cuesta (`Analisis/31` §6). Pura, probada aparte.
 */
export function reactivaTras(
  previa: unknown, direccion: 'entrante' | 'saliente', ahoraMs: number,
): boolean {
  if (direccion !== 'entrante') return false;
  const p = typeof previa === 'object' && previa !== null ? (previa as Partial<Solicitud>) : null;
  if (!p) return false;
  const seguimientoMs = milisegundosDe(p.seguimientoEn);
  if (seguimientoMs === null) return false;
  if (milisegundosDe(p.reactivadaEn) !== null) return false;
  const transcurrido = ahoraMs - seguimientoMs;
  return transcurrido >= 0 && transcurrido < MS_VENTANA_ATENCION;
}

/** Forma que exige un identificador de comercio. Se comprueba ANTES de armar
 *  ninguna ruta con él: `tenantId` viene de un documento, y un documento con un
 *  valor raro no debe poder desviar una escritura a otra parte del árbol. */
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

/**
 * Estado del comercio, leído de SU FICHA y no de la copia propagada en la ruta.
 *
 * POR QUÉ NO SE USA `ruta.estado`, que ya viene resuelto y saldría gratis. Esa
 * copia la mantiene `marcarRutasDelTenant`, que hoy corre al SUSPENDER y al
 * REACTIVAR, pero NO al dar de baja: una ruta de un comercio dado de baja sigue
 * diciendo `activo`. Leer la ficha cuesta una lectura más y es la única fuente
 * que no puede quedar desfasada. Acá se guardan datos personales de clientes
 * finales, así que el lado seguro del error es dejar de guardarlos.
 */
async function estadoDelComercio(tenantId: string): Promise<string> {
  const tenant = await getFirestore().doc(`tenants/${tenantId}`).get();
  return String(tenant.get('estado') ?? 'desconocido');
}

/**
 * Enmascara un teléfono para la bitácora: `59170000001` -> `5917****001`.
 *
 * La regla de Firestore EXIGE el patrón con asteriscos, así que un número
 * completo se rechaza en el servidor. Esta función existe para que el camino
 * correcto sea el fácil, no para ser la única defensa: la diferencia entre
 * «acordarse de enmascarar» y no poder no hacerlo.
 */
export function enmascarar(telefono: unknown): string {
  const t = typeof telefono === 'string' ? telefono.replace(/[^0-9]/g, '') : '';
  if (t.length < 7) return '****';
  return `${t.slice(0, 4)}****${t.slice(-3)}`;
}

/**
 * Los ÚLTIMOS CUATRO dígitos del teléfono, y nada más. Es lo único del cliente
 * final que puede viajar al registro de ejecución (Cloud Logging).
 *
 * POR QUÉ NO SE REUSA `enmascarar()`, que ya existe. Esa función es para la
 * BITÁCORA del comercio, cuya regla EXIGE el patrón `5917****001`, o sea el
 * prefijo más los últimos tres: siete dígitos. Cloud Logging es otra cosa —lo
 * lee NovuChat, no el comercio, y se retiene por meses— así que ahí va MENOS,
 * no lo mismo: cuatro dígitos alcanzan para reconocer dos renglones de la misma
 * conversación en una investigación y no alcanzan para reconstruir el número.
 * Un número boliviano tiene ocho dígitos: con el prefijo y los últimos tres ya
 * quedarían solo dos por adivinar.
 */
export function ultimos4(telefono: unknown): string {
  const t = typeof telefono === 'string' ? telefono.replace(/[^0-9]/g, '') : '';
  return t.length < 4 ? '****' : t.slice(-4);
}

/**
 * ===========================================================================
 * REGISTRO DE EJECUCIÓN CON EL COMERCIO ADENTRO — tráfico y costo por cliente
 * ===========================================================================
 *
 * EL PROBLEMA, del 17/09/2026. La pregunta «cuánto tráfico y cuánto costo
 * generó cada cliente» no se podía contestar mirando los registros: las dos
 * Functions que atienden a n8n escribían solo lo que imprime el envoltorio de
 * Cloud Run —método, ruta, latencia—, sin decir de qué comercio era el mensaje.
 * Con un flujo por cliente y un número por flujo, la única forma de atribuir
 * era leer Firestore comercio por comercio.
 *
 * Desde ahora cada ejecución deja UN renglón estructurado. `logger.info` con un
 * objeto y no texto concatenado: en Cloud Logging el objeto queda en
 * `jsonPayload` y se puede filtrar y agrupar por campo. Un texto armado con
 * plantillas obliga a expresiones regulares sobre el mensaje, que es
 * exactamente lo que hace que nadie consulte los registros.
 *
 * NO CUESTA NI UN MENSAJE MÁS. Un renglón de registro no envía nada por
 * WhatsApp: el cambio agrega CERO mensajes por conversación (CLAUDE.md, base
 * comercial §1, que obliga a declararlo).
 *
 * QUÉ CONSULTAS CONTESTA (Cloud Logging, `jsonPayload.…`):
 *
 *   MENSAJES DEL ASISTENTE EN EL MES POR COMERCIO — la cifra que predice la
 *   factura de Meta y que la consola todavía no muestra (base comercial §4):
 *     evento="ingesta_mensaje" AND direccion="saliente"  → agrupar por tenantId
 *   y contrastarla con los 1.000 mensajes gratis del número de cada comercio.
 *
 *   CONVERSACIONES FACTURADAS POR COMERCIO — la unidad de cobro:
 *     evento="ingesta_mensaje" AND conversacion=true     → agrupar por tenantId
 *   y, dentro de esas, `bloqueNuevo=true` son las que vinieron de exceder las
 *   25 respuestas de una misma ventana.
 *
 *   MENSAJES POR CONVERSACIÓN COMO DISTRIBUCIÓN, no como promedio (§4):
 *     el histograma de `mensajesVentana` sobre los salientes.
 *
 *   TURNOS QUE COSTARON MODELO PERO NO TERMINARON EN MENSAJE:
 *     `configuracion_flujo` por comercio contra `ingesta_mensaje` saliente.
 *
 * QUÉ NO VA, Y POR QUÉ ESOS CAMPOS Y NO OTROS. Cada campo está porque alguna de
 * esas preguntas lo necesita para agrupar o para medir. NUNCA el texto del
 * mensaje, el teléfono completo, el nombre del contacto, el identificador de
 * conversación (`wa_<telefono>`, que ES el teléfono), el `phoneNumberId` del
 * comercio ni ningún secreto: el registro es para contar, no para leer
 * conversaciones, y vale el mismo criterio que la bitácora —si llevara el
 * contenido sería una puerta trasera a lo que T-5 impide—. El teléfono va solo
 * por sus últimos cuatro dígitos (`ultimos4`).
 */
const EVENTO_INGESTA = 'ingesta_mensaje';
const EVENTO_CONFIGURACION = 'configuracion_flujo';

/**
 * ===========================================================================
 * LA SEÑA, COMO LA RECIBE EL FLUJO DE RESERVAS (`configuracionFlujo.sena`)
 * ===========================================================================
 *
 * `activa` exige LAS DOS cosas: un importe mayor que cero en
 * `config/agendamiento` Y el QR del comercio registrado y encendido
 * (`cobroReal`, el mismo criterio que el cobro real de venta: activo, con
 * ficha y con código). Un importe sin QR no puede cobrar; un QR sin importe no
 * tiene qué cobrar. En cualquiera de los dos casos el flujo agenda como
 * siempre, sin seña, y no manda ningún mensaje de más.
 *
 * Cuando NO está activa se devuelve igual el objeto, con `importe` 0 y
 * `qr` nulo, y no `null`: así el flujo distingue «este comercio no cobra
 * seña» de «el panel no contestó», que es lo que lo manda al respaldo.
 *
 * `pendiente`, `evento` y `qrEnviadoEn` son de la SOLICITUD del teléfono que
 * escribió, si el flujo mandó `telefono`: le dicen si el próximo archivo se
 * lee como comprobante y qué cita está retenida. Sin teléfono, van vacíos.
 */
export const MINUTOS_RETENCION_POR_DEFECTO = 30;
export const IMPORTE_SENA_MAXIMO = 10000;

/** Un día, en minutos: la ventana en la que un pago tardío sigue siendo ESTE caso. */
const MINUTOS_DE_UN_DIA = 24 * 60;

export interface SenaParaElFlujo {
  activa: boolean;
  importe: number;
  moneda: string;
  minutosRetencion: number;
  qr: { url: string; nombreCuenta: string; banco: string } | null;
  pendiente: boolean;
  evento: { id: string; calendario: string } | null;
  qrEnviadoEn: string | null;
  /**
   * MINUTOS DESDE QUE SE LIBERÓ EL HORARIO por falta de pago, o `null`.
   *
   * Existe por un caso que solo aparece con dinero de por medio (19/09/2026):
   * el paciente no paga a tiempo, el horario se libera, y DESPUÉS paga. Hasta
   * ahora el flujo no distinguía eso de un comprobante caído del cielo y le
   * preguntaba «¿a qué corresponde?», que es lo peor que se le puede decir a
   * alguien que acaba de pagar lo que el asistente le pidió. Con esto el flujo
   * sabe que hubo una seña de ESE teléfono que venció recién, y puede decir la
   * verdad: llegó el comprobante, el horario ya se había liberado, lo resuelve
   * una persona. La ventana es de un día: más allá, es otra conversación.
   */
  vencidaHaceMin: number | null;
  /** El adelanto a favor vigente de este teléfono (Andres, 21/09/2026), o `null`. */
  aFavor: { hasta: string } | null;
}

export function senaParaElFlujo(
  agendamiento: Record<string, unknown> | undefined,
  cobroRealActivo: boolean,
  moneda: string,
  urlDelQr: (ficha: string) => string,
  solicitud: unknown,
): SenaParaElFlujo {
  const importeCrudo = agendamiento?.['senaImporte'];
  const importe = typeof importeCrudo === 'number' && Number.isInteger(importeCrudo)
    && importeCrudo > 0 && importeCrudo <= IMPORTE_SENA_MAXIMO ? importeCrudo : 0;
  const minutosCrudo = agendamiento?.['senaMinutosRetencion'];
  const minutosRetencion = typeof minutosCrudo === 'number' && Number.isInteger(minutosCrudo)
    && minutosCrudo >= 5 && minutosCrudo <= 180 ? minutosCrudo : MINUTOS_RETENCION_POR_DEFECTO;
  const cobroReal = (agendamiento?.['cobroReal'] ?? {}) as Record<string, unknown>;
  const activa = importe > 0 && cobroRealActivo;

  const s = (typeof solicitud === 'object' && solicitud !== null ? solicitud : {}) as Record<string, unknown>;
  const ev = s['evento'] as Record<string, unknown> | null | undefined;
  const enviado = s['qrEnviadoEn'] as { toMillis?: () => number } | null | undefined;
  const porReloj = senaVencidaPorTiempo(s, minutosRetencion, Date.now());
  return {
    activa,
    importe: activa ? importe : 0,
    moneda,
    minutosRetencion,
    qr: activa
      ? {
          // La imagen no viaja: viaja su dirección pública, que el flujo pone
          // tal cual en el `link` del mensaje de imagen de WhatsApp.
          url: urlDelQr(String(cobroReal['ficha'] ?? '')),
          nombreCuenta: String(cobroReal['nombreCuenta'] ?? ''),
          banco: String(cobroReal['banco'] ?? ''),
        }
      : null,
    // PENDIENTE ES POR ETAPA Y POR RELOJ (20/09/2026): una seña cuyo plazo pasó
    // ya no está pendiente aunque el calendario no la haya vencido todavía
    // (`retencion.ts`, `senaVencidaPorTiempo`).
    pendiente: s['etapa'] === 'qr_enviado' && !porReloj.vencida,
    evento: ev && typeof ev['id'] === 'string' && ev['id'] !== ''
      ? { id: ev['id'], calendario: String(ev['calendario'] ?? '') } : null,
    qrEnviadoEn: typeof enviado?.toMillis === 'function'
      ? new Date(enviado.toMillis()).toISOString() : null,
    vencidaHaceMin: (() => {
      // Vencida por el calendario (etapa) o por el reloj: en los dos casos el
      // flujo tiene que tratar un comprobante que llega como pago TARDÍO.
      let desdeMs: number | null = null;
      if (s['etapa'] === 'vencida') {
        const desde = s['desde'] as { toMillis?: () => number } | null | undefined;
        desdeMs = typeof desde?.toMillis === 'function' ? desde.toMillis() : null;
      } else if (porReloj.vencida) {
        desdeMs = porReloj.venceMs;
      }
      if (desdeMs === null) return null;
      const min = Math.floor((Date.now() - desdeMs) / 60000);
      return min >= 0 && min <= MINUTOS_DE_UN_DIA ? min : null;
    })(),
    aFavor: (() => {
      if (s['etapa'] !== 'a_favor') return null;
      const hasta = milisegundosDe(s['aFavorHasta']);
      return hasta !== null && Date.now() < hasta ? { hasta: new Date(hasta).toISOString() } : null;
    })(),
  };
}

type TipoEvento =
  | 'mensaje_entrante' | 'mensaje_saliente' | 'plantilla_enviada'
  | 'cita_agendada' | 'cita_rechazada' | 'cobro_simulado'
  | 'transferencia_humano' | 'config_publicada' | 'suspension'
  | 'reactivacion' | 'error_flujo' | 'entrada_descartada'
  // CATÁLOGO WEB. Dos eventos, y los dos hacen falta para poder contestar la
  // pregunta que un comercio va a hacer tarde o temprano: «mandé el enlace y no
  // me llegó ningún pedido, ¿se rompió?». Con solo uno de los dos no se puede
  // distinguir «nunca se derivó a nadie» de «se derivó y nadie compró».
  | 'catalogo_enlace' | 'carrito_recibido'
  // UMBRALES DE ATENCIÓN (`Analisis/27` §5). Una ventana que pasó al operador
  // por uso extendido, y una que llegó al bloqueo. Quedan en la bitácora del
  // comercio porque son el hecho que explica un reclamo: «el asistente dejó de
  // contestarle a mi cliente».
  | 'derivacion_operador' | 'bloqueo_ventana'
  // AVISO DE CONSUMO (15/09/2026): las conversaciones del mes llegaron al 80 %
  // de las incluidas en el plan. Una vez por mes. No manda ningún WhatsApp.
  | 'aviso_consumo'
  // SEÑA POR QR (bloque 2, 17/09). Llegó un comprobante y el servidor lo
  // cotejó —`codigo` lleva el resultado: cuadra, no_cuadra, ilegible— y una
  // retención que venció sin comprobante, cuya cita el flujo borró. Los
  // escribe `sena.ts`. Son el hecho que explica «mandé el comprobante y me
  // dijeron que no coincidía» y «mi horario desapareció».
  | 'cobro_cotejado' | 'sena_vencida'
  // SEGUIMIENTO DE SOLICITUD PENDIENTE (bloque 4, `Analisis/31` §4): salió el
  // recordatorio único a un paciente que recibió horarios o el QR y no
  // siguió. `codigo` lleva el modo (`texto` en ventana, `plantilla` fuera).
  // Lo escribe `seguimientos.ts`. Explica «me llegó un mensaje que no pedí».
  //
  // NINGÚN PUNTO Y COMA EN ESTOS COMENTARIOS. `pruebas/bitacora-tipos.test.ts`
  // lee esta unión hasta el primero que encuentra, así que uno escrito acá
  // arriba corta la lista y deja tipos fuera del control que compara la
  // ingesta con las reglas y con la consola. Costó una corrida el 17/09.
  | 'seguimiento_enviado'
  // PREPAGO (bloques A-0 y A-2, 20/09, `DISENO.md` §4undecies): el servicio se
  // cortó por falta de pago o de conversaciones (`codigo` lleva el motivo),
  // volvió, y entró un pago. El corte y la reanudación los escribe la ingesta, y
  // el pago lo escriben `cobroPrepago.ts` y el camino manual, con `codigo` = quién
  // confirmó (`banco` o `propietario`). En modo observación no sale `corte_servicio`: el
  // corte observado va a la auditoría, no a la bitácora que lee el comercio.
  | 'corte_servicio' | 'reanudacion_servicio' | 'pago_registrado';

interface Evento {
  tipo: TipoEvento;
  resultado: 'ok' | 'fallo' | 'rechazado' | 'reintento';
  canal?: 'whatsapp' | 'panel' | 'sistema';
  telefono?: string;
  conversacionId?: string;
  codigo?: string;
  detalle?: string;
  tamanoTexto?: number;
  latenciaMs?: number;
}

/**
 * Escribe un evento en la bitácora del comercio.
 *
 * NUNCA EL TEXTO DEL MENSAJE. Solo metadatos. El motivo está en la cabecera de
 * la colección en `firestore.rules`: si la bitácora llevara el contenido, sería
 * una puerta trasera a lo que T-5 impide — el propietario de NovuChat leyendo
 * conversaciones de todos los comercios sin ninguna ventana de soporte.
 * `tamanoTexto` da la magnitud sin dar el contenido.
 *
 * NO FALLA LA OPERACIÓN. Si la bitácora no se puede escribir, se registra en el
 * log y se sigue: perder un renglón de evidencia es malo, pero no atender a un
 * cliente por eso es peor. La bitácora observa el sistema, no lo gobierna.
 */
export async function registrar(tenantId: string, evento: Evento): Promise<void> {
  try {
    await getFirestore().collection(`tenants/${tenantId}/bitacora`).add({
      ts: Timestamp.now(),
      tipo: evento.tipo,
      resultado: evento.resultado,
      canal: evento.canal ?? 'whatsapp',
      ...(evento.telefono ? { destinoEnmascarado: enmascarar(evento.telefono) } : {}),
      ...(evento.conversacionId ? { conversacionId: evento.conversacionId.slice(0, 80) } : {}),
      ...(evento.codigo ? { codigo: String(evento.codigo).slice(0, 24) } : {}),
      ...(evento.detalle ? { detalle: evento.detalle.slice(0, 120) } : {}),
      ...(typeof evento.tamanoTexto === 'number'
        ? { tamanoTexto: Math.max(0, Math.min(100000, Math.trunc(evento.tamanoTexto))) } : {}),
      ...(typeof evento.latenciaMs === 'number'
        ? { latenciaMs: Math.max(0, Math.min(600000, Math.trunc(evento.latenciaMs))) } : {}),
    });
  } catch {
    console.error(`No se pudo registrar en la bitacora de ${tenantId}: ${evento.tipo}`);
  }
}

/**
 * ===========================================================================
 * ATENCIONES E INTERACCIONES — dos de las tres cifras de la oferta comercial
 * ===========================================================================
 *
 * Las definiciones son las de `web/src/paginas/Cierres.tsx` y no se
 * reinterpretan acá:
 *
 *   ATENCIÓN     una conversación iniciada con un cliente. Cuenta el arranque,
 *                haya terminado bien o no.
 *   INTERACCIÓN  una conversación en la que el cliente recibió MÁS DE UNA
 *                respuesta. Mide las que pasaron de un saludo suelto a un ida y
 *                vuelta de verdad.
 *
 * POR QUÉ ESTA FUNCIÓN ES PURA Y NO TOCA FIRESTORE. Sobre estos números se
 * factura, así que un incremento de más es cobrarle de más a un cliente. La
 * decisión de sumar o no sumar es lo único que puede equivocarse, y separada de
 * la base se puede probar exhaustivamente sin emulador ni red: la suite recorre
 * el mes entero de una conversación mensaje por mensaje. Quien la llama solo
 * aplica lo que esta función decidió, dentro de la transacción.
 *
 * LA DEDUPLICACIÓN, que es la parte difícil. Un `FieldValue.increment(1)` no
 * sabe deduplicar: cuenta mensajes. Se usa la misma clase de marca que ya
 * resolvía `personasAtendidas` —un campo en el documento de la conversación, que
 * ya está indexado por teléfono y ya se escribe en cada mensaje—, con una marca
 * por cifra:
 *
 *   `periodoContado`       último período en que esta conversación ya sumó su
 *                          atención. Si no es el actual, es el primer mensaje
 *                          del mes: suma UNA atención y se actualiza la marca.
 *   `respuestasDelPeriodo` cuántas respuestas salientes lleva la conversación en
 *                          el período. Arranca de cero al cambiar de mes.
 *   `periodoInteraccion`   último período en que esta conversación ya sumó su
 *                          interacción. Se pone al llegar a la SEGUNDA
 *                          respuesta, y por eso la tercera y la cuarta no suman
 *                          nada: es exactamente el caso que cobraría de más.
 *
 * POR QUÉ `personasAtendidas` Y `atenciones` COMPARTEN LA MARCA. Hoy disparan
 * con el mismo hecho —el primer mensaje del período en una conversación cuyo
 * identificador ES el teléfono (`wa_<telefono>`)—, así que una persona y una
 * conversación son la misma cosa y dos marcas idénticas solo podrían
 * desincronizarse. Si algún día una persona pudiera tener más de una
 * conversación abierta, las dos cifras dejarían de coincidir y ahí sí harían
 * falta dos marcas: es el momento de partir esto, y no antes.
 *
 * NO SE CREA NINGÚN REGISTRO NUEVO DE TELÉFONOS y no se agrega ni una lectura:
 * los tres campos viajan en el documento que la transacción ya leía y ya
 * escribía. El costo de las dos cifras nuevas es cero lecturas y cero
 * escrituras extra, salvo el documento de métricas que ya se escribía igual.
 */
export interface MarcasDeConteo {
  periodoContado?: unknown;
  respuestasDelPeriodo?: unknown;
  periodoInteraccion?: unknown;
  /**
   * Cuándo EMPEZÓ la atención vigente. Es el ancla de la ventana de 24 horas,
   * no la marca del último mensaje.
   *
   * La diferencia con medir el silencio entre mensajes es la que decidió
   * Andres, y cambia la factura: con el ancla, una conversación que se estira
   * todo el día es UNA atención por más idas y vueltas que tenga, y a las 24
   * horas de haber empezado se renueva. Con el silencio, en cambio, una charla
   * larga con pausas se habría partido en varias.
   */
  atencionDesde?: { toMillis?: () => number } | unknown;
  /**
   * Respuestas del asistente enviadas dentro de la ventana vigente. Es lo que
   * decide cuándo empieza un bloque nuevo (`RESPUESTAS_POR_CONVERSACION`).
   * Vuelve a cero cuando un mensaje del cliente abre una ventana nueva; no se
   * toca en ningún otro caso. Mismo nombre que en la rama del prepago, para
   * que al reaplicarla el dato ya esté escrito.
   */
  mensajesVentana?: unknown;
  /**
   * Último estado de atención que la ingesta dejó anotado (`normal`,
   * `operador`, `bloqueado`). Es la marca que evita avisar dos veces a
   * recepción por el mismo umbral en la misma ventana. Ver `atencion.ts`.
   */
  atencionEstado?: unknown;
  /**
   * De dónde nació la VENTANA vigente (`ORIGENES`). Se escribe al abrirla y no
   * se vuelve a tocar: el segundo mensaje de una conversación no trae
   * `referral` —Meta lo manda solo en el primero—, así que refrescarlo con
   * cada mensaje convertiría en `directo` a toda conversación que vino de un
   * anuncio. Es el mismo motivo por el que `atencionDesde` tampoco se refresca.
   */
  origen?: unknown;
}

/**
 * CUÁNTAS RESPUESTAS DEL ASISTENTE ENTRAN EN UNA CONVERSACIÓN.
 *
 * Decidido por Andres el 13/09/2026 (`Analisis/27`): la conversación es un
 * BLOQUE de hasta 25 respuestas del asistente a un mismo teléfono dentro de la
 * ventana de 24 horas. La respuesta 26 abre un bloque nuevo y se factura OTRA
 * conversación; a las 24 horas la ventana se renueva y el conteo vuelve a
 * cero. Un cliente con 26 respuestas en el día son dos conversaciones; uno con
 * 20 hoy y 2 mañana, también dos —pero por dos ventanas, no por el bloque—.
 *
 * Reemplaza al tope de 25 con corte: el asistente ya no deja de responder al
 * llegar a 25, sigue, y lo que sigue se cobra. El costo de un bloque lleno es
 * el mismo que tenía una conversación en el tope (0,3051 USD), así que el
 * precio mínimo de la bolsa de `Analisis/23` no cambia.
 *
 * ES UN VALOR COMERCIAL: subirlo cobra menos y bajarlo cobra más. Se cambia
 * con Andres y Silvana, junto con la «Base comercial» de `CLAUDE.md` y con
 * `novuchat.site/precios`, que lo publica. El número vive en `atencion.ts`,
 * junto con los umbrales de corte que lo acompañan (`UMBRALES_ATENCION`).
 */

/**
 * SEPARACIÓN ENTRE UNA ATENCIÓN Y LA SIGUIENTE.
 *
 * Una ATENCIÓN es un inicio de flujo, no una persona ni un mes: el mismo
 * teléfono que consulta tres veces son TRES atenciones y UNA persona atendida.
 * Pero WhatsApp no marca dónde termina una consulta y empieza otra —no hay
 * "colgar"—, así que el corte lo tiene que poner el sistema, y el único dato
 * disponible es el silencio entre mensajes.
 *
 * VEINTICUATRO HORAS DESDE LA PRIMERA INTERACCIÓN, decidido por Andres.
 *
 * Una atención se abre con la primera consulta del cliente y dura un día
 * entero: todo lo que pase dentro de esa ventana es la misma atención, y
 * recién el mensaje que llega pasadas las 24 horas abre otra.
 *
 * No es un número arbitrario: es exactamente la ventana de atención al cliente
 * de WhatsApp, la misma con la que Meta factura sus conversaciones. Que
 * nuestra unidad coincida con la suya hace que la factura que recibimos y la
 * que emitimos se puedan comparar renglón por renglón, en vez de tener que
 * explicar por qué no coinciden.
 *
 * ES UN VALOR COMERCIAL: subirlo cobra menos y bajarlo cobra más, así que se
 * cambia con Andres y no en una revisión de código. Vive en `atencion.ts`.
 */

/**
 * ¿Este mensaje es SOLO una cortesía?
 *
 * Un «gracias» o un «ok» después del recordatorio no es una consulta: el
 * cliente no vino a pedir nada, está acusando recibo. Contarlo abriría una
 * atención por cada persona educada, y encima justamente por un mensaje que
 * provocamos nosotros. Sería cobrar por nuestra propia notificación.
 *
 * EL RIESGO DE ESTO ES PASARSE, no quedarse corto. Si el filtro fuera amplio se
 * tragaría consultas reales y cobraríamos de menos sin enterarnos, que es un
 * error invisible. Por eso es deliberadamente estrecho: el mensaje entero,
 * quitados los emojis y los signos, tiene que ser UNA de estas fórmulas. Basta
 * que agregue cualquier otra cosa —«gracias, quiero otra cita»— para que cuente
 * como atención.
 */
const CORTESIAS = new Set([
  'gracias', 'muchas gracias', 'mil gracias', 'gracias!', 'graciass',
  'ok', 'oka', 'okey', 'okay', 'listo', 'listo gracias', 'perfecto',
  'perfecto gracias', 'dale', 'bueno', 'buenisimo', 'excelente', 'genial',
  'de nada', 'ya', 'ya esta', 'entendido', 'enterado', 'copiado',
  'si', 'no', 'confirmado', 'buenas', 'saludos', 'chau', 'adios', 'hasta luego',
  'ok gracias', 'ok listo', 'muy bien', 'barbaro', 'joya',
]);

export function esCortesia(texto: string): boolean {
  const limpio = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')          // tildes
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')        // emojis, signos y puntuación
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Un mensaje vacío tras la limpieza es un emoji suelto: un pulgar arriba.
  if (limpio === '') return true;
  // Corte por largo antes de mirar el diccionario: una consulta de verdad no
  // entra en veinticinco caracteres, y esto evita que una frase larga que
  // empiece con «gracias» se cuele por alguna coincidencia.
  if (limpio.length > 25) return false;
  return CORTESIAS.has(limpio);
}

export interface Conteo {
  /** ¿Este mensaje abre una atención nueva? (inicio de flujo) */
  atencion: boolean;
  /** ¿Es un mensaje del cliente con contenido, y no una cortesía? */
  esConsulta: boolean;
  /** ¿Es la primera vez que esta persona escribe en el período? */
  personaNueva: boolean;
  /** ¿Con este mensaje el cliente llega a su segunda respuesta del período? */
  interaccion: boolean;
  /** Valor que hay que dejar guardado en la conversación. */
  respuestasDelPeriodo: number;
  /**
   * Respuestas del asistente en la ventana vigente, ya contando este mensaje.
   * Se guarda tal cual. Cero al abrir una ventana nueva.
   */
  mensajesVentana: number;
  /**
   * ¿Esta respuesta es la primera de un bloque nuevo dentro de la ventana
   * vigente? Ocurre con la respuesta 26, la 51, la 76… Solo un mensaje
   * SALIENTE puede abrir un bloque, y solo dentro de una ventana abierta: una
   * respuesta sobre una ventana vencida —un recordatorio, la respuesta a una
   * cortesía tardía— no abre nada, igual que no abre una atención.
   */
  bloqueNuevo: boolean;
  /**
   * ¿Este mensaje suma UNA conversación facturada? Es `atencion || bloqueNuevo`:
   * la ventana que se abre y cada bloque de 25 que se excede. Es lo único que
   * mueve el contador `conversaciones` del agregado del mes.
   */
  conversacion: boolean;
}

/**
 * Decide qué contadores mueve UN mensaje, a partir de las marcas que trae la
 * conversación. `marcas` es lo que hay guardado; todo lo demás se deriva.
 */
export function contadoresDelMensaje(
  marcas: MarcasDeConteo,
  periodo: string,
  direccion: 'entrante' | 'saliente',
  ahoraMs: number = Date.now(),
  texto = '',
): Conteo {
  const mismoPeriodo = marcas.periodoContado === periodo;

  // PERSONA ATENDIDA y ATENCIÓN son cifras distintas y se cuentan distinto.
  // Un teléfono que consulta tres veces es UNA persona atendida y TRES
  // atenciones, siempre que esas tres veces caigan en ventanas distintas.
  // Sin ancla es la primera consulta de esta conversación, así que abre. Una
  // sola definición de la ventana, en `atencion.ts`: tenerla dos veces es
  // pedir que un día el bloque corte con un criterio y los umbrales con otro.
  const vencida = ventanaVencida(marcas, ahoraMs);

  // Solo un mensaje ENTRANTE abre una atención. Una respuesta nuestra no inicia
  // nada: si contara, un recordatorio saliente inventaría una consulta que el
  // cliente nunca hizo, y eso es cobrar por algo que no ocurrió.
  // Una cortesía no abre nada: ver `esCortesia`.
  const consulta = direccion === 'entrante' && !esCortesia(texto);
  const atencion = consulta && vencida;

  // Al cambiar de mes el contador de respuestas vuelve a cero: la definición es
  // POR PERÍODO, y arrastrar el saldo del mes anterior haría que la primera
  // respuesta de enero cobrara la interacción de diciembre.
  const guardadas = marcas.respuestasDelPeriodo;
  const previas = mismoPeriodo && typeof guardadas === 'number' && Number.isFinite(guardadas)
    ? Math.max(0, Math.trunc(guardadas))
    : 0;
  const respuestasDelPeriodo = previas + (direccion === 'saliente' ? 1 : 0);

  // RESPUESTAS EN LA VENTANA, para el bloque. Se reinicia SOLO cuando este
  // mensaje abre una atención nueva. Si la ventana venció pero este mensaje no
  // abre (una cortesía, o una respuesta nuestra sobre una ventana vieja), el
  // contador viejo se descarta igual: lo que se mida contra el bloque es
  // siempre de la ventana vigente, nunca de la de ayer.
  const guardadoVentana = marcas.mensajesVentana;
  const previasVentana = !vencida && typeof guardadoVentana === 'number'
    && Number.isFinite(guardadoVentana)
    ? Math.max(0, Math.trunc(guardadoVentana))
    : 0;
  const mensajesVentana = atencion ? 0 : previasVentana + (direccion === 'saliente' ? 1 : 0);

  // EL BLOQUE NUEVO. La respuesta que hace 26 (o 51, o 76…) dentro de una
  // ventana abierta se factura como otra conversación. Se mira `previasVentana`
  // y no el valor guardado crudo: sobre una ventana vencida `previasVentana`
  // es cero y ninguna respuesta abre bloque, que es lo correcto, porque sin
  // consulta del cliente no hay conversación que cobrar. El `%` y no `===`
  // cubre el bloque tercero y los siguientes con la misma regla.
  const bloqueNuevo = direccion === 'saliente' && !vencida
    && previasVentana > 0 && previasVentana % RESPUESTAS_POR_CONVERSACION === 0;

  return {
    atencion,
    mensajesVentana,
    bloqueNuevo,
    conversacion: atencion || bloqueNuevo,
    /**
     * Una cortesía tampoco mueve la marca de silencio. Si la moviera, un
     * «gracias» dejaría la conversación como recién activa y la consulta de
     * verdad que llegara una hora después NO se contaría — el filtro terminaría
     * haciendo perder atenciones en vez de evitar las falsas.
     */
    esConsulta: consulta,
    personaNueva: !mismoPeriodo,
    // La marca manda sobre el conteo. Que `respuestasDelPeriodo` llegue a tres o
    // a treinta no vuelve a sumar: la interacción ya está anotada en este
    // período. El `>= 2` y no `== 2` es para que un recuento manual o un
    // arreglo de datos que dejara el contador adelantado tampoco se pierda la
    // interacción; la marca sigue impidiendo que se cuente dos veces.
    interaccion: marcas.periodoInteraccion !== periodo && respuestasDelPeriodo >= 2,
    respuestasDelPeriodo,
  };
}

// INSTANCIAS MÍNIMAS POR AMBIENTE (26/09/2026). Las dos Functions que el flujo
// llama en serie tienen una instancia siempre despierta en producción (decisión
// de Andres del 15/09, ver abajo). En staging esa instancia cuesta lo mismo
// (~8,1 USD al mes cada una) para un ambiente sin tráfico: tres veces su
// presupuesto. Por eso es un parámetro, con valor por defecto 1: el job
// `desplegar-produccion` escribe INSTANCIAS_MINIMAS=1 y `desplegar-staging`,
// INSTANCIAS_MINIMAS=0 (con --non-interactive, firebase-tools no usa el valor
// por defecto de un parámetro ausente: falla). `instancias-minimas.test.ts`
// vigila las dos mitades.
const INSTANCIAS_MINIMAS = defineInt('INSTANCIAS_MINIMAS', { default: 1 });

export const ingesta = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Sin CORS: este endpoint es servidor a servidor. Que un navegador no pueda
    // llamarlo elimina de raíz el abuso desde una página cualquiera.
    cors: false,
    maxInstances: 10,
    // UNA INSTANCIA SIEMPRE DESPIERTA (decisión de Andres, 15/09/2026). Sin ella,
    // el primer mensaje después de un rato sin tráfico esperaba el arranque en
    // frío de esta Function y de la otra que el flujo llama en serie
    // (`configuracionFlujo` → `ingesta`): 8 a 12 s de los ~20 que tardaba la
    // primera respuesta. Costo medido en el catálogo de Google (us-east1,
    // facturación por pedido, instancia mínima inactiva): 2,5e-6 USD por
    // vCPU·s y por GiB·s → ~8,1 USD al mes por Function con 1 vCPU y 256 MiB,
    // compartidos por todos los comercios. `pruebas/instancias-minimas.test.ts`
    // impide que se pierda sin querer.
    minInstances: INSTANCIAS_MINIMAS,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // RESOLUCIÓN NÚMERO → COMERCIO, EN UN SOLO PASO. La firma (o el token) se
    // verifica contra el secreto de ESE número y el comercio sale del índice
    // /rutasWhatsApp, NUNCA del cuerpo: aunque n8n mandara
    // `{"tenantId": "otro-negocio"}`, ese campo se ignora por completo.
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }

    const { tenantId } = ruta;
    // Un identificador con forma rara no arma ninguna ruta de escritura.
    if (!ID_TENANT.test(tenantId)) { respuesta.status(404).send('numero no asignado'); return; }

    const mensaje = normalizar(peticion.body);
    if (!mensaje) {
      // Entrada descartada: queda registrada para poder responder «nunca nos
      // llegó» con evidencia, sin guardar lo que vino.
      await registrar(tenantId, {
        tipo: 'entrada_descartada', resultado: 'rechazado',
        detalle: 'payload no valido',
      });
      respuesta.status(400).send('mensaje invalido'); return;
    }

    const db = getFirestore();

    // ESTADO DEL COMERCIO. Uno suspendido o dado de baja deja de acumular
    // conversaciones. No es solo la palanca de cobranza: es dejar de guardar
    // datos personales de terceros de un servicio que ya no se presta. El 409 le
    // dice a n8n que mande el mensaje de cortesía —neutro, sin revelar el motivo
    // comercial— y corte el turno.
    const estado = await estadoDelComercio(tenantId);
    if (estado !== 'activo') {
      // SE REGISTRA IGUAL. La bitácora admite escrituras con el comercio
      // suspendido justamente para esto: el tramo del corte de servicio es el
      // más conflictivo y es donde la evidencia no puede tener agujeros.
      await registrar(tenantId, {
        tipo: 'entrada_descartada', resultado: 'rechazado',
        telefono: mensaje.telefono, codigo: '409', detalle: estado,
      });
      respuesta.status(409).json({ estado });
      return;
    }

    // ACÁ HABÍA UN `createCustomToken` QUE NO SERVÍA PARA NADA, con un comentario
    // que decía que la escritura quedaba sujeta a firestore.rules «igual que la
    // del navegador». Era falso: el token se creaba, se descartaba, y las
    // escrituras de abajo van con el SDK Admin, que se salta las reglas por
    // definición. O sea que el comentario describía una garantía inexistente,
    // que es peor que no tener comentario.
    //
    // Además rompía el endpoint entero: la cuenta de servicio del entorno de
    // ejecución no tiene `iam.serviceAccounts.signBlob`, así que la llamada
    // lanzaba y devolvía 500 en TODOS los mensajes. Se descubrió probando la
    // ingesta de verdad, no leyendo el código.
    //
    // Lo que protege hoy: el tenant sale de la ruta autenticada y nunca del
    // cuerpo, y las reglas cubren a cualquier OTRO cliente. Que la ingesta
    // escriba sujeta a reglas es la Fase 2 de DISENO.md, y cuando se haga hay
    // que usar el token, no solo emitirlo.

    const idConversacion = `wa_${mensaje.telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);
    // 'aaaa-mm' en UTC. `periodoDe` (planes.ts) es la misma cuenta que usa la
    // consola para saber si el aviso de consumo es de este período.
    const periodo = periodoDe();
    const refMetricas = db.doc(`tenants/${tenantId}/metricas/${periodo}`);

    // -----------------------------------------------------------------------
    // CONTEO DE PERSONAS ATENDIDAS (ÚNICOS)
    //
    // EL PROBLEMA. `FieldValue.increment(1)` no sabe deduplicar: cuenta
    // mensajes, no personas. Una persona que escribe treinta veces en el mes
    // sumaría treinta.
    //
    // LO QUE NO SE HIZO, Y POR QUÉ. La solución de manual es un conjunto de
    // hashes de teléfono por período (`/metricas/{p}/vistos/{hash}`). Se
    // descartó por dos motivos:
    //
    //  a) PRIVACIDAD. Un hash de teléfono NO es anonimización. El espacio de
    //     números bolivianos es del orden de 10^8: enumerarlo entero y comparar
    //     hashes es cuestión de segundos en una laptop. Sin sal secreta, ese
    //     conjunto es una segunda copia de los teléfonos, disfrazada. Y con sal
    //     secreta hay que custodiar y rotar la sal, que es otro secreto más.
    //  b) COSTO Y BASURA. Crea un documento por persona y por mes que después
    //     hay que purgar.
    //
    // LO QUE SÍ SE HACE. Se aprovecha que el documento de la conversación YA
    // ESTÁ indexado por teléfono (`wa_<telefono>`) y YA SE ESCRIBE en cada
    // mensaje. Se le agrega un campo `periodoContado`. Si el período que trae no
    // es el actual, esta persona todavía no fue contada este mes: se incrementa
    // `personasAtendidas` y se actualiza la marca. Todo dentro de una
    // transacción, para que dos mensajes simultáneos de la misma persona no la
    // cuenten dos veces.
    //
    // LAS ATENCIONES Y LAS INTERACCIONES VIAJAN EN LA MISMA TRANSACCIÓN, con
    // marcas de la misma clase y por el mismo motivo. Quién decide qué se suma
    // está en `contadoresDelMensaje`, arriba, que es pura y está probada aparte.
    // Que las marcas y los contadores se muevan en una sola transacción es lo
    // que impide que queden desfasados: si se escribiera la marca y fallara el
    // contador, la conversación quedaría contada y la cifra que se factura, no.
    //
    // NO SE CREA NINGÚN REGISTRO NUEVO DE TELÉFONOS. Es minimización de datos:
    // se reutiliza el identificador personal que ya existía en vez de sembrar
    // una segunda copia en la colección de métricas.
    //
    // COSTO EN FIRESTORE, por mensaje entrante:
    //   +1 lectura   (el documento de la conversación, dentro de la transacción)
    //   +0 escrituras en el caso común (la conversación ya se escribía; solo se
    //      le agrega un campo)
    //   +1 escritura SOLO la primera vez que esa persona escribe en el mes
    //
    // Para un comercio con 500 mensajes/mes de 80 personas distintas: 500
    // lecturas y 80 escrituras extra al mes. A la tarifa de Firestore eso es del
    // orden de una milésima de dólar. El conteo exacto sale prácticamente gratis.
    //
    // RECUENTO. Si alguna vez hay que recalcular un período (por una corrección
    // o una disputa de factura), se recorre /conversaciones filtrando por
    // `ultimoEn` dentro del mes. Es caro pero puntual, y no exige haber guardado
    // ninguna estructura extra.
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // EL ESTADO DE ATENCIÓN VIAJA EN LA MISMA TRANSACCIÓN. Con la conversación
    // se lee `cuenta/estado` (los umbrales del comercio) y se decide en qué
    // estado queda el teléfono —normal, operador o bloqueado— con lo que YA se
    // envió. El estado se anota en la conversación: es la marca que permite
    // avisar a recepción una sola vez por umbral y por ventana. Una lectura
    // más por mensaje; a la tarifa de Firestore, nada.
    // -----------------------------------------------------------------------
    const refCuenta = db.doc(`tenants/${tenantId}/cuenta/estado`);
    // La bandera global del modo observación del prepago (`DISENO.md`
    // §4undecies.4). Se lee en la misma transacción, +1 lectura por mensaje:
    // más barato que un caché cuya invalidación habría que probar.
    const refPlataformaPrepago = db.doc('plataforma/prepago');
    const refAuditoria = db.collection(`tenants/${tenantId}/auditoria`);
    const ahoraMs = Date.now();

    const veredicto = await db.runTransaction(async (tx) => {
      const [conversacion, cuentaDoc, plataformaDoc] = await Promise.all([
        tx.get(refConversacion), tx.get(refCuenta), tx.get(refPlataformaPrepago),
      ]);
      const marcas = (conversacion.data() ?? {}) as MarcasDeConteo;
      const conteo = contadoresDelMensaje(marcas, periodo, mensaje.direccion, ahoraMs, mensaje.texto);

      // Se mira lo guardado ANTES de aplicar este mensaje: el estado describe
      // qué hacer con la consulta que acaba de llegar, no con la siguiente.
      const cuenta = cuentaDoc.data();
      const cuentaCruda = (cuenta ?? {}) as CuentaCruda;
      const umbrales = umbralesDeAtencion(cuenta);
      const atencion = estadoDeAtencion(marcas, umbrales, ahoraMs);
      const aviso = mensaje.direccion === 'entrante'
        ? avisoDeTransicion(marcas.atencionEstado, atencion.estado) : null;

      // AVISO DE CONSUMO AL 80 % (decisión de Andres, 15/09/2026). Cuando las
      // conversaciones del mes llegan al 80 % de las incluidas en el plan
      // (`cuenta.limites.conversaciones`, o las del plan si la cuenta es vieja,
      // `planes.ts`), se anota `avisoConsumo` en la cuenta UNA vez por mes. La
      // consola lo muestra; NO se manda ningún WhatsApp: 0 mensajes agregados.
      //
      // CUÁNTO CUESTA. La cuenta ya se leía en esta transacción (umbrales). El
      // agregado del mes no: se lee SOLO si este mensaje suma una conversación
      // Y (el aviso del mes todavía no salió O la cuenta tiene modalidad de
      // prepago, porque solo un mensaje que ABRIRÍA una conversación puede
      // chocar con `sin_conversaciones`). Para un demo es exactamente lo de
      // antes: una lectura por conversación facturada hasta el día del aviso.
      // Leerlo dentro de la transacción es lo que impide que dos conversaciones
      // simultáneas avisen (o corten) dos veces: la segunda se reintenta y ve
      // la marca.
      const conModalidad = modalidadDe(cuentaCruda) !== 'demostracion';
      const corteGuardado = corteDe(cuentaCruda);
      // Con un corte guardado también se lee: hay que saber con exactitud si
      // sigue vigente para borrarlo o no, y sin el agregado `sin_conversaciones`
      // no se puede juzgar.
      const necesitaMetricas = (conteo.conversacion
        && (avisoConsumoPendiente(cuenta, periodo) || conModalidad))
        || (conModalidad && corteGuardado !== null);
      const metricasDoc = necesitaMetricas ? await tx.get(refMetricas) : null;
      const previasDelMes = Number(metricasDoc?.get('conversaciones'));
      const avisoConsumo = metricasDoc
        ? avisoDeConsumo(cuenta, (Number.isFinite(previasDelMes) ? previasDelMes : 0) + 1, periodo)
        : null;

      // -------------------------------------------------------------------
      // EL PREPAGO (bloque A-0, `DISENO.md` §4undecies.3). Sin modalidad, o
      // en demostración, `servicio` es operativo, `rechazo` es nulo y nada de
      // este bloque escribe: los contadores son idénticos a los de hoy, y
      // `pruebas/prepago-ingesta.test.ts` lo exige negando.
      //
      // `sin_pago` rechaza todo; `sin_conversaciones` rechaza solo lo que
      // ABRIRÍA una conversación (una ventana ya abierta se atiende hasta el
      // final: ya se pagó). Y el rechazo SE APLICA solo si la bandera del modo
      // observación está encendida (`corteAplicable`): apagada, se calcula, se
      // anota con `aplicado: false`, se cuenta lo que se habría perdido, y se
      // atiende igual. Encenderla es una decisión de Andres.
      // -------------------------------------------------------------------
      const servicio: EstadoServicio = estadoDeServicio(cuentaCruda, consumidasDe(metricasDoc?.data()), ahoraMs);
      const aplica = corteAplicable(cuentaCruda, plataformaDoc.data());
      const rechazo: MotivoCorte | null = rechazoPorPrepago(servicio.motivo, conteo.atencion);
      const cortado = rechazo !== null && aplica;
      const derivados = () => {
        const d = camposDerivados(servicio, cuentaCruda);
        return {
          estadoPago: d.estadoPago, montoMensual: d.montoMensual, moneda: d.moneda,
          proximoVencimiento: d.proximoVencimientoMs === null
            ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs),
        };
      };
      // Lo que esta transacción decidió sobre el corte, para la bitácora de
      // afuera: `nuevo` = empezó (o cambió de modo) con este mensaje.
      const corte = { nuevo: false, aplicado: cortado, reanudado: false, motivo: rechazo };

      // CUENTA INCOHERENTE (período presente y mal formado): se atiende, y
      // queda en la auditoría UNA vez por cuenta, no por mensaje: la marca
      // `incoherencia` en la cuenta es lo que evita repetirla, y se borra sola
      // cuando el dato se corrige (si vuelve a romperse, vuelve a avisar).
      if (servicio.incoherente) {
        if (cuentaCruda.incoherencia === undefined) {
          const campos = periodosIncoherentes(cuentaCruda);
          tx.set(refCuenta, { incoherencia: { en: Timestamp.now(), campos } }, { merge: true });
          tx.create(refAuditoria.doc(), {
            accion: 'cuenta_incoherente', uid: 'ingesta', en: Timestamp.now(),
            modalidad: servicio.modalidad, campos,
          });
        }
      } else if (cuentaCruda.incoherencia !== undefined) {
        tx.set(refCuenta, { incoherencia: FieldValue.delete() }, { merge: true });
      }

      if (rechazo !== null) {
        // UN CORTE ES NUEVO si no había ninguno, si cambió el motivo, o si
        // cambió de observado a aplicado (o al revés): la fecha «desde» y las
        // pérdidas describen ESE corte. Al pasar de observación a corte real,
        // «desde» es ahora —desde ahora se deja de atender de verdad— y las
        // pérdidas observadas no se mezclan con las reales.
        const esNuevo = corteGuardado === null || corteGuardado.motivo !== rechazo
          || corteGuardado.aplicado !== aplica;
        const desdeMs = !esNuevo ? corteGuardado!.desdeMs
          : corteGuardado?.motivo === rechazo ? ahoraMs
          : (servicio.corteDesdeMs ?? ahoraMs);
        // PERDIDAS = teléfonos distintos que CONSULTARON durante este corte:
        // la marca `corteVisto` en la conversación (cero lecturas extra) hace
        // que cada teléfono cuente una vez por corte. MENSAJES PERDIDOS = cada
        // entrante.
        const yaVisto = conversacion.get('corteVisto') === desdeMs;
        const perdida = mensaje.direccion === 'entrante' && conteo.esConsulta && !yaVisto ? 1 : 0;
        const perdidoMsj = mensaje.direccion === 'entrante' ? 1 : 0;
        tx.set(refCuenta, {
          corte: esNuevo
            ? { motivo: rechazo, desde: Timestamp.fromMillis(desdeMs), aplicado: aplica,
                perdidas: perdida, mensajesPerdidos: perdidoMsj }
            : { perdidas: FieldValue.increment(perdida), mensajesPerdidos: FieldValue.increment(perdidoMsj) },
          ...derivados(),
        }, { merge: true });
        if (esNuevo) {
          // La auditoría la lee el propietario; en observación es la ÚNICA
          // constancia del corte (la bitácora, que lee el comercio, no recibe
          // un corte que no se aplicó).
          tx.create(refAuditoria.doc(), {
            accion: aplica ? 'corte_servicio' : 'corte_observado', uid: 'ingesta', en: Timestamp.now(),
            motivo: rechazo, desde: Timestamp.fromMillis(desdeMs), aplicado: aplica,
          });
        }
        corte.nuevo = esNuevo;
        // La marca del teléfono va en la conversación, se aplique o no el corte.
        tx.set(refConversacion, { corteVisto: desdeMs }, { merge: true });
      } else if (corteGuardado !== null && servicio.operativo) {
        // El servicio volvió a estar operativo (pagó, compró una bolsa, o
        // cambió el mes): el corte se borra. Se mira `servicio.operativo` y no
        // «no hubo rechazo»: un mensaje dentro de una ventana abierta no se
        // rechaza por `sin_conversaciones`, y no por eso el corte terminó. La
        // reanudación se avisa solo si el corte era real.
        tx.set(refCuenta, { corte: FieldValue.delete(), ...derivados() }, { merge: true });
        corte.reanudado = corteGuardado.aplicado;
      }

      // EL MENSAJE SE GUARDA SIEMPRE, también cortado: el comercio tiene que
      // ver QUIÉN le escribió mientras el asistente no atendía.
      const escribirMensaje = () => tx.create(refConversacion.collection('mensajes').doc(), {
        direccion: mensaje.direccion,
        tipo: mensaje.tipo,
        texto: mensaje.texto,
        ts: Timestamp.now(),
        ...(mensaje.idMeta ? { idMeta: mensaje.idMeta } : {}),
      });

      if (cortado) {
        // CORTE APLICADO: se escribe el mensaje y lo mínimo de la conversación
        // para listarla (quién y cuándo), y NINGÚN contador de facturación:
        // ni marcas de ventana, ni métricas, ni aviso. La respuesta a n8n es
        // 200 con `servicio.estado: 'cortado'`; el 409 de esta Function
        // significa «ficha no activa», que es otra cosa.
        tx.set(refConversacion, {
          telefono: mensaje.telefono,
          canal: 'whatsapp',
          ultimoMensaje: mensaje.texto.slice(0, 300),
          ultimoEn: FieldValue.serverTimestamp(),
          ...(mensaje.nombreContacto ? { nombreContacto: mensaje.nombreContacto } : {}),
        }, { merge: true });
        escribirMensaje();
        return { atencion, aviso: null, avisoConsumo: null, conteo, servicio, corte, cortado: true, conModalidad };
      }

      // LA BOLSA (§4undecies.3, punto 6): abrir una conversación con las
      // incluidas agotadas descuenta una de la bolsa (o de la de prueba), y si
      // con esta se acaba el saldo, el corte por conversaciones queda anotado
      // desde ya —este mensaje SÍ se atiende—. Solo con modalidad.
      if (conteo.atencion && conModalidad) {
        const consumo = consumoDeConversacion(servicio);
        if (consumo.campoBolsa) {
          tx.set(refCuenta, { [consumo.campoBolsa]: FieldValue.increment(-1) }, { merge: true });
        }
        if (consumo.cortaDespues && corteGuardado?.motivo !== 'sin_conversaciones') {
          tx.set(refCuenta, {
            corte: { motivo: 'sin_conversaciones', desde: Timestamp.fromMillis(ahoraMs), aplicado: aplica,
                     perdidas: 0, mensajesPerdidos: 0 },
          }, { merge: true });
          tx.create(refAuditoria.doc(), {
            accion: aplica ? 'corte_servicio' : 'corte_observado', uid: 'ingesta', en: Timestamp.now(),
            motivo: 'sin_conversaciones', desde: Timestamp.fromMillis(ahoraMs), aplicado: aplica,
          });
          corte.nuevo = true;
          corte.aplicado = aplica;
          corte.motivo = 'sin_conversaciones';
        }
      }

      // LA SEÑA EN CURSO, si este mensaje trae un hecho del flujo (el QR de la
      // seña recién enviado). Va en la misma transacción que el conteo: un QR
      // contado sin solicitud dejaría al paciente mandando un comprobante que
      // nadie lee, y una solicitud sin QR contado sería un mensaje regalado.
      const solicitudPrevia = conversacion.get('solicitud');
      const solicitud = solicitudTras(solicitudPrevia, mensaje.evento, ahoraMs,
        { referencia: mensaje.referencia, calendario: mensaje.calendario, inicio: mensaje.inicio,
          nueva: mensaje.nueva, monto: mensaje.monto });
      // REACTIVADA (bloque 4): el primer mensaje del paciente dentro de las 24 h
      // de un seguimiento. Se anota en la solicitud y se cuenta en el mes, en
      // la misma transacción que cuenta el mensaje. Cero lecturas extra.
      const reactivada = reactivaTras(solicitudPrevia, mensaje.direccion, ahoraMs);

      // EL ORIGEN ES DE LA VENTANA, NO DEL MENSAJE. Al abrirla manda lo que
      // reportó el flujo; después manda lo guardado, porque Meta solo pone
      // `referral` en el PRIMER mensaje. Así un bloque adicional —la respuesta
      // 26, que factura otra conversación— se atribuye a la campaña que trajo
      // la ventana, que es donde de verdad nació el tráfico.
      const origenVentana = conteo.atencion
        ? (mensaje.origen === 'anuncio' ? 'anuncio' : 'directo')
        : (marcas.origen === 'anuncio' ? 'anuncio' : 'directo');

      tx.set(refConversacion, {
        // La marca del estado se escribe con cada mensaje: cuando la ventana se
        // renueva vuelve a `normal` sola, y el próximo umbral vuelve a avisar.
        atencionEstado: atencion.estado,
        telefono: mensaje.telefono,
        canal: 'whatsapp',
        ultimoMensaje: mensaje.texto.slice(0, 300),
        ultimoEn: FieldValue.serverTimestamp(),
        // Solo lo mueve un mensaje del cliente: ver `ultimoEntranteEn` arriba.
        // El ancla se escribe SOLO al abrir una atención. Refrescarla con cada
        // mensaje convertiría la ventana fija en una ventana deslizante, y una
        // conversación activa nunca se renovaría: el cliente que escribe todos
        // los días quedaría contado una sola vez, para siempre.
        ...(conteo.atencion ? { atencionDesde: FieldValue.serverTimestamp() } : {}),
        // Se escribe con el mismo hecho y por el mismo motivo que el ancla.
        ...(conteo.atencion ? { origen: origenVentana } : {}),
        mensajesTotal: FieldValue.increment(1),
        periodoContado: periodo,
        // El contador de respuestas se calcula, no se incrementa: dentro de la
        // transacción el valor leído es el que vale, y así el número guardado y
        // la decisión que se tomó con él no pueden discrepar.
        respuestasDelPeriodo: conteo.respuestasDelPeriodo,
        // Igual que el anterior: calculado dentro de la transacción, no
        // incrementado. Es lo que decide el bloque en el mensaje siguiente.
        mensajesVentana: conteo.mensajesVentana,
        ...(conteo.interaccion ? { periodoInteraccion: periodo } : {}),
        ...(mensaje.nombreContacto ? { nombreContacto: mensaje.nombreContacto } : {}),
        // Una solicitud nueva trae TODOS sus campos (los nulos también): con
        // `merge: true` los mapas se fusionan campo a campo, y un campo que no
        // viniera sobreviviría de la solicitud anterior.
        ...(solicitud ? { solicitud }
          : reactivada ? { solicitud: { reactivadaEn: Timestamp.fromMillis(ahoraMs) } } : {}),
        // NO CONTACTAR (bloque 4): el paciente pidió que no le escriban, o el
        // turno pasó a una persona. Solo se ENCIENDE desde acá; apagarlo es un
        // acto de una persona del negocio, desde la consola.
        ...(mensaje.evento === 'no_contactar' ? { noContactar: true } : {}),
      }, { merge: true });

      escribirMensaje();

      tx.set(refMetricas, {
        mensajes: FieldValue.increment(1),
        // ENTRANTES POR TIPO (bloque 3, 17/09/2026). `entrantes` ya decía
        // cuántos mensajes mandaron los clientes; no decía DE QUÉ CLASE. La
        // clínica sostiene que en la vida real llegan muchos audios e
        // imágenes, y hasta hoy no había ninguna cifra para confirmarlo o
        // desmentirlo: el flujo contestaba «por ahora atiendo por texto» —un
        // mensaje pagado que no avanza nada— y nadie sabía cuántas veces.
        //
        // Es un MAPA y no siete campos sueltos porque los tipos los fija Meta
        // y pueden crecer: un campo nuevo por tipo obligaría a tocar las
        // reglas, la consola y esta lista cada vez. La clave es el tipo YA
        // NORMALIZADO (`TIPOS`, arriba), así que un tipo desconocido cae en
        // `otro` y nunca siembra una clave arbitraria; las reglas lo vuelven
        // a exigir, porque un límite que solo existe acá no existe.
        //
        // `FieldValue.increment` sobre la clave anidada: con `merge: true` un
        // objeto anidado se fusiona campo por campo, así que esto suma 1 a
        // `entrantesPorTipo.<tipo>` sin pisar los demás tipos y sin una
        // lectura previa. Va en la MISMA transacción que `entrantes`: si uno
        // sube y el otro no, la suma de los tipos deja de dar el total y la
        // consola miente.
        ...(mensaje.direccion === 'entrante'
          ? {
            entrantes: FieldValue.increment(1),
            entrantesPorTipo: { [mensaje.tipo]: FieldValue.increment(1) },
          }
          : {}),
        // Son los números que sostienen la facturación por uso.
        // LOS NOMBRES SON LOS DE LA PAGINA DE PRECIOS, no los de la primera
        // versión de esto, y la diferencia importa porque el cliente lee esa
        // página y después mira esta consola: si los dos números no se llaman
        // igual, la discusión no es sobre la factura sino sobre el vocabulario.
        //
        //   CONVERSACION  = bloque de hasta 25 respuestas del asistente dentro
        //                   de la ventana de 24 h desde el primer mensaje. ES LA
        //                   UNIDAD QUE SE FACTURA. Suma una al abrir la ventana
        //                   y otra por cada bloque de 25 que se excede
        //                   (`RESPUESTAS_POR_CONVERSACION`). Antes se llamaba
        //                   `atenciones` acá adentro.
        //   BLOQUES ADIC. = de esas conversaciones, cuántas vinieron de exceder
        //                   los 25 en una misma ventana. Es lo que le permite al
        //                   comercio ver por qué `conversaciones` es mayor que
        //                   la cantidad de clientes que le escribieron, y a
        //                   NovuChat medir la cola larga que pide `Analisis/16`.
        //   ATENCION      = personas distintas del período. En el código sigue
        //                   siendo `personasAtendidas`, que es más explícito y
        //                   ya tiene datos; el rótulo se traduce en la pantalla.
        //   CIERRE        = cita o pedido concreto. YA NO SE FACTURA: quedó como
        //                   indicador de si el asistente vende o solo responde.
        ...(conteo.personaNueva ? { personasAtendidas: FieldValue.increment(1) } : {}),
        ...(conteo.conversacion ? { conversaciones: FieldValue.increment(1) } : {}),
        ...(conteo.bloqueNuevo ? { bloquesAdicionales: FieldValue.increment(1) } : {}),
        //   POR ANUNCIO   = de esas conversaciones, cuántas nacieron de un
        //                   anuncio de clic a WhatsApp (`ORIGENES`). Es un
        //                   SUBCONJUNTO de `conversaciones`, nunca mayor, y la
        //                   fracción se calcula contra ella: la misma unidad
        //                   que se factura, así que las dos cifras se comparan
        //                   sin traducir nada. Lo que no vino por anuncio no
        //                   necesita su propio contador: es la resta.
        ...(conteo.conversacion && origenVentana === 'anuncio'
          ? { conversacionesPorAnuncio: FieldValue.increment(1) } : {}),
        ...(conteo.interaccion ? { interacciones: FieldValue.increment(1) } : {}),
        //   DERIVADAS      = ventanas que pasaron al operador por uso extendido.
        //   BLOQUEADAS     = ventanas que llegaron al bloqueo. Las dos son la
        //                    cola larga que `Analisis/16` pide medir, ya contada.
        ...(aviso === 'operador' ? { derivadasAOperador: FieldValue.increment(1) } : {}),
        ...(aviso === 'bloqueado' ? { bloqueadas: FieldValue.increment(1) } : {}),
        //   SEÑAS ENVIADAS = QR de seña que salieron. Con `senasCotejadas` y
        //                    `senasVencidas` (que escribe `sena.ts`) es el
        //                    embudo de la reserva con seña.
        ...(mensaje.evento === 'qr_enviado' ? { senasEnviadas: FieldValue.increment(1) } : {}),
        //   REACTIVADAS   = conversaciones en las que el paciente volvió a
        //                   escribir dentro de las 24 h de un seguimiento
        //                   (bloque 4). Con `seguimientos` (que escribe
        //                   `seguimientoEnviado`) es la tasa del recordatorio.
        ...(reactivada ? { reactivadas: FieldValue.increment(1) } : {}),
      }, { merge: true });

      // La marca del aviso y su constancia en la auditoría van en la MISMA
      // transacción que cuenta la conversación: si una se escribe, la otra
      // también. La auditoría la lee el propietario para el historial del
      // comercio; la bitácora recibe el hecho más abajo, como los demás eventos.
      if (avisoConsumo) {
        tx.set(refCuenta, {
          avisoConsumo: { ...avisoConsumo, en: FieldValue.serverTimestamp() },
        }, { merge: true });
        tx.create(db.collection(`tenants/${tenantId}/auditoria`).doc(), {
          accion: 'aviso_consumo', uid: 'ingesta', en: Timestamp.now(), ...avisoConsumo,
        });
      }

      return { atencion, aviso, avisoConsumo, conteo, servicio, corte, cortado: false, conModalidad };
    });

    // Lo que viaja a n8n y al registro sobre el prepago: el estado del
    // servicio con el que se juzgó ESTE mensaje. `cortado` = no se atendió;
    // `observado` = debería estar cortado pero se atendió (modo observación, o
    // ventana abierta con `sin_conversaciones`); `operativo` = todo en orden.
    // `disponibles` no va: solo es exacto cuando se leyó el agregado, y el
    // flujo no decide con él.
    const servicio = {
      estado: veredicto.cortado ? 'cortado' as const
        : veredicto.servicio.operativo ? 'operativo' as const : 'observado' as const,
      motivo: veredicto.servicio.motivo,
      fase: veredicto.servicio.fase,
      graciaHasta: veredicto.servicio.graciaHasta === null
        ? null : new Date(veredicto.servicio.graciaHasta).toISOString(),
    };

    // El renglón que permite atribuir tráfico y costo a este comercio. Ver el
    // bloque «REGISTRO DE EJECUCIÓN CON EL COMERCIO ADENTRO», arriba.
    logger.info('ingesta: mensaje contado', {
      evento: EVENTO_INGESTA,
      // A QUIÉN se le atribuye. Es el campo que faltaba.
      tenantId,
      // Un comercio puede tener más de un flujo, y cada flujo tiene su propio
      // número: la franquicia de 1.000 mensajes gratis de Meta es POR NÚMERO,
      // así que el costo se mira por flujo, no solo por comercio.
      flujo: ruta.flujo || 'agendamiento',
      // El mismo corte mensual que usa la facturación (`periodoDe`).
      periodo,
      // 'saliente' es lo que Meta cobra a 0,0113 USD; 'entrante' no.
      direccion: mensaje.direccion,
      tipo: mensaje.tipo,
      telefonoUlt4: ultimos4(mensaje.telefono),
      // Lo que ya se contaba de esta ventana, para no volver a calcularlo al
      // consultar: respuestas del asistente en la ventana vigente, si este
      // mensaje facturó una conversación, y si esa conversación vino de
      // exceder el bloque de 25.
      mensajesVentana: veredicto.conteo.mensajesVentana,
      conversacion: veredicto.conteo.conversacion,
      bloqueNuevo: veredicto.conteo.bloqueNuevo,
      // El estado con el que se juzgó esta consulta: entre los umbrales de
      // operador y bloqueo cada consulta cuesta un mensaje fijo y se factura
      // igual, y eso explica una ventana cara sin ninguna venta.
      atencionEstado: veredicto.atencion.estado,
      // El prepago: si este mensaje se atendió, se cortó, o se habría cortado
      // (modo observación). Es lo que permite mirar un ciclo entero antes de
      // encender el corte.
      servicio: servicio.estado,
      servicioMotivo: servicio.motivo,
      // El TAMAÑO del texto, nunca el texto.
      tamanoTexto: mensaje.texto.length,
    });

    await registrar(tenantId, {
      tipo: mensaje.direccion === 'entrante' ? 'mensaje_entrante' : 'mensaje_saliente',
      // Durante un corte aplicado el mensaje queda registrado como RECHAZADO
      // con `codigo: 'cortado'`: es la evidencia de que llegó y no se atendió.
      resultado: veredicto.cortado ? 'rechazado' : 'ok',
      ...(veredicto.cortado ? { codigo: 'cortado' } : {}),
      telefono: mensaje.telefono,
      conversacionId: idConversacion,
      // El TAMAÑO del texto, nunca el texto.
      tamanoTexto: mensaje.texto.length,
      ...(typeof peticion.body === 'object' && peticion.body !== null
          && typeof (peticion.body as Record<string, unknown>)['latenciaMs'] === 'number'
        ? { latenciaMs: (peticion.body as Record<string, number>)['latenciaMs'] } : {}),
    });
    if (veredicto.corte.nuevo && veredicto.corte.aplicado) {
      // El comercio ve en su bitácora que el asistente dejó de atender, y por
      // qué (`codigo`). Un corte solo observado NO llega acá: para el comercio
      // no existe (queda en la auditoría, que lee NovuChat).
      await registrar(tenantId, {
        tipo: 'corte_servicio', resultado: 'ok', canal: 'sistema',
        codigo: veredicto.corte.motivo ?? undefined,
      });
    }
    if (veredicto.corte.reanudado) {
      await registrar(tenantId, { tipo: 'reanudacion_servicio', resultado: 'ok', canal: 'sistema' });
    }
    if (veredicto.aviso) {
      // Queda en la bitácora del comercio: es el hecho que explica por qué una
      // persona tuvo que tomar la conversación, o por qué un teléfono dejó de
      // recibir respuestas hasta el día siguiente.
      await registrar(tenantId, {
        tipo: veredicto.aviso === 'operador' ? 'derivacion_operador' : 'bloqueo_ventana',
        resultado: 'ok', telefono: mensaje.telefono, conversacionId: idConversacion,
      });
    }
    if (veredicto.avisoConsumo) {
      // Sin teléfono: el aviso es del comercio, no de quien escribió.
      await registrar(tenantId, {
        tipo: 'aviso_consumo', resultado: 'ok', canal: 'sistema',
        detalle: `${veredicto.avisoConsumo.conversaciones}/${veredicto.avisoConsumo.limite}`,
      });
    }

    // Antes era un 204 vacío. Ahora viaja el estado de atención, para que un
    // flujo que reporte el entrante ANTES de llamar al modelo pueda decidir con
    // él. El flujo vivo ignora el cuerpo y sigue funcionando igual.
    respuesta.status(200).json({
      atencion: {
        ...veredicto.atencion,
        ventanaVenceEn: veredicto.atencion.ventanaVenceEn === null
          ? null : new Date(veredicto.atencion.ventanaVenceEn).toISOString(),
      },
      avisarRecepcion: veredicto.aviso,
      // El prepago (bloque A-0): `cortado` si este mensaje no se atendió. El
      // flujo vivo ignora el cuerpo; el corte real entra por el 409 de
      // `configuracionFlujo`, que los tres flujos ya obedecen. SOLO con
      // modalidad: para una demostración, y para los comercios de hoy, la
      // respuesta es byte a byte la de siempre (lo exigen `aviso-consumo` y
      // `entrantes-por-tipo`, y es la negativa de este bloque).
      ...(veredicto.conModalidad ? { servicio } : {}),
    });
  },
);

/**
 * ===========================================================================
 * CONFIGURACIÓN DEL COMERCIO PARA n8n, RESUELTA POR NÚMERO
 * ===========================================================================
 *
 * Es lo que reemplaza a los valores escritos a mano en el nodo `Config del
 * negocio`. n8n llama acá al empezar cada turno con el `phone_number_id` que
 * viene en el webhook, y recibe con qué comercio está hablando, con qué flujo y
 * con qué datos.
 *
 * TRES COSAS QUE CONVIENE ENTENDER:
 *
 * 1. LA RESPUESTA VIENE ROTULADA. `instruccionesExtra` va en su propia clave,
 *    separada del resto, para que el flujo la inserte en una sección delimitada
 *    del prompt marcada como DATO DEL NEGOCIO. Nunca concatenada por delante de
 *    las reglas de comportamiento del agente. Sin esa separación, lo que un
 *    comercio escribe en el panel se convierte en instrucciones para el modelo
 *    (inyección de segundo orden; ver SEGURIDAD.md §3).
 *
 * 2. EL ESTADO VIAJA EN CADA RESPUESTA. Si el comercio no está activo se
 *    devuelve 409 con el estado y un `mensajeCortesia` NEUTRO. n8n debe enviar
 *    ese texto y cortar el turno. **PROHIBIDO revelarle al cliente final que el
 *    comercio debe dinero**: quien escribe por WhatsApp es un tercero que no
 *    tiene nada que ver con la relación comercial, y enterarlo dañaría al
 *    comercio y a NovuChat por igual.
 *
 * 3. n8n NO DEBE CACHEAR ESTO MÁS DE 60 SEGUNDOS. La suspensión es una palanca
 *    comercial y tiene que surtir efecto ya. Un caché largo la vuelve inútil.
 */
export const configuracionFlujo = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
    // UNA INSTANCIA SIEMPRE DESPIERTA (decisión de Andres, 15/09/2026). Sin ella,
    // el primer mensaje después de un rato sin tráfico esperaba el arranque en
    // frío de esta Function y de la otra que el flujo llama en serie
    // (`configuracionFlujo` → `ingesta`): 8 a 12 s de los ~20 que tardaba la
    // primera respuesta. Costo medido en el catálogo de Google (us-east1,
    // facturación por pedido, instancia mínima inactiva): 2,5e-6 USD por
    // vCPU·s y por GiB·s → ~8,1 USD al mes por Function con 1 vCPU y 256 MiB,
    // compartidos por todos los comercios. `pruebas/instancias-minimas.test.ts`
    // impide que se pierda sin querer.
    minInstances: INSTANCIAS_MINIMAS,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (!ID_TENANT.test(ruta.tenantId)) {
      respuesta.status(404).send('numero no asignado'); return;
    }

    // `flujo` cae en `agendamiento` si la ruta no lo trae. Es el vertical que ya
    // tenían las rutas viejas, escritas antes de que hubiera un segundo: dejarlo
    // vacío haría que el comercio no recibiera NINGUNA configuración de vertical
    // y el flujo se quedaría sin datos sin decir por qué.
    const phoneNumberId = ruta.phoneNumberId;
    const comercio = {
      tenantId: ruta.tenantId,
      flujo: ruta.flujo || 'agendamiento',
      estado: await estadoDelComercio(ruta.tenantId),
    };

    const db = getFirestore();

    // EL TELÉFONO DEL CLIENTE ES OPCIONAL, y con él viaja el estado de atención
    // del teléfono (`atencion`): cuántas respuestas lleva en la ventana, en qué
    // bloque va y si el flujo tiene que pasar al operador o callar. El flujo lo
    // manda en el cuerpo (`telefono`); sin él, la respuesta es la de siempre y
    // el flujo no puede aplicar los umbrales, que es exactamente el estado de
    // un flujo viejo.
    const cuerpo = (typeof peticion.body === 'object' && peticion.body !== null
      ? peticion.body : {}) as Record<string, unknown>;
    const telefonoCrudo = typeof cuerpo['telefono'] === 'string' ? cuerpo['telefono'].trim() : '';
    const telefono = /^[0-9]{8,15}$/.test(telefonoCrudo) ? telefonoCrudo : null;

    // `config/negocio` se lee ANTES de decidir el 409: la cortesía lleva el
    // teléfono de recepción del comercio (`Analisis/36` §3.2), también cuando
    // el comercio está suspendido.
    const config = await db.doc(`tenants/${comercio.tenantId}/config/negocio`).get();
    const negocio = (config.data() ?? {}) as Record<string, unknown>;
    const cortesia = mensajeCortesia(negocio['numeroRecepcion']);

    if (comercio.estado !== 'activo') {
      respuesta.status(409).json({
        estado: comercio.estado,
        // Texto neutro. No menciona pagos, deudas ni suspensiones.
        mensajeCortesia: cortesia,
      });
      return;
    }

    // Lecturas en paralelo. n8n resuelve «quién atiende una limpieza
    // facial» EN MEMORIA sobre estas listas, sin consultas adicionales: son
    // colecciones chicas (200 servicios, 50 funcionarios como tope) y traerlas
    // enteras cuesta menos que cualquier consulta con índice por servicio.
    // Documento específico del vertical, si le corresponde uno. Un comercio de
    // gastronomía no lee configuración de agenda y viceversa: no hace falta
    // filtrar después porque directamente no se pide.
    const docVertical = documentoDeVertical(comercio.flujo);
    const ahoraMs = Date.now();

    const [catalogo, funcionarios, especifica, rotulos, conversacion, cuenta, metricas, plataformaPrepago, campanas] =
      await Promise.all([
        db.collection(`tenants/${comercio.tenantId}/catalogo`)
          .where('activo', '==', true).limit(200).get(),
        db.collection(`tenants/${comercio.tenantId}/funcionarios`)
          .where('activo', '==', true).limit(50).get(),
        docVertical
          ? db.doc(`tenants/${comercio.tenantId}/config/${docVertical}`).get()
          : Promise.resolve(null),
        // Rótulos del cobro simulado: los mismos para TODOS los comercios.
        comercio.flujo === 'venta'
          ? db.doc('plataforma/cobroSimulado').get()
          : Promise.resolve(null),
        // Solo con teléfono hay conversación que mirar.
        telefono
          ? db.doc(`tenants/${comercio.tenantId}/conversaciones/wa_${telefono}`).get()
          : Promise.resolve(null),
        // LA CUENTA, EL AGREGADO DEL MES Y LA BANDERA DEL PREPAGO SE LEEN SIEMPRE
        // (bloque A-0): el corte por falta de pago o de conversaciones se decide
        // acá, ANTES del modelo, con o sin teléfono. La cuenta trae además los
        // umbrales del comercio; sin ella rigen los de respaldo.
        db.doc(`tenants/${comercio.tenantId}/cuenta/estado`).get(),
        db.doc(`tenants/${comercio.tenantId}/metricas/${periodoDe(ahoraMs)}`).get(),
        db.doc('plataforma/prepago').get(),
        // LAS CAMPAÑAS (24/09/2026): capa común, un documento por comercio.
        // Solo se usan las `vigentes` (las aprobó `verificarCampanas`).
        db.doc(`tenants/${comercio.tenantId}/config/campanas`).get(),
      ]);

    // -------------------------------------------------------------------------
    // EL CORTE DEL PREPAGO REUTILIZA EL 409 (`DISENO.md` §4undecies.3). Los tres
    // flujos ya tratan un 409 de acá como «no operativo» y mandan la cortesía
    // sin llamar al modelo: cero cambios en `Flujos/`, cero mensajes nuevos.
    // Se corta SOLO si la bandera del modo observación está encendida
    // (`corteAplicable`): apagada, se responde 200 y la ingesta observa. Una
    // demostración nunca llega al 409. Y `sin_conversaciones` no corta una
    // ventana ya abierta: esa conversación ya se pagó, se atiende hasta el
    // final. El 409 no toca `atencion.estado`: el corte entra por «¿Comercio
    // operativo?», que en los flujos está antes.
    // -------------------------------------------------------------------------
    const cuentaCruda = (cuenta.data() ?? {}) as CuentaCruda;
    const servicio = estadoDeServicio(cuentaCruda, consumidasDe(metricas.data()), ahoraMs);
    const corteAplica = corteAplicable(cuentaCruda, plataformaPrepago.data());
    // SIN TELÉFONO NO SE SABE SI LA VENTANA ESTÁ ABIERTA, y `sin_conversaciones`
    // no corta una ventana abierta: se falla hacia atender. El corte a los
    // teléfonos nuevos sigue entrando por la ingesta y por las peticiones con
    // teléfono; por eso encender la bandera exige que todos los flujos
    // publicados manden `telefono` (ESTADO.md, 20/09). `sin_pago` corta igual.
    const ventanaAbierta = telefono === null || (conversacion !== null
      && !ventanaVencida((conversacion.data() ?? {}) as MarcasDeConteo, ahoraMs));
    if (!servicio.operativo && corteAplica
        && !(servicio.motivo === 'sin_conversaciones' && ventanaAbierta)) {
      logger.info('configuracionFlujo: turno cortado por prepago', {
        evento: EVENTO_CONFIGURACION, tenantId: comercio.tenantId, flujo: comercio.flujo,
        estadoComercio: comercio.estado, telefonoUlt4: telefono ? ultimos4(telefono) : null,
        servicio: 'cortado', servicioMotivo: servicio.motivo,
      });
      respuesta.status(409).json({ estado: servicio.motivo, mensajeCortesia: cortesia });
      return;
    }

    // EL ESTADO DE ATENCIÓN DEL TELÉFONO, si vino. Se calcula con la misma
    // función que la ingesta, sobre lo que la ingesta dejó guardado con el
    // último saliente. `avisarRecepcion` se deduce de la marca que la ingesta
    // anota con cada mensaje: como el flujo reporta el entrante en este mismo
    // turno, la marca queda actualizada para el siguiente y no se avisa dos
    // veces. La decisión de callar o de pasar al operador se toma ACÁ, antes
    // del modelo: un saliente ya enviado no se puede rechazar.
    const atencion = telefono && conversacion
      ? (() => {
          const marcas = (conversacion.data() ?? {}) as Record<string, unknown>;
          const estado = estadoDeAtencion(marcas, umbralesDeAtencion(cuenta?.data()), Date.now());
          return {
            ...estado,
            ventanaVenceEn: estado.ventanaVenceEn === null
              ? null : new Date(estado.ventanaVenceEn).toISOString(),
            avisarRecepcion: avisoDeTransicion(marcas['atencionEstado'], estado.estado),
          };
        })()
      : null;

    const catalogoWebActivo = negocio['catalogoWebActivo'] === true;
    // Se calcula una sola vez: decide qué se manda al prompt y, además, se
    // registra (un catálogo resumido cambia cómo conversa el asistente, y por
    // lo tanto cuántos mensajes hace falta para cerrar).
    const catalogoResumido = catalogoWebActivo && catalogo.size > UMBRAL_CATALOGO_AL_PROMPT;
    const cobroReal = especifica?.get('cobroReal') as Record<string, unknown> | undefined;
    // Encendido Y con código: si falta cualquiera de los dos, se cobra simulado.
    // Un comercio a medio configurar tiene que quedar en el camino que no mueve
    // dinero, nunca en el que sí.
    const cobroRealActivo = cobroReal?.['activo'] === true
      && String(cobroReal?.['ficha'] ?? '') !== ''
      && String(cobroReal?.['cargaUtil'] ?? '') !== '';

    // --- CAMPOS DERIVADOS -------------------------------------------------
    // Se calculan acá y NUNCA se leen de la configuración, aunque aparecieran.
    // Las reglas ya impiden guardarlos; esto es la segunda barrera sobre el
    // vector más serio: un comercio que se fija `estadoComercio: 'activo'` y
    // sigue siendo atendido después de que lo suspendieron.
    const derivados = {
      estadoComercio: comercio.estado,          // de la ficha del tenant
      phoneNumberId,                            // del número que validó la firma
      horarioAtencion: horarioAtencion(negocio['horarios']),
      datosQueNoTenemos: datosQueNoTenemos(negocio),
    };

    // --- TEXTO LIBRE, ROTULADO --------------------------------------------
    // Sale en su propia sección para que el flujo lo inserte delimitado y
    // marcado como DATO DEL NEGOCIO. Nunca por delante de las reglas de
    // comportamiento del agente.
    const datosDelNegocio: Record<string, unknown> = {};
    for (const clave of CAMPOS_LIBRES_AL_PROMPT) {
      if (negocio[clave] !== undefined) datosDelNegocio[clave] = negocio[clave];
    }
    datosDelNegocio['datosQueNoTenemos'] = derivados.datosQueNoTenemos;
    // EL ENLACE DE GOOGLE MAPS es un dato del negocio, pero NO texto libre: el
    // asistente lo reenvía tal cual al cliente, así que solo viaja si es de un
    // dominio de mapas (segunda barrera; la primera son las reglas). Sin
    // enlace válido el campo no va, y el flujo da la dirección sola. Va en el
    // MISMO mensaje que la confirmación: cero mensajes nuevos (Analisis/34 §2).
    const direccionMaps = enlaceDeMapaValido(negocio['direccionMaps']);
    if (direccionMaps) datosDelNegocio['direccionMaps'] = direccionMaps;
    // EL COMPORTAMIENTO GENERAL SALE DE LO VIGENTE, NUNCA DE LO PROPUESTO
    // (17/09/2026). `instruccionesExtra` es lo que el comercio escribió y
    // todavía puede estar sin revisar o rechazado; `instruccionesVigentes` es lo
    // último que aprobó la verificación del servidor (`comportamiento.ts`) o lo
    // que cargó NovuChat. El flujo sigue recibiendo la clave `instruccionesExtra`
    // —no cambia—, pero con el texto vigente adentro; sin vigente, vacío, aunque
    // lo propuesto tenga texto. Es la segunda barrera, igual que con los campos
    // derivados: las reglas impiden que el navegador escriba lo vigente, y acá
    // no se lee lo propuesto ni por accidente.
    datosDelNegocio['instruccionesExtra'] = typeof negocio['instruccionesVigentes'] === 'string'
      ? negocio['instruccionesVigentes'] : '';

    // El renglón de este turno, con el comercio adentro. Ver el bloque
    // «REGISTRO DE EJECUCIÓN CON EL COMERCIO ADENTRO» más arriba: el flujo
    // llama acá UNA vez por turno, antes del modelo, así que contarlos por
    // comercio dice cuántos turnos se atendieron, y contrastarlos con los
    // `ingesta_mensaje` salientes dice cuántos terminaron en un mensaje
    // cobrado. No agrega ningún mensaje al cliente.
    logger.info('configuracionFlujo: turno servido', {
      evento: EVENTO_CONFIGURACION,
      tenantId: comercio.tenantId,
      flujo: comercio.flujo,
      // Un comercio suspendido no llega hasta acá, pero el campo permite
      // separar por estado sin cruzar con Firestore.
      estadoComercio: comercio.estado,
      // Nunca el teléfono entero: el flujo lo manda para los umbrales.
      telefonoUlt4: telefono ? ultimos4(telefono) : null,
      // Lo que ya se contaba de esta ventana, sin recalcular nada: en qué
      // estado está el teléfono y cuántas respuestas lleva. Es lo que explica
      // un turno que no llamó al modelo.
      atencionEstado: atencion?.estado ?? null,
      mensajesVentana: atencion?.respuestasEnVentana ?? null,
      bloque: atencion?.bloque ?? null,
      // Cuántos ítems viajaron al prompt y si fueron resumidos: es lo que
      // vuelve comparable el costo de dos comercios con catálogos distintos.
      catalogoItems: catalogo.size,
      catalogoResumido,
    });

    respuesta.status(200).json({
      tenantId: comercio.tenantId,
      flujo: comercio.flujo,
      estadoComercio: derivados.estadoComercio,
      phoneNumberId: derivados.phoneNumberId,

      // Estado de atención del teléfono que escribió (`null` si el flujo no
      // mandó `telefono`). Lo que el flujo tiene que hacer con este turno:
      //   estado = 'normal'    → al modelo, como siempre.
      //   estado = 'operador'  → NO llamar al modelo: responder `mensajeFijo`
      //                          (o el texto del negocio) y, si
      //                          `avisarRecepcion` viene, avisar a recepción.
      //   estado = 'bloqueado' → NO enviar nada hasta `ventanaVenceEn`.
      atencion,

      // EL PREPAGO, para mirar (bloque A-0): modalidad, fase (cubierto,
      // gracia, cortado), motivo, hasta cuándo dura la gracia, cuántas
      // conversaciones quedan y si el corte está aplicado. NINGÚN flujo decide
      // con esto: el corte real es el 409 de arriba. `disponibles` es `null` en
      // demostración (no hay tope).
      prepago: {
        modalidad: servicio.modalidad,
        fase: servicio.fase,
        motivo: servicio.motivo,
        graciaHasta: servicio.graciaHasta === null ? null : new Date(servicio.graciaHasta).toISOString(),
        disponibles: Number.isFinite(servicio.disponibles) ? servicio.disponibles : null,
        corteAplicado: corteAplica && !servicio.operativo,
      },

      // Operación: valores estructurados, sin texto libre.
      operacion: {
        zonaHoraria: negocio['zonaHoraria'] ?? 'America/La_Paz',
        moneda: negocio['moneda'] ?? 'BOB',
        numeroRecepcion: negocio['numeroRecepcion'] ?? '',
        calendarioId: negocio['calendarioId'] ?? '',
        horarioAtencion: derivados.horarioAtencion,
        prefijosPermitidos: Array.isArray(negocio['prefijosPermitidos'])
          ? (negocio['prefijosPermitidos'] as unknown[]).slice(0, 10)
          : [],
        // Coordenadas del pin nativo de WhatsApp, o `null` si el comercio no
        // las cargó. El flujo las usa SOLO cuando el cliente pide la ubicación
        // (un mensaje más, solo en ese caso). Nunca van al texto del prompt.
        ubicacion: ubicacionDe(negocio['ubicacion']),
      },

      // Voz del agente: FRASES NUESTRAS, elegidas por un enumerado del comercio.
      // El valor que escribió el cliente no se interpola en ninguna parte.
      instruccionesDeVoz: instruccionesDeVoz(negocio),
      // LAS MISMAS FRASES, PERO ROTULADAS. `instruccionesDeVoz` es un arreglo
      // —frase del trato, frase de los emojis— y los flujos las necesitan por
      // separado para poder pisar cada una en su propio campo. Leerlas por
      // posición sería frágil: agregar una tercera frase mañana cambiaría el
      // significado de las dos primeras sin que nadie lo note.
      //
      // Se descubrió el 2026-09-07: las fusiones de los dos flujos leían
      // `instruccionesDeVoz.tratamiento` sobre un ARREGLO, así que siempre daba
      // `undefined` y **el trato elegido en la consola nunca llegaba al
      // asistente**. No se notó porque el valor de respaldo del flujo era el
      // correcto, que es la peor forma de no notarlo.
      //
      // `nombreAsistente` y `nivelEmojis` son para los TEXTOS FIJOS de los
      // flujos, los que no pasan por el modelo: el nombre saneado (una línea,
      // 40 caracteres, '' si no hay) y el enumerado crudo del emoji. Valen
      // para todos los flujos: son de la capa común (`vozFija`, prompt.ts).
      voz: {
        tratamiento: instruccionesDeVoz(negocio)[0] ?? '',
        emojis: instruccionesDeVoz(negocio)[1] ?? '',
        ...vozFija(negocio),
      },

      // Todo lo que escribió el comercio, junto y rotulado.
      datosDelNegocio,

      // -------------------------------------------------------------------
      // CATÁLOGO: ENTERO SI ES CHICO, RESUMIDO SI ES GRANDE.
      //
      // Es el punto 7 del diseño del catálogo web
      // (`Analisis/11-catalogo-web-propio.md`), y el umbral vive en `prompt.ts`
      // porque también lo usa `catalogoWeb.ts`: la consola es la única que sabe
      // cuántos ítems hay, así que decide acá y el flujo no cuenta nada.
      //
      // SOLO SE RESUME SI EL COMERCIO TIENE EL CATÁLOGO WEB ENCENDIDO. Sin
      // sitio adonde derivar, resumir sería quitarle información al asistente a
      // cambio de nada: seguiría siendo el único lugar de donde saca los
      // precios. Un comercio sin catálogo web se comporta exactamente como
      // antes de este cambio, tenga los ítems que tenga.
      ...(catalogoResumido
        ? {
            catalogo: [],
            catalogoResumen: resumirCatalogo(
              catalogo.docs.map((d) => d.data() as Record<string, unknown>)),
            // Con esto el flujo sabe que tiene que derivar al sitio en vez de
            // intentar recitar una lista que no recibió.
            catalogoWeb: { activo: true, derivar: true },
          }
        : {
            // `agotado` viaja para que el asistente diga «se nos acabó» en vez
            // de «no lo tenemos». No es lo mismo para el cliente: lo primero es
            // una venta para mañana y lo segundo es un cliente que se va. Los
            // ítems SIN control de existencias nunca salen agotados: no saber
            // cuántos hay no es saber que hay cero.
            catalogo: catalogo.docs.map((d) => {
              const datos = d.data();
              const quedan = existencias(datos);
              return {
                id: d.id, ...datos,
                ...(quedan !== null ? { agotado: quedan === 0 } : {}),
              };
            }),
            ...(catalogoWebActivo ? { catalogoWeb: { activo: true, derivar: false } } : {}),
          }),

      // Configuración del vertical, en su propia clave. El flujo del Demo A no
      // recibe `venta` y el del Demo B no recibe `agendamiento`: cada uno ve
      // solo lo que sabe usar.
      //
      // LA CAPTACIÓN VA SANEADA, NO CRUDA. Desde que es un flujo genérico la
      // escribe el administrador de cada comercio, y sus listas (rubros,
      // planes, cargos, aclaraciones) las reglas no las pueden recorrer:
      // `sanearCaptacion` descarta cada elemento que no cumple su forma antes
      // de que el asistente lo diga. Sale siempre, aunque falte el documento,
      // con valores por defecto y listas vacías: el flujo tiene un solo camino.
      //
      // Y EL QR DEL COMERCIO NO VIAJA ACÁ (23/09/2026). El documento del
      // vertical se volcaba ENTERO, y adentro va `cobroReal` con su
      // `cargaUtil`: el código del QR llegaba a n8n en cada consulta y quedaba
      // en los datos de ejecución del flujo, que se guardan y se miran. El
      // diseño dice lo contrario con todas las letras —«la imagen NO viaja
      // acá: viaja su ficha», §4duodecies— y los bloques `cobroReal` y `cobro`
      // de más abajo mandan exactamente lo que el flujo necesita: el nombre de
      // la cuenta, el banco, las cuentas para cotejar y la dirección pública de
      // la imagen. La carga útil no hace falta para nada de eso.
      //
      // Afectaba a los DOS verticales que cobran, venta y agendamiento, y
      // estaba en producción desde que existe el cobro real.
      ...(docVertical === 'onboarding'
        ? { onboarding: sanearCaptacion(especifica?.exists ? especifica.data() : {}) }
        : docVertical && especifica?.exists
          ? { [docVertical]: (() => {
              const { cobroReal: _fuera, ...resto } = especifica.data() as Record<string, unknown>;
              return resto;
            })() }
          : {}),

      // COBRO: real o simulado, NUNCA los dos.
      //
      // Son excluyentes por definición: o el dinero se mueve o no se mueve, y
      // mezclarlos produciría el peor resultado posible —un cobro real con el
      // rótulo de simulacro, o al revés—. El cobro real manda si está
      // encendido, y el encendido no lo hace el comercio guardando un
      // formulario: es un acto aparte.
      //
      // PROHIBICIÓN 3, mientras el cobro sea simulado: los rótulos salen de
      // plataforma, nunca de la configuración del comercio. Si el documento
      // faltara, rigen los de respaldo. El sistema falla hacia el rótulo,
      // jamás hacia el silencio.
      ...(comercio.flujo === 'venta'
        ? (cobroRealActivo
          ? { cobroReal: {
                nombreCuenta: String(cobroReal?.['nombreCuenta'] ?? ''),
                // Con esto el flujo coteja el comprobante del cliente.
                cuentas: Array.isArray(cobroReal?.['cuentas'])
                  ? (cobroReal['cuentas'] as unknown[]).slice(0, 5).map(String) : [],
                banco: String(cobroReal?.['banco'] ?? ''),
                venceEl: String(cobroReal?.['venceEl'] ?? ''),
                moneda: String(cobroReal?.['moneda'] ?? 'BOB'),
                montoFijo: typeof cobroReal?.['montoFijo'] === 'number'
                  ? cobroReal['montoFijo'] : null,
                // La imagen NO viaja acá: viaja su ficha. El flujo arma la
                // dirección con su propia base, así que el dominio del panel no
                // queda escrito en ningún lado del servidor.
                fichaQr: String(cobroReal?.['ficha'] ?? ''),
              } }
          : { cobroSimulado: {
                ...rotulosCobroSimulado(rotulos?.data()),
                // Sin media ID no hay QR que enviar, y eso es lo correcto: mejor
                // no mandar nada que mandar una imagen sin rotular.
                mediaIdQr: String(especifica?.get('mediaIdQr') ?? ''),
              } })
        : {}),

      // EL ESTADO DEL COBRO DE ESTE TELÉFONO, solo para el flujo de venta.
      //
      // Va SEPARADO de `cobroReal`/`cobroSimulado` porque no es lo mismo: aquel
      // par dice en qué modo está el comercio, y esto dice qué hacer con el
      // próximo archivo que mande ESTE cliente. Y sale en los DOS modos a
      // propósito: la compuerta del comprobante tiene que funcionar también en
      // la demostración, o el camino que se prueba delante de un prospecto no
      // es el que corre en producción.
      //
      // Es lo que le faltaba al flujo de venta para dejar de dar por comprobante
      // cualquier imagen que llegara (`cobroVenta.ts`).
      ...(comercio.flujo === 'venta'
        ? { cobro: cobroParaElFlujo(
              especifica?.exists ? (especifica.data() as Record<string, unknown>) : undefined,
              cobroRealActivo,
              String(negocio['moneda'] ?? 'BOB'),
              (ficha) => `https://${REGION}-${process.env['GCLOUD_PROJECT'] ?? ''}`
                + `.cloudfunctions.net/imagenDeCobro?f=${ficha}`,
              conversacion?.get('solicitud'),
            ) }
        : {}),

      // SEÑA PARA RESERVAR, solo para el flujo de agendamiento (bloque 2). El
      // QR es el mismo `cobroReal` que registra la consola, en el documento
      // de ESTE flujo (`config/agendamiento`), porque el QR es del flujo que
      // cobra (política de capas). La dirección de la imagen se arma acá con
      // la región y el proyecto de esta Function: el flujo no sabe dónde
      // vive el panel, y no tiene por qué saberlo.
      ...(comercio.flujo === 'agendamiento'
        ? { sena: senaParaElFlujo(
              especifica?.exists ? (especifica.data() as Record<string, unknown>) : undefined,
              cobroRealActivo,
              String(negocio['moneda'] ?? 'BOB'),
              (ficha) => `https://${REGION}-${process.env['GCLOUD_PROJECT'] ?? ''}`
                + `.cloudfunctions.net/imagenDeCobro?f=${ficha}`,
              conversacion?.get('solicitud'),
            ) }
        : {}),

      // Siempre al menos uno. Si el comercio no cargó ninguno, viene el
      // funcionario por defecto con el calendario del negocio: el flujo tiene un
      // solo camino de código y el comercio de una sola persona no configura nada.
      funcionarios: resolverFuncionarios(
        funcionarios.docs.map((d) => ({ id: d.id, datos: d.data() })),
        negocio,
        new Set(catalogo.docs.map((d) => d.id)),
      ),

      // LAS CAMPAÑAS QUE EL FLUJO RECONOCE POR SU TEXTO (Andres, 24/09/2026):
      // SOLO las aprobadas por `verificarCampanas`, en curso hoy y dentro del
      // tope del plan de HOY. Lo propuesto (`lista`) nunca viaja: una campaña
      // sin revisar no salta ningún menú. `campanas.ts` explica el contrato.
      campanas: campanasParaElFlujo(
        campanas.exists ? campanas.get('vigentes') : [],
        limiteDeCampanas(cuenta.exists ? cuenta.data() as Record<string, unknown> : null),
        ahoraMs,
      ),
    });
  },
);
