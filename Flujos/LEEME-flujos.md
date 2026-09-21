# Flujos n8n de los demos NovuChat — guía de importación y puesta en marcha

> **Archivos:** `demo-a-agendamiento.json` (reservas, con Google Calendar
> real) y `demo-b-venta-cobro.json` (venta con QR simulado y alerta al
> dueño), más los que se fueron sumando: la captación de NovuChat (§7), los
> clientes de reservas (§8) y los flujos programados de recordatorios,
> seguimientos y señas vencidas. El código de los nodos y los prompts viven
> en módulos (§0).
> **Destino:** n8n 2.36.5 en `${N8N_BASE_URL}`.
> **Referencia normativa:** `NovuChat/Analisis/02-criterios-implementacion.md`
> (los criterios que cada flujo hace cumplir por código; los flujos ya no
> llevan sticky notes) y el cronograma de `03-plan-demos.md`.

Ambos flujos parten de los borradores de Silvana (`Preliminares/gemini-code-*`)
con todas las correcciones del análisis aplicadas: memoria con clave de sesión
por teléfono, filtro de acuses de estado, parser de tipos de mensaje, fecha y
hora de Bolivia inyectadas al prompt, Gemini como modelo (intercambiable por
Claude en producción), herramientas de Calendar reales, QR rotulado como
simulacro, marcas `[TRANSFERIR]` / `[ENVIAR_QR]` / `[PEDIDO_CONFIRMADO]` para
las bifurcaciones, y cero secretos dentro de los nodos.

---

## 0. Los JSON de esta carpeta son lo que se importa; su código y sus prompts viven en módulos

**Lo que se importa a n8n y lo que se versiona sigue siendo el JSON.** Nada
de la topología, los nombres de nodo, las conexiones, las credenciales ni el
`webhookId` se genera desde otro lado. `publicar-flujo.sh`,
`preparar-import.sh` y `verificar-saneo.sh` buscan nodos por nombre en el
JSON y no cambiaron.

**Desde el 20/09/2026, el JavaScript de los nodos Code y los prompts de los
agentes viven ADEMÁS en módulos versionados**, y un ensamblador los inyecta
en el JSON:

| Carpeta | Qué hay |
|---|---|
| `Flujos/src/comun/` | Los nodos Code que existen con el mismo nombre en todos los verticales conversacionales (`Normalizar entrada`, `Procesar respuesta`, `Config del negocio`, `Comercio no operativo`, `Uso extendido`). Hoy llevan la versión del vertical de reservas; el Demo B y la captación tienen la suya, y conciliarlas es del bloque B-2 |
| `Flujos/src/reservas/` | Los trece nodos Code que solo existen en los flujos de reservas (el candado `Comprobar reserva`, la seña, los medios, el reintento tras cruce) |
| `Flujos/prompts/reservas/` | El `systemMessage` de Sofía, uno por flujo (`demo-a.md`, `platinum.md`); el turno del cliente (`turno-del-cliente.md`) y el reintento tras cruce, compartidos |
| `Flujos/manifiestos/<flujo>.json` | Qué nodo de ese JSON toma qué archivo, **por nombre de nodo**. Nunca hay marcadores dentro del código |
| `admin/scripts/ensamblar-flujo.mjs` | `verificar` (ensambla en memoria y compara byte a byte; sale con 1 si difiere), `ensamblar` (módulos → JSON) y `extraer` (JSON → módulos) |
| `admin/pruebas/ensamblador.test.ts` | La prueba de identidad: para cada JSON con manifiesto, ensamblar reproduce el archivo byte a byte; `extraer` y volver a ensamblar es la identidad; un módulo cambiado o un nodo renombrado hacen fallar con el nombre; y ningún módulo contiene un valor real |

**Regla:** el JSON y sus módulos tienen que ser **idénticos byte a byte**, y
`node admin/scripts/ensamblar-flujo.mjs verificar` lo comprueba para los ocho
archivos. Los que todavía no tienen manifiesto (al 20/09: seguimientos, señas
vencidas, Bellido, recordatorios, Demo B y captación) se verifican como «sin
manifiesto: idéntico por definición», y pasan a módulos en el bloque B-2.

### 0.a Por qué se retiró un generador en agosto de 2026, y por qué esto no es aquello

Hasta el 2026-08-28 existía `build_flows.py`, que producía los JSON enteros
desde Python. Se retiró porque era una **segunda fuente de verdad que solo
podía divergir**: nadie edita Python después de tocar el lienzo de n8n, y de
hecho ya había divergido —seguía produciendo la versión vieja del Demo B,
sin las tres compuertas que hacen cumplir la prohibición 3—. Correrlo habría
revertido eso en silencio.

El ensamblador de hoy responde a esa objeción punto por punto:

1. **No produce topología.** No crea nodos, conexiones, credenciales ni
   posiciones. Parsea el JSON que ya existe y muta en sitio exactamente dos
   cosas: `parameters.jsCode` de un nodo Code, y
   `parameters.options.systemMessage` / `parameters.text` de un agente. Todo
   lo demás del archivo queda como estaba, incluido el orden de las claves
   (`demo-a-recordatorios.json` tiene otro orden de primer nivel y se
   conserva).
