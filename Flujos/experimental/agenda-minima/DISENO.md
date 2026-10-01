# NovuChat — Agenda mínima (v0): diseño

Reformulación del flujo de Bellido (96 nodos) con un principio: **el código calcula, el modelo
conversa**. El modelo nunca decide una hora, nunca lee el calendario y nunca confirma una cita. Los
huecos los calcula `src/lib/agenda.js`; la confirmación es un **botón**, no la interpretación de un
«sí»; el texto de la confirmación lo arma el código con el día y la hora del evento creado.

Es un flujo **experimental**: vive en `Flujos/experimental/agenda-minima/`, fuera de la publicación
normal, y no se activa contra el número de ningún cliente (contrato: `CONTRATO.md`).

## Estado al 30/09/2026, 19:00 (candidato B del concurso para Bellido, sha 7d49dec)

- **Qué hace:** menú de 4 filas; cita por botón con candado antes y después de crear; hermanos en una cita;
  título «Apellidos, Nombres (CNS)» o «(RN)»; desde mañana, hoy solo si lo piden; día lleno ofrece el siguiente;
  una hora escrita que coincide con la oferta cuenta como el botón (una PREGUNTA no); reagendar y cancelar por
  botón, sin perder la cita; emergencia con botón a recepción y aviso al doctor (plantilla, texto de respaldo);
  vacunas y cremas al doctor; audio transcripto (hasta 720.000 bytes).
- **Consultas por código**, con textos de la configuración: servicios, dirección, horario (solo el del panel) y
  **costo, solo si el paciente lo pregunta explícitamente** (Andres, 30/09; `respuestaCosto` en «Config base»).
  Un monto nunca sale de la redacción del modelo.
- **Imágenes:** con pie, se procesan como ese texto; sin pie, «Recibí tu imagen. ¿Qué necesitas?» con el menú.
- **Mensajes por cita típica: 5** (menú, oferta, nombre, confirmación y redes del doctor en un segundo mensaje,
  como pidió el doctor), igual que el flujo actual de Bellido.
- **Revisiones:** tres rondas de seguridad (0 críticas y 0 altas abiertas); cuatro rondas del arnés de la
  revisora; prueba con teléfono real de Andres en el Demo A (5 observaciones, corregidas).

### Límites conocidos y lo que queda para después
- **Describir imágenes con Gemini** (como el flujo actual): hoy una imagen sin pie no se lee.
- **Header Auth en el Webhook de prueba** («Entrada de prueba», solo en `agenda-minima.prueba.json`).
- Los textos de transferencia nombran «el botón» aunque falte el número (panel caído y respaldo vacío).
- «A las 11:30 para Juan Pérez Gómez» sin «el paciente es» elige la hora y vuelve a pedir el nombre; una hora
  escrita con dos nombres de hermanos pasa por el modelo.
- Una cita cargada a mano por el doctor, sin línea «Telefono:», no la ve el paciente para moverla o cancelarla:
  pasa a recepción.
- Sin seña, sin comprobantes, sin varias agendas (ver «Lo que NO hace, a propósito»).
- La configuración de Bellido se contradice en el precio (`instruccionesExtra` dice que no hay precios); es de
  datos y la alinea la cartera.

## Archivos

| Archivo | Qué es |
|---|---|
| `flujo.plantilla.json` | El flujo sin el código: cada nodo Code lleva `"jsCode": "@@nodos/<archivo>.js"`. Es lo que se edita |
| `src/lib/agenda.js` | La librería de agenda (agente A): funciones puras, sin red, sin reloj |
| `src/nodos/_comun.js` | Utilidades comunes de los nodos (`cn*`): leer otro nodo por nombre, leer el estado, regex de la configuración |
| `src/nodos/*.js` | El código de cada nodo Code |
| `construir.mjs` | Arma los dos JSON. `--verificar` no escribe y sale 1 si difieren |
| `agenda-minima.v0.json` | **Producción**: con «WhatsApp Trigger», sin «Entrada de prueba» |
| `agenda-minima.prueba.json` | **Prueba**: sin «WhatsApp Trigger», con «Entrada de prueba» (Webhook POST) |
| `admin/pruebas/agenda-minima-flujo.test.ts` | La suite de punta a punta (un n8n de mentira sobre el JSON armado) |

Para cambiar el flujo: editar la plantilla o un archivo de `src/nodos/`, correr
`node construir.mjs` y `pnpm -s vitest run pruebas/agenda-minima-flujo.test.ts pruebas/agenda-minima-lib.test.ts`
desde `admin/`. Para ver una conversación con los ojos: `AGM_VER=1 pnpm -s vitest run pruebas/agenda-minima-flujo.test.ts -t traza`.

## Total de nodos

