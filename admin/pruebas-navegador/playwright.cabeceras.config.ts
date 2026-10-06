import { defineConfig } from '@playwright/test';
import { CONNECT_EMULADORES, PUERTO_CABECERAS, URL_CABECERAS, VARIABLES_DE_VITE } from './entorno';

/**
 * Pruebas de navegador CON LAS CABECERAS REALES DE HOSTING. Lo que depende de la política de seguridad (el logo con `blob:`, las
 * imágenes, la geolocalización) solo se ve acá: `vite dev` no pone ninguna cabecera. Construye la consola (tarda un minuto) y la sirve
 * con `scripts/probar-csp.mjs`, que lee la política de `firebase.json` y solo le suma los emuladores locales a `connect-src`.
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './preparar-datos.ts',
  testMatch: '**/*.cabeceras.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: { baseURL: URL_CABECERAS, headless: true, locale: 'es-BO', timezoneId: 'America/La_Paz', trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm --filter @novuchat/admin-web build && node scripts/probar-csp.mjs`,
    cwd: '..',
    url: URL_CABECERAS,
    reuseExistingServer: true,
    timeout: 300_000,
    env: { ...VARIABLES_DE_VITE, PUERTO_CSP: String(PUERTO_CABECERAS), CSP_CONNECT_EXTRA: CONNECT_EMULADORES },
  },
});
