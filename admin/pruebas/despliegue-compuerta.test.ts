/**
 * LOS DESPLIEGUES QUE QUEDAN A MEDIAS HACEN FALLAR EL TRABAJO (16/11/2026).
 *
 * Origen: v0.23.1. `firebase deploy` (firebase-tools 15.28.1) salió con código 0
 * a mitad del release de Functions: sin «Deploy complete!» y sin «release
 * complete» de Hosting, que se publica DESPUÉS de Functions. La consola no se
 * publicó y el health check pasó, porque el sitio viejo responde 200.
 *
 * Esta suite cubre las dos piezas y su cableado:
 *   - `scripts/compuerta-registro-despliegue.sh`: lee el registro y decide con el
 *     texto Y el código de salida (C1-C14).
 *   - `scripts/comprobar-version-servida.sh`: el sitio sirve los mismos
 *     `/assets/*.js|css` que el HTML construido (V1-V6, contra un servidor local).
 *   - El workflow: los tres trabajos de despliegue ejecutan la compuerta, en el
 *     orden y con las condiciones que hacen falta (W1-W6). W2 corre el trozo REAL
 *     del workflow con un `firebase` falso.
 *
 * Las fixtures (`fixtures/despliegue/`) son ficticias: el repositorio es público.
 * Sin red (salvo 127.0.0.1), sin credenciales y sin emulador.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, '../..');
const COMPUERTA = join(RAIZ, 'scripts/compuerta-registro-despliegue.sh');
const VERSION = join(RAIZ, 'scripts/comprobar-version-servida.sh');
const FIX = join(aqui, 'fixtures/despliegue');
const A_MEDIAS = readFileSync(join(FIX, '16-11-a-medias.registro.txt'), 'utf8');
const EXITOSO = readFileSync(join(FIX, 'reintento-interno-exitoso.registro.txt'), 'utf8');
const HTML_A = join(FIX, 'html/consola-a.html');
const HTML_B = join(FIX, 'html/consola-b.html');
const HTML_SIN = join(FIX, 'html/sin-assets.html');

const SOLO_COMPLETO = 'hosting,firestore:rules,firestore:indexes,functions,storage';
const BASE = {
  SOLO: SOLO_COMPLETO,
  SITIO_CONSOLA: 'consola-ficticia',
  SITIO_CATALOGO: 'catalogo-ficticio',
  CODIGO_FIREBASE: '0',
};

const tmp = mkdtempSync(join(tmpdir(), 'compuerta-despliegue-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const archivo = (contenido: string): string => {
  const ruta = join(tmp, `a${++n}`);
  writeFileSync(ruta, contenido);
  return ruta;
};

const leerSalidas = (ruta: string): Record<string, string> => {
  const r: Record<string, string> = {};
  if (!existsSync(ruta)) return r;
  for (const l of readFileSync(ruta, 'utf8').split('\n')) {
    const i = l.indexOf('=');
    if (i > 0) r[l.slice(0, i)] = l.slice(i + 1);
  }
  return r;
};

interface Resultado { status: number | null; stdout: string; stderr: string; salidas: Record<string, string> }

/** Corre la compuerta sobre un texto de registro (o una ruta, si `ruta`). */
const compuerta = (registro: string | { ruta: string }, extra: Record<string, string> = {}): Resultado => {
  const ruta = typeof registro === 'string' ? archivo(registro) : registro.ruta;
  const salida = archivo('');
  const r = spawnSync('bash', [COMPUERTA], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, {
      ...BASE,
      FIREBASE_TOOLS_VERSION: '',
      GITHUB_OUTPUT: salida,
      GITHUB_STEP_SUMMARY: archivo(''),
      REGISTRO: ruta,
      ...extra,
    }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, salidas: leerSalidas(salida) };
};

const sinLineas = (t: string, ...trozos: string[]): string =>
  t.split('\n').filter((l) => !trozos.some((x) => l.includes(x))).join('\n');

/** ANSI real como el de firebase-tools en CI, dentro y alrededor de la línea, y CRLF. */
const conAnsiYCrlf = (t: string): string =>
  t.split('\n')
    .map((l) => l
      .replace(/functions\[/g, '\x1b[1m\x1b[32mfunctions[')
      .replace(/\)\] /g, ')]\x1b[39m\x1b[22m ')
      .replace(/^(✔|i|⚠) {1,2}/, (m) => `\x1b[32m\x1b[1m${m}\x1b[22m\x1b[39m`)
      .replace(/function (admin:\S+)\.\.\.$/, 'function \x1b[1m$1\x1b[22m...'))
    .join('\r\n');

