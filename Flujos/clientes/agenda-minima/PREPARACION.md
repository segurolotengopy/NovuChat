# Agenda mínima v0: preparación

Lo escribió la sesión constructora el 30/09/2026, para quien construye el
flujo (Antigravity). Tiene **solo nombres**: ningún valor, token ni
identificador. Los identificadores van como marcadores `REEMPLAZAR_*` en el
JSON exportado ([R8] del prompt).

> **ESTADO: NO EMPEZAR TODAVÍA.** El comercio `ensayo` todavía no está cargado
> con la configuración de Bellido, y falta confirmar que Gemini responde. La
> sesión constructora cambia esta línea cuando las dos cosas estén listas.

## 1. Credenciales que puedes usar: solo las del Demo A [R1]

Son los nombres tal como están en n8n. Se leyeron del flujo vivo del Demo A
con `scripts/credenciales-flujo.sh`, que nunca muestra valores.

| Para qué | Nombre en n8n | Tipo |
|---|---|---|
| Configuración, ingesta y cierres (`configuracionFlujo`, `ingesta`, `registrarCierre`), por cabecera | **Cierres NovuChat A (auto)** | Header Auth |
| Enviar texto con el nodo WhatsApp | **WhatsApp account** | WhatsApp API |
| Enviar interactivos, contactos, ubicación y plantillas con `HTTP Request` a la Graph API | **WhatsApp account**, como *Predefined Credential Type* → WhatsApp API. Es lo mismo que usan «Enviar ubicación» y «Enviar contacto» del Demo A | WhatsApp API |
| Calendario (`freebusy`, crear, leer y borrar eventos) | **Google Calendar account** | Google Calendar OAuth2 |
| Gemini (extracción, redacción y transcripción de audio) | **Google Gemini(PaLM) Api account** | Google Gemini (PaLM) API |

- **Graph Bearer:** el Demo A **no tiene** una credencial «Graph WhatsApp …
  (Bearer)». No la crees. Usa «WhatsApp account» como credencial predefinida
  en el `HTTP Request`.
- **Disparador:** el Demo A usa «WhatsApp OAuth account». Si pones un
  WhatsApp Trigger en tu flujo, el flujo **no se activa nunca** [R3].
  Pruebas con ejecución manual y *pinned data*.
- **Prohibido:** cualquier credencial que diga Bellido, Platinum, Q'Taco,
  NovuChat-Asistente o captación, o que sea de WhatsApp-Modular, SeguroLoTengo,
  OTP o AAB1.

## 2. Calendario de prueba

- En el ensayo, `calendarioId` apunta al **primer calendario del Demo A**
  (`REEMPLAZAR_CALENDARIO_ENSAYO_1`), no al de Bellido.
- En el JSON exportado va el marcador `REEMPLAZAR_CALENDARIO_ENSAYO_1`, nunca
  el identificador.
- Los 8 eventos del caso 7 (día lleno) y el evento a mano del caso 13 (cruce)
  se crean **solo** en ese calendario, y se borran al terminar.

## 3. Quién recibe los avisos

- `numeroRecepcion` y `numeroDoctor` del comercio `ensayo` son **el teléfono
  de quien prueba**, hoy Andres (marcador `REEMPLAZAR_NUMERO_RECEPCION_ENSAYO`).
- Si `configuracionFlujo` devuelve cualquier otro número, te detienes y lo
  anotas en `PRUEBAS.md` [R2].
- El número del Demo A es un número de prueba de Meta: solo entrega a los
  destinatarios registrados.

## 4. Plantilla para avisar al doctor: NO hay una aprobada

En la WABA del Demo A hay 7 plantillas aprobadas (`scripts/listar-plantillas.sh`,
30/09):
- `hello_world`;
- cuatro de ejemplo de Meta (`jaspers_market_*`);
- `requerimiento`, que es de marketing;
- `recordatorio_cita_manana` (utilidad, 3 variables), que es para recordar
  la cita al paciente, no para avisar al doctor.

Ninguna sirve para el aviso de emergencia. Mientras no haya una:
- el nodo de la plantilla usa el nombre marcador `REEMPLAZAR_PLANTILLA_AVISO_DOCTOR`,
  va a fallar, y se prueba **su caída a texto** (§3 del prompt);
- el texto libre solo llega si el teléfono de quien prueba le escribió al
  Demo A en las últimas 24 horas. En el caso 2 se prueba así;
- crear la plantilla es una escritura en Meta, en una WABA **compartida** con
  WhatsApp-Modular, y la decide Andres. No la crees tú.

## 5. La app de Meta del Demo A no es la de AAB1 (prohibición 7)

- `CONFIGURACION.md` §1 dice que la app es **`NovuChat-Demo-A`**. Las apps
  suscritas a su WABA son esa, la de demostración de WhatsApp-Modular (ajena,
  no se toca) y la app 1P de Meta.
- `scripts/verificar-meta.sh` (30/09) dio 4/4: el token del Demo A es de esa
  app, la WABA le entrega, el número responde y el webhook de n8n contesta.
- No hay ningún nodo ni llamada a `/subscriptions` en este trabajo. Tampoco
  se activa ningún disparador.

## 6. Ventana del ensayo

El número del Demo A se turna. Primero va el ensayo del PR #286 de Bellido,
porque es el arreglo de un cliente real, y después Agenda mínima, en la
ventana que autorice Andres. Mientras dura, **el Demo A no sirve para una
demo comercial**.
