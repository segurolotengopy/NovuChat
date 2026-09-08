# ESTADO — bitácora del proyecto NovuChat

> Se actualiza al final de cada sesión y antes de cualquier pausa. Al retomar,
> leer esto primero. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos.

**Última actualización:** 2026-09-08 (rentabilidad: tope por plan y las dos cachés)

---

## Dónde estamos (2026-09-08, día del congelamiento)

**Lo de hoy es económico, no funcional: el 1 de octubre Meta empieza a cobrar
cada respuesta del asistente** (0,1356 Bs en Bolivia, con 1.000 mensajes de
servicio gratis por número al mes). Con eso, una conversación de 10 turnos pasa
de 0,29 a 1,61 Bs y los tres planes quedan en pérdida a los volúmenes
publicados. El costo deja de depender del modelo y pasa a depender de cuántos
mensajes manda el asistente. Se implementaron los tres cambios que el modelo de
costos marcó como mandatorios. **405 pruebas** (eran 336), build y lint en
verde.

**1. Tope de respuestas por ventana de 24 h: 25, igual para los tres planes.**
Es la palanca que faltaba: la promesa «1 chat = 24 horas de interacción» no
tenía fondo. Ahora `configuracionFlujo` devuelve `limites.mensajesRestantes24h`
para ESA conversación, y una compuerta nueva —`¿Dentro del tope?`— corta
**antes del agente**, así que no se paga el modelo ni el mensaje.

- **El tope NO se escalona por plan, y eso se corrigió el mismo día.** La
  primera versión usaba 8 / 12 / 16 y estaba al revés: `Analisis/16` muestra que
  el plan barato es el que más barato tiene ser generoso, y que un plan caro con
  tope menor que el barato es invendible. El estándar único vive en
  `functions/src/planes.ts`; la excepción por comercio, en
  `cuenta/estado.topeMensajes24h`, desde `actualizarEstadoCuenta` o
  `admin/scripts/fijar-tope.mjs`.
- **Un aviso por ventana y después silencio**, no un aviso por mensaje: si
  avisara cada vez, el tope pagaría justo lo que quiere evitar. El texto no
  menciona planes ni pagos.
- **Falla hacia atrás**: sin panel, `mensajesRestantes24h` viene `null` y no se
  corta.
- El contador (`mensajesVentana`) viaja en el documento de la conversación, que
  ya se leía y ya se escribía: **cero lecturas y cero escrituras extra**, y las
  reglas impiden que nadie del negocio lo baje.
- Con 25 respuestas por conversación **el guion del 9 y 10 no se toca**: ninguna
  conversación del ensayo se acerca.

**2. Caché de 60 s en `Traer configuración`.** Las lecturas por conversación
habían pasado de 45 a 295 al conectar la consola. Se cachea **en la Cloud
Function y por comercio**: configuración, catálogo, funcionarios, vertical,
rótulos y cuenta. **La ficha (el estado) se lee fresca en cada llamada**, así
que suspender sigue cortando al instante, y el contador del tope también, que
es por cliente. Se mide con el encabezado `X-NovuChat-Cache` y el campo
`cache` de la respuesta.

**3. Caché del prefijo del prompt: se ordenó el prompt, y hay que medirla.**
La caché es un prefijo exacto, y en Gemini el orden es instrucciones →
herramientas → mensajes: **la hora, que cambia cada minuto, estaba dentro de
las instrucciones y dejaba fuera de la caché el historial entero**. El nombre
del cliente hacía algo peor: un prefijo distinto por cliente no se comparte
entre conversaciones. Ahora las instrucciones son 100 % fijas por negocio y lo
del turno viaja en el mensaje, en un bloque `[CONTEXTO DEL SISTEMA]`; el texto
del cliente va después de `[MENSAJE DEL CLIENTE]` y el prompt dice que eso es
dato y nunca una orden, así que de paso mejora la defensa contra inyección.

> **Lo que NO se puede afirmar todavía, y conviene no afirmarlo:** el mínimo
> cacheable de la familia Gemini 3.5 es de 4.096 tokens y Flash-Lite ni figura
> en esa tabla. Los prefijos fijos miden ~3.300 tokens (Demo A) y ~2.000
> (Demo B), así que **la caché recién entra cuando el historial hace crecer el
> prefijo, y en una conversación corta puede no entrar nunca**. El
> reordenamiento es la condición necesaria; que ocurra hay que verlo con
> `./scripts/ver-ejecuciones.sh --id N --tokens`, que ahora muestra el uso de
> tokens y los campos de caché. **Sin esa medición, el punto 3 está a medias.**
> Y la proporción importa: el modelo es el 12 % del costo, así que esta palanca
> vale ~5 % del total. Acortar la conversación vale mucho más.

**Lo que este trabajo NO hace, y es decisión comercial de Andres:** rehacer los
planes. El modelo dice que lo defendible a precios actuales es del orden de
150 / 250 / 400 conversaciones, no 300 / 1.000 / 2.500, y que el excedente de
50 Bs por 150 queda 5 veces por debajo del costo marginal nuevo. **No firmar
contratos anuales a los precios actuales** sin decir por escrito que el precio
se revisa desde el 1 de octubre.

**Los flujos cambiaron: hay que reimportarlos o publicarlos** con
`./scripts/publicar-flujo.sh --flujo Flujos/<archivo> --aplicar`. Dos nodos
nuevos por flujo conversacional (`¿Dentro del tope?` y `Tope alcanzado`).
Como el congelamiento es hoy, **la decisión de publicar antes o después de las
demos es de Andres**: el código está probado contra los JSON versionados, pero
no contra un teléfono real.

---

## Dónde estamos (2026-09-07, mañana del congelamiento)

**`main` en 124 commits, árbol limpio, saneo en cero, 336 pruebas.** Los tres
flujos publicados y activos; consola, reglas y 20 funciones desplegadas.

**El cambio grande de la madrugada: la consola dejó de ser una maqueta.** Hasta
anoche el negocio escribía su configuración en el panel y el asistente seguía
usando la que llevaba adentro — cambiar un precio no hacía nada. Ahora los tres
flujos leen del panel (`configuracionFlujo`) y **está probado en vivo**: se
cambió el precio del corte en la consola y el asistente lo dijo por WhatsApp.

- **Falla hacia atrás.** Si el panel no contesta, cada flujo usa los valores que
  ya tenía escritos: el peor caso es el comportamiento de ayer, nunca un
  asistente sin catálogo.
- **`estadoComercio` manda desde el panel**, en los tres. Esta afirmación fue
  FALSA entre el 06 y el 07 de septiembre y se corrigió el 07: ver «Suspender un
  comercio no le cortaba el asistente», más abajo.
- **Los rótulos del cobro simulado no se pisan con nada**, aunque el panel los
  mandara. Probado atacándolo.

**El alta de un cliente real ya es posible**, que hasta ayer no lo era:
`alta-comercio.mjs` crea la cuenta sin contraseña conocida, y la reserva de 20
alias de secreto quitó el despliegue de Functions del procedimiento.

**Cuatro de las seis brechas de cara al primer cliente están cerradas.** Quedan
el rol `ingesta`, el límite de 50 eventos de la compuerta, y el código de la
purga de retención —la política ya está decidida—. Las tres son para después de
las demos.

**Lo que NO existe todavía, y la pantalla lo dice:** el cobro real. Se puede
registrar y verificar el QR del comercio, pero **ningún flujo lee `cobroReal`**,
así que el asistente sigue enviando el de demostración. Falta el consumo en el
flujo, los tres nodos del OCR y el control para encenderlo.

**Pendiente de hoy:** la suite A completa con teléfono, y a las 17:00 confirmar
que llegan los seis recordatorios del martes — es el único eslabón que nunca se
vio correr solo.

**A la noche, después de la reunión con Silvana, se construyó el PREPAGO
entero** (ver la sección «Prepago, alta de clientes y flujo interno de cobro»,
más abajo): planes, saldo por conversación, bolsas, mes de prueba, corte por
409, recordatorios, alta con todos los datos desde la consola, y el flujo
interno con el que un negocio le paga a NovuChat por WhatsApp. **Compila y pasa
445 pruebas; NO está desplegado ni probado con teléfono**, y la recomendación es
no desplegarlo antes de los demos: no los afecta (los demos no tienen
modalidad y no se cortan), pero un despliegue la víspera no compra nada porque
el primer corte posible es el 1 de octubre. Todo en
`Analisis/11-prepago-y-alta-de-clientes.md`.

---

## Dónde estábamos el 29 de agosto (latencia del Demo A)

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
| Proyecto Firebase de la consola | Un solo proyecto real de Andres, en us-east1; los `novuchat-admin-*` no se crearon | 02/09 |
| Trato en la consola y los flujos | Tuteo, nunca voseo | 01/09 |
| Unidad de cobro | **Conversación**: ventana fija de 24 h por teléfono desde la primera consulta no cortés. Cierres = métrica de calidad, no se facturan | 06/09 |
| Modelo de los demos | `gemini-3.5-flash-lite` en los dos flujos (Flash perdía 144 Bs/mes en el plan Pro) | 06/09 |
| Agendas por funcionario | Cada funcionario con su calendario; resolución funcionario → área → defecto | 06/09 |
| Calendarios de un negocio | Todos de UNA cuenta de Google; se verifica en el alta | 06/09 |
| Cliente OAuth de n8n | Propio, separado del de Firebase | 06/09 |
| Campos de la consola sin lector en el flujo | Se quitan de la interfaz y se anotan como deuda; no se muestran «pendientes» | 06/09 |
| Rediseño de la consola con el diseño de `novuchat.site` | Se hace DESPUÉS de las observaciones de Andres | 05/09 |
| Política de capas | Flujos / consola / usuarios; lo común una vez, lo propio por flujo con su pestaña; un negocio tiene varios flujos (`flujos: [...]`) | 06/09 |
| Un número por flujo | Se mantiene. El enrutador para compartir número queda pendiente, sin fecha | 06/09 |
| Cobro real | El QR es del comercio y el dinero va a su cuenta. El OCR del comprobante **coteja**, no acredita: el asistente nunca dice «pago acreditado» | 06/09 |
| El QR no se almacena | Se guarda el texto validado y la imagen se vuelve a dibujar en cada envío | 06/09 |
| Anulación de citas | El Flujo A puede cancelar, con búsqueda por el teléfono del mensaje y confirmación explícita del cliente | 06/09 |
| Doble reserva | Candado POR CÓDIGO en `Comprobar reserva`, no por prompt. Cede la cita más nueva y no se le confirma al cliente | 06/09 |
| La consola manda | Los flujos leen su configuración del panel; los valores escritos en el flujo quedan como respaldo si el panel no contesta | 07/09 |
| Precio del catálogo | Opcional. Ausente significa «a consultar»; cero significa gratis y son cosas distintas | 07/09 |
| Envío de plantillas | Por `httpRequest` con el JSON armado a mano, no por el nodo de WhatsApp, que manda `template.language` sin `code` | 06/09 |
| Marcar como recordado | Solo con el identificador de mensaje que devuelve Meta. Un envío fallido no se marca | 06/09 |
| Retención de conversaciones | 12 meses desde el último mensaje, con purga automática | 07/09 |
| Integración con bancos | En una etapa posterior, cuando `~/ManejoQRSimple` esté listo. **No se escribe integración bancaria en este repositorio** | 07/09 |
| Cobro real de NovuChat | Es el nivel «sin API del banco» y así se vende. El asistente nunca dice «pago acreditado» | 07/09 |
| **Moneda de la lista de precios** | **Dólares.** Se cobra en bolivianos al **Tipo de Cambio Oficial del BCB**. Corrige el descalce de fondo: el costo se paga en USD y el ingreso se cobraba en Bs. USD 20 / 40 / 70, instalación USD 65, bolsa USD 10. Bolivia tiene **régimen flexible desde el 29/06/2026** y el BCB publica un TCO diario (12,60 al 08/09), así que la fuente es pública y verificable y **NovuChat no debe publicar un tipo de cambio propio**. Falta decidir solo **qué día**: el de pago o el del primer día hábil del mes, fijo para ese mes. Recomendado el segundo, en `Analisis/14` §5ter | 08/09 |
| **Unidad de cobro** | **Se sigue con la conversación de 24 h.** No se pasa a cobro por respuesta ni a conversación general. **Sujeta a revisión con los parámetros del §8 de `Analisis/15-unidad-de-cobro.md`**, a los tres meses del primer cliente pagando o antes si se dispara alguno. Condiciones de la decisión: publicar el tope de mensajes y mostrar los mensajes en la consola | 08/09 |
| Modelo comercial | **Prepago por mes calendario**, con bolsas que no vencen y un mes calendario de prueba. Los planes se escribieron el 07/09 con los volúmenes viejos (300/1000/2500 y bolsa de 150 por 50 Bs) y **se corrigieron el 08/09** con el modelo de costos: 120/200/300 conversaciones, USD 20/40/70, bolsa de 25 por USD 10. La bolsa vieja perdía 176 Bs cada vez que se vendía | 08/09 |
| Corte del servicio | El 1 sin pago y al agotar conversaciones. Al cliente final, el mismo aviso neutro de la suspensión. Una cuenta **sin modalidad** es demostración y no se corta | 07/09 |
| Recordatorios de cobro | Dos antes de fin de mes (7 y 2 días), uno el día del corte por pago; por bolsa agotada, uno al cortar y otro a los dos días. Todos dicen que sus clientes están sin atención | 07/09 |
| Flujo interno de cobro | Sin agente de IA: menú interactivo con cuatro opciones fijas y el QR real de NovuChat. La confirmación del pago es humana, en la consola | 07/09 |
| Número interno de NovuChat | Alias `cliente20` reservado; la reserva para clientes queda en 19 | 07/09 |

