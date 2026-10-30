import {
  IDS_MODULOS, MODULOS_COMUNES_HOY, PUENTE_DE_FLUJOS, esModulo, type IdModulo,
} from '../../registro.js';

/**
 * =============================================================================
 * EL CONTRATO DE LOS GANCHOS DEL TURNO (F3b-2a, `Analisis/41` §2.3 y §7 F3b)
 * =============================================================================
 *
 * `configuracionFlujo` (el turno que llama n8n) arma la respuesta con piezas de
 * cinco modulos: campañas, captacion, inventario, el cobro de una venta y la
 * seña de una reserva. Hoy `ingesta.ts` los importa y los llama uno por uno,
 * decidiendo por `comercio.flujo`. F3b-2b..2e los cortan: cada modulo entrega
 * su gancho y el coordinador recorre los ENCENDIDOS para ese numero.
 *
 * Este archivo es Core y solo deja DOS cosas, sin mover logica:
 *
 *  1. Los TIPOS de los ganchos (`GanchosDelTurno`). Core no importa nada de un
 *     modulo: por eso la entrada y la salida son datos planos (`Record`), no
 *     los tipos de cada modulo. Las firmas salen de como `ingesta.ts` llama hoy
 *     a cada pieza (`campanasParaElFlujo`, `anunciosParaElFlujo`,
 *     `sanearCaptacion`, `existencias`, `cobroParaElFlujo`, `senaParaElFlujo`).
 *  2. `modulosDelTurno`, la funcion PURA que dice cuales corren.
 *
 * POR QUE LA INTERSECCION CON EL FLUJO DEL NUMERO Y NO SOLO `tenants.modulos`.
 * Un comercio con varios numeros tiene un flujo por numero (la ruta de
 * `rutasWhatsApp`). Hoy la seña solo sale en el numero de agendamiento y el
 * cobro de venta solo en el de venta, aunque la ficha tenga los dos flujos.
 * Si el coordinador mirara solo los modulos de la ficha, el numero de venta
 * recibiria tambien la seña, y eso cambia la respuesta de todos esos comercios.
 * La interseccion conserva el comportamiento de hoy.
 */

/** Un documento del catalogo activo que este turno YA leyo (cero lecturas nuevas). */
export interface ItemDelTurno {
  readonly id: string;
  readonly datos: Readonly<Record<string, unknown>>;
}

/**
 * Lo que el coordinador le da a un gancho. Todo viene de lecturas que el turno
 * ya hace; un gancho no lee Firestore por su cuenta (cero lecturas nuevas) y no
 * escribe: devuelve datos.
 */
export interface ContextoDelTurno {
  /** Sale de la ruta autenticada, nunca del cuerpo. */
  readonly tenantId: string;
  /** El flujo del NUMERO que escribio (`agendamiento` si la ruta no lo trae). */
  readonly flujo: string;
  /** Telefono del cliente final, o `null` si el flujo no lo mando. */
  readonly telefono: string | null;
  readonly ahoraMs: number;
  /** `config/negocio`. */
  readonly negocio: Readonly<Record<string, unknown>>;
  /** `cuenta/estado`, o `null` si no existe (rigen los limites de respaldo). */
  readonly cuenta: Readonly<Record<string, unknown>> | null;
  /** El documento especifico del flujo (`config/{vertical}`), o `undefined`. */
  readonly especifica: Readonly<Record<string, unknown>> | undefined;
  /** Las campañas `vigentes` de `config/campanas`, ya revalidadas por terminos. */
  readonly vigentesDeCampanas: unknown;
  readonly catalogo: readonly ItemDelTurno[];
  /** La solicitud del telefono (`conversaciones/wa_{tel}.solicitud`), si hay. */
  readonly solicitud: unknown;
  /** Encendido Y con codigo; si no, el cobro es simulado. */
  readonly cobroRealActivo: boolean;
  readonly moneda: string;
  /** Arma la direccion publica de la imagen del QR a partir de su ficha. */
  readonly urlDelQr: (ficha: string) => string;
}

/**
 * Lo que un gancho aporta a la respuesta: claves de primer nivel que el
 * coordinador mezcla en lo que ya devuelve. Un gancho NO pisa claves ajenas
 * (la prueba diferencial lo comprueba contra la respuesta de hoy).
 */
export type AporteDelTurno = Readonly<Record<string, unknown>>;

export type GanchoDelTurno = (contexto: ContextoDelTurno) => AporteDelTurno;

