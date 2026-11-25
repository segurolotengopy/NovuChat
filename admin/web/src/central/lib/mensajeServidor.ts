/**
 * El `message` de un error de callable, SOLO para Retomar (`textoErrorRetomar`). Los textos de Retomar los pone el servidor
 * (`ErroresDeTurno`, `ErroresDeEnvio`) y la consola los muestra tal cual. Vive aparte para que `turno.ts` siga sin leer
 * `.message` (lo hace cumplir `turno-pantalla.test.ts`): tomar, devolver y enviar se siguen diciendo por código.
 */
export function mensajeDeError(e: unknown): string {
  const m = e && typeof e === 'object' ? (e as { message?: unknown }).message : undefined;
  return typeof m === 'string' ? m.trim() : '';
}
