/**
 * miniCRM: EL CONTRATO DE COLUMNAS v1 (PR-A, plan del 28/10/2026).
 *
 * Es un DATO, no lógica de un cliente: la plantilla madre de la hoja. Quién
 * escribe cada columna es la regla de seguridad del módulo: el bot escribe SOLO
 * las suyas y NUNCA pisa las del equipo. Un cliente ubica sus columnas con
 * `config/crm.mapaColumnas` (campo -> letra); lo que no está en este contrato
 * no se escribe.
 *
 * Sin datos de salud ni comprobantes en la hoja: ninguna columna del contrato
 * puede llevarlos (la prueba lo vigila por el nombre) y el flujo no los manda.
 */

export type DuenoDeColumna = 'bot' | 'equipo';

export interface ColumnaCrm {
  /** Clave estable que usa `mapaColumnas`. */
  readonly campo: string;
  /** Encabezado en la plantilla madre. */
  readonly titulo: string;
  readonly dueno: DuenoDeColumna;
  /** Columna agregada en v1 que la plantilla original no tenía. */
  readonly nueva?: boolean;
}

export const VERSION_CONTRATO_COLUMNAS = 1;

export const COLUMNAS_V1: readonly ColumnaCrm[] = [
  { campo: 'id', titulo: 'ID', dueno: 'bot' },
  { campo: 'fecha', titulo: 'Fecha', dueno: 'bot' },
  { campo: 'nombre', titulo: 'Nombre', dueno: 'bot' },
  { campo: 'empresa', titulo: 'Empresa', dueno: 'bot' },
  { campo: 'telefono', titulo: 'Teléfono', dueno: 'bot' },
  { campo: 'etapaInicial', titulo: 'Etapa inicial', dueno: 'bot' },
  { campo: 'origen', titulo: 'Origen', dueno: 'bot' },
  { campo: 'calificacion', titulo: 'Calificación', dueno: 'bot' },
  { campo: 'resumen', titulo: 'Resumen', dueno: 'bot' },
  // El rubro o interés que el prospecto registró (PR-B). Nueva en v1: el flujo vivo de NovuChat ya la escribe (columna F).
  { campo: 'interes', titulo: 'Interés', dueno: 'bot', nueva: true },
  { campo: 'valor', titulo: 'Valor', dueno: 'equipo' },
  { campo: 'responsable', titulo: 'Responsable', dueno: 'equipo' },
  { campo: 'estado', titulo: 'Estado', dueno: 'equipo' },
  { campo: 'proximaAccion', titulo: 'Próxima acción', dueno: 'equipo' },
  { campo: 'ultimaInteraccion', titulo: 'Última interacción', dueno: 'bot', nueva: true },
  { campo: 'etapaSugerida', titulo: 'Etapa sugerida', dueno: 'bot', nueva: true },
  { campo: 'idCampana', titulo: 'ID de campaña', dueno: 'bot', nueva: true },
  { campo: 'noContactar', titulo: 'No contactar', dueno: 'bot', nueva: true },
  { campo: 'ultimaActualizacionBot', titulo: 'Última actualización del bot', dueno: 'bot', nueva: true },
  { campo: 'estadoRecordatorio', titulo: 'Estado del recordatorio', dueno: 'bot', nueva: true },
];

export const CAMPOS_DEL_BOT: readonly string[] = COLUMNAS_V1.filter((c) => c.dueno === 'bot').map((c) => c.campo);
export const CAMPOS_DEL_EQUIPO: readonly string[] = COLUMNAS_V1.filter((c) => c.dueno === 'equipo').map((c) => c.campo);

/** Letra de columna válida de Sheets: de A a ZZ. */
export const esLetraDeColumna = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{1,2}$/.test(v);

/**
 * Las columnas que el bot PUEDE escribir según el mapa del cliente (campo ->
 * letra). Solo campos del bot con una letra válida; los del equipo y los
 * desconocidos se descartan siempre, aunque el mapa los traiga. Dos campos en
 * la misma letra: ninguno de los dos se escribe (una celda no tiene dos dueños).
 */
export function columnasEscribibles(mapa: Readonly<Record<string, unknown>> | null | undefined): Record<string, string> {
  const salida: Record<string, string> = {};
  if (mapa === null || typeof mapa !== 'object') return salida;
  const usos = new Map<string, number>();
  for (const v of Object.values(mapa)) if (esLetraDeColumna(v)) usos.set(v, (usos.get(v) ?? 0) + 1);
  for (const campo of CAMPOS_DEL_BOT) {
    const letra = Object.prototype.hasOwnProperty.call(mapa, campo) ? mapa[campo] : undefined;
    if (esLetraDeColumna(letra) && usos.get(letra) === 1) salida[campo] = letra;
  }
  return salida;
}

/**
 * Un texto que viene del cliente final y va a una celda: si empieza con `=`,
 * `+`, `-` o `@` (o un espacio/control antes de ellos) la hoja lo tomaría como
 * fórmula, así que se neutraliza anteponiendo un apóstrofo. Se recortan los
 * controles y se acota el largo. No es un valor nulo: lo no textual da ''.
 */
export function neutralizarTexto(valor: unknown, largoMax = 500): string {
  if (typeof valor !== 'string') return '';
  const limpio = valor
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    // Caracteres de formato (\u200B, BOM, marcas bidi…): invisibles, pueden esconder el primer carácter.
    .replace(/\p{Cf}/gu, '')
    .slice(0, largoMax);
  // Espacios de cualquier tipo (incluido NBSP) antes del primer carácter no lo salvan.
  return /^[\s\u00A0]*[=+\-@]/.test(limpio) ? `'${limpio}` : limpio;
}
