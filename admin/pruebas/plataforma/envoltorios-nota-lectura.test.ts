/**
 * Los envoltorios `scripts/fijar-nota-novutienda-comercio.sh` (enciende o apaga `config/pedidos.notaANovuTienda`) y
 * `scripts/leer-negocio-comercio.sh` (SOLO LECTURA de un campo público de `config/negocio`), y el script de nodo
 * `admin/scripts/plataforma/leer-config-negocio.mjs`. Modelo: `envoltorios-carrito-numero.test.ts`.
 *
 * Con un `node` FALSO que anota sus argumentos y su entorno, credenciales de gcloud FALSAS y HOME aislado en un directorio temporal.
 * NO se toca la nube. Se niega primero: sin confirmación, comercio distinto, demos, entorno inválido, campo fuera de la lista,
 * valores mal formados, modos excluyentes; y que ningún valor (el proyecto) salga por pantalla o vaya en la línea de comandos.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOTA = join(RAIZ, 'scripts', 'fijar-nota-novutienda-comercio.sh');
const LEER = join(RAIZ, 'scripts', 'leer-negocio-comercio.sh');
const MJS = join(RAIZ, 'admin', 'scripts', 'plataforma', 'leer-config-negocio.mjs');

type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/leer-config-negocio.mjs') as unknown as {
  CAMPOS_PERMITIDOS: string[];
  analizarArgumentos: (argv: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  comprobarEnlace: (v: unknown, esperado: string | null) => Array<{ nombre: string; ok: boolean }>;
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  mostrar: (v: unknown) => string;
};

const ID_PROD = 'proy-prod-aaa1';
const ID_STG = 'proy-stg-bbb2';
const T = 'comercio-uno';

const NODE_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$FAKE_DIR/argv"
if [ -z "\${FAKE_SIN_RESPALDO:-}" ]; then
  prev=""; for a in "$@"; do if [ "$prev" = "--respaldo" ] && [ ! -e "$a" ]; then echo '{}' > "$a"; fi; prev="$a"; done
fi
echo "STG=\${GCP_PROJECT_ID_STAGING:-}|PROD=\${GCP_PROJECT_ID_PROD:-}" >> "$FAKE_DIR/entorno"
echo "nodo imprime: \${GCP_PROJECT_ID_STAGING:-} \${GCP_PROJECT_ID_PROD:-}"
exit "\${FAKE_SALIDA:-0}"
`;

let dir: string; let home: string;
const leer = (n: string): string => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } };
const adc = (carpeta: string, id: string) => {
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, 'application_default_credentials.json'), JSON.stringify({ type: 'authorized_user', quota_project_id: id }));
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'envoltorios-nota-'));
  home = join(dir, 'home');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'node'), NODE_FALSO); chmodSync(join(dir, 'bin', 'node'), 0o755);
  adc(join(home, '.config', 'gcloud-novuchat-prod'), ID_PROD);
  adc(join(home, '.config', 'gcloud'), ID_STG);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function correr(script: string, args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: home, FAKE_DIR: dir, ...extra }),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const llamadas = (): number => leer('argv') === '' ? 0 : leer('argv').split('\n').filter((l) => l === '--tenant').length;
const SIN_PROYECTO = (texto: string) => { for (const v of [ID_PROD, ID_STG]) expect(texto).not.toContain(v); };
const base = ['--tenant', T, '--entorno', 'produccion'];

describe('fijar-nota-novutienda-comercio.sh', () => {
  it('SECO: llama al script de nodo sin --aplicar, con --entorno; el proyecto va por ENTORNO, no por la línea de comandos', () => {
    const r = correr(NOTA, [...base, '--activar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(llamadas()).toBe(1);
    const argv = leer('argv');
    expect(argv).toContain('--entorno\nproduccion'); expect(argv).toContain(`--tenant\n${T}`); expect(argv).toContain('--activar');
    expect(argv).not.toContain('--aplicar'); expect(argv).not.toContain('--respaldo'); expect(argv).not.toContain('--proyecto');
    SIN_PROYECTO(argv);
    expect(leer('entorno')).toContain(`STG=${ID_STG}|PROD=${ID_PROD}`);
  });

  it('NINGÚN id de proyecto sale por la pantalla, aunque el script de nodo lo imprima (el filtro lo oculta)', () => {
    const r = correr(NOTA, [...base, '--desactivar']);
    expect(r.codigo).toBe(0);
    SIN_PROYECTO(r.salida);
    expect(r.salida).toContain('<valor>');
    expect(leer('argv')).toContain('--desactivar');
  });

  it('NEGANDO: --aplicar sin --confirmo igual al comercio (o --confirmo sin --aplicar) no llama a nada', () => {
    for (const a of [['--aplicar'], ['--aplicar', '--confirmo', 'otro-comercio'], ['--aplicar', '--confirmo', 'produccion'], ['--confirmo', T]]) {
      expect(correr(NOTA, [...base, '--activar', ...a]).codigo, a.join(' ')).toBe(2);
    }
    expect(llamadas()).toBe(0);
  });

  it('con --confirmo correcto pasa --aplicar, el respaldo en una carpeta 0700 fuera del repositorio y el comercio confirmado', () => {
    const r = correr(NOTA, [...base, '--activar', '--aplicar', '--confirmo', T, '--novutienda-acepta-nota']);
    expect(r.codigo, r.salida).toBe(0);
    const argv = leer('argv').split('\n');
    expect(argv).toContain('--aplicar');
    const ruta = argv[argv.indexOf('--respaldo') + 1]!;
    expect(ruta).toMatch(/^\/tmp\/nota-novutienda\.[A-Za-z0-9]+\/respaldo\.json$/);
    expect(statSync(dirname(ruta)).mode & 0o777).toBe(0o700);
    expect(argv[argv.indexOf('--confirmo') + 1]).toBe(T);
    expect(r.salida).toContain('Respaldo del valor previo');
    SIN_PROYECTO(r.salida); SIN_PROYECTO(leer('argv'));
    rmSync(dirname(ruta), { recursive: true, force: true }); // el operador lo borra al cerrar; la prueba también
  });

  it('si el script de nodo no guarda respaldo (sin cambios, rechazo, precondición), se borra la carpeta y se avisa; el aviso «Respaldo…» no sale', () => {
    const antes = new Set(readdirSync('/tmp').filter((n) => n.startsWith('nota-novutienda.')));
    const r = correr(NOTA, [...base, '--desactivar', '--aplicar', '--confirmo', T], { FAKE_SIN_RESPALDO: '1' });
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('No se guardó respaldo');
    expect(r.salida).not.toContain('Respaldo del valor previo');
    const ruta = leer('argv').split('\n'); const respaldo = ruta[ruta.indexOf('--respaldo') + 1]!;
    expect(existsSync(dirname(respaldo))).toBe(false);
    expect(readdirSync('/tmp').filter((n) => n.startsWith('nota-novutienda.') && !antes.has(n))).toEqual([]);
  });

  it('NEGANDO: en PRODUCCIÓN, --activar --aplicar exige --novutienda-acepta-nota (sin ella no se escribe); staging y el seco no la exigen', () => {
    const ap = ['--activar', '--aplicar', '--confirmo', T];
    expect(correr(NOTA, [...base, ...ap]).codigo).toBe(2);
    expect(llamadas()).toBe(0);
    expect(correr(NOTA, [...base, '--activar']).codigo).toBe(0); // el seco no la exige
    expect(correr(NOTA, ['--tenant', T, '--entorno', 'staging', ...ap]).codigo).toBe(0); // staging tampoco
    const r = correr(NOTA, [...base, ...ap, '--novutienda-acepta-nota']);
    expect(r.codigo, r.salida).toBe(0);
    expect(leer('argv')).not.toContain('novutienda-acepta-nota'); // la opción es del envoltorio: no llega al script de nodo
    // desactivar y revertir no la necesitan, y la opción solo va con --activar
    expect(correr(NOTA, [...base, '--desactivar', '--aplicar', '--confirmo', T]).codigo).toBe(0);
    expect(correr(NOTA, [...base, '--desactivar', '--novutienda-acepta-nota']).codigo).toBe(2);
    expect(correr(NOTA, [...base, '--novutienda-acepta-nota', '--novutienda-acepta-nota', '--activar']).codigo).toBe(2);
  });

  it('NEGANDO: una opción repetida se rechaza (no pisa a la primera en silencio)', () => {
    const casos = [
      ['--tenant', T, '--tenant', 'otro-comercio', '--entorno', 'produccion', '--activar'],
      ['--tenant', T, '--entorno', 'staging', '--entorno', 'produccion', '--activar'],
      [...base, '--activar', '--activar'],
      [...base, '--revertir', '/tmp/a/respaldo.json', '--revertir', '/tmp/b/respaldo.json'],
      [...base, '--activar', '--confirmo', T, '--confirmo', T, '--aplicar'],
      [...base, '--activar', '--aplicar', '--aplicar', '--confirmo', T],
    ];
    for (const c of casos) expect(correr(NOTA, c).codigo, c.join(' ')).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('--revertir <respaldo>: pasa --revertir y esa ruta; con --aplicar no crea otro respaldo', () => {
    const resp = '/tmp/nota-novutienda.ABCDEF/respaldo.json';
    expect(correr(NOTA, [...base, '--revertir', resp]).codigo).toBe(0);
    let argv = leer('argv').split('\n');
    expect(argv).toContain('--revertir'); expect(argv[argv.indexOf('--respaldo') + 1]).toBe(resp); expect(argv).not.toContain('--aplicar');
    rmSync(join(dir, 'argv'));
    expect(correr(NOTA, [...base, '--revertir', resp, '--aplicar', '--confirmo', T]).codigo).toBe(0);
    argv = leer('argv').split('\n');
    expect(argv.filter((a) => a === '--respaldo')).toHaveLength(1);
    expect(argv[argv.indexOf('--respaldo') + 1]).toBe(resp);
    expect(argv).toContain('--aplicar');
  });

  it('NEGANDO: --revertir con una ruta mal formada (relativa, con «..», vacía), o sin --confirmo al aplicar: no se llama a nada', () => {
    for (const mala of ['respaldo.json', '/tmp/../etc/x', '/tmp/a b/r.json', '']) {
      expect(correr(NOTA, [...base, '--revertir', mala]).codigo, mala).toBe(2);
    }
    expect(correr(NOTA, [...base, '--revertir', '/tmp/x/respaldo.json', '--aplicar']).codigo).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('NEGANDO: --activar y --desactivar son excluyentes; también con --revertir; y se exige uno', () => {
    expect(correr(NOTA, [...base, '--activar', '--desactivar']).codigo).toBe(2);
    expect(correr(NOTA, [...base, '--activar', '--revertir', '/tmp/x/respaldo.json']).codigo).toBe(2);
    expect(correr(NOTA, [...base, '--desactivar', '--revertir', '/tmp/x/respaldo.json']).codigo).toBe(2);
    expect(correr(NOTA, [...base]).codigo).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('NEGANDO: demos, ensayo y NovuChat, comercio mal formado, entorno inválido y opciones desconocidas', () => {
    for (const t of ['demo', 'demo-venta', 'demo-agendamiento', 'novuchat', 'novuchat-onboarding', 'ensayo', '../x', 'A', 'ab']) {
      expect(correr(NOTA, ['--tenant', t, '--entorno', 'produccion', '--activar']).codigo, t).toBe(2);
    }
    for (const e of ['dev', 'Produccion', '', 'prod', 'emulador']) {
      expect(correr(NOTA, ['--tenant', T, '--entorno', e, '--activar']).codigo, e).toBe(2);
    }
    expect(correr(NOTA, [...base, '--activar', '--todos']).codigo).toBe(2);
    expect(correr(NOTA, [...base, '--activar', '--proyecto', 'otro']).codigo).toBe(2);
    expect(correr(NOTA, ['--tenant', T, '--activar']).codigo).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('NEGANDO: credenciales de los dos entornos iguales o ilegibles: no se llama a nada', () => {
    adc(join(home, '.config', 'gcloud'), ID_PROD);
    expect(correr(NOTA, [...base, '--activar']).codigo).toBe(2);
    rmSync(join(home, '.config', 'gcloud-novuchat-prod'), { recursive: true, force: true });
    expect(correr(NOTA, [...base, '--activar']).codigo).toBe(3);
    expect(llamadas()).toBe(0);
  });

  it('la salida del script de nodo se conserva (código de salida) y el filtro no la rompe', () => {
    const r = correr(NOTA, [...base, '--activar'], { FAKE_SALIDA: '1' });
    expect(r.codigo).toBe(1);
  });
});

describe('leer-negocio-comercio.sh', () => {
  const leerArgs = (campo: string, extra: string[] = []) => [...base, '--campo', campo, ...extra];

  it('lee SOLO con --entorno, --tenant y --campo; ninguna opción de escritura; el proyecto va por ENTORNO', () => {
    const r = correr(LEER, leerArgs('enlaceCatalogo'));
    expect(r.codigo, r.salida).toBe(0);
    expect(llamadas()).toBe(1);
    const argv = leer('argv');
    expect(argv).toContain('--campo\nenlaceCatalogo');
    for (const mala of ['--aplicar', '--confirmo', '--respaldo', '--proyecto']) expect(argv).not.toContain(mala);
    SIN_PROYECTO(argv); SIN_PROYECTO(r.salida);
    expect(leer('entorno')).toContain(`STG=${ID_STG}|PROD=${ID_PROD}`);
  });

  it('cada campo de la lista cerrada se acepta', () => {
    for (const c of ['enlaceCatalogo', 'ubicacionTienda', 'mapaTienda', 'horarioTienda']) {
      expect(correr(LEER, leerArgs(c)).codigo, c).toBe(0);
    }
    expect(llamadas()).toBe(4);
  });

  it('NEGANDO: un campo fuera de la lista se rechaza SIN llamar a nada (secretos, tokens, variantes de mayúsculas, rutas)', () => {
    for (const c of ['waToken', 'token', 'apiKey', 'firmaSecreto', 'nombre', 'EnlaceCatalogo', 'enlaceCatalogo ', 'enlaceCatalogo,waToken', '*', '', 'a/b', '__name__']) {
      expect(correr(LEER, leerArgs(c)).codigo, c).toBe(2);
    }
    expect(correr(LEER, [...base]).codigo).toBe(2); // sin --campo
    expect(llamadas()).toBe(0);
  });

  it('NEGANDO: no existe forma de escribir: --aplicar, --confirmo, --quitar, --activar se rechazan', () => {
    for (const a of [['--aplicar'], ['--confirmo', T], ['--quitar'], ['--activar'], ['--respaldo', '/tmp/x']]) {
      expect(correr(LEER, leerArgs('enlaceCatalogo', a)).codigo, a.join(' ')).toBe(2);
    }
    expect(llamadas()).toBe(0);
    const fuente = readFileSync(LEER, 'utf8').replace(/^\s*#.*$/gm, '');
    expect(fuente).not.toMatch(/--aplicar|--confirmo|--respaldo|--quitar/);
  });

  it('--esperado: solo con enlaceCatalogo y como URL https:// sin espacios; llega al script de nodo', () => {
    expect(correr(LEER, leerArgs('enlaceCatalogo', ['--esperado', 'https://tienda.ejemplo.test/c'])).codigo).toBe(0);
    expect(leer('argv')).toContain('--esperado\nhttps://tienda.ejemplo.test/c');
    rmSync(join(dir, 'argv'));
    for (const mala of ['http://x.test', 'tienda.test', 'https://x y', 'https://', '']) {
      expect(correr(LEER, leerArgs('enlaceCatalogo', ['--esperado', mala])).codigo, mala).toBe(2);
    }
    expect(correr(LEER, leerArgs('mapaTienda', ['--esperado', 'https://x.test'])).codigo).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('NEGANDO: una opción repetida se rechaza y --esperado exige un host', () => {
    for (const c of [
      ['--tenant', T, '--tenant', 'otro-comercio', '--entorno', 'produccion', '--campo', 'enlaceCatalogo'],
      [...base, '--campo', 'enlaceCatalogo', '--campo', 'mapaTienda'],
      [...base, '--entorno', 'staging', '--campo', 'enlaceCatalogo'],
      [...base, '--campo', 'enlaceCatalogo', '--esperado', 'https://a.test', '--esperado', 'https://b.test'],
    ]) expect(correr(LEER, c).codigo, c.join(' ')).toBe(2);
    for (const sinHost of ['https:///', 'https:///ruta', 'https://', 'https:// x']) {
      expect(correr(LEER, leerArgs('enlaceCatalogo', ['--esperado', sinHost])).codigo, sinHost).toBe(2);
    }
    expect(correr(LEER, leerArgs('enlaceCatalogo', ['--esperado', 'https://x'])).codigo).toBe(0);
    expect(llamadas()).toBe(1);
  });

  it('NEGANDO: demos, ensayo y NovuChat, comercio o entorno inválidos y credenciales iguales', () => {
    for (const t of ['demo-venta', 'demo', 'novuchat', 'ensayo', '../x']) {
      expect(correr(LEER, ['--tenant', t, '--entorno', 'produccion', '--campo', 'enlaceCatalogo']).codigo, t).toBe(2);
    }
    expect(correr(LEER, ['--tenant', T, '--entorno', 'dev', '--campo', 'enlaceCatalogo']).codigo).toBe(2);
    adc(join(home, '.config', 'gcloud'), ID_PROD);
    expect(correr(LEER, leerArgs('enlaceCatalogo')).codigo).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('el código de salida del script de nodo se conserva (1: no existe o no pasa una comprobación)', () => {
    expect(correr(LEER, leerArgs('enlaceCatalogo'), { FAKE_SALIDA: '1' }).codigo).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('leer-config-negocio.mjs (script de nodo, con una base falsa)', () => {
  const PROY = 'demo-novuchat-pruebas';
  const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
  const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
  const URL_OK = 'https://tienda.ejemplo.test/catalogo/comercio-uno';

  /** Base falsa: anota cada pedido (documento y máscara) y NO tiene ningún método de escritura. */
  function baseDe(doc: Record<string, unknown> | null) {
    const pedidos: Array<{ ruta: string; mascara: string[] | undefined }> = [];
    const db = {
      doc: (ruta: string) => ({ ruta }),
      getAll: async (ref: { ruta: string }, op: { fieldMask?: string[] }) => {
        pedidos.push({ ruta: ref.ruta, mascara: op?.fieldMask });
        const datos = doc === null ? null : Object.fromEntries(Object.entries(doc).filter(([k]) => op?.fieldMask?.includes(k)));
        return [{ exists: datos !== null, data: () => (datos === null ? undefined : datos) }];
      },
    };
    return { db, pedidos };
  }
  const correrMjs = async (cfg: Cfg, doc: Record<string, unknown> | null) => {
    const b = baseDe(doc); const salida: string[] = [];
    const codigo = await mod.ejecutar(cfg, { db: b.db, log: (t: string) => salida.push(t) });
    return { codigo, salida: salida.join('\n'), pedidos: b.pedidos };
  };
  const cfgDe = (extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'emulador', tenant: T, campo: 'enlaceCatalogo', esperado: null, ...extra });

  it('la lista cerrada tiene EXACTAMENTE los cuatro campos públicos', () => {
    expect([...mod.CAMPOS_PERMITIDOS].sort()).toEqual(['enlaceCatalogo', 'horarioTienda', 'mapaTienda', 'ubicacionTienda']);
  });

  it('NEGANDO: un campo fuera de la lista se rechaza al analizar y, aunque se llame a ejecutar, no se lee nada', async () => {
    for (const c of ['waToken', 'apiKey', 'nombre', '__proto__', 'enlaceCatalogo.x', 'EnlaceCatalogo']) {
      const r = mod.analizarArgumentos(['--proyecto', PROY, '--tenant', T, '--campo', c], ENV_EMU);
      expect(r.ok, c).toBe(false);
      const m = await correrMjs(cfgDe({ campo: c }), { [c]: 'secreto' });
      expect(m.codigo, c).toBe(2);
      expect(m.pedidos, c).toHaveLength(0);
      expect(m.salida).not.toContain('secreto');
    }
  });

  it('NEGANDO: demos, ensayo y NovuChat, tenant inválido, opciones desconocidas o repetidas, y proyecto fuera de la lista blanca', () => {
    const arg = (a: string[], env: Record<string, string> = ENV_EMU) => mod.analizarArgumentos(a, env);
    for (const t of ['demo', 'demo-venta', 'novuchat', 'novuchat-x', 'ensayo']) {
      expect(arg(['--proyecto', PROY, '--tenant', t, '--campo', 'enlaceCatalogo']).ok, t).toBe(false);
    }
    expect(arg(['--proyecto', PROY, '--tenant', 'A/b', '--campo', 'enlaceCatalogo']).ok).toBe(false);
    expect(arg(['--proyecto', PROY, '--tenant', T, '--campo', 'enlaceCatalogo', '--aplicar']).ok).toBe(false);
    expect(arg(['--proyecto', PROY, '--tenant', T, '--campo', 'enlaceCatalogo', '--campo', 'mapaTienda']).ok).toBe(false);
    expect(arg(['--proyecto', PROY, '--tenant', T]).ok).toBe(false);
    expect(arg(['--proyecto', 'otro-proyecto-real', '--tenant', T, '--campo', 'enlaceCatalogo'], ENV_REAL).ok).toBe(false);
    expect(arg(['--proyecto', PROY, '--tenant', T, '--campo', 'mapaTienda', '--esperado', 'https://x.test']).ok).toBe(false);
  });

  it('--entorno toma el id de la lista blanca del ENTORNO (no de argv)', () => {
    const r = mod.analizarArgumentos(['--entorno', 'staging', '--tenant', T, '--campo', 'enlaceCatalogo'], ENV_REAL);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg?.['proyecto']).toBe(ENV_REAL.GCP_PROJECT_ID_STAGING);
    expect(mod.analizarArgumentos(['--entorno', 'staging', '--proyecto', PROY, '--tenant', T, '--campo', 'enlaceCatalogo'], ENV_REAL).ok).toBe(false);
  });

  it('lee UN solo documento con la máscara de UN solo campo: nada más sale del servidor', async () => {
    const m = await correrMjs(cfgDe(), { enlaceCatalogo: URL_OK, waToken: 'no-debe-salir', nombre: 'No debe salir' });
    expect(m.codigo, m.salida).toBe(0);
    expect(m.pedidos).toEqual([{ ruta: `tenants/${T}/config/negocio`, mascara: ['enlaceCatalogo'] }]);
    expect(m.salida).toContain(URL_OK);
    expect(m.salida).not.toContain('no-debe-salir'); expect(m.salida).not.toContain('No debe salir');
  });

  it('enlaceCatalogo: imprime la URL y las tres comprobaciones (sin barra final, https://, igual a la esperada)', async () => {
    const ok = await correrMjs(cfgDe({ esperado: URL_OK }), { enlaceCatalogo: URL_OK });
    expect(ok.codigo, ok.salida).toBe(0);
    expect(ok.salida).toContain('✓ sin barra final'); expect(ok.salida).toContain('✓ empieza por https://'); expect(ok.salida).toContain('✓ es exactamente igual a la URL esperada');
    const sinEsperado = await correrMjs(cfgDe(), { enlaceCatalogo: URL_OK });
    expect(sinEsperado.salida).not.toContain('igual a la URL esperada');
  });

  it('NEGANDO: barra final detectada, http en vez de https, distinta de la esperada, vacía o que no es texto: salida 1', async () => {
    const barra = await correrMjs(cfgDe(), { enlaceCatalogo: `${URL_OK}/` });
    expect(barra.codigo).toBe(1); expect(barra.salida).toContain('✗ sin barra final');
    const http = await correrMjs(cfgDe(), { enlaceCatalogo: 'http://tienda.ejemplo.test/c' });
    expect(http.codigo).toBe(1); expect(http.salida).toContain('✗ empieza por https://');
    const otra = await correrMjs(cfgDe({ esperado: URL_OK }), { enlaceCatalogo: `${URL_OK}x` });
    expect(otra.codigo).toBe(1); expect(otra.salida).toContain('✗ es exactamente igual a la URL esperada');
    for (const v of ['', 5, null, { a: 1 }]) expect((await correrMjs(cfgDe(), { enlaceCatalogo: v })).codigo, JSON.stringify(v)).toBe(1);
    expect(mod.comprobarEnlace(URL_OK, URL_OK).every((c) => c.ok)).toBe(true);
  });

  it('NEGANDO: comercio inexistente / sin config/negocio / sin el campo: mensaje claro y salida 1', async () => {
    const sinDoc = await correrMjs(cfgDe(), null);
    expect(sinDoc.codigo).toBe(1); expect(sinDoc.salida).toContain('no existe config/negocio');
    const sinCampo = await correrMjs(cfgDe(), { otroCampo: 'x' });
    expect(sinCampo.codigo).toBe(1); expect(sinCampo.salida).toContain('no está en config/negocio');
  });

  it('NEGANDO: un valor con secuencias ANSI u OSC (o U+2028/2029) se imprime con «?» en lugar de los controles: no se ejecuta en la terminal', async () => {
    const hostil = 'https://x.test/\u001b[31mroja\u001b[0m\u001b]52;c;QUJD\u0007 fin\u2028\u2029\u0000';
    for (const campo of ['enlaceCatalogo', 'horarioTienda', 'mapaTienda']) {
      const m = await correrMjs(cfgDe({ campo }), { [campo]: hostil });
      expect(m.salida, campo).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/);
      expect(m.salida).not.toContain('\u001b');
      expect(m.salida).toContain('?[31mroja');
    }
    const objeto = await correrMjs(cfgDe({ campo: 'ubicacionTienda' }), { ubicacionTienda: { a: '\u001b]52;c;Zg==\u0007' } });
    expect(objeto.salida).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(mod.mostrar('a\u001bb\u0085c\u2028d')).toBe('a?b?c?d');
  });

  it('--esperado exige un host: https:/// y https:// se rechazan al analizar', () => {
    for (const mala of ['https:///', 'https:///x', 'https://', 'https:// x']) {
      expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', T, '--campo', 'enlaceCatalogo', '--esperado', mala], ENV_EMU).ok, mala).toBe(false);
    }
    expect(mod.analizarArgumentos(['--proyecto', PROY, '--tenant', T, '--campo', 'enlaceCatalogo', '--esperado', 'https://x'], ENV_EMU).ok).toBe(true);
  });

  it('los otros campos públicos se muestran como texto (o JSON acotado) sin comprobaciones de URL', async () => {
    const t = await correrMjs(cfgDe({ campo: 'horarioTienda' }), { horarioTienda: 'Lunes a viernes 9:00 a 18:00' });
    expect(t.codigo).toBe(0); expect(t.salida).toContain('Lunes a viernes'); expect(t.salida).not.toContain('barra final');
    const o = await correrMjs(cfgDe({ campo: 'ubicacionTienda' }), { ubicacionTienda: { lat: -16.5, lng: -68.1 } });
    expect(o.codigo).toBe(0); expect(o.salida).toContain('"lat":-16.5');
  });

  it('SOLO LECTURA: el texto del script no importa ni llama a set, update, delete, runTransaction ni batch', () => {
    expect(existsSync(MJS)).toBe(true);
    const codigo = readFileSync(MJS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    expect(codigo).not.toMatch(/\.(set|update|create|delete|runTransaction|batch|bulkWriter|recursiveDelete|commit)\s*\(/);
    expect(codigo).not.toMatch(/\b(setDoc|updateDoc|deleteDoc|writeBatch|FieldValue|Timestamp)\b/);
    expect(codigo).not.toMatch(/\b(set|update|delete|runTransaction|batch)\b\s*:/);
    // La única lectura es `getAll` con máscara de campo.
    expect(codigo.match(/\.getAll\(/g)).toHaveLength(1);
    expect(codigo).toMatch(/fieldMask:\s*\[cfg\.campo\]/);
  });

  it('el envoltorio de lectura no importa ni abre otra cosa que el script de lectura', () => {
    const fuente = readFileSync(LEER, 'utf8');
    expect(fuente).toContain('scripts/plataforma/leer-config-negocio.mjs');
    expect(fuente).not.toMatch(/fijar-|aplicar-|resetear-/);
  });
});
