/**
 * Los valores del entorno de las pruebas de navegador, en un solo lugar. Todo es ficticio y local: proyecto `demo-*`
 * (el SDK ni valida la clave) y puertos propios, DISTINTOS de los de `scripts/emuladores.sh` (8232, 9299), para que
 * esta suite conviva con un panel armado a mano.
 */
export const PROYECTO = 'demo-novuchat-e2e';
export const PUERTO_FIRESTORE = 8332;
export const PUERTO_FIRESTORE_WS = 9251;
export const PUERTO_AUTH = 9399;
export const PUERTO_WEB = 5373;
export const URL_WEB = `http://127.0.0.1:${PUERTO_WEB}`;
/** La consola ya construida y servida con las cabeceras REALES de `firebase.json` (CSP, Permissions-Policy), puerto propio. */
export const PUERTO_CABECERAS = 5340;
export const URL_CABECERAS = `http://127.0.0.1:${PUERTO_CABECERAS}`;
/** Lo único que se le suma a `connect-src`: los emuladores locales (sin esto el inicio de sesión no puede ni empezar). */
export const CONNECT_EMULADORES = `http://127.0.0.1:${PUERTO_AUTH} http://127.0.0.1:${PUERTO_FIRESTORE} ws://127.0.0.1:${PUERTO_FIRESTORE_WS}`;

/** Variables de Vite que apuntan la consola a los emuladores propios. */
export const VARIABLES_DE_VITE = {
  VITE_FIREBASE_API_KEY: 'clave-ficticia-de-emulador',
  VITE_FIREBASE_AUTH_DOMAIN: `${PROYECTO}.firebaseapp.com`,
  VITE_FIREBASE_PROJECT_ID: PROYECTO,
  VITE_FIREBASE_APP_ID: '1:0:web:0',
  VITE_APPCHECK_SITE_KEY: 'sin-appcheck-en-emuladores',
  VITE_USAR_EMULADORES: 'true',
  VITE_AUTH_EMULATOR_PORT: String(PUERTO_AUTH),
  VITE_FIRESTORE_EMULATOR_PORT: String(PUERTO_FIRESTORE),
} as const;

/** Usuarios y comercios de `scripts/sembrar.mjs` (valores de prueba que ya están en el repositorio). */
export const CLAVE_DE_PRUEBA = 'NovuChat-Demo-2026';
export const USUARIOS = {
  adminFogon: 'admin.fogon@ejemplo.com',
  adminAurora: 'admin.aurora@ejemplo.com',
  operadorAurora: 'operador.aurora@ejemplo.com',
} as const;
