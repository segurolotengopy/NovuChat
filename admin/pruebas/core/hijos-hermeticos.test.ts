/**
 * EL HIJO DE UNA SUITE HEREDA EL EMULADOR, NUNCA LAS ADC (#245; regla escrita
 * en docs/arquitectura/f2-orden-de-movimiento.md).
 *
 * Toda suite que lanza un script con Node (`spawnSync(process.execPath,
 * [SCRIPT, …], { … })`) le pasa `entorno-del-hijo.ts`: el emulador, Auth a un
 * puerto muerto, credenciales inexistentes y sin servidor de metadatos. Lee
 * las suites con el parser de TypeScript; un `-e` de Node (`--input-type`) no
 * es un script y no cuenta. Sin emulador ni red.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const aqui = join(dirname(fileURLToPath(import.meta.url)), '..');
const suites = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? (e.name === 'node_modules' ? [] : suites(join(dir, e.name))) : e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []));

/** Las funciones de `child_process` que lanzan un proceso, también como `cp.spawnSync`. */
const LANZADORES = new Set(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'fork', 'execSync', 'exec']);
/** Un `-e` de Node no es un script (`--eval`, `--input-type`). */
const ES_EVAL = (t: string) => t === '-e' || t === '--eval' || t === '-p' || t.startsWith('--input-type');

/**
 * Los lanzamientos de Node o de bash que NO pasan `env: entornoDelEmulador(…)`,
 * o que lo pisan después con un spread. Conservador: si el binario, los
 * argumentos o las opciones no se pueden leer como literales, cuenta como
 * script (revisión de seguridad del #259).
 */
