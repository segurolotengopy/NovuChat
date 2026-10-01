/**
 * NINGÚN SCRIPT ESCRIBE EN META CON UNA APP DE WHATSAPP-MODULAR (CLAUDE.md,
 * prohibiciones 5 y 7; revisiones de seguridad de los PR #264 y #265).
 *
 * Todo script que escribe en Graph lo hace con la app o el token que traiga el
 * .env, y el comando no la nombra: el gancho de acciones sensibles no la ve.
 * El candado común (`scripts/lib/apps-ajenas.sh`) corta antes de cada
 * escritura, por huella del id y por el nombre que devuelve Graph, y corta
 * también si no sabe qué app es. Esta suite lo prueba en los once modos que
 * escriben: `webhook-meta.sh --alta-meta/--alta-waba`, `verificar-meta.sh
 * --suscribir/--desuscribir`, `registrar-numero.sh --registrar/--dar-de-baja`,
 * `nombre-visible.sh --pedir`, `crear-plantilla.sh --aplicar`,
 * `enviar-prueba.sh`, `enviar-plantilla.sh` y `subir-qr.sh` (más
 * `plantillas-cliente.sh --crear --aplicar`, que escribe desde python).
 *
 * También prueba que ninguna credencial viaje en los argumentos de curl, donde
 * la ve cualquier usuario de la máquina en `ps` (LOW-B), y, en la fuente, que
 * cada escritura a Graph —en cualquiera de las formas que curl acepta, también
 * partida en varias líneas— tenga el candado antes (LOW-C).
 *
 * Lanza los scripts reales con un `curl` falso adelante en el PATH
 * (`curl-falso-graph.sh`), que contesta lo que la prueba le pide y anota cada
 * llamada. Sin red y sin Meta: además, todo proxy apunta a un puerto muerto,
 * por si algo (el python de plantillas-cliente) intentara salir.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

// El nombre del host de Graph como texto a BUSCAR en el código versionado (no es una URL que se valide).
const DOMINIO_GRAPH = ['graph', 'facebook', 'com'].join('.');
const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '..', '..', '..');
const script = (n: string) => join(REPO, 'scripts', n);
const WEBHOOK_META = script('webhook-meta.sh');
const VERIFICAR_META = script('verificar-meta.sh');
const LIB = script('lib/apps-ajenas.sh');
const ID = '424242';
const WABA = '777777';
const TELEFONO = '5555';
const SECRETO = 'secreto-de-prueba';
const TOKEN = 'token-de-prueba';
const VERIFY = 'verificacion-de-prueba';
const CLAVE_N8N = 'clave-de-prueba';
const PIN = '246813';
const CREDENCIALES = [SECRETO, TOKEN, VERIFY, CLAVE_N8N, PIN];

let dir: string;
let registro: string;
let envN8n: string;
let envCliente: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apps-ajenas-'));
  registro = join(dir, 'curl.log');
  writeFileSync(registro, '');
  copyFileSync(join(AQUI, 'curl-falso-graph.sh'), join(dir, 'curl'));
  chmodSync(join(dir, 'curl'), 0o755);
  envN8n = join(dir, 'env-n8n');
  writeFileSync(envN8n, `N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=${CLAVE_N8N}\n`);
  envCliente = join(dir, 'env-cliente');
  escribirEnv();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function escribirEnv(extra: string[] = []) {
  writeFileSync(envCliente, [
    `WA_APP_ID=${ID}`, `WA_APP_SECRET=${SECRETO}`, `WA_TOKEN=${TOKEN}`, `WABA_ID=${WABA}`,
    `WA_PHONE_ID=${TELEFONO}`, `META_VERIFY_TOKEN=${VERIFY}`, 'WA_TO=12345678', ...extra, '',
  ].join('\n'));
}

type Modo = 'app' | 'token' | 'numero';
interface Caso {
  nombre: string;
  modo: Modo;
  /** El fragmento de la URL de la única escritura. */
  destino: string;
  args: () => string[];
  entrada?: string;
  /** Qué contestar a `subscribed_apps` (verificar-meta decide por eso si escribe). */
  suscritas?: unknown;
}

const CASOS: Caso[] = [
  {
    nombre: 'webhook-meta.sh --alta-meta', modo: 'app', destino: `/${ID}/subscriptions`,
    args: () => [WEBHOOK_META, '--alta-meta', '--webhook-id', 'ruta-de-prueba', '--env-cliente', envCliente, '--env-n8n', envN8n],
  },
  {
    nombre: 'webhook-meta.sh --alta-waba', modo: 'token', destino: `/${WABA}/subscribed_apps`,
    args: () => [WEBHOOK_META, '--alta-waba', '--webhook-id', 'ruta-de-prueba', '--env-cliente', envCliente, '--env-n8n', envN8n],
  },
  {
    // --suscribir escribe si la app NO está suscrita.
    nombre: 'verificar-meta.sh --suscribir', modo: 'token', destino: `/${WABA}/subscribed_apps`,
    args: () => [VERIFICAR_META, '--env', envCliente, '--suscribir'], suscritas: { data: [] },
  },
  {
    // --desuscribir escribe si está, y pide los últimos 4 del App ID (el candado va antes).
    nombre: 'verificar-meta.sh --desuscribir', modo: 'token', destino: `/${WABA}/subscribed_apps`,
    args: () => [VERIFICAR_META, '--env', envCliente, '--desuscribir'], entrada: `${ID.slice(-4)}\n`,
    suscritas: { data: [{ whatsapp_business_api_data: { id: ID } }] },
  },
  {
    nombre: 'registrar-numero.sh --registrar', modo: 'numero', destino: `/${TELEFONO}/register`,
    args: () => [script('registrar-numero.sh'), '--env', envCliente, '--registrar'], entrada: `${PIN}\n`,
  },
  {
    nombre: 'registrar-numero.sh --dar-de-baja', modo: 'numero', destino: `/${TELEFONO}/deregister`,
    args: () => [script('registrar-numero.sh'), '--env', envCliente, '--dar-de-baja'], entrada: `${TELEFONO.slice(-4)}\n`,
  },
  {
    nombre: 'nombre-visible.sh --pedir', modo: 'numero', destino: `/${TELEFONO}`,
    args: () => [script('nombre-visible.sh'), '--env', envCliente, '--pedir', 'Consultorio de Prueba'],
  },
  {
    nombre: 'crear-plantilla.sh --aplicar', modo: 'token', destino: `/${WABA}/message_templates`,
    args: () => [script('crear-plantilla.sh'), '--env', envCliente, '--nombre', 'aviso_de_prueba',
      '--cuerpo', 'Se registró tu pedido en {{1}}. Responde este mensaje si quieres cambiarlo.', '--ejemplos', 'la sucursal', '--aplicar'],
  },
  {
    nombre: 'enviar-prueba.sh', modo: 'numero', destino: `/${TELEFONO}/messages`,
    args: () => [script('enviar-prueba.sh'), '--env', envCliente, 'hola'],
  },
  {
    nombre: 'enviar-plantilla.sh', modo: 'numero', destino: `/${TELEFONO}/messages`,
    args: () => [script('enviar-plantilla.sh'), '--env', envCliente, 'hello_world', 'en_US'],
  },
  {
    nombre: 'subir-qr.sh', modo: 'numero', destino: `/${TELEFONO}/media`,
    args: () => [script('subir-qr.sh'), '--env', envCliente, join(REPO, 'Demo-Recursos', 'qr-demo.png')],
  },
];

