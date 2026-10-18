/**
 * INVITACIONES BAJO LAS REGLAS REALES (sin cambiar las reglas): la colección es de solo lectura para el
 * administrador del propio negocio; el invitado, un operador y el admin de otro negocio NO la leen, y
 * nadie la escribe desde el navegador. El invitado llega a las suyas por `misInvitaciones`.
 *   FIRESTORE_EMULATOR_PORT=<p> FIRESTORE_EMULATOR_WS_PORT=<w> bash pruebas/correr.sh pruebas/central/invitaciones-reglas.test.ts
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'iv-r-a';
const B = 'iv-r-b';
const ID = 'a'.repeat(64);
let entorno: RulesTestEnvironment;

const claims = (t: Record<string, string>, email = 'iv-r@ejemplo.com') => ({
  nc: { t, v: 1 }, email, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
});
const como = (uid: string, t: Record<string, string>, email?: string) => entorno.authenticatedContext(uid, claims(t, email)).firestore();

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231) },
  });
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `tenants/${A}/invitaciones/${ID}`), { correo: 'invitada@ejemplo.com', rol: 'oper', estado: 'pendiente' });
    await setDoc(doc(ctx.firestore(), `tenants/${B}/invitaciones/${ID}`), { correo: 'invitada@ejemplo.com', rol: 'oper', estado: 'pendiente' });
  });
});
afterAll(async () => { await entorno?.cleanup(); });

describe('reglas de invitaciones', () => {
  it('CONTROL: el admin del negocio lee las suyas', async () => {
    await assertSucceeds(getDoc(doc(como('adm-a', { [A]: 'admin' }), `tenants/${A}/invitaciones/${ID}`)));
    await assertSucceeds(getDocs(collection(como('adm-a', { [A]: 'admin' }), `tenants/${A}/invitaciones`)));
  });
  it('el admin de A no lee ni lista las de B', async () => {
    await assertFails(getDoc(doc(como('adm-a', { [A]: 'admin' }), `tenants/${B}/invitaciones/${ID}`)));
    await assertFails(getDocs(collection(como('adm-a', { [A]: 'admin' }), `tenants/${B}/invitaciones`)));
  });
  it('un operador no las lee', async () => {
    await assertFails(getDocs(collection(como('op-a', { [A]: 'oper' }), `tenants/${A}/invitaciones`)));
  });
  it('el invitado no las lee directo (ni por get ni por consulta de grupo por su correo)', async () => {
    const invitada = como('inv-1', {}, 'invitada@ejemplo.com');
    await assertFails(getDoc(doc(invitada, `tenants/${A}/invitaciones/${ID}`)));
    await assertFails(getDocs(collection(invitada, `tenants/${A}/invitaciones`)));
  });
  it('nadie escribe desde el navegador, ni siquiera el admin', async () => {
    const adm = como('adm-a', { [A]: 'admin' });
    await assertFails(setDoc(doc(adm, `tenants/${A}/invitaciones/${'b'.repeat(64)}`), { correo: 'x@ejemplo.com', estado: 'pendiente' }));
    await assertFails(updateDoc(doc(adm, `tenants/${A}/invitaciones/${ID}`), { estado: 'aceptada' }));
    await assertFails(deleteDoc(doc(adm, `tenants/${A}/invitaciones/${ID}`)));
  });
});
