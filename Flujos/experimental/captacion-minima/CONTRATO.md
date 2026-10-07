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

## 14. Cordialidad sin repeticiones (04/10/2026) — manda sobre §13 donde difieran

Tras la prueba real de Andres («hay repeticiones innecesarias, poca cordialidad») cambian los textos fijos de §13: el TRASPASO («…que te cuenta cómo armarlo. Y para dejarlo anotado, ¿cómo se llama tu negocio? 😊», sin «negocio» doble), el cierre tras el nombre («¡Gracias! 😊 Anoté «{empresa}». ¡Cuando quieras, escríbele a {asesor} con el botón!», en lugar de «Quedó anotado.»), la pregunta de la OFERTA (tres formulaciones que rotan) y un acuse («ok», «gracias»…) en el paso de la empresa (no repite la pregunta ni llama al modelo). El detalle y las reglas de seguridad del eco del nombre están en `DISENO.md` §14. Sin cambio en la cuenta de mensajes.

## 15. Más detalle y orientación comercial (06/10/2026) — manda sobre §13 y §14 donde difieran

Silvana (diseño funcional) observó el chat publicado: «está robótico, suele repetir frases, es poco cordial y las respuestas son muy cortas y concisas». La batería real
(24 conversaciones, 104 mensajes) midió 26 palabras por mensaje de promedio (máximo 46), la presentación idéntica en 24 de 24, la pregunta de cierre de la oferta en 18 de 24
y la frase de Harvard en los cuatro rubros que la cargaban; solo gastronomía decía algo concreto de lo que NovuChat hace. Decisiones de Andres, sin reabrir:

1. **Un mensaje por turno, como hoy.** El detalle va dentro del mismo mensaje. **0 mensajes agregados o quitados**; ningún camino necesitó uno más.
2. **Límites** (una sola fuente: `ccLimites()` de la librería; las suites y la batería comparan sus cifras con ella):

   | | Antes | Ahora |
   |---|---|---|
   | Mensaje general | 4 oraciones, 60 palabras | **6 oraciones, 95 palabras** |
   | PLANES (el único con encabezado) | 5 y 70 | **7 y 110** |
   | `empatia` del modelo | 2 oraciones, 140 caracteres, 25 palabras | **2 oraciones, 220 caracteres, 34 palabras** |
   | `respuesta` del modelo (pregunta suelta) y aclaración de la consola | 2 oraciones, 280 caracteres (300 la aclaración) | **3 oraciones, 420 caracteres** |
   | `maxOutputTokens` | 400 | **600** (el razonamiento del modelo también cuenta: se mide en la batería real) |
   | `impacto` (guion) | 160 caracteres, 20 palabras | 160 caracteres, **21 palabras** (la frase de Harvard con «cliente potencial») |
   | `queHacemos` / `comoFunciona` (guion, nuevos) | — | 240 caracteres, 2 oraciones, 24 palabras / 160 caracteres, 1 oración, 20 palabras |
   | Pregunta de cierre de la oferta | 11 palabras | **16 palabras** (con un porqué breve) |

   La oferta máxima cabe justa: empatía (34) + orientación (24) + impacto (21) + pregunta (16) = 95 palabras y 2 + 2 + 1 + 1 = 6 oraciones. Siguen vigentes los límites de Meta
   (cuerpo ≤1.024, título de botón ≤20 y de fila ≤24, lista ≤10 filas) y **una sola «?» por mensaje**. Objetivo de la oferta tras el dolor: 55 a 85 palabras (antes ~40); con una
   empatía realista de ~20 palabras mide 53 a 84 según el rubro (la prueba exige al menos 50).
3. **Estructura de la oferta** (un solo mensaje con botones): empatía natural (modelo) → **orientación** (`queHacemos` del rubro) → el **dato de impacto**, una sola vez por ficha (`impactoDicho`) →
   una pregunta de cierre con su porqué que propone el siguiente paso (ver planes o hablar con un asesor), en tres formulaciones que rotan. Consultivo, sin presión.
4. **Orientación comercial por rubro = dato del tenant, no código.** `guion.rubros.<id>.queHacemos` y `comoFunciona` (este último va en el mensaje de PLANES, entre el resumen de precios y el cierre).
   Se validan en `validarDatos` con el mismo rigor de caracteres y largos que el resto, y además sin `?`, sin precios (`CC_PRECIO`), sin promesas ni porcentajes (`CC_PROMESA_DEL_MODELO`).
   **Verdad comercial:** solo afirmaciones respaldadas por las fuentes verificadas (el PDF, el corpus del sitio del mismo archivo de datos, los planes de la consola y la frase de Harvard); ninguna cifra, cliente,
   caso o resultado inventado; ninguna promesa de contacto ni de tiempos de una persona. Una prueba exige que cada cifra de esas oraciones esté literalmente en las fuentes (hoy 24 y 48) y que sus palabras clave
   estén en el corpus; la tabla «frase → fuente» para Silvana está en el informe de la entrega.
