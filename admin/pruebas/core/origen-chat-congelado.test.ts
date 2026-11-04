/**
 * El origen CONGELADO del núcleo copiado de `chat-novuchat` (estado previo a PR-4c2, commit 1fff3d59) no se desactualiza sin querer:
 * cada archivo coincide con la huella anotada en su LEEME y, si el commit está disponible, con `git show 1fff3d59:<ruta>`.
 * Lo leen `tenants/rroca-antonio/huecos.test.ts` y `tenants/rroca-ruben/armado.test.ts` (sus flujos no adoptan `sesion` en PR-4c2).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ORIGEN = join(AQUI, '../lib/origen-chat-pre-4c2');
const REPO = join(AQUI, '../../..');
const COMMIT = '1fff3d59';
const LEEME = readFileSync(join(ORIGEN, 'LEEME.md'), 'utf8');
const huellas = [...LEEME.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{8}(?:-[0-9a-f]{8}){7})` \|$/gm)].map((m) => [m[1]!, m[2]!.replace(/-/g, '')] as const);
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

describe('origen congelado del chat (previo a PR-4c2)', () => {
  it('el LEEME anota la huella de los 7 archivos y nombra el commit', () => {
    expect(huellas.map(([r]) => r).sort()).toEqual(['flujo.plantilla.json', 'nodos/_comun.js', 'nodos/carga-de-entrada.js', 'nodos/config-del-negocio.js', 'nodos/interpretar-entrada.js', 'nodos/puerta-del-turno.js', 'nodos/resumen-del-turno.js']);
    expect(LEEME).toContain(COMMIT);
  });
  it.each(huellas)('%s coincide con su huella (si alguien lo edita, la prueba lo dice)', (ruta, esperada) => {
    expect(sha(readFileSync(join(ORIGEN, ruta)))).toBe(esperada);
  });
  it('y con el commit 1fff3d59 cuando git lo tiene (en un clon superficial se omite esta comprobación, no las huellas)', () => {
    let tiene = true;
    try { execFileSync('git', ['cat-file', '-e', `${COMMIT}^{commit}`], { cwd: REPO, stdio: 'ignore' }); } catch { tiene = false; }
    if (!tiene) return;
    for (const [ruta] of huellas) {
      const rutaGit = ruta === 'flujo.plantilla.json' ? 'flujo.plantilla.json' : `src/${ruta}`;
      const enGit = execFileSync('git', ['show', `${COMMIT}:Flujos/experimental/chat-novuchat/${rutaGit}`], { cwd: REPO, maxBuffer: 20_000_000 });
      expect(sha(enGit), ruta).toBe(sha(readFileSync(join(ORIGEN, ruta))));
    }
  });
  it('NEGACIÓN: la fuente VIVA del chat ya NO es el origen congelado (PR-4c2 la cambió): por eso las pruebas de Antonio y Rubén leen el congelado', () => {
    const vivo = readFileSync(join(REPO, 'Flujos/experimental/chat-novuchat/src/nodos/registrar-evento.js'), 'utf8');
    expect(vivo).toContain('Comprometer evento');
    expect(readFileSync(join(REPO, 'Flujos/experimental/chat-novuchat/flujo.plantilla.json'), 'utf8')).not.toBe(readFileSync(join(ORIGEN, 'flujo.plantilla.json'), 'utf8'));
  });
});
