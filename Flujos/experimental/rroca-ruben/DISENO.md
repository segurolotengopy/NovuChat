# «Noches Sin Insomnio» de Rubén (tenant `rroca-ruben`): diseño y avance

Fuentes (04/11/2026): especificación consolidada y plan único confirmado por Andres (lista de 15 funcionalidades), MD de Rubén (`CLIENTES/RUBEN_ROCA/Ruben/`), el flujo de Antonio (la forma: 64 nodos, tope 64) y el flujo vivo anterior de Rubén («Libro IA para Emprendedores», 63 nodos), del que se descartó casi todo: 4 productos, 5 prellenados, 5 anuncios, el prompt, la ubicación y la dirección.

## Estado por PR

- **PR-1 (este):** esqueleto de la forma de Antonio (puerta del turno, entrada verificada del receptor, medios, guardado de medios, miniCRM), catálogo de 4 productos y el paso del Libro al Pack, 4 prellenados, botones, cobro REAL por QR de monto abierto, comprobante con cotejo en el servidor, avisos, derivación de lista cerrada, crisis, número no boliviano y un prompt mínimo. Datos con marcadores `REEMPLAZAR_*`.
- **PR-2:** prompt completo, ángulos de anuncio (los de la guía B del MD), objeciones y respuestas de salud largas, y la suite con los 4 casos del PDF de ejemplos.
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

## Para el PR-2 (casos del PDF que NO se resuelven aquí)

- **Caso (a):** una captura de anuncio como PRIMER mensaje recibe el saludo genérico, no la apertura de su ángulo (`decidir-turno.js`, rama del anuncio sin saludar). El PR-2 debe abrir con el ángulo del anuncio.
- **Caso (b):** «vi el video, ¿precio y devolución?» deriva por garantía (`rrDerivacion`) sin dar el precio ni avisar `no_supo`. El PR-2 debe dar el precio por código Y derivar la devolución en el mismo mensaje.

- **Levantar la crisis:** hoy `ficha.riesgo` solo se apaga a las 48 h; el PR-2 debe darle a Rubén una forma de levantarla (cuando la atiende él) y afinar la continuación. Las variantes pendientes y los falsos positivos conocidos están en `crisis-listas.test.ts` (`PENDIENTES_PR2_*`).

## La red de crisis: dos capas y sus límites

1. **Código** (`rrEsCrisis` en `rr.js`): red amplia de frases y raíces sobre texto, voz, texto de una captura y pie de foto; con tipeos plegados; las exclusiones son SOLO listas cerradas de objetos cotidianos y de venta. Ante la duda, crisis.
2. **Marca RIESGO del modelo**: cuando el modelo juzga que hay una crisis que el código no vio, contesta solo esa palabra y el código arma el mismo texto.
Límites: una frase nueva que ninguna capa reconozca no dispara (el modelo es la segunda red, no una garantía); una crisis queda activa 48 h en la ficha. **Las listas de referencia** viven en `admin/pruebas/tenants/rroca-ruben/crisis-listas.test.ts` (frases de crisis y control de falsos positivos); las variantes nuevas se agregan ahí, no se parchan una por una.
**Ninguna publicación sin el PR-2 aprobado y el ensayo en el Demo A pasando esas listas.**

## Dónde vive la salud

La barrera final es `rrSeguro` (código): nunca «sin pastillas», «curar», «desde la primera noche», «garantizado» ni «simulado»; además el filtro de redacción del modelo (`rrExtraRedaccion`) y la derivación médica por código (`rrDerivacion`, clave `medica`: una acción sobre la medicación —dejar, suspender, mezclar, dosis, receta— o `sobredosis`). El prompt solo lo repite.

## Límites conocidos de este PR

- La ficha vence a las 48 h: el paso al Pack («una sola vez») y la crisis viven en esa ficha.
- Una crisis queda activa 48 h: cada mensaje posterior recibe el texto de la crisis con su botón; el PR-2 afina la continuación.
- `config-del-negocio.js` (hueco copiado) todavía lee `direccion` y `direccionMaps`; no se usan.
- Los ángulos de anuncio llegan solo como dato de Campañas (por `titular_principal`); en el código `RR_ANGULOS` está vacío.