5. **Harvard:** «Según Harvard Business Review, contactar a un cliente potencial en la primera hora lo hace siete veces más probable de calificar.» (antes «prospecto»). Vive en `impacto` solo donde encaja —belleza,
   comercio y «otro»; gastronomía y educación no lo cargan— y sale una sola vez por ficha (se vuelve a poder decir en la ventana siguiente).
6. **Sin repetición.** Los textos fijos tienen tres variantes elegidas de forma determinista por contadores de la ficha: `rot.{saludo, rubros, traspaso, acuse, cierre, sinDatos, identidad}` (enteros 0 a 11) además de
   `ofertas` y `sueltas` (§14). El saludo del primer mensaje parte del **último dígito del teléfono** (más `rot.saludo`), así que es reproducible. Familias: saludo y pregunta de rubros, traspaso, acuse, cierre tras el nombre,
   pregunta de cierre de la oferta (y la invitación sin pregunta), «sin datos» e identidad. Dentro de una misma conversación una familia nunca da el mismo texto dos veces seguidas. Las variantes conservan el trato de tú, los emojis
   (nivel «muchos»), la presentación como IA y la regla de no nombrar un botón que no existe. Los contadores se sanean en `ccEstadoVigente` (solo claves conocidas, enteros acotados, solo propiedades propias), vencen con la
   ventana —**salvo `rot.saludo`**, para que quien vuelve al día siguiente no reciba el mismo saludo; a las 48 h se olvida la ficha entera— y «Confirmar envío» los restaura con `fichaAntes` si Meta rechaza el mensaje.
7. **Tono consultivo** en `ccInstrucciones`: vendedor consultivo (reconoce con calidez, conecta con algo concreto que haría el servicio —solo lo del dato—, propone el siguiente paso), sin repetir las palabras del cliente ni las
   frases de los mensajes fijos, variando el arranque, concreto. Los filtros S1 (identidad), S2 (promesas), S3 (montos y ofertas) y H1 (monto con moneda) y la regla de una sola «?» siguen sin aflojar; `CC_MAX_PALABRAS_EMPATIA` (34)
   y el margen de `ccRetomar` (prefijo de hasta 3 oraciones y lo que quede de 95 − 4 − la pregunta) son coherentes con los límites nuevos.
8. **Preguntas sueltas con más detalle:** la `respuesta` del modelo admite 3 oraciones y 420 caracteres. Tras la respuesta la oferta cierra con una invitación sin «?» (tres variantes) que orienta al siguiente paso y mantiene los botones;
   la pregunta completa se repite una de cada dos veces (§14). «Esa no la tengo a la mano» queda para cuando de verdad no hay dato, con tres frases más cálidas.
9. **No cambia:** los hechos de calificación, la planilla, el aviso a recepción, el estado (salvo los contadores nuevos), el manejo de medios, los límites de Meta ni los 43 nodos del flujo.

### Cambio de alcance (Andres, 06/10/2026): ninguna persona del equipo se nombra en lo que el cliente lee
La persona que atienda puede ser otra. Con los datos de NovuChat (`asesor.nombre` **vacío**) ningún mensaje saliente —textos, botones, filas, saludo prellenado del botón a recepción, `cierre` del guion— nombra a nadie: dice «un asesor»
(sin género marcado). Decisión de implementación:
- `ccQuien(asesor)` devuelve el nombre configurado o «un asesor»; `ccInicial` lo capitaliza al inicio de una oración («Un asesor te lo responde con gusto»); `ccTituloAsesor` da «Hablar con un asesor» (20 caracteres justos).
- `guion.asesor` es **opcional** (ausente o `{}` equivale a vacío); un nombre se valida igual que antes (vacío o 2 a 9 letras). Un tenant que configure un nombre sigue funcionando como siempre (las fixtures de prueba con «Silvana» son de un tenant de EJEMPLO).
- `ccEsIdentidad` reconoce también «¿eres un asesor?», «¿me atiende una asesora?»; los filtros S1/S2 siguen cubriendo «un asesor», «el asesor» y «recepción» como quienes no pueden recibir promesas del modelo.
- El nombre del ASISTENTE (p. ej. «Kenji», de la consola) no se toca.
- Pruebas: la suite de punta a punta revisa CADA mensaje con los datos reales (texto, botones, filas, saludo prellenado) contra `/silvana|asesora/i`, la librería recorre todos los caminos y la batería en seco no encuentra el nombre en ninguna conversación.

