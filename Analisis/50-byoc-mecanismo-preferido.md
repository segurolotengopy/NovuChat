# BYOC como mecanismo preferido: la tabla pública, Q'Taco, Rubén y lo que cambia en la base comercial

> Sesión de análisis comercial y financiero, 09/10/2026, a pedido de Andres.
> Modelo reproducible: `Analisis/50-modelo-byoc-preferido.py`. Continúa
> `Analisis/48` y `49`. Lo decidido se marca **DECIDIDO**; lo demás es
> propuesta. No cambia `docs/base-comercial.md` ni `planes.ts`: §6 propone el
> texto para que Andres lo apruebe. Sin secretos ni identificadores.

## 0. Conclusión, adelantada

| Pregunta | Respuesta |
|---|---|
| **Qué decidió Andres (07/10)** | **BYOC es el mecanismo preferido**: el comercio trae portafolio, número y tarjeta, y paga Meta directo. NovuChat cobra la mensualidad e incluye la IA y la infraestructura. El pago regular (NovuChat paga Meta) queda para excepciones declaradas. |
| **¿La tabla pública se sostiene?** | **Sí.** 25 por 200, 50 por 500 y 90 por 1.000 conversaciones dejan **72 % a 77 %** a uso pleno con Flash-Lite y **67 % a 70 %** con Haiku 4.5 (§2). Mejor que los planes con Meta incluido (53 % a 68 %). |
| **Las bolsas** | **DECIDIDO (09/10): dos bolsas.** Conversaciones extra, fuera del plan: 300 por USD 15 (76 % con Flash-Lite). Mensajes salientes que el negocio inicia más de 48 h después del último mensaje del cliente final: 300 por USD 10 (84 %: no llevan IA). Los seguimientos dentro de las 48 h van dentro de la conversación del lead; los de después no cuentan como conversación y salen de la bolsa de mensajes (§3). |
| **Q'Taco** | **DECIDIDO:** 35 por 400, BYOC, instalación 0. Nos quedan 26 USD al mes (73 % a uso pleno). Q'Taco paga a Meta unos 12 USD con 220 conversaciones y unos 32 con 400 (§4). |
| **Rubén (Dhermacore y productos digitales)** | Un tenant, cuatro números en el portafolio verificado de Dhermacore, **60 por 1.500 conversaciones comunes, instalación 200**, seguimientos incluidos y contados como conversaciones. Nos quedan 42 USD (70 %) con Flash-Lite. Su factura de Meta va de 0 a 48 USD si el 70 % de los leads viene por anuncio y Meta da la ventana gratuita de 72 h; sin ella, de 57 a 74. El seguimiento de la semana es el caro (§5). |
| **La intervención humana a mitad del chat** | Hoy solo «pasar con Rubén» (aviso y botón a su WhatsApp). La bandeja en la consola es un módulo sin fecha. **La coexistencia app y API existe en Meta y es la vía que encaja**: Rubén escribiría desde su teléfono y el flujo recibiría el eco para callar al asistente; falta que el receptor de AAB1 entregue ese campo y una prueba con línea real que autoriza Andres (§5.4). |
| **Qué hay que cambiar** | `planes.ts` (200/500/1.000, titularidad `comercio` por defecto), la consola de planes, `docs/base-comercial.md` (§6), el sitio, las bolsas nuevas en el servidor, y un aviso cuando la tarjeta de Meta del comercio falle (§7). |

Todo lo de IA distinto de Flash-Lite sigue estimado, no medido; la batería contra Haiku está pedida y espera una cuota en Vertex o una credencial directa.

## 1. La decisión y su motivo

Andres, 07/10/2026: «Es la tabla de BYOC, pero este es el mecanismo que preferiremos, ya que tenemos muchas restricciones y recomendaciones de parte tuya que no sigamos con el mecanismo de pago regular, es decir que NovuChat pague a Meta». Las restricciones son las de `Analisis/39` §1 y `49` §1: el cupo de Meta (2 números por portafolio sin verificar, portafolios por persona), la tarifa de Meta que nosotros absorbíamos, los chips que poníamos, y que cada aviso al negocio nos comía el margen (`Analisis/48`).

