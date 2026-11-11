# El flujo de venta de Casa Bermejo (tenant `casa-bermejo`): qué es común y qué es propio

Zona: `Flujos/experimental/casa-bermejo/`. Diseño: `DISENO.md`. Estado: **B3c** — flujo completo de Bolivia, ARMADO y APAGADO: `casa-bermejo.json` (57 nodos) y `casa-bermejo.prueba.json` (52), desde `flujo.plantilla.json` y `admin/scripts/datos/casa-bermejo/casa-bermejo.json` (solo marcadores `REEMPLAZAR_*`) con `node Flujos/experimental/casa-bermejo/construir.mjs` (`--verificar` falla si difieren; `--publicable` sale 1 mientras queden marcadores). **No publicable todavía.**
Regla «Basado en» (01/10/2026): la lista de funcionalidades está en `DISENO.md`; no se copió el flujo de otro cliente. Lo común se INCLUYE desde su fuente; lo propio vive aquí.

## Común, incluido desde su fuente
Cobro (`cb*`), avisos (`av*`), conversación (`vd*`), carrito (`vc*`), catálogo externo (`ce*`) en `Flujos/experimental/venta-digital/src/`; mensajes y filtro de redacción (`cm*`) en `comun-sin-agente/src/`; nodos neutros en `venta-digital/src/nodos/`.

## HUECO declarado (copia con fuente común pendiente)
`src/lib/bm.js` y `src/lib/bm-venta.js` se derivaron de `walisuma/src/lib/wl.js` y `wl-venta.js` (la misma venta por WhatsApp con QR del comercio): ficha de 48 h, entrega, intenciones por código (pagar, identidad, factura, volumen, hablar con una persona), revisión de la redacción del modelo, resolvedor de turno y textos de derivación y de comprobante. Diferencias, todas probadas en `admin/pruebas/venta-casa-bermejo-lib.test.ts`:
- La fuente del catálogo es HTTP (`ceVendibles`, B2) y no la consola; un catálogo ilegible pasa con un vendedor (`sin_configuracion`), nunca se improvisa.
- La clave de la ficha es `casabermejo`; el mercado es solo Bolivia (`BM_MERCADO`); el id de pedido lleva `BM`.
- La guía de voz es neutra: tratamiento (`tratamiento` = `usted` o tuteo) y tono los decide el comercio; no hay palabras de material ni piezas sin precio.
- La entrega admite flota o terminal (pide dirección). **No toma documento (CI/DNI)**: decisión de Andres del 05/11/2026 (opción A); el comercio lo pide a mano al coordinar el envío. La ficha nunca guarda un documento y el prompt lo prohíbe.
- Los dominios de las fotos son dato del negocio (`hostsFoto`); sin lista, ninguna foto.
Cuando la venta común suba a `venta-digital/src/`, ambos archivos migran y las copias desaparecen (Walisuma incluido).

## Propio
Los datos y textos de este comercio (`bm.js`), la decisión de su venta (`bm-venta.js`) y, en B3c, la plantilla del flujo, su armador, los datos con marcadores `REEMPLAZAR_*` y la suite del flujo.

## Costo
0 mensajes por conversación agregados respecto de la base de venta (esta librería no envía nada). El conteo real por conversación lo cuenta la suite del flujo en B3c.

## Para B3c: lo que NO se copia de Walisuma
Los nodos `Decidir turno` y `Armar *` de Walisuma llaman a `wlVendibles(panel)`, `wlSinPrecio` y `wlNombraSinPrecio`, que aquí no existen: los nodos de este flujo leen `bmCatalogo(...)` (el resultado de `ceVendibles`) y `ctx.catalogo`. El nodo HTTP del catálogo se llama exactamente **`Traer catálogo`** (lo lee `bmContexto`). Un QR abierto se compara por id, cantidad, precio, detalle y moneda (`vcMismoCarrito`): si el precio cambia con el QR abierto, el cobro se cierra y se emite uno nuevo con el total real.

## Los nodos propios (B3c) y su origen
`src/nodos/{decidir-turno,interpretar-lectura,armar-avisos,armar-mensajes}.js` se derivaron de los de Walisuma (HUECO declarado, igual que `bm*`): cambian el catálogo (`bmCatalogo` sobre `Traer catálogo` en vez del panel de la consola), la ausencia de piezas sin precio y la moneda de las líneas del QR. `Traer catálogo` (HTTP GET, Bearer del tenant en una credencial de n8n, sin `If-None-Match`) lee una dirección fija (`catalogoUrl`) y SOLO el mercado de Bolivia. La suite del flujo está en `admin/pruebas/tenants/casa-bermejo/` (armado, receptor, sesión, Tomar, cobro, promesas, voz, carrito, campañas y `catalogo-flujo.test.ts` con el costo en mensajes).

