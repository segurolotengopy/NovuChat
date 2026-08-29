# 02 — Criterios de implementación para los demos de NovuChat

> Los criterios están ordenados por bloque: **A** canal y cumplimiento,
> **B** arquitectura n8n, **C** costos y calidad conversacional,
> **D** seguridad y operación. Cada uno indica si aplica al **demo**, a
> **producción**, o a ambos. Los marcados ⛔ son bloqueantes: sin ellos el
> demo puede fallar en vivo.

---

## A · Canal de WhatsApp y cumplimiento

**A-1 ⛔ Canal oficial únicamente (demo y producción).**
El canal es la **Meta WhatsApp Cloud API con número de prueba** (decisión
28/08). No se usa Evolution API, Baileys, WPPConnect ni ningún canal de
"dispositivo vinculado", tampoco "solo para el demo": el laboratorio propio
demostró que fallan sin avisar (18/08: mensajes aceptados que nunca llegaban)
y el baneo del número es esperable. Un demo comercial no tiene segunda
oportunidad. Referencia: `WhatsApp-Modular/docs/13-laboratorio-evolution.md`.

**A-2 ⛔ App de Meta dedicada para NovuChat (demo).**
Cada app de Meta admite **una sola URL de webhook**. La app existente
("Demo SeguroLo Tengo") tiene su webhook al servicio de OTP de
WhatsApp-Modular; apuntarla al n8n rompería la Fase 0 de ese proyecto.
Crear una **app nueva** (p. ej. `NovuChat-Demo`) con su propia WABA de prueba
y su número de prueba (+1), y apuntar su webhook a
`${N8N_BASE_URL}${N8N_WEBHOOK_PATH}`. El procedimiento por bloques
de `WhatsApp-Modular/docs/12-guia-operativa-meta.md` (Bloques 1, 2 y 5) aplica
idéntico; el token debe ser el **permanente de usuario de sistema** (Bloque
5), nunca el temporal de 24 h — un token vencido a mitad de demo es una falla
clásica.

**A-3 ⛔ Registrar los destinatarios del demo con anticipación (demo).**
El número de prueba solo entrega a **5 números verificados**. Antes del 9/09:
registrar los celulares de Andres, Silvana y los 2–3 que se usarán con el
público (o pedir el celular de un voluntario al inicio y verificarlo en vivo
tiene riesgo; mejor llevar los números propios ya registrados y prestar un
celular al público).

**A-4 Ventana de servicio de 24 h (ambos).**
Todo el guion del demo es iniciado por el cliente, así que corre dentro de la
ventana de servicio: texto libre permitido y sin costo. Lo que **no** se puede
hacer en vivo es iniciar conversación en frío ni recordatorios "24 h antes":
eso exige plantilla aprobada, y las plantillas están condicionadas por la
Business Verification de AAB1 (enviada 27/08, pendiente). Los recordatorios se
muestran como roadmap o simulados en el Simulador.

**A-5 Transparencia del asistente (ambos).**
Retirar la regla "nunca reveles que eres una IA". El asistente se presenta
como asistente virtual y no niega ser una IA si le preguntan. Coherente con el
pitch ("IA real"), con las políticas de Meta y de los proveedores de LLM, y
con la confianza del cliente final.

**A-6 Opt-out (BAJA) como obligación (producción; gesto en el demo).**
La política de privacidad publicada de AAB1 promete que respondiendo BAJA se
deja de recibir mensajes. Ese compromiso aplica a cualquier flujo que use ese
portafolio: la baja debe persistir **fuera de la sesión** (tabla en Postgres o
Sheets, nunca solo en la memoria de la conversación) y silenciar todo mensaje
posterior. En el demo basta manejarlo con dignidad si alguien lo escribe;
en producción es requisito de salida. Referencia: `reservas-bot/CLAUDE.md`.

---

## B · Arquitectura del flujo en n8n

**B-1 ⛔ Memoria por conversación con clave explícita (ambos).**
En todo nodo de memoria, *Session Key* en modo personalizado con el número de
origen (`messages[0].from`). Sin esto, dos personas escribiendo al bot
comparten memoria (defecto presente en los tres borradores JSON). Demo:
*Window Buffer Memory* con k=10. Producción: **Postgres Chat Memory** contra
el `n8n-db` (PostgreSQL 16 + pgvector ya desplegado) — persistencia entre
reinicios sin servicios nuevos.

