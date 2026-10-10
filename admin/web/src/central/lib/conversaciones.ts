/**
 * =============================================================================
 * CONVERSACIONES: LA LÓGICA DE LA PANTALLA, SIN REACT Y SIN FIREBASE
 * =============================================================================
 *
 * Todo lo que la pantalla DECIDE vive acá, en funciones puras, por tres razones:
 *
 *  1. Se prueba sin navegador ni emulador (`pruebas/central/conversaciones-*.test.ts`):
 *     la búsqueda por teléfono, nombre y palabra, los filtros, la lectura de
 *     documentos viejos y el «anterior / siguiente» son lo que se rompe en
 *     silencio si se toca la pantalla.
 *  2. Las CONSULTAS a Firestore se describen acá como datos (`ConsultaPlana`) y la
 *     pantalla solo las traduce a `where`/`orderBy`. Así `FORMAS_CONSULTA` es la
 *     lista exacta de formas que pueden salir, y `conversaciones-indices.test.ts`
 *     comprueba que cada una tiene su índice declarado en `firestore.indexes.json`.
 *     Una consulta nueva sin índice falla en producción (el emulador no lo exige).
 *  3. La normalización NO se escribe acá: es de Core
 *     (`functions/src/core/conversacion/normalizacion.ts`) y la pantalla la importa
 *     por ruta relativa, igual que la ingesta, la callable y los scripts. Una sola
 *     regla en cuatro lugares; si una de las cuatro cambiara por su cuenta, la
 *     búsqueda dejaría de encontrar lo ya guardado.
 *
 * LECTURA TOLERANTE. Los documentos de antes de H1 no traen ninguno de los campos
 * nuevos (`telefonoTrozos`, `nombrePalabras`, `ultimoEntranteEn`, `ventanaVenceEn`,
 * `noLeidos`, `sinLeer`). `fichaDeDocumento` los lee sin romperse: un campo ausente
 * o de otro tipo es «sin dato», y un documento sin `noLeidos`/`sinLeer` es LEÍDO.
 *
 * LA UNIDAD ES LA CONVERSACIÓN, NO LA «ATENCIÓN» (CLAUDE.md, vocabulario).
 */
import {
  MINIMO_DIGITOS, POR_VENCER_HORAS, PREFIJOS_PAIS_DEFECTO, VENTANA_HORAS,
  normalizarTexto, palabrasDe, soloDigitos, trozosDeTelefono,
} from '../../../../functions/src/core/conversacion/normalizacion';

// Lo de Core que la pantalla y sus pruebas usan, por un solo punto de entrada.
export {
  MAX_PALABRAS_CONSULTA, MAX_PALABRAS_POR_MENSAJE, MAX_RESULTADOS_BUSQUEDA, MINIMO_DIGITOS, POR_VENCER_HORAS,
  PREFIJOS_PAIS_DEFECTO, VENTANA_HORAS, fragmento, mensajeContiene, normalizarTexto, palabraParaIndice, palabrasDe,
  prefijosValidos, raizDe, soloDigitos, trozosDeTelefono,
} from '../../../../functions/src/core/conversacion/normalizacion';

const HORA_MS = 3_600_000;

// ── Constantes de la pantalla ────────────────────────────────────────────────

/** Cuántas conversaciones trae la primera página (en vivo) y cada «Cargar más». */
export const PAGINA_LISTA = 50;
/** Tope de resultados de cada búsqueda directa a Firestore (teléfono, nombre). */
export const LIMITE_BUSQUEDA = 20;
/** Cada cuánto se vuelven a pedir los filtros que dependen del reloj (necesita humano, por vencer). */
export const RESUSCRIBIR_FILTROS_MS = 5 * 60_000;
/** Cada cuánto se refrescan los contadores con la pestaña visible, y el mínimo entre dos refrescos por cambios. */
export const CONTADORES_CADA_MS = 60_000;
export const CONTADORES_MINIMO_MS = 15_000;
/** Espera de la marca de leída: si la persona cambia de conversación enseguida, no se marca la de paso. */
export const REBOTE_MARCA_LEIDA_MS = 1_000;
/**
 * La conversación abierta va en la ruta (`/negocio/:t/conversaciones/:c`). `true`
 * desde que `App.tsx` declara esa ruta (H1-2). Con `false` iría en `?c=`.
 */
