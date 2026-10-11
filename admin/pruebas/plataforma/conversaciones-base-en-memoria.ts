/**
 * Una Firestore EN MEMORIA, lo justo para probar `rellenar-conversaciones.mjs` y
 * `aplicar-consola-conversaciones.mjs` sin emulador ni nube: documentos con hora de actualización,
 * `getAll` con máscara de campos, consultas por id con `limit`, `select` y `startAfter`, lotes atómicos
 * con precondición `lastUpdateTime` y el centinela `FieldValue.delete()`. Cuenta lecturas y escrituras
 * y permite que un documento cambie ENTRE la lectura y la escritura (`antesDeCommit`).
 * Los datos de las pruebas son sintéticos.
 */
export interface Escritura { ruta: string; campos: string[]; enLote: boolean }
type Dato = Record<string, unknown>;
interface Doc { data: Dato; hora: number }
const BORRAR = { __borrar: true as const };
const esBorrar = (v: unknown) => Boolean(v && typeof v === 'object' && (v as { __borrar?: boolean }).__borrar);
const falla = (code: number, mensaje: string) => Object.assign(new Error(mensaje), { code });

export function baseEnMemoria(inicial: Record<string, Dato> = {}) {
  const docs = new Map<string, Doc>();
  let reloj = 1;
  for (const [ruta, data] of Object.entries(inicial)) docs.set(ruta, { data: structuredClone(data), hora: reloj++ });
  const estado = {
    lecturas: 0, escrituras: [] as Escritura[], lotes: [] as number[], consultas: [] as { limite: number; despuesDe: string | null }[],
    /** Se llama justo antes de que un lote confirme (para simular un mensaje que llega en ese instante). */
    antesDeCommit: null as null | (() => void),
    /** Si devuelve un código, el `update` suelto de ese documento falla con él (un error que NO es de precondición). */
    fallaUpdate: null as null | ((ruta: string) => number | null),
    /** Si devuelve true, la escritura de ese documento "se pierde" en silencio (la relectura tiene que notarlo). */
    perderEscritura: null as null | ((ruta: string) => boolean),
  };

  const tiempo = (hora: number) => ({ hora, toDate: () => new Date(hora * 1000) });
  const mascara = (data: Dato, campos?: readonly string[]) => {
    if (!campos) return structuredClone(data);
    const salida: Dato = {};
    for (const c of campos) if (Object.prototype.hasOwnProperty.call(data, c)) salida[c] = structuredClone(data[c]);
    return salida;
  };
  const snapDe = (ruta: string, campos?: readonly string[]) => {
    const d = docs.get(ruta);
    return {
      id: ruta.split('/').pop() as string, ref: refDe(ruta), exists: d !== undefined,
      data: () => (d ? mascara(d.data, campos) : undefined), updateTime: d ? tiempo(d.hora) : undefined,
    };
  };
  const aplicar = (ruta: string, campos: Dato) => {
    const d = docs.get(ruta) as Doc;
    if (estado.perderEscritura?.(ruta)) return;
    for (const [k, v] of Object.entries(campos)) {
      if (esBorrar(v)) delete d.data[k]; else d.data[k] = structuredClone(v);
    }
    d.hora = reloj++;
  };
  const comprobar = (ruta: string, pre: { lastUpdateTime: { hora: number } } | undefined) => {
    const d = docs.get(ruta);
    if (!d) throw falla(5, 'NOT_FOUND');
    if (pre && pre.lastUpdateTime.hora !== d.hora) throw falla(9, 'FAILED_PRECONDITION');
  };

  function refDe(ruta: string) {
    return {
      path: ruta, id: ruta.split('/').pop() as string,
      update: async (campos: Dato, pre?: { lastUpdateTime: { hora: number } }) => {
        const codigo = estado.fallaUpdate?.(ruta);
        if (codigo) throw falla(codigo, 'ERROR_SINTETICO');
        comprobar(ruta, pre);
        aplicar(ruta, campos);
        estado.escrituras.push({ ruta, campos: Object.keys(campos), enLote: false });
      },
    };
  }

  const db = {
    doc: (ruta: string) => refDe(ruta),
    getAll: async (...args: unknown[]) => {
      const ultimo = args[args.length - 1];
      const opciones = ultimo && typeof ultimo === 'object' && !('path' in (ultimo as object)) ? (args.pop() as { fieldMask?: string[] }) : {};
      return (args as { path: string }[]).map((r) => { estado.lecturas += 1; return snapDe(r.path, opciones.fieldMask); });
    },
    collection: (ruta: string) => {
      let limite = Infinity;
      let campos: string[] | undefined;
      let despues: string | null = null;
      const q = {
        orderBy: (_campo: unknown) => q,
        limit: (n: number) => { limite = n; return q; },
        select: (...c: string[]) => { campos = c; return q; },
        startAfter: (snap: { id: string }) => { despues = snap.id; return q; },
        get: async () => {
          estado.consultas.push({ limite, despuesDe: despues });
          const ids = [...docs.keys()].filter((k) => k.startsWith(`${ruta}/`) && !k.slice(ruta.length + 1).includes('/'))
            .map((k) => k.slice(ruta.length + 1)).sort();
          const desde = despues === null ? 0 : ids.findIndex((i) => i > (despues as string));
          const pagina = desde < 0 ? [] : ids.slice(desde, desde + limite);
          estado.lecturas += pagina.length;
          const snaps = pagina.map((i) => snapDe(`${ruta}/${i}`, campos));
          return { empty: snaps.length === 0, docs: snaps };
        },
      };
      return q;
    },
    batch: () => {
      const ops: { ruta: string; campos: Dato; pre?: { lastUpdateTime: { hora: number } } }[] = [];
      return {
        update: (ref: { path: string }, campos: Dato, pre?: { lastUpdateTime: { hora: number } }) => { ops.push({ ruta: ref.path, campos, pre }); },
        commit: async () => {
          estado.antesDeCommit?.();
          for (const o of ops) comprobar(o.ruta, o.pre); // atómico: si UNA falla, ninguna se escribe
          for (const o of ops) {
            aplicar(o.ruta, o.campos);
            estado.escrituras.push({ ruta: o.ruta, campos: Object.keys(o.campos), enLote: true });
          }
          estado.lotes.push(ops.length);
        },
      };
    },
  };
  return {
    db, estado,
    FieldValue: { delete: () => BORRAR },
    FieldPath: { documentId: () => '__name__' },
    /** Lo que hay en un documento (copia), o undefined. */
    leer: (ruta: string) => (docs.has(ruta) ? structuredClone((docs.get(ruta) as Doc).data) : undefined),
    /** Cambia un documento "por fuera" (como la ingesta o una persona): avanza su hora de actualización. */
    tocar: (ruta: string, campos: Dato) => aplicar(ruta, campos),
    rutas: () => [...docs.keys()],
    /** Borra un documento "por fuera". */
    borrar: (ruta: string) => { docs.delete(ruta); },
  };
}
export type BaseEnMemoria = ReturnType<typeof baseEnMemoria>;
