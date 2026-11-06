/**
 * =============================================================================
 * NINGÚN PARÁMETRO DE LAS FUNCTIONS SIN SU VALOR EN EL .env DEL DESPLIEGUE
 * =============================================================================
 *
 * Con `--non-interactive`, firebase-tools exige que todo parámetro declarado
 * con `defineString`/`defineInt`/`defineBoolean`/… tenga su valor en
 * `functions/.env`; el `default` NO cuenta (`lib/deploy/functions/params.js`,
 * `resolveParams`, 15.28.1: «In non-interactive mode but have no value for the
 * following environment variables»). Desde #776 (03/11/2026) dos parámetros del
 * miniCRM declarados con `default: ''` (GOOGLE_OAUTH_CLIENT_ID y
 * CRM_PROYECTO_GCP) tumbaron el despliegue a staging en cada fusión. Producción
 * no puede agregarlos: su `.env` tiene que ser EXACTAMENTE SITIO_PUBLICO +
 * INSTANCIAS_MINIMAS=1 (compuerta del job `desplegar-produccion`).
 *
 * Esta prueba recorre `functions/src` y exige que cada parámetro declarado esté
 * escrito (`NOMBRE=`) en el `.env` que arma `desplegar-staging` Y en el de
 * `desplegar-produccion`. Lo opcional que vacío significa «apagado» se lee de
 * `process.env` (como CPU_FRACCIONARIA), no como parámetro.
 *
 * La segunda mitad comprueba que, sin GOOGLE_OAUTH_CLIENT_ID, la edición del
 * miniCRM por Gmail sigue negando con el verificador REAL (DEPS_REALES).
 *
 * Pura: lee archivos e importa un módulo que no abre Firestore al cargarse.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', 'functions', 'src');
const flujoCi = readFileSync(join(aqui, '../../.github/workflows/ci-node-firebase.yml'), 'utf8');

/** `defineString('X'`, `defineInt("Y"` … (no `defineSecret`: los secretos los resuelve Secret Manager). */
const DECLARACION = /\bdefine(String|Int|Boolean|Float|List|Json)\(\s*['"]([A-Za-z0-9_]+)['"]/g;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

function parametrosDeclarados(fuente: string): string[] {
  return [...fuente.matchAll(DECLARACION)].map((m) => m[2] as string);
}

/** El texto de un job del workflow, desde su cabecera hasta la del siguiente. */
function job(nombre: string): string {
  const i = flujoCi.indexOf(`\n  ${nombre}:\n`);
  expect(i, `no encontré el job ${nombre}`).toBeGreaterThan(-1);
  const resto = flujoCi.slice(i + 1);
  const siguiente = resto.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return siguiente === -1 ? resto : resto.slice(0, siguiente + 1);
}

/** Los nombres que el job escribe en `functions/.env` con `printf '...' ... > functions/.env`. */
function nombresDelEnv(nombreJob: string): string[] {
  const texto = job(nombreJob);
  const m = texto.match(/printf '([^']*)'[^\n]*> functions\/\.env\b/);
  expect(m, `${nombreJob}: no encontré el printf que arma functions/.env`).not.toBeNull();
  return (m![1] as string).split('\\n').filter(Boolean).map((l) => l.split('=')[0] as string);
}

describe('parámetros de las Functions y el .env del despliegue no interactivo', () => {
  const declarados = archivos(raiz).flatMap((f) =>
    parametrosDeclarados(readFileSync(f, 'utf8')).map((nombre) => ({ nombre, archivo: relative(raiz, f) })));

  it('control: el detector encuentra declaraciones (no pasa en vacío)', () => {
    expect(declarados.map((d) => d.nombre)).toEqual(expect.arrayContaining(['INSTANCIAS_MINIMAS', 'SITIO_PUBLICO']));
    expect(parametrosDeclarados("const X = defineString('GOOGLE_OAUTH_CLIENT_ID', { default: '' });"))
      .toEqual(['GOOGLE_OAUTH_CLIENT_ID']);
    expect(parametrosDeclarados('defineBoolean("APAGADO")')).toEqual(['APAGADO']);
    expect(parametrosDeclarados("defineSecret('GEMINI_API_KEY')")).toEqual([]);
  });

  for (const nombreJob of ['desplegar-staging', 'desplegar-produccion']) {
    it(`NIEGA: todo parámetro declarado está escrito en el .env de ${nombreJob}`, () => {
      const enEnv = new Set(nombresDelEnv(nombreJob));
      const faltan = declarados.filter((d) => !enEnv.has(d.nombre)).map((d) => `${d.nombre} (${d.archivo})`);
      expect(faltan, 'con --non-interactive firebase-tools falla: escríbalo en el .env o léalo de process.env').toEqual([]);
    });
  }

  it('NIEGA: los dos opcionales del miniCRM no vuelven a ser parámetros', () => {
    const nombres = declarados.map((d) => d.nombre);
    expect(nombres).not.toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(nombres).not.toContain('CRM_PROYECTO_GCP');
  });

  it('el .env de producción sigue siendo de exactamente dos nombres', () => {
    expect(nombresDelEnv('desplegar-produccion')).toEqual(['SITIO_PUBLICO', 'INSTANCIAS_MINIMAS']);
  });
});

describe('sin GOOGLE_OAUTH_CLIENT_ID la edición por Gmail sigue apagada', () => {
  const previo = process.env['GOOGLE_OAUTH_CLIENT_ID'];
  afterEach(() => {
    if (previo === undefined) delete process.env['GOOGLE_OAUTH_CLIENT_ID'];
    else process.env['GOOGLE_OAUTH_CLIENT_ID'] = previo;
  });

  for (const [caso, valor] of [['ausente', undefined], ['vacía', ''], ['solo espacios', '   ']] as const) {
    it(`NIEGA: variable ${caso} => el verificador real rechaza con sin_audiencia`, async () => {
      if (valor === undefined) delete process.env['GOOGLE_OAUTH_CLIENT_ID'];
      else process.env['GOOGLE_OAUTH_CLIENT_ID'] = valor;
      const { DEPS_REALES } = await import('../functions/src/modulos/crm/editoresCrm.ts');
      const { ErrorToken } = await import('../functions/src/modulos/crm/editores-crm.ts');
      const error = await DEPS_REALES.verificar('cualquier-token').then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorToken);
      expect(error).toMatchObject({ motivo: 'sin_audiencia' });
    });
  }
});
