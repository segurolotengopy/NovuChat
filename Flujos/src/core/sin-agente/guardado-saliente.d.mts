// Tipos de `guardado-saliente.mjs` (para las pruebas en TypeScript).
export type ViaDelGuardadoSaliente = 'enlace' | 'media';
export interface FuentesDelGuardadoSaliente { meta: string; payload: string; tipoReporte: string; telefono: string; version?: string }
export interface OpcionesDelGuardadoSaliente {
  guardarUrl: string;
  vias: ViaDelGuardadoSaliente[];
  fuentes: FuentesDelGuardadoSaliente;
  reportero?: string;
  envio?: string;
  numero?: string;
  desde?: [number, number];
}
export const REPORTERO_DEL_GUARDADO_SALIENTE: string;
export const FUENTE_PREPARAR_SALIENTE: string;
export const LIMITE_DE_IMAGEN_SALIENTE: number;
export const VIAS_DEL_GUARDADO_SALIENTE: ViaDelGuardadoSaliente[];
export const MIME_DEL_BINARIO: string;
export const URL_DESCARGA_SALIENTE: string;
export function validarVias(vias: unknown): ViaDelGuardadoSaliente[];
export function cabeceraDeFuentesSaliente(vias: ViaDelGuardadoSaliente[], fuentes: FuentesDelGuardadoSaliente): string;
export function nodosDelGuardadoSaliente(opciones: OpcionesDelGuardadoSaliente & { numero: string; ingesta: string; meta: { parametros: Record<string, unknown>; credentials: Record<string, unknown> } }): Array<{ id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, any>; [clave: string]: any }>;
export function aristasDelGuardadoSaliente(vias: ViaDelGuardadoSaliente[]): Array<[string, number, string]>;
export function nodosQueAgrega(vias: ViaDelGuardadoSaliente[]): number;
export function injertarGuardadoSaliente<T extends { nodes: any[]; connections: Record<string, any> }>(flujo: T, opciones: OpcionesDelGuardadoSaliente): T;
export function hallazgosDelGuardadoSaliente(flujo: unknown, opciones?: { exigir?: boolean; vias?: ViaDelGuardadoSaliente[]; reportero?: string; envio?: string }): string[];
export function fuentesDeLaCadenaComun(armar?: string, envio?: string): FuentesDelGuardadoSaliente;
export const NODOS_DE_INGESTA_DEL_GUARDADO_SALIENTE: string[];
