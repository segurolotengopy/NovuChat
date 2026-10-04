# Captación mínima (v0) — contrato

> Lo escribe la coordinadora; quien implementa no lo edita: si algo no cierra, se detiene y
> lo reporta. Sin secretos ni identificadores.

Reformulación del chat de captación (`Flujos/novuchat-onboarding.json`, 51 nodos, agente con
memoria y un Code de 900 líneas que corrige lo que el modelo escribió). Decisión de Andres
(03/10/2026): se rehace desde cero con el patrón de **Agenda mínima** (Bellido): **el código
calcula y escribe el guion; el modelo solo pone una línea de empatía, contesta preguntas
sueltas y clasifica**. Flujo experimental: vive en `Flujos/experimental/captacion-minima/` y no
se publica sin el «sí» de Andres.

Referencias a leer antes de escribir: `Flujos/experimental/agenda-minima/` (DISENO, CONTRATO,
plantilla, `construir.mjs`, `src/nodos/_comun.js`, y `admin/pruebas/agenda-minima-flujo.test.ts`
con su n8n de mentira); `Flujos/experimental/venta-minima/construir.mjs` (datos del tenant,
`@@cred:`, guardias, huérfanos, retención `none`); `Flujos/experimental/comun-sin-agente/`
(armador genérico, `src/mensajes.js` con las `cm*`, `src/filtro-redaccion.js`).
Cantera (solo en la rama del PR 389, commit `8173a00`; se lee con `git show 8173a00:<ruta>`):
`Flujos/src/modulos/captacion/*` y `Flujos/src/core/captacion/*`.

## 1. Funcionalidades (confirmadas; no se agregan otras)

1. Primer mensaje: saludo, presentación como asistente virtual con IA y **lista interactiva**
   de los rubros de la consola («Otro / a medida» al final). Texto fijo, sin modelo, aunque el
   primer mensaje traiga una pregunta.
2. Rubro elegido (toque, nombre exacto escrito o destino de campaña): frase de dolor +
   pregunta del guion de ese rubro. Sin modelo.
3. Respuesta al dolor: una línea de empatía (modelo) + dato de impacto + botones `planes` y
   `asesor`. La oferta no lleva imagen.
4. Planes (solo si los piden: toque `planes`, pedido escrito o promesa cumplida):
   `archivoPlanes` de la consola —la imagen de precios— como encabezado del mismo mensaje, con una
   línea y el botón `asesor`; sin archivo válido, el bloque de planes en texto armado por código.
   **Es la única imagen que envía el flujo.** Los precios nunca pasan al modelo ni salen de su redacción.
5. Traspaso (toque `asesor` o pedido escrito): plantilla de aviso a recepción (una vez por
   conversación, contando solo las que Meta aceptó) + botón `cta_url` para escribirle directo
   + pedido del nombre del negocio en el mismo mensaje. Si contesta, se registra la empresa
   por código y se responde corto.
6. «Otro»: pregunta abierta (de qué trata el negocio y qué le quita más tiempo); el modelo
   extrae el rubro con las palabras del cliente y pone la empatía; sigue como 3.
7. Pregunta suelta: el modelo responde breve solo con los datos; el código retoma la
   pregunta del paso pendiente en el mismo mensaje. Si no está en los datos: se ofrece al
   asesor, con botón.
8. Descalificado: el modelo clasifica con motivo de lista cerrada (`numero_equivocado`,
   `vende_o_busca_trabajo`, `sin_negocio`, `spam_o_prueba`); el código valida.
9. Calificación por hechos y planilla (Baja < Media < Descalificado < Alta), origen de
   campaña, CRM.
10. Campañas por texto con destino (`rubro:<id>`, `planes`, `asesor`), tratadas como el
    toque. El servidor hoy manda `{id, texto, inicio, fin}` sin `destino`: se tolera.
11. Ya es cliente: respuesta corta con `cta_url` directo al asesor, sin aviso ni planilla.
12. Común: filtro de eventos, repetidos de Meta, `Reportar mensaje (entrante)` arriba de la
    rama que responde y `(saliente)`, uso extendido, comercio no operativo, hora de La Paz,
    respaldo en texto si Meta rechaza el interactivo, y medios (audio transcrito; imagen y
    documento descritos por el modelo, con tope de tamaño).

## 2. Decisiones

| # | Decisión |
|---|---|
| D1 | Una sola llamada al modelo por turno («Llamar al modelo»), opcional, con `responseSchema` |
| D2 | El modelo ve los planes SIN precio. Si la respuesta está en una aclaración de la consola devuelve su id y el código copia el texto |
| D3 | Se arma con `comun-sin-agente/construir.mjs` (importado) más un `construir.mjs` propio para datos, guardias y huérfanos |
| D4 | Guion y corpus viven en el archivo de datos del tenant; `construir.mjs` los inyecta como literal JS en dos líneas marcadoras |
| D5 | Estado en clave nueva `staticData.global.captacionMinima[from]`; no se lee `conversaciones` |
| D6 | El aviso a recepción sale como un ítem más de «Armar mensajes» por el mismo «Enviar a WhatsApp» |
| D7 | El texto del traspaso no afirma que avisó: «Para hablar con {asesor}, toca el botón y escríbele directo. ¿Cómo se llama tu negocio?» |
| D8 | «Confirmar envío» es el hijo más bajo de «Armar mensajes», hace `throw` si Meta rechaza el mensaje y su respaldo, y solo reporta lo que trae `messages[0].id` |
| D9 | Soporte: `cta_url` directo, sin aviso ni planilla |
| D10 | Ofrecer al asesor = botón de respuesta `asesor` (o fila `asesor` en una lista); al tocarlo, el traspaso |
| D11 | «¿Eres una persona?» la contesta el código con texto fijo |
| D12 | Se conservan los nombres de nodo del flujo viejo donde la función es la misma (`publicar-flujo.sh` injerta `webhookId` y credenciales por nombre) |
| D13 | **Retención (Andres, 03/10/2026): se guardan solo las ejecuciones que fallan.** `saveDataSuccessExecution: none`, `saveDataErrorExecution: all`, `saveExecutionProgress: false`. Una ejecución fallida guarda el texto del turno que falló; sin `errorWorkflow` |
| D14 | Textos fijos genéricos en el código, en tuteo, con `{negocio}` y `{asesor}`; textos por rubro y nombre del asesor, en datos. Ningún nombre de comercio ni de persona en `src/` |
| D15 | Primer mensaje con una pregunta: sale la lista fija (si pide precios, con la promesa de mostrarlos) |
| D16 | **La única imagen que se envía es la de precios, solo cuando el prospecto pregunta por ellos** (Andres, 03/10/2026: las demás no se pueden mantener). Ni la oferta ni los rubros llevan imagen; si no hay `archivoPlanes` válido, los planes salen en texto desde la consola. Los medios que ENVÍA el prospecto se siguen procesando (funcionalidad 12) |

