# Casa Bermejo: diseño del flujo del asistente, Bolivia primero (B3, 05/11/2026)

**Qué es.** El asistente de WhatsApp de un comercio con tienda (tenant `casa-bermejo`). El catálogo, el precio final y el stock los sirve NovuTienda por HTTP (contrato v1: `docs/integracion-novuchat.md` del repositorio de NovuTienda); este flujo no guarda catálogo. El código calcula (carrito, montos, cobro, estados); el modelo conversa. Alcance de este bloque: **Bolivia** (+591, QR del comercio sin monto, comprobante). Argentina (alias en ARS) entra en B4, cuando exista el servidor de alias; confirmar pedido y descuento de stock es del servidor (B5). **Apagado y no publicable**: el flujo se arma, no se importa ni se enciende.

**Regla «basado en» (01/10/2026).** No se copia el flujo de Walisuma. Se parte de esta lista de funcionalidades y se reutilizan los módulos comunes (`Flujos/experimental/venta-digital/src/`, `Flujos/src/core/sin-agente/`, `Flujos/src/core/medios/`), incluidos desde su fuente, nunca copiados.

## Funcionalidades (lista corta, confirmada en el alcance cerrado del 31/10)
1. Entrar solo por la entrega firmada del receptor; sesión por `messages[0].from`; filtro de eventos; normalización de todos los tipos de entrada.
2. Separar por país del remitente (`ceMercadoDePrefijo`): +591 atendido en B3; +54 con texto fijo hasta B4; otro país, texto fijo.
3. Leer el catálogo de NovuTienda (HTTP, credencial de n8n) y adaptarlo con `ceVendibles` (B2): precio exacto, `disponible`, `stock`, cotización `vigente`. Cualquier falla = pase a vendedor (aviso + botón, `ceTextoPase`).
4. Asesorar (una llamada al modelo por turno de conversación libre) y armar el carrito por código (`vcVendibles` → `vcLineas`; el stock recorta la cantidad).
5. Datos de entrega. **Vale la decisión de Andres del 20/11/2026** (que reemplazó a la del 05/11, «no toma CI ni DNI»): el RETIRO pide solo el nombre de quien retira; el ENVÍO en Bolivia pide nombre, CI, ciudad y empresa de flota o terminal; el envío a Argentina, nombre, DNI, dirección, código postal y provincia. El documento (CI o DNI) se guarda solo en la entrega del envío: viaja al pedido, **no** viaja en el aviso al comercio ni en la memoria de la charla (el texto que se reporta lo lleva enmascarado), y **nunca se pide ni se guarda un NIT**. La captura la hace el código (`bmEntregaDeTurno`: CI, ciudad y flota por código; nombre del modelo validado por código) y el cliente ve los datos con «Corregir datos» antes del QR. El asistente tampoco calcula ni cobra el envío.
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
| Medios (voz, imagen, PDF, comprobante guardado) y guardado de medios (11 nodos) | `Flujos/src/core/medios/`, `Flujos/src/core/sin-agente/guardado.mjs` |
| Cadena de envío y reporte saliente | `Flujos/src/core/sin-agente/envio.mjs` |
| **Propio:** `Decidir turno`, `Interpretar lectura`, `Armar avisos`, `Armar mensajes`, la librería `bm*` (venta de este comercio: textos, entrega por país, intenciones por código) y el nodo `Traer catálogo` | `Flujos/clientes/casa-bermejo/` |

## Nodos y tope
Referencia: Walisuma tiene 56 (47 + 9 del guardado). Este flujo agrega UN nodo HTTP, `Traer catálogo` (después de `Puerta del turno`, con «Continue on Fail» solo en ese nodo; la entrada verificada del receptor no lo lleva) → **57 en producción y 52 en prueba al armarlo (B3)**; hoy el armador da 63 y 58, porque desde entonces se sumaron nodos comunes del core (guardado de medios, indicador de escritura): el conteo vigente lo imprime `node construir.mjs`. No se plegó `Interpretar lectura`: el armado y la suite ya lo conectan igual que en la base. El +1 sobre el tope de 56 es una excepción que decide Andres (el catálogo no vive en la consola); `construir.mjs` fija `TOPE_DE_NODOS = 57` y `armado.test.ts` lo exige exacto.

## Cómo se decide un turno (por código)
Puerta cerrada → nada. País: BO y AR siguen; otro país se atiende como Bolivia y la tienda recibe un aviso (decisión del 20/11/2026: ya no hay texto de «fuera de país»). Medios: voz = texto; comprobante → cotejo; imagen/archivo → texto fijo. Sobre el texto, por código: identidad, factura, hablar con una persona → pase. Sin catálogo (`ceVendibles` ok:false) → pase con recepción (aviso + botón, la frase de `sin_configuracion`). Si el catálogo falla por un DEFECTO (401, versión, formato, moneda, país), el mismo aviso de derivación lleva la causa y qué hacer, a lo más una vez por causa cada 6 h (`catalogoAlerta` lo consume «Armar avisos»; 0 nodos y 0 mensajes agregados). Solo la conversación libre llama al modelo (1 llamada: conversa Y propone `{texto, lineas, entrega}`); precios, totales y descuentos del modelo se ignoran; el QR se emite con el pedido, la entrega completa y la confirmación del cliente (detectada por código). Un QR abierto cuyo carrito cambia cierra el cobro (`cobro_cancelado`) antes de emitir otro.

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
