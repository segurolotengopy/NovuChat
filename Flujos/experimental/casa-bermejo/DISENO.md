# Casa Bermejo: diseño del flujo del asistente, Bolivia primero (B3, 05/11/2026)

**Qué es.** El asistente de WhatsApp de un comercio con tienda (tenant `casa-bermejo`). El catálogo, el precio final y el stock los sirve NovuTienda por HTTP (contrato v1: `docs/integracion-novuchat.md` del repositorio de NovuTienda); este flujo no guarda catálogo. El código calcula (carrito, montos, cobro, estados); el modelo conversa. Alcance de este bloque: **Bolivia** (+591, QR del comercio sin monto, comprobante). Argentina (alias en ARS) entra en B4, cuando exista el servidor de alias; confirmar pedido y descuento de stock es del servidor (B5). **Apagado y no publicable**: el flujo se arma, no se importa ni se enciende.

**Regla «basado en» (01/10/2026).** No se copia el flujo de Walisuma. Se parte de esta lista de funcionalidades y se reutilizan los módulos comunes (`Flujos/experimental/venta-digital/src/`, `comun-sin-agente/`, `Flujos/src/core/medios/`), incluidos desde su fuente, nunca copiados.

## Funcionalidades (lista corta, confirmada en el alcance cerrado del 31/10)
1. Entrar solo por la entrega firmada del receptor; sesión por `messages[0].from`; filtro de eventos; normalización de todos los tipos de entrada.
2. Separar por país del remitente (`ceMercadoDePrefijo`): +591 atendido en B3; +54 con texto fijo hasta B4; otro país, texto fijo.
3. Leer el catálogo de NovuTienda (HTTP, credencial de n8n) y adaptarlo con `ceVendibles` (B2): precio exacto, `disponible`, `stock`, cotización `vigente`. Cualquier falla = pase a vendedor (aviso + botón, `ceTextoPase`).
4. Asesorar (una llamada al modelo por turno de conversación libre) y armar el carrito por código (`vcVendibles` → `vcLineas`; el stock recorta la cantidad).
5. Datos de entrega por país (Bolivia: nombre, CI, ciudad, empresa de flota o terminal; por confirmar con el comercio). El asistente NO calcula ni cobra el envío.
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
| **Propio:** `Decidir turno`, `Interpretar lectura`, `Armar avisos`, `Armar mensajes`, la librería `cbv*` (venta de este comercio: textos, entrega por país, intenciones por código) y el nodo `Traer catálogo` | `Flujos/experimental/casa-bermejo/` |

## Nodos y tope
Referencia: Walisuma tiene 58 (47 + 11 del guardado). Este flujo agrega UN nodo HTTP (`Traer catálogo`, con «Continue on Fail» solo en ese nodo y NO en la entrada verificada) → 59. Decisión para el armado, a declarar antes de construir: **plegar `Interpretar lectura` dentro de `Decidir turno`** (queda 58) o pedir la excepción a 59. Se prefiere plegar: menos nodos, más cálculo en código.

## Cómo se decide un turno (por código)
Puerta cerrada → nada. País: BO sigue; AR/otro → texto fijo. Medios: voz = texto; comprobante → cotejo; imagen/archivo → texto fijo. Sobre el texto, por código: identidad, factura, hablar con una persona → pase. Sin catálogo (`ceVendibles` ok:false) → pase con `ceTextoPase`, y `alerta` → aviso a quien opera. Solo la conversación libre llama al modelo (1 llamada: conversa Y propone `{texto, lineas, entrega}`); precios, totales y descuentos del modelo se ignoran; el QR se emite con el pedido, la entrega completa y la confirmación del cliente (detectada por código). Un QR abierto cuyo carrito cambia cierra el cobro (`cobro_cancelado`) antes de emitir otro.

## Costo (unidad: conversación)
Como la base de venta: 1 mensaje al cliente por turno (o ninguno), 2 en el turno del QR (resumen + imagen), 1 al comercio por pedido, +1 por derivación (a lo más una cada 30 min por teléfono). Argentina no lleva imagen (alias en texto). Llamadas al modelo: 0 o 1 por turno. El guardado de medios no manda mensajes. **Cero mensajes agregados respecto de la base**; la suite del flujo lo cuenta (compuerta pendiente desde B2).

## Pruebas (negando)
Armado (nodos, conexiones, receptor, inclusiones byte a byte, no publicable); sesión (dos teléfonos nunca comparten ficha); catálogo (cada código de error → pase con aviso y botón; moneda/mercado; cotización; stock); cobro (nunca «acreditado/verificado/recibimos»; QR sin monto; comprobante repetido; carrito cambiado); voz (NIEGA_IA, sin promesas ni presión); mensajes por conversación; Tomar y comercio no operativo; regresión de Walisuma.

## Etapas (un PR cada una)
- **B3a (este PR):** este diseño. Solo documentos.
- **B3b:** `cbv*` (librería pura de la venta de Bolivia) + sus nodos de código + pruebas puras.
- **B3c:** plantilla, `construir.mjs`, datos con marcadores `REEMPLAZAR_*`, JSON armado y suite del flujo (mundo de mentira).

## Condiciones antes de publicar (no de este bloque)
Escritura anónima de Wegic cerrada y verificada (o sitio nuevo en producción); WABA con método de pago; plantilla de pedido aprobada; QR, titular, lista de envío y WhatsApp de la tienda entregados; credencial del catálogo cargada en n8n por quien opera; ensayo con teléfono real y el «sí» de Andres por acción.
