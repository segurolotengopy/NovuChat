# «Noches Sin Insomnio» de Rubén (tenant `rroca-ruben`): diseño y avance

Fuentes (04/11/2026): especificación consolidada y plan único confirmado por Andres (lista de 15 funcionalidades), MD de Rubén (`CLIENTES/RUBEN_ROCA/Ruben/`), el flujo de Antonio (la forma: 64 nodos, tope 64) y el flujo vivo anterior de Rubén («Libro IA para Emprendedores», 63 nodos), del que se descartó casi todo: 4 productos, 5 prellenados, 5 anuncios, el prompt, la ubicación y la dirección.

## Estado por PR

- **PR-1 (este):** esqueleto de la forma de Antonio (puerta del turno, entrada verificada del receptor, medios, guardado de medios, miniCRM), catálogo de 4 productos y el paso del Libro al Pack, 4 prellenados, botones, cobro REAL por QR de monto abierto, comprobante con cotejo en el servidor, avisos, derivación de lista cerrada, crisis, número no boliviano y un prompt mínimo. Datos con marcadores `REEMPLAZAR_*`.
- **PR-2 (hecho):** prompt completo, ángulos de anuncio (dato de Campañas), objeciones y reglas de salud, la crisis que se levanta a las 48 h de la última señal y la suite `conversacion.test.ts` con los 4 casos del PDF.
- **Después:** seco contra el vivo, ensayo en el Demo A y publicación solo con el botón de Andres. Este flujo NO se publica con marcadores ni con plantillas sin aprobar (`construir.mjs --publicable --anuncios <N>`).

## Decisiones (04/11/2026)

1. El **código decide** (plan, precio, botones, QR, avisos, derivación) y el **modelo solo redacta** 2 a 4 oraciones con una pregunta, filtradas por `cmRevisarRedaccion`. La PARTE 3 del MD (un agente libre que emite etiquetas `[ENVIAR_QR]`) NO se adopta: el prompt no es una barrera.
2. El aviso a Rubén **nunca** dice «pago validado» o «acreditado»: «llegó el comprobante y los datos coinciden; verifique su banco». Se reutilizan las dos plantillas ya aprobadas en Meta (decisión de Andres, 05/11/2026): `aviso_comprobante_recibido` y `aviso_consulta_para_ruben`.
3. **Paso del Libro al Pack: solo Libro → Pack**, +35 (la diferencia del catálogo), una vez, por código, dentro del mensaje del comprobante. El Audiolibro y las Meditaciones no suben al Pack (sin fuente); antes de cobrar se ofrece «Mejor el Pack» en el segundo nivel.
4. **Los precios y las etiquetas viven en el catálogo de la Consola**; los botones llevan el nombre del catálogo y el precio (≤ 20 caracteres).
5. **Cuenta bancaria y nombre del titular NO entran al repositorio:** el cotejo del comprobante usa los datos del tenant en la Consola.
6. **Salud:** ni «sin pastillas» ni «curar» ni consejo médico; el filtro del modelo lo rechaza y la derivación médica es por código. **Crisis:** texto nuevo (no el de violencia de Antonio), botón y aviso.
7. **Sin ubicación ni dirección**, sin menú de bonos, sin protección por violencia, sin nada de «IA para emprendedores».
8. **Entrega:** la hace Rubén él mismo, a mano, por este chat; el bot no envía enlaces ni promete envío automático ni un plazo exacto: los textos dicen «el material» que Rubén envía por este chat.
9. **Rescate de 22 h:** módulo del servidor, no del flujo; este solo cumple su contrato (`no_contactar`), probado en `rescate-contrato.test.ts`.

## Precondiciones de operación (checklist para quien opere; nada de esto lo hace el flujo)

