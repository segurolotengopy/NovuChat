/**
 * =============================================================================
 * BAJAS DE LA CAMPAÑA SALIENTE — `tenants/{t}/bajas/{wa_tel}` (CORE, PR-A y PR-B)
 * =============================================================================
 *
 * Cuando una persona responde «No» a la campaña saliente, queda una BAJA: el comercio no le vuelve a mandar una campaña.
 * Es una colección cerrada de Core (`registro.ts`, reglas `allow read, write: if false`): la escribe SOLO la ingesta, con el
 * SDK Admin, en la MISMA transacción que guarda el mensaje entrante. Nadie la lee desde el navegador.
 *
 *   bajas/{wa_tel} = { canal: 'whatsapp', origen: 'boton_campana', campanaId, desde }
 *
 * CLAVE DE LA BAJA (declarada, M2): `wa_` seguido de los dígitos de `messages[0].from`, tal cual llegan (sin `+` ni espacios
 * internos). Una variante sin el 591 sería OTRA clave. La lista que arme el PR-C debe usar exactamente ese formato.
 *
 * QUÉ CUENTA COMO RESPUESTA A LA CAMPAÑA (PR-B, 27/11/2026, decisiones E3 y E8 de `NOVUCHAT_plan-correcciones-1140`).
 * El servidor sabe qué campaña se le envió a cada persona: `confirmarSalida` escribe `conversaciones/{wa_tel}.campanaEnviada
 * = { idMeta, campanaId, en }` al aceptar la plantilla. Con ese dato decide, con una función PURA (`resolverRespuestaDeCampana`),
 * la misma que usa `configuracionFlujo` para avisarle al flujo (`hechosDeCampana`). El orden, del primero al último:
 *   1. reintento (la misma entrega de Meta, por `idMetaEntrante`): no se escribe nada;
 *   2. payload «no» (`cs:no:<id>`): da de baja SIEMPRE, aunque su `context.id` no sea el de la última campaña (E3: ese payload
 *      solo lo generan nuestras plantillas; «un No nunca se pierde»);
 *   3. payload «sí»: solo con cita (el `context.id` es el de la última campaña) y con un id de campaña válido;
 *   4. etiqueta del botón («No, gracias» / «Sí, contáctenme»): solo con cita;
 *   5. «no» escrito (`esNoEscritoDeCampana`): con cita, o como primera respuesta dentro de las 24 h del envío;
 *   6. nada de lo anterior: `no_aplica` y no se escribe nada.
 * Un `campana_respuesta` SIN `respuestaPor` se trata como «texto» (la lectura más estricta): ningún flujo vivo lo manda así.
 *
 * Idempotente y sin pisar: si la baja ya existe NO se reescribe (`desde` conserva el instante de la primera). Con una
 * respuesta aplicada se anota además `campanaRespuesta: { campanaId, respuesta, en, idMetaEntrante? }` en la conversación (la
 * «nota en la ficha»; ningún cliente puede escribirla: ver `firestore.rules`).
 *
 * LECTURAS ANTES QUE ESCRITURAS: `aplicarRespuestaDeCampana` lee (la baja y, si no se le pasa, la conversación) y solo después
 * escribe; quien la llama tiene que invocarla antes de su primera escritura de la transacción.
 */
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

/** El identificador de una campaña saliente: minúsculas, dígitos y guiones, de 3 a 40. */
export const CAMPANA_ID = /^[a-z0-9-]{3,40}$/;
export const RESPUESTAS_DE_CAMPANA = ['si', 'no'] as const;
export type RespuestaDeCampana = (typeof RESPUESTAS_DE_CAMPANA)[number];
/** Cómo llegó la respuesta: el payload del botón, su etiqueta o texto escrito. */
export const RESPUESTA_POR = ['payload', 'etiqueta', 'texto'] as const;
export type RespuestaPor = (typeof RESPUESTA_POR)[number];
/** La ventana en que una campaña enviada sigue siendo «la última» de esa persona: 24 h. */
export const VENTANA_CAMPANA_MS = 24 * 60 * 60 * 1000;
/** El `id` de un mensaje de Meta (el `wamid`, el `context.id`): mismo alfabeto y tope que `ID_META` de `salidaPersona.ts`. */
export const CONTEXTO_ID = /^[A-Za-z0-9_.=:+/-]{1,120}$/;

export const campanaIdValido = (v: unknown): v is string => typeof v === 'string' && CAMPANA_ID.test(v);
export const contextoIdValido = (v: unknown): v is string => typeof v === 'string' && CONTEXTO_ID.test(v);
export const respuestaPorValida = (v: unknown): v is RespuestaPor => typeof v === 'string' && (RESPUESTA_POR as readonly string[]).includes(v);
/**
 * La respuesta normalizada («No», « no », «NO» → `no`; «Sí», «si» → `si`), o `null` si no es ninguna de las dos. Solo recorta
 * espacios, pasa a minúsculas y quita la tilde de «sí»: «nop» o «no gracias» NO valen (eso es un texto escrito, no el botón).
 */
