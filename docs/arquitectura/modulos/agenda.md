# Módulo Agenda

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `funcionarios`, `agenda` (candado), `sena.ts`, `retencion.ts`, `seguimientos.ts`, recordatorios, señas vencidas; `Funcionarios.tsx`; 13 módulos de `Flujos/src/reservas/`; herramientas de Calendar |
| **Depende de** | Cobros (solo para la seña) |
| **Límite por plan** | agendas (1 / 5 / 10), **hoy sin hacer cumplir**: falta la regla en `firestore.rules` al crear un funcionario, con un contador `contadores/agendas` como el del catálogo. El número ya viaja en la copia `cuenta/estado.limites.agendas` (`planes.ts`). Ver `limites.md` |
| **Configuración** | `config/agenda` (hoy `config/agendamiento`), con lista blanca: `calendarioId` (sale de `config/negocio`), `duracionMin`, `recordatorios`, `senaActiva`, … |
| **Colecciones** | `funcionarios`, `funcionarios/privado`, `agenda`; se agrega `contadores/agendas` |
| **Pestañas** | Agenda / Funcionarios (`admin`); ranura «citas de hoy» en el Tablero; la duración de cita como ranura en Catálogo |
| **Prompt** | `Flujos/prompts/modulos/agenda.md` (hoy dentro de `Flujos/prompts/reservas/*.md`) |
| **Herramientas** | `consultar_disponibilidad`, `agendar_cita`, `buscar_mi_cita`, `cancelar_cita` |
| **Nodos (lo que queda en n8n)** | `Flujos/src/modulos/agenda/*.js` (hoy `Flujos/src/reservas/`, 13 módulos); Google Calendar por credencial de n8n |
| **Ganchos** | `antesDelTurno`, `despuesDelTurno` (seña: retención), `alCierre` (cita), `programado` (recordatorios, seguimientos, señas vencidas: `agendamiento-seguimientos`, `agendamiento-senas-vencidas`, `demo-a-recordatorios`) |
| **Mensajes por conversación** | 0 en la conversación; el recordatorio de solicitud pendiente y los recordatorios de cita son mensajes fuera de la ventana y se declaran en su sección |
| **Pruebas** | `candado-agenda.test.ts`, `seguimientos.test.ts`, `senas-vencidas.test.ts`, `agendamiento-seguimientos.test.ts`, `sena-servidor.test.ts`, `citas-a-calendario.test.ts`, `direccion-maps.test.ts`; las suites de flujo de reservas (Demo A, Platinum, Bellido) hasta que F5 las reparta |

**Observación:** es el módulo más grande. Hoy se llama vertical `agendamiento`. `preparar-sena`, `respuesta-de-la-sena`, `mensaje-de-la-sena` e `interpretar-lectura` van a Cobros con dependencia de Agenda. El techo de agendas por plan no es el número de personas: es que el candado hace una llamada a Google Calendar por cada calendario configurado (`Analisis/24`)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## La regla mandatoria del candado

**Nunca una cita encima de otra con un cliente real** (Andres, 17/09/2026). El
candado se dispara por lo que el modelo HIZO, no por lo que DIJO: si
`agendar_cita` se ejecutó en la vuelta, se verifica en el calendario y, si hay
cruce, se deshace. Está en `CLAUDE.md` y no se repite acá; el diseño del
candado es §4quinquies.4, abajo.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene. La sección
§4quaterdecies (recordatorio de solicitud pendiente) trae sus subsecciones tal
como estaban numeradas en el original (`4terdecies.1` a `.5`).


<!-- movido de admin/DISENO.md §4quinquies (25/09/2026, líneas 1162-1163) -->

## 4quinquies. Funcionarios y agenda por persona


<!-- movido de admin/DISENO.md §4quinquies.1 (25/09/2026, líneas 1164-1185) -->

### 4quinquies.1 El problema

El modelo asumía **un calendario por comercio**, y eso produce un error visible:
una cita de manicure a las 11:30 bloquea una de ortodoncia a las 11:30, cuando
las atienden personas distintas. Lo que hay que impedir es que **un mismo
funcionario** tenga dos citas simultáneas, no que el comercio tenga dos.

