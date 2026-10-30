# El flujo de venta de Walisuma (tenant `walisuma`): qué es común y qué es propio

Regla (Andres, 09/10/2026): **flujo propio = composición propia + núcleo común obligatorio**. Lo común se incluye desde su fuente, nunca se copia; lo propio vive aquí. Regla «Basado en» (01/10/2026): se parte de la lista de funcionalidades, no del flujo de otro cliente.
Zona: `Flujos/experimental/walisuma/`. Este es el **PR-3, el flujo completo** sobre el esqueleto del PR-2: conversación, carrito, cobro real con el QR del comercio, cotejo del comprobante, avisos al comercio y derivación. **No es publicable todavía**: `construir.mjs --publicable` sale 1 mientras queden marcadores `REEMPLAZAR_*`, la plantilla `pedido_registrado` sin aprobar o el costo de entrega sin declarar.
Armado: `node Flujos/experimental/walisuma/construir.mjs` escribe `walisuma.json` (**47 nodos**) y `walisuma.prueba.json` (42); con `--verificar` no escribe y sale 1 si difieren o violan una guardia.
Pruebas: `admin/pruebas/tenants/walisuma/` — `armado.test.ts` (47 nodos, receptor, conexiones, único nodo sin entradas, prohibición 7, webhooks, inclusiones byte a byte, no publicable, datos), `receptor.test.ts`, `sesion.test.ts` (clave `messages[0].from`; carrito, ficha y QR por teléfono; reversión de la ficha), `tomar.test.ts` (pausa por Tomar, «operador» con aviso y botón, comercio no operativo), `neutros.test.ts`, `carrito-flujo.test.ts`, `cobro.test.ts`, `promesas.test.ts`, `voz.test.ts` y `campanas.test.ts`, con `mundo.ts` (el n8n de mentira con dobles) y `derivacion.ts` (la tabla de derivación); más `carrito.test.ts` y `catalogo.test.ts` del PR-1.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Entrada verificada del receptor (6 nodos: Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200), Rechazar (401), Descartar repetidos) | `Flujos/experimental/venta-minima/flujo.plantilla.json`, leídos POR NOMBRE por `construir.mjs`; `--verificar` falla si difieren (id, posición y notas incluidos) |
| Cobro (`cb*`), avisos (`av*`) y motor de la conversación (`vd*`) | `Flujos/experimental/venta-digital/src/{cobro,avisos,conversacion}.js`, librerías de todos los nodos `todo` |
| Mensajes de WhatsApp (`cm*`) | `Flujos/experimental/comun-sin-agente/src/mensajes.js`, paquete `mensajes`, solo en «Armar mensajes» |
| Cadena de envío (¿Enviar de verdad?, Enviar a WhatsApp, ¿Falló el envío?, Enviar respaldo, ¿Reportar? y Reportar mensaje (saliente)) | `comun-sin-agente/src/envio.mjs`, `injertar()` desde `construir.mjs`; «¿Meta aceptó?» solo reencamina una conexión |
| Armador (plantilla + código → JSON, `--verificar`) | `comun-sin-agente/construir.mjs` (`leerProyecto`, `armarVariante`) |
| Medios: transcripción, imagen (con las campañas por titular) y medio no aceptado | `Flujos/src/core/medios/{preparar-transcripcion,anuncio-por-titular+preparar-imagen,medio-no-aceptado}.js`, **byte a byte** |
| Nodos neutros: Carga de entrada, Config del negocio, Normalizar entrada, Puerta del turno, Resumen del turno, y `_comun.js` | `Flujos/experimental/venta-digital/src/nodos/` (ver abajo): subidos NEUTRALIZADOS desde la versión de «El Puente»; la de Antonio no se tocó ni se republicó |
| Reglas del task runner sobre las referencias `$('…')` | `rroca-ruben/construir.mjs`, **importada** (`problemasDeReferencias`) |

### Los nodos neutros y su diferencia con la versión de Antonio (cada una, declarada y probada en `neutros.test.ts`)

