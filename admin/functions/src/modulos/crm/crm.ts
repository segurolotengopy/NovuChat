/**
 * miniCRM: reglas puras del módulo (PR-A). Sin Firestore ni red: el flujo
 * (PR-B) las consulta; aquí solo está lo que decide si el módulo corre.
 *
 *   · `activo` ausente = ENCENDIDO. Apagar es `activo: false` explícito; el
 *     flujo entonces no escribe y Google ni se consulta.
 *   · `recordatorios.activo` ausente = APAGADO (los recordatorios son PR-D y
 *     solo los enciende el servidor).
 *   · Ante un documento ilegible (no objeto, `activo` no booleano) se falla
 *     hacia lo seguro de cada caso: el CRM sigue como si no hubiera dicho
 *     nada (encendido) y los recordatorios, apagados.
 */

export interface ConfigCrm {
  readonly activo?: unknown;
  readonly moneda?: unknown;
  readonly listas?: unknown;
  readonly recordatorios?: unknown;
}

export const crmActivo = (config: ConfigCrm | null | undefined): boolean =>
  config === null || typeof config !== 'object' || config.activo !== false;

/**
 * Lo que `configuracionFlujo` entrega del miniCRM (PR-B3): SOLO `{ crm: { activo } }`, y solo si `config/crm`
 * existe con `activo` booleano. Cualquier otra cosa (sin documento, `activo` ausente o de otro tipo, campos extra)
 * devuelve `{}`: la respuesta queda como siempre y el módulo sigue ENCENDIDO por omisión (`crmActivo`). Los campos
 * reservados del servidor (`hoja`, `mapaColumnas`, `cuentaServicio`…) NUNCA viajan al flujo.
 */
export const crmParaElFlujo = (datos: Readonly<Record<string, unknown>> | null | undefined): { crm?: { activo: boolean } } => {
  if (datos === null || datos === undefined || typeof datos !== 'object') return {};
  const activo = (datos as ConfigCrm).activo;
  return typeof activo === 'boolean' ? { crm: { activo } } : {};
};

export const recordatoriosActivos = (config: ConfigCrm | null | undefined): boolean => {
  if (config === null || typeof config !== 'object') return false;
  const r = config.recordatorios;
  return r !== null && typeof r === 'object' && (r as { activo?: unknown }).activo === true;
};

/** Contacto nuevo: sin mensajes en las últimas 48 horas (regla de negocio de Andres, PR-B). */
export const HORAS_CONTACTO_NUEVO = 48;
