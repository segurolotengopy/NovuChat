/**
 * EL ENTORNO DEL PROCESO HIJO de una suite que lanza un script con el SDK
 * Admin: el emulador, nunca las credenciales del desarrollador.
 *
 * Por qué (#245, 27/09/2026): `asignar-rol.test.ts` lanzaba el script con el
 * entorno heredado más el PUERTO del emulador, sin `FIRESTORE_EMULATOR_HOST`,
 * y firebase-admin iba al Firestore real con las ADC de quien corría la
 * prueba. Pasar el host no alcanza para Auth ni para el servidor de
 * metadatos: por eso Auth va a un puerto muerto, las credenciales a una ruta
 * que no existe y la detección de metadatos se apaga. Si el script intentara
 * salir del emulador, falla en el acto en vez de leer producción.
 *
 * Se usa aunque `pruebas/correr.sh` ya exporte el emulador: la suite también
 * se corre sin él. `pruebas/core/hijos-hermeticos.test.ts` exige que toda suite que
 * lanza un script de `admin/scripts/` con Node pase este entorno.
 */
export function entornoDelEmulador(host: string | undefined, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // `extra` va ANTES de los valores fijos: una suite puede agregar variables
  // propias (`CONFIG_LOCAL_MD`), nunca pisar las que cierran la salida a la
  // nube (revisión de seguridad del #259).
  return {
    ...process.env,
    ...extra,
    ...(host ? { FIRESTORE_EMULATOR_HOST: host } : {}),
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1',
    GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/adc.json',
    CLOUDSDK_CONFIG: '/nonexistent/gcloud',
    METADATA_SERVER_DETECTION: 'none',
  };
}