2. **La identidad byte a byte impide divergir mecánicamente.** Aquel
   generador podía producir algo distinto del lienzo y nadie se enteraba.
   Acá `verificar` compara lo ensamblado con el archivo con `Buffer.equals`,
   y la suite lo exige en CI: un byte distinto es una prueba en rojo, no una
   sorpresa en producción.
3. **Trae la inversa, `extraer`, que `build_flows.py` nunca tuvo.** El ciclo
   real —editar en n8n, exportar, reemplazar el archivo— sigue existiendo y
   ahora termina en `extraer`, que lleva a los módulos lo que cambió en n8n.
   Aquel generador solo iba en una dirección, y por eso el lienzo lo dejaba
   atrás.
4. **Los `REEMPLAZAR_*` no entran en ningún módulo.** Viven en el nodo
   `Config base` del JSON (`Config del negocio` en la captación), y el
   manifiesto lo declara en `conservanMarcadores`; `verificar` comprueba que
   el prefijo sigue ahí. `preparar-import.sh` y `verificar-saneo.sh` no
   cambiaron.

### 0.b El ciclo de trabajo, ahora

- **Se cambia una regla del código o del prompt:** se edita el módulo en
  `Flujos/src/` o `Flujos/prompts/`, se corre
  `node admin/scripts/ensamblar-flujo.mjs ensamblar`, y se commitean juntos
  el módulo y el JSON. Un módulo compartido cambia a la vez el Demo A y
  Platinum: es lo que hace real «un cambio se aplica a todos o a ninguno»
  (`Analisis/20` §5).
- **Se edita en la interfaz de n8n:** se exporta (⋯ → Download), se sanea
  (los valores reales de `Config base` vuelven a ser `REEMPLAZAR_*`), se
  reemplaza el JSON y se corre
  `node admin/scripts/ensamblar-flujo.mjs extraer <flujo>.json`. Los módulos
  reciben lo que cambió; si un módulo compartido cambia, el comando lo avisa,
  porque el otro flujo que lo usa va a dejar de verificar hasta que se
  ensamble también.
- **Antes de cada commit:** `node admin/scripts/ensamblar-flujo.mjs verificar`
  en 0 y `scripts/verificar-saneo.sh` en 0. El gancho de pre-commit que lo
  exige es del bloque B-4.
- **Un flujo nuevo de un vertical que ya tiene módulos** (un cliente de
  reservas) se crea con `extraer --nuevo <carpeta>` y después se edita el
  manifiesto para apuntar a `comun/` y `reservas/` lo que comparte, igual que
  `platinum-agendamiento.json` hoy: su manifiesto es el del Demo A con otro
  archivo para el prompt de Sofía.

Dos convenciones que sostienen la identidad: el archivo de un módulo es el
contenido más **un** salto de línea final (es lo que dejan los editores y el
gancho `end-of-file-fixer`), y cuando el contenido real termina en salto de
línea el manifiesto lo marca con `saltoFinal: true`. Los prompts van en `.md`
porque el gancho `trailing-whitespace` no toca los `.md`: si un prompt
llevara un espacio al final de una línea, el gancho no lo quitaría y la
identidad no se rompería.

`Demo-Recursos/build_recursos.py` **sí se conserva**: genera artefactos
derivados (`calendario-demo-relleno.ics`, `qr-demo.png`) que nadie edita a
mano en otra herramienta, así que ahí el script es la fuente legítima.

Y dos salvaguardas: las rutas del manifiesto tienen que quedar bajo
`Flujos/src/` o `Flujos/prompts/` (una entrada con `../` se rechaza en las
tres operaciones, nombrando la ruta), y la carpeta de `extraer --nuevo` es un
nombre simple (`[a-z0-9-]+`).

**Pendiente para B-2:** hoy `extraer` sobreescribe un módulo compartido con
un aviso y sale con 0. Cuando el módulo lo referencia otro manifiesto tiene
que salir con código 3 y no escribir, salvo `--forzar`: si no, un export de
Platinum puede pisar en silencio el código que también corre en el Demo A.

### 0.c Lo que sigue en el JSON a propósito (propuesta para B-2)

Entre el Demo A y Platinum difieren, además del prompt de Sofía, la expresión
`end` y la `toolDescription` de `agendar_cita` (la duración de la cita) y el
`textBody` de `Avisar a recepción`. En este bloque quedan en el JSON: son
texto de un nodo que no es Code ni agente, y sacarlos exigiría un tipo más de
punto de inyección. Lo que se propone para B-2 es un prompt en capas —un
`base.md` del vertical más las variables por tenant (nombres, ejemplos del
rubro, duración)— que reproduzca cada `systemMessage` byte a byte a partir de
una plantilla; hasta que esa reproducción exista, un archivo por flujo es la
única forma que no cambia el texto.

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
| Header Auth para Graph API | Header Auth | Nodos `Enviar a WhatsApp`, `Enviar texto de respaldo` y `Avisar a NovuChat` (captación). El Demo B ya no la usa: su nodo «Lista interactiva de bienvenida» se retiró el 07/09 | Nombre `Authorization`, valor `Bearer <token permanente>`. **Nunca** la credencial de ingesta: al importar, n8n asigna la única Header Auth que exista a todos los nodos de ese tipo (pasó el 15/09) |

