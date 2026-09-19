# Costo y beneficio de tres capacidades: dirección con Maps, voz, e imágenes y PDF

**17-sep-2026.** Pedido de Andres: análisis de costo/beneficio, sobre lo que
hoy existe, de (1) enviar la dirección con enlace a Google Maps, (2) recibir y
enviar mensajes de voz, y (3) recibir y procesar imágenes y PDF. Tarifas de
Meta de `Analisis/14`; precios del modelo de `14-modelo-costos.py` (Gemini
Flash-Lite, 0,30 USD por millón de tokens de entrada); criterio de latencia de
`Analisis/04` (p50 ≤ 6 s, p90 ≤ 10 s; medido 1,6–5,6 s).

**Lo que hay hoy** (`Normalizar entrada`, `Flujos/demo-a-agendamiento.json`):
`text`, `interactive` y `button` se leen; `image` recibe «AVISO_SISTEMA:
agradécela y continúa»; **audio, documento, ubicación y sticker** reciben
«por ahora atiendo por texto». Cada una de esas respuestas es un mensaje pagado
que no avanza la conversación. La lectura del comprobante está diseñada
(`Analisis/07` §4) y no construida.

---

## 0. Conclusión

| Capacidad | Costo por uso | Mensajes que agrega | Construir | Veredicto |
|---|---|---|---|---|
| **Dirección con enlace a Maps** | 0 | **0** si va dentro de la confirmación de la cita | ½ hora | **Hacer ya.** Ahorra la pregunta «¿dónde quedan?» (un mensaje pagado) y llegadas tarde |
| **Recibir voz** (transcribir) | ≈ 0,001 USD por audio | 0 (reemplaza el «atiendo por texto», que ya se paga) | 1 jornada, compartida con imágenes | **Hacer.** Es el tipo de mensaje más común en Bolivia después del texto, y hoy se pierde |
| **Enviar voz** (sintetizar) | ≈ 0,005 USD por respuesta + el mensaje | 0 (reemplaza texto) | 1 jornada | **No ahora.** Una respuesta con precio, fecha, odontólogo y enlace se lee, no se escucha; suma 2–3 s de latencia; el cliente no puede releer |
| **Recibir imágenes y PDF** | ≈ 0,0001 USD por imagen o página | 0 | 1 jornada, compartida con voz; el cotejo del comprobante ya está diseñado | **Hacer.** La seña de Platinum lo necesita; sin esto un comprobante o una foto reciben una respuesta vacía |
| **Enviar PDF o imagen** (indicaciones, QR, ficha) | 0 por el archivo; 1 mensaje | +1 por envío | ya existe para el QR; ½ jornada para un documento configurable | **Solo cuando reemplaza texto** (indicaciones previas a la cita en un PDF en vez de tres mensajes) |

**El costo de uso de las cuatro es despreciable frente a Meta:** un audio
transcripto cuesta la décima parte de un mensaje; una imagen leída, la
centésima. **Lo que cuesta es la latencia y el riesgo del contenido**, no la
plata. Y el beneficio principal no es ahorrar: es **no perder la conversación
en el primer mensaje** cuando llega en voz o en imagen.

---

## 1. Lo que Meta cobra, y lo que no

- **Todo lo que manda el asistente dentro de la ventana es un mensaje de
  servicio a 0,0113 USD**, sea texto, imagen, audio, ubicación o documento.
  El tipo no cambia el precio.
- **Todo lo que manda el cliente es gratis**, del tipo que sea. Un audio de
  dos minutos y una foto de 3 MB cuestan cero en Meta.
- **Un medio se descarga en dos pasos**: `GET /{media-id}` devuelve una URL
  temporal (vence en 5 minutos) y esa URL se descarga **con el token**. Es un
  solo nodo, el mismo para audio, imagen y PDF: se construye una vez.
- **Un medio que sube NovuChat** (QR, PDF de indicaciones) queda ligado al
  número que lo subió (hallazgo 19 de `ESTADO.md`) y vale unos 30 días; se
  reusa por `media-id`, sin volver a subirlo.

---

## 2. Dirección con enlace a Google Maps

**Dos formas, y la diferencia es un mensaje:**

| Forma | Cómo | Mensajes | Qué ve el paciente |
|---|---|---|---|
| **Enlace dentro del texto** | `config/negocio.direccionMaps` (el enlace corto de Maps) y una línea en el prompt: «al confirmar la cita, incluye la dirección y el enlace» | **0** (va en el mensaje que ya existe) | Texto con enlace tocable; con `preview_url` muestra la tarjeta |
| Mensaje de tipo `location` | Latitud, longitud, nombre y dirección en la configuración; un envío aparte | **+1** (0,0113) | Un pin nativo que abre Maps o Waze |