export const CONVERSACION_EN_LA_RUTA = true;

// ── Modelo que la pantalla usa (no el documento de Firestore) ────────────────

export interface Ficha {
  id: string;
  telefono: string;
  nombre: string;
  ultimoMensaje: string;
  /** ms desde 1970; null si el documento no lo trae. */
  ultimoEn: number | null;
  /** Hora del último mensaje DEL CLIENTE: de ahí corre la ventana de 24 h. */
  ultimoEntranteEn: number | null;
  /** Cuándo vence la ventana de 24 h (`ultimoEntranteEn` + 24 h). */
  ventanaVenceEn: number | null;
  noLeidos: number;
  sinLeer: boolean;
  /** `necesitaHumano === true` en el documento (lo escribirá H2; en H1 casi siempre `false`). */
  necesitaHumano: boolean;
  /** `normal`, `operador` o `bloqueado` (lo anota la ingesta); '' si falta. */
  atencionEstado: string;
  noContactar: boolean;
  telefonoTrozos: string[];
  nombrePalabras: string[];
}

export type Filtro = 'todas' | 'humano' | 'noLeidas' | 'vencer';

/** Sin «El asistente atiende»: en H1 nadie toma conversaciones, así que sería idéntico a «Todas». */
export const FILTROS: readonly { id: Filtro; rotulo: string }[] = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'humano', rotulo: 'Necesita humano' },
  { id: 'noLeidas', rotulo: 'No leídas' },
  { id: 'vencer', rotulo: 'Ventana por vencer' },
];

/** Los estados de atención que piden a una persona (los anota la ingesta). */
export const ESTADOS_HUMANO: readonly string[] = ['operador', 'bloqueado'];

// ── Lectura tolerante de un documento ────────────────────────────────────────

function ms(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  if (!t || typeof t.toMillis !== 'function') return null;
  const n = t.toMillis();
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const lista = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);

/**
 * El documento de Firestore → la ficha de la pantalla. Cualquier campo ausente o
 * de otro tipo es «sin dato»; nunca lanza. Un documento sin `noLeidos` ni
 * `sinLeer` (todos los de antes de H1) es un documento LEÍDO.
 */
export function fichaDeDocumento(id: string, datos: Record<string, unknown> | null | undefined): Ficha {
  const x = datos ?? {};
  const noLeidos = typeof x['noLeidos'] === 'number' && Number.isFinite(x['noLeidos']) ? Math.max(0, Math.floor(x['noLeidos'])) : 0;
  return {
    id,
    telefono: str(x['telefono']) || id.replace(/^wa_/, ''),
    nombre: str(x['nombreContacto']),
    ultimoMensaje: str(x['ultimoMensaje']),
    ultimoEn: ms(x['ultimoEn']),
    ultimoEntranteEn: ms(x['ultimoEntranteEn']),
    ventanaVenceEn: ms(x['ventanaVenceEn']),
    noLeidos,
    sinLeer: x['sinLeer'] === true,
    necesitaHumano: x['necesitaHumano'] === true,
    atencionEstado: str(x['atencionEstado']),
    noContactar: x['noContactar'] === true,
    telefonoTrozos: lista(x['telefonoTrozos']),
    nombrePalabras: lista(x['nombrePalabras']),
  };
}

// ── Las consultas, descritas como datos ──────────────────────────────────────

export type OperadorConsulta = '==' | 'in' | 'array-contains' | '>' | '>=' | '<' | '<=';
export interface Restriccion { campo: string; op: OperadorConsulta; valor: string | number | boolean | string[] }
export interface Orden { campo: string; dir: 'asc' | 'desc' }
/** Una consulta sobre `tenants/{t}/conversaciones`, sin Firestore. Los campos de fecha llevan ms. */
export interface ConsultaPlana { restricciones: Restriccion[]; orden: Orden[]; limite?: number }
/** La forma de una consulta: lo que decide qué índice necesita (sin los valores). */
export interface FormaConsulta { id: string; filtros: { campo: string; op: OperadorConsulta }[]; orden: Orden[] }

