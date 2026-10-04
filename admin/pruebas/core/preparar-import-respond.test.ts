/**
 * `preparar-import.sh` NO CUENTA UN `respondToWebhook` COMO DISPARADOR.
 *
 * El flujo de Q'Taco tiene dos nodos `respondToWebhook` («Aceptar (200)» y «Rechazar (401)») que responden al
 * Webhook que ya recibió. Su tipo contiene «webhook», y la guarda de los disparadores sin ruta propia los contaba
 * como tales y cortaba el import con «hay 2 disparadores sin ruta propia» (04/10/2026). La guarda de verdad (dos
 * disparadores sin `path` no pueden compartir la ruta de Meta) tiene que seguir en pie.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const nodo = (name: string, type: string, parameters: Record<string, unknown> = {}) =>
  ({ name, type, typeVersion: 1, position: [0, 0], parameters });

describe('preparar-import.sh y los respondToWebhook', () => {
  let dir: string; let raiz: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prep-import-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos'));
    copyFileSync(join(REPO, 'scripts', 'preparar-import.sh'), join(raiz, 'scripts', 'preparar-import.sh'));
    writeFileSync(join(raiz, '.env.prueba'), 'N8N_BASE_URL=https://n8n.invalid\n');
    writeFileSync(join(raiz, 'tabla.md'), '| Marcador | Valor |\n|---|---|\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function correr(nodes: unknown[]) {
    writeFileSync(join(raiz, 'Flujos', 'f.json'), JSON.stringify({ name: 'f', nodes, connections: {}, settings: {} }));
    const r = spawnSync('bash', ['scripts/preparar-import.sh', 'Flujos/f.json', '.env.prueba'], {
      cwd: raiz, encoding: 'utf8',
      env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(raiz, 'tabla.md'), BASH_ENV: '', ENV: '' }),
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  }

  it('dos Webhook con ruta propia y dos respondToWebhook sin ruta: sale bien (los respondToWebhook no son disparadores)', () => {
    const r = correr([
      nodo('Entrega', 'n8n-nodes-base.webhook', { path: 'ruta-uno' }),
      nodo('Carrito', 'n8n-nodes-base.webhook', { path: 'ruta-dos' }),
      nodo('Aceptar (200)', 'n8n-nodes-base.respondToWebhook'),
      nodo('Rechazar (401)', 'n8n-nodes-base.respondToWebhook'),
    ]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).not.toContain('sin ruta propia');
    expect(r.salida).toContain('Entrega: conserva su ruta propia');
    expect(r.salida).toContain('Carrito: conserva su ruta propia');
    // los respondToWebhook no reciben webhookId
    const salida = JSON.parse(readFileSync(join(raiz, 'Flujos', 'f.local.json'), 'utf8')) as { nodes: Array<{ name: string; webhookId?: string }> };
    expect(salida.nodes.find((n) => n.name === 'Aceptar (200)')?.webhookId).toBeUndefined();
  });

  it('la guarda sigue en pie: dos disparadores SIN ruta propia siguen cortando el import', () => {
    const r = correr([
      nodo('Uno', 'n8n-nodes-base.webhook'),
      nodo('Dos', 'n8n-nodes-base.webhook'),
      nodo('Aceptar (200)', 'n8n-nodes-base.respondToWebhook'),
    ]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('2 disparadores sin ruta propia');
    expect(r.salida).toContain('Uno, Dos');
    expect(r.salida).not.toContain('Aceptar');
  });
});