## Decisiones pendientes

- **Revisión de la unidad de cobro**, con los parámetros del §8 de
  `Analisis/15-unidad-de-cobro.md`: distribución del largo de las
  conversaciones (no el promedio), ventanas de 24 h por asunto, y dispersión
  del margen entre comercios. Los tres salen de datos que el sistema ya
  escribe; falta ponerlos en una pantalla. **A los tres meses del primer
  cliente pagando**, o antes si se dispara alguno. Sus dos condiciones —
  publicar el tope de mensajes y mostrar los mensajes en la consola — son
  trabajo previo a vender, no parte de la revisión.
- ~~**Proyecto Firebase del panel.**~~ Resuelto el 02/09: un proyecto real,
  us-east1 (ver «Decisiones tomadas»).
- **Observaciones de Andres sobre la consola**, antes de rehacerla con los
  tokens de `novuchat.site` (fondo `#f7f3ec`, superficie `#fff`, texto
  `#1c211f`, acento `#2f3a44`, acento 2 `#12c489`, Archivo 800 en títulos,
  radios 8/16/28). Hoy la consola lleva el sistema «Modernist» importado de
  Claude Design, que es provisional.
- **Retención del secreto OAuth viejo.** Se creó un client secret nuevo el 06/09
  y hay que borrar el anterior en la consola de Google una vez confirmado que
  nada lo usa.
- ~~**Política de retención de conversaciones.**~~ Decidida el 07/09:
  **12 meses desde el último mensaje**, con purga automática. Se borra el
  contenido y se conserva la cuenta —el cierre público, sin teléfono completo—
  para que un comercio pueda defender una factura vieja. Escrita en
  `admin/DISENO.md` §4septies, con las dos frases para los términos. **El código
  de la purga va después de las demos, y antes del primer cliente real.**
- **Silvana como segunda propietaria** de plataforma y como revisora en
  GitHub. Hoy hay un único punto de falla humano y la §4 no se puede cumplir.
- **Facturación de Gemini** para reducir los 503 durante los demos.
- **Memoria persistente** (Postgres Chat Memory) para producción.

### Deuda: campos quitados de la consola porque el flujo no los lee

**Anotado el 2026-09-06.** Se sacaron de la interfaz, NO de las reglas ni de los
datos: los documentos que ya los tengan los conservan. Vuelven tal cual cuando
el flujo lea su configuración de la consola.

La causa de fondo: el flujo lleva su configuración escrita adentro y la consola
escribe en Firestore. Son dos copias que nadie sincroniza. La función que las
uniría, `configuracionParaFlujo`, existe y está desplegada, y **ningún flujo la
llama**. Conectarla es EL trabajo que borra toda esta deuda de una vez.

**Configuración común** (`/config/negocio`)

| Campo | Nota |
|---|---|
| `instruccionesExtra` | Tiene que volver DELIMITADA y rotulada como dato dentro del prompt: es texto libre de un tercero. El texto de ayuda que tenía ya lo prometía. |

**Agenda y citas** (`/config/agendamiento`) — la sección quedó vacía y no se
dibuja. Los cinco valores viven hoy escritos en el prompt del flujo.

| Campo | Etiqueta que tenía | Valor que usa hoy el flujo |
|---|---|---|
| `duracionPorDefectoMin` | Duración por defecto (minutos) | 60, en el prompt |
| `anticipacionMinimaMin` | Anticipación mínima (minutos) | sin límite |
| `anticipacionMaximaDias` | Se puede reservar hasta (días) | sin límite |
| `horasRecordatorio` | Recordatorio (horas antes) | 24, fijo en el flujo de recordatorios |
| `permitirCancelacion` | Permitir cancelar desde WhatsApp | **corregido el 06/09**: no era «siempre permitido», el flujo NO PODÍA cancelar. Ahora sí puede; falta que el campo lo gobierne |

**Venta y entrega** (`/config/venta`) — quedaron `costoDelivery` y
`recargoFlota`, que sí llegan.

| Campo | Etiqueta que tenía |
|---|---|
| `pedidoMinimo` | Pedido mínimo |
| `radioEntregaKm` | Radio de entrega (km) |
| `aceptaDelivery` | Acepta envíos |
| `aceptaRetiroEnLocal` | Acepta retiro en el local |
| `tiempoCocinaMin` | Tiempo de preparación (minutos) |
| `tiempoDespachoMin` | Tiempo de despacho (minutos) |

Los dos de tiempo además existían en el flujo con otro nombre y otro formato
—`tiempoCocina: "25 minutos"` como texto— así que ni siquiera renombrando el
campo se conectaban solos.

**`descripcion` NO está en esta lista**: se conectó el 6 de septiembre y el
agente ya la recibe.

### Reglas de configuración que se aprendieron a los golpes

**Anotadas el 2026-09-06, después de perder una mañana con cada una.**

- **Los calendarios de un negocio son de UNA sola cuenta de Google.** Lo propuso
  Andres y es correcto: una credencial de n8n solo alcanza los calendarios que
  esa cuenta ve, así que un calendario de otra persona no falla al configurarlo
  —falla al crear la cita, con el asistente confirmándola igual. Hay que
  verificarlo en el alta del negocio, no cuando un cliente reclame.

- **Un cliente OAuth por sistema, no uno compartido.** El cliente que Firebase
  crea solo tenía autorizados el ingreso a la consola Y el retorno de n8n. O
  sea que arreglar el calendario ponía a un clic de distancia dejar a los tres
  superadministradores fuera del panel. Ahora hay uno propio para n8n; el de
  Firebase queda solo para el ingreso.

- **La pantalla de consentimiento en modo «Prueba» caduca los tokens a los 7
  días.** Eso fue lo que rompió el calendario el 6 de septiembre: el flujo
  funcionaba, la credencial no. Publicar la app lo resuelve. Para cada proyecto
  nuevo hay que publicarla ANTES de la primera demostración.

- **Un detector de texto atado a cómo redacta un modelo se rompe al cambiar de
  modelo.** El cambio a Flash-Lite —hecho por una razón económica— cambió la
  redacción de la confirmación y desactivó en silencio la compuerta de
  verificación. Cualquier cambio de modelo obliga a revisar los detectores de
  texto de los flujos.

### Google para los comercios, no solo para NovuChat

**Sugerencia de Andres del 2026-09-05. Para DESPUÉS del congelamiento del 8.**

Hoy el vínculo rol↔proveedor es rígido y está verificado en las dos mitades:
`esPropietario` exige Google, `esAdmin` y `esOperador` exigen contraseña, con
21 menciones en `pruebas/reglas.test.ts`. La idea es permitir que un comercio
cuyo correo ya es de Google entre con Google.

**Lo que conviene conservar sin discusión.** Para el equipo de NovuChat, exigir
Google es lo que hace que la superficie de ataque sea «comprometer la cuenta de
Google de Andres» y no «adivinar una contraseña». Eso no se toca.

**Lo que sí se puede aflojar, y por qué.** Para el comercio, la exigencia de
contraseña protege menos de lo que parece: el estado incoherente que el
comentario de `claims.ts` teme —un admin de comercio con `p: true`— ya lo impide
el claim, que solo otorga `scripts/superadmin.mjs`. Lo que la regla agrega ahí
es claridad, y tiene un costo real: a una peluquera con Gmail le pedimos
inventar y recordar una contraseña más para algo que abre dos veces por semana.
Esa contraseña termina anotada al lado de la caja, que es peor que Google con
su segundo factor.

**Cómo se manejaría en la consola:**

1. **Al invitar, el administrador ELIGE el método**, no lo adivina el sistema.
   Si el correo es de Gmail, la consola lo sugiere; no lo impone. Hay gente con
   Gmail que no quiere vincular su cuenta personal al trabajo, y esa objeción es
   legítima.
2. **Ingreso con un solo campo primero.** Se escribe el correo y recién ahí la
   pantalla decide qué mostrar: contraseña o botón de Google. Es el patrón que
   usan los bancos. De paso el enlace «Ingreso interno» podría desaparecer:
   el correo ya dice quién es.
3. **Se mantiene UNA IDENTIDAD, UN PROVEEDOR**, decidido al invitar. Hay que
   APAGAR el enlace automático de cuentas con el mismo correo en Firebase; si no,
   alguien con contraseña que un día entra con Google termina con las dos y
   vuelve el estado ambiguo que la regla evita.

**Costo:** las dos mitades del vínculo (reglas y `claims.ts`), reescribir las
pruebas que hoy afirman lo contrario, y cambiar invitación e ingreso. Medio día
bien hecho.

**Por qué NO antes del 9:** es la pieza que decide quién entra a los datos de
los clientes, hoy funciona y está probada, y quedan cuatro días. Al ensayo se
llega con lo que ya está verificado.

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

**Superado el 2026-09-02:** esos dos proyectos nunca llegaron a existir. La
consola vive en UN proyecto real de Andres, en **us-east1** (su región estándar;
nada de regiones sudamericanas), cuyo identificador está en
`CONFIGURACION.local.md` y en `admin/.firebaserc` (ignorados). Ver «Del 1 al 6
de septiembre».

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

## Demo B — canal completo (2026-08-30)

**Segundo número operativo**, en el portafolio NovuChat. Las cuatro
comprobaciones en verde y los tres identificadores distintos de los del Demo A:
app, WABA y número. `subscribed_apps` ya venía puesta.

**El límite de portafolios no era un problema:** la cuenta tiene tres
—NovuChat, AAB1 y Segurolotengo—, así que el riesgo que arrastrábamos desde el
jueves quedó descartado. El error *"Tu cuenta no se pudo crear"* al pedir el
número se resolvió completando la información del portafolio nuevo: Meta se
niega a crear activos sobre un portafolio incompleto y no lo dice.

**Hallazgo 17 — el marcador del número no puede ser compartido entre demos.**
El flujo del Demo B usaba `REEMPLAZAR_PHONE_NUMBER_ID`, el mismo del Demo A, así
que `preparar-import.sh` le habría puesto el número del Demo A. Habría enviado
desde el número equivocado, en silencio, fallando después con un error de
permisos que apunta a cualquier lado menos a la causa. Ahora tiene marcador
propio, `REEMPLAZAR_PHONE_NUMBER_ID_B`.