/** Campos cuyo valor, en una `Restriccion`, son ms y hay que convertir a Timestamp. */
export const CAMPOS_FECHA: readonly string[] = ['ultimoEn', 'ventanaVenceEn'];

/**
 * TODAS las formas de consulta que la pantalla puede mandar a Firestore. La prueba
 * `conversaciones-indices.test.ts` exige que cada una tenga su índice declarado
 * en `firestore.indexes.json` y que `formaDe(...)` de lo que la pantalla arma
 * esté en esta lista: una consulta nueva se agrega acá, con su índice.
 */
export const FORMAS_CONSULTA: readonly FormaConsulta[] = [
  { id: 'todas', filtros: [], orden: [{ campo: 'ultimoEn', dir: 'desc' }] },
  {
    id: 'humano',
    filtros: [{ campo: 'atencionEstado', op: 'in' }, { campo: 'ultimoEn', op: '>=' }],
    orden: [{ campo: 'ultimoEn', dir: 'desc' }],
  },
  { id: 'noLeidas', filtros: [{ campo: 'sinLeer', op: '==' }], orden: [{ campo: 'ultimoEn', dir: 'desc' }] },
  {
    id: 'vencer',
    filtros: [{ campo: 'ventanaVenceEn', op: '>' }, { campo: 'ventanaVenceEn', op: '<=' }],
    orden: [{ campo: 'ventanaVenceEn', dir: 'asc' }],
  },
  { id: 'telefono-trozos', filtros: [{ campo: 'telefonoTrozos', op: 'array-contains' }], orden: [] },
  { id: 'telefono-prefijo', filtros: [{ campo: 'telefono', op: '>=' }, { campo: 'telefono', op: '<' }], orden: [] },
  { id: 'nombre', filtros: [{ campo: 'nombrePalabras', op: 'array-contains' }], orden: [] },
];

/** La forma (sin valores) de una consulta concreta. */
export function formaDe(c: ConsultaPlana): Omit<FormaConsulta, 'id'> {
  return { filtros: c.restricciones.map((r) => ({ campo: r.campo, op: r.op })), orden: c.orden.map((o) => ({ ...o })) };
}

/** La consulta de cada filtro de la lista. Con `limite` = una página; sin él, para contar. */
export function consultaDeFiltro(filtro: Filtro, ahora: number, limite?: number): ConsultaPlana {
  const con = (c: ConsultaPlana): ConsultaPlana => (limite === undefined ? c : { ...c, limite });
  switch (filtro) {
    case 'todas':
      return con({ restricciones: [], orden: [{ campo: 'ultimoEn', dir: 'desc' }] });
    case 'humano':
      // Solo las de las últimas 24 h: «necesita humano» de hace una semana ya no es una urgencia.
      return con({
        restricciones: [
          { campo: 'atencionEstado', op: 'in', valor: [...ESTADOS_HUMANO] },
          { campo: 'ultimoEn', op: '>=', valor: ahora - VENTANA_HORAS * HORA_MS },
        ],
        orden: [{ campo: 'ultimoEn', dir: 'desc' }],
      });
    case 'noLeidas':
      return con({ restricciones: [{ campo: 'sinLeer', op: '==', valor: true }], orden: [{ campo: 'ultimoEn', dir: 'desc' }] });
    case 'vencer':
      return con({
        restricciones: [
          { campo: 'ventanaVenceEn', op: '>', valor: ahora },
          { campo: 'ventanaVenceEn', op: '<=', valor: ahora + POR_VENCER_HORAS * HORA_MS },
        ],
        orden: [{ campo: 'ventanaVenceEn', dir: 'asc' }],
      });
  }
}

/** ¿El filtro depende del reloj? Esos se vuelven a pedir cada 5 minutos. */
export const filtroConReloj = (f: Filtro): boolean => f === 'humano' || f === 'vencer';

/**
 * Las consultas de una búsqueda por teléfono (≥ 4 dígitos): los «trozos» (finales
 * del número, para los últimos 4/8 dígitos) y un rango por prefijo del `telefono`
 * con lo escrito tal cual y completado con cada prefijo de país del comercio.
 */
