/**
 * ENVOLTORIO. `resetear-estado-turno.mjs` pasó a ser `resetear-telefono-prueba.mjs`, EL ÚNICO reseteo de un teléfono de prueba (Andres, 07/11/2026):
 * limpia el estado del servidor, el cobro pendiente y la ficha de n8n en una sola pasada. Este nombre solo avisa y delega con los mismos argumentos.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { principal } from './resetear-telefono-prueba.mjs';

export const AVISO = '\n  ! `resetear-estado-turno.mjs` se llama ahora `resetear-telefono-prueba.mjs` (un solo reseteo: estado del servidor, cobro pendiente y ficha de n8n). Se ejecuta ese.\n';

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  console.error(AVISO);
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