## Pendiente para publicar (no de este bloque)
Excepción de Andres para el nodo 57; sustituir los marcadores (credenciales, receptor, WABA, número, contacto de aviso, `catalogoUrl`, `hostsFoto`, `tratamiento`, modos de entrega); plantilla de pedido aprobada en Meta; Argentina (B4) y confirmar pedido (B5); ensayo con un teléfono real y el «sí» de Andres por acción.

## Seguimientos declarados (revisión del 06/11)
- **`Traer catálogo` corre en todo mensaje entrante**, también con la puerta cerrada (Tomar, suspendido) o en un medio: suma llamadas contra el límite de NovuTienda y hasta 4 s de latencia, sin mensajes extra. Mejora posible: un `If ruta === 'sigue'` antes del nodo (+1 nodo, otro punto sobre el tope) o una caché corta en la ficha común.
- **Aviso a quien opera** cuando el catálogo falla por un defecto (credencial revocada, versión, moneda): `catalogoAlerta` se calcula en «Decidir turno» y falta un consumidor.
- **El aviso del pedido en el turno del comprobante con el catálogo caído** nombra las líneas por id (el `qrCarrito` no guarda el nombre).
- **Excepción de nodos**: 57 con `Traer catálogo` (el tope de Walisuma es 56): pendiente de Andres; fila en `docs/versiones-por-cliente.md` al aprobarla.

## B4a: Argentina hasta el pedido (sin el servidor de alias)
- **Mercado por prefijo del remitente:** 591 → BO, 54 → AR. `Traer catálogo` pide `?mercado=` con UNA expresión fija (`EXPRESION_MERCADO`, que la guardia compara literal y una prueba contrasta con `ceMercadoDePrefijo`), así que el flujo sigue en 57 nodos. `prefijosPermitidos` pasa a `591,54`; otro país recibe el texto fijo.
- **Precios en pesos:** el catálogo de AR trae ARS; los resúmenes, el aviso al comercio y el precio de un anuncio escriben «ARS …», nunca «Bs».
- **El cobro NO se hace en B4a:** el cobro por alias (contador, rotación y cotejo en pesos) es de un servidor que aún no existe (encargo a Clínicas, 30/10). Hasta entonces, al confirmar el pedido en Argentina NO se emite el QR de Bolivia: el pedido queda anotado, sale UN aviso al comercio («sin comprobante aún», total en ARS) con el botón, y el cliente lee que el pago lo coordina recepción y que no transfiera todavía. Cero mensajes agregados.
- **B4b (pendiente del servidor):** pedir el alias, decirlo en texto, cotejar el comprobante en ARS y traducir los códigos de error.
- **Antes de encender Argentina:** el `prefijosPermitidos` del tenant VIVO debe incluir 54 (la semilla ya lo trae; el panel vivo se actualiza con un paso aparte). La hora del prompt es la de La Paz (UTC-4) también para Argentina (UTC-3): una hora de diferencia en «hoy a las…», aceptada hasta que haya un campo de zona por mercado.
- La expresión del mercado devuelve «X» (y el servidor responde 400 → pase con recepción) donde `ceMercadoDePrefijo` da `null`: otro país, número demasiado corto o largo.

## B8 y B9: la línea completa al pedido y el cobro por alias de Argentina (B4b, hechos)
**Hecho (A).** `qr_enviado` (Bolivia) y `pedido_sin_cobro` (Argentina) llevan las líneas con la forma CERRADA del catálogo externo (`docs/arquitectura/modulos/pedidos.md`, «Pedido de catálogo externo»): `{externa, id, nombre, cantidad, precioCentavos, moneda, detalle?, subtotalCentavos}`, sin una clave más. `bmLineasPedido` (`src/lib/bm-venta.js`, propia de este flujo: `qr-del-pedido.js` y los demás clientes no se tocaron) toma TODO del carrito que arma el código sobre el catálogo de NovuTienda; el modelo no aporta id válido, precio, nombre ni moneda. El mismo id con dos detalles se fusiona sumando cantidades (detalle «1 azul · 2 negra»); la moneda es la del mercado por prefijo (591 BOB, 54 ARS); ante cualquier defecto (id inválido, moneda cruzada, ARS no múltiplo de 100, dos precios para un id, más de 50 unidades por id, otro país) devuelve `null` y NO viajan líneas (el pedido no se crea a medias; el aviso al comercio sale igual). Argentina estrena `referencia` propia (`bmIdPedido`, con el contador `pedidos` que sube) y emite `pedido_sin_cobro` SOLO si Meta aceptó el mensaje (lo decide el reporte saliente), sin `monto` ni `reglaCobro`. Bolivia sin QR configurado no lo emite. Mensajes por conversación: 0 agregados, 0 quitados. Nodos: 57 y 52 (sin cambio). Suite: `admin/pruebas/tenants/casa-bermejo/pedido-lineas.test.ts`.

