import { execFileSync } from 'node:child_process';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
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

/**
 * Enciende ('nueva'), apaga ('clasica') o quita (`null`) la bandera `tenants/{id}.consolaConversaciones`, la que elige entre la
 * pantalla de Conversaciones de siempre y la nueva (H1). Es lo que en producción hace `aplicar-consola-conversaciones.mjs`, con el
 * SDK Admin y SOLO contra el emulador (proyecto `demo-*`; la variable del emulador se FUERZA a nuestro puerto). Quien la usa para
 * encender la nueva TIENE que dejarla en `null` al terminar: `conversaciones.spec.ts` prueba la de siempre y no la enciende.
 */
export async function fijarPantallaConversaciones(tenantId: string, pantalla: 'nueva' | 'clasica' | null): Promise<void> {
  process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO_FIRESTORE}`;
  if (!PROYECTO.startsWith('demo-')) throw new Error('NEGADO: el proyecto de las pruebas de navegador tiene que empezar con «demo-».');
  const app = getApps()[0] ?? initializeApp({ projectId: PROYECTO });
  if (!String(app.options.projectId ?? '').startsWith('demo-')) throw new Error('NEGADO: la app de Admin no es de un proyecto demo-*.');
  await getFirestore(app).doc(`tenants/${tenantId}`).set(
    { consolaConversaciones: pantalla === null ? FieldValue.delete() : pantalla }, { merge: true });
}