| Archivo | Diferencia |
|---|---|
| `carga-de-entrada.js`, `config-del-negocio.js`, `puerta-del-turno.js` | **Ninguna**: idénticos byte a byte (huella fijada de los dos lados) |
| `_comun.js` | El título y UNA función: la clave de la ficha en los datos estáticos ya no es `antonio` sino `CN_TENANT.claveFicha` (parámetro del tenant). Una clave ausente, con otra forma o que toca el prototipo no se usa: el nodo no lee ni escribe fichas (antes, la clave fija no podía fallar así). Se agrega `cnClaveDeFichas()` |
| `normalizar-entrada.js` | Las siete llamadas a la librería del tenant (`raFichaVigente`, `raYaVisto`, `raLineaCliente` ×3, `raEsRiesgo(raNorm(…))`, `RA_VENTANA_FUERA_DE_PAIS_MS`) pasan por `CN_TENANT` (`fichaVigente`, `yaVisto`, `lineaCliente`, `esRiesgo`/`norm`, `ventanaFueraDePaisMs`); dos comentarios dejan de nombrar al cliente |
| `resumen-del-turno.js` | Se QUITAN los tres bloques de reversión propios de ese negocio (`qrPrevio`, `qrLiberado`, `hashPrevio` con `ct*`) y se AGREGA la reversión genérica: `revertirSiFalloElPrincipal` (si ALGÚN envío principal no devolvió `messages[0].id`, aunque saliera el respaldo: con un resumen y un QR, uno bueno no tapa al que falló) y `revertirFicha` (si no salió nada). Solo copia campos de nombre simple a la ficha de `from`. La verificación de entrega (regla I-ENTREGA) queda idéntica. Las variables locales `ra*` se renombran |

El «lector del panel» (`raPanelDe` de Antonio) NO lo usa ninguno de estos cinco nodos: «Config del negocio» lee el cuerpo de la consola directamente, igual que el de Antonio. El lector de `catalogo`, `cobro` y `campañas` de `configuracionFlujo` lo necesita el PR-3 en `wl.js`.

## HUECOS declarados (copia sin fuente común utilizable; a resolver en el módulo común)

| Pieza en este flujo | Origen | Diferencia |
|---|---|---|
| `WL_NIEGA_IA` en `src/lib/wl.js` | `rroca-antonio/src/lib/ra.js` (`RA_NIEGA_IA`) | La expresión, idéntica salvo el nombre. Prohibición 4 de CLAUDE.md |
| Nodos JSON de «Config base», «Traer configuración», «Carga de entrada», «Config del negocio», «Normalizar entrada», «¿Reportar? (entrante)», «Reportar mensaje (entrante)», «Puerta del turno», «¿Bajar medio?», «Obtener URL del medio (general)», «¿Tamaño aceptable?», «Descargar medio», «¿Es audio?», «¿Es un documento?», «Transcribir audio», «Describir documento», «Describir imagen», «¿Meta aceptó?», «Entrada de prueba» | `rroca-antonio/flujo.plantilla.json` | Ninguna, salvo: las notas de «Config base» (ruta de los datos), «Armar mensajes», «Resumen del turno», «Preparar imagen» y «Entrada de prueba»; el código de los nodos neutros (marca `@@vd:`); y el prompt de «Describir documento» y «Describir imagen», que dice «un negocio que vende productos por WhatsApp» donde Antonio dice «quien vende materiales digitales para parejas» |
| «Guardar comprobante» | `rroca-antonio/flujo.plantilla.json`, commit `7188637c` | **Ninguna** (huella fijada del nodo entero). Terminal y arriba de «¿Es un documento?» |
| «Reportar mensaje (entrante)» | el de Antonio | Ninguna: el evento `no_contactar` sale de la petición escrita de no ser contactado; `riesgoEscrito` queda siempre en falso (Walisuma no detecta violencia: `wlEsRiesgo`) |

## Propio de Walisuma