**Recomendación:** el enlace en el texto de la confirmación y en la respuesta
a «¿dónde quedan?», siempre; el mensaje `location` solo si el paciente lo pide
(«mándame la ubicación»), porque es lo que la gente espera en Bolivia para
navegar y es un solo mensaje bien gastado.

**Beneficio:** hoy «¿dónde quedan?» es una pregunta que aparece (prueba 15 de
la aceptación de Platinum) y cuesta un turno; llevar la dirección en la
confirmación la evita en la mayoría de los casos. Y una clínica «entre 2do y
3er anillo» sin mapa es una cita que llega tarde. **Costo: media hora**, y es
configuración del comercio, no del flujo: un campo en `config/negocio`, la
pantalla lo pide en el alta.

---

## 3. Voz

### 3.1 Recibir: transcribir lo que el cliente manda

| | |
|---|---|
| **Cómo** | Descargar el medio; transcribir con el propio Gemini (acepta audio en línea; no hace falta otro proveedor) o con Speech-to-Text; el texto entra al agente como si lo hubieran escrito, marcado como «(audio transcripto)» |
| **Costo por audio** | Gemini: ~32 tokens por segundo; un audio de 30 s son ~1.000 tokens → **≈ 0,001 USD** (aun a tres veces la tarifa de texto). Speech-to-Text de Google: ~0,016 USD por minuto → 0,008 por audio de 30 s. Gemini gana |
| **Mensajes** | **0 más.** Hoy el audio ya recibe una respuesta pagada («atiendo por texto»); con transcripción esa misma respuesta contesta lo que el cliente preguntó |
| **Latencia** | **+2 a 4 s** (descarga 0,5 s, transcripción 1–3 s). Es el costo real: sobre un turno de 5,6 s compromete el p90 de 10 s. Mitigación: transcribir solo audios de **hasta 60 s**; a los más largos, pedir que lo resuma o lo escriba |
| **Riesgo** | Transcripción errada de nombres, horas y montos («las tres» / «a las trece»). El asistente **repite lo que entendió** antes de agendar («Entendí: jueves a las 15:00 con el Dr. Sandoval, ¿correcto?»), que ya es la práctica de la confirmación |
| **Construir** | El nodo de descarga (compartido), un nodo de transcripción, la marca en `Normalizar entrada`. **1 jornada** incluyendo la prueba con teléfono |

**Beneficio:** en Bolivia el audio es el segundo tipo de mensaje más común
después del texto. Hoy un paciente que manda un audio recibe «atiendo por
texto» y **una parte no vuelve a escribir**: es un lead perdido al primer
mensaje, y un mensaje pagado para perderlo. No hay número medido; la prueba 3
de la aceptación de Platinum («un sticker y un audio») es el lugar para
empezar a contar cuántos audios llegan.

### 3.2 Enviar: responder en voz

| | |
|---|---|
| **Cómo** | Sintetizar la respuesta (Google Cloud Text-to-Speech, voz Neural2 en español; o la voz de Gemini), subir el audio a Meta, enviar un mensaje de tipo `audio` |
| **Costo por respuesta** | Neural2: 16 USD por millón de caracteres → una respuesta de 300 caracteres, **0,005 USD**; la voz estándar, 0,001. ElevenLabs, ~0,09: descartada. Más el mensaje de Meta, igual que el texto |
| **Mensajes** | 0 más si reemplaza al texto; **+1 si va además del texto** (que es lo que muchos hacen, y duplica el costo de la conversación) |
| **Latencia** | **+2 a 3 s** (síntesis + subida a Meta), sobre lo que ya suma la transcripción |
| **Lo que se pierde** | Enlaces (Maps, catálogo), el QR, la negrita de precios y horarios, la posibilidad de releer, la búsqueda en el chat. Un audio con «jueves 15:00, Dr. Sandoval, 500 Bs, Radial 26» se pide de nuevo por texto |
| **Construir** | 1 jornada; y una regla de cuándo hablar (solo si el cliente habló, nunca para confirmaciones ni cobros) |

**Recomendación: no ahora.** El costo es chico; el valor es dudoso para lo
que el asistente dice (datos que se leen) y le suma latencia a cada turno. Se
reconsidera si en la medición del §3.1 aparecen clientes que **solo** hablan
en voz, y aun así con la regla «voz solo para lo conversacional; la
confirmación, el precio y el QR siempre en texto».

---

## 4. Imágenes y PDF

### 4.1 Recibir y procesar

