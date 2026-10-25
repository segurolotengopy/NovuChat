/**
 * `scripts/plataforma/aplicar-persona-puede-escribir.mjs` — ENCIENDE O APAGA `tenants/{id}.personaPuedeEscribir`
 * DE UN COMERCIO (la salida de lo que escribe una persona está publicada). Contra el emulador de Firestore,
 * con el script como PROCESO (`entornoDelEmulador`: nunca credenciales del desarrollador) y `ejecutar` en proceso
 * para provocar la carrera de la precondición. Fichas sintéticas, proyecto `demo-*`.
 *
 * Se niega: Bellido (id y nombre, encendiendo y apagando), tenant desconocido, `consolaConversaciones` distinta
 * de `nueva` al encender, comercio inactivo al encender, valores que no son `true`/`false`, producción sin
 * confirmación, y un campo ya presente que no es booleano. Y se afirma: seco no escribe, aplicar escribe UN campo
 * con respaldo y relectura, idempotencia, revertir (restaura o elimina) sin pisar cambios ajenos.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'aplicar-persona-puede-escribir.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'persona-puede-escribir') ?? initializeApp({ projectId: PROYECTO }, 'persona-puede-escribir');
const db = getFirestore(app);

type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-persona-puede-escribir.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  validarValor: (t: unknown) => { ok: boolean; valor?: boolean };
};
const base = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  comprobarRespaldo: (r: string, o?: Record<string, unknown>) => { ok: boolean; real?: string };
};

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'persona-esc-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

let contador = 0;
const nuevoTenant = (p = 'prueba') => `${p}-${Date.now().toString(36)}-${contador++}`;
const FICHA = { nombre: 'Tienda Sintetica', estado: 'activo', consolaConversaciones: 'nueva', plan: 'impulso' };
const ficha = async (t: string, o: Record<string, unknown> = {}) => { await db.doc(`tenants/${t}`).set({ ...FICHA, ...o }); };
const hoy = async (t: string) => (await db.doc(`tenants/${t}`).get());
const hora = async (t: string) => (await hoy(t)).updateTime?.toMillis();

const hijo = (args: string[], extra: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { env: entornoDelEmulador(HOST, extra), encoding: 'utf8' });
const args = (t: string, valor: string, extra: string[] = []) => ['--proyecto', PROYECTO, '--tenant', t, '--valor', valor, ...extra];
const revertir = (t: string, ruta: string, extra: string[] = []) => ['--revertir', '--respaldo', ruta, '--tenant', t, '--proyecto', PROYECTO, ...extra];

describe('argumentos (puros)', () => {
  const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
  const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };

  it('la invocación completa es válida y queda en seco', () => {
    const r = mod.analizarArgumentos(args('tienda-prueba', 'true'), ENV_EMU);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'tienda-prueba', valor: true, aplicar: false, revertir: false, entorno: 'emulador' });
    expect(mod.analizarArgumentos(args('tienda-prueba', 'false'), ENV_EMU).cfg?.['valor']).toBe(false);
  });

  it('NEGATIVAS: --valor solo es el texto exacto true o false', () => {
    for (const v of ['True', 'TRUE', '1', '0', 'si', 'yes', '', 'true,false', '__proto__', ' true']) {
      expect(problemas(args('tienda-prueba', v)), JSON.stringify(v)).toMatch(/--valor/);
    }
    expect(problemas(['--proyecto', PROYECTO, '--tenant', 'tienda-prueba'])).toContain('falta --valor');
    expect(mod.validarValor('true')).toEqual({ ok: true, valor: true });
    expect(mod.validarValor(true).ok).toBe(false);
  });

  it('NEGATIVAS: Bellido (id exacto, contenido, tildes y mayúsculas) se rechaza sin abrir Firebase; un solo comercio por corrida', () => {
    for (const t of ['bellido', 'consultorio-bellido', 'bellido2', 'xx-bellido-yy']) {
      expect(problemas(args(t, 'true')), t).toContain('EXCLUIDO');
      expect(problemas(args(t, 'false')), t).toContain('EXCLUIDO');
    }
    expect(problemas(args('tienda-a,tienda-b', 'true'))).toContain('UN solo comercio');
    expect(problemas(args('../x', 'true'))).toContain('inválido');
    expect(problemas(args('tienda-prueba', 'true'), { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'tienda-prueba' })).toContain('EXCLUIDO');
  });

  it('producción: --aplicar exige --confirmo-produccion igual al tenant; la confirmación no vale fuera de producción', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--valor', 'true'];
    expect(problemas([...prod, '--aplicar', '--respaldo', rutaRespaldo()], ENV_REAL)).toContain('--confirmo-produccion');
    expect(problemas([...prod, '--confirmo-produccion', 'otra-tienda'], ENV_REAL)).toContain('no coincide');
    expect(problemas([...args('tienda-prueba', 'true'), '--confirmo-produccion', 'tienda-prueba'])).toContain('solo se usa contra producción');
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(true); // el seco no pide confirmación
  });

  it('--aplicar exige --respaldo; --revertir exige --respaldo y no admite --valor; un proyecto fuera de la lista blanca se rechaza', () => {
    expect(problemas([...args('tienda-prueba', 'true'), '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas(['--revertir', '--tenant', 'tienda-prueba', '--proyecto', PROYECTO])).toContain('--revertir exige --respaldo');
    expect(problemas(['--revertir', '--valor', 'true', '--respaldo', rutaRespaldo(), '--tenant', 'tienda-prueba', '--proyecto', PROYECTO])).toContain('no admite --valor');
    expect(problemas(['--proyecto', 'proyecto-desconocido', '--tenant', 'tienda-prueba', '--valor', 'true'])).toBeTruthy();
    expect(problemas([...args('tienda-prueba', 'true'), '--aplicar', '--respaldo', '/home/x/respaldo.json'])).toBeTruthy(); // fuera de la lista positiva
  });
});

describe('contra el emulador, como proceso', () => {
  it('seco no escribe; aplicar escribe SOLO el campo, con respaldo 0600 en carpeta 0700; idempotente; revertir lo elimina', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const h0 = await hora(t);

    const seco = hijo(args(t, 'true'));
    expect(seco.status, seco.stdout + seco.stderr).toBe(1);
    expect(seco.stdout).toContain('AUSENTE → true');
    expect(await hora(t)).toBe(h0);

    const ruta = rutaRespaldo();
    const ap = hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta]));
    expect(ap.status, ap.stdout + ap.stderr).toBe(0);
    expect((await hoy(t)).data()).toEqual({ ...FICHA, personaPuedeEscribir: true });
    expect((statSync(ruta).mode & 0o777).toString(8)).toBe('600');
    expect((statSync(dirname(ruta)).mode & 0o777).toString(8)).toBe('700');
    expect(ap.stdout + ap.stderr).not.toContain(PROYECTO);
    const resp = JSON.parse(readFileSync(ruta, 'utf8'));
    expect(resp).toMatchObject({ campo: 'personaPuedeEscribir', previo: { presente: false, valor: null }, escrito: true });
    expect(JSON.stringify(resp)).not.toContain('Sintetica'); // el respaldo no guarda nada del comercio

    const h1 = await hora(t);
    const otra = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(otra.status).toBe(0);
    expect(otra.stdout).toContain('nada que hacer');
    expect(await hora(t)).toBe(h1);

    expect(hijo(revertir(t, ruta)).status).toBe(1); // seco
    expect((await hoy(t)).data()).toHaveProperty('personaPuedeEscribir');
    const rev = hijo(revertir(t, ruta, ['--aplicar']));
    expect(rev.status, rev.stdout + rev.stderr).toBe(0);
    expect((await hoy(t)).data()).toEqual(FICHA);
  });

  it('apagar (false) respalda el valor previo true y revertir lo restaura', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeEscribir: true });
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'false', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    expect((await hoy(t)).get('personaPuedeEscribir')).toBe(false);
    expect(hijo(revertir(t, ruta, ['--aplicar'])).status).toBe(0);
    expect((await hoy(t)).get('personaPuedeEscribir')).toBe(true);
  });

  it('revertir NO pisa un valor cambiado después', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    await db.doc(`tenants/${t}`).update({ personaPuedeEscribir: false, editadoDespues: 'intacto' });
    const rev = hijo(revertir(t, ruta, ['--aplicar']));
    expect(rev.status).toBe(2);
    expect((await hoy(t)).data()).toMatchObject({ personaPuedeEscribir: false, editadoDespues: 'intacto' });
  });

  it('NEGATIVA: Bellido por id (proceso) y por el NOMBRE de la ficha, encendiendo y apagando: nada escrito', async () => {
    await db.doc('tenants/bellido').set({ ...FICHA });
    const antes = await hora('bellido');
    for (const v of ['true', 'false']) {
      const r = hijo(args('bellido', v, ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.status, v).toBe(2);
      expect(r.stderr).toContain('EXCLUIDO');
    }
    expect(await hora('bellido')).toBe(antes);
    expect((await hoy('bellido')).data()).not.toHaveProperty('personaPuedeEscribir');

    const t = nuevoTenant();
    await ficha(t, { nombre: 'Consultorio del Dr. Béllido' });
    const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('EXCLUIDO');
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEscribir');
  });

  it('NEGATIVA: tenant desconocido (no se crea nada), aunque se pida aplicar', async () => {
    const t = nuevoTenant('fantasma');
    const ruta = rutaRespaldo();
    const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta]));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('no existe la ficha');
    expect((await hoy(t)).exists).toBe(false);
    expect(() => statSync(ruta)).toThrow(); // ni siquiera el respaldo
  });

  it('NEGATIVA al encender: consolaConversaciones ausente, clasica, mayúscula o de otro tipo; comercio no activo', async () => {
    for (const consola of [undefined, 'clasica', 'Nueva', 'NUEVA', true, null]) {
      const t = nuevoTenant();
      const { consolaConversaciones: _omitida, ...sinConsola } = FICHA;
      await db.doc(`tenants/${t}`).set(consola === undefined ? sinConsola : { ...sinConsola, consolaConversaciones: consola });
      const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.status, String(consola)).toBe(2);
      expect(r.stdout).toContain('consolaConversaciones === "nueva"');
      expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEscribir');
    }
    for (const estado of ['suspendido', 'dado_de_baja', undefined]) {
      const t = nuevoTenant();
      const { estado: _e, ...sinEstado } = FICHA;
      await db.doc(`tenants/${t}`).set(estado === undefined ? sinEstado : { ...sinEstado, estado });
      const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.status, String(estado)).toBe(2);
      expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEscribir');
    }
  });

  it('apagar SÍ se permite aunque el comercio haya vuelto a la clásica o esté suspendido (la dirección segura)', async () => {
    const t = nuevoTenant();
    await ficha(t, { consolaConversaciones: 'clasica', estado: 'suspendido', personaPuedeEscribir: true });
    const r = hijo(args(t, 'false', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect((await hoy(t)).get('personaPuedeEscribir')).toBe(false);
  });

  it('un campo ya presente que no es booleano no se pisa; y no se escribe sin --respaldo', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeEscribir: 'true' });
    const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status).toBe(2);
    expect((await hoy(t)).get('personaPuedeEscribir')).toBe('true');
    const sin = hijo(args(t, 'false', ['--aplicar']));
    expect(sin.status).toBe(2);
    expect(sin.stderr).toContain('--aplicar exige --respaldo');
  });

  it('un respaldo existente nunca se pisa', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    const t2 = nuevoTenant();
    await ficha(t2);
    const r = hijo(args(t2, 'true', ['--aplicar', '--respaldo', ruta]));
    expect(r.status).toBe(2);
    expect((await hoy(t2)).data()).not.toHaveProperty('personaPuedeEscribir');
  });

  it('PRECONDICIÓN real (lastUpdateTime): si la ficha cambia entre la lectura y la escritura, no se escribe', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    const cfg: Cfg = {
      proyecto: PROYECTO, entorno: 'emulador', tenant: t, valor: true, aplicar: true, revertir: false,
      respaldo: ruta, respaldoResuelto: base.comprobarRespaldo(ruta).real ?? null,
    };
    // `db.getAll` real, pero la ficha cambia justo después de leerla.
    const getAll = db.getAll.bind(db);
    let cambiada = false;
    const dbCarrera = {
      doc: db.doc.bind(db),
      getAll: async (...a: Parameters<typeof db.getAll>) => {
        const r = await getAll(...a);
        if (!cambiada) { cambiada = true; await db.doc(`tenants/${t}`).update({ otro: 'cambio-ajeno' }); }
        return r;
      },
    };
    const salida: string[] = [];
    const codigo = await mod.ejecutar(cfg, { db: dbCarrera, FieldValue, log: (x: string) => salida.push(x) });
    expect(codigo).toBe(3);
    expect(salida.join('\n')).toContain('cambió entre la lectura y la escritura');
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEscribir');
  });

  it('el texto del script: su única escritura a Firestore es `update` de `personaPuedeEscribir`', () => {
    const f = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const escrituras = f.replaceAll('FieldValue.delete()', '').match(/\.(update|set|create|delete|add|batch|bulkWriter|runTransaction)\(/g) ?? [];
    expect(escrituras).toEqual(['.update(']);
    expect(f).toContain('ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion })');
    expect(f).toContain("const CAMPO = 'personaPuedeEscribir'");
    expect(f).not.toMatch(/process\.env\.[A-Z_]*(TOKEN|SECRET|KEY)/);
  });
});