- `src/lib/wl.js` (SOLO datos y textos; lo común está en la base): la ficha por teléfono (olvido a las 48 h, últimos 40 ids de mensaje, tope de 1.000 fichas, campos de la charla `vd*`), `CN_TENANT` (el parámetro que leen los nodos neutros), los textos fijos (cortés y de otro país, ambos con **texto provisional que decide el comercio**) y `wlSeguro` (NIEGA_IA y palabras prohibidas del cobro en código, no en el prompt: prohibiciones 3 y 4).
- `src/lib/wl-venta.js` (la decisión de la venta: catálogo vendible, cobro, entrega, intenciones por código, revisión de la redacción, cuerpo de la llamada al modelo y `wlResolver`) y los nodos `decidir-turno.js`, `interpretar-lectura.js`, `armar-avisos.js` y `armar-mensajes.js`. «Armar mensajes» escribe la ficha con la clave `messages[0].from` y deja en el primer ítem lo que «Resumen del turno» devuelve si el envío no sale (`revertirFicha` y, para el QR, `revertirSiFalloElPrincipal`).
- `flujo.plantilla.json`, `construir.mjs` (guardias, datos, inclusión del receptor) y los datos `admin/scripts/datos/walisuma/walisuma.json` (solo marcadores `REEMPLAZAR_*`; costo de entrega VACÍO a propósito: el comercio todavía no lo declaró).

## Los 11 nodos del PR-3 (47 en total, tope exacto)

Decidir turno, Interpretar lectura, ¿Cotejar?, Cotejar en el servidor, ¿Conversar con el modelo?, Conversar con el modelo, ¿Avisar al servidor?, Avisar al servidor, Armar avisos, ¿Hay avisos?, Enviar aviso. Son 36 + 11 = **47**, sin margen: cualquier nodo extra exige quitar otro. Producción 47, prueba 42.

**El orden de los avisos difiere del de Antonio** (declarado): `Decidir turno → ¿Conversar con el modelo? → [Conversar con el modelo] → Armar avisos → ¿Avisar al servidor? → [Avisar al servidor] → ¿Hay avisos? → [Enviar aviso] → Armar mensajes`. «Armar avisos» corre ANTES de «¿Avisar al servidor?» porque solo después de leer la propuesta del modelo se sabe si el pedido cambió con un QR abierto y hay que cerrar el cobro (`cobro_cancelado`) antes de emitir otro. «¿Hay avisos?» y «Enviar aviso» leen por nombre de «Armar avisos».

## Cómo se decide un turno (código, no prompt)

- **«Decidir turno»** (sin modelo): puerta cerrada → nada; otro país → texto fijo; medios (nota de voz = texto, comprobante → cotejo, anuncio por titular → producto por código, imagen o archivo → texto fijo); y, sobre el texto, **por código**: «¿eres un bot?» (texto fijo que dice que es una IA), volumen o regalos corporativos, factura, una pieza sin precio (tapiz a consultar) y «hablar con una persona» → pasar con recepción. Sin catálogo no se improvisa. Solo la conversación libre llama al modelo: UNA llamada que conversa y propone el pedido (`{texto, lineas, entrega, facturacion, quiereHablar}`).
- **`wl-venta.js` (`wlResolver`, la MISMA decisión en «Armar avisos» y en «Armar mensajes»)**: las líneas salen de `vcLineas` contra los ítems vendibles (activos, con precio en Bs, no agotados; los 3 tapices sin precio y los licores apagados NO se venden); precios, totales y descuentos del modelo se ignoran; el total es `vcTotalCentavos` (nunca suma envío) y el monto del QR sale de ahí. El QR se emite solo con el pedido, la entrega completa (modo, ciudad y a nombre de quién; dirección si es a domicilio) y la confirmación del cliente (dicha por el cliente, detectada por código). Con un QR abierto y el carrito cambiado (`vcMismoCarrito` falso) se avisa al servidor (`cobro_cancelado`); si no responde 200 NO se emite otro QR y se pasa con recepción.
- **Lo que redacta el modelo** pasa por `cmRevisarRedaccion` (sin datos de pago, sin afirmar compra, sin promesas de aviso), por la revisión de voz (sin presión de tiempo, existencias ni «lujo único»), por la de importes (todo importe tiene que ser el precio de una pieza vendible) y por el tope de 2 emojis; si falla, sale un texto fijo. «Billetera» es una pieza del catálogo: la palabra se enmascara solo para el filtro de datos de pago, y la billetera digital sigue prohibida.
- **Cobro REAL** (nunca simulado): el QR sale por id de medio de la consola; ningún texto dice «acreditado», «verificado» ni «recibimos tu pago» (`wlSeguro`, `wlTextoComprobante`): «tu comprobante llegó y los datos coinciden». Quien confirma que entró el dinero es el banco, y el comercio.
- **Aviso al comercio**: la plantilla `pedido_registrado` con 4 variables (`{{1}}` ítems por `vcLineaAviso`, `{{2}}` total por `vcMonto`, `{{3}}` ciudad y modalidad, `{{4}}` el cotejo), o texto libre dentro de la ventana de 23,5 h del destinatario; un solo destinatario (`contactoAviso`), nunca el propio número de quien escribe. «Ya avisé» solo con un `wamid` real; si no, «no pude avisar» y el botón.
- **NIT y CI**: la ficha de 48 h no tiene dónde guardarlos, la memoria de la charla enmascara los números largos y el aviso no los lleva. Si el cliente pide factura, se pasa con recepción.

