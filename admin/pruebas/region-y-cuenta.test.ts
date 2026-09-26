/**
 * Toda Function exportada se despliega en la región del proyecto y corre con
 * `sa-functions`, nunca con la cuenta de cómputo por defecto.
 *
 * Por qué existe (22/09/2026): `fijarTelefonosPago` se creaba sin objeto de
 * opciones en un módulo que index.ts importa ANTES de `setGlobalOptions`, y el
 * manifiesto la dejaba sin región ni cuenta. Se habría desplegado en
 * us-central1 con la cuenta de cómputo —que desde el 13/09 no puede leer
 * Firestore— y la consola la habría buscado en otra región. Esta prueba lee el
 * mismo `__endpoint` del que sale el manifiesto de despliegue, Function por
 * Function, así que ninguna nueva puede volver a quedar afuera.
 *
 * Endurecida el 25/09/2026 (revisión de #205): la cuenta tiene que ser el
 * correo COMPLETO `sa-functions@<proyecto>.iam.gserviceaccount.com`, nunca la
 * abreviatura `sa-functions@`. firebase-tools la acepta al crear el servicio,
 * pero el manifiesto la lleva literal y `ensure.secretsAccessDelta` la compara
 * con el correo completo que devuelve GCF: el delta da todos los secretos y el
 * despliegue llama a `setIamPolicy` con un miembro inválido antes de crear
 * ninguna Function (ver manifiesto-secretos.test.ts, que lo reproduce). El
 * correo sale de GCLOUD_PROJECT, que acá fija vitest.config.ts y acá mismo
 * se asegura antes del import, como firebase-tools lo fija al descubrir.
 */
import { describe, expect, it } from 'vitest';

process.env['GCLOUD_PROJECT'] ??= 'demo-test';
const PROYECTO = process.env['GCLOUD_PROJECT'];

const indice = (await import('../functions/src/index.ts')) as Record<string, unknown>;
const { REGION } = await import('../functions/src/region.ts');

type ConEndpoint = { __endpoint?: { region?: string[]; serviceAccountEmail?: string | null } };
const funciones = Object.entries(indice).filter(
  ([, v]) => typeof v === 'function' && (v as ConEndpoint).__endpoint !== undefined,
) as [string, ConEndpoint][];

describe('región y cuenta de servicio de cada Function exportada', () => {
  it('hay Functions para revisar', () => {
    expect(funciones.length).toBeGreaterThan(40);
  });

  for (const [nombre, f] of funciones) {
    it(`${nombre}: región ${REGION} y cuenta sa-functions con correo completo`, () => {
      const e = f.__endpoint!;
      expect(e.region, `${nombre} sin región`).toEqual([REGION]);
      const cuenta = String(e.serviceAccountEmail ?? '');
      expect(cuenta, `${nombre} sin cuenta de servicio o con la abreviatura`).toMatch(
        /^sa-functions@[a-z0-9-]+\.iam\.gserviceaccount\.com$/,
      );
      expect(cuenta, `${nombre} con la cuenta de otro proyecto`).toBe(
        `sa-functions@${PROYECTO}.iam.gserviceaccount.com`,
      );
    });
  }
});