/**
 * Los cinco ganchos y el modulo al que pertenece cada uno. El nombre es el de
 * la pieza; el modulo lo fija `MODULO_DE_GANCHO`. Hoy:
 *
 *  - `campanas`:  `campanas` y `anuncios` (Campañas; capa comun, todo comercio).
 *  - `captacion`: `onboarding` saneado (solo el flujo de captacion).
 *  - `inventario`: `agotado` por item del catalogo (el estado de existencias).
 *  - `cobroDeVenta`: `cobroReal` | `cobroSimulado`, y `cobro` (solo venta).
 *  - `sena`: `sena` (solo agendamiento).
 */
export interface GanchosDelTurno {
  readonly campanas: GanchoDelTurno;
  readonly captacion: GanchoDelTurno;
  readonly inventario: GanchoDelTurno;
  readonly cobroDeVenta: GanchoDelTurno;
  readonly sena: GanchoDelTurno;
}

export type NombreDeGancho = keyof GanchosDelTurno;

/**
 * A que modulo pertenece cada gancho. `cobroDeVenta` y `sena` son los dos de
 * Cobros: que corran en el numero correcto lo decide el flujo del numero, no el
 * modulo (ver `modulosDelTurno`). `satisfies` hace que olvidar un gancho nuevo
 * no compile.
 */
export const MODULO_DE_GANCHO = {
  campanas: 'campanas',
  captacion: 'captacion',
  inventario: 'inventario',
  cobroDeVenta: 'cobros',
  sena: 'cobros',
} as const satisfies Record<NombreDeGancho, IdModulo>;

/** Lo minimo de la ficha del tenant que mira `modulosDelTurno`. */
export type FichaDelTurno = Readonly<Record<string, unknown>> | null | undefined;

const comoLista = (v: unknown): readonly string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

/**
 * Los modulos de un flujo, segun el puente del registro; vacio si el flujo no
 * existe (un valor raro en la ruta no enciende nada por su cuenta).
 */
function modulosDelFlujo(flujoRuta: string): readonly IdModulo[] {
  const puente = PUENTE_DE_FLUJOS as Readonly<Record<string, { readonly modulos: readonly IdModulo[] }>>;
  return Object.prototype.hasOwnProperty.call(puente, flujoRuta) ? (puente[flujoRuta]?.modulos ?? []) : [];
}

/**
 * Los modulos ENCENDIDOS de la ficha. Con `modulos` (la lista que escribe la
 * migracion de H2b) manda esa lista; sin ella —ficha vieja— se derivan de sus
 * `flujos` por el puente mas los comunes de hoy (todo comercio los tiene), que
 * es lo que hoy hace cada comercio sin saberlo.
 * Lo desconocido se ignora: un id que no es modulo no enciende nada.
 */
function modulosEncendidos(ficha: FichaDelTurno): ReadonlySet<IdModulo> {
  const propios = comoLista(ficha?.['modulos']);
  if (propios !== null) return new Set(propios.filter(esModulo));
  const flujos = comoLista(ficha?.['flujos']) ?? [];
  return new Set<IdModulo>([...MODULOS_COMUNES_HOY, ...flujos.flatMap((f) => modulosDelFlujo(f))]);
}

/**
 * LOS MODULOS QUE CORREN EN ESTE TURNO: encendidos ∩ (modulos del flujo del
 * numero ∪ comunes), en el orden de `IDS_MODULOS` (el topologico del registro).
 *
 *  - Un modulo apagado en la ficha no corre, este en el flujo que este.
 *  - Un modulo encendido pero fuera del flujo del numero no corre en ese numero.
 *  - Los comunes (`MODULOS_COMUNES_HOY`) corren siempre que esten encendidos: no
 *    dependen del flujo del numero. «Encendidos» sigue mandando: un comun que la
 *    ficha apaga (Campañas con limite 0) no corre.
 *  - El orden es el del registro, no el de la lista de la ficha: dos fichas con
 *    la misma lista en distinto orden dan el mismo recorrido.
 *  - Una ficha sin lista (`null`, sin `modulos` ni `flujos`) tiene encendidos
 *    solo los comunes de hoy: no inventa modulos de un flujo que no declara.
 *
 * Pura: sin Firestore, sin reloj. No devuelve nunca un id fuera de `IDS_MODULOS`.
 */
export function modulosDelTurno(ficha: FichaDelTurno, flujoRuta: string): readonly IdModulo[] {
  const encendidos = modulosEncendidos(ficha);
  const delNumero = new Set<IdModulo>([...modulosDelFlujo(flujoRuta), ...MODULOS_COMUNES_HOY]);
  return IDS_MODULOS.filter((m) => encendidos.has(m) && delNumero.has(m));
}
