/**
 * Los valores del entorno de las pruebas de navegador, en un solo lugar. Todo es ficticio y local: proyecto `demo-*`
 * (el SDK ni valida la clave) y puertos propios, DISTINTOS de los de `scripts/emuladores.sh` (8232, 9299), para que
 * esta suite conviva con un panel armado a mano.
 */

/**
 * CARRILES. Cuatro personas o agentes pueden correr la suite a la vez, cada uno con SUS emuladores y SUS puertos: `E2E_CARRIL=1..4`
 * suma `carril × 10` a todos los puertos (el carril 0, el de siempre, no suma nada). Sin esto, la siembra de un carril borraría los
 * datos de otro. `bash pruebas-navegador/emuladores.sh` y `playwright` leen la misma variable.
 */
export const CARRIL = Number(process.env['E2E_CARRIL'] ?? 0);
if (!Number.isInteger(CARRIL) || CARRIL < 0 || CARRIL > 9) throw new Error('E2E_CARRIL tiene que ser un entero de 0 a 9.');
const D = CARRIL * 10;

export const PROYECTO = 'demo-novuchat-e2e';
export const PUERTO_FIRESTORE = 8332 + D;
export const PUERTO_FIRESTORE_WS = 9251 + D;
export const PUERTO_AUTH = 9399 + D;
export const PUERTO_WEB = 5373 + D;
export const PUERTO_FUNCTIONS = 5231 + D;
export const URL_WEB = `http://127.0.0.1:${PUERTO_WEB}`;
/** La consola ya construida y servida con las cabeceras REALES de `firebase.json` (CSP, Permissions-Policy), puerto propio. */
export const PUERTO_CABECERAS = 5340 + D;
/** El catálogo web público es OTRO sitio de Hosting, con su propia política (target `catalogo` de `firebase.json`). */
export const PUERTO_CATALOGO = 5341 + D;
export const URL_CATALOGO = `http://127.0.0.1:${PUERTO_CATALOGO}`;
export const FICHA_DEL_CATALOGO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const URL_CABECERAS = `http://127.0.0.1:${PUERTO_CABECERAS}`;
/** Lo único que se le suma a `connect-src`: los emuladores locales (sin esto el inicio de sesión no puede ni empezar). */
export const CONNECT_EMULADORES = `http://127.0.0.1:${PUERTO_AUTH} http://127.0.0.1:${PUERTO_FIRESTORE} ws://127.0.0.1:${PUERTO_FIRESTORE_WS} http://127.0.0.1:${PUERTO_FUNCTIONS}`;

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
  /** Se crean con `crearUsuarioDeEnsayo` (no los trae la siembra). */
  operadorFogon: 'operador.fogon@ejemplo.com',
  sinVerificarFogon: 'sinverificar.fogon@ejemplo.com',
} as const;
