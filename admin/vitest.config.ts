import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pruebas/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // El emulador es un recurso compartido: las suites no corren en paralelo
    // porque cada una limpia Firestore entre pruebas.
    fileParallelism: false,
    pool: 'threads',
    // functions/src/opcionesGlobales.ts arma el correo de sa-functions con
    // GCLOUD_PROJECT y falla si no está (firebase-tools la fija al descubrir
    // las Functions; Cloud Run, en ejecución). Las suites que importan
    // index.ts la necesitan; `demo-` marca que no es un proyecto real.
    env: { GCLOUD_PROJECT: 'demo-test' },
  },
});
