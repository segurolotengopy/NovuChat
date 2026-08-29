# 05 — Demo B (Venta y cobro): diseño cerrado y estado de construcción

> **Fecha:** 2026-08-28 · **Rubros:** Gastronomía y Retail
> **Flujo:** `Flujos/demo-b-venta-cobro.json`
> **Guía de trámites:** `GUIA-META-NOVUCHAT.md` (raíz, fuente única)

---

## 1. El bloqueo y cómo quedó resuelto

El Demo B estaba detenido por un problema de la plataforma, no del flujo: **el
número de prueba gratuito de la Cloud API es uno por portafolio comercial, no
por app**. Con las dos apps colgadas de la misma WABA, **cada mensaje entrante
dispara los dos flujos**: el cliente escribe "Hola" y le contestan Sofía y el
asistente de ventas a la vez. No se puede evitar desde n8n, porque la entrega
la decide Meta antes de llegar al webhook.

**Decisión de Andres (2026-08-28): opción (a)** — portafolio comercial nuevo →
segunda WABA → segundo número de prueba → dos flujos independientes.

La opción (b), unificar ambos demos en un flujo que enrute por vertical según
la opción del menú inicial, queda descartada. Se anota la razón para no
revisitarla: obliga a un solo prompt con dos catálogos, dos personalidades y
dos juegos de reglas de cobro, con memoria compartida por teléfono; es más
frágil de ensayar y no ahorra ningún trámite de Meta que no haya que hacer
igual para producción.

## 2. Arquitectura del flujo (18 nodos)

```
WhatsApp Trigger (app NovuChat-Demo-B, portafolio nuevo)
  └─ ¿Es un mensaje?            filtro: hay `messages` y no hay `statuses`
      └─ Config del negocio     ÚNICO nodo editable por cliente (20 campos)
          └─ Normalizar entrada  text · interactive · button · order · image ·
                                 document · audio · location · sticker · resto
              └─ ¿Saludo inicial?
                  ├─ sí → Lista interactiva de bienvenida (HTTP → Graph API)
                  └─ no → AI Agent NovuChat
                            ├─ Google Gemini Chat Model   (sub-nodo intercambiable)
                            └─ Memoria por teléfono       (sessionKey = messages[0].from)
                          └─ Procesar respuesta   ← compuerta de prohibiciones 3 y 4
                              ├─ Responder al cliente        (WhatsApp)
                              ├─ ¿Enviar QR? → Enviar QR (HTTP, media ID + caption)
                              └─ ¿Pedido confirmado? → Avisar al dueño (WhatsApp)
```

## 3. Cumplimiento de las reglas de diseño de CLAUDE.md

| Regla | Dónde se cumple | Estado |
|---|---|---|
| Clave de sesión explícita = número de origen | `Memoria por teléfono`, `sessionKey` = `messages[0].from` | ya estaba, se conserva |
| Filtro de eventos antes del agente | `¿Es un mensaje?` | **reforzado**: ahora exige además `statuses` vacío |
| Normalización de entrada | `Normalizar entrada` | **ampliada**: se agregaron `button`, `document`, `audio`/`voice` y `location`; `image` y `document` marcan `esComprobante` |
| Fecha, hora y zona en el prompt | `$now.setZone('America/La_Paz')` + `settings.timezone` | ya estaba, se conserva |
| Modelo como sub-nodo intercambiable | `Google Gemini Chat Model` → *Anthropic Chat Model* en producción, sin tocar nada más | ya estaba |
| Todo lo configurable en `Config del negocio` | 20 campos | **corregido**: el menú, el catálogo, los precios, el delivery, el recargo de flota, los tiempos, el horario, la moneda y los textos de rótulo estaban **incrustados en el System Message**. Ahora se leen por expresión |
| Nodos Code en JavaScript | los dos nodos Code | verificado, cero Python |

## 4. Prohibición 3 — el cobro es SIMULADO: tres compuertas

El diseño anterior confiaba en el prompt: si el modelo omitía la frase "Pago
verificado (simulado)", el cliente veía una confirmación de cobro que parecía
real. Un LLM puede omitirla por temperatura, por truncado de salida o en un
reintento. **Una prohibición dura no puede depender de la buena voluntad del
modelo.** Ahora está impuesta por código:

1. **La imagen** — `Demo-Recursos/qr-demo.png` lleva el rótulo impreso dentro
   de la imagen. Es lo único que el flujo no puede garantizar por sí solo: si
   alguna vez se reemplaza la imagen, la nueva tiene que llevar el rótulo.
2. **El epígrafe** — el nodo `Enviar QR` construye el cuerpo con
   `caption: $json.captionQr` de forma incondicional. No existe camino que
   envíe la imagen sin epígrafe.
3. **El texto** — `Procesar respuesta` inspecciona **cada** respuesta antes de
   que salga a WhatsApp, y agrega el rótulo cuando falta:
   - si va acompañada del QR y no dice "simulado";
   - si confirma el pedido y no dice "simulado";
   - **red de seguridad**: si afirma un cobro (*pago verificado / confirmado /
     acreditado*, *cobro realizado*, *ya recibimos la transferencia*, *el
     cobro es real*…) sin la palabra "simulado", en **cualquier** camino —
     incluido el de reintento, cuando el cliente manda el comprobante dos
     veces, o un mensaje suelto fuera de guion.
4. **La alerta al dueño** dice "DEMOSTRACIÓN · Cobro SIMULADO: no hay
   acreditación bancaria, no entró dinero".
5. La lista interactiva de bienvenida lleva el pie "Demostración NovuChat ·
   los cobros son simulados", así que el rótulo aparece en el primer mensaje.

El campo `avisos` de la salida registra qué compuerta actuó (`rotulo_qr`,
`rotulo_confirmacion`, `rotulo_generico`, `correccion_ia`). Si en el ensayo
`rotulo_generico` aparece seguido, hay que ajustar el prompt: significa que el
modelo se está yendo del guion.

## 5. Prohibición 4 — el agente no niega ser una IA

Regla explícita al inicio del System Message, **y** corrección por código: si
la respuesta niega ser un bot/robot/IA o afirma ser una persona, `Procesar
respuesta` la reescribe como "sí, soy un asistente virtual con inteligencia
artificial" antes de enviarla. La lista de bienvenida se presenta como
"asistente virtual (IA)".

## 6. Latencia (aprendizajes del Demo A, ya verificados ahí)

- `retryOnFail` en el sub-nodo del modelo: 3 intentos, 1 s entre ellos — por
  los 503 de Gemini en picos de demanda.
- `maxIterations` = 5 en el agente.
- `executionTimeout` = 60 s en `settings`.
- `maxOutputTokens` = 1024, `temperature` = 0.3.
- Reglas 13–15 del System Message: un solo paso de razonamiento por mensaje,
  sin repetir el pedido completo, una pregunta por vez, sin relleno.
- `retryOnFail` también en los cuatro nodos de salida, y `onError:
  continueRegularOutput` en `Avisar al dueño`: un número del dueño mal
  cargado ya no tumba la ejecución delante del cliente.

## 7. Otras correcciones de fondo

- **`Procesar respuesta` emparejaba mal los items.** Usaba
  `$('Normalizar entrada').first()` dentro de un bucle: con dos mensajes
  simultáneos, la respuesta del segundo cliente se enviaba al teléfono del
  primero. Ahora empareja por índice. Era un defecto del mismo tipo que la
  memoria compartida.
- **Los nodos de salida dependían de `$('Config del negocio').item`**, cuyo
  emparejamiento hacia atrás se rompe después de un nodo Code. Ahora la
  configuración viaja dentro del item y los nodos leen `$json`.
- **El QR pasó de nodo WhatsApp a HTTP Request contra el Graph API**, con el
  mismo patrón que la lista interactiva. Motivo: permite usar el **media ID**
  (`POST /{PHONE_NUMBER_ID}/media`, válido 30 días) en lugar de una URL
  pública, que era una dependencia externa innecesaria en plena demostración.
  Si `qrMediaId` queda vacío, cae automáticamente en `qrUrl`.
- **Marcas residuales**: se limpia cualquier `[MARCA]` que el modelo invente,
  no solo las dos conocidas, para que el cliente nunca vea corchetes.
