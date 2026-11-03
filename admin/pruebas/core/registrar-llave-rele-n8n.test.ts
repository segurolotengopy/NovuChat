/**
 * `scripts/registrar-llave-rele-n8n.sh`: registra la llave del relé B9 en la credencial Header Auth
 * «AAB1 envío · <alias>» de n8n. Se prueba NEGANDO, con un n8n FALSO (servidor HTTP local en memoria).
 *
 * Lo que se cierra:
 *  - alias desconocido o mal uso: sale 2 y no hay ni una llamada;
 *  - el seco solo lee (GET): rechaza modo distinto de 600, dos líneas, forma inválida, enlaces;
 *  - duplicados o nombre con otro tipo: se aborta sin escribir;
 *  - la llave de prueba jamás aparece en stdout/stderr, ni en los archivos de respaldo;
 *  - --aplicar actualiza en el lugar (PATCH), relee y borra la entrega; si falla, la conserva;
 *  - solo el alias de ensayo puede crear la credencial.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const SCRIPT = join(RAIZ, 'scripts', 'registrar-llave-rele-n8n.sh');

const API_KEY = 'llave-api-de-prueba-xyz';
// Llave de prueba con la forma aab1e_<wabaId>_<64 hex>, armada sin diez dígitos seguidos.
const WABA = '12345' + 'x'.replace('x', '6789');
const HEX = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const LLAVE = `aab1e_${WABA}_${HEX}`;

interface Cred { id: string; name: string; type: string; data?: unknown }
interface Llamada { metodo: string; ruta: string; cuerpo: string }

let dir = '';
let servidor: Server;
let creds: Cred[] = [];
let llamadas: Llamada[] = [];
let flujos: unknown[] = [];
let patchCodigo = 200;
let postCodigo = 200;
let pagina1 = false;
let alPatch: (() => void) | null = null;
let redirige = false;
let redirigeSoloPatch = false;
let destinoRedireccion = 'http://127.0.0.1:1/otro';
let sinData = false;
let elementosRaros = false;
let envArchivo = '';

/** Servidor falso que solo cuenta las llamadas que recibe (proxy o destino de una redirección). */
async function contador(): Promise<{ srv: Server; url: string; n: () => number }> {
  let n = 0;
  const srv = createServer((_req, res) => { n += 1; res.statusCode = 200; res.end('{}'); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, n: () => n };
}
const cerrar = (s: Server) => new Promise<void>((ok) => s.close(() => ok()));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'llave-rele-'));
  chmodSync(dir, 0o700);
  creds = [{ id: 'cred1abcd', name: 'AAB1 envío · ruben', type: 'httpHeaderAuth' }];
  llamadas = [];
  flujos = [{ name: 'Flujo A', nodes: [{ credentials: { httpHeaderAuth: { id: 'cred1abcd', name: 'x' } } }] }];
  patchCodigo = 200;
  postCodigo = 200;
  pagina1 = false;
  alPatch = null;
  redirige = false;
  redirigeSoloPatch = false;
  destinoRedireccion = 'http://127.0.0.1:1/otro';
  sinData = false;
  elementosRaros = false;
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString();
      const ruta = (req.url ?? '').split('?')[0] ?? '';
      llamadas.push({ metodo: req.method ?? '', ruta, cuerpo });
      const responder = (codigo: number, o: unknown) => { res.statusCode = codigo; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.headers['x-n8n-api-key'] !== API_KEY) return responder(401, {});
      if (redirige || (redirigeSoloPatch && req.method === 'PATCH')) { res.statusCode = 307; res.setHeader('location', destinoRedireccion); return res.end(); }
      if (ruta === '/api/v1/credentials' && req.method === 'GET') {
        if (sinData) return responder(200, {});
        if (elementosRaros) return responder(200, { data: ['x'] });
        const todas = creds.map(({ id, name, type }) => ({ id, name, type }));
        if (!pagina1) return responder(200, { data: todas });
        const desde = Number(new URL(req.url ?? '', 'http://x').searchParams.get('cursor') ?? '0');
        return responder(200, { data: todas.slice(desde, desde + 1), nextCursor: desde + 1 < todas.length ? String(desde + 1) : null });
      }
      if (ruta === '/api/v1/workflows' && req.method === 'GET') return responder(200, { data: flujos });
      if (ruta === '/api/v1/credentials' && req.method === 'POST') {
        if (postCodigo >= 400) return responder(postCodigo, {});
        const c = JSON.parse(cuerpo) as Cred;
        creds.push({ id: `nueva${creds.length}abcd`, name: c.name, type: c.type, data: c.data });
        return responder(postCodigo, {});
      }
      const m = /^\/api\/v1\/credentials\/(\w+)$/.exec(ruta);
      if (m && req.method === 'PATCH') {
        if (alPatch) alPatch();
        if (patchCodigo >= 400) return responder(patchCodigo, {});
        const c = creds.find((x) => x.id === m[1]);
        if (c) c.data = (JSON.parse(cuerpo) as { data: unknown }).data;
        return responder(patchCodigo, {});
      }
      return responder(404, {});
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  envArchivo = join(dir, 'env');
  writeFileSync(envArchivo, `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=${base}\n`, { mode: 0o600 });
});