/** Lo que Graph contesta del número del entorno: uno de NovuChat. */
const NUMERO_PROPIO = { id: TELEFONO, verified_name: 'Consultorio de Prueba NovuChat' };

// Un proxy muerto: si algo intentara salir a la red, falla en el acto.
const SIN_RED = { HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9',
  http_proxy: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '', no_proxy: '' };

function lanzar(args: string[], respuesta: unknown, opciones: { entrada?: string; suscritas?: unknown; extra?: Record<string, string> } = {}) {
  const r = spawnSync('bash', args, {
    encoding: 'utf8',
    input: opciones.entrada ?? '',
    env: entornoDelEmulador(undefined, {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      BASH_ENV: '',
      ENV: '',
      REGISTRO_CURL: registro,
      RESPUESTA_GRAPH: typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta),
      SUSCRITAS_GRAPH: JSON.stringify(opciones.suscritas ?? { data: [] }),
      RESPUESTA_NUMERO: JSON.stringify(NUMERO_PROPIO),
      NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: '',
      NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA: '',
      NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: '',
      ...SIN_RED,
      ...opciones.extra,
    }),
  });
  const llamadas = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  return {
    codigo: r.status, salida: r.stdout, error: r.stderr, llamadas,
    escrituras: llamadas.filter((l) => l.startsWith('ESCRIBE ')),
  };
}

/** El caso por nombre (para las pruebas que miran uno solo). */
const caso = (nombre: string): Caso => {
  const c = CASOS.find((x) => x.nombre === nombre);
  if (!c) throw new Error(`no hay caso «${nombre}»`);
  return c;
};

/** El cuerpo que curl leyó de un archivo (lo que el curl falso anota entre «»). */
const cuerpoDe = (l = '') => (l.split('«')[1] ?? '').replace(/»$/, '');

const correr = (c: Caso, respuesta: unknown, extra: Record<string, string> = {}) =>
  lanzar(c.args(), respuesta, { entrada: c.entrada, suscritas: c.suscritas, extra });

/** Lo que curl recibió en sus argumentos: lo que se ve en `ps`. */
const argumentos = (l: string) => l.split('‹')[0];

const huella = (s: string) => createHash('sha256').update(s).digest('hex');
const PROPIA = { id: ID, name: 'NovuChat-Asistente' };