**45 en la plantilla; 44 en cada variante** (la de producción quita «Entrada de prueba», la de prueba
quita «WhatsApp Trigger»). Bellido: 96. De los 44: 11 Code, 15 IF, 1 Set, 9 HTTP (configuración, ingesta ×2,
cierre, Gemini ×2, Graph ×2 y la descarga del medio), 5 Google Calendar, 1 nodo de medios de WhatsApp, 1 de
Gemini para el audio y 1 disparador.

## El grafo

```
WhatsApp Trigger (prod) ─┐
Entrada de prueba (prueba)┴→ Carga de entrada → ¿Es un mensaje? → Config base → Traer configuración
  → Config del negocio → Interpretar entrada → ¿Reportar? (entrante) ─sí→ Reportar mensaje (entrante) ─┐
                                                                     └no────────────────────────────────┴→ ¿Comercio operativo?
  ¿Comercio operativo? ─no→ Comercio no operativo ───────────────────────────────────────────────────→ Armar mensajes
        └sí→ ¿Atención normal? ─no→ Uso extendido ─────────────────────────────────────────────────→ Armar mensajes
                  └sí→ ¿Es audio? ─sí→ Obtener URL del medio → Descargar medio → Transcribir audio ─┐
                                   └no─────────────────────────────────────────────────────────────┴→ Decidir turno
  Decidir turno → ¿Extraer? ─sí→ Extraer (Gemini, JSON) ─┐
                            └no──────────────────────────┴→ Plan del turno
  Plan del turno → ¿Leer agenda? ─sí→ Leer agenda ─┐
                                  └no──────────────┴→ Resolver con agenda
  Resolver con agenda → ¿Crear cita? ─sí→ Crear evento → Releer el hueco ─┐
                                     └no───────────────────────────────────┴→ Candado
  Candado → ¿Hay cruce? ─sí→ Deshacer cita ─┐
                        └no─────────────────┴→ ¿Registrar cierre? ─sí→ Registrar cierre (cita) ─┐
                                                                 └no──────────────────────────────┴→ ¿Borrar cita? ─sí→ Borrar evento ─┐
                                                                                                                      └no────────────────┴→ ¿Redactar?
  ¿Redactar? ─sí→ Redactar (Gemini, texto) ─┐
             └no──────────────────────────────┴→ Armar mensajes
  Armar mensajes (un ítem por mensaje) → ¿Enviar de verdad? ─sí→ Enviar a WhatsApp ─┐
                                                          └no───────────────────────┴→ ¿Falló el envío? ─sí→ Enviar respaldo ─┐
                                                                                                          └no────────────────┴→ ¿Reportar? (saliente) ─sí→ Reportar mensaje (saliente) ─┐
                                                                                                                                                      └no──────────────────────────────────┴→ Resumen del turno
```

Toda conversación pasa por **Decidir turno → Plan → Resolver → Candado → Armar mensajes**, aunque no
toque el calendario: hay un solo camino de código y un solo lugar donde se escribe el estado.

## Tabla nodo por nodo

«Entra de» y «sale a» son las conexiones de la plantilla. Los IF salen «sí / no».

