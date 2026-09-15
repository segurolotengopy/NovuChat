# Flujos n8n de los demos NovuChat — guía de importación y puesta en marcha

> **Archivos:** `demo-a-agendamiento.json` (Belleza y Salud, con Google
> Calendar real) y `demo-b-venta-cobro.json` (Gastronomía y Retail, con QR
> simulado y alerta al dueño).
> **Destino:** n8n 2.36.5 en `${N8N_BASE_URL}`.
> **Referencia normativa:** `NovuChat/Analisis/02-criterios-implementacion.md`
> (los criterios citados en los sticky notes de cada flujo) y el cronograma de
> `03-plan-demos.md`.

Ambos flujos parten de los borradores de Silvana (`Preliminares/gemini-code-*`)
con todas las correcciones del análisis aplicadas: memoria con clave de sesión
por teléfono, filtro de acuses de estado, parser de tipos de mensaje, fecha y
hora de Bolivia inyectadas al prompt, Gemini como modelo (intercambiable por
Claude en producción), herramientas de Calendar reales, QR rotulado como
simulacro, marcas `[TRANSFERIR]` / `[ENVIAR_QR]` / `[PEDIDO_CONFIRMADO]` para
las bifurcaciones, y cero secretos dentro de los nodos.

---

## 0. Los JSON de esta carpeta son la única fuente de verdad

Hasta el 2026-08-28 existía un generador, `build_flows.py`, que producía
ambos JSON desde Python. **Se retiró.**

El motivo no es de estilo. `CLAUDE.md` ya define que la fuente de verdad son
los JSON versionados y que el ciclo real de trabajo es *editar en la interfaz
de n8n → exportar (⋯ → Download) → reemplazar el archivo*. Con esa definición,
el generador quedaba como una **segunda fuente de verdad que solo podía
divergir**: nadie edita Python después de tocar el lienzo de n8n.

Y ya había divergido con consecuencias. El generador seguía produciendo la
versión vieja del Demo B, mientras que `demo-b-venta-cobro.json` fue reescrito
a fondo: 18 nodos, la corrección del defecto de emparejamiento que enviaba la
respuesta de un cliente al teléfono de otro, la configuración del negocio
movida a 20 campos del nodo `Config del negocio`, y tres compuertas por código
que hacen cumplir la **prohibición 3** (cobro simulado siempre rotulado).
Correr el generador habría revertido todo eso **en silencio**, incluidas las
compuertas de seguridad.

Regla, entonces:

- Se edita en n8n y se exporta. No se genera.
- Antes de reemplazar el archivo, se sanea: los valores reales del nodo
  `Config del negocio` se cambian por sus marcadores `REEMPLAZAR_*`
  (ver `CONFIGURACION.local.md` §0.b para la correspondencia).
- `scripts/verificar-saneo.sh` bloquea el commit si un JSON de `Flujos/` queda
  sin ningún `REEMPLAZAR_`, que es la señal de un export sin sanear.

`Demo-Recursos/build_recursos.py` **sí se conserva**: genera artefactos
derivados (`calendario-demo-relleno.ics`, `qr-demo.png`) que nadie edita a
mano en otra herramienta, así que ahí el script es la fuente legítima.

---

## 1. Importar

En el editor de n8n: **Workflows → ⋯ → Import from File** (uno por archivo).
Importar con la cuenta propietaria (criterio D-17: en Community los flujos no
se comparten entre usuarios; Silvana trabaja sobre copias export/import vía el
repo Git).

## 2. Credenciales a crear (una sola vez)

| Credencial | Tipo en n8n | Se usa en | Valores |
|---|---|---|---|
| WhatsApp Trigger (app `NovuChat-Demo`) | WhatsApp Trigger API | Nodo trigger de ambos flujos | App Secret + Verify Token de la app **nueva y dedicada** (criterio A-2 — no reutilizar la app del OTP) |
| WhatsApp envío | WhatsApp API | Nodos "Responder…", "Avisar…", "Enviar QR" | **Token permanente de usuario de sistema** (Bloque 5 de `WhatsApp-Modular/docs/12`), nunca el temporal de 24 h |
| Google Gemini | Google Gemini (PaLM) API | Sub-nodo del modelo | API key de Google AI Studio; en el desplegable del nodo elegir el modelo **flash vigente** (el JSON trae `gemini-2.5-flash` como valor inicial: cambiarlo si el desplegable ofrece un flash más nuevo) |
| Google Calendar | Google Calendar OAuth2 | Tools del Demo A | OAuth2 de la cuenta que posee el calendario del demo |
| Header Auth para Graph API | Header Auth | Nodo "Lista interactiva de bienvenida" (Demo B) | Nombre `Authorization`, valor `Bearer <token permanente>` |

## 3. Completar el nodo `Config del negocio` de cada flujo

Es el único lugar donde se personaliza el flujo (criterio B-8). Campos con
prefijo `REEMPLAZAR_`:

- **Demo A:** `phoneNumberId` (el ID del número de prueba, no el número),
  `numeroRecepcion` (uno de los 5 registrados, sin `+`), `calendarioId`
  (calendario dedicado al demo), `horarioAtencion`.
- **Demo B:** `phoneNumberId`, `numeroDueno` (el celular que sonará "del
  negocio" en la mesa), `qrUrl` (URL pública de la imagen del QR de
  demostración — el rótulo 🧪 debe estar impreso **en la propia imagen**,
  además del caption) y `waGraphVersion` (confirmar la versión vigente del
  Graph API en el panel de Meta).

Los catálogos y precios de los prompts (System Message del agente) son de
demostración; se editan ahí mismo si Silvana quiere otros productos.

## 4. Conectar el webhook de Meta

En la app `NovuChat-Demo`: WhatsApp → Configuración → Webhooks → URL del
WhatsApp Trigger de n8n (el nodo la muestra al abrirlo; usar la URL de
producción, no la de test) + el Verify Token de la credencial → suscribirse a
`messages`. Con el flujo **activado**, mandar "Hola" desde un número
registrado.

**Nota:** una app de Meta tiene **una** URL de webhook. Para alternar entre
los dos demos hay dos caminos: (a) dos apps de Meta con dos números de prueba
(uno por demo — lo más limpio para presentar ambos el mismo día), o (b) una
sola app y activar un solo flujo a la vez en n8n (los dos triggers generan
URLs distintas, así que habría que cambiar la URL del webhook al alternar —
evitarlo en vivo). Recomendado: **(a)**.

## 5. Verificaciones antes del ensayo (suites del plan 03 §4)

1. Dos celulares conversando a la vez → cero cruce de memoria (criterio B-1).
2. Enviar un sticker y un audio → respuesta cortés, sin error de ejecución.
3. Demo A: pedir "mañana en la tarde" → los horarios propuestos existen de
   verdad como huecos del calendario y ninguno está en el pasado (criterio
   B-5; si fallara, revisar `GENERIC_TIMEZONE=America/La_Paz` en el `.env`
   del contenedor y la zona del calendario).
4. Demo A: rechazar horarios 3 veces → llega el aviso al número de recepción
   y el cliente recibe la despedida sin la marca `[TRANSFERIR]` visible.
5. Demo B: completar una venta → llega el QR con caption de demostración, la
   confirmación dice "simulado" y la alerta llega al celular del dueño.
6. Demo B retail: pedir envío a Oruro → el bot NO entrega QR sin Nombre + CI.
7. Exportar ambos flujos al repo Git de NovuChat después de cada sesión
   (criterio D-18) revisando que ningún valor `REEMPLAZAR_` haya sido
   sustituido por un secreto real dentro del JSON (criterio D-15 — tokens y
   claves viven solo en credenciales).

## 6. Notas de compatibilidad

- Los JSON usan los nodos estándar de n8n (WhatsApp Trigger, IF, Set, Code,
  AI Agent, Gemini, Window Buffer Memory, Google Calendar Tool, HTTP Request).
  Si al importar alguna versión de nodo aparece como desactualizada, n8n la
  migra al abrirla; revisar visualmente los parámetros marcados.
- En el nodo del modelo puede elegirse cualquier Gemini del desplegable sin
  tocar nada más; para producción se sustituye el sub-nodo por **Anthropic
  Chat Model** (Claude) — el resto del flujo no cambia (criterio B-7).
- El paso a memoria persistente (producción) es reemplazar "Memoria por
  teléfono" por **Postgres Chat Memory** contra `n8n-db`, manteniendo la
  misma clave de sesión (criterio B-1).
- Si el nodo WhatsApp diera problemas con la imagen del QR en el número de
  prueba, el fallback es replicar el patrón del nodo HTTP de la lista
  interactiva con `type: "image"` y `link` (contingencia 4 del plan 03).

---

## 7. Flujo de captación de NovuChat (`novuchat-onboarding.json`)

**El primer flujo de un cliente real en producción: el propio NovuChat**
(14/09/2026). Atiende el número de NovuChat, que no es de prueba. Especificación
de Silvana y decisiones de Andres en `CLIENTES/NOVUCHAT/` (carpeta local).

### Qué hace

1. **Compuerta inicial, sin modelo.** A un «hola» suelto le responde con dos
   botones: «Soy cliente actual» y «Soy cliente nuevo». Quien ya escribió lo que
   quiere («hola, ¿cuánto cuesta?») pasa directo al asistente.
2. **Cliente actual, sin modelo.** Un mensaje con el enlace a la consola, cómo
   recuperar la contraseña y un botón a una persona. **Sin código de acceso.**
3. **Cliente nuevo.** El asistente responde con la información del sitio y va
   registrando empresa, contacto, rubro, flujos de interés, personalización y
   NIT (marcas `[LEAD]…[/LEAD]`). Con los cuatro obligatorios, cierra (`[CIERRE]`):
   botón a un asesor y aviso interno con la plantilla `solicitud_contacto`.
