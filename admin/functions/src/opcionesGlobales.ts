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
setGlobalOptions({
  region: REGION,
  maxInstances: 10,
  serviceAccount: 'sa-functions@novuchat-demo.iam.gserviceaccount.com',
});
