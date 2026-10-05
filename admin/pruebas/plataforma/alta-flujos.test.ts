/**
 * H2b-3: la lista de flujos del alta sale del registro, y un flujo desconocido se rechaza.
 *
 * - `alta-comercio.mjs` y `asignar-numero.mjs` rechazan `interno` con código 2, antes de abrir Firebase.
 * - `tenants.ts` (el alta por la consola) deriva `VERTICALES` del registro, y el alta SIGUE escribiendo
 *   `vertical` y `flujos`, NUNCA `modulos` (lo escribe solo la migración, otro PR).
 * - `completar-flujos.mjs` ya crea `config/onboarding` (su `DOCUMENTO` propio no la tenía).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(aqui, '..', '..', 'scripts', 'plataforma');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const correr = (script: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    encoding: 'utf8', env: entornoDelEmulador(HOST), timeout: 60_000,
  });
  return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('alta con un flujo desconocido', () => {
  it('alta-comercio.mjs --flujos interno: rechazada (código 2) y sin abrir Firebase', () => {
    const r = correr('alta-comercio.mjs', '--proyecto', PROYECTO, '--tenant', 'alta-flujos-x', '--nombre', 'X',
      '--admin', 'a@ejemplo.com', '--flujos', 'interno');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('flujo desconocido: interno');
  });

  it('alta-comercio.mjs --flujos agendamiento,interno: rechazada aunque haya uno bueno', () => {
    const r = correr('alta-comercio.mjs', '--proyecto', PROYECTO, '--tenant', 'alta-flujos-x', '--nombre', 'X',
      '--admin', 'a@ejemplo.com', '--flujos', 'agendamiento,interno');
    expect(r.codigo, r.salida).toBe(2);
  });

  it('asignar-numero.mjs --flujo interno: rechazada (código 2)', () => {
    const r = correr('asignar-numero.mjs', '--proyecto', PROYECTO, '--operador', 'o@ejemplo.com', '--tenant', 'alta-flujos-x',
      '--numero', '1000000077', '--waba', '1000000078', '--flujo', 'interno', '--alias', 'cliente01');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('--flujo desconocido: interno');
  });

  it('el alta por la consola (tenants.ts) deriva VERTICALES del registro y no escribe `modulos`', () => {
    const t = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'plataforma', 'tenants.ts'), 'utf8');
    expect(t).toMatch(/const VERTICALES = new Set<string>\(IDS_FLUJOS\);/);
    expect(t).toMatch(/import \{ IDS_FLUJOS \} from '\.\.\/registro\.js';/);
    expect(t).not.toMatch(/new Set\(\[\s*'agendamiento'/);
    // El alta sigue escribiendo vertical y flujos…
    expect(sinComentarios(t)).toMatch(/vertical = flujos\[0\]/);
    expect(sinComentarios(t)).toMatch(/vertical, flujos,/);
    // …y ninguna escritura de `modulos` en el código del archivo.
    expect(sinComentarios(t)).not.toMatch(/\bmodulos\b/);
  });

  it('los scripts de alta no escriben `modulos`', () => {
    for (const s of ['alta-comercio.mjs', 'asignar-numero.mjs', 'completar-flujos.mjs']) {
      expect(sinComentarios(readFileSync(join(SCRIPTS, s), 'utf8')), s).not.toMatch(/\bmodulos\b/);
    }
  });
});

describe('completar-flujos.mjs usa el documento del registro', () => {
  it('crea config/onboarding para un comercio de captación (antes no estaba en su DOCUMENTO)', async () => {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = getApps().find((a) => a.name === 'alta-flujos') ?? initializeApp({ projectId: PROYECTO }, 'alta-flujos');
    const db = getFirestore(app);
    const T = 'alta-flujos-onb';
    await db.recursiveDelete(db.doc(`tenants/${T}`));
    await db.doc(`tenants/${T}`).set({ nombre: 'Captación', estado: 'activo', vertical: 'onboarding' });
    // OJO: el script recorre TODA la colección `tenants` del emulador (no tiene `--tenant` ni seco).
    try {
      const r = correr('completar-flujos.mjs', '--proyecto', PROYECTO);
      expect(r.codigo, r.salida).toBe(0);
      expect((await db.doc(`tenants/${T}/config/onboarding`).get()).exists).toBe(true);
      expect((await db.doc(`tenants/${T}`).get()).get('flujos')).toEqual(['onboarding']);
      // Segunda corrida: `create` no pisa lo que ya existe y el script no falla.
      await db.doc(`tenants/${T}/config/onboarding`).set({ actualizadoPor: 'otro', marca: 'intacta' });
      const r2 = correr('completar-flujos.mjs', '--proyecto', PROYECTO);
      expect(r2.codigo, r2.salida).toBe(0);
      expect((await db.doc(`tenants/${T}/config/onboarding`).get()).get('marca')).toBe('intacta');
    } finally {
      await db.recursiveDelete(db.doc(`tenants/${T}`));
    }
  });
});
