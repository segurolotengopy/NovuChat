import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  'pruebas/agenda-minima-flujo.test.ts',
  'pruebas/agenda-minima-lib.test.ts',
  'pruebas/agenda-minima-herramienta-actualizar.test.ts',
  'pruebas/venta-minima-comun.test.ts',
  'pruebas/venta-minima-pedido.test.ts',
  'pruebas/venta-minima-reserva.test.ts',
  'pruebas/venta-minima-avisos.test.ts',
  'pruebas/venta-minima-promos.test.ts',
  'pruebas/venta-minima-cobro.test.ts',
  'pruebas/venta-minima-salida.test.ts',
  'pruebas/venta-minima-decision.test.ts',
  'pruebas/venta-minima-integracion.test.ts',
  'pruebas/venta-minima-flujo.test.ts',
  'pruebas/n8n-de-mentira.test.ts',
  'pruebas/comun-sin-agente-construir.test.ts',
  'pruebas/comun-sin-agente-envio.test.ts',
  'pruebas/comun-sin-agente-filtro.test.ts',
  'pruebas/comun-sin-agente-mensajes.test.ts',
  'pruebas/agendamiento-seguimientos.test.ts',
  'pruebas/alta-plan-inicial.test.ts',
  // 'pruebas/asignar-rol.test.ts' NO: abre Firebase antes del modo seco (ver arriba).
  'pruebas/bellido-flujo.test.ts',
  'pruebas/bitacora-tipos.test.ts',
  'pruebas/core/bitacora.test.ts',
  'pruebas/core/clave-n8n-fuera-de-argumentos.test.ts',
  'pruebas/core/env-nace-cerrado.test.ts',
  'pruebas/core/gancho-sistemas-ajenos.test.ts',
  'pruebas/core/hijos-hermeticos.test.ts',
  'pruebas/core/apps-ajenas-escrituras.test.ts',
  'pruebas/campanas-consola.test.ts',
  'pruebas/central/contrato-f1b-puras.test.ts',
  'pruebas/candado-agenda.test.ts',
  'pruebas/calendario-fechas-en-el-nodo.test.ts',
  'pruebas/capacidades-comunes.test.ts',
  'pruebas/modulos/captacion/captacion.test.ts',
  'pruebas/modulos/catalogo-web/carrito-podado.test.ts',
  'pruebas/ci-calidad-filtro.test.ts',
  'pruebas/citas-a-calendario.test.ts',
  'pruebas/central/cobrador-doble.test.ts',
  'pruebas/central/comportamiento-pantalla.test.ts',
  'pruebas/central/consola-pagar.test.ts',
  'pruebas/conteo-bloques.test.ts',
  'pruebas/central/contrasena-minimo.test.ts',
  'pruebas/frontera/despliegue.test.ts',
  'pruebas/frontera/fronteras.test.ts',
  'pruebas/frontera/mudanza.test.ts',
  'pruebas/frontera/referencias-a-scripts.test.ts',
  'pruebas/frontera/rutas-escritas.test.ts',
  'pruebas/demo-b-catalogo.test.ts',
  'pruebas/demo-b-cobro.test.ts',
  'pruebas/demo-b-medios.test.ts',
  'pruebas/core/direccion-maps.test.ts',
  'pruebas/encabezado-comercio.test.ts',
  'pruebas/core/ensamblador.test.ts',
  'pruebas/core/niega-ia.test.ts',
  'pruebas/core/venta-salida.test.ts',
  'pruebas/estado-comercio.test.ts',
  'pruebas/estado-de-versiones.test.ts',
  'pruebas/flujos-origen.test.ts',
  'pruebas/flujos-umbrales.test.ts',
  'pruebas/modulos/productos/imagen-catalogo.test.ts',
  'pruebas/central/indices.test.ts',
  'pruebas/instancias-minimas.test.ts',
  'pruebas/modulos/inventario/inventario.test.ts',
  'pruebas/nombre-asistente.test.ts',
  'pruebas/onboarding-flujo.test.ts',
  'pruebas/central/planes.test.ts',
  'pruebas/plataforma/contrato-f1b-consola.test.ts',
  'pruebas/plataforma/copia-por-contrato-consola.test.ts',
  'pruebas/plataforma/enlace-privado.test.ts',
  'pruebas/plataforma/plataforma.test.ts',
  'pruebas/platinum-flujo.test.ts',
  'pruebas/prefijo-cacheable.test.ts',
  'pruebas/prepago-separacion.test.ts',
  'pruebas/central/prepago.test.ts',
  'pruebas/modulos/cobros/qr.test.ts',
  'pruebas/plataforma/region-y-cuenta.test.ts',
  'pruebas/central/saneo.test.ts',
  'pruebas/sena-cotejo.test.ts',
  'pruebas/senas-vencidas.test.ts',
  'pruebas/umbrales-atencion.test.ts',
  'pruebas/modulos/productos/xlsx.test.ts',
];

// Una entrada de SUITES_PURAS que no existe no falla sola: la suite movida sale
// de «puras» y sigue corriendo en «emulador» sin que nadie lo note (F2 mueve
// suites de carpeta). Se corta acá, al cargar la configuración.
const aqui = dirname(fileURLToPath(import.meta.url));
const perdidas = SUITES_PURAS.filter((s) => !existsSync(join(aqui, s)));
if (perdidas.length) {
  throw new Error(`SUITES_PURAS nombra suites que no existen (¿se movieron?): ${perdidas.join(', ')}`);
}

export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 30000,
    // El emulador es un recurso compartido: las suites no corren en paralelo
    // porque cada una limpia Firestore entre pruebas. Se hereda en los dos
    // proyectos con `extends: true`.
    fileParallelism: false,
    pool: 'threads',
    // functions/src/core/opcionesGlobales.ts arma el correo de sa-functions con
    // GCLOUD_PROJECT y falla si no está (firebase-tools la fija al descubrir
    // las Functions; Cloud Run, en ejecución). Las suites que importan
    // index.ts la necesitan; `demo-` marca que no es un proyecto real.
    // CPU_FRACCIONARIA vacía: la forma de staging (`cpu`) no entra a la
    // instantánea de despliegue aunque el shell la tenga (pruebas/frontera/despliegue.test.ts).
    env: { GCLOUD_PROJECT: 'demo-test', CPU_FRACCIONARIA: '' },
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