`/tenants/{t}/funcionarios/{id}`: nombre, especialidad, `calendarioId`,
`horarioTrabajo` —que puede diferir del horario del comercio, y ahí está la mitad
de la gracia: el salón abre de 9 a 19 pero el odontólogo va martes y jueves de 14
a 18—, `servicios` y `activo`.

**Datos personales de un tercero que no es el cliente final.** Teléfono y correo
van en `/funcionarios/{id}/privado/datos`, con el mismo criterio que los
contactos y los datos ampliados de conversaciones: las reglas no pueden ocultar
campos sueltos en una lectura, así que lo que un rol no debe ver va en otro
documento. **El operador ve quién atiende qué —lo necesita para contestar— pero
no el teléfono personal de la manicurista, que no necesita para nada.**

La baja es **lógica** (`activo: false`), nunca borrado: un funcionario borrado
dejaría citas pasadas apuntando a un identificador que ya no existe.


<!-- movido de admin/DISENO.md §4quinquies.2 (25/09/2026, líneas 1186-1205) -->

### 4quinquies.2 Servicio ↔ funcionario: denormalizado de un solo lado

Un servicio lo atienden varios funcionarios y un funcionario atiende varios
servicios. Se resuelve con una lista `servicios: [idDeCatalogo]` **en el
funcionario**, y nada del otro lado.

**Por qué no hay consultas.** n8n tiene que resolver «quién puede atender una
limpieza facial» y «cuál es su calendario» de forma barata. La respuesta no es un
índice mejor: es **no consultar**. `configuracionFlujo` ya devuelve el catálogo;
ahora devuelve también los funcionarios activos. Son colecciones chicas —200
servicios y 50 funcionarios como tope— y traerlas enteras en la misma llamada
cuesta menos que cualquier consulta con índice por servicio. n8n cruza las dos
listas **en memoria**.

**Referencias colgadas.** Las reglas solo pueden comprobar que `servicios` es una
lista de hasta 50 elementos, no que esos identificadores existan. Un servicio
borrado del catálogo deja la referencia atrás. `resolverFuncionarios()` las
descarta contra los ids del catálogo, para que el agente no ofrezca un servicio
inexistente. Hay una prueba de eso.


<!-- movido de admin/DISENO.md §4quinquies.3 (25/09/2026, líneas 1206-1217) -->

### 4quinquies.3 Un solo funcionario tiene que ser trivial

Muchas PyMEs bolivianas son una persona sola. **La colección puede estar vacía.**
Si no hay ningún funcionario activo, `configuracionFlujo` fabrica uno por defecto
con el calendario y los horarios del comercio, y el flujo ve siempre una lista
con al menos un elemento.

Resultado: **el flujo tiene un solo camino de código** y el comercio de una sola
persona no configura nada. La complejidad la paga quien la necesita. Un
funcionario que se cargó sin calendario propio hereda el del comercio, por el
mismo motivo: nadie puede quedar sin agenda ninguna.


<!-- movido de admin/DISENO.md §4quinquies.4 (25/09/2026, líneas 1218-1256) -->

### 4quinquies.4 El candado contra la doble reserva

**Google Calendar no impide eventos superpuestos**: si dos clientes reservan a la
vez, crea las dos citas sin chistar. Y entre «consultar disponibilidad» y «crear
la cita» pasan segundos, que es tiempo de sobra. La garantía no puede vivir ahí.

`/tenants/{t}/agenda/{funcionarioId}_{aaaammdd}_{ranura}`. El día se parte en
ranuras de 15 minutos; una cita de 60 ocupa cuatro. El identificador es
determinista y la reserva se hace con `create` **dentro de una transacción**:
`create` falla si el documento ya existe, y la transacción hace que las cuatro
ranuras se tomen todas o ninguna. Eso es exclusión mutua de verdad, no una
comprobación previa.

**La superposición parcial queda cubierta** porque el choque no se busca por hora
de inicio —el reflejo natural, que dejaría pasar justamente ese caso— sino por
ranura: 11:00–12:00 y 11:30–12:30 comparten dos.

