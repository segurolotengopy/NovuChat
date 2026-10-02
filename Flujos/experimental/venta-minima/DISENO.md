# NovuChat — Venta mínima (v0): diseño del armado

Flujo **experimental** para el piloto de Q'Taco (restaurante), desde el lunes 05/10/2026. Vive en
`Flujos/experimental/venta-minima/`, como Agenda mínima, fuera de la publicación normal. El plano completo
(contratos entre nodos, máquina de estados, textos fijos, costo) está en el diseño de la tarea
(`CLIENTES/QTACO/solicitudes/diseno-venta-minima-2026-10-01.md`, que no se versiona); este archivo cuenta
**cómo se arma el JSON y en qué se aparta del plano**.

Principio: **el código calcula, el modelo solo extrae.** El modelo (Gemini, por HTTP) extrae las líneas de un
pedido o los campos de una reserva, lee el comprobante y transcribe un audio. Todo texto al cliente y al
restaurante lo arma el código; los totales salen de la carta; los avisos solo dicen «llegó» si salieron.

## Archivos

| Archivo | Qué es |
|---|---|
| `flujo.plantilla.json` | El flujo sin código y sin datos del negocio. Es lo que se edita |
| `src/lib/{comun,pedido,reserva,avisos,promos,cobro}.js` | Las seis librerías (prefijos `vm`, `pd`, `rs`, `av`, `pr`, `cb`) |
| `src/nodos/*.js` | El código de cada nodo Code |
| `construir.mjs` | Arma los JSON. `--verificar` no escribe y sale 1 si alguno difiere |
| `venta-minima.qtaco.json` | **Producción** de Q'Taco: entrada del receptor, sin «Entrada de prueba» |
| `venta-minima.prueba.json` | **Prueba**: «Entrada de prueba» en lugar de la cadena del receptor |
| `admin/scripts/datos/venta-minima/qtaco.json` | Datos del tenant: credenciales por nombre, receptor y `configBase`, solo con marcadores `REEMPLAZAR_*` |
| `admin/scripts/datos/venta-minima/ensayo.json` | Datos del ensayo: hereda de `qtaco.json`, con `entrada: "prueba"` |
| `admin/pruebas/venta-minima-flujo.test.ts` | La suite de punta a punta: corre el JSON armado con el n8n de mentira contra las librerías reales |

Para cambiar el flujo: editar la plantilla, un nodo de `src/nodos/` o una librería; correr
`node Flujos/experimental/venta-minima/construir.mjs`; luego, desde `admin/`,
`pnpm -s vitest run --project puras pruebas/venta-minima-flujo.test.ts`. Para ver una conversación:
`VM_VER=1 pnpm -s vitest run --project puras pruebas/venta-minima-flujo.test.ts -t <nombre>`.

## Cómo se arma

- Cada Code lleva `"jsCode": "@@nodos/<archivo>.js"` en la plantilla. `construir.mjs` pega delante del código
  del nodo las seis librerías, **en este orden**: `comun, pedido, reserva, avisos, promos, cobro`.
  `@@comun:` pone solo `comun.js` y `@@solo:` solo el nodo (el Code de n8n no tiene módulos).
- `@@dato:a.b.c@@` toma un dato del tenant (ruta del receptor, URL del verificador, WABA) y `@@cred:ingesta|graph|medios`
  el nombre de la credencial. `Config base` se llena entera con `configBase`.
- **Una salida por archivo de datos**: `qtaco.json` → `venta-minima.qtaco.json`; `ensayo.json` → `venta-minima.prueba.json`.
  Un tenant nuevo es un archivo nuevo en `datos/venta-minima/`, nunca código.
- Guardias de producción (`--verificar` falla con código 1): el JSON de producción **no puede** traer
  «Entrada de prueba» (es el único nodo que activa `modoPrueba`) ni un «WhatsApp Trigger» con la entrada del
  receptor (prohibición 7).

## El grafo (51 nodos en producción de Q'Taco; 46 en la prueba)

