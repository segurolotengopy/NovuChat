# Agenda mínima v0: contrato de construcción

Lo escribió la sesión constructora el 30/09/2026. Es el plan que siguen los
dos agentes que construyen en paralelo. **Principio: el código calcula, el
modelo conversa.** El modelo nunca decide una hora, nunca lee el calendario y
nunca confirma una cita.

Fuentes (solo lectura):
- `Flujos/bellido-agendamiento.json`: el flujo vivo, de donde se copian los
  contratos (configuración, ingesta, cierre, plantilla al doctor, envío de
  interactivos, audio).
- `admin/scripts/datos/negocio-bellido.json`: la forma de la configuración.
- La rama `origin/cartera/bellido-doctor-29-09` (PR #286): las reglas del
  doctor. Se lee con `git show`, no se fusiona.
- `Flujos/src/core/` y `Flujos/src/modulos/agenda/`: cómo se resolvió cada
  incidente (día lleno, «9 am», dos citas con un «sí», reagendar, la hora que
  pide es la de su propia cita).

## 1. Archivos y quién los escribe

Todo va bajo `Flujos/experimental/agenda-minima/` (fuera de la frontera de
zonas: `fronteras.test.ts` solo lee `Flujos/src/`).

| Archivo | Quién | Qué |
|---|---|---|
| `src/lib/agenda.js` | agente A | Funciones puras de agenda (§3). Sin `require`, sin globales de Node (`URL`, `Buffer`, `crypto`) y sin red |
| `admin/pruebas/agenda-minima-lib.test.ts` | agente A | Suite pura de la librería |
| `src/nodos/*.js` | agente B | El código de cada nodo Code. Usa las funciones de §3 por nombre, sin definirlas |
| `flujo.plantilla.json` | agente B | El flujo de n8n sin el código: cada nodo Code lleva `"jsCode": "@@nodos/<archivo>.js"` |
| `construir.mjs` | agente B | Arma `agenda-minima.v0.json`: en cada nodo Code pone `lib/agenda.js` + el archivo del nodo. Con `--verificar` falla si el JSON versionado difiere de lo que arma |
| `agenda-minima.v0.json` | agente B | El flujo armado, con marcadores `REEMPLAZAR_*` y sin identificadores |
| `admin/pruebas/agenda-minima-flujo.test.ts` | agente B | Suite pura del flujo: evalúa el código de cada nodo del JSON armado con un n8n de mentira |
| `DISENO.md` | agente B | Tabla nodo por nodo, diagrama de estados, lo que no hace, y mensajes por conversación contra Bellido |
| `admin/vitest.config.ts` | agente B | Registra las dos suites en `SUITES_PURAS` |

Nadie toca otro archivo del repositorio. Nadie hace commit ni push. Nadie
llama a n8n, a Meta, a Google ni a Gemini.

## 2. Reglas que el flujo tiene que cumplir

Del proyecto (`CLAUDE.md`):
1. **Candado por hecho.** Antes de crear se relee el hueco. Después de crear
   se relee otra vez, y si hay otro evento que se cruza, **se borra el
   propio**, se le dice al paciente y se le vuelve a ofrecer. El paso de
   después no se omite nunca.
2. **Solo se ofrece lo que se cumple.** Todo error (modelo, calendario,
   plataforma) y toda pregunta sin respuesta en la configuración termina en
   transferencia: aviso a recepción **más** botón o enlace para escribirle.
   El texto nunca dice «lo consulto», «te aviso», «te llamamos» ni «te
   escribirán».
3. **Nunca se confirma lo que no se creó.** Si el calendario falla al leer,
   crear o releer, no hay confirmación: `mensajeErrorTemporal` y transferencia.
4. **Nada clínico.** Ni dosis, ni indicación, ni diagnóstico. En emergencia no
   se menciona el 168.
5. **Memoria por teléfono.** La clave del estado es `messages[0].from`.
6. **Filtro de eventos.** Solo pasan cargas con `messages`.
7. **Fecha y hora** en `America/La_Paz` (UTC-4 fijo, sin horario de verano),
   inyectadas al modelo. El día de la semana sale de código.
8. **El reporte del entrante va antes de la rama del modelo**, y hay una
   llamada de ingesta por cada mensaje entrante y por cada saliente.
9. **Cada mensaje cuesta.** El texto de la oferta va en el cuerpo del mismo
   mensaje interactivo. No se manda un texto aparte.

Del doctor (PR #286 y lo publicado el 30/09):
- **P11.** Dos hermanos van en **una** cita de `duracionPorDefectoMin`
  minutos, con los dos nombres en el título.
- **P12.** Recién nacido y niño sano tienen la misma prioridad. Se ofrece
  **desde mañana**; **hoy solo si el paciente lo pide** y hay hueco que
  respete la anticipación mínima.
- **P13.** El título del evento es «Apellidos, Nombres (CNS)» para control de
  niño sano y «Apellidos, Nombres (RN)» para recién nacido. La marca la pone
  el código según el servicio, no el modelo.
- **Día lleno:** se dice que ese día no queda espacio y se ofrece el
  siguiente día hábil con huecos.
- **«9 am»:** si pide una hora concreta y está libre, va primera en la
  oferta. Si está ocupada, se dice y se ofrecen las más cercanas.
- **Un «sí» no agenda nada.** Agendar exige tocar un botón de hueco. Si
  escribe «ya», «sí» o «dale» con una oferta pendiente, se le pide tocar un
  botón, y se vuelve a mandar la oferta.
- **Reagendar no pierde la cita:** se crea la nueva, pasa el candado, y
  recién entonces se borra la anterior.
- **La hora que pide es la de su propia cita:** al calcular huecos para
  mover, los eventos del propio teléfono no bloquean… pero tampoco se ofrece
  la misma hora que ya tiene: se le dice que esa ya es su cita.
- **Emergencia:** `mensajeEmergencia` y enlace a recepción al paciente;
  aviso al doctor por la plantilla `alerta_emergencia`, y si falla, por texto.

## 3. La librería `src/lib/agenda.js` (agente A)

JavaScript plano, funciones declaradas con `function` en el ámbito global del
nodo (el nodo Code no tiene módulos). Todas puras: reciben datos y devuelven
datos. El tiempo entra como parámetro (`ahoraMs`), nunca con `Date.now()`
adentro. Zona fija: `TZ_OFFSET_MIN = -240`.

```js
// Fechas en La Paz. `fecha` es 'AAAA-MM-DD'; `iso` lleva el desplazamiento -04:00.
fechaLocal(ms)                      // -> 'AAAA-MM-DD'
horaLocal(ms)                       // -> 'HH:MM'
diaDeLaSemana(fecha)                // -> 'lunes' | ... | 'domingo'
isoLocal(fecha, 'HH:MM')            // -> 'AAAA-MM-DDTHH:MM:00-04:00'
msDe(iso)                           // -> número
sumarDias(fecha, n)                 // -> 'AAAA-MM-DD'
etiquetaDeHueco(iso)                // -> 'Jue 15:00' (20 caracteres o menos)
textoDeFecha(iso)                   // -> 'jueves 2 de octubre a las 15:00'

// Horario. `horario` es el de la configuración, en la forma que devuelve
// `configuracionFlujo` para Bellido (leerla del flujo vivo y de
// negocio-bellido.json; aceptar las dos formas si difieren).
tramosDelDia(horario, fecha)        // -> [{desde:'HH:MM', hasta:'HH:MM'}], [] si cerrado

// Eventos del calendario, tal como los devuelve el nodo Google Calendar
// (getAll): {id, summary, description, status, transparency,
//  start:{dateTime|date}, end:{dateTime|date}}.
ocupados(eventos, opciones)         // -> [{inicioMs, finMs, id}]; ignora cancelados y
                                    //    `transparent`; un evento de día entero ocupa el día;
                                    //    opciones.ignorarIds: ids que no bloquean (mover)

huecosDelDia({eventos, fecha, horario, duracionMin, ahoraMs, anticipacionMin, franja, ignorarIds})
  // -> [{inicio: iso, fin: iso, etiqueta}] en orden. Solo en punto o y media.
  //    La cita entera cabe en el tramo y no toca ningún ocupado.
  //    franja: 'manana' (antes de 12:00) | 'tarde' (12:00 o después) | 'cualquiera'.

ofertaDeHuecos({eventos, cfg, ahoraMs, fechaPreferida, horaPreferida, franja, pidioHoy, ignorarIds, maximo})
  // cfg: {horario, duracionPorDefectoMin, anticipacionMinimaMin, anticipacionMaximaDias}
  // -> {huecos: [...hasta `maximo` (3)], dia: 'AAAA-MM-DD' | null,
  //     aviso: null | 'dia_lleno' | 'dia_cerrado' | 'fecha_pasada' | 'hora_ocupada'
  //            | 'fuera_de_rango' | 'sin_huecos',
  //     diaPedido: 'AAAA-MM-DD' | null}
  // Reglas: sin fecha, desde MAÑANA (P12); hoy solo si pidioHoy o fechaPreferida es hoy.
  // Día pedido sin huecos -> aviso 'dia_lleno' (o 'dia_cerrado') y los huecos del
  // siguiente día con huecos. horaPreferida libre -> va primera; ocupada -> 'hora_ocupada'
  // y las más cercanas. Busca hasta 14 días hacia adelante; si no hay -> 'sin_huecos'.

rangoALeer({ahoraMs, fechaPreferida, dias})  // -> {desde: iso, hasta: iso} para el nodo que lee la agenda

hayCruce({eventos, inicio, fin, exceptoId})  // -> {cruce: boolean, con: [ids]}
  // Es el candado: se llama antes de crear (exceptoId vacío) y después (exceptoId = el propio).

tituloDeLaCita({pacientes, servicio})
  // pacientes: [{apellidos, nombres}] (1 o 2; hermanos = 2)
  // servicio: 'control_nino_sano' -> '(CNS)'; 'control_recien_nacido' -> '(RN)'
  // -> 'Pérez Gómez, Ana (CNS)'; hermanos del mismo apellido ->
  //    'Pérez Gómez, Ana y Luis (CNS)'; de apellido distinto -> 'Pérez, Ana / Rojas, Luis (CNS)'.
  // Mira cómo lo arma el #286 y cómo lo lee «Comprobar reserva» (con o sin «Cita»).

descripcionDeLaCita({telefono, servicio, pacientes, nombrePerfil})
  // Texto de la descripción. Siempre incluye la línea exacta `Tel: <telefono>`.

citasDelTelefono({eventos, telefono, ahoraMs})
  // -> [{id, inicio, fin, titulo, etiqueta}] futuras, cuya descripción trae `Tel: <telefono>`.

idDeBoton(tipo, datos) / leerIdDeBoton(id)
  // 'h|<inicio iso>|<servicio>'  hueco
  // 'c|<eventId>'                cancelar esa cita
  // 'm|<eventId>'                mover esa cita
  // 256 caracteres como máximo (tope de Meta para el id). leer -> {tipo, ...} o null.

partirNombre(texto)
  // 'Ana Pérez Gómez' -> {apellidos:'Pérez Gómez', nombres:'Ana'} (heurística simple y
  // documentada: si hay coma, «Apellidos, Nombres»; con 2 palabras, nombre + apellido;
  // con 3 o más, la primera es el nombre). Devuelve null si está vacío o es un saludo.
```

## 4. El estado por teléfono (agente B)

En `$getWorkflowStaticData('global').agendaMinima[telefono]`:

```js
{ paso: 'inicio' | 'menu' | 'ofreciendo_huecos' | 'esperando_nombre' | 'cancelando' | 'moviendo',
  servicio: 'control_recien_nacido' | 'control_nino_sano' | null,
  hermanos: boolean,
  huecoElegido: iso | null,       // el botón que tocó, mientras falta el nombre
  moverId: eventId | null,        // la cita que está moviendo
  ultimaOferta: [iso, ...],       // para volver a mandarla si escribe «ya»
  ultimoMensajeMs: number }       // vence a los 30 minutos
```

Lo que cabe en el id del botón no se guarda. Al leer, un estado vencido es
`inicio`. En cada turno se limpian los teléfonos vencidos (el objeto no crece
sin tope).

## 5. El grafo (agente B)

Un solo ítem recorre el flujo. Los nodos Code corren «una vez para todos los
ítems». Los nodos de calendario y de HTTP llevan `alwaysOutputData: true` y
`onError: continueRegularOutput`, para que un fallo llegue al código en vez
de cortar la ejecución.

```
WhatsApp Trigger ──┐
Entrada de prueba ─┴→ ¿Es un mensaje? → Traer configuración → Config del negocio
  → Reportar mensaje (entrante) → Interpretar entrada
  → ¿Es audio? ─sí→ Obtener URL del medio → Descargar medio → Transcribir audio ─┐
               └no────────────────────────────────────────────────────────────────┴→ Decidir turno
  → ¿Extraer? ─sí→ Extraer (Gemini, JSON) ─┐
              └no───────────────────────────┴→ Plan del turno
  → ¿Leer agenda? ─sí→ Leer agenda ─┐
                  └no────────────────┴→ Resolver con agenda
  → ¿Crear cita? ─sí→ Crear evento → Releer el hueco → Candado → ¿Hay cruce? ─sí→ Deshacer cita ─┐
                 │                                                   └no→ Registrar cierre (cita) ─┤
                 └no────────────────────────────────────────────────────────────────────────────────┴→ ¿Borrar cita? ─sí→ Borrar evento ─┐
                                                                                                                       └no────────────────┴→ ¿Redactar?
  → ¿Redactar? ─sí→ Redactar (Gemini, texto) ─┐
               └no────────────────────────────┴→ Armar mensajes
  → Armar mensajes (un ítem por mensaje saliente) → Enviar a WhatsApp
  → ¿Falló el envío? ─sí→ Enviar respaldo (texto) ─┐
                     └no────────────────────────────┴→ Reportar mensaje (saliente)
```

- **Entrada de prueba** es un nodo Webhook (`POST`) que recibe la misma carga
  que entrega el disparador de WhatsApp. Sirve para probar sin activar el
  disparador. Su ruta va como marcador `REEMPLAZAR_RUTA_DE_PRUEBA`.
- **Armar mensajes** devuelve un ítem por mensaje: `{para, payload, respaldo,
  tipoReporte, texto}`. `payload` es el cuerpo completo para
  `POST /{version}/{phoneNumberId}/messages` (texto, `interactive` de lista o
  de botones, `contacts`, `location` o `template`). `respaldo` es el texto que
  se manda si Meta rechaza el `payload`. Los destinatarios posibles son el
  paciente, recepción y el doctor.
- **Enviar a WhatsApp** es un solo `HTTP Request` para todo. El
  `phoneNumberId` sale de `metadata.phone_number_id` del mensaje entrante.
- **Mover:** «Crear cita» y «Borrar cita» en el mismo turno, en ese orden. Si
  el candado encuentra cruce, **no** se borra la anterior.
- **Comercio no operativo y uso extendido:** se respeta lo que devuelve la
  ingesta del entrante, con los mismos textos que Bellido.
- Un nodo que no corrió no se lee con `$('Nodo').item`: antes se mira
  `$('Nodo').isExecuted`.

Credenciales, por nombre y con `id` vacío (el publicador las resuelve):
- `NovuChat ingesta (Bellido)`: configuración, ingesta y cierre;
- `Graph WhatsApp Bellido (Bearer)`: «Enviar a WhatsApp» y «Enviar respaldo»;
- `WhatsApp Consultorio Bellido (envío)`: obtener y descargar el medio;
- Google Calendar y Gemini: el nombre queda vacío, como en el JSON de Bellido.

Modelo: `gemini-3.5-flash-lite`, el mismo de Bellido. Extracción con
`responseMimeType: application/json` y el `responseSchema` del prompt 01,
ampliado con `horaPreferida` (`HH:MM` o null), `pidioHoy` (boolean),
`hermanos` (boolean) y `pacientes` (lista de nombres completos).
`maxOutputTokens` 200. Redacción: solo texto, 300 tokens. Sin `temperature`
ni `topP`. Las dos llamadas son `HTTP Request` con la credencial predefinida
`googlePalmApi`; confirmar sus parámetros con el método de
`parametros-de-nodos-n8n-desde-npm` (`npm pack` de los paquetes 2.36.5, en el
scratchpad).

## 6. La suite del flujo (agente B)

`admin/pruebas/agenda-minima-flujo.test.ts` lee el JSON armado y corre el
código de cada nodo Code con un n8n de mentira (`$input`, `$json`, `$()`,
`$getWorkflowStaticData`). Evalúa con el evaluador que ya usan las demás
suites, que lleva la marca de Semgrep; no escribas un `new Function` nuevo.

Casos mínimos, cada uno con su «niega»:
1. menú; 2. emergencia (sin 168, plantilla `alerta_emergencia` y caída a
texto); 3. vacunas; 4. «quiero cita el jueves en la tarde»; 5. tocar un
botón; 6. nombre faltante; 7. día lleno; 8. sábado cerrado; 9. «ya» con una
oferta pendiente no agenda; 10. reagendar no pierde la cita; 11. audio;
12. foto deriva; 13. el cruce después de crear deshace la propia;
14. calendario caído no confirma y avisa a recepción; 15. hermanos en una
cita; 16. el título «Apellidos, Nombres (CNS)» y «(RN)»; 17. desde mañana, y
hoy solo si lo pide; 18. nada clínico; 19. el JSON no tiene identificadores
ni secuencias de 10 dígitos o más; 20. el reporte del entrante está antes de
la rama del modelo, por posición y por conexiones; 21. dos teléfonos no
comparten estado; 22. un mensaje por saliente reportado.
