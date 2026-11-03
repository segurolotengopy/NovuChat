// Tipos de `guardado.mjs` (para las pruebas en TypeScript).
export interface CredencialesDelGuardado { ingesta: string; graph: string; graphTipo?: 'httpHeaderAuth' | 'whatsAppApi'; graphAviso?: string; graphAvisoTipo?: 'httpHeaderAuth' | 'whatsAppApi' }
export interface OpcionesDelGuardado {
  credenciales?: CredencialesDelGuardado;
  guardarUrl: string;
  carga?: string;
  config?: string;
  ancla?: string;
  graphDe?: string;
  numero?: string;
  desde?: [number, number];
}
export interface NodoDelGuardado { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, any>; [clave: string]: any }
export const ANCLA_DEL_GUARDADO: string;
export const NODOS_DEL_GUARDADO: string[];
export const NODOS_DE_META_DEL_GUARDADO: string[];
export const NODOS_DE_INGESTA_DEL_GUARDADO: string[];
export const ARISTAS_DEL_GUARDADO: Array<[string, number, string]>;
export const URL_DESCARGA_GUARDADO: string;
export const FUENTE_PREPARAR: string;
export const FUENTE_RESULTADO: string;
export const FUENTE_REINTENTO: string;
export function cabeceraDeFuentes(carga: string, config: string): string;
export function numeroDelAncla(ancla: { name?: string; parameters?: Record<string, any> }): string;
export function nodosDelGuardado(opciones: OpcionesDelGuardado & { credenciales: CredencialesDelGuardado; numero: string }): NodoDelGuardado[];
export function credencialesDelFlujo(flujo: { nodes: any[] }, ancla: any, graphDe: string): CredencialesDelGuardado;
export function injertarGuardado<T extends { nodes: any[]; connections: Record<string, any> }>(flujo: T, opciones: OpcionesDelGuardado): T;
export function hallazgosDelGuardado(flujo: unknown, opciones?: { exigir?: boolean }): string[];
export function manejaMedios(flujo: unknown): boolean;
