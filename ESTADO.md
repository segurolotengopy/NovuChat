# ESTADO — bitácora del proyecto NovuChat

> Se actualiza al final de cada sesión y antes de cualquier pausa. Al retomar,
> leer esto primero. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos.

**Última actualización:** 2026-08-28 (sesión de tarde/noche)

---

## Dónde estamos

**Demo A (Agendamiento — Belleza y Salud): REIMPORTADO, PUBLICADO Y MEDIDO
POR PRIMERA VEZ.**

- Canal verificado de punta a punta con `scripts/verificar-meta.sh`: las cuatro
  comprobaciones en verde (token de la app correcta, WABA suscrita, número
  responde, webhook devuelve 200).
- **Primera medición real, 2026-08-29 01:24, ejecución #14:** un saludo
  ("hola") resolvió en **7,958 s**, con **una sola ejecución** y **cero
  llamadas a `consultar_disponibilidad`**. La corrección del prompt funciona:
  el agente ya no consulta el calendario para saludar.
- **Pero el número es una advertencia, no una victoria.** Un saludo es el
  turno más barato posible: una sola llamada al modelo, sin herramientas. Si
  el caso más simple tarda 8 s, el turno que sí necesita el calendario va a
  estar peor. Queda por medir el turno de agendamiento, que es el que llegó a
  48 s.
- El flujo viejo quedó despublicado y renombrado como VIEJO: es la vuelta
  atrás.
- El archivo que se importa es `Flujos/demo-a-agendamiento.local.json`, con el
  `webhookId` fijado en la ruta que Meta ya tiene registrada. **No se versiona**
  (`*.local.json` está en `.gitignore`) porque esa ruta es sensible. El JSON
  versionado no trae `webhookId` a propósito.

**Tercera tanda (2026-08-29, 08:04 a 08:06) — LATENCIA CERRADA.**

Con saldo prepago cargado y `models/gemini-3.5-flash`:

| Ejecución | Tiempo |
|---|---|
| hola | 2,873 s |
| quiero saber los servicios | 2,765 s |
| si, para corte | 3,806 s |
| y para mañana? | 3,846 s |
| lunes a las 11 por favor | 5,338 s |

**p50 ≈ 3,8 s · peor caso 5,34 s.** El criterio era p50 ≤ 6 s, p90 ≤ 10 s y
peor caso ≤ 15 s: se cumple con holgura. La conversación completa de
agendamiento —catálogo con precios de belleza, especialidades dentales **sin**
precios, horarios del sábado, domingo cerrado, lunes 31 con tres opciones
exactas, y cita confirmada— funcionó de punta a punta.

**Dos defectos encontrados en `Procesar respuesta` del Demo A, ya corregidos
en el JSON (falta reimportar en n8n):**

1. **Mensaje vacío → 400.** Si el modelo devuelve una respuesta vacía —lo que
   pasó con el "gracias" final del cliente— `textBody` quedaba en `''` y el
   nodo de WhatsApp fallaba con *Bad request*. Ahora, ante respuesta vacía, se
   envía `mensajeCierre`, campo nuevo del nodo `Config del negocio`.
2. **`$('Normalizar entrada').first()` dentro del bucle.** El mismo defecto de
   emparejamiento que se había corregido en el Demo B: con dos mensajes
   simultáneos, **la respuesta de un cliente salía al teléfono de otro**. Ahora
   empareja por índice. No se había detectado antes porque ese archivo lo
   revisó el agente de latencia, que miraba tiempos y no correctitud.

**CAUSA RAÍZ CERRADA Y VERIFICADA (2026-08-29, 09:31).** El ID del calendario
tenía 89 caracteres en vez de 90: le faltaba el primer carácter. Corregido en
la tabla de marcadores y empujado a la instancia con
`scripts/publicar-flujo.sh --aplicar`.

Prueba de aceptación superada, con evidencia:

- El agente **leyó el calendario real**: reconoció por su cuenta la cita de
  Corte de las 15:30 sin que se la mencionaran.
- **Se negó a agendar sobre un horario ocupado** cuando se le pidió las 15:30,
  y ofreció alternativas reales.
