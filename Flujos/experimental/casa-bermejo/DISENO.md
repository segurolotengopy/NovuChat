# Casa Bermejo: diseño del flujo del asistente, Bolivia primero (B3, 05/11/2026)

**Qué es.** El asistente de WhatsApp de un comercio con tienda (tenant `casa-bermejo`). El catálogo, el precio final y el stock los sirve NovuTienda por HTTP (contrato v1: `docs/integracion-novuchat.md` del repositorio de NovuTienda); este flujo no guarda catálogo. El código calcula (carrito, montos, cobro, estados); el modelo conversa. Alcance de este bloque: **Bolivia** (+591, QR del comercio sin monto, comprobante). Argentina (alias en ARS) entra en B4, cuando exista el servidor de alias; confirmar pedido y descuento de stock es del servidor (B5). **Apagado y no publicable**: el flujo se arma, no se importa ni se enciende.

**Regla «basado en» (01/10/2026).** No se copia el flujo de Walisuma. Se parte de esta lista de funcionalidades y se reutilizan los módulos comunes (`Flujos/experimental/venta-digital/src/`, `comun-sin-agente/`, `Flujos/src/core/medios/`), incluidos desde su fuente, nunca copiados.

## Funcionalidades (lista corta, confirmada en el alcance cerrado del 31/10)
1. Entrar solo por la entrega firmada del receptor; sesión por `messages[0].from`; filtro de eventos; normalización de todos los tipos de entrada.
2. Separar por país del remitente (`ceMercadoDePrefijo`): +591 atendido en B3; +54 con texto fijo hasta B4; otro país, texto fijo.
3. Leer el catálogo de NovuTienda (HTTP, credencial de n8n) y adaptarlo con `ceVendibles` (B2): precio exacto, `disponible`, `stock`, cotización `vigente`. Cualquier falla = pase a vendedor (aviso + botón, `ceTextoPase`).
4. Asesorar (una llamada al modelo por turno de conversación libre) y armar el carrito por código (`vcVendibles` → `vcLineas`; el stock recorta la cantidad).
5. Datos de entrega (Bolivia: nombre, ciudad, empresa de flota o terminal o dirección; por confirmar con el comercio). **El asistente NO toma CI ni DNI en el chat** (decisión de Andres, 05/11/2026, opción A): el comercio lo pide a mano al coordinar el envío. Motivo: la ficha de 48 h en n8n nunca guarda documentos y así el flujo queda como el de la base de venta, sin dato sensible en el almacén de n8n. El asistente tampoco calcula ni cobra el envío.
6. Cobro real Bolivia: QR del comercio SIN monto (imagen de la consola) + lectura del comprobante y cotejo en el servidor. Nunca «pago acreditado»: «tu comprobante llegó y los datos coinciden».
7. Pedido: aviso al comercio (plantilla de pedido, una vez cuando llega el comprobante) y registro en la consola de NovuChat (PR-4, de Clínicas). Nada se escribe en NovuTienda desde este flujo.
8. Derivación a un vendedor (aviso Y botón), Tomar, comercio no operativo, uso extendido, guardado de medios (obligatorio), identidad (nunca niega ser una IA).
9. Recibo: no automático (decisión de Andres, 05/11): lo envía el comercio desde su consola.

## Qué es común (se incluye) y qué es propio (se escribe)
| Pieza | Origen |
|---|---|
| Entrada verificada del receptor, Descartar repetidos | `venta-minima/flujo.plantilla.json`, por nombre |
| Carga de entrada, Config del negocio, Normalizar entrada, Puerta del turno, Resumen del turno | `venta-digital/src/nodos/` (neutros, parámetro `CN_TENANT`) |
| Cobro (`cb*`), avisos (`av*`), conversación (`vd*`), carrito (`vc*`) | `venta-digital/src/` |
| Catálogo externo (`ce*`) | `venta-digital/src/catalogo-externo.js` (B2) |
| Medios (voz, imagen, PDF, comprobante guardado) y guardado de medios (11 nodos) | `Flujos/src/core/medios/`, `comun-sin-agente/src/guardado.mjs` |
| Cadena de envío y reporte saliente | `comun-sin-agente/src/envio.mjs` |
| **Propio:** `Decidir turno`, `Interpretar lectura`, `Armar avisos`, `Armar mensajes`, la librería `bm*` (venta de este comercio: textos, entrega por país, intenciones por código) y el nodo `Traer catálogo` | `Flujos/experimental/casa-bermejo/` |

## Nodos y tope
Referencia: Walisuma tiene 56 (47 + 9 del guardado). Este flujo agrega UN nodo HTTP, `Traer catálogo` (después de `Puerta del turno`, con «Continue on Fail» solo en ese nodo; la entrada verificada del receptor no lo lleva) → **57 en producción y 52 en prueba**. No se plegó `Interpretar lectura`: el armado y la suite ya lo conectan igual que en la base. El +1 sobre el tope de 56 es una excepción que decide Andres (el catálogo no vive en la consola); `construir.mjs` fija `TOPE_DE_NODOS = 57` y `armado.test.ts` lo exige exacto.

## Cómo se decide un turno (por código)
Puerta cerrada → nada. País: BO sigue; AR/otro → texto fijo. Medios: voz = texto; comprobante → cotejo; imagen/archivo → texto fijo. Sobre el texto, por código: identidad, factura, hablar con una persona → pase. Sin catálogo (`ceVendibles` ok:false) → pase con `ceTextoPase`, y `alerta` → aviso a quien opera. Solo la conversación libre llama al modelo (1 llamada: conversa Y propone `{texto, lineas, entrega}`); precios, totales y descuentos del modelo se ignoran; el QR se emite con el pedido, la entrega completa y la confirmación del cliente (detectada por código). Un QR abierto cuyo carrito cambia cierra el cobro (`cobro_cancelado`) antes de emitir otro.

## Costo (unidad: conversación)
Como la base de venta: 1 mensaje al cliente por turno (o ninguno), 2 en el turno del QR (resumen + imagen), 1 al comercio por pedido, +1 por derivación (a lo más una cada 30 min por teléfono). Argentina no lleva imagen (alias en texto). Llamadas al modelo: 0 o 1 por turno. El guardado de medios no manda mensajes. **Cero mensajes agregados respecto de la base**; la suite del flujo lo cuenta (compuerta pendiente desde B2).

## Pruebas (negando)
Armado (nodos, conexiones, receptor, inclusiones byte a byte, no publicable); sesión (dos teléfonos nunca comparten ficha); catálogo (cada código de error → pase con aviso y botón; moneda/mercado; cotización; stock); cobro (nunca «acreditado/verificado/recibimos»; QR sin monto; comprobante repetido; carrito cambiado); voz (NIEGA_IA, sin promesas ni presión); mensajes por conversación; Tomar y comercio no operativo; regresión de Walisuma.

## Etapas (un PR cada una)
- **B3a (este PR):** este diseño. Solo documentos.
- **B3b:** `bm*` (librería pura de la venta de Bolivia) + sus nodos de código + pruebas puras.
- **B3c:** plantilla, `construir.mjs`, datos con marcadores `REEMPLAZAR_*`, JSON armado y suite del flujo (mundo de mentira).

## Condiciones antes de publicar (no de este bloque)
Escritura anónima de Wegic cerrada y verificada (o sitio nuevo en producción); WABA con método de pago; plantilla de pedido aprobada; QR, titular, lista de envío y WhatsApp de la tienda entregados; credencial del catálogo cargada en n8n por quien opera; ensayo con teléfono real y el «sí» de Andres por acción.
