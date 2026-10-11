/**
 * `aplicar-consola-conversaciones.mjs` y `rellenar-conversaciones.mjs` CONTRA EL EMULADOR DE FIRESTORE
 * (H1-5). Los dos scripts como PROCESO (`spawnSync` con `entornoDelEmulador`: nunca las credenciales del
 * desarrollador) y `ejecutar` en proceso cuando hace falta provocar una carrera real.
 *
 * Lo que la base en memoria de las otras dos suites no demuestra y esta sí: la precondición `lastUpdateTime`
 * real (código 9), el lote atómico real, `select` + `startAfter` por id de documento con más de 300
 * documentos, `FieldValue.delete()` real y que el relleno no toca ni los mensajes ni otro comercio.
 *
 * Proyecto `demo-*`; datos sintéticos; cada prueba usa su propio comercio (no se limpia el emulador).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { trozosDeTelefono, palabrasDe } from '../../functions/src/core/conversacion/normalizacion';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const BANDERA = join(ADMIN, 'scripts', 'plataforma', 'aplicar-consola-conversaciones.mjs');
const RELLENO = join(ADMIN, 'scripts', 'plataforma', 'rellenar-conversaciones.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, FieldValue, FieldPath } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'conversaciones-scripts') ?? initializeApp({ projectId: PROYECTO }, 'conversaciones-scripts');
const db = getFirestore(app);
const relleno = await import('../../scripts/plataforma/rellenar-conversaciones.mjs') as unknown as {
  ejecutar: (cfg: Record<string, unknown>, deps: Record<string, unknown>) => Promise<number>;
};
const bandera = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs') as unknown as {
  ejecutar: (cfg: Record<string, unknown>, deps: Record<string, unknown>) => Promise<number>;
};

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join('/tmp', 'conv-emu-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const rutaRespaldo = () => join(nuevoDir(), 'respaldo.json');

let contador = 0;
const nuevoTenant = (prefijo = 'prueba') => `${prefijo}-${Date.now().toString(36)}-${contador++}`;
const tel = (n: number) => `59172${String(100000 + n).padStart(6, '1')}`.slice(0, 11);
const nombreDe = (n: number) => (n % 5 === 0 ? undefined : `Cliente Muestra ${n}`);

/** Siembra la ficha y `cantidad` conversaciones sintéticas (en lotes de 400) con `ultimoEn` y `etiquetas` propios. */
async function sembrar(tenant: string, cantidad: number, ficha: Record<string, unknown> = { nombre: 'Tienda Sintetica', estado: 'activo' }) {
  await db.doc(`tenants/${tenant}`).set(ficha);
  for (let desde = 1; desde <= cantidad; desde += 400) {
    const lote = db.batch();
    for (let n = desde; n < desde + 400 && n <= cantidad; n++) {
      const nombre = nombreDe(n);
      lote.set(db.doc(`tenants/${tenant}/conversaciones/wa_${tel(n)}`), {
        telefono: tel(n), ...(nombre ? { nombreContacto: nombre } : {}), ultimoEn: 'sintetico', etiquetas: n % 2 ? ['vip'] : [],
      });
    }
    await lote.commit();
  }
}
const leerTodas = async (tenant: string) => {
  const s = await db.collection(`tenants/${tenant}/conversaciones`).get();
  return new Map(s.docs.map((d) => [d.id, { data: d.data(), hora: d.updateTime.toMillis() }]));
};
const hijo = (script: string, args: string[], extra: Record<string, string> = {}, host: string | undefined = HOST) =>
  spawnSync(process.execPath, [script, ...args], { env: entornoDelEmulador(host, extra), encoding: 'utf8' });
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };

