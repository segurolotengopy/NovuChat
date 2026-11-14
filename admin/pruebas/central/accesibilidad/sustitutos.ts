/**
 * SUSTITUTOS DE LA CAPA DE DATOS para las pruebas con motor (13/11/2026). Se reemplaza SOLO lo que habla con Firebase (Firestore,
 * Functions, Auth); la `App` y todas sus páginas son las reales. Sin `vi.mock` aquí: los cuatro `vi.mock` viven en `motor.test.ts`.
 *
 * Todo lo que el sustituto no sabe responder se ANOTA (`sinSustituto`, `escrituras`, `red`) y la suite lo exige vacío: una página que
 * llama a algo no previsto no pasa en silencio.
 */

export interface FilaDeColeccion { id: string; datos: Record<string, unknown> }
export interface Escenario {
  docs?: Record<string, Record<string, unknown>>;
  colecciones?: Record<string, FilaDeColeccion[]>;
  respuestas?: Record<string, unknown>;
}
export const ALMACEN = {
  docs: new Map<string, Record<string, unknown>>(),
  colecciones: new Map<string, FilaDeColeccion[]>(),
  respuestas: new Map<string, unknown>(),
  colgado: false,
  lecturas: 0,
  escrituras: [] as string[],
  sinSustituto: [] as string[],
  red: 0,
};

/** Los escenarios se pasan como datos recién construidos (fábricas en `paginas.ts`): no se clonan porque llevan instancias (marcas de tiempo). */
export function reiniciarAlmacen(e: Escenario = {}): void {
  ALMACEN.docs = new Map(Object.entries(e.docs ?? {}));
  ALMACEN.colecciones = new Map(Object.entries(e.colecciones ?? {}));
  ALMACEN.respuestas = new Map(Object.entries(e.respuestas ?? {}));
  ALMACEN.colgado = false;
  ALMACEN.lecturas = 0;
  ALMACEN.escrituras = [];
  ALMACEN.sinSustituto = [];
  ALMACEN.red = 0;
}

interface Ref { __ruta: string; __tipo: 'doc' | 'coleccion'; id: string; path: string }
const esRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && '__ruta' in v;

function armar(tipo: 'doc' | 'coleccion', padre: unknown, tramos: string[]): Ref {
  const base = esRef(padre) ? [padre.__ruta] : typeof padre === 'string' ? [padre] : [];
  const ruta = [...base, ...tramos].join('/').replace(/\/+/g, '/');
  return { __ruta: ruta, __tipo: tipo, id: ruta.split('/').pop() ?? '', path: ruta };
}

function instantaneaDeDoc(ref: Ref) {
  const datos = ALMACEN.docs.get(ref.__ruta);
  return { id: ref.id, ref, exists: () => datos !== undefined, data: () => (datos === undefined ? undefined : { ...datos }), get: (k: string) => datos?.[k] };
}
function instantaneaDeColeccion(ref: Ref) {
  const filas = ALMACEN.colecciones.get(ref.__ruta) ?? [];
  const docs = filas.map((f) => ({ id: f.id, ref: armar('doc', ref, [f.id]), exists: () => true, data: () => ({ ...f.datos }), get: (k: string) => f.datos[k] }));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: (d: unknown) => void) => docs.forEach(fn), docChanges: () => [] as unknown[] };
}
const instantanea = (ref: Ref) => (ref.__tipo === 'doc' ? instantaneaDeDoc(ref) : instantaneaDeColeccion(ref));

export function firestoreFalso(real: Record<string, unknown>): Record<string, unknown> {
  const anotar = (que: string) => async (...a: unknown[]) => {
    ALMACEN.escrituras.push(`${que} ${esRef(a[0]) ? a[0].__ruta : ''}`.trim());
    throw new Error('escritura no permitida en la prueba de accesibilidad');
  };
  return {
    ...real,
    doc: (padre: unknown, ...t: string[]) => armar('doc', padre, t),
    collection: (padre: unknown, ...t: string[]) => armar('coleccion', padre, t),
    collectionGroup: (_db: unknown, id: string) => armar('coleccion', undefined, ['**', id]),
    query: (ref: unknown) => ref,
    onSnapshot: (ref: Ref, ok: (s: unknown) => void) => {
      ALMACEN.lecturas++;
      let baja = false;
      if (!ALMACEN.colgado) queueMicrotask(() => { if (!baja) ok(instantanea(ref)); });
      return () => { baja = true; };
    },
    getDoc: async (ref: Ref) => { ALMACEN.lecturas++; return instantaneaDeDoc(ref); },
    getDocs: async (ref: Ref) => { ALMACEN.lecturas++; return instantaneaDeColeccion(ref); },
    getCountFromServer: async (ref: Ref) => { ALMACEN.lecturas++; const n = (ALMACEN.colecciones.get(ref.__ruta) ?? []).length; return { data: () => ({ count: n }) }; },
    updateDoc: anotar('updateDoc'),
    setDoc: anotar('setDoc'),
    addDoc: anotar('addDoc'),
    deleteDoc: anotar('deleteDoc'),
    writeBatch: () => { ALMACEN.escrituras.push('writeBatch'); throw new Error('escritura no permitida en la prueba de accesibilidad'); },
    runTransaction: anotar('runTransaction'),
  };
}

export function functionsFalso(real: Record<string, unknown>): Record<string, unknown> {
  return {
    ...real,
    httpsCallable: (_f: unknown, nombre: string) => async () => {
      if (ALMACEN.respuestas.has(nombre)) return { data: ALMACEN.respuestas.get(nombre) };
      ALMACEN.sinSustituto.push(nombre);
      throw Object.assign(new Error('sin sustituto'), { code: 'functions/unavailable' });
    },
  };
}

export function authFalso(real: Record<string, unknown>): Record<string, unknown> {
  return { ...real, getRedirectResult: async () => null, signOut: async () => {}, onIdTokenChanged: () => () => {} };
}

export const firebaseFalso = {
  app: {},
  db: { __db: true },
  auth: { currentUser: null },
  funciones: {},
  storage: null,
  REGION_FUNCIONES: 'us-east1',
  urlDeFuncionHttp: (n: string) => `https://funciones.invalid/${n}`,
};
