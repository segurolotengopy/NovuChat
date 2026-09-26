/**
 * El manifiesto de las Functions lleva el correo COMPLETO de sa-functions, y
 * con él firebase-tools no intenta reescribir la política de ningún secreto.
 *
 * Por qué existe (25/09/2026, revisión de seguridad de #205). Para que las
 * mismas Functions se desplieguen en staging y en producción, la cuenta dejó
 * de llevar el proyecto escrito. La primera forma elegida fue la abreviatura
 * `sa-functions@`, que firebase-tools acepta al crear el servicio
 * (`lib/gcp/proto.js`, formatServiceAccount). Pero el camino de los secretos
 * es otro: `deploy/functions/ensure.js` (secretsToServiceAccounts /
 * secretsAccessDelta) compara la cadena CRUDA del manifiesto con el correo
 * completo que devuelve GCF; con la abreviatura el delta da TODOS los
 * `defineSecret` en TODOS los despliegues, y `fabricator.js` llama a
 * `setIamPolicy` de cada secreto con el miembro `serviceAccount:sa-functions@`
 * antes de crear ninguna Function. El desplegador de producción no tiene
 * `secrets.setIamPolicy` a propósito (`desplegadorSecretos`): 403 después de
 * consumir la aprobación; en staging, 400 por miembro malformado. Y el
 * `--dry-run` no lo ve: solo corre `checkSecretAccess`.
 *
 * Esta prueba reproduce ese delta con el `ensure.js` del firebase-tools
 * INSTALADO (el que despliega), sobre la Function `ingesta` real: con el correo
 * derivado de GCLOUD_PROJECT el delta es vacío; con la abreviatura, no. Y
 * comprueba que sin GCLOUD_PROJECT el módulo falla en vez de publicar un
 * manifiesto a medias.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

process.env['GCLOUD_PROJECT'] ??= 'demo-test';
const PROYECTO = process.env['GCLOUD_PROJECT'];
const CORREO_COMPLETO = `sa-functions@${PROYECTO}.iam.gserviceaccount.com`;

// CommonJS del firebase-tools instalado; no publica `exports`, así que la ruta
// interna es la única forma, y es la misma que usa el despliegue.
const require = createRequire(import.meta.url);
const ensure = require('firebase-tools/lib/deploy/functions/ensure.js') as {
  secretsAccessDelta: (a: { projectId: string; wantBackend: unknown; haveBackend: unknown }) => Promise<Record<string, string[]>>;
};
const backend = require('firebase-tools/lib/deploy/functions/backend.js') as { of: (...e: unknown[]) => unknown };

type Endpoint = {
  serviceAccountEmail?: string | null;
  secretEnvironmentVariables?: { key: string; secret?: string; projectId?: string }[];
};
const indice = (await import('../functions/src/index.ts')) as Record<string, { __endpoint?: Endpoint }>;
const ingesta = indice['ingesta']?.__endpoint;
if (!ingesta) throw new Error('ingesta no expone __endpoint');

/** Los secretos como los deja el descubrimiento (discovery/v1alpha1.js): key → secret del mismo proyecto. */
const secretos = (ingesta.secretEnvironmentVariables ?? []).map((s) => ({
  key: s.key,
  secret: s.secret ?? s.key,
  projectId: PROYECTO,
}));

/** Un endpoint gcfv2 como el que firebase-tools arma para `ingesta`, con la cuenta que se le pase. */
function endpoint(serviceAccount: string) {
  return {
    id: 'ingesta',
    project: PROYECTO,
    region: 'us-east1',
    platform: 'gcfv2',
    entryPoint: 'ingesta',
    runtime: 'nodejs22',
    httpsTrigger: {},
    serviceAccount,
    secretEnvironmentVariables: secretos,
  };
}

describe('la cuenta del manifiesto y el delta de accesos a secretos', () => {
  it('ingesta declara sus secretos: los dos demos y la reserva de 20 clientes', () => {
    // firma.ts: INGESTA_DEMOA, INGESTA_DEMOB e INGESTA_CLIENTE01..20.
    expect(secretos.length).toBeGreaterThanOrEqual(22);
    expect(secretos.map((s) => s.secret)).toContain('INGESTA_DEMOA');
    expect(secretos.map((s) => s.secret)).toContain('INGESTA_CLIENTE20');
  });

  it('el manifiesto lleva el correo completo de sa-functions del proyecto', () => {
    expect(ingesta.serviceAccountEmail).toBe(CORREO_COMPLETO);
  });

  it('con el correo del manifiesto, el delta contra lo que GCF devuelve es vacío', async () => {
    const want = backend.of(endpoint(String(ingesta.serviceAccountEmail)));
    const have = backend.of(endpoint(CORREO_COMPLETO));
    await expect(ensure.secretsAccessDelta({ projectId: PROYECTO, wantBackend: want, haveBackend: have })).resolves.toEqual({});
  });

  it('con la abreviatura sa-functions@ el delta trae todos los secretos (el defecto que se cierra)', async () => {
    const want = backend.of(endpoint('sa-functions@'));
    const have = backend.of(endpoint(CORREO_COMPLETO));
    const delta = await ensure.secretsAccessDelta({ projectId: PROYECTO, wantBackend: want, haveBackend: have });
    expect(Object.keys(delta).sort()).toEqual(secretos.map((s) => s.secret).sort());
    for (const cuentas of Object.values(delta)) expect(cuentas).toEqual(['sa-functions@']);
  });

  it('sin GCLOUD_PROJECT el módulo falla en vez de armar un correo a medias', async () => {
    const guardado = process.env['GCLOUD_PROJECT'];
    delete process.env['GCLOUD_PROJECT'];
    vi.resetModules();
    try {
      await expect(import('../functions/src/opcionesGlobales.ts')).rejects.toThrow(/GCLOUD_PROJECT/);
    } finally {
      process.env['GCLOUD_PROJECT'] = guardado;
      vi.resetModules();
    }
  });
});
