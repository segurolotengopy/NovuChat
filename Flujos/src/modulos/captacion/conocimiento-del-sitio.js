// BASE DE CONOCIMIENTO: el corpus del asistente de novuchat.site.
//
// ES UNA MULETA CON ALARMA, no la fuente de verdad. La fuente es el indice RAG
// del sitio (`Novuchat-site/functions/src/rag/indice.json`, que se regenera con
// `pnpm rag:indexar` desde el contenido publicado). Mientras el sitio no exponga
// una Function `conocimiento` que n8n pueda consultar -- la de su asistente
// exige App Check y CORS de navegador --, el corpus se copia aca con su HUELLA,
// y `admin/pruebas/onboarding-flujo.test.ts` falla si la huella deja de
// coincidir con la del sitio. Pedido a la sesion del sitio en
// `CLIENTES/NOVUCHAT/02-pedido-sesion-sitio.md`.
//
// POR QUE EL CORPUS ENTERO Y NO RECUPERACION POR SIMILITUD: son unos 16 mil
// caracteres, menos que medio mensaje de Meta en costo, y con el corpus entero
// el agente no puede «no encontrar» el fragmento correcto. Va en las
// instrucciones, que no cambian entre turnos, asi que el proveedor lo cachea.
//
// Para actualizarlo: regenerar el indice en el sitio y volver a copiar
// FRAGMENTOS -- SIN el campo `vector`, que son unos 809 KB y este nodo no usa:
// solo lee `id`, `titulo`, `url` y `texto` -- y HUELLA (la del indice del sitio,
// tal cual) (Flujos/LEEME-flujos.md, seccion del flujo de captacion).
const HUELLA = "b0b58ba17884db3df3ce9706e61375eb2a641b2573e0b60f588f467d6d81b504";
const GENERADO = "2026-09-16T01:53:52.079Z";
const FRAGMENTOS = [
 {
  "id": "que-es",
  "titulo": "Qué es NovuChat",
  "url": "/",
  "texto": "NovuChat es un asistente para WhatsApp con inteligencia artificial, para negocios de Bolivia. NovuChat atiende a tus clientes por WhatsApp las 24 horas: responde, agenda citas en tu calendario, toma pedidos y cobra por QR. Lo instalamos en 48 horas y tú lo controlas desde tu celular. Se resume así: El primer empleado de tu negocio que nunca duerme."
 },
 {
  "id": "capacidad-atiende-las-24-horas",
  "titulo": "Atiende las 24 horas",
  "url": "/",
  "texto": "Atiende las 24 horas. Entiende lo que el cliente escribe, aunque escriba con errores o cambie de opinión a mitad del pedido."
 },
 {
  "id": "capacidad-agenda-en-tu-calendario-real",
  "titulo": "Agenda en tu calendario real",
  "url": "/",
  "texto": "Agenda en tu calendario real. Consulta tu Google Calendar, ofrece los horarios que de verdad están libres y crea la cita. Nunca confirma un turno que no existe."
 },
 {
  "id": "capacidad-toma-pedidos-y-cobra-por",
  "titulo": "Toma pedidos y cobra por QR",
  "url": "/",
  "texto": "Toma pedidos y cobra por QR. Pedido desde tu catálogo, total con el envío ya calculado y el QR de tu banco. El cliente manda el comprobante y tú lo validas."
 },
 {
  "id": "capacidad-recuerda-las-citas",
  "titulo": "Recuerda las citas",
  "url": "/",
  "texto": "Recuerda las citas. Manda el recordatorio 24 horas antes por una plantilla aprobada de WhatsApp. Las ausencias bajan solas."
 },
 {
  "id": "capacidad-deriva-a-una-persona",
  "titulo": "Deriva a una persona",
  "url": "/",
  "texto": "Deriva a una persona. Cuando no está seguro, o cuando el cliente lo pide, pasa la conversación a tu equipo. No improvisa."
 },
 {
  "id": "capacidad-consola-para-el-dueno",
  "titulo": "Consola para el dueño",
  "url": "/",
  "texto": "Consola para el dueño. Mira las conversaciones, cambia horarios y precios y controla todo desde el celular."
 },
 {
  "id": "problema",
  "titulo": "Qué problema resuelve",
  "url": "/",
  "texto": "El 23 % de las empresas nunca responde. Y responder dentro de la primera hora hace siete veces más probable que la conversación termine en venta. No se pierde por precio: se pierde porque nadie contestó a tiempo. Un chatbot de botones tampoco lo arregla, porque se rompe apenas el cliente escribe distinto o cambia de opinión. Ventas que se van: Tus clientes escriben fuera de horario o en plena hora pico. Sin respuesta, escriben al de al lado. Citas olvidadas: En salones y consultorios, la gente olvida su turno y ese hueco ya no se recupera. Clientes que no vuelven: Nada les recuerda que existes. La primera compra fue buena y no hubo una segunda. Equipo desgastado: Tu gente pierde horas respondiendo lo mismo por décima vez en el día."
 },
 {
  "id": "ia-contra-botones",
  "titulo": "IA de verdad, no un árbol de botones",
  "url": "/",
  "texto": "Chatbot de botones: Se rompe si el cliente escribe distinto de lo previsto; Obliga a elegir de un menú, aunque nada encaje; No entiende «cámbiame a las seis» ni «cuánto sale con el envío»; El cliente termina pidiendo hablar con una persona. NovuChat: Entiende lenguaje natural y el contexto de la conversación; Si el cliente cambia el pedido, adapta la orden y recalcula el total; Consulta tu agenda y tu catálogo antes de responder; Deriva a tu equipo solo cuando de verdad hace falta."
 },
 {
  "id": "precios-resumen",
  "titulo": "Cuánto cuesta NovuChat",
  "url": "/precios",
  "texto": "¿Cuánto cuesta NovuChat? Hay tres planes mensuales, con los precios expresados en dólares: Impulso a USD 25 al mes con 100 conversaciones, Crecimiento a USD 50 al mes con 220 conversaciones, Pro a USD 90 al mes con 500 conversaciones. El más económico es Impulso, desde USD 25 al mes. Aparte se paga una única instalación de USD 65. El precio incluye el consumo de la inteligencia artificial y las conversaciones de WhatsApp. El cobro se hace en bolivianos, al Tipo de Cambio Oficial del Banco Central de Bolivia del primer día hábil de cada mes, que se mantiene durante todo ese mes."
 },
 {
  "id": "plan-impulso",
  "titulo": "Plan Impulso",
  "url": "/precios",
  "texto": "El plan Impulso cuesta USD 25 al mes, en modalidad prepago (cada mes se paga por adelantado), e incluye 100 conversaciones mensuales. Para el negocio que empieza a perder mensajes por no dar abasto. Incluye siempre: Asistente con IA que entiende lenguaje natural, 24 horas; 100 conversaciones al mes; Consola para ver todo desde el celular; Canal oficial de WhatsApp Business. Además el negocio ELIGE 1 SOLO de estos 2 caminos, no los 2: Citas — 1 agenda conectada a tu Google Calendar, con recordatorio automático 24 horas antes. O BIEN Ventas — Catálogo de hasta 20 productos, con el total y el envío ya calculados. Si un negocio necesita los dos caminos, contrata un plan para cada uno, cada uno en su propio número de WhatsApp."
 },
 {
  "id": "plan-crecimiento",
  "titulo": "Plan Crecimiento",
  "url": "/precios",
  "texto": "El plan Crecimiento cuesta USD 50 al mes, en modalidad prepago (cada mes se paga por adelantado), e incluye 220 conversaciones mensuales. Para el negocio con varias personas atendiendo y agenda llena. Incluye siempre: Asistente con IA que entiende lenguaje natural, 24 horas; 220 conversaciones al mes; Consola para ver todo desde el celular; Canal oficial de WhatsApp Business. Además el negocio ELIGE 1 SOLO de estos 2 caminos, no los 2: Citas — Hasta 5 agendas, una por persona: nadie queda con dos citas a la vez. Con recordatorio automático 24 horas antes. O BIEN Ventas — Catálogo de hasta 100 productos, con el total y el envío ya calculados. Si un negocio necesita los dos caminos, contrata un plan para cada uno, cada uno en su propio número de WhatsApp."
 },
 {
  "id": "plan-pro",
  "titulo": "Plan Pro",
  "url": "/precios",
  "texto": "El plan Pro cuesta USD 90 al mes, en modalidad prepago (cada mes se paga por adelantado), e incluye 500 conversaciones mensuales. Para varias sucursales o un volumen alto de pedidos. Incluye siempre: Asistente con IA que entiende lenguaje natural, 24 horas; 500 conversaciones al mes; Consola para ver todo desde el celular; Canal oficial de WhatsApp Business; Soporte técnico prioritario. Además el negocio ELIGE 1 SOLO de estos 2 caminos, no los 2: Citas — Hasta 10 agendas, una por persona o por sucursal. Con recordatorio automático 24 horas antes. O BIEN Ventas — Catálogo de hasta 500 productos, con el total y el envío ya calculados. Si un negocio necesita los dos caminos, contrata un plan para cada uno, cada uno en su propio número de WhatsApp."
 },
 {
  "id": "instalacion-costo",
  "titulo": "Cuánto cuesta la instalación",
  "url": "/precios",
  "texto": "La instalación es un pago único, por adelantado al inicio del servicio, y cuesta USD 65. Incluye: Configuración inicial llave en mano: recibes el asistente listo para atender; Nadie de NovuChat lee tus conversaciones sin que tú abras el acceso; Verificación oficial de tu número ante Meta; Carga de tus servicios, precios, horarios y el tono del asistente; Conexión con tu Google Calendar; Pruebas con casos reales antes de salir en vivo. Si el negocio necesita desarrollo a medida (Integración con tu ERP o tu sistema propio; Consultas a tus sistemas en tiempo real; Flujos complejos entre varios departamentos), la instalación arranca en USD 125. Es desarrollo a medida, cotizado caso por caso: no son funciones que el asistente traiga de serie. "
 },
 {
  "id": "excedentes",
  "titulo": "Qué pasa si me paso del plan",
  "url": "/precios",
  "texto": "Si se superan las conversaciones incluidas en el plan, cada bloque adicional de hasta 30 conversaciones cuesta USD 10. El bloque adicional no vence. Se avisa al llegar al 80 % del plan y no se cobra ningún excedente sin que el negocio lo apruebe. El consumo de la inteligencia artificial y las conversaciones de WhatsApp están incluidos en el precio del plan."
 },
 {
  "id": "como-se-cuenta",
  "titulo": "Cómo contamos las conversaciones",
  "url": "/precios",
  "texto": "Una conversación son hasta 25 respuestas del asistente a un mismo cliente dentro de 24 horas continuas. Si alguien te escribe a las nueve de la mañana, sigue preguntando al mediodía y cierra su pedido a las seis de la tarde, eso es una sola conversación. Si un mismo cliente necesita más de 25 respuestas en el día, el asistente sigue atendiéndolo y a partir de la respuesta 26 se cuenta una conversación nueva. Pasadas las 24 horas desde su primer mensaje, la cuenta vuelve a empezar. Lo hacemos así porque no te castiga por conversar: una conversación de tres mensajes y una de veinte cuestan lo mismo. Cobrar por mensaje te obligaría a vigilar cuánto habla el asistente, y un asistente que responde corto vende menos. Y el asistente no deja a un cliente a medias por pasar de 25 respuestas. En tu consola ves el mismo número que facturamos, y además dos datos que sirven para decidir: cuántas personas distintas atendiste y cuántos cierres se lograron. Conversación: Hasta 25 respuestas del asistente a un mismo cliente en 24 horas continuas. A partir de la respuesta 26 en el mismo día se cuenta otra; a las 24 horas la cuenta vuelve a cero. Es la unidad que se factura. Atención: Una persona distinta atendida en el período. Si el mismo cliente vuelve tres veces en el mes, son tres conversaciones y una sola atención. No se factura: es un dato para que sepas a cuánta gente distinta llegaste. Cierre: Una cita agendada o un pedido confirmado. Es lo que mide si el asistente está vendiendo, no solo respondiendo. Excedente: Si superas las conversaciones de tu plan, cada bloque adicional de hasta 30 conversaciones cuesta USD 10 y no vence. Te avisamos al llegar al 80 % de tu plan, y nunca se te cobra sin que lo apruebes."
 },
 {
  "id": "instalacion-proceso",
  "titulo": "Lo instalamos en 48 horas",
  "url": "/como-funciona",
  "texto": "Lo instalamos en 48 horas. Tú no programas nada. Nosotros hacemos la conexión con el canal oficial de Meta. Paso 1, Análisis: Una reunión de una hora: tus servicios, precios, horarios, funcionarios y el tono con el que quieres que hable. Paso 2, Desarrollo: Damos de alta tu negocio, cargamos tu configuración y conseguimos el número nuevo de tu asistente. Paso 3, Pruebas: Ensayamos los casos difíciles: agendar, rechazar, cambiar de opinión, escribir fuera de horario. Paso 4, Despliegue: Publicamos el asistente y te entregamos el acceso a tu consola."
 },
 {
  "id": "rubro-salud-belleza",
  "titulo": "Salud y Belleza",
  "url": "/soluciones/salud-belleza",
  "texto": "Para el rubro Salud y Belleza: Agenda sola, recuerda las citas y libera a tu equipo del teléfono. Cada profesional con su propia agenda, sin citas superpuestas. Agenda sin que nadie intervenga: El cliente pide turno, el asistente consulta los horarios libres de cada profesional y crea la cita en su calendario. Si ese horario está ocupado, ofrece alternativas. Recordatorio 24 horas antes: Se manda solo, por una plantilla aprobada de WhatsApp. El cliente puede confirmar o reagendar respondiendo el mismo mensaje. Precios cuando corresponde: En belleza el asistente da precios. En salud no los inventa: explica que la valoración la hace el profesional y agenda la consulta. El plan recomendado para este rubro es crecimiento."
 },
 {
  "id": "rubro-gastronomia",
  "titulo": "Gastronomía",
  "url": "/soluciones/gastronomia",
  "texto": "Para el rubro Gastronomía: Toma el pedido desde tu carta, calcula el total con el envío, manda el QR y avisa a la cocina. El pedido, con su total: El asistente arma el pedido desde tu carta con los precios que cargaste, suma el envío y confirma el total con el cliente antes de pasarlo a la cocina. El envío, ya sumado: El cliente dice a dónde va y el total sale con el costo de envío incluido. Sin idas y vueltas ni «te confirmo el precio». Cobro por QR y comprobante: Manda el QR de tu banco y recibe el comprobante; quien confirma que entró la plata es tu banco, no el asistente. En demostraciones el QR está rotulado como simulado. El plan recomendado para este rubro es crecimiento."
 },
 {
  "id": "rubro-comercio",
  "titulo": "Comercio y Retail",
  "url": "/soluciones/comercio",
  "texto": "Para el rubro Comercio y Retail: Responde por tu catálogo a cualquier hora, toma los datos de envío y cierra la venta con el QR. Tu catálogo, con sus precios: El asistente responde con los productos y precios que cargaste, arma el pedido y calcula el total con el envío. No inventa nada que no esté en tu catálogo. Datos de envío antes del cobro: Pide nombre y carnet para la guía de envío antes de mandar el QR, así el paquete sale el mismo día. Ventas de madrugada: La mayoría de las consultas llegan cuando la tienda está cerrada. El asistente las convierte igual. El plan recomendado para este rubro es crecimiento."
 },
 {
  "id": "compromiso",
  "titulo": "Nuestro compromiso",
  "url": "/nosotros",
  "texto": "Nuestro asistente siempre dice que es una inteligencia artificial si le preguntan. Nunca se hace pasar por una persona. Los cobros de demostración se rotulan como simulados en la imagen, en el pie y en la confirmación. Usamos únicamente el canal oficial de WhatsApp Business de Meta. Nada de dispositivos vinculados ni APIs no oficiales que hagan que te bloqueen el número."
 },
 {
  "id": "contacto",
  "titulo": "Cómo contactarnos",
  "url": "/contacto",
  "texto": "Para hablar con una persona: WhatsApp +591 70661250 o correo novuchat@novuchat.site. Estamos en La Paz, Bolivia. Para una demostración conviene dejar los datos en el formulario de la página de demostración; respondemos por WhatsApp en menos de 24 horas hábiles."
 },
 {
  "id": "faq-necesito-un-numero-nuevo-de",
  "titulo": "¿Necesito un número nuevo de WhatsApp?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Necesito un número nuevo de WhatsApp? Respuesta: Sí, y lo conseguimos nosotros: un número nuevo a tu nombre, dedicado al asistente, incluido en la instalación. Tu WhatsApp de siempre sigue igual y es donde te avisamos cuando una conversación necesita a una persona. Conectar tu número actual es posible, pero entonces dejarías de poder responder desde el celular con ese número, así que hoy no lo recomendamos."
 },
 {
  "id": "faq-que-pasa-si-el-cliente",
  "titulo": "¿Qué pasa si el cliente manda un audio o una foto?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Qué pasa si el cliente manda un audio o una foto? Respuesta: Hoy el asistente responde con cortesía pidiendo que lo escriba, o deriva la conversación a una persona de tu equipo."
 },
 {
  "id": "faq-puede-equivocarse",
  "titulo": "¿Puede equivocarse?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Puede equivocarse? Respuesta: Sí, como cualquiera. Por eso está construido para no equivocarse en lo que importa: nunca confirma una cita sin verificar que exista en tu calendario, no inventa precios que no le diste y, si no está seguro después de tres intentos, deriva a una persona."
 },
 {
  "id": "faq-el-asistente-dice-que-es",
  "titulo": "¿El asistente dice que es una inteligencia artificial?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿El asistente dice que es una inteligencia artificial? Respuesta: Siempre, si le preguntan. Es un compromiso que no negociamos: nunca se hace pasar por una persona."
 },
 {
  "id": "faq-cobra-de-verdad",
  "titulo": "¿Cobra de verdad?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Cobra de verdad? Respuesta: Muestra el QR de tu banco y recibe el comprobante que envía el cliente; quien lo valida eres tú, y quien confirma que entró la plata es tu banco. El dinero se acredita directamente en tu cuenta, nunca pasa por nosotros. En las demostraciones el QR está rotulado como simulado y no cobra nada."
 },
 {
  "id": "faq-cuanto-cuesta-la-instalacion",
  "titulo": "¿Cuánto cuesta la instalación?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Cuánto cuesta la instalación? Respuesta: USD 65, un pago único que se hace por adelantado, al inicio del servicio y aparte de la mensualidad del plan. Es llave en mano: la verificación de tu número ante Meta, la carga de tus servicios, precios, horarios y el tono del asistente, la conexión con tu Google Calendar y las pruebas con casos reales. Si tu negocio necesita desarrollo a medida, como integrarlo con tu sistema propio, la instalación arranca en USD 125 y se cotiza caso por caso."
 },
 {
  "id": "faq-cuanto-tarda-la-instalacion",
  "titulo": "¿Cuánto tarda la instalación?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Cuánto tarda la instalación? Respuesta: 48 horas desde que tenemos tu información: servicios o productos con precios, horarios y tu calendario. Lo que puede tardar más es el trámite de verificación de tu negocio ante Meta, que no depende de nosotros."
 },
 {
  "id": "faq-que-pasa-si-no-pago",
  "titulo": "¿Qué pasa si no pago un mes?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Qué pasa si no pago un mes? Respuesta: Se suspende el asistente, pero conservas tus datos y el acceso a la consola en modo lectura. A tus clientes les llega un mensaje neutro: nunca se enteran de que hubo un problema de pago."
 },
 {
  "id": "faq-los-costos-de-whatsapp-y",
  "titulo": "¿Los costos de WhatsApp y de la inteligencia artificial son aparte?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Los costos de WhatsApp y de la inteligencia artificial son aparte? Respuesta: No. El consumo del modelo de inteligencia artificial y las conversaciones de WhatsApp están incluidos en tu plan. Lo único que se cobra aparte son los excedentes, si superas las conversaciones incluidas, y te avisamos antes de llegar. Tampoco te cobramos por cada mensaje que responde el asistente, aunque a nosotros WhatsApp nos los cobre."
 },
 {
  "id": "faq-donde-estan-mis-datos",
  "titulo": "¿Dónde están mis datos?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Dónde están mis datos? Respuesta: En la infraestructura de Google Cloud, en servidores de Estados Unidos, con la información de cada negocio aislada de la de los demás. Las reglas que garantizan ese aislamiento se prueban automáticamente en cada cambio."
 },
 {
  "id": "faq-ustedes-pueden-leer-las-conversaciones",
  "titulo": "¿Ustedes pueden leer las conversaciones de mis clientes?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Ustedes pueden leer las conversaciones de mis clientes? Respuesta: No, salvo que tú lo autorices. Ser dueños de NovuChat no nos da acceso: para entrar a dar soporte hace falta que un administrador de tu negocio abra un permiso, que dura entre una y veinticuatro horas, queda registrado y caduca solo. No podemos dárnoslo nosotros mismos. Las reglas que lo garantizan se prueban con más de doscientos casos automáticos en cada cambio."
 },
 {
  "id": "faq-puedo-cambiar-de-plan",
  "titulo": "¿Puedo cambiar de plan?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Puedo cambiar de plan? Respuesta: Sí, en cualquier momento. El cambio se aplica el mes siguiente, sin recalcular el mes en curso."
 },
 {
  "id": "faq-sirve-para-varias-sucursales",
  "titulo": "¿Sirve para varias sucursales?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Sirve para varias sucursales? Respuesta: Sí. Cada número de WhatsApp es un asistente con su propia configuración, y todos se administran desde la misma consola."
 },
 {
  "id": "faq-puedo-tener-citas-y-ventas",
  "titulo": "¿Puedo tener citas y ventas a la vez?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Puedo tener citas y ventas a la vez? Respuesta: Sí. Cada camino vive en su propio número de WhatsApp, así que se contrata un plan para cada uno y los dos se administran desde la misma consola. Escríbenos y lo armamos contigo: no hace falta que elijas hoy y te arrepientas después, se puede sumar el segundo cuando quieras."
 },
 {
  "id": "faq-por-que-tengo-que-elegir",
  "titulo": "¿Por qué tengo que elegir entre citas y ventas?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Por qué tengo que elegir entre citas y ventas? Respuesta: Porque son dos formas distintas de atender y cada una necesita su propia configuración: la de citas mira tu calendario, la de ventas mira tu catálogo. Un plan trae una de las dos, con el tamaño que corresponde a su nivel. Si tu negocio necesita las dos, se contratan las dos."
 },
 {
  "id": "faq-en-que-moneda-pago",
  "titulo": "¿En qué moneda pago?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿En qué moneda pago? Respuesta: Los precios están en dólares y el cobro se hace en bolivianos, al Tipo de Cambio Oficial del Banco Central de Bolivia. Tomamos el del primer día hábil de cada mes y lo mantenemos todo ese mes, así que sabes exactamente cuánto vas a pagar antes de hacerlo, y puedes verificarlo en la página del Banco Central."
 },
 {
  "id": "faq-cuando-se-paga",
  "titulo": "¿Cuándo se paga?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Cuándo se paga? Respuesta: Todo es prepago. Cada mes del plan se paga por adelantado, y la instalación es un pago único que también se hace por adelantado, al inicio del servicio. No hay contratos largos ni permanencia."
 },
 {
  "id": "faq-que-pasa-si-una-conversacion",
  "titulo": "¿Qué pasa si una conversación se hace muy larga?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Qué pasa si una conversación se hace muy larga? Respuesta: Una conversación son hasta 25 respuestas del asistente a un mismo cliente dentro de 24 horas continuas. Si un cliente necesita más, el asistente sigue atendiéndolo y desde la respuesta 26 se cuenta una conversación nueva. Como una charla tan larga casi siempre es porque algo se trabó, además te avisamos al número que nos des para que alguien de tu equipo la mire, con todo el contexto de lo que ya se habló. En tu consola ves cuántas conversaciones del mes se contaron por este motivo."
 },
 {
  "id": "faq-que-necesitan-de-mi-para",
  "titulo": "¿Qué necesitan de mí para empezar?",
  "url": "/preguntas-frecuentes",
  "texto": "Pregunta: ¿Qué necesitan de mí para empezar? Respuesta: Un número nuevo, que conseguimos nosotros; la lista de servicios o productos con precios; tus horarios y quién atiende cada servicio; tu calendario de Google y el tono con el que quieres que hable el asistente. Nada más: tú no programas nada."
 }
];

const conocimiento = FRAGMENTOS
  .map((f) => '### ' + f.titulo + ' (novuchat.site' + f.url + ')\n' + f.texto)
  .join('\n\n');

return $input.all().map((it, i) => ({ json: { ...it.json,
  conocimiento, conocimientoHuella: HUELLA, conocimientoGenerado: GENERADO,
}, pairedItem: { item: i } }));
