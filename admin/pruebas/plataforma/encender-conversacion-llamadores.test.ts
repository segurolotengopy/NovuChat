/**
 * El 5 de `encender-conversacion.mjs` («Retomar pendiente de Meta») no es un fallo, y ningún llamador lo toma por tal.
 * Hallazgo: `alta-comercio.mjs` y `asignar-numero.mjs` solo IMPRIMEN la orden como siguiente paso (no lo lanzan ni lo
 * importan); el único código que lo ejecuta es el envoltorio `scripts/encender-conversacion.sh` (con `exec`: el operador ve el 5).
 * Esta prueba fija eso: si alguien empieza a lanzarlo desde un script, debe leer el código de salida y mapear 5 y 6 a «pendiente».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(__dirname, '../../..');
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8');
const LLAMADORES = ['admin/scripts/plataforma/alta-comercio.mjs', 'admin/scripts/plataforma/asignar-numero.mjs'];

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.git' || n === 'lib') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, acc); else if (/\.(mjs|js|ts|sh|ya?ml)$/.test(n)) acc.push(p);
  }
  return acc;
}

describe('encender-conversacion: el 5 no es fallo para quien lo invoca', () => {
  it.each(LLAMADORES)('%s solo lo nombra en un texto: no lo lanza ni lo importa', (r) => {
    const t = leer(r);
    expect(t).toContain('encender-conversacion.mjs');
    expect(t).not.toMatch(/(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\([^)]*encender-conversacion/s);
    expect(t).not.toMatch(/import[^;\n]*encender-conversacion/);
    expect(t).not.toMatch(/import\(\s*['"][^'"]*encender-conversacion/);
    // la línea que lo menciona es un console.log
    for (const l of t.split('\n').filter((x) => x.includes('encender-conversacion.mjs') && !x.trim().startsWith('*') && !x.trim().startsWith('//'))) {
      expect(l).toMatch(/console\.log/);
    }
  });

  it('contraprueba: solo el envoltorio .sh y el propio script lo ejecutan, y todo llamador que lo lance debe tratar 5 y 6 como pendiente', () => {
    const quienes = [...archivos(join(RAIZ, 'admin/scripts')), ...archivos(join(RAIZ, 'scripts')), ...archivos(join(RAIZ, '.github'))]
      .filter((p) => readFileSync(p, 'utf8').includes('encender-conversacion'))
      .map((p) => p.slice(RAIZ.length + 1)).sort();
    expect(quienes).toEqual([
      'admin/scripts/plataforma/alta-comercio.mjs', 'admin/scripts/plataforma/asignar-numero.mjs',
      'admin/scripts/plataforma/encender-conversacion.mjs', 'scripts/encender-conversacion.sh',
    ]);
    // el envoltorio tiene `set -euo pipefail`, pero termina con `exec`: node reemplaza al shell y su código (el 5 incluido)
    // llega tal cual al operador; no queda ningún paso después que lo tome por fallo
    const sh = leer('scripts/encender-conversacion.sh');
    expect(sh).toMatch(/^set -euo pipefail$/m);
    expect(sh).toMatch(/^exec node /m);
    const lineas = sh.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
    expect(lineas.at(-1)).toMatch(/^exec node /);
    // el script documenta que 5 (y 6) es pendiente de Retomar, no corte
    const s = leer('admin/scripts/plataforma/encender-conversacion.mjs');
    expect(s).toMatch(/termina con salida 5/);
    expect(s).toMatch(/[Pp]endiente, igual que el 5/);
  });
});
