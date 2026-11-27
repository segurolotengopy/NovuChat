/**
 * =============================================================================
 * BAJAS DE LA CAMPAÑA SALIENTE — `tenants/{t}/bajas/{wa_tel}` (CORE, PR-A)
 * =============================================================================
 *
 * Cuando una persona toca «No, gracias» en la plantilla de la campaña saliente, queda una BAJA: el comercio no
 * le vuelve a mandar una campaña. Es una colección cerrada de Core (`registro.ts`, reglas `allow read, write: if
 * false`): la escribe SOLO la ingesta, con el SDK Admin, en la MISMA transacción que guarda el mensaje entrante.
 * Nadie la lee desde el navegador; la lista de una campaña la arma un script del servidor.
 *
 *   bajas/{wa_tel} = { canal: 'whatsapp', origen: 'boton_campana', campanaId, desde }
 *
 * CLAVE DE LA BAJA (declarada, M2): `wa_` seguido de los dígitos de `messages[0].from`, tal cual llegan (sin `+` ni espacios
 * internos; la ingesta rechaza el mensaje entero si los trae). Una variante sin el 591 sería OTRA clave. La lista que arme
 * el PR-C debe usar exactamente ese formato.
 *
 * Idempotente y sin pisar: si la baja ya existe NO se reescribe (`desde` conserva el instante de la primera). Con «sí»
 * o «no» se anota además `campanaRespuesta: { campanaId, respuesta, en }` en la conversación (la «nota en la ficha»; la
 * consola no la muestra todavía y ningún cliente puede escribirla: ver `firestore.rules`).
 *
 * LECTURAS ANTES QUE ESCRITURAS: `aplicarRespuestaDeCampana` lee la baja y, solo después, escribe; quien la llama tiene
 * que invocarla antes de su primera escritura de la transacción.
 */
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

/** El identificador de una campaña saliente: minúsculas, dígitos y guiones, de 3 a 40. */
export const CAMPANA_ID = /^[a-z0-9-]{3,40}$/;
export const RESPUESTAS_DE_CAMPANA = ['si', 'no'] as const;
export type RespuestaDeCampana = (typeof RESPUESTAS_DE_CAMPANA)[number];

export const campanaIdValido = (v: unknown): v is string => typeof v === 'string' && CAMPANA_ID.test(v);
/**
 * La respuesta normalizada («No», « no », «NO» → `no`; «Sí», «si» → `si`), o `null` si no es ninguna de las dos. Solo recorta
 * espacios, pasa a minúsculas y quita la tilde de «sí»: «nop» o «no gracias» NO valen (eso es un texto escrito, no el botón).
 */
export function normalizarRespuestaDeCampana(v: unknown): RespuestaDeCampana | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  const n = t === 'sí' ? 'si' : t;
  return (RESPUESTAS_DE_CAMPANA as readonly string[]).includes(n) ? (n as RespuestaDeCampana) : null;
}
export const respuestaDeCampanaValida = (v: unknown): boolean => normalizarRespuestaDeCampana(v) !== null;

/**
 * Aplica la respuesta a la campaña dentro de la transacción `tx`. Devuelve `'baja'` si creó la baja, `'ya_baja'` si ya
 * existía (no se toca), `'respuesta'` si solo anotó la respuesta («sí»), o `'invalida'` si la respuesta está fuera de la lista, o es un «sí» sin id
 * de campaña válido (no se escribe nada). Un «no» con id inválido SÍ crea la baja, con `campanaId: null`.
 */
export async function aplicarRespuestaDeCampana(
  tx: Transaction, refConv: DocumentReference, datos: { campanaId: unknown; respuesta: unknown }, ahora: Timestamp,
): Promise<'baja' | 'ya_baja' | 'respuesta' | 'invalida'> {
  const { campanaId } = datos;
  const respuesta = normalizarRespuestaDeCampana(datos.respuesta);
  if (respuesta === null) return 'invalida';
  // Un «no» NUNCA se pierde: sin un id de campaña válido igual se crea la baja (`campanaId: null`). Un «sí» sin id no escribe nada.
  const id = campanaIdValido(campanaId) ? campanaId : null;
  if (id === null && respuesta === 'si') return 'invalida';
  const refBaja = refConv.parent.parent!.collection('bajas').doc(refConv.id);
  const existente = respuesta === 'no' ? await tx.get(refBaja) : null;
  tx.set(refConv, { campanaRespuesta: { campanaId: id, respuesta, en: ahora } }, { merge: true });
  if (existente === null) return 'respuesta';
  if (existente.exists) return 'ya_baja';
  tx.create(refBaja, { canal: 'whatsapp', origen: 'boton_campana', campanaId: id, desde: ahora });
  return 'baja';
}
