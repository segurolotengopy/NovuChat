/**
 * =============================================================================
 * LOS TRES EJES DE LA CUENTA EN LA CONSOLA: plan, modalidad y titularidad
 * (`Analisis/41` §4), más el modelo por tenant y los cambios incluidos del mes
 * =============================================================================
 *
 * EL CRITERIO ES DEL SERVIDOR. Las listas cerradas (modelos, titularidades) y
 * la aritmética de los cambios del mes viven en `functions/src/central/ejes.ts`,
 * módulo puro que esta consola importa directamente, igual que `planes.ts` y
 * `prepago.ts`. Si la consola tuviera su propia lista, podría ofrecer un valor
 * que el servidor rechaza.
 *
 * Lo que agrega este archivo es de la PANTALLA: las palabras con que se dice
 * cada valor, los nombres de las callables en un solo lugar (`CALLABLES`) y la
 * forma de la respuesta de `ejesDeCuenta`, que es el ÚNICO camino por el que
 * el comercio ve la titularidad de sus números (`rutasWhatsApp` es solo del
 * propietario en `firestore.rules`: el documento trae el alias del secreto).
 *
 * LA CONSOLA NO DECIDE NADA CON ESTOS DATOS: los muestra y pide al servidor
 * que los cambie. Ninguna pantalla compara el plan con «demostracion» ni lee
 * `pagaMeta`: la modalidad la dice `modalidadDe` y la titularidad, cada número.
 *
 * Módulo puro: no importa Firebase, se prueba sin emulador.
 */
import { MODALIDADES, esModalidad, modalidadDe, type CuentaCruda, type Modalidad } from './prepago';
import {
  MODELOS, MODELO_POR_DEFECTO, TITULARIDADES, TITULARIDAD_POR_DEFECTO, esModelo, esTitularidad,
  modeloDe as modeloDeFicha, titularidadDe as titularidadDeRuta,
  type Modelo, type Titularidad,
} from '../../../functions/src/central/ejes';
// LO QUE VA POR CONTRATO (F1b): las validaciones y las lecturas del precio y
// de la prueba son las del servidor, importadas del módulo puro como todo lo
// demás de esta carpeta. El campo de la pantalla valida con el MISMO
// predicado con que el servidor rechaza.
import {
  LIMITE_MAXIMO, MAXIMO_PRECIO_POR_CONTRATO_USD, conversacionesValidas, precioMensualDe, precioPorContratoDe,
  precioPorContratoValido,
} from '../../../functions/src/planes';
import {
  BOLSA_PRUEBA_MAXIMA, bolsaPruebaValida, esPeriodo, inicioDePrueba, mesBolivia,
} from '../../../functions/src/prepago';

export { MODALIDADES, esModalidad, modalidadDe, MODELOS, MODELO_POR_DEFECTO, TITULARIDADES, esModelo, esTitularidad };
export type { Modalidad, Modelo, Titularidad };
export {
  BOLSA_PRUEBA_MAXIMA, LIMITE_MAXIMO, MAXIMO_PRECIO_POR_CONTRATO_USD, bolsaPruebaValida, conversacionesValidas,
  precioMensualDe, precioPorContratoDe, precioPorContratoValido,
};

// -----------------------------------------------------------------------------
// LAS CALLABLES, POR NOMBRE
// -----------------------------------------------------------------------------

export const CALLABLES = {
  /**
   * Plan, modalidad, umbrales, motivo visible, corte por tenant y lo que va
   * por contrato: cambios incluidos, conversaciones, precio y la prueba.
   */
  cuenta: 'actualizarEstadoCuenta',
  /** Titularidad por número y modelo por tenant (solo propietario). */
  ejes: 'asignarEjes',
  /** Los tres ejes, el modelo y los cambios del mes, para pintar (admin o propietario). */
  leerEjes: 'ejesDeCuenta',
  /** Un cambio de configuración operado por NovuChat, contra `cambiosIncluidos`. */
  cambio: 'registrarCambioOperado',
  suspender: 'suspenderTenant',
  reactivar: 'reactivarTenant',
  corte: 'fijarCortePrepago',
  pagoManual: 'registrarPagoManual',
} as const;

// -----------------------------------------------------------------------------
// LA RESPUESTA DE `ejesDeCuenta`
// -----------------------------------------------------------------------------

