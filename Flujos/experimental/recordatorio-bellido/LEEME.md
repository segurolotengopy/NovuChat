# Recordatorio de cita al paciente de Bellido: flujo de PRUEBA

**01/10/2026 · cartera.** Pequeño flujo aparte, construido desde la lista de funcionalidades
(`CLIENTES/BELLIDO/solicitudes/recordatorio-al-paciente-funcionalidades-2026-10-01.md`, aprobada por Andres), no
copiando el flujo de recordatorios del Demo A. 14 nodos. **Es de prueba:** usa un calendario de pruebas (el del
comercio `ensayo`) y envía solo a los teléfonos de prueba de Andres y de Silvana. No es el flujo definitivo.

## Qué hace
- **«Crear citas ficticias»** (webhook): crea en el calendario de pruebas seis citas para mañana con el formato del
  chat (`Apellidos, Nombres (CNS|RN)`, línea `Telefono: …`): dos gestionadas por NovuChat (Andres y Silvana, con la
  línea `Agendado por NovuChat.`), que **deben salir**, y cuatro que **no deben salir**: una manual con teléfono y sin
  marca, una con `[no recordar]`, una sin teléfono y una con prefijo extranjero.
- **«Correr recordatorio ahora»** (webhook; y el disparador diario de las 17:00, **apagado** en la prueba): lee las citas
  de mañana, deja solo las que cumplen el criterio de abajo, y envía la plantilla `recordatorio_cita_consultorio`
  (idioma `es`; 4 parámetros de cuerpo; ver «Sin datos del paciente»). Si Meta acepta el mensaje, marca la cita con
  `[recordado]`; si no, deja la causa en la ejecución y no marca nada.
- Funcionalidades cubiertas: 1 (corrida diaria; apagada en la prueba), 2, 3, 4 (con `estadoComercio` fijo en el Set),
  5, 6 (cada envío es un mensaje de utilidad), 7 (la causa queda por cita). **Faltan para producción:** el aviso a
  recepción una vez por corrida cuando algo falla, y leer el estado del comercio del servidor (como los demás flujos).

## Criterio: «paciente gestionado por NovuChat» (Andres, 03/10/2026)
Haber usado el sistema para agendar habilita el recordatorio; al paciente no se le avisa de antemano, y se le manda
mientras no lo haya cancelado. **No se hacen recordatorios a pacientes que NovuChat no gestionó.** Esto reemplaza la
regla anterior («toda cita con la línea `Telefono:`, sea cual sea su origen»). Una cita se recuerda **solo si**:

1. su descripción tiene la línea completa `Agendado por NovuChat.` (la escribe `agendar_cita` y el flujo de agenda);
2. su `iCalUID` **no** empieza por `novuchat-importada-` (las que carga `admin/scripts/datos/citas-a-calendario.mjs`
   llevan la misma línea de marca, y por eso se distinguen por el `iCalUID`);
3. trae el teléfono **en la línea que le toca** (la 2 si la 1 empieza por `Cliente:`, si no la 1; el mismo criterio de
   `citasDelTelefono` de Agenda mínima): una línea entera `Telefono:` (o `Teléfono:`, con `+` opcional) con 8 a 15
   dígitos (16 o más no es un teléfono) y prefijo permitido (591). Si la descripción tiene **más de una** línea
   `Telefono:` (un nombre de perfil con un salto de línea puede colar otra) la cita es ambigua y se omite. Con
   `prefijosPermitidos` vacío **falla cerrado**: no se envía a ningún prefijo y la ejecución termina en error;
4. no lleva `[recordado]` ni `[no recordar]` (esta última, sin distinguir mayúsculas; es la forma de que recepción
   saque una cita del recordatorio) y no está cancelada (`status` `cancelled`; Google además no devuelve las borradas).

Cada cita omitida deja su causa en `omitidas` de la ejecución (`cancelada`, `ya recordada`, `no recordar`,
`importada`, `no gestionada por NovuChat`, `telefono ambiguo`, `sin telefono`, `prefijo no permitido`, `evento sin hora`,
`variable de plantilla de mas de 30 caracteres`, `sin prefijos configurados`, y en la prueba `fuera de la lista de
prueba`), sin nombres. La descripción solo se trunca (a 4000 caracteres) para analizarla: al marcar vuelve entera, y
las marcas `[recordado]` y `[no recordar]` se buscan en la completa. El calendario donde se marca es siempre el
configurado (`calendarioId`), nunca el `organizer` del evento.

