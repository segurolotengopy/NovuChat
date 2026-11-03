// Tipos de `guardado.mjs` (para las pruebas en TypeScript).
export interface CredencialesDelGuardado { ingesta: string; graph?: string; rele?: string; graphTipo?: 'httpHeaderAuth' | 'whatsAppApi'; graphAviso?: string; graphAvisoTipo?: 'httpHeaderAuth' | 'whatsAppApi' }
export interface OpcionesDelGuardado {
  credenciales?: CredencialesDelGuardado;
  guardarUrl: string;
  carga?: string;
  config?: string;
  ancla?: string;
  graphDe?: string;
  /** 'graph' (por defecto) o 'rele' (relé B9). */
  canal?: 'graph' | 'rele';
  /** Canal rele: prefijo de la Idempotency-Key del aviso. */
  cliente?: string;
  /** Canal rele: base del relé (por defecto el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE). */
  releUrl?: string;
  /** Canal rele: medios por teléfono y día / por flujo y día (por defecto 20 y 60). */
  cupo?: { porTelefono?: number; global?: number };
  numero?: string;
  desde?: [number, number];
}
export interface NodoDelGuardado { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, any>; [clave: string]: any }
export const ANCLA_DEL_GUARDADO: string;
export const NODOS_DEL_GUARDADO: string[];
export const NODOS_DE_META_DEL_GUARDADO: string[];
export const NODOS_DE_INGESTA_DEL_GUARDADO: string[];
export const ARISTAS_DEL_GUARDADO: Array<[string, number, string]>;
export const ARISTAS_DEL_GUARDADO_RELE: Array<[string, number, string]>;
export const NODOS_DE_REINTENTO_RELE: string[];
export const CONDICION_429_RELE: string;
export const ESPERA_429_RELE: string;
export const URL_DESCARGA_GUARDADO: string;
export const FUENTE_PREPARAR: string;
export const FUENTE_RESULTADO: string;
export const FUENTE_REINTENTO: string;
export const FUENTE_CUPO: string;
export const LIMITE_DE_IMAGEN_RELE: number;
export const CUPO_POR_DEFECTO_RELE: { porTelefono: number; global: number };
export function validarCupo(cupo?: { porTelefono?: number; global?: number }): { porTelefono: number; global: number };
export function cabeceraDeFuentes(carga: string, config: string, cupo?: { porTelefono?: number; global?: number }): string;
export function numeroDelAncla(ancla: { name?: string; parameters?: Record<string, any> }): string;
export function nodosDelGuardado(opciones: OpcionesDelGuardado & { credenciales: CredencialesDelGuardado; numero: string }): NodoDelGuardado[];
export function credencialesDelFlujo(flujo: { nodes: any[] }, ancla: any, graphDe: string, canal?: 'graph' | 'rele'): CredencialesDelGuardado;
export function injertarGuardado<T extends { nodes: any[]; connections: Record<string, any> }>(flujo: T, opciones: OpcionesDelGuardado): T;
export function hallazgosDelGuardado(flujo: unknown, opciones?: { exigir?: boolean }): string[];
export function manejaMedios(flujo: unknown): boolean;
export function urlDescargaRele(releUrl?: string): string;
export function urlInfoRele(releUrl?: string): string;
