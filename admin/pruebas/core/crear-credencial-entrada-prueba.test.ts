/**
 * `scripts/crear-credencial-entrada-prueba.sh`: crea en n8n, por la API pública, la credencial Header Auth
 * «Entrada de prueba <Comercio>» con una clave ALEATORIA que el propio script genera y guarda en un archivo
 * NUEVO de modo 600. Seco por omisión.
 *
 * Se prueba NEGANDO, con un n8n FALSO (servidor HTTP local, en memoria). Sin red ni n8n real.
 *
 * Lo que se cierra:
 *  - mal uso (sin nombre, sin archivo, nombre fuera de la forma, --aplicar sin --confirmo igual): sale 2 y no hay ni una llamada;
 *  - la carpeta del archivo tiene que ser del usuario y de modo 700 (nunca una carpeta compartida) y no puede ser un enlace;
 *  - un archivo que YA existe no se pisa: ni se genera clave ni se escribe en n8n;
 *  - el seco solo lee (GET), no crea el archivo y no imprime nada secreto;
 *  - la clave NUNCA sale por pantalla (ni la clave ni la llave de la API) y es la misma que se envió a n8n;
 *  - la clave es aleatoria (dos corridas dan claves distintas), de al menos 32 bytes en base64url;
 *  - una credencial ya existente (de cualquier tipo, también en la segunda página): se niega sin escribir y sin generar clave;
 *  - --aplicar crea una sola vez, con el tipo y los campos esperados, y el archivo queda (modo 600);
 *  - si la creación falla o no se puede comprobar, sale 3 y el archivo se CONSERVA.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'crear-credencial-entrada-prueba.sh');

const API_KEY = 'llave-api-de-prueba-xyz';
const NOMBRE = 'Entrada de prueba Casa Bermejo';

interface Cred { id: string; name: string; type: string; data?: { name: string; value: string } }
interface Llamada { metodo: string; ruta: string; llave: string | undefined; cuerpo: string }

let dir = '';
let carpeta = '';
let servidor: Server;
let base = '';
let creds: Cred[] = [];
let llamadas: Llamada[] = [];
let envRel = '';
let archivo = '';
let paginar = false;
let postFalla = false;
let getFallaTrasPost = false;
let redirigir = false;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'entrada-prueba-'));
  carpeta = join(dir, 'clave');
  mkdirSync(carpeta, { mode: 0o700 });
  chmodSync(carpeta, 0o700);
  creds = [];
  llamadas = [];
  paginar = false;
  postFalla = false;
  getFallaTrasPost = false;
  redirigir = false;
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString();
      const ruta = (req.url ?? '').split('?')[0] ?? '';
      const llave = req.headers['x-n8n-api-key'] as string | undefined;
      llamadas.push({ metodo: req.method ?? '', ruta, llave, cuerpo });
      const responder = (codigo: number, o: unknown) => { res.statusCode = codigo; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (redirigir) { res.statusCode = 302; res.setHeader('location', `${base}/otra-parte`); return res.end(); }
      if (llave !== API_KEY) return responder(401, { message: 'unauthorized' });
      if (ruta === '/api/v1/credentials' && req.method === 'GET') {
        if (getFallaTrasPost && llamadas.some((l) => l.metodo === 'POST')) return responder(500, {});
        const todas = creds.map(({ id, name, type }) => ({ id, name, type }));
        if (!paginar) return responder(200, { data: todas });
        const desde = Number(new URL(req.url ?? '', 'http://x').searchParams.get('cursor') ?? '0');
        return responder(200, { data: todas.slice(desde, desde + 1), nextCursor: desde + 1 < todas.length ? String(desde + 1) : null });
      }
      if (ruta === '/api/v1/credentials' && req.method === 'POST') {
        if (postFalla) return responder(500, {});
        const c = JSON.parse(cuerpo) as { name: string; type: string; data: { name: string; value: string } };
        const nueva = { id: `cred${creds.length + 1}abcd`, name: c.name, type: c.type, data: c.data };
        creds.push(nueva);
        return responder(200, { id: nueva.id, name: nueva.name, type: nueva.type });
      }
      return responder(404, {});
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  writeFileSync(join(dir, 'env'), `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=${base}\n`);
  envRel = relative(RAIZ, join(dir, 'env'));
  archivo = join(carpeta, 'clave-entrada-prueba');
});

afterEach(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  rmSync(dir, { recursive: true, force: true });
});

function correr(args: string[], cwd: string = RAIZ): Promise<{ codigo: number; salida: string }> {
  return new Promise((ok) => {
    const h = spawn('bash', [SCRIPT, ...args], { cwd, env: entornoDelEmulador(undefined) });
    let salida = '';
    h.stdout.on('data', (d: Buffer) => { salida += d.toString(); });
    h.stderr.on('data', (d: Buffer) => { salida += d.toString(); });
    h.on('close', (c) => ok({ codigo: c ?? -1, salida }));
  });
}

const buenos = (...mas: string[]) => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, ...mas,
  ...(mas.includes('--aplicar') ? ['--confirmo', NOMBRE] : [])];
const escrituras = () => llamadas.filter((l) => l.metodo !== 'GET');
/** La clave que quedó en el archivo (la prueba la lee; el script nunca la imprime). */
const claveDelArchivo = () => readFileSync(archivo, 'utf8');
function sinSecretos(salida: string) {
  expect(salida).not.toContain(API_KEY);
  if (existsSync(archivo)) expect(salida).not.toContain(claveDelArchivo());
}