### Dos defectos que solo se vieron con el modelo real (batería real del 06/10/2026)
- **Aperturas repetidas.** El modelo abrió una y otra vez con «¡Uff, te entiendo!», «¡Perfecto!», «¡Excelente!»: `ccInstrucciones` nombraba la frase («no siempre «¡Uff, te entiendo!»») y la usaba de primer ejemplo, y **nombrar un ejemplo, aun negándolo, lo copia**.
  Ahora el prompt no nombra ninguna frase ni lleva listas negras: pide «abre cada vez de forma distinta, según lo que dijo el cliente» y da CUATRO ejemplos con aperturas y estructuras distintas (una observación, una felicitación por algo concreto, una frase de empatía imaginativa y
  una directa al punto; ninguna con «?» —la empatía no admite preguntas—). Una prueba exige que no compartan los 12 primeros caracteres ni la primera palabra y que no aparezca «Uff».
- **Pregunta pendiente repetida idéntica (C25, promesa inducida).** (a) `pide_asesor` incluye ahora pedir que lo llamen, le escriban o le expliquen por llamada, mensaje o reunión; el camino R6 ya no usa la empatía del modelo sino **una frase del código** (tres variantes, `rot.pideAsesor`:
  «Si prefieres hablarlo con una persona, puedes hacerlo con un asesor desde las opciones de abajo»…), con el botón (o la fila) del asesor, sin traspaso ni aviso y sin prometer llamada, horario ni respuesta (así «¡Con gusto te ayudamos con eso!» del modelo ya no puede salir).
  (b) Red de seguridad en el código: `repetidas` (entero 0 a 9 en la ficha, saneado, vence con la ventana, restaurado con `fichaAntes`) cuenta las veces seguidas que se retoma la pregunta pendiente. A la 2.ª vez no sale idéntica: se reformula (dos formulaciones que se alternan por paso) y se agrega
  «Si prefieres, un asesor te lo explica directo 😊» con su botón. Cualquier turno que no retome la pregunta la reinicia. Además, un tipo `otro` en el paso del dolor o del negocio ya no se toma por la respuesta al dolor (oferta y calificación Media): se retoma la pregunta con la empatía del modelo.
- **Mensajes por conversación: 0 agregados y 0 quitados.**

### Correcciones de la revisión de código y de seguridad del PR #454 (06/10/2026)
- **A. Filtros del modelo (S1/S2/S3), en el código y solo en la capa propia de captación** (`CC_YO_DEL_MODELO`, `CC_PROMESA_DEL_MODELO`, `CC_OFERTA_DEL_MODELO` y `quienPromete`; no se tocó el filtro común). S2: `quienPromete` suma `asesora`, `especialista`, `ejecutivo`, `ejecutiva`, `equipo` y `alguien`,
  y la regex de promesas cubre `te va a (llamar|escribir|…)`, el futuro plural, `recibirás una llamada`, `te llegará`, `te (enviaremos|mandaremos|envío|mando)`, `coordinamos una llamada`, `(asesor|equipo|…) (responde|escribe|llama|…)` y `puede llamarte|escribirte`. S3 (empatía y respuesta): `sin costo|sin cargo|de regalo|rebaja|por ciento|promoción|oferta|precio especial|bonificación|2x1|lanzamiento`.
  S1: `mi nombre es`, `me llamo`, «habla X» al inicio de una oración (no «habla con tus clientes» ni «habla español»), `aquí el/la/tu asesor(a)`, `(hablas|hablo|estás hablando|estoy hablando|conversas) con el/la/un/una asesor(a)|ejecutivo|vendedor`, `atiende el/la asesor(a)` y `yo mismo/a`.
  Pruebas con la lista exacta del informe (19 frases) en `respuesta` y en `empatia`, más legítimas que deben pasar («Cada profesional tiene su propia agenda», «Te atiende el sistema 24 horas»).