```
Entrega del receptor → Verificar firma con el receptor → ¿Firma válida? ─sí→ Aceptar (200) → Descartar repetidos ─┐
                                                                         └no→ Rechazar (401)                    │
Entrada de prueba (solo en el JSON de prueba) ─────────────────────────────────────────────────────────────────┤
                                                                                                                ▼
Carga de entrada → Config base → ¿Es un mensaje? → Traer configuración → Config del negocio → Interpretar entrada
  → ¿Reportar? (entrante) → Reportar mensaje (entrante) → ¿Comercio operativo? ─no→ Comercio no operativo ─┐
                                                                    └sí→ ¿Atención normal? ─no→ Uso extendido ─┤
     ¿Bajar medio? → Obtener URL → ¿Tamaño aceptable? → Descargar medio → ¿Es audio? → Transcribir audio ─┐      │
        (comprobante) ¿Es PDF? → Leer comprobante (PDF | imagen) → Interpretar lectura → Cotejar ─────────┤      │
  Decidir turno → ¿Extraer? → Extraer → Plan del turno → Armar avisos ◄────────────────────────────────────┴──────┘
  Armar avisos → ¿Hay avisos? → ¿Avisar de verdad? → Enviar aviso → Reunir avisos → ¿Falló el aviso? → Aviso de respaldo
                                      └no→ Simular aviso                                      └→ Armar mensajes
  Armar mensajes ─→ ¿Enviar de verdad? → Enviar a WhatsApp → ¿Falló el envío? → Enviar respaldo → ¿Reportar? (saliente) → Reportar mensaje (saliente)
                 └→ ¿Registrar cierre? → Registrar cierre → Resumen del turno
```

`Reportar mensaje (entrante)` va **arriba** de `Decidir turno` en el lienzo (la suite lo verifica por posición y
por orden de ejecución). Los envíos al cliente van arriba del cierre, que cuelga de `Armar mensajes` por debajo.

## En qué se aparta del plano (y por qué)

1. **`Config base` va antes de `¿Es un mensaje?`.** El plano pide que ese IF mire `phone_number_id` esperado, que
   vive en `Config base`; un IF no puede leer un nodo que todavía no corrió. Así lo de otro número de la misma
   WABA y los acuses de estado se descartan **antes** de llamar a la consola.
2. **Tres nodos más que el §4.4:** `Reunir avisos`, `¿Avisar de verdad?` y `Simular aviso`.
   - `Reunir avisos`: con `executionOrder: v1` un nodo con dos ramas de entrada corre dos veces. Si `¿Falló el aviso?`
     repartiera los avisos de a uno, `Armar mensajes` correría dos veces y el cliente recibiría su respuesta duplicada.
     `Reunir avisos` deja una sola decisión: o sale un ítem por cada aviso caído **con respaldo**, o sale uno
     `{sinRespaldos: true}`. Las ramas de «Hay avisos / no hay» y «cayó / no cayó» son excluyentes, y la suite
     comprueba que `Decidir turno`, `Plan del turno`, `Armar avisos` y `Armar mensajes` corren **una sola vez** por turno
     en más de 30 escenarios.
   - `¿Avisar de verdad?` y `Simular aviso`: en modo prueba sin `enviarDeVerdad` no se manda nada, y sin un `wamid`
     el cliente de la prueba leería «No pude pasarle…». `Simular aviso` da un `wamid` marcado `SIMULADO-n`.
     **Cambio en un archivo ajeno (una línea):** `armar-mensajes.js` lee también `vmTodos('Simular aviso')` junto
     a `Enviar aviso`. Sin esa línea el ensayo no recorre el camino de producción.
3. **El cierre cuelga de `Armar mensajes` en paralelo** con el envío (el plano no fija dónde), por debajo del
   lienzo. Nunca se registra en modo prueba. `Resumen del turno` es el último nodo y el que responde la prueba.
4. **Solo se reporta lo que Meta aceptó** (`¿Reportar? (saliente)` mira el `id` de la respuesta): un QR que Meta
   rechazó no abre el cobro en el servidor.
5. **Plantillas por evento, no una sola.** El plano (DD9) proponía `purchase_transaction_alert` para todo;
   `avisos.js` trae plantillas por evento y configurables. En `qtaco.json`: `plantillaPedido: pedido_registrado`,
   `plantillaReserva: appointment_confirmed`, `plantillaDerivacion: appointment_confirmed` y sus idiomas (`es`,
   a confirmar). Nombre, idioma y orden son **datos**, no código. Sin nombre configurado no se inventa uno.