Reglas del proyecto que el flujo hace cumplir en código: nunca niega ser IA; solo ofrece lo
que cumple (toda oferta del asesor lleva botón o fila; ninguna promesa de «te escriben» sin
mecanismo); una sola «?» y un mensaje por turno; hasta 3 oraciones y unas 45 palabras; Code
sin `URL`, `Buffer` ni `crypto`; ningún Trigger con credencial de AAB1; ningún texto del
cliente dentro de `systemInstruction`.

## 3. El grafo (44 nodos en la plantilla; 43 por variante)

Orden del lienzo. HTTP, Gemini y Sheets con `onError: continueRegularOutput`; los de lectura,
además, `alwaysOutputData`.

1. WhatsApp Trigger (solo producción; credencial `@@cred:trigger` explícita)
2. Entrada de prueba (webhook POST con Header Auth `@@cred:entradaPrueba`; solo variante de prueba)
3. Carga de entrada (code)
4. Config base (set)
5. ¿Es un mensaje? (if: `messages` > 0, `statuses` == 0, `phone_number_id` == `phoneNumberIdEsperado`)
6. Traer configuración (http)
7. Config del negocio (code)
8. Interpretar entrada (code)
9. ¿Reportar? (entrante) (if)
10. Reportar mensaje (entrante) (http; ARRIBA en el lienzo)
11. ¿Comercio operativo? (if) → 12. Comercio no operativo (code)
13. ¿Atención normal? (if) → 14. Uso extendido (code)
15. ¿Bajar medio? (if)
16. Obtener URL del medio (general) (http GET a Graph)
17. ¿Tamaño aceptable? (if: audio ≤ 720.000 bytes; imagen o PDF ≤ 5.000.000)
18. Descargar medio (http)
19. ¿Es audio? (if) → 20. Transcribir audio (googleGemini)
21. ¿Es un documento? (if) → 22. Describir documento / 23. Describir imagen (googleGemini; prompts de `8173a00`)
24. Decidir turno (code)
25. ¿Llamar al modelo? (if) → 26. Llamar al modelo (http Gemini)
27. Armar mensajes (code)
28. ¿Enviar de verdad? (if) → 29. Enviar a WhatsApp (http, `fullResponse`, `neverError`)
30. ¿Falló el interactivo? (if) → 31. Enviar texto de respaldo (http)
32. ¿Guardar prospecto? (if) → 33. Guardar prospecto (http CRM)
34. Prospecto para la planilla (code) → 35. Buscar teléfono en planilla, 36. Leer IDs de la planilla (Sheets)
37. Decidir fila de la planilla (code) → 38. ¿Agregar fila? → 39. Agregar fila; 40. ¿Actualizar fila? → 41. Actualizar fila
42. Confirmar envío (code; hijo más bajo de 27) → 43. Reportar mensaje (saliente) (http)
44. Resumen del turno (code; última rama de 27, para la respuesta de la prueba)

Ningún nodo `agent`, `memoryBufferWindow` ni `lmChat*`.

## 4. Estado por teléfono

`$getWorkflowStaticData('global').captacionMinima[<messages[0].from>]`, clave `^\d{6,20}$`:

```
{ v:1, paso:'inicio'|'eligiendo_rubro'|'esperando_dolor'|'esperando_negocio'|'oferta'|'esperando_empresa'|'libre',
  rubroId:'', rubroLibre:'', empresa:'', reintentoEmpresa:false,
  hechos:{pidioAsesor:false,pidioPlanes:false,eligioOtro:false,respondioDolor:false,descarte:''},
  planesPendientes:false, planesMostrados:false, soporte:false, anuncio:false,
  avisado:false, avisoFalla:'', ultimoMensajeMs:0, ultimosIds:[] }
```

- Con la ventana (24 h desde `ultimoMensajeMs`) vencen `paso`, `planesPendientes`,
  `planesMostrados`, `soporte`, `avisado`, `reintentoEmpresa`. Los `hechos`, el rubro, la
  empresa y `anuncio` no.
- A las 48 h sin mensajes se borra la entrada. En cada turno se barren las de más de 48 h
  (tope 5.000 entradas).
- **Un solo escritor:** «Armar mensajes». «Confirmar envío» escribe solo `avisado` y
  `avisoFalla` con lo que contestó Meta. «Interpretar entrada» solo lee `ultimosIds`: si el id
  ya está, devuelve `[]` (no reporta ni responde).

### Reglas globales (cualquier paso)
- Toque `asesor`, o texto que cumple `ccPideAsesor` y NO es el texto de una campaña → TRASPASO.
- Toque `planes`: con rubro u «Otro» → PLANES; sin rubro → LISTA con la promesa (`planesPendientes`).
- Toque `rubro:<id>` vigente → rubro elegido; id que ya no existe → LISTA con «Esa opción ya no está».
- `ccEsSoporte` → SOPORTE.
- Pregunta de identidad → «Soy el asistente virtual de {negocio}, con inteligencia artificial.» y se retoma el paso.
- Rubro (u «Otro») elegido con `planesPendientes` → PLANES en vez del dolor (promesa cumplida; Alta).

### Transiciones

| Paso | Entrada | Va a | Modelo |
|---|---|---|---|
| inicio | Cualquier cosa no global → LISTA. Campaña `rubro:<id>`: como el toque. Campaña `planes` o texto que pide planes: LISTA con la promesa. Campaña `asesor`: LISTA con la fila del asesor, sin traspaso. Sin rubros cargados: PREGUNTA ABIERTA | eligiendo_rubro | No |
| eligiendo_rubro | Toque o nombre exacto → DOLOR. «Otro» → PREGUNTA ABIERTA. Otro texto o audio → modelo | esperando_dolor / esperando_negocio | Solo texto libre |
| esperando_dolor | Texto o audio → modelo → OFERTA (`respondioDolor`). Planes solo si `ccPidePlanesCorto` (mensaje corto que solo pide planes) | oferta | Sí |
| esperando_negocio | Texto → modelo (`rubroLibre` + empatía) → OFERTA con el impacto de `otro` | oferta | Sí |
| oferta | `planes` o `ccPidePlanesCorto` → PLANES. Texto → modelo | oferta | Texto libre |
| esperando_empresa | `ccNombreDeEmpresa` válido → «Gracias, quedó anotado.»; con «?» o algo que no es un nombre → modelo, y una sola vez se repregunta | libre | A veces |
| libre | Como oferta, sin repreguntar | libre | Texto libre |

