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
