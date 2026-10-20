/**
 * `scripts/rotar-ingesta.sh crear`: crea en n8n, por la API pública, la credencial Header Auth
 * «NovuChat ingesta (<alias>)» de un cliente real nuevo, seco por omisión.
 *
 * Se prueba NEGANDO, con un n8n FALSO (servidor HTTP local, en memoria) y un `gcloud` FALSO
 * adelante en el PATH que entrega el valor del secreto por stdout. Sin red ni n8n real, sin
 * Secret Manager real.
 *
 * Lo que se cierra:
 *  - mal uso (secreto, nombre, versión malformados; sin --proyecto): sale 2 y no hay ni una llamada;
 *  - el seco solo lee (GET) y nunca escribe;
 *  - ni el valor del secreto, ni la llave de la API, ni el proyecto salen por pantalla;
 *  - el valor no viaja en los argumentos de ningún proceso (gcloud falso lo comprueba);
 *  - una credencial ya existente (de cualquier tipo) o duplicada: se niega sin escribir;
 *  - --aplicar crea una vez, con el tipo y los campos esperados, y es idempotente.
 */
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'rotar-ingesta.sh');

const API_KEY = 'llave-api-de-prueba-xyz';
// 64 hexadecimales de prueba (no existen), sin diez dígitos seguidos.
const VALOR = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const PROYECTO = 'proyecto-consola-de-prueba';
const NOMBRE = 'NovuChat ingesta (Ruben)';
const SECRETO = 'INGESTA_CLIENTE05';

interface Cred { id: string; name: string; type: string; data?: unknown }
interface Llamada { metodo: string; ruta: string; llave: string | undefined; cuerpo: string }

let dir = '';
let servidor: Server;
let base = '';
let creds: Cred[] = [];
let llamadas: Llamada[] = [];
let envRel = '';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rotar-crear-'));
  creds = [];
  llamadas = [];
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString();
      const ruta = (req.url ?? '').split('?')[0] ?? '';
      const llave = req.headers['x-n8n-api-key'] as string | undefined;
      llamadas.push({ metodo: req.method ?? '', ruta, llave, cuerpo });
      const responder = (codigo: number, o: unknown) => { res.statusCode = codigo; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (llave !== API_KEY) return responder(401, { message: 'unauthorized' });
      if (ruta === '/api/v1/credentials' && req.method === 'GET') return responder(200, { data: creds.map(({ id, name, type }) => ({ id, name, type })) });
      if (ruta === '/api/v1/credentials' && req.method === 'POST') {
        const c = JSON.parse(cuerpo) as { name: string; type: string; data: unknown };
        const nueva = { id: `cred${creds.length + 1}abcd`, name: c.name, type: c.type, data: c.data };
        creds.push(nueva);
        return responder(200, { id: nueva.id, name: nueva.name, type: nueva.type });
      }
      return responder(404, {});
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  // gcloud falso: anota sus argumentos y entrega el valor por stdout.
  writeFileSync(join(dir, 'gcloud'), `#!/usr/bin/env bash
echo "$*" >> "${dir}/gcloud-args"
[[ -n "\${FAKE_GCLOUD_FALLA:-}" ]] && { echo "error con proyecto ${PROYECTO}" >&2; exit 1; }
printf '%s' "\${FAKE_VALOR}"
`);
  chmodSync(join(dir, 'gcloud'), 0o755);
  writeFileSync(join(dir, 'env'), `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=${base}\n`);
  envRel = relative(RAIZ, join(dir, 'env'));
});

afterEach(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  rmSync(dir, { recursive: true, force: true });
});

function correr(args: string[], extra: Record<string, string> = {}): Promise<{ codigo: number; salida: string }> {
  return new Promise((ok) => {
    const h = spawn('bash', [SCRIPT, ...args], {
      cwd: RAIZ,
      env: entornoDelEmulador(undefined, { PATH: `${dir}:${process.env.PATH ?? ''}`, FAKE_VALOR: VALOR, ...extra }),
    });
    let salida = '';
    h.stdout.on('data', (d: Buffer) => { salida += d.toString(); });
    h.stderr.on('data', (d: Buffer) => { salida += d.toString(); });
    h.on('close', (c) => ok({ codigo: c ?? -1, salida }));
  });
}

