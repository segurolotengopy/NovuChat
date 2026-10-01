# Recordatorio de cita al paciente de Bellido: flujo de PRUEBA

**01/10/2026 · cartera.** Pequeño flujo aparte, construido desde la lista de funcionalidades
(`CLIENTES/BELLIDO/solicitudes/recordatorio-al-paciente-funcionalidades-2026-10-01.md`, aprobada por Andres), no
copiando el flujo de recordatorios del Demo A. 14 nodos. **Es de prueba:** usa un calendario de pruebas (el del
comercio `ensayo`) y envía solo a los teléfonos de prueba de Andres y de Silvana. No es el flujo definitivo.

## Qué hace
- **«Crear citas ficticias»** (webhook): crea en el calendario de pruebas cuatro citas para mañana con el formato del
  chat (`Apellidos, Nombres (CNS|RN)`, línea `Telefono: …`): una para Andres, una para Silvana, una sin teléfono y
  una con prefijo extranjero.
- **«Correr recordatorio ahora»** (webhook; y el disparador diario de las 17:00, **apagado** en la prueba): lee las citas
  de mañana, deja las que traen teléfono con prefijo 591 y sin la marca `[recordado]`, y envía la plantilla
  `recordatorio_cita` (biblioteca `appointment_reminder_2`; 4 parámetros: paciente, negocio, fecha, hora). Si Meta
  acepta el mensaje, marca la cita con `[recordado]`; si no, deja la causa en la ejecución y no marca nada.
- Funcionalidades cubiertas: 1 (corrida diaria; apagada en la prueba), 2, 3, 4 (con `estadoComercio` fijo en el Set),
  5, 6 (cada envío es un mensaje de utilidad), 7 (la causa queda por cita). **Faltan para producción:** el aviso a
  recepción una vez por corrida cuando algo falla, y leer el estado del comercio del servidor (como los demás flujos).

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
