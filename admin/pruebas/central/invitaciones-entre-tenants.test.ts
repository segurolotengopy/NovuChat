/**
 * INVITACIONES CON ACEPTACIÓN ENTRE TENANTS — con los emuladores de Auth y de Firestore.
 *
 * Cierra el hallazgo de `invitarUsuario`: ya no consulta Auth (sondeo), no toca claims ni
 * `miembros`, y el rol nace solo cuando la persona ACEPTA con su propia sesión. Se prueba
 * negando; cada bloque tiene su control positivo.
 *
 * Se SALTA sin emulador de Auth (FIREBASE_AUTH_EMULATOR_HOST). Correr (puertos propios):
 *   firebase emulators:start --only auth --project demo-novuchat-pruebas   (con su firebase.json de puertos)
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<puerto> FIRESTORE_EMULATOR_PORT=<p> FIRESTORE_EMULATOR_WS_PORT=<w> \
 *     bash pruebas/correr.sh pruebas/central/invitaciones-entre-tenants.test.ts
 * Uids con prefijo `iv-`; correos @ejemplo.com.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// El claim se pone AL FINAL de aceptar: para probar su falla se envuelve `asignarRol` (lo demás es real).
const control = vi.hoisted(() => ({ antes: null as null | (() => Promise<void>) }));
vi.mock('../../functions/src/core/seguridad/claims.ts', async (original) => {
  const real = await original<typeof import('../../functions/src/core/seguridad/claims.ts')>();
  return {
    ...real,
    asignarRol: async (...a: Parameters<typeof real.asignarRol>) => {
      if (control.antes && a[2] !== null) await control.antes();
      return real.asignarRol(...a);
    },
  };
});

const HAY_AUTH = Boolean(process.env['FIREBASE_AUTH_EMULATOR_HOST']);
const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
const inv = await import('../../functions/src/central/invitaciones.ts');
const { idInvitacion, MENSAJE } = await import('../../functions/src/central/invitacionesDecision.ts');
const { asignarRol } = await import('../../functions/src/core/seguridad/claims.ts');
const { getAuth } = await import('firebase-admin/auth');
const { Timestamp, getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'iv-a';
const B = 'iv-b';
const C = 'iv-c';
const CLAVE = 'Clave-de-prueba-2026!';
const DIA = 24 * 60 * 60 * 1000;
const correoDe = (uid: string) => `${uid}@ejemplo.com`.toLowerCase();
const USUARIOS = ['iv-titA', 'iv-adminA', 'iv-operA', 'iv-adminB', 'iv-ana', 'iv-otro', 'iv-vinc'];
const ANA = correoDe('iv-ana');
const ID_ANA = idInvitacion(ANA);

type P = Parameters<typeof inv.invitarUsuario.run>[0];
const llamar = (f: { run: (p: P) => unknown }, data: Record<string, unknown>, auth: object | null) =>
  f.run({ data, auth, rawRequest: {} } as unknown as P) as Promise<Record<string, unknown>>;
const invitar = (data: Record<string, unknown>, auth: object | null) => llamar(inv.invitarUsuario, data, auth);
const cancelar = (data: Record<string, unknown>, auth: object | null) => llamar(inv.cancelarInvitacion, data, auth);
const responder = (data: Record<string, unknown>, auth: object | null) => llamar(inv.responderInvitacion, data, auth);
const mis = (auth: object | null) => llamar(inv.misInvitaciones, {}, auth);

async function crear(uid: string): Promise<void> {
  await getAuth().deleteUser(uid).catch(() => undefined);
  await getAuth().createUser({ uid, email: correoDe(uid), password: CLAVE, emailVerified: true });
}
const claimsDe = async (uid: string) =>
  ((await getAuth().getUser(uid)).customClaims?.['nc'] ?? null) as { t: Record<string, string>; v: number } | null;
const sesionDe = async (uid: string, extra: { proveedor?: string; verificado?: boolean } = {}) => ({
  uid,
  token: {
    nc: await claimsDe(uid), email: correoDe(uid), auth_time: Math.floor(Date.now() / 1000),
    firebase: { sign_in_provider: extra.proveedor ?? 'password' }, email_verified: extra.verificado ?? true,
  },
});
const docInv = async (t: string, id: string) => (await db.doc(`tenants/${t}/invitaciones/${id}`).get()).data();
const auditoria = async (t: string, accion?: string) =>
  (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data()).filter((d) => !accion || d['accion'] === accion);
const miembro = async (t: string, u: string) => (await db.doc(`tenants/${t}/miembros/${u}`).get());
const sembrarInv = (t: string, correo: string, extra: Record<string, unknown> = {}) =>
  db.doc(`tenants/${t}/invitaciones/${idInvitacion(correo)}`).set({
    correo, rol: 'oper', estado: 'pendiente', motivo: null, creadaPor: 'iv-adminA',
    creadaEn: Timestamp.now(), venceEn: Timestamp.fromMillis(Date.now() + 3 * DIA), reenvios: 0,
    resueltaEn: null, resueltaPor: null, ...extra,
  });

const suite = HAY_AUTH ? describe : describe.skip;

suite('invitaciones con aceptación', () => {
  beforeAll(async () => { for (const u of USUARIOS) await crear(u); });
  const limpiarM = () => Promise.all(Array.from({ length: 22 }, async (_, i) => {
    await db.doc(`tenants/iv-m${i}/invitaciones/${ID_ANA}`).delete();
    await db.doc(`tenants/iv-m${i}`).delete();
  }));
  afterEach(async () => { vi.restoreAllMocks(); control.antes = null; await limpiarM(); });

  async function sembrar(conTitular = true): Promise<void> {
    await limpiarM();
    for (const t of [A, B, C]) {
      for (const sub of ['auditoria', 'miembros', 'invitaciones']) {
        for (const d of (await db.collection(`tenants/${t}/${sub}`).get()).docs) await d.ref.delete();
      }
    }
    for (const u of USUARIOS) await getAuth().setCustomUserClaims(u, null);
    await asignarRol('iv-titA', A, 'admin');
    await asignarRol('iv-adminA', A, 'admin');
    await asignarRol('iv-operA', A, 'oper');
    await asignarRol('iv-adminB', B, 'admin');
    await db.doc(`tenants/${A}/miembros/iv-titA`).set({ rol: 'admin', correo: correoDe('iv-titA') });
    await db.doc(`tenants/${A}/miembros/iv-adminA`).set({ rol: 'admin', correo: correoDe('iv-adminA') });
    await db.doc(`tenants/${A}/miembros/iv-operA`).set({ rol: 'oper', correo: correoDe('iv-operA') });
    await db.doc(`tenants/${B}/miembros/iv-adminB`).set({ rol: 'admin', correo: correoDe('iv-adminB') });
    await db.doc(`tenants/${A}`).set({ nombre: 'Negocio A', estado: 'activo', ...(conTitular ? { titularCuentaUid: 'iv-titA' } : {}) });
    await db.doc(`tenants/${B}`).set({ nombre: 'Negocio B', estado: 'activo' });
    await db.doc(`tenants/${C}`).set({ nombre: 'Negocio C', estado: 'dado_de_baja' });
  }

  // ---- Invitar: sin sondeo ----
  it('SONDEO: un correo con cuenta en B y uno inexistente dan la MISMA respuesta y Auth no se consulta', async () => {
    await sembrar();
    const espia = vi.spyOn(getAuth(), 'getUserByEmail');
    const conCuenta = await invitar({ tenantId: A, correo: correoDe('iv-adminB'), rol: 'oper' }, await sesionDe('iv-adminA'));
    const inexistente = await invitar({ tenantId: A, correo: 'fantasma@ejemplo.com', rol: 'oper' }, await sesionDe('iv-adminA'));
    expect(conCuenta).toEqual(inexistente);
    expect(conCuenta).toEqual({ ok: true, mensaje: MENSAJE.invitada });
    expect(espia).not.toHaveBeenCalled();
    expect(await docInv(A, idInvitacion(correoDe('iv-adminB')))).toMatchObject({ estado: 'pendiente', rol: 'oper' });
    expect(await docInv(A, idInvitacion('fantasma@ejemplo.com'))).toMatchObject({ estado: 'pendiente' });
  });

  it('CONTROL: invitar solo deja la invitación: ni claim, ni miembro, y el id es el hash del correo', async () => {
    await sembrar();
    const antes = await claimsDe('iv-ana');
    await invitar({ tenantId: A, correo: ` ${ANA.toUpperCase()} `, rol: 'oper' }, await sesionDe('iv-adminA'));
    const d = await docInv(A, ID_ANA);
    expect(d).toMatchObject({ correo: ANA, rol: 'oper', estado: 'pendiente', reenvios: 0, creadaPor: 'iv-adminA' });
    expect(d!['venceEn'].toMillis() - Date.now()).toBeGreaterThan(6.9 * DIA);
    expect(await claimsDe('iv-ana')).toEqual(antes);
    expect((await miembro(A, 'iv-ana')).exists).toBe(false);
    expect(await auditoria(A, 'invitar_usuario')).toHaveLength(1);
  });

  it('un operador no invita ni cancela; el admin de B no actúa sobre A', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    await expect(invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-operA'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(cancelar({ tenantId: A, invitacionId: ID_ANA }, await sesionDe('iv-operA'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-adminB'))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await docInv(A, ID_ANA))!['estado']).toBe('pendiente');
  });

  it('invitar a un miembro o al titular se rechaza y no cambia su rol ni su claim', async () => {
    await sembrar();
    const antes = await claimsDe('iv-titA');
    for (const quien of ['iv-adminA', 'iv-titA']) {
      for (const objetivo of ['iv-titA', 'iv-operA']) {
        await expect(invitar({ tenantId: A, correo: correoDe(objetivo), rol: 'oper' }, await sesionDe(quien)))
          .rejects.toMatchObject({ code: 'already-exists', message: MENSAJE.yaEsMiembro });
      }
    }
    expect(await claimsDe('iv-titA')).toEqual(antes);
    expect((await miembro(A, 'iv-titA')).data()?.['rol']).toBe('admin');
    expect((await db.collection(`tenants/${A}/invitaciones`).get()).size).toBe(0);
  });

  it('con titular, un admin que no es titular no invita admins; el titular sí (control); sin titular, un admin sí', async () => {
    await sembrar();
    await expect(invitar({ tenantId: A, correo: ANA, rol: 'admin' }, await sesionDe('iv-adminA'))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await docInv(A, ID_ANA)).toBeUndefined();
    await invitar({ tenantId: A, correo: ANA, rol: 'admin' }, await sesionDe('iv-titA'));
    expect((await docInv(A, ID_ANA))!['rol']).toBe('admin');
    await sembrar(false);
    await invitar({ tenantId: A, correo: ANA, rol: 'admin' }, await sesionDe('iv-adminA'));
    expect((await docInv(A, ID_ANA))!['rol']).toBe('admin');
  });

  it('topes: la invitación 21 se rechaza (las vencidas no cuentan) y el reenvío 6 se rechaza', async () => {
    await sembrar();
    for (let i = 0; i < 20; i += 1) await sembrarInv(A, `p${i}@ejemplo.com`);
    await sembrarInv(A, 'vieja@ejemplo.com', { venceEn: Timestamp.fromMillis(Date.now() - DIA) });
    await expect(invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-adminA')))
      .rejects.toMatchObject({ code: 'resource-exhausted', message: MENSAJE.topePendientes });
    expect(await docInv(A, ID_ANA)).toBeUndefined();
    // renovar una existente con el negocio lleno sigue permitido
    await invitar({ tenantId: A, correo: 'p0@ejemplo.com' }, await sesionDe('iv-adminA'));
    // una cancelada libera lugar
    await cancelar({ tenantId: A, invitacionId: idInvitacion('p1@ejemplo.com') }, await sesionDe('iv-adminA'));
    await invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-adminA'));
    expect(await docInv(A, ID_ANA)).toBeDefined();
    // la vencida que se tocó quedó persistida como vencida
    expect((await docInv(A, idInvitacion('vieja@ejemplo.com')))!['estado']).toBe('vencida');

    await sembrar();
    const admin = await sesionDe('iv-adminA');
    await invitar({ tenantId: A, correo: ANA }, admin);
    for (let i = 1; i <= 5; i += 1) await invitar({ tenantId: A, correo: ANA }, admin);
    expect((await docInv(A, ID_ANA))!['reenvios']).toBe(5);
    await expect(invitar({ tenantId: A, correo: ANA }, admin))
      .rejects.toMatchObject({ code: 'resource-exhausted', message: MENSAJE.topeReenvios });
    expect((await docInv(A, ID_ANA))!['reenvios']).toBe(5);
  });

  it('valores hostiles: tenantId, invitacionId y correo se rechazan sin tocar nada', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    const admin = await sesionDe('iv-adminA');
    const ana = await sesionDe('iv-ana');
    const malos = ['a/b', '__proto__', '..', 'x'.repeat(65), 'A'.repeat(64), '', 7, null, { a: 1 }];
    for (const m of malos) {
      await expect(cancelar({ tenantId: A, invitacionId: m }, admin)).rejects.toMatchObject({ code: 'invalid-argument' });
      await expect(responder({ tenantId: A, invitacionId: m, respuesta: 'aceptar' }, ana)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    for (const t of ['a/b', '__proto__', 'constructor/x', 'x'.repeat(61), '', 7]) {
      await expect(invitar({ tenantId: t, correo: ANA }, admin)).rejects.toMatchObject({ code: expect.stringMatching(/invalid-argument|permission-denied/) });
      await expect(responder({ tenantId: t, invitacionId: ID_ANA, respuesta: 'aceptar' }, ana)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'quizas' }, ana)).rejects.toMatchObject({ code: 'invalid-argument' });
    for (const c of ['', 'sin-arroba', 'a b@ejemplo.com', 7]) {
      await expect(invitar({ tenantId: A, correo: c }, admin)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect((await docInv(A, ID_ANA))!['estado']).toBe('pendiente');
    expect(await claimsDe('iv-ana')).toBeNull();
  });

  // ---- Responder ----
  it('CONTROL: aceptar da el claim, la ficha de miembro activa, marca aceptada y audita', async () => {
    await sembrar();
    await invitar({ tenantId: A, correo: ANA, rol: 'oper' }, await sesionDe('iv-adminA'));
    const r = await responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana'));
    expect(r).toEqual({ ok: true, mensaje: 'Listo: ya tiene acceso a Negocio A.' });
    expect((await claimsDe('iv-ana'))?.t[A]).toBe('oper');
    expect((await miembro(A, 'iv-ana')).data()).toMatchObject({ correo: ANA, rol: 'oper', estado: 'activo', invitadoPor: 'iv-adminA' });
    expect(await docInv(A, ID_ANA)).toMatchObject({ estado: 'aceptada', resueltaPor: 'iv-ana' });
    expect(await auditoria(A, 'aceptar_invitacion')).toHaveLength(1);
    // reinvitarla ahora (ya es miembro) se rechaza
    await expect(invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-adminA'))).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('CONTROL: rechazar deja la invitación revocada con motivo y sin claim ni miembro', async () => {
    await sembrar();
    await invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-adminA'));
    expect(await responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'rechazar' }, await sesionDe('iv-ana')))
      .toEqual({ ok: true, mensaje: MENSAJE.rechazada });
    expect(await docInv(A, ID_ANA)).toMatchObject({ estado: 'revocada', motivo: 'rechazada' });
    expect(await claimsDe('iv-ana')).toBeNull();
    expect((await miembro(A, 'iv-ana')).exists).toBe(false);
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: MENSAJE.noVigente });
  });

  it('aceptar con otro correo, con otro tenant o por otro (incluido quien invitó): not-found uniforme y nada se toca', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    const uniforme = { code: 'not-found', message: MENSAJE.noEncontrada };
    // otra persona con el id de la de Ana
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-otro'))).rejects.toMatchObject(uniforme);
    // el invitador aceptando por otro
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-adminA'))).rejects.toMatchObject(uniforme);
    // Ana con el tenantId cambiado (existe pero no tiene invitación suya) o inexistente
    await expect(responder({ tenantId: B, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana'))).rejects.toMatchObject(uniforme);
    await expect(responder({ tenantId: 'iv-no-existe', invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana'))).rejects.toMatchObject(uniforme);
    // el token dice otro correo que la ficha de la invitación (ficha alterada)
    await db.doc(`tenants/${A}/invitaciones/${ID_ANA}`).update({ correo: 'otra@ejemplo.com' });
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana'))).rejects.toMatchObject(uniforme);
    for (const u of ['iv-ana', 'iv-otro']) expect(await claimsDe(u)).toBeNull();
    expect((await db.collection(`tenants/${A}/miembros`).get()).size).toBe(3);
  });

  it('sesión sin verificar, de Google o sin sesión: no responde; con cuenta vinculada a Google no recibe rol', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    const peticion = { tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' };
    await expect(responder(peticion, await sesionDe('iv-ana', { verificado: false }))).rejects.toMatchObject({ code: 'permission-denied', message: MENSAJE.sesion });
    await expect(responder(peticion, await sesionDe('iv-ana', { proveedor: 'google.com' }))).rejects.toMatchObject({ code: 'permission-denied', message: MENSAJE.sesion });
    await expect(responder(peticion, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(mis(await sesionDe('iv-ana', { proveedor: 'google.com' }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await claimsDe('iv-ana')).toBeNull();

    // cuenta de contraseña con Google vinculado: el token dice «password» pero asignarRol lo rechaza.
    await sembrarInv(A, correoDe('iv-vinc'));
    await getAuth().updateUser('iv-vinc', { providerToLink: { providerId: 'google.com', uid: 'iv-google-vinc' } });
    await expect(responder({ tenantId: A, invitacionId: idInvitacion(correoDe('iv-vinc')), respuesta: 'aceptar' }, await sesionDe('iv-vinc')))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await claimsDe('iv-vinc')).toBeNull();
    expect((await miembro(A, 'iv-vinc')).exists).toBe(false);
    expect((await docInv(A, idInvitacion(correoDe('iv-vinc'))))!['estado']).toBe('pendiente');
    await crear('iv-vinc'); // se deja la cuenta limpia
  });

  it('vencida (reloj adelantado): se rechaza, se persiste vencida y no hay claim ni miembro', async () => {
    await sembrar();
    await sembrarInv(A, ANA, { venceEn: Timestamp.fromMillis(Date.now() - 1000) });
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: MENSAJE.noVigente });
    expect((await docInv(A, ID_ANA))!['estado']).toBe('vencida');
    expect(await claimsDe('iv-ana')).toBeNull();
    expect((await miembro(A, 'iv-ana')).exists).toBe(false);
    // y el admin la puede reenviar: vuelve a pendiente con plazo nuevo
    await invitar({ tenantId: A, correo: ANA }, await sesionDe('iv-adminA'));
    expect(await docInv(A, ID_ANA)).toMatchObject({ estado: 'pendiente', reenvios: 1 });
  });

  it('doble aceptación: la segunda se rechaza, y dos a la vez dejan UN solo acceso coherente', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    const peticion = { tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' };
    await responder(peticion, await sesionDe('iv-ana'));
    await expect(responder(peticion, await sesionDe('iv-ana'))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await auditoria(A, 'aceptar_invitacion')).toHaveLength(1);

    await sembrar();
    await sembrarInv(A, ANA);
    const sesion = await sesionDe('iv-ana');
    const resultados = await Promise.allSettled([responder(peticion, sesion), responder(peticion, sesion)]);
    expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true);
    // coherencia: el claim sigue puesto y hay ficha de miembro activa, una sola aceptación
    expect((await claimsDe('iv-ana'))?.t[A]).toBe('oper');
    expect((await miembro(A, 'iv-ana')).data()?.['estado']).toBe('activo');
    expect(await auditoria(A, 'aceptar_invitacion')).toHaveLength(1);
  });

  it('si el claim falla AL FINAL, se revierte: sin claim, sin miembro y la invitación vuelve a pendiente', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    control.antes = async () => {
      // en este punto la confirmación ya está escrita (estado intermedio inerte: miembro sin claim)
      expect((await miembro(A, 'iv-ana')).exists).toBe(true);
      expect(await claimsDe('iv-ana')).toBeNull();
      // y una cancelación ya no puede ganar: está aceptada
      await expect(cancelar({ tenantId: A, invitacionId: ID_ANA }, await sesionDe('iv-adminA'))).rejects.toMatchObject({ code: 'not-found' });
      throw new Error('falla simulada de Auth');
    };
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana')))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    control.antes = null;
    expect(await claimsDe('iv-ana')).toBeNull();
    expect((await miembro(A, 'iv-ana')).exists).toBe(false);
    const d = await docInv(A, ID_ANA);
    expect(d).toMatchObject({ estado: 'pendiente', resueltaPor: null });
    expect(d).not.toHaveProperty('compensacionPendiente');
    expect(await auditoria(A, 'aceptar_invitacion_revertida')).toHaveLength(1);
    // CONTROL: reintentar ahora funciona
    await responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana'));
    expect((await claimsDe('iv-ana'))?.t[A]).toBe('oper');
  });

  it('cancelada ANTES de aceptar: no hay claim ni miembro', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    await cancelar({ tenantId: A, invitacionId: ID_ANA }, await sesionDe('iv-adminA'));
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana')))
      .rejects.toMatchObject({ code: 'failed-precondition', message: MENSAJE.noVigente });
    expect(await claimsDe('iv-ana')).toBeNull();
    expect((await miembro(A, 'iv-ana')).exists).toBe(false);
  });

  it('con titular, un admin invitado por quien NO es titular no entra (el titular pudo fijarse después); el invitado por el titular, sí', async () => {
    await sembrar(false);
    await sembrarInv(A, ANA, { rol: 'admin', creadaPor: 'iv-adminA' });
    await db.doc(`tenants/${A}`).update({ titularCuentaUid: 'iv-titA' });
    await expect(responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana')))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(await claimsDe('iv-ana')).toBeNull();
    expect((await miembro(A, 'iv-ana')).exists).toBe(false);
    expect((await docInv(A, ID_ANA))!['estado']).toBe('pendiente');
    // CONTROL
    await db.doc(`tenants/${A}/invitaciones/${ID_ANA}`).update({ creadaPor: 'iv-titA' });
    await responder({ tenantId: A, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana'));
    expect((await claimsDe('iv-ana'))?.t[A]).toBe('admin');
  });

  it('VIGENCIA: un admin al que ya se le retiró el rol no invita ni cancela aunque su token siga viejo', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    const viejo = await sesionDe('iv-adminA'); // token con el claim admin
    await asignarRol('iv-adminA', A, null);
    await expect(invitar({ tenantId: A, correo: 'nuevo@ejemplo.com' }, viejo)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(cancelar({ tenantId: A, invitacionId: ID_ANA }, viejo)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await docInv(A, ID_ANA))!['estado']).toBe('pendiente');
    expect(await docInv(A, idInvitacion('nuevo@ejemplo.com'))).toBeUndefined();
  });

  it('misInvitaciones: un fallo de índice (código 9) se registra y responde un mensaje claro', async () => {
    await sembrar();
    const rotura = Object.assign(new Error('9 FAILED_PRECONDITION: falta indice'), { code: 9 });
    vi.spyOn(db.constructor.prototype as { collectionGroup: () => unknown }, 'collectionGroup').mockImplementation(() => { throw rotura; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(mis(await sesionDe('iv-ana'))).rejects.toMatchObject({
      code: 'failed-precondition', message: 'No se pudieron leer sus invitaciones por ahora. Intente más tarde.',
    });
    expect(log).toHaveBeenCalled();
  });

  it('negocio dado de baja: la invitación no se acepta (not-found)', async () => {
    await sembrar();
    await sembrarInv(C, ANA);
    await expect(responder({ tenantId: C, invitacionId: ID_ANA, respuesta: 'aceptar' }, await sesionDe('iv-ana')))
      .rejects.toMatchObject({ code: 'not-found' });
    expect(await claimsDe('iv-ana')).toBeNull();
  });

  // ---- Cancelar ----
  it('CONTROL: el admin cancela y queda revocada/cancelada con auditoría; B no toca las de A y A no toca las de B', async () => {
    await sembrar();
    await sembrarInv(A, ANA);
    await sembrarInv(B, ANA);
    // admin de A con el id de B en su propio tenant: no existe -> not-found; con tenantId B: sin permiso.
    await expect(cancelar({ tenantId: B, invitacionId: ID_ANA }, await sesionDe('iv-adminA'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(cancelar({ tenantId: A, invitacionId: idInvitacion('nadie@ejemplo.com') }, await sesionDe('iv-adminA'))).rejects.toMatchObject({ code: 'not-found' });
    expect((await docInv(B, ID_ANA))!['estado']).toBe('pendiente');
    expect(await cancelar({ tenantId: A, invitacionId: ID_ANA }, await sesionDe('iv-adminA'))).toEqual({ ok: true, mensaje: MENSAJE.cancelada });
    expect(await docInv(A, ID_ANA)).toMatchObject({ estado: 'revocada', motivo: 'cancelada', resueltaPor: 'iv-adminA' });
    expect((await docInv(B, ID_ANA))!['estado']).toBe('pendiente');
    expect(await auditoria(A, 'cancelar_invitacion')).toHaveLength(1);
    // ya resuelta: no se cancela de nuevo
    await expect(cancelar({ tenantId: A, invitacionId: ID_ANA }, await sesionDe('iv-adminA'))).rejects.toMatchObject({ code: 'not-found' });
  });

  // ---- Mis invitaciones ----
  it('misInvitaciones devuelve solo las pendientes y vigentes de MI correo, de negocios activos', async () => {
    await sembrar();
    await sembrarInv(A, ANA, { rol: 'admin' });                                                    // vale
    await sembrarInv(B, ANA, { venceEn: Timestamp.fromMillis(Date.now() - DIA) });                 // vencida
    await sembrarInv(C, ANA);                                                                      // negocio dado de baja
    await sembrarInv(A, correoDe('iv-otro'));                                                      // ajena
    await sembrarInv(B, correoDe('iv-otro'));                                                      // ajena
    const r = await mis(await sesionDe('iv-ana')) as { invitaciones: Array<Record<string, unknown>> };
    expect(r.invitaciones).toEqual([{ tenantId: A, invitacionId: ID_ANA, nombreNegocio: 'Negocio A', rol: 'admin', venceEn: expect.any(Number) }]);

    await db.doc(`tenants/${B}/invitaciones/${ID_ANA}`).update({ estado: 'revocada', venceEn: Timestamp.fromMillis(Date.now() + DIA) });
    await db.doc(`tenants/${A}/invitaciones/${ID_ANA}`).update({ estado: 'revocada' });
    expect((await mis(await sesionDe('iv-ana')) as { invitaciones: unknown[] }).invitaciones).toEqual([]);
    // un admin de A no ve las de nadie por esta vía (solo las de su propio correo)
    await sembrarInv(B, ANA);
    expect((await mis(await sesionDe('iv-adminA')) as { invitaciones: unknown[] }).invitaciones).toEqual([]);
  });

  it('misInvitaciones con más de 20 pendientes devuelve a lo sumo 20', async () => {
    await sembrar();
    for (let i = 0; i < 22; i += 1) {
      await db.doc(`tenants/iv-m${i}`).set({ nombre: `M${i}`, estado: 'activo' });
      await sembrarInv(`iv-m${i}`, ANA);
    }
    const r = await mis(await sesionDe('iv-ana')) as { invitaciones: unknown[] };
    expect(r.invitaciones.length).toBe(20);
  });
});
