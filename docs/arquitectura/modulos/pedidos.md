# Módulo Pedidos

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `pedidos`, checkout del carrito (dentro de `catalogoWeb.ts`), `Pedidos.tsx`, `Memoria del carrito` |
| **Depende de** | Productos |
| **Límite por plan** | — |
| **Configuración** | `config/pedidos` (hoy dentro de `config/venta`), con lista blanca por manifiesto |
| **Colecciones** | `pedidos` |
| **Pestañas** | Pedidos (`admin` y `oper`) |
| **Prompt** | fragmento de venta del prompt (`Flujos/prompts/modulos/pedidos.md`, hoy dentro del prompt del Demo B) |
| **Herramientas** | las del carrito del esqueleto de venta |
| **Nodos (lo que queda en n8n)** | nodos Code del Demo B sin extraer (15, con Core, Cobros y Catálogo web); F2 los extrae con `ensamblar-flujo.mjs extraer` |
| **Ganchos** | `alCierre` (venta) |
| **Mensajes por conversación** | 0 (la Function; el rescate de 22 h lo envía el flujo n8n consumidor, +1 por conversación rescatada) |
| **Pruebas** | `carrito-podado.test.ts`, `demo-b-catalogo.test.ts`, `entrantes-por-tipo.test.ts`; la suite del Demo B |

**Ubicación compartida (05/10/2026):** si un pedido de delivery trae `ubicacion { lat, lng }` (opcional; la escribe el servidor desde el catálogo web), `Pedidos.tsx` muestra «Ubicación compartida · Abrir en Maps». El enlace se arma solo con `ubicacion.ts` (`ubicacionValida` / `enlaceAMaps`: números finitos, rango, no (0,0), 5 decimales) y se abre con `target="_blank" rel="noopener noreferrer"`; nunca se usa texto ni URL del pedido. Las reglas de `pedidos` ya permiten leer el documento entero a quien lee conversaciones, sin lista de campos: no cambian. Prueba: `admin/pruebas/modulos/pedidos/ubicacion.test.ts`. Mensajes: 0.