## 3. Completar el nodo `Config base` de cada flujo

Es el único lugar del JSON donde hay valores del negocio (criterio B-8): el
nodo Set `Config base` (`Config del negocio` en la captación) lleva los
campos con prefijo `REEMPLAZAR_`, y `Config del negocio` —un nodo Code, en
`Flujos/src/comun/`— los fusiona con lo que responde el panel. Los completa
`scripts/preparar-import.sh` desde `CONFIGURACION.local.md`, nunca a mano.
Campos con prefijo `REEMPLAZAR_`:

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

**Desde el 15/09 es un flujo genérico** (`admin/DISENO.md` §4sexies.5): lo que
el asistente ofrece sale de la consola, no del JSON. NovuChat es su primer
usuario, con el asistente «Kenji».

> **Todavía no se publica para otro comercio.** El prompt, el mensaje de uso
> extendido, el botón de cliente actual y la base de conocimiento (el corpus de
> novuchat.site, con el teléfono de contacto de NovuChat) nombran a NovuChat a
> mano. Publicado para un comercio X, sus prospectos recibirían la oferta y el
> contacto de NovuChat. Antes del segundo comercio: esos textos pasan por
> `nombreNegocio` y `enlaceConsola`, y el corpus se condiciona al tenant
> `novuchat` (revisión de seguridad del 15/09, LOW-2).

### Qué hace

1. **Compuerta inicial, sin modelo.** A un «hola» suelto le responde con dos
   botones: «Soy cliente actual» y «Soy cliente nuevo». Quien ya escribió lo que
   quiere («hola, ¿cuánto cuesta?») pasa directo al asistente.
2. **Cliente actual, sin modelo.** Un mensaje con el enlace a la consola, cómo
   recuperar la contraseña y un botón a una persona. **Sin código de acceso.**
3. **Cliente nuevo** (guion de Silvana, 15/09). El asistente se presenta con el
   nombre de la consola («Kenji» en NovuChat) y pide **en una sola pregunta** el
   nombre de la persona y el de su empresa. **Deduce el rubro** solo si el nombre
   de la empresa trae una palabra del oficio, y lo dice de forma que el cliente
   pueda corregirlo; si no, muestra la lista numerada de rubros de la consola
   (marca `[RUBROS]`) y el número se resuelve por código. Después, en el mismo
   mensaje, la solución de ese rubro y los planes y cargos únicos armados por
   código con los precios exactos de la consola (marca `[PLANES]`), con el botón
   de respuesta **«Hablar con un asesor»**. Registra empresa, contacto, rubro,
   personalización y consulta (`[LEAD]…[/LEAD]`); **ya no pide el NIT**. Con
   empresa, contacto y rubro cierra (`[CIERRE]`) y avisa por la plantilla
   `solicitud_contacto`; en ese cierre completo no va botón.
4. **Traspaso, sin modelo.** Tocar «Hablar con un asesor» (o escribir que quiere
   un asesor) responde «Ya le pasé tus datos a nuestro equipo…», avisa una sola
   vez por la plantilla (nunca al propio número de recepción) y cierra la etapa.
   Con horario de atención dice cuándo; sin horario, «lo antes posible».
5. **Topes.** En la respuesta 25 (fin del primer bloque, editable en la pestaña
   «Captación») ofrece un asesor con el mismo botón y sigue. **El techo de costo es el
   del servidor**, igual que en A y B: al umbral de operador de la cuenta (50)
   responde un mensaje fijo y avisa; al de bloqueo (100) no responde nada. Los
   dos se obedecen antes de llamar al modelo.
6. **Idempotencia.** Un reenvío de Meta con el mismo id de mensaje no se
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

### Configuración por consola

El flujo trae la oferta de la consola en cada turno (`Traer configuración`), y
lo que dice la consola manda sobre el corpus del sitio y sobre el respaldo de
`Config base`:

| Qué | Dónde | Cómo lo usa el asistente |
|---|---|---|
| Nombre del asistente | `config/negocio.nombreAsistente` (común) | Se presenta con él; si le preguntan, dice que es una IA |
| Rubros | `config/onboarding.rubros` | Reconoce el rubro del prospecto, le ofrece la solución de ese rubro y el flujo sugerido |
| Planes | `config/onboarding.planes` | **Hasta 5, en texto** dentro de la respuesta. **Desde 6, el archivo** de `archivoPlanes` (PDF o imagen), que es obligatorio en ese caso |
| Cargos únicos | `config/onboarding.cargosUnicos` | Instalación y demás; `desde: true` se dice «desde» |
| Aclaraciones | `config/onboarding.aclaraciones` | **Solo si le preguntan** (qué es una conversación, la bolsa, el prepago, la moneda) |
| Horario de atención | `config/negocio` | **Opcional.** Si está, lo usa para decir cuándo contesta una persona; si no, no promete un horario |

Precios siempre en dólares: el asistente no calcula bolivianos (se cobra al
Tipo de Cambio Oficial del BCB, Base comercial §3).

