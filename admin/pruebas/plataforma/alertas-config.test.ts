/**
 * `scripts/plataforma/alertas-config.mjs`, CONTRA EL EMULADOR (proyecto propio para no cruzarse con otras suites).
 *
 * El script escribe `plataforma/alertas` con el SDK Admin, que se salta las reglas: lo único que impide un tope de 50, un
 * host con IP o un archivo versionado es su propia validación. Se prueba ejecutándolo de verdad y NEGANDO. Valores
 * sintéticos armados en ejecución (ningún dominio ni correo real en el repositorio).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOPE_MAXIMO } from '../../functions/src/plataforma/alertaOperativa.ts';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'alertas-config.mjs');
const PROYECTO = 'demo-alertas-config';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps, deleteApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'alertas-config') ?? initializeApp({ projectId: PROYECTO }, 'alertas-config');
const db = getFirestore(app);
const ref = db.doc('plataforma/alertas');

// Cada prueba lanza procesos de Node contra el emulador: con la máquina cargada 5 s no alcanzan (fallo intermitente observado).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const DOMINIO = ['avisos', 'ejemplo', 'test'].join('.');
const CORREO = ['persona', '@', 'ejemplo', '.test'].join('');
const DENEGADA = 'cadena-denegada-ficticia';
let tmp: string;
let runtime: string;
let n = 0;

const doc = async () => (await ref.get());
const leer = (r: string): string => readFileSync(r, 'utf8');
const modoDe = (r: string): number => { const fd = openSync(r, 'r'); try { return fstatSync(fd).mode & 0o777; } finally { closeSync(fd); } };

function correr(...a: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...a], {
    encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: runtime }),
  });
  const salida = `${r.stdout}${r.stderr}`;
  // Nada de lo que se escribe sale entero por pantalla: ni el correo, ni las cadenas denegadas.
  expect(salida).not.toContain(CORREO);
  expect(salida).not.toContain(DENEGADA);
  return { codigo: r.status, salida };
}
/** Un archivo local con lo pedido (el destinatario y las denegadas SOLO entran por aquí). */
const archivo = (extra: Record<string, unknown> = {}, base: Record<string, unknown> | null = null): string[] => {
  const ruta = join(tmp, `pedido-${++n}.local.json`);
  writeFileSync(ruta, JSON.stringify({ dominioAvisos: DOMINIO, destinatario: CORREO, enlaceHosts: 'github.com', enlaceRepos: 'dueno/repo-uno', ...(base ?? {}), ...extra }));
  return ['--archivo', ruta];
};
const respaldoDe = (salida: string): string => /\(modo 600\): (\S+)/.exec(salida)![1]!;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'alertas-config-'));
  runtime = join(tmp, 'run'); mkdirSync(runtime, { mode: 0o700 }); chmodSync(runtime, 0o700);
  await ref.delete();
});
afterAll(async () => { await ref.delete(); await deleteApp(app); rmSync(tmp, { recursive: true, force: true }); });