| Caso | Qué hace hoy | Con procesamiento | Costo por uso |
|---|---|---|---|
| **Comprobante de pago** (imagen o PDF, incluso el PDF-imagen del BCP) | No se lee; el flujo de seña no puede existir | El cotejo de `Analisis/07` §4: monto, cuenta destino, fecha; nunca «acreditado» | ≈ 260 tokens por imagen o página: **0,0001 USD** |
| **Foto «quiero que me queden así»** (clínica, salón) | «Gracias, continúa» | Reconoce que es una foto de referencia, la agradece, la deja para la valoración. **No opina sobre el resultado** ni diagnostica; es la misma regla del prompt de Platinum | 0,0001 |
| **Foto de un producto** (comercio) | «Gracias, continúa» | Identifica si está en el catálogo y responde con precio; si no, dice que lo consulta recepción | 0,0001 |
| **Captura de pantalla** de una promoción vieja o de otro negocio | «Gracias, continúa» | Lee el texto y responde a lo que dice: «esa promoción ya no está vigente; la actual es…» | 0,0001 |
| **PDF de una orden médica, receta, seguro** | «Atiendo por texto» | Lee lo que dice y lo deriva a la valoración o a recepción, **sin interpretarlo** | 0,0001 por página |

**Costo del modelo: nada.** Mil imágenes son 0,10 USD. **Mensajes: cero más**,
porque la respuesta al medio ya se pagaba vacía. **Latencia: +1 a 2 s** por la
descarga y la lectura, menos que el audio.

**Construir: 1 jornada**, con el nodo de descarga compartido con la voz. Los
tres nodos del comprobante (`Analisis/07` §4.2) son el 80 % del trabajo, y
hacen falta de todos modos para la seña de Platinum (`Analisis/30` §4). Lo
demás es un prompt de descripción con las reglas de arriba.

**Los riesgos son de contenido, no de costo:**

1. **Una foto de dientes o de piel es dato de salud.** Se lee, se responde y
   **no se guarda**: no va a Storage, no va al historial de mensajes más que
   como «el cliente envió una imagen». La URL de Meta vence en 5 minutos y
   eso está bien. Es coherente con la retención de 12 meses que el contrato
   promete solo para los mensajes.
2. **El comprobante coteja, no acredita** (prohibición 3). Ya está resuelto en
   el diseño; solo hay que no romperlo al construir.
3. **El modelo puede «ver» lo que quiere ver.** El prompt de lectura devuelve
   cadena vacía ante la duda (`Analisis/07` §4.3); un campo vacío hace que
   una persona mire.

### 4.2 Enviar imágenes y PDF

Lo que existe: el QR del comercio, que se sube una vez y se manda por
`media-id`. Lo que se podría agregar con el mismo mecanismo:

| Envío | Cuándo vale la pena | Mensajes |
|---|---|---|
| **PDF de indicaciones previas** («qué hacer antes del blanqueamiento», «cómo llegar») | Si reemplaza a dos o tres mensajes de texto que hoy se mandan, o a preguntas que se repiten. Un PDF configurable por comercio: `config/negocio.documentos[]`, subido una vez | +1, pero **ahorra 2 o 3** |
| **Foto de un producto** del catálogo | Ya está en el catálogo web; mandar la foto en el chat es un mensaje pagado que el enlace da gratis (`CLAUDE.md` §5) | +1 por foto: **no** |
| **Ficha de la cita como imagen** | No. La confirmación en texto se lee, se copia y se busca | — |

---

## 5. Qué construir y en qué orden

| # | Qué | Jornadas | Por qué en este orden |
|---|---|---|---|
| 1 | Dirección con enlace a Maps en la confirmación y en «¿dónde quedan?» | ½ hora | Cero costo, cero riesgo, beneficio inmediato |
| 2 | Nodo «Descargar medio de Meta» + lectura de imágenes y PDF + los tres nodos del comprobante | 1 | Lo exige la seña de Platinum; sirve a todos los flujos |
| 3 | Transcripción de audio, con tope de 60 s y confirmación de lo entendido | ½ (el nodo de descarga ya está) | Recupera el lead que llega en voz |
| 4 | PDF de indicaciones configurable por comercio | ½ | Solo si un cliente lo pide; ahorra mensajes |
| — | Respuestas en voz | — | Cuando la medición del punto 3 lo justifique |

**Total: unas 2 jornadas** para lo recomendado. Cada pieza declara sus
mensajes (`CLAUDE.md` §1): las tres primeras **no agregan ninguno**; la cuarta
agrega uno y quita dos o tres.

---

## 6. Qué medir

| Dato | Para qué |
|---|---|
| Mensajes entrantes por tipo (texto, audio, imagen, documento, ubicación) por comercio | Cuántos leads llegan en voz o en imagen; hoy no se cuenta y `Normalizar entrada` ya sabe el tipo |
| Latencia del turno con audio y con imagen, contra p50 ≤ 6 s y p90 ≤ 10 s | Si el tope de 60 s alcanza o hay que bajarlo |
| Conversaciones que empezaron con un audio y siguieron | Si la transcripción recupera leads, con número |
| «¿Dónde quedan?» antes y después del enlace | Si la dirección en la confirmación evita la pregunta |
