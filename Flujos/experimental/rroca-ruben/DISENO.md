# «Noches Sin Insomnio» de Rubén (tenant `rroca-ruben`): diseño y avance

Fuentes (04/11/2026): especificación consolidada y plan único confirmado por Andres (lista de 15 funcionalidades), MD de Rubén (`CLIENTES/RUBEN_ROCA/Ruben/`), el flujo de Antonio (la forma: 64 nodos, tope 64) y el flujo vivo anterior de Rubén («Libro IA para Emprendedores», 63 nodos), del que se descartó casi todo: 4 productos, 5 prellenados, 5 anuncios, el prompt, la ubicación y la dirección.

## Estado por PR

- **PR-1 (este):** esqueleto de la forma de Antonio (puerta del turno, entrada verificada del receptor, medios, guardado de medios, miniCRM), catálogo de 4 productos y el paso del Libro al Pack, 4 prellenados, botones, cobro REAL por QR de monto abierto, comprobante con cotejo en el servidor, avisos, derivación de lista cerrada, crisis, número no boliviano y un prompt mínimo. Datos con marcadores `REEMPLAZAR_*`.
- **PR-2 (hecho):** prompt completo, ángulos de anuncio (dato de Campañas), objeciones y reglas de salud, la crisis que se levanta a las 48 h de la última señal y la suite `conversacion.test.ts` con los 4 casos del PDF.
- **Después:** seco contra el vivo, ensayo en el Demo A y publicación solo con el botón de Andres. Este flujo NO se publica con marcadores ni con plantillas sin aprobar (`construir.mjs --publicable --anuncios <N>`).

## Decisiones (04/11/2026)

1. El **código decide** (plan, precio, botones, QR, avisos, derivación) y el **modelo solo redacta** 2 a 4 oraciones con una pregunta, filtradas por `cmRevisarRedaccion`. La PARTE 3 del MD (un agente libre que emite etiquetas `[ENVIAR_QR]`) NO se adopta: el prompt no es una barrera.
2. El aviso a Rubén **nunca** dice «pago validado» o «acreditado»: «llegó el comprobante y los datos coinciden; verifique su banco». Las plantillas del libro anterior no sirven y hay que aprobar otras nuevas (hoy marcador + `PENDING`).
3. **Paso del Libro al Pack: solo Libro → Pack**, +35 (la diferencia del catálogo), una vez, por código, dentro del mensaje del comprobante. El Audiolibro y las Meditaciones no suben al Pack (sin fuente); antes de cobrar se ofrece «Mejor el Pack» en el segundo nivel.
4. **Los precios y las etiquetas viven en el catálogo de la Consola**; los botones llevan el nombre del catálogo y el precio (≤ 20 caracteres).
5. **Cuenta bancaria y nombre del titular NO entran al repositorio:** el cotejo del comprobante usa los datos del tenant en la Consola.
6. **Salud:** ni «sin pastillas» ni «curar» ni consejo médico; el filtro del modelo lo rechaza y la derivación médica es por código. **Crisis:** texto nuevo (no el de violencia de Antonio), botón y aviso.
7. **Sin ubicación ni dirección**, sin menú de bonos, sin protección por violencia, sin nada de «IA para emprendedores».
8. **Entrega:** la hace Rubén desde la Consola; el bot no promete envío automático ni enlaces.
9. **Rescate de 22 h:** módulo del servidor, no del flujo; este solo cumple su contrato (`no_contactar`), probado en `rescate-contrato.test.ts`.

## Precondiciones de operación (checklist para quien opere; nada de esto lo hace el flujo)

- [ ] `fijar-flujos --tenant rroca-ruben --flujos venta`: el tenant con el flujo `venta` (precondición del rescate, punto 5 del contrato).
- [ ] Plantillas de aviso nuevas aprobadas en Meta y sus nombres en los datos (`avisoComprobantePlantilla`, `avisoConsultaPlantilla`, estados `APPROVED`).
- [ ] QR nuevo (concepto «Noches Sin Insomnio»; el id de medio que sirve la Consola lo sube Andres) y la sección de cobro real del tenant.
- [ ] Catálogo de 4 productos cargado en la Consola (`negocio-rroca-ruben.json`) y los anuncios (`campanas-rroca-ruben.json`) en el módulo Campañas.
- [ ] Planilla del miniCRM (`planillaProspectosId`) y verificar los títulos de la fila 3 contra la copia viva.
- [ ] Garantía y devolución (`garantiaTexto`), enlaces o archivos de entrega y horario de Rubén de noche (el aviso y el botón de crisis dependen de su teléfono).
- [ ] Falla abierta de la pausa: es la de `chat-novuchat` con la puerta idéntica (si la ingesta y la consola caen en el mismo turno, la puerta devuelve «normal»); a decidir con Cartera antes de publicar.

## PR-2 (05/11/2026): la conversación

**Qué trae.** El prompt completo del modelo (`RR_PROMPT`: base de conocimiento, objeciones, reglas de salud, transparencia; **4.626 caracteres, tope 4.670 = el de Antonio**; el de Antonio usa ≈ 3.6k, el de Rubén lleva más porque trae los 14 eslabones y las objeciones, y no repite ninguna cifra de precio), los casos del PDF resueltos **por código**, las 17 variantes de crisis y de falsos positivos que quedaron pendientes en el PR-1, la forma de levantar la crisis y la suite `conversacion.test.ts`. Mensajes por conversación al cliente: **0 agregados** (todo va dentro del mensaje que ya sale; la prueba lo niega turno a turno).

