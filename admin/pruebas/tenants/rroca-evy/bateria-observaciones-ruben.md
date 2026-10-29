# Batería con modelo real: observaciones de Rubén (28/10/2026), Evy y Emma

Solo la LISTA de casos y su criterio. **No se ejecutó** (no gasta llamadas a Gemini): correrla espera el botón de Andres. El motor es el de siempre (`Flujos/experimental/rroca-evy/herramientas/bateria.mjs`, contra la variante de prueba, modo prueba sin `enviarDeVerdad`), y estos casos se pasan a `bateria-casos.json` con el mismo vocabulario de chequeos (`Flujos/experimental/rroca-evy-bateria/LEEME.md`). Los dos tipos nuevos van marcados **(nuevo)**.

**Para Emma:** los mismos casos, cambiando «Dra. Evy» por «Dra. Emma» y con la excepción de su PROPIO.md: **ninguna cifra de dinero**, tampoco en la bienvenida (O4-1 y O4-2 se invierten: `excluye_cifras_de_dinero` sin `permitido`).

## Criterio

- Un caso pasa si pasan todos sus chequeos **duros**; el umbral global de blandos es el de la batería vigente (≥ 95 %).
- Los textos fijos del código se comparan **exactos** (`texto_fijo`), sin tildes ni mayúsculas: el modelo no interviene en ellos y cualquier diferencia es un defecto del código, no del modelo.
- Además de los chequeos de cada caso rigen los `invariantes_globales` de la batería vigente (no repetir el mismo texto dos veces seguidas, un botón pulsado no reaparece, no ofrecer lo que no se cumple, sin enlaces salvo el botón y el mapa de la Consola).
- Textos fijos que se esperan:
  - `PREFERENCIA` = «¡Perfecto! ¿Qué día y horario te quedan mejor para tu valoración?» / con nombre: «¡Perfecto! ¿Cómo te llamas y qué día y horario te quedan mejor para tu valoración?»
  - `CIERRE` termina en «Ya pasé tus datos a recepción; te contactarán para confirmar tu hora.»
  - `OFERTA_LLAMADA` = «Si quieres, recepción te llama para ofrecerte los horarios disponibles y tú decides. ¿Te parece?»
  - `CIERRE_AMABLE` = «Entendido, sin problema. Cuando quieras, me escribes por aquí y seguimos conversando. 😊»
  - `SALUDO_CORTO` empieza con «¡Hola de nuevo! 😊» (o «¡Aquí sigo! 😊» si se repite).
- Tipos nuevos: **`aviso_contiene`** (el aviso a recepción del turno trae todas las frases) y **`sin_aviso`** (ningún aviso a recepción en el turno).

## Casos (42)

### (1) El día y el horario antes del cierre

| Id | Turnos (lo que dice la persona) | Chequeos (duro = D) |
|---|---|---|
| O1-1 | «Hola» → «Quiero agendar mi valoración» | t2: D `texto_fijo` PREFERENCIA con nombre; D `sin_boton`; D `sin_aviso` |
| O1-2 | «Hola» → «quiero agendar» → «Rosa, el martes en la tarde» | t3: D `boton_recepcion`; D `incluye_todas` [«Excelente decisión, Rosa», «Ya pasé tus datos a recepción; te contactarán para confirmar tu hora»]; D `aviso_contiene` [«Rosa», «martes», «tarde»] |
| O1-3 | «Hola, me llamo Paola» → «quiero agendar» | t2: D `texto_fijo` PREFERENCIA sin nombre; `excluye` [«cómo te llamas»] |
| O1-4 | «Hola» → «Quiero agendar el jueves en la mañana, soy Ana» | t2: D `boton_recepcion` (cierra directo, sin pregunta); D `aviso_contiene` [«jueves», «mañana»] |
| O1-5 | «Hola» → «quiero agendar» → «Lucía» → «cualquier día después de las 5» | t3: D `sin_boton`, `incluye_alguna` [«acomodan más»]; t4: D `boton_recepcion`, D `incluye_todas` [«Excelente decisión, Lucía»] |
| O1-6 | «Cuéntame de la valoración» → (el modelo ofrece agendar) «sí» | t2: D `texto_fijo` PREFERENCIA (con o sin nombre); D `sin_boton` |
| O1-7 | «Hola» → «quiero agendar» → «soy diabética» | t3: D `sin_boton`; D `sin_aviso`; `excluye` [«Excelente decisión»] (contesta el modelo, remite a la valoración) |
| O1-8 | «Hola» → «quiero agendar» → «¿tienen sábados?» | t3: D `sin_aviso`; contesta el modelo con el horario de la Consola o remite; `excluye` [«Ya pasé tus datos»] |
| O1-9 | «Hola» → «Me gustaría chatear con la secretaria» | t2: D `boton_recepcion` (sin pregunta de día) |
| O1-10 | «Hola» → «quiero agendar» → «martes en la tarde» (perfil «Ana Pérez») | t3: D `incluye_todas` [«Excelente decisión, Ana»]; D `excluye` [«Excelente decisión, Martes»] |

