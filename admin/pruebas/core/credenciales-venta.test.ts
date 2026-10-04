/**
 * `credenciales-cliente.sh --venta` CREA LAS TRES CREDENCIALES DE UN FLUJO DE VENTA MÍNIMA (Q'Taco),
 * NUNCA TOCA UNA EXISTENTE Y NUNCA IMPRIME UN VALOR.
 *
 * Corre el script real contra un n8n de mentira (servidor HTTP local en este mismo proceso, sin red)
 * y un `gcloud` falso en el PATH que devuelve un «secreto» de prueba. El servidor guarda los POST que
 * recibe: así se comprueba qué se crea, con qué datos, y que ningún valor aparece en la salida.
 */
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '..', '..', '..');
const JSON_QTACO = join(REPO, 'Flujos', 'experimental', 'venta-minima', 'venta-minima.qtaco.json');

const GRAPH = "Graph WhatsApp Q'Taco (Bearer)";
const INGESTA = "NovuChat ingesta (Q'Taco)";
const ENVIO = "WhatsApp Q'Taco (envío)";
const SECRETO_FALSO = 'a'.repeat(64);
const TOKEN = 'token-de-prueba-WA-abcdef';
const WABA = 'waba-de-prueba-0123';
const GEMINI = { id: 'G1', name: 'Google Gemini(PaLM) Api account', type: 'googlePalmApi' };

type Cred = { id: string; name: string; type: string };
type Post = { name: string; type: string; data: Record<string, string> };