4. **Topes.** En la respuesta 25 (fin del primer bloque, editable en la pestaña
   «Captación») ofrece un asesor con un botón y sigue. **El techo de costo es el
   del servidor**, igual que en A y B: al umbral de operador de la cuenta (50)
   responde un mensaje fijo y avisa; al de bloqueo (100) no responde nada. Los
   dos se obedecen antes de llamar al modelo.
5. **Idempotencia.** Un reenvío de Meta con el mismo id de mensaje no se
   responde dos veces.

**Mensajes que declara:** 1 por turno al cliente, siempre, en el único nodo
`Enviar a WhatsApp` (o su respaldo en texto si Meta rechaza el interactivo,
nunca los dos); ninguno con el teléfono bloqueado. Más **1 plantilla utility**
por prospecto cerrado y 1 por cada umbral que marca el servidor.

**Solo se da por hecho lo que Meta aceptó** (desde la aceptación del
15/09/2026). `Confirmar envío` es el hijo más bajo de `Salida` y corre último:
lee lo que contestó Meta y

- si rechazó el texto, o el interactivo **y** su respaldo, **termina la
  ejecución en error** con el código y el mensaje de Meta (sin el texto ni el
  teléfono del cliente): `./scripts/ver-ejecuciones.sh --env .env.novuchat --error`
  lo encuentra. Antes, un texto rechazado terminaba en «success»;
- reporta a la ingesta como saliente **solo lo que salió**. Antes el reporte
  colgaba de `¿Responder?` y un mensaje rechazado se contaba como respuesta;
- marca la bienvenida recién cuando salió. Antes se marcaba al decidirla, y un
  envío fallido dejaba a ese teléfono sin botones para siempre.

No agrega ni quita mensajes a Meta: no hace ninguna llamada.

### Credenciales (todas nuevas, propias de la app `NovuChat-Asistente`)

| Credencial | Tipo | Nodos |
|---|---|---|
| WhatsApp Trigger | WhatsApp Trigger API (App ID + App Secret de `NovuChat-Asistente`) | `WhatsApp Trigger` |
| Graph WhatsApp NovuChat (Bearer) | Header Auth: `Authorization` = `Bearer <token permanente>` | `Enviar a WhatsApp`, `Enviar texto de respaldo`, `Avisar a NovuChat` |
| NovuChat ingesta (alias del número) | Header Auth, el secreto del alias `clienteNN` | `Traer configuración`, `Reportar mensaje (entrante/saliente)` |
| CRM de prospectos (cabecera) | Header Auth | `Guardar prospecto` (solo si `crmUrl` no está vacío) |
| Google Gemini | la compartida | `Google Gemini Chat Model` |

### Importar

```bash
./scripts/preparar-import.sh Flujos/novuchat-onboarding.json .env.novuchat
```

**El segundo argumento es obligatorio para este flujo.** Sin él, el script toma
la ruta de webhook del Demo A y los dos flujos pelearían por la misma URL. Con
`.env.novuchat`, que todavía no tiene ruta, n8n crea una nueva.

Los marcadores de `Config base` (`REEMPLAZAR_PHONE_NUMBER_ID_NOVUCHAT`,
`REEMPLAZAR_NUMERO_RECEPCION_NOVUCHAT`, `REEMPLAZAR_HORARIO_ATENCION_NOVUCHAT`)
son el **respaldo** si la consola no contesta: los valores de verdad salen del
tenant `novuchat` en la consola. Después: `Trigger On` = Messages, credenciales,
**Publish**, y la URL de Production al webhook de la app `NovuChat-Asistente`.

### La base de conocimiento es una copia con alarma

El nodo `Conocimiento del sitio` lleva el corpus del RAG de novuchat.site con su
huella. `admin/pruebas/onboarding-flujo.test.ts` falla si el sitio regeneró su
índice y la huella ya no coincide. Para actualizarlo, se vuelve a copiar
`FRAGMENTOS`, `HUELLA` y `GENERADO` desde
`Novuchat-site/functions/src/rag/indice.json`. Se retira cuando el sitio exponga
la Function `conocimiento` (pedido en `CLIENTES/NOVUCHAT/02-pedido-sesion-sitio.md`).

### Límites conocidos

- La etapa y los datos del prospecto viven en los datos estáticos del flujo. n8n los guarda **solo en ejecuciones de
  producción**: probando desde el editor, cada ejecución arranca de cero.
- **El mensaje del cliente se reporta antes que la respuesta**: el nodo
  `Reportar mensaje (entrante)` está más arriba en el lienzo y el flujo corre con
  `executionOrder: v1`. Si se mueve debajo, el aviso de los umbrales no sale
  (defecto encontrado en el #66). Una prueba lo vigila.
- Si el panel no contesta, no hay estado de atención y el flujo atiende sin
  techo, igual que A y B: una caída del panel no deja sin respuesta a nadie.
- `crmUrl` vacío: el CRM todavía no existe. Los prospectos quedan en la consola
  (Conversaciones del tenant `novuchat`) y en el aviso interno.
