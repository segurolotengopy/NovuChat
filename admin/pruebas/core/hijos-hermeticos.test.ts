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

/** Los lanzamientos de un script con Node que NO pasan `entornoDelEmulador(…)` como `env`. */
function sinEntorno(ruta: string, texto = readFileSync(ruta, 'utf8')): string[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const malos: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'spawnSync') {
      const [bin, args, opciones] = n.arguments;
      const esNode = bin && ts.isPropertyAccessExpression(bin) && bin.getText(fuente) === 'process.execPath';
      const primero = args && ts.isArrayLiteralExpression(args) ? args.elements[0] : undefined;
      const esScript = primero !== undefined && !ts.isStringLiteral(primero);
      if (esNode && esScript) {
        const env = opciones && ts.isObjectLiteralExpression(opciones)
          ? opciones.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(fuente) === 'env') : undefined;
        const bien = env && ts.isPropertyAssignment(env) && ts.isCallExpression(env.initializer)
          && env.initializer.expression.getText(fuente) === 'entornoDelEmulador';
        if (!bien) malos.push(`${ruta.startsWith(aqui) ? ruta.slice(aqui.length + 1) : ruta}:${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1}`);
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
      METADATA_SERVER_DETECTION: 'none',
    });
    // Aunque el proceso de la prueba traiga credenciales reales, no pasan.
    const antes = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    process.env['GOOGLE_APPLICATION_CREDENTIALS'] = '/home/alguien/.config/gcloud/adc.json';
    try {
      expect(entornoDelEmulador('x').GOOGLE_APPLICATION_CREDENTIALS).toBe('/nonexistent/adc.json');
    } finally {
      if (antes === undefined) delete process.env['GOOGLE_APPLICATION_CREDENTIALS']; else process.env['GOOGLE_APPLICATION_CREDENTIALS'] = antes;
    }
  });

  it('toda suite que lanza un script con Node le pasa entornoDelEmulador', () => {
    const todas = suites(aqui);
    expect(todas.length).toBeGreaterThan(50); // control de que el recorrido encuentra las suites
    expect(todas.flatMap((r) => sinEntorno(r))).toEqual([]);
  });

  it('el control detecta el entorno heredado o ausente, y no cuenta un -e de Node (control negativo)', () => {
    expect(sinEntorno('x.ts', 'spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST } });')).toEqual(['x.ts:1']);
    expect(sinEntorno('x.ts', "spawnSync(process.execPath, [SCRIPT, '--proyecto', P], { encoding: 'utf8' });")).toEqual(['x.ts:1']);
    expect(sinEntorno('x.ts', 'spawnSync(process.execPath, [SCRIPT], { env: entornoDelEmulador(HOST) });')).toEqual([]);
    expect(sinEntorno('x.ts', "spawnSync(process.execPath, ['--input-type=module', '-e', 'x'], {});")).toEqual([]);
  });
});
