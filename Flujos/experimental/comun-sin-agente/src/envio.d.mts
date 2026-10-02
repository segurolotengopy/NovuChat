// Tipos de `envio.mjs` (para las pruebas en TypeScript).
export interface OpcionesDeEnvio {
  credenciales: { graph: string; ingesta?: string };
  ingestaUrl?: string;
  armado?: string;
  config?: string;
  entrada?: string;
  para?: string;
  reportar?: boolean;
  desde?: [number, number];
  lote?: { tamano?: number; intervaloMs?: number };
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
export function injertar<T extends { nodes: any[]; connections: Record<string, any> }>(plantilla: T, opciones: OpcionesDeEnvio): T;