**B-2 ⛔ Filtro de eventos antes del agente (ambos).**
Nodo IF/Filter tras el WhatsApp Trigger que solo deja pasar payloads con
`messages` (descarta `statuses`: sent/delivered/read). Evita ejecuciones y
tokens desperdiciados y cualquier posibilidad de bucle. Es la Fase A de la
guía de Silvana; los borradores no la implementan.

**B-3 ⛔ Nodo de normalización de entrada (ambos).**
El nodo Code "parsear carrito/imágenes" del tercer borrador, generalizado a
los cuatro tipos: `text` (pasa tal cual), `interactive` (extrae la opción
elegida), `order` (lista los ítems con cantidades y precios en texto para el
agente), `image` (lo traduce a "el cliente envió una imagen, probablemente el
comprobante"), y **cualquier otro tipo** (audio, sticker, ubicación) con una
respuesta cortés de "por ahora atiendo por texto" en el demo. Nunca acceder a
`.text.body` sin pasar por aquí: es el crash más fácil de provocar desde el
público (mandar un sticker).

**B-4 Herramientas reales, no fingidas (demo A).**
El demo de agendamiento usa **Google Calendar real** como Tool del AI Agent:
una tool de consulta (Get Many sobre el calendario del negocio, acotada al
horario de atención) y una de creación (Create con título
"Cita <nombre> — <servicio>"). Preparar el calendario con eventos de relleno
para que "no haya" horarios en las primeras franjas y el público vea al agente
proponer alternativas reales. El esquema `gestionar_agenda_citas` de los
Preliminares es la referencia de parámetros; materializarlo como dos tools
separadas reduce la ambigüedad para el modelo.

**B-5 ⛔ Fecha, hora y zona horaria inyectadas (ambos).**
`GENERIC_TIMEZONE=America/La_Paz` en el `.env` del n8n y la fecha/hora actual
inyectada en el System Message (expresión con `$now`). Sin esto, "mañana en la
tarde" y "el viernes" se calculan mal y el demo de agendamiento pierde toda
credibilidad. Bolivia es UTC-4 fijo, sin horario de verano.

**B-6 Doble salida: cliente + dueño (demo B, ambos en producción).**
Conservar la bifurcación del tercer borrador: al confirmarse un pedido, el
cliente recibe la confirmación y el número del dueño recibe el resumen
estructurado del pedido (o se agrega fila en Google Sheets). En el demo es un
momento teatral fuerte: el celular "del negocio" suena en la mesa. El número
del dueño va en variable de entorno o credencial, nunca hardcodeado en el
flujo (los flujos se exportan a Git).

**B-7 Modelo de IA como sub-nodo intercambiable (ambos).**
Demos: sub-nodo **Google Gemini Chat Model** con credencial de Google AI
Studio (nivel gratuito suficiente), eligiendo el modelo *flash* de la
generación vigente (verificar la lista del nodo al construir; la familia
actual es Gemini 3.x). Producción: se cambia el sub-nodo por **Anthropic**
(Claude; Haiku 4.5 como punto de partida por costo, Sonnet si la calidad
conversacional lo pide) **sin tocar el resto del flujo** — esa es la razón de
usar AI Agent y no llamadas HTTP manuales. Temperatura 0.3–0.4 y tope de
tokens de salida en ambos casos.

**B-8 Un flujo por demo, plantillizado (ambos).**
La promesa de "despliegue en 48 h" del pitch se sostiene solo si por cliente
nuevo cambian únicamente: System Message (nombre del negocio, catálogo,
precios), calendario/hoja conectada, número del dueño y credenciales. Todo
eso debe vivir en la cabecera del flujo (Set node o variables), no disperso.

**B-9 Solo JavaScript en nodos Code (ambos).**
La imagen de n8n desplegada no incluye Python. Los nodos Code se escriben en
JavaScript. (Restricción documentada del despliegue de OCI.)

**B-10 Sin RAG para los demos (demo).**
La plantilla comunitaria 3081 (Qdrant + Drive) no se usa: para un menú o
catálogo de demo (≤ 50 ítems) el System Message o una hoja de Sheets basta.
Si producción llega a necesitar búsqueda semántica de catálogo, el camino es
pgvector en `n8n-db`, no un servicio nuevo.

---

## C · Costos y calidad conversacional

**C-11 Reglas de prompt heredadas de los Preliminares (ambos).**
Se conservan las reglas ya validadas por Silvana: nunca inventar precios ni
disponibilidad; máximo ~3 oraciones por mensaje; español boliviano con "Bs";
Belleza muestra precios, Salud no cotiza y deriva a evaluación; sin Nombre +
CI no hay QR para envío por flota; recálculo inmediato ante cambios de
opinión; y el **límite de 3 rechazos/iteraciones con transferencia a humano**.

**C-12 ⛔ El QR de cobro es un simulacro rotulado (demo).**
El QR que se muestre debe decir en su caption que es demostración y la
confirmación debe decir "pago verificado (simulado)". Nunca datos de un
comercio real, nunca confirmación que parezca real: es la lección estructural
de `reservas-bot` (`docs/16`) y protege la credibilidad ante el cliente. El
cobro real llega recién con webhook de acreditación bancaria (producción,
fuera de alcance actual).

**C-13 Control de consumo (producción; buen hábito en demo).**
Windowing de historial (k=10 en demo; 6 en producción según la guía), timeout
de sesión (30–60 min: pasado el silencio, la sesión se cierra y un mensaje
nuevo abre hilo limpio), tope de tokens de salida, y el filtro B-2. Con
conversaciones de servicio gratis en Meta y un modelo *flash/haiku*, el costo
variable por pedido queda en fracciones de centavo: los márgenes de los
planes (150/250/350 Bs) se protegen con estas cuatro palancas, no con el
precio del modelo.

**C-14 Criterios de aceptación = tablas de Silvana (demo).**
Las tablas Input/Output/Criterio de éxito de las dos ayudas memoria son la
suite de aceptación. El ensayo general recorre cada fila y algunos casos
hostiles (ver `03-plan-demos.md` §4). Un demo no se da por listo describiendo
que funciona: se da por listo cuando el checklist pasó completo en el
teléfono real.

---

## D · Seguridad y operación

**D-15 ⛔ Secretos solo en credenciales de n8n o `.env` (ambos).**
Token permanente de Meta, App Secret, API key de Gemini y OAuth de Google
viven en el almacén de credenciales de n8n (o el `.env` del contenedor, modo
600). Nunca en nodos, prompts, sticky notes ni en los JSON exportados a Git.
Antes de cada push del repo NovuChat, revisar el JSON exportado (la
exportación de n8n referencia credenciales por ID, pero los valores escritos
a mano en parámetros sí viajan).

**D-16 Verificación del webhook (ambos).**
Configurar el *verify token* del webhook y el App Secret en la credencial del
WhatsApp Trigger para que n8n valide la firma de Meta. La instancia ya está
correctamente cerrada (solo NPM publica 80/443; n8n sin puertos propios;
2FA activo): no abrir nada nuevo para esto.

**D-17 Propiedad de los flujos en n8n Community (ambos).**
La licencia Community **no comparte flujos entre usuarios**. Convención ya
anotada en el proyecto n8n-OCI: la cuenta propietaria (Andres) es dueña de
todo lo productivo/demo; la segunda cuenta (Silvana) desarrolla y se
transfiere por export/import JSON vía el repositorio Git. Decidir esto antes
del primer flujo evita rehacer trabajo.

**D-18 Respaldo y versionado (ambos).**
`respaldo-vm.sh` ya exporta los flujos a JSON a diario con subida a Object
Storage (incluida la `N8N_ENCRYPTION_KEY`, sin la cual las credenciales son
irrecuperables). Complemento manual: exportar los flujos del demo al repo
GitHub de NovuChat después de cada sesión de trabajo, para poder reconstruir
la instancia o compartir con Silvana.

**D-19 Recursos de la VM (ambos).**
2 OCPU ARM compartidos con Odoo, NPM y otp-service: nada de modelos locales
(la inferencia va por API, restricción ya documentada) y límites de memoria ya
fijados (n8n 1200 MB). Dos demos conversacionales no estresan la VM; si se
agrega transcripción de audio u OCR de comprobantes, medir antes de la fecha.

**D-20 No cruzar NovuChat con el servicio de OTP (ambos).**
`otp-service` (fase0, misma VM) es un sistema financiero en producción con
reglas duras propias. NovuChat no lo toca: ni su webhook, ni su número, ni su
app de Meta (ver A-2). Son productos distintos que solo comparten
infraestructura.