describe.each(CASOS)('$nombre', (c) => {
  it.each([
    ['AAB1-WA-Prod'],
    ['Demo SeguroLo Tengo'],
    ['aab1 wa staging'],
    ['DEMO SEGUROLOTENGO (vieja)'],
    ['ＡＡＢ１-WA-Prod'],
    ['Demo Seguro Lo Téngo'],
  ])('corta sin escribir si Graph dice que la app es «%s»', (nombre) => {
    const r = correr(c, { id: ID, name: nombre });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/prohibiciones 5 y 7/);
    expect(r.escrituras).toEqual([]);
  });

  it.each([
    ['un error de Graph', { error: { message: 'Invalid OAuth access token' } }],
    ['un error sin objeto', { error: 'x' }],
    ['una respuesta sin nombre', { id: ID }],
    ['una respuesta sin id (no se sabe de quién es el token)', { name: 'NovuChat-Asistente' }],
    ['una respuesta vacía', ''],
    ['algo que no es JSON', '<html>502</html>'],
    ['una lista en vez de un objeto', [PROPIA]],
  ])('corta sin escribir ante %s: sin saber qué app es, no escribe', (_caso, respuesta) => {
    const r = correr(c, respuesta);
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/No se pudo saber qué app es/);
    expect(r.escrituras).toEqual([]);
  });

  it('corta sin escribir si Graph contesta otra app que la del entorno', () => {
    const r = correr(c, { id: '515151', name: 'NovuChat-Asistente' });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/no de la …4242 del entorno/);
    expect(r.escrituras).toEqual([]);
  });

  it('por huella corta antes de consultar a Graph, aunque Graph diga un nombre propio', () => {
    const r = correr(c, PROPIA, { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: huella(ID) });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/\(huella\).*prohibiciones 5 y 7/);
    expect(r.escrituras).toEqual([]);
    expect(r.llamadas.filter((l) => l.includes('fields=id,name'))).toEqual([]);
  });

  it('con una app propia sigue y escribe una vez, después de consultar el nombre', () => {
    const r = correr(c, PROPIA);
    expect(r.error).not.toMatch(/✗/);
    expect(r.escrituras).toHaveLength(1);
    expect(r.escrituras[0]).toContain(c.destino);
    expect(r.llamadas.findIndex((l) => l.includes('fields=id,name'))).toBeLessThan(r.llamadas.indexOf(r.escrituras[0] ?? ''));
  });

  // No es una barrera contra un .env hostil (puede redefinir python3 o exit):
  // ver el límite honesto en scripts/lib/apps-ajenas.sh.
  it('redefinir la lista o las funciones del candado en el .env hace fallar la carga, sin escribir', () => {
    for (const trampa of ['negar_app_ajena() { :; }', 'curl_token() { :; }', 'APPS_AJENAS_FRAGMENTOS=zzz', 'APPS_AJENAS_HUELLAS=',
      'APPS_AJENAS_NUMEROS_HUELLAS=', 'APPS_AJENAS_WABAS_HUELLAS=', 'waba_ajena() { return 1; }', `APPS_AJENAS_CLASIFICAR='print("propia x")'`, 'huella_en() { return 1; }']) {
      escribirEnv([trampa]);
      const r = correr(c, { id: ID, name: 'AAB1-WA-Prod' });
      expect(r.codigo, trampa).not.toBe(0);
      expect(r.escrituras, trampa).toEqual([]);
    }
  });

  it('un .env que redefine curl_token (para poner el token en los argumentos) no carga, aunque la app sea propia', () => {
    escribirEnv(['curl_token() { command curl -H "Authorization: Bearer $WA_TOKEN" "$@"; }']);
    const r = correr(c, PROPIA);
    expect(r.codigo).not.toBe(0);
    expect(r.llamadas).toEqual([]);
  });

  it('un .env que exporta PYTHONPATH no le cambia el json al clasificador (python3 -I)', () => {
    // Un json.py propio que diría «propia» para cualquier respuesta.
    const py = mkdtempSync(join(dir, 'py-'));
    writeFileSync(join(py, 'json.py'), `def loads(s):\n    return {"id": "${ID}", "name": "NovuChat-Asistente", "verified_name": "Consultorio"}\n`);
    escribirEnv([`PYTHONPATH=${py}`]);
    const r = correr(c, { id: ID, name: 'AAB1-WA-Prod' });
    // Algunos scripts caen antes, en su propio python: lo que importa es que no escriban.
    expect(r.codigo).not.toBe(0);
    expect(r.escrituras).toEqual([]);
  });

  it('corta sin escribir si WA_GRAPH_VERSION no tiene forma de versión', () => {
    escribirEnv(['WA_GRAPH_VERSION=v26.0/../otra']);
    const r = correr(c, PROPIA);
    expect(r.codigo).toBe(3);
    expect(r.escrituras).toEqual([]);
  });

  it('corta sin escribir si el .env no trae WA_APP_ID', () => {
    escribirEnv(['WA_APP_ID=']);
    const r = correr(c, PROPIA);
    expect(r.codigo).not.toBe(0);
    expect(r.escrituras).toEqual([]);
  });

  if (c.modo !== 'app') {
    const variable = c.modo === 'token' ? 'WABA_ID' : 'WA_PHONE_ID';
    it(`corta sin escribir si ${variable} no tiene forma de id (va en la ruta de la URL)`, () => {
      escribirEnv([`${variable}=5555/../6666`]);
      const r = correr(c, PROPIA);
      expect(r.codigo).toBe(3);
      expect(r.error).toMatch(new RegExp(`${variable} no tiene forma de id`));
      expect(r.escrituras).toEqual([]);
    });

    if (c.modo === 'token') {
      // El LOW de la tercera revisión del #277: una app propia no alcanza si la
      // WABA de destino es de WhatsApp-Modular (el .env copiado por error).
      it('por huella de la WABA corta antes de tocar la red, aunque la app sea propia', () => {
        const r = correr(c, PROPIA, { NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: huella(WABA).replace(/(.{8})(?!$)/g, '$1:') });
        expect(r.codigo).toBe(3);
        expect(r.error).toMatch(/WABA …7777 es de WhatsApp-Modular \(huella\).*prohibiciones 5 y 7/);
        expect(r.escrituras).toEqual([]);
        // El candado no pregunta nada a Graph (verificar-meta hace antes sus lecturas de siempre).
        expect(r.llamadas.filter((l) => l.includes('fields=id,'))).toEqual([]);
      });

      it('una huella de WABA que no es la del entorno no corta (la lista no confunde WABAs)', () => {
        const r = correr(c, PROPIA, { NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: huella('888888') });
        expect(r.codigo).not.toBe(3);
        expect(r.escrituras).toHaveLength(1);
      });
    }

    if (c.modo === 'numero') {
      // El MEDIUM de la revisión del #277: una app propia no alcanza si el
      // número de destino es de WhatsApp-Modular (el .env copiado por error).
      it('por huella del NÚMERO corta antes de tocar la red, aunque la app sea propia', () => {
        const r = correr(c, PROPIA, { NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA: huella(TELEFONO).replace(/(.{8})(?!$)/g, '$1:') });
        expect(r.codigo).toBe(3);
        expect(r.error).toMatch(/número …5555 es de WhatsApp-Modular \(huella\).*prohibiciones 5 y 7/);
        expect(r.escrituras).toEqual([]);
        expect(r.llamadas.filter((l) => l.includes('fields=id,'))).toEqual([]);
      });

      it.each([['AAB1'], ['SeguroLoTengo OTP'], ['ａａｂ１']])(
        'corta sin escribir si Graph dice que el número se llama «%s», aunque la app sea propia', (nombre) => {
          const r = correr(c, PROPIA, { RESPUESTA_NUMERO: JSON.stringify({ id: TELEFONO, verified_name: nombre }) });
          expect(r.codigo).toBe(3);
          expect(r.error).toMatch(/El número «.*» es de WhatsApp-Modular.*prohibiciones 5 y 7/);
          expect(r.escrituras).toEqual([]);
        });

      it.each([
        ['un error de Graph', { error: { message: 'Unsupported get request' } }],
        ['un número sin nombre visible', { id: TELEFONO }],
        ['una respuesta sin id', { verified_name: 'Consultorio' }],
        ['algo que no es JSON', '<html>502</html>'],
      ])('corta sin escribir ante %s al preguntar por el número', (_n, respuesta) => {
        const r = correr(c, PROPIA, { RESPUESTA_NUMERO: typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta) });
        expect(r.codigo).toBe(3);
        expect(r.error).toMatch(/No se pudo saber de quién es el número/);
        expect(r.escrituras).toEqual([]);
      });

      it('corta sin escribir si Graph contesta otro número que el del entorno', () => {
        const r = correr(c, PROPIA, { RESPUESTA_NUMERO: JSON.stringify({ id: '6666', verified_name: 'Consultorio' }) });
        expect(r.codigo).toBe(3);
        expect(r.error).toMatch(/otro número/);
        expect(r.escrituras).toEqual([]);
      });

      it('pregunta por el número con el token por la entrada estándar, antes de escribir', () => {
        const r = correr(c, PROPIA);
        const i = r.llamadas.findIndex((l) => l.includes(`/${TELEFONO}?fields=id,verified_name`));
        expect(i).toBeGreaterThan(-1);
        expect(r.llamadas[i]).toContain(`‹Authorization: Bearer ${TOKEN}›`);
        expect(i).toBeLessThan(r.llamadas.indexOf(r.escrituras[0] ?? ''));
      });
    }

    it('pregunta por la app del TOKEN (/app), que es la que escribe', () => {
      const r = correr(c, PROPIA);
      const consulta = r.llamadas.find((l) => l.includes('fields=id,name')) ?? '';
      expect(consulta).toMatch(/\/app\?fields=id,name/);
      expect(consulta).toContain(`‹Authorization: Bearer ${TOKEN}›`);
    });
  }

  it('ninguna credencial en los argumentos de curl (se verían en `ps`)', () => {
    const r = correr(c, PROPIA);
    expect(r.llamadas.length).toBeGreaterThan(1);
    for (const l of r.llamadas) for (const s of CREDENCIALES) expect(argumentos(l), s).not.toContain(s);
  });
});