**Botón «Hablar con un asesor».** Es la salida hacia una persona. Va dentro de
la misma respuesta, nunca como un mensaje aparte: con los planes, al final del
primer bloque (`topeAviso`) y en un `[CIERRE]` al que le faltan datos. En el
cierre completo no va, porque la persona ya fue avisada y el botón solo
invitaría a un mensaje pagado que repite el traspaso.

**Mensajes:** la configuración no agrega mensajes. El archivo de planes tiene
que salir **en lugar** del texto de ese turno (documento o imagen con el texto
en el pie), nunca además: si saliera aparte, sumaría 1 mensaje por cada
conversación que pregunte por planes.

**Carga inicial:** desde la pestaña «Captación», o con
`node admin/scripts/cargar-captacion.mjs --proyecto <id> --tenant <id> --archivo <json>`
(primero en seco). El contenido de NovuChat está en
`admin/scripts/datos/captacion-novuchat.json`, copiado del sitio.

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

---

## 8. Flujo de reservas de Clínica Platinum (`platinum-agendamiento.json`)

**Primer cliente con el flujo de agendamiento** (15/09/2026; demo el 16/09).
Clínica dental y de estética facial en Santa Cruz. Es una copia del Demo A
vigente —59 nodos, umbrales del servidor, prefijo cacheable, `nombreAsistente`,
candado contra la doble reserva, dirección con enlace a Maps, seña por QR— con los datos del
cliente y **un solo mecanismo nuevo**: la sección `INFORMACIÓN DEL NEGOCIO` del prompt, que inserta
`instruccionesExtra` (el texto libre de hasta 1.500 caracteres que el comercio
escribe en su consola) **delimitado y rotulado como dato**, después de las
reglas de comportamiento y de las herramientas; si contradice una regla, manda
la regla. `Config del negocio` toma el de la consola si viene con contenido y,
si no, el respaldo de `Config base` (misma regla que los demás textos). La
fuente de los textos es `CLIENTES/PLATINUM/conocimiento-asistente.md`, carpeta
local: si cambia ahí, cambia en `Config base` y en la consola.

Lo demás que difiere del Demo A: trato de **usted** y pocos emojis (repertorio
dental), dos agendas —«Dr. Christyan Sandoval» y «Dr. Juan Pérez», nombre
provisional hasta que la clínica lo confirme— cada una con su calendario, los
ejemplos del prompt en clave dental, la **duración por servicio** en el prompt y
en `agendar_cita` (60 minutos el blanqueamiento, 30 la valoración clínica y
cualquier otro), el rótulo del aviso a recepción, y las credenciales con nombre
propio e id vacío: «NovuChat ingesta (Clínica Platinum)» en los cinco nodos
HTTP de ingesta y «WhatsApp Clínica Platinum (envío)» en los dos de WhatsApp y
en `Enviar ubicación`. `publicar-flujo.sh` asigna por ese nombre y avisa si no
existe.

**Mensajes por conversación: los mismos que el Demo A.** No agrega ni quita
ninguno: 1 respuesta por turno, el aviso a recepción solo en los casos de
siempre (tres rechazos, reserva no verificada, umbrales del servidor).

**Dirección con enlace a Maps y pin a pedido (17/09/2026, `Analisis/34` §2),
igual en el Demo A.** `Config del negocio` toma `direccionMaps` de la consola
(validado por dominio: solo Google Maps, porque es lo único que el asistente
reenvía tal cual) y las coordenadas de `operacion.ubicacion`; el prompt pone el
enlace junto a la dirección en §6, pide dirección y enlace dentro de la
confirmación (§4) y ante «¿dónde quedan?» (6c): **0 mensajes nuevos**. Solo si
el paciente pide expresamente la ubicación, el modelo termina con
`[ENVIAR_UBICACION]` y, si el comercio cargó coordenadas, `¿Enviar ubicación?`
→ `Enviar ubicación` (HTTP a Graph, `type: location`) → `Reportar ubicación
(saliente)` (tipo `location`): **+1 mensaje, solo en ese caso**, contado como
cualquier saliente. Cuelgan de `Responder al cliente`, debajo del reporte del
texto (orden v1: el texto se reporta primero). Sin coordenadas la marca se quita
y no se manda nada. Un pin rechazado por Meta sale por la salida de error del
nodo y no se reporta. Suite: bloque (j) de `platinum-flujo.test.ts`, sobre los
dos flujos.

**Seña por QR con cotejo del comprobante (bloque 2, `Analisis/30` §4,
`Analisis/07` §4), igual en el Demo A.** La clínica pierde horarios con
pacientes que reservan y no van; la seña —una fracción del tratamiento, pagada
por QR al reservar— los filtra. Es **cobro real**: el QR es el del comercio
(`registrarQrDeCobro`, pestaña «Configuración de QR» de agendamiento) y el
dinero va a su cuenta, así que rige la prohibición 3 de CLAUDE.md en cada texto.
Se enciende desde la consola con `senaImporte` (0 = sin seña) y
`senaMinutosRetencion` (5..180) en `config/agendamiento`; el panel se lo cuenta
al flujo en `configuracionFlujo.sena`, y sin seña **no cambia nada**.

Cómo funciona, de punta a punta:

