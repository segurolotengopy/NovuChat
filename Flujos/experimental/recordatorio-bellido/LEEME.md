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
3. trae la línea `Telefono:` (o `Teléfono:`) con un número de 8 a 15 dígitos y prefijo permitido (591);
4. no lleva `[recordado]` ni `[no recordar]` (esta última, sin distinguir mayúsculas; es la forma de que recepción
   saque una cita del recordatorio) y no está cancelada (`status` `cancelled`; Google además no devuelve las borradas).

Cada cita omitida deja su causa en `omitidas` de la ejecución (`cancelada`, `ya recordada`, `no recordar`,
`importada`, `no gestionada por NovuChat`, `sin telefono`, `prefijo no permitido`, `evento sin hora`), sin nombres.

**Sin datos del paciente.** La plantilla `recordatorio_cita_consultorio` (idioma `es`) dice: «Hola {{1}}, Este es un
recordatorio sobre tu próxima cita con {{2}} el {{3}} a las {{4}}. ¡Esperamos verte!». Su botón es de URL fija y **no
lleva parámetro al enviar** (el `jsonBody` solo manda el componente `body`). Los valores:
- {{1}} = `saludoVariable` del Config del recordatorio; por omisión «te escribimos del consultorio del Dr. Bellido».
- {{2}} = `conQuienVariable` del Config; por omisión «tu peque».
- {{3}} = solo la fecha escrita, p. ej. «lunes 5 de octubre» (sin «el»). {{4}} = solo la hora en 24 h, p. ej. «10:30»
  (sin «a las»).
Se leería: «Hola te escribimos del consultorio del Dr. Bellido, Este es un recordatorio sobre tu próxima cita con tu peque
el lunes 5 de octubre a las 10:30. ¡Esperamos verte!». Ninguna variable lleva saltos de línea, tabuladores ni 4 o más
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

## Cómo se aplica
`herramientas/generar.py` arma el JSON con marcadores; `herramientas/aplicar-prueba.py` los resuelve en memoria y crea o
actualiza el flujo en n8n con las credenciales de Bellido por nombre (ver el encabezado del script). El repositorio no
guarda ids, teléfonos ni rutas de webhook.