**Sin datos del paciente.** La plantilla `recordatorio_cita_consultorio` (idioma `es`) dice: «Hola {{1}}, Este es un
recordatorio sobre tu próxima cita con {{2}} el {{3}} a las {{4}}. ¡Esperamos verte!». Su botón es de URL fija y **no
lleva parámetro al enviar** (el `jsonBody` solo manda el componente `body`). Los valores:
- {{1}} = `saludoVariable` del Config del recordatorio; por omisión «te escribimos del consultorio».
- {{2}} = `conQuienVariable` del Config; por omisión «el Doctor Bellido» (la plantilla dice «con {{2}} el {{3}}»; decisión de Andres, 04/10; la plantilla NO se cambia).
- {{3}} = solo la fecha escrita, p. ej. «lunes 5 de octubre» (sin «el»). {{4}} = solo la hora en 24 h, p. ej. «10:30»
  (sin «a las»).
Se lee: «Hola te escribimos del consultorio, Este es un recordatorio sobre tu próxima cita con el Doctor Bellido el domingo 4 de octubre a las 11:00. ¡Esperamos verte!» (la coma tras «Hola …» es de la plantilla aprobada). Meta limita a 30 caracteres cada variable de texto: una más larga se omite con su causa.
Ninguna variable lleva saltos de línea, tabuladores ni 4 o más
espacios seguidos (límite de Meta): el nodo las limpia. No hay servicio, motivo ni nombre del paciente; lo acordado queda
en el texto de la plantilla. El título de la cita no se copia a ningún campo del item. Lo que sí queda en los datos de la
ejecución es lo que el calendario ya tenía: la salida del nodo de Google Calendar y la `descripcionMarcada` (la
descripción original más `[recordado]`), que se necesita para marcar la cita sin pisar su texto.

**Variables de la plantilla, por configuración.** La definición de la plantilla **no está en este repositorio**: se
supone con **4 variables de cuerpo** en el orden de arriba. Si se aprueba una plantilla sin la variable del saludo, se
pone `variablesCuerpo = 3` en el Config (y la plantilla nueva en `plantilla`): `Preparar recordatorios` arma `parametros`
sin el saludo y `Enviar plantilla` envía esa lista, sin tocar más lógica. Con un número de variables distinto del real,
Meta rechaza el envío (la causa queda en la ejecución). Pendiente: confirmar el texto y la categoría (utilidad) de la
plantilla antes de producción.

### Dónde el criterio puede NO alcanzar
- **Una cita creada por NovuChat y luego editada a mano en Calendar** puede perder la línea de marca (por ejemplo si la
  interfaz de Calendar reescribe la descripción como HTML): deja de recibir recordatorio, aunque el paciente sea nuestro.
  Es el error del lado seguro (no manda), pero no avisa.
- **Quien copie la línea `Agendado por NovuChat.` a mano** en una cita manual la vuelve «gestionada»: el criterio
  confía en el texto de la descripción, no en un registro aparte.
- **Una importación que no conserve el `iCalUID`** `novuchat-importada-…` (otro script, o importar el `.ics` de otra
  forma) no se distinguiría de una cita del chat, porque lleva la misma línea de marca. Hoy solo
  `citas-a-calendario.mjs` importa, y fija ese `iCalUID`.
- **El nodo «Obtener varios» debe entregar `iCalUID` y `status`** del evento tal como los devuelve la API de Google
  Calendar; la suite lo supone y no puede comprobarlo (se verifica en la prueba contra el calendario de pruebas).
- Las citas ficticias de la prueba no pueden representar la **importada** (el nodo de creación no deja fijar el
  `iCalUID`) ni la **cancelada**; las cubre la suite `admin/pruebas/recordatorio-bellido.test.ts`.

## Hallazgo: `timeMin`/`timeMax` en `options` no se aplican
En el nodo Google Calendar «Obtener varios» las fechas «After/Before» son parámetros del nodo, **no** de `options`. Con
`options.timeMin`/`options.timeMax` el nodo devolvió también una cita de dentro de tres días. Con los parámetros
`timeMin`/`timeMax` al nivel del nodo, solo las de mañana. `Flujos/demo-a-recordatorios.json` («Citas de mañana») usa
`options`: ese flujo recordaría **todas** las citas futuras con teléfono, no solo las de mañana. Está anotado para
corregirse aparte (no es de este PR).

## Salida definitiva: `recordatorio-bellido.v1.json`
Se genera con el mismo `herramientas/generar.py` y el mismo código de `src/` (una sola fuente):
`python3 herramientas/generar.py v1 > recordatorio-bellido.v1.json`. Nombre: «NovuChat Bellido — Recordatorio de citas
(24 h)». Doce nodos: `Todos los días 17:00` → `Config del recordatorio` → `Citas de mañana` → `Preparar recordatorios` →
`¿Hay recordatorios?` → (sí) `Enviar plantilla` → `Después del envío` → `¿Se envió?` → (sí) `Marcar como recordada`
→ (si falla) `Enviado pero no marcado` / (no se envió) `Recordatorio no enviado`; y (no hay recordatorios)
`Revisar omisión`.