export interface NumeroDeCuenta {
  phoneNumberId: string;
  flujo: string;
  estado: string;
  titularidad: Titularidad;
  titularidadExplicita: boolean;
}

/** `cambios` de `ejesDeCuenta`: en demostración, `incluidos` y `restantes` vienen en `null` e `ilimitado` en `true`. */
export interface CambiosVista {
  mes: string;
  usados: number;
  incluidos: number | null;
  restantes: number | null;
  ilimitado: boolean;
}

export interface EjesDeCuenta {
  tenantId: string;
  plan: string | null;
  limites: {
    conversaciones: number; productos: number; agendas: number; cambiosIncluidos: number;
    origen: 'cuenta' | 'plan' | 'respaldo';
    /**
     * Las claves de la copia fijadas POR CONTRATO (`porContratoDe` de
     * `planes.ts`); un cambio de plan las conserva. Opcional: un servidor
     * anterior a este campo no lo manda, y entonces el origen no se afirma.
     */
    porContrato?: string[];
    /** Cuántos cambios trae el plan de la cuenta, para decir «el plan trae N». */
    cambiosIncluidosDelPlan?: number;
    /** Cuántas conversaciones trae el plan de la cuenta (F1b), para decir «el plan trae N». */
    conversacionesDelPlan?: number;
  };
  /**
   * LA MENSUALIDAD QUE RIGE (F1b): la del contrato si la cuenta tiene una, si
   * no la del plan. Opcional: un servidor anterior no la manda, y entonces la
   * pantalla usa la del plan sin afirmar ningún contrato.
   */
  precio?: { mensualUsd: number; porContrato: number | null; delPlanUsd: number };
  modalidad: Modalidad;
  modalidadExplicita: boolean;
  modelo: Modelo;
  numeros: NumeroDeCuenta[];
  cambios: CambiosVista;
}

/**
 * DE DÓNDE SALEN LOS CAMBIOS INCLUIDOS: `contrato` si la cuenta los fijó por
 * contrato, `plan` si rigen los del plan, `null` si el servidor no lo dijo
 * (uno anterior a este campo): en ese caso la pantalla no afirma ninguno.
 */
export function origenDeCambiosIncluidos(ejes: Pick<EjesDeCuenta, 'limites'> | null | undefined): 'contrato' | 'plan' | null {
  return origenPorContrato(ejes, 'cambiosIncluidos');
}

/**
 * LO MISMO PARA CUALQUIER CLAVE POR CONTRATO (F1b: `cambiosIncluidos` y
 * `conversaciones`): `contrato`, `plan`, o `null` si el servidor no lo dijo.
 */
export function origenPorContrato(
  ejes: Pick<EjesDeCuenta, 'limites'> | null | undefined, clave: 'cambiosIncluidos' | 'conversaciones',
): 'contrato' | 'plan' | null {
  const por = ejes?.limites.porContrato;
  if (!Array.isArray(por)) return null;
  return por.includes(clave) ? 'contrato' : 'plan';
}

/**
 * LA PRUEBA DE UNA CUENTA, PARA PINTARLA (F1b): su primer y su último mes y
 * la bolsa que queda. `null` si la cuenta no tiene un período de prueba sano.
 * `desde` sale de `inicioDePrueba`, la misma lectura que `estadoDeServicio`.
 */
export function pruebaDeCuenta(cuenta: CuentaCruda | null | undefined): { desde: string; hasta: string; bolsa: number | null } | null {
  const hasta = cuenta?.periodoPrueba;
  if (!esPeriodo(hasta)) return null;
  const bolsa = cuenta?.bolsaPrueba;
  return { desde: inicioDePrueba(cuenta), hasta, bolsa: typeof bolsa === 'number' && Number.isFinite(bolsa) ? bolsa : null };
}

/**
 * ¿Es un último mes de prueba que el servidor aceptaría? Un `aaaa-mm` que no
 * es anterior al mes en curso de Bolivia (`pruebaNueva` rechaza los pasados).
 * La modalidad la mira el servidor contra la cuenta.
 */
export const periodoPruebaAceptable = (v: unknown, ahoraMs: number): v is string =>
  esPeriodo(v) && v >= mesBolivia(ahoraMs);