- **B. `ccEsIdentidad`:** `asesor|asesora` solo como pregunta a «tú» (`eres|sos`), nunca con `es` («mi esposa es asesora de seguros» va al modelo). «¿Me atiende un asesor?» y «¿hablo con una asesora?» ya no son identidad: son un pedido de contacto (ruta R6).
- **C. Tipo `otro` en el dolor o el negocio: vuelve al comportamiento anterior** (se toma como respuesta: `respondioDolor`, califica Media, guarda `rubroId`/`rubroLibre` y pasa a la oferta), para que el cliente no quede atrapado ante «😩😩», «👍», «jaja sí», una foto o un audio. El caso C25 se resuelve en CÓDIGO: `ccPidioContacto(texto)` (llámame, me llamas, contáctenme, escríbeme,
  «que me expliquen por videollamada», «¿me atiende un asesor?»…; sobre el texto normalizado, solo en texto o audio transcrito, nunca en un toque) deriva a la ruta R6 (acción `contacto`: texto del código `ccPresentaAsesor`, botón del asesor, sin traspaso ni aviso, sin prometer llamada ni horario) en cualquier paso, sin llamar al modelo; en el primer mensaje, la lista de rubros con la fila del asesor.
  «Tengo muchas llamadas perdidas» o «me llaman todo el día» no lo activan. La red `repetidas` se conserva para el retomar de una pregunta pendiente (preguntas sueltas).
- **D. Validación de los datos** (`errorDeTextoDelGuion`, para TODOS los textos del guion): invisibles y de control `[\u0080-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]`, formato de WhatsApp `[*_~\`]`, enlaces con `CC_ENLACE` de la librería, promesas, ofertas/porcentajes, precios y montos (también en letras), pago acreditado o verificado, negar ser IA y hablar como persona.
  `?` y `¿` rechazados en `queHacemos`, `comoFunciona` e `impacto`; los `cierre` y las `pregunta` conservan su «?». En ejecución, `ccPlanes` aplica `ccSinPregunta` a `comoFunciona`.
- **E. Textos fijos sin promesa:** «sin datos» y la reformulación de la pregunta repetida ofrecen al asesor como una OPCIÓN («si prefieres, puedes preguntárselo a un asesor con las opciones de abajo»), nunca «te lo explica/te lo responde». Sin `numeroRecepcion` válido, o si quien escribe es recepción (`ccHayRecepcion`), no llevan esa frase ni el botón y no nombran ningún botón.
- **F.** La pregunta de cierre mide ≤16 palabras también con «un asesor» («…para ubicar tu presupuesto…»); `ccRetomar` descuenta la reformulación y la cola del asesor del presupuesto del prefijo; `repetidas` SATURA (alterna 8 y 9; no da la vuelta a 0). `rot` lista también `pideAsesor`.
- La batería gana `exige` por turno (`accion`, `boton`): C23 exige avanzar a la oferta y C25/C25b exigen la acción `contacto` con el botón del asesor; el incumplimiento cuenta como violación (`no_avanza`, `sin_boton_del_asesor`).
- **Mensajes por conversación: 0 agregados y 0 quitados.**

## 16. Documento comercial de Kenji (07/10/2026) — manda sobre §13, §14 y §15 donde difieran

Fuente única del contenido comercial: **`fuentes/system-prompt-comercial-kenji-2026-10-07.md`** («System Prompt Comercial para Kenji», Andres y Silvana, 6 secciones). Decisiones de Andres, sin reabrir (D1 a D10):

**Qué manda sobre lo anterior.** (a) **El flujo ya no pregunta por el dolor en los rubros estándar** (§13/§15): elegir el rubro es **explicarlo** de inmediato. La pregunta de dolor queda solo para «Otro» (como cierre
investigativo). (b) **Los cierres** son los del documento: la pregunta de la oferta es EXACTA la 1.ª vez y la de los precios, la de D3. (c) **El contacto** es siempre «hablar con alguien de nuestro equipo» con el botón (aviso a recepción +
botón, como hoy): nunca «se comunique contigo» ni «ofrecerle contactarlo»; ningún texto promete llamada, horario ni que alguien escriba. (d) El dato de Harvard (§15) **no se usa** en los datos de NovuChat (el documento es la fuente
única y el mensaje no tiene espacio); el mecanismo (`impacto`, una vez por ficha) sigue en la librería para otros tenants. (e) `nivelEmojis` de los datos baja a «pocos» (D6; ver la advertencia).

