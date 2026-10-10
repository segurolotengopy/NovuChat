/**
 * =============================================================================
 * BUSCAR UNA PALABRA EN LAS CONVERSACIONES — `buscarConversaciones` (CORE)
 * =============================================================================
 *
 * El teléfono y el nombre se buscan desde la consola, directo a Firestore. La
 * PALABRA dentro de los mensajes no: hay que consultar los mensajes de TODAS las
 * conversaciones del comercio (un `collectionGroup`), y abrir esa consulta en
 * las reglas dejaría a cualquier cuenta autenticada preguntar por los mensajes
 * de otro comercio con solo adivinar su id (decisión D3 del plan H1: ninguna
 * regla `{path=**}/mensajes` se abre). Esta callable es la única puerta.
 *
 * ENTRADA   `{tenantId, texto, cursor?}`. El servidor ignora cualquier otra clave.
 * SALIDA    `{palabras, resultados:[{conversacionId, telefono, mensajeId, ts,
 *            direccion, fragmento}], cursor}`. `ts` son milisegundos desde 1970.
 *            Nunca el texto completo del mensaje: solo un fragmento (≤ 100).
 *
 * LO QUE GARANTIZA, cada línea con una prueba que la niega
 * (`pruebas/core/buscar-conversaciones.test.ts`):
 *
 *  - **El permiso es el de las reglas para leer conversaciones** y se comprueba
 *    SOBRE EL COMERCIO PEDIDO (`exigirLectorDeConversaciones`, `acceso.ts`).
 *  - **La consulta lleva SIEMPRE `tenantId == el pedido`.** Sin ese filtro la
 *    palabra «alfajor» de otro comercio aparecería en esta lista.
 *  - **El cliente nunca manda una ruta.** El cursor es `wa_<teléfono>/<id>` con
 *    una forma cerrada, y la ruta se ARMA bajo el comercio pedido; además cada
 *    documento hallado debe vivir en `tenants/{t}/conversaciones/`. Un cursor de
 *    otra forma o que no existe responde «La búsqueda cambió».
 *  - **Segunda pasada**: el índice (`array-contains`) pregunta por UNA palabra
 *    (la más larga); si se escribieron varias, el mensaje debe contener TODAS
 *    (`mensajeContiene`). Los mensajes anteriores a la indexación no tienen
 *    `palabras` y no aparecen: se indexa desde ahora, el relleno no los toca.
 *  - **El texto buscado NUNCA se registra.** Los registros llevan comercio, uid,
 *    cuántas palabras, cuántos resultados y un código; el texto es lo que la
 *    persona quiere encontrar en la intimidad de sus clientes. Los errores de
 *    infraestructura se registran solo con su `code`.
 *  - **Mensajes de error FIJOS**, los del plan.
 *
 * PAGINACIÓN. Se leen lotes de 20 mensajes por el índice (orden: más nuevo
 * primero) y se queda con los que pasan la segunda pasada, hasta 20 resultados.
 * Con una sola palabra todo lo que trae el índice pasa; con varias, hasta 3
 * lotes por llamada (60 lecturas como máximo) para no devolver páginas vacías.
 * El cursor es el último documento DEVUELTO (si la página se llenó) o el último
 * LEÍDO (si se acabó el tope de lotes); `null` cuando ya no hay más.
 *
 * ÍNDICE. `CONSULTA_PALABRAS` describe la consulta y la prueba de índices
 * (`conversaciones-indices.test.ts`) exige que `firestore.indexes.json` la
 * tenga: `tenantId` ASC, `palabras` CONTAINS, `ts` DESC, alcance
 * COLLECTION_GROUP. El emulador no exige índices; si la callable se usa antes de
 * que el índice esté READY, Firestore responde FAILED_PRECONDITION y sale como
 * `unavailable`: por eso el orden de puesta en producción es índices, Functions
 * y, al final, la bandera de la pantalla.
 *
 * SIN App Check: el plan no lo pide para esta callable y exigirlo es un cambio
 * aparte, con medición previa (ver `verComprobante.ts`). Cero mensajes por
 * conversación. Costo por llamada: lecturas de la ficha (y de soporte, si es
 * soporte), una de cursor si lo hay, y 20 a 60 de mensajes; 0 escrituras.
 */
import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  Timestamp, getFirestore,
  type DocumentSnapshot, type Firestore, type Query, type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { exigirAutenticado } from '../seguridad/autorizacion.js';
import {
  ID_COMERCIO, MENSAJE_NO_DISPONIBLE, exigirLectorDeConversaciones,
} from './acceso.js';
import {
  MAX_PALABRAS_CONSULTA, MAX_RESULTADOS_BUSQUEDA, fragmento, mensajeContiene, palabraParaIndice, palabrasDe,
} from './normalizacion.js';

// ---------------------------------------------------------------------------
// CONTRATO
// ---------------------------------------------------------------------------

