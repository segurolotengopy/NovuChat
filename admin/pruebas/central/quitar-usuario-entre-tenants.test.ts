/**
 * `quitarUsuario` ENTRE TENANTS — con los emuladores de Auth y de Firestore.
 *
 * Defecto corregido: la callable comprobaba que quien llama es admin de
 * `tenantId`, pero no que `uid` fuera miembro de ese tenant; el admin de A le
 * revocaba las sesiones y subía el `nc.v` a cualquier uid conocido. Ahora un
 * destino sin ficha en `tenants/A/miembros` se rechaza con `not-found`, sin
 * tocar sesiones, claims ni auditoría. Los CONTROLES prueban que quitar a un
 * miembro real sigue funcionando.
 *
 * Se SALTA si no hay emulador de Auth (FIREBASE_AUTH_EMULATOR_HOST): el CI de
 * hoy levanta solo Firestore. Correr con Auth (puertos propios, proyecto demo-*):
 *   firebase emulators:start --only auth --project demo-novuchat-pruebas
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<puerto> FIRESTORE_EMULATOR_PORT=<p> \
 *     bash pruebas/correr.sh pruebas/central/quitar-usuario-entre-tenants.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';

const HAY_AUTH = Boolean(process.env['FIREBASE_AUTH_EMULATOR_HOST']);
const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
const { quitarUsuario } = await import('../../functions/src/central/usuarios.ts');
const { asignarRol } = await import('../../functions/src/core/seguridad/claims.ts');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'qu-a';
const B = 'qu-b';
const CLAVE = 'Clave-de-prueba-2026!';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Peticion = Parameters<typeof quitarUsuario.run>[0];
const quitar = (data: Record<string, unknown>, auth: object | null) =>
  quitarUsuario.run({ data, auth, rawRequest: {} } as unknown as Peticion);

async function crear(uid: string): Promise<void> {
  await getAuth().deleteUser(uid).catch(() => undefined);
  await getAuth().createUser({ uid, email: `${uid}@prueba.invalid`, password: CLAVE, emailVerified: true });
}
const claimsDe = async (uid: string) =>
  ((await getAuth().getUser(uid)).customClaims?.['nc'] ?? null) as { t: Record<string, string>; v: number; p?: boolean } | null;
const validoDesde = async (uid: string) => (await getAuth().getUser(uid)).tokensValidAfterTime ?? '';
/** El token de quien llama, con la forma que ve la callable. */
const sesionDe = async (uid: string) => ({
  uid, token: { nc: await claimsDe(uid), firebase: { sign_in_provider: 'password' }, email_verified: true },
});
const auditoriaDe = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'quitar_usuario').get()).docs.map((d) => d.data());

const suite = HAY_AUTH ? describe : describe.skip;

suite('quitarUsuario con un destino que no es miembro del tenant', () => {
  beforeAll(async () => {
    for (const u of ['adminA', 'miembroA', 'soloB', 'nadie', 'propietario', 'ingestaB']) await crear(u);
    // La ingesta es una identidad de servicio: sin ningún método interactivo.
    await getAuth().deleteUser('ingestaB');
    await getAuth().createUser({ uid: 'ingestaB' });
  });

  async function sembrar(): Promise<void> {
    for (const t of [A, B]) {
      for (const d of (await db.collection(`tenants/${t}/auditoria`).get()).docs) await d.ref.delete();
      for (const d of (await db.collection(`tenants/${t}/miembros`).get()).docs) await d.ref.delete();
    }
    // Se reinician los claims de todos para que cada caso parta igual.
    for (const u of ['adminA', 'miembroA', 'soloB', 'nadie', 'propietario', 'ingestaB']) {
      await getAuth().setCustomUserClaims(u, null);
    }
    await asignarRol('adminA', A, 'admin');
    await asignarRol('miembroA', A, 'oper');
    await asignarRol('soloB', B, 'oper');
    await getAuth().setCustomUserClaims('propietario', { nc: { p: true, t: { [B]: 'admin' }, v: 7 } });
    await getAuth().setCustomUserClaims('ingestaB', { nc: { t: { [B]: 'ingesta' }, v: 3 } });
    await db.doc(`tenants/${A}/miembros/adminA`).set({ rol: 'admin' });
    await db.doc(`tenants/${A}/miembros/miembroA`).set({ rol: 'oper' });
    await db.doc(`tenants/${B}/miembros/soloB`).set({ rol: 'oper' });
    // tokensValidAfterTime tiene resolución de segundos: se espera para que
    // una revocación se distinga de la creación.
    await espera(1100);
  }

  const NO_MIEMBROS = ['soloB', 'nadie', 'propietario', 'ingestaB'];

  it('un destino que no es miembro de A se rechaza con not-found y no se toca nada (usuario de B, sin rol, propietario, ingesta)', async () => {
    await sembrar();
    const antes: Record<string, { validoDesde: string; claims: Awaited<ReturnType<typeof claimsDe>> }> = {};
    for (const u of NO_MIEMBROS) antes[u] = { validoDesde: await validoDesde(u), claims: await claimsDe(u) };

    for (const u of NO_MIEMBROS) {
      await expect(quitar({ tenantId: A, uid: u }, await sesionDe('adminA')))
        .rejects.toMatchObject({ code: 'not-found' });
      expect(await validoDesde(u)).toBe(antes[u]!.validoDesde); // sesiones intactas
      expect(await claimsDe(u)).toEqual(antes[u]!.claims); // claims y nc.v intactos
    }
    expect(await auditoriaDe(A)).toHaveLength(0);
    expect(await auditoriaDe(B)).toHaveLength(0);
  });

  // ---- Control positivo: lo legítimo sigue funcionando. ----
  it('CONTROL: quitar a un miembro real de A borra su ficha, su rol en A, revoca sus sesiones y audita', async () => {
    await sembrar();
    const antes = await validoDesde('miembroA');

    expect(await quitar({ tenantId: A, uid: 'miembroA' }, await sesionDe('adminA'))).toEqual({ ok: true });

    expect((await db.doc(`tenants/${A}/miembros/miembroA`).get()).exists).toBe(false);
    expect((await claimsDe('miembroA'))?.t).toEqual({});
    expect(await validoDesde('miembroA')).not.toBe(antes);
    expect(await auditoriaDe(A)).toEqual([expect.objectContaining({ destino: 'miembroA' })]);
  });

  it('CONTROL: el admin de B no puede usar su rol sobre A; un oper de A tampoco', async () => {
    await sembrar();
    await asignarRol('soloB', B, 'admin');
    await expect(quitar({ tenantId: A, uid: 'miembroA' }, await sesionDe('soloB')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(quitar({ tenantId: A, uid: 'adminA' }, await sesionDe('miembroA')))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
});