describe('alertas-config.mjs: seco por omisión, escritura con respaldo y relectura', () => {
  it('sin --aplicar NO escribe nada y dice qué haría, con el destino a la vista y el destinatario enmascarado', async () => {
    const r = correr(...archivo({ avisosDenegar: [DENEGADA] }));
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(`Destino   : emulador ${HOST}`);
    expect(r.salida).toContain('Sin --aplicar no se escribió nada');
    expect(r.salida).toContain('p***@e***');
    expect(r.salida).toContain('1 cadena(s), no se imprimen');
    expect((await doc()).exists).toBe(false);
  });

  it('--aplicar escribe SOLO los campos pedidos, deja el respaldo (modo 600) y relee', async () => {
    await ref.set({ otroCampo: 'ajeno', topeDiario: 4 });
    const r = correr(...archivo({ topeDiario: 6 }), '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('escrito y comprobado');
    const d = await doc();
    expect(d.get('dominioAvisos')).toBe(DOMINIO);
    expect(d.get('destinatario')).toBe(CORREO);
    expect(d.get('enlaceHosts')).toBe('github.com');
    expect(d.get('enlaceRepos')).toBe('dueno/repo-uno');
    expect(d.get('topeDiario')).toBe(6);
    expect(d.get('otroCampo')).toBe('ajeno');                       // no toca lo que no es suyo
    const ruta = respaldoDe(r.salida);
    expect(modoDe(ruta)).toBe(0o600);
    expect(JSON.parse(leer(ruta))).toEqual({ existia: true, datos: { topeDiario: 4 } });
  });

  it('por argumentos (sin destinatario ni denegadas) también sirve', async () => {
    const r = correr('--dominio', DOMINIO, '--hosts', 'github.com', '--repos', 'dueno/repo-uno', '--tope', '7', '--aplicar');
    expect(r.codigo).toBe(0);
    expect((await doc()).get('topeDiario')).toBe(7);
  });

  it('repetir lo mismo: «Nada que cambiar» y no escribe ni deja otro respaldo', async () => {
    const f = archivo();
    correr(...f, '--aplicar');
    const r = correr(...f, '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Nada que cambiar');
    expect(r.salida).not.toContain('Respaldo');
  });

  it('--revertir devuelve el documento anterior (o lo borra si no existía), relee y deja respaldo del estado ACTUAL', async () => {
    const a = correr(...archivo(), '--aplicar');
    const ruta = respaldoDe(a.salida);
    expect((await doc()).exists).toBe(true);
    const seco = correr('--revertir', ruta);
    expect(seco.codigo).toBe(0);
    expect((await doc()).get('dominioAvisos')).toBe(DOMINIO);       // el seco no revierte
    const r = correr('--revertir', ruta, '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('revertido y comprobado');
    expect((await doc()).exists).toBe(false);
    const previo = respaldoDe(r.salida);                            // el estado que había ANTES de revertir
    expect(modoDe(previo)).toBe(0o600);
    expect(JSON.parse(leer(previo)).datos.dominioAvisos).toBe(DOMINIO);
  });

  it('--revertir restaura los valores previos de un documento que ya existía', async () => {
    await ref.set({ dominioAvisos: 'previo.ejemplo.test', topeDiario: 3 });
    const a = correr(...archivo({ topeDiario: 7 }), '--aplicar');
    expect(correr('--revertir', respaldoDe(a.salida), '--aplicar').codigo).toBe(0);
    const d = await doc();
    expect([d.get('dominioAvisos'), d.get('topeDiario'), d.get('destinatario')]).toEqual(['previo.ejemplo.test', 3, undefined]);
  });

  it('un archivo local *.local.json sirve; las cadenas denegadas entran y NO se imprimen', async () => {
    const r = correr(...archivo({ enlaceRepos: [], avisosDenegar: [DENEGADA, 'otra-cadena-ficticia'], topeDiario: 8 }), '--aplicar');
    expect(r.codigo).toBe(0);
    const d = await doc();
    expect(d.get('avisosDenegar')).toBe(`${DENEGADA},otra-cadena-ficticia`);
    expect(d.get('enlaceRepos')).toBe('');                          // lista vacía = sin enlaces de Actions
    expect(d.get('topeDiario')).toBe(8);
  });
});

describe('alertas-config.mjs: lo que se NIEGA (sale 2 y no escribe)', () => {
  const sinEscribir = async (...a: string[]) => {
    const r = correr(...a, '--aplicar');
    expect(r.codigo, a.join(' ')).toBe(2);
    expect((await doc()).exists).toBe(false);
    return r;
  };
  it('tope mayor que el máximo del código (9, 50), cero, negativo, decimal o texto: se RECHAZA, no se recorta', async () => {
    for (const t of ['9', '50', '0', '-1', '4.5', 'x', '']) await sinEscribir('--dominio', DOMINIO, '--tope', t);
  });
  it('el máximo de este script es el del código', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toContain(`const TOPE_MAXIMO = ${TOPE_MAXIMO};`);
  });
  it('dominio con esquema o ruta, destinatario sin forma, host IP o con puerto, repo mal formado, cadena denegada corta', async () => {
    await sinEscribir('--dominio', `https://${DOMINIO}`);
    await sinEscribir('--dominio', `${DOMINIO}/x`);
    await sinEscribir(...archivo({ destinatario: 'no-es-un-correo' }));
    await sinEscribir('--hosts', '10.0.0.5');
    await sinEscribir('--hosts', 'github.com:8443');
    await sinEscribir('--hosts', '');
    await sinEscribir('--repos', 'sin-barra');
    await sinEscribir('--repos', 'a/b/c');
    await sinEscribir(...archivo({ avisosDenegar: ['ab'] }));
  });
  it('--destinatario y --denegar por ARGUMENTO se rechazan (se ven en ps): solo por --archivo', async () => {
    const a = await sinEscribir('--dominio', DOMINIO, '--destinatario', CORREO);
    expect(a.salida).toContain('--archivo');
    const b = await sinEscribir('--dominio', DOMINIO, '--denegar', DENEGADA);
    expect(b.salida).toContain('--archivo');
  });
  it('una bandera final sin valor, o que consume otra bandera como valor, es error de uso (2), no silencio', async () => {
    await sinEscribir('--dominio', DOMINIO, '--tope');
    await sinEscribir('--dominio', '--aplicar');
    await sinEscribir('--hosts', '--repos', 'dueno/repo-uno');
    expect(correr('--dominio').codigo).toBe(2);
  });
  it('sin proyecto, con proyecto mal formado o sin ningún campo pedido', async () => {
    const sin = spawnSync(process.execPath, [SCRIPT, '--dominio', DOMINIO], { encoding: 'utf8', env: entornoDelEmulador(HOST) });
    expect(sin.status).toBe(2);
    expect(correr('--aplicar').codigo).toBe(2);
    const mal = spawnSync(process.execPath, [SCRIPT, '--proyecto', 'X', '--dominio', DOMINIO, '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST) });
    expect(mal.status).toBe(2);
  });
  it('un archivo que no se llama *.local.json (versionable) o con campos ajenos: se niega', async () => {
    const f = join(tmp, 'alertas.json');
    writeFileSync(f, JSON.stringify({ dominioAvisos: DOMINIO }));
    await sinEscribir('--archivo', f);
    await sinEscribir(...archivo({ tenantId: 'x' }));
  });
  it('sin $XDG_RUNTIME_DIR ni --respaldo no hay dónde dejar el respaldo: no escribe', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...archivo(), '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: '' }) });
    expect(r.status).toBe(2);
    expect((await doc()).exists).toBe(false);
  });
  it('un respaldo que ya existe no se pisa: no escribe', async () => {
    const respaldo = join(tmp, 'ya-existe.json');
    writeFileSync(respaldo, 'contenido-previo');
    const r = correr(...archivo(), '--respaldo', respaldo, '--aplicar');
    expect(r.codigo).toBe(2);
    expect(leer(respaldo)).toBe('contenido-previo');
    expect((await doc()).exists).toBe(false);
  });
  it('--respaldo dentro del repositorio (donde un git add lo versionaría) se rechaza; dentro de $XDG_RUNTIME_DIR o fuera del repo, no', async () => {
    const dentro = join(aqui, 'respaldo-de-prueba.json');
    const r = await sinEscribir(...archivo(), '--respaldo', dentro);
    expect(r.salida).toContain('fuera del repositorio');
    expect(spawnSync('test', ['-e', dentro]).status).not.toBe(0);   // y no lo creó
    expect(correr(...archivo(), '--respaldo', join(runtime, 'r.json'), '--aplicar').codigo).toBe(0);
  });
  it('contra un proyecto REAL (sin emulador) --aplicar exige --confirmo produccion y GCP_PROJECT_ID_PROD igual; el destino se imprime', async () => {
    const real = (extra: string[], vars: Record<string, string>) => spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...archivo(), ...extra], {
      encoding: 'utf8', // Sin credenciales posibles: ni un intento de tocar un proyecto real desde la prueba.
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: '', GOOGLE_APPLICATION_CREDENTIALS: join(tmp, 'no-existe.json'), CLOUDSDK_CONFIG: join(tmp, 'gcloud'), XDG_RUNTIME_DIR: runtime, ...vars },
    });
    const seco = real([], {});
    expect(`${seco.stdout}${seco.stderr}`).toContain('Destino   : proyecto real');
    expect(real(['--aplicar'], {}).status).toBe(2);                                                 // sin --confirmo
    expect(real(['--aplicar', '--confirmo', 'staging'], { GCP_PROJECT_ID_PROD: PROYECTO }).status).toBe(2);
    expect(real(['--aplicar', '--confirmo', 'produccion'], {}).status).toBe(2);                     // sin la variable
    expect(real(['--aplicar', '--confirmo', 'produccion'], { GCP_PROJECT_ID_PROD: 'otro-proyecto-xyz' }).status).toBe(2);
    expect((await doc()).exists).toBe(false);
  });
  it('solo escribe plataforma/alertas: no crea ningún otro documento de plataforma', async () => {
    correr(...archivo(), '--aplicar');
    const otros = await db.collection('plataforma').get();
    expect(otros.docs.map((d) => d.id)).toEqual(['alertas']);
  });
});