| Nodo | Tipo | Qué hace | Entra de | Sale a |
|---|---|---|---|---|
| WhatsApp Trigger | whatsAppTrigger | Solo en producción. Mensajes de la Cloud API | — | Carga de entrada |
| Entrada de prueba | webhook (POST, `lastNode`) | Solo en la variante de prueba. Recibe la misma carga de WhatsApp dentro de `body`, más las banderas de prueba. Ruta `REEMPLAZAR_RUTA_DE_PRUEBA` | — | Carga de entrada |
| Carga de entrada | code | Deja la entrada en una forma: acepta la del disparador, la de un Webhook y la carga completa de Meta (`entry[0].changes[0].value`). Lee el modo prueba **solo** del nodo «Entrada de prueba» | las dos entradas | ¿Es un mensaje? |
| ¿Es un mensaje? | if | Filtro de eventos: solo pasan cargas con `messages`. Los acuses se descartan | Carga de entrada | Config base |
| Config base | set | `calendarioForzado` (vacío) y `waGraphVersion`. **El único lugar desde donde se apunta a otro calendario** | ¿Es un mensaje? | Traer configuración |
| Traer configuración | httpRequest | `POST configuracionFlujo`, mismo contrato que Bellido (cuerpo `{telefono}`, cabecera `X-NovuChat-Numero`, respuesta completa, `neverError`) | Config base | Config del negocio |
| Config del negocio | code | Todo lo configurable: 200 = panel, 409 = suspendido, otra = respaldo local sin datos reales (sin calendario). Resuelve calendario, horario, tolerancia y modo prueba | Traer configuración | Interpretar entrada |
| Interpretar entrada | code | Normaliza `text`, `interactive` (`list_reply` antes que `button_reply`), `button`, `audio`/`voice`, `image`, `document` y cualquier otro tipo. Filtra el prefijo de país | Config del negocio | ¿Reportar? (entrante) |
| ¿Reportar? (entrante) | if | En modo prueba no se llama a la ingesta | Interpretar entrada | sí: Reportar (entrante) · no: ¿Comercio operativo? |
| Reportar mensaje (entrante) | httpRequest | Una llamada a `ingesta` por cada mensaje entrante, **antes** de la rama del modelo (arriba en el lienzo). Mismo cuerpo que Bellido, con `no_contactar` | ¿Reportar? (entrante) | ¿Comercio operativo? |
| ¿Comercio operativo? | if | `estadoComercio` de la configuración y, si la respuesta del reporte trae `servicio.estado = cortado`, no operativo. Sin esos campos: operativo | las dos | sí: ¿Atención normal? · no: Comercio no operativo |
| Comercio no operativo | code | Texto neutro del panel, sin revelar el motivo. Sin modelo ni calendario | ¿Comercio operativo? | Armar mensajes |
| ¿Atención normal? | if | `atencion.estado` de la respuesta del reporte o, si no viene, de la configuración. Sin ninguna: normal | ¿Comercio operativo? | sí: ¿Es audio? · no: Uso extendido |
| Uso extendido | code | Operador: aviso fijo y, la primera vez, aviso a recepción. Bloqueado: nada, salvo el aviso. Sin modelo | ¿Atención normal? | Armar mensajes |
| ¿Es audio? | if | `esAudio` | ¿Atención normal? | sí: Obtener URL del medio · no: Decidir turno |
| Obtener URL del medio | whatsApp (media) | GET del id del medio: URL, tipo y `file_size` | ¿Es audio? | Descargar medio |
| Descargar medio | httpRequest | Baja el archivo con el token, como binario. No se guarda en ningún lado | Obtener URL | Transcribir audio |
| Transcribir audio | langchain.googleGemini | `audio:transcribe`, mismo modelo. El audio muere aquí | Descargar medio | Decidir turno |
| Decidir turno | code | Decide **sin modelo**: menú, emergencia, vacunas/cremas (al doctor), botones de hueco/cancelar/mover, «ya»/«sí» suelto, audio ilegible, fotos y otros tipos. Solo el texto libre va a la extracción. Arma el cuerpo de la extracción | ¿Es audio?, Transcribir audio | ¿Extraer? |
| ¿Extraer? | if | `accion = extraer` | Decidir turno | sí: Extraer · no: Plan del turno |
| Extraer | httpRequest | Gemini `generateContent`, `responseMimeType: application/json`, `responseSchema`, 200 tokens, sin `temperature` ni `topP`. Solo entiende el mensaje | ¿Extraer? | Plan del turno |
| Plan del turno | code | Valida campo por campo lo que dijo el modelo y decide el plan y el rango del calendario a leer. El servicio lo elige el menú, no el modelo | ¿Extraer?, Extraer | ¿Leer agenda? |
| ¿Leer agenda? | if | Hay rango que leer | Plan del turno | sí: Leer agenda · no: Resolver con agenda |
| Leer agenda | googleCalendar (getAll) | Un solo calendario, el de `Config del negocio`. 14 días, o 90 para cancelar/mover | ¿Leer agenda? | Resolver con agenda |
| Resolver con agenda | code | **Aquí se calcula**: huecos (`ofertaDeHuecos`), validación del hueco elegido (candado, primera mitad), cita a crear, cita a borrar, cuerpo para redactar | ¿Leer agenda?, Leer agenda | ¿Crear cita? |
| ¿Crear cita? | if | Hay cita que crear | Resolver con agenda | sí: Crear evento · no: Candado |
| Crear evento | googleCalendar (create) | Crea la cita con el título que arma el código («Apellidos, Nombres (CNS)» o «(RN)»). Sin reintentos: un reintento duplicaría | ¿Crear cita? | Releer el hueco |
| Releer el hueco | googleCalendar (getAll) | **Candado, segunda mitad**: relee el calendario después de crear. No se omite nunca | Crear evento | Candado |
| Candado | code | Si hay otro evento que se cruza, o la relectura falla, o la propia no aparece: se borra **la propia**. Solo con relectura limpia hay confirmación y cierre. Reagendar: la anterior se borra recién ahora | ¿Crear cita?, Releer el hueco | ¿Hay cruce? |
| ¿Hay cruce? | if | Hay una cita propia que deshacer | Candado | sí: Deshacer cita · no: ¿Registrar cierre? |
| Deshacer cita | googleCalendar (delete) | Borra la cita propia | ¿Hay cruce? | ¿Registrar cierre? |
| ¿Registrar cierre? | if | Cita creada y verificada, y no es modo prueba | ¿Hay cruce?, Deshacer cita | sí: Registrar cierre (cita) · no: ¿Borrar cita? |
| Registrar cierre (cita) | httpRequest | `registrarCierre` `{tipo: cita, referencia, telefono, nombreCliente}`. Es el modelo comercial: no se omite | ¿Registrar cierre? | ¿Borrar cita? |
| ¿Borrar cita? | if | Hay cita que borrar (cancelar, o reagendar con candado limpio) | ¿Registrar cierre?, Registrar cierre | sí: Borrar evento · no: ¿Redactar? |
| Borrar evento | googleCalendar (delete) | Borra la cita cancelada o la anterior | ¿Borrar cita? | ¿Redactar? |
| ¿Redactar? | if | Hay oferta simple o pregunta que contestar | ¿Borrar cita?, Borrar evento | sí: Redactar · no: Armar mensajes |
| Redactar | httpRequest | Gemini, solo texto, 300 tokens. Recibe los huecos **ya calculados** y los datos del negocio | ¿Redactar? | Armar mensajes |
| Armar mensajes | code | Un ítem por mensaje saliente: `{para, payload, texto, respaldo, tipoReporte, evento, reportar}`. Verifica lo redactado, arma la confirmación, aplica el modo prueba y **escribe el estado** (único lugar) | Candado (vía ¿Redactar?), Comercio no operativo, Uso extendido | ¿Enviar de verdad? |
| ¿Enviar de verdad? | if | Producción: sí. Prueba: solo con `enviarDeVerdad` y `telefonoDePrueba` | Armar mensajes | sí: Enviar a WhatsApp · no: ¿Falló el envío? |
| Enviar a WhatsApp | httpRequest | Un solo nodo para todo (texto, botones, lista, enlace, plantilla). `phoneNumberId` del mensaje entrante | ¿Enviar de verdad? | ¿Falló el envío? |
| ¿Falló el envío? | if | Solo mira un campo `error` explícito | ¿Enviar de verdad?, Enviar a WhatsApp | sí: Enviar respaldo · no: ¿Reportar? (saliente) |
| Enviar respaldo | httpRequest | El mismo contenido como texto, con el enlace adentro. Al doctor: si falla la plantilla, sale el texto | ¿Falló el envío? | ¿Reportar? (saliente) |
| ¿Reportar? (saliente) | if | Solo lo que va AL PACIENTE, y no en modo prueba | ¿Falló el envío?, Enviar respaldo | sí: Reportar (saliente) · no: Resumen del turno |
| Reportar mensaje (saliente) | httpRequest | Una llamada a `ingesta` por cada mensaje enviado al paciente, con el hecho (`horarios_ofrecidos`, `no_contactar`) | ¿Reportar? (saliente) | Resumen del turno |
| Resumen del turno | code | Último nodo. Para la prueba: los mensajes del turno y un resumen. Lee todo por nombre de «Armar mensajes» | ¿Reportar? (saliente), Reportar (saliente) | — |

