/**
 * LA FUNCTION QUE VERIFICA EL COMPORTAMIENTO GENERAL ANTES DE APLICARLO.
 *
 * Se dispara con cada escritura de `tenants/{t}/config/negocio` y actúa solo
 * cuando cambió `instruccionesExtra` (lo propuesto). Corre las dos capas de
 * `comportamiento.ts` y escribe el resultado donde el navegador NO puede:
 *
 *   - `instruccionesRevision` siempre (estado, motivo, hash, capa, quién, cuándo);
 *   - `instruccionesVigentes` SOLO si aprobó. Un rechazo o un «no se pudo
 *     verificar» dejan vigente lo último aprobado: el asistente sigue con lo
 *     que ya se revisó, nunca con lo nuevo sin revisar.
 *
 * POR QUÉ UN DISPARADOR Y NO UNA CALLABLE. La consola escribe la configuración
 * directamente en Firestore, con las reglas validando el esquema, y así tiene
 * que seguir: no hay ninguna Function por la que pase el guardado. Con el
 * disparador, el camino de la consola no cambia y la verificación no se puede
 * saltear —una petición armada a mano llega igual a Firestore y dispara igual—.
 * Es la regla de la base comercial §7 aplicada a la seguridad: un control que
 * solo existe en la pantalla no existe.
 *
 * SIN CLAVE DEL MODELO, NO SE APRUEBA. `GEMINI_API_KEY` se lee del entorno,
 * como en `imagenCatalogo.ts`, para que su ausencia degrade en vez de romper el
 * despliegue; pero acá degradar es dejar el texto `pendiente`, no aprobarlo.
 * Un revisor ausente no es un revisor que dice que sí.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { REGION } from './region.js';
import { CLAVE_GEMINI, claveGemini } from './imagenCatalogo.js';
import {
  REVISOR_FUNCTION, hashCorto, revisarTexto,
  type ConsultarModelo, type OtrosComercios, type Revision,
} from './comportamiento.js';

/** El mismo modelo que la comprobación de fotos; temperatura 0 y salida corta. */
const MODELO = 'gemini-3.5-flash-lite';
const TIEMPO_MAXIMO_MS = 15_000;

/** Llama a Gemini y devuelve el texto de la respuesta, o `undefined` si no hubo. */
export async function consultarGemini(instruccion: string): Promise<string | undefined> {
  const clave = claveGemini();
  if (clave === '') return undefined;
  const cuerpo = {
    contents: [{ parts: [{ text: instruccion }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 120 },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    },
  ).catch(() => null);
  if (!r || !r.ok) return undefined;
  const j = await r.json().catch(() => null) as
    { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
  const texto = j?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  return typeof texto === 'string' && texto.trim() !== '' ? texto : undefined;
}

const textoDe = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Los demás comercios, para la capa 1: identificadores y nombres, sin el
 * propio. Se leen con el SDK Admin; ninguno viaja al motivo ni al modelo.
 */
export async function otrosComercios(db: Firestore, tenantId: string): Promise<OtrosComercios> {
  const todos = await db.collection('tenants').select('nombre').get();
  const ids: string[] = [];
  const nombres: string[] = [];
  for (const d of todos.docs) {
    if (d.id === tenantId) continue;
    ids.push(d.id);
    const nombre = d.get('nombre');
    if (typeof nombre === 'string') nombres.push(nombre);
  }
  return { ids, nombres };
}

export type ResultadoAplicar = 'aplicado' | 'obsoleto' | 'sin_documento';

/**
 * Escribe el veredicto. En una transacción, y con una condición: el texto que
 * se revisó tiene que seguir siendo el propuesto. Si el comercio guardó otra
 * vez mientras el modelo pensaba, este veredicto es de un texto que ya no
 * existe y no se escribe; la escritura nueva disparó su propia revisión.
 */
export async function aplicarRevision(
  db: Firestore, tenantId: string, texto: string, revision: Revision, revisadoPor: string,
): Promise<ResultadoAplicar> {
  const ref = db.doc(`tenants/${tenantId}/config/negocio`);
  const resultado = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return 'sin_documento' as const;
    if (textoDe(doc.get('instruccionesExtra')) !== texto) return 'obsoleto' as const;
    tx.update(ref, {
      instruccionesRevision: {
        estado: revision.estado,
        motivo: revision.motivo,
        hash: revision.hash,
        capa: revision.capa,
        revisadoPor,
        revisadoEn: Timestamp.now(),
      },
      ...(revision.estado === 'aprobado' ? { instruccionesVigentes: texto } : {}),
    });
    return 'aplicado' as const;
  });
  if (resultado === 'aplicado') {
    await db.collection(`tenants/${tenantId}/auditoria`).add({
      accion: 'revisar_comportamiento', uid: revisadoPor, en: Timestamp.now(),
      estado: revision.estado, capa: revision.capa, hash: revision.hash, motivo: revision.motivo,
      // La magnitud, nunca el texto: la auditoría la lee el propietario.
      caracteres: texto.length,
    });
  }
  return resultado;
}