1. **La cita se retiene por hecho.** Con la seña activa, `agendar_cita` crea la
   cita con el título `PENDIENTE DE SEÑA · Cita <nombre> — <servicio>` y suma
   `Seña pendiente: N Bs` a la descripción: lo pone la expresión del nodo, no
   el modelo. El prompt lleva el bloque `SEÑA PARA RESERVAR` solo con la seña
   activa (importe y minutos interpolados por negocio: sigue siendo cacheable)
   y le dice al modelo que **no** confirme la cita: el horario queda reservado
   N minutos a la espera de la seña, y el comprobante se manda por este chat
   antes de salir de la app del banco. `Procesar respuesta` suma la red de la
   prohibición 3 con cobro real: si el modelo escribe «pago acreditado»,
   «recibimos tu pago» o similar, esa oración se reemplaza por «El comprobante
   lo revisa <negocio> y ellos confirman el pago» y queda `correccion_cobro`
   en `avisos`.
2. **El QR sale después del texto.** De `Comprobar reserva` cuelga, **debajo
   de todas sus otras salidas**, `¿Enviar QR de la seña?` (cita verificada, seña
   activa, sin cruce) → `Preparar seña` (caption con servicio, día, hora, quién
   atiende, la seña, la instrucción de guardar el comprobante antes de salir de
   la app y los minutos de retención; ≤ 1.024 caracteres; usted o tuteo según
   la configuración) → `Enviar QR de la seña` (HTTP a Graph, `type: image` con
   el `link` del QR del panel) → `Reportar QR (saliente)` (ingesta, tipo
   `image`, `evento: qr_enviado` con la cita retenida y su calendario: desde
   ahí el servidor sabe que la próxima foto o PDF de ese teléfono es el
   comprobante). Si Meta rechaza el QR, sale por la salida de error a `QR no
   enviado` → aviso a recepción, y no se reporta. Con la seña activa `¿Hay cita
   verificada?` **no** registra el cierre: lo crea el servidor al cotejar.
3. **El comprobante no va al modelo.** `Normalizar entrada` marca
   `esComprobante` cuando llega una foto o un PDF y el panel dijo que ese
   teléfono tiene un QR pendiente (`senaPendiente`); guarda `mensajeId`,
   `mediaId` y `mimeType`. `¿Es un comprobante?` va entre `¿Atención normal?` y
   el agente (que sigue teniendo una sola entrada): `Obtener URL del medio`
   (nodo WhatsApp, `media` → `mediaUrlGet`) → `Descargar comprobante` (HTTP con
   el token, como archivo binario `data`; el PDF del banco es una imagen
   adentro de un PDF) → `¿Es PDF?` → `Leer comprobante (PDF)` /
   `Leer comprobante (imagen)` (nodo Google Gemini, `analyze`, el mismo modelo
   del agente, el prompt de `Analisis/07` §4.3 tal cual) → `Interpretar lectura`
   (saca el JSON del texto; `legible` = hay monto o cuenta) →
   `Cotejar en el servidor` (`cotejarComprobante`: **quien compara es el
   servidor**, contra el importe de la seña y las cuentas del QR) →
   `Respuesta de la seña` (UN mensaje fijo por resultado: cuadra → «los datos
   coinciden… la cita queda reservada, sujeta a la verificación del pago por
   la clínica»; no cuadra → qué dato no coincide y lo revisa una persona;
   ilegible → que lo reenvíe; 409 o panel caído → lo revisa una persona) →
   `¿Cuadró la seña?` → `Leer cita retenida` → `Confirmar cita retenida` (le
   quita el prefijo al título) → `Mensaje de la seña` (completa día, hora y
   persona con la cita leída; si el título no se pudo corregir, lo dice en el
   aviso) → `Mensaje a enviar` y `¿Transferir a humano?`. **Siempre se avisa a
   recepción**: es la clínica la que confirma que el dinero entró, mirando su
   banco. **El comprobante no se guarda**: ningún nodo lo escribe a ningún lado.
4. **Las retenciones vencidas las limpia un flujo aparte**
   (`agendamiento-senas-vencidas.json`, abajo).

**Mensajes que declara este bloque:** **+1 por conversación** (el QR, imagen
con caption) **solo en las que llegan a reservar con la seña activa**; la
respuesta al comprobante es **1 mensaje fijo** (sin modelo), que reemplaza al
turno del agente. Los avisos a recepción (cita pagada, diferencia, ilegible, QR
rechazado) **los paga NovuChat**. Sin seña: 0 mensajes agregados.

Suite: bloque (l) de `platinum-flujo.test.ts`, sobre los dos flujos.

**Medios entrantes: clasificar, no mirar (bloque 3, 17/09/2026, `Analisis/34`
§3.1 y §4.1), igual en el Demo A.** Un audio, una foto o un PDF que **no** es
comprobante dejan de recibir «por ahora atiendo por texto» —un mensaje pagado
que no avanza nada— y entran al agente convertidos en **texto**.

El caso que lo provocó: el 17/09 un paciente mandó un audio y una imagen en el
mismo minuto. Al audio el asistente le contestó que atiende por texto; de la
imagen **inventó** que era un comprobante («Ya tenemos todo listo»). Nadie vio
la imagen, y el texto que la acompañaba se descartó.

