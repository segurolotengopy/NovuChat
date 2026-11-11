/**
 * `scripts/cargar-alerta-n8n.sh`: carga en n8n la credencial Crypto «NovuChat alertas (HMAC)» y el flujo
 * «NovuChat — Error de envío incierto» con la URL de la Function repuesta. Seco por omisión.
 *
 * Con un n8n FALSO local (http en 127.0.0.1, solo para pruebas: ALERTA_PERMITIR_HTTP_LOCAL) y un `gcloud` FALSO delante
 * en el PATH. Sin red, sin nube, sin credenciales reales. Lo que cada grupo cierra:
 *  - uso y salvaguardas (sin --confirmo, dos modos, doble llave del proyecto, --env abierto, xtrace): ni una escritura;
 *  - el valor del secreto viaja por TUBERÍA al cuerpo del POST/PATCH y NO queda en pantalla, argumentos de gcloud, ni
 *    en ningún archivo bajo el directorio de ejecución y el temporal;
 *  - el flujo se crea INACTIVO, con el marcador repuesto solo en el cuerpo enviado y la credencial asignada por id;
 *  - una credencial duplicada, en otro tipo o ausente aborta sin escribir.
 * Valores sintéticos armados en ejecución (la guarda de saneo del repositorio público).
 */
import { spawn } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const PROD = 'prueba-alertas-prd1';
const API_KEY = ['llave', 'api', 'n8n', 'de', 'prueba'].join('-');
const SECRETO = ['secreto', 'hmac', 'de', 'prueba', 'solo', 'esta', 'suite'].join('-');
const URL_FN = 'https://alertaoperativa-prueba-uc.a.run.app';
const NOMBRE_CRED = 'NovuChat alertas (HMAC)';
const NOMBRE_FLUJO = 'NovuChat — Error de envío incierto';

interface Cred { id: string; name: string; type: string; data?: unknown }
interface Flujo { id: string; name: string; active: boolean; [k: string]: unknown }
interface Llamada { metodo: string; ruta: string; cuerpo: string }

let dir: string; let bin: string; let gcloudCfg: string; let runtime: string; let envArchivo: string; let SCRIPT: string;
let servidor: Server;
let creds: Cred[]; let flujos: Flujo[]; let llamadas: Llamada[];
let codigoDeEscritura: number;