const buenos = (...mas: string[]) => ['crear', '--secreto', SECRETO, '--version', '1', '--credencial', NOMBRE, '--proyecto', PROYECTO, '--env', envRel, ...mas];
const escrituras = () => llamadas.filter((l) => l.metodo !== 'GET');
const argsGcloud = () => (existsSync(join(dir, 'gcloud-args')) ? readFileSync(join(dir, 'gcloud-args'), 'utf8') : '');
function sinSecretos(salida: string) {
  expect(salida).not.toContain(VALOR);
  expect(salida).not.toContain(API_KEY);
  expect(salida).not.toContain(PROYECTO);
}

describe('rotar-ingesta.sh crear: mal uso, sale 2 sin tocar nada', () => {
  const casos: Array<[string, string[]]> = [
    ['sin --proyecto', ['crear', '--secreto', SECRETO, '--version', '1', '--credencial', NOMBRE, '--env', 'x']],
    ['secreto malformado (minúsculas)', ['crear', '--secreto', 'ingesta_cliente05', '--version', '1', '--credencial', NOMBRE, '--proyecto', PROYECTO, '--env', 'x']],
    ['secreto malformado (otro prefijo)', ['crear', '--secreto', 'OTRO_CLIENTE05', '--version', '1', '--credencial', NOMBRE, '--proyecto', PROYECTO, '--env', 'x']],
    ['versión no numérica', ['crear', '--secreto', SECRETO, '--version', 'latest', '--credencial', NOMBRE, '--proyecto', PROYECTO, '--env', 'x']],
    ['sin --credencial', ['crear', '--secreto', SECRETO, '--version', '1', '--proyecto', PROYECTO, '--env', 'x']],
    ['nombre fuera de la forma cerrada', ['crear', '--secreto', SECRETO, '--version', '1', '--credencial', 'Mi credencial', '--proyecto', PROYECTO, '--env', 'x']],
    ['nombre con alias vacío', ['crear', '--secreto', SECRETO, '--version', '1', '--credencial', 'NovuChat ingesta ()', '--proyecto', PROYECTO, '--env', 'x']],
    ['nombre con inyección', ['crear', '--secreto', SECRETO, '--version', '1', '--credencial', 'NovuChat ingesta (a"); x)', '--proyecto', PROYECTO, '--env', 'x']],
  ];
  for (const [que, args] of casos) {
    it(que, async () => {
      const r = await correr(args);
      expect(r.codigo).toBe(2);
      expect(llamadas).toHaveLength(0);
      expect(argsGcloud()).toBe('');
      sinSecretos(r.salida);
    });
  }

  it('el PROYECTO del entorno no reemplaza a --proyecto', async () => {
    const r = await correr(['crear', '--secreto', SECRETO, '--version', '1', '--credencial', NOMBRE, '--env', envRel], { PROYECTO });
    expect(r.codigo).toBe(2);
    expect(llamadas).toHaveLength(0);
  });
});

