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
 */
import { describe, expect, it } from 'vitest';

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
    it(`${nombre}: región ${REGION} y cuenta sa-functions`, () => {
      const e = f.__endpoint!;
      expect(e.region, `${nombre} sin región`).toEqual([REGION]);
      expect(String(e.serviceAccountEmail ?? ''), `${nombre} sin cuenta de servicio`).toMatch(/^sa-functions@/);
    });
  }
});
