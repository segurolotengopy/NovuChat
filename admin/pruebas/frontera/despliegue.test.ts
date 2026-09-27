/**
 * =============================================================================
 * LO QUE SE DESPLIEGA NO CAMBIA AL MOVER ARCHIVOS (F2, tanda cero)
 * =============================================================================
 *
 * F2 mueve archivos de `functions/src` sin cambiar lógica, y `index.ts`
 * reexporta desde las carpetas nuevas para que lo desplegado sea lo mismo. Esta
 * prueba lo comprueba: los nombres que exporta `index.ts` (cada uno es una
 * Function desplegada) y, de cada uno, su `__endpoint` (región, cuenta de
 * servicio, secretos, disparador, instancias, memoria, tiempo) tienen que ser
 * EXACTAMENTE los de `despliegue.json`, en esta carpeta.
 *
 * Si falta un nombre, el despliegue falla, o con `--force` BORRA la Function;
 * si cambia un secreto o una región, la Function se recrea distinta. Ninguna
 * de las dos cosas puede pasar en una tanda de F2.
 *
 * Un cambio LEGÍTIMO (una Function nueva, fuera de F2) regenera el archivo:
 *   ACTUALIZAR_DESPLIEGUE=si pnpm exec vitest run pruebas/frontera/despliegue.test.ts
 * y el diff de `despliegue.json` va en el PR, a la vista. La carpeta es de la
 * coordinadora (`docs/arquitectura/agentes.md`).
 *
 * LO QUE NO CUBRE (revisión de seguridad del #239): el `__endpoint` es la
 * forma que firebase-tools lee para crear la Function, no todo lo que corre.
 * Quedan fuera las opciones de ejecución de las callables (`cors`,
 * `enforceAppCheck`, `consumeAppCheckToken`), el VALOR de los parámetros (solo
 * se guarda `params.INSTANCIAS_MINIMAS`, no su default), la forma de staging
 * (`cpu` con CPU_FRACCIONARIA, que vitest.config.ts fija vacía) y el
 * comportamiento de cada handler, que cubren sus suites. Para F2 alcanza: lo
 * que un movimiento puede romper es el nombre, el orden de `setGlobalOptions`
 * (cuenta y región) y los secretos.
 *
 * Pura: importa `index.ts` como `region-y-cuenta.test.ts`, con GCLOUD_PROJECT
 * de vitest.config.ts; no abre Firebase.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ARCHIVO = join(dirname(fileURLToPath(import.meta.url)), 'despliegue.json');

/** Nombre → __endpoint (o el tipo, si la exportación no es una Function). */
async function desplegado(): Promise<Record<string, unknown>> {
  const indice = (await import('../../functions/src/index.ts')) as Record<string, { __endpoint?: unknown }>;
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(indice).sort()) o[k] = indice[k]?.__endpoint ?? typeof indice[k];
  return JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
}

describe('lo que se despliega', () => {
  it('index.ts exporta exactamente las Functions de despliegue.json, con el mismo __endpoint', async () => {
    const actual = await desplegado();
    if (process.env['ACTUALIZAR_DESPLIEGUE'] === 'si') {
      // Regenerar compara el archivo consigo mismo: nunca en el CI.
      if (process.env['CI']) throw new Error('ACTUALIZAR_DESPLIEGUE no se usa en el CI: pasaría en vacío.');
      const correos = JSON.stringify(actual).match(/[\w.-]+@[\w.-]+/g) ?? [];
      if (correos.some((c) => !c.endsWith('@demo-test.iam.gserviceaccount.com'))) {
        throw new Error(`Un correo que no es del proyecto de prueba: ${correos.join(', ')}`);
      }
      writeFileSync(ARCHIVO, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const esperado = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(actual), 'nombres exportados por index.ts').toEqual(Object.keys(esperado));
    for (const nombre of Object.keys(esperado)) {
      expect(actual[nombre], `${nombre}: su __endpoint cambió`).toEqual(esperado[nombre]);
    }
  });

  it('el archivo tiene las Functions de hoy (control de que no pasa en vacío)', () => {
    const esperado = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Record<string, { platform?: string }>;
    expect(Object.keys(esperado).length).toBeGreaterThanOrEqual(55);
    expect(Object.values(esperado).filter((e) => e?.platform === 'gcfv2').length).toBeGreaterThanOrEqual(50);
  });
});
