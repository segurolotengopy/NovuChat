/**
 * REGLAS DE `/plataforma/alertas/*`, PROBADAS NEGANDO (emulador).
 * `eventos`: solo el propietario (Google) lee; nadie escribe desde el navegador. `control`: nadie lee ni
 * escribe. Los escribe el servidor (SDK Admin, que se salta las reglas).
 */
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const REGLAS = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: REGLAS, host: '127.0.0.1', port: PUERTO },
  });
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'plataforma/alertas/eventos/e1'), { tipo_error: 'envio_incierto' });
    await setDoc(doc(c.firestore(), 'plataforma/alertas/control/dia_2026-11-07'), { enviados: 1 });
  });
});
afterAll(async () => { await entorno?.cleanup(); });

const propietario = () => entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com')).firestore();
const admin = () => entorno.authenticatedContext('u-admin', claims({ t1: 'admin' })).firestore();
const sinSesion = () => entorno.unauthenticatedContext().firestore();

describe('plataforma/alertas/eventos', () => {
  it('el propietario con Google lee un evento y la lista', async () => {
    await assertSucceeds(getDoc(doc(propietario(), 'plataforma/alertas/eventos/e1')));
    await assertSucceeds(getDocs(collection(propietario(), 'plataforma/alertas/eventos')));
  });
  it('un administrador de comercio, un propietario sin Google y un anónimo no leen', async () => {
    const sinGoogle = entorno.authenticatedContext('u-n2', claims({}, true, 'password')).firestore();
    for (const db of [admin(), sinGoogle, sinSesion()]) {
      await assertFails(getDoc(doc(db, 'plataforma/alertas/eventos/e1')));
      await assertFails(getDocs(collection(db, 'plataforma/alertas/eventos')));
    }
  });
  it('nadie escribe desde el navegador, ni el propietario', async () => {
    for (const db of [propietario(), admin(), sinSesion()]) {
      await assertFails(setDoc(doc(db, 'plataforma/alertas/eventos/e2'), { tipo_error: 'x' }));
      await assertFails(updateDoc(doc(db, 'plataforma/alertas/eventos/e1'), { estado: 'enviado' }));
      await assertFails(deleteDoc(doc(db, 'plataforma/alertas/eventos/e1')));
    }
  });
});

describe('plataforma/alertas/control', () => {
  it('nadie lee ni escribe los contadores del tope, ni el propietario', async () => {
    for (const db of [propietario(), admin(), sinSesion()]) {
      await assertFails(getDoc(doc(db, 'plataforma/alertas/control/dia_2026-11-07')));
      await assertFails(setDoc(doc(db, 'plataforma/alertas/control/dia_2026-11-07'), { enviados: 0 }));
    }
  });
});
