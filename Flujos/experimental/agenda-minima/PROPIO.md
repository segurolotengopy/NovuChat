# Agenda mínima (Bellido): lo propio y lo incluido del miniCRM

Código de Bellido **descongelado por orden expresa de Andres el 04/11/2026 solo para el miniCRM**: no se tocan la plantilla de recordatorios, el prompt, el candado ni nada que el miniCRM no necesite.

## miniCRM (módulo `crm`)

- **Incluido desde su fuente (nunca copiado):** `Flujos/src/modulos/crm/` (`crm.js`, `nodo-prospecto.js`, `nodo-decidir-fila.js`, `adaptador-senales.js`), con los paquetes `crm-prospecto` y `crm-decidir-senales` (marcas `@@medio:` de la plantilla), y la rama de 8 nodos que genera `ramaCrm` (`comun-sin-agente/construir-crm.mjs`), colgada de «Armar mensajes» además de sus conexiones previas, por debajo del envío (y = 640). Va en las dos variantes (producción y prueba). `injertarCrm` pone el mapa y los rangos; `hallazgosCrm` es la guardia del constructor (ningún rango llega a la letra U, retención de ejecuciones en `none`).
- **Credencial:** `Google Sheets miniCRM (crm-bellido)`, calculada por el constructor (`CREDENCIAL_CRM`); nunca sale de datos.
- **Datos (zona Tenants):** `admin/scripts/datos/bellido/crm.json` con el mapa de columnas (el mismo de Evy: hoja `Leads_CRM`, encabezados en la fila 3, `LEAD-` desde 1001). El id de la planilla es el marcador `REEMPLAZAR_PLANILLA_PROSPECTOS_ID_BELLIDO` en `Config base` (lo repone la publicación; nunca un id real en el repositorio) y la hoja es `Leads_CRM`. La variante de prueba lleva el id vacío: no escribe en ninguna planilla. `Config del negocio` trata un marcador como vacío.
- **Propio de Bellido:** `agmProspectoCrm` en `src/lib/agenda.js` (función pura, vocabulario cerrado) y su armado en `Armar mensajes` (`guardarPlanilla` / `prospectoPlanilla` en el primer ítem de salida). Reglas duras:
  - El texto libre del cliente no pasa; nada de salud (consultorio pediátrico): ni motivo clínico, ni síntomas, ni nombre del paciente. El nombre del contacto es el del perfil de WhatsApp, saneado.
  - Los hechos son los del código: «Agendar cita» solo si el calendario creó el evento (`base.creada`), «Reprogramar» si además había una cita que mover, «Cancelar» solo si el borrado del calendario salió bien. Lo que diga el modelo no cuenta.
  - Nunca deja prospecto la emergencia, los medios que el canal no lee, los errores, el uso extendido, la suspensión ni un turno sin respuesta; tampoco en modo prueba ni sin id y hoja válidos.
  - El resumen nunca dice que alguien pagó; la columna U (diagnóstico del equipo) no se lee ni se escribe.
  - El cálculo va en `try/catch`: si falla, `prospectoPlanilla = null` y el turno sigue; la planilla nunca tumba la atención.
  - «Contacto nuevo» = sin mensajes en 48 h: el estado de agenda vence a los 30 minutos, así que se lleva un mapa propio `agendaMinimaCrm` (teléfono a último mensaje) en los datos estáticos del flujo, podado a las 48 h.
- **Mensajes por conversación: 0.** La rama no envía nada; no se agrega ni se quita ningún mensaje al paciente.
- **Nodos:** 62 -> 70 (producción y prueba); 71 con «Expandir citas» (hermanos, 07/11/2026). Bellido no tiene tope en su constructor; la declaración está en `docs/versiones-por-cliente.md`.
- **Ajuste de `settings`:** la plantilla fija `saveManualExecutions: false` (lo exige `hallazgosCrm`; el guardado ya fijaba el resto).
- **Pruebas:** `admin/pruebas/tenants/bellido/crm.test.ts` (rama, mapa, rangos, credencial) y el bloque «miniCRM» de `admin/pruebas/agenda-minima-flujo.test.ts`.

## Phone id para la atadura del timbre (10/11/2026)

- «Config base» lleva `phoneNumberIdAtadura` (marcador `REEMPLAZAR_PHONE_NUMBER_ID_BELLIDO`) solo para que `scripts/cargar-timbre-n8n.sh` lea el phone id de Bellido (el flujo lo obtiene dinámicamente); ningún nodo lo lee. No se llama `phoneNumberId` porque «Config base» deja pasar los demás campos y lo pisaría. Lo siembra `flujo-de-prueba.mjs --sobre-bellido` desde `WA_PHONE_ID`; 0 nodos, 0 mensajes.

## Hermanos: dos citas seguidas (07/11/2026)

- **Decisión de Andres:** con dos pacientes se crean DOS eventos seguidos (uno por hermano, con su propio título) y solo se ofrecen horarios con el doble de `duracionPorDefectoMin` libre y contiguo. Cada cita es independiente: cancelar o mover una no toca la otra.
- **Nodo propio nuevo:** «Expandir citas» (`src/nodos/expandir-citas.js`), entre «¿Crear cita?» y «Crear evento»: un ítem por cita. «Crear evento» corre una vez por ítem; «Releer el hueco» y «¿Registrar cierre?» van con `executeOnce` (un cierre por par).
- **Candado por hecho:** `candado.js` verifica cada evento creado; si no se crearon todos, o hay cruce, o la relectura falla, o no son contiguos, se deshacen todos («Deshacer cita» corre por ítem).
- **Mensajes por conversación: 0** (un solo mensaje de confirmación). Nodos: +1.
