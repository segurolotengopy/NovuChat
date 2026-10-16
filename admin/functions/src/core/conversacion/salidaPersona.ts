/**
 * =============================================================================
 * LO QUE COMPARTEN EL ENVÍO, EL RECLAMO Y LA CONFIRMACIÓN DE UN MENSAJE DE PERSONA (CORE, H2-3)
 * =============================================================================
 *
 * Contrato único de H2 (16/10/2026), §4: la persona NO envía a Meta desde la Function. El camino es
 *
 *   consola -> `enviarComoPersona` (valida, escribe el mensaje `pendiente`) -> TIMBRE al flujo n8n
 *   «Salida de persona» -> `reclamarSalidaPersona` (pendiente -> enviando, atómico) -> el flujo envía
 *   por el relé B9 o por Graph -> `confirmarSalidaPersona` (aceptado | rechazado | incierto).
 *
 * Este archivo tiene lo que dos o tres de esas piezas necesitan: las constantes, la huella que ata una
 * clave a su envío, la clave del relé y el TIMBRE.
 *
 * LOS ESTADOS DEL MENSAJE (`mensajes/{clave}.estadoEnvio`):
 *
 *   pendiente  --reclamar-->  enviando  --confirmar-->  aceptado | rechazado | incierto
 *   enviando por más de 2 min (nadie confirmó)          -->  incierto   (lo marca el siguiente reclamo)
 *   incierto   --confirmar (UNA sola vez)-->            aceptado | rechazado
 *
 * Un 504 del relé, un tiempo agotado o un `enviando` viejo quedan `incierto` y NO se reenvían solos:
 * reenviar es decisión de la persona, con una clave nueva. Reenviar solo duplicaría un mensaje que
 * quizá sí llegó, y a un cliente de verdad no se le manda dos veces lo mismo.
 *
 * EL TIMBRE. Un POST SIN DATOS al webhook del flujo «Salida de persona» de ese número. Sin datos a
 * propósito: el mensaje no viaja por ahí (el flujo lo reclama), así que un timbre capturado no revela ni
 * permite alterar nada, y tocarlo dos veces es inofensivo (el segundo reclamo no encuentra nada). La
 * RUTA del webhook es una URL de capacidad y vive solo en Secret Manager (`SALIDA_PERSONA_RUTAS`), nunca
 * en el repositorio, en un log ni en Firestore:
 *
 *     { "<aliasSecreto>": { "ruta": "https://…", "clave": "…" } }
 *
 * La clave del alias es la de `rutasWhatsApp/{n}.aliasSecreto` (la misma que usa la ingesta). La `clave`
 * de adentro es la del Header Auth del webhook de n8n; no es la de la ingesta: comprometer una no abre la
 * otra. Van las dos formas, como en `despertarFlujo` del catálogo web: `Authorization: Bearer <clave>`
 * (lo que n8n verifica hoy sin escribir código) y la firma HMAC de la marca de tiempo (para el día que el
 * flujo la verifique). El secreto tiene que existir, con `secretAccessor` para `sa-functions`, ANTES de
 * desplegar: es un paso de producción que pide la coordinadora con el «sí» de Andres.
 *
 * UN SOLO SECRETO con todos los timbres (aceptado): al ampliar a más números se pasa a uno por alias, para que
 * comprometer uno no entregue los demás.
 *
 * Un timbre que falla NO falla el envío: el mensaje ya está guardado como `pendiente` y el siguiente
 * timbre (de cualquier envío del comercio) lo reclama. La persona ve `pendiente`, nunca un éxito falso.
 */
import { createHash, createHmac } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// CONSTANTES (con nombre: ninguna cifra suelta en el código que las usa)
// ---------------------------------------------------------------------------