## El estado por teléfono

`$getWorkflowStaticData('global').agendaMinima[<messages[0].from>]`. Vence a los 30 minutos (un estado
vencido es `inicio`) y en cada turno se barren los vencidos. **Se lee en «Decidir turno» y se escribe
solo en «Armar mensajes»**. Solo funciona con el flujo activo (n8n guarda `staticData` únicamente así).

Campos: los del contrato (`paso`, `servicio`, `hermanos`, `huecoElegido`, `moverId`, `ultimaOferta`,
`ultimoMensajeMs`) más los que no caben en un id de botón: `pacientes` (nombres dichos), `moverInicio`,
`moverTitulo`, `primerTexto` (lo que escribió antes del menú, si dice algo), `ultimoMensajeId` (un
reenvío de Meta no se contesta dos veces) y `pidioSegundoNombre`. Lo que cabe en el id del botón
(`h|<inicio>|<servicio>`, `c|<eventId>`, `m|<eventId>`) no se guarda.

```
                    ┌──────────── escribe «cancelar» / «reagendar» (sin menú) ────────────┐
                    │                                                                      ▼
 inicio ──(1er mensaje)──► menu ──(elige servicio)──► ofreciendo_huecos ◄──(otra hora / otro día)──┐
   ▲  ▲                     │                               │  │                                   │
   │  │      (vacunas, emergencia: botón y fin)             │  └──(toca un hueco sin nombre)──► esperando_nombre
   │  │                                                     │                                        │
   │  └────────── cita creada y verificada (inicio) ◄───────┴──(toca un hueco con nombre)────────────┘
   │                                                           (Crear → Releer → Candado)
   │                                                                 │ cruce: se deshace la propia y vuelve a
   │                                                                 └──────────────► ofreciendo_huecos
   ├── cancelando ──(toca «Cancelar …»)──► inicio
   └── moviendo ──(elige cita, si hay varias)──► ofreciendo_huecos (con moverId) ──(toca un hueco)──► crea la nueva, candado, y recién entonces borra la anterior
```