Cómo funciona:

1. **`Normalizar entrada` marca el medio.** `esMedioAudio` para `audio` y
   `voice` con id; `esMedioVisual` para `image` y `document` **cuando no son
   comprobante** (el bloque 2 manda: con `senaPendiente` la foto sigue yendo al
   cotejo). Una nota de voz se **reporta** como `audio`, no como `voice`, para
   que el contador del mes no la tire a «otro». `location` recibe la dirección
   del negocio en vez del aviso genérico; `sticker`, `video` y `contacts`
   siguen con el aviso cortés, porque ahí no hay nada que leer.
2. **La rama va después de la del comprobante y antes del agente.**
   `¿Es un comprobante?` [no] → `¿Trae un medio?` [no] → `AI Agent`; [sí] →
   `Obtener URL del medio (general)` → `Descargar medio` → `¿Es audio?` →
   **sí**: `Transcribir audio` (Gemini `audio`/`transcribe` sobre el binario) →
   `Preparar transcripción`; **no**: `¿Es un documento?` → `Describir documento`
   / `Describir imagen` (Gemini `analyze` con un prompt de **lista cerrada**:
   `publicidad | boca_o_dientes | comprobante | documento_salud | otro`) →
   `Preparar imagen`. Los dos `Preparar …` vuelven al agente.
   Los nodos de descarga son **gemelos** de los del comprobante y no los
   mismos: compartirlos obligaba a meter un IF dentro de una rama ya probada.
3. **El agente NUNCA ve el medio.** No es una instrucción del prompt: es el
   cableado. Ningún nodo que tenga el binario en la mano tiene salida al
   agente; lo que entra es una transcripción marcada («(audio transcripto) …»,
   con la orden de repetir en una línea lo que entendió antes de agendar) o
   **uno** de cinco textos fijos elegidos por la categoría. Ninguno
   diagnostica, ninguno promete un resultado, y el de «parece un comprobante
   pero no hay seña pendiente» no da ningún pago por recibido (prohibición 3).
   El texto que el modelo leyó en la imagen viaja **rotulado como dato**, en
   una línea, sin corchetes y recortado a 300: una captura no puede inventar
   una marca ni dictarle una instrucción al modelo.
4. **El audio largo no se transcribe.** Meta no manda la duración: se estima
   por `file_size` (~16 kB/s de ogg/opus; 60 s ≈ 960 kB). Por encima, o con la
   transcripción vacía, se pide con amabilidad que lo escriba. El supuesto es
   deliberadamente generoso —una nota de voz real va a ~2 kB/s— porque
   equivocarse hacia abajo devuelve el «atiendo por texto» que esto vino a
   sacar. **Hay que medirlo con un teléfono real** y ajustar la constante.
5. **Latencia.** `Normalizar entrada` anota `recibidoEn` y `Mensaje a enviar`
   deja `latenciaMs` en los datos de la ejecución, para sacar el p50 y el p90
   con `ver-ejecuciones.sh`: esta rama agrega una descarga y una llamada al
   modelo (+2 a 4 s en audio, +1 a 2 en imagen) contra un p90 de 10 s.

**Mensajes que declara este bloque: 0.** Los dos nodos nuevos contra Meta son
de **lectura** (`media/mediaUrlGet` y la descarga del archivo): no envían nada.
Estos caminos **reemplazan** a la respuesta vacía que ya se pagaba. El costo
del modelo es de centavos: ~0,001 USD por audio de 30 s y ~0,0001 por imagen.

**Nada se guarda, y falta verificarlo en la VM.** Ningún nodo escribe la
imagen, el PDF ni el audio en Storage, en Firestore ni en un archivo: entran
como binario `data`, se leen y de ahí sale texto. Lo que queda en el historial
de 12 meses es una marca —«(audio) el cliente envió una nota de voz»— y no el
contenido, que es además lo correcto con datos de salud (`Analisis/34` §4.1,
riesgo 1). Pero eso vale para el **flujo**; en la **instancia** faltan dos
verificaciones que hoy no están hechas y que corresponden a Andres en la VM:

- **`N8N_DEFAULT_BINARY_MODE=filesystem`** en el `.env` del contenedor. Con el
  modo por defecto (`default`) los bytes del audio y de la foto quedan dentro
  de los datos de ejecución, **en la base de n8n**, y ahí sí hay una copia.
- **Poda de ejecuciones**: `EXECUTIONS_DATA_PRUNE=true` y
  `EXECUTIONS_DATA_MAX_AGE` en horas, para que los binarios del disco no se
  acumulen. No se pone `settings.saveDataSuccessExecution: 'none'` en el flujo:
  eso apagaría también el diagnóstico, que es lo que permitió encontrar los
  defectos de las ejecuciones #2867 y #2936.
- **La credencial de Gemini tiene que ser de nivel pago.** En el nivel gratuito
  el contenido puede usarse para entrenar, y acá viajan audios y fotos de
  pacientes. Se verifica en la consola de Google AI Studio, en la cuenta cuya
  clave está en la credencial «Google Gemini (PaLM) API» de n8n.

