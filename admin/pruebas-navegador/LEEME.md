# Pruebas de navegador de la consola

Lo que ve y toca una persona: entra, abre una pantalla, guarda, mira el resultado. Es lo que `pruebas/` (reglas y lógica, con vitest) no cubre
y donde aparecieron los defectos de la semana del 05/10/2026: un guardado que el servidor rechaza, el logo que la política de seguridad bloquea.
Nacieron de la regla de Andres del 05/10 («ninguna función de la consola se entrega sin probarse completa»); la matriz de funciones es de la Cartera
(`QTACO_matriz-pruebas-de-consola`) y esta carpeta es la parte automática.

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
| Pedidos | vacío y aparición en vivo, delivery con detalle y nota, HTML como texto, aislamiento entre comercios, exportar CSV |
| Productos | alta, edición, baja, volver a ofrecer y eliminar con el contador del plan; negativas (eliminar solo lo dado de baja, «No», foto no https, sin nombre); búsqueda; aislamiento |
| Tablero | cifras, horario de hoy, períodos, enlace a Productos |
| Usuarios | lista con rol y estado, aislamiento |

## Defectos conocidos que las pruebas ya reproducen (`test.fail`)

- **ALT-C**: `firestore.rules` supera el tope de 1000 expresiones de las reglas de Firestore y rechaza **todo** guardado de Configuración
  («El servidor rechazó el cambio»), incluso sin cambiar nada. Existe también en producción (v0.13.2). Las dos pruebas marcadas con `test.fail`
  (guardar los 7 días, guardar un enlace de Maps válido) pasan hoy *por fallar*; cuando las reglas nuevas lleguen a `main` se ponen en rojo y se quita la marca.

## Lo que falta

Cobros y Configuración de QR, Inventario, Conversaciones (audio y video), Campañas, Catálogo web público, y **Usuarios: invitar** (llama a la Function
`invitarUsuario`; hace falta el emulador de Functions). El QR real, el banco, WhatsApp y el login con Google no se automatizan: los prueban Andres y Silvana con evidencia.