describe('crear-credencial-entrada-prueba.sh: mal uso, sale 2 sin tocar nada', () => {
  const casos: Array<[string, () => string[]]> = [
    ['sin --nombre', () => ['--archivo', archivo, '--env', envRel]],
    ['sin --archivo', () => ['--nombre', NOMBRE, '--env', envRel]],
    ['nombre fuera de la forma cerrada', () => ['--nombre', 'Mi credencial', '--archivo', archivo, '--env', envRel]],
    ['nombre con la forma del catálogo', () => ['--nombre', 'NovuTienda catálogo (Casa Bermejo prueba)', '--archivo', archivo, '--env', envRel]],
    ['nombre con inyección', () => ['--nombre', 'Entrada de prueba a"); x', '--archivo', archivo, '--env', envRel]],
    ['--aplicar sin --confirmo', () => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, '--aplicar']],
    ['--aplicar con --confirmo distinto', () => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, '--aplicar', '--confirmo', 'Entrada de prueba Otro']],
    ['opción desconocida', () => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, '--forzar']],
    ['--nombre sin valor', () => ['--nombre']],
  ];
  for (const [que, args] of casos) {
    it(`${que}: sale 2, ninguna llamada y no se crea el archivo`, async () => {
      const { codigo } = await correr(args());
      expect(codigo).toBe(2);
      expect(llamadas).toEqual([]);
      expect(existsSync(archivo)).toBe(false);
    });
  }
});

describe('crear-credencial-entrada-prueba.sh: la carpeta y el archivo se validan antes de escribir', () => {
  it('una carpeta con permisos de grupo u otros (compartida): no genera clave ni escribe', async () => {
    chmodSync(carpeta, 0o755);
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(llamadas).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
  });
  it('una carpeta que es un enlace se rechaza', async () => {
    const enlace = join(dir, 'enlace');
    symlinkSync(carpeta, enlace);
    const { codigo } = await correr(['--nombre', NOMBRE, '--archivo', join(enlace, 'clave'), '--env', envRel, '--aplicar', '--confirmo', NOMBRE]);
    expect(codigo).toBe(1);
    expect(llamadas).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
  });
  it('una carpeta inexistente: sale 1 sin escribir', async () => {
    const { codigo } = await correr(['--nombre', NOMBRE, '--archivo', join(dir, 'no-existe', 'clave'), '--env', envRel, '--aplicar', '--confirmo', NOMBRE]);
    expect(codigo).toBe(1);
    expect(llamadas).toEqual([]);
  });
  it('un archivo que ya existe no se pisa: sale 1, no escribe en n8n y conserva su contenido', async () => {
    writeFileSync(archivo, 'contenido-previo', { mode: 0o600 });
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(claveDelArchivo()).toBe('contenido-previo');
    expect(salida).toContain('ya existe');
  });
  it('un archivo que ya existe también se niega en el seco', async () => {
    writeFileSync(archivo, 'contenido-previo', { mode: 0o600 });
    const { codigo } = await correr(buenos());
    expect(codigo).toBe(1);
    expect(claveDelArchivo()).toBe('contenido-previo');
  });
  it('un enlace colgante como archivo no se sigue: no escribe en n8n', async () => {
    symlinkSync(join(dir, 'destino-ajeno'), archivo);
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(join(dir, 'destino-ajeno'))).toBe(false);
  });
});

describe('crear-credencial-entrada-prueba.sh: el seco solo lee', () => {
  it('sale 0, no escribe en n8n, no crea el archivo y no imprime secretos', async () => {
    const { codigo, salida } = await correr(buenos());
    expect(codigo).toBe(0);
    expect(llamadas.length).toBeGreaterThan(0);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
    expect(salida).toContain('Diagnóstico solamente');
    sinSecretos(salida);
  });
});

