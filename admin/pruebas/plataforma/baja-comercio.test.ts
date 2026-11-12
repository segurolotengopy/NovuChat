/**
 * `scripts/plataforma/baja-comercio.mjs` — DA DE BAJA UN COMERCIO con la misma lógica que la callable `bajaTenant`
 * (`functions/src/plataforma/baja.ts`, compartida). Contra el emulador de Firestore; los claims se inyectan (no hay Auth).
 * Los comercios son sintéticos. Negando primero:
 *   1. Argumentos y salvaguardas: sin proyecto, proyecto fuera de la lista, producción sin confirmación o con otra,
 *      `--aplicar` sin respaldo, `--revertir` (no existe), varios comercios, comercio excluido.
 *   2. Comercio inexistente (1) y ya dado de baja (0, sin escribir).
 *   3. Seco: no escribe nada y no imprime datos personales.
 *   4. Aplicar: ficha, rutas, roles y auditoría; los datos se conservan; precondición; respaldo que no se pisa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'baja-comercio.mjs');
type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/baja-comercio.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  QUIEN: string;
};
const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'baja-comercio') ?? initializeApp({ projectId: PROYECTO }, 'baja-comercio');
const db = getFirestore(app);

const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const dirs: string[] = [];
const rutaRespaldo = () => { const d = mkdtempSync(join('/tmp', 'baja-comercio-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'respaldo.json'); };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const T = 'comercio-baja-prueba';
const OTRO = 'comercio-vecino-prueba';
const RUTA_A = 'ruta-baja-a';
const RUTA_B = 'ruta-baja-b';
const RUTA_VECINA = 'ruta-baja-vecina';
const MIEMBROS = ['uid-m1', 'uid-m2'];

async function sembrar(estado = 'activo'): Promise<void> {
  for (const t of [T, OTRO]) {
    for (const c of ['miembros', 'auditoria', 'editoresCrm', 'conversaciones']) {
      for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) await d.ref.delete();
    }
  }
  await db.doc(`tenants/${T}`).set({ nombre: 'Comercio de prueba', estado, vertical: 'venta' });
  await db.doc(`tenants/${OTRO}`).set({ nombre: 'Vecino de prueba', estado: 'activo' });
  for (const [id, tenantId, e] of [[RUTA_A, T, 'activo'], [RUTA_B, T, 'activo'], [RUTA_VECINA, OTRO, 'activo']] as const) {
    await db.doc(`rutasWhatsApp/${id}`).set({ tenantId, flujo: 'venta', estado: e });
  }
  for (const uid of MIEMBROS) await db.doc(`tenants/${T}/miembros/${uid}`).set({ correo: `${uid}@ejemplo.invalid`, rol: 'admin', estado: 'activo' });
  await db.doc(`tenants/${T}/conversaciones/c1`).set({ ultimoEn: Timestamp.now() });
}
beforeAll(() => sembrar());

const quitados: Array<[string, string]> = [];
const auditados: Array<{ tenantId: string; accion: string; uid: string }> = [];
const depsBase = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  db, Timestamp, env: {}, log: () => undefined,
  quitarRol: async (uid: string, tenantId: string) => { quitados.push([uid, tenantId]); },
  auditar: async (tenantId: string, accion: string, uid: string, detalle: object) => {
    auditados.push({ tenantId, accion, uid });
    await db.collection(`tenants/${tenantId}/auditoria`).add({ accion, uid, ...detalle });
  },
  ...extra,
});
const corre = async (cfg: Cfg, extra: Record<string, unknown> = {}) => {
  const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, depsBase({ log: (t: string) => salida.push(t), ...extra }));
  return { codigo, salida: salida.join('\n') };
};
const cfgSeco = (tenant = T): Cfg => ({ proyecto: PROYECTO, entorno: 'emulador', tenant, aplicar: false, respaldo: null, respaldoResuelto: null });
const cfgAplicar = (tenant = T): Cfg => { const r = rutaRespaldo(); return { ...cfgSeco(tenant), aplicar: true, respaldo: r, respaldoResuelto: r }; };
const estadoDe = async (t: string) => (await db.doc(`tenants/${t}`).get()).get('estado');
const estadoRuta = async (id: string) => (await db.doc(`rutasWhatsApp/${id}`).get()).get('estado');

describe('baja-comercio — argumentos y salvaguardas (negando primero)', () => {
  const ok = ['--proyecto', PROYECTO, '--tenant', T];
  const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', ...ENV_REAL };
  const analizar = (argv: string[], e: Record<string, string> = env) => mod.analizarArgumentos(argv, e);
  const motivos = (argv: string[], e: Record<string, string> = env) => (analizar(argv, e).problemas ?? []).join(' | ');

  it('sin proyecto o sin comercio no corre', () => {
    expect(motivos(['--tenant', T])).toMatch(/falta --proyecto/);
    expect(motivos(['--proyecto', PROYECTO])).toMatch(/falta --tenant/);
  });
  it('un proyecto fuera de la lista blanca se rechaza, y el id real nunca se imprime', () => {
    const r = analizar(['--proyecto', 'proyecto-desconocido-123', '--tenant', T]);
    expect(r.ok).toBe(false);
    expect((r.problemas ?? []).join(' ')).not.toContain('proyecto-desconocido-123');
  });
  it('producción: --aplicar exige --confirmo-produccion igual al comercio; sin él o con otro se rechaza', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', T, '--aplicar', '--respaldo', rutaRespaldo()];
    expect(motivos(prod, ENV_REAL)).toMatch(/exige --confirmo-produccion/);
    expect(motivos([...prod, '--confirmo-produccion', OTRO], ENV_REAL)).toMatch(/no coincide con --tenant/);
    expect(analizar([...prod, '--confirmo-produccion', T], ENV_REAL).ok).toBe(true);
  });
  it('--confirmo-produccion solo se usa contra producción', () => {
    expect(motivos([...ok, '--confirmo-produccion', T])).toMatch(/solo se usa contra producción/);
  });
  it('--aplicar sin --respaldo no corre', () => {
    expect(motivos([...ok, '--aplicar'])).toMatch(/--aplicar exige --respaldo/);
  });
  it('--revertir NO existe: la baja no se deshace con un botón', () => {
    expect(motivos([...ok, '--revertir'])).toMatch(/no existe --revertir/);
  });
  it('un solo comercio por corrida, con un id válido, y ningún argumento desconocido', () => {
    expect(motivos(['--proyecto', PROYECTO, '--tenant', `${T},${OTRO}`])).toMatch(/UN solo comercio/);
    expect(motivos(['--proyecto', PROYECTO, '--tenant', 'A_B'])).toMatch(/inválido/);
    expect(motivos([...ok, '--forzar'])).toMatch(/opción desconocida/);
    expect(motivos([...ok, '--valor', 'x'])).toMatch(/opción desconocida/);
  });
  it('un comercio excluido (Bellido) no se toca', () => {
    expect(motivos(['--proyecto', PROYECTO, '--tenant', 'bellido'])).toMatch(/EXCLUIDO/);
  });
  it('el proceso real: sin confirmación sale con 2 y no escribe', async () => {
    await sembrar();
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T, '--aplicar'], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--aplicar exige --respaldo/);
    expect(await estadoDe(T)).toBe('activo');
  });
  it('el proceso real: un proyecto fuera de la lista sale con 2, sin tocar nada', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', 'otro-proyecto-cualquiera', '--tenant', T], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(await estadoDe(T)).toBe('activo');
  });
  it('el proceso real: el seco contra el emulador no escribe y sale con 1 (hay algo por dar de baja)', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/SECO/);
    expect(await estadoDe(T)).toBe('activo');
  });
});

describe('baja-comercio — la ejecución', () => {
  it('un comercio que no existe: sale con 1 y no crea nada', async () => {
    const r = await corre(cfgAplicar('comercio-que-no-existe'));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no existe la ficha/);
    expect((await db.doc('tenants/comercio-que-no-existe').get()).exists).toBe(false);
  });

  it('el seco no escribe: ni la ficha, ni las rutas, ni los roles, ni la auditoría; y no imprime datos personales', async () => {
    await sembrar();
    quitados.length = 0; auditados.length = 0;
    const r = await corre(cfgSeco());
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/estado actual\s+: activo/);
    expect(r.salida).toMatch(/miembros\s+: 2/);
    expect(r.salida).toMatch(/rutas de WhatsApp\s+: 2 \(2 activo\)/);
    expect(r.salida).not.toMatch(/ejemplo\.invalid|uid-m1|ruta-baja/);
    expect(await estadoDe(T)).toBe('activo');
    expect(await estadoRuta(RUTA_A)).toBe('activo');
    expect(quitados).toEqual([]);
    expect(auditados).toEqual([]);
    expect((await db.collection(`tenants/${T}/auditoria`).get()).size).toBe(0);
  });

  it('aplicar: ficha dado_de_baja con bajaEn y bajaPor, SOLO sus rutas cortadas, roles quitados, auditoría; no borra nada', async () => {
    await sembrar();
    quitados.length = 0; auditados.length = 0;
    const cfg = cfgAplicar();
    const r = await corre(cfg);
    expect(r.codigo).toBe(0);
    const ficha = (await db.doc(`tenants/${T}`).get()).data() ?? {};
    expect(ficha['estado']).toBe('dado_de_baja');
    expect(ficha['bajaPor']).toBe(mod.QUIEN);
    expect(ficha['bajaEn']).toBeDefined();
    expect(await estadoRuta(RUTA_A)).toBe('dado_de_baja');
    expect(await estadoRuta(RUTA_B)).toBe('dado_de_baja');
    expect(await estadoRuta(RUTA_VECINA)).toBe('activo');
    expect(await estadoDe(OTRO)).toBe('activo');
    expect(quitados.sort()).toEqual(MIEMBROS.map((u) => [u, T]).sort());
    expect(auditados).toEqual([{ tenantId: T, accion: 'baja_tenant', uid: mod.QUIEN }]);
    expect((await db.collection(`tenants/${T}/auditoria`).get()).docs[0]?.get('miembros')).toBe(2);
    // Retención: nada se borró.
    expect((await db.collection(`tenants/${T}/miembros`).get()).size).toBe(2);
    expect((await db.doc(`tenants/${T}/conversaciones/c1`).get()).exists).toBe(true);
    // El respaldo guarda el estado previo y ningún dato personal.
    const texto = readFileSync(cfg['respaldo'] as string, 'utf8');
    expect(JSON.parse(texto)).toMatchObject({ campo: 'baja', tenant: T, previo: { estado: 'activo' } });
    expect(texto).not.toMatch(/ejemplo\.invalid/);
  });

  it('idempotente: ya dado de baja, sale con 0, no escribe ni audita otra vez ni toca el respaldo', async () => {
    quitados.length = 0; auditados.length = 0;
    const antes = (await db.doc(`tenants/${T}`).get()).get('bajaEn');
    const cfg = cfgAplicar();
    const r = await corre(cfg);
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/ya está dado de baja/);
    expect(quitados).toEqual([]);
    expect(auditados).toEqual([]);
    expect(existsSync(cfg['respaldo'] as string)).toBe(false);
    expect((await db.doc(`tenants/${T}`).get()).get('bajaEn').isEqual(antes)).toBe(true);
  });

  it('un respaldo existente nunca se pisa: sale con 2 y no da la baja', async () => {
    await sembrar();
    const cfg = cfgAplicar();
    expect((await corre(cfg)).codigo).toBe(0);
    await sembrar();
    const otra = await corre(cfg); // mismo respaldo, ya existe
    expect(otra.codigo).toBe(2);
    expect(otra.salida).toMatch(/Ya existe un archivo/);
    expect(await estadoDe(T)).toBe('activo');
  });

  it('precondición: si la ficha cambia entre la lectura y la escritura, no se da la baja (3) y no se corta nada', async () => {
    await sembrar();
    quitados.length = 0;
    const conCambio = new Proxy(db, {
      get(objetivo, prop) {
        if (prop === 'doc') {
          return (ruta: string) => {
            const ref = objetivo.doc(ruta);
            if (ruta !== `tenants/${T}`) return ref;
            return Object.create(ref, { update: { value: async (...a: unknown[]) => { await ref.update({ otro: 'cambio-ajeno' }); return (ref.update as (...x: unknown[]) => Promise<unknown>)(...a); } } });
          };
        }
        const v = Reflect.get(objetivo, prop) as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(objetivo) : v;
      },
    });
    const r = await corre(cfgAplicar(), { db: conCambio });
    expect(r.codigo).toBe(3);
    expect(r.salida).toMatch(/cambió entre la lectura y la escritura/);
    expect(await estadoDe(T)).toBe('activo');
    expect(await estadoRuta(RUTA_A)).toBe('activo');
    expect(quitados).toEqual([]);
  });

  it('una baja cortada a medias (ficha lista, una ruta activa, sin auditoría) se ve incompleta en el seco y --aplicar la COMPLETA sin reescribir la ficha', async () => {
    await sembrar('dado_de_baja');
    const bajaEn = Timestamp.fromMillis(1_700_000_000_000);
    await db.doc(`tenants/${T}`).update({ bajaEn, bajaPor: 'quien-sea' });
    await db.doc(`rutasWhatsApp/${RUTA_A}`).update({ estado: 'dado_de_baja' }); // la otra (B) queda activa
    quitados.length = 0; auditados.length = 0;
    const seco = await corre(cfgSeco());
    expect(seco.codigo).toBe(1);
    expect(seco.salida).toMatch(/INCOMPLETA/);
    expect(await estadoRuta(RUTA_B)).toBe('activo');
    const r = await corre(cfgAplicar());
    expect(r.codigo).toBe(0);
    expect(await estadoRuta(RUTA_B)).toBe('dado_de_baja');
    expect(await estadoRuta(RUTA_VECINA)).toBe('activo');
    expect(quitados.sort()).toEqual(MIEMBROS.map((u) => [u, T]).sort());
    expect(auditados).toHaveLength(1);
    const ficha = (await db.doc(`tenants/${T}`).get()).data() ?? {};
    expect((ficha['bajaEn'] as { toMillis: () => number }).toMillis()).toBe(1_700_000_000_000);
    expect(ficha['bajaPor']).toBe('quien-sea');
    // Y ahora sí está completa: nada que hacer.
    expect((await corre(cfgAplicar())).salida).toMatch(/nada que hacer/);
  });

  it('ejecutarBajaTenant (la lógica compartida): el gancho se llama con (comercio, quien, «baja») DESPUÉS de las rutas y ANTES de los roles', async () => {
    await sembrar();
    const orden: string[] = [];
    const { ejecutarBajaTenant } = await import('../../functions/src/plataforma/baja.ts');
    const r = await ejecutarBajaTenant({
      db: db as never, ahora: () => Timestamp.now() as never,
      quitarRol: async () => { orden.push('rol:' + await estadoRuta(RUTA_A)); },
      auditar: async (_t: string, accion: string) => { orden.push(`auditar:${accion}`); },
      gancho: async (t: string, q: string, m: string) => { orden.push(['gancho', t, q, m, await estadoRuta(RUTA_A)].join(':')); },
    }, T, 'quien');
    expect(r.miembros).toBe(2);
    expect(orden).toEqual([`gancho:${T}:quien:baja:dado_de_baja`, 'rol:dado_de_baja', 'rol:dado_de_baja', 'auditar:baja_tenant']);
  });

  it('un miembro cuyo usuario ya no existe en Auth no detiene la baja: el cableado real lo tolera y revoca las sesiones', () => {
    const texto = readFileSync(SCRIPT, 'utf8');
    expect(texto).toMatch(/asignarRol\(uid, tenantId, null, \{ revocarSesiones: true \}\)/);
    expect(texto).toMatch(/auth\/user-not-found/);
  });

  it('el código de la baja es UNO: el script no repite la lógica de la callable', () => {
    const texto = readFileSync(SCRIPT, 'utf8');
    expect(texto).toMatch(/ejecutarBajaTenant/);
    expect(texto).not.toMatch(/\.update\(\s*\{\s*estado/);
    expect(texto).not.toMatch(/\.delete\(/);
  });
});
