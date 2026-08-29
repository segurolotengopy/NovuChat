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

if (enEmuladores) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9299', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8231);
}