## Ambigüedades del encargo que se resolvieron así (para revisar)

1. **Cuándo sale el aviso del pedido**: el encargo dice «1 por pedido» y a la vez un valor «sin comprobante aún». Se resolvió con UN aviso por pedido, cuando el comprobante llega y se coteja (`llegó y los datos coinciden`, `llegó; los datos casi coinciden, revisar` o `llegó; no se pudo cotejar, revisar`), y el valor «sin comprobante aún» solo en el pedido sin QR de cobro real (recepción coordina el pago). Un pedido con QR cuyo cliente nunca manda el comprobante NO avisa. Si el comercio quiere el aviso al emitir el QR, serían 2 por pedido.
2. **La confirmación del cliente**: el JSON del modelo no trae una bandera de confirmación; la detecta el CÓDIGO sobre el texto del cliente (`wlQuierePagar`) y queda en la ficha (`cierre`) hasta que la entrega esté completa.
3. **Facturación**: el campo `facturacion` del JSON se lee y se descarta; no hay dónde llevarlo (la plantilla tiene 4 variables y la ficha no puede guardarlo). Hasta el PR-4 (pedidos a la Consola) la factura se pasa con recepción.
4. **Modos y costo de entrega**: vacíos en los datos (marcador y cadena vacía). Sin lista de modos, el modo es una línea corta del cliente; el texto del QR dice «el total no incluye el costo de entrega» y no se ofrece ningún envío.
5. **El texto para números de otro país** sigue siendo provisional.

## Condiciones declaradas

- **No publicable.** `node construir.mjs --publicable` sale 1: hay marcadores `REEMPLAZAR_*` (credenciales por nombre, receptor, `wabaIdEsperado`, teléfonos de prueba, contacto del aviso, modos de entrega…), la plantilla `pedido_registrado` no consta como APPROVED y el costo de entrega está vacío. Los mensajes nombran claves y marcadores, nunca valores. Aun en verde, el flujo NO se publica sin el «sí» de Andres por acción y una prueba contra un teléfono real.
- **Guía de voz**: viene de la guía de tono y voz del cliente (el PDF de la carpeta del cliente, solo lectura); el prompt está en `wl.js` (`WL_PROMPT_VOZ`).
- **Prefijos permitidos**: el dato trae `591` por omisión; si Walisuma vende a turistas, hay que decidirlo antes de publicar (el texto de otro país es provisional).
- **Falla abierta de la pausa y orden «suspendido antes que bloqueado»**: heredados de la puerta común, como en los demás flujos.
- **Modo prueba**: niega por defecto (`telefonosDePrueba` sin llenar = ningún teléfono permitido).

## Mensajes por conversación

**1 al cliente por turno** (o ninguno), **más el QR cuando se emite**: el resumen del pedido y la imagen del QR (2 mensajes en ese turno). **1 al comercio por pedido** (el aviso del pedido, cuando llega el comprobante) y **+1 por derivación** (a lo más una consulta cada 30 minutos por teléfono). Sin mensaje de bienvenida extra: la presentación del asistente va en el mismo mensaje de la primera vez. Llamadas al modelo: 0 o 1 por turno de conversación libre (la puerta cerrada, la pausa por Tomar, los comprobantes, los anuncios y las derivaciones por código no llaman al modelo); las de Gemini en los medios son 1 por audio, imagen o PDF.
