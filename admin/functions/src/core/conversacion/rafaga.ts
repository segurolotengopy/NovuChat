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

export const VERSION_RAFAGA = 1;
/** Documentos que se leen como máximo (los 6 más recientes de la conversación). */
export const MAX_LECTURAS = 6;
/** Fragmentos que se devuelven como máximo. */
export const MAX_FRAGMENTOS = 5;
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

/**
 * Pura. `docsNuevoAViejo` viene ordenado por `ts` descendente. Se recorre del más nuevo al más viejo y
 * se corta en el primer saliente (lo que el asistente ya contestó no es parte de la ráfaga). Los
 * `idMeta` repetidos (reintento de Meta) quedan una vez, en su primera aparición cronológica. Se
 * devuelven en orden cronológico, máximo `MAX_FRAGMENTOS` (los más nuevos).
 */
export function fragmentosDeRafaga(docsNuevoAViejo: readonly MensajeCrudo[]): FragmentoDeRafaga[] {
  const recientes: FragmentoDeRafaga[] = [];
  for (const d of docsNuevoAViejo.slice(0, MAX_LECTURAS)) {
    if (d.direccion !== 'entrante') break;
    const ms = aMs(d.ts);
    if (ms === null) continue;
    recientes.push({
      idMeta: typeof d.idMeta === 'string' ? d.idMeta.slice(0, MAX_ID_META) : '',
      tipo: typeof d.tipo === 'string' ? d.tipo : '',
      texto: typeof d.texto === 'string' ? d.texto.slice(0, MAX_TEXTO) : '',
      ms,
    });
  }
  const cronologico = recientes.reverse();
  const vistos = new Set<string>();
  const unicos: FragmentoDeRafaga[] = [];
  for (const f of cronologico) {
    if (f.idMeta) {
      if (vistos.has(f.idMeta)) continue;
      vistos.add(f.idMeta);
    }
    unicos.push(f);
  }
  return unicos.slice(-MAX_FRAGMENTOS);
}

/**
 * Lee los `MAX_LECTURAS` mensajes más recientes de `tenants/{tenantId}/conversaciones/wa_{telefono}`.
 * El tenant lo pone el que llama desde la ruta autenticada. Cero escrituras.
 */
export async function leerRafaga(
  db: Firestore, tenantId: string, telefono: string,
): Promise<{ v: 1; fragmentos: FragmentoDeRafaga[] }> {
  const snap = await db
    .collection(`tenants/${tenantId}/conversaciones/wa_${telefono}/mensajes`)
    .orderBy('ts', 'desc')
    .limit(MAX_LECTURAS)
    .get();
  return { v: VERSION_RAFAGA, fragmentos: fragmentosDeRafaga(snap.docs.map((d) => d.data() as MensajeCrudo)) };
}
