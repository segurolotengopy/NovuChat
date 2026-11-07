// Tipos de `expresiones.mjs` (la guardia común del sandbox de expresiones de n8n), para las pruebas en TypeScript.
export interface ReglaDeExpresion { regla: string; severidad: 'bloquea'; re: RegExp; clave: boolean; propiedad: boolean; texto: string }
export interface HallazgoDeExpresion { nodo: string; ruta: string; regla: string; severidad: string; texto: string }
export interface Rechazo { regla: string; palabra: string; texto: string }
export const REGLAS_DE_EXPRESION: ReglaDeExpresion[];
export function sinLiterales(codigo: string): string;
export function rechazoDeCodigo(codigo: string): Rechazo | null;
export function rechazoDeExpresion(texto: string): Rechazo | null;
export function hallazgosDeExpresiones(flujo: unknown): HallazgoDeExpresion[];
export function textosDeHallazgos(flujo: unknown): string[];