/**
 * Las dos capas y la escritura, juntas. Es lo que corre el disparador y lo
 * que prueban las suites, con el modelo simulado.
 */
export async function revisarYAplicar(
  db: Firestore, tenantId: string, texto: string, consultar: ConsultarModelo,
  revisadoPor: string = REVISOR_FUNCTION,
): Promise<{ revision: Revision; resultado: ResultadoAplicar }> {
  const otros = texto.trim() === '' ? { ids: [], nombres: [] } : await otrosComercios(db, tenantId);
  const revision = await revisarTexto(texto, otros, consultar);
  const resultado = await aplicarRevision(db, tenantId, texto, revision, revisadoPor);
  return { revision, resultado };
}

/**
 * ¿Hay que revisar esta escritura? Solo si cambió lo propuesto y la revisión
 * guardada no es ya de ESE texto. La segunda condición es lo que hace que la
 * carga de NovuChat (`cargar-negocio.mjs`, que deja propuesto, vigente y
 * revisión aprobada en una sola escritura) no dispare una segunda revisión, y
 * que un reintento del disparador no cueste otra llamada al modelo. Un
 * `pendiente` con el mismo hash SÍ se vuelve a intentar.
 */
export function hayQueRevisar(
  antes: Record<string, unknown>, despues: Record<string, unknown>,
): boolean {
  const propuesto = textoDe(despues['instruccionesExtra']);
  if (textoDe(antes['instruccionesExtra']) === propuesto) return false;
  const revision = despues['instruccionesRevision'];
  if (typeof revision === 'object' && revision !== null) {
    const r = revision as Record<string, unknown>;
    if (r['hash'] === hashCorto(propuesto) && r['estado'] !== 'pendiente') return false;
  }
  return true;
}

export const verificarComportamiento = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/config/negocio',
    region: REGION,
    secrets: [CLAVE_GEMINI],
    maxInstances: 3,
    timeoutSeconds: 60,
  },
  async (evento) => {
    if (!evento.data?.after.exists) return;
    const antes = (evento.data.before.data() ?? {}) as Record<string, unknown>;
    const despues = (evento.data.after.data() ?? {}) as Record<string, unknown>;
    if (!hayQueRevisar(antes, despues)) return;

    const tenantId = evento.params.tenantId;
    const texto = textoDe(despues['instruccionesExtra']);
    const { revision, resultado } = await revisarYAplicar(getFirestore(), tenantId, texto, consultarGemini);
    // Nunca el texto: el estado, la capa y el hash bastan para seguirle la pista.
    logger.info('verificarComportamiento', {
      tenantId, estado: revision.estado, capa: revision.capa, hash: revision.hash, resultado,
      caracteres: texto.length,
    });
  },
);