### Resultado del modelo ya validado

| Resultado | Qué sale |
|---|---|
| `pregunta` con `enLosDatos` y respuesta válida | La respuesta + la pregunta del paso pendiente, en el mismo mensaje |
| `pregunta` sin datos | «Eso no lo tengo en mis datos; {asesor} te lo responde.» + botón o fila `asesor` + la pregunta del paso si cabe (una sola «?») |
| `descarte` aceptado | Texto fijo según el motivo, sin pregunta ni botón; paso `libre` |
| Vacío, error HTTP, JSON inválido o fuera del esquema | «Disculpa, no pude procesar tu mensaje. Si quieres, {asesor} te ayuda directamente.» + botón `asesor`; el paso no cambia |

### Medios (en «Decidir turno»)
- Audio: la transcripción es el texto (hasta 4.400 caracteres), `porAudio: true`. Sin
  transcripción o fuera de tope: «No pude escuchar tu audio. ¿Me lo escribes?».
- Imagen o PDF: categoría `comprobante` u `otro`. `comprobante` → texto fijo + botón `asesor`.
  `otro` → el pie de foto es el texto, y lo leído en la imagen va al modelo como dato rotulado.
- Otros tipos: «Por ahora atiendo texto, audio, fotos y documentos. ¿Me lo escribes?».

## 5. Contrato del modelo

`gemini-3.5-flash-lite` por `generateContent`, credencial `googlePalmApi`,
`responseMimeType: application/json`, `maxOutputTokens: 400`, sin `temperature` ni `topP`.

- `systemInstruction`: estática por configuración (cacheable): reglas, rubros (id, nombre,
  solución), planes sin precio, aclaraciones (`a1…aN`; solo el tema si el texto trae un monto) y corpus.
- `contents`: `PASO`, `PREGUNTA QUE HICISTE`, `RUBRO`, `HOY` (La Paz; día de la semana por
  código) y el mensaje del cliente entre `<<<` y `>>>` (sin esos delimitadores adentro,
  recortado a 1.500 caracteres).

```
{type:OBJECT, required:[todas], properties:{
 tipo:{type:STRING, enum:[respuesta,pregunta,pide_planes,pide_asesor,ya_es_cliente,descarte,otro]},
 rubroId:{type:STRING, enum:[ninguno, ...ids de la consola]},
 rubroLibre:{type:STRING}, empatia:{type:STRING}, respuesta:{type:STRING},
 aclaracion:{type:STRING, enum:[ninguno, a1..aN]}, enLosDatos:{type:BOOLEAN},
 descarte:{type:STRING, enum:[ninguno,numero_equivocado,vende_o_busca_trabajo,sin_negocio,spam_o_prueba]} }}
```

Validación por campo (si un campo no pasa, su respaldo; si falla el objeto, FALLO):
- `tipo` desconocido → `otro`. `rubroId` fuera de lista → `''`.
- `rubroLibre`: 3 a 60 caracteres; sin `[]{}<>«»"` ni backtick; sin `=+-@` al inicio; no es una
  orden al asistente ni un no-rubro; y aparece en el texto del cliente o en el de la imagen
  (normalizado), o cada palabra de 4 letras o más aparece ahí.
- `empatia`: 1 oración, ≤100 caracteres, sin «?», pasa `cmRevisarRedaccion`. Si no: «Te entiendo.».
- `respuesta`: ≤2 oraciones y 280 caracteres, sin «?», pasa `cmRevisarRedaccion` (sin montos,
  promesas, enlaces ni negar ser IA). Si no: se trata como «no lo tengo».
- `aclaracion` válida: la respuesta es el texto de la consola, recortado a 300.
- `descarte` aceptado solo si: el turno es texto escrito, audio transcrito o campaña (no un
  toque, imagen ni documento); no hay hecho de Alta; no es soporte; el texto del cliente no
  contiene `descarte` (sin distinguir mayúsculas ni espacios); el motivo está en la lista.

## 6. Mensajes que arma el código

- **LISTA:** «¡Hola! Soy {nombreAsistente, }el asistente virtual de {negocio}, con
  inteligencia artificial. ¿De qué rubro es tu negocio?». Botón «Ver rubros»; hasta 10 filas
  `rubro:<id>` (título ≤24, descripción ≤72), «Otro» al final; fila `asesor` solo si el turno
  ofrece al asesor. Respaldo en texto con los nombres en una línea.
- **DOLOR:** `dolor` + `pregunta` del guion, texto.
- **OFERTA:** botones de respuesta, sin encabezado; cuerpo =
  empatía + impacto + «¿Quieres ver los planes o hablar con {asesor}?»; botón `planes` solo si
  hay planes o archivo y no se mostraron; botón `asesor`.
- **PLANES:** con `archivoPlanes` válido (el host y el tipo ya los valida `limpiarOferta`),
  encabezado imagen o documento + una línea + botón `asesor`; sin archivo, el bloque en texto
  (como `bloquePlanes` de `8173a00`) + botón. Si Meta rechaza el interactivo, el respaldo lleva el
  enlace del archivo o el bloque en texto. Sin planes:
  «Los planes te los pasa {asesor}.» + botón.
- **TRASPASO:** `cmContactoConBoton` con `cta_url` a `wa.me/{numeroRecepcion}`, botón ≤20.
  Pide la empresa si no se conoce y no es soporte. Aviso `solicitud_contacto` (6 parámetros,
  como `salida.js` de `8173a00`) si `!avisado`, hay recepción y quien escribe no es
  recepción. Sin número de recepción: ni botón ni promesa.
- Límites de Meta (fijarlos en las pruebas): lista ≤10 filas, título 24, descripción 72,
  botón de lista 20, id ≤200, encabezado de lista solo texto; botones de respuesta ≤3, título
  20; cuerpo de interactivo ≤1.024.

