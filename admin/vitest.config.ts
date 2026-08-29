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
  },
});