### D1 y D2: híbrido y rubros estándar
- **El modelo redacta, el código fija.** Al elegir un rubro estándar (toque, nombre escrito, campaña o rubro que el modelo reconoce) el plan llama al modelo en modo `explicar` (`ccDecidir` → `plan.modo = 'explicar'`) y `ccResolverModelo` devuelve la acción `explicacion`.
  Es **la única llamada nueva** y no agrega ningún mensaje: el mensaje de ese turno es la explicación + la pregunta de cierre + los botones «Ver planes» / «Hablar con el equipo» (título de 20 caracteres, el máximo de Meta). Si el modelo falla, no responde, devuelve un JSON roto o su texto no pasa la validación, sale el **respaldo fijo** del
  dato (`guion.rubros.<id>.explicacion`), nunca el texto de falla.
- **Validación de lo redactado** (`ccLeerModelo` + `ccExplicacionDelRubro`): el filtro común de redacción; S1/S2/S3 y H1 (sin aflojar); hasta 4 oraciones, 72 palabras y 520 caracteres (con la pregunta de cierre de 13 palabras cabe en 6 oraciones y 95); sin «?»;
  números solo como número ENTERO presente en lo que ve el modelo (antes un «7» pasaba por estar dentro de «72»); **ninguna cifra de consumo** (`CC_CIFRA_DE_CONSUMO`); **nada que valide pagos con el banco** (`CC_ACREDITA_MODELO`); **ningún sistema que el servicio no nombre**
  (`ccSistemaAjeno`: denylist de sistemas, marcas con mayúscula interior, siglas y, en la explicación y en la `respuesta`, palabras con mayúscula en medio de la frase; solo se pueden nombrar WhatsApp, Meta, Google Calendar, Google Sheets, el miniCRM, el QR, el negocio, el asistente y los planes);
  y **«obligatoriamente basada en los puntos clave»** (`ccCubrePuntos`: cada punto clave se toca si aparece un tercio de sus raíces de 5 letras, y la explicación tiene que tocar el 60% de los puntos).
- **Datos por rubro** (`guion.rubros.<id>`): `explicacion` (el respaldo fijo, con los puntos clave del documento §2) y `puntosClave` (2 a 8, los ve el modelo en la `systemInstruction` estática, junto a su rubro). Un rubro con `explicacion` **no lleva** `dolor` ni `pregunta`;
  sin `explicacion` (otros tenants) el flujo anterior sigue igual (`esperando_dolor`). `construir.mjs` valida todo (límites desde la librería: `CC_MAX_EXPLICACION`, `CC_MAX_ORACIONES_EXPLICACION`, `CC_MAX_PALABRAS_EXPLICACION`) con las guardas de siempre.
- **Mensaje:** `ccOferta({ explicacion })` con los emojis **por partes** (`ccEmPartes`): con «pocos» cada parte conserva su primer emoji, así la pregunta exacta no pierde su 🤝.

### D3 y D7: contacto y la pregunta exacta
- `ccQuien` (sin nombre) = «alguien de nuestro equipo»; el botón, «Hablar con el equipo». Traspaso: «Toca el botón para escribirle directo a alguien de nuestro equipo y ver juntos cómo armarlo» + el pedido de datos.
- **Pregunta de cierre (D7):** la 1.ª vez de la ficha, EXACTA: «¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝». Las repeticiones rotan por `ofertas` entre dos formulaciones más (mismo sentido, ≤16 palabras).
- **Cierre de precios (D3):** «¿Te gustaría hablar con alguien de nuestro equipo para evaluar juntos qué plan es el ideal para empezar? 🤝» (el documento decía «se comunique contigo»).

### D5: precios, solo si pide planes o costos, armados por el código
`guion.precios` trae las FRASES (no las cifras): `estandar` («Setup estándar»), `detalleEstandar`, `aMedida`, `mensual`, `incluye`. Las cifras salen de la consola: `cargosUnicos` (el más barato sin `desde` = estándar, **sin «desde»**; el más barato con `desde` = a medida) y los planes `mes`:
«Setup estándar USD 65, pago único (configuración llave en mano y conexión a Meta). [Si el rubro es «Otro»: Setup a medida desde USD 125.] Planes mensuales (Impulso, Crecimiento, Pro) desde USD 25. Todos incluyen las funciones clave que necesites (…).» + el cierre D3, con la imagen de planes si existe; sin archivo, el bloque de planes y debajo lo que incluyen y el cierre.
Sin `guion.precios` (otro tenant), el mensaje de planes es el de §13. El modelo no ve ni escribe una cifra.

