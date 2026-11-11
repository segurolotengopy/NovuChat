/**
 * TODO `defineSecret` DE LAS FUNCTIONS CAE EN UN PREFIJO DE LA CONDICIÓN DE IAM DE `desplegadorSecretos`.
 *
 * La cuenta de despliegue lee los metadatos de un secreto solo si su nombre cae en un prefijo de la condición
 * «secretos-de-las-functions» (`scripts/preparar-staging.sh`, fase `cuentas`; en producción la amplía a mano cada
 * `scripts/nube-*.sh`). Un secreto nuevo con un prefijo que la condición no cubre rompe `desplegar-staging` con
 * «403 secretmanager.secrets.get denied» al fusionar (le pasó a `SALIDA_PERSONA_RUTAS` el 17/10/2026 y casi le pasa a
 * `ALERTA_OPERATIVA_HMAC` y `RESEND_API_KEY_ALERTAS` en el #851). Esta prueba parsea la condición del script y
 * recorre los `defineSecret` del código; si uno no cae en un prefijo, falla ANTES de fusionar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const FUENTE = join(RAIZ, 'admin', 'functions', 'src');
const PREPARAR = readFileSync(join(RAIZ, 'scripts', 'preparar-staging.sh'), 'utf8');

function archivos(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

/** Los secretos que el código declara, con el archivo que los declara. */
export function secretosDeclarados(fuentes: Array<{ ruta: string; texto: string }>): Array<{ nombre: string; ruta: string }> {
  return fuentes.flatMap(({ ruta, texto }) =>
    [...texto.matchAll(/\bdefineSecret\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => ({ nombre: m[1]!, ruta })));
}

/** Los prefijos de la condición de `desplegadorSecretos` que arma el script de staging. */
export function prefijosDeLaCondicion(script: string): string[] {
  const linea = script.split('\n').find((l) => l.includes('local cond="expression=') && l.includes('secrets/INGESTA_'));
  if (!linea) throw new Error('no encontré la condición de desplegadorSecretos en preparar-staging.sh');
  return [...linea.matchAll(/secrets\/([A-Z0-9_]+)\\"/g)].map((m) => m[1]!);
}

/** Un nombre cae en la condición si EMPIEZA con alguno de los prefijos (como `startsWith`). */
export const cubierto = (nombre: string, prefijos: readonly string[]): boolean => prefijos.some((p) => nombre.startsWith(p));

describe('los secretos de las Functions caen en un prefijo de la condición de IAM del despliegue', () => {
  const declarados = secretosDeclarados(archivos(FUENTE).map((ruta) => ({ ruta, texto: readFileSync(ruta, 'utf8') })));
  const prefijos = prefijosDeLaCondicion(PREPARAR);

  it('control: el detector ve los secretos y los prefijos (no pasa en vacío)', () => {
    expect(declarados.length).toBeGreaterThanOrEqual(28);
    expect(prefijos).toEqual(expect.arrayContaining(['INGESTA_', 'GEMINI_API_KEY', 'COBRADOR_', 'SALIDA_PERSONA_', 'ALERTAS_']));
    expect(declarados.map((d) => d.nombre)).toEqual(expect.arrayContaining(['ALERTAS_HMAC', 'ALERTAS_RESEND_API_KEY', 'INGESTA_DEMOA']));
  });

  it('NIEGA: ningún defineSecret queda fuera de la condición', () => {
    const fuera = declarados.filter((d) => !cubierto(d.nombre, prefijos)).map((d) => `${d.nombre} (${d.ruta.slice(RAIZ.length + 1)})`);
    expect(fuera, 'un secreto fuera de los prefijos rompe el despliegue con 403: agregue su prefijo a preparar-staging.sh y a un script nube-*.sh, o renómbrelo').toEqual([]);
  });

  it('NIEGA (mutación): los nombres viejos de la alerta NO caían, y un prefijo con comodín no es un prefijo', () => {
    expect(cubierto('ALERTA_OPERATIVA_HMAC', prefijos)).toBe(false);
    expect(cubierto('RESEND_API_KEY_ALERTAS', prefijos)).toBe(false);
    expect(prefijos.every((p) => /^[A-Z0-9_]+$/.test(p) && !p.includes('*'))).toBe(true);
    // Si la condición perdiera ALERTAS_, los dos secretos de hoy quedarían fuera.
    const sinAlertas = prefijos.filter((p) => p !== 'ALERTAS_');
    expect(declarados.filter((d) => !cubierto(d.nombre, sinAlertas)).map((d) => d.nombre).sort()).toEqual(['ALERTAS_HMAC', 'ALERTAS_RESEND_API_KEY']);
  });

  it('el prefijo ALERTAS_ es EXACTO y el mismo en preparar-staging.sh y en nube-alertas.sh', () => {
    const nube = readFileSync(join(RAIZ, 'scripts', 'nube-alertas.sh'), 'utf8');
    expect(nube).toContain('readonly PREFIJO="ALERTAS_"');
    expect(PREPARAR).toContain('PREFIJO_ALERTAS="ALERTAS_"');
    expect(nube).toContain('readonly SECRETO_HMAC="ALERTAS_HMAC"');
    expect(nube).toContain('readonly SECRETO_RESEND="ALERTAS_RESEND_API_KEY"');
  });

  it('la detección falla si un secreto nuevo se sale del prefijo (simulación sobre un texto)', () => {
    const nuevo = secretosDeclarados([{ ruta: 'x.ts', texto: "const S = defineSecret('OTRO_SECRETO_NUEVO');" }]);
    expect(nuevo.map((n) => n.nombre)).toEqual(['OTRO_SECRETO_NUEVO']);
    expect(cubierto(nuevo[0]!.nombre, prefijos)).toBe(false);
  });
});