/** El texto de un mensaje de persona: de 1 a 1.000 caracteres (contrato §2). */
export const TEXTO_MAXIMO = 1000;
/** La clave de idempotencia: 16 a 128 caracteres, generada por la consola, una por envío lógico. */
export const CLAVE_DE_ENVIO = /^[A-Za-z0-9_.:-]{16,128}$/;
/**
 * Tras un entrante sin responder, la persona espera 45 s antes de poder enviar (contrato §9): entre que
 * el asistente leyó «nadie atiende» y que el modelo contesta pasan de 5 a 20 s, y en esa carrera la persona
 * y el asistente le hablarían al cliente a la vez.
 */
export const BLOQUEO_DE_CARRERA_MS = 45_000;
/** Un `enviando` más viejo que esto se da por `incierto` (contrato §4). */
export const ENVIANDO_MAXIMO_MS = 2 * 60_000;
/**
 * Un `pendiente` más viejo que esto, o cuya ventana de Meta ya se cerró, no se entrega: pasa a `rechazado`
 * con el código `caducado` (reintentable), sin contar. Un mensaje que esperó minutos por un timbre perdido
 * ya no es lo que la persona quiso decir, y fuera de la ventana Meta lo rechazaría.
 */
export const PENDIENTE_MAXIMO_MS = 2 * 60_000;
export const CODIGO_CADUCADO = 'caducado';
/** Cuántos mensajes entrega un reclamo, como máximo. */
export const MAXIMO_POR_RECLAMO = 10;
/** Cuánto espera la Function al webhook del timbre (el flujo responde de inmediato). */
export const ESPERA_DEL_TIMBRE_MS = 4000;

export type EstadoDeEnvio = 'pendiente' | 'enviando' | 'aceptado' | 'rechazado' | 'incierto';
export const ESTADOS_DE_ENVIO: readonly EstadoDeEnvio[] = ['pendiente', 'enviando', 'aceptado', 'rechazado', 'incierto'];

/** El camino de salida de un número: el relé B9 o Graph directo (Q'Taco hasta el traslado). */
export type CanalDeSalida = 'rele' | 'graph';
/**
 * Un número sin `canalSalida` sale como sale hoy, por Graph desde n8n: pasar al relé es una decisión por
 * número (`rutasWhatsApp/{n}.canalSalida = 'rele'`), no un cambio global.
 */
export const CANAL_DE_SALIDA_POR_DEFECTO: CanalDeSalida = 'graph';
export const canalDeSalidaDe = (ruta: Record<string, unknown> | null | undefined): CanalDeSalida =>
  ruta?.['canalSalida'] === 'rele' ? 'rele' : CANAL_DE_SALIDA_POR_DEFECTO;

/** El código de un rechazo: el de Meta (131047…) o el del relé (WM-30xx), como texto corto. */
export const CODIGO_DE_ENVIO = /^[A-Za-z0-9_.-]{1,40}$/;
/** El id que Meta devuelve al aceptar un mensaje. */
export const ID_META = /^[A-Za-z0-9_.=:+/-]{1,120}$/;

// ---------------------------------------------------------------------------
// LA CLAVE Y SU HUELLA
// ---------------------------------------------------------------------------

const sha256 = (...partes: string[]): string => {
  const h = createHash('sha256');
  partes.forEach((p, i) => { if (i > 0) h.update('\n'); h.update(p); });
  return h.digest('hex');
};

/**
 * Lo que ata una clave a su envío: (conversación, persona, texto). Una clave ya usada con otro texto, otra
 * persona u otra conversación NO se reutiliza (`failed-precondition`); con los mismos datos devuelve lo
 * guardado. Se guarda el hash y no se compara el texto en claro, para que el motivo del rechazo no dependa
 * de qué se muestre.
 */
export const huellaDeEnvio = (conversacionId: string, uid: string, texto: string): string =>
  sha256('huella', conversacionId, uid, texto);

/**
 * La Idempotency-Key del relé: 48 hex del hash de (comercio, conversación, clave). Estable para el mismo
 * mensaje —un reintento del flujo no duplica— y distinta entre comercios aunque dos consolas generen la
 * misma clave. No revela la clave de la consola.
 */
export const claveReleDe = (tenantId: string, conversacionId: string, clave: string): string =>
  sha256('rele', tenantId, conversacionId, clave).slice(0, 48);