**Dependencia del servidor (Core, no de este flujo):** la ingesta reenvía `pedido_sin_cobro` desde el PR #899; sin él el pedido de Argentina no existe y `pedirAliasArs` daría `409 sin_pedido` (el flujo transfiere a recepción). Bolivia usa la forma nueva en cuanto el tenant tenga `config/pedidos.catalogoExterno`.

**B9: el alias en Argentina (decisión de Andres: el alias llega en el TURNO SIGUIENTE).** Sigue en 57 y 52 nodos y 0 mensajes agregados: el pedido solo existe en el servidor después del mensaje que lo reporta, así que el turno 0 anota el pedido (1 mensaje, 1 aviso, como en B4a) y OFRECE «pagar» solo si el aviso salió; el cliente escribe «pagar» y ese turno responde con el alias.
- **Ficha:** `aliasPedidoId` (`wa_<referencia>`), `aliasEstado` (`pedido`, luego `abierto`, luego `fin`), `aliasVenceMs`, `aliasMontoCent`, `aliasAr`. Un pedido nuevo reemplaza al anterior.
- **Pedir el alias:** «Decidir turno» (`alias_pedir`: Argentina, pedido anotado, carrito vacío, orden de pagar). «Armar avisos» arma `servidor` ({v:1, pedidoId, telefono = messages[0].from}) y «Avisar al servidor» (generalizado, dos destinos fijos: `ingesta` y `pedirAliasArs`) llama. El mensaje lo arma «Armar mensajes» con el alias, el monto exacto y los minutos que quedan.
- **Comprobante:** «Interpretar lectura» arma `cuerpoAlias` y «Cotejar en el servidor» (generalizado, dos destinos fijos) llama a `cotejarAliasArs`. La lectura de `alias` y `operacion` es PROPIA de este flujo (`bmLecturaAlias` en `bm.js` y dos campos más en el prompt de «Describir imagen» y «Describir documento»); `cbLectura` y `cobro.js` NO se tocaron, así que Bolivia y los demás clientes no cambian. Sin `alias`, se usa `cuentaDestino`.
- **Frases fijas por código:** `ok` = «llegó y los datos coinciden» (NUNCA acreditado, verificado ni «recibimos tu pago») + aviso a recepción; `monto_distinto` y `alias_distinto` piden el correcto, `ilegible` una foto más nítida, `repetido` «ya tengo registrado…»; `vencido`, `en_revision`, cualquier 409 distinto de `cerrado`, un código desconocido o una caída: aviso + botón.
- **Alias apagado (409 `cerrado`):** vuelve el comportamiento de B4a (el pago lo coordina recepción, con el botón), sin alias, sin aviso nuevo y sin promesas.
- **«¿Hay avisos?»** decide si sale el aviso de un turno de «pagar» con la misma regla que `bmAliasPedirResultado` (una prueba las compara): el aviso solo sale cuando el servidor NO abrió el alias.
- **Pruebas:** `admin/pruebas/tenants/casa-bermejo/alias-ar.test.ts`.
- **Pendiente:** el alias real del comercio (`config/cobros`, lo escribe el servidor) y abrir las Functions de #898 (no nacen invocables); un ensayo con un teléfono real de Argentina; probar el prompt de lectura con comprobantes reales (qué campo trae el alias en cada banco o billetera).

**Estado de B5 y B6:** B5a y B5b (crear y confirmar el pedido externo en el servidor, y el botón «Confirmar» de la Consola) están en `main`; este flujo solo aporta las líneas. B6 (`pedirAliasArs` y `cotejarAliasArs`, PR #898) está abierto y sin desplegar; sus Functions no nacen invocables.