- [ ] `fijar-flujos --tenant rroca-ruben --flujos venta`: el tenant con el flujo `venta` (precondición del rescate, punto 5 del contrato).
- [x] Plantillas de aviso: se REUTILIZAN las dos ya APROBADAS en Meta (`aviso_comprobante_recibido`, 4 variables; `aviso_consulta_para_ruben`, 3 variables; idioma `es`, `APPROVED`), ya en los datos. Nada que pedir a Meta.
- [ ] QR: el MISMO de antes, con los mismos datos (no se pide uno nuevo). El `mediaIdQr` y el titular viven en la Consola, no en el repo. **El media id de WhatsApp del QR vence hacia el 18/11/2026: hay que re-subirlo antes (pendiente operativo, no de código).** Falta cargar la sección de cobro real del tenant.
- [ ] Teléfono de avisos de Rubén: el MISMO de antes (el dato no cambia); la persona de prueba va por el entorno, nunca en el repo.
- [ ] Catálogo de 4 productos cargado en la Consola (`negocio-rroca-ruben.json`) y los anuncios (`campanas-rroca-ruben.json`) en el módulo Campañas.
- [ ] Planilla del miniCRM: hoja NUEVA; el id (`planillaProspectosId`, hoy marcador) lo carga Principal en el entorno, no en el repo; verificar los títulos de la fila 3 contra la copia viva.
- [x] La garantía SALE de la lista de faltantes: no hay garantía (ver «PR-3»). Horario: 24/7, sin cambios.
- **Siguen impidiendo publicar** (`construir.mjs --publicable`): ruta, URL del verificador y waba del receptor, `phoneNumberIdEsperado`, `numeroRecepcion`, `telefonosDePrueba`, ruta de prueba y `planillaProspectosId`. No se publica ni se ensaya hasta la prueba conjunta Andres + Rubén.
- [ ] Falla abierta de la pausa: es la de `chat-novuchat` con la puerta idéntica (si la ingesta y la consola caen en el mismo turno, la puerta devuelve «normal»); a decidir con Cartera antes de publicar.

## PR-2 (05/11/2026): la conversación

**Qué trae.** El prompt completo del modelo (`RR_PROMPT`: base de conocimiento, objeciones, reglas de salud, transparencia; **4.626 caracteres, tope 4.670 = el de Antonio**; el de Antonio usa ≈ 3.6k, el de Rubén lleva más porque trae los 14 eslabones y las objeciones, y no repite ninguna cifra de precio), los casos del PDF resueltos **por código**, las 17 variantes de crisis y de falsos positivos que quedaron pendientes en el PR-1, la forma de levantar la crisis y la suite `conversacion.test.ts`. Mensajes por conversación al cliente: **0 agregados** (todo va dentro del mensaje que ya sale; la prueba lo niega turno a turno).

**Casos del PDF.**
- **(a)** Una captura de anuncio SIN texto, como primer mensaje y con un anuncio reconocido por su titular (dato de Campañas, `titular_principal`) y con ángulo, ya NO recibe el saludo genérico: sale la presentación (una vez) y la apertura que redacta el modelo con el ángulo como dato (plan `angulo`); si el modelo falla o el texto se rechaza, cae al saludo fijo. Sin ángulo (dato vacío), saludo fijo. No se agregó lógica de anuncios: es el mecanismo `titular_principal` que ya existía.
- **(b)** «¿Precio y devolución?»: el precio sale por código (el del catálogo, el de UN producto si lo nombra, la lista si no) DELANTE de la derivación, en el mismo mensaje, con presentación si es el primero, el botón de Rubén y el aviso. **Clave del aviso: `devolucion`** (antes `garantia`; el motivo exacto), no `no_supo`: `no_supo` es la clave de «el modelo no supo», con texto variable y sin el motivo; el PDF pide un aviso a Rubén, que sale con su motivo. Solo con garantía, otro medio de pago, reclamo o volumen; la crisis y la pregunta médica nunca traen precio.
- **(c) y (d)** «¿Me garantizan dormir?» no garantiza y recuerda el plan de 21 días; si la misma frase pregunta el precio o la duración de los audios, el código junta las respuestas en UN mensaje. Dos preguntas que el código no reconoce las contesta el modelo (el prompt se lo pide) y su respuesta con más de una «?» cae al texto fijo.
- **Objeciones por código:** «lo voy a pensar» (sin presión, con los dos precios del catálogo, sin pregunta ni botones; solo con las opciones habilitadas: antes lo contesta el modelo, sin montos) y la muestra de voz (solo si la piden: 50 segundos de «Cierra el día»; ver PR-3: la dirección de la landing es ya un dato; texto anterior: «la página del libro, sección Escucha un fragmento»).

