/**
 * NINGÚN SCRIPT ESCRIBE EN META CON UNA APP DE WHATSAPP-MODULAR (CLAUDE.md,
 * prohibiciones 5 y 7; revisiones de seguridad de los PR #264 y #265).
 *
 * `webhook-meta.sh --alta-meta` hace `POST /{app}/subscriptions`; `--alta-waba`
 * y `verificar-meta.sh --suscribir/--desuscribir` escriben en
 * `/{WABA}/subscribed_apps`. Todos con la app que traiga el .env, y el comando
 * no la nombra: el gancho de acciones sensibles no la ve. El candado común
 * (`scripts/lib/apps-ajenas.sh`) corta antes, por huella del id y por el
 * nombre que devuelve Graph, y corta también si no sabe qué app es.
 *
 * Lanza los scripts reales con un `curl` falso adelante en el PATH: contesta lo
 * que la prueba le pide a la consulta del nombre y anota cada llamada, con lo
 * que recibió por la entrada estándar, marcando como ESCRITURA toda forma que
 * curl convierte en POST, DELETE o PUT. Sin red y sin Meta.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEBHOOK_META = join(REPO, 'scripts', 'webhook-meta.sh');
const VERIFICAR_META = join(REPO, 'scripts', 'verificar-meta.sh');
const LIB = join(REPO, 'scripts', 'lib', 'apps-ajenas.sh');
const ID = '424242';
const WABA = '777777';
const SECRETO = 'secreto-de-prueba';

// Cada línea del registro: «ESCRIBE|LEE <argumentos> ‹entrada estándar›».
const CURL_FALSO = `#!/usr/bin/env bash
entrada=""
case " $* " in *" @- "*|*"@-"*) entrada=$(cat) ;; esac
tipo=LEE
for a in "$@"; do case "$a" in -d|--data*|-F|--form*|-T|--upload-file) tipo=ESCRIBE ;; esac; done
case " $* " in *" -X POST "*|*" -X DELETE "*|*" -X PUT "*|*" --request "*) tipo=ESCRIBE ;; esac
printf '%s %s ‹%s›\\n' "$tipo" "$*" "$entrada" >> "$REGISTRO_CURL"
if [ "$tipo" = ESCRIBE ]; then echo '{"success":true}'; exit 0; fi
case " $* " in
  *fields=id,name*) printf '%s' "$RESPUESTA_GRAPH" ;;
  *subscribed_apps*) printf '%s' "$SUSCRITAS_GRAPH" ;;
  *) echo '{"data":[]}' ;;
esac
`;

let dir: string;
let registro: string;
let envN8n: string;
let envCliente: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apps-ajenas-'));
  registro = join(dir, 'curl.log');
  writeFileSync(registro, '');
  writeFileSync(join(dir, 'curl'), CURL_FALSO);
  chmodSync(join(dir, 'curl'), 0o755);
  envN8n = join(dir, 'env-n8n');
  writeFileSync(envN8n, 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\n');
  envCliente = join(dir, 'env-cliente');
  escribirEnv();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function escribirEnv(extra: string[] = []) {
  writeFileSync(envCliente, [
    `WA_APP_ID=${ID}`, `WA_APP_SECRET=${SECRETO}`, 'WA_TOKEN=token-de-prueba', `WABA_ID=${WABA}`,
    'WA_PHONE_ID=5555', 'META_VERIFY_TOKEN=verificacion-de-prueba', ...extra, '',
  ].join('\n'));
}

type Modo = '--alta-meta' | '--alta-waba' | '--suscribir' | '--desuscribir';

function correr(modo: Modo, respuesta: unknown, extra: Record<string, string> = {}) {
  const args = modo === '--suscribir' || modo === '--desuscribir'
    ? [VERIFICAR_META, '--env', envCliente, modo]
    : [WEBHOOK_META, modo, '--webhook-id', 'ruta-de-prueba', '--env-cliente', envCliente, '--env-n8n', envN8n];
  const r = spawnSync('bash', args, {
    encoding: 'utf8',
    // --desuscribir pide los últimos 4 del App ID; el candado va antes.
    input: `${ID.slice(-4)}\n`,
    env: entornoDelEmulador(undefined, {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      BASH_ENV: '',
      ENV: '',
      REGISTRO_CURL: registro,
      RESPUESTA_GRAPH: typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta),
      // --suscribir escribe si la app NO está; --desuscribir, si está.
      SUSCRITAS_GRAPH: JSON.stringify({ data: modo === '--desuscribir' ? [{ whatsapp_business_api_data: { id: ID } }] : [] }),
      NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: '',
      ...extra,
    }),
  });
  const llamadas = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  return {
    codigo: r.status, salida: r.stdout, error: r.stderr, llamadas,
    escrituras: llamadas.filter((l) => l.startsWith('ESCRIBE ')),
  };
}

const huella = (s: string) => createHash('sha256').update(s).digest('hex');
const MODOS: Modo[] = ['--alta-meta', '--alta-waba', '--suscribir', '--desuscribir'];
const PROPIA = { id: ID, name: 'NovuChat-Asistente' };

describe.each(MODOS)('%s', (modo) => {
  it.each([
    ['AAB1-WA-Prod'],
    ['Demo SeguroLo Tengo'],
    ['aab1 wa staging'],
    ['DEMO SEGUROLOTENGO (vieja)'],
    ['ＡＡＢ１-WA-Prod'],
    ['Demo Seguro Lo Téngo'],
  ])('corta sin escribir si Graph dice que la app es «%s»', (nombre) => {
    const r = correr(modo, { id: ID, name: nombre });
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
    const r = correr(modo, respuesta);
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/No se pudo saber qué app es/);
    expect(r.escrituras).toEqual([]);
  });

  it('corta sin escribir si Graph contesta otra app que la del entorno', () => {
    const r = correr(modo, { id: '515151', name: 'NovuChat-Asistente' });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/no de la …4242 del entorno/);
    expect(r.escrituras).toEqual([]);
  });

  it('por huella corta antes de consultar a Graph, aunque Graph diga un nombre propio', () => {
    const r = correr(modo, PROPIA, { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: huella(ID) });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/\(huella\).*prohibiciones 5 y 7/);
    expect(r.escrituras).toEqual([]);
    expect(r.llamadas.filter((l) => l.includes('fields=id,name'))).toEqual([]);
  });

  it('con una app propia sigue y escribe una vez, después de consultar el nombre', () => {
    const r = correr(modo, PROPIA);
    expect(r.error).not.toMatch(/✗/);
    expect(r.escrituras).toHaveLength(1);
    const destino = modo === '--alta-meta' ? `/${ID}/subscriptions` : `/${WABA}/subscribed_apps`;
    expect(r.escrituras[0]).toContain(destino);
    expect(r.llamadas.findIndex((l) => l.includes('fields=id,name'))).toBeLessThan(r.llamadas.indexOf(r.escrituras[0]));
  });

  it('el .env no puede apagar el candado: redefinirlo hace fallar la carga, sin escribir', () => {
    for (const trampa of ['negar_app_ajena() { :; }', 'APPS_AJENAS_FRAGMENTOS=zzz', 'APPS_AJENAS_HUELLAS=']) {
      escribirEnv([trampa]);
      const r = correr(modo, { id: ID, name: 'AAB1-WA-Prod' });
      expect(r.codigo, trampa).not.toBe(0);
      expect(r.escrituras, trampa).toEqual([]);
    }
  });

  it('corta sin escribir si WA_GRAPH_VERSION no tiene forma de versión', () => {
    escribirEnv(['WA_GRAPH_VERSION=v26.0/../otra']);
    const r = correr(modo, PROPIA);
    expect(r.codigo).toBe(3);
    expect(r.escrituras).toEqual([]);
  });
});

describe('las credenciales no van en los argumentos de curl (se verían en `ps`)', () => {
  it.each(['--alta-meta', '--alta-waba'] as const)('%s: ni el app secret ni el token en los argumentos', (modo) => {
    const r = correr(modo, PROPIA);
    expect(r.llamadas.length).toBeGreaterThan(0);
    for (const l of r.llamadas) expect(l.split('‹')[0]).not.toContain(SECRETO);
    const consulta = r.llamadas.find((l) => l.includes('fields=id,name')) ?? '';
    expect(consulta.split('‹')[0]).not.toContain('token-de-prueba');
  });

  it('--alta-waba pregunta por la app del TOKEN (/app), que es la que Meta suscribe', () => {
    const r = correr('--alta-waba', PROPIA);
    const consulta = r.llamadas.find((l) => l.includes('fields=id,name')) ?? '';
    expect(consulta).toMatch(/\/app\?fields=id,name/);
    expect(consulta).toContain('‹Authorization: Bearer token-de-prueba›');
  });

  it('--alta-meta pregunta por la app del entorno con el app access token', () => {
    const r = correr('--alta-meta', PROPIA);
    const consulta = r.llamadas.find((l) => l.includes('fields=id,name')) ?? '';
    expect(consulta).toContain(`/${ID}?fields=id,name`);
    expect(consulta).toContain(`‹Authorization: Bearer ${ID}|${SECRETO}›`);
  });
});

describe('la fuente de los scripts', () => {
  const fuente = (r: string) => readFileSync(r, 'utf8');
  // Toda forma que curl convierte en escritura, en una línea de curl a Graph.
  const ESCRITURA = /curl\b[^\n]*(?:-X (?:POST|DELETE|PUT)|\s-d\s|--data|\s-F\s|--form)[^\n]*(?:\$G|\$\{G\})\//;

  it.each([
    ['webhook-meta.sh', WEBHOOK_META, 2],
    ['verificar-meta.sh', VERIFICAR_META, 2],
  ])('%s: cada escritura a Graph va después de negar_app_ajena, en el mismo bloque', (_n, ruta, cuantas) => {
    // Bloques: los `if` de primer nivel de webhook-meta y las ramas de verificar-meta.
    const lineas = fuente(ruta).split('\n');
    const escrituras = lineas.flatMap((l, i) => (ESCRITURA.test(l) ? [i] : []));
    expect(escrituras).toHaveLength(cuantas);
    for (const i of escrituras) {
      const antes = lineas.slice(Math.max(0, i - 12), i).join('\n');
      expect(antes, `línea ${i + 1}`).toMatch(/^\s*negar_app_ajena "\$WA_APP_ID" (app|token)$/m);
    }
  });

  it('los dos scripts cargan el candado ANTES de cualquier .env', () => {
    for (const ruta of [WEBHOOK_META, VERIFICAR_META]) {
      const f = fuente(ruta);
      const carga = f.indexOf('source scripts/lib/apps-ajenas.sh');
      expect(carga).toBeGreaterThan(-1);
      expect(carga).toBeLessThan(f.search(/source "\$(ENV_|ARCHIVO_ENV)/));
    }
  });

  it('el candado queda readonly', () => {
    expect(fuente(LIB)).toMatch(/^readonly APPS_AJENAS_FRAGMENTOS APPS_AJENAS_HUELLAS$/m);
    expect(fuente(LIB)).toMatch(/^readonly -f huella_ajena negar_app_ajena$/m);
  });

  it('bootstrap-claude-code.sh ya no regenera verificar-meta.sh sin candado', () => {
    expect(fuente(join(REPO, 'bootstrap-claude-code.sh'))).not.toMatch(/escribir "scripts\/verificar-meta\.sh"/);
  });

  const lista = (/APPS_AJENAS_HUELLAS="([^"]*)"/.exec(fuente(LIB))?.[1] ?? '').split(/\s+/).filter(Boolean);

  it('no publica un id de app: huellas sha256 en grupos de 8 y sin tiras largas de dígitos', () => {
    // verificar-saneo.sh corta desde 10 dígitos seguidos; una huella de corrido puede traerlos.
    for (const ruta of [LIB, WEBHOOK_META, VERIFICAR_META]) expect(fuente(ruta)).not.toMatch(/\d{9,}/);
    for (const h of lista) expect(h).toMatch(/^([0-9a-f]{8}:){7}[0-9a-f]{8}$/);
  });

  it('trae la huella de las dos apps de WhatsApp-Modular (AAB1-WA-Prod y Demo SeguroLo Tengo)', () => {
    expect(new Set(lista).size).toBeGreaterThanOrEqual(2);
  });

  it('una huella escrita con «:» corta de verdad (sin red)', () => {
    // No se conoce ningún id que dé las huellas reales: se prueba el cotejo con
    // una del mismo formato, por la variable EXTRA.
    const conPuntos = huella(ID).replace(/(.{8})(?!$)/g, '$1:');
    const r = correr('--alta-meta', PROPIA, { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: conPuntos });
    expect(r.codigo).toBe(3);
    expect(r.llamadas).toEqual([]);
  });
});
