export const NODO_RAFAGA_SI: string;
export const NODO_RAFAGA_ESPERAR: string;
export const NODO_RAFAGA_CONSULTAR: string;
export const NODO_RAFAGA_AGRUPAR: string;
export const NODOS_DE_LA_RAFAGA: string[];
export const ANCLA_REPORTE: string;
export const TIMEOUT_RAFAGA_MS: number;
export const ESPERA_POR_DEFECTO_SEG: number;
export const NORMALIZADORES: string[];

export interface OpcionesDeLaRafaga {
  ancla?: { nodo: string; salida?: number; destino: string };
  normalizador?: string;
  config?: string;
  configBase?: string;
  traerConfiguracion?: string;
  puerta?: string;
  posicion?: [number, number];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlujoN8n = any;

export function codigoDeLaRafaga(configBase?: string): string;
export function nodosDeLaRafaga(opciones: OpcionesDeLaRafaga & { traer: FlujoN8n }): FlujoN8n[];
export function injertarRafaga<T>(flujo: T, opciones: OpcionesDeLaRafaga): T;
export function quitarRafaga<T>(flujo: T): T;
export function hallazgosDeLaRafaga(flujo: unknown, opciones?: { exigir?: boolean }): string[];
