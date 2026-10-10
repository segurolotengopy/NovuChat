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
 *  - **El permiso** se comprueba SOBRE EL COMERCIO PEDIDO
 *    (`exigirLectorDeConversaciones`, `acceso.ts`): el de las reglas para leer
 *    conversaciones, y para el soporte además exige comercio activo o suspendido.
 *  - **La consulta lleva SIEMPRE `tenantId == el pedido`.** Sin ese filtro la
 *    palabra «alfajor» de otro comercio aparecería en esta lista.
 *  - **El cliente nunca manda una ruta.** El cursor es `wa_<teléfono>/<id>` con
 *    una forma cerrada, y la ruta se ARMA bajo el comercio pedido; además cada
 *    documento hallado debe vivir en `tenants/{t}/conversaciones/`. Un cursor de
 *    otra forma o que no existe responde «La búsqueda cambió».
 *  - **El cursor que SALE también pasa por esa guarda**: nunca se devuelve la
 *    posición de un documento que no sea de este comercio o de una conversación
 *    con id irregular (un dato corrupto no puede fabricar un cursor que la
 *    página siguiente rechace ni filtrar el teléfono de otro comercio).
 *  - **Segunda pasada**: el índice (`array-contains`) pregunta por UNA palabra
 *    (la más larga); si se escribieron varias, el mensaje debe contener TODAS
 *    (`mensajeContiene`). Los mensajes anteriores a la indexación no tienen
 *    `palabras` y no aparecen: se indexa desde ahora, el relleno no los toca.
 *  - **El texto buscado NUNCA se registra.** Los registros llevan comercio, uid,
 *    rol, cuántas palabras, cuántos resultados y un código; el texto es lo que la
 *    persona quiere encontrar en la intimidad de sus clientes, y tampoco hay
 *    teléfonos en los registros. Los errores de infraestructura se registran solo
 *    con su `code`.
 *  - **Mensajes de error FIJOS**, los del plan.
 *  - **Un tope por usuario** (abuso de lecturas por una cuenta del comercio): 120
 *    búsquedas por hora y 600 por día, contadas en el servidor, en un documento
 *    transaccional `topesDeBusqueda/{uid}` (global, no por comercio). Las reglas lo
 *    niegan todo al navegador: la negación final de `firestore.rules` cierra esa
 *    colección y la prueba lo demuestra. Solo cuentan las búsquedas ya
 *    autorizadas y bien formadas (las que de verdad leen mensajes).
 *  - **App Check y concurrencia** por entorno (`opcionesDeBuscarConversaciones`),
 *    con el mismo patrón que el visor de comprobantes.
 *
 * ESTADO DEL CONTRATO DE PAGINACIÓN (decisión de la coordinadora, 10/10/2026).
 * Se leen lotes de 20 mensajes por el índice (más nuevo primero) y se queda con
 * los que pasan la segunda pasada, hasta 20 resultados. Con una sola palabra todo
 * lo que trae el índice pasa; con varias, se leen hasta 3 lotes por llamada (60
 * lecturas como máximo) para no devolver páginas vacías.
 *
 *   `resultados: []` con `cursor !== null` significa «sin resultados en lo
 *   reciente; se puede buscar más atrás». NO es un error ni el final: la consola
 *   lo muestra así y ofrece seguir con ese cursor. El final es `cursor: null`.
 *
 * El cursor es el último documento DEVUELTO (si la página se llenó) o, si se
 * acabó el tope de lotes, el último documento LEÍDO del último lote que además
 * sea de este comercio y de una conversación con id regular. Si ninguno lo es, el
 * cursor es `null` (se registra `cursor_irregular`): la paginación termina antes
 * que devolver una posición que no se puede reanudar. Un documento con id de
 * mensaje que no sea un id automático de 20 caracteres no se devuelve: su cursor
 * no podría reanudarse (la ingesta siempre genera ids automáticos).
 *
 * DEFENSA EN PROFUNDIDAD. La guarda de ruta y de forma de id sobre cada documento
 * hallado, y el `Set` de documentos ya vistos entre lotes, son inalcanzables por
 * pruebas de caja negra con datos sanos (la consulta ya filtra por `tenantId` y
 * `startAfter` no repite): quedan por si un dato corrupto o un cambio futuro de la
 * consulta rompen esas premisas. Lo que sí se prueba es la guarda con datos
 * corruptos sembrados a propósito.
 *
 * ÍNDICE. `CONSULTA_PALABRAS` describe la consulta y la prueba de índices
 * (`conversaciones-indices.test.ts`, que vive en el PR de la consola, H1-3) exige
 * que `firestore.indexes.json` la tenga; la misma forma se comprueba acá en el
 * bloque «el despliegue» de `buscar-conversaciones.test.ts`: `tenantId` ASC,
 * `palabras` CONTAINS, `ts` DESC, alcance COLLECTION_GROUP. El emulador no exige
 * índices; si la callable se usa antes de que el índice esté READY, Firestore
 * responde FAILED_PRECONDITION y sale como `unavailable`: por eso el orden de
 * puesta en producción es índices, Functions y, al final, la bandera de la
 * pantalla.
 *
 * COSTO por llamada, una vez desplegada: lecturas de la ficha (y de soporte, si es
 * soporte), una del tope y UNA ESCRITURA del tope (120 búsquedas por hora y 600 por
 * día por usuario, como mucho), una del cursor si lo hay, y 20 a 60 de mensajes.
 * Cero mensajes por conversación.
 */
