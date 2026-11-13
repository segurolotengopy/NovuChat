// Tipos de `envio.mjs` (para las pruebas en TypeScript).
export interface OpcionesDeEnvio {
  credenciales: { graph?: string; rele?: string; ingesta?: string };
  /** 'graph' (por defecto) o 'rele' (relé B9). */
  canal?: 'graph' | 'rele';
  /** Canal rele: prefijo de la Idempotency-Key. */
  cliente?: string;
  /** Canal rele: base del relé; por defecto el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE. */
  releUrl?: string;
  ingestaUrl?: string;
  armado?: string;
  config?: string;
  entrada?: string;
  para?: string;
  reportar?: boolean;
  desde?: [number, number];
  lote?: { tamano?: number; intervaloMs?: number };
  reportarFallidos?: boolean;
  siguiente?: string;
}
export interface NodoDeEnvio { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, any>; [clave: string]: any }
export interface CadenaDeEnvio {
  nodes: NodoDeEnvio[];
  connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>;
  entrada: string;
  salidas: Array<{ nodo: string; salida: number }>;
}
export function nodosDeEnvio(opciones: OpcionesDeEnvio): CadenaDeEnvio;
export function llamaANumerar(js: string): boolean;
export function hallazgosDelEnvioRele(flujo: { nodes?: any[] }): string[];
export function esBaseDeReleAdmitida(base: string): boolean;
export function injertar<T extends { nodes: any[]; connections: Record<string, any> }>(plantilla: T, opciones: OpcionesDeEnvio): T;

export const MARCADOR_URL_DEL_RELE: string;
export const PREFIJO_CREDENCIAL_RELE: string;
export const NODOS_DEL_ENVIO_RELE: string[];
export const CLAVES_DEL_CUERPO_RELE: string[];
export const LIMITE_DEL_CUERPO_RELE: number;
export const ROLES_DE_CLAVE_RELE: string[];
export const FUENTE_CODIGOS_RELE: string;
export const FUENTE_DECIDIR_ENVIO: string;
export function validarRele(o: { cliente?: string; releUrl?: string; credenciales?: { rele?: string } }): { cliente: string; releUrl: string; credencial: string };
export function claveDeIdempotencia(cliente: string, rol: string, nExpresion: string): string;
export function cuerpoParaElRele(payloadExpresion: string, destinoExpresion: string): string;
export function parametrosDeMensajeRele(o: {
  cliente?: string; releUrl?: string; credenciales?: { rele?: string }; rol: string; pnidExpresion: string; payloadExpresion: string; destinoExpresion: string; nExpresion: string;
  neverError?: boolean; lote?: { tamano?: number; intervaloMs?: number };
}): Record<string, any>;
export function nodosDeEnvioRele(opciones: OpcionesDeEnvio): CadenaDeEnvio;