export function consultasDeTelefono(digitos: string, prefijos: readonly string[]): ConsultaPlana[] {
  if (digitos.length < MINIMO_DIGITOS) return [];
  const comienzos = [digitos, ...prefijos.map((p) => p + digitos)].filter((c, i, todos) => todos.indexOf(c) === i);
  return [
    { restricciones: [{ campo: 'telefonoTrozos', op: 'array-contains', valor: digitos }], orden: [], limite: LIMITE_BUSQUEDA },
    ...comienzos.map((c): ConsultaPlana => ({
      restricciones: [{ campo: 'telefono', op: '>=', valor: c }, { campo: 'telefono', op: '<', valor: c + '' }],
      orden: [], limite: LIMITE_BUSQUEDA,
    })),
  ];
}

/** La consulta por nombre: la palabra más selectiva (`nombrePalabras` guarda las raíces). */
export function consultaDeNombre(palabra: string): ConsultaPlana {
  return { restricciones: [{ campo: 'nombrePalabras', op: 'array-contains', valor: palabra }], orden: [], limite: LIMITE_BUSQUEDA };
}

// ── Qué es lo que la persona escribió en el buscador ─────────────────────────

export type Consulta =
  | { tipo: 'vacia' }
  | { tipo: 'corta'; digitos: string }
  | { tipo: 'telefono'; digitos: string }
  | { tipo: 'texto'; texto: string; palabras: string[] };

/**
 * Un buscador, dos búsquedas. Si lo escrito son solo cifras (con +, espacios,
 * guiones o paréntesis, como se pega un número) es un teléfono; si no, es texto.
 *
 * EL «00» INICIAL. Un número pegado como «00 591 …» (marcación internacional)
 * quita el «00»: lo que se guarda es «591…». Pero «0047» (los últimos 4) y
 * «00000047» (el número sin prefijo) también empiezan en «00» y NO son marcación
 * internacional: por eso solo se quita con 11 dígitos o más, que es lo que mide
 * un número con prefijo de país y «00» delante.
 */
export function clasificarConsulta(crudo: string): Consulta {
  const q = crudo.trim();
  if (!q) return { tipo: 'vacia' };
  if (/^[\d\s+\-().]+$/.test(q)) {
    let digitos = soloDigitos(q);
    if (!digitos) return { tipo: 'vacia' };
    if (digitos.startsWith('00') && digitos.length >= 11) digitos = digitos.slice(2);
    return digitos.length < MINIMO_DIGITOS ? { tipo: 'corta', digitos } : { tipo: 'telefono', digitos };
  }
  return { tipo: 'texto', texto: normalizarTexto(q).trim(), palabras: palabrasDe(q, 6) };
}

/**
 * ¿El teléfono coincide con lo escrito? Devuelve el MEJOR tipo de coincidencia
 * (para ordenar) o null.
 *
 *   completo   el número entero, con o sin el prefijo del país
 *   final      lo escrito es el final del número (últimos 4, últimos 8…)
 *   inicio     lo escrito es el comienzo del número, con prefijo
 *   sin-prefijo  lo escrito es el comienzo del número SIN el prefijo del país
 *              (se completa con el prefijo del comercio)
 */
export type TipoCoincidenciaTelefono = 'completo' | 'final' | 'inicio' | 'sin-prefijo';

export function coincidenciaTelefono(
  telefono: string, trozos: readonly string[] | undefined, digitos: string,
  prefijos: readonly string[] = PREFIJOS_PAIS_DEFECTO,
): TipoCoincidenciaTelefono | null {
  if (digitos.length < MINIMO_DIGITOS) return null;
  const tel = soloDigitos(telefono);
  if (!tel) return null;
  if (tel === digitos) return 'completo';
  for (const p of prefijos) if (tel === p + digitos) return 'completo';
  const finales = trozos && trozos.length ? trozos : trozosDeTelefono(tel);   // documento viejo: se calcula acá
  if (finales.includes(digitos)) return 'final';
  if (tel.startsWith(digitos)) return 'inicio';
  for (const p of prefijos) if (tel.startsWith(p + digitos)) return 'sin-prefijo';
  return null;
}

const PESO_TELEFONO: Record<TipoCoincidenciaTelefono, number> = {
  completo: 0, final: 1, 'sin-prefijo': 2, inicio: 3,
};

