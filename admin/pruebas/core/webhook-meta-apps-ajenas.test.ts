/**
 * `webhook-meta.sh` NO ESCRIBE EL WEBHOOK DE UNA APP DE WHATSAPP-MODULAR
 * (CLAUDE.md, prohibiciones 5 y 7; revisión de seguridad del PR #264).
 *
 * `--alta-meta` hace `POST /{app}/subscriptions` y `--alta-waba` hace
 * `POST /{WABA}/subscribed_apps` con la app que traiga `--env-cliente`. El
 * comando no nombra la app, así que el gancho de acciones sensibles no la ve:
 * un .env con el id de AAB1-WA-Prod reescribiría el webhook de toda esa app. El
 * script corta antes del POST, por huella del id y por el nombre que devuelve
 * Graph, y corta también si no sabe qué app es.
 *
 * Lanza el script real con un `curl` falso adelante en el PATH: contesta lo que
 * la prueba le pide a la consulta del nombre y anota cada llamada. Sin red y
 * sin Meta.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'webhook-meta.sh');
const ID = '424242';

const CURL_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$REGISTRO_CURL"
case " $* " in
  *" POST "*) echo '{"success":true}' ;;
  *fields=id,name*) printf '%s' "$RESPUESTA_GRAPH" ;;
  *) echo '{"data":[]}' ;;
esac
`;

let dir: string;
let registro: string;
let envN8n: string;
let envCliente: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'webhook-meta-'));
  registro = join(dir, 'curl.log');
  writeFileSync(registro, '');
  writeFileSync(join(dir, 'curl'), CURL_FALSO);
  chmodSync(join(dir, 'curl'), 0o755);
  envN8n = join(dir, 'env-n8n');
  writeFileSync(envN8n, 'N8N_BASE_URL=https://n8n.invalid\nN8N_API_KEY=clave-de-prueba\n');
  envCliente = join(dir, 'env-cliente');
  writeFileSync(envCliente, [
    `WA_APP_ID=${ID}`, 'WA_APP_SECRET=secreto-de-prueba', 'WA_TOKEN=token-de-prueba',
    'WABA_ID=7777', 'META_VERIFY_TOKEN=verificacion-de-prueba', '',
  ].join('\n'));
});

function correr(modo: '--alta-meta' | '--alta-waba', respuesta: unknown, extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, modo, '--webhook-id', 'ruta-de-prueba', '--env-cliente', envCliente, '--env-n8n', envN8n], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      REGISTRO_CURL: registro,
      RESPUESTA_GRAPH: typeof respuesta === 'string' ? respuesta : JSON.stringify(respuesta),
      NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: '',
      ...extra,
    }),
  });
  const llamadas = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  return { codigo: r.status, salida: r.stdout, error: r.stderr, llamadas, posts: llamadas.filter((l) => / POST /.test(` ${l} `)) };
}

const huella = (s: string) => createHash('sha256').update(s).digest('hex');

describe.each(['--alta-meta', '--alta-waba'] as const)('%s', (modo) => {
  it.each([
    ['AAB1-WA-Prod'],
    ['Demo SeguroLo Tengo'],
    ['aab1 wa staging'],
    ['DEMO SEGUROLOTENGO (vieja)'],
  ])('corta sin POST si Graph dice que la app es «%s»', (nombre) => {
    const r = correr(modo, { id: ID, name: nombre });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/prohibiciones 5 y 7/);
    expect(r.posts).toEqual([]);
  });

  it.each([
    ['un error de Graph', { error: { message: 'Invalid OAuth access token' } }],
    ['una respuesta sin nombre', { id: ID }],
    ['una respuesta sin id (no se sabe de quién es el token)', { name: 'NovuChat-Asistente' }],
    ['una respuesta vacía', ''],
    ['algo que no es JSON', '<html>502</html>'],
    ['una lista en vez de un objeto', [{ id: ID, name: 'NovuChat-Asistente' }]],
  ])('corta sin POST ante %s: sin saber qué app es, no escribe', (_caso, respuesta) => {
    const r = correr(modo, respuesta);
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/No se pudo saber qué app es/);
    expect(r.posts).toEqual([]);
  });

  it('corta sin POST si Graph contesta otra app que la del entorno', () => {
    const r = correr(modo, { id: '515151', name: 'NovuChat-Asistente' });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/no de la …4242 del entorno/);
    expect(r.posts).toEqual([]);
  });

  it('por huella corta antes de tocar la red, aunque Graph diga un nombre propio', () => {
    const r = correr(modo, { id: ID, name: 'NovuChat-Asistente' }, { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: huella(ID) });
    expect(r.codigo).toBe(3);
    expect(r.error).toMatch(/\(huella\).*prohibiciones 5 y 7/);
    expect(r.llamadas).toEqual([]);
  });

  it('con una app propia sigue y hace el POST de siempre', () => {
    const r = correr(modo, { id: ID, name: 'NovuChat-Asistente' });
    expect(r.error).toBe('');
    expect(r.codigo).toBe(0);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toContain(modo === '--alta-meta' ? `/${ID}/subscriptions` : '/7777/subscribed_apps');
    // La consulta del nombre va antes del POST.
    expect(r.llamadas.findIndex((l) => l.includes('fields=id,name'))).toBeLessThan(r.llamadas.indexOf(r.posts[0]));
  });
});

describe('--alta-waba pregunta por la app del TOKEN, que es la que Meta suscribe', () => {
  it('consulta /app con el token del entorno, no /{WA_APP_ID}', () => {
    const r = correr('--alta-waba', { id: ID, name: 'NovuChat-Asistente' });
    const consulta = r.llamadas.find((l) => l.includes('fields=id,name'));
    expect(consulta).toMatch(/\/app\?fields=id,name/);
    expect(consulta).toContain('Authorization: Bearer token-de-prueba');
  });
});

describe('la fuente del script', () => {
  const fuente = readFileSync(SCRIPT, 'utf8');

  it('cada POST a Graph va después de negar_app_ajena, en el mismo modo', () => {
    const bloques = fuente.split(/^if \[ "\$MODO" = /m).slice(1);
    const conPost = bloques.filter((b) => /-X POST "\$G\//.test(b));
    expect(conPost).toHaveLength(2);
    for (const b of conPost) {
      const negar = b.search(/^\s*negar_app_ajena "\$WA_APP_ID" (app|token)$/m);
      expect(negar).toBeGreaterThan(-1);
      expect(negar).toBeLessThan(b.search(/-X POST "\$G\//));
    }
  });

  const lista = (/APPS_AJENAS_HUELLAS="([^"]*)"/.exec(fuente)?.[1] ?? '').split(/\s+/).filter(Boolean);

  it('no publica un id de app: las huellas son sha256 en grupos de 8 y no hay tiras largas de dígitos', () => {
    // verificar-saneo.sh corta desde 10 dígitos seguidos; una huella de corrido puede traerlos.
    expect(fuente).not.toMatch(/\d{9,}/);
    for (const h of lista) expect(h).toMatch(/^([0-9a-f]{8}:){7}[0-9a-f]{8}$/);
  });

  it('trae la huella de las dos apps de WhatsApp-Modular (AAB1-WA-Prod y Demo SeguroLo Tengo)', () => {
    expect(new Set(lista).size).toBeGreaterThanOrEqual(2);
  });

  it('una huella de la lista, con sus «:», corta de verdad (sin red)', () => {
    // No se conoce ningún id que dé esas huellas: se prueba el cotejo con una
    // lista equivalente, escrita en el mismo formato, por la variable EXTRA.
    const conPuntos = huella(ID).replace(/(.{8})(?!$)/g, '$1:');
    const r = correr('--alta-meta', { id: ID, name: 'NovuChat-Asistente' }, { NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: conPuntos });
    expect(r.codigo).toBe(3);
    expect(r.llamadas).toEqual([]);
  });
});
