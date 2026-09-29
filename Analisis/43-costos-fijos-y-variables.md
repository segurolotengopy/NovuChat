# Costos fijos y variables, en porcentaje del precio, con Gemini medido

**28-sep-2026.** Sesión de análisis financiero y comercial. Pedido de Andres:
separar los costos fijos de los variables, expresarlos como porcentaje del
precio de cada plan y poner el énfasis en Gemini.

Modelo reproducible: `Analisis/43-modelo-fijos-variables.py` (`python3`, sin
dependencias). Parte de `Analisis/14` (tarifas de Meta), `27` (bloques), `39`
(BYOC) y `docs/base-comercial.md`. **No cambia ningún precio vigente**: mide, y
señala lo que habría que rediscutir.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **Gemini costaba en septiembre el 6 % del costo; medido, está entre el 18 % y el 42 %** | El supuesto de `Analisis/14` era un prompt de 2.150 tokens y una llamada por respuesta. Lo medido en 119 respuestas reales es un prompt de 7.500 a 8.000 tokens por llamada, y **2,2 llamadas por respuesta** en reservas: cada herramienta reenvía todo el prompt. Por eso Gemini cuesta **de 3 a 7 veces** lo supuesto (§2) |
| **Los planes publicados siguen cerrando** | Con la caché funcionando, al 100 % de uso, el margen de contribución es de 59 % (Impulso), 46 % (Crecimiento), 25 % (Pro) y 40 % (Platinum). En el plan grande manda **Meta, no Gemini**: es el 41 % del precio (§3) |
| **BYOC no cierra al tope que se vende** | En BYOC NovuChat no paga Meta, así que **Gemini es todo su costo variable**. USD 50 por 2.000 conversaciones de reservas deja **−4 %** si la caché funciona y **−125 %** si no funciona. El equilibrio real está entre **580 y 1.900** conversaciones, no en las 2.000 (§4). Rubén Roca y Dhermacore son BYOC |
| **Lo que decide todo es una incógnita: la caché implícita de Gemini** | El margen del plan Pro pasa del 25 % al 8 %, y el de BYOC del −4 % al −125 %, según que Google reutilice o no el prompt de sistema. **n8n no registra la cifra que factura Google**, solo un estimado. Hay que leer la factura real de septiembre (§6) |
| **Los cambios incluidos son el costo escondido de los planes** | El catálogo de F1 trae 0 / 1 / 2 cambios operados al mes (Platinum 4). Valuados a USD 15, son el 30 % del precio de Crecimiento y el 50 % del de Platinum: horas que no aparecen en ninguna factura (§3.3) |
| **El fijo de plataforma es chico: unos USD 22 al mes** | Se cubre con un solo cliente del plan Impulso. **El fijo que pesa es el tiempo de Andres y de Silvana**, que no está en ninguna cuenta. Es lo que falta para el punto de equilibrio del negocio (§5) |

---

> **Nota del 28/09 (`Analisis/45`):** el escenario «con caché» de este documento supone que el 100 % de las llamadas acierta en la caché sin costo; es el **techo** de la caché implícita, no su valor esperado. Para decidir, usar la columna «implícita central» de `Analisis/45` §3 hasta que se mida el acierto real.

## 1. Qué es fijo y qué es variable

| Tipo | Rubro | Se mueve con | Dónde está la cifra |
|---|---|---|---|
| **Variable por conversación** | Meta, servicio (0,0113 USD por respuesta, pasada la franquicia) | mensajes del asistente | `Analisis/14` §1 |
| | Meta, utilidad (recordatorio, 40 % de las conversaciones de reservas) | citas agendadas | `Analisis/14` §2 |
| | **Gemini** (entrada, salida y razonamiento) | respuestas × llamadas por respuesta × tamaño del prompt | **este documento, §2** |
| | Gemini para medios (audio, imagen, comprobante) | medios recibidos | bajo; 15 de 570 ejecuciones revisadas traían medios |
| **Variable sobre el precio** | IVA 13 % + IT 3 % | precio cobrado | `Analisis/21` |
| **Semifijo por comercio** | La franquicia de 1.000 mensajes (un ahorro, no un costo) | un número por comercio | `base-comercial` §1 |
| | Chip del número | un número por comercio | **supuesto**: USD 1,50 al mes |
| **Fijo de plataforma** | Instancia mínima de `ingesta` y `configuracionFlujo` | nada | ~16 USD, bitácora de septiembre |
| | Staging, Secret Manager, dominio | nada | ~6 USD (§5) |
| | VM de OCI, Firebase, Hosting | nada, hasta que se salga de la capa gratuita | 0 hoy |
| **Fijo no monetizado** | Horas de Andres y de Silvana; herramientas de desarrollo | nada | **no está registrado** (§5) |