## Cómo apuntar a un calendario de prueba

Todos los nodos de calendario leen el id de `$('Config del negocio')`, y «Config del negocio» lo
resuelve en **un solo lugar**, en este orden:

1. `calendarioForzado` del nodo **«Config base»** (un Set al principio del flujo; **vacío** en el JSON
   versionado). Si no está vacío, manda sobre todo lo demás.
2. En modo prueba, `body.calendarioDePrueba` de «Entrada de prueba». Sin él, el calendario queda
   **vacío** (los nodos de calendario fallan y el flujo transfiere): nunca se cae al real.
3. El `calendarioId` de la configuración del panel.

Para probar contra otro calendario sin tocar nada más: poner su id en `calendarioForzado` (campo
`Config base → calendarioForzado`). Un nodo de calendario nuevo tiene que leer
`={{ $('Config del negocio').first().json.calendarioId }}`; la suite lo comprueba.

## La variante de prueba

`agenda-minima.prueba.json` se sube a n8n para probar. **No tiene «WhatsApp Trigger»**: activar un flujo
con ese nodo registra el disparador en Meta y le quita el webhook al flujo vivo de la misma app.
Entra por «Entrada de prueba» (Webhook POST, `responseMode: lastNode`) con la carga de WhatsApp dentro
de `body` (o la carga completa de Meta) y, opcionales:

| Campo de `body` | Efecto |
|---|---|
| `modoPrueba: true` | Activa el modo. Solo vale `true` literal |
| `calendarioDePrueba` | Calendario de todos los nodos (ver arriba) |
| `telefonoDePrueba` | Todo mensaje saliente va a este número, sea cual sea el destinatario, con el prefijo «[a recepción]» o «[al doctor]» cuando corresponde |
| `enviarDeVerdad` | Falso por omisión: «Enviar a WhatsApp» y «Enviar respaldo» se saltean y los mensajes quedan como enviados. Verdadero: se envía de verdad, solo a `telefonoDePrueba` |

En modo prueba **no se llama a la ingesta ni al cierre** y la atención se toma como normal; la
configuración sí se pide.

**El disparador real no puede activar el modo.** La bandera no se lee de la carga: «Carga de entrada»
pregunta si corrió el nodo «Entrada de prueba» y lee **su** cuerpo. El JSON de producción no tiene ese
nodo (`$('Entrada de prueba')` ni existe), así que una carga de WhatsApp con `modoPrueba` en la raíz,
dentro del mensaje o en el texto no cambia nada. La suite lo prueba con tres cargas maliciosas.

**La respuesta de la prueba** es el resultado de «Resumen del turno»:

```
{ ok, modoPrueba,
  mensajes: [{ para, destino, payload, texto, respaldo, reportar }],
  resumen: { ruta, accion, huecosOfrecidos, eventoCreadoId, eventoBorradoId, estadoDespues, errores, mensajesSalientes } }
```

`ruta` es el plan del turno (`menu`, `emergencia`, `ofrecer`, `crear`, `cancelar`, `cruce`, `error`…) y
`accion` lo que pasó (`cita_creada`, `cita_movida`, `cita_cancelada`, `cruce_deshecho`…).

## Compatibilidad con el arnés de la revisora

Ella clona el JSON, cambia el disparador por un Webhook, desactiva los nodos de envío, la ingesta y el
cierre (un nodo desactivado deja pasar su entrada) y apunta el calendario a uno de prueba. Por eso:

- La entrada se normaliza desde las tres formas (disparador, `body.messages` y `entry[0].changes[0].value`).
- **Nada depende de la respuesta de un nodo de envío, de la ingesta ni del cierre**: sin campos de
  atención o servicio en la respuesta del reporte, atención normal y comercio operativo; «¿Falló el
  envío?» solo mira un `error` explícito; después de un envío o un reporte, los datos salen de un nodo
  Code anterior por nombre (`$('Armar mensajes')`).
- Un audio sin transcripción (el nodo de medios es de tipo whatsApp y ella lo desactiva) no rompe el
  flujo: pide que lo escriban.

### Nodos que el arnés de la revisora necesita (nombre e `id` en el JSON)

