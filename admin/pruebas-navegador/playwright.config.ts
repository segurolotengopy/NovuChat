import { defineConfig } from '@playwright/test';
import { PUERTO_WEB, URL_WEB, VARIABLES_DE_VITE } from './entorno';

/**
 * Pruebas de navegador de la consola (no son las de `pruebas/`, que corren con vitest): una persona entra, toca y mira.
 * Necesitan los emuladores de Auth y Firestore ya sembrados (`pruebas-navegador/LEEME.md`); la consola se levanta sola.
 * Usan el Chromium que Playwright ya tiene descargado en la máquina: esta configuración no baja nada.
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './preparar-datos.ts',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/*.cabeceras.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: URL_WEB,
    headless: true,
    locale: 'es-BO',
    timezoneId: 'America/La_Paz',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm --filter @novuchat/admin-web exec vite --host 127.0.0.1 --port ${PUERTO_WEB} --strictPort`,
    cwd: '..',
    url: URL_WEB,
    reuseExistingServer: true,
    timeout: 90_000,
    env: { ...VARIABLES_DE_VITE },
  },
});