describe('las credenciales no van en los argumentos de curl (LOW-B)', () => {
  // Lecturas: no pasan por el candado, pero el token tampoco va en los argumentos.
  it.each([
    ['verificar-meta.sh (las cuatro comprobaciones)', () => [VERIFICAR_META, '--env', envCliente]],
    ['registrar-numero.sh --estado', () => [script('registrar-numero.sh'), '--env', envCliente, '--estado']],
    ['nombre-visible.sh (solo leer)', () => [script('nombre-visible.sh'), '--env', envCliente]],
    ['listar-plantillas.sh', () => [script('listar-plantillas.sh'), '--env', envCliente]],
    ['webhook-meta.sh --ver-waba', () => [WEBHOOK_META, '--ver-waba', '--env-cliente', envCliente, '--env-n8n', envN8n]],
    ['webhook-meta.sh --ver-meta', () => [WEBHOOK_META, '--ver-meta', '--env-cliente', envCliente]],
    ['webhook-meta.sh --preparar (la API de n8n)', () => [WEBHOOK_META, '--preparar', '--webhook-id', 'ruta-de-prueba', '--flujo-id', '7', '--env-n8n', envN8n]],
  ] as const)('%s: solo lee, sin el candado y sin credenciales en los argumentos', (_n, args) => {
    const r = lanzar(args(), PROPIA);
    expect(r.llamadas.length).toBeGreaterThan(0);
    expect(r.escrituras).toEqual([]);
    expect(r.llamadas.filter((l) => l.includes('fields=id,name'))).toEqual([]);
    for (const l of r.llamadas) for (const s of CREDENCIALES) expect(argumentos(l), s).not.toContain(s);
  });

  it('verificar-meta.sh ya no usa debug_token (exige el token en la URL): pregunta /app con el token por la entrada estándar', () => {
    const r = lanzar([VERIFICAR_META, '--env', envCliente], PROPIA);
    expect(r.llamadas.some((l) => l.includes('debug_token'))).toBe(false);
    const app = r.llamadas.find((l) => /\/app\?fields=id /.test(l)) ?? '';
    expect(app).toContain(`‹Authorization: Bearer ${TOKEN}›`);
  });

  it('webhook-meta.sh --preparar: la clave de n8n va por la entrada estándar', () => {
    const r = lanzar([WEBHOOK_META, '--preparar', '--webhook-id', 'ruta-de-prueba', '--flujo-id', '7', '--env-n8n', envN8n], PROPIA);
    expect(r.llamadas[0]).toContain(`‹X-N8N-API-KEY: ${CLAVE_N8N}›`);
  });

  it('--alta-meta manda el verify token y la URL en el cuerpo, desde un archivo', () => {
    const r = correr(caso('webhook-meta.sh --alta-meta'), PROPIA);
    const cuerpo = new URLSearchParams(cuerpoDe(r.escrituras[0]));
    expect(cuerpo.get('verify_token')).toBe(VERIFY);
    expect(cuerpo.get('callback_url')).toBe('https://n8n.invalid/webhook/ruta-de-prueba/webhook');
    expect(cuerpo.get('object')).toBe('whatsapp_business_account');
    expect(cuerpo.get('fields')).toBe('messages,account_update');
    expect(r.escrituras[0]).toContain(`‹Authorization: Bearer ${ID}|${SECRETO}›`);
  });

  it('--alta-waba manda el verify token y la URL en el cuerpo JSON, desde un archivo', () => {
    const r = correr(caso('webhook-meta.sh --alta-waba'), PROPIA);
    expect(JSON.parse(cuerpoDe(r.escrituras[0]))).toEqual({
      override_callback_uri: 'https://n8n.invalid/webhook/ruta-de-prueba/webhook', verify_token: VERIFY,
    });
    expect(r.escrituras[0]).toContain(`‹Authorization: Bearer ${TOKEN}›`);
  });

  it('registrar-numero.sh --registrar manda el PIN en el cuerpo, desde un archivo', () => {
    const r = correr(caso('registrar-numero.sh --registrar'), PROPIA);
    expect(JSON.parse(cuerpoDe(r.escrituras[0]))).toEqual({ messaging_product: 'whatsapp', pin: PIN });
    expect(r.escrituras[0]).toContain(`‹Authorization: Bearer ${TOKEN}›`);
  });
});

describe('plantillas-cliente.sh --crear --aplicar (escribe desde python, no con curl)', () => {
  const args = (...m: string[]) => [script('plantillas-cliente.sh'), '--env-cliente', envCliente, ...m];

  it('corta con código 3 antes del python si la app es ajena', () => {
    const r = lanzar(args('--crear', '--aplicar'), { id: ID, name: 'AAB1-WA-Prod' });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/prohibiciones 5 y 7/);
    expect(r.salida).not.toMatch(/Plantillas en la WABA/);
  });

  it('corta por huella, sin consultar a Graph', () => {
    const r = lanzar(args('--crear', '--aplicar'), PROPIA, { extra: { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: huella(ID) } });
    expect(r.codigo).toBe(3);
    expect(r.llamadas).toEqual([]);
  });

  it('corta por huella de la WABA, antes del python y sin consultar a Graph', () => {
    const r = lanzar(args('--crear', '--aplicar'), PROPIA, {
      extra: { NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: huella(WABA).replace(/(.{8})(?!$)/g, '$1:') },
    });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/WABA …7777 es de WhatsApp-Modular \(huella\).*prohibiciones 5 y 7/);
    expect(r.llamadas).toEqual([]);
    expect(r.salida).not.toMatch(/Plantillas en la WABA/);
  });

  it('con una app propia pasa el candado (el python después no tiene red)', () => {
    const r = lanzar(args('--crear', '--aplicar'), PROPIA);
    expect(r.codigo).not.toBe(3);
    expect(r.salida).toContain('app: NovuChat-Asistente');
  });

  it('--crear sin --aplicar y --listar no pasan por el candado', () => {
    for (const m of [['--crear'], ['--listar']]) {
      lanzar(args(...m), PROPIA);
      expect(readFileSync(registro, 'utf8'), m.join(' ')).toBe('');
    }
  });
});