**Pedido de catálogo externo (B5a, 09/11/2026; Casa Bermejo / NovuTienda).** `armarPedidoWa` acepta, además de las líneas del catálogo propio, líneas con la forma cerrada `{externa: true, id, nombre, cantidad, precioCentavos, moneda, detalle?, subtotalCentavos?}` (cualquier otra clave descarta la línea). Solo entran si el tenant tiene el DATO `tenants/{t}/config/pedidos.catalogoExterno = {activo: true, monedas: ['BOB'|'ARS']}` (lo escribe el servidor; las reglas no abren `config/pedidos` al cliente; sin el dato el comportamiento es el de siempre, probado). Congela id (`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, sin `__`; es el `productoId` que se enviará a NovuTienda), nombre, precio y moneda declarados por el flujo, porque ese catálogo no está en Firestore y el servidor no puede recalcularlos; sí los acota (precio entero 1..100.000.000 centavos, ARS en múltiplos de 100, moneda dentro de las habilitadas, una sola moneda por pedido, cantidad entera 1..`MAX_UNIDADES_WA`, hasta `MAX_LINEAS_WA`, ids repetidos descartados) y recalcula subtotales y total; un `subtotalCentavos` que no coincide descarta la línea. El pedido lleva `catalogo: 'externo'` e ítems con `precioCentavos`; sin monto de QR `totalDistinto` es `true`, salvo en `pedido_sin_cobro` (Argentina), donde es `false`. `PedidoWa.moneda` admite `ARS`. Estado `recibido`; el Confirmar es B5b (abajo). `facturacion` solo la limpia de siempre; el teléfono, enmascarado. Disparo: `qr_enviado` (Bolivia, QR abierto) o `pedido_sin_cobro` (Argentina; la ingesta lo reenvía al gancho igual que `qr_enviado`, sin tocar solicitud ni conteo). Pruebas: `admin/pruebas/modulos/pedidos/pedido-externo.test.ts`. Mensajes: 0.

**Confirmar un pedido externo (B5b, 09/11/2026; Casa Bermejo / NovuTienda).** Callable `confirmarPedidoExterno` (`admin/functions/src/modulos/pedidos/confirmarExterno.ts`, declarada en el manifiesto). Entrada: SOLO `{tenantId, pedidoId}` (cualquier otra clave se rechaza). Se exige `esAdminDe` / `esOperDe` de ESE `tenantId` (contraseña y correo verificado; el soporte de NovuChat no): un comercio ajeno es `permission-denied` (mismo patrón que `verComprobante`). Además `cuentaVigenteDe`, comercio `activo`, módulo `pedidos` y `config/pedidos.catalogoExterno.activo`. **Sesión reciente: no se exige** (`exigirSesionReciente` es para mover dinero a mano); acá el operador confirma un pedido de su propio comercio y NovuTienda es idempotente por `pedidoId`, así que repetir una confirmación no daña. App Check por ambiente (producción sí; staging y emulador no, como `verComprobante`) y `concurrency` 10 (no en staging).

Estados de un pedido: `recibido`, `confirmando` (nuevo), `confirmado` (nuevo), `reemplazado`, `cancelado`. Flujo: una transacción relee todo y pasa `recibido` a `confirmando` (`confirmandoEn`, `confirmandoPor`) ANTES de llamar; mientras tanto `cerrarPedidoWa` (solo actúa sobre `recibido`) no puede reemplazarlo ni cancelarlo, y una segunda confirmación simultánea no llama (una sola llamada). 200: `confirmado` con `confirmadoEn` = EXACTAMENTE el instante enviado (se parsea del cuerpo) y `confirmadoPor`. 409, 429/503 agotados, red, tiempo o error de contrato: vuelve a `recibido` en transacción (solo si el reclamo sigue siendo propio). Un `confirmando` de más de 2 min (la Function murió a medias, o la escritura final falló) se puede retomar; uno más reciente responde «ya se está confirmando». Si el pedido se borra durante la llamada, `not-found`. `confirmado` responde OK sin llamar de nuevo y sin necesitar el secreto.

Llamada: `POST {baseUrl}/api/novuchat/v1/pedidos/confirmar`, cuerpo exacto `{"pedidoId","items":[{"productoId","cantidad"}],"confirmadoEn"}` (se copia campo por campo: precio, nombre y teléfono nunca salen), `X-Marca-Tiempo` (ms, reloj del servidor, uno por intento) y `X-Firma` = HMAC-SHA256 hex de `"{marca}.{cuerpo exacto}"`, `Authorization: Bearer`. Sin seguir redirecciones; tope de 8 s por intento. 429/503: hasta 3 intentos (esperas de 0,5 y 1,5 s) y luego `unavailable`. 400, 401, 405 y cualquier otro código: `internal`, sin reintento. Red caída o tiempo agotado: `unavailable`, sin reintento.

**SUPUESTOS (el contrato v1 no los fija; confirmar con NovuTienda):** (1) `confirmadoEn` viaja como cadena ISO 8601 UTC (`armarCuerpo`); (2) el cuerpo del 409 es `{"faltantes":[{"productoId","solicitado","disponible"}]}` (`faltantesLegibles`; sin alias; otra forma da lista vacía y el mensaje general igual sale; el nombre legible sale del pedido y no de la respuesta).

Secreto: UNO solo en Secret Manager, `NOVUTIENDA_CONFIRMAR`, con el mapa `{ "<tenantId>": { "baseUrl": "https://…", "bearer": "…", "firmaSecreto": "…" } }` (decisión de Andres). Nunca en el repositorio, en Firestore ni en un log (los logs llevan solo un código y el estado HTTP). Ausente, ilegible, sin la entrada del comercio, URL no https o claves cortas: falla cerrado, no sale nada y el pedido no cambia. **IAM:** el nombre cae en el prefijo `NOVUTIENDA_` de la condición de `desplegadorSecretos` (`secretos-iam-prefijos.test.ts`). Staging: `./scripts/preparar-staging.sh novutienda` (amplía la condición y crea el secreto con un valor aleatorio, que la Function rechaza hasta cargar el mapa; la fase `cuentas` ya arma la condición con el prefijo). Producción: `./scripts/nube-novutienda.sh` (seco por omisión; `--aplicar --confirmo produccion` amplía la condición, crea el secreto con `{}` y da `secretAccessor` a `sa-functions`; `--cargar <archivo>` agrega el mapa real sin mostrarlo; `--revertir-iam`). Pendiente de ese paso: una callable nueva no nace invocable; falta `confirmarpedidoexterno` en la lista cerrada de `nube-visor.sh`. Todo lo hace Claude con el «sí» de Andres, antes de desplegar.

Consola: botón «Confirmar» en `Pedidos.tsx` solo para pedidos externos `recibido` Y cuando la sesión es admin u oper de ese comercio (`rolEn`); envía `{tenantId, pedidoId}`. Un pedido `confirmando` se rotula «Confirmando…» sin botón; el 409 muestra los faltantes. Pruebas: `admin/pruebas/modulos/pedidos/confirmar-externo.test.ts` (emulador), `confirmar-pantalla.test.ts`, `admin/pruebas/plataforma/preparar-staging-novutienda.test.ts` y `nube-novutienda.test.ts`. Mensajes por conversación: 0.

**Observación:** hoy es parte del vertical `venta`; el checkout escribe pedidos y descuenta stock. El checkout que escribe `pedidos` sale de `catalogoWeb.ts` (que se parte) y viene acá. La pantalla Pedidos es la única de la consola que se mira con las manos ocupadas (§4nonies.1, abajo)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Rescate de 22 h (`reclamarRescates`)

**Qué es.** Una Function HTTP del módulo (`admin/functions/src/modulos/pedidos/rescates.ts`, declarada en el manifiesto) que **decide y marca** a quién se le escribe UN mensaje de texto libre cuando la conversación de venta lleva entre 22 h y 23 h 30 min sin un mensaje del cliente. **No envía**: el envío y la redacción son de un flujo de n8n por comercio (otro PR), que la llama con la credencial de ingesta de su número. Plan de diseño: `RUBENROCA_plan-rescate_2026-10-20`, paso 1.

**Contrato.** `POST` con `{ v: 1, soloTelefonos?, excluir?, tope? }` (`validarCuerpo`: clave extra, `v` distinto de 1, más de 20 teléfonos de prueba, más de 50 excluidos o un `tope` fuera de 1 a 20 son `400`). Responde `200 { phoneNumberId, rescates: [{ telefono, ultimoEntranteMs, textos }] }`, con `motivo` (`lista_vacia`, `servicio_no_operativo`, `sin_modulo`, `tope_diario`) cuando no hay nada que devolver. Errores: `405`, `401 'no autorizado'`, `409 { estado }` (ruta no activa) y `409 { estado: 'flujo_no_admitido' }` si la ruta no es de `venta`. La respuesta no lleva `nombreContacto` ni mensajes del asistente; solo hasta 6 textos entrantes de 300 caracteres.

**A quién nunca** (`motivoParaNoRescatar`, pura, en este orden): teléfono inválido, excluido (incluido el número de recepción), fuera de la lista de prueba, otra línea, ya rescatado (cualquier valor en `rescate`), `riesgoEn` (protección ante una crisis, ver abajo), `noContactar` (la enciende la ingesta con `evento: 'no_contactar'`; cualquier valor distinto de ausente o false, `null` incluido), contacto bloqueado por el comercio (`bloqueada` con cualquier valor distinto de ausente o false, `null` incluido), atención distinta de normal, sin ventana, turno de una persona (regla exacta: `tomadoEn >= último mensaje del cliente − 24 h`, borde inclusive, aunque ya se haya devuelto; o pausa vigente; o turno ilegible. Un turno tomado antes de esa ventana, p. ej. 30 h antes del último mensaje, y ya devuelto NO bloquea), compró (`agendada`, `en_revision`, `a_favor` o `cotejos` > 0), con un seguimiento de Agenda ya enviado (`solicitud.seguimientos` > 0 o `seguimientoEn`, para no duplicar con `seguimientosPendientes`), antes de 22 h, después de 23 h 30 min. Además, por los mensajes (`leerMensajesParaRescate`): de cada candidata se leen, con `ts >= último entrante − 24 h`, los **60 mensajes más nuevos** (`MENSAJES_A_LEER`; límite conocido: si la ventana tiene más de 60 mensajes, entrantes y salientes, los más antiguos no se leen y una imagen o un rechazo anterior a ellos no se vería). Entre ellos, cualquier imagen o documento entrante (posible comprobante) y cualquier `order` entrante (carrito web o carrito nativo de Meta: un pedido hecho es una compra aunque no haya `solicitud.etapa`; además, un documento de `pedidos` con ese `conversacionId` creado en las últimas 24 h, consulta de un solo campo con filtro de fecha en memoria; si se llena el tope de lectura de 30 pedidos, ante la duda no se rescata) y los rechazos explícitos en un texto o en la respuesta de un botón o lista (`interactive`): «no me interesa», «no, gracias», «stop»…; «lo voy a pensar» no cuenta. Las candidatas se leen por páginas de 100 (hasta 5 por corrida, `MAX_PAGINAS`), de la más antigua a la más nueva, para que las ya rescatadas o descartadas no dejen sin leer a las nuevas.

**Unicidad.** La marca `rescate { enviadoEn, phoneNumberId, anclaMs }` se escribe ANTES de enviar, con `merge`, dentro de una transacción que relee y vuelve a decidir; no se borra nunca: un rescate por contacto y por comercio, para siempre. Si el envío falla, ese rescate se pierde (mejor que dos). Toda escritura a `conversaciones` debe llevar `merge`: una sin él borraría la marca (verificado el 20/10/2026: no hay ninguna en `functions/src`).

**Módulo.** El comercio debe tener el módulo `pedidos` (`tieneModulo(ficha, 'pedidos')`, la ficha `tenants/{id}`, como `verComprobante.ts`); si no, responde `200` con `motivo: 'sin_modulo'` (misma forma que los otros motivos de esta función) y no lee conversaciones.

**Protección ante una crisis (`riesgoEn`, 05/11/2026).** `noContactar` no basta: una persona del negocio puede apagarlo desde la consola y el reporte del flujo puede fallar. Por eso la ingesta, cuando el reporte trae `evento: 'no_contactar'` **y** `riesgo: true` (campo nuevo, solo válido con ese evento), escribe además `riesgoEn` (marca de tiempo; cada señal la renueva) y `reclamarRescates` descarta toda conversación con cualquier valor en `riesgoEn` distinto de ausente, false o null. Las reglas de Firestore prohíben a la ingesta por SDK cliente y a la consola crearla, cambiarla o borrarla (prueba negativa en `reglas.test.ts`); solo la escribe el SDK Admin del servidor. **Pendiente fuera de esta Function:** el flujo de Rubén (y todo flujo con ruta de crisis) debe enviar `riesgo: true` junto a `no_contactar` en esa ruta; hasta entonces `riesgoEn` no se escribe y la única protección sigue siendo `noContactar`. Parte tocada en la ingesta (Core, otro dueño: `normalizar` y una línea del `set`): debe revisarla Rearquitectura.

**Topes de protección** (constantes del servidor, no comerciales): 20 por corrida y `TOPE_DIARIO_POR_COMERCIO = 150` marcas en 24 h (conteo `count()` sobre `rescate.enviadoEn`, índice de campo simple; **el tope es aproximado**: el conteo se lee antes de marcar, así que llamadas concurrentes pueden excederlo en hasta 20 por cada una; gasto máximo ~1,70 USD por día y comercio a 0,0113 USD). **Decisión aceptada explícitamente (05/11/2026):** el exceso por concurrencia (hasta 20 por llamada simultánea, acotado a ~200 por día y comercio) se acepta: no hay un contador transaccional y el costo del exceso es de centavos; el límite sigue siendo del servidor.

**Multi-tenant y privacidad.** El comercio y la línea salen de la credencial, nunca del cuerpo; solo se lee y marca `tenants/{ruta.tenantId}/conversaciones` con `phoneNumberId` igual al de la ruta. Se respeta el corte del prepago (`corteAplicable` y `estadoDeServicio`). Nunca se registra en el log un teléfono ni un texto; la bitácora recibe `seguimiento_enviado` con `codigo: 'rescate_reclamado'` (reclamado, no «enviado»: la marca va antes del envío y no hay camino de confirmación de n8n de vuelta) y el teléfono enmascarado también en `conversacionId`.

**Costo.** La Function agrega 0 mensajes; el flujo que la consume agrega +1 por conversación rescatada (`docs/base-comercial.md` §1). Pruebas: `admin/pruebas/modulos/pedidos/rescates-decision.test.ts` (pura) y `rescates.test.ts` (emulador). Pedidos no importa de `modulos/cobros`.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene. La
subsección §4nonies.2 (Cobros, la pantalla de la plata) está en `cobros.md`.


<!-- movido de admin/DISENO.md §4sexies.3bis (25/09/2026, líneas 1413-1431) -->

### 4sexies.3bis El catálogo nativo de WhatsApp es una capacidad de VENTA

**Decidido el 2026-09-07.** El catálogo de productos de Meta —con carrito nativo—
se publica **solo para el flujo de venta**. Para agendamiento no se hace, y no es
una deuda: es una decisión.

**Por qué.** En agendamiento el catálogo es **referencial**: la lista que el
asistente usa para saber de qué hablar y cuánto cuesta, no una tienda. Nadie pone
un corte de pelo en un carrito de compras. Y aunque se quisiera, **Meta exige
precio en cada producto**, así que los servicios que se cotizan después de
evaluar —los que la consola modela con el precio opcional, §catálogo— no se
pueden listar: la mitad del catálogo de una clínica quedaría afuera.

**Cómo encaja.** Es una capacidad por flujo, como la agenda o el cobro. Cuando se
implemente, va con su línea en la tabla de capacidades y su publicación desde la
consola —una sola fuente de verdad—, con el SKU de Meta igual al identificador
del ítem para que un carrito llegue al asistente con productos que sabe nombrar.
Análisis completo en `Analisis/09-catalogo-nativo-de-whatsapp.md`.


<!-- movido de admin/DISENO.md §4nonies (25/09/2026, líneas 1810-1830) -->

## 4nonies. Pedidos y cobros: tres pantallas, no una

> **Estado (2026-09-12): las tres pantallas están construidas y en producción**
> (commit `45d130d`, PR #51). Se hicieron **antes** que los dos datos de
> §4nonies.3, por decisión de Andres del 09/09. Por eso cada una dice en
> pantalla lo que todavía no puede mostrar, en vez de aparecer vacía. **Los dos
> datos siguen pendientes**, y son lo próximo de esta sección.

**Pedido de Andres, 2026-09-09.** Hoy «Pedidos y cobro» es UNA pantalla que en
realidad configura el QR: no lista un solo pedido ni un solo cobro. El nombre
promete dos cosas que no están.

Se parte en tres, y la división no es de menú: **cada una la mira una persona
distinta, en un momento distinto, para decidir algo distinto.**

| Pantalla | Quién | Para qué |
|---|---|---|
| **Pedidos** | admin y **operador** | Preparar y entregar lo que se pidió |
| **Cobros** | admin | Ver la plata y confirmar contra el banco |
| **Configuración de QR** | admin | Lo que hoy existe, con su nombre real |


<!-- movido de admin/DISENO.md §4nonies.1 (25/09/2026, líneas 1831-1851) -->

### 4nonies.1 Pedidos — la pantalla del cocinero y del repartidor

**Es la única pantalla de la consola que se mira con las manos ocupadas.** Quien
la abre no está analizando el negocio: está por cocinar o por salir a repartir.
Eso manda sobre todo lo demás — poco texto, lo importante grande, y nada que
obligue a abrir un modal para saber qué hacer.

Listado de pedidos con **fecha y hora**, y por cada uno:

- **Todos los ítems** y sus cantidades.
- **El detalle de cada ítem tal como lo pidió el cliente** —«sin cebolla», «L»—.
  Es lo que más se equivoca y lo que más caro sale equivocar.
- **La modalidad de entrega**: si va a envío o se retira en el local, con la
  dirección cuando corresponde.
- **El monto**.
- **El comprobante de pago que subió el cliente.**

**El operador ve esta pantalla y NO ve Cobros.** No es jerarquía: el cocinero no
necesita saber cuánto facturó el negocio, y cada dato de más en una pantalla
operativa es un dato que hay que saltear para llegar al que importa.


<!-- movido de admin/DISENO.md §4nonies.3 (25/09/2026, líneas 1873-1911) -->

### 4nonies.3 Lo que falta para poder construirlas

No se puede empezar por la pantalla: **dos datos que las dos necesitan no
existen todavía**, y sin ellos saldría una pantalla que miente.

1. **EL COMPROBANTE NO SE GUARDA.** Del mensaje se guardan `tipo`, `texto` y el
   identificador de Meta, pero **no el `media id`**, así que no hay de dónde
   traer la imagen. Hacen falta tres cosas, en orden: guardarlo en la ingesta,
   una función que baje el archivo con el token y lo sirva desde nuestro propio
   origen —nunca un enlace a Meta, que caduca—, y el permiso de lectura. Es el
   mismo hueco que hoy hace que en «Conversaciones» solo se marque el adjunto.

2. **LOS PEDIDOS POR WHATSAPP NO SE GUARDAN COMO PEDIDOS.** La colección
   `pedidos` ya tiene ítems, total, entrega, dirección y nota —está completa—
   pero **solo la escribe el carrito web**. Un pedido tomado conversando registra
   un `cierre`, que es un número para facturar y no lleva ítems. Mientras siga
   así, la pantalla de Pedidos estaría vacía justo para el flujo que la
   necesita. Lo tiene que escribir el flujo al confirmar, con la misma forma que
   ya usa el carrito: una sola forma de pedido, no dos.

**El orden recomendado era ese**: primero los dos datos, después las pantallas,
porque al revés se construye contra datos que no llegan. Se invirtió el 09/09
para tener las pantallas a la vista, con esta condición: **mientras falten los
dos datos, cada pantalla lo dice.** Pedidos avisa que los pedidos de WhatsApp
todavía no se listan, y dónde verlos; Cobros avisa que el comprobante está en
la conversación. Esos avisos se quitan cuando llegue el dato, no antes.

> **Revisión del 17/09 (§4duodecies): el `media id` del comprobante YA NO HACE
> FALTA guardarlo.** La seña por QR resolvió el punto 1 por otro camino: el
> comprobante **no se guarda, se coteja**. El flujo lo baja de Meta con el
> token, un modelo lo lee, y al servidor llega solo el JSON leído (monto,
> cuenta, fecha, hora, banco); la imagen y el PDF no van a Storage ni a
> Firestore, y en el cierre queda `cotejo` con lo leído y el resultado. Cobros
> muestra eso, y sigue diciendo que la imagen está en la conversación: no
> como deuda, sino como decisión. Un comprobante guardado es un dato personal
> más que custodiar, y lo que la persona necesita para mirar su banco —monto,
> banco, hora— ya está en el cotejo. El punto 2 (los pedidos por WhatsApp
> como pedidos) sigue pendiente.


<!-- movido de admin/DISENO.md §4nonies.4 (25/09/2026, líneas 1912-1918) -->

### 4nonies.4 Lo que cambia en el registro de flujos — hecho

`web/src/central/lib/flujos.ts` declara para `venta` las pestañas Pedidos, Cobros,
Inventario y Configuración de QR. «Pedidos» es la primera con `oper` entre sus
roles, y la compuerta de la cabecera (`App.tsx`) ya filtra por `roles` en vez de
suponer que una pestaña de flujo implica administrador.