describe('crear-credencial-entrada-prueba.sh: una credencial ya existente se niega sin escribir', () => {
  it('con el mismo nombre y de otro tipo: sale 1, no escribe y no genera clave', async () => {
    creds = [{ id: 'x1abcd', name: NOMBRE, type: 'googlePalmApi' }];
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
    expect(salida).toContain('ya hay 1');
  });
  it('con el nombre en la segunda página: también se niega', async () => {
    paginar = true;
    creds = [{ id: 'a1abcd', name: 'otra', type: 'httpHeaderAuth' }, { id: 'b2abcd', name: NOMBRE, type: 'httpHeaderAuth' }];
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
  });
});

describe('crear-credencial-entrada-prueba.sh --aplicar', () => {
  it('crea una sola vez, con el tipo y los campos esperados, y la clave del archivo es la que se envió', async () => {
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(0);
    expect(escrituras()).toHaveLength(1);
    const cuerpo = JSON.parse(escrituras()[0]!.cuerpo) as { name: string; type: string; data: { name: string; value: string } };
    expect(cuerpo.name).toBe(NOMBRE);
    expect(cuerpo.type).toBe('httpHeaderAuth');
    expect(cuerpo.data.name).toBe('Authorization');
    expect(cuerpo.data.value).toBe(`Bearer ${claveDelArchivo()}`);
    expect(existsSync(archivo)).toBe(true);
    expect(statSync(archivo).mode & 0o777).toBe(0o600);
    expect(salida).toContain('El archivo de la clave se conserva');
    sinSecretos(salida);
  });
  it('la clave es aleatoria y de al menos 32 bytes en base64url', async () => {
    expect((await correr(buenos('--aplicar'))).codigo).toBe(0);
    const una = claveDelArchivo();
    expect(una).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect((await correr(['--nombre', 'Entrada de prueba Otro', '--archivo', join(carpeta, 'otra'), '--env', envRel, '--aplicar', '--confirmo', 'Entrada de prueba Otro'])).codigo).toBe(0);
    expect(readFileSync(join(carpeta, 'otra'), 'utf8')).not.toBe(una);
  });
  it('una segunda corrida se niega: no hay segunda escritura ni se pisa la clave', async () => {
    expect((await correr(buenos('--aplicar'))).codigo).toBe(0);
    const clave = claveDelArchivo();
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toHaveLength(1);
    expect(claveDelArchivo()).toBe(clave);
  });
  it('si la creación falla sale 3 y el archivo se CONSERVA', async () => {
    postFalla = true;
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(3);
    expect(existsSync(archivo)).toBe(true);
    expect(creds).toEqual([]);
    sinSecretos(salida);
  });
  it('POST bien y la relectura falla: sale 3, dice que pudo crearse y el archivo se CONSERVA', async () => {
    getFallaTrasPost = true;
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(3);
    expect(escrituras()).toHaveLength(1);
    expect(salida).toContain('la credencial pudo crearse: verificar en n8n');
    expect(existsSync(archivo)).toBe(true);
    sinSecretos(salida);
  });
  it('una llave de API equivocada: no se crea la credencial', async () => {
    writeFileSync(join(dir, 'env'), `N8N_API_KEY=otra\nN8N_BASE_URL=${base}\n`);
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
  });
});

describe('crear-credencial-entrada-prueba.sh: rutas y conexión', () => {
  it('--archivo relativo se resuelve contra el directorio de quien llama', async () => {
    const { codigo } = await correr(['--nombre', NOMBRE, '--archivo', 'clave-entrada-prueba', '--env', join(dir, 'env'), '--aplicar', '--confirmo', NOMBRE], carpeta);
    expect(codigo).toBe(0);
    expect(existsSync(archivo)).toBe(true);
  });
  it('el archivo --env NO se ejecuta: una línea con una orden no corre', async () => {
    const marca = join(dir, 'marca-ejecutada');
    writeFileSync(join(dir, 'env'), `X=$(touch ${marca})\nN8N_API_KEY="${API_KEY}"\nexport N8N_BASE_URL=${base}\n`);
    const { codigo } = await correr(buenos());
    expect(codigo).toBe(0);
    expect(existsSync(marca)).toBe(false);
  });
  it('un env sin la llave: sale 1 sin llamar a n8n', async () => {
    writeFileSync(join(dir, 'env'), `N8N_BASE_URL=${base}\n`);
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(llamadas).toEqual([]);
    expect(existsSync(archivo)).toBe(false);
  });
  it('una dirección de n8n sin https (que no sea local): no se envía la llave', async () => {
    writeFileSync(join(dir, 'env'), `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=http://n8n.ejemplo.invalid\n`);
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(llamadas).toEqual([]);
    expect(salida).toContain('https');
    expect(existsSync(archivo)).toBe(false);
  });
  it('una redirección no se sigue: sale 1, nada se escribe y no se crea el archivo', async () => {
    redirigir = true;
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(llamadas.every((l) => l.ruta === '/api/v1/credentials')).toBe(true);
    expect(existsSync(archivo)).toBe(false);
    sinSecretos(salida);
  });
});