/** El mes en curso de Bolivia (`aaaa-mm`): el mínimo del campo del último mes de prueba. */
export const mesEnCurso = (ahoraMs: number): string => mesBolivia(ahoraMs);

// -----------------------------------------------------------------------------
// MODALIDAD — las palabras nuevas sobre los valores del servidor
// -----------------------------------------------------------------------------

/** Cómo se le dice cada modalidad al comercio y al propietario. */
export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = {
  demostracion: 'Demostración',
  prueba: 'Prueba',
  prepago: 'Producción',
};

export const etiquetaModalidad = (cuenta: CuentaCruda | null | undefined): string =>
  ETIQUETA_MODALIDAD[modalidadDe(cuenta)];

/** Lo que explica cada modalidad en un `title` o una ayuda. */
export const DESCRIPCION_MODALIDAD: Record<Modalidad, string> = {
  demostracion: 'Sin costo y sin corte: es para mostrar el asistente.',
  prueba: 'Un mes sin mensualidad, con 20 conversaciones de prueba. El paso a producción lo hace NovuChat.',
  prepago: 'El comercio paga por adelantado y el servicio se corta si el mes no está cubierto.',
};

// -----------------------------------------------------------------------------
// TITULARIDAD — por número, no por plan
// -----------------------------------------------------------------------------

export const ETIQUETA_TITULARIDAD: Record<Titularidad, string> = {
  novuchat: 'Número de NovuChat',
  comercio: 'Número propio del comercio',
};

/** Lo que se le explica al comercio de cada titularidad. */
export const DESCRIPCION_TITULARIDAD: Record<Titularidad, string> = {
  novuchat: 'El número, la WABA y la tarjeta son de NovuChat: el consumo de WhatsApp entra en el precio del plan.',
  comercio: 'El número y la WABA son del comercio: Meta le factura el consumo de WhatsApp a su tarjeta. Lo que se paga a NovuChat es el servicio.',
};

/** Una ruta de WhatsApp tal como la lee el PROPIETARIO en la cartera (`rutasWhatsApp/{n}`). */
export interface RutaWhatsApp {
  phoneNumberId: string;
  tenantId: string;
  flujo?: unknown;
  estado?: unknown;
  titularidad?: unknown;
}

/**
 * La titularidad de un número o de una ruta, con la regla del servidor
 * (`titularidadDe` de `central/ejes.ts`: ausente o inválida, `novuchat`).
 * Acepta cualquier objeto con `titularidad`, sea una ruta de la cartera o un
 * número de `ejesDeCuenta`.
 */
export const titularidadDe = (n: { titularidad?: unknown } | null | undefined): Titularidad =>
  n ? titularidadDeRuta({ titularidad: n.titularidad }) : TITULARIDAD_POR_DEFECTO;

/** Lee un documento de `rutasWhatsApp` sin confiar en su forma. Solo para el propietario. */
export function rutaDe(id: string, datos: Record<string, unknown> | undefined): RutaWhatsApp {
  const d = datos ?? {};
  return {
    phoneNumberId: id,
    tenantId: typeof d['tenantId'] === 'string' ? d['tenantId'] : '',
    flujo: d['flujo'],
    estado: d['estado'],
    titularidad: d['titularidad'],
  };
}

/**
 * ¿A este comercio Meta le factura el consumo directamente? Sí si ALGUNO de
 * sus números es propio. La titularidad es por número (`Analisis/41` §4): un
 * comercio puede tener uno propio y otro provisto. Reemplaza al viejo
 * `paganEllosAMeta(plan)`, que lo deducía del plan BYOC.
 */
export const facturaMetaAlComercio = (numeros: readonly { titularidad?: unknown }[]): boolean =>
  numeros.some((n) => titularidadDe(n) === 'comercio');

// -----------------------------------------------------------------------------
// MODELO — decisión de NovuChat por tenant (`Analisis/41` §4, consecuencia 1)
// -----------------------------------------------------------------------------

/** Cómo se dice cada modelo en pantalla. Las claves son las de la lista cerrada del servidor. */
export const ETIQUETA_MODELO: Record<Modelo, string> = {
  'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-sonnet-5': 'Claude Sonnet 5',
};

export const modeloDe = (ficha: { modelo?: unknown } | null | undefined): Modelo =>
  modeloDeFicha(ficha ? { modelo: ficha.modelo } : null);