function sinEntorno(ruta: string, texto = readFileSync(ruta, 'utf8')): string[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const malos: string[] = [];
  const lugar = (n: ts.Node) => `${ruta.startsWith(aqui) ? ruta.slice(aqui.length + 1) : ruta}:${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1}`;
  const nombreDe = (e: ts.Expression) => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '');
  const conEntorno = (o: ts.Expression | undefined): boolean => {
    if (!o || !ts.isObjectLiteralExpression(o)) return false;
    const i = o.properties.findIndex((p) => ts.isPropertyAssignment(p) && p.name.getText(fuente) === 'env');
    if (i < 0) return false;
    const env = o.properties[i] as ts.PropertyAssignment;
    const bien = ts.isCallExpression(env.initializer) && env.initializer.expression.getText(fuente) === 'entornoDelEmulador';
    const pisado = o.properties.slice(i + 1).some((p) => ts.isSpreadAssignment(p) || (p.name?.getText(fuente) === 'env'));
    return bien && !pisado;
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && LANZADORES.has(nombreDe(n.expression))) {
      const nombre = nombreDe(n.expression);
      const [primero, segundo, tercero] = n.arguments;
      if (nombre === 'exec' || nombre === 'execSync') {
        // Solo el de child_process: una cadena con el comando (`regex.exec(x)` no lo es).
        const cmd = primero && (ts.isStringLiteral(primero) || ts.isNoSubstitutionTemplateLiteral(primero) || ts.isTemplateExpression(primero))
          ? primero.getText(fuente) : null;
        if (cmd !== null && /^[`'"]\s*(node|bash|sh)\b/.test(cmd) && !conEntorno(segundo)) malos.push(lugar(n));
      } else if (nombre === 'fork') {
        const opciones = segundo && ts.isArrayLiteralExpression(segundo) ? tercero : segundo;
        if (!conEntorno(opciones)) malos.push(lugar(n));
      } else if (primero) {
        const bin = primero.getText(fuente);
        const esNodeOBash = bin === 'process.execPath' || /^['"`](node|bash|sh)['"`]$/.test(bin);
        const binarioDesconocido = !ts.isStringLiteral(primero) && !ts.isNoSubstitutionTemplateLiteral(primero) && bin !== 'process.execPath';
        if (esNodeOBash || binarioDesconocido) {
          const args = segundo && ts.isArrayLiteralExpression(segundo) ? segundo : null;
          const esEval = args !== null && args.elements.some((e) => ts.isStringLiteral(e) && ES_EVAL(e.text));
          const opciones = args !== null || (segundo && !ts.isObjectLiteralExpression(segundo)) ? tercero : segundo;
          if (!esEval && !conEntorno(opciones)) malos.push(lugar(n));
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return malos;
}

describe('el hijo de una suite hereda el emulador, nunca las ADC', () => {
  it('el entorno apunta al emulador y deja sin salida a la nube', () => {
    const e = entornoDelEmulador('127.0.0.1:8231');
    expect(e).toMatchObject({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8231',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1',
      GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/adc.json',
      CLOUDSDK_CONFIG: '/nonexistent/gcloud',
      METADATA_SERVER_DETECTION: 'none',
    });
    // Aunque el proceso de la prueba traiga credenciales reales, no pasan.
    const antes = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    process.env['GOOGLE_APPLICATION_CREDENTIALS'] = '/ruta/ficticia/adc.json';
    try {
      expect(entornoDelEmulador('x').GOOGLE_APPLICATION_CREDENTIALS).toBe('/nonexistent/adc.json');
      // Ni por `extra`: las variables propias de una suite no pisan las fijas.
      expect(entornoDelEmulador('x', { GOOGLE_APPLICATION_CREDENTIALS: '/ruta/ficticia/adc.json', METADATA_SERVER_DETECTION: 'assume-present' }))
        .toMatchObject({ GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/adc.json', METADATA_SERVER_DETECTION: 'none' });
    } finally {
      if (antes === undefined) delete process.env['GOOGLE_APPLICATION_CREDENTIALS']; else process.env['GOOGLE_APPLICATION_CREDENTIALS'] = antes;
    }
  });

  it('toda suite que lanza un script con Node le pasa entornoDelEmulador', () => {
    const todas = suites(aqui);
    expect(todas.length).toBeGreaterThan(50); // control de que el recorrido encuentra las suites
    expect(todas.flatMap((r) => sinEntorno(r))).toEqual([]);
  });

  it('el control detecta el entorno heredado o ausente en toda forma de lanzar, y no cuenta un -e de Node (control negativo)', () => {
    const malos = [
      'spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST } });',
      "spawnSync(process.execPath, [SCRIPT, '--proyecto', P], { encoding: 'utf8' });",
      'spawnSync(process.execPath, args, { env: { ...process.env } });',
      "spawnSync(process.execPath, ['--no-warnings', SCRIPT], {});",
      "spawnSync('node', [SCRIPT], {});",
      'spawnSync(nodo, [SCRIPT], {});',
      "cp.spawnSync(process.execPath, [SCRIPT], {});",
      "execFileSync(process.execPath, [SCRIPT, 'verificar'], { encoding: 'utf8' });",
      "execFile(process.execPath, [SCRIPT], {}, () => {});",
      "spawn(process.execPath, [SCRIPT], {});",
      'fork(SCRIPT, [], {});',
      'fork(SCRIPT);',
      "execSync(`node ${SCRIPT}`);",
      "spawnSync('bash', [SH], { encoding: 'utf8' });",
      'spawnSync(process.execPath, [SCRIPT], { env: entornoDelEmulador(HOST), ...otras });',
      'spawnSync(process.execPath, [SCRIPT], opciones);',
    ];
    for (const m of malos) expect(sinEntorno('x.ts', m), m).toEqual(['x.ts:1']);
    const bien = [
      'spawnSync(process.execPath, [SCRIPT], { env: entornoDelEmulador(HOST) });',
      "spawnSync(process.execPath, args, { encoding: 'utf8', env: entornoDelEmulador(HOST) });",
      "spawnSync('bash', [SH], { env: entornoDelEmulador(undefined, { X: 'y' }) });",
      "spawnSync(process.execPath, ['--input-type=module', '-e', 'x'], {});",
      "execFileSync('git', ['ls-files'], { cwd: X });",
      '/x/.exec(texto);',
    ];
    for (const b of bien) expect(sinEntorno('x.ts', b), b).toEqual([]);
  });
});