export interface ResultadoTelefono { ficha: Ficha; tipo: TipoCoincidenciaTelefono }

/** Las fichas que coinciden con el teléfono, lo más específico primero y, a igualdad, lo más reciente. */
export function buscarPorTelefono(
  fichas: readonly Ficha[], digitos: string, prefijos: readonly string[] = PREFIJOS_PAIS_DEFECTO,
): ResultadoTelefono[] {
  const salida: ResultadoTelefono[] = [];
  for (const ficha of fichas) {
    const tipo = coincidenciaTelefono(ficha.telefono, ficha.telefonoTrozos, digitos, prefijos);
    if (tipo) salida.push({ ficha, tipo });
  }
  return salida.sort((a, b) => PESO_TELEFONO[a.tipo] - PESO_TELEFONO[b.tipo] || (b.ficha.ultimoEn ?? 0) - (a.ficha.ultimoEn ?? 0));
}

/** Por nombre del contacto: todas las palabras escritas tienen que estar en el nombre. */
export function buscarPorNombre(fichas: readonly Ficha[], texto: string): Ficha[] {
  const partes = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  if (!partes.length) return [];
  return fichas.filter((f) => {
    const n = normalizarTexto(f.nombre);
    return partes.every((p) => n.includes(p));
  });
}

/** Une listas de fichas por id; en un id repetido gana la ÚLTIMA (la más reciente de las que se pasan). */
export function unirFichas(...listas: readonly (readonly Ficha[])[]): Ficha[] {
  const m = new Map<string, Ficha>();
  for (const l of listas) for (const f of l) m.set(f.id, f);
  return [...m.values()];
}

// ── Ventana de 24 h ──────────────────────────────────────────────────────────

export type EstadoVentana = 'sin-dato' | 'abierta' | 'por-vencer' | 'cerrada';

export interface Ventana { estado: EstadoVentana; restanteMs: number }

/**
 * La ventana corre desde el ÚLTIMO MENSAJE DEL CLIENTE (`ultimoEntranteEn`), no
 * desde el último mensaje de la conversación: un mensaje del asistente o de una
 * persona no la abre ni la prolonga. SIN DATO (`null`: todas las conversaciones
 * de antes de H1) no es «cerrada»: no se sabe, y la pantalla no pinta pastilla.
 */
export function ventanaDe(ultimoEntranteEn: number | null, ahora: number): Ventana {
  if (ultimoEntranteEn === null) return { estado: 'sin-dato', restanteMs: 0 };
  const restanteMs = ultimoEntranteEn + VENTANA_HORAS * HORA_MS - ahora;
  if (restanteMs <= 0) return { estado: 'cerrada', restanteMs: 0 };
  return { estado: restanteMs < POR_VENCER_HORAS * HORA_MS ? 'por-vencer' : 'abierta', restanteMs };
}

/** La ventana de una ficha: de `ultimoEntranteEn`, o de `ventanaVenceEn` − 24 h si solo viene ese. */
export function ventanaDeFicha(f: Pick<Ficha, 'ultimoEntranteEn' | 'ventanaVenceEn'>, ahora: number): Ventana {
  const desde = f.ultimoEntranteEn ?? (f.ventanaVenceEn !== null ? f.ventanaVenceEn - VENTANA_HORAS * HORA_MS : null);
  return ventanaDe(desde, ahora);
}

