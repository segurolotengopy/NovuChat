/**
 * EL TITULAR DE LA CUENTA (T2): `fijar-titular.mjs`, las dos altas y `asignar-rol.mjs`.
 *
 * Decisión de Andres (17/10/2026): un administrador no puede quitar al titular; solo NovuChat
 * lo cambia. La lógica vive en `scripts/plataforma/titular-cuenta.mjs` y se prueba contra el
 * emulador de Firestore con un Auth de mentira (el Auth de los procesos hijos está apagado a
 * propósito). Se prueba negando, con control positivo.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
// @ts-expect-error módulo .mjs sin tipos
import { adminsActivos, fijarTitular, rechazoPorTitular } from '../../scripts/plataforma/titular-cuenta.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const SCRIPTS = join(ADMIN, 'scripts', 'plataforma');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'fijar-titular') ?? initializeApp({ projectId: PROYECTO }, 'fijar-titular');
const db = getFirestore(app);

const T = 'ftit-uno';
const AJENO = 'ftit-ajeno';
const SIN = 'ftit-sin-titular';
const TENANTS = [T, AJENO, SIN];
const OP = 'operador@ejemplo.com';

// Auth de mentira: uid → claims. Misma forma de claim que claims.ts: nc.t[tenant].
const CLAIMS: Record<string, Record<string, string>> = {
  admin1: { [T]: 'admin' }, admin2: { [T]: 'admin' }, oper1: { [T]: 'oper' },
  pend1: { [T]: 'admin' }, baja1: { [T]: 'admin' }, soloficha: {}, ajeno1: { [AJENO]: 'admin' },
  adminSin: { [SIN]: 'admin' },
};
const auth = {
  getUser: async (uid: string) => {
    if (!(uid in CLAIMS)) throw new Error('no existe');
    return { uid, customClaims: { nc: { t: CLAIMS[uid] } } };
  },
};
const rolEnFicha = { admin1: 'admin', admin2: 'admin', oper1: 'oper', pend1: 'admin', baja1: 'admin', soloficha: 'admin' } as const;
const estadoEnFicha: Record<string, string> = { pend1: 'pendiente_verificacion', baja1: 'baja' };

const ficha = async (t: string) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const auditorias = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', 'fijar_titular').get()).docs.map((d) => d.data());
const miembros = async (t: string) =>
  Object.fromEntries((await db.collection(`tenants/${t}/miembros`).get()).docs.map((d) => [d.id, d.data()]));

async function sembrar() {
  for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const t of [T, AJENO, SIN]) await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', plan: 'impulso', marca: 'intacta' });
  await db.doc(`tenants/${T}`).update({ titularCuentaUid: 'admin1', titularCuentaEn: Timestamp.now(), titularCuentaPor: 'prueba' });
  for (const [uid, rol] of Object.entries(rolEnFicha)) {
    await db.doc(`tenants/${T}/miembros/${uid}`).set({
      correo: `${uid}@ejemplo.com`, rol, estado: estadoEnFicha[uid] ?? 'activo', desde: Timestamp.now(),
    });
  }
  await db.doc(`tenants/${AJENO}/miembros/ajeno1`).set({ correo: 'ajeno1@ejemplo.com', rol: 'admin', estado: 'activo' });
  await db.doc(`tenants/${SIN}/miembros/adminSin`).set({ correo: 'adminsin@ejemplo.com', rol: 'admin', estado: 'activo' });
}
beforeAll(sembrar);

const fijar = (uid: string | null, aplicar: boolean, tenant = T) =>
  fijarTitular({ db, auth, tenant, uid, operador: OP, aplicar });

describe('fijar-titular: lo que no se puede', () => {
  it('en seco no escribe nada, ni auditoría (control: dice que sí podría)', async () => {
    const antes = await ficha(T);
    const r = await fijar('admin2', false);
    expect(r).toMatchObject({ ok: true, aplicado: false, anterior: 'admin1', nuevo: 'admin2' });
    expect(await ficha(T)).toEqual(antes);
    expect(await auditorias(T)).toHaveLength(0);
  });

  it.each([
    ['un no miembro', 'ajeno1', 'no es miembro'],
    ['un operador', 'oper1', 'no es admin'],
    ['una membresía pendiente de verificación', 'pend1', 'no está activa'],
    ['una membresía de baja', 'baja1', 'no está activa'],
    ['un miembro cuyo claim no es admin', 'soloficha', 'claim'],
  ])('rechaza %s, aun con --aplicar, y no deja rastro', async (_n, uid, motivo) => {
    const antes = await ficha(T);
    const r = await fijar(uid, true);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain(motivo);
    expect(await ficha(T)).toEqual(antes);
    expect(await auditorias(T)).toHaveLength(0);
  });

  it('rechaza un comercio que no existe', async () => {
    const r = await fijar('admin1', true, 'ftit-no-existe');
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('no existe');
  });
});

describe('fijar-titular --aplicar', () => {
  it('escribe solo los tres campos y la auditoría; miembros, claims y el resto, intactos', async () => {
    const fichaAntes = await ficha(T);
    const miembrosAntes = await miembros(T);
    const ajenoAntes = [await ficha(AJENO), await miembros(AJENO), await ficha(SIN)];
    const claimsAntes = JSON.stringify(CLAIMS);
    const r = await fijar('admin2', true);
    expect(r).toMatchObject({ ok: true, aplicado: true, anterior: 'admin1', nuevo: 'admin2' });

    const despues = await ficha(T);
    const { titularCuentaUid, titularCuentaEn, titularCuentaPor, ...resto } = despues;
    const { titularCuentaUid: _u, titularCuentaEn: _e, titularCuentaPor: _p, ...restoAntes } = fichaAntes;
    expect(titularCuentaUid).toBe('admin2');
    expect(titularCuentaPor).toBe('fijar-titular');
    expect(titularCuentaEn).toBeInstanceOf(Timestamp);
    expect(resto).toEqual(restoAntes);
    expect(await miembros(T)).toEqual(miembrosAntes);
    expect(JSON.stringify(CLAIMS)).toBe(claimsAntes);
    expect([await ficha(AJENO), await miembros(AJENO), await ficha(SIN)]).toEqual(ajenoAntes);

    const aud = await auditorias(T);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({
      accion: 'fijar_titular', uid: OP, origen: 'script',
      antes: { titularCuentaUid: 'admin1' }, despues: { titularCuentaUid: 'admin2' },
    });
    expect(await auditorias(AJENO)).toHaveLength(0);
  });

  it('--quitar deja la cuenta sin titular y lo audita; repetirlo se rechaza', async () => {
    const r = await fijar(null, true);
    expect(r).toMatchObject({ ok: true, aplicado: true, anterior: 'admin2', nuevo: null });
    expect((await ficha(T))['titularCuentaUid']).toBeNull();
    const aud = await auditorias(T);
    expect(aud).toHaveLength(2);
    expect(aud.some((a) => a['despues']?.titularCuentaUid === null && a['antes']?.titularCuentaUid === 'admin2')).toBe(true);
    expect((await fijar(null, true)).ok).toBe(false);
    expect(await auditorias(T)).toHaveLength(2);
  });

  it('una comprobación que cambia dentro de la transacción aborta sin escribir', async () => {
    await db.doc(`tenants/${T}`).update({ titularCuentaUid: 'admin1' });
    // La membresía pasa a baja entre la comprobación y la escritura: la transacción la relee.
    const authQueBaja = {
      getUser: async (uid: string) => {
        await db.doc(`tenants/${T}/miembros/${uid}`).update({ estado: 'baja' });
        return auth.getUser(uid);
      },
    };
    const antes = await ficha(T);
    const n = (await auditorias(T)).length;
    await expect(fijarTitular({ db, auth: authQueBaja, tenant: T, uid: 'admin2', operador: OP, aplicar: true }))
      .rejects.toThrow(/cambió/);
    expect(await ficha(T)).toEqual(antes);
    expect(await auditorias(T)).toHaveLength(n);
  });

  it('la relectura detecta un fallo: si la ficha no queda como se escribió, devuelve ok:false', async () => {
    await sembrar();
    // Un db cuya relectura miente: el primer get de la ficha es real, el último devuelve otro titular.
    let lecturas = 0;
    const dbMentiroso = new Proxy(db, {
      get(o, k) {
        if (k !== 'doc') return (o as any)[k].bind ? (o as any)[k].bind(o) : (o as any)[k];
        return (ruta: string) => {
          const ref = o.doc(ruta);
          if (ruta !== `tenants/${T}`) return ref;
          return new Proxy(ref, {
            get(r, kk) {
              if (kk === 'get') return async () => {
                lecturas += 1;
                const s = await r.get();
                return lecturas >= 2 && lecturas % 2 === 0 ? { exists: s.exists, get: () => 'otro' } : s;
              };
              const v = (r as any)[kk];
              return typeof v === 'function' ? v.bind(r) : v;
            },
          });
        };
      },
    });
    const r = await fijarTitular({ db: dbMentiroso as any, auth, tenant: T, uid: 'admin2', operador: OP, aplicar: true });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('relectura');
  });
});

describe('fijar-titular sin --tenant: solo lista', () => {
  it('lista los administradores activos y no escribe', async () => {
    await sembrar();
    const antes = await ficha(T);
    const l = await adminsActivos({ db, auth, tenant: T });
    expect(l.map((a: { uid: string }) => a.uid).sort()).toEqual(['admin1', 'admin2', 'soloficha']);
    expect(l.find((a: { uid: string }) => a.uid === 'soloficha')?.claimAdmin).toBe(false);
    expect(await ficha(T)).toEqual(antes);
  });
});

describe('fijar-titular.mjs: la línea de comandos', () => {
  const correr = (...args: string[]) => {
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'fijar-titular.mjs'), ...args], {
      encoding: 'utf8', env: entornoDelEmulador(HOST), timeout: 30_000,
    });
    return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  it('sin --operador, con --uid sin --tenant o con --quitar y --uid: código 2', () => {
    for (const a of [[], ['--proyecto', PROYECTO], ['--proyecto', PROYECTO, '--operador', OP, '--uid', 'abc123'],
      ['--proyecto', PROYECTO, '--operador', OP, '--tenant', T, '--quitar', '--uid', 'abc123'],
      ['--proyecto', PROYECTO, '--operador', OP, '--tenant', T]]) {
      expect(correr(...a).codigo, a.join(' ')).toBe(2);
    }
  });
});

describe('asignar-rol: el titular no se quita ni se degrada', () => {
  beforeAll(sembrar);
  const dec = (uidAuth: string | undefined, correo: string, accion: string, tenant = T) =>
    rechazoPorTitular({ db, tenant, correo, uidAuth, accion });

  it('rechaza quitar y degradar al titular, por correo y por uid, con la salida que dice qué hacer', async () => {
    for (const accion of ['quitar', 'oper']) {
      expect(await dec(undefined, 'admin1@ejemplo.com', accion)).toContain('primero cambie el titular con fijar-titular.mjs');
      expect(await dec('admin1', 'otro@ejemplo.com', accion)).toContain('fijar-titular.mjs');
    }
  });
  it('permite a un no titular y a un tenant sin titular (control positivo)', async () => {
    expect(await dec('admin2', 'admin2@ejemplo.com', 'quitar')).toBeNull();
    expect(await dec('oper1', 'oper1@ejemplo.com', 'oper')).toBeNull();
    expect(await dec('adminSin', 'adminsin@ejemplo.com', 'quitar', SIN)).toBeNull();
  });

  it('el script, en seco, rechaza con 1 al titular y deja pasar a un no titular', () => {
    const correr = (correo: string, ...mas: string[]) => {
      const r = spawnSync(process.execPath, [join(SCRIPTS, 'asignar-rol.mjs'), '--proyecto', PROYECTO, '--tenant', T,
        '--correo', correo, ...mas], { encoding: 'utf8', env: entornoDelEmulador(HOST), timeout: 30_000 });
      return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };
    const q = correr('admin1@ejemplo.com', '--quitar');
    expect(q.codigo, q.salida).toBe(1);
    expect(q.salida).toContain('primero cambie el titular con fijar-titular.mjs');
    const o = correr('admin1@ejemplo.com', '--rol', 'oper');
    expect(o.codigo, o.salida).toBe(1);
    expect(o.salida).toContain('fijar-titular.mjs');
    const ok = correr('admin2@ejemplo.com', '--quitar');
    expect(ok.codigo, ok.salida).toBe(0);
    const ok2 = correr('admin1@ejemplo.com', '--rol', 'admin');
    expect(ok2.codigo, ok2.salida).toBe(0);
  });
});

describe('las dos altas fijan el titular', () => {
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;])\/\/.*$/gm, '$1');
  it('altaTenant (tenants.ts) y alta-comercio.mjs escriben titularCuentaUid con el uid del administrador inicial, en la ficha', () => {
    const ts = sinComentarios(readFileSync(join(ADMIN, 'functions', 'src', 'plataforma', 'tenants.ts'), 'utf8'));
    const mjs = sinComentarios(readFileSync(join(SCRIPTS, 'alta-comercio.mjs'), 'utf8'));
    expect(ts).toMatch(/lote\.create\(ref, \{[\s\S]*?titularCuentaUid: usuarioAdmin\.uid[\s\S]*?\}\);/);
    expect(mjs).toMatch(/lote\.create\(db\.doc\(`tenants\/\$\{TENANT\}`\), \{[\s\S]*?titularCuentaUid: usuario\.uid[\s\S]*?\}\);/);
    // Y el administrador inicial es el mismo que recibe la membresía.
    expect(mjs).toMatch(/miembros\/\$\{usuario\.uid\}`\), \{\s*correo: ADMIN, rol: 'admin'/);
  });
});