La ranura **no lleva datos personales**: ni teléfono ni nombre del cliente. Es un
candado, no un registro. No se actualiza —mover una cita es liberar y volver a
tomar, para que siga siendo atómico— y sí se borra al cancelar, porque si no el
horario quedaría bloqueado para siempre.

#### Lo que este diseño NO garantiza

Dicho sin adornos, porque es la parte que importa:

1. **El candado solo conoce las citas que pasaron por el asistente.** Si alguien
   del comercio carga una cita a mano en Google Calendar, esta colección no se
   entera y el choque vuelve a ser posible. Por eso el flujo **sigue consultando
   Calendar** antes de ofrecer horarios: Calendar cubre lo manual, el candado
   cubre la concurrencia. Ninguno de los dos alcanza solo.
2. **Firestore y Calendar pueden divergir.** La cita se crea en dos sistemas y no
   hay transacción entre ellos. Si el `create` en Calendar falla después de tomar
   la ranura, queda una ranura ocupada sin cita. Mitigación: liberar la ranura
   ante un fallo de Calendar, y una tarea de reconciliación pendiente.
3. **La granularidad de 15 minutos redondea hacia arriba.** Una cita de 5 minutos
   ocupa una ranura entera. Es deliberado —los turnos reales no son de 5
   minutos— pero hay que saberlo antes de prometer agendas al minuto.


<!-- movido de admin/DISENO.md §4quinquies.5 (25/09/2026, líneas 1257-1282) -->

### 4quinquies.5 El ID de calendario, validado en los dos lados

Es **el dato que más caro salió en este proyecto**: uno pegado a mano con un
carácter de menos hizo que Google devolviera 404 al crear, que el agente
confirmara igual, y que la lectura de disponibilidad fallara **en silencio** — el
agente pasó a inventar los horarios y llegó a ofrecer las 15:00 pisando una cita
de las 15:30. El síntoma no apuntaba a la causa por ninguna parte.

Ahora que habrá uno por funcionario cargado desde el panel, la validación está en
**el panel y en las reglas**, con las dos trampas que ya se aprendieron
escribiendo `scripts/fijar-calendario.sh`:

1. **Exactamente 64 hexadecimales.** No «32 o más». La primera versión de aquel
   script aceptaba un ID truncado, que es justo el caso que existía para impedir.
   *Un validador que no rechaza el caso que motivó escribirlo no valida nada.*
2. **El orden importa.** Un ID de calendario **tiene forma de correo**: si se
   prueba primero la forma de correo, un ID de grupo malformado cae ahí y pasa.
   En las reglas esa precedencia se expresa negando la segunda rama — lo que
   termina en `@group.calendar.google.com` se juzga únicamente con la regla
   estricta, sin red de rescate.

Vacío es válido y significa «sin agenda propia». Lo que no puede pasar es un
valor con forma equivocada, porque eso falla en silencio.

---


<!-- movido de admin/DISENO.md §4quaterdecies (25/09/2026, líneas 2823-2830) -->

## 4quaterdecies. Recordatorio de solicitud pendiente

**17/09/2026, `Analisis/31` §4.** De cada diez personas que le escriben a la
clínica, cuatro no terminan de reservar. **Un** recordatorio recupera a una
parte. Dos, o uno a quien pidió que lo dejen en paz, cuestan el número de
WhatsApp del comercio, que es su canal entero. Por eso todo lo de acá está
escrito en forma de negación.


<!-- movido de admin/DISENO.md §4terdecies.1 (25/09/2026, líneas 2831-2851) -->

### 4terdecies.1 Quién entra, y quién no

La decisión es una función pura del servidor —`esPendienteDeSeguimiento`, en
`functions/src/seguimientos.ts`— y se prueba caso por caso en
`pruebas/seguimientos.test.ts`. Entra la conversación que cumple **todas**:

