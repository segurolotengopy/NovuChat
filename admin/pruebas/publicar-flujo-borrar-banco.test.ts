/**
 * `publicar-flujo.sh --borrar`: borra un flujo TEMPORAL de pruebas sin leerlo (un banco de pruebas puede crecer tanto que leerlo por la API supera los 30 s).
 * Solo vale para un entorno `.env.<nombre>-banco`: nunca el flujo de un cliente ni un demo. Se prueba NEGANDO, sin tocar n8n (el seco no llama a la red).
 */
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(RAIZ, 'scripts/publicar-flujo.sh');
const creados: string[] = [];
afterAll(() => { for (const f of creados) rmSync(f, { force: true }); });

function env(nombre: string, id = 'AbC123xyz'): string {
  const ruta = join(RAIZ, nombre);
  writeFileSync(ruta, `N8N_BASE_URL=http://127.0.0.1:9\nN8N_API_KEY=clave-falsa\nN8N_WORKFLOW_ID=${id}\n`);
  creados.push(ruta);
  return nombre;
}
const correr = (nombre: string, extra: string[] = []) => spawnSync('bash', [SCRIPT, '--env', nombre, '--borrar', ...extra], { encoding: 'utf8', cwd: RAIZ });

describe('publicar-flujo.sh --borrar', () => {
  it('SECO: un entorno de banco dice qué haría y no llama a la red', () => {
    const r = correr(env('.env.prueba-borrar-banco'));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Seco: se desactivaria y borraria/);
  });
  it('NEGADO: el entorno de un cliente (no termina en -banco) no se borra, ni con --aplicar', () => {
    for (const n of ['.env.prueba-borrar-cliente', '.env.prueba-walisuma', '.env.prueba-banco-no']) {
      const r = correr(env(n), ['--aplicar']);
      expect(r.status, n).toBe(2);
      expect(r.stderr).toMatch(/solo vale para un entorno de banco/);
    }
  });
  it('NEGADO: un id de flujo con símbolos no se usa', () => {
    const r = correr(env('.env.prueba-id-malo-banco', 'abc/../x'), ['--aplicar']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/invalido/);
  });
  it('con --aplicar y sin n8n alcanzable, falla sin decir que borró', () => {
    const r = correr(env('.env.prueba-sin-red-banco'), ['--aplicar']);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toMatch(/Flujo del banco borrado/);
  });
});