## 7. Archivo de datos del tenant

`admin/scripts/datos/captacion-minima/novuchat.json` (y `ensayo.json`, que hereda, con
`entrada: 'prueba'`):

```
{ nombreFlujo, entrada:'trigger'|'prueba', hereda?,
  credenciales:{trigger, ingesta, graph, planilla, crm, entradaPrueba?},
  pruebaRuta,
  configBase:{waGraphVersion, phoneNumberIdEsperado, numeroRecepcion, nombreNegocio, horarioAtencion,
     plantillaAviso, idiomaPlantillaAviso, planillaProspectosId, planillaProspectosHoja, crmUrl,
     prefijosPermitidos, nivelEmojis, mensajeComercioSuspendido, limiteInteractivo},
  guion:{ asesor:{nombre:''|'<2-9 letras>'},
          rubros:{ '<id consola>':{dolor, pregunta, impacto?}, otro:{pregunta, impacto?} } },
  conocimiento:{huella, generado, excluidos:[ids], fragmentos:[{id,titulo,url,texto}]} }
```

- Solo marcadores `REEMPLAZAR_*` para identificadores; nunca un valor real.
- `nombreFlujo`: el del flujo vivo de captación. Corpus: de
  `8173a00:Flujos/src/modulos/captacion/conocimiento-del-sitio.js` (fragmentos sin `vector`,
  huella, generado, excluidos). Frases de dolor y preguntas: del guion comercial (abajo).
  `impacto`: vacío (lo pone la coordinadora). `asesor.nombre`: `Silvana`.
- Un rubro de la consola sin entrada en el guion se trata como «Otro».

Guion inicial (ids de la consola de NovuChat):
- `salud-belleza`: dolor «En salones y consultorios, la gente olvida su turno y ese hueco ya no se recupera.»; pregunta «¿Pierdes mucho tiempo agendando y recordando citas a mano?»
- `gastronomia`: dolor «En hora pico, si no respondes rápido, el cliente le compra al de al lado.»; pregunta «¿Se te escapan pedidos los fines de semana o de noche?»
- `comercio`: dolor «Tus clientes escriben fuera de horario y, sin respuesta rápida, le compran a otro.»; pregunta «¿Se te escapan ventas de noche o los fines de semana?»
- `educacion`: dolor «Responder las mismas dudas de padres y alumnos quita mucho tiempo.»; pregunta «¿Te llegan las mismas consultas todos los días?»
- `otro`: pregunta «¿De qué trata tu negocio y qué es lo que más tiempo te quita hoy?»

### Validaciones en `construir.mjs` (error con el nombre del campo)
- Las de Venta mínima: `configBase` sin «=» inicial, comillas, barra invertida ni llaves;
  credenciales; `hereda`; solo `ensayo*.json` puede tener `entrada: 'prueba'`.
- Todo texto del guion: sin controles ni saltos de línea; sin `=+-@` al inicio; sin `{{`, `[`,
  `]`, `<`, `>`; sin `REEMPLAZAR_`; sin URL.
- `dolor`: 1 a 200 caracteres, una oración, sin «?». `pregunta`: 1 a 140, termina en una sola
  «?». Juntos: hasta 3 oraciones y 45 palabras.
- `impacto`: 0 a 160 caracteres, una oración, hasta 20 palabras, sin «?». Con empatía ≤100 caracteres y la pregunta fija, la oferta cabe en 3 oraciones y unas 45 palabras.
- Cualquier clave `imagen` en el guion es un error (no se admiten imágenes).
- Asesor: `"Hablar con " + nombre` ≤ 20; sin nombre, «Hablar con un asesor».
- Ids `^[a-z0-9_-]{1,40}$`; `otro` obligatorio; hasta 20 rubros.
- Corpus: hasta 40.000 caracteres; ningún fragmento incluido con
  `USD\s*\d|\$\s*\d|\d+\s*(d[oó]lares|bs|bolivianos)`.
- `crmUrl`: `''` en v0.

### Inyección
Tras `armarVariante`, cada línea se reemplaza exactamente una vez (0 o 2 apariciones es error):
- `const CM_GUION = null; // @@guion` en `config-del-negocio.js`
- `const CM_CONOCIMIENTO = null; // @@conocimiento` en `decidir-turno.js`

### Guardias de `--verificar` (sobre lo armado y sobre el archivo versionado)
- «Entrada de prueba» nunca en producción; «WhatsApp Trigger» nunca en la prueba.
- Disparador con credencial explícita, nunca una que coincida con `/aab1|wa-prod/i`.
- Ningún texto con `subscriptions` ni `subscribed_apps`.
- Anfitriones HTTP: `graph.facebook.com`, `generativelanguage.googleapis.com`,
  `us-east1-novuchat-demo.cloudfunctions.net` (o un marcador). Solo dos URL por expresión:
  «Descargar medio» `={{ $json.url }}` y «Guardar prospecto» `={{ $json.crmUrl }}`.
- Ningún nodo `agent`, `memoryBufferWindow` ni `lmChat*`.
- `saveDataSuccessExecution` en `none`, `saveDataErrorExecution` en `all`, sin `errorWorkflow`,
  `saveExecutionProgress: false`, `executionOrder: v1`, `timezone: America/La_Paz`.
- Planilla: rangos `A3:J` y `A3:A`; «Agregar fila» en `USER_ENTERED`; «Actualizar fila» en `RAW`.
- `REEMPLAZAR_` solo en «Config base» (y la ruta de prueba).
- Huérfanos: todo `captacion-minima.*.json` tiene su archivo de datos, salvo `*.local.json`.

## 8. Archivos