- **Creó la cita**: "Ortodoncia 17:00–18:00" existe en Google Calendar.
- Tiempos de 3,7 a 7,9 s, dentro del criterio.

Esto invalida las pruebas de disponibilidad anteriores a la corrección: hasta
entonces el agente **inventaba** los horarios. La evidencia era que había
ofrecido las 15:00 del 29 pisando la cita de las 15:30.

**COMPUERTA DE VERIFICACIÓN DE RESERVA — construida, sin publicar.** El flujo
pasó de 15 a 18 nodos. Si la respuesta afirma que la cita quedó agendada, se
consulta el calendario y se comprueba que exista un evento creado en los
últimos 5 minutos; si no existe, **no sale esa respuesta**: sale una disculpa
honesta y se deriva a recepción.

- La detección de "afirma que agendó" vive en `Procesar respuesta`, en código,
  no en una expresión del nodo IF, para poder probarla. La trampa que encontró
  la prueba: *"ya tiene reservada su cita"* no es una confirmación nueva sino
  un aviso de horario ocupado, y disparar ahí rompería una conversación
  correcta. 9 de 9 casos, con las frases reales del agente.
- Falla del lado seguro: si el nodo de Calendar falla, la compuerta cierra.
- **Limitación documentada:** la comprobación es por *recencia* (algún evento
  creado en los últimos 5 minutos), no por coincidencia de cliente. Con varias
  reservas simultáneas podría dar un falso positivo. Revisar antes del segundo
  cliente real, junto con la migración del rol `ingesta`.
- **PUBLICADA el 2026-08-29 09:53** (HTTP 200, 18 nodos, flujo activo). No
  requirió ningún paso manual.

**DEMO A VALIDADO DE PUNTA A PUNTA (2026-08-29, 11:11 a 11:13).** Con el flujo
repuesto en 16 nodos y la compuerta publicada:

- **Lectura real de la agenda, comprobada por omisión:** para el lunes 31
  ofreció 09:30, 14:00 y 16:30, y evitó las 11:00, donde ya había un Corte
  creado en una conversación anterior. Nadie se lo dijo.
- Para el sábado ofreció 12:30, 14:00 y 18:00 sin pisar las citas de 15:30 y
  17:00.
- **Reserva creada y verificada en Calendar:** lunes 31 de agosto, 14:00,
  Limpieza facial.
- **La compuerta no estorbó:** la confirmación salió normal, con el evento
  existente.
- Tiempos de 1,6 a 5,6 s, dentro del criterio (p50 ≤ 6 s, p90 ≤ 10 s).
- Catálogo con precios de belleza y precio unitario correcto al preguntar por
  un servicio suelto.

**Pendiente de pulido para el guion (no es defecto):** el agente alterna el
registro entre "usted" y "tú" con el mismo cliente y el mismo negocio —"con
mucho gusto le ayudo, don Andrés" a las 09:56 y "qué gusto saludarte, tu cita"
a las 11:11—. En una demostración comercial la inconsistencia se nota. Conviene
fijar el tratamiento en el `systemMessage` y que lo decida Silvana según el
rubro.

**Hallazgo 15 — "Copy to editor" sobre una ejecución vieja REVIERTE el flujo,
en silencio.** El 2026-08-29 la instancia volvió sola al estado de las 08:55:
reaparecieron el ID de calendario de 89 caracteres y el código viejo de
`Procesar respuesta`, y desaparecieron los tres nodos de la compuerta. Los
síntomas que se ven son otros —"agendar_cita está mal", "hay un error de
hora"— y no apuntan a la causa: con el ID roto Google devuelve 404 y el agente
vuelve a inventar la disponibilidad.

El botón está arriba a la derecha en la vista de una ejecución y carga en el
lienzo el flujo **tal como estaba en ese momento**. Guardar después pisa todo
lo posterior. Antes del 8 de septiembre, no usarlo; y si se usa, correr
`./scripts/publicar-flujo.sh` para ver qué se perdió.