/** Los textos de error: lista cerrada y literal (plan H1, «Contrato»). */
export const MENSAJES = {
  sinSesion: 'Inicie sesión.',
  sinPermiso: 'No tiene permiso para buscar en estas conversaciones.',
  pocoTexto: 'Escriba al menos una palabra de 3 letras.',
  cursor: 'La búsqueda cambió; vuelva a buscar.',
  noDisponible: MENSAJE_NO_DISPONIBLE,
} as const;

/** La consulta, como datos: la prueba de índices la lee y la callable la arma con ella. */
export const CONSULTA_PALABRAS = Object.freeze({
  grupo: 'mensajes',
  igualdad: 'tenantId',
  contiene: 'palabras',
  orden: Object.freeze({ campo: 'ts', direccion: 'desc' as const }),
  limite: MAX_RESULTADOS_BUSQUEDA,
});

/** Largo máximo del texto buscado, en caracteres. */
export const MAX_TEXTO = 100;
/** Ancho del fragmento que se devuelve (tope del plan: 120). */
export const ANCHO_FRAGMENTO = 100;
/** Lotes de lectura por llamada (cada uno, de `MAX_RESULTADOS_BUSQUEDA` mensajes). */
export const MAX_LOTES = 3;

const CURSOR = /^(wa_[0-9]{8,15})\/([A-Za-z0-9]{20})$/;
const CONVERSACION = /^wa_[0-9]{8,15}$/;

export interface ResultadoDeBusqueda {
  conversacionId: string;
  telefono: string;
  mensajeId: string;
  /** Milisegundos desde 1970. */
  ts: number;
  direccion: 'entrante' | 'saliente';
  fragmento: string;
}

export interface SalidaDeBusqueda {
  palabras: string[];
  resultados: ResultadoDeBusqueda[];
  cursor: string | null;
}

// ---------------------------------------------------------------------------
// OPCIONES DE DESPLIEGUE
// ---------------------------------------------------------------------------

/**
 * Las opciones de la callable, en una función pura para probarlas. Región como
 * las demás, hasta 5 instancias y NINGUNA mínima (no se paga por tenerla
 * encendida). Sin `enforceAppCheck` y sin `concurrency`: ni el plan lo pide ni
 * hace falta tocar la cuota de CPU de staging.
 */
export function opcionesDeBuscarConversaciones(): CallableOptions {
  return { region: REGION, maxInstances: 5 };
}

// ---------------------------------------------------------------------------
// REGISTRO: nunca el texto buscado
// ---------------------------------------------------------------------------

interface DatosDeRegistro { tenantId?: unknown; uid?: string; palabras?: number; resultados?: number; motivo?: string }

/**
 * La única forma de registrar. Un campo por cada dato permitido: comercio (solo
 * si tiene la forma de un id de comercio, para que nadie escriba lo que quiera
 * en los registros), uid, cantidad de palabras, cantidad de resultados, código.
 */
function registrar(codigo: string, d: DatosDeRegistro = {}): void {
  const linea = {
    funcion: 'buscarConversaciones', codigo,
    ...(typeof d.tenantId === 'string' && ID_COMERCIO.test(d.tenantId) ? { tenantId: d.tenantId } : {}),
    ...(d.uid ? { uid: d.uid } : {}),
    ...(d.palabras !== undefined ? { palabras: d.palabras } : {}),
    ...(d.resultados !== undefined ? { resultados: d.resultados } : {}),
    ...(d.motivo ? { motivo: d.motivo } : {}),
  };
  if (codigo === 'ok') logger.info('buscarConversaciones', linea);
  else logger.warn('buscarConversaciones', linea);
}