| Archivo | Qué es |
|---|---|
| `src/lib/captacion.js` | Librería pura, prefijo `cc`, sin reloj ni red |
| `src/nodos/_comun.js` | Copia adaptada de Agenda mínima: solo `cnNodo`, `cnPrimero`, `cnTodos`, `cnCfg`, `cnNorm`, `cnDigitos`, `cnRecorte`, `cnTextoDeGemini`, `cnJsonDeGemini`, `cnAtencion`, `cnClaveValida` |
| `src/nodos/{carga-de-entrada,config-del-negocio,interpretar-entrada,comercio-no-operativo,uso-extendido,decidir-turno,armar-mensajes,resumen-del-turno}.js` | Nodos propios |
| `src/nodos/decidir-fila-de-la-planilla.js` | Copia TAL CUAL de `8173a00:Flujos/src/modulos/captacion/decidir-fila-de-la-planilla.js` (una prueba compara el texto) |
| `src/nodos/{prospecto-para-la-planilla,confirmar-envio}.js` | Adaptados de `8173a00` (leen los ítems de «Armar mensajes»; Confirmar escribe solo `avisado`/`avisoFalla`; en modo prueba no reporta) |
| `flujo.plantilla.json`, `construir.mjs`, `DISENO.md` | Plantilla, armador y cómo se arma |
| `captacion-minima.novuchat.json`, `captacion-minima.prueba.json` | Generados por `construir.mjs` |
| `admin/scripts/datos/captacion-minima/{novuchat,ensayo}.json` | Datos del tenant |
| `admin/pruebas/captacion-minima-lib.test.ts`, `admin/pruebas/captacion-minima-flujo.test.ts` | Suites; se agregan a `SUITES_PURAS` de `admin/vitest.config.ts` |

Se adapta copiando de `8173a00` (no se importa): `limpiarOferta`, campañas con destino y
atención (`core/captacion/config-del-negocio.js`); `SOPORTE`, `ASESOR`, `CONTACTO_PERSONA`,
campañas y `referral` (`normalizar-entrada.js`); `ORDEN_AL_ASISTENTE`, `NO_ES_RUBRO`,
`CORTESIA`, `COMO_SE_LLAMA`, `NO_ES_NOMBRE`, `EVASIVA`, `nombreDeEmpresa`
(`modulos/captacion/estado-de-la-conversacion.js`); `PIDE_PLANES`, `bloquePlanes`,
`tituloDeFila`, `filasDeRubros`, `NIEGA_IA` (`procesar-respuesta.js`); `conEmojis`
(`traspaso-a-un-asesor.js`). Se descarta el resto.

### Firmas de la librería (`cc*`, puras)

```
ccNorm(t) ccPlano(t,max) ccEsOrden(t) ccConEmojis(t,nivel) ccUnaPregunta(t) ccContar(t)->{oraciones,palabras}
ccPideAsesor(t) ccEsSoporte(t) ccPidePlanes(t) ccPidePlanesCorto(t) ccEsIdentidad(t) ccEsSaludo(t)
ccRubroPorNombre(t,rubros)->id|'' ccCampana(texto,campanas)->{id,destino?}|null
ccLeerToque(id,rubros)->{tipo:'rubro'|'otro'|'planes'|'asesor'|'vencida',id?}|null
ccEstadoBase() ccEstadoVigente(e,ahoraMs) ccYaVisto(e,id) ccRecordarId(e,id) ccBarrer(mapa,ahoraMs)
ccInstrucciones(cfg,conocimiento)->texto
ccCuerpoModelo({paso,cfg,mensaje,preguntaHecha,textoDeImagen,ahoraMs})->body
ccEsquema(rubroIds,aclaracionIds)
ccLeerModelo(jsonGemini,{rubroIds,aclaracionIds,textoCliente,textoDeImagen})->{ok,tipo,rubroId,rubroLibre,empatia,respuesta,aclaracion,enLosDatos,descarte}
ccRubroLibreValido(v,textos) ccNombreDeEmpresa(t)->''|nombre ccDescarteAceptado({...})->motivo|''
ccLista(cuerpo,rubros,conAsesor,tituloAsesor) ccOferta({empatia,impacto,asesor,conPlanes}) ccPlanes(cfg,asesor)
ccTraspaso({numero,desde,negocio,asesor,pideEmpresa}) ccAviso({...})->payload|null ccHechos(antes,nuevos) ccProspecto(estado,entrada)
```

Las firmas se pueden precisar al implementar (un parámetro más, un campo más en un retorno),
dejándolo dicho en `DISENO.md`; no se cambian el comportamiento ni los contratos de arriba.

## 9. Pruebas (negando)

`captacion-minima-flujo.test.ts`: el n8n de mentira de Agenda mínima sobre los dos JSON
armados; dobles de configuración, ingesta, Gemini (respuestas fijas por caso), Graph y Sheets
en memoria; reloj congelado.

Casos: C1 belleza con planes (6 mensajes + 1 plantilla, 1 llamada al modelo; Alta) · C2
gastronomía sin planes · C3 «Otro», estudio contable (`rubroLibre` solo si está en el texto;
Media) · C4 «Otro», importadora («cuánto cobran» dentro de la respuesta al dolor no es Alta) ·
C5 solo «hola» (1 mensaje, 0 llamadas; Baja) · C6 toca rubro y no sigue (Baja) · C7 escribe en
vez de tocar · C8 opción vencida → lista · C9 ya es cliente (`cta_url`, sin planilla ni aviso)
· C10 inyección (ni marcas, ni descarte, ni rubro; la identidad la contesta el código) · C11
número equivocado y C12 vende o busca trabajo (Descalificado) · C13 descalificado y luego toca
asesor (gana Alta; el resumen no dice «Descalificado») · C16 precios antes del rubro (promesa
cumplida: planes y Alta al dar el rubro; un segundo «precios» no los repite) · C17 sin rubros
cargados (pregunta abierta) · C18 audio con el rubro · C19 campaña con destino a un rubro
(dolor sin lista; origen de campaña en la planilla) · C20 campaña sin destino · C21 destino a
un rubro que ya no existe (lista) · C22 destino `planes` sin rubro (promesa; Alta al dar el rubro).

Además: imagen sin pie, comprobante con botón, audio grande, tipo no admitido; modelo caído,
JSON inválido, `enum` fuera de lista, «?» en la empatía, monto en la respuesta, `rubroLibre`
con corchetes o con una orden; empresa `=HYPERLINK(…)` que no llega como fórmula; estado viejo
en `conversaciones` que no afecta; dos teléfonos sin estado compartido; repetido de Meta sin
reporte ni respuesta; ventana de 25 h → lista; 49 h → ficha olvidada; uso extendido (operador
y bloqueado) y comercio no operativo; traspaso sin recepción (sin botón ni promesa), aviso
rechazado que se reintenta, recepción que escribe (sin aviso); campaña «Quiero hablar con una
persona» que no elige al asesor; destino `asesor` sin aviso.