### D9 y D10: consumo, topes, integraciones y banco, por código
Cuatro reglas deterministas en `ccDecidir` (sobre el texto normalizado, en cualquier paso salvo el primer mensaje, **antes** del modelo y sin llamarlo):
| Regla | Detecta | Respuesta |
|---|---|---|
| `ccPreguntaConsumo` | cuántos mensajes incluye una conversación, límites o topes de uso, detalles técnicos de consumo | acción `consumo`: la oración del documento §5 (dato `respuestas.consumo`) + la opción de hablar con el equipo; **ni un dígito**; no se activa si el cliente cuenta su propio volumen |
| `ccPreguntaTopePlan` | cantidades de conversaciones o mensajes de un plan concreto (nombre en la consola o «plan») | se muestra la imagen de planes, como un pedido de planes (`ccPedirPlanes`); sin cifras escritas |
| `ccPreguntaBanco` | si valida o confirma pagos, transferencias o comprobantes (con o sin «banco») | acción `banco`: «solo revisa visualmente el comprobante: no lo valida con el banco; confirman el banco y el negocio» (prohibición 3) |
| `ccPreguntaIntegracion` | «se conecta/integra/sincroniza con X», «integración con X», «compatible con X» donde X no es WhatsApp, Meta, Google Calendar, Google Sheets, el QR ni el miniCRM | acción `integracion`: «Esa no la tengo a la mano» + el equipo; no repite el nombre del sistema; **nunca inventa una integración** |
Las respuestas fijas rotan por el contador `fijas` (`rot`, 0 a 11): dos preguntas seguidas no reciben el mismo mensaje. Sin recepción válida no nombran ningún botón. El tema preguntado va a la ficha (`temas`, vocabulario cerrado: costos, consumo, integraciones, pagos, dudas).

### «Otros rubros» (documento §3) y lo que cuenta el cliente
Con `guion.rubros.otro.propuesta` el flujo de «Otro» es: tocar «Otro» → la pregunta de qué trata y su mayor cuello de botella (sin modelo); si responde solo el rubro → **empatía contextual** del modelo (con su industria) + **propuesta de valor fija** («no te obliga a seguir un menú rígido: usa IA que se adapta a tu forma de trabajar; con nuestros Setups a Medida armamos respuestas totalmente personalizadas»; el «100%» del documento se dice «totalmente» porque `validarDatos` rechaza todo «%»)
+ **cierre investigativo** (`preguntaDolor`); si en el mismo mensaje cuenta también lo que le cuesta → directo a la oferta (con `queHacemos` como orientación). Cuando responde el cierre investigativo, el modelo extrae `necesidad` y el flujo pasa a la oferta.
- **Validación** (`ccNecesidadValida`, `ccNombreDePersonaValido`, la empresa con `ccNombreDeEmpresa` y que salga de lo que el cliente dijo): `necesidad` de 3 a 160 caracteres, en una línea, sin enlaces, fórmulas, datos personales (teléfono, correo, carnet), órdenes ni marcas, y cada palabra de 5 letras sale de lo que el cliente dijo; `nombre` de 2 a 4 palabras con letras, sin dígitos, enlaces, fórmulas ni órdenes ni palabras de negocio, y todas dichas por el cliente.
- **Nombre y empresa:** al pasar con el equipo UN mensaje pide las dos cosas («¿Cómo te llamas y cómo se llama tu negocio?»; si ya dijo su nombre, solo el negocio). Una respuesta que es solo el nombre del negocio se anota por código (sin modelo); si trae más, el modelo extrae `nombre` y `empresa` y se aplica la validación estricta; si falla, cae al comportamiento de antes (solo la empresa, nombre del perfil). Los acuses no pisan nada. El nombre dado reemplaza al del perfil en la columna C.

### Calificación sin pregunta de dolor
El hecho `respondioDolor` **conserva su nombre histórico pero significa «interactuó después de la explicación»** (escribió o dijo algo sustantivo —`ccEsSustantivo`: una pregunta de fondo, un comentario sobre su negocio, su necesidad, o preguntó por costos, consumo, integraciones o pagos—, no un saludo ni un acuse; en «Otro», respondió el cierre investigativo). La tabla de reglas de «Decidir fila de la planilla» sigue siendo la única fuente:
**Alta** = pidió al equipo o los planes · **Descalificado** = motivo aceptado · **Media** = eligió rubro (o «Otro») e interactuó · **Baja** = el resto (eligió rubro y no continuó).

### El resumen de la hoja (columna J), por código
«Rubro X. Interés: Y. Necesidad: Z. Preguntó por: costos, consumo de mensajes, integraciones, pagos y comprobantes, otras dudas. Pidió: planes y hablar con el equipo.» con lo que haya (hasta 400 caracteres; los temas son de un vocabulario cerrado; la necesidad se sanea otra vez y la celda nunca empieza con lo que una planilla toma por fórmula). El prospecto (`ccProspecto`) trae los campos nuevos `necesidad` y `temas`; no cambian las columnas ni el esquema de la hoja.