**Levantar la crisis (decisión).** La ficha guarda `riesgoMs` = cuándo fue la **última señal** de crisis (el texto de ese turno, o la marca RIESGO del modelo). La protección vence a las 48 h de esa señal, **no** del último mensaje: escribir «gracias» o «el libro» ya no la renueva; escribir otra señal reinicia el plazo. Dentro de las 48 h la crisis sigue cortando la venta (sin libro, precio ni QR aunque pida comprar) y cada respuesta reporta `no_contactar`. Una ficha vieja sin `riesgoMs` usa su último mensaje (comportamiento anterior). Se prefirió esto a un camino de Rubén porque el único camino que ya existe (pausar la conversación desde la Consola) no distingue «Rubén atendió la crisis» de «uso extendido»: levantarla ahí sería adivinar. **Decisión pendiente de Andres:** si quiere además que Rubén pueda levantarla antes de las 48 h, hace falta un dato nuevo en la Consola (no existe hoy). El texto de la continuación es el mismo (no se afinó: una frase distinta para «gracias» sería una decisión de redacción de Silvana).

**Renovación dentro del plazo (revisión del PR-2).** Con la protección activa no se llama al modelo, así que su marca RIESGO no podría renovar nada. Por eso, DENTRO de las 48 h, todo turno de texto (o voz) renueva `riesgoMs` salvo una lista cerrada (`rrEsNeutro`: acuses cortos como «gracias», «ok», «listo»; y mensajes de venta de hasta 8 palabras: el libro, precio, cuánto cuesta, comprar…): quien sigue mal con palabras que ninguna lista reconoce («sigo igual de mal») no queda sin protección a las 48 h de la primera señal. Un `riesgoMs` en el futuro (reloj adelantado) se recorta a «ahora». El PIE DE FOTO de un comprobante que habla de una crisis recibe la protección (antes seguía el cobro normal); un pie sin crisis no corta el cotejo.

**Decisiones de Andres (05/11/2026), resueltas en el PR-3:** (1) la vigencia se MANTIENE en 48 h desde la última señal; (2) la protección la levanta Rubén con una acción suya, nunca el cliente (ver «PR-3»).

**Variantes de crisis.** Las listas de `crisis-listas.test.ts` pasaron de 17 pendientes a casos reales (10 variantes de crisis y 7 falsos positivos; el principio no cambia: ante la duda, crisis; las exclusiones son solo listas cerradas de objetos cotidianos y las listas de referencia solo se amplían). Límite: una frase que ninguna capa reconozca sigue sin disparar; el modelo es la segunda red.

## PR-3 (05/11/2026): sin garantía, plantillas reutilizadas, landing y crisis que levanta Rubén

**No hay garantía (decisión comercial de Andres).** Salen el dato `garantiaTexto` y `rrTextoGarantia`; la clave de la derivación pasa de `garantia` a `devolucion` (aviso a Rubén con el motivo «devolución, garantía o reembolso»). La pregunta por devolución, garantía o reembolso se responde con un texto fijo en código (`RR_TEXTO_DEVOLUCION`), con botón «Hablar con Rubén» y aviso: «Es un producto digital de pago único y no tiene garantía de devolución. Si tienes un problema con tu pago o con tu material, Rubén te atiende directamente.» Sin enlaces, montos ni promesas. El caso (b) sigue dando el precio por código en el mismo mensaje; el caso (c) «¿me garantizan dormir?» sigue sin garantizar resultados y recordando el plan de 21 días (no es la garantía comercial). El prompt dice «Sin garantía de devolución: no la ofrezcas» (≤ 4.670 caracteres).
**PARA SILVANA: revisar la redacción exacta del texto «NO hay garantía»** (es una decisión comercial y el texto sale de `RR_TEXTO_DEVOLUCION` en `src/lib/rr.js`).