**Casos del PDF.**
- **(a)** Una captura de anuncio SIN texto, como primer mensaje y con un anuncio reconocido por su titular (dato de Campañas, `titular_principal`) y con ángulo, ya NO recibe el saludo genérico: sale la presentación (una vez) y la apertura que redacta el modelo con el ángulo como dato (plan `angulo`); si el modelo falla o el texto se rechaza, cae al saludo fijo. Sin ángulo (dato vacío), saludo fijo. No se agregó lógica de anuncios: es el mecanismo `titular_principal` que ya existía.
- **(b)** «¿Precio y devolución?»: el precio sale por código (el del catálogo, el de UN producto si lo nombra, la lista si no) DELANTE de la derivación, en el mismo mensaje, con presentación si es el primero, el botón de Rubén y el aviso. **Clave del aviso: `garantia`** (el motivo exacto), no `no_supo`: `no_supo` es la clave de «el modelo no supo», con texto variable y sin el motivo; el PDF pide un aviso a Rubén, que sale con su motivo. Solo con garantía, otro medio de pago, reclamo o volumen; la crisis y la pregunta médica nunca traen precio.
- **(c) y (d)** «¿Me garantizan dormir?» no garantiza y recuerda el plan de 21 días; si la misma frase pregunta el precio o la duración de los audios, el código junta las respuestas en UN mensaje. Dos preguntas que el código no reconoce las contesta el modelo (el prompt se lo pide) y su respuesta con más de una «?» cae al texto fijo.
- **Objeciones por código:** «lo voy a pensar» (sin presión, con los dos precios del catálogo, sin pregunta ni botones; solo con las opciones habilitadas: antes lo contesta el modelo, sin montos) y la muestra de voz (solo si la piden: 50 segundos de «Cierra el día», sin enlaces: **el dato de la URL de la landing no está en los datos del tenant**, el texto dice «la página del libro, sección Escucha un fragmento»).

**Levantar la crisis (decisión).** La ficha guarda `riesgoMs` = cuándo fue la **última señal** de crisis (el texto de ese turno, o la marca RIESGO del modelo). La protección vence a las 48 h de esa señal, **no** del último mensaje: escribir «gracias» o «el libro» ya no la renueva; escribir otra señal reinicia el plazo. Dentro de las 48 h la crisis sigue cortando la venta (sin libro, precio ni QR aunque pida comprar) y cada respuesta reporta `no_contactar`. Una ficha vieja sin `riesgoMs` usa su último mensaje (comportamiento anterior). Se prefirió esto a un camino de Rubén porque el único camino que ya existe (pausar la conversación desde la Consola) no distingue «Rubén atendió la crisis» de «uso extendido»: levantarla ahí sería adivinar. **Decisión pendiente de Andres:** si quiere además que Rubén pueda levantarla antes de las 48 h, hace falta un dato nuevo en la Consola (no existe hoy). El texto de la continuación es el mismo (no se afinó: una frase distinta para «gracias» sería una decisión de redacción de Silvana).

**Variantes de crisis.** Las listas de `crisis-listas.test.ts` pasaron de 17 pendientes a casos reales (10 variantes de crisis y 7 falsos positivos; el principio no cambia: ante la duda, crisis; las exclusiones son solo listas cerradas de objetos cotidianos y las listas de referencia solo se amplían). Límite: una frase que ninguna capa reconozca sigue sin disparar; el modelo es la segunda red.

## La red de crisis: dos capas y sus límites

1. **Código** (`rrEsCrisis` en `rr.js`): red amplia de frases y raíces sobre texto, voz, texto de una captura y pie de foto; con tipeos plegados; las exclusiones son SOLO listas cerradas de objetos cotidianos y de venta. Ante la duda, crisis.
2. **Marca RIESGO del modelo**: cuando el modelo juzga que hay una crisis que el código no vio, contesta solo esa palabra y el código arma el mismo texto.
Límites: una frase nueva que ninguna capa reconozca no dispara (el modelo es la segunda red, no una garantía); una crisis queda activa 48 h desde la última señal. **Las listas de referencia** viven en `admin/pruebas/tenants/rroca-ruben/crisis-listas.test.ts` (frases de crisis y control de falsos positivos); las variantes nuevas se agregan ahí, no se parchan una por una.
**Ninguna publicación sin el PR-2 aprobado y el ensayo en el Demo A pasando esas listas.**

## Dónde vive la salud

La barrera final es `rrSeguro` (código): nunca «sin pastillas», «curar», «desde la primera noche», «garantizado» ni «simulado»; además el filtro de redacción del modelo (`rrExtraRedaccion`) y la derivación médica por código (`rrDerivacion`, clave `medica`: una acción sobre la medicación —dejar, suspender, mezclar, dosis, receta— o `sobredosis`). El prompt solo lo repite.

## Límites conocidos de este PR

- La ficha vence a las 48 h del último mensaje: el paso al Pack («una sola vez») vive en esa ficha; la crisis vence a las 48 h de su última señal (`riesgoMs`).
- Una crisis queda activa 48 h desde la ÚLTIMA SEÑAL: cada mensaje posterior recibe el texto de la crisis con su botón (ver «PR-2»).
- `config-del-negocio.js` (hueco copiado) todavía lee `direccion` y `direccionMaps`; no se usan.
- Los ángulos de anuncio llegan solo como dato de Campañas (por `titular_principal`); en el código `RR_ANGULOS` está vacío. Un video o Reel por texto («vi el video…») no tiene anuncio en Campañas (no hay titular que leer): lo atiende el modelo con la pauta del prompt.