### Tabla «frase → fuente» (D4)
Todo lo de la columna «Solo el documento» se toma como verdad comercial dictada por Andres y Silvana (**fuente: «documento comercial 07/10/2026»**): el sitio (corpus de `conocimiento`) **no lo menciona**. Una prueba lo fija (`miniCRM`, `Kanban`, `notas especiales`, `entrevistas`, `admisiones` y `pensiones` no están en el corpus).
| Frase del texto del rubro | Fuente | Solo el documento |
|---|---|---|
| Salud: «recepcionista virtual 24/7», «se integra a tu Google Calendar», «maneja varias agendas a la vez», «agenda sin cruzar horarios» | documento §2; el sitio dice «atiende las 24 horas», «agenda en tu calendario», «cada profesional con su propia agenda» | «recepcionista virtual», «varias agendas a la vez» |
| Salud: «recordatorio automático un día antes» · Belleza: «recordatorio 24 horas antes» | documento §2; el sitio: «recordatorio 24 horas antes por una plantilla aprobada» | «un día antes» (equivale) |
| Belleza: «muestra tus servicios y motiva a agendar en el momento», «revisa la disponibilidad de tus especialistas», «agenda llena» | documento §2 | sí (el sitio habla de agendar y de horarios libres de cada profesional) |
| Gastronomía: «en horas pico ya no pierdes pedidos», «muestra tu menú», «cobro con QR», «directo a cocina» | documento §2; el sitio: «toma el pedido desde tu carta… manda el QR y avisa a la cocina» | «notas especiales» |
| Retail: «no pierdes ventas por las noches», «muestra tu catálogo», «cierra el carrito», «cobra con QR», «datos de envío», «listo para el despacho» | documento §2; el sitio: «responde por tu catálogo a cualquier hora, toma los datos de envío y cierra la venta con el QR» | «cerrar el carrito», «despacho» |
| Educación: «muchas consultas de padres», «admisiones y pensiones», «entrevistas en el calendario del colegio» | documento §2; el sitio: «responde las dudas de padres y alumnos y agenda citas en tu calendario» | «admisiones», «pensiones», «entrevistas» |
| Leads de Ventas: «ningún prospecto calificado se enfría», «califica el interés con IA», «resumen automático», «miniCRM», «tablero Kanban por etapas de venta» | documento §2 | **todo** (el sitio no menciona leads, miniCRM ni Kanban) |
| «Otro»: «no te obliga a seguir un menú rígido», «IA que se adapta a tu forma de trabajar», «Setups a Medida» | documento §3 (reformulado: el documento dice «no usa menús rígidos» y este chat arranca con una lista) | «Setups a Medida» |
| Precios: «Setup estándar USD 65, pago único (configuración llave en mano y conexión a Meta)», «Setup a medida desde USD 125», «planes mensuales (Impulso, Crecimiento, Pro) desde USD 25», «funciones clave (agendamiento inteligente, cierre de ventas con catálogo y cobro, o captura y gestión de leads con miniCRM)» | documento §4 y la consola (cargos 65 sin «desde» y 125 con «desde»; planes 25/50/90) | el nombre «Setup» (la consola dice «Instalación»), «miniCRM» |
| Consumo: «nuestros planes están diseñados para que cada conversación cubra sin problemas todo el flujo necesario para cerrar una venta o agendar una cita» | documento §5 | sí |
| Banco: «solo revisa visualmente el comprobante… no lo valida con el banco; confirman el banco y el negocio» | documento §6 y prohibición 3 de CLAUDE.md | «revisa visualmente» (el sitio dice «quien lo valida eres tú») |

### Qué no cambia, y mensajes por conversación
Los hechos de Alta y de Descalificado, el aviso a recepción (una vez por conversación), el estado, los medios, los límites de Meta, la regla de una sola «?», el trato de tú, 43 nodos por variante y los filtros S1 a S3 y H1.
**Mensajes por conversación: ≤ antes** (la regla del flujo es UN mensaje del asistente por cada mensaje del cliente, y eso no cambia). Lo que baja es lo que el cliente tiene que escribir: un rubro estándar pasa de «lista → pregunta de dolor → (el cliente la contesta) → oferta» a «lista → explicación con la oferta».
El mismo recorrido de un cliente (lista, rubro, planes, equipo, nombre del negocio) son **6 mensajes y 1 llamada al modelo antes** (la respuesta al dolor) y **5 mensajes y 1 llamada ahora** (la explicación, que se hace al elegir el rubro; la prueba de punta a punta lo mide contra el flujo anterior armado en memoria).
Si el cliente contesta algo más que el nombre del negocio (p. ej. «Juan Pérez, Salón Rosa»), la extracción de nombre y empresa agrega **una llamada** (2 en total); consumo, topes, integraciones y banco se contestan sin modelo y ahorran llamadas. Un cliente que sigue comentando tras la explicación genera su turno y su mensaje, como siempre (C1 de la batería: 6 mensajes y 2 llamadas contra 6 y 1 antes).
«Otro»: un mensaje por turno del cliente (el de tres partes responde a la industria; la oferta llega con la necesidad).

