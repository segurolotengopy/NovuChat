// Las salvaguardas de uso de los dos scripts de limpieza de comercio: se rechazan ANTES de tocar Firestore (salida 2).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const dir = join(__dirname, '..', '..', 'scripts', 'plataforma');
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
// Regla #245: el hijo de una suite hereda el emulador, nunca las ADC (pruebas/core/hijos-hermeticos.test.ts).
const correr = (script: string, args: string[]) => spawnSync(process.execPath, [join(dir, script), ...args], { encoding: 'utf8', timeout: 20000, env: entornoDelEmulador(HOST) });

describe('renombrar-comercio.mjs', () => {
  it('rechaza sin proyecto, con nombre corto o con marcas < >', () => {
    expect(correr('renombrar-comercio.mjs', ['--tenant', 'rroca-ruben', '--nombre', 'Nombre válido']).status).toBe(2);
    expect(correr('renombrar-comercio.mjs', ['--proyecto', 'x', '--tenant', 'rroca-ruben', '--nombre', 'ab']).status).toBe(2);
    expect(correr('renombrar-comercio.mjs', ['--proyecto', 'x', '--tenant', 'rroca-ruben', '--nombre', '<b>Hola</b>']).status).toBe(2);
    expect(correr('renombrar-comercio.mjs', ['--proyecto', 'x', '--tenant', 'rroca-ruben', '--nombre', 'Hola‮abc']).status).toBe(2);
  });
  it('--aplicar exige confirmación igual al tenant y respaldo absoluto', () => {
    const base = ['--proyecto', 'x', '--tenant', 'rroca-ruben', '--nombre', 'Nombre válido', '--aplicar'];
    expect(correr('renombrar-comercio.mjs', base).status).toBe(2);
    expect(correr('renombrar-comercio.mjs', [...base, '--confirmo-produccion', 'otro', '--respaldo', '/tmp/no-existe-r.json']).status).toBe(2);
    expect(correr('renombrar-comercio.mjs', [...base, '--confirmo-produccion', 'rroca-ruben', '--respaldo', 'relativo.json']).status).toBe(2);
  });
});

describe('quitar-campanas.mjs', () => {
  it('solo acepta los ids de la lista cerrada y el comercio permitido', () => {
    expect(correr('quitar-campanas.mjs', ['--proyecto', 'x', '--tenant', 'rroca-ruben', '--ids', 'tres-doce-am']).status).toBe(2);
    expect(correr('quitar-campanas.mjs', ['--proyecto', 'x', '--tenant', 'otro-comercio', '--ids', 'que-publicar']).status).toBe(2);
    expect(correr('quitar-campanas.mjs', ['--proyecto', 'x', '--tenant', 'rroca-ruben']).status).toBe(2);
  });
  it('un tenant como __proto__ o constructor sale con 2, no con un error sin controlar', () => {
    expect(correr('quitar-campanas.mjs', ['--proyecto', 'x', '--tenant', '__proto__', '--ids', 'que-publicar']).status).toBe(2);
    expect(correr('quitar-campanas.mjs', ['--proyecto', 'x', '--tenant', 'constructor', '--ids', 'que-publicar']).status).toBe(2);
  });
  it('--aplicar exige confirmación y respaldo', () => {
    const base = ['--proyecto', 'x', '--tenant', 'rroca-ruben', '--ids', 'que-publicar', '--aplicar'];
    expect(correr('quitar-campanas.mjs', base).status).toBe(2);
    expect(correr('quitar-campanas.mjs', [...base, '--confirmo-produccion', 'rroca-ruben']).status).toBe(2);
  });
});