**Hallazgo 18 — los nodos HTTP Request impedían publicar.** Los dos del Demo B
declaraban autenticación genérica sin tipo de credencial, y n8n no publica un
flujo con nodos así. Se conectaron a la credencial `whatsAppApi` ya existente en
lugar de repetir el token en una cabecera: un secreto menos que custodiar.

**QR subido** con el número del Demo B — el media ID queda ligado al número que
lo sube, así que el del Demo A no habría servido. **Vence a los 30 días**: si el
9 de septiembre estuviera vencido, se regenera con
`./scripts/subir-qr.sh --env .env.demo-b`.

## Demo B VALIDADO DE PUNTA A PUNTA (2026-08-31)

Conversación completa contra WhatsApp real: lista interactiva de bienvenida,
toma de pedido con opciones, cálculo del total desglosado, envío del QR **en su
lugar de la conversación**, recepción del comprobante y confirmación del pedido
con aviso al dueño.

**La prohibición 3 se cumple y está verificada a ojo:** el QR llega con
«DEMOSTRACIÓN · ESTE QR NO COBRA» impreso arriba, «SIMULACRO DE PAGO» abajo, y
el epígrafe dice «cobro SIMULADO, no cobra ni mueve dinero». Rótulo en la
imagen **y** en el texto. La confirmación dice «Pago verificado (SIMULADO —
demostración, sin cobro real)» y el aviso al dueño repite que no hubo
acreditación bancaria.

Trato en tuteo boliviano, sin voseo, con emojis acotados.

**Hallazgo 19 — un media ID queda LIGADO al número que lo sube.** El QR se
había subido con el número del Demo A; enviarlo desde el Demo B devuelve
`(#131000) Something went wrong`, un error que no menciona ni el media ni el
número. Se comprueba consultando el media con cada token: existe para uno y no
para el otro.

**Hallazgo 20 — la URL del nodo de envío del QR no llevaba `/messages`.** Un
carácter de diferencia con el nodo de la lista, que sí funcionaba, y el mismo
error genérico de Meta.

**Hallazgo 21 — el flujo de recordatorios leía un solo calendario.** Desde que
cada profesional tiene el suyo, no habría visto ninguna cita y nadie habría
recibido su recordatorio, sin error ni aviso. Corregido.

**Lección de método, tercera vez en dos días:** un `sed`/`replace` que no
coincide deja el script sin cambiar y todo parece funcionar. Pasó con el
`--env` de `subir-qr.sh`, que aceptaba la opción y seguía usando el otro
entorno. Verificar el efecto, no la ejecución.

## Recordatorios — probados de punta a punta (2026-08-31)

Flujo creado en n8n por API (`HgAc711lMs4ArbbZ`, 9 nodos) y **probado a mano
con Execute workflow, sin publicarlo**. Recorre los tres calendarios, encuentra
la cita, extrae el teléfono de la descripción del evento, envía el recordatorio
y marca la cita como recordada.

**Hallazgo 22 — el nodo que marca la cita actualizaba el calendario por
defecto.** La cita vive en el de la especialista, así que devolvía «no se
encuentra el recurso». Sin esa marca el flujo pierde su única defensa contra el
doble envío: cada corrida volvería a encontrar la misma cita y mandaría el
recordatorio otra vez. Ahora `Preparar recordatorios` recuerda en qué
calendario está cada cita — en un calendario secundario, el propio evento lo
dice en `organizer.email`.

**Sigue SIN PUBLICAR, a propósito.** Al activarlo, todos los días a las 17:00
escribe por WhatsApp a quien tenga cita al día siguiente. Es decisión de Andres
cuándo activarlo y con qué horario.

## Oferta comercial: las tres cifras, completas (2026-09-01)

Faltaban dos de las tres. **Cierres** ya estaba en producción; **atenciones** e
**interacciones** se mostraban en la pantalla y estaban en la lista blanca de las
reglas, pero nadie las escribía.

- La ingesta las cuenta ahora en la **misma transacción** que ya movía
  `personasAtendidas`, con marcas en el documento de la conversación:
  `periodoContado` (atención), `respuestasDelPeriodo` y `periodoInteraccion`.
  Cero lecturas y cero escrituras extra.
- La decisión de contar salió a una función pura, `contadoresDelMensaje`, y se
  prueba mes por mes. Los dos casos que sostienen la factura —la segunda
  conversación del mismo cliente no suma otra atención, y la tercera y la cuarta
  respuesta no suman otra interacción— están cubiertos.
- **La ingesta volvió a autenticar.** `SECRETOS_POR_NUMERO` estaba vacío desde
  siempre (un `defineSecret` exige un nombre fijo y el identificador del número
  no puede ir en un repositorio público), así que ningún número autenticaba y la
  ingesta no recibía nada. Pasa a usar `rutaAutenticada()` de `firma.ts`, que ya
  resolvía eso con un alias, y que ya usaba `/cierres` en producción.
- Suite del panel: **226 pruebas en verde** (eran 212).

**Sin verificar todavía, y hace falta antes del congelamiento:** nada de esto se
probó contra n8n, Firestore real ni un teléfono. Falta desplegar las Functions,
mandar un mensaje de verdad y comprobar en el panel que la atención aparezca una
sola vez y la interacción recién en la segunda respuesta.

**Verificado el 2026-09-02 y de nuevo el 2026-09-06** con teléfono real en los
dos demos. Ojo: la definición de las cifras cambió después de escribir esto —la
versión vigente está en «Del 1 al 6 de septiembre → Facturación».

## Del 1 al 6 de septiembre — lo que cambió

Seis días, PRs #20 a #28 fusionados (#27 cerrado, superado por #28). Lo que
sigue está agrupado por tema, no por fecha; lo del **6 de septiembre** va
marcado.

### Plataforma (Firebase)

- **Un proyecto real, en us-east1.** Firestore `(default)`, 18 Cloud Functions
  gen2 con la región en una sola constante (`functions/src/region.ts`), Hosting
  en `consola.novuchat.site` (dominio propio agregado el 04/09) y App Check con
  reCAPTCHA Enterprise, con los dos dominios registrados.
- **Tres superadministradores** dados de alta con `scripts/superadmin.mjs`
  (Andres, Silvana y la cuenta de NovuChat). Entran solo con Google.
- **Datos reales sembrados** con `scripts/sembrar-demos.mjs`: los dos negocios
  de los demos con su catálogo, horarios y funcionarios, y usuarios de prueba
  por rol con `scripts/usuarios-prueba.mjs`.
- **Tres defectos de despliegue que costaron horas:** `firebase deploy` subía
  un `lib/` viejo (ahora hay `predeploy` que compila); el CSP apuntaba a
  proyectos que no existían y la COOP rompía la ventana de Google (arreglado en
  tres pasadas, después de dar por bueno algo que no lo estaba); y un
  `createCustomToken` muerto en la ingesta devolvía 500 en CADA mensaje.

### Consola

- **Sistema de diseño «Modernist»** importado completo desde Claude Design
  (`web/src/diseno.css`, Archivo alojada en `web/public/fuentes/`, tema
  `[data-tema="oscuro"]` disponible pero no obligatorio). Es provisional: el
  definitivo sigue a `novuchat.site` y espera observaciones.
- **Todo el trato pasó a tuteo.** El voseo se coló varias veces en textos
  nuevos (manual, prompts, «Mi cuenta») y se barrió con una expresión regular
  cada vez; conviene volver a pasarla antes de publicar cualquier texto.
- **Tablero por rol** (`Tablero.tsx`): NovuChat ve la cartera y lo que NO ve por
  regla; el comercio ve hoy, su catálogo y su cuenta.
- **«Consumo»** (antes «Cierres», `/consumo`, con redirecciones desde
  `/cierres` y `/uso`) muestra conversaciones, atenciones, interacciones y
  cierres del período. El superadministrador ve el resumen sin el teléfono
  completo ni el contenido: lo impiden las reglas, no la pantalla.
- **Ingreso** (`Ingresar.tsx`): el comercio no presiona nada, ve el formulario
  directo. El acceso del equipo es un enlace discreto «Ingreso interno» que
  recién ahí ofrece «Continuar con Google» (con selector de cuenta). Se quitó
  la frase «Solo con cuenta de Google: no hay contraseña que robar…».
- **«Mi cuenta»** (`/mi-cuenta`): cambio de contraseña desde adentro, mínimo 12
  caracteres; si Firebase pide sesión reciente, se manda el enlace por correo en
  vez de esconder el error. A las cuentas de Google se les dice que la
  administra Google.
- **Botón para reingresar** en las pantallas sin salida (`SinSalida.tsx`), por
  ejemplo «Tu cuenta todavía no está asociada a ningún negocio».
- **06/09 — se quitó lo que el flujo no lee** y se probó cada pantalla con la
  consulta real que hace (12 pruebas nuevas, «Pantallas · la consulta real de
  cada una», verificadas saboteando la regla). Detalle en la sección de deuda.
- **La descripción del negocio SÍ llega al agente** desde el 06/09: es parte
  del núcleo del producto, y quedó en el prompt del Demo A como «QUÉ ES EL
  NEGOCIO».

### Facturación: de «cierre» a «conversación», en cinco correcciones

La definición se corrigió cinco veces entre el 01/09 y el 06/09, y cada una
quedó en su PR. La vigente es la última:

