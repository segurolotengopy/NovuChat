/**
 * Tipos del ensamblador de flujos (`ensamblar-flujo.mjs`), para que la suite
 * `pruebas/ensamblador.test.ts` lo importe con `strict` sin un `any` implícito.
 * El script es JavaScript a propósito: corre con `node` pelado, sin compilar.
 */

/** Una entrada del manifiesto: la ruta del módulo, o la ruta con la marca de salto final. */
export type EntradaDeModulo = string | { archivo: string; saltoFinal?: boolean };

export interface Manifiesto {
  flujo: string;
  /** Nodos que se quedan en el JSON a propósito, con el prefijo que deben conservar. */
  conservanMarcadores?: Record<string, string>;
  /** Nodo Code → archivo bajo `Flujos/src/`. */
  codigo?: Record<string, EntradaDeModulo>;
  /** Agente → archivos bajo `Flujos/prompts/` por campo. */
  prompts?: Record<string, { systemMessage?: EntradaDeModulo; text?: EntradaDeModulo }>;
}

export interface Ensamblado {
  archivo: string;
  /** El JSON ensamblado (o el original, sin manifiesto). */
  texto: string;
  original: string;
  conManifiesto: boolean;
  /** Los puntos de inyección aplicados, como `codigo/<nodo>` o `prompts/<nodo>.<campo>`. */
  inyectados?: string[];
}

export interface Verificacion {
  archivo: string;
  estado: 'sin-manifiesto' | 'identico' | 'difiere';
  diferencias: string[];
  inyectados?: string[];
}

export const RAIZ_FLUJOS: string;
export const TIPO_CODE: string;
export const TIPO_AGENTE: string;

export function carpetas(raiz?: string): { flujos: string; src: string; prompts: string; manifiestos: string };
export function slug(nombre: string): string;
export function listarFlujos(raiz?: string): string[];
export function rutaDeManifiesto(archivoFlujo: string, raiz?: string): string;
export function leerManifiesto(archivoFlujo: string, raiz?: string): Manifiesto | null;
export function ensamblarEnMemoria(archivoFlujo: string, raiz?: string): Ensamblado;
export function verificarFlujo(archivoFlujo: string, raiz?: string): Verificacion;
export function ensamblarFlujo(archivoFlujo: string, raiz?: string): boolean;
export function manifiestoInicial(archivoFlujo: string, carpeta: string, raiz?: string): Manifiesto;
export function extraerFlujo(
  archivoFlujo: string, opciones?: { raiz?: string; nuevo?: string | null },
): { escritos: string[]; avisos: string[]; manifiesto: Manifiesto };