const GCLOUD_FALSO = `#!/usr/bin/env bash
E="$FAKE_DIR"
printf '%s\\n' "$*" >> "$E/gcloud-llamadas"
case "$*" in
  *"secrets describe"*) [[ -f "$E/secreto" ]] || { echo "NOT_FOUND ${PROD}" >&2; exit 1; } ;;
  *"secrets versions access latest --secret ALERTAS_HMAC"*) [[ -f "$E/secreto" ]] || { echo "ERROR acceso denegado ${PROD}" >&2; exit 1; }; cat "$E/secreto" ;;
  *"run services describe alertaoperativa --region "*) [[ -f "$E/url" ]] || { echo "ERROR no existe ${PROD}" >&2; exit 1; }; cat "$E/url" ;;
  *) echo "gcloud falso: llamada no prevista" >&2; exit 97 ;;
esac
`;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cargar-alerta-'));
  bin = join(dir, 'bin'); gcloudCfg = join(dir, 'tmp', 'gcloud'); runtime = join(dir, 'run');
  mkdirSync(join(dir, 'tmp')); mkdirSync(bin); mkdirSync(gcloudCfg); mkdirSync(runtime, { mode: 0o700 }); chmodSync(runtime, 0o700);
  mkdirSync(join(dir, 'repo', 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'repo', 'Flujos'), { recursive: true });
  mkdirSync(join(dir, 'repo', 'admin', 'functions', 'src', 'core'), { recursive: true });
  SCRIPT = join(dir, 'repo', 'scripts', 'cargar-alerta-n8n.sh');
  copyFileSync(join(RAIZ, 'scripts', 'cargar-alerta-n8n.sh'), SCRIPT); chmodSync(SCRIPT, 0o755);
  copyFileSync(join(RAIZ, 'Flujos', 'error-envio-incierto.json'), join(dir, 'repo', 'Flujos', 'error-envio-incierto.json'));
  copyFileSync(join(RAIZ, 'admin', 'functions', 'src', 'core', 'region.ts'), join(dir, 'repo', 'admin', 'functions', 'src', 'core', 'region.ts'));
  writeFileSync(join(bin, 'gcloud'), GCLOUD_FALSO); chmodSync(join(bin, 'gcloud'), 0o755);
  writeFileSync(join(gcloudCfg, 'application_default_credentials.json'), JSON.stringify({ type: 'authorized_user', quota_project_id: PROD }));
  writeFileSync(join(dir, 'secreto'), SECRETO);
  writeFileSync(join(dir, 'url'), URL_FN);
  creds = []; flujos = []; llamadas = []; codigoDeEscritura = 200;
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => partes.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString();
      const ruta = (req.url ?? '').split('?')[0] ?? '';
      const metodo = req.method ?? '';
      llamadas.push({ metodo, ruta, cuerpo });
      const responder = (codigo: number, o: unknown) => { res.statusCode = codigo; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.headers['x-n8n-api-key'] !== API_KEY) return responder(401, {});
      if (ruta === '/api/v1/credentials' && metodo === 'GET') return responder(200, { data: creds.map(({ id, name, type }) => ({ id, name, type })) });
      if (ruta === '/api/v1/credentials' && metodo === 'POST') {
        if (codigoDeEscritura >= 400) return responder(codigoDeEscritura, {});
        const c = JSON.parse(cuerpo) as Cred; creds.push({ id: `cred${creds.length}abcd`, name: c.name, type: c.type, data: c.data });
        return responder(200, {});
      }
      const mc = /^\/api\/v1\/credentials\/(\w+)$/.exec(ruta);
      if (mc && metodo === 'PATCH') {
        if (codigoDeEscritura >= 400) return responder(codigoDeEscritura, {});
        const c = creds.find((x) => x.id === mc[1]); if (c) c.data = (JSON.parse(cuerpo) as { data: unknown }).data;
        return responder(200, {});
      }
      if (ruta === '/api/v1/workflows' && metodo === 'GET') return responder(200, { data: flujos.map((w) => ({ id: w.id, name: w.name, active: w.active })) });
      if (ruta === '/api/v1/workflows' && metodo === 'POST') {
        if (codigoDeEscritura >= 400) return responder(codigoDeEscritura, {});
        const w = { ...(JSON.parse(cuerpo) as object), id: `wf${flujos.length}abcd`, active: false } as Flujo; flujos.push(w);
        return responder(200, w);
      }
      const mw = /^\/api\/v1\/workflows\/(\w+)$/.exec(ruta);
      if (mw && metodo === 'GET') { const w = flujos.find((x) => x.id === mw[1]); return w ? responder(200, w) : responder(404, {}); }
      if (mw && metodo === 'PUT') {
        const i = flujos.findIndex((x) => x.id === mw[1]); if (i < 0) return responder(404, {});
        flujos[i] = { ...(JSON.parse(cuerpo) as object), id: mw[1]!, active: flujos[i]!.active } as Flujo;
        return responder(200, flujos[i]);
      }
      return responder(404, {});
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  envArchivo = join(dir, 'tmp', 'env');
  writeFileSync(envArchivo, `N8N_API_KEY=${API_KEY}\nN8N_BASE_URL=http://127.0.0.1:${(servidor.address() as AddressInfo).port}\n`, { mode: 0o600 });
  chmodSync(envArchivo, 0o600);
});
afterEach(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
  rmSync(dir, { recursive: true, force: true });
});

const leer = (n: string): string => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } };
const gcloudLlamadas = (): string[] => leer('gcloud-llamadas').split('\n').filter(Boolean);
const escrituras = (): Llamada[] => llamadas.filter((l) => l.metodo !== 'GET');
const sacar = (...nombres: string[]) => nombres.forEach((n) => rmSync(join(dir, n), { force: true }));

