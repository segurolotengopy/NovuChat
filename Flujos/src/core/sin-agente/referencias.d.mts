// Tipos de `referencias.mjs` (verificador de referencias de nodos), para las pruebas en TypeScript.
export interface ReferenciasDeNodo { nodo: string; literales: string[]; ayuda: string[]; dinamica: boolean }
export function referenciasDeNodos(nodos: unknown): ReferenciasDeNodo[];
export function antecesoresDe(flujo: unknown): Map<string, Set<string>>;
export function problemasDeReferencias(flujo: unknown): string[];