/** «3 h 20 min», «45 min», «menos de 1 min». */
export function textoRestante(ms: number): string {
  if (ms <= 0) return 'cerrada';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

// ── Filtros ──────────────────────────────────────────────────────────────────

/**
 * «Necesita humano» (decisión P2): `necesitaHumano === true` (lo escribirá H2) o un
 * estado de atención que pide a una persona (`operador`, `bloqueado`) con la
 * conversación activa en las últimas 24 h. Un documento sin ninguno de los dos no.
 */
export function necesitaHumanoDe(f: Ficha, ahora: number): boolean {
  if (f.necesitaHumano) return true;
  return ESTADOS_HUMANO.includes(f.atencionEstado) && f.ultimoEn !== null && f.ultimoEn >= ahora - VENTANA_HORAS * HORA_MS;
}

/** Qué filtros cumple una conversación (el mismo criterio que la consulta del servidor). */
export function cumpleFiltro(f: Ficha, filtro: Filtro, ahora: number): boolean {
  switch (filtro) {
    case 'todas': return true;
    case 'humano': return necesitaHumanoDe(f, ahora);
    case 'noLeidas': return f.sinLeer;
    case 'vencer': return f.ventanaVenceEn !== null && f.ventanaVenceEn > ahora && f.ventanaVenceEn <= ahora + POR_VENCER_HORAS * HORA_MS;
  }
}

/**
 * Aplica el filtro. `fijadas` son las conversaciones que la persona abrió con el
 * filtro puesto: se quedan en la lista aunque al abrirlas dejen de cumplirlo
 * (una «no leída» deja de serlo al leerla). Sin esto la lista salta bajo los
 * dedos, y «siguiente» saltearía conversaciones: el que recorre las no leídas
 * con el teclado perdería su lugar.
 */
export function aplicarFiltro(
  fichas: readonly Ficha[], filtro: Filtro, ahora: number, fijadas: ReadonlySet<string> = new Set(),
): Ficha[] {
  return fichas.filter((f) => fijadas.has(f.id) || cumpleFiltro(f, filtro, ahora));
}

/** Más reciente arriba, como WhatsApp; «por vencer» ordena por la que vence antes. */
export function ordenarPara(filtro: Filtro, fichas: readonly Ficha[]): Ficha[] {
  if (filtro === 'vencer') {
    return [...fichas].sort((a, b) => (a.ventanaVenceEn ?? Infinity) - (b.ventanaVenceEn ?? Infinity) || (b.ultimoEn ?? 0) - (a.ultimoEn ?? 0));
  }
  return [...fichas].sort((a, b) => (b.ultimoEn ?? 0) - (a.ultimoEn ?? 0));
}

export const ordenarPorReciente = (fichas: readonly Ficha[]): Ficha[] => ordenarPara('todas', fichas);

/**
 * La lista que se ve: la primera página EN VIVO, las páginas anteriores (sin vivo)
 * y las fijadas (las abiertas con el filtro puesto, que se quedan aunque ya no lo
 * cumplan). En un id repetido gana la versión más fresca: en vivo > fijada >
 * página anterior (una página anterior es una foto de cuando se pidió).
 */
export function mezclarLista(
  filtro: Filtro, enVivo: readonly Ficha[], anteriores: readonly Ficha[], fijadas: ReadonlyMap<string, Ficha> = new Map(),
): Ficha[] {
  return ordenarPara(filtro, unirFichas(anteriores, [...fijadas.values()], enVivo));
}

/** Los contadores de los chips: `null` = todavía no se pudo contar (no se inventa un cero). */
export type Contadores = Record<Filtro, number | null>;
export const CONTADORES_VACIOS: Contadores = { todas: null, humano: null, noLeidas: null, vencer: null };

// ── Marcar leída ─────────────────────────────────────────────────────────────

/**
 * ¿Hay que escribir `{noLeidos: 0, sinLeer: false}`? Solo si quien mira es del
 * negocio con rol admin u oper (el propietario de NovuChat NUNCA marca: ve con
 * una ventana de soporte y no deja huella en los datos del comercio), con la
 * pestaña visible y algo por marcar. Un documento viejo (sin los campos) no se
 * toca: ya es «leído».
 */
export function debeMarcarLeida(a: {
  rol: string | null; propietario: boolean; visible: boolean; noLeidos: number; sinLeer: boolean;
}): boolean {
  if (a.propietario) return false;
  if (a.rol !== 'admin' && a.rol !== 'oper') return false;
  if (!a.visible) return false;
  return a.noLeidos > 0 || a.sinLeer;
}

// ── Errores de la búsqueda por palabra (callable `buscarConversaciones`) ─────

/**
 * El texto para quien busca, según el CÓDIGO del error (`e.code`) y nunca su
 * `message`: el mensaje de una Function puede traer detalles internos y no
 * está pensado para la pantalla. Los códigos son los de `firebase/functions`
 * (`functions/<código>`); también se aceptan sin el prefijo.
 */
export function textoErrorBusqueda(codigo: unknown, conCursor = false): string {
  const c = typeof codigo === 'string' ? codigo.replace(/^functions\//, '') : '';
  switch (c) {
    case 'unauthenticated': return 'Su sesión venció. Vuelva a ingresar para buscar.';
    case 'permission-denied': return 'No tiene permiso para buscar en estas conversaciones.';
    case 'invalid-argument': return conCursor ? 'La búsqueda cambió; vuelva a buscar.' : 'Escriba al menos una palabra de 3 letras.';
    case 'resource-exhausted': return 'Hay demasiadas búsquedas seguidas. Espere un momento e intente de nuevo.';
    case 'not-found': return 'La búsqueda por palabra todavía no está disponible. Puede buscar por teléfono o por nombre.';
    default: return 'La búsqueda por palabra no está disponible en este momento. Intente de nuevo.';
  }
}

// ── Anterior / siguiente ─────────────────────────────────────────────────────

/**
 * La conversación vecina en la lista que se está viendo. No da la vuelta: en el
 * borde se queda donde está (devuelve null), porque saltar de la última a la
 * primera desorienta a quien recorre una lista larga. Si la actual no está en
 * la lista (se filtró, o no hay ninguna abierta), «siguiente» va a la primera y
 * «anterior» a la última.
 */
export function vecina(ids: readonly string[], actual: string | null, direccion: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = actual === null ? -1 : ids.indexOf(actual);
  if (i < 0) return direccion === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  const j = i + direccion;
  return j < 0 || j >= ids.length ? null : (ids[j] ?? null);
}

// ── Rutas ────────────────────────────────────────────────────────────────────

/**
 * La dirección de una conversación: `/negocio/:t/conversaciones/:c` y, si viene de
 * una búsqueda, `?m=<mensaje>` para saltar a él. Todo escapado.
 */
export function rutaConversaciones(tenantId: string, conversacionId?: string | null, mensajeId?: string | null): string {
  const base = `/negocio/${encodeURIComponent(tenantId)}/conversaciones`;
  if (!conversacionId) return base;
  if (CONVERSACION_EN_LA_RUTA) {
    return `${base}/${encodeURIComponent(conversacionId)}${mensajeId ? `?m=${encodeURIComponent(mensajeId)}` : ''}`;
  }
  const p = new URLSearchParams({ c: conversacionId });
  if (mensajeId) p.set('m', mensajeId);
  return `${base}?${p.toString()}`;
}

// ── Etiquetas de hora (siempre en hora de Bolivia, UTC-4 fijo) ───────────────

const BO_MS = -4 * HORA_MS;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function enBolivia(ms: number) {
  const d = new Date(ms + BO_MS);
  return {
    dia: Math.floor((ms + BO_MS) / 86_400_000),
    h: d.getUTCHours(), min: d.getUTCMinutes(), sem: d.getUTCDay(),
    d: d.getUTCDate(), m: d.getUTCMonth() + 1, a: d.getUTCFullYear(),
  };
}
const dos = (n: number) => String(n).padStart(2, '0');

export function horaCorta(ms: number): string {
  const b = enBolivia(ms);
  return `${dos(b.h)}:${dos(b.min)}`;
}

/** La hora de la ficha: hoy «14:05», ayer «Ayer», esta semana el día, antes la fecha. */
export function etiquetaFicha(ms: number | null, ahora: number): string {
  if (ms === null) return '';
  const b = enBolivia(ms);
  const dif = enBolivia(ahora).dia - b.dia;
  if (dif <= 0) return horaCorta(ms);
  if (dif === 1) return 'Ayer';
  if (dif < 7) return DIAS[b.sem] ?? '';
  return `${dos(b.d)}/${dos(b.m)}/${String(b.a).slice(2)}`;
}

/** El separador de día dentro del hilo. */
export function etiquetaDia(ms: number, ahora: number): string {
  const b = enBolivia(ms);
  const dif = enBolivia(ahora).dia - b.dia;
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  return `${dos(b.d)}/${dos(b.m)}/${b.a}`;
}

export function mismoDia(a: number, b: number): boolean {
  return enBolivia(a).dia === enBolivia(b).dia;
}