function correr(args: string[], vars: Record<string, string> = {}, bashArgs: string[] = [], cfg = gcloudCfg): Promise<{ codigo: number; salida: string }> {
  return new Promise((ok) => {
    const h = spawn('env', [`CLOUDSDK_CONFIG=${cfg}`, 'bash', ...bashArgs, SCRIPT, ...args], {
      cwd: RAIZ,
      env: entornoDelEmulador(undefined, {
        PATH: `${bin}:/usr/bin:/bin`, FAKE_DIR: dir, GCP_PROJECT_ID_PROD: PROD, GCP_PROJECT_ID_STAGING: '',
        XDG_RUNTIME_DIR: runtime, TMPDIR: join(dir, 'tmp'), ALERTA_PERMITIR_HTTP_LOCAL: '1', ...vars,
      }),
    });
    let salida = '';
    h.stdout.on('data', (d: Buffer) => { salida += d.toString(); });
    h.stderr.on('data', (d: Buffer) => { salida += d.toString(); });
    h.on('close', (c) => {
      // Lo que NUNCA puede salir en pantalla: el valor del secreto, la URL, la clave de la API ni el id del proyecto.
      for (const p of [SECRETO, URL_FN, 'alertaoperativa-prueba', API_KEY, PROD]) expect(salida).not.toContain(p);
      ok({ codigo: c ?? -1, salida });
    });
  });
}
const APLICAR = ['--aplicar', '--confirmo', 'produccion'];
const cred = (extra: Partial<Cred> = {}): Cred => ({ id: 'cred9abcd', name: NOMBRE_CRED, type: 'crypto', ...extra });