| Para qué | Nombre (así se busca) | `id` |
|---|---|---|
| Inicio: la entrada queda en una sola forma | «Carga de entrada» | `carga-entrada` |
| Inicio: el mensaje normalizado (teléfono, tipo, texto) | «Interpretar entrada» | `interpretar` |
| Reporte del entrante (se desactiva) | «Reportar mensaje (entrante)» | `reportar-entrante` |
| Todo lo que sale (un ítem por mensaje) | «Armar mensajes» | `armar` |
| Salida: el envío (se desactiva) | «Enviar a WhatsApp» | `enviar` |
| Salida: el envío de respaldo (se desactiva) | «Enviar respaldo» | `enviar-respaldo` |
| Salida: reporte del saliente (se desactiva) | «Reportar mensaje (saliente)» | `reportar-saliente` |
| Salida: el cierre comercial de la cita (se desactiva) | «Registrar cierre (cita)» | `registrar-cierre` |
| Último nodo: los mensajes y el resumen del turno | «Resumen del turno» | `resumen` |

## Lo que NO hace, a propósito

- **Seña y comprobantes**: ni QR, ni lectura de comprobantes, ni retención de la cita. Bellido no cobra seña;
  es la rama más grande del flujo vivo y no entra en una agenda mínima.
- **Varias agendas**: un solo calendario, el de `Config del negocio`. Sin funcionarios ni calendario por servicio.
- **Clasificación de imágenes y documentos**: una foto o un archivo se derivan a recepción (aviso más botón); no se leen.
- **Nada clínico**: ni dosis, ni indicación, ni diagnóstico. Una pregunta de salud se transfiere. En emergencia no se menciona el 168.
- **Agente con herramientas ni memoria de conversación de n8n**: no hay. El modelo no tiene herramientas.
- **Campañas del menú**: no salta el menú por una campaña (la única excepción de menú es cancelar o mover).
- **Tarjeta de contacto (`contacts`)**: el doctor y recepción se abren con un botón `cta_url` a `wa.me`, como el flujo vivo de Bellido.
- **Ubicación como pin**: la dirección y el mapa van dentro de la confirmación, no en un mensaje aparte.
- **Un «sí» que agende**: agendar exige tocar un botón de hueco.
- **Confirmar lo que no se creó**: sin cita creada y verificada, no hay confirmación ni cierre.
- **Recordatorios, seguimientos y campañas de salida**: son otros flujos.

## Mensajes salientes por conversación: Agenda mínima contra Bellido

Cada mensaje que envía el flujo cuesta (0,0113 USD por mensaje desde el 01/10/2026; `docs/base-comercial.md` §1).

**Bellido, contado en su JSON.** Los nodos que envían al paciente son: «Enviar interactivo» (menú, contacto
directo y emergencia), «Responder al cliente» (cada respuesta del agente), «Enviar ubicación», «Enviar contacto»,
«Redes del doctor» y «Enviar QR de la seña»; y a otras personas, «Avisar a recepción» y «Avisar al doctor»
(plantilla o texto). Hay 9 nodos que envían y 7 que reportan salientes. El agente contesta **cada** turno de
texto: el menú sale una vez por ventana; el «Redes del doctor» sale **solo** tras una cita verificada.

| Conversación | Bellido | Agenda mínima | Diferencia |
|---|---|---|---|
| **Cita típica** (hola, servicio, hueco, nombre, confirmación) | menú (1) + respuesta del agente con horarios (1) + pregunta del nombre o «¿te la agendo?» (1 o 2) + confirmación (1) + redes (1) = **5 a 6** | menú (1) + oferta con botones (1) + pide el nombre (1) + confirmación (1) + redes (1) = **5** | **0 a −1** |
| Emergencia | botón a recepción (1) + aviso al doctor (1) = 2 | botón a recepción (1) + aviso al doctor (1) = **2** | 0 |
| Vacunas y otros | contacto al doctor (1) | contacto al doctor (1) = **1** | 0 |
| Cancelar una cita | pregunta y confirmación del agente (1 o 2) + resultado (1) = 2 a 3 | botón «Cancelar» (1) + resultado (1) = **2** | 0 a −1 |
| Reagendar (una cita) | agente: cancelar, confirmar, ofrecer, nombre, confirmar = 4 o más | oferta directa (1) + confirmación (1) = **2** | −2 o más |
| Foto o audio sin entender | respuesta del agente (1) | 1 (audio: pide que lo escriba; foto sin pie: «Recibí tu imagen» con el menú) | 0 |
| Error del modelo o del calendario | «problema técnico» (1) | texto con botón (1) + aviso a recepción (1) = **2** | +1 (cumple la política de transferencia) |

- Las redes del doctor van en un **segundo** mensaje después de la confirmación, como en el flujo actual (petición
  del doctor, fila 23 de la aceptación, 30/09). La primera versión las ponía dentro de la confirmación.
- Los avisos a recepción y al doctor no son mensajes de la conversación del paciente (no se reportan a la
  ingesta), pero sí cuestan como envío: son los +1 de emergencia, errores y transferencias, igual que Bellido.
- **Llamadas a la ingesta**: una por cada mensaje entrante y una por cada saliente al paciente. La suite las
  cuenta (`caso 22`).