La imagen que el chat de captación manda a los prospectos desde el 06/10 ya dice: USD 25 / 50 / 90 al mes por hasta 200 / 500 / 1.000 conversaciones, instalación estándar 65 y a medida desde 125, y «el cliente paga directamente a Meta los costos de mensajería».

## 2. La tabla pública, validada

USD al mes, a uso pleno. «Nos queda» descuenta impuestos (16 %), infraestructura prorrateada (2,18) e IA.

| Plan | Flash-Lite | Haiku 4.5 | Agente con caché | Agente sin caché | Hoy, con Meta incluido (100/220/500; `Analisis/49` §1, flujo mínimo) |
|---|---|---|---|---|---|
| Impulso 25 por 200 | 18 (72 %) | 17 (67 %) | 15 (58 %) | 9 (34 %) | 16 (63 %) |
| Crecimiento 50 por 500 | 38 (76 %) | 35 (69 %) | 29 (59 %) | 14 (29 %) | 34 (68 %) |
| Pro 90 por 1.000 | 69 (77 %) | 63 (70 %) | 52 (58 %) | 22 (25 %) | 47 (53 %) |

- **Vale para los flujos de diseño mínimo** (Agenda mínima, Venta mínima, Captación mínima). Un agente con herramientas y sin caché la rompe; ya no se construyen así.
- **El modelo lo elige NovuChat.** Los equilibrios están lejos: Impulso pierde recién a 4.700 conversaciones con Flash-Lite y a 1.775 con Haiku.
- **Lo que paga el comercio a Meta**, a uso pleno y con un aviso por conversación: unos 2 USD en Impulso, 23 en Crecimiento y 57 en Pro. Con varios avisos al negocio (como Q'Taco), 10, 43 y 97. En Pro, el total puede pasar de 145 USD: la imagen y el contrato lo dicen con números, nunca como «centavos» (`base-comercial` §3).
- **Instalación 65 y «a medida desde 125».** El alta BYOC lleva una sesión de Meta con el dueño (portafolio, tarjeta, número); Q'Taco salió con 0 y Rubén con 200. Andres decide si 65 se queda.

## 3. Las bolsas: dos, y una regla de conteo

**DECIDIDO (Andres, 09/10):**

| Bolsa | Qué cubre | Precio | Por unidad | Nos queda | Lo que el comercio paga a Meta por esas 300 |
|---|---|---|---|---|---|
| **Conversaciones extra** | Conversaciones por encima de las incluidas en el plan | **300 por USD 15** | 0,050 | 11,4 (76 %) con Flash-Lite; 9,4 (63 %) con Haiku | Según su tráfico (5 respuestas y 1 aviso: unos 20 USD pasada la franquicia) |
| **Mensajes salientes fuera de las 48 h** | Mensajes que el negocio inicia más de 48 horas después del último mensaje del cliente final (el seguimiento «a la semana», una reactivación) | **300 por USD 10** | 0,033 | 8,4 (84 %): no llevan IA | Unos 22 USD: son plantillas de marketing a 0,074. Hay que decirlo: la bolsa le cuesta más en Meta que en NovuChat |

**La regla de conteo, confirmada por Andres el 09/10:**
- El seguimiento **dentro de las 48 horas** va dentro de la conversación del lead: no abre una conversación nueva aunque pase la ventana de 24 horas.
- Un mensaje iniciado por el negocio **después de 48 horas no cuenta como conversación**: se descuenta de la bolsa de mensajes salientes. Si el cliente final responde, esa respuesta abre una conversación que sí cuenta (por confirmar con Principal, §7).
- Las dos bolsas entran en el conteo de su unidad, no vencen y se cortan al agotarse, como las conversaciones en producción.

**Lo que esto cambia:** 1.500 conversaciones vuelven a ser unos 1.500 leads, no 500 (§5.2). El servidor hoy no distingue un saliente iniciado por el negocio de una respuesta, cuenta cada ventana de 24 horas como conversación y solo conoce la bolsa de 30 por 10, con el pago sobre una lista cerrada: **las dos bolsas y la regla son código nuevo en el conteo y en Pagar**, que dimensiona Principal (§7).

**Dimensionado de Principal (09/10, solo lectura sobre main):** hoy el servidor no distingue un saliente del negocio de una respuesta, la ventana es fija de 24 horas desde la primera consulta, un saliente nunca abre conversación y la respuesta del cliente sobre ventana vencida abre una cobrada; no existe la hora del último entrante, y el código no manda nada después de 48 horas (los seguimientos viven en Agenda). Hacen falta: la hora del último entrante en el servidor, un evento «seguimiento» con ordinal, la reserva del mensaje antes de enviarlo (un solo escritor, idempotente), que ese evento no sume al bloque de 25 ni a los umbrales, las dos bolsas en el catálogo y en Pagar (variante nueva de pago), un contador y un corte propio para los salientes, la lista blanca de reglas, Consumo y el aviso de bolsa. **3 a 4 jornadas de agente en tres bloques:** Central (1,5 a 2, en paralelo a F3b), Core (0,5 a 1, después de fusionar #439, que toca `ingesta.ts`) y Módulo (0,5). **La bolsa de mensajes solo cierra en BYOC:** cobra 0,033 por mensaje y a Meta le cuesta 0,074; con titularidad `novuchat`, NovuChat pierde.

**Decisiones que Principal deja a Andres antes de construir:**
1. La respuesta del cliente a un seguimiento dentro de las 48 h: ¿no cobra y extiende la conversación del lead (A), o cobra como hoy (B)?
2. Qué reinicia las 48 h: cualquier mensaje entrante (como Meta) o solo una consulta sin cortesías.
3. Cuántos mensajes salientes fuera de 48 h incluye cada plan (0 por defecto) y el umbral del aviso por saldo.
4. Si se devuelve el mensaje a la bolsa cuando el envío a Meta falla.
5. Si la bolsa vieja de 30 por 10 convive con la de 300 por 15, y qué pasa con el regalo de 6 meses, que hoy usa esa constante.
6. Si la bolsa de mensajes se vende solo con titularidad `comercio`.

**Una observación, dicha una vez:** a 0,050 por conversación, la bolsa de conversaciones sigue más barata que los planes (0,090 a 0,125): Impulso más una bolsa son 500 conversaciones por 40 y Crecimiento las da por 50. Andres lo aceptó así.

## 4. Q'Taco: decidido

**DECIDIDO (Andres, 07/10):** 35 USD al mes por 400 conversaciones, BYOC, instalación 0. El titular hizo el alta en su portafolio el 08/10; el número se traslada en la ventana de mantenimiento cuando Meta apruebe las plantillas, y hasta entonces Meta le factura el consumo a NovuChat: estimado entre 0 y 3 USD, con unas 10 conversaciones por día durante menos de una semana, porque las respuestas caben en la franquicia del número y solo se cobrarían los avisos al restaurante.

| | 220 conversaciones | 400 conversaciones |
|---|---|---|
| Nos queda con Flash-Lite | 26 (75 %) | 26 (73 %) |
| Nos queda con Haiku | 25 (71 %) | 23 (66 %) |
| Meta de Q'Taco (5,3 respuestas y 4,2 avisos por conversación) | 12 | 32 |

El precio, 0,0875 USD por conversación, cae entre Impulso (0,125) y Crecimiento (0,10): no abre una excepción. Lo que sí hay que decirle antes de cargar la tarjeta es su factura de Meta.

## 5. Rubén: Dhermacore y productos digitales en un solo cliente

### 5.1 Quién es y qué quiere

Rubén es agencia y autor: hace el marketing y el seguimiento de las dos doctoras de Dhermacore y vende productos digitales. Quiere **todo en una sola plataforma**: un tenant, cuatro números, cuatro flujos de campañas de Facebook e Instagram (clic a WhatsApp), hasta cuatro imágenes por campaña y una campaña al mes por línea. Las líneas de las doctoras terminan en una cita avisada a un número; las de productos, en una venta con QR y cotejo. Pide dos seguimientos por lead (uno dentro de las 48 horas y otro dentro de la semana) y poder **intervenir a mitad del chat** para insistir y cerrar la cita.

**DECIDIDO (Andres, 09/10):** Dhermacore tiene empresa y portafolio verificado, y Rubén lo administra: **los cuatro números van en ese portafolio**, con la tarjeta del cliente. Un portafolio verificado admite hasta 20 números y no queda «limitado». La propuesta dual del 23/09 (`Analisis/38`, `39`) queda reemplazada por esta.

### 5.2 Precio y lo que nos queda

**60 USD al mes por 1.500 conversaciones comunes a los cuatro números; instalación 200; las dos bolsas de §3; 4 cambios de campaña al mes como autogestión desde la consola (operados por NovuChat, 15 USD cada uno); el seguimiento de las 48 horas incluido en la conversación del lead; el de la semana, de la bolsa de mensajes salientes.**

| Flujo | Al 50 % de uso | A uso pleno | Equilibrio |
|---|---|---|---|
| Diseño mínimo con Flash-Lite | 45 (75 %) | 42 (70 %) | 12.000 |
| Diseño mínimo con Haiku 4.5 | 40 (67 %) | 32 (54 %) | 4.500 |
| Agente con caché | 33 (54 %) | 17 (28 %) | 2.300 |
| Agente sin caché | 10 (17 %) | −28 | 945 |

- **Los seguimientos no nos cuestan IA:** texto fijo, sin modelo; hasta unas 3.000 ejecuciones más al mes en n8n (`Analisis/49` §6 las absorbe). El de las 48 horas va incluido; el de la semana se vende en la bolsa de mensajes salientes, y la instalación cubre construirlos.
- **1.500 conversaciones son unos 1.500 leads** con la regla de §3. Si Rubén manda el mensaje de la semana al 60 % de ellos (900 mensajes, 3 bolsas), nos paga 60 más 30 y nos quedan unos 67 USD (42 del plan y 25 de las bolsas).
- **Es precio por contrato** (0,040 por conversación), con plazo y revisión.

### 5.3 Lo que paga Rubén a Meta

Cuatro números son cuatro franquicias: 4.000 mensajes de servicio gratis al mes. Si el 70 % de los leads llega por anuncio, su primera conversación y el seguimiento de las 48 horas salen gratis (ventana de 72 horas del punto de entrada). Lo que cuesta es **el seguimiento de la semana, que siempre es plantilla de marketing a 0,074 USD**, y el de 48 horas para quien no vino de un anuncio.

| Escenario (70 % por anuncio) | Meta al mes | Paga en total |
|---|---|---|
| 1.500 leads sin seguimientos | 0 | 60 |
| 1.500 leads con el seguimiento de 48 h (incluido) | 33 | 93 |
| 1.500 leads con el de 48 h y el de la semana al 60 % (900 mensajes, 3 bolsas de 10) | 100 | 190 |
| Si Meta no diera la ventana gratuita: 1.500 leads con los dos seguimientos al 60 % | 234 | 324 |

La ventana de 72 horas **no se promete hasta medirla** (`base-comercial` §6); el origen del anuncio ya se registra en el servidor.

**Cuatro condiciones que salen de la consulta a WhatsApp-Modular (09/10):**
1. **Consentimiento.** El clic en un anuncio no autoriza seguimientos de marketing fuera de la ventana: el flujo tiene que pedirlo en el chat («¿te escribimos en la semana?») y guardarlo. Sin eso, el seguimiento de la semana no sale.
2. **Calidad.** Los seguimientos a quien no respondió son lo que más se reporta; cada bloqueo baja la calidad del número, y una sanción puede afectar a todo el portafolio. Con los cuatro números en uno, el riesgo es común.
3. **Recategorización.** Meta puede pasar a marketing una plantilla escrita como «recordatorio» (ya nos pasó con una propia). Se prueba cada plantilla antes de prometer su costo.
4. **Tope de envíos nuevos:** 250 personas por día por portafolio hasta que suba el nivel; con unos 100 seguimientos por día, alcanza.

### 5.4 La intervención de Rubén a mitad del chat

| Vía | Qué es | Estado |
|---|---|---|
| **Pasar con Rubén** | El asistente le avisa con el resumen del lead y le da al lead un botón para escribirle a su WhatsApp personal | **Existe** («pasar con recepción» con su número). Es lo que se ofrece desde el día uno |
| **Bandeja en la consola** | Rubén responde por el mismo número desde la consola; el asistente se pausa para ese teléfono | **No existe.** Necesita el envío desde el servidor (F4), el estado por teléfono (F3b) y una pantalla. Módulo para todos; sin fecha |
| **Coexistencia app y API** | El número queda a la vez en la aplicación del teléfono y en la API; cuando Rubén escribe desde la app, el flujo recibe el eco y calla al asistente | **Existe en Meta y es la que encaja** (investigación de WhatsApp-Modular del 09/10, documentación oficial): ver abajo |

**Lo que encontró la investigación (09/10, documentación oficial de Meta salvo donde se dice):**
- **Cómo se activa:** por el registro integrado del Tech Provider (AAB1), con la aplicación WhatsApp Business ya instalada y en uso en el número; el cliente confirma un código en su teléfono. Dentro de las 24 horas hay que pedir contactos e historial, o el cliente se reincorpora. El historial se sincroniza una sola vez (hasta 180 días; multimedia, 14).
- **Qué se pierde en la app:** grupos (no se admiten ni sincronizan), mensajes temporales, «ver una vez» y ubicación en vivo; las listas de difusión quedan en solo lectura.
- **Cómo se pausa el asistente:** cuando el humano escribe desde la app, Meta manda el campo `smb_message_echoes` (texto, imagen, video, documento, edición y borrado). El flujo trata cada eco como «el humano está hablando en esa conversación» y calla; deduplica por id. **Ese campo admite el desvío por WABA, pero el receptor de AAB1 hoy solo entrega `messages`: hay que ampliarlo**, y lo hace la sesión principal de WhatsApp-Modular con autorización de Andres. Las desconexiones no pasan por el receptor.
- **Costos:** lo que Rubén escriba desde la app es gratis; lo que envíe la API paga tarifa estándar. Si el eco cuenta en la franquicia: no documentado.
- **Riesgos:** el número se desconecta si el teléfono principal no se usa unos 14 días; revertir exige el teléfono del dueño; el alta de coexistencia en AAB1 está pendiente de un ajuste (WhatsApp-Modular). No verificado: países (un proveedor dice que Bolivia tiene soporte pleno), límites de mensajería y calidad, verificación del negocio y OBA en coexistencia.
- **Falta la prueba con una línea real** (línea con al menos 7 días de uso en la app, un teléfono de Andres, con reversa). La autoriza Andres en la sesión de investigaciones de WhatsApp-Modular. Sin esa prueba, a Rubén se le promete «pasar con Rubén» y la coexistencia se le muestra como posibilidad.

Informe completo: investigación de coexistencia de WhatsApp-Modular del 09/10/2026 (entregable fuera del repositorio; pedirlo a esa sesión).

### 5.5 Qué hay que construir y cuándo

Cuatro flujos de dos tipos sobre el esqueleto de venta y Agenda mínima; galería de hasta cuatro imágenes por campaña; enrutamiento por campaña a cada doctora; seguimientos con consentimiento (hoy viven en Agenda, D02 y D03 de `CLIENTES/DEMANDA.md`); aviso de cita a un número; QR y cotejo (existen). Son 3 a 6 jornadas; la instalación de 200 cubre parte. Viene después del esqueleto de venta: **no se promete fecha** hasta que Rearquitectura lo ubique (política del 21/09).

## 6. Lo que cambia en `docs/base-comercial.md`

Propuesta de texto, para que Andres la apruebe y el agente `metodo` la aplique:

| Sección | Hoy dice | Propuesta |
|---|---|---|
| §1 «Meta es el 94 % del costo; el modelo el 6 %» | Vale con Meta incluido | «En BYOC el comercio paga Meta; para NovuChat la IA es casi todo el costo variable. Los mensajes por conversación se siguen declarando porque son la factura del comercio.» |
| §1 «Optimizar tokens ya casi no rinde» | Vale con Meta incluido | En BYOC vuelve a rendir: 0,004 USD por conversación con Flash-Lite contra 0,011 con Haiku. Cada flujo declara su costo de IA por conversación |
| §3 «Planes 25 / 50 / 90 por 100 / 220 / 500» | Meta incluido | **25 / 50 / 90 por 200 / 500 / 1.000, BYOC.** El pago regular queda para excepciones declaradas (Bellido) |
| §3 «El plan de entrada cabe exacto en la franquicia» | Argumento nuestro | Pasa a ser del comercio: su factura de Meta en Impulso ronda los 2 USD |
| §3 «El volumen del plan grande no se estira más allá de 500» | Por Meta | Por la IA: el tope se fija contra el modelo (`Analisis/39` §2); 1.000 es holgado |
| §3 «Bolsa: 30 por 10, que no vence» | Para Meta incluido | Dos bolsas BYOC (§3): 300 conversaciones por 15 y 300 mensajes salientes fuera de 48 h por 10; no vencen y entran en el conteo de su unidad |
| §3 «Aviso al 80 %» | Sigue | Sigue. Se agrega: aviso cuando la tarjeta del comercio en Meta falle, porque el canal se cae y NovuChat no puede reponerlo |
| §3 BYOC «se ofrece caso por caso» | Excepción | Es el mecanismo preferido. Lo que sigue valiendo: el modelo lo elige NovuChat; la factura de Meta no son «centavos»; BYOC no levanta el techo de n8n |
| §4 Consola | Mensajes del mes contra los 1.000 gratis | Es la cifra que le predice la factura al comercio: pasa a obligatoria, por número |
| Contrato (nuevo) | — | Acceso de administrador sostenido al portafolio; Google (y Anthropic, si entra Haiku) como proveedores de IA en la política de privacidad; revisión si el tráfico por anuncio cambia |

## 7. Lo que hay que alinear, con dueño

| Pieza | Qué | Dueño |
|---|---|---|
| `planes.ts` y consola de planes | 200 / 500 / 1.000; titularidad `comercio` por defecto; `cambiosIncluidos` 0 / 1 / 2 | Principal (Central) |
| Las dos bolsas y la regla de conteo en el servidor | Contador de mensajes salientes fuera de 48 h; la bolsa de conversaciones de 300 por 15 y la de mensajes de 300 por 10 en Pagar; consumo en la consola. Dimensionado pedido a Principal el 09/10 | Core y Central |
| `docs/base-comercial.md` | §6 | `metodo`, con el OK de Andres |
| Sitio (`precios.es.ts`) | Los tres planes publicados dicen lo mismo que `planes.ts` | Sesión del sitio |
| Imagen del chat de captación | Factura de Meta con números; sin bolsas hasta que existan | Sesión del chat |
| Aviso de tarjeta de Meta | Nuevo | Core, después de medir cómo se detecta |
| Registro integrado y coexistencia en AAB1 | Alta del número en el receptor; ampliación del campo de ecos; prueba de coexistencia | WhatsApp-Modular |
| Sesión con el dueño | Portafolio, tarjeta y plantillas en su WABA, el mismo día del alta | Cartera |
| Mientras tanto | Un prospecto que firme hoy se atiende: conversaciones y precio se fijan por contrato sin cambiar código | Cartera |

**Cartera actual:** Bellido sigue en pago regular (decidido el 01/10) como excepción declarada, revisable al renovar; Q'Taco ya pasó a BYOC; los demás flujos son demos o nuestros.

## 8. Supuestos y lo que falta medir

- IA: Flash-Lite 0,004 USD por conversación (`Analisis/43` §8 más comprobante y audio); Haiku 0,0106 estimado con el mismo perfil de tokens. La batería contra Haiku está pedida (Operadora, 06/10); espera una cuota en Vertex o una credencial directa.
- Meta: 0,0113 por mensaje de servicio o utilidad, 0,074 marketing, 1.000 gratis por número; ventana de 72 horas del punto de entrada por anuncio, sin promesa.
- Impuestos 16 % del precio; infraestructura 21,82 USD al mes entre 10 comercios; sin impuesto a las utilidades ni retenciones por pagos al exterior.
- Coexistencia: documentación leída (§5.4); faltan la ampliación del receptor y la prueba con línea real, que autoriza Andres.
- Capacidad de n8n: `Analisis/49` §6; Rubén suma unas 4.500 ejecuciones conversacionales y hasta 1.000 de seguimientos al mes, dentro de la holgura.
