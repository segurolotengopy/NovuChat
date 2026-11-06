# El flujo de venta de Casa Bermejo (tenant `casa-bermejo`): qué es común y qué es propio

Zona: `Flujos/experimental/casa-bermejo/`. Diseño: `DISENO.md`. Estado: **B3b** (librería de venta pura y su prueba); el JSON del flujo, la plantilla y la suite del flujo llegan en B3c. **No publicable.**
Regla «Basado en» (01/10/2026): la lista de funcionalidades está en `DISENO.md`; no se copió el flujo de otro cliente. Lo común se INCLUYE desde su fuente; lo propio vive aquí.

## Común, incluido desde su fuente
Cobro (`cb*`), avisos (`av*`), conversación (`vd*`), carrito (`vc*`), catálogo externo (`ce*`) en `Flujos/experimental/venta-digital/src/`; mensajes y filtro de redacción (`cm*`) en `comun-sin-agente/src/`; nodos neutros en `venta-digital/src/nodos/`.

## HUECO declarado (copia con fuente común pendiente)
`src/lib/bm.js` y `src/lib/bm-venta.js` se derivaron de `walisuma/src/lib/wl.js` y `wl-venta.js` (la misma venta por WhatsApp con QR del comercio): ficha de 48 h, entrega, intenciones por código (pagar, identidad, factura, volumen, hablar con una persona), revisión de la redacción del modelo, resolvedor de turno y textos de derivación y de comprobante. Diferencias, todas probadas en `admin/pruebas/venta-casa-bermejo-lib.test.ts`:
- La fuente del catálogo es HTTP (`ceVendibles`, B2) y no la consola; un catálogo ilegible pasa con un vendedor (`sin_configuracion`), nunca se improvisa.
- La clave de la ficha es `casabermejo`; el mercado es solo Bolivia (`BM_MERCADO`); el id de pedido lleva `BM`.
- La guía de voz es neutra: tratamiento (`tratamiento` = `usted` o tuteo) y tono los decide el comercio; no hay palabras de material ni piezas sin precio.
- La entrega admite flota o terminal (pide dirección). **No toma documento (CI/DNI)**: decisión pendiente de Andres; la ficha nunca guarda un documento y el prompt lo prohíbe.
- Los dominios de las fotos son dato del negocio (`hostsFoto`); sin lista, ninguna foto.
Cuando la venta común suba a `venta-digital/src/`, ambos archivos migran y las copias desaparecen (Walisuma incluido).

## Propio
Los datos y textos de este comercio (`bm.js`), la decisión de su venta (`bm-venta.js`) y, en B3c, la plantilla del flujo, su armador, los datos con marcadores `REEMPLAZAR_*` y la suite del flujo.

## Costo
0 mensajes por conversación agregados respecto de la base de venta (esta librería no envía nada). El conteo real por conversación lo cuenta la suite del flujo en B3c.