describe('rotar-ingesta.sh crear: seco por omisión', () => {
  it('comprueba y no escribe; no imprime valor, llave ni proyecto', async () => {
    const r = await correr(buenos());
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('forma esperada');
    expect(r.salida).toContain('httpHeaderAuth');
    expect(r.salida).toContain('Diagnóstico solamente');
    expect(escrituras()).toHaveLength(0);
    expect(creds).toHaveLength(0);
    sinSecretos(r.salida);
  });

  it('el valor nunca viaja en los argumentos de gcloud; el proyecto sí, por --project', async () => {
    await correr(buenos());
    expect(argsGcloud()).not.toContain(VALOR);
    expect(argsGcloud()).toContain(`--project ${PROYECTO}`);
  });

  it('secreto con forma incorrecta (corto): sale 1 sin escribir ni listar', async () => {
    const r = await correr(buenos('--aplicar'), { FAKE_VALOR: 'abc123' });
    expect(r.codigo).toBe(1);
    expect(llamadas).toHaveLength(0);
    sinSecretos(r.salida);
  });

  it('secreto con salto de línea final: sale 1 sin escribir', async () => {
    const r = await correr(buenos('--aplicar'), { FAKE_VALOR: `${VALOR}\n` });
    expect(r.codigo).toBe(1);
    expect(llamadas).toHaveLength(0);
    sinSecretos(r.salida);
  });

  it('gcloud falla: sale 1 sin escribir y sin mostrar el proyecto', async () => {
    const r = await correr(buenos('--aplicar'), { FAKE_GCLOUD_FALLA: '1' });
    expect(r.codigo).toBe(1);
    expect(llamadas).toHaveLength(0);
    sinSecretos(r.salida);
  });

  it('llave de API equivocada: sale 1 sin escribir y sin imprimirla', async () => {
    writeFileSync(join(dir, 'env'), `N8N_API_KEY=otra-llave-mala\nN8N_BASE_URL=${base}\n`);
    const r = await correr(buenos('--aplicar'));
    expect(r.codigo).toBe(1);
    expect(escrituras()).toHaveLength(0);
    expect(r.salida).not.toContain('otra-llave-mala');
    sinSecretos(r.salida);
  });
});

describe('rotar-ingesta.sh crear: ya existe, se niega sin escribir', () => {
  it('ya existe una del mismo nombre y tipo (seco y aplicar)', async () => {
    creds.push({ id: 'c1', name: NOMBRE, type: 'httpHeaderAuth' });
    for (const extra of [[], ['--aplicar']]) {
      const r = await correr(buenos(...extra));
      expect(r.codigo).toBe(1);
      expect(r.salida).toContain('ya hay 1');
      sinSecretos(r.salida);
    }
    expect(escrituras()).toHaveLength(0);
    expect(creds).toHaveLength(1);
  });

  it('ya existe una del mismo nombre pero de OTRO tipo', async () => {
    creds.push({ id: 'c1', name: NOMBRE, type: 'httpBasicAuth' });
    const r = await correr(buenos('--aplicar'));
    expect(r.codigo).toBe(1);
    expect(escrituras()).toHaveLength(0);
  });

  it('duplicadas', async () => {
    creds.push({ id: 'c1', name: NOMBRE, type: 'httpHeaderAuth' }, { id: 'c2', name: NOMBRE, type: 'httpHeaderAuth' });
    const r = await correr(buenos('--aplicar'));
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('ya hay 2');
    expect(escrituras()).toHaveLength(0);
  });

  it('otra credencial con otro nombre no estorba', async () => {
    creds.push({ id: 'c1', name: 'NovuChat ingesta (Otro)', type: 'httpHeaderAuth' });
    const r = await correr(buenos());
    expect(r.codigo).toBe(0);
  });
});

describe('rotar-ingesta.sh crear --aplicar', () => {
  it('crea una vez con el tipo y los campos esperados y no imprime el valor', async () => {
    const r = await correr(buenos('--aplicar'));
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('creada, única y de tipo httpHeaderAuth');
    sinSecretos(r.salida);
    expect(escrituras()).toHaveLength(1);
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({ name: NOMBRE, type: 'httpHeaderAuth', data: { name: 'Authorization', value: `Bearer ${VALOR}` } });
    // Relee por la API después de crear.
    expect(llamadas[llamadas.length - 1]).toMatchObject({ metodo: 'GET', ruta: '/api/v1/credentials' });
  });

  it('es idempotente: la segunda vez se niega y no escribe', async () => {
    expect((await correr(buenos('--aplicar'))).codigo).toBe(0);
    const r = await correr(buenos('--aplicar'));
    expect(r.codigo).toBe(1);
    expect(escrituras()).toHaveLength(1);
    expect(creds).toHaveLength(1);
  });
});