import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import {
  Timestamp, getFirestore,
  type DocumentSnapshot, type Firestore, type Query, type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { exigirAutenticado } from '../seguridad/autorizacion.js';
import type { RolVerificado } from '../seguridad/vigencia.js';
import {
  ID_COMERCIO, MENSAJE_NO_DISPONIBLE, MENSAJE_SIN_PERMISO, exigirLectorDeConversaciones,
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
  sinPermiso: MENSAJE_SIN_PERMISO,
  pocoTexto: 'Escriba al menos una palabra de 3 letras.',
  cursor: 'La búsqueda cambió; vuelva a buscar.',
  tope: 'Hizo demasiadas búsquedas. Espere un momento e intente de nuevo.',
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
/**
 * El tope por usuario: búsquedas por hora y por día (La Paz). Son más altos que los 30/100 del
 * visor de comprobantes porque ESTA callable la llama la consola en cada búsqueda por texto (con
 * rebote de 350 ms): una persona normal hace varias llamadas por búsqueda. El abuso queda acotado
 * igual: 120 por hora x 60 lecturas = 7.200 lecturas por hora por cuenta, como máximo.
 */
export const TOPE_POR_HORA = 120;
export const TOPE_POR_DIA = 600;

const CURSOR = /^(wa_[0-9]{8,15})\/([A-Za-z0-9]{20})$/;
const CONVERSACION = /^wa_[0-9]{8,15}$/;
const MENSAJE_ID = /^[A-Za-z0-9]{20}$/;
/** Un uid de Firebase Auth como id de documento. */
const UID_SEGURO = /^[A-Za-z0-9_-]{1,128}$/;

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
// OPCIONES DE DESPLIEGUE (App Check por entorno, concurrencia solo fuera de staging)
// ---------------------------------------------------------------------------

/**
 * ¿Se exige App Check? En producción sí (la consola ya lo inicializa y manda el
 * token); en staging no (su build no lleva la clave del sitio) y en el emulador
 * tampoco. Una constante y no una variable de entorno, a propósito: el mismo
 * patrón que `APP_CHECK_DEL_VISOR`.
 */
export const APP_CHECK_DE_BUSQUEDA = { produccion: true, staging: false } as const;

/** Concurrencia por instancia fuera de staging (con 1 vCPU; cada búsqueda espera a Firestore, no calcula). */
export const CONCURRENCIA_DE_BUSQUEDA = 10;

/**
 * Las opciones de la callable, en una función pura para probarlas. Región como
 * las demás, hasta 5 instancias y NINGUNA mínima (no se paga por tenerla
 * encendida).
 *
 * CONCURRENCIA: `concurrency` solo FUERA de staging. En staging
 * (`CPU_FRACCIONARIA === 'si'`, `gcf_gen1` = menos de 1 vCPU) firebase-tools
 * rechaza una concurrencia mayor que 1 y la baja sola a 1 si no se declara
 * (`opcionesGlobales.ts`); por eso ahí no se escribe. En producción, con la
 * memoria por defecto, la CPU resuelve a 1 vCPU y la concurrencia declarada vale.
 * Sin variable de entorno nueva: el CI de producción exige un `.env` exacto.
 */
export function opcionesDeBuscarConversaciones(env: Record<string, string | undefined> = process.env): CallableOptions {
  const staging = env['CPU_FRACCIONARIA'] === 'si';
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  return {
    region: REGION,
    maxInstances: 5,
    ...(staging ? {} : { concurrency: CONCURRENCIA_DE_BUSQUEDA }),
    enforceAppCheck: emulador ? false : staging ? APP_CHECK_DE_BUSQUEDA.staging : APP_CHECK_DE_BUSQUEDA.produccion,
  };
}

// ---------------------------------------------------------------------------
// EL TOPE POR USUARIO
// ---------------------------------------------------------------------------

const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Consume un cupo del usuario, en UNA transacción sobre `topesDeBusqueda/{uid}`:
 * `{hora:'aaaa-mm-ddThh' (La Paz), busquedasHora, dia:'aaaa-mm-dd',
 * busquedasDia, actualizadoEn}`. Devuelve `null` si hay cupo, o el motivo
 * (`tope_hora` / `tope_dia`) si ya llegó a 120 en la hora o a 600 en el día; en
 * ese caso NO escribe. Un contador ilegible se trata como agotado (falla
 * cerrado). Las reglas niegan este documento a todos: solo lo escribe el servidor.
 */
export async function consumirCupoDeBusqueda(
  db: Firestore, uid: string, ahoraMs: number,
): Promise<null | 'tope_hora' | 'tope_dia'> {
  if (!UID_SEGURO.test(uid)) throw new Error('uid inválido para el tope');
  const sello = new Date(ahoraMs - 4 * 3_600_000).toISOString();
  const hora = sello.slice(0, 13);
  const dia = sello.slice(0, 10);
  const ref = db.doc(`topesDeBusqueda/${uid}`);
  return db.runTransaction(async (tx) => {
    const previo = await tx.get(ref);
    const d = previo.exists ? (previo.data() ?? {}) : {};
    const busquedasHora = d['hora'] === hora ? d['busquedasHora'] : 0;
    const busquedasDia = d['dia'] === dia ? d['busquedasDia'] : 0;
    if (!numeroValido(busquedasHora) || !numeroValido(busquedasDia)) return 'tope_hora';
    if (busquedasHora >= TOPE_POR_HORA) return 'tope_hora';
    if (busquedasDia >= TOPE_POR_DIA) return 'tope_dia';
    tx.set(ref, {
      hora, busquedasHora: busquedasHora + 1, dia, busquedasDia: busquedasDia + 1,
      actualizadoEn: Timestamp.fromMillis(ahoraMs),
    });
    return null;
  });
}

// ---------------------------------------------------------------------------
// REGISTRO: nunca el texto buscado
// ---------------------------------------------------------------------------

interface DatosDeRegistro {
  tenantId?: unknown; uid?: string; rol?: RolVerificado; palabras?: number; resultados?: number; motivo?: string;
}

/**
 * La única forma de registrar. Un campo por cada dato permitido: comercio (solo
 * si tiene la forma de un id de comercio, para que nadie escriba lo que quiera
 * en los registros), uid, rol, cantidad de palabras, cantidad de resultados,
 * código. Ni el texto buscado ni teléfonos.
 */
function registrar(codigo: string, d: DatosDeRegistro = {}): void {
  const linea = {
    funcion: 'buscarConversaciones', codigo,
    ...(typeof d.tenantId === 'string' && ID_COMERCIO.test(d.tenantId) ? { tenantId: d.tenantId } : {}),
    ...(d.uid ? { uid: d.uid } : {}),
    ...(d.rol ? { rol: d.rol } : {}),
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

export const buscarConversaciones = onCall(opcionesDeBuscarConversaciones(process.env), async (p: CallableRequest) => {
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

/**
 * ¿El documento hallado es de ESTE comercio y de una conversación con id regular,
 * con un id de mensaje que un cursor pueda reanudar? Es la guarda de ruta de los
 * resultados Y de la posición que se devuelve como cursor.
 */
function esDocumentoPropio(d: QueryDocumentSnapshot, tenantId: string): boolean {
  if (!d.ref.path.startsWith(`tenants/${tenantId}/conversaciones/`)) return false;
  const conversacionId = d.ref.parent.parent?.id;
  return typeof conversacionId === 'string' && CONVERSACION.test(conversacionId) && MENSAJE_ID.test(d.id);
}

const cursorDe = (d: QueryDocumentSnapshot): string => `${d.ref.parent.parent?.id}/${d.id}`;

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
  let rol: RolVerificado;
  try {
    ({ rol } = await exigirLectorDeConversaciones(p, tenantId, db, ahoraMs));
  } catch (e) {
    registrar(e instanceof HttpsError ? e.code : 'unavailable', { tenantId, uid });
    throw e;
  }
  const t = tenantId as string; // validado por `exigirLectorDeConversaciones`
  const quien = { tenantId: t, uid, rol };

  // 2. El texto: de 1 a 100 caracteres y con al menos una palabra de 3 letras.
  const texto = datos['texto'];
  const palabras = typeof texto === 'string' && texto.length >= 1 && texto.length <= MAX_TEXTO
    ? palabrasDe(texto, MAX_PALABRAS_CONSULTA) : [];
  const palabraIndice = palabraParaIndice(palabras);
  if (typeof texto !== 'string' || palabraIndice === null) {
    registrar('invalid-argument', { ...quien, motivo: 'texto' });
    throw new HttpsError('invalid-argument', MENSAJES.pocoTexto);
  }

  // 3. La forma del cursor (todavía sin leer nada).
  const crudo = datos['cursor'];
  const hayCursor = crudo !== undefined && crudo !== null;
  const partes = hayCursor && typeof crudo === 'string' ? CURSOR.exec(crudo) : null;
  if (hayCursor && partes === null) {
    registrar('invalid-argument', { ...quien, palabras: palabras.length, motivo: 'cursor' });
    throw new HttpsError('invalid-argument', MENSAJES.cursor);
  }

  // 4. EL TOPE por usuario: de aquí en adelante la búsqueda lee mensajes.
  const motivoDeTope = await consumirCupoDeBusqueda(db, uid, ahoraMs);
  if (motivoDeTope !== null) {
    registrar('resource-exhausted', { ...quien, motivo: motivoDeTope });
    throw new HttpsError('resource-exhausted', MENSAJES.tope);
  }

  // 5. El cursor: la ruta se arma BAJO el comercio pedido, y debe existir.
  let inicio: DocumentSnapshot | null = null;
  if (partes !== null) {
    const ref = db.doc(`tenants/${t}/conversaciones/${partes[1]}/mensajes/${partes[2]}`);
    if (!ref.path.startsWith(`tenants/${t}/conversaciones/`)) {
      registrar('invalid-argument', { ...quien, palabras: palabras.length, motivo: 'cursor' });
      throw new HttpsError('invalid-argument', MENSAJES.cursor);
    }
    const snap = await ref.get();
    if (!snap.exists || !(snap.get('ts') instanceof Timestamp)) {
      registrar('invalid-argument', { ...quien, palabras: palabras.length, motivo: 'cursor' });
      throw new HttpsError('invalid-argument', MENSAJES.cursor);
    }
    inicio = snap;
  }

  // 6. La consulta: SIEMPRE acotada al comercio pedido, por el índice, la más nueva primero.
  const base: Query = db.collectionGroup(CONSULTA_PALABRAS.grupo)
    .where(CONSULTA_PALABRAS.igualdad, '==', t)
    .where(CONSULTA_PALABRAS.contiene, 'array-contains', palabraIndice)
    .orderBy(CONSULTA_PALABRAS.orden.campo, CONSULTA_PALABRAS.orden.direccion)
    .limit(CONSULTA_PALABRAS.limite);

  const resultados: ResultadoDeBusqueda[] = [];
  let cursor: string | null = null;
  const ya = new Set<string>(); // un mismo documento no se repite entre lotes
  for (let lote = 0; lote < MAX_LOTES; lote++) {
    const snap = await (inicio ? base.startAfter(inicio) : base).get();
    let llena = false;
    for (const d of snap.docs) {
      if (ya.has(d.ref.path)) continue;
      ya.add(d.ref.path);
      const r = aResultado(d, t, palabras);
      if (r) resultados.push(r);
      if (resultados.length >= MAX_RESULTADOS_BUSQUEDA && r) { cursor = cursorDe(d); llena = true; break; }
    }
    if (llena) break;
    if (snap.size < CONSULTA_PALABRAS.limite) break; // se acabó: cursor null
    inicio = snap.docs[snap.docs.length - 1] ?? null; // posición INTERNA para el lote siguiente
    if (lote === MAX_LOTES - 1) {
      // Tope de lotes: el cursor es el último leído que pase la guarda, no el último a secas.
      const ultimoBueno = [...snap.docs].reverse().find((d) => esDocumentoPropio(d, t));
      cursor = ultimoBueno ? cursorDe(ultimoBueno) : null;
      if (cursor === null) registrar('cursor_irregular', { ...quien, motivo: 'cursor_irregular' });
    }
  }

  registrar('ok', { ...quien, palabras: palabras.length, resultados: resultados.length });
  return { palabras, resultados, cursor };
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
  if (!esDocumentoPropio(d, tenantId)) return null;
  const conversacionId = d.ref.parent.parent!.id; // verificado por `esDocumentoPropio`
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
