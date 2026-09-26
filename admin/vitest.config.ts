import { configDefaults, defineConfig } from 'vitest/config';

/**
 * DOS PROYECTOS: `puras` Y `emulador`.
 *
 * Hasta el 26/09/2026 había una sola lista y TODO corría detrás de
 * `firebase emulators:exec` / `pruebas/correr.sh`, aunque más de la mitad de
 * las suites no tocan Firestore (las de los flujos de n8n, planes, prepago
 * puro, campañas, atención, el ensamblador, las pantallas…). Levantar el
 * emulador para correr `planes.test.ts` cuesta un minuto y un puerto que se
 * comparte entre worktrees (ver `pruebas/correr.sh`).
 *
 * `puras` es una LISTA EXPLÍCITA: cada archivo de abajo se verificó en verde
 * sin emulador (42 suites, 2.275 pruebas, ~5 s, el 26/09/2026). `emulador` es
 * TODO LO DEMÁS: una suite nueva cae ahí por defecto, donde siempre funciona;
 * si no toca Firestore, se agrega a la lista y gana el ciclo corto. Una suite
 * de la lista que empiece a necesitar el emulador falla en `pnpm
 * pruebas:puras`, que es exactamente lo que se quiere: se la saca de la lista.
 *
 * HERMÉTICA POR CONSTRUCCIÓN: `pnpm pruebas:puras` fija
 * FIRESTORE_EMULATOR_HOST=127.0.0.1:1, un puerto donde nadie escucha. Si una
 * suite de la lista abre Firebase, falla al instante en vez de colgarse en un
 * entorno sin red o, peor, de mandar tráfico real con las credenciales por
 * defecto (ADC). Por eso `asignar-rol.test.ts` NO está en la lista aunque
 * pasaba sin emulador: `asignar-rol.mjs` inicializa Firebase y lee Firestore
 * ANTES de decidir el modo seco (líneas 82-98), y con ADC en la máquina eso es
 * una lectura real. Va en `emulador` (revisión de seguridad del PR #206).
 *
 *   pnpm pruebas:puras      -> vitest run --project puras      (sin emulador, hermética)
 *   pnpm pruebas:emulador   -> correr.sh --project emulador    (con emulador)
 *   pnpm pruebas:reglas     -> correr.sh                       (todo, como siempre)
 *
 * El CI sigue corriendo `pruebas:reglas`: los dos proyectos, con emulador.
 */
export const SUITES_PURAS = [
  'pruebas/agendamiento-seguimientos.test.ts',
  'pruebas/alta-plan-inicial.test.ts',
  // 'pruebas/asignar-rol.test.ts' NO: abre Firebase antes del modo seco (ver arriba).
  'pruebas/bellido-flujo.test.ts',
  'pruebas/bitacora-tipos.test.ts',
  'pruebas/campanas-consola.test.ts',
  'pruebas/candado-agenda.test.ts',
  'pruebas/captacion.test.ts',
  'pruebas/carrito-podado.test.ts',
  'pruebas/citas-a-calendario.test.ts',
  'pruebas/cobrador-doble.test.ts',
  'pruebas/comportamiento-pantalla.test.ts',
  'pruebas/consola-pagar.test.ts',
  'pruebas/conteo-bloques.test.ts',
  'pruebas/contrasena-minimo.test.ts',
  'pruebas/demo-b-catalogo.test.ts',
  'pruebas/demo-b-cobro.test.ts',
  'pruebas/direccion-maps.test.ts',
  'pruebas/encabezado-comercio.test.ts',
  'pruebas/ensamblador.test.ts',
  'pruebas/estado-comercio.test.ts',
  'pruebas/estado-de-versiones.test.ts',
  'pruebas/flujos-origen.test.ts',
  'pruebas/flujos-umbrales.test.ts',
  'pruebas/imagen-catalogo.test.ts',
  'pruebas/indices.test.ts',
  'pruebas/instancias-minimas.test.ts',
  'pruebas/inventario.test.ts',
  'pruebas/nombre-asistente.test.ts',
  'pruebas/onboarding-flujo.test.ts',
  'pruebas/planes.test.ts',
  'pruebas/plataforma.test.ts',
  'pruebas/platinum-flujo.test.ts',
  'pruebas/prefijo-cacheable.test.ts',
  'pruebas/prepago-separacion.test.ts',
  'pruebas/prepago.test.ts',
  'pruebas/qr.test.ts',
  'pruebas/region-y-cuenta.test.ts',
  'pruebas/saneo.test.ts',
  'pruebas/sena-cotejo.test.ts',
  'pruebas/senas-vencidas.test.ts',
  'pruebas/umbrales-atencion.test.ts',
  'pruebas/xlsx.test.ts',
];

export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 30000,
    // El emulador es un recurso compartido: las suites no corren en paralelo
    // porque cada una limpia Firestore entre pruebas. Se hereda en los dos
    // proyectos con `extends: true`.
    fileParallelism: false,
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: {
          name: 'puras',
          include: SUITES_PURAS,
        },
      },
      {
        extends: true,
        test: {
          name: 'emulador',
          include: ['pruebas/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...SUITES_PURAS],
        },
      },
    ],
  },
});
