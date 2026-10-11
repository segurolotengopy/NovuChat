# Consola oculta: lo que la consola de UN comercio no pinta

Zona Central. Primer caso: Q'Taco (primer cliente real, abre el 08/10/2026).
Decidido por Andres el 06/10/2026 (D1, D2, D3, D5).

## Diseño

1. **Una sola lista por comercio**, `tenants/{id}.consolaOculta`: lista cerrada de
   ids `horario`, `hoy`, `invitar`, `pagar`, `reemplazoQr`. Sin la clave, un id
   desconocido o un valor que no es lista: la consola es la de siempre.
2. **Por qué no sale del registro de módulos.** `modulos` decide pestañas por módulo
   encendido. Estas cinco cosas no son pestañas de módulo: «Horario» y «Hoy» son
   de Configuración y del Tablero, «Invitar» es un formulario de Usuarios, «Pagar»
   es una pestaña central que ningún módulo declara, y el reemplazo del QR es un
   bloque de la pestaña Cobros que solo se esconde con el cobro real activo. Apagar
   Cobros esconde de más: Q'Taco necesita registrar su primer QR.
3. **Un solo lugar para la lógica**: `admin/functions/src/central/consola-oculta.ts`
   (puro, sin `import`): la lista cerrada, la lectura (`consolaOcultaDeFicha`),
   `esVisible` y `reemplazoQrOculto`. La consola y el script importan el mismo archivo.
4. **Ocultar es no pintar el control Y cerrar la ruta**: `useConsolaOculta` lee la
   ficha en vivo; mientras carga (`null`) no se pinta nada ocultable; `SiNoOculta`
   envuelve la ruta de Pagar y, si está oculta, redirige a `/` (el tablero).
5. **Qué oculta cada id**: `horario` la sección de Configuración (y con ella oculta,
   guardar no valida ni escribe `horarios`); `hoy` la tarjeta del Tablero; `invitar`
   el formulario de Usuarios (la tabla queda); `pagar` la pestaña, la ruta y el botón
   de «Estado de cuenta»; `reemplazoQr` el formulario «Cambiar el QR» solo si
   `activo` es `true` (el registro del PRIMER QR sigue disponible).
6. **La escribe NovuChat, nunca el comercio**: `firestore.rules` cierra
   `create, update, delete` de `tenants/{id}` a todo navegador (probado por guarda de
   fuente en `consola-oculta.test.ts`; sin cambio de reglas). El único camino es
   `admin/scripts/plataforma/aplicar-consola-oculta.mjs`: seco por omisión; con
   `--aplicar` exige `--respaldo` (0600, fuera del repositorio, nunca se pisa), escribe
   UN campo con precondición de hora, relee y compara; `--revertir` restaura (o elimina
   el campo si no existía); contra producción exige `--confirmo-produccion <tenant>`;
   rechaza ids fuera de la lista cerrada. Modelado sobre `aplicar-modulos-tenant.mjs` (#444).

## Lo que NO es

- **No es un límite.** Es solo presentación: nada de esto sustituye una regla del
  servidor. `invitarUsuario`, la emisión de pagos y `registrarQrDeCobro` siguen
  validando en el servidor con o sin la lista. Quien necesite que algo NO se pueda
  hacer lo prohíbe en `firestore.rules` o en la Function.
- No oculta nada que el comercio use sin la lista: sin lista, cero cambios.
- **El propietario de NovuChat ignora la lista**, para todos los ids: NovuChat ve y
  opera todo en cualquier comercio (Pagar incluido; el enlace de Plataforma a
  `/negocio/{id}/pagar` sigue abriendo). Lo hace `useConsolaOculta` con la sesión
  (`ocultosParaVisitante`), así que menú, páginas y rutas lo heredan.
- **Si falla la lectura de la lista, la consola muestra todo** (la lista queda vacía).
  Decisión aceptada: ningún límite del servidor depende de la lista.

## Costo

0 mensajes por conversación. Nube: el script escribe 1 documento (con respaldo local);
el despliegue de la consola va con la etiqueta que corresponda.