const HOST_FN = new URL(URL_FN).hostname;
/** ¿El texto trae una URL https cuyo host sea EXACTAMENTE el de la Function? (se parsea; no se busca por subcadena). */
function citaElHostDeLaFunction(texto: string): boolean {
  return (texto.match(/https?:\/\/[^\s"'<>)\\]+/g) ?? []).some((c) => { try { return new URL(c).hostname === HOST_FN; } catch { return false; } });
}
/** Ningún archivo bajo el directorio de ejecución y el temporal contiene el secreto ni la URL. Cada archivo se abre UNA vez y se lee por descriptor. */
function archivosConSecreto(): string[] {
  const hallados: string[] = [];
  const recorrer = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = join(d, e.name);
      if (e.isDirectory()) { recorrer(r); continue; }
      const fd = openSync(r, 'r');
      try {
        if (!fstatSync(fd).isFile()) continue;
        const t = readFileSync(fd, 'utf8');
        if (t.includes(SECRETO) || citaElHostDeLaFunction(t)) hallados.push(r);
      } finally { closeSync(fd); }
    }
  };
  recorrer(runtime); recorrer(join(dir, 'tmp'));
  return hallados;
}

describe('cargar-alerta-n8n.sh: uso y salvaguardas (ni una escritura)', () => {
  it('--help explica los dos modos y sale 0', async () => {
    const r = await correr(['--help']);
    expect(r.codigo).toBe(0);
    for (const t of ['--credencial', '--flujo', '--aplicar', '--confirmo', 'REEMPLAZAR_URL_ALERTA_OPERATIVA']) expect(r.salida).toContain(t);
  });
  it.each([
    ['sin modo', ['--env']],
    ['dos modos', ['--credencial', '--flujo']],
    ['--aplicar sin --confirmo', ['--credencial', '--aplicar']],
    ['--confirmo de otro entorno', ['--credencial', '--aplicar', '--confirmo', 'staging']],
    ['--confirmo sin --aplicar', ['--flujo', '--confirmo', 'produccion']],
    ['una opción desconocida', ['--credencial', '--todo']],
    ['la opción retirada de nube-alertas', ['--entregar-hmac']],
  ])('%s: sale 2 sin tocar n8n ni gcloud', async (_n, args) => {
    const r = await correr(args);
    expect(r.codigo).toBe(2);
    expect(llamadas).toEqual([]);
    expect(gcloudLlamadas()).toEqual([]);
  });
  it('--aplicar sin GCP_PROJECT_ID_PROD o con otro proyecto: 2; el seco con otro proyecto también', async () => {
    expect((await correr(['--credencial', ...APLICAR], { GCP_PROJECT_ID_PROD: '' })).codigo).toBe(2);
    expect((await correr(['--credencial', ...APLICAR], { GCP_PROJECT_ID_PROD: 'otro-proyecto-xyz' })).codigo).toBe(2);
    expect((await correr(['--credencial'], { GCP_PROJECT_ID_PROD: 'otro-proyecto-xyz' })).codigo).toBe(2);
    expect((await correr(['--credencial'], { GCP_PROJECT_ID_STAGING: PROD })).codigo).toBe(2);
    expect(llamadas).toEqual([]);
    expect(gcloudLlamadas()).toEqual([]);
  });
  it('--env abierto (modo 644) o N8N_BASE_URL http sin la excepción de pruebas: 2 con --aplicar', async () => {
    chmodSync(envArchivo, 0o644);
    expect((await correr(['--credencial', ...APLICAR, '--env', envArchivo])).codigo).toBe(2);
    chmodSync(envArchivo, 0o600);
    expect((await correr(['--credencial', '--env', envArchivo], { ALERTA_PERMITIR_HTTP_LOCAL: '' })).codigo).toBe(2);
    expect(llamadas).toEqual([]);
  });
  it('ALERTA_PERMITIR_HTTP_LOCAL con --aplicar y credenciales de gcloud FUERA del temporal: 2 sin tocar nada; en seco no estorba', async () => {
    const fuera = join(dir, 'gcloud-fuera'); mkdirSync(fuera);
    writeFileSync(join(fuera, 'application_default_credentials.json'), JSON.stringify({ type: 'authorized_user', quota_project_id: PROD }));
    const r = await correr(['--credencial', ...APLICAR, '--env', envArchivo], {}, [], fuera);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('CLOUDSDK_CONFIG');
    expect(llamadas).toEqual([]);
    expect(gcloudLlamadas()).toEqual([]);
    expect((await correr(['--credencial', '--env', envArchivo], {}, [], fuera)).codigo).toBe(1);
  });
  it('con xtrace (bash -x o SHELLOPTS=xtrace) se NIEGA (2) antes de tocar nada', async () => {
    expect((await correr(['--credencial', ...APLICAR, '--env', envArchivo], {}, ['-x'])).codigo).toBe(2);
    expect((await correr(['--credencial', ...APLICAR, '--env', envArchivo], { SHELLOPTS: 'xtrace' })).codigo).toBe(2);
    expect(llamadas).toEqual([]);
    expect(gcloudLlamadas()).toEqual([]);
  });
});

describe('cargar-alerta-n8n.sh --credencial', () => {
  it('seco: solo GET, no lee el valor del secreto; sale 1 si la credencial falta y 0 si existe', async () => {
    const r = await correr(['--credencial', '--env', envArchivo]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('NO existe');
    creds.push(cred());
    expect((await correr(['--credencial', '--env', envArchivo])).codigo).toBe(0);
    expect(escrituras()).toEqual([]);
    expect(gcloudLlamadas().some((l) => l.includes('versions access'))).toBe(false);
  });
  it('--aplicar crea la credencial crypto con el valor por tubería: POST con hmacSecret; nada en pantalla, argumentos ni archivos', async () => {
    const r = await correr(['--credencial', ...APLICAR, '--env', envArchivo]);
    expect(r.codigo, r.salida).toBe(0);
    const w = escrituras();
    expect(w).toHaveLength(1);
    expect(w[0]!.metodo).toBe('POST');
    expect(JSON.parse(w[0]!.cuerpo)).toEqual({ name: NOMBRE_CRED, type: 'crypto', data: { hmacSecret: SECRETO } });
    expect(creds).toHaveLength(1);
    expect(gcloudLlamadas().join('\n')).not.toContain(SECRETO);
    expect(archivosConSecreto()).toEqual([]);
    expect(r.salida).toContain('Relectura');
  });
  it('--aplicar sobre una existente la ACTUALIZA EN EL LUGAR (PATCH por id), sin POST ni DELETE', async () => {
    creds.push(cred());
    const r = await correr(['--credencial', ...APLICAR, '--env', envArchivo]);
    expect(r.codigo, r.salida).toBe(0);
    expect(escrituras().map((l) => `${l.metodo} ${l.ruta}`)).toEqual(['PATCH /api/v1/credentials/cred9abcd']);
    expect(creds).toHaveLength(1);
    expect(creds[0]!.id).toBe('cred9abcd');
    expect(creds[0]!.data).toEqual({ hmacSecret: SECRETO });
    expect(archivosConSecreto()).toEqual([]);
  });
  it('duplicadas, de otro tipo o con nombre equivalente: 2 y NO se escribe', async () => {
    for (const lista of [[cred(), cred({ id: 'cred8abcd' })], [cred({ type: 'httpHeaderAuth' })], [cred({ name: 'NOVUCHAT alertas (HMAC)' })]]) {
      creds = lista; llamadas.length = 0;
      const r = await correr(['--credencial', ...APLICAR, '--env', envArchivo]);
      expect(r.codigo, JSON.stringify(lista)).toBe(2);
      expect(escrituras()).toEqual([]);
    }
  });
  it('un valor sin la forma de la clave, o un gcloud que falla: no se escribe nada en n8n', async () => {
    writeFileSync(join(dir, 'secreto'), 'corto');
    expect((await correr(['--credencial', ...APLICAR, '--env', envArchivo])).codigo).toBe(2);
    writeFileSync(join(dir, 'secreto'), `${SECRETO} con espacios`);
    expect((await correr(['--credencial', ...APLICAR, '--env', envArchivo])).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
    sacar('secreto');
    const r = await correr(['--credencial', ...APLICAR, '--env', envArchivo]);
    expect(r.codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });
  it('el secreto sin crear en Secret Manager: 3 con aviso (primero nube-alertas.sh)', async () => {
    sacar('secreto');
    const r = await correr(['--credencial', '--env', envArchivo]);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('nube-alertas.sh');
    expect(llamadas).toEqual([]);
  });
  it('n8n responde 500 al escribir, o rechaza la clave de la API: 3', async () => {
    codigoDeEscritura = 500;
    expect((await correr(['--credencial', ...APLICAR, '--env', envArchivo])).codigo).toBe(3);
    writeFileSync(envArchivo, readFileSync(envArchivo, 'utf8').replace(API_KEY, 'otra-clave'), { mode: 0o600 });
    expect((await correr(['--credencial', '--env', envArchivo])).codigo).toBe(3);
  });
});

describe('cargar-alerta-n8n.sh --flujo', () => {
  it('seco: resuelve la URL sin mostrarla y solo hace GET; sin la credencial aborta (2)', async () => {
    creds.push(cred());
    const r = await correr(['--flujo', '--env', envArchivo]);
    expect(r.codigo, r.salida).toBe(1); // algo pendiente: el flujo no existe y se crearía
    expect(r.salida).toContain('NO existe, se crea INACTIVO');
    expect(escrituras()).toEqual([]);
    flujos.push({ id: 'wf7abcd', name: NOMBRE_FLUJO, active: false });
    expect((await correr(['--flujo', '--env', envArchivo])).codigo).toBe(0); // ya existe: nada pendiente
    flujos = [];
    creds = [];
    expect((await correr(['--flujo', '--env', envArchivo])).codigo).toBe(2);
    expect(escrituras()).toEqual([]);
  });
  it('--aplicar crea el flujo INACTIVO: marcador repuesto solo en el cuerpo, credencial por id, ningún REEMPLAZAR_', async () => {
    creds.push(cred());
    const r = await correr(['--flujo', ...APLICAR, '--env', envArchivo]);
    expect(r.codigo, r.salida).toBe(0);
    const w = escrituras();
    expect(w.map((l) => `${l.metodo} ${l.ruta}`)).toEqual(['POST /api/v1/workflows']);
    const cuerpo = JSON.parse(w[0]!.cuerpo) as { name: string; nodes: Array<{ name: string; parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }> }>; settings: unknown };
    expect(Object.keys(cuerpo).sort()).toEqual(['connections', 'name', 'nodes', 'settings']);
    expect(cuerpo.name).toBe(NOMBRE_FLUJO);
    expect(cuerpo.nodes).toHaveLength(5);
    expect(String(cuerpo.nodes.find((n) => n.name === 'Armar alerta')!.parameters['jsCode'])).toContain(`const url = '${URL_FN}';`);
    expect(cuerpo.nodes.find((n) => n.name === 'Enviar alerta operativa')!.parameters['url']).toBe('={{ $json.url }}');
    expect(cuerpo.nodes.find((n) => n.name === 'Firmar alerta (HMAC)')!.credentials).toEqual({ crypto: { id: 'cred9abcd', name: NOMBRE_CRED } });
    expect(w[0]!.cuerpo).not.toContain('REEMPLAZAR_');
    expect(flujos[0]!.active).toBe(false);
    expect(archivosConSecreto()).toEqual([]);
    // El JSON versionado sigue con su marcador: la reposición es solo en memoria.
    expect(readFileSync(join(RAIZ, 'Flujos', 'error-envio-incierto.json'), 'utf8')).toContain('REEMPLAZAR_URL_ALERTA_OPERATIVA');
    expect(readFileSync(join(dir, 'repo', 'Flujos', 'error-envio-incierto.json'), 'utf8')).toContain('REEMPLAZAR_URL_ALERTA_OPERATIVA');
    expect(llamadas.some((l) => l.ruta.endsWith('/activate'))).toBe(false);
  });
  it('--aplicar sobre uno existente lo ACTUALIZA (PUT) y no cambia su estado activo', async () => {
    creds.push(cred());
    flujos.push({ id: 'wf7abcd', name: NOMBRE_FLUJO, active: true });
    const r = await correr(['--flujo', ...APLICAR, '--env', envArchivo]);
    expect(r.codigo, r.salida).toBe(0);
    expect(escrituras().map((l) => `${l.metodo} ${l.ruta}`)).toEqual(['PUT /api/v1/workflows/wf7abcd']);
    expect(flujos[0]!.active).toBe(true);
    expect(r.salida).toContain('sigue activo');
  });
  it('credencial duplicada o de otro tipo, o flujo duplicado: 2 y NO se escribe', async () => {
    for (const [cs, fs] of [
      [[cred(), cred({ id: 'cred8abcd' })], []],
      [[cred({ type: 'httpHeaderAuth' })], []],
      [[cred()], [{ id: 'wf1abcd', name: NOMBRE_FLUJO, active: false }, { id: 'wf2abcd', name: NOMBRE_FLUJO, active: false }]],
    ] as Array<[Cred[], Flujo[]]>) {
      creds = cs; flujos = fs; llamadas.length = 0;
      const r = await correr(['--flujo', ...APLICAR, '--env', envArchivo]);
      expect(r.codigo).toBe(2);
      expect(escrituras()).toEqual([]);
    }
  });
  it('una URL con otra forma (http, sin .run.app, con ruta) o sin servicio: no se escribe', async () => {
    creds.push(cred());
    for (const u of ['http://alertaoperativa-prueba.a.run.app', 'https://otro.example.org', `${URL_FN}/ruta`, '']) {
      writeFileSync(join(dir, 'url'), u);
      const r = await correr(['--flujo', ...APLICAR, '--env', envArchivo]);
      expect(r.codigo, u).toBe(2);
    }
    sacar('url');
    expect((await correr(['--flujo', ...APLICAR, '--env', envArchivo])).codigo).toBe(3);
    expect(escrituras()).toEqual([]);
  });
});