Propiedades sobre todas las salidas de la suite: a lo más una «?» por mensaje; hasta 3
oraciones y unas 45 palabras; toda oferta del asesor con botón o fila; ningún texto dice «ya
le pasé», «te escribirán» ni «lo consulto»; `systemInstruction` idéntica entre turnos; una
llamada a la ingesta por entrante y por saliente aceptado; `Reportar mensaje (entrante)` antes
de la rama del modelo (posición y conexiones); la rama de medios está cableada; solo el mensaje de PLANES con `archivoPlanes` trae `header` de imagen o documento, ningún otro; el JSON no
trae secuencias de 10 dígitos o más; `construir --verificar` sale 0 y sale 1 ante cada dato
inválido, guardia violada o huérfano.

`captacion-minima-lib.test.ts`: cada `cc*` con sus límites y sus negaciones, y el esquema.

Deben seguir verdes sin excepción nueva: `core/entregas` (tope de excepciones intacto),
`core/higiene-flujos`, `frontera`, `core/registro`, `core/ensamblador`, `agenda-minima-*`,
`venta-minima-flujo`, `comun-sin-agente-*`.

## 10. Criterio de terminado

```
node Flujos/experimental/captacion-minima/construir.mjs --verificar
cd admin && pnpm install --frozen-lockfile        # pnpm, nunca npm
cd admin && pnpm -s vitest run --project puras pruebas/captacion-minima-lib.test.ts pruebas/captacion-minima-flujo.test.ts
cd admin && pnpm pruebas:puras
node admin/scripts/ensamblar-flujo.mjs verificar
./scripts/verificar-saneo.sh
```

## 11. Fuera de v0

Imágenes por rubro o en la oferta (la única imagen es la de precios); guion en la consola; trato de usted en los textos fijos; oferta del asesor en la respuesta 25;
memoria de conversación; consulta del cliente en la planilla; CRM real; segundo tenant;
batería contra el modelo (bloque siguiente); ensayo y publicación (bloque siguiente, con el
«sí» de Andres); retirar el flujo viejo y cerrar el PR 389.

## 12. Correcciones de la revisión (03/10/2026) — mandan sobre lo anterior donde difieran

Dos revisiones (código y seguridad: 0 críticos, 0 altos; 3 medios de seguridad y 7 importantes
de código). Cada punto lleva su prueba negando. «Interpretar entrada» y los demás nodos siguen
siendo de quien implementa; la suite de punta a punta pasa a ser editable por él (su autor ya
terminó).

### Seguridad
- **S1 (identidad).** `ccEsIdentidad` reconoce `(eres|es|sos|hablo con|me atiende|me escribe) (el |la |un |una )?(<asesor>|persona|humano|robot|bot|automatico|real)` (con el nombre del asesor normalizado). `ccLeerModelo` rechaza en `empatia` y `respuesta` `\bsoy\b|\bsomos\b|\bte habla\b|aqui no hay (ningun )?(robot|bot)`, y en `empatia` además el nombre del asesor y `\b(asesor|asesora|ejecutiv[oa])\b`. Pruebas: «Sí, soy Silvana.», «Te habla Silvana, del equipo.», «Soy una asesora del equipo.» y «Aquí no hay ningún robot.» se rechazan; «¿eres Silvana?», «¿es un robot?», «¿me atiende una persona?», «¿esto es automático?» las contesta el código con el texto fijo de identidad.
- **S2 (promesas).** Se rechaza en `empatia` y `respuesta`: `\b(se|te) (pondra|pondran|contacta|contactara|comunica|comunicara|llama|llamara|escribe|escribira|respond(e|era|eran))\b|\bte respond(emos|eremos)\b|\ben contacto contigo\b|\bse comunica\w* contigo\b|\bmenos de \d+ horas\b`. El fragmento `contacto` del corpus se agrega a los excluidos. Pruebas con las cuatro frases del informe.
- **S3 (montos y ofertas).** `empatia` rechaza todo dígito y `%|gratis|descuento|promo|oferta`. `respuesta` solo acepta números que aparezcan literalmente en los datos que ve el modelo y rechaza `\d+\s*(\$|u\$s|\$us|usd|euros?|al mes|mensual|por mes|anual)`, `%`, `gratis`, `descuento`. `CC_PIDE_PLANES` acepta `cuanto (me |nos )?(cuesta|sale|cobran|vale)`. `ccTieneMonto` y la validación del corpus en `construir.mjs` reutilizan un único patrón que reconoce «25 USD», «$us 65», «150$», «U$S 150», «1 dólar», «150 euros», «99,90 mensuales». Pruebas con cada forma.
- **S4 (L1).** `rubroLibre` y `empresa` rechazan enlaces (`cmEnlacesDe`) y secuencias de 6 o más dígitos.
- **S5 (L2).** «¿Tamaño aceptable?» exige además `^https://lookaside\.fbsbx\.com/` en la `url` del medio.
- **S6 (L3).** «Armar mensajes» borra `sd.conversaciones` y `sd.vistos` del flujo viejo (el mismo workflow se publica encima). Prueba.
- **S7 (L6, I11).** `ensayo.json` pone `planillaProspectosId: ''`; con `modoPrueba` NO se escribe la planilla; y `configBase.telefonosDePrueba` (lista opcional) limita a qué números puede dirigirse una ejecución de prueba. Pruebas.
- **S8.** `textoDeImagen` y `RUBRO` van dentro de un bloque delimitado, no sueltos. `validarDatos` rechaza ids de rubro `__proto__|constructor|prototype`. Se recuerdan 5 ids por ficha (no 20) y `ccBarrer` respeta el tope exacto de 5.000.