export function normalizarRespuestaDeCampana(v: unknown): RespuestaDeCampana | null {
  if (typeof v !== 'string') return null;
  // NFC primero: un «sí» con la tilde descompuesta (i + U+0301, p. ej. teclados de macOS) tiene que valer como «sí».
  const t = v.normalize('NFC').trim().toLowerCase();
  const n = t === 'sí' ? 'si' : t;
  return (RESPUESTAS_DE_CAMPANA as readonly string[]).includes(n) ? (n as RespuestaDeCampana) : null;
}
export const respuestaDeCampanaValida = (v: unknown): boolean => normalizarRespuestaDeCampana(v) !== null;

/**
 * ¿El texto escrito es, exactamente, un «no» a la campaña? Tras NFD sin tildes, minúsculas, la coma pasada a espacio, los «.» y «!»
 * del final quitados (E8: «No.», «No gracias!») y los espacios colapsados, tiene que ser `no` o `no gracias`. Nada más:
 * «no me interesa» o «no, pero…» son conversación, no una baja.
 */
export function esNoEscritoDeCampana(texto: unknown): boolean {
  if (typeof texto !== 'string') return false;
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/,/g, ' ').replace(/[.!\s]+$/, '').replace(/\s+/g, ' ').trim();
  return t === 'no' || t === 'no gracias';
}

type Datos = Record<string, unknown> | undefined;
const aMs = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const f = (v as { toMillis?: unknown } | null)?.toMillis;
  if (typeof f === 'function') { const n = (f as () => unknown).call(v); return typeof n === 'number' && Number.isFinite(n) ? n : null; }
  return null;
};

export interface CampanaEnviada { idMeta: string; campanaId: string | null; enMs: number }
/** La última campaña enviada a esta persona, si sigue dentro de las 24 h; `null` si no hay o venció. */
export function campanaEnviadaDe(conv: Datos, ahoraMs: number): CampanaEnviada | null {
  const e = conv?.['campanaEnviada'] as Record<string, unknown> | undefined;
  if (typeof e !== 'object' || e === null) return null;
  const enMs = aMs(e['en']);
  if (!contextoIdValido(e['idMeta']) || enMs === null || ahoraMs - enMs > VENTANA_CAMPANA_MS) return null;
  return { idMeta: e['idMeta'], campanaId: campanaIdValido(e['campanaId']) ? e['campanaId'] : null, enMs };
}

export interface HechosDeCampana { citada: boolean; primeraEnVentana: boolean; campanaId: string | null }
/**
 * Lo que `configuracionFlujo` le dice al flujo, y lo que la ingesta vuelve a calcular antes de escribir: `citada` (el `context.id`
 * es el de la última campaña vigente), `primeraEnVentana` (hay una campaña vigente y la persona aún no le respondió) y su `campanaId`.
 * NUNCA incluye el idMeta.
 */
export function hechosDeCampana(conv: Datos, contextoId: unknown, ahoraMs: number): HechosDeCampana {
  const e = campanaEnviadaDe(conv, ahoraMs);
  if (e === null) return { citada: false, primeraEnVentana: false, campanaId: null };
  const previa = aMs((conv?.['campanaRespuesta'] as Record<string, unknown> | undefined)?.['en']);
  return {
    citada: contextoIdValido(contextoId) && contextoId === e.idMeta,
    primeraEnVentana: previa === null || previa < e.enMs,
    campanaId: e.campanaId,
  };
}

export interface EntradaDeCampana {
  respuesta: unknown; por?: unknown; campanaId?: unknown; contextoId?: unknown; texto?: unknown; idMetaEntrante?: unknown;
}
export type DecisionDeCampana =
  | { decision: 'reintento'; respuesta: RespuestaDeCampana | null }
  | { decision: 'baja'; respuesta: RespuestaDeCampana; campanaId: string | null }
  | { decision: 'respuesta'; respuesta: RespuestaDeCampana; campanaId: string | null }
  | { decision: 'invalida' }
  | { decision: 'no_aplica' };

