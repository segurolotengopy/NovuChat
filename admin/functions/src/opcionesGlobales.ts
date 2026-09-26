/**
 * Las opciones globales de TODAS las Functions. Se importa PRIMERO en index.ts.
 *
 * Por qué es un módulo aparte (22/09/2026): el código compila a CommonJS, así
 * que los `import` de index.ts se ejecutan en el orden en que están escritos, y
 * cada Function toma las opciones globales en el momento en que se crea, al
 * cargarse su módulo. Cuando index.ts importó pagos.ts arriba de
 * `setGlobalOptions`, pagos.ts cargó ingesta.ts y otros antes de tiempo, y
 * ocho Functions —ingesta y configuracionFlujo entre ellas— quedaron en el
 * manifiesto sin la cuenta sa-functions (y una, sin región). Con las opciones
 * en su propio módulo, importado primero, ningún import futuro puede
 * adelantarse. Lo vigila admin/pruebas/region-y-cuenta.test.ts.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './region.js';

// CUENTA PROPIA, NO LA DE CÓMPUTO POR DEFECTO (2026-09-13). La de cómputo tiene
// rol Editor: quien lograra ejecutar código en una Function tendría casi todo
// el proyecto. `sa-functions` tiene solo lo que las Functions usan —Firestore,
// Auth (getUserByEmail, setCustomUserClaims, revokeRefreshTokens), lectura de
// sus secretos, los disparadores de Firestore y logs— y NO puede cambiar
// permisos, redesplegar ni hacerse pasar por otra cuenta; verificado con Policy
// Troubleshooter. Permisos y procedimiento en .github/DESPLIEGUE-FIREBASE.md,
// «Estado real». El correo va escrito: los de cuenta de servicio están
// exceptuados de la convención de repositorio público.
// Un secreto nuevo necesita `secretAccessor` para ESTA cuenta, uno por uno
// (ver `firma.ts`, «CUANDO SE ACABEN LOS VEINTE»).
//
// EL PROYECTO SE DERIVA, NO SE ESCRIBE (2026-09-25, staging). Hasta hoy el
// correo llevaba escrito el proyecto de producción, y eso hacía imposible
// desplegar las mismas Functions en el proyecto de staging: pedían correr con
// una cuenta de OTRO proyecto. Se arma con GCLOUD_PROJECT, que firebase-tools
// fija al proyecto DESTINO cuando carga este código para descubrir las
// Functions (`lib/functions/env.js`, línea 278 de 15.29.0) y que Cloud Run
// fija en tiempo de ejecución. En producción resuelve al MISMO correo de
// siempre; en staging, al `sa-functions` de ese proyecto.
//
// POR QUÉ NO LA ABREVIATURA `sa-functions@`, que firebase-tools también acepta
// (`lib/gcp/proto.js`, `formatServiceAccount`): la completa recién al crear el
// servicio, pero el manifiesto la lleva literal (`lib/v2/options.js`,
// `optionsToEndpoint` no la convierte; `discovery/v1alpha1.js` la copia tal
// cual) y `deploy/functions/ensure.js` compara esa cadena cruda con el correo
// completo que devuelve GCF: el delta de accesos a secretos da los 25
// `defineSecret` en cada despliegue, y `fabricator.js` llama a `setIamPolicy`
// de cada secreto con el miembro `serviceAccount:sa-functions@` ANTES de crear
// ninguna Function. El desplegador no tiene `secrets.setIamPolicy` a propósito
// (DESPLIEGUE-FIREBASE.md, `desplegadorSecretos`): 403 en producción y 400 en
// staging, y el `--dry-run` NO lo ve (solo corre `checkSecretAccess`).
// Reproducido contra `ensure.secretsAccessDelta` en
// admin/pruebas/manifiesto-secretos.test.ts; la forma del correo la vigila
// admin/pruebas/region-y-cuenta.test.ts.
//
// Sin GCLOUD_PROJECT se FALLA, no se adivina: un manifiesto con un correo a
// medias es exactamente el defecto de arriba. En las pruebas lo fija
// vitest.config.ts.
const proyecto = process.env['GCLOUD_PROJECT'];
if (!proyecto) {
  throw new Error(
    'opcionesGlobales: GCLOUD_PROJECT no está definida; sin ella no se puede armar el correo de sa-functions ' +
      '(firebase-tools la fija al descubrir las Functions; en las pruebas, vitest.config.ts).',
  );
}
setGlobalOptions({
  region: REGION,
  maxInstances: 10,
  serviceAccount: `sa-functions@${proyecto}.iam.gserviceaccount.com`,
});
