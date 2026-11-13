/**
 * `scripts/plataforma/aplicar-persona-puede-enviar-medios.mjs` — ENCIENDE O APAGA `tenants/{id}.personaPuedeEnviarMedios`
 * (la segunda bandera: enviar adjuntos como persona). Contra el emulador de Firestore, con el script como PROCESO
 * y `ejecutar` en proceso para la carrera de la precondición. Fichas sintéticas, proyecto `demo-*`.
 *
 * Se niega: encender sin `personaPuedeEscribir === true` exacto ('true', 1, ausente), sin consola nueva o sin estado
 * activo; comercios excluidos (id y nombre); tenant desconocido; valores que no son `true`/`false`; producción sin
 * confirmación; un campo previo que no es booleano; un respaldo de otro comercio, entorno o campo. Se afirma: seco no
 * escribe, aplicar escribe SOLO ese campo y UNA auditoría en el mismo lote (si la ficha cambió, ninguna de las dos),
 * idempotencia, revertir (restaura o elimina) sin pisar cambios ajenos, y que nunca se toca `personaPuedeEscribir`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const SCRIPT = join(ADMIN, 'scripts', 'plataforma', 'aplicar-persona-puede-enviar-medios.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'persona-puede-enviar-medios') ?? initializeApp({ projectId: PROYECTO }, 'persona-puede-enviar-medios');
const db = getFirestore(app);

type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-persona-puede-enviar-medios.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  validarValor: (t: unknown) => { ok: boolean; valor?: boolean };
};
const base = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  comprobarRespaldo: (r: string, o?: Record<string, unknown>) => { ok: boolean; real?: string };
};

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'persona-med-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

let contador = 0;
const nuevoTenant = (p = 'prueba') => `${p}-${Date.now().toString(36)}-${contador++}`;
const FICHA = { nombre: 'Tienda Sintetica', estado: 'activo', consolaConversaciones: 'nueva', plan: 'impulso', personaPuedeEscribir: true };
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

  it('NEGATIVAS: un comercio de NOVUCHAT_TENANTS_EXCLUIDOS (id exacto, contenido, tildes y mayúsculas) se rechaza sin abrir Firebase; Bellido ya NO está excluido (Andres, 08/11/2026); un solo comercio por corrida', () => {
    for (const t of ['bellido', 'consultorio-bellido', 'bellido2', 'xx-bellido-yy']) {
      expect(mod.analizarArgumentos(args(t, 'true'), ENV_EMU).ok, t).toBe(true);   // orden de Andres: el Doctor de Bellido toma y escribe
      expect(problemas(args(t, 'true'), { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'bellido' }), t).toContain('EXCLUIDO');   // el mecanismo sigue
      expect(problemas(args(t, 'false'), { ...ENV_EMU, NOVUCHAT_TENANTS_EXCLUIDOS: 'bellido' }), t).toContain('EXCLUIDO');
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
    expect((await hoy(t)).data()).toEqual({ ...FICHA, personaPuedeEnviarMedios: true });
    // Se abre UNA vez: modo y contenido salen del mismo descriptor (sin comprobar y luego abrir la misma ruta).
    const fd = openSync(ruta, 'r');
    let modo: number;
    let texto: string;
    try { modo = fstatSync(fd).mode & 0o777; texto = readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
    expect(modo.toString(8)).toBe('600');
    const fdDir = openSync(dirname(ruta), 'r');
    try { expect((fstatSync(fdDir).mode & 0o777).toString(8)).toBe('700'); } finally { closeSync(fdDir); }
    expect(ap.stdout + ap.stderr).not.toContain(PROYECTO);
    const resp = JSON.parse(texto);
    expect(resp).toMatchObject({ campo: 'personaPuedeEnviarMedios', previo: { presente: false, valor: null }, escrito: true });
    expect(JSON.stringify(resp)).not.toContain('Sintetica'); // el respaldo no guarda nada del comercio

    const h1 = await hora(t);
    const otra = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(otra.status).toBe(0);
    expect(otra.stdout).toContain('nada que hacer');
    expect(await hora(t)).toBe(h1);

    expect(hijo(revertir(t, ruta)).status).toBe(1); // seco
    expect((await hoy(t)).data()).toHaveProperty('personaPuedeEnviarMedios');
    const rev = hijo(revertir(t, ruta, ['--aplicar']));
    expect(rev.status, rev.stdout + rev.stderr).toBe(0);
    expect((await hoy(t)).data()).toEqual(FICHA);
  });

  it('apagar (false) respalda el valor previo true y revertir lo restaura', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeEnviarMedios: true });
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'false', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(false);
    expect(hijo(revertir(t, ruta, ['--aplicar'])).status).toBe(0);
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(true);
  });

  it('revertir NO pisa un valor cambiado después', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    await db.doc(`tenants/${t}`).update({ personaPuedeEnviarMedios: false, editadoDespues: 'intacto' });
    const rev = hijo(revertir(t, ruta, ['--aplicar']));
    expect(rev.status).toBe(2);
    expect((await hoy(t)).data()).toMatchObject({ personaPuedeEnviarMedios: false, editadoDespues: 'intacto' });
  });

  it('NEGATIVA: un comercio excluido por NOVUCHAT_TENANTS_EXCLUIDOS (id y NOMBRE de la ficha), encendiendo y apagando: nada escrito', async () => {
    await db.doc('tenants/bellido').set({ ...FICHA });
    const antes = await hora('bellido');
    for (const v of ['true', 'false']) {
      const r = hijo(args('bellido', v, ['--aplicar', '--respaldo', rutaRespaldo()]), { NOVUCHAT_TENANTS_EXCLUIDOS: 'bellido' });
      expect(r.status, v).toBe(2);
      expect(r.stderr).toContain('EXCLUIDO');
    }
    expect(await hora('bellido')).toBe(antes);
    expect((await hoy('bellido')).data()).not.toHaveProperty('personaPuedeEnviarMedios');

    const t = nuevoTenant();
    await ficha(t, { nombre: 'Consultorio del Dr. Béllido' });
    const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]), { NOVUCHAT_TENANTS_EXCLUIDOS: 'bellido' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('EXCLUIDO');
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
  });

  it('NEGATIVA: tenant desconocido (no se crea nada), aunque se pida aplicar', async () => {
    const t = nuevoTenant('fantasma');
    const ruta = rutaRespaldo();
    const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta]));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('no existe la ficha');
    expect((await hoy(t)).exists).toBe(false);
    expect(() => openSync(ruta, 'r')).toThrow(); // ni siquiera el respaldo
  });

  it('NEGATIVA al encender: consolaConversaciones ausente, clasica, mayúscula o de otro tipo; comercio no activo', async () => {
    for (const consola of [undefined, 'clasica', 'Nueva', 'NUEVA', true, null]) {
      const t = nuevoTenant();
      const { consolaConversaciones: _omitida, ...sinConsola } = FICHA;
      await db.doc(`tenants/${t}`).set(consola === undefined ? sinConsola : { ...sinConsola, consolaConversaciones: consola });
      const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.status, String(consola)).toBe(2);
      expect(r.stdout).toContain('consolaConversaciones === "nueva"');
      expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
    }
    for (const estado of ['suspendido', 'dado_de_baja', undefined]) {
      const t = nuevoTenant();
      const { estado: _e, ...sinEstado } = FICHA;
      await db.doc(`tenants/${t}`).set(estado === undefined ? sinEstado : { ...sinEstado, estado });
      const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.status, String(estado)).toBe(2);
      expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
    }
  });

  it('apagar SÍ se permite aunque el comercio haya vuelto a la clásica o esté suspendido (la dirección segura)', async () => {
    const t = nuevoTenant();
    await ficha(t, { consolaConversaciones: 'clasica', estado: 'suspendido', personaPuedeEnviarMedios: true });
    const r = hijo(args(t, 'false', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(false);
  });

  it('un campo ya presente que no es booleano no se pisa; y no se escribe sin --respaldo', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeEnviarMedios: 'true' });
    const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status).toBe(2);
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe('true');
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
    expect((await hoy(t2)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
  });

  const auditorias = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());

  it('NEGATIVA al encender: personaPuedeEscribir ausente, "true", 1, false o null => 2, dice cuál falta y no escribe nada (ni auditoría)', async () => {
    for (const previa of [undefined, 'true', 1, false, null]) {
      const t = nuevoTenant();
      const { personaPuedeEscribir: _p, ...sin } = FICHA;
      await db.doc(`tenants/${t}`).set(previa === undefined ? sin : { ...sin, personaPuedeEscribir: previa });
      const h0 = await hora(t);
      const r = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.status, String(previa)).toBe(2);
      expect(r.stdout).toContain('personaPuedeEscribir === true');
      expect(await hora(t)).toBe(h0);
      expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
      expect(await auditorias(t)).toHaveLength(0);
    }
  });

  it('con varias precondiciones rotas, el mensaje las nombra todas; apagar sin personaPuedeEscribir SÍ se puede', async () => {
    const t = nuevoTenant();
    await db.doc(`tenants/${t}`).set({ nombre: 'Tienda Sintetica', estado: 'suspendido', consolaConversaciones: 'clasica', personaPuedeEnviarMedios: true });
    const seco = hijo(args(t, 'true'));
    expect(seco.status).toBe(2);
    for (const x of ['personaPuedeEscribir === true', 'consolaConversaciones === "nueva"', 'estado === "activo"']) expect(seco.stdout).toContain(x);
    const ap = hijo(args(t, 'false', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(ap.status, ap.stdout + ap.stderr).toBe(0);
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(false);
    expect((await hoy(t)).get('personaPuedeEscribir')).toBeUndefined();
  });

  it('solo toca personaPuedeEnviarMedios: personaPuedeEscribir y el resto de la ficha quedan idénticos', async () => {
    const t = nuevoTenant();
    await ficha(t);
    expect(hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()])).status).toBe(0);
    expect((await hoy(t)).data()).toEqual({ ...FICHA, personaPuedeEnviarMedios: true });
    expect(hijo(args(t, 'false', ['--aplicar', '--respaldo', rutaRespaldo()])).status).toBe(0);
    expect((await hoy(t)).data()).toEqual({ ...FICHA, personaPuedeEnviarMedios: false });
  });

  it('AUDITORÍA: exactamente un documento por aplicación (encender, apagar, revertir), sin teléfono, ruta ni proyecto; idempotente y seco no auditan', async () => {
    const t = nuevoTenant();
    await ficha(t, { telefono: '59170000000' });
    expect(hijo(args(t, 'true')).status).toBe(1);
    expect(await auditorias(t)).toHaveLength(0);                       // seco
    const ruta = rutaRespaldo();
    const ap = hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta]));
    expect(ap.status, ap.stdout + ap.stderr).toBe(0);
    let a = await auditorias(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ accion: 'persona_puede_enviar_medios_cambiada', uid: 'script', script: 'aplicar-persona-puede-enviar-medios', campo: 'personaPuedeEnviarMedios', anterior: null, nuevo: true, origen: 'script', entorno: 'emulador', operacion: 'aplicar' });
    expect(a[0]?.['en']).toBeTruthy();
    const otra = hijo(args(t, 'true', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(otra.status).toBe(0);
    expect(await auditorias(t)).toHaveLength(1);                       // idempotente: no audita
    expect(hijo(args(t, 'false', ['--aplicar', '--respaldo', rutaRespaldo()])).status).toBe(0);
    a = await auditorias(t);
    expect(a).toHaveLength(2);
    expect(a.find((x) => x['nuevo'] === false)).toMatchObject({ anterior: true, operacion: 'aplicar' });
    expect(hijo(revertir(t, ruta)).status).toBe(2);                    // el campo ya no es lo que escribió este respaldo
    await db.doc(`tenants/${t}`).update({ personaPuedeEnviarMedios: true });
    expect(hijo(revertir(t, ruta, ['--aplicar'])).status).toBe(0);
    a = await auditorias(t);
    expect(a).toHaveLength(3);
    expect(a.find((x) => x['operacion'] === 'revertir')).toMatchObject({ anterior: true, nuevo: null });
    const texto = JSON.stringify(a);
    for (const prohibido of ['59170000000', PROYECTO, '/home', '/tmp', 'Sintetica']) expect(texto).not.toContain(prohibido);
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios'); // revertir eliminó el campo (no existía)
  });

  it('un respaldo de otro comercio, de otro entorno o de otro campo se rechaza al revertir', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    const otro = nuevoTenant();
    await ficha(otro, { personaPuedeEnviarMedios: true });
    const r1 = hijo(revertir(otro, ruta, ['--aplicar']));
    expect(r1.status).toBe(2);
    expect(r1.stdout).toContain('otro comercio');
    expect((await hoy(otro)).get('personaPuedeEnviarMedios')).toBe(true);
    const sustituir = (cambio: Record<string, unknown>) => {
      const rr = rutaRespaldo();
      const fd = openSync(ruta, 'r');
      let j: Record<string, unknown>;
      try { j = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
      writeFileSync(rr, JSON.stringify({ ...j, ...cambio }), { mode: 0o600 });
      return rr;
    };
    const rEnt = hijo(revertir(t, sustituir({ entorno: 'produccion' }), ['--aplicar']));
    expect(rEnt.status).toBe(2);
    expect(rEnt.stdout).toContain('otro entorno');
    const rCampo = hijo(revertir(t, sustituir({ campo: 'personaPuedeEscribir' }), ['--aplicar']));
    expect(rCampo.status).toBe(2);
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(true);
    expect(await auditorias(t)).toHaveLength(1);
  });

  it('PRECONDICIÓN real: si la ficha cambia entre la lectura y la escritura, NO queda ni el campo NI la auditoría (lote atómico)', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    const cfg: Cfg = {
      proyecto: PROYECTO, entorno: 'emulador', tenant: t, valor: true, aplicar: true, revertir: false,
      respaldo: ruta, respaldoResuelto: base.comprobarRespaldo(ruta).real ?? null,
    };
    const getAll = db.getAll.bind(db);
    let cambiada = false;
    const dbCarrera = {
      doc: db.doc.bind(db), batch: db.batch.bind(db),
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
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
    expect(await auditorias(t)).toHaveLength(0);
  });

  it('REVERTIR que vuelve a ENCENDER evalúa las tres precondiciones sobre la misma lectura: si falta alguna, 2 y nada escrito', async () => {
    for (const rota of [{ personaPuedeEscribir: false }, { consolaConversaciones: 'clasica' }, { estado: 'suspendido' }]) {
      const t = nuevoTenant();
      await ficha(t, { personaPuedeEnviarMedios: true });
      const ruta = rutaRespaldo();
      expect(hijo(args(t, 'false', ['--aplicar', '--respaldo', ruta])).status).toBe(0);   // respaldo: previo true, escrito false
      await db.doc(`tenants/${t}`).update(rota);
      const h0 = await hora(t);
      const n0 = (await auditorias(t)).length;
      for (const extra of [[], ['--aplicar']]) {
        const r = hijo(revertir(t, ruta, extra));
        expect(r.status, JSON.stringify(rota) + r.stdout).toBe(2);
        expect(r.stdout).toContain('volvería a ENCENDER');
      }
      expect(await hora(t)).toBe(h0);
      expect(await auditorias(t)).toHaveLength(n0);
      expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(false);
    }
    // con las precondiciones en regla, el mismo revertir SÍ restaura
    const ok = nuevoTenant();
    await ficha(ok, { personaPuedeEnviarMedios: true });
    const ruta = rutaRespaldo();
    expect(hijo(args(ok, 'false', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    expect(hijo(revertir(ok, ruta, ['--aplicar'])).status).toBe(0);
    expect((await hoy(ok)).get('personaPuedeEnviarMedios')).toBe(true);
  });

  it('REVERTIR que apaga o elimina el campo NO exige precondiciones (dirección segura)', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    await db.doc(`tenants/${t}`).update({ estado: 'suspendido', consolaConversaciones: 'clasica', personaPuedeEscribir: false });
    expect(hijo(revertir(t, ruta, ['--aplicar'])).status).toBe(0);
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
  });

  it('PRECONDICIÓN real en --revertir: si la ficha cambia entre la lectura y la escritura, NO queda ni el campo NI la auditoría', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeEnviarMedios: true });
    const ruta = rutaRespaldo();
    expect(hijo(args(t, 'false', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    const n0 = (await auditorias(t)).length;
    const cfg: Cfg = {
      proyecto: PROYECTO, entorno: 'emulador', tenant: t, valor: null, aplicar: true, revertir: true,
      respaldo: ruta, respaldoResuelto: base.comprobarRespaldo(ruta, { lectura: true }).real ?? null,
    };
    const getAll = db.getAll.bind(db);
    let cambiada = false;
    const dbCarrera = {
      doc: db.doc.bind(db), batch: db.batch.bind(db),
      getAll: async (...a: Parameters<typeof db.getAll>) => {
        const r = await getAll(...a);
        if (!cambiada) { cambiada = true; await db.doc(`tenants/${t}`).update({ otro: 'cambio-ajeno' }); }
        return r;
      },
    };
    const salida: string[] = [];
    const codigo = await mod.ejecutar(cfg, { db: dbCarrera, FieldValue, log: (x: string) => salida.push(x) });
    expect(codigo, salida.join('\n')).toBe(3);
    expect(salida.join('\n')).toContain('cambió entre la lectura y la escritura');
    expect((await hoy(t)).get('personaPuedeEnviarMedios')).toBe(false);
    expect(await auditorias(t)).toHaveLength(n0);
  });

  it('PRECONDICIÓN real al aplicar: si la ficha cambia entre la lectura y la escritura, NO queda ni el campo NI la auditoría (lote atómico)', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const ruta = rutaRespaldo();
    const cfg: Cfg = {
      proyecto: PROYECTO, entorno: 'emulador', tenant: t, valor: true, aplicar: true, revertir: false,
      respaldo: ruta, respaldoResuelto: base.comprobarRespaldo(ruta).real ?? null,
    };
    const getAll = db.getAll.bind(db);
    let cambiada = false;
    const dbCarrera = {
      doc: db.doc.bind(db), batch: db.batch.bind(db),
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
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeEnviarMedios');
    expect(await auditorias(t)).toHaveLength(0);
  });

  it('BANDERA YA ENCENDIDA y hoy falta una precondición con --valor true: salida 2 (comportamiento actual, no se «perdona»), sin escribir', async () => {
    for (const rota of [{ personaPuedeEscribir: false }, { consolaConversaciones: 'clasica' }, { estado: 'suspendido' }]) {
      const t = nuevoTenant();
      await ficha(t, { personaPuedeEnviarMedios: true, ...rota });
      const h0 = await hora(t);
      for (const extra of [[], ['--aplicar', '--respaldo', rutaRespaldo()]]) {
        const r = hijo(args(t, 'true', extra));
        expect(r.status, JSON.stringify(rota)).toBe(2);
        expect(r.stdout).toContain('Para encenderla falta');
      }
      expect(await hora(t)).toBe(h0);
      expect(await auditorias(t)).toHaveLength(0);
    }
  });

  it('el bloque «ANTES DE ENCENDER (este script no lo verifica)» sale con true (seco y aplicar, y al revertir a true) y NUNCA con false', async () => {
    const t = nuevoTenant();
    await ficha(t);
    const seco = hijo(args(t, 'true'));
    expect(seco.stdout).toContain('ANTES DE ENCENDER (este script no lo verifica)');
    for (const x of ['--medios', '4a y 4f', 'enviarAdjuntoComoPersona', 'leerAdjuntoPersona', 'Graph, no por el relé']) expect(seco.stdout).toContain(x);
    const ruta = rutaRespaldo();
    const ap = hijo(args(t, 'true', ['--aplicar', '--respaldo', ruta]));
    expect(ap.status).toBe(0);
    expect(ap.stdout).toContain('ANTES DE ENCENDER (este script no lo verifica)');
    expect(ap.stdout.indexOf('ANTES DE ENCENDER')).toBeLessThan(ap.stdout.indexOf('Escrito y releído'));
    for (const extra of [[], ['--aplicar', '--respaldo', rutaRespaldo()]]) {
      const off = hijo(args(t, 'false', extra));
      expect(off.stdout).not.toContain('ANTES DE ENCENDER');
    }
    // revertir hacia «true»
    const t2 = nuevoTenant();
    await ficha(t2, { personaPuedeEnviarMedios: true });
    const r2 = rutaRespaldo();
    expect(hijo(args(t2, 'false', ['--aplicar', '--respaldo', r2])).status).toBe(0);
    expect(hijo(revertir(t2, r2)).stdout).toContain('ANTES DE ENCENDER');
    // revertir hacia «ausente» no lo muestra
    const t3 = nuevoTenant();
    await ficha(t3);
    const r3 = rutaRespaldo();
    expect(hijo(args(t3, 'true', ['--aplicar', '--respaldo', r3])).status).toBe(0);
    expect(hijo(revertir(t3, r3, ['--aplicar'])).stdout).not.toContain('ANTES DE ENCENDER');
  });

  it('el texto del script: un solo lote (update del campo + create de la auditoría); nunca escribe personaPuedeEscribir', () => {
    const f = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const escrituras = f.replaceAll('FieldValue.delete()', '').match(/\.(update|set|create|delete|add|batch|bulkWriter|runTransaction)\(/g) ?? [];
    expect(escrituras).toEqual(['.batch(', '.update(', '.create(']);
    expect(f).toContain('lote.update(ref, { [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion })');
    expect(f).toContain("const CAMPO = 'personaPuedeEnviarMedios'");
    expect(f).toContain("const CAMPO_PREVIO = 'personaPuedeEscribir'");
    expect(f).not.toMatch(/update\(\s*ref\s*,\s*\{\s*\[CAMPO_PREVIO\]/);
    expect(f).not.toMatch(/process\.env\.[A-Z_]*(TOKEN|SECRET|KEY)/);
  });
});
