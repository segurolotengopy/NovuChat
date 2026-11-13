// Tipos de `construir.mjs` (para las pruebas en TypeScript).
export interface Variante { archivo: string; nombre: string; quitar?: string | string[] }
export interface Proyecto {
  dir: string;
  plantilla: { nodes: Array<Record<string, unknown>>; connections: Record<string, unknown>; [clave: string]: unknown };
  librerias: string[];
  comun: string[];
  paquetes: Record<string, string[]>;
  variantes: Variante[];
  leerNodo: (ruta: string, nodo: string) => string;
}
export interface ConfigDeConstruccion {
  plantilla?: string;
  raiz?: string;
  librerias?: string | string[];
  comun?: string | string[];
  paquetes?: Record<string, string | string[]>;
  variantes: Variante[];
}
export function leerProyecto(carpeta: string, configEnMemoria?: ConfigDeConstruccion | null, opciones?: { tope?: string }): Proyecto;
export function codigoDe(proyecto: Proyecto, marca: string, nodo: string): string;
export function armarVariante(proyecto: Proyecto, variante: Variante): string;
export function construir(
  carpeta: string,
  opciones?: { verificar?: boolean; config?: ConfigDeConstruccion | null; tope?: string },
): Array<{ archivo: string; nodos: number; alDia: boolean; existia: boolean }>;
