# Estándar del asistente de venta NovuChat (versión 1.1, 27/11/2026)

Reemplaza a la versión 1 (`NOVUCHAT_estandar-del-asistente-de-venta_2026-11-27.md`). La versión 1.1 la corrigió la revisora independiente por orden de Andres, después de validarla. Los cambios están detallados al final.

**Qué es.** Es la lista escrita de reglas para todo comercio con asistente de venta: Casa Bermejo, Walisuma, Q'Taco, Demo B y el chat de NovuChat en lo que aplique, y todo comercio nuevo desde su alta.

**Complementa lo que ya existe; no lo reemplaza** (Andres, 27/11). Lo que ya existe:
- CLAUDE.md;
- la memoria del proyecto;
- la bitácora de reclamos;
- la auditoría de prácticas comunes (`BERMEJO_auditoria-practicas-comunes_2026-11-27.md` y sus partes A y B);
- la batería de 39 casos (`BERMEJO_bateria-ataque-catalogo_2026-11-27.md`);
- los criterios de revisión de Bermejo (`BERMEJO_criterios-revision-1098_2026-11-26.md`).

Cada revisión aplica todo junto. Si este documento contradice u omite algo de esas fuentes, rige lo previo hasta que Andres decida con botón.

Lo marcado **[práctica]** existía como costumbre de otros clientes y aquí pasa a norma. Andres lo corrige si algo no es así.

## Cómo se usa
1. **Matriz.** La matriz de verificación de cada comercio incluye todos los puntos de este documento y los de las fuentes previas. Un punto que no aplica se declara «no aplica» con su porqué; no se omite.
2. **Pruebas.**
   - Cada punto tiene una prueba que falla si se incumple.
   - Las reglas comunes se prueban como invariante global sobre todos los flujos de producción, con modelo simulado y la conversación completa, no con un regex sobre el prompt.
   - Un punto sin prueba así es una observación en la revisión.
3. **Publicación.** Ningún flujo de venta se publica ni se avisa «puede probar» sin la matriz completa y la corrida interna del recorrido entero.
4. **Guion de frases.** Lo define Silvana por cliente y se corre completo antes de cada publicación.
5. **El prompt no es una barrera.** Cada regla se hace cumplir en código. Lo general vive en core o en un módulo común, se escribe y se revisa una vez, y nunca se copia por comercio.

