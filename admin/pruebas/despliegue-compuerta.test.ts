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
 *     texto Y el código de salida (C1-C15).
 *   - `scripts/comprobar-version-servida.sh`: el sitio sirve los mismos
 *     `/assets/*.js|css` que el HTML construido (V1-V8, contra un servidor local).
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
    expect(r.salidas).toEqual({ completo: 'true', hosting_publicado: 'todos', functions_pendientes: '', candidatas: '' });
  });

  // ---- Varios intentos (el workflow repite `firebase deploy` ante la cuota de escrituras) ----
  const INICIA = (f: string) => `i  functions: updating Node.js 22 (2nd Gen) function admin:${f}(us-east1)...\n`;
  const OK = (f: string) => `✔  functions[admin:${f}(us-east1)] Successful update operation.\n`;
  const CUOTA = (f: string) => `⚠  functions: Got "Quota Exceeded" error while trying to update projects/p/locations/us-east1/functions/${f}. Waiting to retry...\n`;
  const OMITIDA = (f: string) => `i  functions: Skipped (No changes detected) admin:${f}(us-east1)\n`;
  const FIN = '\n✔  Deploy complete!\n';
  const intento = (reg: string, acum: string, extra: Record<string, string> = {}) => {
    const reintentable = archivo('');
    const r = compuerta(reg, { SOLO: 'functions', REGISTRO_ACUMULADO: archivo(acum), REINTENTABLE_EN: reintentable, ...extra });
    return { ...r, reintentable: readFileSync(reintentable, 'utf8').trim() };
  };

  it('C16: una Function que falló en el intento 1 y fue «Skipped» en el 2 NO pasa: la compuerta mide el ACUMULADO', () => {
    const a1 = INICIA('fnX') + INICIA('fnY') + CUOTA('fnX') + OK('fnY');
    const a2 = OMITIDA('fnX') + OMITIDA('fnY') + FIN;
    const r = intento(a2, a1 + a2);
    expect(r.status, r.stdout).toBe(1);
    expect(r.stdout).toContain('Function sin confirmar: admin:fnX(us-east1)');
    expect(r.stdout).not.toContain('Function sin confirmar: admin:fnY(');
    expect(r.salidas['functions_pendientes']).toBe('functions:admin:fnX');
    expect(r.reintentable).toBe('no'); // en el último intento fnX no chocó con la cuota: no se repite, se falla fuerte
    // Contraste: solo con el último intento (sin acumulado) pasaría por buena, y por eso el workflow pasa el acumulado.
    expect(compuerta(a2, { SOLO: 'functions' }).status).toBe(0);
  });

  it('C17: la Function fallida en el intento 1 y CONFIRMADA en el 2 sí pasa', () => {
    const a1 = INICIA('fnX') + INICIA('fnY') + CUOTA('fnX') + OK('fnY');
    const a2 = INICIA('fnX') + OK('fnX') + OMITIDA('fnY') + FIN;
    const r = intento(a2, a1 + a2);
    expect(r.status, r.stdout).toBe(0);
    expect(r.salidas['functions_pendientes']).toBe('');
  });

  it('C18: reintentable con al menos UNA señal de cuota y ninguna pendiente con otro fallo; una pendiente sin ninguna línea es «no intentada»', () => {
    const una = intento(INICIA('fnX') + CUOTA('fnX'), INICIA('fnX') + CUOTA('fnX'));
    expect(una.status).toBe(1);
    expect(una.reintentable).toBe('si');
    // firebase-tools se rindió antes de intentar fnY: sin línea de cuota ni de éxito → sigue siendo reintentable.
    const noIntentada = INICIA('fnX') + INICIA('fnY') + CUOTA('fnX');
    expect(intento(noIntentada, noIntentada).reintentable).toBe('si');
    // NEGANDO: una pendiente con un fallo que NO es de cuota → no se repite.
    const otroFallo = INICIA('fnX') + INICIA('fnY') + CUOTA('fnX') + '✘  functions[admin:fnY(us-east1)]: Deployment error.\n';
    expect(intento(otroFallo, otroFallo).reintentable).toBe('no');
    // NEGANDO: ninguna señal de cuota en todo el intento → no.
    const sinSenal = INICIA('fnX') + INICIA('fnY');
    expect(intento(sinSenal, sinSenal).reintentable).toBe('no');
    // El fallo de OTRA Function que no está pendiente no impide repetir.
    const ajena = INICIA('fnX') + CUOTA('fnX') + INICIA('fnZ') + '✘  functions[admin:fnZ(us-east1)]: Deployment error.\n' + OK('fnZ');
    expect(intento(ajena, ajena).reintentable).toBe('si');
  });

  it('C22: el registro REAL del 25/11 (86 Functions, 8 sin confirmar, 5 que firebase-tools ni intentó) es reintentable y sigue fallando', () => {
    const real = readFileSync(join(FIX, 'cuota-real-25-11.registro.txt'), 'utf8');
    // El registro real trae «Failed to get the IAM Policy on the Service …/services/sondeocobros» (Cloud Run, nombre en minúsculas):
    // es parte del mismo choque con la cuota y se tolera A PROPÓSITO como reintentable; si fuera un permiso de verdad, el segundo
    // intento volvería a fallar y la compuerta final falla igual (costo: tiempo, nunca un despliegue dado por bueno).
    const r = intento(real, real, { SOLO: SOLO_COMPLETO, CODIGO_FIREBASE: '1' });
    expect(r.status).toBe(1);
    expect(r.reintentable).toBe('si');
    expect(r.salidas['functions_pendientes']).toBe([
      'confirmarPedidoExterno', 'enviarAdjuntoComoPersona', 'guardarComprobante', 'guardarMedio', 'leerAdjuntoPersona', 'sondeoCobros', 'verComprobante', 'verMedio',
    ].map((f) => `functions:admin:${f}`).sort().join(','));
    // Con «unexpected state» agregado, o con un fallo de compilación, deja de serlo.
    expect(intento(real + 'This deployment is in an unexpected state - please re-deploy your functions.\n', real, { SOLO: SOLO_COMPLETO, CODIGO_FIREBASE: '1' }).reintentable).toBe('no');
    expect(intento(real + '⚠  functions: Build failed: error TS2304\n', real, { SOLO: SOLO_COMPLETO, CODIGO_FIREBASE: '1' }).reintentable).toBe('no');
  });

  it('C19: no es reintentable con «unexpected state», sin Functions pendientes, ni con un fallo de compilación', () => {
    const base = INICIA('fnX') + CUOTA('fnX');
    expect(intento(base + 'This deployment is in an unexpected state - please re-deploy your functions.\n', base).reintentable).toBe('no');
    // Todas confirmadas, pero falta «Deploy complete!»: nada pendiente que reintentar.
    const sinPendientes = INICIA('fnX') + OK('fnX') + CUOTA('fnX');
    const r = intento(sinPendientes, sinPendientes);
    expect(r.status).toBe(1);
    expect(r.reintentable).toBe('no');
    // Pendiente sin ninguna línea de cuota (fallo de compilación o de arranque).
    const compilacion = INICIA('fnX') + '⚠  functions: Build failed: error TS2304\n';
    expect(intento(compilacion, compilacion).reintentable).toBe('no');
    // Con cuota en otra parte, un fallo de compilación igual corta.
    const mezcla = INICIA('fnX') + INICIA('fnY') + CUOTA('fnY') + '⚠  functions: Build failed: error TS2304\n';
    expect(intento(mezcla, mezcla).reintentable).toBe('no');
    // Un despliegue completo es «no» (no hay nada que repetir).
    expect(intento(INICIA('fnX') + OK('fnX') + FIN, INICIA('fnX') + OK('fnX') + FIN).reintentable).toBe('no');
  });

  it('C23: el registro REAL del 26/11 (87 actualizaciones, todas «Successful», Hosting publicado, 4 avisos «unexpected state») pasa con un ::warning:: que cuenta los avisos y nombra candidatas', () => {
    const real = readFileSync(join(FIX, 'unexpected-state-completo-26-11.registro.txt'), 'utf8');
    const STG23 = { AVISO_SERVICIO_NO_FATAL: '1', FIREBASE_TOOLS_VERSION: '15.28.1' };
    const corre = (reg: string) => compuerta(reg, { SOLO: SOLO_COMPLETO, SITIO_CONSOLA: 'proyecto-ficticio', SITIO_CATALOGO: 'catalogo-ficticio', ...STG23 });
    const r = corre(real);
    expect(r.status, r.stdout).toBe(0);
    expect(r.salidas['completo']).toBe('true');
    expect(r.stdout).toMatch(/::warning::firebase-tools avisó 4 vez\/veces «unexpected state»/);
    expect(r.stdout).toMatch(/candidatas \(el aviso no nombra la Function\): [A-Za-z]/); // deduce al menos una Function
    expect(r.stdout).not.toContain('::error::');
    // NEGANDO: cualquier otra cosa sigue siendo fatal con el MISMO aviso.
    const sinOk = real.split('\n'); const i = sinOk.findIndex((l) => l.includes('Successful update operation'));
    sinOk.splice(i, 1);
    const f1 = corre(sinOk.join('\n')); expect(f1.status).toBe(1); expect(f1.stdout).toContain('unexpected state'); expect(f1.stdout).toContain('Function sin confirmar');
    const f2 = corre(real.replace('Deploy complete!', 'Deploy terminó')); expect(f2.status).toBe(1);
    const f3 = corre(real.replace('hosting[catalogo-ficticio]: release complete', 'hosting[catalogo-ficticio]: release pendiente')); expect(f3.status).toBe(1);
    expect(f3.stdout).toContain('unexpected state');
    // NEGANDO: una Function NUEVA (create) con el aviso es fatal: su invoker no se fijó y nadie la podría invocar.
    const conCreate = 'i  functions: creating Node.js 22 (2nd Gen) function admin:fnNueva(us-east1)...\n✔  functions[admin:fnNueva(us-east1)] Successful create operation.\n' + real;
    const f4 = corre(conCreate); expect(f4.status, f4.stdout).toBe(1); expect(f4.stdout).toContain('unexpected state');
    // NEGANDO: con una versión de firebase-tools que NO es la verificada, el aviso vuelve a ser fatal.
    const otraVersion = compuerta(real, { SOLO: SOLO_COMPLETO, SITIO_CONSOLA: 'proyecto-ficticio', SITIO_CATALOGO: 'catalogo-ficticio', AVISO_SERVICIO_NO_FATAL: '1' });
    expect(otraVersion.status).toBe(1);
    expect(otraVersion.stdout).toContain('unexpected state');
    // Los avisos de un intento ANTERIOR (registro acumulado) también cuentan: el último intento limpio no los borra.
    const anterior = compuerta(real.split('\n').filter((l) => !l.includes('unexpected state')).join('\n'),
      { SOLO: SOLO_COMPLETO, SITIO_CONSOLA: 'proyecto-ficticio', SITIO_CATALOGO: 'catalogo-ficticio', REGISTRO_ACUMULADO: archivo(real), ...STG23 });
    // (revisión de seguridad 27/11) Aviso solo en el acumulado y ninguna candidata en el último intento: nada que verificar → fatal.
    expect(anterior.status, anterior.stdout).toBe(1);
    expect(anterior.stdout).toContain('no hay Function confirmada que verificar');
    // Dos avisos seguidos y UNA sola confirmación después: las dos confirmadas desde el primer aviso son candidatas.
    const dos = compuerta(real, { SOLO: SOLO_COMPLETO, SITIO_CONSOLA: 'proyecto-ficticio', SITIO_CATALOGO: 'catalogo-ficticio', ...STG23 });
    const cand = (dos.salidas['candidatas'] ?? '').split(',').filter(Boolean);
    const lineas = real.split('\n');
    const primer = lineas.findIndex((l) => l.includes('unexpected state'));
    const esperadas = lineas.slice(primer).filter((l) => /Successful (create|update|delete) operation\./.test(l)).length;
    expect(cand.length, dos.stdout).toBe(esperadas);
    // Sin avisos no hay warning ni candidatas.
    const limpio = corre(real.split('\n').filter((l) => !l.includes('unexpected state')).join('\n'));
    expect(limpio.status).toBe(0); expect(limpio.stdout).not.toContain('unexpected state');
  });

  it('C24 (revisión de #1137): el aviso solo baja a warning en staging, con versión explícita, sin ninguna forma de creación, y con anclajes de línea entera', () => {
    const real = readFileSync(join(FIX, 'unexpected-state-completo-26-11.registro.txt'), 'utf8');
    const base = { SOLO: SOLO_COMPLETO, SITIO_CONSOLA: 'proyecto-ficticio', SITIO_CATALOGO: 'catalogo-ficticio' };
    const STG = { ...base, AVISO_SERVICIO_NO_FATAL: '1', FIREBASE_TOOLS_VERSION: '15.28.1' };
    const fatal = (reg: string, env: Record<string, string> = STG, etiqueta = '') => { const r = compuerta(reg, env); expect(r.status, `${etiqueta}\n${r.stdout}`).toBe(1); return r; };
    expect(compuerta(real, STG).status).toBe(0);
    // PRODUCCIÓN: sin AVISO_SERVICIO_NO_FATAL es fatal aunque la versión sea la verificada.
    fatal(real, { ...base, FIREBASE_TOOLS_VERSION: '15.28.1' }, 'producción');
    // Versión ausente, vacía, distinta o con sufijo: fatal.
    for (const v of ['', '15.29.0', '15.28.1-beta', 'v15.28.1', '15.28.1 ']) fatal(real, { ...STG, FIREBASE_TOOLS_VERSION: v }, `versión «${v}»`);
    // Creación escrita de cualquier forma, en el acumulado: fatal.
    const NUEVA = '✔  functions[admin:fnNueva(us-east1)] Successful create operation.\n';
    for (const extra of [
      'i  functions: Creating Node.js 22 (2nd Gen) function admin:fnNueva(us-east1)...\n' + NUEVA,
      'i  functions:   creating Node.js 22 (2nd Gen) function admin:fnNueva(us-east1)...\n' + NUEVA,
      NUEVA,
      '⚠  functions:  failed to create function projects/p/locations/us-east1/functions/fnNueva\n',
      '⚠  functions: Got "Quota Exceeded" error while trying to create projects/p/locations/us-east1/functions/fnNueva. Waiting to retry...\n',
    ]) fatal(extra + real, STG, `creación: ${extra.slice(0, 40)}`);
    // Anclajes: una Function iniciada con espacio final o resto de spinner y SIN Successful es pendiente.
    fatal(real + 'i  functions: updating Node.js 22 (2nd Gen) function admin:fnHuerfana(us-east1)... \n', STG, 'updating con espacio final');
    fatal(real + 'i  functions: updating Node.js 22 (2nd Gen) function admin:fnHuerfana(us-east1)... ⠋ trabajando\n', STG, 'updating con spinner');
    // «release complete» y «Deploy complete!» tienen que ser la LÍNEA ENTERA (no una subcadena de otra línea ni de otro proceso).
    fatal(real.replace('✔  hosting[catalogo-ficticio]: release complete', 'nota: hosting[catalogo-ficticio]: release complete'), STG, 'release dentro de otra línea');
    fatal(real.replace('✔  Deploy complete!', '> Deploy complete!'), STG, 'Deploy complete de otro proceso');
    // Un «Successful» de un intento ANTERIOR no tapa un «updating» sin confirmar del ÚLTIMO intento.
    const a1 = '✔  functions[admin:fnU(us-east1)] Successful update operation.\ni  functions: updating Node.js 22 (2nd Gen) function admin:fnU(us-east1)...\n';
    const a2 = 'i  functions: updating Node.js 22 (2nd Gen) function admin:fnU(us-east1)...\n\n✔  Deploy complete!\n';
    const enmascarado = compuerta(a2, { SOLO: 'functions', REGISTRO_ACUMULADO: archivo(a1 + a2) });
    expect(enmascarado.status).toBe(1);
    expect(enmascarado.stdout).toContain('Function sin confirmar: admin:fnU(us-east1)');
    // Las candidatas (staging) salen en GITHUB_OUTPUT, solo con nombres válidos.
    const ok = compuerta(real, STG);
    expect(ok.salidas['candidatas']).toMatch(/^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$/);
    expect(ok.salidas['completo']).toBe('true');
    // M-D (revisión de #1137) NEGANDO: una confirmada con un id de forma inesperada, después del aviso, no se omite en silencio: es fatal.
    const tras = real.split('\n').slice(real.split('\n').findIndex((l) => l.includes('unexpected state')));
    const idMalo = /functions\[[^:\]]*:?([A-Za-z0-9_-]+)\(/.exec(tras.find((l) => /Successful update operation\./.test(l)) ?? '')?.[1] ?? '';
    expect(idMalo).not.toBe('');
    const raro = compuerta(real.split(`${idMalo}(`).join('fn.rara('), STG);
    expect(raro.status, raro.stdout).toBe(1);
    expect(raro.stdout).toContain('id con forma inesperada');
    expect(raro.salidas['candidatas']).toBe('');
  });

  it('C21: un id de Function con metacaracteres de expresión regular nunca es reintentable', () => {
    const raro = INICIA('fn.*') + CUOTA('fnAlgo');
    expect(intento(raro, raro).reintentable).toBe('no');
    const barra = INICIA('fnX|fnY') + CUOTA('fnX');
    expect(intento(barra, barra).reintentable).toBe('no');
  });

  it('C20: un sitio de Hosting publicado en un intento anterior cuenta (el rollback no se salta por el último intento)', () => {
    const a1 = INICIA('fnX') + OK('fnX') + 'i  hosting[consola-ficticia]: beginning deploy...\n✔  hosting[consola-ficticia]: release complete\n';
    const a2 = OMITIDA('fnX') + FIN;
    const solo = 'functions,hosting:consola';
    const conAcumulado = compuerta(a2, { SOLO: solo, SITIO_CATALOGO: '', REGISTRO_ACUMULADO: archivo(a1 + a2) });
    expect(conAcumulado.salidas['hosting_publicado']).toBe('todos');
    expect(conAcumulado.status, conAcumulado.stdout).toBe(0);
    // Sin el acumulado, el último intento por sí solo no tiene «release complete».
    const sinAcumulado = compuerta(a2, { SOLO: solo, SITIO_CATALOGO: '' });
    expect(sinAcumulado.salidas['hosting_publicado']).toBe('ninguno');
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

  it('C6: «unexpected state» es FATAL por omisión (producción); solo staging (AVISO_SERVICIO_NO_FATAL=1) con la versión verificada y despliegue completo lo baja a ::warning::', () => {
    const AVISO = '⚠  functions: Updated function is not associated with a service. This deployment is in an unexpected state - please re-deploy your functions.\n';
    const STG = { AVISO_SERVICIO_NO_FATAL: '1', FIREBASE_TOOLS_VERSION: '15.28.1' };
    // PRODUCCIÓN (sin la variable): fatal aunque todo lo demás esté completo.
    const prod = compuerta(`${EXITOSO}${AVISO}`, { FIREBASE_TOOLS_VERSION: '15.28.1' });
    expect(prod.status).toBe(1);
    expect(prod.stdout).toContain('unexpected state');
    // STAGING completo: warning.
    const stg = compuerta(`${AVISO}${EXITOSO}`, STG);
    expect(stg.status, stg.stdout).toBe(0);
    expect(stg.stdout).toMatch(/::warning::firebase-tools avisó 1 vez\/veces «unexpected state»/);
    // NEGANDO (seguridad 27/11): aviso sin NINGUNA confirmación posterior = nada que verificar = fatal.
    const sinCand = compuerta(`${EXITOSO}${AVISO}`, STG);
    expect(sinCand.status).toBe(1);
    expect(sinCand.stdout).toContain('no hay Function confirmada');
    // NEGANDO en staging: una Function CREADA, o el despliegue a medias, sigue siendo fatal.
    const conCreate = compuerta(`${EXITOSO}i  functions: creating Node.js 22 (2nd Gen) function admin:fnNueva(us-east1)...\n✔  functions[admin:fnNueva(us-east1)] Successful create operation.\n${AVISO}`, STG);
    expect(conCreate.status).toBe(1);
    expect(conCreate.stdout).toContain('unexpected state');
    const medias = compuerta(A_MEDIAS, STG);
    expect(medias.status).toBe(1);
    expect(medias.stdout).toContain('unexpected state');
  });

  it('C7: sin el release del catálogo falla y Hosting queda «parcial»', () => {
    const r = compuerta(sinLineas(EXITOSO, 'hosting[catalogo-ficticio]: release complete'));
    expect(r.status).toBe(1);
    // Se nombra por su rol, no por su id (en staging y dev el id es el del proyecto).
    expect(r.stdout).toContain('Hosting no publicó el sitio del catálogo');
    expect(r.stdout).not.toContain('catalogo-ficticio');
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
    // Las dos formas reales de firebase-tools: ANSI a mitad de línea en el
    // release de Hosting y «Deploy complete!» en negrita y subrayado. Más una
    // secuencia de cursor con «?» (`\x1b[?25l`) delante de «Deploy complete!»: si
    // el saneo no la quitara, R2 fallaría.
    const reales = EXITOSO
      .replace('hosting[consola-ficticia]: release complete',
        'hosting[consola-ficticia]:\x1b[22m\x1b[39m release complete')
      .replace('hosting[catalogo-ficticio]: release complete',
        'hosting[catalogo-ficticio]:\x1b[22m\x1b[39m release complete')
      .replace('Deploy complete!', '\x1b[?25l\x1b[1m\x1b[4mDeploy complete!\x1b[24m\x1b[22m\x1b[?25h');
    expect(reales).not.toBe(EXITOSO);
    const r = compuerta(reales);
    expect(r.status, r.stdout).toBe(0);
    expect(r.salidas).toEqual(compuerta(EXITOSO).salidas);
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

  it('C15: un destino de Hosting desconocido en SOLO es error de uso', () => {
    const r = compuerta(EXITOSO, { SOLO: 'hosting:consola,hosting:otro,functions' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('destino de Hosting desconocido');
    expect(r.salidas).toEqual({});
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

  it('V7: un destino de Hosting desconocido en SOLO -> 2 sin peticiones', async () => {
    responder = () => [200, html(HTML_A)];
    const r = await version({ SOLO: 'hosting:consola,hosting:otro' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('destino de Hosting desconocido');
    expect(peticiones).toBe(0);
  });

  it('V8: el curl limita redirecciones y esquemas', () => {
    const s = readFileSync(VERSION, 'utf8');
    expect(s).toContain('--max-redirs 3 --proto "$proto" --proto-redir "$proto"');
    expect(s).toContain("if [[ \"$url\" == http://127.0.0.1:* ]]; then proto='=http'; else proto='=https'; fi");
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
            ESPERA_REINTENTO_CUOTA: '0',
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

    if (t !== 'desplegar-dev') {
      it(`W2b ${t}: se repite SOLO ante la cuota con TODAS las pendientes; la compuerta mide el acumulado de los intentos`, () => {
        const bin = join(tmp, `bin-cuota-${t}`);
        spawnSync('mkdir', ['-p', bin]);
        // Un firebase falso: cuenta sus llamadas, guarda sus argumentos y responde con el registro N (REG1, REG2, REG3; el
        // último se repite) y el código de salida N (COD1, COD2, COD3).
        writeFileSync(join(bin, 'firebase'), [
          '#!/usr/bin/env bash',
          'n=$(( $(cat "$CONTADOR" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$CONTADOR"',
          'echo "$*" >> "$ARGUMENTOS"',
          'k=$n; [ "$k" -gt 3 ] && k=3',
          'eval "reg=\\$REG$k; cod=\\$COD$k"',
          'cat "$reg"; exit "${cod:-0}"', '',
        ].join('\n'));
        chmodSync(join(bin, 'firebase'), 0o755);
        const codigo = `set -euo pipefail\n${fragmento(job(t))}`;
        const I = (f: string) => `i  functions: updating Node.js 22 (2nd Gen) function admin:${f}(us-east1)...\n`;
        const OKF = (f: string) => `✔  functions[admin:${f}(us-east1)] Successful update operation.\n`;
        const Q = (f: string) => `⚠  functions: Got "Quota Exceeded" error while trying to update projects/p/locations/us-east1/functions/${f}. Waiting to retry...\n`;
        const OM = (f: string) => `i  functions: Skipped (No changes detected) admin:${f}(us-east1)\n`;
        const FIN = '✔  Deploy complete!\n';
        const HOST = 'i  hosting[consola-ficticia]: beginning deploy...\n✔  hosting[consola-ficticia]: release complete\ni  hosting[catalogo-ficticio]: beginning deploy...\n✔  hosting[catalogo-ficticio]: release complete\n';
        const COMPLETO = I('fnX') + OKF('fnX') + HOST + FIN;
        const A_MEDIAS_CUOTA = I('fnX') + Q('fnX'); // iniciada, chocó con la cuota y nada más
        const SIN_CUOTA = I('fnX') + '⚠  functions: Build failed: error\n';
        const corre = (registros: string[], codigos: string[] = ['0', '0', '0']) => {
          const contador = archivo(''); const argumentos = archivo('');
          const reg = registros.map((r) => archivo(r));
          const r = spawnSync('bash', ['-c', codigo], {
            encoding: 'utf8',
            env: entornoDelEmulador(undefined, {
              PATH: `${bin}:${process.env['PATH'] ?? ''}`,
              CONTADOR: contador, ARGUMENTOS: argumentos,
              REG1: reg[0] ?? reg[reg.length - 1]!, REG2: reg[1] ?? reg[reg.length - 1]!, REG3: reg[2] ?? reg[reg.length - 1]!,
              COD1: codigos[0] ?? '0', COD2: codigos[1] ?? '0', COD3: codigos[2] ?? '0',
              ESPERA_REINTENTO_CUOTA: '0',
              RUNNER_TEMP: tmp, GITHUB_OUTPUT: archivo(''), GITHUB_STEP_SUMMARY: archivo(''), GITHUB_WORKSPACE: RAIZ,
              GITHUB_REF_NAME: 'v0.0.0', GITHUB_RUN_ID: '1', GITHUB_SHA: 'abcdef0abcdef0', FIREBASE_TOOLS_VERSION: '',
              SOLO: SOLO_COMPLETO, PROYECTO: 'consola-ficticia', SITIO_CONSOLA: 'consola-ficticia', SITIO_CATALOGO: 'catalogo-ficticio', FORZAR: '',
            }),
          });
          const args = readFileSync(argumentos, 'utf8').split('\n').filter(Boolean);
          return { status: r.status, llamadas: args.length, args, salida: r.stdout + r.stderr };
        };
        // 1) cuota y luego completo: pasa con 2 llamadas, con los MISMOS argumentos en las dos.
        const uno = corre([A_MEDIAS_CUOTA, COMPLETO]);
        expect(uno.status, uno.salida).toBe(0);
        expect(uno.llamadas).toBe(2);
        expect(uno.args[0]).toBe(uno.args[1]);
        expect(uno.salida).toContain('Cuota de escrituras');
        // 1b) EL CASO REAL del 25/11: el registro verdadero (8 Functions pendientes, 5 que firebase-tools ni intentó) se repite UNA
        //     vez, y el segundo intento confirma las 8 y publica Hosting: pasa con 2 llamadas. Si el segundo intento NO confirma a
        //     las 8, la compuerta falla (acumulado).
        const real = readFileSync(join(FIX, 'cuota-real-25-11.registro.txt'), 'utf8');
        const pend = ['confirmarPedidoExterno', 'enviarAdjuntoComoPersona', 'guardarComprobante', 'guardarMedio', 'leerAdjuntoPersona', 'sondeoCobros', 'verComprobante', 'verMedio'];
        const segundo = pend.map((f) => I(f) + OKF(f)).join('') + HOST + FIN;
        const realOk = corre([real, segundo], ['1', '0']);
        expect(realOk.status, realOk.salida).toBe(0);
        expect(realOk.llamadas).toBe(2);
        const realIncompleto = corre([real, pend.slice(0, 7).map((f) => I(f) + OKF(f)).join('') + HOST + FIN], ['1', '0']);
        expect(realIncompleto.status).not.toBe(0);
        expect(realIncompleto.salida).toContain('Function sin confirmar: admin:verMedio(us-east1)');
        // 2) cuota dos veces y luego completo: 3 llamadas.
        expect(corre([A_MEDIAS_CUOTA, A_MEDIAS_CUOTA, COMPLETO]).llamadas).toBe(3);
        // 3) cuota tres veces: falla y NUNCA hay un cuarto intento.
        const tres = corre([A_MEDIAS_CUOTA, A_MEDIAS_CUOTA, A_MEDIAS_CUOTA]);
        expect(tres.status).not.toBe(0);
        expect(tres.llamadas).toBe(3);
        // 4) EL PELIGRO: fnX chocó con la cuota en el intento 1 y en el 2 firebase la omite («Skipped») y termina «completo»:
        //    la compuerta mide el ACUMULADO, así que FALLA (no hay un fnX viejo en producción dado por bueno).
        const omitida = corre([A_MEDIAS_CUOTA, OM('fnX') + HOST + FIN]);
        expect(omitida.status).not.toBe(0);
        expect(omitida.llamadas).toBe(2);
        expect(omitida.salida).toContain('Function sin confirmar: admin:fnX(us-east1)');
        // 5) cuota en el intento 1 y un fallo SIN cuota en el 2 (aunque el código sea 1): corta con 2 llamadas.
        const mixto = corre([A_MEDIAS_CUOTA, SIN_CUOTA, A_MEDIAS_CUOTA], ['0', '1', '0']);
        expect(mixto.status).not.toBe(0);
        expect(mixto.llamadas).toBe(2);
        // 6) NEGANDO: un fallo sin la señal de cuota en el PRIMER intento: una sola llamada, con su código de salida.
        const sin = corre([SIN_CUOTA, COMPLETO], ['2', '0', '0']);
        expect(sin.status).not.toBe(0);
        expect(sin.llamadas).toBe(1);
        // 7) «unexpected state» aunque haya cuota: no se repite.
        const estado = corre([A_MEDIAS_CUOTA + 'This deployment is in an unexpected state - please re-deploy your functions.\n', COMPLETO]);
        expect(estado.status).not.toBe(0);
        expect(estado.llamadas).toBe(1);
        // 8) un código de salida distinto de 0 en el último intento falla aunque el registro diga «completo».
        const codigoMalo = corre([A_MEDIAS_CUOTA, COMPLETO], ['0', '3', '0']);
        expect(codigoMalo.status).not.toBe(0);
        expect(codigoMalo.llamadas).toBe(2);
      });
    }

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

  /** El `run: |` de un paso, sin la sangría del YAML. */
  const runDe = (p: string): string => {
    const i = p.indexOf('run: |\n');
    expect(i, 'el paso no tiene run: |').toBeGreaterThan(-1);
    return p.slice(i + 'run: |\n'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  };
  /** Corre un `run:` real del workflow con `firebase`, `npm` y `gcloud` de mentira que anotan sus llamadas. */
  const correrPaso = (codigo: string, nombre: string, clonFalla: boolean, extra: Record<string, string>) => {
    const bin = join(tmp, `bin-previa-${nombre}`);
    spawnSync('mkdir', ['-p', bin]);
    const llamadas = join(bin, 'llamadas');
    writeFileSync(llamadas, '');
    writeFileSync(join(bin, 'firebase'), `#!/usr/bin/env bash\necho "firebase $*" >> "${llamadas}"\n[[ "$1" == hosting:clone && "${clonFalla ? 'si' : 'no'}" == si ]] && exit 1\nexit 0\n`);
    writeFileSync(join(bin, 'npm'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(bin, 'gcloud'), '#!/usr/bin/env bash\nexit 1\n');
    for (const b of ['firebase', 'npm', 'gcloud']) chmodSync(join(bin, b), 0o755);
    const salida = archivo('');
    const r = spawnSync('bash', ['-c', codigo], {
      encoding: 'utf8',
      env: entornoDelEmulador(undefined, {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`, GITHUB_OUTPUT: salida, FIREBASE_TOOLS_VERSION: '0.0.0',
        PROYECTO: 'consola-ficticia', SITIO: 'consola-ficticia', ...extra,
      }),
    });
    return { status: r.status, salidas: leerSalidas(salida), llamadas: readFileSync(llamadas, 'utf8'), texto: `${r.stdout}${r.stderr}` };
  };

  it('W4c: la copia a «previa» emite previa_ok=true SOLO si el clon de esta corrida salió bien (producción)', () => {
    const copia = paso(job('desplegar-produccion'), '- name: Conservar copia de la versión actual');
    expect(copia).toContain('id: copia_previa');
    const codigo = runDe(copia);
    const bien = correrPaso(codigo, 'copia-bien', false, {});
    expect(bien.salidas['previa_ok']).toBe('true');
    // NEGADA: con el clon fallido el paso sigue sin tumbar el despliegue (continue-on-error), pero NO hay previa_ok.
    const mal = correrPaso(codigo, 'copia-mal', true, {});
    expect(mal.status).toBe(0);
    expect(mal.salidas['previa_ok']).toBeUndefined();
  });

  it('W4d: el rollback NO clona «previa» sobre live sin previa_ok de esta corrida: falla fuerte y pide el manual', () => {
    const rollback = paso(job('desplegar-produccion'), '- name: Rollback de hosting');
    expect(rollback).toContain('PREVIA_OK: ${{ steps.copia_previa.outputs.previa_ok }}');
    const codigo = runDe(rollback);
    for (const previa of ['', 'false', 'TRUE']) {
      const r = correrPaso(codigo, `rollback-sin-${previa || 'vacio'}`, false, { PREVIA_OK: previa });
      expect(r.status, previa).toBe(1);
      expect(r.llamadas, previa).not.toContain('hosting:clone');
      expect(r.texto).toContain('Rollback automático NO ejecutado');
      expect(r.salidas['rollback'], previa).toBe('no_ejecutado');
    }
    // El operador lo ve en post-despliegue: la salida llega por el job y tiene su texto propio (≤ 140).
    expect(job('desplegar-produccion')).toContain('rollback: ${{ steps.rollback.outputs.rollback }}');
    expect(paso(job('desplegar-produccion'), '- name: Rollback de hosting')).toContain('id: rollback');
    const post = job('post-despliegue');
    expect(post).toContain('ROLLBACK: ${{ needs.desplegar-produccion.outputs.rollback }}');
    const texto = /'(Health check fallido; rollback NO ejecutado[^']*)'/.exec(post)?.[1] ?? '';
    expect(texto).not.toBe('');
    expect(texto.length).toBeLessThanOrEqual(140);
    // Contraprueba: con la copia de esta corrida, el rollback sí clona previa → live.
    const ok = correrPaso(codigo, 'rollback-con', false, { PREVIA_OK: 'true' });
    expect(ok.status, ok.texto).toBe(0);
    expect(ok.salidas['rollback']).toBeUndefined();
    expect(ok.llamadas).toContain('firebase hosting:clone consola-ficticia:previa consola-ficticia:live');
  });

  it('W7: el aviso «unexpected state» solo baja a warning en STAGING (producción no define la variable) y staging verifica el invoker de las candidatas', () => {
    const prod = job('desplegar-produccion');
    const stg = job('desplegar-staging');
    expect(prod).not.toContain('AVISO_SERVICIO_NO_FATAL');
    expect(job('desplegar-dev')).not.toContain('AVISO_SERVICIO_NO_FATAL');
    expect(stg).toContain("AVISO_SERVICIO_NO_FATAL: '1'");
    expect(stg).toContain('scripts/verificar-invocadores-candidatas.sh');
    expect(stg).toContain("if: steps.desplegar.outputs.candidatas != ''");
    expect(prod).not.toContain('verificar-invocadores-candidatas');
  });

  it('W8: el script que verifica los invocadores lee la política (solo lectura), acepta cualquier miembro con run.invoker y FALLA si falta o no se puede leer', () => {
    const bin = join(tmp, 'bin-invocadores');
    spawnSync('mkdir', ['-p', bin]);
    writeFileSync(join(bin, 'gcloud'), [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$LLAMADAS_GCLOUD"',
      'case "$1 $2 $3" in',
      '  "run services get-iam-policy") f="$POLITICAS/$4" ;;',
      '  "functions describe "*) f="$POLITICAS/describe-$3" ;;',
      '  *) echo "solo lectura" >&2; exit 9 ;;',
      'esac',
      '[ -f "$f" ] || exit 1; cat "$f"', '',
    ].join('\n'));
    chmodSync(join(bin, 'gcloud'), 0o755);
    const politicas = join(tmp, 'politicas'); spawnSync('mkdir', ['-p', politicas]);
    writeFileSync(join(politicas, 'fnpublica'), JSON.stringify({ bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] }));
    writeFileSync(join(politicas, 'fnprogramada'), JSON.stringify({ bindings: [{ role: 'roles/run.invoker', members: ['serviceAccount:planificador@p.iam.gserviceaccount.com'] }] }));
    writeFileSync(join(politicas, 'fnsinrol'), JSON.stringify({ bindings: [{ role: 'roles/otro', members: ['allUsers'] }] }));
    writeFileSync(join(politicas, 'fnvacia'), JSON.stringify({ bindings: [{ role: 'roles/run.invoker', members: [] }] }));
    writeFileSync(join(politicas, 'fnbasura'), 'esto no es json');
    // I-A (revisión de #1137): una Function de EVENTOS no lleva invocador en su servicio (Eventarc lo tiene a nivel de proyecto).
    const sinInvocador = JSON.stringify({ bindings: [] });
    writeFileSync(join(politicas, 'fnevento'), sinInvocador);
    writeFileSync(join(politicas, 'describe-fnEvento'), JSON.stringify({ eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written' } }));
    writeFileSync(join(politicas, 'fnhttpsininvocador'), sinInvocador);
    writeFileSync(join(politicas, 'describe-fnHttpSinInvocador'), JSON.stringify({ serviceConfig: { uri: 'https://ejemplo.invalid' } }));
    writeFileSync(join(politicas, 'fneventovacio'), sinInvocador);
    writeFileSync(join(politicas, 'describe-fnEventoVacio'), JSON.stringify({ eventTrigger: { eventType: '' } }));
    writeFileSync(join(politicas, 'fnsindescribir'), sinInvocador);
    writeFileSync(join(politicas, 'fndescribebasura'), sinInvocador);
    writeFileSync(join(politicas, 'describe-fnDescribeBasura'), 'esto no es json');
    writeFileSync(join(politicas, 'fn-con-guion'), JSON.stringify({ bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] }));
    const llamadas = archivo('');
    const corre = (candidatas: string, extra: Record<string, string> = {}) => {
      const r = spawnSync('bash', [join(RAIZ, 'scripts', 'verificar-invocadores-candidatas.sh')], {
        encoding: 'utf8',
        env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, PROYECTO: 'proyecto-ficticio', CANDIDATAS: candidatas, POLITICAS: politicas, LLAMADAS_GCLOUD: llamadas, ...extra }),
      });
      return { status: r.status, salida: r.stdout + r.stderr };
    };
    const ok = corre('fnPublica,fnProgramada');
    expect(ok.status, ok.salida).toBe(0);
    expect(readFileSync(llamadas, 'utf8')).toContain('run services get-iam-policy fnpublica --region us-east1 --project proyecto-ficticio');
    expect(readFileSync(llamadas, 'utf8')).not.toMatch(/add-iam|set-iam|remove-iam/);
    // NEGANDO: sin el rol, con el rol vacío, ilegible o inexistente: falla y nombra la Function.
    for (const f of ['fnSinRol', 'fnVacia', 'fnBasura', 'fnInexistente']) {
      const r = corre(`fnPublica,${f}`);
      expect(r.status, f).toBe(1);
      expect(r.salida).toContain(f);
      expect(r.salida).toContain('nube-visor.sh');
    }
    // De eventos y sin invocador en el servicio: pasa, y lo dice; la lectura del disparador es de solo lectura y solo se hace si falta el invocador.
    const evento = corre('fnPublica,fnEvento');
    expect(evento.status, evento.salida).toBe(0);
    expect(evento.salida).toContain('fnEvento: es de eventos');
    expect(readFileSync(llamadas, 'utf8')).toContain('functions describe fnEvento --gen2 --region us-east1 --project proyecto-ficticio');
    expect(readFileSync(llamadas, 'utf8')).not.toContain('functions describe fnPublica');
    expect(readFileSync(llamadas, 'utf8')).not.toMatch(/add-iam|set-iam|remove-iam|functions (deploy|delete|call)/);
    // NEGANDO: sin invocador y sin disparador de eventos comprobado (HTTP, eventType vacío, sin poder describirla, respuesta ilegible) sigue fallando.
    for (const f of ['fnHttpSinInvocador', 'fnEventoVacio', 'fnSinDescribir', 'fnDescribeBasura']) {
      const r = corre(`fnPublica,fnEvento,${f}`);
      expect(r.status, f).toBe(1);
      expect(r.salida).toContain(`${f}: SIN invocador`);
    }
    // M-C: el servicio de una Function con «_» lleva «-».
    expect(corre('fn_Con_Guion').status).toBe(0);
    expect(readFileSync(llamadas, 'utf8')).toContain('run services get-iam-policy fn-con-guion ');
    expect(corre('').status).toBe(0);
    expect(corre('fnPublica,../x').status).toBe(1);
    expect(corre('fnPublica', { PROYECTO: '' }).status).toBe(2);
    expect(corre('fnPublica', { REGION: 'x;y' }).status).toBe(2);
  });

  it('W4: en producción el health check corre también tras un despliegue fallido, y el rollback tras él', () => {
    const j = job('desplegar-produccion');
    expect(paso(j, 'id: salud')).toContain(
      "if: ${{ !cancelled() && steps.desplegar.outputs.firebase_corrio == 'true' }}");
    // El rollback, solo si Hosting se publicó: si no, live ya es la versión anterior
    // y clonar «previa» revertiría algo que nadie publicó.
    const rollback = paso(j, '- name: Rollback de hosting');
    expect(rollback).toContain(
      "if: ${{ !cancelled() && steps.salud.outputs.ok == 'false' && steps.desplegar.outputs.hosting_publicado != 'ninguno' }}");
    // Negativa: el if del rollback no puede carecer de la condición de hosting_publicado.
    const ifRollback = /\n\s+if: (.*)\n/.exec(rollback)?.[1] ?? '';
    expect(ifRollback).toContain("steps.desplegar.outputs.hosting_publicado != 'ninguno'");
    expect(ifRollback).not.toBe("${{ !cancelled() && steps.salud.outputs.ok == 'false' }}");
    // Fallar el job no depende de Hosting: un sitio que no responde falla siempre.
    expect(paso(j, '- name: Fallar si producción no responde')).toContain(
      "if: ${{ !cancelled() && steps.salud.outputs.ok == 'false' }}");
    // El humo del catálogo sigue atado a una consola sana.
    expect(paso(j, './scripts/humo-sitio-publico.sh')).toContain("if: steps.salud.outputs.ok == 'true'");
  });

  it('W4b: antes de CADA intento de despliegue, hosting_publicado vuelve a «desconocido» (staging y producción)', () => {
    for (const nombre of ['desplegar-staging', 'desplegar-produccion']) {
      const bucle = /for intento in 1 2 3; do\n([\s\S]*?)\n\s+firebase deploy --only/.exec(job(nombre))?.[1] ?? '';
      // Dentro del bucle y ANTES de firebase deploy: un valor viejo no puede sobrevivir a un corte del paso.
      expect(bucle, nombre).toContain('echo "hosting_publicado=desconocido" >> "$GITHUB_OUTPUT"');
    }
    // «desconocido» no es «ninguno»: el rollback corre, y post-despliegue tiene su propio texto.
    expect(paso(job('desplegar-produccion'), '- name: Rollback de hosting')).toContain("hosting_publicado != 'ninguno'");
    expect(job('post-despliegue')).toContain("process.env.HOSTING === 'desconocido'");
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
    // Con health check fallido y Hosting sin publicar no hubo rollback: el texto lo dice.
    const sinRollback = 'Health check fallido tras un despliegue a medias; Hosting no se publicó, sin rollback';
    expect(post).toContain(`'${sinRollback}'`);
    expect(sinRollback.length).toBeLessThanOrEqual(140);
    expect(post.indexOf("process.env.HOSTING === 'ninguno'")).toBeLessThan(post.indexOf('rollback intentado'));
    expect(post).toContain(
      "'Despliegue a medias: Hosting publicado, pero firebase deploy no terminó bien; sin rollback'");
    expect(post).not.toContain('Functions sin confirmar o en estado inesperado');
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
