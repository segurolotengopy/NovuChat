/**
 * =============================================================================
 * LOS TRES EJES DE LA CUENTA EN LA CONSOLA: plan, modalidad y titularidad
 * (`Analisis/41` §4), más el modelo por tenant y los cambios incluidos del mes
 * =============================================================================
 *
 * ESTE ARCHIVO ES EL CONTRATO CON FUNCTIONS, EN UN SOLO LUGAR. Los nombres de
 * las callables, de los campos y de los valores que el agente `central` expone
 * en la fase F1 se escriben acá y en ningún otro archivo de la consola: cuando
 * las dos ramas se reconcilien, lo que cambie se cambia una vez.
 *
 * Lo que HOY existe en `functions/src` y esta consola ya usa:
 *   - `cuenta/estado.modalidad` con `MODALIDADES` de `prepago.ts`
 *     (`demostracion | prueba | prepago`; el código conserva `prepago`, la
 *     consola dice «Producción», `Analisis/41` §6.1 punto 6);
 *   - `actualizarEstadoCuenta({ tenantId, plan?, modalidad?, periodoPrueba?,
 *     umbralOperador?, umbralBloqueo?, motivoVisible?, corteActivo? })`;
 *   - `suspenderTenant`, `reactivarTenant`, `fijarCortePrepago`,
 *     `registrarPagoManual`.
 *
 * Lo que se ASUME de `central` (rama `central/ejes-de-la-cuenta`) y se valida
 * al reconciliar:
 *   - `rutasWhatsApp/{phoneNumberId}.titularidad: 'novuchat' | 'comercio'`,
 *     ausente = `novuchat` (es lo que hoy son todos los números);
 *   - `tenants/{t}.modelo` con uno de `MODELOS`;
 *   - la clave de límite `cuenta/estado.limites.cambiosIncluidos` y el contador
 *     `cuenta/estado.cambios.{aaaa-mm}` (cambios operados por NovuChat en el
 *     mes, escrito por `registrarCambioOperado`);
 *   - la callable `asignarEjes({ tenantId, titularidad?: { phoneNumberId,
 *     titularidad }, modelo? })` para lo que `actualizarEstadoCuenta` no
 *     escribe hoy. Si `central` extiende `actualizarEstadoCuenta` en vez de
 *     agregarla, cambia `CALLABLES.ejes` y nada más.
 *
 * LA CONSOLA NO DECIDE NADA CON ESTOS DATOS: los muestra y pide al servidor
 * que los cambie. Ninguna pantalla vuelve a comparar `plan === 'demostracion'`
 * ni a leer `pagaMeta`: la modalidad la dice `modalidadDe` (módulo del
 * servidor) y la titularidad la dice cada número.
 *
 * Módulo puro: no importa Firebase, se prueba sin emulador.
 */
import { MODALIDADES, esModalidad, modalidadDe, type CuentaCruda, type Modalidad } from './prepago';
import { periodoDe } from './planes';

export { MODALIDADES, esModalidad, modalidadDe };
export type { Modalidad };

// -----------------------------------------------------------------------------
// LAS CALLABLES, POR NOMBRE
// -----------------------------------------------------------------------------

export const CALLABLES = {
  /** Plan, modalidad, umbrales, motivo visible y corte por tenant. Existe hoy. */
  cuenta: 'actualizarEstadoCuenta',
  /** Titularidad por número y modelo por tenant. La agrega `central`. */
  ejes: 'asignarEjes',
  /** Un cambio de configuración operado por NovuChat, contra `cambiosIncluidos`. La agrega `central`. */
  cambio: 'registrarCambioOperado',
  suspender: 'suspenderTenant',
  reactivar: 'reactivarTenant',
  corte: 'fijarCortePrepago',
  pagoManual: 'registrarPagoManual',
} as const;

// -----------------------------------------------------------------------------
// MODALIDAD — las palabras nuevas sobre los valores viejos
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
  prueba: 'Un mes sin mensualidad, con 20 conversaciones de prueba. Después pasa a producción.',
  prepago: 'El comercio paga por adelantado y el servicio se corta si el mes no está cubierto.',
};

// -----------------------------------------------------------------------------
// TITULARIDAD — por número, no por plan
// -----------------------------------------------------------------------------

export const TITULARIDADES = ['novuchat', 'comercio'] as const;
export type Titularidad = (typeof TITULARIDADES)[number];

export const esTitularidad = (v: unknown): v is Titularidad =>
  typeof v === 'string' && (TITULARIDADES as readonly string[]).includes(v);

export const ETIQUETA_TITULARIDAD: Record<Titularidad, string> = {
  novuchat: 'Número de NovuChat',
  comercio: 'Número propio del comercio',
};