- **Modelo**: menú, emergencia, vacunas, botones, «ya»/«sí», fotos y audios ilegibles **no llaman a ningún modelo**.
  Un turno de texto libre hace como mucho dos llamadas cortas (extracción de 200 tokens y redacción de 300), contra
  el agente de Bellido con herramientas y hasta 4.096 tokens de salida por vuelta. Una oferta con aviso (día lleno,
  día cerrado, hora ocupada) ni siquiera se redacta: el texto lo arma el código.

## Reglas del proyecto que este flujo hace cumplir en código

| Regla | Dónde |
|---|---|
| Candado por hecho (nunca una cita encima de otra) | «Resolver con agenda» valida antes; «Releer el hueco» + «Candado» después; si hay cruce o no se puede comprobar, se borra la propia |
| Solo se ofrece lo que se cumple | «Armar mensajes»: toda transferencia es aviso a recepción **más** botón; ningún texto promete «te aviso», «lo consulto», «te llamamos», «te escribirán» (y una redacción del modelo que lo diga se descarta) |
| Nunca se confirma lo que no se creó | «Candado» cambia el plan a `error` si el calendario falló al leer, crear o releer |
| Nada clínico | «Plan del turno» transfiere una pregunta de salud; «Armar mensajes» descarta una redacción con dosis, medicamentos o el 168 |
| Memoria por teléfono | La clave del estado es `messages[0].from` |
| Filtro de eventos | «¿Es un mensaje?» |
| Normalización de entrada | «Interpretar entrada» |
| Fecha y zona | La Paz UTC-4 fijo; el día de la semana sale de la librería, y la tabla de 14 días va al prompt de extracción |
| Reporte del entrante antes de la rama del modelo | «Reportar mensaje (entrante)» está arriba en el lienzo y antes en las conexiones |
| Configuración en un solo nodo | «Config del negocio» (con «Config base» para el calendario forzado) |
| Un aviso nunca va al propio número | «Armar mensajes» no avisa a recepción ni al doctor si escribe el mismo número |

## Pedidos del doctor que el flujo cubre

P3 (emergencia: botón y «ya le avisé al doctor», sin 168), P5 (vacunas y cremas al doctor), P8 (huecos cada 30
minutos; manda la hora de fin del evento), P9 (el costo solo si preguntan; una pregunta que no está en la
configuración se transfiere), P10 (tolerancia de 10 minutos dentro de la confirmación, con la frase de la
configuración), P11 (dos hermanos en una cita), P12 (desde mañana; hoy solo si lo pide), P13 («Apellidos,
Nombres (CNS)» / «(RN)»), R2 (otra hora no repite las mismas tres), R4 (una pregunta por una hora nunca agenda),
R7 (sin citas: texto fijo y recepción con botón), R9 (la hora de su propia cita no se vuelve a ofrecer), R12 (un
botón viejo se vuelve a validar) y R13 (ningún texto sale con un hueco). **R14 (la palabra «urgencia») no entra**:
las palabras de emergencia son las de la configuración, como en Bellido.

## Desvíos del contrato y decisiones

1. **`Reportar mensaje (entrante)` va después de «Interpretar entrada»** (el contrato lo ponía antes): el cuerpo
   del reporte necesita el texto y el tipo ya normalizados. Sigue antes de toda la rama del modelo.
2. **Nodos que el contrato no dibuja**: «Carga de entrada» (las tres formas de entrada), «Config base» (Set con
   `calendarioForzado`), «¿Reportar?» ×2, «¿Enviar de verdad?», «¿Registrar cierre?», «¿Hay cruce?» (está en el
   contrato), «¿Borrar cita?», «¿Comercio operativo?», «¿Atención normal?», «Comercio no operativo», «Uso
   extendido» y «Resumen del turno». Por eso son 44 nodos y no «unos 30».
3. **`src/nodos/_comun.js`** va entre la librería y el código del nodo (el contrato decía librería + nodo), y
   los nodos que no usan la librería llevan una marca `@@comun:` para no cargarla.
4. **Campos de estado agregados** (ver arriba). El contrato fija seis; los demás no caben en un id de botón.
5. **La atención y el comercio operativo salen de la ingesta del entrante si la respuesta los trae** (el
   servidor ya los devuelve) y, si no, de `configuracionFlujo`, como el flujo vivo de Bellido.
6. **Anticipación mínima**: el servidor todavía no manda `agendamiento`; si no llega, el respaldo usa 120
   minutos (el supuesto de `negocio-bellido.json`), no los 0 que aplica hoy el flujo vivo. **Decisión para Andres.**
7. **El servicio lo elige el menú (o el botón), no el modelo**: el modelo solo lo propone cuando no hay uno, y el
   texto lo cambia solo si nombra «recién nacido» o «niño sano».