---

## 2. Gemini, medido

### 2.1 Tarifa (leída el 28/09 en la página oficial de Google)

Gemini 3.5 Flash-Lite, nivel pago estándar, USD por millón de tokens:

| Entrada | Salida (incluye el razonamiento) | Caché, lectura | Caché, almacenamiento |
|---|---|---|---|
| 0,30 | 2,50 | **0,03** | 1,00 por millón y por hora |

Los ocho flujos corren `gemini-3.5-flash-lite` en el agente y en los nodos de
medios. El razonamiento viene encendido en «minimal» por defecto y **se factura
como salida**; ningún flujo lo fija explícitamente. `Analisis/14` suponía que
leer de la caché costaba el 25 % de la entrada: cuesta el **10 %**, y eso
favorece al caso con caché.

### 2.2 Tokens reales por respuesta

Extraídos de las ejecuciones de n8n del 22 al 28/09. Solo se leyeron los
conteos de tokens, no el contenido de los mensajes.

| Flujo | Respuestas medidas | Llamadas al modelo por respuesta | Entrada por llamada (mediana) | **Entrada por respuesta** | Salida por respuesta |
|---|---|---|---|---|---|
| Demo A (reservas) | 35 | 2,34 | 7.811 | **17.142** | 64 |
| Platinum (reservas) | 28 | 2,14 | 7.470 | **15.823** | 54 |
| Bellido (reservas) | 23 | 2,09 | 7.639 | **16.244** | 55 |
| Captación | 19 | 1,00 | 8.437 | **8.439** | 64 |
| Demo B (venta) | 14 | 1,00 | 3.484 | **3.495** | 66 |

**Contra el supuesto de septiembre:** `Analisis/14` usaba 2.150 tokens de prefijo
y una llamada por respuesta (dos solo cuando había herramienta). Hoy el prompt de
sistema de reservas tiene unas 3.800 palabras: creció con cada regla que se le
agregó (candado, «solo lo que se cumple», seña, voz). Y **una respuesta de
reservas llama 2,2 veces al modelo en promedio**, porque cada herramienta
(`consultar_disponibilidad`, `agendar_cita`…) vuelve a mandar todo el prompt.

**Tres límites de la medición:**
1. n8n guarda `tokenUsageEstimate`, un **estimado propio**, no la cifra de Google.
2. El estimado no cuenta las definiciones de herramientas (~600 tokens por
   llamada, sumadas en el modelo) ni el razonamiento (100 por llamada, supuesto).
3. No dice si la caché implícita acertó.

Por eso hay cuatro escenarios, no uno.

### 2.3 Costo de Gemini por conversación (8,5 respuestas, la mezcla de `Analisis/14`)

| Flujo | Supuesto de septiembre | **Medido, con caché** | Medido, sin caché | Pesimista (+25 % de tokens, razonamiento doble) |
|---|---|---|---|---|
| Reservas | 0,0069 USD | **0,0208** | 0,0511 | 0,0683 |
| Captación | 0,0069 | **0,0101** | 0,0250 | 0,0339 |
| Venta (Demo B) | 0,0069 | **0,0067** | 0,0125 | 0,0182 |