- **Respuesta vacía**: si el modelo devuelve nada, se envía un texto de
  cortesía en lugar de fallar el nodo de WhatsApp.

## 8. Marcadores del flujo, para `CONFIGURACION.local.md`

Dentro del JSON los valores sensibles usan `REEMPLAZAR_*` (texto inerte:
`${...}` lo interpretaría n8n como expresión y fallaría al importar).

| Marcador en el JSON | Valor real que le corresponde |
|---|---|
| `REEMPLAZAR_PHONE_NUMBER_ID` | `PHONE_NUMBER_ID` del número de prueba **del Demo B** (`${WA_PHONE_ID_B}`) |
| `REEMPLAZAR_NUMERO_DUENO_SIN_+` | celular que hace de "dueño del negocio", solo dígitos; debe estar entre los 5 registrados (`${WA_TO_DUENO}`) |
| `REEMPLAZAR_MEDIA_ID_QR_DEMO` | media ID devuelto por `POST /{PHONE_NUMBER_ID}/media`, subido **con el número del Demo B** |

`qrUrl` queda vacío a propósito: solo se llena si se decide servir el QR
por URL pública en vez de por media ID.

## 9. Qué falta verificar contra un teléfono real

Nada de esto se da por bueno hasta probarlo (regla de CLAUDE.md: reportar el
resultado real, no el esperado).

1. **`Trigger On` del WhatsApp Trigger**: llega vacío al importar. Seleccionar
   *Messages* a mano.
2. **El agente sin herramientas**: el Demo B no tiene ninguna. Si esta versión
   de n8n exige al menos una para el *Tools Agent*, hay que sustituir el nodo
   por un *Basic LLM Chain* con la misma memoria. Es el único riesgo de
   importación que no se puede descartar leyendo el JSON.
3. **La lista interactiva** desde el número de prueba (algunas cuentas de
   prueba limitan los mensajes interactivos). Fallback: menú numerado en
   texto; el parser ya entiende ambos.
4. **El carrito nativo (`order`)** solo funciona si la WABA tiene catálogo.
   Sin catálogo el pedido entra por lista + texto y el flujo funciona igual.
5. **Dos celulares a la vez**: cero cruce de memoria.
6. **El camino de reintento del comprobante**: mandar la foto dos veces y
   confirmar que las dos confirmaciones dicen "simulado".
7. **Escribir al Demo A con el B publicado**: debe responder solo Sofía.

## 10. Orden de los trámites de Meta y ruta crítica

| # | Trámite | Depende de | Duración | Bloqueante |
|---|---|---|---|---|
| 1 | Portafolio comercial nuevo | — | 15 min + confirmación de correo | sí |
| 2 | App `NovuChat-Demo-B` en el portafolio nuevo | 1 | 15 min | sí |
| 3 | Producto WhatsApp → WABA y número de prueba | 2 | 15 min | sí |
| 4 | Publicar la app en **Live** | 2 | 15 min (necesita URL de privacidad) | sí |
| 5 | Registrar los 5 destinatarios | 3 | 20 min, con los teléfonos a mano | sí |
| 6 | Token permanente del usuario de sistema | 1, 2, 3 | 20 min | sí |
| 7 | `subscribed_apps` **por API** | 3, 6 | 10 min | sí |
| 8 | Credenciales y `Config del negocio` en n8n | 2, 3, 6 | 30 min | sí |
| 9 | Webhook en verde + flujo publicado | 4, 8 | 15 min | sí |
| 10 | Subir el QR y pegar el media ID | 3, 6 | 10 min | sí |
| 11 | Prueba de humo | todo | 20 min | sí |

Ninguno de los once espera aprobación de Meta. La **Business Verification no
hace falta** para el número de prueba, así que no hay ningún tiempo de espera
de terceros en la ruta crítica: es trabajo de Andres, unas 3 horas efectivas.

**Los pasos 4 y 7 son los que no se ven.** Los dos fallan en silencio: la app
en modo Desarrollo y la WABA sin `subscribed_apps` producen exactamente el
mismo síntoma que un webhook mal puesto —"no entra nada a n8n"— y no aparecen
en ninguna pantalla de diagnóstico.