### Código
- **R1.** «Hola, vendo ropa y mis clientes me preguntan precios todo el día» NO es pedir planes: en el primer mensaje y en `eligiendo_rubro`, un pedido de planes exige `ccPidePlanesCorto`, o `ccPidePlanes` junto con «?» o un verbo de pedido (quiero, necesito, dame, mándame, pásame, cuál, cuánto, ver, cotiza). Pruebas en los dos pasos.
- **R2.** Una pregunta por precio nunca recibe «Eso no lo tengo en mis datos»: en `ccResolverModelo`, si el texto pide planes (R1) y el tipo es `pregunta` o `pide_planes`, va a `ccPedirPlanes` en cualquier paso. `esperando_negocio` y `esperando_empresa` también miran `ccPidePlanesCorto`.
- **R3.** «Perfecto», «Excelente», «Bueno», «Entendido», «Vale», «Genial», «De acuerdo», «Muy amable», «Ya le escribí», «Ahorita le escribo» no son el nombre de una empresa (ampliar cortesías y evasivas). Pruebas negando.
- **R4.** «¿El plan incluye soporte?» no es un cliente pidiendo soporte: `ccEsSoporte` exige una forma de cliente («necesito soporte», «soporte de mi cuenta», «ya soy cliente…»); la palabra suelta la resuelve el modelo.
- **R5 (descarte y tildes).** Se bloquea el descarte solo si el texto del cliente, sin tildes y en minúsculas, contiene la palabra `descarte` o un motivo literal con guion bajo (`numero_equivocado`, `vende_o_busca_trabajo`, `sin_negocio`, `spam_o_prueba`). «Perdón, número equivocado» y «Perdon, numero equivocado» descalifican igual (con `numero_equivocado` del modelo).
- **R6.** Con `pide_asesor` del modelo: en `eligiendo_rubro` sale la lista CON la fila del asesor; en los modos de texto, la pregunta del paso con el botón. `ccPideAsesor` reconoce «Hola, quiero hablar con una persona» (se admite un saludo delante); una campaña sigue sin elegir al asesor.
- **R7.** «Otro» con `rubroLibre` ya conocido: no se vuelve a preguntar de qué trata el negocio. Campo nuevo `guion.rubros.otro.preguntaDolor` (se valida como `pregunta`; en `novuchat.json`: «¿Qué es lo que más tiempo te quita hoy en tu negocio?»).
- **R8 (ficha adelantada).** «Armar mensajes» guarda la ficha previa en el primer ítem (`fichaAntes`). Si «Confirmar envío» va a hacer `throw` porque Meta rechazó el mensaje y su respaldo, restaura la ficha previa conservando `ultimosIds` y `ultimoMensajeMs`. Se enmienda el «un solo escritor» del §4 y D8: «Confirmar envío» también restaura la ficha cuando el envío falla. Prueba: tras un rechazo total, el siguiente «precios» vuelve a recibir los planes.
- **R9.** Retención de D13: `construir.mjs`, la plantilla, los JSON, `DISENO.md` y las pruebas pasan de «none/none» a «none/all».
- **R10.** «Interpretar entrada» devuelve `[]` (ni se reporta ni se responde) para `reaction`, `sticker`, `request_welcome`, `system` y `ephemeral`, como Venta mínima.
- **R11 (tamaño).** «Interpretar entrada» usa `@@comun` y un `cnYaVisto` en lugar de pegar la librería entera; «Decidir turno» no pega `+mensajes+filtro` si no usa ninguna `cm*` (ajustar la prueba que lo exige); se quitan `ccEsSaludo` y `cnNorm` si no se usan; se unifican `ccQuien` (tres copias de `ccPlano(cfg.asesor,20)||'un asesor'`), la presentación (dos copias), la validación del archivo de planes (dos copias), el filtro de rubros comunes (tres copias, ya existe `ccRubrosComunes`) y la expresión de destino de campaña (dos copias).
- **R12 (menores baratos).** Campaña con destino vencido en el primer mensaje: se presenta sin decir «Esa opción ya no está». En oferta y libre se le pasa al modelo la pregunta de la oferta como «PREGUNTA QUE HICISTE». El modo `negocio` respeta `r.rubroId`. En libre, un agradecimiento no repite «¿Quieres hablar con X?». Una aclaración al retomar se recorta para no pasar de 3 oraciones ni 50 palabras. «No pude leer tu imagen» distingue documento. `cnMapaDeFichas` no escribe desde nodos que solo leen. «Reportar mensaje (saliente)» con `timeout` de 4000. En `captacion-minima-flujo.test.ts`: quitar `describe.skipIf` (la suite debe fallar si falta el JSON) y corregir el comentario «tolera 60».

### Fuera de esta ronda
Tokens de razonamiento dentro de `maxOutputTokens: 400` y el pedido de baja («no me escriban más»): los mide la batería. Concurrencia de `staticData` entre ejecuciones y credencial del disparador por id de app: se verifican contra n8n antes de publicar.

## 13. Tono y rubros: correcciones tras ver el flujo vivo (03/10/2026, noche)

Andres probó el flujo publicado: «muy muy mal, robotizado, nada amable; hay que seguir los
ejemplos» (`CLIENTES/NOVUCHAT/Opciones de Conversaciones Novuchat.pdf`; léelo). Dos causas:

**C1. Los ids de rubro del guion no coincidían con los de la consola VIVA.** La consola de
NovuChat usa `salud-y-belleza`, `gastronomia`, `comercio-y-retail`, `educacion` y `otro-a-medida`
(son el *slug del nombre*). El guion usaba `salud-belleza`, `comercio` y `otro` (copiados de un
archivo del repositorio), así que «Salud y Belleza» y «Comercio y Retail» caían en la pregunta de
«Otro» sin que nadie lo notara: un rubro sin entrada en el guion se trata como «Otro» en silencio.
- El guion se busca por el id del rubro y, si no está, por el *slug de su nombre* (minúsculas, sin
  tildes, no alfanuméricos → `-`). Las claves de `guion.rubros` en `novuchat.json` pasan a los ids
  vivos: `salud-y-belleza`, `gastronomia`, `comercio-y-retail`, `educacion`, y `otro`.
- Un rubro de la consola SIN entrada en el guion (y que no sea el de «a medida») ya no es silencioso:
  se sigue tratando como «Otro», pero con aviso `rubro_sin_guion` en el ítem (la suite y la batería lo
  cuentan; la batería falla si lo ve).
- Prueba de regresión en la suite de punta a punta con la consola VIVA como fixture (los cinco ids de
  arriba): tocar cada rubro da SU frase de dolor, nunca la de «Otro».

**C2. El tono.** Se sigue el PDF: cálido, cercano, con exclamaciones y emojis, y dicho como lo diría
una persona de Bolivia; el asistente refleja lo que el cliente contó con sus palabras y nunca suena
seco. Lo que cambia:
- `configBase.nivelEmojis` pasa a `muchos` (la consola de NovuChat lo declara así).
- **Límites de longitud** (el PDF tiene mensajes de 3 o 4 oraciones): mensaje general ≤ 4 oraciones
  y ≤ 60 palabras (una exclamación inicial cuenta como oración); el mensaje de PLANES ≤ 5 oraciones y
  ≤ 70 palabras. Sigue siendo UNA «?» por mensaje y un solo mensaje por turno. `empatia` sube a ≤ 140
  caracteres (emojis incluidos); `impacto` ≤ 160 caracteres y ≤ 24 palabras. Ajusta `construir.mjs`,
  la librería, `MAX_PALABRAS`/`MAX_ORACIONES` de las suites y el detector de la batería.