Meta cobra 0,096 USD por esa misma conversación fuera de la franquicia. Con eso,
**Gemini pasa a ser el 18 % del costo variable de reservas con caché, el 35 %
sin caché y el 42 % en el pesimista**, contra el 6 % supuesto. La frase de la
base comercial «Meta es el 94 %, el modelo es el 6 %» ya no describe a los
flujos de reservas.

**¿Funciona la caché?** Probablemente sí, porque la fecha y la hora van en el
mensaje del usuario (`[CONTEXTO DEL SISTEMA]`) y no en el prompt de sistema, que
así queda estable por comercio, y los 7.500 tokens pasan el mínimo. Pero
Google la aplica «cuando acierta», sin garantía, y n8n no lo registra.

---

## 3. Los planes, en porcentaje del precio

Los planes son los del catálogo vigente (`admin/functions/src/central/cuenta/planes.ts`,
`CATALOGO_PLANES = 2026-09-25`, iguales al sitio): **Impulso 25/100, Crecimiento
50/220 y Pro 90/500**, más **BYOC 50/2.000** fuera de la lista y la bolsa de 30
conversaciones por USD 10. **Platinum** es Pro con contrato a medida: USD 120 y 4
cambios incluidos.

Reservas, 10 clientes para prorratear el fijo, escenario «medido, con caché».

### 3.1 Al 100 % del cupo

| | Impulso 25/100 | Crecimiento 50/220 | Pro 90/500 | Platinum 120/500 | BYOC 50/2.000 |
|---|---|---|---|---|---|
| Impuestos (IVA + IT) | 16,0 % | 16,0 % | 16,0 % | 16,0 % | 16,0 % |
| Meta, servicio | 0,0 % | 19,7 % | **40,8 %** | 30,6 % | 0,0 % |
| Meta, recordatorio | 1,8 % | 2,0 % | 2,5 % | 1,9 % | 0,0 % |
| **Gemini** | **8,3 %** | **9,2 %** | **11,6 %** | **8,7 %** | **83,2 %** |
| Chip del número | 6,0 % | 3,0 % | 1,7 % | 1,2 % | 0,0 % |
| Fijo de plataforma prorrateado | 8,7 % | 4,4 % | 2,4 % | 1,8 % | 4,4 % |
| **Margen de contribución** | **59,1 %** | **45,8 %** | **25,0 %** | **39,8 %** | **−3,6 %** |

### 3.2 Al 60 % del cupo (un mes normal)

| | Impulso | Crecimiento | Pro | Platinum | BYOC |
|---|---|---|---|---|---|
| Meta, servicio | 0,0 % | 2,8 % | 19,5 % | 14,6 % | 0,0 % |
| **Gemini** | 5,0 % | 5,5 % | 6,9 % | 5,2 % | **49,9 %** |
| **Margen de contribución** | **63,2 %** | **67,2 %** | **52,0 %** | **60,0 %** | **29,7 %** |

**Cómo leerlo:**
- **Impulso es el plan más sano**, como decía `Analisis/14`: cabe en la franquicia,
  así que Meta no cobra nada. Lo que más pesa ahí, después de los impuestos, son
  el fijo y el chip, **no el uso**.
- **En Pro manda Meta**: el 41 % del precio al 100 % de uso. Gemini
  suma 12 puntos más. Es el plan con menos colchón: con el escenario pesimista
  de Gemini queda en −1 %.
- **Platinum (USD 120 por el mismo cupo que Pro) deja 15 puntos más**
  que la lista: el precio a medida le hace bien al margen.

### 3.3 Lo que el catálogo incluye y esta cuenta no ve: los cambios operados

Desde F1 cada plan trae **cambios de configuración operados por NovuChat al mes**
(`cambiosIncluidos`: 0 / 1 / 2, BYOC 2; Platinum 4 por contrato). No son dinero
que sale a un proveedor: son **horas de Andres o de Silvana**, y por eso no están
en el margen de arriba. Pero pesan. Valuados a USD 15 cada uno, el precio del
cambio suelto de `Analisis/40` §5.2:

| | Impulso | Crecimiento | Pro | Platinum | BYOC |
|---|---|---|---|---|---|
| Cambios incluidos al mes | 0 | 1 | 2 | 4 | 2 |
| Valor a USD 15 | 0 | 15 | 30 | 60 | 30 |
| **En % del precio** | **0 %** | **30 %** | **33 %** | **50 %** | **60 %** |

Si se usan todos, **Crecimiento pasa del 46 % al 16 % de margen y Platinum del
40 % a −10 %**. Los USD 15 son un precio, no un costo medido: el costo real depende
de cuánto tarda un cambio. Es la primera cifra que falta para el §5.2. Y confirma
lo que ya advertía el catálogo: «incluir más de dos en un plan de USD 50 lo
regala».

### 3.4 Sensibilidad a Gemini: margen de contribución al 100 % de uso

| | Supuesto de septiembre | **Con caché** | Sin caché | Pesimista |
|---|---|---|---|---|
| Impulso 25/100 | 64,7 % | **59,1 %** | 47,0 % | 40,1 % |
| Crecimiento 50/220 | 52,0 % | **45,8 %** | 32,5 % | 24,9 % |
| Pro 90/500 | 32,8 % | **25,0 %** | 8,2 % | **−1,4 %** |
| Platinum 120/500 | 45,6 % | **39,8 %** | 27,2 % | 20,0 % |
| BYOC 50/2.000 | 52,1 % | **−3,6 %** | **−124,7 %** | **−193,6 %** |

---

## 4. BYOC: el caso donde Gemini lo es todo

En BYOC el comercio le paga a Meta. **A NovuChat le queda como costo variable
solo Gemini.** El tope de 2.000 conversaciones se fijó con el costo de
septiembre, y `base-comercial` §3 ya advertía que «el tope se fija contra el
modelo que corre». El modelo no cambió: **cambió lo que consume**.

Equilibrio: las conversaciones al mes en que Gemini se come el precio neto de
impuestos (USD 42) menos el fijo prorrateado.

| Escenario | Reservas | Venta (con el prompt del Demo B) |
|---|---|---|
| Supuesto de septiembre | 5.783 | 5.783 |
| **Medido, con caché** | **1.914** | 5.930 |
| Medido, sin caché | 779 | 3.198 |
| Pesimista | 583 | 2.186 |

**Lo que dice:**
- **Un BYOC de reservas a 2.000 conversaciones pierde plata en todos los
  escenarios medidos.** Hoy no hay ninguno de reservas.
- **Un BYOC de venta (Rubén Roca, Dhermacore) cierra**, pero solo si su prompt se
  parece al del Demo B, que tiene 3.500 tokens. Si el esqueleto de venta de F3a
  crece como creció el de reservas —medios, transferencia, botón, campañas—, se
  acerca a la fila de reservas. **El tamaño del prompt de F3a es una decisión
  comercial**, no solo técnica.
- La cláusula «el modelo lo elige NovuChat» protege contra un cambio de modelo.
  **No protege contra un prompt que crece.** El contrato BYOC necesita un
  disparador de revisión por costo del modelo por conversación, no solo por
  cambio de modelo.

---

## 5. Los fijos

### 5.1 Plataforma (monetizados)