6. **Entrada del receptor sin «Raw Body».** El pedido de armado decía «Raw Body activado»; la referencia del
   receptor, probada en vivo el 28/09, no lo usa: el Webhook va con `options: {}` y el verificador recibe
   `JSON.stringify($json.body)`. Activar «Raw Body» mueve la carga a un binario y deja sin probar `$json.body`
   (de donde sale `body.value`). Si el receptor exigiera los bytes exactos, se decide en el ensayo (T11).

## La entrada del receptor (camino B)

`Entrega del receptor` (Webhook POST, `responseMode: responseNode`, ruta marcador) → `Verificar firma con el
receptor` (HTTP interno, **sin** «Continue on Fail», `onError` ni reintentos; `wabaIdEsperado` fijo como marcador;
cuerpo con `JSON.stringify`) → `¿Firma válida?` → `Aceptar (200)` | `Rechazar (401)` → `Descartar repetidos`
(`removeItemsSeenInPreviousExecutions` por `deliveryId`). Después, `Interpretar entrada` descarta además los
repetidos por `wamid` de Meta y los números de otro prefijo. **Ningún WhatsApp Trigger** (prohibición 7). El
verificador solo se llama por la red interna. Ruta y URL van como `REEMPLAZAR_*`.

## Mensajes por conversación (declarados y medidos en la suite)

Es un flujo nuevo: no agrega ni quita mensajes a ningún otro cliente. Lo que cuesta cada conversación de Q'Taco:

| Conversación | Al cliente | Al restaurante (ventanas cerradas) | Al restaurante (ventanas abiertas) |
|---|---|---|---|
| Pedido con QR (menú, carta, resumen, QR, comprobante) | 5 | 2 plantillas | 5 (2 plantillas, 2 detalles y la imagen del comprobante para `completo`) |
| Pedido sin QR, plan B (menú, carta, resumen, pase) | 4 | 2 | 4 |
| Reserva (menú, datos, resumen, enviada) | 4 | 2 | 4 |
| Promoción | 1 (ficha con 3 botones) | 0 | 0 |
| Derivación | 1 | 2 plantillas | 2 (texto libre en lugar de la plantilla) |

Cada mensaje aclaratorio (producto no encontrado, orden o sueltos, datos del delivery) suma uno al cliente. No
cuestan nada: repetidos, números fuera del prefijo, acuses de estado, reacciones y stickers.

## Lo que falta para publicar (pendientes de la persona)

- **Credenciales en n8n** (id vacío en el JSON): «NovuChat ingesta (Q'Taco)», «Graph WhatsApp Q'Taco (Bearer)» (con un
  token que tenga la WABA del número de Q'Taco), «WhatsApp Q'Taco (envío)» y la de Gemini (se resuelve al publicar).
- **Marcadores** en `CONFIGURACION.local.md`: ruta del receptor, URL del verificador, WABA, phone number id, número de
  recepción, los dos números de aviso, dirección, horario de atención y **horario de pedidos** (formato
  `lun=12:00-22:00,…,dom=cerrado`; sin él no se bloquea ningún pedido y las reservas se derivan).
- **Plantillas**: confirmar nombre, idioma, categoría y las cuatro variables de `pedido_registrado` y
  `appointment_confirmed` en Meta (T9). `appointment_confirmed` tiene el encabezado fijo «Cita confirmada»: para una
  solicitud de reserva es la decisión P2 pendiente.
- **Consola de Q'Taco**: `catalogoWebActivo` en `false` (con más de 40 ítems la ingesta manda `catalogo: []` y el flujo
  deriva todo pedido), carta, campañas y QR; `numeroRecepcion` y `venta.aceptaDelivery`/`aceptaRetiroEnLocal`.
- **Retención de ejecuciones (P6)**: la plantilla guarda errores y no éxitos; confirmar con Andres.
- Importar con `./scripts/preparar-import.sh Flujos/experimental/venta-minima/venta-minima.qtaco.json .env.qtaco`
  (el patrón de marcadores corta en comillas, barras y espacios: **no pegar dos marcadores con una coma**; la suite lo
  verifica) y **Publish**, con la ventana de mantenimiento y el «sí» de Andres.