afterEach(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  rmSync(dir, { recursive: true, force: true });
});

function correr(args: string[], extra: Record<string, string> = {}): Promise<{ codigo: number; salida: string }> {
  return new Promise((ok) => {
    const h = spawn('bash', [SCRIPT, ...args], { cwd: RAIZ, env: entornoDelEmulador(undefined, { XDG_RUNTIME_DIR: dir, TMPDIR: tmpdir(), RELE_PERMITIR_HTTP_LOCAL: '1', ...extra }) });
    let salida = '';
    h.stdout.on('data', (d: Buffer) => { salida += d.toString(); });
    h.stderr.on('data', (d: Buffer) => { salida += d.toString(); });
    h.on('close', (c) => ok({ codigo: c ?? -1, salida }));
  });
}
const entrega = (alias: string, contenido = LLAVE, modo = 0o600) => {
  const ruta = join(dir, `llave-rele-${alias}`);
  writeFileSync(ruta, contenido, { mode: modo });
  chmodSync(ruta, modo);
  return ruta;
};
const seco = (alias = 'ruben') => ['--alias', alias, '--env', envArchivo];
const aplicar = (alias = 'ruben') => [...seco(alias), '--aplicar', '--confirmo', 'produccion'];
const escrituras = () => llamadas.filter((l) => l.metodo !== 'GET');
function limpia(salida: string) {
  expect(salida).not.toContain(LLAVE);
  expect(salida).not.toContain(HEX);
  expect(salida).not.toContain(WABA);
  expect(salida).not.toContain(API_KEY);
}

describe('mal uso: sale 2 sin llamar a n8n', () => {
  const casos: Array<[string, () => string[]]> = [
    ['alias desconocido', () => seco('cliente99')],
    ['alias con mayúsculas', () => seco('Ruben')],
    ['sin alias', () => ['--env', envArchivo]],
    ['aplicar sin --confirmo', () => [...seco(), '--aplicar']],
    ['aplicar con confirmación equivocada', () => [...seco(), '--aplicar', '--confirmo', 'si']],
    ['opción desconocida', () => [...seco(), '--x']],
  ];
  for (const [que, args] of casos) {
    it(que, async () => {
      entrega('ruben');
      const r = await correr(args());
      expect(r.codigo).toBe(2);
      expect(llamadas).toHaveLength(0);
      limpia(r.salida);
    });
  }
});

describe('seco: solo GET, valida la entrega sin mostrarla', () => {
  it('entrega válida: sale 0, no escribe y no muestra la llave', async () => {
    entrega('ruben');
    const r = await correr(seco());
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('citada por 1 flujo');
    expect(escrituras()).toHaveLength(0);
    limpia(r.salida);
  });
  const malas: Array<[string, () => void]> = [
    ['modo distinto de 600', () => { entrega('ruben', LLAVE, 0o644); }],
    ['dos líneas', () => { entrega('ruben', `${LLAVE}\n${LLAVE}\n`); }],
    ['forma inválida', () => { entrega('ruben', `${LLAVE}x`); }],
    ['con espacios', () => { entrega('ruben', `${LLAVE} `); }],
    ['vacía', () => { entrega('ruben', ''); }],
    ['enlace simbólico', () => { const real = join(dir, 'real'); writeFileSync(real, LLAVE, { mode: 0o600 }); symlinkSync(real, join(dir, 'llave-rele-ruben')); }],
    ['ausente', () => undefined],
  ];
  for (const [que, armar] of malas) {
    it(`rechaza entrega ${que}`, async () => {
      armar();
      const r = await correr(seco());
      expect(r.codigo).toBe(1);
      expect(escrituras()).toHaveLength(0);
      limpia(r.salida);
      const ap = await correr(aplicar());
      expect(ap.codigo).toBe(2);
      expect(escrituras()).toHaveLength(0);
      limpia(ap.salida);
    });
  }
  it('duplicados: aborta sin escribir', async () => {
    entrega('ruben');
    creds.push({ id: 'cred2abcd', name: 'AAB1 envío · ruben', type: 'httpHeaderAuth' });
    const r = await correr(aplicar());
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
    expect(existsSync(join(dir, 'llave-rele-ruben'))).toBe(true);
    limpia(r.salida);
  });
  it('nombre con otro tipo: aborta sin escribir', async () => {
    entrega('ruben');
    creds[0]!.type = 'whatsAppApi';
    const r = await correr(aplicar());
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
    expect(existsSync(join(dir, 'llave-rele-ruben'))).toBe(true);
  });
  it('nombre equivalente pero no exacto (normalizado): aborta sin escribir', async () => {
    entrega('ruben');
    creds.push({ id: 'cred3abcd', name: 'aab1 envío · RUBEN', type: 'httpHeaderAuth' });
    const r = await correr(aplicar());
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
  });
  it('credencial inexistente en un alias de cliente: aborta sin crear', async () => {
    entrega('evy');
    const r = await correr(aplicar('evy'));
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
  });
});