### Advertencia (D6) y lo que queda fuera
Con la consola de NovuChat, `voz.nivelEmojis` **manda** sobre `configBase.nivelEmojis` (este solo es el respaldo si la consola no lo envía): para que el nivel «pocos» rija en vivo hay que cambiarlo en la consola (no está en esta zona ni en este PR). La propuesta de las 7 filas de la lista de rubros está en `fuentes/rubros-propuestos-2026-10-07.json` y NO se aplicó.
No hay preguntas de perfilado extra (volumen, urgencia): quedan como propuesta.

## Correcciones de la batería real (§17, 07/10/2026)

La batería real contra el modelo (132 corridas, 258 llamadas) dio 15 violaciones de `exige`. Se corrigió solo esto; los fallos de JSON y los reintentos del modelo son transitorios del proveedor y no se tocan.

1. **La pregunta de cierre exacta, en todo camino.** La 1.ª vez es siempre «¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝». En el camino de «Otro» el emoji se perdía porque el nivel «pocos» dejaba un emoji por mensaje y se lo quedaba la empatía. Ahora `ccOferta` arma DOS partes (lo dicho y el cierre) y cada una conserva su propio emoji. Las variantes posteriores pueden no llevarlo. Hay prueba por camino (lista, respaldo fijo, texto libre, «Otro» y «ninguno»).
2. **Un precio solo sale si el código confirma que se pidió el costo del servicio.** `ccPideCostoDelServicio` decide (la etiqueta `pide_planes` del modelo solo cuenta si esa regla coincide). Sí: «¿cuánto cuesta?», «¿cuánto cobran por el servicio?», «precios», «quiero ver los planes». No: «cuánto cuesta» sobre un producto del cliente o lo que le preguntan a él («me quita tiempo responder cuánto cuesta cada herramienta»). En la oferta, un costo con su objeto explícito (`ccPideCostoConObjeto`: «cuánto sale al mes», «cuánto cuesta el bot») lo contesta el código sin llamar al modelo. **Petición posterior de planes:** la 1.ª vez se reenvía la imagen con «Te los comparto otra vez» (`planesReenviados` en la ficha, vence con la ventana); desde la 2.ª ya no se repite. Sin mensajes ni llamadas de más: es el mismo turno que antes daba «ya te los mostré».
3. **Tono de la explicación del modelo.** Abre con una frase breve, cálida, con exclamación y un emoji acorde al rubro; siempre en 2.ª persona del singular; una idea por oración; sin copiar el documento. Los respaldos fijos del guion también abren así.
4. **Puntos clave: una sola regla.** `puntosClave[i]` puede ser un texto o `{texto, palabras}`, con la familia de palabras del punto («notas especiales|indicaciones|aclaraciones|observaciones», «carrito|pedido|compra»…). `ccCubrePuntos` exige TODOS; si falta uno sale el respaldo. La batería usa la misma función (`cubrePuntos`). `construir.mjs` valida las familias y exige que el respaldo fijo cubra los suyos.
5. **Expectativas de la batería.** N-NOMBRE2 usa «mi negocio es Salón Rosa»; OT1 turno 3 acepta «cuello de botella» o «tarea que te quita»; y la necesidad se actualiza con la última respuesta sustantiva tras el cierre investigativo mientras no se haya pasado con el equipo (una necesidad que solo describe el negocio no cuenta). C26 turno 3 ahora es del código (sin modelo, con la imagen de planes).
6. **Dos fallos seguidos del modelo no dan el mismo texto.** El texto de falla tiene 2 variantes que rotan con el contador `fijas`; ninguna promete nada y las dos llevan el botón del equipo.

Mensajes y llamadas por conversación: sin cambios (0 mensajes más; 0 llamadas más). El reenvío de planes sustituye al «ya te los mostré» y no añade turnos.

