/**
 * `scripts/cotejar-ids-ajenos.sh`: la regla «toda huella se coteja contra los
 * .env de NovuChat antes de entrar a una lista del candado» (PR #313, el error
 * del número de la Fase 0), hecha repetible.
 *
 * Se prueba negando: el script tiene que DETECTAR una coincidencia (si dejara de
 * mirar una clave o una lista, esta suite falla), tiene que callar el id, y
 * tiene que leer el .env como datos, sin ejecutarlo. Sin red: los ids son de
 * prueba, y las listas vigentes se amplían con las variables `*_EXTRA` del
 * candado, que solo pueden agregar.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', '..', '..', 'scripts', 'cotejar-ids-ajenos.sh');
const sha = (id: string) => createHash('sha256').update(id).digest('hex');
// Con «:» cada 8, como las listas del candado.
const agrupada = (h: string) => h.match(/.{8}/g)!.join(':');

const APP = '918273645';
const NUMERO = '564738291';
const WABA = '192837465';
const INOCENTE = '123456789';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cotejar-ids-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function env(nombre: string, lineas: string[]) {
  const ruta = join(dir, nombre);
  writeFileSync(ruta, `${lineas.join('\n')}\n`);
  return ruta;
}

function correr(args: string[], extra: Record<string, string> = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: entornoDelEmulador(undefined, extra),
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

const LISTAS = {
  NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA: agrupada(sha(APP)),
  NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA: agrupada(sha(NUMERO)),
  NOVUCHAT_WABAS_AJENAS_HUELLAS_EXTRA: agrupada(sha(WABA)),
};

describe('cotejar-ids-ajenos.sh', () => {
  it('con ids que no están en ninguna lista sale 0 y no coincide nada', () => {
    const f = env('.env.uno', [`WA_APP_ID=${INOCENTE}`, `WA_PHONE_ID=${INOCENTE}1`, `WABA_ID=${INOCENTE}2`]);
    const r = correr(['--env', f], LISTAS);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Ningún id');
    expect(r.salida).toContain('3 id(s) revisados');
  });

  it.each([
    ['WA_APP_ID', APP, 'apps'],
    ['WA_PHONE_ID', NUMERO, 'números'],
    ['WABA_ID', WABA, 'WABAs'],
  ])('%s en la lista vigente: sale 1 y dice cuál lista', (clave, id, lista) => {
    const f = env('.env.uno', [`${clave}=${id}`]);
    const r = correr(['--env', f], LISTAS);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(`COINCIDE con la lista vigente de ${lista}`);
  });

  it('una clave se mira solo contra SU lista: el id de una app puesto como WABA_ID no coincide', () => {
    const f = env('.env.uno', [`WABA_ID=${APP}`]);
    expect(correr(['--env', f], LISTAS).codigo).toBe(0);
  });

  it('nunca imprime un id: solo los últimos 4 dígitos', () => {
    const f = env('.env.uno', [`WA_APP_ID=${APP}`, `WA_PHONE_ID=${NUMERO}`, `WABA_ID=${WABA}`]);
    const r = correr(['--env', f], LISTAS);
    for (const id of [APP, NUMERO, WABA]) {
      expect(r.salida).not.toContain(id);
      expect(r.salida).toContain(`…${id.slice(-4)}`);
    }
  });

  describe('--candidata (antes de agregar una huella)', () => {
    it('una huella que coincide con un id de un .env: sale 1 y avisa que no se agregue', () => {
      const f = env('.env.demo', [`WA_PHONE_ID=${INOCENTE}`]);
      const r = correr(['--env', f, '--candidata', sha(INOCENTE)]);
      expect(r.codigo).toBe(1);
      expect(r.salida).toContain('COINCIDE con la huella candidata');
      expect(r.salida).toContain('NO se agrega');
      expect(r.salida).not.toContain(INOCENTE);
    });

    it('la candidata agrupada con «:» también se compara', () => {
      const f = env('.env.demo', [`WABA_ID=${INOCENTE}`]);
      expect(correr(['--env', f, '--candidata', agrupada(sha(INOCENTE))]).codigo).toBe(1);
    });

    it('una huella que no coincide con ningún .env: sale 0', () => {
      const f = env('.env.demo', [`WA_PHONE_ID=${INOCENTE}`]);
      expect(correr(['--env', f, '--candidata', sha('999999999')]).codigo).toBe(0);
    });

    it('acepta varias candidatas, y basta una que coincida', () => {
      const f = env('.env.demo', [`WA_APP_ID=${INOCENTE}`]);
      const r = correr(['--env', f, '--candidata', sha('999999999'), '--candidata', sha(INOCENTE)]);
      expect(r.codigo).toBe(1);
    });

    it.each(['no-es-hex', 'abc', sha('x').slice(1), `${sha('x')}00000`, '１'.repeat(64), 'á'.repeat(64)])('rechaza «%s»: sale 2', (mala) => {
      const f = env('.env.demo', [`WA_APP_ID=${INOCENTE}`]);
      expect(correr(['--env', f, '--candidata', mala]).codigo).toBe(2);
    });
  });

  describe('lee el .env como datos', () => {
    it('no ejecuta el archivo: un comando dentro no corre', () => {
      const marca = join(dir, 'ejecutado');
      const f = env('.env.hostil', [`touch ${marca}`, `$(touch ${marca})`, `WA_APP_ID=${INOCENTE}`]);
      const r = correr(['--env', f]);
      expect(r.codigo).toBe(0);
      expect(existsSync(marca)).toBe(false);
    });

    it('entiende export, comillas, espacios y retorno de carro', () => {
      const f = env('.env.formas', [`export WA_APP_ID="${APP}"\r`, `WA_PHONE_ID = '${NUMERO}'`, `  WABA_ID=${WABA}  `]);
      const r = correr(['--env', f], LISTAS);
      expect(r.codigo).toBe(1);
      expect(r.salida.match(/COINCIDE con la lista vigente/g)).toHaveLength(3);
    });

    it('si una clave aparece dos veces vale la última, como en el .env cargado', () => {
      const f = env('.env.dos', [`WA_APP_ID=${APP}`, `WA_APP_ID=${INOCENTE}`]);
      expect(correr(['--env', f], LISTAS).codigo).toBe(0);
    });


    it('un comentario con una clave no cuenta', () => {
      const f = env('.env.comentado', [`# WA_APP_ID=${APP}`, `WABA_ID=${INOCENTE}`]);
      expect(correr(['--env', f], LISTAS).codigo).toBe(0);
    });
  });

  describe('falla cerrado: «no coincide» solo se dice cuando se demostró (revisión de seguridad)', () => {
    const CAND = sha(INOCENTE);

    // Formas que `source` entiende y el script tiene que entender igual: si no,
    // una huella candidata de un id propio pasaría con exit 0.
    it.each([
      ['comentario al final de la línea', `WA_PHONE_ID=${INOCENTE} # demo A`],
      ['entre comillas y comentario', `WA_PHONE_ID="${INOCENTE}" # x`],
      ['punto y coma al final', `WA_PHONE_ID=${INOCENTE};`],
      ['readonly delante', `readonly WA_PHONE_ID=${INOCENTE}`],
      ['declare -x delante', `declare -x WA_PHONE_ID=${INOCENTE}`],
      ['BOM al principio del archivo', `\uFEFFWA_PHONE_ID=${INOCENTE}`],
      ['sangría', `    WA_PHONE_ID=${INOCENTE}`],
    ])('reconoce el id con %s', (_n, linea) => {
      const f = env('.env.forma', [linea]);
      const r = correr(['--env', f, '--candidata', CAND]);
      expect(r.codigo).toBe(1);
      expect(r.salida).toContain('COINCIDE con la huella candidata');
    });

    it('un archivo binario (con un byte NUL) se lee igual, no se salta', () => {
      const f = join(dir, '.env.binario');
      writeFileSync(f, Buffer.concat([Buffer.from('\0\n'), Buffer.from(`WA_PHONE_ID=${INOCENTE}\n`)]));
      expect(correr(['--env', f, '--candidata', CAND]).codigo).toBe(1);
    });

    // Una clave presente cuyo valor no se entiende como id: no se puede decir
    // que nada coincide. Sale 2, y nunca repite el valor.
    it.each([
      ['una variable', 'WA_PHONE_ID=${OTRO}'],
      ['una sustitución', 'WA_PHONE_ID=$(echo 1)'],
      ['vacío', 'WA_PHONE_ID='],
      ['letras', 'WA_APP_ID=abc'],
      ['demasiado corto', 'WABA_ID=12'],
      ['pegado a otro texto', `WA_APP_ID=${INOCENTE}x`],
    ])('una clave presente con %s: sale 2 y no dice «todo bien»', (_n, linea) => {
      const f = env('.env.raro', [linea]);
      const r = correr(['--env', f, '--candidata', CAND]);
      expect(r.codigo).toBe(2);
      expect(r.salida).toContain('NO se pudo cotejar');
      expect(r.salida).not.toContain('✓');
      expect(r.salida).not.toContain(INOCENTE);
    });

    // Segunda ronda de seguridad: líneas que `source` lee distinto de lo que parece
    // a simple vista. Ninguna puede dar 0 con la huella del id a la vista.
    it.each([
      ['un prefijo parecido y luego la clave', `X_WA_PHONE_ID=111111111 WA_PHONE_ID=${INOCENTE}`],
      ['dos asignaciones en la misma línea', `WA_PHONE_ID=111111111 WA_PHONE_ID=${INOCENTE}`],
      ['dos asignaciones separadas por «;»', `WA_PHONE_ID=111111111;WA_PHONE_ID=${INOCENTE}`],
      ['el valor partido por una comilla', `WA_PHONE_ID="${INOCENTE.slice(0, 4)}"${INOCENTE.slice(4)}`],
      ['la clave dentro de otro valor', `NOTA="ver WA_PHONE_ID=${INOCENTE}"`],
      ['comilla sin cerrar', `WA_PHONE_ID="${INOCENTE}`],
    ])('%s: sale 2, nunca 0', (_n, linea) => {
      const f = env('.env.ambiguo', [linea]);
      const r = correr(['--env', f, '--candidata', sha(INOCENTE)]);
      expect(r.codigo).toBe(2);
      expect(r.salida).not.toContain('✓');
    });

    it('una asignación con «+=» (source concatena y el cotejo no) hace ambiguo el archivo: sale 2', () => {
      const f = env('.env.concatena', [`WA_PHONE_ID=${INOCENTE}`, 'WA_PHONE_ID+=5678']);
      const r = correr(['--env', f, '--candidata', sha(INOCENTE)]);
      expect(r.codigo).toBe(2);
      expect(r.salida).not.toContain('✓');
    });

    it('una línea de más de 4 KiB que nombra la clave: sale 2 sin tardar', () => {
      const f = env('.env.larga', [`WA_PHONE_ID=${INOCENTE} # ${'x'.repeat(5000)}`]);
      const r = correr(['--env', f, '--candidata', sha(INOCENTE)]);
      expect(r.codigo).toBe(2);
      expect(r.salida).not.toContain('✓');
    });

    it('la clave en el comentario del final de OTRA línea hace ambiguo el archivo: sale 2', () => {
      const f = env('.env.ambiguo', [`WA_PHONE_ID=${INOCENTE}`, `OTRA=1 # WA_PHONE_ID=111111111`]);
      expect(correr(['--env', f, '--candidata', sha(INOCENTE)]).codigo).toBe(2);
    });

    it('«;» y un comentario tras el valor siguen siendo una sola asignación', () => {
      const f = env('.env.ok', [`WA_PHONE_ID=${INOCENTE}; # demo`]);
      expect(correr(['--env', f, '--candidata', sha(INOCENTE)]).codigo).toBe(1);
    });

    it('--dir con un valor vacío: sale 2, no cae a la carpeta principal', () => {
      expect(correr(['--dir', '']).codigo).toBe(2);
    });

    it('una clave ilegible junto a otra legible que no coincide: sale 2, no 0', () => {
      const f = env('.env.mixto', [`WA_APP_ID=${INOCENTE}`, 'WA_PHONE_ID=${OTRO}']);
      expect(correr(['--env', f]).codigo).toBe(2);
    });

    it('un id legible que coincide gana sobre una clave ilegible en otro lado: sale 1', () => {
      const f = env('.env.mixto', [`WA_APP_ID=${APP}`, 'WA_PHONE_ID=${OTRO}']);
      expect(correr(['--env', f], LISTAS).codigo).toBe(1);
    });

    it('un archivo sin ninguna de las tres claves no es error, pero solo, no demuestra nada: sale 2', () => {
      const f = env('.env.sinclaves', ['N8N_BASE_URL=https://n8n.invalid']);
      const r = correr(['--env', f]);
      expect(r.codigo).toBe(2);
      expect(r.salida).toContain('No se revisó ningún id');
    });

    it('un archivo sin claves junto a otro con ids no impide el cotejo: sale 0', () => {
      const a = env('.env.sinclaves', ['N8N_BASE_URL=https://n8n.invalid']);
      const b = env('.env.uno', [`WA_APP_ID=${INOCENTE}`]);
      expect(correr(['--env', a, '--env', b]).codigo).toBe(0);
    });

    it.skipIf(process.getuid?.() === 0)('un archivo ilegible: sale 2', () => {
      const f = env('.env.cerrado', [`WA_APP_ID=${INOCENTE}`]);
      chmodSync(f, 0o000);
      expect(correr(['--env', f]).codigo).toBe(2);
    });

    it('si python3 no contesta, sale 3 y no dice «todo bien»', () => {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 1\n');
      chmodSync(join(bin, 'python3'), 0o755);
      const f = env('.env.uno', [`WA_APP_ID=${INOCENTE}`]);
      const r = correr(['--env', f], { PATH: `${bin}:${process.env.PATH ?? ''}` });
      expect(r.codigo).toBe(3);
      expect(r.salida).not.toContain('✓');
    });
  });

  describe('no revela ids por ninguna vía', () => {
    it('de un id solo se ven los últimos 4 dígitos, ni siquiera los primeros', () => {
      const f = env('.env.uno', [`WA_APP_ID=${APP}`]);
      const r = correr(['--env', f], LISTAS);
      expect(r.salida).toContain(`…${APP.slice(-4)}`);
      expect(r.salida).not.toContain(APP.slice(0, 5));
    });

    it('un argumento desconocido, que podría ser un id pegado por error, no se repite', () => {
      const r = correr([NUMERO]);
      expect(r.codigo).toBe(2);
      expect(r.salida).not.toContain(NUMERO);
    });

    it.each(['--dir', '--env', '--candidata'])('%s sin valor: sale 2 (no 1, que significa «coincide»)', (opcion) => {
      expect(correr([opcion]).codigo).toBe(2);
    });
  });

  describe('qué archivos mira', () => {
    it('con --dir toma .env y .env.* y se salta los .example', () => {
      env('.env', [`WA_APP_ID=${INOCENTE}`]);
      env('.env.cliente', [`WA_APP_ID=${INOCENTE}`]);
      env('.env.example', [`WA_APP_ID=${APP}`]);
      const r = correr(['--dir', dir], LISTAS);
      expect(r.codigo).toBe(0);
      expect(r.salida).toContain('2 archivo(s)');
    });

    it('con --dir encuentra la coincidencia en cualquiera de los archivos', () => {
      env('.env', [`WA_APP_ID=${INOCENTE}`]);
      env('.env.cliente', [`WABA_ID=${WABA}`]);
      const r = correr(['--dir', dir], LISTAS);
      expect(r.codigo).toBe(1);
      expect(r.salida).toContain('.env.cliente');
    });

    it.each([
      ['carpeta inexistente', ['--dir', '/no/existe/jamas']],
      ['--env que no existe', ['--env', '/no/existe/jamas/.env']],
    ])('%s: sale 2', (_n, args) => {
      expect(correr(args).codigo).toBe(2);
    });

    it('una carpeta sin ningún .env: sale 2, no un falso «todo bien»', () => {
      expect(correr(['--dir', dir]).codigo).toBe(2);
    });

    it('un argumento desconocido: sale 2', () => {
      expect(correr(['--loquesea']).codigo).toBe(2);
    });
  });

  it('con las listas vigentes de verdad, un .env de prueba no coincide (las huellas reales no son de ids de prueba)', () => {
    const f = env('.env.uno', [`WA_APP_ID=${INOCENTE}`, `WA_PHONE_ID=${INOCENTE}1`, `WABA_ID=${INOCENTE}2`]);
    expect(correr(['--env', f]).codigo).toBe(0);
  });
});
