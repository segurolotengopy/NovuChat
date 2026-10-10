# Pruebas de navegador de la consola

Lo que ve y toca una persona: entra, abre una pantalla, guarda, mira el resultado. Es lo que `pruebas/` (reglas y lógica, con vitest) no cubre
y donde aparecieron los defectos de la semana del 05/10/2026: un guardado que el servidor rechaza, el logo que la política de seguridad bloquea.
Nacieron de la regla de Andres del 05/10 («ninguna función de la consola se entrega sin probarse completa»); la matriz de funciones es de la Cartera
(`QTACO_matriz-pruebas-de-consola`) y esta carpeta es la parte automática.

## Carriles: varias corridas a la vez

`E2E_CARRIL=1..4` (0 por omisión) suma `carril × 10` a todos los puertos (Firestore 8332, Auth 9399, Functions 5231, `vite` 5373, cabeceras 5340 y catálogo 5341). Cada carril levanta SUS emuladores
(`E2E_CARRIL=2 bash pruebas-navegador/emuladores.sh`) y corre con la misma variable (`E2E_CARRIL=2 pnpm pruebas:navegador`). Sin esto, la siembra de uno borraría los datos del otro. Cada carril escribe solo
sus propios `*.spec.ts`; los helpers de `ayudas/`, `entorno.ts` y `preparar-datos.ts` tienen un solo dueño (la Operadora).

## Cómo se corre

1. Emuladores (una terminal, quedan abiertos): `bash pruebas-navegador/emuladores.sh`. Puertos propios (Firestore 8332, Auth 9399), con las
   **reglas reales** de `firestore.rules`.
2. `pnpm pruebas:navegador` — la consola corre con `vite` y cada prueba parte de un estado conocido (`preparar-datos.ts` vuelve a sembrar con
   `scripts/sembrar.mjs --limpiar`, con el comercio de ventas «Parrilla El Fogon» activo, que tiene la forma de Q'Taco).
3. `pnpm pruebas:navegador:cabeceras` — construye la consola y la sirve con las **cabeceras reales** de `firebase.json` (`scripts/probar-csp.mjs`,
   al que solo se le suman los emuladores a `connect-src`). Lo que depende de la política (el logo, las imágenes) solo se prueba acá.

Usan el Chromium que Playwright ya tiene descargado; no bajan nada. Todo es local y ficticio (proyecto `demo-*`); las pruebas **nunca** escriben en la nube.
La siembra y los datos de prueba se niegan a correr contra un proyecto que no empiece con `demo-`.

## Qué cubre hoy

| Pantalla | Casos |
|---|---|
| Configuración: horarios | guardar los 7 días y verlos al volver; **negativas**: día incompleto, cierre antes de la apertura |
| Configuración: Maps | **negativas**: enlace de otro sitio, dominio parecido; guardar uno válido |
| Configuración: logo (cabeceras reales) | subir, ver, quitar; sin violaciones de la política; control de que el detector sí ve un `blob:`; archivo que no es imagen |
| Configuración de QR (`/cobro`, `vite` y cabeceras reales) | vacío, registrado sin cobrar, «Cobrando», nombre con HTML; el QR se lee de la imagen en el navegador y se manda al servidor con lo escrito; **negativas**: sin imagen, imagen sin código, archivo que no es imagen, más de 12 MB, dato rechazado por el servidor (se marca en su campo), sin permiso, el QR de otro comercio no se ve. La Function `registrarQrDeCobro` se **simula** (no hay emulador de Functions): se prueba la pantalla, no la Function |
| Cobros (`/cobros`) | lista con monto, cotejo y «comprobado»; la pantalla nunca dice «acreditado»; Comprobar; detalle; períodos; CSV; contadores por mes; cobro simulado; aislamiento |
| Pedidos | vacío y aparición en vivo, delivery con detalle y nota, HTML como texto, aislamiento entre comercios, exportar CSV. **Sin función hoy** (PR-C de Cartera): filtros, cambio de estado, ubicación compartida |
| Productos | alta, edición, baja, volver a ofrecer y eliminar con el contador del plan; negativas (eliminar solo lo dado de baja, «No», foto no https, sin nombre); búsqueda; aislamiento |
| Conversaciones | lista y hilo, adjuntos marcados, HTML como texto, «No contactar», hilo vacío, aislamiento. **Sin función hoy**: la consola NO reproduce audio ni video ni muestra la imagen del comprobante (solo los marca); la prueba lo fija |
| Campañas | plan Impulso (0, no ofrece el formulario) y plan Crecimiento (3): crear, editar, eliminar, tope del plan; negativas (sin texto, fin antes del inicio, empieza en el pasado, texto repetido, cancelar), aislamiento |
| Tablero | cifras, horario de hoy, períodos, enlace a Productos |
| Usuarios | lista con rol y estado, aislamiento. **Invitar** necesita el emulador de Functions: se prueba a mano en staging |
| Catálogo web público (cabeceras reales de su sitio) | política y `Permissions-Policy` puestas (hoy `geolocation=()`: el PR-B de ubicación la abre y esa línea se actualiza); carga, foto https, buscar, carrito, retiro y envío (la dirección es obligatoria), «Volver al chat», qué manda el navegador (solo identificadores y cantidades), errores 429 / 404 / 409 |

## Defectos conocidos que las pruebas ya reproducen (`test.fail`)

- **ALT-C**: `firestore.rules` supera el tope de 1000 expresiones de las reglas de Firestore y rechaza **todo** guardado de Configuración
  («El servidor rechazó el cambio»), incluso sin cambiar nada. Existe también en producción (v0.13.2). Las dos pruebas marcadas con `test.fail`
  (guardar los 7 días, guardar un enlace de Maps válido) pasan hoy *por fallar*; cuando las reglas nuevas lleguen a `main` se ponen en rojo y se quita la marca.

## Lo que falta

Inventario (Q'Taco no lo usa: se oculta), Usuarios: invitar y los claims tras cambiar un rol (Functions), y todo lo que exige una persona: el QR real, el banco, WhatsApp,
las notificaciones, el login con Google y la prueba en teléfono. Lo prueban Andres y Silvana, con evidencia.