- **Sin lo de la prueba:** ni los dos webhooks, ni «Crear citas ficticias», ni la Config de la prueba, ni teléfonos de
  prueba. Lo único por reemplazar al aplicar son `REEMPLAZAR_CALENDARIO_BELLIDO` (el calendario real) y
  `REEMPLAZAR_PHONE_NUMBER_ID_BELLIDO` (el id del número de Bellido). El JSON no trae ids ni teléfonos.
- **Disparador:** `scheduleTrigger` con cron `0 17 * * *`, **habilitado en el JSON**, y `settings.timezone` =
  `America/La_Paz` (17:00 de La Paz = 21:00 UTC). El despliegue lo deja **inactivo** hasta que Andres lo active.
- **Lee** solo las citas de mañana del calendario real (`timeMin`/`timeMax` al nivel del nodo, `singleEvents`), aplica el
  criterio de arriba y envía la plantilla.
- **Escribe solo dos cosas:** el envío de la plantilla y la marca `[recordado]` en la `description` de la cita
  (`updateFields` con solo `description`). No crea, no borra, no mueve ni cambia el título de ninguna cita.
- **Si Meta rechaza el envío** (la respuesta no trae id de mensaje): la cita **no** se marca `[recordado]` (un
  reintento la vuelve a intentar) y la ejecución termina en **ERROR visible** en n8n: `Recordatorio no enviado` lanza
  `Recordatorio no enviado: N cita(s) sin recordar. Causas: …`, con las causas de Meta y sin teléfono, título ni
  descripción del paciente. Con `executionOrder: v1` la rama de marcar (salida de arriba) corre antes que la del error,
  de modo que las citas enviadas en la misma corrida sí quedan marcadas.
- **Si la marca falla después de enviar:** `Marcar como recordada` tiene salida de error y va a `Enviado pero no
  marcado`, que lanza `Enviado pero no marcado: N cita(s) (eventoId: …)` sin teléfono ni datos del paciente. La plantilla
  ya salió, así que **repetir la ejecución completa la reenviaría al paciente**. «Retry» tampoco sirve: reintenta el
  nodo que lanzó el error y repite el `throw`. Recepción agrega [recordado] a mano en la descripción de los eventos
  listados. No se usa Retry ni una ejecución completa el mismo día (reenviaría la plantilla). En resumen: nunca una
  ejecución completa.
- **Si la omisión es por configuración** (una variable de la plantilla de más de 30 caracteres, o `prefijosPermitidos`
  vacío), `Revisar omisión` lanza `Recordatorio no enviado: configuracion invalida (…)`: no termina en verde. Si no hay
  citas que correspondan (o el comercio no está operativo), sí termina en verde.
- **Ejecuciones guardadas:** `settings.saveDataSuccessExecution` = `none`: las ejecuciones exitosas no se guardan (llevan
  teléfonos y la descripción de la cita); las de error se siguen guardando.
- **Credenciales por nombre:** `Google Calendar account` (nodos de Calendar) y `Graph WhatsApp Bellido (Bearer)`
  (`Enviar plantilla`). Ninguna otra.
- **Estado del comercio:** `estadoComercio` es una clave de datos del Config, fija en `operativo` (con otro valor, el
  flujo no manda nada). **Mejora posterior, no incluida:** leerla del servidor como los demás flujos (el nodo «Traer
  configuración» con la credencial de ingesta que usa `bellido-agendamiento.json`, antes de `Citas de mañana`, y
  escribir su resultado en esa clave). No se agregó aquí porque es un nodo de red nuevo.
- **Costo en mensajes (`docs/base-comercial.md` §1):** agrega **1 mensaje de utilidad por cita recordada** (unos
  0,0113 USD por mensaje) a la conversación del paciente; no agrega ni quita ningún otro mensaje del asistente de
  Bellido. Una cita se recuerda una sola vez (la marca `[recordado]`) y solo si cumple el criterio.
- **Pendientes antes de activar:** el aviso a recepción cuando una corrida falla (hoy basta el error visible en n8n) y
  leer el estado del comercio del servidor. La suite `admin/pruebas/recordatorio-bellido-v1.test.ts` prueba lo anterior;
  no puede probar el orden de ramas de n8n ni el disparo del cron (se ven en la primera corrida manual y en la primera
  de las 17:00).

## Cómo se aplica la prueba
En la prueba, `Preparar recordatorios` solo deja salir a `telefonoPruebaAndres` y `telefonoPruebaSilvana` del Config
(cualquier otro número se omite con `fuera de la lista de prueba`; con la lista vacía falla cerrado). El flujo
definitivo no trae esas claves y no filtra. `aplicar-prueba.py` crea el archivo de estado (con las rutas de los
webhooks) con `os.open(…, 0o600)`.

`herramientas/generar.py` arma el JSON con marcadores; `herramientas/aplicar-prueba.py` los resuelve en memoria y crea o
actualiza el flujo en n8n con las credenciales de Bellido por nombre (ver el encabezado del script). El repositorio no
guarda ids, teléfonos ni rutas de webhook.
