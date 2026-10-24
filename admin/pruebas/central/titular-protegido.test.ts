/**
 * TITULAR PROTEGIDO — con los emuladores de Auth y de Firestore.
 *
 * Un administrador no quita al titular de la cuenta; el titular no se quita ni se
 * degrada a sí mismo; reinvitarlo como admin sigue permitido. Los rechazos ocurren
 * ANTES de tocar ficha, claims, sesiones o auditoría. Un negocio sin titular y un
 * administrador que no es titular se comportan como siempre (controles).
 *
 * Se SALTA sin emulador de Auth (FIREBASE_AUTH_EMULATOR_HOST). Correr:
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<puerto> FIRESTORE_EMULATOR_PORT=<p> \
 *     bash pruebas/correr.sh pruebas/central/titular-protegido.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';

const HAY_AUTH = Boolean(process.env['FIREBASE_AUTH_EMULATOR_HOST']);
const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
const { quitarUsuario, invitarUsuario } = await import('../../functions/src/central/usuarios.ts');
const { asignarRol } = await import('../../functions/src/core/seguridad/claims.ts');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'ti-a';
const B = 'ti-b';
const CLAVE = 'Clave-de-prueba-2026!';
const CORREO_TA = `ta@${'prueba.invalid'}`;
const USUARIOS = ['TA', 'TB', 'adminA', 'operA', 'adminB'];
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PQuitar = Parameters<typeof quitarUsuario.run>[0];
type PInvitar = Parameters<typeof invitarUsuario.run>[0];
const quitar = (data: Record<string, unknown>, auth: object | null) =>
  quitarUsuario.run({ data, auth, rawRequest: {} } as unknown as PQuitar);
const invitar = (data: Record<string, unknown>, auth: object | null) =>
  invitarUsuario.run({ data, auth, rawRequest: {} } as unknown as PInvitar);

async function crear(uid: string): Promise<void> {
  await getAuth().deleteUser(uid).catch(() => undefined);
  await getAuth().createUser({ uid, email: `${uid.toLowerCase()}@prueba.invalid`, password: CLAVE, emailVerified: true });
}
const claimsDe = async (uid: string) =>
  ((await getAuth().getUser(uid)).customClaims?.['nc'] ?? null) as { t: Record<string, string>; v: number } | null;
const validoDesde = async (uid: string) => (await getAuth().getUser(uid)).tokensValidAfterTime ?? '';
const sesionDe = async (uid: string) => ({
  uid, token: { nc: await claimsDe(uid), firebase: { sign_in_provider: 'password' }, email_verified: true, auth_time: Math.floor(Date.now() / 1000) },
});
const auditoria = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());
const miembro = async (t: string, u: string) => (await db.doc(`tenants/${t}/miembros/${u}`).get());

const suite = HAY_AUTH ? describe : describe.skip;

suite('titular de la cuenta protegido', () => {
  beforeAll(async () => { for (const u of USUARIOS) await crear(u); });

  async function sembrar(conTitular = true): Promise<void> {
    for (const t of [A, B]) {
      for (const sub of ['auditoria', 'miembros']) {
        for (const d of (await db.collection(`tenants/${t}/${sub}`).get()).docs) await d.ref.delete();
      }
    }
    for (const u of USUARIOS) await getAuth().setCustomUserClaims(u, null);
    await asignarRol('TA', A, 'admin');
    await asignarRol('adminA', A, 'admin');
    await asignarRol('operA', A, 'oper');
    await asignarRol('TB', B, 'admin');
    await asignarRol('adminB', B, 'admin');
    await db.doc(`tenants/${A}/miembros/TA`).set({ rol: 'admin', correo: CORREO_TA });
    await db.doc(`tenants/${A}/miembros/adminA`).set({ rol: 'admin' });
    await db.doc(`tenants/${A}/miembros/operA`).set({ rol: 'oper' });
    await db.doc(`tenants/${B}/miembros/TB`).set({ rol: 'admin' });
    await db.doc(`tenants/${B}/miembros/adminB`).set({ rol: 'admin' });
    await db.doc(`tenants/${A}`).set(conTitular ? { titularCuentaUid: 'TA' } : {});
    await db.doc(`tenants/${B}`).set({ titularCuentaUid: 'TB' });
    await espera(1100);
  }

  it('el admin de A no puede quitar al titular de A: rechazado, nada se toca', async () => {
    await sembrar();
    const antes = { claims: await claimsDe('TA'), valido: await validoDesde('TA') };
    await expect(quitar({ tenantId: A, uid: 'TA' }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'No se puede quitar al titular de la cuenta. Lo cambia NovuChat.' });
    expect((await miembro(A, 'TA')).exists).toBe(true);
    expect(await claimsDe('TA')).toEqual(antes.claims);
    expect(await validoDesde('TA')).toBe(antes.valido);
    expect(await auditoria(A)).toHaveLength(0);
  });

  it('el titular no se quita a sí mismo', async () => {
    await sembrar();
    await expect(quitar({ tenantId: A, uid: 'TA' }, await sesionDe('TA')))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await miembro(A, 'TA')).exists).toBe(true);
    expect((await claimsDe('TA'))?.t[A]).toBe('admin');
    expect(await auditoria(A)).toHaveLength(0);
  });

  it('reinvitar al titular como oper se rechaza (I1: ya es miembro) y su claim sigue admin', async () => {
    await sembrar();
    const antes = await claimsDe('TA');
    for (const quien of ['adminA', 'TA']) {
      await expect(invitar({ tenantId: A, correo: CORREO_TA, rol: 'oper' }, await sesionDe(quien)))
        .rejects.toMatchObject({ code: 'already-exists' });
    }
    // un rol ausente equivale a oper
    await expect(invitar({ tenantId: A, correo: CORREO_TA }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: 'already-exists' });
    expect(await claimsDe('TA')).toEqual(antes);
    expect((await miembro(A, 'TA')).data()?.['rol']).toBe('admin');
    expect(await auditoria(A)).toHaveLength(0);
  });

  it('el admin de B no puede nombrar a A (permission-denied) y el de A no alcanza al titular de B (not-found)', async () => {
    await sembrar();
    await expect(quitar({ tenantId: A, uid: 'TA' }, await sesionDe('adminB')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(invitar({ tenantId: A, correo: CORREO_TA, rol: 'oper' }, await sesionDe('adminB')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    const antes = await validoDesde('TB');
    await expect(quitar({ tenantId: A, uid: 'TB' }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: 'not-found' });
    expect(await validoDesde('TB')).toBe(antes);
    expect((await claimsDe('TB'))?.t[B]).toBe('admin');
  });

  // ---- Controles positivos ----
  it('CONTROL: el admin de A quita a otro miembro y se audita', async () => {
    await sembrar();
    expect(await quitar({ tenantId: A, uid: 'operA' }, await sesionDe('adminA'))).toEqual({ ok: true });
    expect((await miembro(A, 'operA')).exists).toBe(false);
    expect(await auditoria(A)).toEqual([expect.objectContaining({ destino: 'operA' })]);
  });

  it('I1: reinvitar al titular, ni como admin, cambia algo: es miembro y se rechaza sin tocar su claim', async () => {
    await sembrar();
    // un admin que no es titular ni siquiera puede invitar admins si hay titular; el titular, sí, pero ya es miembro
    await expect(invitar({ tenantId: A, correo: CORREO_TA, rol: 'admin' }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(invitar({ tenantId: A, correo: CORREO_TA, rol: 'admin' }, await sesionDe('TA')))
      .rejects.toMatchObject({ code: 'already-exists' });
    expect((await claimsDe('TA'))?.t[A]).toBe('admin');
    expect((await miembro(A, 'TA')).data()?.['rol']).toBe('admin');
  });

  it('CONTROL: un negocio sin titular se comporta como hoy (se puede quitar a quien sea)', async () => {
    await sembrar(false);
    expect(await quitar({ tenantId: A, uid: 'TA' }, await sesionDe('adminA'))).toEqual({ ok: true });
    expect((await miembro(A, 'TA')).exists).toBe(false);
  });

  it('CONTROL: titularCuentaUid null explicito = sin titular (quitar funciona)', async () => {
    await sembrar();
    await db.doc(`tenants/${A}`).set({ titularCuentaUid: null });
    expect(await quitar({ tenantId: A, uid: 'TA' }, await sesionDe('adminA'))).toEqual({ ok: true });
    expect((await miembro(A, 'TA')).exists).toBe(false);
  });

  it('un titularCuentaUid guardado con espacios sigue protegiendo al titular', async () => {
    await sembrar();
    await db.doc(`tenants/${A}`).set({ titularCuentaUid: ' TA ' });
    await expect(quitar({ tenantId: A, uid: 'TA' }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await miembro(A, 'TA')).exists).toBe(true);
  });

  it('CONTROL: un admin que no es titular puede quitarse a sí mismo', async () => {
    await sembrar();
    expect(await quitar({ tenantId: A, uid: 'adminA' }, await sesionDe('adminA'))).toEqual({ ok: true });
    expect((await miembro(A, 'adminA')).exists).toBe(false);
  });
});