Y falta la prueba contra un teléfono real: que el nodo de WhatsApp baje el
medio, que Gemini lo acepte, qué forma exacta tiene la salida del nodo de
transcripción y cuánto pesa de verdad un audio de 30 s (la prueba 3 de la
aceptación de Platinum, «un sticker y un audio», es el lugar para empezar).

Suite: bloque (m) de `platinum-flujo.test.ts`, sobre los dos flujos.

Suite: `admin/pruebas/platinum-flujo.test.ts` (ejecuta el JSON versionado:
compara nodo por nodo con el Demo A, prueba `instruccionesExtra`, el prompt, los
umbrales, el orden del lienzo y la elección de agenda por odontólogo). Además
recorre las suites comunes `flujos-umbrales`, `prefijo-cacheable` y
`estado-comercio`.

### Marcadores e importación

Cada marcador necesita **su fila exacta** en la tabla de `CONFIGURACION.local.md`
(`preparar-import.sh` no acepta una fila de otro cliente por prefijo):

| Marcador | Qué va |
|---|---|
| `REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM` | ID del número de WhatsApp de la clínica (no el número) |
| `REEMPLAZAR_NUMERO_RECEPCION_PLATINUM` | Celular que recibe los avisos, sin `+` (para el demo, el de Andres; debe escribir primero al número) |
| `REEMPLAZAR_CALENDARIO_PLATINUM_1` | Calendario del Dr. Sandoval; también es el del negocio y el de los tres servicios sin persona elegida |
| `REEMPLAZAR_CALENDARIO_PLATINUM_2` | Calendario del Dr. Juan Pérez |
| `REEMPLAZAR_HORARIO_ATENCION_PLATINUM` | Horario de atención (no consta en las fuentes: confirmar con la clínica). Es el respaldo si la consola no contesta |

```bash
./scripts/preparar-import.sh Flujos/platinum-agendamiento.json .env.platinum
```

**Con el segundo argumento**, siempre: sin él el flujo se lleva la ruta de
webhook del Demo A. Después, en n8n: importar, credenciales (WhatsApp Trigger de
la app de la clínica, «WhatsApp Clínica Platinum (envío)» con el token
permanente, «NovuChat ingesta (Clínica Platinum)» con el secreto del alias, la
Google Calendar OAuth2 que tenga acceso a los DOS calendarios), `Trigger On` =
Messages, **Publish**, y la URL de Production al webhook de la app.

Los nodos nuevos de la seña llevan las mismas credenciales por nombre
(«WhatsApp Clínica Platinum (envío)» en `Enviar QR de la seña`,
`Obtener URL del medio` y `Descargar comprobante`; «NovuChat ingesta (Clínica
Platinum)» en `Reportar QR (saliente)` y `Cotejar en el servidor`); los dos
`Leer comprobante` y los dos nodos de Calendar van sin nombre y
`publicar-flujo.sh` los completa **por tipo** desde el flujo vivo (la
credencial de Google Gemini del modelo del agente y la OAuth2 de Calendar).

Los del bloque 3 siguen la misma regla: «WhatsApp Clínica Platinum (envío)» en
`Obtener URL del medio (general)` y `Descargar medio`; `Transcribir audio`,
`Describir documento` y `Describir imagen` van sin nombre y se completan por
tipo con la credencial de Gemini.

### Señas vencidas (`agendamiento-senas-vencidas.json`)

Flujo programado, **sin disparador de webhook y sin ningún nodo de WhatsApp**:
cada 10 minutos (`*/10 * * * *`) pide la configuración al panel
(`Traer configuración` con `REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM`, el único
marcador) y, **solo si el comercio está activo y la seña está activa**, revisa
todas las agendas (`Citas pendientes de seña`, `q: PENDIENTE DE SEÑA`, de ayer
a 90 días), se queda con las citas cuyo **título empieza** con el prefijo y
cuyo `created` es anterior a los minutos de retención (`Vencidas`; el teléfono
sale de la descripción que escribe `agendar_cita`), **primero se lo reporta
al servidor** (`Reportar seña vencida` → `senaVencida`, idempotente) y recién
con su respuesta borra (`¿Borrar la cita?` → `Borrar cita vencida`): con
`registrado`, `repetido` o `sin_sena_pendiente` se borra; con `ya_agendada`
—el comprobante cuadró y el título no se pudo corregir— **no se toca**. Con el
panel caído, el comercio suspendido o la seña inactiva no sale ningún item y no
se borra nada. Nunca le escribe al paciente: un mensaje por retención vencida
costaría 0,0113 USD y provocaría el reclamo que se quiere evitar.
**Mensajes: 0.** Suite: `admin/pruebas/senas-vencidas.test.ts`.

Se crea por la API, con las credenciales resueltas por nombre y por tipo desde
el flujo conversacional de la clínica (el de `.env.platinum`), y queda con su
propio `.env`:

```bash
./scripts/preparar-import.sh Flujos/agendamiento-senas-vencidas.json .env.platinum
./scripts/publicar-flujo.sh --env .env.platinum --flujo Flujos/agendamiento-senas-vencidas.json \
    --crear --activar --env-nuevo .env.platinum-senas          # primero sin --aplicar: diagnóstico
```