describe('salvaguardas de entorno', () => {
  it('--aplicar con .env de modo distinto de 600: sale 2 sin llamadas', async () => {
    entrega('ruben');
    chmodSync(envArchivo, 0o644);
    const r = await correr(aplicar());
    expect(r.codigo).toBe(2);
    expect(llamadas).toHaveLength(0);
  });
  it('XDG_RUNTIME_DIR de modo distinto de 700: sale 2 sin llamadas', async () => {
    entrega('ruben');
    chmodSync(dir, 0o755);
    const r = await correr(seco());
    chmodSync(dir, 0o700);
    expect(r.codigo).toBe(2);
    expect(llamadas).toHaveLength(0);
  });
  it('N8N_BASE_URL sin https (y sin la excepción local): sale 2 sin llamadas', async () => {
    entrega('ruben');
    const r = await correr(seco(), { RELE_PERMITIR_HTTP_LOCAL: '' });
    expect(r.codigo).toBe(2);
    expect(llamadas).toHaveLength(0);
    limpia(r.salida);
  });
  it('no sigue redirecciones en el GET: el segundo servidor recibe 0 llamadas', async () => {
    const otro = await contador();
    try {
      entrega('ruben');
      redirige = true;
      destinoRedireccion = `${otro.url}/api/v1/credentials`;
      const r = await correr(aplicar());
      expect(r.codigo).toBe(3);
      expect(escrituras()).toHaveLength(0);
      expect(otro.n()).toBe(0);
      expect(existsSync(join(dir, 'llave-rele-ruben'))).toBe(true);
      limpia(r.salida);
    } finally { await cerrar(otro.srv); }
  });
  it('no sigue redirecciones en el PATCH: el segundo servidor recibe 0 llamadas y se conserva la entrega', async () => {
    const otro = await contador();
    try {
      const ruta = entrega('ruben');
      redirigeSoloPatch = true;
      destinoRedireccion = `${otro.url}/api/v1/credentials/cred1abcd`;
      const r = await correr(aplicar());
      expect(r.codigo).toBe(3);
      expect(otro.n()).toBe(0);
      expect(existsSync(ruta)).toBe(true);
      limpia(r.salida);
    } finally { await cerrar(otro.srv); }
  });
  it('ignora HTTPS_PROXY/HTTP_PROXY: el proxy falso recibe 0 llamadas', async () => {
    const proxy = await contador();
    try {
      entrega('ruben');
      const r = await correr(aplicar(), { HTTPS_PROXY: proxy.url, HTTP_PROXY: proxy.url, https_proxy: proxy.url, http_proxy: proxy.url, ALL_PROXY: proxy.url });
      expect(r.codigo).toBe(0);
      expect(proxy.n()).toBe(0);
      expect(escrituras()).toHaveLength(1);
      limpia(r.salida);
    } finally { await cerrar(proxy.srv); }
  });
  it('RELE_PERMITIR_HTTP_LOCAL=1 con http:// no local: sale 2 sin llamadas', async () => {
    entrega('ruben');
    writeFileSync(envArchivo, `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=http://10.255.255.1:5678\n`, { mode: 0o600 });
    const r = await correr(aplicar(), { RELE_PERMITIR_HTTP_LOCAL: '1' });
    expect(r.codigo).toBe(2);
    expect(llamadas).toHaveLength(0);
    limpia(r.salida);
  });
  it('RELE_PERMITIR_HTTP_LOCAL=1 con --env fuera del directorio temporal: se ignora y sale 2', async () => {
    entrega('ruben');
    const r = await correr(aplicar(), { TMPDIR: join(dir, 'otro-tmp-que-no-existe') });
    expect(r.codigo).toBe(2);
    expect(llamadas).toHaveLength(0);
    limpia(r.salida);
  });
  it('no se pudo escribir el respaldo: sale 2, no escribe y conserva la entrega', async () => {
    entrega('ruben');
    writeFileSync(join(dir, 'registrar-llave-rele-respaldos'), 'x');
    const r = await correr(aplicar());
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
    expect(existsSync(join(dir, 'llave-rele-ruben'))).toBe(true);
    limpia(r.salida);
  });
});

