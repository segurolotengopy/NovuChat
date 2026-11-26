/**
 * `scripts/catalogo-externo.sh`: el envoltorio que enciende el catálogo externo de UN comercio sin mostrar el id del
 * proyecto. La lógica (seco, respaldo, precondición, vuelta atrás) es de `aplicar-catalogo-externo.mjs` y la prueba
 * `aplicar-catalogo-externo.test.ts`. Aquí se prueba lo que decide el envoltorio, NEGANDO, con un `node` y un `gh` de
 * mentira en el PATH (registran lo que reciben e imprimen los ids a propósito):
 *   · el seco no lleva --aplicar ni --respaldo: no puede escribir;
 *   · sin --confirmo <entorno> no se llama a Node; un entorno equivocado se rechaza antes de llamarlo;
 *   · cada id tiene que dar la huella de su entorno (un tercer proyecto no pasa) y producción, además, cruzarse con el
 *     quota_project_id; el id NUNCA aparece en la salida ni en argv: Node recibe `--entorno` y los ids solo en su
 *     entorno, con todo lo heredado desexportado;
 *   · producción agrega --confirmo-produccion <tenant>; el respaldo va en una carpeta 0700 del usuario fuera del repo, y
 *     --revertir solo acepta un respaldo de esa carpeta.
 * Se corre una COPIA del envoltorio con las huellas de los ids de prueba y la carpeta de respaldos en un directorio
 * temporal (nada en /var/tmp), y la carpeta de gcloud fija en la de mentira; el resto del archivo es idéntico. El hijo
 * corre con `entornoDelEmulador` (regla de hijos-hermeticos): credenciales inexistentes y sin metadatos, más lo propio
 * de cada caso. Ids de prueba, no reales.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ORIGINAL = join(AQUI, '../../../scripts/catalogo-externo.sh');
const ADMIN = join(AQUI, '../..');
const PROD = 'proyecto-prod-prueba';
const STG = 'proyecto-stg-prueba';
const huella = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12);
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

interface Opciones {
  cuota?: string | null; env?: Record<string, string | undefined>; ghStg?: string; ghProd?: string; salidaNode?: number;
  bash?: string[]; nodeReal?: boolean; antes?: (base: string) => void; nodeEspera?: boolean; sinTrampa?: boolean;
}
interface Llamada { argv: string[]; cwd: string; env: Record<string, string | null> }

function preparar(args: string[], o: Opciones = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'novuchat-catext-')); dirs.push(dir);
  // La copia: huellas de los ids de prueba y carpeta de respaldos dentro de `dir`.
  const repo = join(dir, 'repo'); mkdirSync(join(repo, 'scripts'), { recursive: true });
  symlinkSync(ADMIN, join(repo, 'admin'));
  const base = join(dir, 'respaldos-base'); mkdirSync(base);
  const original = readFileSync(ORIGINAL, 'utf8');
  const gcloud = join(dir, 'gcloud'); mkdirSync(gcloud);
  const copia = original
    .replace(/^readonly HUELLA_STAGING="[0-9a-f]{12}"$/m, `readonly HUELLA_STAGING="${huella(STG)}"`)
    .replace(/^readonly HUELLA_PROD="[0-9a-f]{12}"$/m, `readonly HUELLA_PROD="${huella(PROD)}"`)
    .replace(/^readonly BASE_RESPALDOS="\/var\/tmp"$/m, `readonly BASE_RESPALDOS="${base}"`)
    // El entorno hermético fija CLOUDSDK_CONFIG en una ruta inexistente: la copia lee la carpeta de gcloud de mentira.
    .replace(/^CONFIG_GCLOUD="\$\{CLOUDSDK_CONFIG:-\$HOME\/\.config\/gcloud-novuchat-prod\}"$/m, `CONFIG_GCLOUD="${gcloud}"`)
    // Solo para la contraprueba de Ctrl-C: la tubería SIN la trampa del filtro.
    .replace(/^\) 2>&1 \| \{ trap '' INT; tapar; \}$/m, (l) => (o.sinTrampa ? ') 2>&1 | { tapar; }' : l));
  expect(copia.split('\n').filter((l, i) => l !== original.split('\n')[i])).toHaveLength(o.sinTrampa ? 5 : 4);
  writeFileSync(join(repo, 'scripts', 'catalogo-externo.sh'), copia, { mode: 0o755 });
  o.antes?.(base);

  const bin = join(dir, 'bin'); mkdirSync(bin, { recursive: true });
  const cuota = o.cuota === undefined ? PROD : o.cuota;
  writeFileSync(join(gcloud, 'application_default_credentials.json'),
    JSON.stringify({ type: 'authorized_user', ...(cuota === null ? {} : { quota_project_id: cuota }) }, null, 1));
  // `node` de mentira: anota argv y el entorno que importa, e imprime los ids, un número largo y una cuenta.
  const vigiladas = ['GCP_PROJECT_ID_STAGING', 'GCP_PROJECT_ID_PROD', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT',
    'CLOUDSDK_CONFIG', 'NODE_OPTIONS', 'FIRESTORE_EMULATOR_HOST', 'GOOGLE_CLOUD_QUOTA_PROJECT', 'NOVUCHAT_TENANTS_EXCLUIDOS', 'P', 'PROD', 'PATH'];
  writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash
python3 -I -c 'import json,os,sys; json.dump({"argv": sys.argv[2:], "cwd": os.getcwd(), "env": {k: os.environ.get(k) for k in ${JSON.stringify(vigiladas)}}}, open(sys.argv[1], "w"))' "$(dirname "$0")/../llamada.json" "$@"
echo "proyecto: $GCP_PROJECT_ID_PROD y $GCP_PROJECT_ID_STAGING"
echo "error en projects/$GCP_PROJECT_ID_STAGING número 123456789 de alguien@ejemplo.com" >&2
${o.nodeEspera ? `trap 'sleep 0.3; echo "interrumpido en projects/$GCP_PROJECT_ID_PROD"; exit 130' INT
echo esperando
while :; do sleep 0.05; done` : ''}
exit ${o.salidaNode ?? 1}
`, { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
case "$3" in GCP_PROJECT_ID_STAGING) printf '%s\\n' "${o.ghStg ?? ''}";; GCP_PROJECT_ID_PROD) printf '%s\\n' "${o.ghProd ?? ''}";; esac
`, { mode: 0o755 });
  const env: Record<string, string> = {
    NOVUCHAT_TENANTS_EXCLUIDOS: '',
    PATH: o.nodeReal ? `${join(dir, 'solo-gh')}:${dirname(process.execPath)}:${process.env['PATH']}` : `${bin}:${process.env['PATH']}`,
    HOME: dir, GCP_PROJECT_ID_STAGING: STG, GCP_PROJECT_ID_PROD: PROD,
    // heredadas que NO deben llegar a Node
    GOOGLE_CLOUD_PROJECT: 'otro-proyecto-heredado', NODE_OPTIONS: '--report-uncaught-exception', FIRESTORE_EMULATOR_HOST: '127.0.0.1:9',
    GOOGLE_CLOUD_QUOTA_PROJECT: 'otra-cuota-heredada', P: 'proyecto-heredado-p', PROD: 'proyecto-heredado-prod',
  };
  if (o.nodeReal) { mkdirSync(join(dir, 'solo-gh')); writeFileSync(join(dir, 'solo-gh', 'gh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 }); }
  // `undefined` = ausente: vacío, que el envoltorio trata igual (`${X:-}`); el entorno heredado no la puede traer.
  for (const [k, v] of Object.entries(o.env ?? {})) env[k] = v ?? '';
  const argv = [...(o.bash ?? []), join(repo, 'scripts', 'catalogo-externo.sh'), ...args];
  const registro = join(dir, 'llamada.json');
  const leerLlamada = () => (existsSync(registro) ? JSON.parse(readFileSync(registro, 'utf8')) as Llamada : null);
  return { argv, env, dir, base, leerLlamada, dirRespaldos: join(base, `novuchat-respaldos-${process.getuid!()}`) };
}
function correr(args: string[], o: Opciones = {}) {
  const p = preparar(args, o);
  const r = spawnSync('bash', p.argv, { encoding: 'utf8', env: entornoDelEmulador(undefined, p.env) });
  return { status: r.status, salida: `${r.stdout}${r.stderr}`, llamada: p.leerLlamada(), base: p.base, dirRespaldos: p.dirRespaldos, dir: p.dir };
}
const valorDe = (argv: string[], op: string) => { const i = argv.indexOf(op); return i < 0 ? undefined : argv[i + 1]; };
const sinIds = (s: string) => {
  for (const x of [PROD, STG, '123456789', 'alguien@']) expect(s).not.toContain(x);
};
const BASE = ['--tenant', 'casa-bermejo', '--monedas', 'BOB,ARS'];

describe('catalogo-externo.sh: la copia de prueba difiere del original solo en las huellas y la carpeta', () => {
  it('el original fija huellas de 12 hex y la carpeta /var/tmp', () => {
    const t = readFileSync(ORIGINAL, 'utf8');
    expect(t).toMatch(/^readonly HUELLA_STAGING="[0-9a-f]{12}"$/m);
    expect(t).toMatch(/^readonly HUELLA_PROD="[0-9a-f]{12}"$/m);
    expect(t).toMatch(/^readonly BASE_RESPALDOS="\/var\/tmp"$/m);
    expect(t).not.toContain('--proyecto');
  });
});

describe('catalogo-externo.sh: seco por omisión', () => {
  it('staging en seco: llama a Node con --entorno staging, SIN --aplicar ni --respaldo, y devuelve su código', () => {
    const r = correr(['--entorno', 'staging', ...BASE]);
    expect(r.status, r.salida).toBe(1);
    const a = r.llamada!.argv;
    expect(a[0]).toBe('scripts/plataforma/aplicar-catalogo-externo.mjs');
    expect(valorDe(a, '--entorno')).toBe('staging');
    expect(valorDe(a, '--tenant')).toBe('casa-bermejo');
    expect(valorDe(a, '--monedas')).toBe('BOB,ARS');
    for (const op of ['--aplicar', '--respaldo', '--confirmo-produccion', '--proyecto']) expect(a).not.toContain(op);
    expect(a.join(' ')).not.toContain(STG); expect(a.join(' ')).not.toContain(PROD);
    expect(r.llamada!.cwd.endsWith('/admin')).toBe(true);
    // el seco no crea la carpeta de respaldos
    expect(existsSync(r.dirRespaldos)).toBe(false);
    sinIds(r.salida);
  });
  it('producción en seco: --entorno produccion, sin --aplicar ni --confirmo-produccion', () => {
    const r = correr(['--entorno', 'produccion', ...BASE]);
    expect(valorDe(r.llamada!.argv, '--entorno')).toBe('produccion');
    expect(r.llamada!.argv).not.toContain('--aplicar');
    expect(r.llamada!.argv).not.toContain('--confirmo-produccion');
    sinIds(r.salida);
  });
  it('el entorno de Node: solo la lista blanca; NADA heredado (proyecto, cuota, emulador, NODE_OPTIONS, CLOUDSDK_*, P/PROD)', () => {
    const r = correr(['--entorno', 'staging', ...BASE]);
    const e = r.llamada!.env;
    expect(e['GCP_PROJECT_ID_STAGING']).toBe(STG);
    expect(e['GCP_PROJECT_ID_PROD']).toBe(PROD);
    expect(e['GOOGLE_APPLICATION_CREDENTIALS']).toMatch(/\/gcloud\/application_default_credentials\.json$/);
    for (const k of ['GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CONFIG', 'NODE_OPTIONS', 'FIRESTORE_EMULATOR_HOST', 'GOOGLE_CLOUD_QUOTA_PROJECT', 'P', 'PROD', 'NOVUCHAT_TENANTS_EXCLUIDOS']) {
      expect(e[k], k).toBeNull();
    }
    expect(correr(['--entorno', 'staging', ...BASE], { env: { NOVUCHAT_TENANTS_EXCLUIDOS: 'otro-comercio' } }).llamada!.env['NOVUCHAT_TENANTS_EXCLUIDOS']).toBe('otro-comercio');
  });
});

describe('catalogo-externo.sh: escribir exige --aplicar --confirmo <el mismo entorno>', () => {
  it('NEGADO: --aplicar sin --confirmo no llama a Node', () => {
    const r = correr(['--entorno', 'staging', ...BASE, '--aplicar']);
    expect(r.status).toBe(2); expect(r.llamada).toBeNull();
    expect(r.salida).toMatch(/--aplicar exige --confirmo staging/);
  });
  it('NEGADO: entorno equivocado (--confirmo produccion con --entorno staging, y al revés) no llama a Node', () => {
    for (const [ent, conf] of [['staging', 'produccion'], ['produccion', 'staging'], ['produccion', 'si']]) {
      const r = correr(['--entorno', ent, ...BASE, '--aplicar', '--confirmo', conf]);
      expect(r.status, `${ent}/${conf}`).toBe(2); expect(r.llamada).toBeNull();
    }
  });
  it('NEGADO: --confirmo sin --aplicar se rechaza', () => {
    const r = correr(['--entorno', 'staging', ...BASE, '--confirmo', 'staging']);
    expect(r.status).toBe(2); expect(r.llamada).toBeNull();
  });
  it('staging: --aplicar crea la carpeta 0700 del usuario, pone el respaldo dentro y NO pasa --confirmo-produccion', () => {
    const r = correr(['--entorno', 'staging', ...BASE, '--aplicar', '--confirmo', 'staging'], { salidaNode: 0 });
    expect(r.status, r.salida).toBe(0);
    const a = r.llamada!.argv;
    expect(a).toContain('--aplicar');
    const resp = valorDe(a, '--respaldo')!;
    expect(dirname(resp)).toBe(r.dirRespaldos);
    expect(resp).toMatch(/\/catalogo-externo-staging-casa-bermejo-\d{8}T\d{6}Z\.json$/);
    expect(a).not.toContain('--confirmo-produccion');
    const s = statSync(r.dirRespaldos);
    expect(s.isDirectory()).toBe(true); expect(s.mode & 0o777).toBe(0o700); expect(s.uid).toBe(process.getuid!());
    expect(r.salida).toContain(`respaldo: ${resp}`);
    sinIds(r.salida);
  });
  it('producción: --aplicar lleva --confirmo-produccion <tenant>', () => {
    const r = correr(['--entorno', 'produccion', ...BASE, '--aplicar', '--confirmo', 'produccion'], { salidaNode: 0 });
    const a = r.llamada!.argv;
    expect(valorDe(a, '--entorno')).toBe('produccion');
    expect(valorDe(a, '--confirmo-produccion')).toBe('casa-bermejo');
    sinIds(r.salida);
  });
  it('NEGADO: una carpeta de respaldos ajena en permisos (0755) o un enlace: no llama a Node', () => {
    const r755 = correr(['--entorno', 'staging', ...BASE, '--aplicar', '--confirmo', 'staging'],
      { antes: (b) => { const d = join(b, `novuchat-respaldos-${process.getuid!()}`); mkdirSync(d); chmodSync(d, 0o755); } });
    expect(r755.status).toBe(2); expect(r755.llamada).toBeNull();
    const rEnlace = correr(['--entorno', 'staging', ...BASE, '--aplicar', '--confirmo', 'staging'],
      { antes: (b) => { const d = join(b, 'otra'); mkdirSync(d, { mode: 0o700 }); symlinkSync(d, join(b, `novuchat-respaldos-${process.getuid!()}`)); } });
    expect(rEnlace.status).toBe(2); expect(rEnlace.llamada).toBeNull();
  });
  it('la ruta de respaldo que arma el envoltorio pasa la validación real del script de Node (comprobarRespaldo)', async () => {
    const r = correr(['--entorno', 'staging', ...BASE, '--aplicar', '--confirmo', 'staging'], { salidaNode: 0 });
    const { comprobarRespaldo } = await import('../../scripts/plataforma/aplicar-consola-conversaciones.mjs');
    expect(comprobarRespaldo(valorDe(r.llamada!.argv, '--respaldo'), { permitirExistente: true })).toMatchObject({ ok: true });
  });
  it('--crear-documento y --desactivar llegan tal cual', () => {
    expect(correr(['--entorno', 'staging', ...BASE, '--crear-documento']).llamada!.argv).toContain('--crear-documento');
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--desactivar']).llamada!.argv).toContain('--desactivar');
  });
});

/**
 * Corre con un respaldo creado DENTRO de la carpeta de respaldos de la copia (la base la conoce `antes`): el argumento
 * `__RESPALDO__` se reemplaza por esa ruta antes de lanzar el envoltorio.
 */
