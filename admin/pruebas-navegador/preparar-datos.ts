import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROYECTO, PUERTO_AUTH, PUERTO_FIRESTORE } from './entorno';

/**
 * Antes de toda la suite deja los emuladores en un estado CONOCIDO: vuelve a sembrar con `scripts/sembrar.mjs --limpiar` (el mismo
 * script que usa una persona para probar a mano; idempotente), con el comercio de ventas «Parrilla El Fogon» activo. Así una corrida
 * que se cortó a la mitad no deja basura para la siguiente. Los emuladores tienen que estar arriba (`LEEME.md`).
 */
export default function prepararDatos(): void {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync(process.execPath, ['scripts/sembrar.mjs', '--limpiar'], {
    cwd: raiz,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      PROYECTO_EMULADOR: PROYECTO,
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PUERTO_FIRESTORE}`,
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PUERTO_AUTH}`,
      SEMBRAR_FOGON_ACTIVO: '1',
    },
  });
}