**Sticky notes retirados del flujo del Demo A** por decisión de Andres
(2026-08-29). Se quitaron también del JSON versionado para que un `--aplicar`
no los reintroduzca. El flujo pasó de 18 a 16 nodos.

**Hallazgo 14 — n8n no publica un flujo con un nodo sin credencial, y eso
crea un círculo.** El primer intento devolvió *400 Cannot publish workflow*.
Peor: el PUT **escribió los nodos igual** y solo falló la publicación, así que
la instancia quedó con el nodo nuevo sin credencial y sin forma de salir por
la API. Se resolvió haciendo que `publicar-flujo.sh` **herede la credencial
por TIPO**: el JSON declara `googleCalendarOAuth2Api` con id vacío y el script
lo completa desde otra credencial ya conectada del mismo tipo. Vale para
cualquier nodo con la referencia vacía, exista o no en la instancia.

**Facturación de Gemini: resuelta.** La cuenta es de prepago; vincularla no
alcanza, hay que cargar saldo. Presupuesto de alerta en 20 USD acotado a los
dos proyectos de NovuChat.

---|---|---|
| 01:24 | hola | 7,958 s |
| 01:33 | hola | 19,042 s |
| 01:37 | hola | 16,925 s |
| 01:38 | ¿tienen turno mañana en la tarde? | 23,241 s |
| 01:39 | de las 2pm, consulta médica | **Error a los 13 s** |

- **El modelo configurado en n8n era `models/gemini-3.5-flash`**, no el
  `models/gemini-2.5-flash` que fija el archivo. Se cambió al reimportar, al
  elegirlo del desplegable.
- El error es **429, cuota del nivel gratuito agotada**: `limit: 20` para ese
  modelo, con `retryDelay: 58s`.
- **El tiempo creciente no es del agente: es estrangulamiento más reintentos.**
  `retryOnFail` con 3 intentos cada 1 s contra un servidor que pide esperar
  58 s no recupera nada, consume más cuota y alarga cada ejecución. Las
  mediciones de 17 a 23 s están contaminadas por eso.
- **Ninguna medición de latencia es válida todavía**, salvo quizá la primera.
- **Lo que sí quedó demostrado es la calidad del agente**: con "¿tienen turno
  mañana en la tarde?" respondió que el domingo no se atiende, ofreció el
  lunes 31 de agosto con tres horarios exactos y no inventó precios. El
  razonamiento de fechas y el horario de atención funcionan.
- **Consecuencia: habilitar la facturación de Gemini deja de ser una decisión
  pendiente y pasa a ser un requisito de la demo.** Con nivel gratuito, una
  demostración en vivo ante público falla.

**Demo B (Venta y cobro — Gastronomía y Retail): DISEÑADO Y CORREGIDO,
esperando el segundo número.** El flujo tiene 18 nodos y quedó listo; el
bloqueo se resolvió por la opción (a), portafolio comercial nuevo.

**Sitio administrativo multi-tenant: ANDAMIADO, pista paralela.** No bloquea
las demos. 42 de 42 pruebas de aislamiento pasan contra el emulador.

**Repositorio: PÚBLICO y saneado.** `git init` hecho, un commit local, **sin
remoto y sin push**. El verificador de saneo da 0 hallazgos.

---

## Logros (2026-08-28)

- Análisis de los documentos preliminares de Silvana → `Analisis/`.
- Recursos del demo: calendario de relleno, QR simulado, checklist, guion y
  Simulador v2 offline → `Demo-Recursos/`.
- App de Meta `NovuChat-Demo-A` creada, publicada y con webhook operativo.
- Google Cloud `${GCP_PROJECT_ID}` con OAuth de Calendar y API de Gemini.
- Demo A funcionando de punta a punta contra WhatsApp real.
- **Latencia del Demo A:** identificada la causa probable —el agente encadena
  llamadas innecesarias a `consultar_disponibilidad`, no el tamaño del
  prompt— y aplicados los ajustes. Protocolo de medición y criterio de
  aceptación en `Analisis/04-latencia-demo-a.md`.
- **Demo B:** corregido un defecto que mandaba la respuesta de un cliente al
  teléfono de otro, y las prohibiciones 3 y 4 pasaron de ser reglas del prompt
  a compuertas por código.
