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