- **El modelo escribe la empatía con calidez.** En `ccInstrucciones`, una sección de tono: escribe
  como una persona cercana y entusiasta; `empatia` = UNA oración que retome con tus palabras lo que
  dijo el cliente (no lo repitas textual), 1 emoji cuando aporta, sin preguntas, cifras, saludos ni
  promesas. Dos ejemplos genéricos, sin nombres de comercios: «¡Uff, te entiendo! 😅 Responder todo a
  mano le quita tiempo a cualquiera.» y «¡Qué buena señal que ya vendas por WhatsApp! 🙌». El respaldo
  cuando la empatía no pasa el filtro deja de ser «Te entiendo.»: «¡Te entiendo! 😊».
- **Textos fijos del código** (todos pasan por `ccConEmojis` según el nivel):
  - LISTA: «¡Hola! 👋 Soy {nombre, }el asistente virtual de {negocio} 🤖✨, con inteligencia artificial. Para darte la info exacta, ¿de qué rubro es tu negocio?»
  - OFERTA: empatía + impacto + «¿Te gustaría ver los planes o prefieres hablar con {asesor}?»
  - PLANES con archivo: «¡Claro! 😊 {resumen} {cierre}», donde `resumen` lo arma el código desde la consola: «La instalación sale desde USD {mínimo de cargosUnicos} (pago único) y los planes mensuales desde USD {mínimo de planes}, cobrados en bolivianos.» (sin cargos, solo la mitad de los planes; sin planes ni cargos, solo el cierre) y `cierre` es el del rubro (abajo) o «¿Qué te parece si {asesor} te cuenta cómo armaríamos esto para tu negocio? 👇». Sin archivo: el bloque de planes en texto + el mismo cierre.
  - TRASPASO: «¡Perfecto! 🙌 Toca el botón para escribirle directo a {asesor}, que te cuenta cómo armarlo para tu negocio. Y para dejarlo anotado, ¿cómo se llama tu negocio?» (sin recepción: sin botón ni promesa; nunca «ya le pasé tus datos»).
  - Gracias por la empresa: «¡Gracias! 😊 Quedó anotado.»  Falla del modelo: «¡Uy, tuve un problema para procesar tu mensaje! 😅 Si quieres, {asesor} te ayuda directamente.»  Identidad: «Soy el asistente virtual de {negocio}, con inteligencia artificial 🤖.»  Sin datos: «Esa no la tengo a la mano 🤔; {asesor} te lo responde.»  Descarte: un texto cordial («¡Sin problema! 😊 …») por motivo.  Audio ilegible y tipo no admitido: con 😊.
- **Datos nuevos por rubro:** `cierre` (opcional; ≤ 2 oraciones y ≤ 160 caracteres, puede terminar en «?» y en «👇»; mismas reglas de caracteres que el resto del guion). `dolor` admite hasta 2 oraciones y ≤ 200 caracteres (la exclamación inicial cuenta); `dolor` + `pregunta` juntos ≤ 3 oraciones y ≤ 50 palabras. Los emojis son válidos en todo el guion.
- **Guion de `novuchat.json`** (sale del PDF; el trato es de tú):
  - `salud-y-belleza`: dolor «¡Excelente! 💅 En los salones y consultorios, la gente olvida su turno y ese hueco ya no se recupera.» · pregunta «Cuéntame, ¿actualmente pierdes mucho tiempo agendando y recordando citas a mano?» · impacto «Nuestra IA responde al instante y agenda sola, incluso cuando estás atendiendo.» · cierre «¿Qué te parece si Silvana te cuenta cómo armaríamos esto para tu negocio? 👇»
  - `gastronomia`: dolor «¡Qué rico! 🍔 En gastronomía los clientes escriben en plena hora pico y, si no respondes rápido, le compran al de al lado.» · pregunta «¿Tomas pedidos por WhatsApp actualmente?» · impacto «Tomamos el pedido, sumamos el envío y mandamos el QR de cobro en segundos.» · cierre «¿Hablamos con Silvana para ver cómo subiríamos tu menú al sistema? 👇»
  - `comercio-y-retail`: dolor «¡Genial! 🛍️ Cuando un cliente escribe fuera de horario y nadie responde rápido, le compra a otro.» · pregunta «¿Se te escapan ventas de noche o los fines de semana?» · impacto «Responde por tu catálogo a cualquier hora y deja el pedido listo con el QR.» · cierre «¿Hablamos con Silvana para ver cómo cargaríamos tu catálogo? 👇»
  - `educacion`: dolor «¡Qué bien! 🎓 Responder las mismas dudas de padres y alumnos todos los días quita muchísimo tiempo.» · pregunta «¿Te llegan las mismas consultas una y otra vez?» · impacto «Responde sobre horarios e inscripciones y agenda visitas en tu calendario.» · cierre «¿Hablamos con Silvana para ver cómo armaríamos las respuestas para tu institución? 👇»
  - `otro`: pregunta «¡Perfecto! 😊 Cuéntame un poquito, ¿de qué trata tu negocio y qué es lo que más tiempo te quita hoy?» · preguntaDolor «🤔 ¿Y qué es lo que más tiempo te quita hoy en tu negocio?» · impacto «Armamos flujos a medida para lo que necesitas lograr, incluso conectados a tu sistema.» · cierre «Para negocios como el tuyo diseñamos flujos a medida. ¿Te animas a hablar con Silvana para ver cómo estructuraríamos tus respuestas? 👇»
  La cifra de Harvard no entra (se carga después, verificada).
- **Batería:** la consola ficticia de `herramientas/bateria.mjs` usa los ids VIVOS y los nombres vivos; agrega casos de tono con las conversaciones del PDF (belleza completa, gastronomía, estudio contable, importadora con ERP, comercio) y que `rubro_sin_guion` cuente como fallo. Sigue siendo solo en seco para ti: la corrida real la hace la coordinadora.