8. **Reagendar con una sola cita ofrece directo** (sin botón de «mover esta»): pedir otra hora ya es la
   intención, y el reemplazo igual exige tocar un hueco.
9. **Cancelar o reagendar al empezar una conversación nueva no pasa por el menú** (regex de código).
10. **Las redes del doctor van dentro de la confirmación**, no en un mensaje aparte (−1 mensaje por cita).
11. **Sin campañas ni menú por campaña.**

## Pendientes para pasar esto a n8n (los hace una persona)

- Importar `agenda-minima.prueba.json` (con `flujo-de-prueba.mjs`) o `agenda-minima.v0.json`; las credenciales se
  resuelven por nombre (`NovuChat ingesta (Bellido)`, `Graph WhatsApp Bellido (Bearer)`,
  `WhatsApp Consultorio Bellido (envío)`, y Google Calendar y Gemini con el nombre vacío). El disparador de
  WhatsApp de producción necesita su credencial propia: no se activa contra la app de otro flujo.
- La plantilla `alerta_emergencia` tiene que estar aprobada en la WABA; si no, el aviso al doctor sale por el texto.
- Lo que no se puede probar en una ejecución manual: el estado por teléfono (`staticData`) solo persiste con el
  flujo activo.

## Revisión de seguridad del candidato B (30/09, sobre 383e363)

Corregido en la ronda 3:
- **Disponibilidad (HIGH):** el texto del paciente se recorta en «Interpretar entrada» (1.500 caracteres), y las
  regex de «Decidir turno» ya no tienen costo cuadrático. La suite mide un texto de 80.000 caracteres.
- **Una pregunta por una hora no agenda** (R4): «¿tienes a las 9:30?», «¿a las 10 se puede?» se contestan con
  disponibilidad y botones; ni al agendar ni al mover se toma como elección.
- **La redacción no puede afirmar una cita** («quedó agendada», «reservé», «confirmo tu cita») ni negar ser una
  IA: se descarta y sale el texto fijo o la transferencia (`AFIRMA` en «Armar mensajes»).
- **Audio:** «¿Audio de tamaño aceptable?» corta en 720.000 bytes ANTES de descargar y transcribir; sin tamaño
  conocido tampoco se transcribe (Decidir turno pide que lo escriba).
- **Emergencia sin número del doctor:** el paciente no lee «ya le avisé al doctor»; el aviso va a recepción,
  marcado EMERGENCIA.
- **Deshacer cita:** tres intentos; un 404 o 410 de Google cuenta como ya borrado; si falla y no hay recepción,
  el aviso va al doctor.
- **Perfil y teléfono:** el nombre de perfil pierde `<`, `>`, `&` y saltos de línea; la línea «Telefono:» solo se
  reconoce en su lugar del formato (la cita de otro no aparece en la lista por un perfil manipulado).

Anotado, sin corregir (LOW):
- El Webhook «Entrada de prueba» no tiene autenticación: solo existe en `agenda-minima.prueba.json`, con una
  ruta al azar que no se versiona, y se borra al terminar la prueba. Si esa variante se usara por más tiempo,
  llevaría Header Auth.
- Los textos de transferencia dicen «tocando el botón» aunque recepción o el doctor no tengan número (panel
  caído y respaldo sin reemplazar): el botón no sale y el texto lo nombra igual. Con el panel de Bellido
  respondiendo no pasa; se corrige cuando se revise el respaldo de «Config base».

## Observaciones de Andres con teléfono real (30/09, sobre 4ae8f3c)

| # | Cambio | Mensajes por conversación |
|---|---|---|
| 1 | Un mensaje con solo una hora («¿y a las 4?») hereda el día de la última oferta | 0 |
| 2 | La confirmación y las redes del doctor van en **dos mensajes**, como en el flujo actual (petición del doctor, fila 23 de la aceptación) | **+1 por cita confirmada (0,0113 USD)**. Una cita típica pasa de 4 a 5 mensajes, igual que el flujo actual |
| 3 | La redacción pierde las muletillas de apertura («Claro que sí,», «Por supuesto,»…), que quedaban incoherentes detrás de una frase fija | 0 |
| 4 | Preguntas sencillas (servicios, dirección, horario, costo) respondidas por código con textos de la configuración (`respuestaServicios`, `respuestaCosto` en «Config base» o en el panel); al primer mensaje, la respuesta va en el cuerpo del menú | 0 |
| 5 | Una imagen con texto se procesa como ese texto; sin texto, «Recibí tu imagen. ¿Qué necesitas?» con el menú. Describir la imagen con Gemini (como el flujo actual) queda para después | 0 |

El costo (`respuestaCosto`) solo se dice si lo preguntan, nunca al agendar. La frase («La consulta pediátrica
cuesta 250 Bs. Si quieres, te ayudo a agendarla.») es un dato del cliente en «Config base» y la valida Andres.