describe('alertas-config.mjs --revertir: el respaldo pasa por la MISMA validación (un respaldo editado no es una puerta trasera)', () => {
  const revertirCon = async (datos: unknown, existia = true) => {
    const f = join(tmp, `respaldo-${++n}.json`);
    writeFileSync(f, JSON.stringify({ existia, datos }));
    await ref.set({ dominioAvisos: 'actual.ejemplo.test' });
    const r = correr('--revertir', f, '--aplicar');
    return { r, d: (await doc()).get('dominioAvisos') as string };
  };
  it('destinatario sin forma, tope > 8, hosts con IP, repos mal formados, denegadas que no son texto o tipos ajenos: se NIEGA y no cambia nada', async () => {
    for (const datos of [
      { destinatario: 'no-es-un-correo' }, { topeDiario: 999 }, { topeDiario: '5' }, { enlaceHosts: `evil.ejemplo.test,${['1', '2', '3', '4'].join('.')}` },
      { enlaceRepos: '../../x' }, { avisosDenegar: { x: 1 } }, { avisosDenegar: ['arreglo'] }, { dominioAvisos: 'https://x.ejemplo.test' },
      { dominioAvisos: 'MAYUSCULAS.ejemplo.test' },                                                // no normalizado
    ]) {
      const { r, d } = await revertirCon(datos);
      expect(r.codigo, JSON.stringify(datos)).toBe(2);
      expect(d).toBe('actual.ejemplo.test');
    }
  });
  it('un respaldo válido sí revierte', async () => {
    const { r, d } = await revertirCon({ dominioAvisos: 'previo.ejemplo.test', topeDiario: 3 });
    expect(r.codigo).toBe(0);
    expect(d).toBe('previo.ejemplo.test');
  });
  it('el respaldo del estado actual queda ANTES de revertir; si no hay dónde dejarlo, no revierte', async () => {
    const f = join(tmp, 'resp.json');
    writeFileSync(f, JSON.stringify({ existia: true, datos: { dominioAvisos: 'previo.ejemplo.test' } }));
    await ref.set({ dominioAvisos: 'actual.ejemplo.test' });
    const sin = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--revertir', f, '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: '' }) });
    expect(sin.status).toBe(2);
    expect((await doc()).get('dominioAvisos')).toBe('actual.ejemplo.test');
  });
  it('--revertir con un respaldo ilegible o con campos ajenos se niega', async () => {
    const f = join(tmp, 'resp2.json');
    writeFileSync(f, 'no-json');
    expect(correr('--revertir', f, '--aplicar').codigo).toBe(2);
    writeFileSync(f, JSON.stringify({ existia: true, datos: { tenantId: 'x' } }));
    expect(correr('--revertir', f, '--aplicar').codigo).toBe(2);
  });
});