- **Guía de Meta reescrita** (687 líneas, once bloques pausables) con los once
  hallazgos incorporados y los pasos del segundo número.
- **Saneo del repositorio público** con marcadores, `CONFIGURACION.local.md`
  ignorado, y `scripts/verificar-saneo.sh`.
- **Estándar DevSecOps v2** aplicado, con despliegue por federación de
  identidades OIDC y cero claves de cuenta de servicio.
- **Panel administrativo** diseñado y andamiado en `admin/`.

---

## Hallazgos que costaron tiempo (no volver a tropezar)

1. **El número de prueba es UNO POR PORTAFOLIO COMERCIAL, no por app.** Al
   crear `NovuChat-Demo-A` se colgó de la WABA que ya existía del proyecto
   WhatsApp-Modular. Por eso el hilo de WhatsApp mostraba mensajes viejos.
2. **`subscribed_apps` es obligatorio y NO existe en la interfaz de Meta.**
   Suscribir el campo `messages` no basta: la WABA debe estar suscrita a la
   app, y eso solo se hace por API. Era la causa de "no entra nada a n8n".
   Script: `scripts/verificar-meta.sh`.
3. **La app de Meta debe estar publicada (Live).** En modo Desarrollo, Meta
   solo entrega los webhooks de prueba disparados desde el panel. Publicar
   exige URL de política de privacidad y categoría; no requiere Business
   Verification.
4. **El token de verificación del webhook NO se configura en n8n.** El nodo
   responde el `hub.challenge` automáticamente: se inventa la cadena en Meta
   y no se pega en ningún lado.
5. **La credencial de Calendar debe ser del tipo `Google Calendar OAuth2 API`**,
   no la genérica `Google OAuth2 API` (esa exige el campo Scope y el nodo no
   la acepta). Crearla **desde el nodo** evita el error.
6. **Un Client ID y un Client Secret de clientes OAuth distintos** producen
   `Client authentication failed`. Descargar el JSON del cliente y copiar de
   ahí, nunca de la pantalla.
7. **La URL del webhook debe ser la de Production**, no la de Test
   (`/webhook-test/`), que solo vive mientras el editor está escuchando.
8. **Los datos fijados (pin) no afectan las ejecuciones de producción**, solo
   las manuales. No bloquean el webhook.
9. **Gemini devuelve 503 en picos de demanda.** Mitigación: elegir el modelo
   desde el desplegable (nunca escribirlo a mano), activar *Retry On Fail*, y
   evaluar habilitar facturación para tener capacidad prioritaria.
10. **El parámetro `Trigger On` del WhatsApp Trigger llega vacío** al importar
    el JSON generado: hay que seleccionar **Messages** a mano, y dejar
    *Receive Message Status Updates* **sin valores** para no generar
    ejecuciones basura.
11. **La imagen del QR no necesita hosting público**: se sube con
    `POST /{PHONE_NUMBER_ID}/media` y se envía por media ID (válido 30 días).

12. **`gemini-2.5-flash` ya no está disponible para cuentas nuevas.** Devuelve
    404 con el texto "no longer available to new users". El JSON lo tenía
    fijado y por eso el flujo se rompía al reimportar. Modelo vigente y
    probado en esta cuenta: **`models/gemini-3.5-flash`**. Google recomienda
    `3.6-flash`, sin probar acá. Elegir siempre del desplegable.
