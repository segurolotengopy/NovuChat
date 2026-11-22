export const NODO_INDICADOR: string;
export const NODO_INDICADOR_ACTIVO: string;
export const NODOS_DEL_INDICADOR: string[];
export const ANCLA_REPORTE: string;
export const TIMEOUT_INDICADOR_MS: number;
export const VERSION_GRAPH_POR_DEFECTO: string;
export const TIPOS_DE_CREDENCIAL: string[];
export const NORMALIZADORES: string[];
export const NODOS_DEL_MODELO: string[];

export interface Credencial { tipo: 'httpHeaderAuth' | 'whatsAppApi'; nombre: string }
export interface OpcionesDelIndicador {
  ancla?: { nodo: string; salida?: number };
  normalizador?: string;
  config?: string;
  configBase?: string;
  credencial?: Credencial;
  posicion?: [number, number];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlujoN8n = any;

export function tieneAgente(flujo: unknown): boolean;
export function nodosDelIndicador(opciones: OpcionesDelIndicador): FlujoN8n[];
export function credencialDeEnvio(flujo: unknown): Credencial | null;
export function injertarIndicador<T>(flujo: T, opciones: OpcionesDelIndicador): T;
export function quitarIndicador<T>(flujo: T): T;
export function hallazgosDelIndicador(flujo: unknown, opciones?: { exigir?: boolean }): string[];
export function esNodoIndicador(n: unknown): boolean;