/** De un error cualquiera, solo su `code` y solo si tiene forma de código. */
function codigoDe(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  const s = typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  return /^[A-Za-z0-9_./-]{1,40}$/.test(s) ? s : 'desconocido';
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// LA CALLABLE
// ---------------------------------------------------------------------------

export const buscarConversaciones = onCall(opcionesDeBuscarConversaciones(), async (p: CallableRequest) => {
  const datos = esObjeto(p.data) ? p.data : {};
  try {
    return await atender(p, datos, getFirestore(), Date.now());
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Un error que no es nuestro (Firestore, índice sin construir): solo su código.
    registrar('unavailable', { tenantId: datos['tenantId'], uid: p.auth?.uid, motivo: `error_${codigoDe(e)}` });
    throw new HttpsError('unavailable', MENSAJES.noDisponible);
  }
});

async function atender(
  p: CallableRequest, datos: Record<string, unknown>, db: Firestore, ahoraMs: number,
): Promise<SalidaDeBusqueda> {
  const tenantId = datos['tenantId'];

  // 1. Identidad y permiso sobre el comercio PEDIDO.
  let uid: string;
  try {
    uid = exigirAutenticado(p);
  } catch (e) {
    registrar('unauthenticated');
    throw e;
  }
  try {
    await exigirLectorDeConversaciones(p, tenantId, db, ahoraMs);
  } catch (e) {
    registrar(e instanceof HttpsError ? e.code : 'unavailable', { tenantId, uid });
    throw e;
  }
  const t = tenantId as string; // validado por `exigirLectorDeConversaciones`

  // 2. El texto: de 1 a 100 caracteres y con al menos una palabra de 3 letras.
  const texto = datos['texto'];
  const palabras = typeof texto === 'string' && texto.length >= 1 && texto.length <= MAX_TEXTO
    ? palabrasDe(texto, MAX_PALABRAS_CONSULTA) : [];
  const palabraIndice = palabraParaIndice(palabras);
  if (typeof texto !== 'string' || palabraIndice === null) {
    registrar('invalid-argument', { tenantId: t, uid, motivo: 'texto' });
    throw new HttpsError('invalid-argument', MENSAJES.pocoTexto);
  }

  // 3. El cursor: forma cerrada, ruta armada BAJO el comercio, y que exista.
  let inicio: DocumentSnapshot | null = null;
  const crudo = datos['cursor'];
  if (crudo !== undefined && crudo !== null) {
    const partes = typeof crudo === 'string' ? CURSOR.exec(crudo) : null;
    if (partes === null) {
      registrar('invalid-argument', { tenantId: t, uid, palabras: palabras.length, motivo: 'cursor' });
      throw new HttpsError('invalid-argument', MENSAJES.cursor);
    }
    const ref = db.doc(`tenants/${t}/conversaciones/${partes[1]}/mensajes/${partes[2]}`);
    if (!ref.path.startsWith(`tenants/${t}/conversaciones/`)) {
      registrar('invalid-argument', { tenantId: t, uid, palabras: palabras.length, motivo: 'cursor' });
      throw new HttpsError('invalid-argument', MENSAJES.cursor);
    }
    const snap = await ref.get();
    if (!snap.exists || !(snap.get('ts') instanceof Timestamp)) {
      registrar('invalid-argument', { tenantId: t, uid, palabras: palabras.length, motivo: 'cursor' });
      throw new HttpsError('invalid-argument', MENSAJES.cursor);
    }
    inicio = snap;
  }

  // 4. La consulta: SIEMPRE acotada al comercio pedido, por el índice, la más nueva primero.
  const base: Query = db.collectionGroup(CONSULTA_PALABRAS.grupo)
    .where(CONSULTA_PALABRAS.igualdad, '==', t)
    .where(CONSULTA_PALABRAS.contiene, 'array-contains', palabraIndice)
    .orderBy(CONSULTA_PALABRAS.orden.campo, CONSULTA_PALABRAS.orden.direccion)
    .limit(CONSULTA_PALABRAS.limite);

  const resultados: ResultadoDeBusqueda[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  const ya = new Set<string>(); // un mismo documento no se repite entre lotes
  for (let lote = 0; lote < MAX_LOTES; lote++) {
    const snap = await (inicio ? base.startAfter(inicio) : base).get();
    let llena = false;
    for (const d of snap.docs) {
      if (ya.has(d.ref.path)) continue;
      ya.add(d.ref.path);
      const r = aResultado(d, t, palabras);
      if (r) resultados.push(r);
      if (resultados.length >= MAX_RESULTADOS_BUSQUEDA) { cursor = d; llena = true; break; }
    }
    if (llena) break;
    if (snap.size < CONSULTA_PALABRAS.limite) { cursor = null; break; } // se acabó
    inicio = cursor = snap.docs[snap.docs.length - 1] ?? null;
  }

  registrar('ok', { tenantId: t, uid, palabras: palabras.length, resultados: resultados.length });
  return { palabras, resultados, cursor: cursor ? `${cursor.ref.parent.parent?.id}/${cursor.id}` : null };
}

/**
 * De un mensaje hallado al resultado, o `null` si no corresponde: otro comercio
 * (nunca debería, la consulta lo filtra; se vuelve a comprobar por la ruta),
 * una conversación con id raro, un texto que no es texto, o un mensaje que no
 * contiene TODAS las palabras buscadas.
 */
function aResultado(
  d: QueryDocumentSnapshot, tenantId: string, palabras: readonly string[],
): ResultadoDeBusqueda | null {
  if (!d.ref.path.startsWith(`tenants/${tenantId}/conversaciones/`)) return null;
  const conversacionId = d.ref.parent.parent?.id;
  if (typeof conversacionId !== 'string' || !CONVERSACION.test(conversacionId)) return null;
  const texto: unknown = d.get('texto');
  const ts: unknown = d.get('ts');
  if (typeof texto !== 'string' || !(ts instanceof Timestamp)) return null;
  const guardadas: unknown = d.get('palabras');
  const delMensaje = Array.isArray(guardadas) ? guardadas.filter((x): x is string => typeof x === 'string') : undefined;
  if (!mensajeContiene(delMensaje, texto, palabras)) return null;
  return {
    conversacionId,
    telefono: conversacionId.slice(3),
    mensajeId: d.id,
    ts: ts.toMillis(),
    direccion: d.get('direccion') === 'entrante' ? 'entrante' : 'saliente',
    fragmento: fragmento(texto, palabras, ANCHO_FRAGMENTO),
  };
}