Después se actualiza como los demás:
`./scripts/publicar-flujo.sh --env .env.platinum-senas --flujo Flujos/agendamiento-senas-vencidas.json`.

### Seguimientos (`agendamiento-seguimientos.json`)

Flujo programado, **el único de la clínica que le escribe a alguien que no
escribió primero**. Cada hora al minuto 15 (`15 * * * *`, para no pisar al
barrido de señas vencidas, que corre en punto) pide la configuración al panel
(`REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM`, el único marcador) y, **solo si el
comercio está activo**, le pregunta al servidor a quién le toca el recordatorio
de solicitud pendiente.

**El flujo no decide a quién se le escribe.** Lo decide
`seguimientosPendientes` (`admin/functions/src/seguimientos.ts`, regla completa
en `admin/DISENO.md` §4quaterdecies): una sola vez por solicitud, nunca a quien
pidió que no le escriban, nunca a un teléfono en operador o bloqueado, nunca a
quien ya agendó, y solo entre 2 y 4 h (texto en ventana) o entre 24 y 48 h
(plantilla de utilidad). Tope de 50 por corrida.

**La marca va ANTES del envío**: `Marcar seguimiento` → `seguimientoEnviado`, y
`¿Se marcó?` no deja pasar nada que el servidor no haya marcado en esa corrida.
Si el envío falla después, ese recordatorio se pierde y nadie lo reintenta: un
seguimiento perdido es mejor que dos, porque el segundo es el que hace que la
persona bloquee el número.

Los nodos, en orden: `Cada hora` → `Config base` → `Traer configuración` →
`Pendientes` → `Un item por solicitud` → `Marcar seguimiento` → `¿Se marcó?` →
`¿En ventana?` → `Enviar texto` / `Enviar plantilla` → `Reportar seguimiento
(saliente)`.

**Mensajes: +1 en las conversaciones que quedaron a medio camino** (el de modo
texto, dentro de la ventana). El de modo plantilla cae sobre una ventana
vencida y la ingesta no lo cuenta como conversación, así que al comercio no se
le factura nada; la respuesta del paciente sí abre una conversación nueva, que
es justamente lo que se busca. Suite:
`admin/pruebas/agendamiento-seguimientos.test.ts`.

Se crea igual que el de señas vencidas, con su propio `.env`:

```bash
./scripts/preparar-import.sh Flujos/agendamiento-seguimientos.json .env.platinum
./scripts/publicar-flujo.sh --crear --env .env.platinum \
    --flujo Flujos/agendamiento-seguimientos.json \
    --activar --env-nuevo .env.platinum-seguimientos     # primero sin --aplicar: diagnóstico
```

Después se actualiza como los demás:
`./scripts/publicar-flujo.sh --env .env.platinum-seguimientos --flujo Flujos/agendamiento-seguimientos.json`.

**No activarlo antes de que la plantilla esté aprobada:** sin ella el modo
`plantilla` falla en Meta, y la solicitud ya quedó marcada.

#### La plantilla `solicitud_cita_sin_confirmar`

Categoría **UTILITY**, idioma `es`, **sin botones**, sin precio y sin
vocabulario comercial: el clasificador de Meta lee las palabras, no la
intención (memoria «meta-plantillas-restricciones», 14/09). Se redacta como el
**estado de una solicitud que la persona hizo**, no como una invitación.

```bash
./scripts/crear-plantilla.sh --env .env.platinum \
    --nombre solicitud_cita_sin_confirmar --idioma es \
    --cuerpo 'Se registró tu solicitud de cita en {{1}} para {{2}}. Estado: sin confirmar. Responde este mensaje si quieres retomarla.' \
    --ejemplos 'Clínica Platinum|el sábado 20 a las 10:00'     # sin --aplicar: solo muestra la carga útil
```

Con `--aplicar` la envía a revisión, que **tarda días**. Después:
`./scripts/listar-plantillas.sh --env .env.platinum --detalle`. La crea Claude
con el OK de Andres; los dos parámetros son, en orden, el **nombre del negocio**
(`{{1}}`) y la **fecha de la solicitud** (`{{2}}`), y los arma
`Un item por solicitud` desde lo que devuelve el panel.

#### Los dos hechos que aporta el flujo conversacional

`platinum-agendamiento.json` y `demo-a-agendamiento.json` cambian **solo dos
`jsonBody`**, y **no agregan ningún mensaje**:

- `Reportar mensaje (saliente)` suma `evento: 'horarios_ofrecidos'` cuando
  `consultar_disponibilidad` corrió en el turno y `agendar_cita` no, y
  `evento: 'no_contactar'` cuando el turno terminó transferido a una persona
  (gana sobre el anterior).
- `Reportar mensaje (entrante)` suma `evento: 'no_contactar'` cuando el texto
  del cliente coincide con una expresión regular fija («no me escriban», «no me
  molesten», «dejen de escribir», «no quiero más mensajes», «bórrame de»,
  «quitame de»). Lo que la expresión no cubre —«borrame» sin tilde, «stop»— lo
  resuelve el interruptor **No contactar** de la pantalla de conversaciones.

Se cubren en `admin/pruebas/platinum-flujo.test.ts`, bloque **(n)**.