function correrConRespaldo(args: string[], o: { modo?: number; enlace?: boolean; puntos?: boolean } = {}) {
  const vivos = [...args];
  return correr(vivos, {
    antes: (b) => {
      const d = join(b, `novuchat-respaldos-${process.getuid!()}`); mkdirSync(d, { mode: 0o700 }); chmodSync(d, 0o700);
      const archivo = join(d, 'r.json');
      if (o.enlace) { const real = join(b, 'real.json'); writeFileSync(real, '{}', { mode: 0o600 }); symlinkSync(real, archivo); }
      else { writeFileSync(archivo, '{}', { mode: o.modo ?? 0o600 }); chmodSync(archivo, o.modo ?? 0o600); }
      const ruta = o.puntos ? `${d}/../novuchat-respaldos-${process.getuid!()}/r.json` : archivo;
      vivos.splice(vivos.indexOf('__RESPALDO__'), 1, ruta);
    },
  });
}

describe('catalogo-externo.sh: --revertir solo con un respaldo de la carpeta del envoltorio', () => {
  const REV = ['--entorno', 'produccion', '--tenant', 'casa-bermejo', '--revertir', '__RESPALDO__'];
  it('en producción: el seco pasa --revertir --respaldo sin --aplicar; con --aplicar --confirmo produccion agrega --confirmo-produccion', () => {
    const seco = correrConRespaldo(REV);
    expect(seco.status, seco.salida).toBe(1);
    expect(seco.llamada!.argv).toContain('--revertir');
    expect(dirname(valorDe(seco.llamada!.argv, '--respaldo')!)).toBe(seco.dirRespaldos);
    expect(seco.llamada!.argv).not.toContain('--aplicar');
    const ap = correrConRespaldo([...REV, '--aplicar', '--confirmo', 'produccion']);
    expect(ap.llamada!.argv).toContain('--aplicar');
    expect(valorDe(ap.llamada!.argv, '--confirmo-produccion')).toBe('casa-bermejo');
    sinIds(ap.salida);
    // y sin confirmar, no
    const sin = correrConRespaldo([...REV, '--aplicar']);
    expect(sin.status).toBe(2); expect(sin.llamada).toBeNull();
  });
  it('NEGADO: un respaldo fuera de la carpeta, un enlace, uno que no es 0600, o con «..»: no llama a Node', () => {
    const fuera = join(mkdtempSync(join(tmpdir(), 'novuchat-catext-f-')), 'r.json'); dirs.push(dirname(fuera));
    writeFileSync(fuera, '{}', { mode: 0o600 });
    const r = correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--revertir', fuera]);
    expect(r.status).toBe(2); expect(r.llamada).toBeNull();
    for (const o of [{ modo: 0o644 }, { enlace: true }, { puntos: true }]) {
      const x = correrConRespaldo(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--revertir', '__RESPALDO__'], o);
      expect(x.status, JSON.stringify(o)).toBe(2); expect(x.llamada).toBeNull();
    }
  });
  it('NEGADO: --revertir no admite --monedas ni --desactivar', () => {
    expect(correr(['--entorno', 'staging', ...BASE, '--revertir', '/tmp/x.json']).status).toBe(2);
    expect(correr(['--entorno', 'staging', '--tenant', 'casa-bermejo', '--desactivar', '--revertir', '/tmp/x.json']).status).toBe(2);
  });
});

describe('catalogo-externo.sh: el proyecto, cruzado y nunca impreso', () => {
  it('NEGADO: un TERCER proyecto como staging (forma válida, distinto de producción) no pasa la huella', () => {
    for (const env of [{ GCP_PROJECT_ID_STAGING: 'tercer-proyecto-ajeno' }, { GCP_PROJECT_ID_PROD: 'tercer-proyecto-ajeno' }]) {
      const r = correr(['--entorno', 'staging', ...BASE], { env, cuota: env.GCP_PROJECT_ID_PROD ?? PROD });
      expect(r.status, JSON.stringify(env)).toBe(2); expect(r.llamada).toBeNull();
      expect(r.salida).toMatch(/huella no coincide/);
      expect(r.salida).not.toContain('tercer-proyecto-ajeno'); sinIds(r.salida);
    }
  });
  it('NEGADO: credenciales cuyo quota_project_id no es producción, o sin él', () => {
    for (const cuota of [STG, 'otro-proyecto-x', null]) {
      const r = correr(['--entorno', 'staging', ...BASE], { cuota });
      expect(r.status, String(cuota)).toBe(2); expect(r.llamada).toBeNull(); sinIds(r.salida);
    }
  });
  it('NEGADO: staging igual a producción, una sola variable, o una con forma inválida', () => {
    const casos: Array<Record<string, string | undefined>> = [
      { GCP_PROJECT_ID_STAGING: PROD }, { GCP_PROJECT_ID_STAGING: undefined }, { GCP_PROJECT_ID_PROD: 'Proyecto Malo' },
    ];
    for (const env of casos) {
      const r = correr(['--entorno', 'produccion', ...BASE], { env });
      expect(r.status, JSON.stringify(env)).toBe(2); expect(r.llamada).toBeNull(); sinIds(r.salida);
    }
  });
  it('sin las variables en el entorno las lee de gh (sin imprimirlas)', () => {
    const r = correr(['--entorno', 'staging', ...BASE], { env: { GCP_PROJECT_ID_STAGING: undefined, GCP_PROJECT_ID_PROD: undefined }, ghStg: STG, ghProd: PROD });
    expect(r.llamada!.env['GCP_PROJECT_ID_STAGING']).toBe(STG);
    expect(r.llamada!.env['GCP_PROJECT_ID_PROD']).toBe(PROD);
    sinIds(r.salida);
  });
  it('NEGADO: un id del entorno que no coincide con la variable del repositorio no se usa', () => {
    const r = correr(['--entorno', 'staging', ...BASE], { env: { GCP_PROJECT_ID_STAGING: 'otro-proyecto-ajeno' }, ghStg: STG, ghProd: PROD });
    expect(r.status).toBe(2); expect(r.llamada).toBeNull();
    expect(r.salida).not.toContain('otro-proyecto-ajeno'); sinIds(r.salida);
  });
  it('NEGADO: con xtrace (bash -x o SHELLOPTS) no corre', () => {
    const r = correr(['--entorno', 'staging', ...BASE], { bash: ['-x'] });
    expect(r.status).toBe(2); expect(r.llamada).toBeNull(); sinIds(r.salida);
    const s = correr(['--entorno', 'staging', ...BASE], { env: { SHELLOPTS: 'xtrace' } });
    expect(s.status).toBe(2); expect(s.llamada).toBeNull(); sinIds(s.salida);
  });
  it('NEGADO: sin HOME sale con 2', () => {
    const r = correr(['--entorno', 'staging', ...BASE], { env: { HOME: undefined } });
    expect(r.status).toBe(2); expect(r.llamada).toBeNull();
  });
});

describe('catalogo-externo.sh: uso', () => {
  it('NEGADO: sin --entorno, entorno desconocido, tenant inválido, dos modos o ninguno, --crear-documento sin --monedas', () => {
    const malos = [
      [...BASE],
      ['--entorno', 'prod', ...BASE],
      ['--entorno', 'staging', '--tenant', '../x', '--monedas', 'BOB'],
      ['--entorno', 'staging', '--tenant', 'a,b', '--monedas', 'BOB'],
      ['--entorno', 'staging', '--tenant', 'casa-bermejo'],
      ['--entorno', 'staging', ...BASE, '--desactivar'],
      ['--entorno', 'staging', '--tenant', 'casa-bermejo', '--desactivar', '--crear-documento'],
      ['--entorno', 'staging', ...BASE, '--respaldo', '/var/tmp/s.json'],
      ['--entorno', 'staging', ...BASE, '--opcion-rara'],
      ['--entorno', 'staging', '--tenant', '--monedas', 'BOB'],
    ];
    for (const args of malos) {
      const r = correr(args);
      expect(r.status, args.join(' ')).toBe(2); expect(r.llamada).toBeNull();
    }
  });
});

describe('catalogo-externo.sh: de punta a punta con el script de Node REAL (sin nube)', () => {
  it('Node resuelve --entorno desde su entorno y respeta NOVUCHAT_TENANTS_EXCLUIDOS: sale con 2 antes de conectarse, sin ids', () => {
    const r = correr(['--entorno', 'staging', ...BASE], { nodeReal: true, env: { NOVUCHAT_TENANTS_EXCLUIDOS: 'casa-bermejo' } });
    expect(r.status, r.salida).toBe(2);
    expect(r.salida).toMatch(/EXCLUIDO/);
    sinIds(r.salida);
  });
  it('NEGADO: monedas repetidas pasan el envoltorio pero el script real las rechaza antes de conectarse', () => {
    const r = correr(['--entorno', 'produccion', '--tenant', 'casa-bermejo', '--monedas', 'BOB,BOB'], { nodeReal: true });
    expect(r.status, r.salida).toBe(2);
    expect(r.salida).toMatch(/repetidas/);
    sinIds(r.salida);
  });
});

describe('catalogo-externo.sh: el arranque no hereda comportamiento (BASH_ENV, funciones, PATH) y Ctrl-C se ve', () => {
  const SISTEMA = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  it('NEGADO: BASH_ENV no llega a los bash hijos (el gh y el node de mentira son bash)', () => {
    const d = mkdtempSync(join(tmpdir(), 'novuchat-catext-bashenv-')); dirs.push(d);
    const marca = join(d, 'marca'); writeFileSync(join(d, 'rc'), `echo x >> ${marca}\n`);
    const r = correr(['--entorno', 'staging', ...BASE], { env: { BASH_ENV: join(d, 'rc'), GCP_PROJECT_ID_STAGING: undefined, GCP_PROJECT_ID_PROD: undefined }, ghStg: STG, ghProd: PROD });
    expect(r.status).toBe(1); expect(r.llamada).not.toBeNull();
    // Una sola vez: el arranque del envoltorio (eso es de quien lo llama); ni gh (dos veces) ni node la vuelven a leer.
    expect(readFileSync(marca, 'utf8')).toBe('x\n');
    sinIds(r.salida);
  });
  it('NEGADO: una función exportada `sha256sum` no falsea la huella, ni un sha256sum de mentira en el PATH; Node recibe el PATH de sistema', () => {
    const conFuncion = correr(['--entorno', 'staging', ...BASE], { env: { 'BASH_FUNC_sha256sum%%': '() { echo 2dedea95e190; }' } });
    expect(conFuncion.status).toBe(1); expect(conFuncion.llamada).not.toBeNull();
    const conBinario = correr(['--entorno', 'staging', ...BASE], {
      antes: (base) => { const b = join(dirname(base), 'bin'); mkdirSync(b, { recursive: true }); writeFileSync(join(b, 'sha256sum'), '#!/bin/sh\necho 000000000000 -\n', { mode: 0o755 }); },
    });
    expect(conBinario.status).toBe(1); expect(conBinario.llamada).not.toBeNull();
    expect(conBinario.llamada!.env['PATH']).toBe(SISTEMA);
  });
  /** Lanza el envoltorio en su propio grupo, espera «esperando» y manda SIGINT a TODO el grupo (como Ctrl-C en la terminal). */
  async function conCtrlC(o: Opciones) {
    const p = preparar(['--entorno', 'staging', ...BASE], { ...o, nodeEspera: true });
    const hijo = spawn('bash', p.argv, { env: entornoDelEmulador(undefined, p.env), detached: true });
    let salida = '';
    const listo = new Promise<void>((res) => {
      const ver = (d: Buffer) => { salida += d.toString(); if (salida.includes('esperando')) res(); };
      hijo.stdout!.on('data', ver); hijo.stderr!.on('data', ver);
    });
    const fin = new Promise<number | null>((res) => { hijo.on('close', (c: number | null) => res(c)); });
    await listo;
    process.kill(-hijo.pid!, 'SIGINT');
    return { codigo: await fin, salida };
  }
  it('Ctrl-C: Node recibe la señal, su aviso (que sale 0,3 s después) se ve tapado y el envoltorio sale con 130', async () => {
    const { codigo, salida } = await conCtrlC({});
    expect(codigo).toBe(130);
    expect(salida).toContain('interrumpido en projects/<proyecto>');
    sinIds(salida);
  }, 15000);
  it('NEGADO (contraprueba de la trampa): sin `trap \'\' INT` el filtro muere con Ctrl-C y el aviso de Node se pierde', async () => {
    const { salida } = await conCtrlC({ sinTrampa: true });
    expect(salida).toContain('esperando');
    expect(salida).not.toContain('interrumpido');
    sinIds(salida);
  }, 15000);
  it('NEGADO: una función exportada `command`, `compgen` o `unset` no reemplaza la limpieza (modo privilegiado -p)', () => {
    for (const nombre of ['command', 'compgen', 'unset']) {
      const r = correr(['--entorno', 'staging', ...BASE], { env: { [`BASH_FUNC_${nombre}%%`]: '() { echo /tmp/node-falso; }' } });
      expect(r.status, nombre).toBe(1); expect(r.llamada, nombre).not.toBeNull();
      sinIds(r.salida);
    }
    // El ataque real: `compgen` reemplazada esconde a `command`, que la limpieza ya no ve. Solo -p lo cierra.
    const juntas = correr(['--entorno', 'staging', ...BASE], { env: {
      'BASH_FUNC_compgen%%': '() { :; }', 'BASH_FUNC_command%%': '() { echo /tmp/node-falso; }' } });
    expect(juntas.status).toBe(1); expect(juntas.llamada).not.toBeNull();
    sinIds(juntas.salida);
  });
});
