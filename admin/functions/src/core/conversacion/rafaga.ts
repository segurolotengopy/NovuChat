/**
 * =============================================================================
 * RÁFAGAS DE MENSAJES: LO QUE EL SERVIDOR ENTREGA AL FLUJO (CORE)
 * =============================================================================
 *
 * Cuando una persona manda 2 o 3 textos seguidos, hoy el flujo responde a cada uno (n respuestas,
 * n mensajes cobrados a 0,0113 USD). El flujo espera unos segundos y le pregunta a `configuracionFlujo`
 * cuáles son los últimos entrantes de ESE teléfono; con eso decide, en el nodo, si es el último de la
 * ráfaga (responde con los textos unidos) o si calla. Acá vive solo la parte del servidor: validar el
 * pedido, y devolver los fragmentos recientes. La decisión de agrupar NO se toma acá: es del nodo.
 *
 * FALLA ABIERTO. Si la consulta falla o el flujo no encuentra su propio `idMeta` en la lista, responde
 * solo, como hoy. Este módulo no escribe nada (0 escrituras) y lee como mucho `MAX_LECTURAS` documentos
 * de la conversación `wa_<telefono>` del tenant de la ruta autenticada: el tenant NUNCA sale del cuerpo.
 *
 * Zona Core: sin importaciones de zonas superiores; de Firestore solo tipos.
 */
import type { Firestore } from 'firebase-admin/firestore';

export const VERSION_RAFAGA = 1 as const;
/** Vecinos que se leen alrededor del mensaje propio: hasta 5 anteriores y 3 posteriores. */
export const MAX_PREDECESORES = 5;
export const MAX_SUCESORES = 3;
/**
 * Documentos que se leen como máximo: el propio (1), 5 + 3 vecinos = 9. Con un reintento de Meta
 * (el mismo `idMeta` en dos documentos) se lee uno más: 10.
 */
export const MAX_LECTURAS = 1 + MAX_PREDECESORES + MAX_SUCESORES;
/** El mensaje propio debe ser de los últimos 10 minutos: sin un wamid reciente no se lee nada. */
export const VENTANA_PROPIA_MS = 10 * 60_000;
/** Fragmentos que se devuelven como máximo. */
export const MAX_TEXTO = 1500;
export const MAX_ID_META = 120;

export interface FragmentoDeRafaga {
  idMeta: string;
  tipo: string;
  texto: string;
  /** Hora del servidor, en milisegundos desde 1970. */
  ms: number;
}

/** Lo mínimo de un mensaje guardado que esta pieza necesita. */
export interface MensajeCrudo {
  direccion?: unknown;
  tipo?: unknown;
  texto?: unknown;
  idMeta?: unknown;
  ts?: unknown;
}

export type ValidacionRafaga =
  | { ok: true; idMeta: string }
  | { ok: false; status: 400; error: string };

const TELEFONO = /^[0-9]{8,15}$/;

/** Valida `cuerpo.rafaga`. El teléfono ya viene saneado de la ruta (o `null`). */
export function validarRafaga(rafaga: unknown, telefono: string | null): ValidacionRafaga {
  const mal = (error: string): ValidacionRafaga => ({ ok: false, status: 400, error });
  if (telefono === null || !TELEFONO.test(telefono)) return mal('rafaga_telefono');
  if (typeof rafaga !== 'object' || rafaga === null || Array.isArray(rafaga)) return mal('rafaga_forma');
  const r = rafaga as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== 'v' && k !== 'idMeta') return mal('rafaga_clave');
  if (r['v'] !== VERSION_RAFAGA) return mal('rafaga_version');
  const id = r['idMeta'];
  if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID_META) return mal('rafaga_idmeta');
  return { ok: true, idMeta: id };
}