| Condición | Por qué |
|---|---|
| `solicitud.etapa` es `horarios` o `qr_enviado` | Son las dos etapas a medio camino. `agendada` y `vencida` están cerradas: **nunca a quien ya agendó** |
| `solicitud.seguimientos === 0` | **Nunca dos veces a la misma solicitud.** El cero tiene que estar escrito: un campo ausente o con otro tipo no entra |
| `noContactar !== true` | **Nunca a quien pidió que no le escriban**, ni a quien pasó a una persona |
| `atencionEstado` no es `operador` ni `bloqueado` | Esa conversación ya la atiende alguien, o el asistente dejó de responder por uso extendido. Un recordatorio automático encima sería el peor mensaje posible |
| `ultimoEn` entre 2 y 4 h → **texto**; entre 24 y 48 h → **plantilla** | Entre las 4 y las 24 no se manda nada: la ventana está por vencer o recién venció, el texto ya no entra y la plantilla llegaría de madrugada. Después de las 48 un recordatorio ya no es una actualización, es publicidad |

Tope de 50 por corrida. La consulta va por `ultimoEn` entre 2 y 48 horas atrás
—acotada por construcción— y el resto se filtra en memoria: consultar por
`solicitud.etapa` devolvería un conjunto que crece sin techo, porque una
solicitud en `horarios` que nadie retoma se queda ahí para siempre. **No hace
falta ningún índice compuesto**: es un campo con dos extremos de rango y el
orden sobre ese mismo campo.


<!-- movido de admin/DISENO.md §4terdecies.2 (25/09/2026, líneas 2852-2864) -->

### 4terdecies.2 La marca va ANTES del envío

El flujo llama primero a `seguimientoEnviado` y recién después manda. Si el
envío falla, la solicitud queda marcada y nadie reintenta: **un seguimiento
perdido es mejor que dos**, porque el segundo es el que hace que la persona
bloquee el número. `seguimientoEnviado` es idempotente dentro de una
transacción, así que dos corridas simultáneas no pueden mandar dos. El nodo
`¿Se marcó?` del flujo no deja pasar nada que el servidor no haya marcado en
esa corrida.

Es la misma forma que §4duodecies usa para las retenciones vencidas: **primero
se lo digo al servidor, después actúo**.


<!-- movido de admin/DISENO.md §4terdecies.3 (25/09/2026, líneas 2865-2881) -->

### 4terdecies.3 De dónde salen los dos hechos

Los escribe el flujo conversacional dentro de reportes que ya existían —**cero
mensajes agregados**—, y siempre por lo que PASÓ, no por lo que el modelo
escribió:

- **`horarios_ofrecidos`** (reporte del saliente): `consultar_disponibilidad`
  corrió en el turno y `agendar_cita` no. Son los mismos campos que sostienen
  el candado contra la doble reserva.
- **`no_contactar`**: el turno terminó transferido a una persona
  (`transferir === true`, en el saliente), **o** el texto del cliente coincide
  con una expresión regular fija, en el reporte del entrante. Lo que esa
  expresión no cubre —«borrame» sin tilde, «stop»— lo resuelve el interruptor
  **No contactar** de la pantalla de conversaciones, que una persona del
  negocio enciende cuando el cliente se lo pide. La regla de Firestore deja
  escribir ese campo, y solo ese, con un valor booleano.


<!-- movido de admin/DISENO.md §4terdecies.4 (25/09/2026, líneas 2882-2894) -->

### 4terdecies.4 Qué cuesta y qué se mide

El de modo `texto` cae dentro de la ventana: **+1 mensaje, solo en las
conversaciones que quedaron a medio camino**. El de modo `plantilla` cae fuera,
y la ingesta no cuenta un saliente sobre ventana vencida como conversación: al
comercio no se le factura nada. **La respuesta del paciente sí** abre una
conversación nueva, y es exactamente lo que se busca.

Dos contadores del mes, y los dos hacen falta juntos: `seguimientos` (los que
salieron) y `reactivadas` (en cuántos el paciente volvió a escribir dentro de
las 24 h). Los enviados solos no dicen nada. La consola los muestra en
«Consumo» solo cuando el período los trae.


<!-- movido de admin/DISENO.md §4terdecies.5 (25/09/2026, líneas 2895-2901) -->

### 4terdecies.5 Lo que este bloque NO hace

No manda plantillas de **marketing** ni reactivación de base: eso es un paquete
aparte, nunca incluido en el plan (`Analisis/31` §4). No le escribe a nadie que
no haya escrito primero. Y no mide de dónde vino el lead —la ventana gratuita
de 72 h de los anuncios sigue pendiente desde `Analisis/25` §1.4.