/** Lo que se le explica al comercio de cada titularidad. */
export const DESCRIPCION_TITULARIDAD: Record<Titularidad, string> = {
  novuchat: 'El número, la WABA y la tarjeta son de NovuChat: el consumo de WhatsApp entra en el precio del plan.',
  comercio: 'El número y la WABA son del comercio: Meta le factura el consumo de WhatsApp a su tarjeta. Lo que se paga a NovuChat es el servicio.',
};

/** Una ruta de WhatsApp tal como la lee la consola (`rutasWhatsApp/{n}`). */
export interface RutaWhatsApp {
  phoneNumberId: string;
  tenantId: string;
  flujo?: unknown;
  estado?: unknown;
  titularidad?: unknown;
}

/** Ausente o inválida, la titularidad es de NovuChat: es lo que hoy son todos los números. */
export const titularidadDe = (ruta: { titularidad?: unknown } | null | undefined): Titularidad =>
  esTitularidad(ruta?.titularidad) ? ruta.titularidad : 'novuchat';

/** Lee un documento de `rutasWhatsApp` sin confiar en su forma. */
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
 * ¿A este comercio Meta le factura el consumo de WhatsApp directamente? Sí si
 * ALGUNO de sus números es propio. Reemplaza a `paganEllosAMeta(plan)`, que lo
 * deducía del plan BYOC: la titularidad es por número (`Analisis/41` §4), y
 * un comercio puede tener uno propio y otro provisto.
 */
export const facturaMetaAlComercio = (rutas: readonly RutaWhatsApp[]): boolean =>
  rutas.some((r) => titularidadDe(r) === 'comercio');

// -----------------------------------------------------------------------------
// MODELO — decisión de NovuChat por tenant (`Analisis/41` §4, consecuencia 1)
// -----------------------------------------------------------------------------

/**
 * Los modelos entre los que elige NovuChat. Son los tres que `Analisis/39`
 * midió contra el tope BYOC: Gemini (equilibrio 3.873 conversaciones), Haiku
 * 4.5 (1.542) y Sonnet 5 (771). Lo asume esta consola; `central` fija la
 * lista definitiva en Functions y se reconcilia acá.
 */
export const MODELOS = ['gemini', 'claude-haiku', 'claude-sonnet'] as const;
export type Modelo = (typeof MODELOS)[number];

export const esModelo = (v: unknown): v is Modelo =>
  typeof v === 'string' && (MODELOS as readonly string[]).includes(v);

export const ETIQUETA_MODELO: Record<Modelo, string> = {
  gemini: 'Gemini',
  'claude-haiku': 'Claude Haiku',
  'claude-sonnet': 'Claude Sonnet',
};

/** El modelo por defecto es el que corre en los cinco flujos de hoy. */
export const MODELO_POR_DEFECTO: Modelo = 'gemini';

export const modeloDe = (ficha: { modelo?: unknown } | null | undefined): Modelo =>
  esModelo(ficha?.modelo) ? ficha.modelo : MODELO_POR_DEFECTO;

// -----------------------------------------------------------------------------
// CAMBIOS INCLUIDOS DEL MES (`Analisis/41` §4, consecuencia 4)
// -----------------------------------------------------------------------------

export interface CambiosDelMes {
  /** `aaaa-mm` del mes que se mira, el mismo período que el resto de los contadores. */
  mes: string;
  usados: number;
  /** `null` si la cuenta no trae la clave: el plan no la vendió o `central` todavía no la escribió. */
  incluidos: number | null;
  /** `true` cuando ya se usaron todos los incluidos. Nunca con `incluidos` en `null`. */
  agotados: boolean;
}

const enteroNoNegativo = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * Cuántos cambios de configuración operados por NovuChat lleva el comercio
 * este mes, contra los que su plan incluye. Los dos números los escribe el
 * servidor (`registrarCambioOperado`, la copia `limites.cambiosIncluidos`); la
 * consola solo los lee. Un dato ausente o mal formado se muestra como cero
 * usados y sin tope conocido: no se inventa un límite.
 */
export function cambiosDelMes(
  cuenta: Record<string, unknown> | null | undefined, ahoraMs = Date.now(),
): CambiosDelMes {
  const mes = periodoDe(ahoraMs);
  const contador = cuenta?.['cambios'];
  const usados = typeof contador === 'object' && contador !== null
    ? enteroNoNegativo((contador as Record<string, unknown>)[mes]) ?? 0
    : 0;
  const limites = cuenta?.['limites'];
  const incluidos = typeof limites === 'object' && limites !== null
    ? enteroNoNegativo((limites as Record<string, unknown>)['cambiosIncluidos'])
    : null;
  return { mes, usados, incluidos, agotados: incluidos !== null && usados >= incluidos };
}
