# Chat NovuChat v2: qué es común y qué es propio

Regla (Andres, 09/10/2026): **flujo propio = composición propia + núcleo común obligatorio**. Lo común se incluye desde su fuente, nunca se copia; lo propio vive aquí.
`admin/pruebas/chat-novuchat-lib.test.ts`, «lo común se incluye desde su fuente, byte a byte», lo comprueba.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Mensajes de WhatsApp: texto, botones, lista, `cta_url`, `cmContactoConBoton` | `Flujos/experimental/comun-sin-agente/src/mensajes.js` (paquete `mensajes`) |
| Filtro de redacción del modelo (promesas, afirmar hechos, negar ser IA, montos, enlaces) | `comun-sin-agente/src/filtro-redaccion.js` (paquete `filtro`) |
| Cadena de envío: ¿Enviar de verdad?, Enviar a WhatsApp (lote de 1, 1,5 s), respaldo en texto, reporte saliente | `comun-sin-agente/src/envio.mjs`, `injertar()` desde `construir.mjs` |
| Armador (plantilla + código → JSON, variantes, `--verificar`) | `comun-sin-agente/construir.mjs` (`leerProyecto`, `armarVariante`) |
| Hoja de prospectos (miniCRM): `Prospecto para la planilla` y `Decidir fila de la planilla` | **Módulo `crm`** (`Flujos/src/modulos/crm/`: paquetes `crm-prospecto` y `crm-decidir`; la calificación y el resumen, del adaptador `Flujos/src/modulos/captacion/crm-captacion.js`). El mapa de columnas es DATO del tenant: la clave `crm` de `admin/scripts/datos/chat-novuchat/novuchat.json` (el ensayo la hereda); `injertarCrm` lo pone en el código y fija los rangos de los 4 nodos de Google. Ya no hay copias en `src/nodos/` |

## Común SIN fuente utilizable: copiado y declarado (HUECOS, a resolver en el módulo común)

| Pieza en este flujo | Dónde está lo «común» y por qué no se pudo incluir |
|---|---|
| `src/nodos/_comun.js` (`cn*`: leer nodos por nombre, atención, Gemini, mapa de fichas) | No hay fuente: Captación (119 líneas), Agenda (147) y Venta (673) tienen cada una la suya. Copia adaptada de Captación mínima |
| Carga de entrada (filtro de eventos de Meta), Interpretar entrada (normalización), medios (3 Gemini, tamaño, descarga) | `Flujos/src/core/normalizar-entrada.js` y `core/medios/*` son del contrato del agente (`userInput`, `$('Normalizar entrada')`); no componen con un flujo sin agente |
| Puerta del turno (comercio no operativo + uso extendido) | `core/comercio-no-operativo.js` y `core/uso-extendido.js` son del contrato del agente y hay 4 versiones divergentes de `uso-extendido` |
| Config del negocio (consola → configuración) | `core/config-del-negocio.js` (403 líneas) es del agente; este nodo toma solo precios, imagen, recepción, voz y atención |
| `chAviso` (plantilla `solicitud_contacto` a recepción) | `cmContactoConBoton` cubre solo el botón; no hay constructor común de la plantilla |
| Detectores, extracción literal de nombre y empresa, filtros de redacción propios (`src/lib/chat.js`, primer bloque) | Existían solo en Captación mínima: son piezas propias de NovuChat portadas con sus pruebas (y comparadas con la original) |

## Propio de NovuChat

**Puerta de la entrega** (`¿Meta aceptó?`): un nodo propio entre `¿Reportar? (saliente)` y `Reportar mensaje (saliente)` que lee `messages[0].id` y `error` (regla I-ENTREGA 3). Los nodos comunes quedan intactos; `construir.mjs` solo reencamina esa conexión y una prueba lo compara con la fuente.

Cerebro conversacional: instrucciones y datos del documento comercial (`admin/scripts/datos/chat-novuchat/novuchat.json`), historial y ficha por teléfono, coalescencia de clics (Registrar evento,
Esperar ráfaga, Armar turno), contexto y validación del mensaje del modelo (con su reintento y respaldos), rutas deterministas (planes, equipo, consumo, tope, banco, integración, costos de Meta,
descuento, lista —también la lista con el pitch fijo en el primer «Quiero más información» del anuncio— el «sí» a la oferta del equipo y los botones de cada turno: `chBotonesDelTurno`), «Confirmar envío» (restaura la ficha si Meta rechaza), hoja y calificación por hechos, y el modelo como parámetro de los datos.

Propio también: el sitio web (`sitioWeb`) que anexa el código en las rutas específicas (empresa, sin dato, no documentado, complemento de planes, integraciones y costos de Meta), a lo más 2 veces por ventana y por teléfono; no agrega mensajes.

## Mensajes por conversación

Un mensaje por turno del cliente (una ráfaga de clics es UN turno) más la plantilla a recepción UNA vez por ventana de 24 h. **0 agregados y 0 quitados** respecto de Captación mínima por turno, salvo (ajustes del 09/10): **+1 mensaje** en el camino «Ver planes» como primera respuesta (pide el nombre y el negocio antes de los planes; el camino de texto libre lo pide en el mismo mensaje, 0 agregados) y **+1 plantilla** a recepción cuando un segundo traspaso trae una empresa distinta, con tope de **3 plantillas por teléfono y por ventana de 24 h**;
las llamadas al modelo son 0 o 1 por turno (2 si una guardia rechaza el mensaje). Diferencia de la cadena común: ante el rechazo de la plantilla de aviso, envía además el texto de respaldo a recepción.

## Delta del paso a incluir el módulo `crm` (PR-B, 30/10/2026; sin publicar)

- **«Buscar teléfono en planilla» pasa de `returnFirstMatch: true` a `false`.** Antes traía solo la fila MÁS ANTIGUA del teléfono y la actualizaba; ahora trae todas las coincidencias y el módulo elige la MÁS RECIENTE (mayor `row_number`), como pidió Andres. Con un solo registro por teléfono la salida es la misma.
- Los rangos de lectura (`A3:J` y `A3:A`), la fila de encabezados y la columna de búsqueda salen del mapa `crm` de los datos; las guardias de `construir.mjs` los comparan con lo que da el mapa.
- Antes de escribir se comprueba el encabezado LETRA POR LETRA (A hasta J); un encabezado movido o renombrado da `encabezados_distintos` y no se escribe.
- `config/crm.activo === false` apaga la escritura (el nodo del prospecto devuelve vacío). La Function que lo entrega es el PR-B3, aparte: hoy el flujo siempre escribe.
- Mensajes de WhatsApp por conversación: 0 agregados o quitados.