describe('compuerta del registro de `firebase deploy`', () => {
  it('C1: el registro del 16/11 con código 0 falla y nombra lo que falta', () => {
    const r = compuerta(A_MEDIAS);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toContain('Deploy complete!');
    expect(r.stdout).toContain('unexpected state');
    for (const f of ['fnDos', 'fnTres', 'fnSeis', 'fnSiete']) {
      expect(r.stdout).toContain(`Function sin confirmar: admin:${f}(us-east1)`);
    }
    for (const f of ['fnUno', 'fnCuatro', 'fnCinco']) {
      expect(r.stdout).not.toContain(`Function sin confirmar: admin:${f}(`);
    }
    expect(r.salidas['functions_pendientes']).toBe(
      'functions:admin:fnDos,functions:admin:fnSeis,functions:admin:fnSiete,functions:admin:fnTres');
    expect(r.salidas['hosting_publicado']).toBe('ninguno');
    expect(r.salidas['completo']).toBe('false');
  });

  it('C2: el reintento interno que sale bien no es un fallo', () => {
    const r = compuerta(EXITOSO);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('reintento interno resuelto: fnDos');
    expect(r.stdout).toMatch(/::warning::.*cuota/);
    expect(r.salidas).toEqual({ completo: 'true', hosting_publicado: 'todos', functions_pendientes: '' });
  });

  it('C3: el mismo registro con código 2 falla (texto Y código, juntos)', () => {
    const r = compuerta(EXITOSO, { CODIGO_FIREBASE: '2' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('código 2');
    expect(r.salidas['completo']).toBe('false');
  });

  it('C4: sin «Deploy complete!» falla', () => {
    const r = compuerta(sinLineas(EXITOSO, 'Deploy complete!'));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('no llegó a «Deploy complete!»');
  });

  it('C5: una Function iniciada sin su «Successful» falla y se nombra', () => {
    const r = compuerta(sinLineas(EXITOSO, 'functions[admin:fnSiete(us-east1)] Successful'));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Function sin confirmar: admin:fnSiete(us-east1)');
    expect(r.salidas['functions_pendientes']).toBe('functions:admin:fnSiete');
  });

  it('C6: «unexpected state» falla aunque todo lo demás esté', () => {
    const r = compuerta(`${EXITOSO}⚠  functions: Updated function is not associated with a service. This deployment is in an unexpected state - please re-deploy your functions.\n`);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('unexpected state');
  });

  it('C7: sin el release del catálogo falla y Hosting queda «parcial»', () => {
    const r = compuerta(sinLineas(EXITOSO, 'hosting[catalogo-ficticio]: release complete'));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('catalogo-ficticio');
    expect(r.salidas['hosting_publicado']).toBe('parcial');
  });

  it('C8: `hosting:consola` solo espera la consola', () => {
    const r = compuerta(sinLineas(EXITOSO, 'hosting[catalogo-ficticio]: release complete'), { SOLO: 'hosting:consola' });
    expect(r.status, r.stdout).toBe(0);
    expect(r.salidas['hosting_publicado']).toBe('todos');
  });

  it('C9: sin Hosting en SOLO no se espera ningún sitio', () => {
    const r = compuerta(sinLineas(EXITOSO, 'release complete'), { SOLO: 'firestore:rules,functions' });
    expect(r.status, r.stdout).toBe(0);
    expect(r.salidas['hosting_publicado']).toBe('no_aplica');
  });

  it('C10: SOLO con functions y ni una línea de Functions: formato desconocido, falla', () => {
    const r = compuerta(sinLineas(EXITOSO, 'functions[', 'function admin:', 'failed to update', 'Quota'));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('formato esperado');
  });

  it('C11: todas las Functions omitidas («Skipped») pasan', () => {
    const omitidas = sinLineas(EXITOSO, 'function admin:', 'Successful', 'failed to update', 'Quota', 'Request to')
      .replace('✔  functions: functions source uploaded successfully',
        ['fnUno', 'fnDos', 'fnTres'].map((f) => `✔  functions[admin:${f}(us-east1)] Skipped (No changes detected)`).join('\n'));
    const r = compuerta(omitidas);
    expect(r.status, r.stdout).toBe(0);
    expect(r.salidas['completo']).toBe('true');
  });

  it('C12: ANSI real y CRLF dan el mismo veredicto', () => {
    const exito = compuerta(conAnsiYCrlf(EXITOSO));
    expect(exito.status, exito.stdout).toBe(0);
    expect(exito.salidas).toEqual(compuerta(EXITOSO).salidas);
    const medias = compuerta(conAnsiYCrlf(A_MEDIAS));
    expect(medias.status).toBe(1);
    expect(medias.salidas).toEqual(compuerta(A_MEDIAS).salidas);
  });

  it('C13: registro vacío falla; sin registro o sin SOLO es error de uso', () => {
    expect(compuerta('').status).toBe(1);
    expect(compuerta({ ruta: join(tmp, 'no-existe.log') }).status).toBe(2);
    expect(compuerta(EXITOSO, { SOLO: '' }).status).toBe(2);
    expect(compuerta(EXITOSO, { SITIO_CONSOLA: '' }).status).toBe(2);
  });

  it('C14: una etiqueta sin codebase (`fnX(us-east1)`) se empareja', () => {
    const sinCodebase = EXITOSO.replaceAll('admin:fnUno(us-east1)', 'fnX(us-east1)');
    expect(compuerta(sinCodebase).status).toBe(0);
    const r = compuerta(sinLineas(sinCodebase, 'functions[fnX(us-east1)] Successful'));
    expect(r.status).toBe(1);
    expect(r.salidas['functions_pendientes']).toBe('functions:fnX');
  });

  it('nunca imprime el registro', () => {
    const r = compuerta(A_MEDIAS);
    expect(r.stdout + r.stderr).not.toContain('proyecto-ficticio');
    expect(r.stdout + r.stderr).not.toContain('project_number');
  });
});

// ---------------------------------------------------------------------------
// Versión servida, contra un servidor http en 127.0.0.1.
// ---------------------------------------------------------------------------
describe('lo servido es lo construido', () => {
  let servidor: Server;
  let base = '';
  let peticiones = 0;
  // Qué responder en cada petición: [código, cuerpo]. Se cambia por prueba.
  let responder: (ruta: string, intento: number) => [number, string] = () => [200, ''];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      peticiones++;
      const [codigo, cuerpo] = responder((req.url ?? '').split('?')[0] ?? '', peticiones);
      res.writeHead(codigo, { 'Content-Type': 'text/html' });
      res.end(cuerpo);
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  const html = (ruta: string) => readFileSync(ruta, 'utf8');

  // spawn asíncrono: spawnSync bloquearía el bucle de eventos y el servidor no contestaría.
  const version = (extra: Record<string, string>): Promise<Resultado> => {
    peticiones = 0;
    const salida = archivo('');
    return new Promise((ok, mal) => {
      const hijo = spawn('bash', [VERSION], {
        env: entornoDelEmulador(undefined, {
          SOLO: 'hosting:consola',
          URL_CONSOLA: base,
          URL_CATALOGO: '',
          HTML_CONSOLA: HTML_A,
          INTENTOS: '2',
          ESPERA: '0',
          GITHUB_OUTPUT: salida,
          ...extra,
        }),
      });
      let stdout = '';
      let stderr = '';
      hijo.stdout.on('data', (d) => (stdout += String(d)));
      hijo.stderr.on('data', (d) => (stderr += String(d)));
      hijo.on('error', mal);
      hijo.on('close', (status) => ok({ status, stdout, stderr, salidas: leerSalidas(salida) }));
    });
  };

  it('V1: sirve la misma versión -> 0', async () => {
    responder = () => [200, html(HTML_A)];
    const r = await version({});
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.salidas['ok']).toBe('true');
  });

  it('V1b: con los dos sitios, cada uno contra su HTML', async () => {
    responder = (ruta) => [200, html(ruta.startsWith('/c/') ? HTML_B : HTML_A)];
    const r = await version({ SOLO: 'hosting,functions', URL_CATALOGO: base, HTML_CATALOGO: HTML_B });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('V2: sirve otra versión -> 1, con lo construido y lo servido', async () => {
    responder = () => [200, html(HTML_B)];
    const r = await version({});
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('consola sirve otra versión: se construyó /assets/index-AAAA.js, se sirve /assets/index-BBBB.js');
    expect(r.salidas['ok']).toBe('false');
  });

  it('V3: la vieja primero y la nueva después -> 0 (la CDN tarda en propagar)', async () => {
    responder = (_r, i) => [200, html(i === 1 ? HTML_B : HTML_A)];
    const r = await version({});
    expect(r.status, r.stdout).toBe(0);
    expect(peticiones).toBe(2);
  });

  it('V4: 404 o 500 -> 1', async () => {
    for (const codigo of [404, 500]) {
      responder = () => [codigo, 'no'];
      const r = await version({});
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('se sirve nada');
    }
  });

  it('V5: HTML construido sin assets, o URL http:// pública -> 2', async () => {
    responder = () => [200, html(HTML_A)];
    expect((await version({ HTML_CONSOLA: HTML_SIN })).status).toBe(2);
    const r = await version({ URL_CONSOLA: 'http://ejemplo.com' });
    expect(r.status).toBe(2);
    expect(peticiones).toBe(0);
  });

  it('V6: SOLO sin hosting -> 0 sin peticiones; `hosting` sin URL_CATALOGO -> 2', async () => {
    responder = () => [200, html(HTML_A)];
    const r = await version({ SOLO: 'firestore:rules,functions' });
    expect(r.status).toBe(0);
    expect(peticiones).toBe(0);
    expect((await version({ SOLO: 'hosting' })).status).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// El cableado en el workflow.
// ---------------------------------------------------------------------------
describe('el workflow ejecuta la compuerta en los tres despliegues', () => {
  const ci = readFileSync(join(RAIZ, '.github/workflows/ci-node-firebase.yml'), 'utf8');
  const job = (nombre: string): string => {
    const i = ci.indexOf(`\n  ${nombre}:\n`);
    expect(i, `no encontré el job ${nombre}`).toBeGreaterThan(-1);
    const resto = ci.slice(i + 1);
    const sig = resto.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
    return sig === -1 ? resto : resto.slice(0, sig + 1);
  };
  const ABRE = '# >>> despliegue con compuerta';
  const CIERRA = '# <<< despliegue con compuerta';
  const TRABAJOS = ['desplegar-produccion', 'desplegar-staging', 'desplegar-dev'] as const;

  /** El trozo real entre marcadores, sin la sangría del YAML. */
  const fragmento = (j: string): string => {
    const i = j.indexOf(ABRE);
    const f = j.indexOf(CIERRA);
    expect(i).toBeGreaterThan(-1);
    expect(f).toBeGreaterThan(i);
    return j.slice(i, f).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  };
  /** El paso (`- name:` … siguiente `- name:`) que contiene `marca`. */
  const paso = (j: string, marca: string): string => {
    const m = j.indexOf(marca);
    expect(m, marca).toBeGreaterThan(-1);
    const ini = j.lastIndexOf('      - name:', m);
    const fin = j.indexOf('      - name:', m);
    return j.slice(ini, fin === -1 ? undefined : fin);
  };

  for (const t of TRABAJOS) {
    it(`W1 ${t}: guarda el registro con tee, toma PIPESTATUS y corre la compuerta tras firebase deploy`, () => {
      const j = job(t);
      const fr = fragmento(j);
      expect(fr).toContain('REGISTRO="$RUNNER_TEMP/firebase-deploy.log"');
      expect(fr).toContain('2>&1 | tee "$REGISTRO"');
      expect(fr).toContain('estados=("${PIPESTATUS[@]}")');
      expect(fr).toContain('CODIGO_FIREBASE="${estados[0]}"');
      const deploy = j.lastIndexOf('firebase deploy --only "$SOLO"');
      expect(j.indexOf('scripts/compuerta-registro-despliegue.sh')).toBeGreaterThan(deploy);
      expect(paso(j, ABRE)).toContain('id: desplegar');
      expect(paso(j, ABRE)).not.toContain('continue-on-error');
    });

    it(`W2 ${t}: el trozo real del workflow falla con el registro del 16/11 y pasa con el exitoso`, () => {
      const bin = join(tmp, `bin-${t}`);
      spawnSync('mkdir', ['-p', bin]);
      writeFileSync(join(bin, 'firebase'), '#!/usr/bin/env bash\ncat "$FIXTURE"\nexit "$CODIGO_FALSO"\n');
      chmodSync(join(bin, 'firebase'), 0o755);
      const codigo = `set -euo pipefail\n${fragmento(job(t))}`;
      const corre = (fixture: string, codigoFalso: string) => {
        const salida = archivo('');
        const r = spawnSync('bash', ['-c', codigo], {
          encoding: 'utf8',
          env: entornoDelEmulador(undefined, {
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            FIXTURE: join(FIX, fixture),
            CODIGO_FALSO: codigoFalso,
            RUNNER_TEMP: tmp,
            GITHUB_OUTPUT: salida,
            GITHUB_STEP_SUMMARY: archivo(''),
            GITHUB_WORKSPACE: RAIZ,
            GITHUB_REF_NAME: 'v0.0.0',
            GITHUB_RUN_ID: '1',
            GITHUB_SHA: 'abcdef0abcdef0',
            FIREBASE_TOOLS_VERSION: '',
            // dev ya convirtió `hosting` en `hosting:consola` antes del trozo.
            SOLO: t === 'desplegar-dev' ? 'hosting:consola,firestore:rules,functions' : SOLO_COMPLETO,
            PROYECTO: 'consola-ficticia',
            SITIO_CONSOLA: 'consola-ficticia',
            SITIO_CATALOGO: 'catalogo-ficticio',
            FORZAR: '',
          }),
        });
        return { status: r.status, salidas: leerSalidas(salida), stdout: r.stdout + r.stderr };
      };
      const medias = corre('16-11-a-medias.registro.txt', '0');
      expect(medias.status).not.toBe(0);
      expect(medias.salidas['completo']).toBe('false');
      expect(medias.salidas['firebase_corrio']).toBe('true');
      const exito = corre('reintento-interno-exitoso.registro.txt', '0');
      expect(exito.status, exito.stdout).toBe(0);
      expect(exito.salidas['completo']).toBe('true');
      expect(corre('reintento-interno-exitoso.registro.txt', '2').status).not.toBe(0);
    });

    it(`W3 ${t}: comprueba la versión servida después del despliegue, sin if`, () => {
      const j = job(t);
      const v = j.indexOf('id: version');
      expect(v).toBeGreaterThan(j.indexOf(CIERRA));
      const p = paso(j, 'id: version');
      expect(p).toContain('scripts/comprobar-version-servida.sh');
      expect(p).not.toMatch(/\n\s+if:/);
      expect(p).not.toContain('continue-on-error');
      expect(p).toContain('timeout-minutes');
      if (t === 'desplegar-produccion') expect(v).toBeLessThan(j.indexOf('id: salud'));
    });
  }

  it('W4: en producción el health check corre también tras un despliegue fallido, y el rollback tras él', () => {
    const j = job('desplegar-produccion');
    expect(paso(j, 'id: salud')).toContain(
      "if: ${{ !cancelled() && steps.desplegar.outputs.firebase_corrio == 'true' }}");
    for (const nombre of ['Rollback de hosting', 'Fallar si producción no responde']) {
      expect(paso(j, `- name: ${nombre}`)).toContain("if: ${{ !cancelled() && steps.salud.outputs.ok == 'false' }}");
    }
    // El humo del catálogo sigue atado a una consola sana.
    expect(paso(j, './scripts/humo-sitio-publico.sh')).toContain("if: steps.salud.outputs.ok == 'true'");
  });

  it('W5: las salidas nuevas llegan a post-despliegue con textos de 140 caracteres o menos', () => {
    const j = job('desplegar-produccion');
    expect(j).toContain('despliegue_completo: ${{ steps.desplegar.outputs.completo }}');
    expect(j).toContain('hosting_publicado: ${{ steps.desplegar.outputs.hosting_publicado }}');
    expect(j).toContain('version_servida: ${{ steps.version.outputs.ok }}');
    const post = job('post-despliegue');
    expect(post).toContain('COMPLETO: ${{ needs.desplegar-produccion.outputs.despliegue_completo }}');
    expect(post).toContain('HOSTING: ${{ needs.desplegar-produccion.outputs.hosting_publicado }}');
    expect(post).toContain('VERSION_SERVIDA: ${{ needs.desplegar-produccion.outputs.version_servida }}');
    const textos = [...post.matchAll(/'(Despliegue [^']*)'/g)].map((m) => m[1] ?? '');
    expect(textos.length).toBeGreaterThanOrEqual(5);
    for (const tx of textos) expect(tx.length, tx).toBeLessThanOrEqual(140);
    // Un rollback sigue teniendo prioridad sobre el despliegue a medias.
    expect(post.indexOf("SALUD_OK === 'false'")).toBeLessThan(post.indexOf("COMPLETO === 'false'"));
    expect(post.indexOf("VERSION_SERVIDA === 'false'")).toBeLessThan(post.indexOf("SALUD_OK === 'true'"));
  });

  it('W6: la versión fijada de firebase-tools es la verificada por la compuerta', () => {
    const fijada = /FIREBASE_TOOLS_VERSION: '([^']+)'/.exec(ci)?.[1];
    const verificada = /^VERSION_VERIFICADA=(\S+)$/m.exec(readFileSync(COMPUERTA, 'utf8'))?.[1];
    expect(fijada).toBeDefined();
    expect(verificada).toBe(fijada);
  });
});