// Revisión de seguridad del #313: la comparación de huellas no puede depender
// del shell. Con `echo $2 | tr`, un .env con `IFS=,` apagaba las tres capas, y
// en la WABA la huella es la única.
describe('las huellas se comparan sin depender del shell (#313)', () => {
  const agrupada = (s: string) => huella(s).replace(/(.{8})(?!$)/g, '$1:');
  /** Carga la biblioteca (o una copia) en un bash limpio y corre `cuerpo`. */
  const bash = (cuerpo: string, opciones: { lib?: string; shim?: string; extraEnv?: Record<string, string> } = {}) => {
    const r = spawnSync('bash', ['-c', `source "${opciones.lib ?? LIB}"\n${cuerpo}`], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${opciones.shim ? `${opciones.shim}:` : ''}${process.env.PATH ?? ''}`, BASH_ENV: '', ENV: '', ...opciones.extraEnv,
      }),
    });
    return { codigo: r.status, salida: r.stdout.trim(), error: r.stderr };
  };
  // La lista con el formato de la base: una huella por línea, con saltos de línea.
  const LISTA = `\n${agrupada('777777')}\n${agrupada('888888')}\n`;
  const PREAMBULOS = [':', 'IFS=,', 'IFS=', "IFS=$'\\n'", 'IFS=:', 'IFS=01234abcdef', 'echo() { :; }', 'tr() { cat; }', 'printf() { :; }'];

  it.each(PREAMBULOS)('con «%s» en el entorno, una huella de la lista se reconoce y otra no', (pre) => {
    expect(bash(`${pre}; huella_en 777777 "$L" && command echo si || command echo no`, { extraEnv: { L: LISTA } }).salida, pre).toBe('si');
    expect(bash(`${pre}; huella_en 888888 "$L" && command echo si || command echo no`, { extraEnv: { L: LISTA } }).salida, pre).toBe('si');
    expect(bash(`${pre}; huella_en 999999 "$L" && command echo si || command echo no`, { extraEnv: { L: LISTA } }).salida, pre).toBe('no');
  });

  it('un .env con IFS=, ya no apaga la capa de la WABA: corta con código 3, sin escribir', () => {
    escribirEnv(['IFS=,']);
    for (const nombre of ['crear-plantilla.sh --aplicar', 'webhook-meta.sh --alta-waba', 'verificar-meta.sh --suscribir']) {
      const r = correr(caso(nombre), PROPIA, { NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: LISTA });
      expect(r.codigo, nombre).toBe(3);
      expect(r.error, nombre).toMatch(/WABA …7777 es de WhatsApp-Modular \(huella\)/);
      expect(r.escrituras, nombre).toEqual([]);
    }
  });

  describe('falla cerrado si no puede calcular la huella', () => {
    const shim = (cuerpo: string) => {
      const d = mkdtempSync(join(dir, 'shim-'));
      writeFileSync(join(d, 'python3'), `#!/bin/sh\n${cuerpo}\n`);
      chmodSync(join(d, 'python3'), 0o755);
      return d;
    };
    it.each([
      ['python3 que sale con error', 'exit 1'],
      ['python3 que no existe como programa', 'exit 127'],
      ['python3 que contesta cualquier otra cosa', 'echo quizas'],
      ['python3 que no contesta nada', 'exit 0'],
      ['python3 que dice «no» y después sale con error', 'echo no; exit 1'],
      ['python3 que dice «si» y después sale con error', 'echo si; exit 1'],
    ])('%s: sale con 3 y no da por buena la huella', (_n, cuerpo) => {
      const r = bash('huella_en 777777 "$L" && echo si || echo no', { shim: shim(cuerpo), extraEnv: { L: LISTA } });
      expect(r.codigo).toBe(3);
      expect(r.salida).not.toMatch(/si|no/);
      expect(r.error).toMatch(/No se pudo calcular la huella/);
    });
  });

  describe('cada función de huellas usa su lista de base, además de _EXTRA', () => {
    // La lista real no se puede ejercitar (los ids reales no están): se copia
    // la biblioteca con las tres listas cambiadas por huellas de ids de prueba.
    const copia = () => {
      let t = readFileSync(LIB, 'utf8');
      for (const [variable, id] of [['APPS_AJENAS_HUELLAS', ID], ['APPS_AJENAS_NUMEROS_HUELLAS', TELEFONO], ['APPS_AJENAS_WABAS_HUELLAS', WABA]] as const) {
        const antes = t;
        t = t.replace(new RegExp(`^${variable}="[^"]*"`, 'm'), `${variable}="\n${agrupada(id)}\n"`);
        expect(t, variable).not.toBe(antes);
      }
      const ruta = join(dir, 'lib-de-prueba.sh');
      writeFileSync(ruta, t);
      return ruta;
    };
    it.each([
      ['huella_ajena', ID, [TELEFONO, WABA]],
      ['numero_ajeno', TELEFONO, [ID, WABA]],
      ['waba_ajena', WABA, [ID, TELEFONO]],
    ])('%s reconoce su id y no el de las otras dos listas', (funcion, propio, ajenos) => {
      const lib = copia();
      expect(bash(`${funcion} ${propio} && command echo si || command echo no`, { lib }).salida).toBe('si');
      for (const otro of ajenos) expect(bash(`${funcion} ${otro} && command echo si || command echo no`, { lib }).salida, otro).toBe('no');
    });
  });

  // En es_ES y es_BO (las de este equipo), [0-9] aceptaba dígitos de ancho
  // completo y arábigo-índicos: pasaban el control de forma y su huella no
  // coincidía con la del id. Donde la configuración regional no está
  // instalada, bash vuelve a C y la prueba solo comprueba que rechaza.
  it.each([['７７７７７７'], ['٧٧٧٧٧٧'], ['77７777'], [' 777777'], ['0777777'], ['777777\n']])(
    'un WABA_ID «%s» no pasa el control de forma, en ninguna configuración regional', (valor) => {
      for (const locale of ['C', 'C.UTF-8', 'es_ES.UTF-8', 'es_BO.utf8', 'es_AR.utf8']) {
        escribirEnv([`WABA_ID=${JSON.stringify(valor)}`]);
        const r = correr(caso('crear-plantilla.sh --aplicar'), PROPIA, { LC_ALL: locale });
        expect(r.codigo, locale).toBe(3);
        expect(r.error, locale).toMatch(/WABA_ID no tiene forma de id/);
        expect(r.escrituras, locale).toEqual([]);
      }
    });

  it.each([['７７７７'], ['٧٧٧٧']])('es_id rechaza «%s» aunque el entorno traiga LC_ALL=es_ES.UTF-8', (valor) => {
    const r = bash(`es_id "$V" && command echo si || command echo no`, { extraEnv: { V: valor, LC_ALL: 'es_ES.UTF-8' } });
    expect(r.salida).toBe('no');
  });
  it('es_id rechaza (no acepta) si el .env deja LC_ALL de solo lectura', () => {
    const r = bash('readonly LC_ALL=es_ES.UTF-8\nes_id "$V" && command echo si || command echo no', { extraEnv: { V: '７７７７' } });
    expect(r.salida).toBe('no');
    const ok = bash('readonly LC_ALL=es_ES.UTF-8\nes_id "$V" && command echo si || command echo no', { extraEnv: { V: '777777' } });
    expect(ok.salida).toBe('no'); // falla cerrado: sin poder fijar LC_ALL=C, no da por bueno ni un id válido
  });

  it('es_id acepta un id de Meta y rechaza lo que no lo es', () => {
    for (const [v, esperado] of [['777777', 'si'], ['1234', 'si'], ['123', 'no'], ['0777', 'no'], ['7777a', 'no'], ['', 'no'], ['7'.repeat(21), 'si'], ['7'.repeat(22), 'no']]) {
      expect(bash(`es_id "$V" && command echo si || command echo no`, { extraEnv: { V: v ?? '' } }).salida, String(v)).toBe(esperado);
    }
  });
});