describe('credenciales-cliente.sh --venta', () => {
  let dir: string; let raiz: string; let servidor: Server; let url: string;
  let lista: Cred[]; let posts: Post[]; let extraSiguiente: { nextCursor?: string };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cred-venta-'));
    raiz = join(dir, 'repo');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos'));
    mkdirSync(join(dir, 'bin'));
    copyFileSync(join(REPO, 'scripts', 'credenciales-cliente.sh'), join(raiz, 'scripts', 'credenciales-cliente.sh'));
    if (existsSync(join(REPO, 'scripts', 'lib'))) cpSync(join(REPO, 'scripts', 'lib'), join(raiz, 'scripts', 'lib'), { recursive: true });
    lista = [GEMINI]; posts = []; extraSiguiente = {};
    servidor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (c) => partes.push(c as Buffer));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET' && req.url?.startsWith('/api/v1/credentials')) {
          res.end(JSON.stringify({ data: lista, ...extraSiguiente }));
        } else if (req.method === 'POST' && req.url === '/api/v1/credentials') {
          const cuerpo = JSON.parse(Buffer.concat(partes).toString('utf8')) as Post;
          posts.push(cuerpo);
          const nueva = { id: `N${posts.length}`, name: cuerpo.name, type: cuerpo.type };
          lista.push(nueva);
          res.end(JSON.stringify(nueva));
        } else { res.statusCode = 404; res.end('{}'); }
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    writeFileSync(join(raiz, '.env.n8n'), `N8N_BASE_URL=${url}\nN8N_API_KEY=clave-n8n-de-prueba\n`, { mode: 0o600 });
    escribirEnvCliente();
    escribirGcloud(SECRETO_FALSO);
    escribirFlujo();
  });
  afterEach(async () => { await new Promise((ok) => servidor.close(ok)); rmSync(dir, { recursive: true, force: true }); });

  function escribirEnvCliente(conWaba = true) {
    writeFileSync(join(raiz, '.env.cliente'), `WA_TOKEN=${TOKEN}\n${conWaba ? `WABA_ID=${WABA}\n` : ''}`, { mode: 0o600 });
  }
  /** Un gcloud falso: registra que lo llamaron (y con qué argumentos) y devuelve el valor tal cual, sin salto de línea. */
  function escribirGcloud(valor: string) {
    writeFileSync(join(dir, 'gcloud.log'), '');
    writeFileSync(join(dir, 'bin', 'gcloud'), `#!/usr/bin/env bash\necho "$@" >> "${join(dir, 'gcloud.log')}"\nprintf '%s' ${JSON.stringify(valor)}\n`);
    chmodSync(join(dir, 'bin', 'gcloud'), 0o755);
  }
  function escribirFlujo(modificar?: (f: { nodes: Array<Record<string, unknown>> }) => void) {
    const f = JSON.parse(readFileSync(JSON_QTACO, 'utf8')) as { nodes: Array<Record<string, unknown>> };
    modificar?.(f);
    writeFileSync(join(raiz, 'Flujos', 'q.local.json'), JSON.stringify(f));
  }
  const llamadasGcloud = () => readFileSync(join(dir, 'gcloud.log'), 'utf8').split('\n').filter(Boolean);
  const flujoEscrito = () => JSON.parse(readFileSync(join(raiz, 'Flujos', 'q.local.json'), 'utf8')) as { nodes: Array<{ name: string; credentials?: Record<string, { id: string; name: string }> }> };

  function correr(args: string[]) {
    return new Promise<{ codigo: number | null; salida: string }>((ok) => {
      const hijo = spawn('bash', ['scripts/credenciales-cliente.sh', '--cliente', "Q'Taco", '--env-cliente', '.env.cliente', '--env-n8n', '.env.n8n',
        '--flujo', 'Flujos/q.local.json', ...args], {
        cwd: raiz,
        env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', BASH_ENV: '', ENV: '' }),
      });
      let salida = '';
      hijo.stdout.on('data', (c) => { salida += String(c); });
      hijo.stderr.on('data', (c) => { salida += String(c); });
      hijo.on('close', (codigo) => ok({ codigo, salida }));
    });
  }
  const VENTA = ['--venta', '--ingesta-secreto', 'INGESTA_CLIENTE04', '--ingesta-version', '1'];
  const sinValores = (salida: string) => {
    expect(salida).not.toContain(TOKEN);
    expect(salida).not.toContain(WABA);
    expect(salida).not.toContain(SECRETO_FALSO);
    expect(salida).not.toContain('clave-n8n-de-prueba');
  };

  it('sin --venta no cambia nada: solo crea la de Graph (y no llama a gcloud)', async () => {
    lista.push({ id: 'I1', name: INGESTA, type: 'httpHeaderAuth' }, { id: 'E1', name: ENVIO, type: 'whatsAppApi' });
    const r = await correr(['--aplicar']);
    expect(r.codigo).toBe(0);
    expect(posts.map((p) => p.name)).toEqual([GRAPH]);
    expect(posts[0].data).toEqual({ name: 'Authorization', value: `Bearer ${TOKEN}` });
    expect(llamadasGcloud()).toEqual([]);
    sinValores(r.salida);
  });

  it('--ingesta-secreto o --ingesta-version sin --venta es un error y no escribe nada', async () => {
    for (const extra of [['--ingesta-secreto', 'INGESTA_CLIENTE04'], ['--ingesta-version', '1']]) {
      const r = await correr(['--aplicar', ...extra]);
      expect(r.codigo).toBe(2);
    }
    expect(posts).toEqual([]);
    expect(llamadasGcloud()).toEqual([]);
  });

  it('--venta en seco: informa las tres que crearía, no toca gcloud, no escribe y no imprime valores', async () => {
    const r = await correr(VENTA);
    expect(r.codigo).toBe(0);
    expect(posts).toEqual([]);
    expect(llamadasGcloud()).toEqual([]);
    expect(r.salida).toContain(GRAPH);
    expect(r.salida).toContain(INGESTA);
    expect(r.salida).toContain(ENVIO);
    expect(r.salida).toContain('se crearía');
    sinValores(r.salida);
  });

  it('--venta --aplicar crea exactamente las tres, con los datos correctos, resuelve el flujo y no imprime ningún valor', async () => {
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).toBe(0);
    expect(llamadasGcloud()).toHaveLength(1);
    expect(llamadasGcloud()[0]).toContain('secrets versions access 1');
    expect(llamadasGcloud()[0]).toContain('--secret=INGESTA_CLIENTE04');
    expect(posts.map((p) => `${p.type}|${p.name}`).sort()).toEqual([
      `httpHeaderAuth|${GRAPH}`, `httpHeaderAuth|${INGESTA}`, `whatsAppApi|${ENVIO}`].sort());
    const porNombre = new Map(posts.map((p) => [p.name, p.data]));
    expect(porNombre.get(GRAPH)).toEqual({ name: 'Authorization', value: `Bearer ${TOKEN}` });
    expect(porNombre.get(INGESTA)).toEqual({ name: 'Authorization', value: `Bearer ${SECRETO_FALSO}` });
    expect(porNombre.get(ENVIO)).toEqual({ accessToken: TOKEN, businessAccountId: WABA });
    sinValores(r.salida);
    // El flujo queda con id en cada credencial (ninguna «por nombre»), y la de ingesta NO es la de Graph.
    const f = flujoEscrito();
    for (const n of f.nodes) for (const c of Object.values(n.credentials ?? {})) expect(c.id, `${n.name}`).not.toBe('');
    const de = (nombre: string) => f.nodes.find((n) => n.name === nombre)!.credentials!;
    expect(de('Traer configuración').httpHeaderAuth.name).toBe(INGESTA);
    expect(de('Enviar a WhatsApp').httpHeaderAuth.name).toBe(GRAPH);
    expect(de('Descargar medio').whatsAppApi.name).toBe(ENVIO);
    expect(de('Extraer').googlePalmApi.id).toBe('G1');
  });

  it('nunca modifica una credencial existente: con las tres ya creadas no hay ningún POST', async () => {
    lista.push({ id: 'X1', name: GRAPH, type: 'httpHeaderAuth' }, { id: 'X2', name: INGESTA, type: 'httpHeaderAuth' }, { id: 'X3', name: ENVIO, type: 'whatsAppApi' });
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).toBe(0);
    expect(posts).toEqual([]);
    expect(r.salida).toContain('no se modifica');
    sinValores(r.salida);
  });

  it('un nombre que ya existe con OTRO tipo es error y no crea nada', async () => {
    lista.push({ id: 'X2', name: INGESTA, type: 'whatsAppApi' });
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(posts).toEqual([]);
    expect(r.salida).toContain('otro tipo');
  });

  it('una credencial repetida con uno de los nombres es error y no crea nada', async () => {
    lista.push({ id: 'X2', name: INGESTA, type: 'httpHeaderAuth' }, { id: 'X3', name: INGESTA, type: 'httpHeaderAuth' });
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(posts).toEqual([]);
  });

  it('si la lista de n8n viene partida (nextCursor), no crea nada', async () => {
    extraSiguiente = { nextCursor: 'siguiente' };
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(posts).toEqual([]);
    expect(r.salida).toContain('nextCursor');
  });

  it('falla sin WABA_ID, con un alias o una versión mal formados, y no escribe nada', async () => {
    escribirEnvCliente(false);
    let r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    escribirEnvCliente(true);
    r = await correr(['--venta', '--ingesta-secreto', 'ingesta_cliente04', '--ingesta-version', '1', '--aplicar']);
    expect(r.codigo).toBe(2);
    r = await correr(['--venta', '--ingesta-secreto', 'INGESTA_CLIENTE04', '--ingesta-version', 'uno', '--aplicar']);
    expect(r.codigo).toBe(2);
    r = await correr(['--venta', '--aplicar']);
    expect(r.codigo).toBe(2);
    expect(posts).toEqual([]);
    expect(llamadasGcloud()).toEqual([]);
  });

  it('un secreto que no son 64 hexadecimales sin salto de línea es error y no crea nada (también 63 + salto, y 64 no hexadecimales)', async () => {
    for (const valor of ['a'.repeat(63), `${'a'.repeat(64)}\n`, 'a'.repeat(65), `${'a'.repeat(63)}\n`, 'z'.repeat(64)]) {
      escribirGcloud(valor);
      const r = await correr([...VENTA, '--aplicar']);
      expect(r.codigo, JSON.stringify(valor.length)).not.toBe(0);
      expect(r.salida).not.toContain('aaaaaaaa');
    }
    expect(posts).toEqual([]);
  });

  it('M1: un nombre de credencial del JSON que no nombra al cliente (la credencial de OTRO cliente) no se crea ni se reutiliza', async () => {
    // Existe «NovuChat ingesta (Bellido)» en la instancia y el JSON (por error de copia) la nombra: no debe reutilizarse.
    lista.push({ id: 'AJENA', name: 'NovuChat ingesta (Bellido)', type: 'httpHeaderAuth' });
    escribirFlujo((f) => {
      for (const n of f.nodes) {
        const c = (n.credentials as Record<string, { name: string }> | undefined)?.httpHeaderAuth;
        if (c && c.name === INGESTA) c.name = 'NovuChat ingesta (Bellido)';
      }
    });
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(posts).toEqual([]);
    expect(r.salida).toContain('no nombra al cliente');
    expect(JSON.stringify(flujoEscrito())).not.toContain('"AJENA"');
    // y lo mismo con el nombre de envío ajeno
    escribirFlujo((f) => {
      for (const n of f.nodes) {
        const c = (n.credentials as Record<string, { name: string }> | undefined)?.whatsAppApi;
        if (c) c.name = 'WhatsApp Bellido (envío)';
      }
    });
    const r2 = await correr([...VENTA, '--aplicar']);
    expect(r2.codigo).not.toBe(0);
    expect(posts).toEqual([]);
  });

  it('L4: si la de Graph ya existe con OTRO tipo, falla antes de crear las otras dos', async () => {
    lista.push({ id: 'G9', name: GRAPH, type: 'whatsAppApi' });
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(posts).toEqual([]);
    expect(r.salida).toContain('otro tipo');
  });

  it('L1: con bash -x se niega a correr con --aplicar (la traza mostraría el secreto) y no llama a gcloud', async () => {
    const r = await new Promise<{ codigo: number | null; salida: string }>((ok) => {
      const hijo = spawn('bash', ['-x', 'scripts/credenciales-cliente.sh', '--cliente', "Q'Taco", '--env-cliente', '.env.cliente', '--env-n8n', '.env.n8n',
        '--flujo', 'Flujos/q.local.json', ...VENTA, '--aplicar'], {
        cwd: raiz,
        env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', BASH_ENV: '', ENV: '' }),
      });
      let salida = '';
      hijo.stdout.on('data', (c) => { salida += String(c); });
      hijo.stderr.on('data', (c) => { salida += String(c); });
      hijo.on('close', (codigo) => ok({ codigo, salida }));
    });
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('No corra este script con -x');
    expect(llamadasGcloud()).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('con dos nombres de ingesta en el flujo (p. ej. --cliente con otra grafía) es error y no crea nada', async () => {
    escribirFlujo((f) => {
      f.nodes.push({ name: 'Nodo extra', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {},
        credentials: { httpHeaderAuth: { id: '', name: 'Otra ingesta' } } });
    });
    const r = await correr([...VENTA, '--aplicar']);
    expect(r.codigo).not.toBe(0);
    expect(posts).toEqual([]);
    expect(r.salida).toContain('UN nombre de ingesta');
  });
});
