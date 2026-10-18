/**
 * `quitarUsuario` ENTRE TENANTS — reproduce un defecto de seguridad (sin
 * corregirlo) con los emuladores de Auth y de Firestore.
 *
 * El defecto: la callable comprueba que quien llama es admin de `tenantId`,
 * pero NO que `uid` sea miembro de ese tenant. Entonces un admin de A, con el
 * uid de alguien que no es de A, le REVOCA las sesiones y le SUBE `nc.v`,
 * y deja en la auditoría de A un `quitar_usuario` con ese uid ajeno.
 *
 * Qué documentan las pruebas:
 *  - «HOY»: lo que pasa con el código actual (el defecto, afirmado tal cual).
 *  - `it.fails`: el comportamiento deseado (rechazar y no tocar nada). Pasa
 *    mientras el defecto exista y se pone ROJA el día que se corrija: quien lo
 *    corrija debe quitar la marca `.fails` y borrar el bloque «HOY».
 *  - Control positivo: quitar a un miembro real de A sí funciona.
 *
 * Se SALTA si no hay emulador de Auth (FIREBASE_AUTH_EMULATOR_HOST): el CI de
 * hoy levanta solo Firestore. Correr con Auth (puertos propios, proyecto demo-*):
 *   firebase emulators:start --only auth --project demo-novuchat-pruebas
 *     (con un firebase.json cuyo emulador de auth use el puerto elegido)
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

  it('HOY: el admin de A revoca las sesiones y sube nc.v de un usuario que solo es de B; sus roles de B se conservan', async () => {
    await sembrar();
    const antes = { validoDesde: await validoDesde('soloB'), claims: await claimsDe('soloB') };
    expect(antes.claims).toMatchObject({ t: { [B]: 'oper' } });

    const r = await quitar({ tenantId: A, uid: 'soloB' }, await sesionDe('adminA'));

    expect(r).toEqual({ ok: true }); // no rechaza
    const despues = { validoDesde: await validoDesde('soloB'), claims: await claimsDe('soloB') };
    expect(despues.validoDesde).not.toBe(antes.validoDesde); // sesiones revocadas
    expect(despues.claims?.v).toBe((antes.claims?.v ?? 0) + 1); // sube nc.v
    expect(despues.claims?.t).toEqual({ [B]: 'oper' }); // el rol de B NO se pierde
    // Queda auditoría EN A con el uid ajeno.
    expect(await auditoriaDe(A)).toEqual([expect.objectContaining({ uid: 'adminA', destino: 'soloB' })]);
    expect(await auditoriaDe(B)).toHaveLength(0);
    // Y no existía ni existe ficha de miembro de soloB en A.
    expect((await db.doc(`tenants/${A}/miembros/soloB`).get()).exists).toBe(false);
  });

  it('HOY: lo mismo con un uid sin ningún rol ("nadie") y con el propietario y la ingesta de B', async () => {
    await sembrar();
    const previo: Record<string, { validoDesde: string; claims: Awaited<ReturnType<typeof claimsDe>> }> = {};
    for (const u of ['nadie', 'propietario', 'ingestaB']) previo[u] = { validoDesde: await validoDesde(u), claims: await claimsDe(u) };

    for (const u of ['nadie', 'propietario', 'ingestaB']) {
      expect(await quitar({ tenantId: A, uid: u }, await sesionDe('adminA'))).toEqual({ ok: true });
      expect(await validoDesde(u)).not.toBe(previo[u]!.validoDesde); // sesión revocada
    }
    // "nadie" gana un claim vacío con v=1 (antes no tenía claims).
    expect(await claimsDe('nadie')).toMatchObject({ t: {}, v: 1 });
    // El propietario conserva `p` y su rol en B; solo sube la versión.
    expect(await claimsDe('propietario')).toEqual({ p: true, t: { [B]: 'admin' }, v: 8 });
    // La ingesta conserva su rol en B; solo sube la versión.
    expect(await claimsDe('ingestaB')).toMatchObject({ t: { [B]: 'ingesta' }, v: 4 });
    expect(await auditoriaDe(A)).toHaveLength(3);
  });

  // ---- El comportamiento deseado. Hoy FALLA, y `it.fails` lo vuelve verde. ----
  it.fails('DESEADO: un destino que no es miembro de A se rechaza y no se revoca ni se toca nada', async () => {
    await sembrar();
    const antes = { validoDesde: await validoDesde('soloB'), claims: await claimsDe('soloB') };

    await expect(quitar({ tenantId: A, uid: 'soloB' }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(not-found|permission-denied)$/) });

    expect(await validoDesde('soloB')).toBe(antes.validoDesde);
    expect(await claimsDe('soloB')).toEqual(antes.claims);
    expect(await auditoriaDe(A)).toHaveLength(0);
  });

  it.fails('DESEADO: lo mismo para un uid sin ningún rol', async () => {
    await sembrar();
    const antes = { validoDesde: await validoDesde('nadie'), claims: await claimsDe('nadie') };
    await expect(quitar({ tenantId: A, uid: 'nadie' }, await sesionDe('adminA')))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(not-found|permission-denied)$/) });
    expect(await validoDesde('nadie')).toBe(antes.validoDesde);
    expect(await claimsDe('nadie')).toEqual(antes.claims);
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
