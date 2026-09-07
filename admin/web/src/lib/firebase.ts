/**
 * Inicialización del SDK de Firebase para el navegador.
 *
 * La configuración de acá NO es secreta: viaja en el bundle y Google lo
 * documenta explícitamente. Lo que protege los datos son las reglas de
 * Firestore (`admin/firestore.rules`) y App Check. Por eso este archivo puede
 * vivir en un repositorio público sin más cuidado que no confundirlo con un
 * secreto: los valores reales se inyectan por variables de entorno de Vite en
 * el momento de compilar (GitHub Actions), no se versionan.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app: FirebaseApp = initializeApp(config);

const enEmuladores = import.meta.env.VITE_USAR_EMULADORES === 'true';

// App Check acredita que la petición viene de ESTA aplicación web y no de un
// script. No es autenticación de usuario: es lo que encarece el abuso masivo de
// los endpoints públicos de Firestore y de las Cloud Functions.
const claveAppCheck = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (!enEmuladores && claveAppCheck) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(claveAppCheck),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

/**
 * REGIÓN DE LAS FUNCIONES, EN UN SOLO LUGAR.
 *
 * Tiene que ser la misma que `functions/src/region.ts`. Estaba escrita a mano
 * en la pantalla de usuarios y decía `southamerica-east1`, donde no hay ninguna
 * función desplegada: invitar a alguien fallaba SIEMPRE, y el mensaje genérico
 * de la pantalla —«No se pudo enviar la invitación»— lo hacía parecer un
 * problema pasajero. Nadie lo detectó porque el error no distingue entre «la
 * función rechazó» y «la función no existe».
 */
export const REGION_FUNCIONES = 'us-east1';
export const funciones: Functions = getFunctions(app, REGION_FUNCIONES);

if (enEmuladores) {
  // Puertos configurables para que el entorno de trabajo a mano y el de las
  // pruebas puedan convivir sin pisarse. Los valores por defecto son los que
  // levanta `scripts/emuladores.sh`.
  const puertoAuth = Number(import.meta.env.VITE_AUTH_EMULATOR_PORT ?? 9299);
  const puertoFirestore = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? 8232);
  connectAuthEmulator(auth, `http://127.0.0.1:${puertoAuth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', puertoFirestore);
  connectFunctionsEmulator(funciones, '127.0.0.1',
    Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT ?? 5231));
}
