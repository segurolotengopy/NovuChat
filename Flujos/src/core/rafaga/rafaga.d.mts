export const NODO_RAFAGA_SI: string;
export const NODO_RAFAGA_ESPERAR: string;
export const NODO_RAFAGA_CONSULTAR: string;
export const NODO_RAFAGA_AGRUPAR: string;
export const NODOS_DE_LA_RAFAGA: string[];
export const ANCLA_REPORTE: string;
export const TIMEOUT_RAFAGA_MS: number;
export const REINTENTOS_MAXIMOS: number;
export const ESPERA_ENTRE_INTENTOS_MS: number;
export const ESPERA_POR_DEFECTO_SEG: number;
export const NORMALIZADORES: string[];
export interface CamposDeLaRafaga { tipo: string; mensajeId: string; from: string; phoneNumberId: string; texto: string }
export const CAMPOS_CANONICOS: Omit<CamposDeLaRafaga, 'texto'>;
export const NORMALIZADORES_VERIFICADOS: Record<string, string>;
export function huellaDe(codigo: string): string;
export function emisionesDelCodigo(codigo: string): { error?: string; emisiones: { claves: Set<string>; abierto: boolean }[] };

export interface OpcionesDeLaRafaga {
  ancla?: { nodo: string; salida?: number; destino: string };
  normalizador?: string;
  config?: string;
  configBase?: string;
  traerConfiguracion?: string;
  campos?: Partial<CamposDeLaRafaga>;
  /** Nodo del que se leen los campos del mensaje (ascendiente del ancla); sin él, se leen del item del ancla. */
  fuente?: string;
  /** Nodo(s) que LEEN `textoDelTurno` de «Agrupar ráfaga» (destino o descendientes). Obligatorio; `null` solo para fixtures de prueba. */
  consumidor?: string | string[] | null;
  puerta?: string;
  posicion?: [number, number];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlujoN8n = any;

export function codigoDeLaRafaga(configBase?: string, campos?: Partial<CamposDeLaRafaga>, fuente?: string): string;
export function nodosDeLaRafaga(opciones: OpcionesDeLaRafaga & { traer: FlujoN8n }): FlujoN8n[];
export function injertarRafaga<T>(flujo: T, opciones: OpcionesDeLaRafaga): T;
export function quitarRafaga<T>(flujo: T): T;
export function hallazgosDeLaRafaga(flujo: unknown, opciones?: OpcionesDeLaRafaga & { exigir?: boolean }): string[];