function aMs(ts: unknown): number | null {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  const t = ts as { toMillis?: () => number } | null | undefined;
  if (t && typeof t.toMillis === 'function') {
    const v = t.toMillis();
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** Un saliente se entrega como MARCA: el nodo la usa de separador, sin texto ni idMeta. */
export const TIPO_MARCA_SALIENTE = 'saliente';

/**
 * Pura. `docsNuevoAViejo` viene en cualquier orden. Devuelve las entradas dadas en
 * orden cronológico (por `ms`, luego `idMeta`): los entrantes con su texto (≤1500) y los salientes como
 * MARCA `{idMeta:'', tipo:'saliente', texto:'', ms}`. Un entrante sin `idMeta` (p. ej. el pedido del
 * catálogo web) sale con `idMeta:''` y su tipo real: el nodo lo trata como no agrupable. Los entrantes
 * con `idMeta` repetido (reintento de Meta) quedan una vez, el más antiguo.
 */
export function fragmentosDeRafaga(docsNuevoAViejo: readonly MensajeCrudo[]): FragmentoDeRafaga[] {
  const todos: FragmentoDeRafaga[] = [];
  for (const d of docsNuevoAViejo) {
    const ms = aMs(d.ts);
    if (ms === null) continue;
    if (d.direccion === 'saliente') {
      todos.push({ idMeta: '', tipo: TIPO_MARCA_SALIENTE, texto: '', ms });
    } else if (d.direccion === 'entrante') {
      todos.push({
        idMeta: typeof d.idMeta === 'string' ? d.idMeta.slice(0, MAX_ID_META) : '',
        tipo: typeof d.tipo === 'string' ? d.tipo : '',
        texto: typeof d.texto === 'string' ? d.texto.slice(0, MAX_TEXTO) : '',
        ms,
      });
    }
  }
  todos.sort((x, y) => x.ms - y.ms || (x.idMeta < y.idMeta ? -1 : x.idMeta > y.idMeta ? 1 : 0));
  const vistos = new Set<string>();
  return todos.filter((f) => {
    if (!f.idMeta) return true;
    if (vistos.has(f.idMeta)) return false;
    vistos.add(f.idMeta);
    return true;
  });
}

/**
 * Lee la vecindad de MI mensaje en `tenants/{tenantId}/conversaciones/wa_{telefono}/mensajes`.
 * El tenant lo pone el que llama desde la ruta autenticada. Cero escrituras. Puede lanzar: quien
 * llama decide (la rama de `configuracionFlujo` responde 500 y el flujo falla abierto).
 *
 * RELATIVA A MI MENSAJE, no a «los últimos»: si después del mío llegan muchas entradas (un álbum de
 * fotos, salientes), mi vecindad sigue siendo la misma.
 *  1. Mi documento: `where('idMeta','==',idMeta).limit(2)`. Si hay dos (reintento de Meta) se toma el
 *     de menor `ts` (y, a igual `ts`, el de menor id). Ninguno, o más viejo que 10 min -> `[]`: quien
 *     no conoce un wamid reciente de esta conversación no lee texto ajeno, y el nodo responde solo.
 *  2. Anteriores: `orderBy('ts','desc').startAfter(mi documento).limit(5)`; posteriores:
 *     `orderBy('ts','asc').startAfter(mi documento).limit(3)`.
 * DESEMPATE: el cursor con el documento usa `ts` y, a igual `ts`, el id del documento (Firestore lo
 * agrega solo, en la misma dirección). Es un orden total y estable: los empates caen de un lado u
 * otro de mi documento según su id, ninguno se pierde ni se repite, y el propio nunca se duplica.
 * Son consultas de un solo campo (`idMeta`, `ts`): no necesitan índice compuesto.
 */
export async function leerRafaga(
  db: Firestore, tenantId: string, telefono: string, idMeta: string, ahoraMs: number = Date.now(),
): Promise<{ v: 1; fragmentos: FragmentoDeRafaga[] }> {
  const vacia = { v: VERSION_RAFAGA, fragmentos: [] as FragmentoDeRafaga[] };
  const coleccion = db.collection(`tenants/${tenantId}/conversaciones/wa_${telefono}/mensajes`);
  const propios = await coleccion.where('idMeta', '==', idMeta).limit(2).get();
  const candidatos = propios.docs
    .map((d) => ({ d, ms: aMs((d.data() as MensajeCrudo).ts), entrante: (d.data() as MensajeCrudo).direccion === 'entrante' }))
    .filter((x): x is typeof x & { ms: number } => x.entrante && x.ms !== null)
    .sort((x, y) => x.ms - y.ms || (x.d.id < y.d.id ? -1 : x.d.id > y.d.id ? 1 : 0));
  const mio = candidatos[0];
  if (!mio || mio.ms < ahoraMs - VENTANA_PROPIA_MS) return vacia;
  const [antes, despues] = await Promise.all([
    coleccion.orderBy('ts', 'desc').startAfter(mio.d).limit(MAX_PREDECESORES).get(),
    coleccion.orderBy('ts', 'asc').startAfter(mio.d).limit(MAX_SUCESORES).get(),
  ]);
  const docs = [...antes.docs, mio.d, ...despues.docs].map((d) => d.data() as MensajeCrudo);
  return { v: VERSION_RAFAGA, fragmentos: fragmentosDeRafaga(docs) };
}