13. **La API key de Gemini de AI Studio no vive en el proyecto que uno cree.**
    AI Studio crea solo un proyecto `gen-lang-client-*` ("Default Gemini
    Project") y ahí queda la key. Aunque `${GCP_PROJECT_ID}` tenga facturación,
    las peticiones se cuentan contra el **nivel gratuito** si la key pertenece
    a ese otro proyecto. Síntoma: 429 con `generate_content_free_tier_requests`.
    Se corrige vinculando ese proyecto a la cuenta de facturación.
---

## Decisiones tomadas

| Decisión | Resolución | Fecha |
|---|---|---|
| Canal de WhatsApp | Meta Cloud API, número de prueba | 28/08 |
| LLM de los demos | Gemini (Google AI Studio) | 28/08 |
| LLM de producción | Claude API (Anthropic) | 28/08 |
| Evolution API | Prohibido, ni siquiera para demos | 22/08 |
| Cobro por QR | Simulacro rotulado, impuesto por código | 28/08 |
| Transparencia del agente | No niega ser una IA, impuesto por código | 28/08 |
| Diseño del Demo B | Opción (a): portafolio nuevo y segundo número | 28/08 |
| Visibilidad del repositorio | Público, con saneo por marcadores | 28/08 |
| Fuente de verdad de los flujos | Los JSON de `Flujos/`; `build_flows.py` retirado | 28/08 |
| Alcance del panel admin | Pista paralela, no bloquea las demos | 28/08 |

## Decisiones pendientes

- **Proyecto Firebase del panel.** Recomendación del agente de arquitectura:
  dos proyectos nuevos y dedicados, `novuchat-admin-dev` y `-prod`, dejando el
  proyecto de demos como está. El argumento decisivo es que el proyecto de
  demos ya emitió credenciales que hoy viven en la VM de OCI, una máquina con
  co-inquilinos. **Falta la decisión de Andres.**
- **Política de retención de conversaciones.** Hay que decidirla antes del
  primer cliente real: son datos personales de terceros que nunca consintieron
  nada ante NovuChat.
- **Silvana como segunda propietaria** de plataforma y como revisora en
  GitHub. Hoy hay un único punto de falla humano y la §4 no se puede cumplir.
- **Facturación de Gemini** para reducir los 503 durante los demos.
- **Memoria persistente** (Postgres Chat Memory) para producción.

---

## Panel administrativo (pista paralela)

**Diseño extendido y verificado el 2026-08-29: 72 de 72 pruebas de aislamiento
en verde contra el emulador**, ejecutadas y comprobadas.

- **Techo de crecimiento del producto, escrito:** 2 números por WABA por
  defecto, hasta 20 con verificación de negocio; más allá hacen falta más
  WABA. Con una WABA verificada, **el techo son 20 comercios**, y el número 21
  no exige cambiar código sino un trámite de Meta, de días o semanas.
- **El número es por comercio, no por flujo.** Varios flujos demo pueden
  compartir número; cada cliente pago necesita el suyo.
- Contactos del comercio en subcolección propia; el rol operador no los ve.
- Conteo de personas atendidas sin crear un segundo registro de teléfonos: se
  reutiliza el documento de conversación con una marca de período. Se descartó
  el hash de teléfono porque el espacio de numeración boliviana se enumera en
  segundos: un hash sin sal es una copia disfrazada de la agenda.
- Suspensión separada de baja. Un comercio suspendido **sigue viendo sus
  datos**, y el mensaje al cliente final es neutro y fijo en el código: nunca
  revela que el comercio debe dinero.
- Enrutamiento por `phone_number_id` con índice inverso `/rutasWhatsApp`.

**Dos defectos que las pruebas nuevas destaparon, y que estaban "en verde":**

1. `rolEn()` devolvía `null`, y comparar `null` con una cadena en el lenguaje
   de reglas **lanza error** en vez de dar falso. El propietario de NovuChat no
   podía leer auditoría, invitaciones ni accesos de soporte. Roto desde la
   entrega anterior, sin cobertura que lo detectara.
2. Ocho pruebas de contactos **pasaban en vacío**: los `assertFails` pasaban
   porque los documentos no existían, no porque las reglas los negaran. En una
   suite dominada por `assertFails`, el verde no prueba nada por sí solo. Se
   agregó un control de la semilla, y se comprobó que el control funciona
   rompiendo la semilla a propósito.

**Conflicto de CI pendiente de resolver:** `ci-node-firebase.yml` (sin filtro
de rutas) y `.github/workflows/despliegue-admin.yml` (sobre `admin/**`)
**despliegan los dos** el mismo componente. Hay que dejar uno solo. Recomendado:
conservar el del estándar y trasladarle los tres controles propios del otro
—prohibiciones de renderizado, negación por defecto de las reglas y pruebas de
Firestore—, que hoy no existen en el estándar.

**Riesgo nuevo:** la suspensión de un comercio depende de que n8n respete el
409 y no cachee la configuración más de 60 s.

## Recordatorios — el bloqueo NO existía

**Hallazgo 16 (2026-08-29): la WABA ya tiene 6 plantillas APROBADAS**, entre
ellas `hello_world` (utility) y `requerimiento` (marketing, es). Comprobado con
`scripts/listar-plantillas.sh`.

Dábamos por sentado que sin la verificación de AAB1 no había plantillas y que
por lo tanto **no se podían prometer recordatorios de 24 h antes en vivo**. Es
falso: la WABA es la compartida con WhatsApp-Modular, cuyo `otp-service` en
producción ya envía plantillas. **Se puede enviar fuera de la ventana de 24
horas hoy mismo.**

Consecuencias:

- Se puede probar el camino de envío por plantilla **ya**, con `hello_world`,
  sin crear nada.
- Falta crear `recordatorio_cita_manana` con tres variables. Se crea en la
  misma WABA: no toca la app `Demo SeguroLo Tengo`, porque las plantillas
  pertenecen a la WABA y no a la app.
- **El recordatorio de 24 h antes deja de ser una promesa condicionada.**

**Flujo de recordatorios construido:** `Flujos/demo-a-recordatorios.json`, 8
nodos, sobre el esqueleto que propuso Silvana. Agrega lo que faltaba: calendario
y número desde configuración, filtro de prefijo de país, corte si el comercio no
está operativo, y **marca en la descripción del evento para no enviar dos veces**
— sin eso, un reintento o una prueba manual le manda el recordatorio repetido al
cliente. Modo `texto` o `plantilla`, conmutable desde configuración.

## Proyectos Firebase creados (2026-08-29)

`novuchat-admin-dev` y `novuchat-admin-prod`, bajo `${GOOGLE_ACCOUNT_PANEL}`.
Pendiente: cargar en GitHub los secretos y variables de
`.github/DESPLIEGUE-FIREBASE.md` §5 cuando exista el remoto.

## Hallazgos del chat de prueba de Silvana (2026-08-29, 19:59–20:04)

1. **EL AGENTE INVENTÓ UNA DIRECCIÓN.** Ante "¿dónde queda su clínica?"
   respondió "Sopocachi, sobre la Avenida 20 de Octubre". No existe tal dato en
   ninguna configuración. La regla 6 prohibía inventar precios, servicios y
   disponibilidad, y no cubría direcciones. **Es el peor defecto posible para
   una demo comercial: un cliente podría presentarse en una dirección
   inventada.** Corregido: la prohibición ahora cubre cualquier dato, hay campos
   `direccion`, `politicaCancelacion` y `datosQueNoTenemos` en configuración, y
   se prohíbe explícitamente la evasiva del tipo "contamos con un equipo
   altamente calificado", que es una invención disfrazada.
2. **Dejó una pregunta sin responder.** Silvana preguntó cómo cancelar y el
   agente nunca contestó, ni siquiera al reclamárselo. Corregido con la regla
   6b: responder todas las preguntas de un mismo mensaje antes de avanzar.
3. **Un mensaje salió cortado a mitad de frase.** Sin diagnosticar.
4. **La compuerta se disparó al confirmar la cita de Silvana, y la causa era
   mía. CONFIRMADO leyendo la ejecución #232 por la API.** `agendar_cita` corrió
   **sin error en 405 ms**: la cita se creó. Quien falló fue mi verificación:
   `Verificar en el calendario` devolvió un item vacío porque
   `$('Config del negocio').item` **no resuelve después de un nodo Code** — el
   emparejamiento se rompe, el ID de calendario llegaba vacío y la consulta no
   traía nada. Es exactamente el defecto que el agente del Demo B había
   documentado al corregir sus nodos de salida, y que yo reintroduje.
   Corregido con `.first()`, más `updatedMin` de 10 minutos y `limit` 50: sin
   `updatedMin` la consulta ordena por fecha de inicio y una cita lejana puede
   quedar fuera de la página de resultados, que era un segundo defecto latente
   en la misma consulta.

   **Lección de método:** el nodo tenía `onError: continueRegularOutput`, que
   hace fallar en silencio y deja la ejecución marcada como exitosa. Falla del
   lado seguro, pero es invisible: sin `scripts/ver-ejecuciones.sh` habríamos
   seguido adivinando.

## Diagnóstico remoto de n8n

`scripts/ver-ejecuciones.sh` consulta las ejecuciones por la API con la clave
que ya teníamos: resumen, filtro por error, y detalle nodo por nodo con tiempos
y mensajes de error. **No hacía falta ningún permiso nuevo.** Hasta ahora cada
diagnóstico exigía que una persona abriera n8n y sacara una captura.

## Remoto de GitHub

`https://github.com/segurolotengopy/NovuChat.git`, configurado como `origin`.
Repositorio **público y vacío**: nunca se hizo push.

## Riesgos vivos para el 9–10 de septiembre

- **Latencia del Demo A**: sigue siendo el pendiente número uno. Los ajustes
  están aplicados pero **sin medir**. Si la ejecución de 48 s todavía figura
  en n8n, abrirla y contar las iteraciones del agente cierra la pregunta en
  dos minutos.
- **Límite de portafolios de Meta**: son 2 por cuenta personal sin verificar.
  Si ya están agotados, **la opción (a) del Demo B se cae** y hay que volver a
  la mesa. Verificarlo antes de invertir las tres horas de trámites.
- **`executionTimeout` de 60 s**: si vence, el cliente no recibe nada. Sesenta
  segundos de silencio ante un prospecto son peores que una respuesta lenta:
  el guion necesita una salida manual a los ~20 s.
- **Agente sin herramientas en el Demo B**: algunas versiones de n8n exigen al
  menos una para el *Tools Agent*. Si falla al importar, el reemplazo es un
  *Basic LLM Chain* con la misma memoria, media hora.
- **Solo 5 destinatarios**: el guion contempla prestar un celular al público.
- **503 de Gemini**: mitigado con reintentos; se cierra con facturación.
- **Business Verification de AAB1**: no bloquea los demos, pero sin ella no
  hay plantillas, así que **no se prometen recordatorios "24 h antes" en
  vivo**.

## Riesgos del repositorio público

- La historia de git es permanente: cualquier valor que se cuele hay que
  sacarlo con `commit --amend` **antes** del primer push, no con un commit
  nuevo.
- `.env` lo protege el gancho de pre-commit, no el estándar. Sin
  `pre-commit install` el modo exacto del verificador nunca corre.
- **La §4 no se puede hacer cumplir técnicamente**: GitHub no permite aprobar
  el propio PR y es una cuenta con un solo dueño. Hasta sumar a Silvana como
  revisora, la separación de funciones es un acuerdo de proceso.
- **Conviene rotar la ruta UUID del webhook**: es el único control de acceso
  real del flujo y no se puede saber si estuvo en algún historial previo.
- En la Fase 1 la ingesta escribe con el SDK Admin, que se salta las reglas:
  el aislamiento depende de una línea de código. Migrar al rol `ingesta`
  **antes del segundo cliente**.

## Próximos pasos

1. Verificar el límite de portafolios de Meta. Cinco minutos, y condiciona
   todo el Demo B.
2. Reimportar el Demo A en n8n, publicar y **medir** con el protocolo de
   `Analisis/04-latencia-demo-a.md`. Criterio: p50 ≤ 6 s, p90 ≤ 10 s.
3. Decidir el proyecto Firebase del panel.
4. Trámites de Meta del segundo número, en el orden de la guía. Los pasos 4
   (publicar en Live) y 7 (`subscribed_apps`) fallan en silencio.
5. Recorrer la suite A completa de `Demo-Recursos/checklist-ensayo.md`.
6. Agregar al guion la salida manual a los ~20 s.
7. Ensayo general 6–7/09 con Silvana; video de respaldo; Simulador al día.
8. 8/09 congelamiento y exportación de flujos al repositorio.