## 1. Catálogo
- **1.1 Nunca negar el catálogo.** A «¿qué tienen?», «qué venden», «catálogo», «carta», «productos», «todo» o «lista», el asistente responde por código con el catálogo: botón, lista o ambos. Nunca «No encuentro eso en nuestro catálogo» ni un equivalente cuando el comercio tiene catálogo. (Andres, 27/11: «sin catálogo… NO ME SIRVE»; 23/11: el catálogo existe para generar pedidos.)
- **1.2 Botón «Ver catálogo» siempre que el cliente lo pida.** Sale en el saludo, cada vez que el cliente pide el catálogo y cuando no se encuentra lo que nombra, **también con un pedido o un QR en curso**. Va en el mismo mensaje: 0 mensajes agregados. El enlace es un dato del comercio. (Andres, 27/11, con botón; bitácora del 27/11: «por código, también en el saludo».)
- **1.3 El catálogo es simple, no el sitio completo:** solo productos, descripciones, precios y categorías para elegir, sin portada ni textos de sitio. (Andres, 24/11: «no interesa en ese catálogo que existan textos títulos, etc. Solo productos, descripciones y precios, con categorías para elegir».)
- **1.4 Catálogo conectado a WhatsApp de punta a punta.** El recorrido real del cliente se prueba con un pedido real antes de decir «listo»: catálogo → carrito → «Comprar» → chat → resumen → QR. El catálogo devuelve el pedido al chat para pagar ahí. Para un comercio de NovuTienda, el recorrido es el carrito de NovuTienda. (Andres, 23/11 y 27/11; derogación de la «D7» de Bermejo, 27/11.)
- **1.5 El carrito llega entero:** piezas, cantidades y precios vivos del catálogo, **y la nota del cliente**, llegan al resumen y al pedido en TODOS los comercios con catálogo. (Andres, 27/11, con botón; antecedente: la nota del carrito de Walisuma, 19/11, #1017.) Si el catálogo no envía la nota, se le pide que la envíe. Hoy NovuTienda no la envía.
- **1.6 El precio sale solo del catálogo**, leído vivo en cada turno, nunca del modelo. El asistente no afirma «precios actualizados» ni «verifiqué los precios». (R59, 25/11.)
- **1.7 Buscar como habla la gente:** plurales en «s» y en «es», sin tildes, abreviaturas y sinónimos usuales («tele»). **[práctica]**

## 2. Listados
- **2.1 Nunca un listado plano.** Todo listado va con viñetas, un producto por línea con su precio, y con lista interactiva o botones cuando WhatsApp lo permite. (Andres, 27/11: «con Botones, con bullets, NO un listado plano… era una práctica común».)
- **2.2 Listas completas o con remisión expresa.** Si el cliente pide una categoría, salen todos los productos a la venta. Si no caben en un mensaje, se dice cuántos faltan y se ofrece «Ver más» o el catálogo. Nunca se recorta en silencio.
  - El tope lo fija WhatsApp: 4096 caracteres para un texto y 1024 para el cuerpo de un mensaje interactivo. El código común corta el texto en 4000.
  - (No confundir con los 40 ítems de `docs/base-comercial.md:230`: ese tope decide qué catálogo va al prompt del modelo, no cuántos productos ve el cliente.)
- **2.3 Lista interactiva de categorías y de productos**, de hasta 10 filas. Si hay más, 9 ítems y «Ver más». El toque de una fila se resuelve por código y nunca va al modelo; un toque viejo recibe una respuesta clara.
  - **Estado:** la pieza común `cmLista` (`Flujos/src/core/sin-agente/mensajes.js:42-47`) solo arma la lista de 10 filas. El «Ver más», la paginación y la resolución del toque por código **no existen todavía**: hay que construirlos como pieza común.
- **2.4 Varias categorías pedidas a la vez:** se responden todas, completas, o se remite al catálogo.
- **2.5 Agrupar por área o categoría** cuando la lista cruza varias. **[práctica]**

## 3. Redacción y formato
- **3.1 Párrafos separados** por una línea en blanco, una idea por párrafo, en TODOS los chats; nunca un bloque corrido. Es un mismo mensaje: 0 mensajes agregados. (Andres, 20/10.)
- **3.2 El filtro de redacción no destruye saltos de línea ni viñetas**, y no cuenta cada línea de una lista como una oración. Hoy es un defecto del core: `filtro-redaccion.js:415-422` une con `join(' ')` y afecta a todos los comercios.
- **3.3 Trato coherente** en todos los textos fijos del comercio: no mezclar tú y usted. El registro lo fija el guion del cliente. **[práctica]**
- **3.4 Límites de WhatsApp respetados por código:**
  - texto: 4096 caracteres;
  - cuerpo de un mensaje interactivo: 1024;
  - título de botón: 20, con un máximo de 3 botones;
  - título de fila: 24, descripción: 72, con un máximo de 10 filas.
- **3.5 En restaurantes no se usa «Menú»** para el inicio: se usa «Volver a inicio», y «carta» son los platos. (Andres, 06/11.)

## 4. Saludo e identidad
- **4.1 Se presenta como «asistente virtual con IA»** y nunca niega ser una IA. (CLAUDE.md, prohibición 4; Andres, 12/11.)
- **4.2 El saludo trae opciones:** dice qué puede hacer y ofrece botones o una lista (catálogo, categorías, pedir). **[práctica]** (Andres, 24/11: «ninguna de las respuestas tiene botones».)
- **4.3 Botones con criterio:** un botón ya pulsado no reaparece, no se ofrece antes de tiempo y el texto coincide con los botones. (Andres, 10 y 11/10.)

## 5. Pedido y cobro
- **5.1 Resumen con botón «Confirmar pedido»** cuando el pedido y la entrega están completos.
- **5.2 El QR sale con el pedido confirmado**, en el mismo turno en que el cliente toca «Confirmar pedido». (Andres, 23/11.)
- **5.3 Nunca se le pide al cliente que escriba «pagar».** Con el pedido completo, el texto «confirmo» o «pagar» también emite el QR; «¿confirmo?» como pregunta, no. (Andres, 23/11, 24/11 y 26/11.)
- **5.4 Sin QR directo después de un dato de texto libre** (nombre, ciudad, aclaración, documento): sale el resumen con «Confirmar pedido». El costo aceptado es +1 mensaje por pedido. (Andres, 26/11, con botón, R14.)
- **5.5 En los pasos de datos de la entrega, en el nombre del retiro y en el resumen, el mensaje lo escribe SOLO el código.** El texto del modelo no sale en esos turnos. (Andres, 26/11, con botón.)
- **5.6 Nunca «pago acreditado», «verificado» ni «recibimos tu pago».** El cobro simulado va rotulado en la imagen y en el texto; el real y el simulado son excluyentes. (CLAUDE.md, prohibición 3.)
- **5.7 El comprobante nombra TODAS las diferencias**, el destinatario primero. (Andres, 07/11.)
- **5.8 Un QR reemplazado siempre se advierte:** si el pedido cambia con un QR ya enviado, se dice que el anterior quedó anulado, en el mismo mensaje del QR nuevo, con 0 mensajes agregados. (Andres, 27/11, con botón.)
- **5.9 Lo que el asistente dice coincide con lo que el código hizo:** no sale «agregué» si no se agregó. (Candado por hecho, no por dicho.)

## 6. Derivación y funciones de conversación
- **6.1 Solo se ofrece lo que se cumple.** Ante un error o algo que no sabe, pasa con recepción, con aviso y botón. Después de derivar no se cuela una oferta de venta. (Andres, 21/09.)
- **6.2 Juego completo de funciones de conversación encendido desde el alta:** texto, consola, «Tomar», adjuntos, medios entrantes, guardado de medios, aviso con botón, baja y uso extendido. Una que falta es un defecto que bloquea. (Andres, 15 y 21/11.)
- **6.3 Baja por texto** (Andres, 12/11) **y por voz** (después, para todos los comercios con agente).
- **6.4 Fotos siempre enteras**, nunca recortadas. (Andres, 22/11.)

## 7. Método
- **7.1 Prueba interna del recorrido completo antes de pedirle nada a Andres**, diciendo qué no cubre: el modelo real, WhatsApp real y la API real. (Andres, 27/11.)
- **7.2 «Listo» con evidencia propia.** Hay revisión independiente punto por punto contra este documento y las fuentes previas; un CI en verde no es conformidad. (Andres, 18 y 24/11.)
- **7.3 Una regla de experiencia se prueba como invariante global**, no por casos sueltos. (Andres, 11/10.)
- **7.4 Cada cambio declara cuántos mensajes agrega o quita.** Este documento se cumple con 0 mensajes agregados, salvo las decisiones de Andres que lo digan (5.4).

## Estado al 27/11/2026
- **Sin prueba global hoy:** 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1 (solo se prueba la pieza), 3.2 y 4.2.
  - Lo que existe: `ux-baja`, `ux-identidad`, `ux-derivacion`, `niega-ia` y `nucleo-comun`.
  - Las invariantes globales 4 y 5 de declinación y oferta al equipo viven en `admin/pruebas/chat-novuchat-bateria.test.ts:181` y `:188`. Hay que subirlas a `admin/pruebas/core/`.
  - El `vigilante-ux.ts` NO es común: hay una copia por tenant (doctoras y rroca-*, estos dados de baja). También hay que subirlo a `admin/pruebas/core/`.
  - Falta `admin/pruebas/core/ux-catalogo.test.ts`.
- **Piezas comunes por crear o subir:**
  - el reconocedor de «qué tienen» o «catálogo» (hoy hay copias en Q'Taco y Walisuma);
  - la lista o el texto del catálogo en viñetas por área;
  - el botón «Ver catálogo» (hoy hay copias idénticas en Bermejo y Walisuma);
  - la paginación «Ver más» con el toque resuelto por código;
  - el arreglo de `filtro-redaccion.js`.
- **Decisiones tomadas el 27/11:**
  - la «D7» de Bermejo, derogada: el catálogo devuelve el pedido al chat para pagar;
  - 1.2: el botón sale siempre;
  - 1.5: la nota llega en todos los comercios;
  - 5.8: el QR anulado siempre se avisa.
- **Pendientes:**
  - pedirle a NovuTienda que envíe la nota del carrito (1.5);
  - versionar este documento en `docs/`, en la zona del método.

## Cambios respecto de la versión 1
- Se declara que el documento **complementa** las fuentes previas, en lugar de ser la «fuente única de matrices y pruebas».
- **1.2:** se quita «mientras no haya pedido ni QR en curso» (decisión de Andres: siempre).
- **Nuevo 1.3:** catálogo simple (24/11). La 1.3 vieja pasa a 1.4, con la derogación de la D7.
- **1.5:** la nota del carrito pasa a ser norma por decisión de Andres; se agrega que NovuTienda hoy no la envía.
- **1.6:** se agrega R59 (precio vivo, sin afirmar «precios actualizados»).
- **2.2:** se corrige la cita de los 40 ítems y se fijan los topes reales.
- **2.3:** se aclara que el «Ver más» y el toque por código no existen en `cmLista`.
- **3.4:** se corrigen los límites: texto 4096, interactivo 1024.
- **Nuevos 5.3, 5.4 y 5.5:** no pedir «pagar», «confirmo» y R14; sin QR directo tras un texto libre; solo el código escribe en los pasos de entrega.
- **5.8:** el aviso de QR anulado, con la decisión de Andres.
- **6.3:** se corrige la fecha de la baja por voz.
- **«Estado»:** la D7 pasa a resuelta y se corrige la cita de `vigilante-ux.ts`.