| USD al mes | Rubro | Fuente |
|---|---|---|
| 16,00 | Instancia mínima en `ingesta` y `configuracionFlujo` | bitácora de septiembre (#79) |
| 2,00 | Staging: Secret Manager y Scheduler | `docs/staging/DISENO.md` |
| 1,32 | Secret Manager de producción | `Analisis/14` §8 |
| 2,50 | Dominio (supuesto: renovación anual prorrateada) | a confirmar |
| 0,00 | VM de OCI (Always Free, compartida con WhatsApp-Modular) | `Analisis/14` §8 |
| 0,00 | Firebase, Hosting, reCAPTCHA (capa gratuita) | `Analisis/14` §8 |
| **21,82** | **Total** | |

Con un cliente Impulso ya se cubre. **No es lo que decide el equilibrio.**

**Cuándo se rompe la capa gratuita.** La VM de OCI pasa a pagarse (~55 USD,
estimación de `Analisis/14`) cuando n8n necesite más de lo que da el nivel
gratuito. La VM es **compartida** con un sistema financiero en producción: si
NovuChat la satura, el problema no es solo de costo.

### 5.2 No monetizados, y son los que pesan

| Rubro | Estado |
|---|---|
| Horas de Andres (arquitectura, infraestructura, alta de clientes, comercial) | sin cifra |
| Horas de Silvana (diseño funcional, guiones, material comercial) | sin cifra |
| Herramientas de desarrollo (suscripciones de IA para programar, gestor de contraseñas) | sin cifra |
| Horas por alta de cliente, contra una instalación de USD 65 | la memoria del proyecto dice «demasiadas horas para un cliente»; sin medir |

Sin estos números, **el punto de equilibrio del negocio no se puede calcular**:
el de la plataforma es un cliente, y el de las personas no se sabe. Es el
siguiente análisis natural (`Analisis/44`, caja a 12 meses).

---

## 6. Qué hacer, en orden

| # | Qué | Quién | Por qué |
|---|---|---|---|
| 1 | **Leer la factura de septiembre de la Generative Language API** (proyecto de la llave de Gemini) y dividirla por las respuestas de septiembre | Andres (consola de facturación) o un script con su «sí» | Decide entre «con caché» y «sin caché»: de eso depende el margen de BYOC y de Pro. Esta sesión no tiene acceso a la facturación |
| 2 | **Revisar el tope BYOC antes de firmar a Rubén Roca o a Dhermacore** | Andres, con la Cartera | A 2.000 conversaciones, un BYOC de reservas pierde; uno de venta gana solo con prompt chico. Agregar al contrato un disparador por costo del modelo por conversación |
| 3 | **Presupuesto de tokens para el prompt de F3a**, declarado como hoy se declaran los mensajes por conversación | Planificadora | `CLAUDE.md` obliga a declarar mensajes agregados; los tokens agregados hoy no se declaran, y ya son entre el 18 % y el 42 % del costo |
| 4 | Reescribir la frase «Meta es el 94 %, el modelo es el 6 %» de `base-comercial` §1 | Andres decide | Hoy induce a creer que optimizar el prompt no rinde. En reservas, sí rinde |
| 5 | Fijar el razonamiento de forma explícita en los flujos y medir cuánto produce | Planificadora | Se factura como salida, y hoy depende de lo que Google elija por defecto |
| 6 | Poner cifra a las horas y a las herramientas | Andres y Silvana | Sin eso no hay punto de equilibrio del negocio |

**Palancas sobre Gemini, de mayor a menor efecto** (para la Planificadora; aquí
solo se dimensionan):
1. **Menos llamadas por respuesta** (2,2 → 1,5): baja un 30 % el costo de
   Gemini en reservas.
2. **Asegurar la caché**: la diferencia entre 0,021 y 0,051 USD por conversación.
3. **Prompt de sistema más corto**: lineal. Cada 1.000 tokens menos ahorran unos
   0,0056 USD por conversación de reservas sin caché (2,2 llamadas × 8,5
   respuestas).
4. **Otro modelo de la misma familia**: Gemini 3.1 Flash-Lite cuesta 0,25 / 1,50;
   es un 17 % menos en entrada, pero hay que probar la calidad.

---

## 7. Supuestos a verificar

| Supuesto | Valor usado | Cómo se verifica |
|---|---|---|
| Tokens reales contra el estimado de n8n | 1,0× (con y sin caché); 1,25× (pesimista) | Factura de septiembre (§6.1) |
| Parte del prompt que la caché reutiliza | 6.000 tokens por llamada en reservas | Factura, o `usageMetadata.cachedContentTokenCount` en una llamada directa |
| Razonamiento en «minimal» | 100 tokens por llamada | `thoughtsTokenCount` en una llamada directa |
| Mezcla de conversaciones | 60 % de 5 respuestas, 30 % de 10, 10 % de 25 | Distribución real cuando haya un cliente en producción |
| Chip del número | USD 1,50 al mes | Andres |
| Dominio | USD 2,50 al mes | Andres |
