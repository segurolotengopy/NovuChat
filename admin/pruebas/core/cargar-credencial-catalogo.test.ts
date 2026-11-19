/**
 * `scripts/cargar-credencial-catalogo.sh`: crea en n8n, por la API pública, la credencial Header Auth
 * «NovuTienda catálogo (<comercio>)» con un token que llega en un ARCHIVO local de modo 600. Seco por omisión.
 *
 * Se prueba NEGANDO, con un n8n FALSO (servidor HTTP local, en memoria). Sin red ni n8n real.
 *
 * Lo que se cierra:
 *  - mal uso (sin nombre, sin archivo, nombre fuera de la forma, --aplicar sin --confirmo igual): sale 2 y no hay ni una llamada;
 *  - el archivo se valida antes de tocar n8n (modo distinto de 600, enlace, token con espacios, ausente): no hay escrituras;
 *  - el seco solo lee (GET), no escribe y deja el archivo;
 *  - ni el token ni la llave de la API salen por pantalla;
 *  - una credencial ya existente (de cualquier tipo, también en la segunda página): se niega sin escribir y el archivo queda;
 *  - --aplicar crea una sola vez, con el tipo y los campos esperados, y BORRA el archivo (salvo --conservar);
 *  - si la creación falla, sale 3 y el archivo se CONSERVA.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'cargar-credencial-catalogo.sh');

const API_KEY = 'llave-api-de-prueba-xyz';
const TOKEN = 'tok_de_prueba_Zq7Kp2Lm9Xw4Vb8Nc3Rt5Yh1Ug6Jd0Fs'; // no existe; solo ASCII imprimible
const NOMBRE = 'NovuTienda catálogo (Casa Bermejo prueba)';

interface Cred { id: string; name: string; type: string; data?: unknown }
interface Llamada { metodo: string; ruta: string; llave: string | undefined; cuerpo: string }

let dir = '';
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
  dir = mkdtempSync(join(tmpdir(), 'cargar-catalogo-'));
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
  writeFileSync(join(dir, 'env'), `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=${base}\n`);
  envRel = relative(RAIZ, join(dir, 'env'));
  archivo = join(dir, 'token-catalogo');
  writeFileSync(archivo, TOKEN, { mode: 0o600 });
  chmodSync(archivo, 0o600);
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
function sinSecretos(salida: string) {
  expect(salida).not.toContain(TOKEN);
  expect(salida).not.toContain(API_KEY);
}

describe('cargar-credencial-catalogo.sh: mal uso, sale 2 sin tocar nada', () => {
  const casos: Array<[string, () => string[]]> = [
    ['sin --nombre', () => ['--archivo', archivo, '--env', envRel]],
    ['sin --archivo', () => ['--nombre', NOMBRE, '--env', envRel]],
    ['nombre fuera de la forma cerrada', () => ['--nombre', 'Mi credencial', '--archivo', archivo, '--env', envRel]],
    ['nombre con inyección', () => ['--nombre', 'NovuTienda catálogo (a"); x)', '--archivo', archivo, '--env', envRel]],
    ['--aplicar sin --confirmo', () => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, '--aplicar']],
    ['--aplicar con --confirmo distinto', () => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, '--aplicar', '--confirmo', 'NovuTienda catálogo (Otro)']],
    ['opción desconocida', () => ['--nombre', NOMBRE, '--archivo', archivo, '--env', envRel, '--forzar']],
    ['--nombre sin valor', () => ['--nombre']],
  ];
  for (const [que, args] of casos) {
    it(`${que}: sale 2, ninguna llamada y el archivo queda`, async () => {
      const { codigo, salida } = await correr(args());
      expect(codigo).toBe(2);
      expect(llamadas).toEqual([]);
      expect(existsSync(archivo)).toBe(true);
      sinSecretos(salida);
    });
  }
});

describe('cargar-credencial-catalogo.sh: el archivo se valida antes de escribir', () => {
  it('modo distinto de 600: no escribe y el archivo queda', async () => {
    chmodSync(archivo, 0o644);
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
    sinSecretos(salida);
  });
  it('un enlace al archivo se rechaza', async () => {
    const enlace = join(dir, 'enlace');
    symlinkSync(archivo, enlace);
    const { codigo, salida } = await correr(['--nombre', NOMBRE, '--archivo', enlace, '--env', envRel, '--aplicar', '--confirmo', NOMBRE]);
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
    sinSecretos(salida);
  });
  it('un contenido con espacios no es un token: no escribe', async () => {
    writeFileSync(archivo, 'esto no es un token valido', { mode: 0o600 });
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
  });
  it('un archivo demasiado corto no es un token', async () => {
    writeFileSync(archivo, 'abc', { mode: 0o600 });
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
  });
  it('un archivo ausente: sale 1 sin escribir', async () => {
    rmSync(archivo);
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
  });
});

describe('cargar-credencial-catalogo.sh: el seco solo lee', () => {
  it('sale 0, no escribe, deja el archivo y no imprime el token ni la llave', async () => {
    const { codigo, salida } = await correr(buenos());
    expect(codigo).toBe(0);
    expect(llamadas.length).toBeGreaterThan(0);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
    expect(salida).toContain('Diagnóstico solamente');
    sinSecretos(salida);
  });
});

describe('cargar-credencial-catalogo.sh: una credencial ya existente se niega sin escribir', () => {
  it('con el mismo nombre y de otro tipo: sale 1, no escribe y el archivo queda', async () => {
    creds = [{ id: 'x1abcd', name: NOMBRE, type: 'googlePalmApi' }];
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
    expect(salida).toContain('ya hay 1');
    sinSecretos(salida);
  });
  it('con el nombre en la segunda página: también se niega', async () => {
    paginar = true;
    creds = [{ id: 'a1abcd', name: 'otra', type: 'httpHeaderAuth' }, { id: 'b2abcd', name: NOMBRE, type: 'httpHeaderAuth' }];
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
  });
});

describe('cargar-credencial-catalogo.sh --aplicar', () => {
  it('crea una sola vez, con el tipo y los campos esperados, y borra el archivo', async () => {
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(0);
    expect(escrituras()).toHaveLength(1);
    const cuerpo = JSON.parse(escrituras()[0]!.cuerpo) as { name: string; type: string; data: { name: string; value: string } };
    expect(cuerpo.name).toBe(NOMBRE);
    expect(cuerpo.type).toBe('httpHeaderAuth');
    expect(cuerpo.data).toEqual({ name: 'Authorization', value: `Bearer ${TOKEN}` });
    expect(existsSync(archivo)).toBe(false);
    expect(salida).toContain('archivo del token borrado');
    sinSecretos(salida);
  });
  it('con --conservar el archivo queda', async () => {
    const { codigo } = await correr(buenos('--aplicar', '--conservar'));
    expect(codigo).toBe(0);
    expect(escrituras()).toHaveLength(1);
    expect(existsSync(archivo)).toBe(true);
  });
  it('una segunda corrida con el archivo repuesto se niega: no hay segunda escritura', async () => {
    expect((await correr(buenos('--aplicar'))).codigo).toBe(0);
    writeFileSync(archivo, TOKEN, { mode: 0o600 });
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toHaveLength(1);
    expect(existsSync(archivo)).toBe(true);
  });
  it('si la creación falla sale 3 y el archivo se CONSERVA', async () => {
    postFalla = true;
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(3);
    expect(existsSync(archivo)).toBe(true);
    expect(creds).toEqual([]);
    sinSecretos(salida);
  });
  it('una llave de API equivocada: nada se escribe y el archivo queda', async () => {
    writeFileSync(join(dir, 'env'), `N8N_API_KEY=otra\nN8N_BASE_URL=${base}\n`);
    const { codigo } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(existsSync(archivo)).toBe(true);
  });
});

describe('cargar-credencial-catalogo.sh: la creación pudo hacerse pero no se pudo comprobar', () => {
  it('POST bien y la relectura falla: sale 3, dice que pudo crearse y el archivo se CONSERVA', async () => {
    getFallaTrasPost = true;
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(3);
    expect(escrituras()).toHaveLength(1);
    expect(salida).toContain('la credencial pudo crearse: verificar en n8n');
    expect(existsSync(archivo)).toBe(true);
    sinSecretos(salida);
  });
});

describe('cargar-credencial-catalogo.sh: rutas y conexión', () => {
  it('--archivo relativo se resuelve contra el directorio de quien llama, no contra la raíz del repositorio', async () => {
    const { codigo } = await correr(['--nombre', NOMBRE, '--archivo', 'token-catalogo', '--env', join(dir, 'env'), '--aplicar', '--confirmo', NOMBRE], dir);
    expect(codigo).toBe(0);
    expect(escrituras()).toHaveLength(1);
    expect(existsSync(archivo)).toBe(false);
  });
  it('--env con ruta absoluta se acepta', async () => {
    const { codigo } = await correr(['--nombre', NOMBRE, '--archivo', archivo, '--env', join(dir, 'env')]);
    expect(codigo).toBe(0);
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
    expect(existsSync(archivo)).toBe(true);
  });
  it('una dirección de n8n sin https (que no sea local): no se envía la llave', async () => {
    writeFileSync(join(dir, 'env'), `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=http://n8n.ejemplo.invalid\n`);
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(llamadas).toEqual([]);
    expect(salida).toContain('https');
    expect(existsSync(archivo)).toBe(true);
  });
  it('una redirección no se sigue: sale 1, nada se escribe y el archivo queda', async () => {
    redirigir = true;
    const { codigo, salida } = await correr(buenos('--aplicar'));
    expect(codigo).toBe(1);
    expect(escrituras()).toEqual([]);
    expect(llamadas.every((l) => l.ruta === '/api/v1/credentials')).toBe(true);
    expect(existsSync(archivo)).toBe(true);
    sinSecretos(salida);
  });
});