1. Atención = persona por mes (01/09, PR #21) →
2. Atención = **inicio de flujo desde un teléfono**: tres consultas del mismo
   teléfono son tres atenciones y una persona (01/09, #21 corregido) →
3. Umbral de **2 horas**, y un «gracias» u «ok» después del recordatorio **no
   abre** una atención (`esCortesia()`, 02/09, #24) →
4. **Ventana FIJA de 24 h desde la primera interacción**, como la de WhatsApp:
   mensajes a las 0, 20 y 25 horas son DOS atenciones (02/09, #25) →
5. **06/09, #28 — la unidad que se cobra se llama CONVERSACIÓN**, igual que en
   `novuchat.site/precios`. «Atención» pasa a ser la persona distinta. Los
   cierres dejan de facturarse y quedan como métrica de calidad.

Cómo queda en el código (`functions/src/ingesta.ts`):

| Cifra | Campo | Regla |
|---|---|---|
| Conversaciones (se cobran) | `conversaciones` | Se abre con un mensaje entrante no cortés cuando no hay ventana abierta; ancla `atencionDesde`; `HORAS_VENTANA_ATENCION = 24`, fija |
| Atenciones | `personasAtendidas` | Teléfonos distintos en el período |
| Interacciones | `interacciones` | Conversaciones con ≥ 2 respuestas del asistente |
| Cierres (calidad) | `cierres` | Solo con referencia externa verificable; ver abajo |

- **Endpoint `/cierres`** (`functions/src/cierres.ts`): referencia obligatoria
  (evento del calendario, mensaje del comprobante), identificador idempotente
  `tipo_referencia` para que un reintento de n8n no cuente dos veces, tenant
  tomado de la firma y nunca del cuerpo, y transacción única entre documento y
  contador. Lo que NovuChat lee lleva el teléfono enmascarado; nombre, detalle
  y teléfono completo van a `/privado/datos`, solo para el administrador.
- **La ingesta autentica de verdad** con `rutaAutenticada()` (`firma.ts`),
  acepta HMAC o token con o sin «Bearer», y los flujos le reportan **cada
  mensaje**, entrante y saliente (02/09, #26).
- **`bajaTenant`** ahora corta las rutas del negocio: un comercio dado de baja
  seguía acumulando cierres (01/09, #23).
- Suite: **249 pruebas** (eran 226), incluidas ventana de 24 h, cortesía,
  cierres y las consultas reales de cada pantalla.

### Flujos de n8n

- **Cierres con prueba.** Demo A registra el cierre solo si la cita quedó en el
  calendario (`¿Hay cita verificada?` → `Registrar cierre (cita)`); Demo B solo
  si llegó un comprobante y la respuesta lleva «SIMULADO». Cada demo con la
  credencial de SU número (`Cierres NovuChat A/B (auto)`, creadas por API desde
  `.env` porque los valores pegados a mano no se podían verificar).
- **`neverError` se quitó**: el nodo salía en verde con un 401. Y `.item` pasó a
  `.first()` en las expresiones de cabecera.
- **Demo B acepta el comprobante como imagen O documento** —llegó como
  `document` en la prueba real— y lee `tipo`/`mensajeId` de `Normalizar
  entrada`.
- **Recordatorios**: plantilla `recordatorio_cita_manana` aprobada (es, 3
  variables: nombre, servicio, hora), `modo: plantilla`, cron 17:00 La Paz,
  activo. **Nunca se lo vio disparar solo**: probarlo en el ensayo con una cita
  para el día siguiente.
- **06/09 — modelo a `gemini-3.5-flash-lite`** en los dos flujos, por costo.
  Margen mensual por plan, después del modelo (Bs; no incluye Meta):

  | Modelo | Impulso 250 | Crecimiento 450 | Pro 850 |
  |---|---|---|---|
  | Gemini 3.1 Flash-Lite | +223 | +360 | +626 |
  | **Gemini 3.5 Flash-Lite (elegido)** | +218 | +344 | +585 |
  | Claude Haiku 4.5 con caché | +206 | +304 | +486 |
  | Claude Sonnet 5 con caché | +150 | +116 | +15 |
  | Gemini 3.5 Flash (el anterior) | +131 | +53 | **−144** |
  | Sonnet 5 sin caché | +54 | −203 | −782 |

  «Claude en producción» de `CLAUDE.md` sigue vigente como decisión, pero con
  estos números es Haiku con caché, no Sonnet.
- **06/09 — funcionarios con agenda propia.** `Config del negocio` lleva
  `funcionarios` (`[{nombre, servicios, calendario}]`): **María** y **José**
  para belleza, cada uno con su calendario, y el consultorio odontológico. El
  calendario se resuelve funcionario → área → defecto en
  `consultar_disponibilidad`, `agendar_cita` y `Calendarios a revisar`. El
  prompt tiene el bloque «QUIÉN ATIENDE». **Lo que no hace todavía:** filtrar
  por servicio o especialidad de cada persona; reparte por nombre.
- **06/09 — el detector de confirmación** (`Procesar respuesta`) ya no depende
  de cómo redacta el modelo: reconoce sustantivo + participio («Cita
  confirmada»), tiene una guarda `NIEGA` («no se pudo…») y el prompt exige
  «SI UNA HERRAMIENTA FALLA, NO INVENTES EL RESULTADO». Cadena verificada:
  `agendar_cita ok · afirmaAgendo · reservaVerificada · cierre registrado`.
- **`scripts/preparar-import.sh`** reemplazaba los marcadores en orden
  alfabético, así que `REEMPLAZAR_CALENDARIO_BELLEZA` pisaba a
  `..._BELLEZA_2` y José recibía el calendario de María. Ahora va del más largo
  al más corto. **Regla:** todo marcador que sea prefijo de otro se rompe con
  reemplazo ingenuo.
- **`sembrar-demos.mjs`** dejaba funcionarios viejos (había 5, no 3): ahora
  borra los que no están en la semilla.
- Herramientas nuevas: `listar-plantillas.sh --detalle`,
  `verificar-credencial-cierres.sh`, `ver-ejecuciones.sh --env`,
  `probar-cierre.mjs`, `limpiar-cierres-de-prueba.mjs`.

### Google OAuth del calendario (06/09)

La cita con José falló con el flujo sano: el token de la credencial había
caducado porque la pantalla de consentimiento estaba en «Prueba» (7 días).
Después vino `invalid_client` y `access_denied`. Se resolvió publicando la app y
creando un cliente OAuth propio para n8n, con el retorno de n8n autorizado; el
cliente de Firebase queda solo para el ingreso a la consola. Las cuatro reglas
que salieron de esto están en «Reglas de configuración que se aprendieron a los
golpes».

### CI y DevSecOps

- PR #22: el paso que detecta cambios abortaba con `fatal: bad object` cuando
  la cabeza no estaba en el clon; ahora se protege `GITHUB_SHA`.
- CodeQL marcaba un `.includes` como falso positivo → `Set`.
- `.claude/settings.json` quedó con una coma colgando al quitar `WebFetch` y era
  JSON inválido.
- **06/09 — CI rojo en #27 y #28.** Diagnóstico equivocado primero: se escribieron
  seis excepciones para CVE de `tar` que Trivy **ni siquiera reportaba**. El
  bloqueo real era `qs` (CVE-2026-82417/82562). La corrección de verdad:
  `overrides: qs: ^6.16.0` en `admin/pnpm-workspace.yaml` —pnpm 11 ignora los
  `overrides` de `package.json`— y las excepciones de `tar` retiradas. En
  `.devsecops.yml` quedan solo la de `uuid` (CVE-2026-41907) y la de gitleaks.
  **Regla:** leer el informe de Trivy antes de escribir una excepción; filtra
  por identificador de CVE, no por paquete.

### Documentos y prompts que quedaron escritos

- `Preliminares/prompt-diseno-panel.md` — para pedir el diseño de la consola.
- `Preliminares/prompt-landing-precisiones.md` — para la sesión de la landing:
  corregir tres promesas de `/precios` (funcionarios por especialidad, variantes
  y zonas de envío, «base de datos aislada») y aclarar en el glosario que lo
  que se factura es la conversación. **Falta aplicarlo.**
- `Preliminares/diseno-consola.html` — captura de `novuchat.site` que pasó
  Andres (sin CSS; los tokens se tomaron del sitio vivo).
- Manual de la consola, de una sola página, como artefacto de Claude. Andres
  quiere **tres PDF separados** (superadmin, administrador, operador), cada uno
  con «cómo piensa el asistente», el del empleado sin lo del dueño, ninguno con
  lo del equipo de NovuChat, y el cambio de contraseña explicado por «Mi
  cuenta» y el correo automático. Esperan al rediseño.

### Política de capas: flujos, consola y usuarios (06/09, tarde)

Andres la fijó como política del producto: **FLUJOS** (n8n), **CONSOLA** y
**USUARIOS** (negocios). Lo común no se repite por flujo; lo propio de cada
flujo es excluyente y trae su pestaña; un negocio tiene uno o más flujos. Quedó
escrita con su lista de control en `admin/DISENO.md` §4sexies.0 y como regla en
`CLAUDE.md`.

Lo que se encontró al revisarla contra el código, y se corrigió el mismo día:

- **Un negocio tenía UN solo flujo.** `vertical` era un valor único y
  `asignarNumero` lo sobreescribía. Ahora la ficha lleva `flujos: [...]`; las
  reglas leen la lista (`flujosTenant`, `tieneFlujo`) y caen en `vertical` solo
  si la lista no existe, así nada de lo ya cargado cambia. **Cuando están las
  dos, manda la lista** (probado saboteando la regla: las dos pruebas clave
  fallan si se ignora).
- **Las pestañas no seguían al flujo.** «Funcionarios» se ofrecía a todo
  administrador, incluso al de un restaurante, y el servidor le rechazaba el
  alta. Ahora `web/src/lib/flujos.ts` es el registro: «Agenda» solo con
  reservas, «Pedidos y cobro» solo con venta, y la etiqueta del catálogo dice
  «Servicios», «Productos» o «Catálogo» según los flujos.
- **No había pantalla de catálogo.** Servicios y productos solo entraban por
  script. Ahora hay `Catalogo.tsx` (alta, baja lógica, área, precio, duración
  solo con agenda). Se agregó `area` a la lista blanca: sin eso un ítem
  sembrado con área no se podía ni dar de baja, porque la lista evalúa el
  documento resultante.
- **El alta no creaba el documento del flujo.** Las reglas prohíben crearlo
  desde el navegador, así que un negocio nuevo de venta nunca iba a poder
  guardar su pestaña. `altaTenant` y `asignarNumero` lo crean ahora.
- **El QR** sigue siendo de NovuChat (prohibición 3) y la pestaña de cobro lo
  muestra como «Cargado» o «Sin QR», con la explicación.
- Suite: **257 pruebas** (eran 249).

**Lo que la política deja pendiente**, a propósito: la deuda de conectar los
flujos a `configuracionFlujo`, que sigue siendo la misma.

**Decidido por Andres el 06/09:** que dos flujos de un mismo negocio usen dos
números distintos **está bien** y no hay que cambiarlo. El **enrutador** que
permitiría compartir un número entre flujos queda anotado como tarea pendiente,
sin fecha. No bloquea nada: hoy cada flujo tiene su número y su secreto, que
además es más seguro.

### Cobro REAL con el QR del comercio (06/09, tarde)

Andres fijó la política: el comercio sube su propio QR por la consola, declara a
nombre de quién está la cuenta y hasta cuándo vale, y cuando el cliente paga y
manda su comprobante, el sistema lo lee y lo coteja.

**La distinción que sostiene todo lo demás:** con un QR real el dinero SÍ se
mueve, así que la prohibición 3 no desaparece, cambia de forma. El OCR de un
comprobante **no es una acreditación bancaria** —una imagen se edita— así que el
asistente nunca dice «pago acreditado». Dice que recibió el comprobante y que
los datos coinciden. Lo que esto reemplaza no es al banco: es al dueño mirando
cincuenta capturas por día.

**Se probó contra muestras REALES que pasó Andres**, y cada una destapó un
defecto de diseño que habría llegado a producción:

1. **El QR Simple boliviano NO es EMVCo.** Se implementó el estándar completo,
   con verificación de CRC, y el QR real del BNB resultó ser **256 bytes
   cifrados** más una etiqueta. De adentro no se lee nada. Sin esa prueba, el
   sistema habría rechazado TODOS los QR bolivianos. Ahora se reconocen dos
   familias: `emvco` (se comprueba todo solo) y `cifrado` (se comprueba la
   forma, y el comercio declara cuenta, titular, vencimiento y confirma que es
   reutilizable y de monto abierto).
2. ~~**El QR real vencía el mismo día en que se generó**, así que el modelo
   «carga tu QR una vez» no se sostiene.~~ **CORREGIDO el 07/09.** Generalicé
   desde UNA muestra —el QR que la app del BNB da por defecto a una persona— a
   todo el ecosistema, que es el mismo error de método que ya había cometido con
   el formato EMVCo. El estándar boliviano deja la vigencia como parámetro al
   emitir; la API de Banco Económico la toma como `dueDate` y su propio ejemplo
   usa `2026-12-31`. **El modelo se sostiene: lo que no sirve es el QR personal
   de una billetera, que es el instrumento equivocado.** Detalle y consecuencias
   en `Analisis/08-qr-simple-lo-que-cambia.md`.
3. **Un comprobante de tres bancos, tres formatos.** El del Banco de Crédito
   **no muestra el nombre del destinatario**: su «A nombre de» es el de la
   cuenta de ORIGEN. Cotejar por nombre habría rechazado todos los pagos hechos
   desde ese banco. Se cambió el ancla a la **cuenta de destino**, que sí está
   en los tres.
4. **La misma cuenta, catorce dígitos en un banco y trece enmascarada en otro.**
   Los asteriscos no reemplazan un dígito cada uno. Comparar largos rechazaba
   pagos buenos.
5. **El comprobante en PDF no tiene texto**: es una imagen adentro de un PDF.
   `pdftotext` devuelve vacío. Hace falta OCR de verdad.

**Lo que quedó hecho y probado:** validación de las dos familias, extracción de
las cuentas del QR, cotejo de importe, fecha y destinatario con los formatos
reales de los tres bancos, registro por Cloud Function —el navegador NO puede
escribirlo—, y la pantalla «Pedidos y cobro» con las cuatro advertencias.
**58 pruebas nuevas.**

**El QR no se guarda como imagen: se vuelve a dibujar** a partir del texto
validado. Así no puede pasar que se valide un código y se envíe otro, y el
cliente recibe un QR limpio en vez de una foto de pantalla. El PNG lo arma el
servidor sin bibliotecas de imágenes, y se comprobó con `zxing-cpp` —un
decodificador independiente— que se escanea y devuelve el texto exacto.

**LO QUE FALTA PARA QUE EL COBRO REAL EXISTA DE VERDAD**, y conviene tenerlo
claro porque la pantalla ya parece terminada: **ningún flujo lee `cobroReal`.**
Se puede registrar y verificar un QR —probado el 07/09 con uno real del BNB— y
el asistente sigue enviando el de demostración. Activarlo hoy no cambiaría
nada. Falta:

1. Que el flujo de venta lea `cobroReal` y, cuando esté encendido, envíe la
   imagen por su ficha (`/api/qr/imagen?f=…`) **sin** los rótulos de simulacro,
   en vez del QR de demostración. Son excluyentes.
2. Los tres nodos del OCR: descargar el archivo de Meta, leerlo con Gemini,
   cotejar con `cotejo.ts`.
3. El control para encender el cobro real, que hoy no existe en ninguna parte:
   `activo` se escribe en `false` y nada lo cambia. Lo enciende NovuChat, no el
   comercio, porque pasar de demostración a dinero de verdad es una decisión
   comercial y no un botón.

Mientras tanto los textos de la pantalla **no invitan a hacer nada**. La primera
versión decía «avísale a NovuChat para empezar a usarlo» y dejaba a la persona
esperando una gestión que no existe; Andrés lo encontró de inmediato al
guardarlo: «me dijo que me avise y yo no sé qué hacer».

**Lo que falta del OCR, y necesita un teléfono:** los tres nodos de n8n (descargar el
archivo de Meta, leerlo con Gemini, cotejar). El prompt de lectura y el mensaje
al cliente —«guarda el comprobante ANTES de salir de la aplicación de tu
banco»— están escritos en `Analisis/07-cobro-real-y-ocr.md`, listos para pegar.

### Anulaciones de citas en el Flujo A (06/09, tarde)

**Defecto encontrado al revisarlo a pedido de Andres:** el agente tenía dos
herramientas de calendario —consultar y crear— y **ninguna para cancelar**. El
prompt lo decía («NO PODÉS MOVER NI CANCELAR CITAS») pero la política del
negocio que el mismo prompt le entrega al cliente prometía lo contrario:
«escríbenos por este mismo chat y lo resolvemos sin costo». O sea, el asistente
invitaba a cancelar por WhatsApp y después no podía.

Se agregaron dos herramientas:

- **`buscar_mi_cita`**: trae las citas FUTURAS de ese cliente. El teléfono sale
  del mensaje, **nunca del modelo**: si lo pusiera el agente, un cliente podría
  pedir las citas de otro número y cancelarlas. Google busca por el texto
  «Telefono: …» que `agendar_cita` ya escribe en la descripción del evento.
- **`cancelar_cita`**: borra por identificador, y solo el que devolvió la
  búsqueda.

El prompt ahora exige: buscar, leerle al cliente lo que se encontró, esperar su
confirmación explícita, y recién cancelar. Para mover una cita, **cancelar antes
de agendar**: al revés quedarían las dos.

**Sin publicar.** El diagnóstico confirma que los dos nodos heredarían la
credencial de Google Calendar por tipo, así que es un solo comando
(`./scripts/publicar-flujo.sh --aplicar`). Falta probarlo contra un teléfono:
agendar, pedir cancelar, confirmar, y verificar en el calendario que el evento
desapareció.

**Limitación conocida:** la búsqueda es por calendario, y el negocio tiene tres.
Si el cliente no dice con quién era la cita, el agente se lo pregunta. Es
natural en una peluquería, pero conviene saberlo.

### Un defecto viejo que apareció de paso

La consola llamaba a las Cloud Functions en `southamerica-east1` y están
desplegadas en `us-east1`. **Invitar a un usuario nunca funcionó**, y el mensaje
genérico de la pantalla —«No se pudo enviar la invitación»— lo hacía parecer un
problema pasajero. La región ahora está en un solo lugar
(`web/src/lib/firebase.ts`).

### Candado por código contra la doble reserva (06/09, noche)

**Cómo se descubrió.** Una prueba real de Silvana: pidió dos citas, con María y
con José, a horarios pegados. El asistente le dijo que «se cruzarían», agendó
una sola y le pidió que escribiera de nuevo para la otra. En el calendario,
José quedó con **dos citas de 9 a 10**.

**La causa, comprobada ejecución por ejecución en n8n (#944 a #968):
`consultar_disponibilidad` NO se llamó ni una vez** en toda la conversación. El
agente propuso las 9:00 sin mirar la agenda y reservó encima de una cita que ya
existía. La agenda por persona, que se construyó justamente para esto, quedaba
inerte porque nadie la consultaba.

**Tres defectos, todos del texto del prompt:**

1. La sección «economía de herramientas» planteaba la consulta como un TOPE
   —«como máximo UNA llamada por mensaje»— justo después de decirle que cada
   llamada demora. El modelo hizo lo lógico: no llamar. Ahora es un requisito
   explícito, y ningún horario se propone ni se confirma sin verificar.
2. Decía que dos citas con personas DISTINTAS se cruzan. No se cruzan.
3. «Una vez por cita» se leyó como «una cita por conversación».

**El candado, que es lo que de verdad protege.** Andres pidió que fuera por
código antes del congelamiento, y tenía razón: un prompt ya se rompió una vez al
cambiar de modelo, y dos clientes presentándose a la misma hora no puede
depender de que el modelo obedezca.

Vive en el nodo `Comprobar reserva` y **no cuesta ninguna consulta extra**:
`Verificar en el calendario` ya traía todos los eventos de todos los
calendarios, y cada evento viene con `organizer.email`, que es el identificador
del calendario. Si la cita recién creada se superpone con otra del MISMO
calendario, hay doble reserva; distinto calendario no es conflicto.

- **Cede la más nueva.** Así dos conversaciones simultáneas no se borran
  mutuamente: la que llegó primero se queda con el horario.
- **Deshace la cita y NO se la confirma al cliente.** Le dice que el horario se
  ocupó y pasa el pedido a recepción. Confirmar una cita que se acaba de borrar
  sería el peor resultado posible.
- No registra cierre: no hubo cita, no se factura.
- Citas pegadas (9–10 y 10–11) no son conflicto. Los eventos de día completo
  —«feriado»— tampoco bloquean.

**Probado sobre el código que corre de verdad.** La suite
`admin/pruebas/candado-agenda.test.ts` **extrae el código del JSON del flujo y
lo ejecuta**, en vez de copiarlo: si alguien edita el nodo en n8n y exporta, la
prueba corre el código nuevo. Nueve casos, empezando por los datos reales de la
ejecución #964. Verificado con dos sabotajes: quitar el candado rompe cuatro
pruebas, ignorar el calendario rompe la de las dos personas distintas.

**El candado falló en su primera prueba real, y el defecto era el desempate.**
Ejecución #1076: el agente agendó TRES citas en un mismo mensaje —padre e hijo
con José, esposa con María, todos a las 09:00— y las dos que chocaban quedaron
con el MISMO `created`: `00:20:52` las dos, porque Google guarda ese campo con
resolución de segundos. La regla exigía que la otra fuera ESTRICTAMENTE
anterior, así que ninguna cedió y las dos sobrevivieron.

La prueba que debía cubrirlo usaba marcas separadas por cuatro segundos: pasaba
sin probar nada. Ahora, con marcas iguales, desempata el identificador —da igual
cuál gane, mientras sea siempre el mismo—, se ceden todas las que sobran y no
solo una, el aviso a recepción sale una sola vez, y el mensaje al cliente dice
QUÉ cita cayó y a qué hora en vez de un «hubo un cruce» a secas. Las citas que
no chocan siguen contando como cierre.

Verificado tomando el código que corre en n8n y ejecutándolo contra los eventos
reales de la #1076: deshace una sola cita, la correcta.

**También se reforzó el prompt.** Al justificar las dos citas con José, el
asistente dijo «como José y María tienen agendas independientes, quedaron a la
misma hora». La independencia entre personas distintas no autoriza dos clientes
con la MISMA persona a la misma hora, y ahora el prompt lo dice con esas
palabras y ofrece la salida: horas distintas, o profesionales distintos.

**Deuda que dejó la prueba.** Para ejecutar el código del flujo, la prueba usa
`new Function`, que la regla `js-eval-prohibido` de Semgrep bloquea con razón.
Se documentó la excepción en la línea exacta. Lo correcto a futuro es que el
código de los nodos Code viva en archivos `.js` versionados que se inyecten al
JSON al preparar el import: una sola fuente, y la prueba lo importaría sin nada
dinámico. Es un cambio en la canalización de los flujos y no entra antes del 8.

**Límite conocido:** la consulta trae hasta 50 eventos por calendario en 90
días. Un negocio con más citas que eso podría dejar una superposición sin ver.
Hay que subir el límite o acotar la ventana antes del primer cliente grande.

### El recordatorio de las 17:00 nunca llegó, y eran TRES defectos (06/09, noche)

Andrés avisó que no había recibido ni uno. El cron **sí dispara**: corre todos
los días a las 21:00 UTC —sus 17:00— y la ejecución termina en «success». El
problema estaba adentro, y la ejecución #1001 lo mostró entero.

1. **El envío fallaba.** Meta devolvía «Bad request» con el detalle exacto:
   `template.language` sin el campo `code`. El nodo de WhatsApp de n8n arma ese
   objeto mal. Se comprobó contra la API que el cuerpo correcto devuelve 200 y
   el mensaje llega, así que el nodo se reemplazó por un `httpRequest` que arma
   el JSON a mano —el mismo camino que ya usa el Demo B para el QR.
2. **La cita se marcaba como recordada IGUAL.** El nodo de envío tenía
   `continueRegularOutput`, así que el error seguía de largo y `Marcar como
   recordado` escribía `[recordado]` en el evento. Resultado: el fallo se volvía
   permanente e invisible, porque al día siguiente esa cita ya estaba «hecha».
   Ahora hay una compuerta que exige el identificador de mensaje que devuelve
   Meta; sin eso, no se marca nada.
3. **No miraba la agenda de José.** `Calendarios del negocio` armaba la lista
   con el calendario del negocio y el mapa de servicios, pero NO con
   `funcionarios`. La cita de las 09:00 del día siguiente vivía en la agenda de
   José y el flujo no la veía. Es **el mismo defecto que ya se había corregido
   en el flujo de agendamiento** (`Calendarios a revisar`) y que aquí quedó sin
   corregir: cuando un dato se lee en dos flujos, arreglarlo en uno solo es
   medio arreglo. Ahora revisa cuatro calendarios en vez de tres.

**Verificado hasta donde se puede sin esperar al reloj:** la plantilla llega
(Andrés recibió el mensaje de prueba), el flujo vivo arma la lista de cuatro
calendarios incluida la de José, el envío tiene su credencial y la compuerta
está conectada. **La corrida completa se ve mañana a las 17:00**, que procesará
las citas del 8: son seis, así que van a llegar seis recordatorios.

**Detalle útil:** `publicar-flujo.sh` toma el identificador del flujo de
`N8N_WORKFLOW_ID`, así que para publicar este hay un `.env.recordatorios`
—ignorado— que hereda `.env` y solo cambia esa línea:
`./scripts/publicar-flujo.sh --env .env.recordatorios --flujo Flujos/demo-a-recordatorios.json --aplicar`

### La consola dejó de ser una maqueta: el Demo A ya lee su configuración (07/09)

Andrés lo puso en la ruta crítica con la pregunta correcta: «¿qué se necesita
para que funcione, y que un cliente no detecte que no funciona?». La auditoría
dio una causa única y dos sorpresas.

**El diagnóstico.** Lo que la consola MUESTRA era real —conversaciones, consumo,
métricas, bitácora: los flujos las escriben—. Lo que la consola GUARDA no lo
leía nadie: **ningún flujo llamaba a `configuracionFlujo`**. Configuración,
Servicios, Agenda y Pedidos eran un formulario que escribía en el vacío. El
cliente cambiaba un precio, probaba por WhatsApp, y el asistente seguía igual.

**La sorpresa que ya se veía.** Los ocho servicios del Demo A estaban cargados
**sin precio**: el sembrador nunca los escribió. La pantalla mostraba ocho filas
con «—» mientras el asistente cotizaba «Corte 70 Bs» de memoria. Cargados.

**La segunda sorpresa.** Un tratamiento dental no tiene precio fijo, y las
reglas EXIGÍAN un número. O sea que la consola no podía ni editar esos cuatro
servicios. Ahora el precio es opcional —ausente significa «a consultar», que es
la regla que el prompt ya tenía—, la moneda también, y la pantalla lo explica:
**cero no es lo mismo que a consultar**, cero dice gratis.

**Cómo quedó conectado el Demo A.** Dos nodos nuevos y un truco de nombres:

```
¿Es un mensaje? → Config base → Traer configuración → Config del negocio → Normalizar entrada
                  (los valores    (HTTP al panel,      (fusiona: la
                   de siempre)     4 s de tope)         consola pisa)
```

El nodo que fusiona **se llama** `Config del negocio`, que es como se llamaba el
Set de valores escritos a mano. Así las veinte expresiones que ya lo buscaban
por ese nombre —herramientas, prompt, nodos de salida— recogen la versión
fusionada sin tocar ninguna.

- **Falla hacia atrás, nunca hacia el silencio.** Si el panel no contesta, o
  contesta un error, se usan los valores de siempre: el peor caso es el
  comportamiento de ayer. `Config base` conserva el catálogo de respaldo, porque
  sin él un panel caído dejaría al asistente sin precios.
- **Un campo vacío en la consola no borra el de respaldo.** Un negocio a medio
  configurar se comporta como antes, no peor.
- **`estadoComercio` se toma del panel y no del respaldo**, siempre que el panel
  conteste. La intención era que esto cortara el servicio a quien dejó de pagar.
  **No alcanza, y se descubrió el mismo día:** ver «El estado del comercio no
  corta nada todavía», más abajo.
- El prompt dejó de tener el catálogo escrito a mano. Se parte por **precio**,
  no por rubro: lo que tiene precio se cotiza en el chat, lo que no, después de
  evaluar.

**Dos cosas que se arreglaron porque se vieron al comparar los dos lados:**

- **El horario sonaba a máquina.** El panel servía «lunes: 09:00-19:00; martes:
  09:00-19:00; …». Ahora agrupa los días seguidos: «lunes a sábado, de 09:00 a
  19:00; domingo: cerrado». Con cinco pruebas, incluida la que impide agrupar
  días NO consecutivos: si el negocio cierra los miércoles, «lunes a viernes»
  sería mentira y el cliente vendría un día cerrado.
- **«70 BOB» no se le dice a nadie.** Es el código ISO; en Bolivia se dice «Bs».

**Los recordatorios también quedaron conectados**, con la misma cadena y el
mismo respaldo. Ahí lo que más importa no es el texto: es el **estado**.
`Preparar recordatorios` ya cortaba cuando el comercio no estaba operativo, pero
leía un valor escrito dentro del flujo que siempre decía «operativo». O sea que
un comercio suspendido **seguía mandando plantillas, y cada plantilla la cobra
Meta**. Se dio por corregido al conectar el panel, y **no lo está**: el 409 de
un comercio suspendido cae al respaldo igual que un panel caído. Ver «El estado
del comercio no corta nada todavía».

**PROBADO EN VIVO el 07/09 de madrugada.** Se cambió el precio del corte de 70 a
85 en la base, igual que lo haría la consola, y el asistente lo dijo. Pero la
primera vez NO: contestó 70 aunque la ejecución #1176 muestra que había recibido
`Corte 85 Bs`. La causa no era la conexión sino la **memoria de conversación**,
que guarda ocho turnos y ya tenía su propia respuesta anterior con 70. Ante un
conflicto entre el historial reciente y las instrucciones, el modelo se repitió.

Se agregó al prompt que la lista de precios es la única válida, que está
actualizada **al momento de este mensaje**, y que si antes dio otro precio el
bueno es el de ahora. Con eso contestó 85. **Importa más de lo que parece:** en
un caso real un precio no cambia a mitad de conversación, pero es exactamente lo
que hace un cliente probando —cambia el precio, vuelve al chat abierto y
pregunta— y si le contesta el viejo concluye que la consola no sirve.

**Un tropiezo propio, y de los tontos.** Al renombrar `Config del negocio` a
`Config base` se actualizó todo lo que SALÍA del nodo y no lo que ENTRABA:
`¿Es un mensaje?` seguía apuntando al nombre viejo, que ahora era la fusión, y
el flujo moría con «Node 'Config base' hasn't been executed». El chat estuvo
caído tres minutos, de madrugada y sin tráfico real. Se publicaron dos flujos
sin que pasara un solo mensaje por ellos, que es justo lo que `CLAUDE.md`
prohíbe. Queda el control de nodos huérfanos como parte de la revisión.

### El catálogo se edita, y la duración va de a 15 minutos (07/09)

- **Editar en la propia fila.** Hasta ahora solo se podía dar de baja y volver a
  cargar, que además cambiaba el identificador del ítem y **rompía la referencia
  que los funcionarios guardan en `servicios`**. El nombre sigue sin editarse
  por esa misma razón: cambiarlo dejaría a los profesionales apuntando a un
  servicio inexistente y el asistente diría que nadie lo atiende. Para cambiar
  el nombre hay que dar de baja y cargar de nuevo, que es lo correcto: es otro
  servicio.
- **Quitar el precio borra el campo, no pone cero.** Cero dice gratis; ausente
  dice «se cotiza».
- **Duración en múltiplos de 15**, exigido por las reglas y ofrecido como lista
  cerrada en la pantalla. Una agenda se ofrece de a cuartos de hora: con 50
  minutos quedan huecos de 10 que no se venden y el asistente propone horarios
  como «14:50». Las catorce fichas ya cargadas cumplen; no hizo falta migrar.

**El Demo B quedó conectado el 07/09**, con la misma cadena y una diferencia que
importa: **los rótulos del cobro simulado NO se pisan con nada que venga de
afuera**, aunque el panel los mandara. `rotuloDemo`, `captionQr` y
`textoPagoSimulado` se reponen después de la fusión, de modo que ninguna clave
del panel pueda ocuparlos. Es la prohibición 3 hecha código: la garantía de que
un cobro de demostración no se presenta como real no puede depender de un campo
editable ni de que un endpoint conteste bien. Probado atacándolo: se corrió la
fusión con una respuesta que traía «Pago acreditado» en ese campo y los tres
rótulos quedaron intactos.

Su catálogo se parte por **área** —carta y tienda— y no por precio como el
Demo A, porque se ofrecen distinto. Un ítem sin precio no entra: no se puede
cobrar lo que no tiene precio.

**Y al probarlo apareció el incidente del 28 de agosto, otra vez.** Andrés pidió
algo y el asistente contestó «nuestra tienda está ubicada en la zona central de
La Paz». Se la inventó: el panel tiene la dirección vacía y ya lo sabía —su
`datosQueNoTenemos` la lista— pero el flujo del Demo B **no le pasaba ese dato
al prompt**, y su única regla contra inventar hablaba solo de «productos y
precios». El del Demo A tenía la regla completa desde el 28 de agosto.

Es la **tercera vez en dos días** que una lección corregida en un flujo no había
cruzado a otro: los calendarios de los funcionarios en los recordatorios, la
regla de no inventar acá, y antes el catálogo. Vale como criterio permanente:
**cuando se arregla algo en un flujo, hay que ir a buscar el mismo defecto en
los otros dos**, porque comparten el origen y no la corrección.

Corregido: el Demo B recibe `direccion` y `datosQueNoTenemos` del panel, y su
regla 12 ahora prohíbe inventar cualquier dato, con el ejemplo textual de la
dirección. Además `datosQueNoTenemos` dejó de repetir lo que el comercio declara
a mano y el sistema ya dedujo —«dirección del local» junto a «la dirección del
local»—, que el asistente le leía dos veces al cliente.

### Brechas de cara al primer cliente (07/09)

Andrés listó seis. Auditadas contra el código, no de memoria:

| | Brecha | Estado |
|---|---|---|
| 1 | Alias de secreto sin desplegar | **CERRADA el 07/09** |
| 2 | Alta del administrador de un comercio real | **CERRADA el 07/09** |
| 3 | Catálogo y reglas fuera del prompt | **CERRADA la noche del 06/09**, al conectar la consola |
| 4 | Retención de conversaciones | **DECIDIDA el 07/09**: 12 meses. Falta el código de la purga |
| 5 | Migrar la ingesta al rol `ingesta` | abierta, antes del segundo cliente |
| 6 | Límite de 50 eventos en la compuerta | abierta |
| 7 | **El estado del comercio no corta nada** | abierta, encontrada el 07/09 por la tarde |
| 8 | El respaldo de los flujos es el del demo | abierta; es un paso del alta, no código |

Las dos últimas salieron de escribir `Analisis/13-requisitos-alta-clientes.md`,
que es el documento de qué pedirle a un cliente y qué hace NovuChat en cada
caso, para el flujo de reservas. Ahí están también las opciones de número, de
Meta y de calendario con su recomendación, y los ajustes de redacción que
necesita la landing.

**La #2 era el bloqueo de verdad, no la #1.** Con el alias sin desplegar el alta
era incómoda; sin la #2 era **imposible**: `altaTenant` e `invitarUsuario` exigen
que la persona ya haya ingresado una vez, y la consola no tiene pantalla de
registro. Nadie podía crearse una cuenta. Ahora `alta-comercio.mjs` crea la
cuenta con una clave aleatoria que no se imprime ni se guarda y entrega un
enlace de restablecimiento; completarlo marca además el correo como verificado,
que es lo que las reglas exigen. Probado contra el proyecto real y limpiado
después.

**La #3 estaba cerrada sin que nadie lo notara.** Al conectar la consola, el
catálogo salió del prompt: hoy el System Message no tiene ni un precio ni un
nombre de servicio literal. Las reglas dejaron de ser «belleza/salud» y se
parten por precio, que es lo genérico. Queda reprobar la suite A.

**La #1, cerrada con veinte alias** (`cliente01`…`cliente20`), cada uno con su
secreto propio y con **valor real desde el primer día**, no un marcador. Las dos
razones están en `firma.ts`, y la segunda no es obvia: si el valor se creara en
el alta sería una versión nueva del secreto, y las instancias de Functions que
ya corren siguen con la vieja hasta reciclarse — el cliente recién dado de alta
fallaría de forma intermitente unos minutos, que es el peor tipo de falla.
Naciendo con su valor, en el alta no se crea ninguna versión.

Se eligió veinte secretos separados y no un solo secreto con un mapa JSON
adentro —que sería ilimitado y no necesitaría reserva— por el radio de daño: un
mapa filtrado entrega las claves de todos los clientes de una vez. Veinte
secretos cuestan poco más de un dólar al mes.

**Verificado tras desplegar:** `configuracionFlujo` responde 200 con los dos
demos y la ingesta sigue autenticando. El procedimiento de alta completo quedó
en `admin/DISENO.md` §6.1.

### Suspender un comercio NO le cortaba el asistente (07/09)

**Reportado por otra sesión de análisis, confirmado, y peor de lo reportado.**
Lo grave no es el defecto: es que yo había **afirmado por escrito** que el panel
cortaba el servicio, en `ESTADO.md` y en tres mensajes de commit, sin
comprobarlo. La conexión del panel daba este defecto por cerrado y lo había
dejado abierto.

**La cadena, exacta.** `configuracionFlujo` contesta **409** con
`{estado, mensajeCortesia}` y **sin `tenantId`** cuando el comercio no está
activo. Los tres nodos de fusión exigían `tenantId` para dar la respuesta por
buena, así que un 409 caía al respaldo — y el respaldo dice
`estadoComercio: 'operativo'` escrito a mano. Un comercio suspendido seguía
siendo atendido, y el flujo de recordatorios seguía enviando plantillas que
**Meta cobra**.

**La raíz: no se podía distinguir «el panel dice que está suspendido» de «el
panel no contestó».** Los dos llegaban como un fallo. Ahora el nodo HTTP pide la
respuesta completa —código y cuerpo— y la fusión decide con el código:

| Respuesta | Qué hace |
|---|---|
| `200` con `tenantId` | usa la configuración del panel |
| `409` | **suspendido**, con el aviso neutro que manda el propio panel |
| cualquier otra | no se pudo saber → respaldo |

**Y la política ante el silencio es distinta por flujo, a propósito:**

- **Conversacionales (A y B): siguen atendiendo.** Hay alguien esperando; una
  caída del panel no puede dejar sin respuesta a todos los comercios.
- **Recordatorios: cortan.** No espera nadie en tiempo real. Saltarse los
  recordatorios de un día se recupera; mandar plantillas que Meta cobra por un
  comercio que quizá está suspendido, no.

**Sobre `neverError`, que este proyecto prohibió el 2026-09-01:** aquel caso era
un nodo que salía verde con un 401 y nadie miraba el resultado. Acá el código se
examina explícitamente y lo que no se reconoce cae al respaldo dejando rastro.
La regla real no es «nunca `neverError`»: es **«nunca ignores el código»**.

**Tercer hallazgo, el que no venía en el reporte: el Demo B no tenía NINGUNA
compuerta de estado.** Atendía siempre, cobrara o no el negocio. El Demo A la
tenía desde el principio. Es —otra vez— la lección que no cruzó de un flujo a
otro; van cuatro. Se agregó `¿Comercio operativo?` y `Comercio no operativo`,
que corta **antes del agente**, así un comercio suspendido no consume ni tokens.

**Probado sobre el código que corre**, en los tres flujos:
`admin/pruebas/estado-comercio.test.ts` extrae la lógica del JSON y la ejecuta.
17 casos: el 409 suspende, el aviso no menciona deudas ni pagos, el activo
opera, y el silencio se comporta según la política de cada flujo.

### Las notas de Silvana sobre el catálogo de WhatsApp (07/09)

Analizadas en `Analisis/09-catalogo-nativo-de-whatsapp.md`. Sus notas quedaron en
`Demo-Recursos/catalogo-whatsapp-notas-silvana.md`, tal como llegaron.

**Lo que confirma:** el aviso del chip —no instalar WhatsApp en el número de la
API— es correcto y caro de olvidar; el catálogo nativo es la interfaz correcta
para una tienda con muchos productos; y el tope comercial es un buen instinto.

**Lo que ya no era cierto cuando se escribió:** que lo editado en la consola no
llega al asistente. Desde la madrugada del 7 sí llega, y está probado en vivo.

**Lo que el documento no sabía:** el Flujo B **ya entiende un carrito del
catálogo nativo** —`Normalizar entrada` tiene su rama `order` y lee
`product_items`—. Pero al agente le llega el SKU crudo («2 x PLAN_BASE»), así que
el punto de sincronía es que **el SKU de Meta sea el identificador del ítem en la
consola**.

**Dónde recomiendo algo distinto:** el documento propone que el cliente llene un
Google Sheets y que Meta lo consuma como origen de datos. Funciona y es más
rápido para la rueda de negocios, pero **crea una segunda fuente de verdad de los
productos**, justo después de haber pasado una noche eliminando ese problema. Con
el Sheet quedarían tres: consola, Sheet y catálogo de Meta. La ruta que aprovecha
lo hecho es que **NovuChat publique el feed que Meta consume**, leído de la
consola: una sola fuente, y el SKU sale bien por construcción. Medio día de
trabajo, después de las demos. El Sheet sirve como parche, con fecha de retiro.

**La corrección más útil, sobre el tope comercial:** el documento lo justifica por
las horas de carga, y con un feed esas horas tienden a cero. El límite real es
otro y es técnico: **el catálogo viaja dentro del prompt, en cada mensaje**, y
crece en línea recta. Con decenas no se nota; con cientos, cada respuesta cuesta
más, tarda más y elige peor. Para un supermercado la respuesta no es un prompt
más grande sino catálogo nativo con búsqueda. El tope se sostiene, pero se
explica distinto —«lo que entra en la cabeza del asistente»— y **conviene medirlo
con 20, 50 y 150 ítems antes de fijar el número**.

**DECIDIDO por Andres el 07/09:** el punto 3 de las notas —la consola arma el
catálogo de WhatsApp— **se adopta para el Flujo B**, con el feed desde la consola
en vez del Google Sheets. Y **se descarta para el Flujo A**, con su razón, que es
mejor que la técnica: en agendamiento el catálogo es **referencial**, la lista de
la que el asistente habla, no una tienda. Nadie pone un corte de pelo en un
carrito.

La razón técnica apunta al mismo lado: Meta exige precio en cada producto, así
que los servicios «a consultar» no se pueden listar y la mitad del catálogo de
una clínica quedaría afuera. Queda escrito como capacidad por flujo en
`admin/DISENO.md` §4sexies.3bis. **Una clínica no va a tener catálogo de
WhatsApp, y está bien.**

### Plataformas externas de catálogo: el carrito se puede editar (07/09)

Analizado en `Analisis/10-catalogo-plataformas-externas.md` un segundo documento
—GloriaFood, TakeApp, plantillas con Google Sheets, WooCommerce—. Tiene una
lectura comercial correcta y **un agujero que puede costar dinero**.

**Las cuatro opciones terminan igual:** la web del catálogo abre WhatsApp con un
mensaje de texto ya escrito que el cliente envía con su dedo. **Ese texto es
editable antes de mandarlo**, sin herramientas ni saber nada: se toca y se cambia
el número. Un pedido de 350 Bs llega diciendo 35.

Con el catálogo nativo de Meta eso no pasa: el mensaje `order` lo arma WhatsApp
desde el catálogo y el cliente no puede tocarlo. **Es la diferencia entera entre
las dos rutas**, y el documento no la menciona.

**Si igual se conecta una plataforma externa, hace falta una línea de prompt
ANTES:** el asistente debe reconocer los productos y **volver a cotizar contra su
propio catálogo**, ignorando los precios del texto. Hoy el prompt dice «nunca
inventes precios fuera de estas reglas», que no es lo mismo. Sin eso, el sistema
le cobra a un negocio lo que el cliente decidió.

**Y reintroducen el problema que se acaba de resolver:** los productos vivirían
en la plataforma externa y el asistente hablaría desde el catálogo de la consola.
Cuando difieran, el asistente cotiza uno y el carrito llega con el otro.

**Recomendación:** para la rueda de negocios, **no conectar ninguna**. Al cliente
del Setup Estándar —hasta 20 productos— lo cubre conectar la lista interactiva
que el Flujo B ya envía con el catálogo que la consola ya tiene: **medio día**,
sin depender de nadie y con una sola fuente de verdad. Al comercio grande le
corresponde el Setup A Medida, y ahí el catálogo nativo de Meta.

**La decisión de fondo no es técnica:** si el catálogo **es parte del producto**,
vive en la consola y NovuChat lo publica donde haga falta —más trabajo, y es lo
que sostiene el precio—; si **es del cliente**, se conecta lo que él tenga y
NovuChat cobra menos por la instalación. Las dos son defendibles. Lo que no se
sostiene es cobrar como si fuera parte del producto y conectarlo como si fuera
del cliente.
### Sobre el reporte «el estado del comercio no corta nada» (08/09)

La rama de análisis comercial traía una sección que daba este defecto por
ABIERTO. **Ya estaba cerrado** cuando esa rama se escribió: el arreglo entró por
el PR #37 (`fix/suspender-corta-de-verdad`) y está en `main` desde el 07/09 por
la noche. Los nodos de fusión examinan el código HTTP explícitamente, así que un
409 se distingue de «el panel no contestó» y corta de verdad; hay una suite que
lo comprueba contra los tres flujos (`pruebas/estado-comercio.test.ts`).

Se anota en vez de borrarlo porque la discrepancia es la lección: **dos ramas
largas sin fusionar describen sistemas distintos**, y la que documenta puede
quedar describiendo un defecto que la que programa ya cerró. Ver el orden de
fusión más abajo.

### Rama de análisis comercial: qué trae y qué le pide a las demás (08/09)

Rama `claude/novuchat-client-setup-requirements-4af84e`. **Es solo análisis: no
toca flujos, funciones, reglas ni consola.** Se registra para que las otras ramas
la lean antes de recomendar cambios, porque tres de sus conclusiones afectan
trabajo que ya está hecho en ellas.

| Documento | Qué resuelve |
|---|---|
| `Analisis/13-requisitos-alta-clientes.md` | Qué pedirle a un cliente y qué hace NovuChat para activarlo: número, Meta, calendario, ficha de alta y el procedimiento paso a paso |
| `Analisis/14-costo-por-conversacion-y-precios.md` | Costo real por conversación con las tarifas del 1-oct, margen por plan, escala a 100 y 300 comercios, y las opciones de mejora cuantificadas |
| `Analisis/14-modelo-costos.py` | El modelo, reproducible sin dependencias |
| `Analisis/15-unidad-de-cobro.md` | Si conviene cambiar de unidad de cobro. Decidido: no |
| `Analisis/16-sensibilidad-topes-y-bolsas.md` | Sensibilidad del tope de mensajes y de las bolsas. Dos correcciones a lo propuesto |
| `Analisis/17-resumen-ejecutivo-precios.md` | **Para Silvana.** Todo lo anterior sin tecnicismos, con lo que hay que decidir y cuándo |
| `Analisis/18-cambios-en-sitio-y-presentacion.md` | Instrucciones exactas, archivo por archivo, para corregir `novuchat.site` y la presentación |
| `Analisis/19-catalogo-web-y-precio-por-flujo.md` | Cuántos ítems van al prompt y al catálogo web, y si conviene cobrar distinto por flujo. Las dos respuestas: el corte no es económico, y no conviene |
| `Analisis/20-un-flujo-para-todos-los-clientes.md` | Si un mismo flujo de n8n puede atender a todos los clientes. Sí, y el bloqueo es una credencial que se elimina con un trámite de Meta |

**Lo que esta rama le pide a cada una, y por qué:**

- **A `claude/novuchat-prepago-clientes-49caf7`:** la arquitectura del prepago
  es correcta y no hay que tocarla, pero está cargada con **Base 300 /
  Crecimiento 1.000 / Corporativo 2.500 y bolsas de 150 a 50 Bs**, que desde el
  1 de octubre dejan los tres planes en pérdida. La propuesta conservadora es
  **120 / 200 / 300 conversaciones**, y **la bolsa a 25 por 110 Bs** en lugar de
  150 por 50: la actual cobra el 22 % de lo que cuesta y **pierde 176 Bs cada vez
  que se vende**, más que el margen entero de un plan Impulso. El arreglo es la
  tabla de `functions/src/prepago.ts` y sus pruebas, y **conviene hacerlo antes
  de desplegar**, para no migrar cuentas ya creadas. El detalle y la
  sensibilidad, en `Analisis/16-sensibilidad-topes-y-bolsas.md`.
- **Sobre el tope de mensajes:** el escalonado por plan (20 / 25 / 30) está al
  revés. Ser generoso cuesta 0,8 % del precio en Impulso y 6,4 % en Crecimiento,
  porque el plan chico vive dentro de la franquicia de Meta. Pero un plan caro
  con tope más chico es invendible, así que **la recomendación es un tope único
  de 25 para los tres**, fijado por calidad de servicio y no por plan.
- **A `disenio/catalogo-web`:** el catálogo web deja de ser una mejora de
  producto y pasa a ser **la mayor reducción de costo del sistema**: lleva un
  pedido de unos 13 mensajes a 4 o 5, un 68 % menos. Vale como argumento para
  priorizar los dos nodos de n8n y la plantilla que le faltan. Y le toca
  renumerarse de `11-` a `12-`.
  **Y una corrección a su diseño** (`Analisis/19`): el umbral que propone —
  catálogo chico al prompt, grande solo al checkout— es correcto, pero **no lo
  fija el costo**. Con la caché puesta, 500 ítems en el prompt cuestan menos que
  medio mensaje del asistente. Lo que fija el umbral es la legibilidad del chat
  y la confiabilidad del modelo: hasta 40 ítems la lista completa, por encima un
  resumen con categorías y rango de precios.
- **A `fix/suspender-corta-de-verdad`:** confirmar que la corrección cubre los
  **dos** caminos del 409, porque el prepago agrega el suyo (`sin_pago`,
  `sin_conversaciones`) sobre el mismo mecanismo.
- **A quien toque un flujo:** desde octubre cada mensaje del asistente cuesta
  0,1356 Bs. **Todo cambio de flujo debería declarar cuántos mensajes agrega o
  quita**, igual que hoy declara qué prueba lo cubre.
- **A quien piense la arquitectura de n8n:** el flujo **ya está parametrizado**
  —los nodos eligen número y comercio por expresión, y la configuración llega
  del panel—. Lo que obliga a un flujo por cliente es **una credencial**: la del
  disparador, porque cada app de Meta tiene un solo webhook. **No construir el
  nivel intermedio** de un flujo con varios disparadores: obliga a que el token
  viaje en los datos de ejecución y se tira cuando llegue Tech Provider. Detalle
  en `Analisis/20`.

**La base comercial quedó en `CLAUDE.md`**, sección «Base comercial — el dinero
de cada decisión técnica», para que las sesiones y los agentes la tengan sin
leer los siete documentos: cuánto cuesta cada mensaje, el tope de 25, los
precios en dólares con el TCO del BCB, qué tiene que mostrar la consola, el
corte del catálogo en 40 ítems, y lo que no hay que hacer.

**Dos cosas que hay que hacer antes de vender, salgan de donde salgan:**
publicar el tope de mensajes —la frase «sin importar cuántos sean» de
`novuchat.site/precios` deja de ser cierta— y mostrar los mensajes en la consola
junto a las conversaciones.

### Para después del congelamiento (pedidos de Andres del 05 y 06/09)

- **Alta y administración de negocios por el equipo de NovuChat:** crear el
  negocio con nombre, razón social, NIT, dueño y administrador con sus datos;
  editarlo; asignarle período de prueba; crear administradores; asignarle un
  plan como en `/precios`; ver y recargar el saldo de conversaciones; controlar
  la mensualidad.
- **Rol contador:** ingresa los depósitos por negocio (a cuántas mensualidades
  corresponden, con descuento por pago adelantado); el superadministrador los
  aprueba.
- **Verificar que cada promesa de `/precios` sea factible o esté marcada
  «próximamente»** (el prompt de la landing cubre las tres que no lo eran).
- Google como método de ingreso para comercios (sección propia más arriba).
- Conectar los flujos a `configuracionParaFlujo` y devolver los doce campos.
- `firebase-tools` 15 (cierra seis avisos de Dependabot sobre `tar`, solo
  desarrollo).

### Prepago, alta de clientes y flujo interno de cobro (07/09, noche)

Andres trajo nueve pedidos de la reunión con Silvana. Están todos construidos y
probados en local; **nada desplegado, nada probado con teléfono**. El documento
de referencia es `Analisis/11-prepago-y-alta-de-clientes.md`: modelo, supuestos
a confirmar, lista de lo que hace falta, y el plan para el miércoles.

**Lo que hay:**

- **`admin/functions/src/prepago.ts`, puro.** Planes de la presentación,
  `estadoDeServicio()`, consumo de bolsas, `aplicarPago()`,
  `recordatoriosDebidos()` y los cuerpos de las tres plantillas. Lo usa el
  servidor para cortar y lo importa la consola para mostrar el saldo: un solo
  cálculo, dos lectores. 45 pruebas mes por mes.
- **El corte es un 409.** `configuracionFlujo` e `ingesta` contestan
  `{ estado: 'sin_pago' | 'sin_conversaciones', mensajeCortesia }`, el mismo
  409 y el mismo texto de la suspensión. **Los tres flujos ya sabían qué hacer
  con él**: cortan sin cambios. La ingesta decide dentro de la transacción que
  ya leía la conversación, descuenta la bolsa que toque y anota el corte con
  los mensajes perdidos desde entonces.
- **La conversación abierta se respeta.** Al agotarse las conversaciones se
  corta ABRIR nuevas; el cliente a mitad de un pedido lo termina. Exige que
  «Traer configuración» mande `from`: está en los JSON de A y B, **falta
  republicarlos**.
- **Consola:** «Dar de alta un negocio» con todos los datos (crea la cuenta del
  administrador y muestra el enlace de contraseña una vez), «Cuenta» por
  negocio para NovuChat (ficha, plan, saldo, **pagos por confirmar**, pago
  visto por fuera, configuración a mano), estado de cuenta del comercio con
  saldo y cómo pagar, columna «Servicio» en la cartera. Funciones nuevas:
  `editarTenant`, `configurarCuenta`, `registrarPago`, `confirmarPago`,
  `rechazarPago`; `altaTenant` extendida.
- **Flujo interno `novuchat-cobro-prepago.json`**: menú (renovar, cambiar de
  plan, bolsa, saldo), QR real de NovuChat por su ficha, comprobante reenviado
  al celular de NovuChat. Sin agente de IA, a propósito. La lógica está en
  `cobroTextos.ts` (puro, 23 pruebas) y el nodo `Despachar respuesta` se prueba
  desde el JSON: ante cualquier error del servidor, texto de error temporal y
  nada de menú ni QR.
- **Flujo `novuchat-recordatorios-prepago.json`**, dos veces por día, marca
  solo con el id de mensaje de Meta.
- **Reglas:** `/pagos` de solo lectura para el admin del comercio y NovuChat;
  tres tipos nuevos de bitácora. **Scripts:** `alta-comercio.mjs` extendido,
  `asignar-numero.mjs`, `activar-cobro-novuchat.mjs`.
- **Suite: 445 pruebas** (92 nuevas). Saneo en cero.

**Supuestos que conviene confirmar con Silvana** (tabla completa en el
análisis): la bolsa no sostiene el servicio sin mensualidad; las 20 de prueba
se pierden al contratar; un pago cubre el mes en curso si no está cubierto y si
no el siguiente, sin prorrateo; cambiar de plan es pagar el plan nuevo.

**Lo que hace falta para que exista de verdad** (detalle en el análisis §5):
un número real de NovuChat en la Cloud API **con su propia app y webhook** (una
app tiene una sola URL; el enrutador sigue pendiente), el negocio `novuchat`
con su QR de comercio registrado y encendido, las tres plantillas aprobadas por
Meta, las credenciales y los dos flujos en n8n, y el despliegue de Functions,
reglas y consola.

**Recomendación para la semana:** no desplegar antes de los demos; dar de alta a
los primeros clientes el 9 con `alta-comercio.mjs` en **mes de prueba**
(funciona con o sin las Functions nuevas: si el servidor viejo corre, no lee la
cuenta y no corta); desplegar el 10 a la noche o el 11 y correr la prueba real
del análisis §5.6; número interno, QR y plantillas la semana del 14. El primer
corte posible es el 1 de octubre.

## Riesgos vivos para el 9–10 de septiembre

**Actualizado el 2026-09-07.**

- **El recordatorio de las 17:00 sigue sin verse correr solo.** Se corrigieron
  sus tres defectos y se verificó todo lo verificable sin esperar al reloj, pero
  la corrida completa es hoy.
- **Se movió mucho el 6 y el 7.** Tres funciones desplegadas, los tres flujos
  republicados, reglas y consola. Todo verificado pieza por pieza, pero la
  acumulación es el riesgo: conviene que la suite A pase entera antes de dar
  nada por bueno.
- **Cambio de modelo = revisar detectores.** Ya rompió una vez en silencio.
- **Credencial de Google Calendar.** La app está publicada, pero si una cita
  falla con el flujo en verde, es la credencial: reconectar, no depurar.
- **`executionTimeout` de 60 s**: el guion conserva la salida manual a los ~20 s.
- **Solo 5 destinatarios**: el guion contempla prestar un celular al público.
- **Números de la consola en la demo.** Se llenan con lo que se haga en el
  ensayo. Números chicos y coherentes convencen más que números grandes que no
  cierran.

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

1. **07/09, hoy — Ensayo con Silvana.** Suite A de
   `Demo-Recursos/checklist-ensayo.md` completa, en los dos demos, con teléfono
   real. Dejar una cita agendada para el 8. Probar el pedido del Demo B con
   comprobante como foto Y como archivo.
2. **07/09, 17:00 — Los recordatorios.** Tienen que llegar SEIS, uno por cada
   cita del martes 8. Es lo único que nunca se vio correr solo. Si no llegan, la
   ejecución dice por qué: desde ayer un envío fallido ya no marca la cita como
   recordada.
3. **08/09 — Congelamiento.** Confirmar que `main` es lo que corre; borrar el
   secreto OAuth viejo si ya nada lo usa; video de respaldo. **No tocar nada
   más**: en las últimas horas se desplegaron funciones, se republicaron los
   tres flujos y cambiaron reglas y consola.
4. **09 y 10/09 — Demos.**
5. **Después de las demos, en este orden:**
   - **Prepago en producción** (`Analisis/11`, §5 y §6): desplegar Functions,
     reglas y consola; republicar A y B con el `from`; prueba real con un
     negocio de prueba; número interno de NovuChat con su app; negocio
     `novuchat` y su QR; plantillas en Meta; los dos flujos internos en n8n.
     Confirmar con Silvana los supuestos del §1.2.
   - Cobro real de punta a punta: que el flujo lea `cobroReal`, los tres nodos
     del OCR, y el control para encenderlo.
   - Brecha 6: la compuerta de reserva con dos consultas dirigidas en vez de
     subir el límite de 50.
   - Brecha 5: migrar la ingesta al rol `ingesta`.
   - La purga de retención a 12 meses.
   - Rediseño de la consola con el diseño de `novuchat.site`, y los tres PDF.
   - Alta y administración de negocios desde la consola, y el rol contador.
   - `prompt-landing-precisiones.md` en la landing; `firebase-tools` 15; sumar a
     Silvana como revisora en GitHub (§4).

**Decidido por Andres el 07/09**, sobre `Analisis/08-qr-simple-lo-que-cambia.md`:

1. **NovuChat SÍ se integrará a bancos, pero en una etapa posterior**, cuando
   `~/ManejoQRSimple` esté listo. No ahora.
2. **Se usa `ManejoQRSimple`, no se reimplementa.** Sin esfuerzos duplicados.
3. **OpenBCB se sigue** como buena noticia para el mediano plazo.

**Lo que eso fija para el cobro real de NovuChat.** Queda como el nivel **«sin
API del banco»** —el comercio sube su QR y el asistente coteja el comprobante—
y **así hay que venderlo**: el asistente nunca dice «pago acreditado», porque en
este nivel no lo sabe. Es lo correcto para la mayoría de los comercios hoy, y no
es un parche a la espera de otra cosa.

**Y fija un límite de alcance que conviene respetar:** todo lo que sea hablar
con un banco —generar QR por pedido, consultar el estado de un pago, conciliar—
**no se escribe en este repositorio**. Cuando llegue esa etapa, NovuChat consume
`ManejoQRSimple` a través de sus puertos (`QrProvider`, `PaymentWatcher`), que
ya están pensados ahí. Si alguna vez aparece código de integración bancaria en
NovuChat, es señal de que se está duplicando el esfuerzo que esta decisión
justamente evita.