### (P) Promesa de llamada con mecanismo

| Id | Turnos | Chequeos |
|---|---|---|
| OP-1 | «Hola» → «gracias, ¿me llaman ustedes?» | t2: D `excluye` [«te llama», «te llamamos», «te contactará», «te van a llamar»] (sin aviso de llamada, ninguna promesa) |
| OP-2 | «Hola» → «no gracias» → «sí» → «gracias» | t3: D `aviso_contiene` [«pidió que la llamen»]; t4: si nombra la llamada, solo «Recepción te contactará para ofrecerte los horarios disponibles.» (`excluye` [«te llamamos», «mañana te llaman»]) |
| OP-3 | «Hola» → «quiero agendar el martes» (plantilla fuera de ventana NO aprobada en el entorno de prueba) | t2: D `boton_recepcion`; D `excluye` [«Ya pasé tus datos»] (sin aviso no se promete) |

### (2) Ubicación completa

| Id | Turnos | Chequeos |
|---|---|---|
| O2-1 | «Hola» → «¿Dónde están ubicados?» | t2: D `incluye_todas` [«📍 Ubicación: », «Teléfono: », «Horario: »] (con los tres datos en la Consola); D `excluye` [«+591»] |
| O2-2 | «Hola» → «me pasas la dirección exacta?» | t2: la dirección en texto; D el teléfono y el horario aparecen UNA sola vez |
| O2-3 | «Hola» → «¿cómo llego?» (Consola sin enlace de mapa) | t2: D `excluye` [«📍»]; sin líneas vacías al final |
| O2-4 | «Hola» → «¿cuánto dura la sesión?» | t2: D `excluye` [«Teléfono:», «Horario:», «📍»] |

### (3) «No gracias» / «Lo voy a pensar»

| Id | Turnos | Chequeos |
|---|---|---|
| O3-1 | «Hola» → «No gracias» | t2: D `texto_fijo` OFERTA_LLAMADA; D `sin_agente`; D `sin_boton` |
| O3-2 | «Hola» → «Lo voy a pensar» | t2: D `texto_fijo` OFERTA_LLAMADA |
| O3-3 | «Hola» → «más adelante, gracias» | t2: D `texto_fijo` OFERTA_LLAMADA |
| O3-4 | «Hola» → «lo voy a pensar» → «sí, me parece» | t3: D `boton_recepcion`; D `incluye_todas` [«Ya pasé tus datos a recepción»]; D `aviso_contiene` [«pidió que la llamen»] |
| O3-5 | «Hola» → «no gracias» → «no» | t3: D `texto_fijo` CIERRE_AMABLE; D `excluye` [«excelente día», «recepción te llama»] |
| O3-6 | «Hola» → «no gracias» → «no» → «no gracias» | t4: D `excluye` [«recepción te llama»] (la oferta no se repite) |
| O3-7 | «Hola» → «no gracias, ¿cuánto cuesta?» | t2: contesta el modelo (`excluye` [«recepción te llama»]); D sin cifras salvo la permitida |
| O3-8 | «Hola» → «gracias» | t2: contesta el modelo; D `excluye` [«excelente día», «recepción te llama»] |
| O3-9 | «Cuéntame» → (oferta de agendar) «no» | t2: D `texto_fijo` OFERTA_LLAMADA |

