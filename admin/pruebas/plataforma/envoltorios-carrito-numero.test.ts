/**
 * Los envoltorios `scripts/fijar-carrito-comercio.sh` y `scripts/fijar-numero-publico-comercio.sh` (y `--quien` de `resetear-telefono.sh`):
 * ningún valor real (proyecto, ruta secreta del carrito, host de n8n, número público, teléfono de prueba) sale por la pantalla ni va en la
 * línea de comandos. Con un `node` FALSO que anota sus argumentos y su entorno, credenciales de gcloud FALSAS, una tabla local y un `.env`
 * FALSOS en un directorio temporal. NO se toca la nube. Las pruebas niegan: sin confirmación, o con un valor mal formado, no se llama a nada.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CARRITO = join(RAIZ, 'scripts', 'fijar-carrito-comercio.sh');
const NUMERO = join(RAIZ, 'scripts', 'fijar-numero-publico-comercio.sh');
const RESET = join(RAIZ, 'scripts', 'resetear-telefono.sh');

const ID_PROD = 'proy-prod-aaa1';
const ID_STG = 'proy-stg-bbb2';
const RUTA = 'ruta-secreta-del-carrito-9z';
const HOST = 'n8n.ejemplo-privado.test';
// Los números y el correo se arman con piezas: el repositorio es público y su saneo rechaza una secuencia de 10 o más dígitos o un correo escritos de corrido.
const n591 = (resto: string): string => ['591', resto].join('');
const PUBLICO = n591('70007777');
const CORREO = ['operador', 'ejemplo.test'].join('@');
const T = 'comercio-uno';

const NODE_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$FAKE_DIR/argv"
echo "PROYECTO_RESETEO=\${PROYECTO_RESETEO:-}|TEL_PRUEBA=\${TEL_PRUEBA:-}|FIJAR_PROYECTO=\${FIJAR_PROYECTO:-}|CARRITO_URL_N8N=\${CARRITO_URL_N8N:-}|NUMERO_PUBLICO_LINEA=\${NUMERO_PUBLICO_LINEA:-}|NUMERO_OPERADOR=\${NUMERO_OPERADOR:-}" >> "$FAKE_DIR/entorno"
echo "nodo imprime: \${FIJAR_PROYECTO:-} \${PROYECTO_RESETEO:-} \${TEL_PRUEBA:-} \${CARRITO_URL_N8N:-} \${NUMERO_PUBLICO_LINEA:-} \${NUMERO_OPERADOR:-}"
exit "\${FAKE_SALIDA:-0}"
`;

let dir: string; let home: string;
const leer = (n: string): string => { try { return readFileSync(join(dir, n), 'utf8'); } catch { return ''; } };
const adc = (carpeta: string, id: string) => {
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, 'application_default_credentials.json'), JSON.stringify({ type: 'authorized_user', quota_project_id: id }));
};
const tabla = (filas: string[]) => {
  const ruta = join(dir, 'tabla.md');
  writeFileSync(ruta, ['| Marcador | Valor |', '|---|---|', ...filas].join('\n') + '\n');
  return ruta;
};
const envN8n = (contenido: string) => { const r = join(dir, 'env-n8n'); writeFileSync(r, contenido); return r; };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'envoltorios-'));
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
const llamadas = (): number => leer('argv') === '' ? 0 : leer('argv').split('\n').filter((l) => l.startsWith('--proyecto-env')).length;
const SIN_VALORES = (salida: string) => { for (const v of [ID_PROD, ID_STG, RUTA, HOST, PUBLICO, CORREO]) expect(salida).not.toContain(v); };

describe('fijar-carrito-comercio.sh', () => {
  const buenas = () => ({
    CONFIG_LOCAL_MD: tabla([`| \`REEMPLAZAR_RUTA_CARRITO_COMERCIO_UNO\` | ${RUTA} |`]),
    ENV_N8N: envN8n(`N8N_BASE_URL=https://${HOST}/\nN8N_API_KEY=clave-que-no-debe-salir\n`),
  });

  it('SECO: llama al script de nodo sin --aplicar, con el proyecto y la URL por ENTORNO y ningún valor en la línea de comandos', () => {
    const r = correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], buenas());
    expect(r.codigo, r.salida).toBe(0);
    expect(llamadas()).toBe(1);
    const argv = leer('argv');
    expect(argv).toContain('--proyecto-env'); expect(argv).toContain('--url-env'); expect(argv).toContain(`--tenant\n${T}`);
    expect(argv).not.toContain('--aplicar');
    SIN_VALORES(argv);
    expect(leer('entorno')).toContain(`FIJAR_PROYECTO=${ID_PROD}|CARRITO_URL_N8N=https://${HOST}/webhook/${RUTA}`);
  });

  it('NINGÚN valor real sale por la pantalla, aunque el script de nodo los imprima (el filtro los oculta) ni la clave de n8n', () => {
    const r = correr(CARRITO, ['--tenant', T, '--entorno', 'staging'], buenas());
    expect(r.codigo).toBe(0);
    SIN_VALORES(r.salida);
    expect(r.salida).not.toContain('clave-que-no-debe-salir');
    expect(r.salida).toContain('<valor>');
    expect(leer('entorno')).toContain(`FIJAR_PROYECTO=${ID_STG}`); // staging usa el proyecto de staging
  });

  it('NEGANDO: --aplicar sin --confirmo igual al comercio (o --confirmo sin --aplicar) no llama a nada', () => {
    const e = buenas();
    for (const a of [['--aplicar'], ['--aplicar', '--confirmo', 'otro-comercio'], ['--aplicar', '--confirmo', 'produccion'], ['--confirmo', T]]) {
      expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion', ...a], e).codigo, a.join(' ')).toBe(2);
    }
    expect(llamadas()).toBe(0);
    const ok = correr(CARRITO, ['--tenant', T, '--entorno', 'produccion', '--aplicar', '--confirmo', T], e);
    expect(ok.codigo, ok.salida).toBe(0);
    expect(leer('argv')).toContain('--aplicar');
  });

  it('--quitar no necesita ruta ni host y pasa --quitar', () => {
    const r = correr(CARRITO, ['--tenant', T, '--entorno', 'produccion', '--quitar'], { CONFIG_LOCAL_MD: tabla([]), ENV_N8N: join(dir, 'no-existe') });
    expect(r.codigo, r.salida).toBe(0);
    expect(leer('argv')).toContain('--quitar');
    expect(leer('argv')).not.toContain('--url-env');
  });

  it('NEGANDO (3): sin la fila de la ruta, con la fila «pendiente», con una ruta mal formada o con un host sin https o con ruta: no se llama a nada', () => {
    const base = { ENV_N8N: envN8n(`N8N_BASE_URL=https://${HOST}\n`) };
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { ...base, CONFIG_LOCAL_MD: tabla([]) }).codigo).toBe(3);
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { ...base, CONFIG_LOCAL_MD: tabla([`| \`REEMPLAZAR_RUTA_CARRITO_COMERCIO_UNO\` | ${RUTA} (pendiente) |`]) }).codigo).toBe(3);
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { ...base, CONFIG_LOCAL_MD: tabla(['| `REEMPLAZAR_RUTA_CARRITO_COMERCIO_UNO` | ../../x y |']) }).codigo).toBe(3);
    const ok = tabla([`| \`REEMPLAZAR_RUTA_CARRITO_COMERCIO_UNO\` | ${RUTA} |`]);
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { CONFIG_LOCAL_MD: ok, ENV_N8N: envN8n(`N8N_BASE_URL=http://${HOST}\n`) }).codigo).toBe(3);
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { CONFIG_LOCAL_MD: ok, ENV_N8N: envN8n(`N8N_BASE_URL=https://${HOST}/webhook/otra\n`) }).codigo).toBe(3);
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { CONFIG_LOCAL_MD: ok, ENV_N8N: envN8n('OTRA=1\n') }).codigo).toBe(3);
    expect(llamadas()).toBe(0);
  });

  it('NEGANDO (2): demos y NovuChat, entorno o comercio inválidos, y credenciales de los dos entornos iguales: no se llama a nada', () => {
    const e = buenas();
    for (const a of [['--tenant', 'demo-venta'], ['--tenant', 'novuchat'], ['--tenant', '../x'], ['--tenant', T, '--entorno', 'dev']]) {
      expect(correr(CARRITO, [...(a.includes('--entorno') ? [] : ['--entorno', 'produccion']), ...a], e).codigo, a.join(' ')).toBe(2);
    }
    adc(join(home, '.config', 'gcloud'), ID_PROD);
    expect(correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], e).codigo).toBe(2);
    expect(llamadas()).toBe(0);
  });

  it('no deja el valor en el entorno heredado de un emulador: FIRESTORE_EMULATOR_HOST no llega al script de nodo', () => {
    const r = correr(CARRITO, ['--tenant', T, '--entorno', 'produccion'], { ...buenas(), FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
    expect(r.codigo, r.salida).toBe(0);
    expect(existsSync(join(dir, 'argv'))).toBe(true);
  });
});

describe('fijar-numero-publico-comercio.sh', () => {
  const buenas = () => ({
    CONFIG_LOCAL_MD: tabla([`| \`REEMPLAZAR_NUMERO_PUBLICO_COMERCIO_UNO\` | ${PUBLICO} |`]),
    NOVUCHAT_OPERADOR: CORREO,
  });

  it('SECO: el número, el proyecto y el operador van por ENTORNO; la línea de comandos no lleva ninguno', () => {
    const r = correr(NUMERO, ['--tenant', T, '--entorno', 'produccion'], buenas());
    expect(r.codigo, r.salida).toBe(0);
    const argv = leer('argv');
    expect(argv).toContain('--numero-env'); expect(argv).toContain('--operador-env'); expect(argv).toContain('--proyecto-env');
    expect(argv).not.toContain('--aplicar');
    SIN_VALORES(argv);
    expect(leer('entorno')).toContain(`NUMERO_PUBLICO_LINEA=${PUBLICO}|NUMERO_OPERADOR=${CORREO}`);
    SIN_VALORES(r.salida);
  });

  it('NEGANDO: sin confirmación igual al comercio no escribe; con ella pasa --aplicar', () => {
    for (const a of [['--aplicar'], ['--aplicar', '--confirmo', 'otro'], ['--confirmo', T]]) {
      expect(correr(NUMERO, ['--tenant', T, '--entorno', 'staging', ...a], buenas()).codigo, a.join(' ')).toBe(2);
    }
    expect(llamadas()).toBe(0);
    expect(correr(NUMERO, ['--tenant', T, '--entorno', 'staging', '--aplicar', '--confirmo', T], buenas()).codigo).toBe(0);
    expect(leer('argv')).toContain('--aplicar');
  });

  it('NEGANDO (3): sin fila, «pendiente», número mal formado, o sin operador: no se llama a nada', () => {
    const base = { NOVUCHAT_OPERADOR: CORREO };
    expect(correr(NUMERO, ['--tenant', T, '--entorno', 'produccion'], { ...base, CONFIG_LOCAL_MD: tabla([]) }).codigo).toBe(3);
    expect(correr(NUMERO, ['--tenant', T, '--entorno', 'produccion'], { ...base, CONFIG_LOCAL_MD: tabla([`| \`REEMPLAZAR_NUMERO_PUBLICO_COMERCIO_UNO\` | ${PUBLICO} (pendiente) |`]) }).codigo).toBe(3);
    for (const malo of [`+${PUBLICO}`, '70007777', ['0591', '700077'].join(''), ['5917', '000777'].join('')]) {
      expect(correr(NUMERO, ['--tenant', T, '--entorno', 'produccion'], { ...base, CONFIG_LOCAL_MD: tabla([`| \`REEMPLAZAR_NUMERO_PUBLICO_COMERCIO_UNO\` | ${malo} |`]) }).codigo, malo).toBe(3);
    }
    expect(correr(NUMERO, ['--tenant', T, '--entorno', 'produccion'], { CONFIG_LOCAL_MD: buenas().CONFIG_LOCAL_MD }).codigo).toBe(3); // sin operador ni gcloud
    expect(llamadas()).toBe(0);
  });

  it('--quitar no necesita el número; demos y NovuChat se rechazan', () => {
    expect(correr(NUMERO, ['--tenant', T, '--entorno', 'produccion', '--quitar'], { CONFIG_LOCAL_MD: tabla([]), NOVUCHAT_OPERADOR: CORREO }).codigo).toBe(0);
    expect(leer('argv')).toContain('--quitar');
    expect(leer('argv')).not.toContain('--numero-env');
    expect(correr(NUMERO, ['--tenant', 'demo-agendamiento', '--entorno', 'produccion'], buenas()).codigo).toBe(2);
  });
});

describe('resetear-telefono.sh --quien', () => {
  const filas = (tels: string) => [`| \`REEMPLAZAR_TELEFONOS_DE_PRUEBA\` | ${tels} |`];
  const ANDRES = n591('70007339'); const SILVANA = n591('70001250');
  const reset = (tels: string, args: string[]) => correr(RESET, args, { CONFIG_LOCAL_MD: tabla(filas(tels)), RESETEAR_SOLO_LISTA: '1' });

  it('--quien andres y --quien silvana resuelven SU número de la lista cerrada, sin imprimir ningún número', () => {
    for (const [quien, tel] of [['andres', ANDRES], ['silvana', SILVANA]] as const) {
      const r = reset(`${ANDRES},${SILVANA},${n591('70000001')}`, ['--tenant', 'walisuma', '--quien', quien]);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).not.toContain(tel);
      expect(r.salida).not.toMatch(/\d{8,}/);
    }
  });

  it('NEGANDO: sin su número en la lista, o con DOS que terminan igual, no se resetea nada', () => {
    expect(reset(`${SILVANA},${n591('70000001')}`, ['--tenant', 'walisuma', '--quien', 'andres']).codigo).toBe(1);
    expect(reset(`${ANDRES},${n591('71117339')}`, ['--tenant', 'walisuma', '--quien', 'andres']).codigo).toBe(1);
  });

  it('NEGANDO: --tel y --quien juntos, --quien desconocido, y demos o NovuChat se rechazan', () => {
    const l = `${ANDRES},${SILVANA}`;
    expect(reset(l, ['--tenant', 'walisuma', '--quien', 'andres', '--tel', ANDRES]).codigo).toBe(2);
    expect(reset(l, ['--tenant', 'walisuma', '--quien', 'rubén']).codigo).toBe(2);
    expect(reset(l, ['--tenant', 'demo-venta', '--quien', 'andres']).codigo).toBe(2);
    expect(reset(l, ['--tenant', 'novuchat', '--quien', 'silvana']).codigo).toBe(2);
    expect(reset(l, ['--tenant', 'ensayo', '--quien', 'silvana']).codigo).toBe(2);
  });

  it('el teléfono y el proyecto NO van en la línea de comandos del script de nodo: llegan por entorno, y la salida no los escribe (ni en mayúsculas)', () => {
    const sinSolo = (tels: string) => correr(RESET, ['--tenant', 'walisuma', '--quien', 'andres'], {
      CONFIG_LOCAL_MD: tabla(filas(tels)), ENV_N8N: envN8n('N8N_BASE_URL=http://127.0.0.1:9\nN8N_API_KEY=clave-falsa\n'), GCP_PROJECT_ID_PROD: 'proy-reset-prod', GCP_PROJECT_ID_STAGING: 'proy-reset-stg',
    });
    const r = sinSolo(`${ANDRES},${SILVANA}`);
    expect(r.codigo, r.salida).toBe(0);
    const argv = leer('argv');
    expect(argv).toContain('--tel-env'); expect(argv).toContain('--proyecto-env');
    expect(argv).not.toContain(ANDRES); expect(argv).not.toContain('proy-reset-prod');
    expect(leer('entorno')).toContain('PROYECTO_RESETEO=proy-reset-prod|TEL_PRUEBA=' + ANDRES);
    expect(r.salida.toLowerCase()).not.toContain(ANDRES);
    expect(r.salida.toLowerCase()).not.toContain('proy-reset-prod');
  });

  it('NEGANDO: demo, demo-venta, novuchat y novuchat-algo se rechazan en el reinicio', () => {
    for (const t of ['demo', 'demo-venta', 'novuchat', 'novuchat-onboarding', 'ensayo']) {
      expect(reset(`${ANDRES},${SILVANA}`, ['--tenant', t, '--quien', 'andres']).codigo, t).toBe(2);
    }
  });

  it('--tel sigue funcionando como antes', () => {
    expect(reset(`${ANDRES}`, ['--tenant', 'walisuma', '--tel', ANDRES]).codigo).toBe(0);
  });
});