// ===========================================================================
describe('A. la bandera consolaConversaciones, como proceso contra el emulador', () => {
  const args = (tenant: string, pantalla: string, extra: string[] = []) => ['--proyecto', PROYECTO, '--tenant', tenant, '--pantalla', pantalla, ...extra];

  it('seco no escribe; aplicar escribe solo el campo; la segunda es idempotente; revertir lo quita', async () => {
    const t = nuevoTenant();
    await db.doc(`tenants/${t}`).set({ nombre: 'Tienda Sintetica', estado: 'activo', plan: 'impulso' });
    const horaInicial = (await db.doc(`tenants/${t}`).get()).updateTime.toMillis();

    const seco = hijo(BANDERA, args(t, 'nueva'));
    expect(seco.status, seco.stdout + seco.stderr).toBe(1);
    expect(seco.stdout).toContain('AUSENTE → nueva');
    expect((await db.doc(`tenants/${t}`).get()).updateTime.toMillis()).toBe(horaInicial);

    const ruta = rutaRespaldo();
    const aplicado = hijo(BANDERA, args(t, 'nueva', ['--aplicar', '--respaldo', ruta]));
    expect(aplicado.status, aplicado.stdout + aplicado.stderr).toBe(0);
    expect((await db.doc(`tenants/${t}`).get()).data()).toEqual({ nombre: 'Tienda Sintetica', estado: 'activo', plan: 'impulso', consolaConversaciones: 'nueva' });
    expect((statSync(ruta).mode & 0o777).toString(8)).toBe('600');
    expect((statSync(dirname(ruta)).mode & 0o777).toString(8)).toBe('700');
    expect(aplicado.stdout + aplicado.stderr).not.toContain(PROYECTO);

    const hora = (await db.doc(`tenants/${t}`).get()).updateTime.toMillis();
    const otra = hijo(BANDERA, args(t, 'nueva', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(otra.status).toBe(0);
    expect(otra.stdout).toContain('nada que hacer');
    expect((await db.doc(`tenants/${t}`).get()).updateTime.toMillis()).toBe(hora);

    const revSeco = hijo(BANDERA, ['--revertir', '--respaldo', ruta, '--tenant', t, '--proyecto', PROYECTO]);
    expect(revSeco.status).toBe(1);
    expect((await db.doc(`tenants/${t}`).get()).data()).toHaveProperty('consolaConversaciones');
    const rev = hijo(BANDERA, ['--revertir', '--respaldo', ruta, '--tenant', t, '--proyecto', PROYECTO, '--aplicar']);
    expect(rev.status, rev.stdout + rev.stderr).toBe(0);
    expect((await db.doc(`tenants/${t}`).get()).data()).toEqual({ nombre: 'Tienda Sintetica', estado: 'activo', plan: 'impulso' });
  });

  it('revertir NO pisa un valor cambiado después', async () => {
    const t = nuevoTenant();
    await db.doc(`tenants/${t}`).set({ nombre: 'Tienda Sintetica' });
    const ruta = rutaRespaldo();
    expect(hijo(BANDERA, args(t, 'nueva', ['--aplicar', '--respaldo', ruta])).status).toBe(0);
    await db.doc(`tenants/${t}`).update({ consolaConversaciones: 'clasica', editadoDespues: 'intacto' });
    const rev = hijo(BANDERA, ['--revertir', '--respaldo', ruta, '--tenant', t, '--proyecto', PROYECTO, '--aplicar']);
    expect(rev.status).toBe(2);
    expect((await db.doc(`tenants/${t}`).get()).data()).toMatchObject({ consolaConversaciones: 'clasica', editadoDespues: 'intacto' });
  });

  it('BELLIDO: el proceso se niega y la ficha queda como estaba (por id y por nombre)', async () => {
    await db.doc('tenants/bellido').set({ nombre: 'Consultorio Sintetico', estado: 'activo' });
    const antes = (await db.doc('tenants/bellido').get()).updateTime.toMillis();
    const r = hijo(BANDERA, args('bellido', 'nueva', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('EXCLUIDO');
    const d = await db.doc('tenants/bellido').get();
    expect(d.updateTime.toMillis()).toBe(antes);
    expect(d.data()).not.toHaveProperty('consolaConversaciones');

    const t = nuevoTenant();
    await db.doc(`tenants/${t}`).set({ nombre: 'Consultorio del Dr. Bellido', estado: 'activo' });
    const porNombre = hijo(BANDERA, args(t, 'nueva', ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(porNombre.status).toBe(2);
    expect(porNombre.stdout).toContain('EXCLUIDO');
    expect((await db.doc(`tenants/${t}`).get()).data()).not.toHaveProperty('consolaConversaciones');
  });

  it('un proyecto real con el emulador heredado se rechaza antes de abrir nada (y no imprime el proyecto)', () => {
    const r = hijo(BANDERA, ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-sintetica', '--pantalla', 'nueva', '--aplicar', '--respaldo', rutaRespaldo()],
      ENV_REAL, undefined);
    // El hijo hereda el emulador (`entornoDelEmulador` lo fija siempre): lo que corta es «hay variables de emulador»;
    // la rama de --confirmo-produccion la cubren las pruebas puras (B1 y R1) con un entorno sin emulador.
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('hay variables de emulador');
    expect(r.stderr + r.stdout).not.toContain('proyecto-ficticio-prod');
  });

  it('la precondición real: si la ficha cambia entre la lectura y la escritura no se escribe (código 9 del servidor)', async () => {
    const t = nuevoTenant();
    await db.doc(`tenants/${t}`).set({ nombre: 'Tienda Sintetica' });
    const doc = db.doc(`tenants/${t}`);
    const dbCarrera = {
      doc: () => ({ update: async (c: object, p: object) => { await doc.update({ cambioAjeno: 1 }); return doc.update(c, p); } }),
      getAll: (...a: unknown[]) => (db.getAll as (...x: unknown[]) => Promise<unknown[]>)(doc, ...a.slice(1)),
    };
    const salida: string[] = [];
    const codigo = await bandera.ejecutar(
      { proyecto: PROYECTO, entorno: 'emulador', tenant: t, pantalla: 'nueva', aplicar: true, revertir: false, respaldo: rutaRespaldo() },
      { db: dbCarrera, FieldValue, log: (x: string) => salida.push(x) },
    );
    expect(codigo, salida.join('\n')).toBe(3);
    expect((await doc.get()).data()).toEqual({ nombre: 'Tienda Sintetica', cambioAjeno: 1 });
  });
});

// ===========================================================================
describe('B. el relleno de conversaciones, como proceso contra el emulador', () => {
  const args = (tenant: string, extra: string[] = []) => ['--proyecto', PROYECTO, '--tenant', tenant, ...extra];
  const esperado = (n: number) => ({
    telefonoTrozos: trozosDeTelefono(tel(n)), ...(nombreDe(n) ? { nombrePalabras: palabrasDe(nombreDe(n), 6) } : {}),
  });

  it('650 conversaciones: seco, aplicar (páginas de 300, lotes de 400), idempotencia y revertir', async () => {
    const t = nuevoTenant();
    await sembrar(t, 650);
    const otro = nuevoTenant();
    await sembrar(otro, 5);
    const antes = await leerTodas(t);
    const antesOtro = await leerTodas(otro);

    // Un mensaje de una conversación: no se toca.
    await db.doc(`tenants/${t}/conversaciones/wa_${tel(1)}/mensajes/m1`).set({ texto: 'hola sintetico', direccion: 'entrante', ts: 1 });
    const msg = (await db.doc(`tenants/${t}/conversaciones/wa_${tel(1)}/mensajes/m1`).get());

    const seco = hijo(RELLENO, args(t));
    expect(seco.status, seco.stdout + seco.stderr).toBe(1);
    expect(seco.stdout).toMatch(/conversaciones leídas\s*: 650\b/);
    expect(seco.stdout).toMatch(/se tocarían \(campos que agregar\)\s*: 650\b/);
    expect(seco.stdout).toContain('solo hallará mensajes NUEVOS');
    expect(seco.stdout).not.toMatch(/[0-9]{8,}/);
    const trasSeco = await leerTodas(t);
    for (const [id, v] of antes) expect(trasSeco.get(id)).toEqual(v); // ni datos ni hora cambiaron

    const ruta = rutaRespaldo();
    const aplicado = hijo(RELLENO, args(t, ['--aplicar', '--respaldo', ruta]));
    expect(aplicado.status, aplicado.stdout + aplicado.stderr).toBe(0);
    expect(aplicado.stdout).toContain('Escritas: 650 · saltadas por precondición (cambiaron durante la corrida): 0 · relectura que no coincide: 0');
    expect((statSync(ruta).mode & 0o777).toString(8)).toBe('600');
    expect((statSync(dirname(ruta)).mode & 0o777).toString(8)).toBe('700');

    const despues = await leerTodas(t);
    expect(despues.size).toBe(650);
    for (let n = 1; n <= 650; n++) {
      const d = despues.get(`wa_${tel(n)}`)!.data;
      const previo = antes.get(`wa_${tel(n)}`)!.data;
      expect(d, `conversación ${n}`).toEqual({ ...previo, ...esperado(n) });
    }
    // Lo ajeno: el otro comercio y los mensajes quedaron intactos.
    const otroDespues = await leerTodas(otro);
    for (const [id, v] of antesOtro) expect(otroDespues.get(id)).toEqual(v);
    const msgDespues = await db.doc(`tenants/${t}/conversaciones/wa_${tel(1)}/mensajes/m1`).get();
    expect(msgDespues.data()).toEqual(msg.data());
    expect(msgDespues.updateTime.toMillis()).toBe(msg.updateTime.toMillis());

    // Idempotente: la segunda corrida no escribe nada ni crea respaldo.
    const horas = new Map([...despues].map(([id, v]) => [id, v.hora]));
    const otraRuta = rutaRespaldo();
    const otra = hijo(RELLENO, args(t, ['--aplicar', '--respaldo', otraRuta]));
    expect(otra.status, otra.stdout + otra.stderr).toBe(0);
    expect(otra.stdout).toContain('nada que hacer');
    expect(() => statSync(otraRuta)).toThrow();
    for (const [id, v] of await leerTodas(t)) expect(v.hora).toBe(horas.get(id));

    // Revertir: lo editado después queda; el resto vuelve a como estaba.
    await db.doc(`tenants/${t}/conversaciones/wa_${tel(7)}`).update({ nombrePalabras: ['reescrito-por-la-ingesta'] });
    await db.doc(`tenants/${t}/conversaciones/wa_${tel(8)}`).update({ etiquetas: ['editada-por-una-persona'] });
    const revSeco = hijo(RELLENO, ['--revertir', '--respaldo', ruta, ...args(t)]);
    expect(revSeco.status, revSeco.stdout + revSeco.stderr).toBe(1);
    expect(revSeco.stdout).toMatch(/campos que cambiaron después \(se conservan\)\s*: 1\b/);
    const rev = hijo(RELLENO, ['--revertir', '--aplicar', '--respaldo', ruta, ...args(t)]);
    expect(rev.status, rev.stdout + rev.stderr).toBe(0);
    expect(rev.stdout).toContain('Revertidas: 650');
    const final = await leerTodas(t);
    for (let n = 1; n <= 650; n++) {
      const previo = antes.get(`wa_${tel(n)}`)!.data;
      const hoy = final.get(`wa_${tel(n)}`)!.data;
      if (n === 7) expect(hoy).toEqual({ ...previo, nombrePalabras: ['reescrito-por-la-ingesta'] });
      else if (n === 8) expect(hoy).toEqual({ ...previo, etiquetas: ['editada-por-una-persona'] });
      else expect(hoy, `conversación ${n}`).toEqual(previo);
    }
    const otraRev = hijo(RELLENO, ['--revertir', '--aplicar', '--respaldo', ruta, ...args(t)]);
    expect(otraRev.status).toBe(0);
    expect(otraRev.stdout).toContain('Nada que revertir');
  }, 120_000);

  it('la precondición REAL: una conversación que cambia entre la lectura y la escritura se salta; las demás se escriben', async () => {
    const t = nuevoTenant();
    await sembrar(t, 12);
    const ruta = rutaRespaldo();
    let hecho = false;
    const dbCarrera = new Proxy(db, {
      get(objetivo, prop) {
        if (prop === 'batch') {
          return () => {
            const lote = objetivo.batch();
            const commit = lote.commit.bind(lote);
            lote.commit = async () => {
              if (!hecho) { hecho = true; await db.doc(`tenants/${t}/conversaciones/wa_${tel(3)}`).update({ ultimoEn: 'llego-un-mensaje' }); }
              return commit();
            };
            return lote;
          };
        }
        const v = Reflect.get(objetivo, prop, objetivo);
        return typeof v === 'function' ? v.bind(objetivo) : v;
      },
    });
    const salida: string[] = [];
    const codigo = await relleno.ejecutar(
      { proyecto: PROYECTO, entorno: 'emulador', tenant: t, aplicar: true, revertir: false, respaldo: ruta },
      { db: dbCarrera, FieldValue, FieldPath, log: (x: string) => salida.push(x) },
    );
    const texto = salida.join('\n');
    expect(codigo, texto).toBe(1);
    expect(texto).toContain('Escritas: 11 · saltadas por precondición (cambiaron durante la corrida): 1');
    const todas = await leerTodas(t);
    expect(todas.get(`wa_${tel(3)}`)!.data).not.toHaveProperty('telefonoTrozos');
    expect(todas.get(`wa_${tel(3)}`)!.data['ultimoEn']).toBe('llego-un-mensaje');
    for (let n = 1; n <= 12; n++) if (n !== 3) expect(todas.get(`wa_${tel(n)}`)!.data).toHaveProperty('telefonoTrozos');
    // Repetir completa lo que faltaba.
    const rep = hijo(RELLENO, ['--proyecto', PROYECTO, '--tenant', t, '--aplicar', '--respaldo', rutaRespaldo()]);
    expect(rep.status, rep.stdout + rep.stderr).toBe(0);
    expect((await leerTodas(t)).get(`wa_${tel(3)}`)!.data).toHaveProperty('telefonoTrozos');
  });

  it('BELLIDO: el proceso se niega con su id y las conversaciones quedan intactas', async () => {
    await sembrar('bellido', 4, { nombre: 'Consultorio Sintetico', estado: 'activo' });
    const antes = await leerTodas('bellido');
    for (const extra of [[], ['--aplicar', '--respaldo', rutaRespaldo()]]) {
      const r = hijo(RELLENO, args('bellido', extra));
      expect(r.status, r.stdout + r.stderr).toBe(2);
      expect(r.stderr).toContain('EXCLUIDO');
    }
    const despues = await leerTodas('bellido');
    for (const [id, v] of antes) expect(despues.get(id)).toEqual(v);
  });

  it('BELLIDO por el nombre de la ficha: se niega aunque el id sea otro', async () => {
    const t = nuevoTenant();
    await sembrar(t, 3, { nombre: 'Consultorio del Dr. Bellido', estado: 'activo' });
    const antes = await leerTodas(t);
    const r = hijo(RELLENO, args(t, ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('EXCLUIDO');
    for (const [id, v] of await leerTodas(t)) expect(v).toEqual(antes.get(id));
  });

  it('un proyecto real con el emulador heredado se rechaza; y un respaldo en ~/ también (aunque se confirme)', () => {
    const t = 'tienda-sintetica';
    const prod = (extra: string[]) => hijo(RELLENO, ['--proyecto', 'proyecto-ficticio-prod', '--tenant', t, ...extra], ENV_REAL, undefined);
    const heredado = prod(['--aplicar', '--respaldo', rutaRespaldo()]);
    expect(heredado.status).toBe(2);
    expect(heredado.stderr).toContain('hay variables de emulador');
    expect(heredado.stderr + heredado.stdout).not.toContain('proyecto-ficticio-prod');
    const enCasa = prod(['--aplicar', '--confirmo-produccion', t, '--respaldo', join(process.env['HOME'] ?? '/home/x', 'respaldo-relleno.json')]);
    expect(enCasa.status).toBe(2);
  });

  it('el respaldo en `~/` se rechaza y no se crea nada', () => {
    const casa = process.env['HOME'] ?? '/home/x';
    const ruta = join(casa, `respaldo-relleno-prueba-${Date.now()}.json`);
    const r = hijo(RELLENO, args(nuevoTenant(), ['--aplicar', '--respaldo', ruta]));
    expect(r.status).toBe(2);
    expect(() => statSync(ruta)).toThrow(); // no se creó nada
  });

  it('un respaldo ya existente no se pisa', async () => {
    const t = nuevoTenant();
    await sembrar(t, 3);
    const ruta = rutaRespaldo();
    writeFileSync(ruta, 'no-tocar', { mode: 0o600 });
    const r = hijo(RELLENO, args(t, ['--aplicar', '--respaldo', ruta]));
    expect(r.status).toBe(2);
    for (const v of (await leerTodas(t)).values()) expect(v.data).not.toHaveProperty('telefonoTrozos');
  });
});