### (4) Sin «bonificado»; 250 Bs solo en la bienvenida

| Id | Turnos | Chequeos |
|---|---|---|
| O4-1 | «Hola» | t1: D `excluye` [«bonificad»]; `incluye_alguna` [«250 Bs»]; `incluye_alguna` [«sin pagar nada para agendar»] |
| O4-2 | «Hola» → «¿cuánto cuesta el tratamiento?» | t2: D `excluye_cifras_de_dinero` (sin `permitido`); D `excluye` [«bonificad»] |
| O4-3 | «Hola» → «¿de verdad es gratis?» | t2: D `excluye` [«250», «bonificad»]; `incluye_alguna` [«gratuita»] |
| O4-4 | «Hola» → «quiero agendar el lunes en la tarde, soy Ana» | t2 (cierre): D `excluye` [«bonificad», «250»] |
| O4-5 | (imagen del anuncio de blazer blanco) → «¿qué incluye la valoración?» | t2: D `excluye` [«250», «bonificad»] |

### (5) Saludo con la ficha vigente

| Id | Turnos | Chequeos |
|---|---|---|
| O5-1 | «Hola» → «hola» | t2: D `texto_fijo` SALUDO_CORTO con «¿Cómo te llamas»; D `sin_agente`; D `excluye` [«asistente virtual de la Dra.»] |
| O5-2 | «Hola, soy Paola» → «buenas» | t2: D `texto_fijo` «¡Hola de nuevo! 😊 ¿En qué te puedo ayudar?» |
| O5-3 | «Hola» → «hola» → «buenas tardes doctora» | t3: D `distinto_del_turno_anterior` |
| O5-4 | «Hola» → «hola, quiero información de los tratamientos» | t2: contesta el modelo; D sin repetir la bienvenida completa (`excluye` [«asistente virtual de la Dra.»]) |

### (6) Variar el cierre

| Id | Turnos | Chequeos |
|---|---|---|
| O6-1 | «Cuéntame de la valoración» → «¿y cuánto dura?» → «¿y duele?» → «¿y es para mí?» | D en cada turno la última pregunta difiere de la del turno anterior (`distinto_del_turno_anterior` sobre la última oración) |
| O6-2 | O6-1 y luego «sí» | t5: D `texto_fijo` PREFERENCIA (la variante sigue siendo una oferta) |
| O6-3 | «Hola» → «Ana» → «no entendí» | la pregunta del nombre puede repetirse (no es de cierre): sin chequeo duro de variación |

### Regresión (lo que ya funcionaba)

| Id | Turnos | Chequeos |
|---|---|---|
| OR-1 | «Hola Dra. Evy, vi su anuncio y quiero agendar mi valoración gratuita 🙌» | t1: D `sin_boton` (primer contacto: bienvenida que pide nombre y deseo); `pregunta_nombre_y_deseo` |
| OR-2 | «Hola» → «quiero agendar el martes, soy Ana» → «quiero agendar de nuevo» | t3: D `boton_recepcion`; `incluye_alguna` [«de nuevo el botón»]; D `sin_aviso` |
| OR-3 | «Hola» → «tengo fiebre y la cara hinchada» | t2: texto fijo de consulta médica con botón (sin cambios) |
| OR-4 | «Hola» → «no me escribas más» | t2: D `baja_silenciosa` (gana la baja, no la oferta de llamada) |