// ---------------------------------------------------------------------------
// EL TIMBRE
// ---------------------------------------------------------------------------

/** El secreto con el mapa alias -> { ruta, clave }. Declararlo exige que EXISTA al desplegar. */
export const SECRETO_DE_SALIDA_PERSONA = defineSecret('SALIDA_PERSONA_RUTAS');

export interface DestinoDeTimbre { ruta: string; clave: string }

/** ¿Una URL https, sin usuario ni contraseña, que sirva de webhook? Nunca http. */
function rutaDeTimbreValida(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * El destino del timbre para un alias, o `null`. Lee el JSON del secreto sin fiarse de su forma: un JSON
 * roto, un alias ausente, una ruta que no es https o una clave vacía dan `null` (no se toca el timbre y el
 * mensaje queda `pendiente`). Nunca devuelve ni registra el contenido del secreto entero.
 */
export function destinoDeTimbre(secretoCrudo: string, alias: string): DestinoDeTimbre | null {
  let mapa: unknown;
  try { mapa = JSON.parse(secretoCrudo); } catch { return null; }
  if (typeof mapa !== 'object' || mapa === null || Array.isArray(mapa)) return null;
  if (!Object.hasOwn(mapa, alias)) return null;
  const d = (mapa as Record<string, unknown>)[alias];
  if (typeof d !== 'object' || d === null) return null;
  const { ruta, clave } = d as Record<string, unknown>;
  if (!rutaDeTimbreValida(ruta) || typeof clave !== 'string' || clave.length < 8) return null;
  return { ruta, clave };
}

export type TocarTimbre = (alias: string, phoneNumberId: string, ahoraMs: number) => Promise<boolean>;

/**
 * Toca el timbre: POST sin datos con `Authorization: Bearer <clave>`, `X-NovuChat-Numero`, la marca de
 * tiempo y la firma HMAC de `"<marca>."` (cuerpo vacío). `true` si el flujo respondió 2xx. Cualquier
 * falla (secreto ausente, red, tiempo) es `false`: el llamador no explica por qué ni registra la ruta.
 */
export const tocarTimbre: TocarTimbre = async (alias, phoneNumberId, ahoraMs) => {
  try {
    const destino = destinoDeTimbre(SECRETO_DE_SALIDA_PERSONA.value(), alias);
    if (!destino) return false;
    const marca = String(ahoraMs);
    const firma = createHmac('sha256', destino.clave).update(`${marca}.`).digest('hex');
    const r = await fetch(destino.ruta, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${destino.clave}`,
        'X-NovuChat-Numero': phoneNumberId,
        'X-NovuChat-Timestamp': marca,
        'X-NovuChat-Signature': `sha256=${firma}`,
      },
      redirect: 'error', // un redirect llevaría la cabecera con la clave a otro destino
      signal: AbortSignal.timeout(ESPERA_DEL_TIMBRE_MS),
    });
    return r.ok;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// EL CONTEO DEL MES: `mensajesPersona`
// ---------------------------------------------------------------------------

/**
 * Suma (o resta) al agregado del mes `mensajesPersona`, dentro de la transacción que cambia el estado.
 * Cuenta el `aceptado` y el `incierto` (pudo haber llegado y Meta lo cobra); el `rechazado` no. Un
 * `incierto` que después resulta `rechazado` se resta una vez. NO toca `salientes` ni `mensajes`: eso
 * es del asistente y de la ingesta, que cuentan con otra regla (la franquicia de 1.000 gratis).
 * El período es el mes en UTC, el mismo de `periodoDe` en Central (`aaaa-mm`).
 */
export function sumarMensajePersona(tx: Transaction, db: Firestore, tenantId: string, ahoraMs: number, n: 1 | -1): void {
  const periodo = new Date(ahoraMs).toISOString().slice(0, 7);
  tx.set(db.doc(`tenants/${tenantId}/metricas/${periodo}`), { mensajesPersona: FieldValue.increment(n) }, { merge: true });
}