describe('alertas-config.mjs: argumentos estrictos y la ruta del respaldo (sexta ronda)', () => {
  const repoRaiz = (): string => spawnSync('git', ['-C', aqui, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
  const comunPadre = (): string => dirname(spawnSync('git', ['-C', aqui, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim());
  const sinEscribir = async (...a: string[]) => {
    const r = correr(...a, '--aplicar');
    expect(r.codigo, a.join(' ')).toBe(2);
    expect((await doc()).exists).toBe(false);
    return r;
  };

  it('un argumento desconocido o suelto, o --destinatario/--denegar (también con = y con --archivo): salida 2 y el valor no se repite', async () => {
    for (const extra of [['--cualquiera', 'x'], ['suelto'], ['--tope=5'], ['--dominio=' + DOMINIO]]) await sinEscribir('--dominio', DOMINIO, ...extra);
    const a = await sinEscribir(...archivo(), `--destinatario=${CORREO}`);
    expect(a.salida).toContain('--archivo');
    await sinEscribir(...archivo(), '--destinatario', CORREO);
    await sinEscribir(...archivo(), `--denegar=${DENEGADA}`);
    await sinEscribir(...archivo(), '--denegar', DENEGADA);
    const u = correr('--dominio', DOMINIO, '--misterio-secreto-123', '--aplicar');
    expect(u.codigo).toBe(2);
    expect(u.salida).not.toContain('misterio-secreto-123');          // el argumento no se imprime
    expect(u.salida).not.toContain('--destinatario C');              // la ayuda ya no lo ofrece
    expect(u.salida).not.toContain('--denegar X');
  });

  it('--revertir con «datos»: null (o un arreglo) sale 2 y no cambia nada', async () => {
    for (const datos of [null, [], 'texto', 5]) {
      const f = join(tmp, `nulo-${++n}.json`);
      writeFileSync(f, JSON.stringify({ existia: true, datos }));
      await ref.set({ dominioAvisos: 'actual.ejemplo.test' });
      expect(correr('--revertir', f, '--aplicar').codigo, JSON.stringify(datos)).toBe(2);
      expect((await doc()).get('dominioAvisos')).toBe('actual.ejemplo.test');
    }
    const g = join(tmp, 'nulo-total.json');
    writeFileSync(g, 'null');
    expect(correr('--revertir', g, '--aplicar').codigo).toBe(2);
  });

  it('--respaldo: un symlink que apunta DENTRO del repositorio no lo disfraza (ruta real del directorio padre)', async () => {
    const enlace = join(tmp, 'enlace-al-repo');
    symlinkSync(aqui, enlace);
    const r = await sinEscribir(...archivo(), '--respaldo', join(enlace, 'r-por-enlace.json'));
    expect(r.salida).toContain('fuera del repositorio');
    expect(spawnSync('test', ['-e', join(aqui, 'r-por-enlace.json')]).status).not.toBe(0);
  });

  it('--respaldo: desde OTRO cwd la raíz del repositorio sale del directorio del script, no del cwd', async () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...archivo(), '--respaldo', join(aqui, 'r-otro-cwd.json'), '--aplicar'], {
      encoding: 'utf8', cwd: tmp, env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: runtime }),
    });
    expect(r.status).toBe(2);
    expect(spawnSync('test', ['-e', join(aqui, 'r-otro-cwd.json')]).status).not.toBe(0);
    expect((await doc()).exists).toBe(false);
  });

  it('--respaldo: tampoco en el checkout PRINCIPAL (el padre del .git común) ni en la raíz del repositorio', async () => {
    await sinEscribir(...archivo(), '--respaldo', join(comunPadre(), 'r-checkout-principal.json'));
    await sinEscribir(...archivo(), '--respaldo', join(repoRaiz(), 'r-raiz.json'));
  });

  it('$XDG_RUNTIME_DIR dentro del repositorio, o con modo distinto de 700, no sirve como destino por omisión', async () => {
    const dentro = join(aqui, 'xdg-de-prueba');
    mkdirSync(dentro, { mode: 0o700 }); chmodSync(dentro, 0o700);
    try {
      const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...archivo(), '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: dentro }) });
      expect(r.status).toBe(2);
      expect(readdirSync(dentro)).toEqual([]);                       // no dejó ningún respaldo dentro del repositorio
    } finally { rmSync(dentro, { recursive: true, force: true }); }
    const abierto = join(tmp, 'xdg-755'); mkdirSync(abierto); chmodSync(abierto, 0o755);
    const s = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...archivo(), '--aplicar'], { encoding: 'utf8', env: entornoDelEmulador(HOST, { XDG_RUNTIME_DIR: abierto }) });
    expect(s.status).toBe(2);
    expect(readdirSync(abierto)).toEqual([]);
    expect((await doc()).exists).toBe(false);
  });

  it('el .gitignore (raíz y admin/) ignora los respaldos alertas-config-respaldo-*', () => {
    for (const g of [join(aqui, '..', '..', '..', '.gitignore'), join(aqui, '..', '..', '.gitignore')]) expect(readFileSync(g, 'utf8')).toContain('alertas-config-respaldo-*');
  });
});