**Entrega.** Verificado: ningún texto promete envío automático, enlaces ni plazo; dicen que Rubén envía el material por este chat.

**Plantillas.** Se reutilizan las dos ya aprobadas (nombres y estado `APPROVED` en «Config base»; ninguna id ni token). `--publicable` ya no las nombra; los demás marcadores siguen impidiendo publicar (`publicacion.test.ts` lo niega por nombre).

**Landing.** `landingDominio` en «Config base» (dato; solo el dominio, validado). El flujo solo la usa en la muestra de voz y SOLO si la persona la pide: «La muestra de unos 50 segundos de “Cierra el día” está en su página: <dirección>». Sin el dato, el texto no inventa dirección.

**Meditaciones.** El botón se llama «3 Meditaciones 20Bs» (19 caracteres, sin emoticón). El nombre sale del catálogo y el id sale del nombre: el producto pasó a `3-meditaciones` (dato, `catId`, guardia de publicación, pruebas). **Al cargar el catálogo en la Consola se crea el ítem nuevo; el viejo `meditaciones`, si existe, queda por retirar.**

**Crisis sin teléfonos.** Ningún texto, prompt o prueba nombra números ni líneas de ayuda: la derivación es el aviso a Rubén + botón «Hablar con Rubén» + recomendar un profesional. Prueba negada en `crisis-listas.test.ts`.

**Quién levanta la crisis: Rubén, con una acción suya.** Señal usada: `pausadoPorPersona: true`, que el servidor agrega a la respuesta de la ingesta SOLO cuando una persona tomó la conversación desde la consola (no la trae el tope de uso extendido —estado `operador` o `bloqueado` por respuestas— ni el bloqueo de un contacto, que trae `bloqueadoPorContacto`). Sin tocar Core, Consola ni la «Puerta del turno» (módulo común, byte a byte): `rrTurnoDeAtencion` la combina con la salida de la puerta. Mecanismo: con la protección activa, el turno pausado anota `ficha.pausaPersonaMs`; si esa pausa es POSTERIOR a la última señal (`riesgoMs`) y un turno posterior es de atención normal (ruta «sigue», sin pausa), `rrFichaVigente` limpia `riesgo`, `riesgoMs` y `pausaPersonaMs`. Un texto del cliente («ya estoy bien», «gracias») no levanta; el uso extendido no levanta; el bloqueo de un contacto no levanta; sin pausa vence sola a las 48 h de la última señal; una crisis nueva tras levantar vuelve a proteger. Pruebas en `conversacion.test.ts`.
**Límites declarados.** (1) Solo se ve la pausa si el cliente escribe mientras Rubén tiene la conversación (el flujo solo corre con un mensaje entrante); si Rubén toma y devuelve sin que el cliente escriba, no se ve y la protección vence a las 48 h. (2) La pausa por persona también termina sola a los 30 minutos del turno: eso cuenta como «devuelta», porque Rubén la había tomado (una acción suya). (3) Una señal de crisis escrita durante la pausa no levanta (su fecha no es anterior a la pausa) hasta una pausa posterior. (4) El diseño es seguro por defecto: ante la duda, la protección sigue.

**Propuesta para el Arte 4 (portada), que es de Rubén (el repo no lo contiene).** Reemplazar «sin depender de pastillas» por «Un método paso a paso para ordenar tus noches y tu descanso»: sin promesa médica ni mención de pastillas o medicación. El bono NO aparece en el fondo del Arte 4 (sigue siendo regalo con el libro; el producto no cambia). El ángulo de campaña del Arte 4 (`campanas-rroca-ruben.json`) no menciona el bono ni las pastillas: no hubo nada que quitar.

**Pendiente operativo.** El media id de WhatsApp del QR vence hacia el 18/11/2026: re-subirlo antes (no es código). La línea mantiene su nombre.

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