describe('la fuente de los scripts (LOW-C)', () => {
  const fuente = (r: string) => readFileSync(r, 'utf8');
  /** Líneas lógicas: las terminadas en «\» se unen con la siguiente; sin comentarios. */
  const logicas = (texto: string) => texto.replace(/\\\n/g, ' ').split('\n');
  const esComentario = (l: string) => /^\s*#/.test(l);

  // Toda forma que curl convierte en escritura: -X/--request con un verbo que
  // no sea GET (o con una variable: no se sabe cuál es), pegado o no, también
  // dentro de un grupo de opciones cortas (-sXPOST); cuerpos (-d, --data*,
  // --json, -F, --form*) y subidas (-T), también pegados (-d@cuerpo, -sFx=y).
  const ESCRITURA = new RegExp([
    String.raw`\bcurl(?:_token)?\b.*(?:`,
    String.raw`\s-[a-zA-Z]*X\s*(?!GET\b)\S`,
    String.raw`|\s--request(?:=|\s+)(?!GET\b)\S`,
    String.raw`|\s-[a-zA-Z]*[dFT]`,
    String.raw`|\s(?:--data(?:-[a-z]+)?|--json|--form(?:-string)?|--upload-file)(?=[\s=]|$)`,
    ')',
  ].join(''));
  /**
   * A Graph (no a la API de n8n, que webhook-meta.sh llama por `$API`): la URL
   * literal o cualquier variable que el archivo arme con ella (G, GRAPH, URL…).
   */
  const aGraph = (l: string, texto: string) => {
    if (l.includes(DOMINIO_GRAPH)) return true;
    // `G` es el nombre de la casa: cuenta aunque el archivo no la asigne (puede
    // venir de otro `source`), además de toda asignación que traiga la URL.
    const variables = ['G', ...[...texto.matchAll(/^\s*(?:local\s+|export\s+)?([A-Za-z_]\w*)=[^\n]*graph\.facebook\.com/gm)].map((m) => m[1])];
    return variables.some((v) => new RegExp(String.raw`\$\{?${v}\}?(?:/|"|$)`).test(l));
  };
  const escribeEnGraph = (l: string, texto = 'G="https://graph.facebook.com/v26.0"') =>
    !esComentario(l) && ESCRITURA.test(l) && !l.includes('$API') && aGraph(l, texto);

  it.each([
    'curl -s -X POST "$G/x"',
    'curl -s -XPOST "${G}/x"',
    'curl -s -XDELETE "$G/x"',
    'curl --request POST "$G/x"',
    'curl --request=PUT "$G/x"',
    'curl --json \'{}\' "$G/x"',
    'curl_token -s -d "a=b" "$G/x"',
    'command curl -s --data-binary @f "$G/x"',
    'curl --data-urlencode "a=b" "$G/x"',
    'curl -F messaging_product=whatsapp "$G/x"',
    'curl -T archivo "https://graph.facebook.com/v26.0/x"',
    'R=$(curl -s --max-time 30 -X POST "${G}/x" -H @- <<<"x" \\\n  -d \'{}\')',
    'R=$(curl_token -s \\\n  "${G}/${WABA_ID}/subscribed_apps" \\\n  -X POST)',
    'curl_token -sXPOST "${G}/${WA_PHONE_ID}/messages"',
    'curl -sd@cuerpo "$G/x"',
    'curl -d@cuerpo "$G/x"',
    'curl -sFx=y "$G/x"',
    'curl -X "$M" "$G/x"',
    'curl --request "$M" "$G/x"',
  ])('reconoce como escritura: %s', (l) => {
    expect(logicas(l).some((x) => escribeEnGraph(x))).toBe(true);
  });

  it('una variable cuenta como Graph solo si el archivo la arma con la URL de Graph', () => {
    const l = 'R=$(curl -sS -X POST "$URL" -d x)';
    expect(escribeEnGraph(l, 'URL="https://graph.facebook.com/${V}/${P}/messages"')).toBe(true);
    expect(escribeEnGraph(l, 'URL="${N8N_BASE_URL%/}/webhook/x"')).toBe(false);
    expect(escribeEnGraph('curl -XPOST "$GRAPH/x"', 'GRAPH="https://graph.facebook.com/v21.0"')).toBe(true);
    expect(escribeEnGraph('curl -XPOST "$GRAPHX/x"', 'GRAPH="https://graph.facebook.com/v21.0"')).toBe(false);
    expect(escribeEnGraph('curl -XPOST "$G/x"', '')).toBe(true);
    expect(escribeEnGraph('curl -XPOST "$B/x"', 'B="${GRAPH_URL:-https://graph.facebook.com/v26.0}"')).toBe(true);
  });

  it.each([
    'curl -s "$G/x"',
    'curl -s -X GET "$G/x"',
    'curl --request GET "$G/x"',
    'curl -H @- "$G/app?fields=id,name" <<<"x"',
    'curl -s -X POST -H @- "$API$2" -d "$3"',
    '# curl -X POST "$G/x"',
    'curl -sS --max-time 20 -H "Content-Type: application/json" "$G/x"',
    'curl -so /dev/null -w "%{http_code}" "$G/x"',
    'curl -sX GET "$G/x"',
  ])('no toma por escritura: %s', (l) => {
    expect(logicas(l).some((x) => escribeEnGraph(x))).toBe(false);
  });

  /** Qué modo del candado corresponde al destino de la escritura. */
  const modoDe = (l: string): Modo | undefined => {
    if (/\$\{?WA_APP_ID\}?\/subscriptions/.test(l)) return 'app';
    if (/\$\{?WABA_ID\}?\//.test(l)) return 'token';
    if (/\$\{?WA_PHONE_ID\}?/.test(l)) return 'numero';
    return undefined;
  };
  /**
   * El candado más cercano hacia arriba, sin cruzar el cierre de un bloque
   * (`fi`, `;;`, `esac`, `}`, `done`): un candado en otra rama no cuenta.
   */
  const candadoAntes = (ls: string[], i: number): Modo | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      const l = (ls[j] ?? '').trim();
      const m = /^negar_app_ajena "\$\{?WA_APP_ID(?::-)?\}?" (app|token|numero)$/.exec(l);
      if (m) return m[1] as Modo;
      if (/^(?:fi|;;|esac|\}|done)\b/.test(l) || /;;\s*$/.test(l)) return undefined;
    }
    return undefined;
  };

  const ESCRIBEN: [string, number][] = [
    ['webhook-meta.sh', 2],
    ['verificar-meta.sh', 2],
    ['registrar-numero.sh', 2],
    ['nombre-visible.sh', 1],
    ['crear-plantilla.sh', 1],
    ['enviar-prueba.sh', 1],
    ['enviar-plantilla.sh', 1],
    ['subir-qr.sh', 1],
  ];
  // Excepciones declaradas, con su porqué y su vencimiento: una vencida hace
  // fallar la suite y obliga a decidir otra vez.
  const EXCEPCIONES: Record<string, { id: string; porque: string; vence: string }> = {
    // Prueba de humo del arranque (Bloques 2-4 de la guía): se copia suelta
    // junto a un .env.meta sin WA_APP_ID ni el repositorio al lado, y solo
    // manda hello_world a WA_TO. El token ya no va en sus argumentos.
    'Demo-Recursos/prueba-humo-meta.sh': { id: 'prueba-humo-sin-candado', porque: 'suelta, sin WA_APP_ID', vence: '2026-12-27' },
  };

  it.each(Object.entries(EXCEPCIONES))('la excepción de %s tiene porqué y no venció', (_r, e) => {
    expect(e.porque).not.toBe('');
    expect(Date.now()).toBeLessThan(Date.parse(`${e.vence}T23:59:59-04:00`));
  });

  it.each(ESCRIBEN)('%s: cada escritura a Graph va después de negar_app_ajena, con el modo de su destino', (n, cuantas) => {
    const texto = fuente(script(n));
    const ls = logicas(texto);
    const escrituras = ls.flatMap((l, i) => (escribeEnGraph(l, texto) ? [i] : []));
    expect(escrituras).toHaveLength(cuantas);
    for (const i of escrituras) {
      const l = ls[i] ?? '';
      expect(modoDe(l), l).toBeDefined();
      expect(candadoAntes(ls, i), l).toBe(modoDe(l));
    }
  });

  /** Los archivos versionados con esas extensiones, en todo el repositorio. */
  const versionados = (...patrones: string[]) => {
    const r = spawnSync('git', ['ls-files', '-z', '--', ...patrones], { cwd: REPO, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.split('\0').filter(Boolean);
  };
  const todos = versionados('*.sh');

  it('recorre todos los .sh versionados, en cualquier carpeta', () => {
    expect(todos).toContain('scripts/lib/apps-ajenas.sh');
    expect(todos).toContain('Demo-Recursos/prueba-humo-meta.sh');
    expect(todos.length).toBeGreaterThan(40);
  });

  it('ningún otro .sh escribe en Graph sin estar en la lista (o en las excepciones, con su porqué)', () => {
    const conocidos = new Set([...ESCRIBEN.map(([n]) => `scripts/${n}`), ...Object.keys(EXCEPCIONES)]);
    const escriben = todos.filter((r) => {
      const texto = fuente(join(REPO, r));
      return logicas(texto).some((l) => escribeEnGraph(l, texto));
    });
    expect(escriben.filter((r) => !conocidos.has(r))).toEqual([]);
    for (const e of Object.keys(EXCEPCIONES)) expect(escriben, e).toContain(e);
  });

  it('fuera de curl, solo plantillas-cliente.sh escribe en Graph (desde python, con el candado antes)', () => {
    // python/urllib, requests o fetch en un archivo que conoce la URL de Graph.
    const archivos = versionados('*.sh', '*.py', '*.mjs', '*.js', '*.ts')
      .filter((r) => !/^(?:web|functions)\/|(?:^|\/)node_modules\//.test(r) && !r.endsWith('.test.ts'));
    const escriben = archivos.filter((r) => {
      const t = fuente(join(REPO, r));
      return t.includes(DOMINIO_GRAPH) && /urllib\.request|\brequests\.(?:post|delete|put)|\bfetch\(/.test(t);
    });
    expect(escriben).toEqual(['scripts/plantillas-cliente.sh']);
  });

  // Solo por la entrada estándar: el secreto va en el `<<<`, después de todo argumento.
  const sinSecretoEnArgumentos = (rutas: string[], secreto: RegExp) => {
    for (const r of rutas) {
      for (const l of logicas(fuente(join(REPO, r)))) {
        if (esComentario(l) || !/\bcurl\b/.test(l) || !secreto.test(l)) continue;
        expect(l.split('<<<')[0], `${r}: ${l.trim()}`).not.toMatch(secreto);
      }
    }
  };

  it('ningún .sh pasa el token ni el verify token de Meta en los argumentos de curl', () => {
    sinSecretoEnArgumentos(todos, /Bearer \$\{?WA_TOKEN|access_token=\$|input_token=|verify_token=\$/);
  });

  it('ningún .sh pasa un secreto de Meta a python por argv (se pasa por el entorno)', () => {
    // `VT="$VT" python3 -c …` está bien: el entorno es del dueño. `python3 -c … "$VT"`, no.
    const EN_ARGV = /\bpython3?\b.*"\$\{?(?:WA_TOKEN|WA_APP_SECRET|VT|PIN|META_VERIFY_TOKEN)\}?"/;
    for (const r of todos) {
      for (const l of logicas(fuente(join(REPO, r)))) {
        if (!esComentario(l)) expect(l, `${r}: ${l.trim()}`).not.toMatch(EN_ARGV);
      }
    }
  });

  // La clave de n8n, solo en los scripts de Meta: publicar-flujo.sh,
  // ver-ejecuciones.sh y credenciales-flujo.sh todavía la pasan en los
  // argumentos, y van en un PR propio (se prueban contra n8n, no con este curl).
  it('los scripts de Meta no pasan la clave de n8n en los argumentos de curl', () => {
    sinSecretoEnArgumentos(ESCRIBEN.map(([n]) => `scripts/${n}`), /X-N8N-API-KEY: \$/);
  });

  const CARGA_LIB = /source (?:scripts\/lib|"\$\(dirname "\$0"\)\/lib)\/apps-ajenas\.sh/;
  // Un comando, no texto: al principio de la línea o después de «;» o «)».
  const CARGA_ENV = /(?:^|[;)])\s*(?:source|\.)\s+"?(?:\$\{?(?:ENV_\w+|ARCHIVO_ENV)|\.\/\$ENV_FILE|\.\/\.env|\.env)/m;

  it.each([...ESCRIBEN.map(([n]) => n), 'plantillas-cliente.sh', 'listar-plantillas.sh', 'ver-portafolios.sh'])(
    '%s carga el candado ANTES de cualquier .env', (n) => {
      const f = fuente(script(n)).split('\n').filter((l) => !esComentario(l)).join('\n');
      const carga = f.search(CARGA_LIB);
      expect(carga).toBeGreaterThan(-1);
      expect(f.search(CARGA_ENV)).toBeGreaterThan(-1);
      expect(carga).toBeLessThan(f.search(CARGA_ENV));
    });

  it('plantillas-cliente.sh: el candado va antes del python que escribe', () => {
    const f = fuente(script('plantillas-cliente.sh'));
    const candado = f.search(/^\s*negar_app_ajena "\$\{WA_APP_ID:-\}" token$/m);
    expect(candado).toBeGreaterThan(-1);
    expect(candado).toBeLessThan(f.indexOf("python3 - <<'PY'"));
  });

  it('con la biblioteca cargada, un --env sin «/» carga el del directorio actual, no uno del PATH', () => {
    // `source nombre` busca primero en el PATH: el `[ -f ]` miraría un archivo
    // y el `source` cargaría otro. La biblioteca apaga esa búsqueda (sourcepath).
    const aca = mkdtempSync(join(dir, 'aca-'));
    writeFileSync(join(aca, 'env.x'), readFileSync(envCliente, 'utf8'));
    writeFileSync(join(dir, 'env.x'), readFileSync(envCliente, 'utf8').replace(`WA_PHONE_ID=${TELEFONO}`, 'WA_PHONE_ID=6666'));
    const r = spawnSync('bash', [script('registrar-numero.sh'), '--env', 'env.x', '--dar-de-baja'], {
      cwd: aca, encoding: 'utf8', input: `${TELEFONO}\n`,
      env: entornoDelEmulador(undefined, {
        PATH: `${dir}:${process.env.PATH ?? ''}`, BASH_ENV: '', ENV: '', REGISTRO_CURL: registro,
        RESPUESTA_GRAPH: JSON.stringify(PROPIA), SUSCRITAS_GRAPH: '{}', RESPUESTA_NUMERO: JSON.stringify(NUMERO_PROPIO),
        NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: '', NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA: '', NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: '', ...SIN_RED,
      }),
    });
    expect(r.status, r.stderr).toBe(0);
    const escrituras = readFileSync(registro, 'utf8').split('\n').filter((l) => l.startsWith('ESCRIBE '));
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toContain(`/${TELEFONO}/deregister`);
  });

  it('el candado apaga sourcepath y queda readonly, con curl_token', () => {
    expect(fuente(LIB)).toMatch(/^shopt -u sourcepath$/m);
    expect(fuente(LIB)).toMatch(/^readonly APPS_AJENAS_FRAGMENTOS APPS_AJENAS_HUELLAS APPS_AJENAS_NUMEROS_HUELLAS APPS_AJENAS_WABAS_HUELLAS APPS_AJENAS_CLASIFICAR$/m);
    expect(fuente(LIB)).toMatch(/^readonly -f es_id huella_en huella_ajena numero_ajeno waba_ajena negar_app_ajena curl_token$/m);
  });

  it('un .env que redefine la lista de números ajenos no carga', () => {
    escribirEnv(['APPS_AJENAS_NUMEROS_HUELLAS=']);
    const r = correr(caso('registrar-numero.sh --dar-de-baja'), PROPIA);
    expect(r.codigo).not.toBe(0);
    expect(r.llamadas).toEqual([]);
  });

  it('bootstrap-claude-code.sh ya no regenera scripts sin candado', () => {
    for (const s of ['verificar-meta', 'enviar-prueba', 'subir-qr']) {
      expect(fuente(join(REPO, 'bootstrap-claude-code.sh'))).not.toMatch(new RegExp(`escribir "scripts/${s}\\.sh"`));
    }
  });

  const huellasDe = (nombre: string) =>
    (new RegExp(`^${nombre}="([^"]*)"`, 'm').exec(fuente(LIB))?.[1] ?? '').split(/\s+/).filter(Boolean);
  const lista = huellasDe('APPS_AJENAS_HUELLAS');
  const numeros = huellasDe('APPS_AJENAS_NUMEROS_HUELLAS');
  const wabas = huellasDe('APPS_AJENAS_WABAS_HUELLAS');

  it('no publica un id de app, de número ni de WABA: huellas sha256 en grupos de 8 y sin tiras largas de dígitos', () => {
    // verificar-saneo.sh corta desde 10 dígitos seguidos; una huella de corrido puede traerlos.
    for (const ruta of [LIB, WEBHOOK_META, VERIFICAR_META]) expect(fuente(ruta)).not.toMatch(/\d{9,}/);
    for (const h of [...lista, ...numeros, ...wabas]) expect(h).toMatch(/^([0-9a-f]{8}:){7}[0-9a-f]{8}$/);
  });

  it('trae la huella de las tres WABA de WhatsApp-Modular (el OTP, la de prueba y la de producción), todas distintas', () => {
    expect(new Set(wabas).size).toBe(3);
    for (const h of wabas) {
      expect(lista).not.toContain(h);
      expect(numeros).not.toContain(h);
    }
  });

  it('la WABA de la Fase 0 NO está en la lista: el Demo A de NovuChat la usa y cortarla le impediría escribir en la suya', () => {
    // Huella (no secreta) de esa WABA, cotejada el 01/10/2026 contra el WABA_ID
    // de los .env del Demo A. Si un día entra en la lista, esta prueba obliga a
    // decidir de nuevo, con la sesión de WhatsApp-Modular y con Andres.
    const fase0 = '81b6dbfe:a743262e:262c511d:1744ba20:fd14c37d:8d01482f:85a58016:f2123386';
    expect(wabas).not.toContain(fase0);
    expect(fuente(LIB)).not.toContain('81b6dbfe');
  });

  it('trae la huella de las dos apps de WhatsApp-Modular (AAB1-WA-Prod y Demo SeguroLo Tengo)', () => {
    expect(new Set(lista).size).toBeGreaterThanOrEqual(2);
  });

  it('trae la huella de los tres números de WhatsApp-Modular (el OTP y las líneas de sus dos WABA), distintas entre sí y de las de apps', () => {
    expect(new Set(numeros).size).toBe(3);
    for (const h of numeros) {
      expect(lista).not.toContain(h);
      expect(wabas).not.toContain(h);
    }
  });

  it('el número de la Fase 0 NO está en la lista: es el WA_PHONE_ID del Demo A y cortarlo le impediría escribir con su propio número', () => {
    // Estuvo hasta el 01/10/2026, rotulado «en desuso» sin cotejarlo contra los
    // .env de NovuChat. Huella (no secreta) cotejada ese día contra el
    // WA_PHONE_ID del .env del Demo A. Si un día entra en la lista, esta prueba
    // obliga a decidir otra vez, con la sesión de WhatsApp-Modular y con Andres.
    const fase0 = '57f8cfb2:d8b6bd3b:c46050ca:3d8718cc:d09842cd:70f68d4b:28454469:a19d36bf';
    expect(numeros).not.toContain(fase0);
    expect(fuente(LIB)).not.toContain('57f8cfb2');
  });

  it('una huella escrita con «:» corta de verdad (sin red)', () => {
    // No se conoce ningún id que dé las huellas reales: se prueba el cotejo con
    // una del mismo formato, por la variable EXTRA.
    const conPuntos = huella(ID).replace(/(.{8})(?!$)/g, '$1:');
    const r = correr(caso('webhook-meta.sh --alta-meta'), PROPIA, { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: conPuntos });
    expect(r.codigo).toBe(3);
    expect(r.llamadas).toEqual([]);
  });
});