/** La decisión, pura (ver el orden en la cabecera). `soloBaja`: comercio suspendido; un «sí» no escribe nada. */
export function resolverRespuestaDeCampana(
  conv: Datos, e: EntradaDeCampana, ahoraMs: number, opciones: { soloBaja?: boolean } = {},
): DecisionDeCampana {
  const respuesta = normalizarRespuestaDeCampana(e.respuesta);
  if (respuesta === null) return { decision: 'invalida' };
  // 1. Reintento de Meta: la misma entrega ya se aplicó.
  const previa = conv?.['campanaRespuesta'] as Record<string, unknown> | undefined;
  if (typeof e.idMetaEntrante === 'string' && e.idMetaEntrante !== '' && previa?.['idMetaEntrante'] === e.idMetaEntrante) {
    return { decision: 'reintento', respuesta: normalizarRespuestaDeCampana(previa['respuesta']) };
  }
  const por: RespuestaPor = respuestaPorValida(e.por) ? e.por : 'texto';
  const h = hechosDeCampana(conv, e.contextoId, ahoraMs);
  const propio = campanaIdValido(e.campanaId) ? e.campanaId : null;
  const id = propio ?? h.campanaId;
  // 2. Payload «no»: siempre baja (E3).
  if (por === 'payload' && respuesta === 'no') return { decision: 'baja', respuesta, campanaId: id };
  if (respuesta === 'si') {
    if (opciones.soloBaja === true) return { decision: 'invalida' };
    if (por === 'texto') return { decision: 'no_aplica' };
    // Un «sí» exige un id de campaña válido; el payload lo trae, la etiqueta lo toma de la campaña citada.
    if (por === 'payload' && propio === null) return { decision: 'invalida' };
    if (!h.citada) return { decision: 'no_aplica' };
    return id === null ? { decision: 'invalida' } : { decision: 'respuesta', respuesta, campanaId: id };
  }
  // «no» por etiqueta: con cita. «no» escrito: con cita o primera respuesta de la ventana, y solo si es exactamente «no».
  if (por === 'etiqueta') return h.citada ? { decision: 'baja', respuesta, campanaId: id } : { decision: 'no_aplica' };
  if (esNoEscritoDeCampana(e.texto) && (h.citada || h.primeraEnVentana)) return { decision: 'baja', respuesta, campanaId: id };
  return { decision: 'no_aplica' };
}

export type ResultadoDeCampana = 'baja' | 'ya_baja' | 'respuesta' | 'invalida' | 'no_aplica';

/**
 * Aplica la respuesta a la campaña dentro de la transacción `tx`. Devuelve `'baja'` si creó la baja, `'ya_baja'` si ya existía (no
 * se toca) o si es el reintento de un «no», `'respuesta'` si solo anotó la respuesta («sí»), `'invalida'` si la respuesta está
 * fuera de la lista o es un «sí» sin id de campaña válido, y `'no_aplica'` si la respuesta es válida pero no es de la campaña
 * (no hay cita, ni «no» escrito exacto). En los dos últimos no se escribe nada.
 *
 * `opciones.conversacion`: los datos de la conversación que la transacción ya leyó (cero lecturas nuevas); sin ella se lee aquí.
 * `soloBaja` (comercio suspendido): escribe ÚNICAMENTE `bajas/{wa_tel}`; no crea ni toca `conversaciones/{wa_tel}`.
 */
export async function aplicarRespuestaDeCampana(
  tx: Transaction, refConv: DocumentReference,
  datos: { campanaId: unknown; respuesta: unknown; por?: unknown; contextoId?: unknown; texto?: unknown; idMetaEntrante?: unknown },
  ahora: Timestamp, opciones: { soloBaja?: boolean; conversacion?: Record<string, unknown> | undefined } = {},
): Promise<ResultadoDeCampana> {
  const refBaja = refConv.parent.parent!.collection('bajas').doc(refConv.id);
  const conv = 'conversacion' in opciones ? opciones.conversacion : (await tx.get(refConv)).data();
  const d = resolverRespuestaDeCampana(conv, datos, ahora.toMillis(), { soloBaja: opciones.soloBaja });
  if (d.decision === 'invalida' || d.decision === 'no_aplica') return d.decision;
  if (d.decision === 'reintento') return d.respuesta === 'no' ? 'ya_baja' : 'respuesta';
  const existente = d.respuesta === 'no' ? await tx.get(refBaja) : null;
  if (opciones.soloBaja !== true) {
    const idMetaEntrante = typeof datos.idMetaEntrante === 'string' && datos.idMetaEntrante !== '' ? { idMetaEntrante: datos.idMetaEntrante } : {};
    tx.set(refConv, { campanaRespuesta: { campanaId: d.campanaId, respuesta: d.respuesta, en: ahora, ...idMetaEntrante } }, { merge: true });
  }
  if (existente === null) return 'respuesta';
  if (existente.exists) return 'ya_baja';
  tx.create(refBaja, { canal: 'whatsapp', origen: 'boton_campana', campanaId: d.campanaId, desde: ahora });
  return 'baja';
}
