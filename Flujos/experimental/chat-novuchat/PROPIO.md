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

## Común SIN fuente utilizable: copiado y declarado (HUECOS, a resolver en el módulo común)

| Pieza en este flujo | Dónde está lo «común» y por qué no se pudo incluir |
|---|---|
| `src/nodos/_comun.js` (`cn*`: leer nodos por nombre, atención, Gemini, mapa de fichas) | No hay fuente: Captación (119 líneas), Agenda (147) y Venta (673) tienen cada una la suya. Copia adaptada de Captación mínima |
| Carga de entrada (filtro de eventos de Meta), Interpretar entrada (normalización), medios (3 Gemini, tamaño, descarga) | `Flujos/src/core/normalizar-entrada.js` y `core/medios/*` son del contrato del agente (`userInput`, `$('Normalizar entrada')`); no componen con un flujo sin agente |
| Puerta del turno (comercio no operativo + uso extendido) | `core/comercio-no-operativo.js` y `core/uso-extendido.js` son del contrato del agente y hay 4 versiones divergentes de `uso-extendido` |
| Config del negocio (consola → configuración) | `core/config-del-negocio.js` (403 líneas) es del agente; este nodo toma solo precios, imagen, recepción, voz y atención |
| `chAviso` (plantilla `solicitud_contacto` a recepción) | `cmContactoConBoton` cubre solo el botón; no hay constructor común de la plantilla |
| `decidir-fila-de-la-planilla.js`, `prospecto-para-la-planilla.js` (hoja Leads_CRM) | `Flujos/src/modulos/captacion/` existe pero está ATRASADO (sin calificación por hechos ni resumen J). Copia idéntica a la de `captacion-minima/src/nodos/`; una prueba compara byte a byte |
| Detectores, extracción literal de nombre y empresa, filtros de redacción propios (`src/lib/chat.js`, primer bloque) | Existían solo en Captación mínima: son piezas propias de NovuChat portadas con sus pruebas (y comparadas con la original) |

## Propio de NovuChat

**Puerta de la entrega** (`¿Meta aceptó?`): un nodo propio entre `¿Reportar? (saliente)` y `Reportar mensaje (saliente)` que lee `messages[0].id` y `error` (regla I-ENTREGA 3). Los nodos comunes quedan intactos; `construir.mjs` solo reencamina esa conexión y una prueba lo compara con la fuente.

Cerebro conversacional: instrucciones y datos del documento comercial (`admin/scripts/datos/chat-novuchat/novuchat.json`), historial y ficha por teléfono, coalescencia de clics (Registrar evento,
Esperar ráfaga, Armar turno), contexto y validación del mensaje del modelo (con su reintento y respaldos), rutas deterministas (planes, equipo, consumo, tope, banco, integración, costos de Meta,
descuento, lista), «Confirmar envío» (restaura la ficha si Meta rechaza), hoja y calificación por hechos, y el modelo como parámetro de los datos.

## Mensajes por conversación

Un mensaje por turno del cliente (una ráfaga de clics es UN turno) más la plantilla a recepción UNA vez por ventana de 24 h. **0 agregados y 0 quitados** respecto de Captación mínima por turno;
las llamadas al modelo son 0 o 1 por turno (2 si una guardia rechaza el mensaje). Diferencia de la cadena común: ante el rechazo de la plantilla de aviso, envía además el texto de respaldo a recepción.