describe('paginación', () => {
  it('un duplicado en la segunda página se ve', async () => {
    entrega('ruben');
    pagina1 = true;
    creds.push({ id: 'otra1abcd', name: 'Otra', type: 'httpHeaderAuth' }, { id: 'cred2abcd', name: 'AAB1 envío · ruben', type: 'httpHeaderAuth' });
    const r = await correr(aplicar());
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
  });
  it('--aplicar funciona recorriendo páginas', async () => {
    entrega('ruben');
    pagina1 = true;
    creds.unshift({ id: 'otra1abcd', name: 'Otra', type: 'httpHeaderAuth' });
    const r = await correr(aplicar());
    expect(r.codigo).toBe(0);
    expect(escrituras()).toHaveLength(1);
  });
});

describe('--aplicar', () => {
  it('relectura que falla (duplicado tras el PATCH): sale 3 y conserva la entrega', async () => {
    const ruta = entrega('ruben');
    alPatch = () => { creds.push({ id: 'dup1abcd', name: 'AAB1 envío · ruben', type: 'httpHeaderAuth' }); };
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  it('la entrega cambia de archivo antes del borrado: sale 3 y no la borra', async () => {
    const ruta = entrega('ruben');
    alPatch = () => { unlinkSync(ruta); writeFileSync(ruta, LLAVE, { mode: 0o600 }); };
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  it('falla el POST del alias de ensayo: sale 3 y conserva la entrega', async () => {
    const ruta = entrega('ensayo01');
    postCodigo = 500;
    const r = await correr(aplicar('ensayo01'));
    expect(r.codigo).toBe(3);
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  it('actualiza en el lugar, relee, borra la entrega y no muestra la llave', async () => {
    const ruta = entrega('ruben');
    const r = await correr(aplicar());
    expect(r.codigo).toBe(0);
    expect(escrituras()).toHaveLength(1);
    const w = escrituras()[0]!;
    expect(w.metodo).toBe('PATCH');
    expect(w.ruta).toBe('/api/v1/credentials/cred1abcd');
    expect(JSON.parse(w.cuerpo)).toEqual({ data: { name: 'Authorization', value: `Bearer ${LLAVE}` } });
    expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
    expect(existsSync(ruta)).toBe(false);
    limpia(r.salida);
    // El respaldo existe, es de modo 600 y no lleva la llave.
    const rd = join(dir, 'registrar-llave-rele-respaldos');
    const archivos = readdirSync(rd);
    expect(archivos).toHaveLength(1);
    expect(readFileSync(join(rd, archivos[0]!), 'utf8')).not.toContain(HEX);
    expect(statSync(join(rd, archivos[0]!)).mode & 0o777).toBe(0o600);
    expect(statSync(rd).mode & 0o777).toBe(0o700);
  });
  it('401 (clave de API rechazada): sale 3 sin escribir y conserva la entrega', async () => {
    const ruta = entrega('ruben');
    const url = readFileSync(envArchivo, 'utf8').split('N8N_BASE_URL=')[1]!.trim();
    writeFileSync(envArchivo, `N8N_API_KEY=otra-clave\nN8N_BASE_URL=${url}\n`, { mode: 0o600 });
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(escrituras()).toHaveLength(0);
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  it('lista sin `data`: sale 3 sin escribir, sin traceback', async () => {
    const ruta = entrega('ruben');
    sinData = true;
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(escrituras()).toHaveLength(0);
    expect(r.salida).not.toContain('Traceback');
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  it('elementos que no son objetos: sale 3 sin traceback', async () => {
    entrega('ruben');
    elementosRaros = true;
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(escrituras()).toHaveLength(0);
    expect(r.salida).not.toContain('Traceback');
  });
  it('credencial sin id: sale 3 sin escribir y sin traceback', async () => {
    const ruta = entrega('ruben');
    delete (creds[0] as Partial<Cred>).id;
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(escrituras()).toHaveLength(0);
    expect(r.salida).not.toContain('Traceback');
    expect(existsSync(ruta)).toBe(true);
  });
  it('flujo con nodos que no son objetos: sale 3 sin escribir', async () => {
    entrega('ruben');
    flujos = [{ name: 'Raro', nodes: ['x'] }];
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(escrituras()).toHaveLength(0);
    expect(r.salida).not.toContain('Traceback');
  });
  it('ningún flujo cita la credencial: sale 3 sin escribir y conserva la entrega', async () => {
    const ruta = entrega('ruben');
    flujos = [];
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(escrituras()).toHaveLength(0);
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  it('ensayo01 con la credencial existente y sin flujos que la citen: sí actualiza', async () => {
    creds.push({ id: 'ens1abcd', name: 'AAB1 envío · ensayo01', type: 'httpHeaderAuth' });
    flujos = [];
    entrega('ensayo01');
    const r = await correr(aplicar('ensayo01'));
    expect(r.codigo).toBe(0);
    expect(escrituras().map((l) => l.metodo)).toEqual(['PATCH']);
  });
  it('el PATCH acepta 201', async () => {
    const ruta = entrega('ruben');
    patchCodigo = 201;
    const r = await correr(aplicar());
    expect(r.codigo).toBe(0);
    expect(existsSync(ruta)).toBe(false);
  });
  it('el POST del alias de ensayo acepta 201', async () => {
    const ruta = entrega('ensayo01');
    postCodigo = 201;
    const r = await correr(aplicar('ensayo01'));
    expect(r.codigo).toBe(0);
    expect(existsSync(ruta)).toBe(false);
  });
  it('si n8n falla, conserva la entrega', async () => {
    const ruta = entrega('ruben');
    patchCodigo = 500;
    const r = await correr(aplicar());
    expect(r.codigo).toBe(3);
    expect(existsSync(ruta)).toBe(true);
    limpia(r.salida);
  });
  for (const [alias, quien] of [['cliente07', 'Emma'], ['cliente08', 'Evy'], ['qtaco', "Q'Taco"], ['cliente03', 'Bellido']] as const) {
    it(`${alias} (${quien}): seco encuentra la credencial; aplicar hace PATCH en el lugar y borra la entrega`, async () => {
      creds.push({ id: `${alias}abcd`, name: `AAB1 envío · ${alias}`, type: 'httpHeaderAuth' });
      flujos.push({ name: `Flujo ${alias}`, nodes: [{ credentials: { httpHeaderAuth: { id: `${alias}abcd`, name: 'x' } } }] });
      const ruta = entrega(alias);
      const s = await correr(seco(alias));
      expect(s.codigo).toBe(0);
      expect(escrituras()).toHaveLength(0);
      limpia(s.salida);
      const r = await correr(aplicar(alias));
      expect(r.codigo).toBe(0);
      expect(escrituras()).toHaveLength(1);
      const w = escrituras()[0]!;
      expect(w.metodo).toBe('PATCH');
      expect(w.ruta).toBe(`/api/v1/credentials/${alias}abcd`);
      expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
      expect(existsSync(ruta)).toBe(false);
      limpia(r.salida);
    });
    it(`${alias} (${quien}): no puede crear la credencial si falta (sale 2)`, async () => {
      const ruta = entrega(alias);
      const r = await correr(aplicar(alias));
      expect(r.codigo).toBe(2);
      expect(escrituras()).toHaveLength(0);
      expect(existsSync(ruta)).toBe(true);
      limpia(r.salida);
    });
  }
  it('solo el alias de ensayo crea la credencial si falta', async () => {
    const ruta = entrega('ensayo01');
    const r = await correr(aplicar('ensayo01'));
    expect(r.codigo).toBe(0);
    expect(escrituras().map((l) => l.metodo)).toEqual(['POST']);
    expect(creds.some((c) => c.name === 'AAB1 envío · ensayo01' && c.type === 'httpHeaderAuth')).toBe(true);
    expect(existsSync(ruta)).toBe(false);
    limpia(r.salida);
  });
});

