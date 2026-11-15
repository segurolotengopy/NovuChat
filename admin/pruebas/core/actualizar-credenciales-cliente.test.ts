/**
 * actualizar-credenciales-cliente.sh: sus cerrojos y las dos opciones que se le agregaron el 13/11/2026
 * (número de prueba nuevo del Demo A; se usó contra n8n real).
 *
 *   --sin-disparador      no toca la credencial del Trigger (la app no cambió): no pide WA_APP_SECRET y un
 *                         Trigger compartido no bloquea.
 *   --permitir-inactivos  un flujo AJENO pero INACTIVO que comparte la credencial no bloquea; uno ACTIVO sí.
 *
 * Se lanza el script real contra un n8n FALSO (servidor HTTP local) que anota cada PATCH. Las pruebas se
 * escriben negando: lo que NO debe pasar (escribir una credencial compartida con un flujo activo ajeno,
 * escribir el Trigger con --sin-disparador, escribir sin secreto) es lo que se comprueba.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'actualizar-credenciales-cliente.sh');

type Flujo = { id: string; name: string; active?: boolean; nodes: unknown[] };
const nodo = (nombre: string, tipo: string, id: string, cred: string) => ({
  name: nombre,
  credentials: { [tipo]: { id, name: cred } },
});

let servidor: Server;
let patches: { ruta: string; cuerpo: unknown }[];
let flujos: Flujo[];
let dir: string;
let base: string;

beforeEach(async () => {
  patches = [];
  dir = mkdtempSync(join(tmpdir(), 'cred-'));
  servidor = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => (cuerpo += d));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'PATCH') {
        patches.push({ ruta: req.url ?? '', cuerpo: JSON.parse(cuerpo || '{}') });
        res.end('{}');
      } else if ((req.url ?? '').startsWith('/api/v1/workflows')) {
        res.end(JSON.stringify({ data: flujos }));
      } else {
        res.end('{}');
      }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as { port: number }).port;
  base = `http://127.0.0.1:${puerto}`;
  // Demo A (principal), de él dependen el Trigger y el envío.
  flujos = [];
});
afterEach(async () => {
  await new Promise((ok) => servidor.close(ok));
  rmSync(dir, { recursive: true, force: true });
});

function entorno(secreto: string): string {
  const ruta = join(dir, '.env.demo');
  writeFileSync(
    ruta,
    [
      `N8N_BASE_URL=${base}`,
      'N8N_API_KEY=clave-falsa',
      'WA_APP_ID=APP-PRUEBA',
      `WA_APP_SECRET=${secreto}`,
      'WA_TOKEN=token-falso-de-prueba',
      'WABA_ID=WABA-PRUEBA',
      'N8N_WORKFLOW_ID=A',
      '',
    ].join('\n'),
  );
  return ruta;
}

function correr(args: string[]): Promise<{ codigo: number; salida: string }> {
  return new Promise((ok) => {
    execFile('bash', [SCRIPT, ...args], { env: entornoDelEmulador(undefined) }, (e, out, err) => {
      const codigo = e && typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 0;
      ok({ codigo, salida: out + err });
    });
  });
}

const propio = (): Flujo => ({
  id: 'A',
  name: 'Demo A',
  active: true,
  nodes: [nodo('Trigger', 'whatsAppTriggerApi', 'T1', 'Trigger'), nodo('Envío', 'whatsAppApi', 'E1', 'Envío')],
});
const ajeno = (activo: boolean, tipo = 'whatsAppApi', id = 'E1'): Flujo => ({
  id: 'X',
  name: 'Otro demo',
  active: activo,
  nodes: [nodo('Otro nodo', tipo, id, 'compartida')],
});

describe('el cerrojo de credencial compartida', () => {
  it('con un flujo ACTIVO ajeno no escribe nada (sin opciones)', async () => {
    flujos = [propio(), ajeno(true)];
    const r = await correr(['--env-cliente', entorno('secreto-falso'), '--env-n8n', join(dir, '.env.demo'), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('un flujo INACTIVO ajeno también bloquea si no se pidió --permitir-inactivos', async () => {
    flujos = [propio(), ajeno(false)];
    const r = await correr(['--env-cliente', entorno('secreto-falso'), '--env-n8n', join(dir, '.env.demo'), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('--permitir-inactivos NO levanta el cerrojo si el flujo ajeno está ACTIVO', async () => {
    flujos = [propio(), ajeno(true)];
    const r = await correr([
      '--env-cliente', entorno('secreto-falso'), '--env-n8n', join(dir, '.env.demo'),
      '--permitir-inactivos', '--aplicar',
    ]);
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('--permitir-inactivos con el ajeno INACTIVO: avisa y escribe solo las credenciales del Demo A', async () => {
    flujos = [propio(), ajeno(false)];
    const r = await correr([
      '--env-cliente', entorno('secreto-falso'), '--env-n8n', join(dir, '.env.demo'),
      '--permitir-inactivos', '--sin-disparador', '--aplicar',
    ]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('INACTIVO');
    expect(patches.map((p) => p.ruta)).toEqual(['/api/v1/credentials/E1']);
  });

  it('en seco no escribe nada aunque todo sea válido', async () => {
    flujos = [propio(), ajeno(false)];
    const r = await correr([
      '--env-cliente', entorno('secreto-falso'), '--env-n8n', join(dir, '.env.demo'),
      '--permitir-inactivos', '--sin-disparador',
    ]);
    expect(r.codigo).toBe(0);
    expect(patches).toEqual([]);
  });
});

describe('--permitir-inactivos falla cerrado', () => {
  const args = (secreto: string) => ['--env-cliente', entorno(secreto), '--env-n8n', join(dir, '.env.demo'), '--permitir-inactivos', '--aplicar'];

  it('un ajeno al que la API no le informa «active» NO se da por inactivo', async () => {
    const x = ajeno(false);
    delete x.active;
    flujos = [propio(), x];
    const r = await correr(args('secreto-falso'));
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('con un ajeno inactivo y OTRO ACTIVO sobre la misma credencial, bloquea', async () => {
    flujos = [propio(), ajeno(false), { ...ajeno(true), id: 'Y', name: 'Otro activo' }];
    const r = await correr(args('secreto-falso'));
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('un ajeno inactivo que un flujo llama como subflujo (Execute Workflow) NO cuenta como inactivo', async () => {
    flujos = [
      propio(),
      ajeno(false),
      { id: 'Z', name: 'Llamador activo', active: true, nodes: [{ name: 'Llamar', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: 'X' } } }] },
    ];
    const r = await correr(args('secreto-falso'));
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('sola (sin --sin-disparador) y con secreto, escribe el Trigger y el envío del Demo A', async () => {
    flujos = [propio(), ajeno(false, 'whatsAppApi', 'E1')];
    const r = await correr(args('secreto-falso'));
    expect(r.codigo).toBe(0);
    expect(patches.map((p) => p.ruta).sort()).toEqual(['/api/v1/credentials/E1', '/api/v1/credentials/T1']);
    expect(r.salida).not.toContain('secreto-falso');
  });
});

describe('--sin-disparador', () => {
  it('no toca el Trigger aunque lo comparta un flujo ACTIVO ajeno, y no pide WA_APP_SECRET', async () => {
    flujos = [propio(), ajeno(true, 'whatsAppTriggerApi', 'T1')];
    const r = await correr([
      '--env-cliente', entorno(''), '--env-n8n', join(dir, '.env.demo'),
      '--sin-disparador', '--aplicar',
    ]);
    expect(r.codigo).toBe(0);
    expect(patches.map((p) => p.ruta)).toEqual(['/api/v1/credentials/E1']);
    expect(patches.some((p) => p.ruta.endsWith('/T1'))).toBe(false);
  });

  it('sin la opción, un Trigger compartido con un flujo activo ajeno sigue bloqueando todo', async () => {
    flujos = [propio(), ajeno(true, 'whatsAppTriggerApi', 'T1')];
    const r = await correr(['--env-cliente', entorno('secreto-falso'), '--env-n8n', join(dir, '.env.demo'), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('sin la opción y sin WA_APP_SECRET, --aplicar se niega y no escribe', async () => {
    flujos = [propio()];
    const r = await correr(['--env-cliente', entorno(''), '--env-n8n', join(dir, '.env.demo'), '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(patches).toEqual([]);
  });

  it('el valor que se escribe en el envío es el token y la WABA del .env, y nunca sale por la pantalla', async () => {
    flujos = [propio()];
    const r = await correr([
      '--env-cliente', entorno(''), '--env-n8n', join(dir, '.env.demo'), '--sin-disparador', '--aplicar',
    ]);
    expect(r.codigo).toBe(0);
    expect(patches[0]?.cuerpo).toEqual({
      data: { accessToken: 'token-falso-de-prueba', businessAccountId: 'WABA-PRUEBA' },
      isPartialData: true,
    });
    expect(r.salida).not.toContain('token-falso-de-prueba');
  });
});
