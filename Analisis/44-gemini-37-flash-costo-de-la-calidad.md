# Subir a Gemini 3.7 Flash: cuánto cuesta la calidad

**28-sep-2026.** Sesión de análisis financiero y comercial. Andres y Silvana
quieren probar Gemini 3.7 Flash en lugar de 3.5 Flash-Lite. El motivo: hay
demasiadas confusiones y reintentos, y eso es justamente lo que infló el peso
de Gemini que midió `Analisis/43`. Todavía no hay clientes que paguen y la
rearquitectura está en obra, así que conviene fijar ahora una línea base de
calidad, pensando en muchos clientes.

Este documento **no discute la decisión de probar**: dimensiona qué le hace al
margen y qué tiene que medir la prueba para que sirva. Modelo reproducible:
`Analisis/44-modelo-gemini-37-flash.py`, que reutiliza los tokens medidos y los
planes de `Analisis/43`.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **La prueba tiene sentido y ahora es barata** | Hasta el 31/12/2026, 3.7 Flash cuesta 0,75 / 3,75 por millón de tokens: 2,5 veces la entrada de Flash-Lite. Si la calidad reduce las llamadas y las respuestas, el costo por conversación sube entre 1,4 y 3 veces, no más (§2) |
| **El precio que cuenta es el de 2027, y es el doble** | Desde el **01/01/2027**, 3.7 Flash pasa a **1,50 / 7,50**: 5 veces la entrada y 3 veces la salida de Flash-Lite. Los clientes que se buscan van a pagar sobre todo en 2027. **Una línea base con 3.7 Flash hay que evaluarla con la tarifa de 2027**, no con la promoción |
| **Con 3.7 al precio de 2027, Gemini pasa a costar más que Meta** | Con una mejora media (1,6 llamadas por respuesta, 7,5 respuestas por conversación), Gemini es el **59 %** del costo variable de reservas. Hoy es el 18 %. El margen de Crecimiento cae del 46 % al **6 %**, y el de Platinum del 40 % al **2 %** (§3) |
| **La variable que decide es el razonamiento, y n8n no deja controlarlo** | 3.7 Flash razona en «medio» por defecto y se cobra como salida. Entre 0 y 1.500 tokens de razonamiento por llamada, la conversación va de 0,05 a 0,19 USD. **El sub-nodo de chat de Gemini de n8n 2.36.5 no expone ni el nivel ni el presupuesto de razonamiento** (`supportsThinkingBudget: false`). Tal como está, la prueba corre en «medio» sin poder bajarlo (§4) |
| **La prueba, medida en n8n, subestima el costo** | n8n anota un estimado que **no cuenta el razonamiento**. Con Flash-Lite era un error chico; con 3.7 en «medio» puede ser la mitad del costo. La prueba tiene que medir con la cifra de Google (§5) |
| **BYOC con 3.7 Flash no se puede vender a USD 50** | El equilibrio de reservas cae de 1.900 a entre 210 y 680 conversaciones al mes. Con 3.7 Flash, BYOC necesita otro precio u otro tope (§3.4) |
| **Mi recomendación** | Probar sí, **con tres condiciones**: (1) medir razonamiento, llamadas y respuestas con la cifra de Google; (2) buscar la forma de fijar el razonamiento en «bajo» antes de sacar conclusiones; (3) decidir la línea base con la tabla de 2027 y, si hace falta, ajustar precios o topes **antes** de firmar a los clientes nuevos (§6) |

---

> **Nota del 28/09 (`Analisis/45`):** el escenario «con caché» de este documento supone que el 100 % de las llamadas acierta en la caché sin costo; es el **techo** de la caché implícita, no su valor esperado. Para decidir, usar la columna «implícita central» de `Analisis/45` §3 hasta que se mida el acierto real.

## 1. Las tarifas

USD por millón de tokens, nivel pago estándar (página oficial de Google, leída
el 28/09/2026):

| Modelo | Entrada | Salida (incluye el razonamiento) | Caché | Razonamiento por defecto | Niveles |
|---|---|---|---|---|---|
| 3.5 Flash-Lite (hoy) | 0,30 | 2,50 | 0,03 | «minimal» | minimal, low, medium, high |
| **3.7 Flash, hasta el 31/12/2026** | **0,75** | **3,75** | 0,075 | **«medium»** | low, medium, high (sin «minimal») |
| **3.7 Flash, desde el 01/01/2027** | **1,50** | **7,50** | 0,15 | «medium» | low, medium, high |

Dos datos más de la misma página:
- **3.8 Flash y 3.6 Flash cuestan exactamente lo mismo que 3.7 Flash**, con el
  mismo salto en 2027. Si se sube a la familia Flash, conviene probar también la
  versión más nueva, que no cuesta más.
- La caché implícita necesita al menos 4.096 tokens en la familia Flash. El
  prompt de reservas (~7.500) la alcanza; el del Demo B (~3.500) no.

---

## 2. Gemini por conversación de reservas

Con caché, contra los 0,096 USD que cobra Meta por una conversación de 8,5
respuestas fuera de la franquicia. «Mejora» es lo que el modelo mejor ahorraría
en reintentos y confusiones:
- **Media:** 1,6 llamadas por respuesta y 7,5 respuestas por conversación.
- **Fuerte:** 1,3 llamadas y 7 respuestas.
- **Hoy:** 2,2 llamadas y 8,5 respuestas.

| Escenario | Gemini por conversación | Veces lo de hoy | Gemini en el costo variable |
|---|---|---|---|
| **Hoy: 3.5 Flash-Lite** | 0,021 USD | 1,0 | 18 % |
| 3.7 en 2026, sin mejora | 0,095 | 4,6 | 50 % |
| 3.7 en 2026, mejora media | 0,061 | 2,9 | 42 % |
| 3.7 en 2026, mejora fuerte | 0,029 | 1,4 | 27 % |
| 3.7 en 2027, sin mejora | 0,190 | 9,2 | 67 % |
| **3.7 en 2027, mejora media** | **0,122** | **5,9** | **59 %** |
| 3.7 en 2027, mejora fuerte | 0,059 | 2,8 | 43 % |

**La mejora sí baja la factura de Meta.** Cada respuesta menos por conversación
ahorra 0,0113 USD de Meta, y de 8,5 a 7,5 respuestas son 0,011 por
conversación. Es real, pero chico al lado de lo que sube Gemini.

---

## 3. Qué le hace al margen de cada plan

### 3.1 Margen de contribución, reservas, al 100 % del cupo (10 clientes)

| Escenario | Impulso 25/100 | Crecimiento 50/220 | Pro 90/500 | Platinum 120/500 | BYOC 50/2.000 |
|---|---|---|---|---|---|
| **Hoy: 3.5 Flash-Lite** | **59 %** | **46 %** | **25 %** | **40 %** | −4 % |
| 3.7 en 2026, mejora media | 43 % | 33 % | 9 % | 28 % | −165 % |
| 3.7 en 2026, mejora fuerte | 56 % | 50 % | 30 % | 43 % | −37 % |
| 3.7 en 2027, sin mejora | −9 % | −29 % | −69 % | −31 % | −682 % |
| **3.7 en 2027, mejora media** | **19 %** | **6 %** | **−25 %** | **2 %** | −409 % |
| 3.7 en 2027, mejora fuerte | 44 % | 37 % | 14 % | 31 % | −154 % |

### 3.2 Al 60 % del cupo (un mes normal)

| Escenario | Impulso | Crecimiento | Pro | Platinum |
|---|---|---|---|---|
| **Hoy** | 63 % | 67 % | 52 % | 60 % |
| 3.7 en 2027, mejora media | 39 % | 43 % | 22 % | 38 % |
| 3.7 en 2027, mejora fuerte | 54 % | 60 % | 45 % | 55 % |

En un mes normal, con mejora fuerte, 3.7 queda **cerca de hoy**. El problema
es el cliente que usa todo su cupo, y con los planes grandes ese es el caso que
se busca.

### 3.3 Desglose en % del precio: Crecimiento y Platinum, al 100 %

| | Impuestos | Meta | **Gemini** | Chip y fijo | **Margen** |
|---|---|---|---|---|---|
| Crecimiento, hoy | 16,0 % | 21,7 % | **9,1 %** | 7,4 % | **45,8 %** |
| Crecimiento, 3.7 en 2027, mejora media | 16,0 % | 16,7 % | **53,7 %** | 7,4 % | **6,2 %** |
| Platinum, hoy | 16,0 % | 32,5 % | **8,7 %** | 3,1 % | **39,8 %** |
| Platinum, 3.7 en 2027, mejora media | 16,0 % | 27,8 % | **50,9 %** | 3,1 % | **2,3 %** |

### 3.4 BYOC

Conversaciones de reservas al mes a partir de las cuales Gemini se come los
USD 50 netos:

| Hoy | 3.7 en 2026, media | 3.7 en 2026, fuerte | 3.7 en 2027, media | 3.7 en 2027, fuerte |
|---|---|---|---|---|
| 1.916 | 652 | 1.362 | **326** | 681 |

Con 3.7 Flash, **BYOC a 2.000 conversaciones por USD 50 no existe**. Para venta
el número es mejor (el prompt es más chico), pero la dirección es la misma.

### 3.5 Qué precio conserva el margen de hoy (3.7 en 2027, mejora media, al 100 %)

| Plan | Precio hoy | Margen hoy | Precio que lo conserva |
|---|---|---|---|
| Impulso 25/100 | 25 | 59 % | 66 |
| Crecimiento 50/220 | 50 | 46 % | 102 |
| Pro 90/500 | 90 | 25 % | 166 |
| Platinum 120/500 | 120 | 40 % | 222 |

Esta tabla no es una propuesta de precios: muestra que **no se puede pasar el
costo al precio**. Por eso la salida está en bajar el razonamiento y las
llamadas, no en subir la lista.

---

## 4. El razonamiento es la palanca, y hoy no está a mano

Gemini 3.7 Flash, en 2027, con mejora media (1,6 llamadas y 7,5 respuestas):

| Razonamiento por llamada | USD por conversación | Margen de Crecimiento al 100 % |
|---|---|---|
| 0 (no se puede con 3.7; su mínimo es «low») | 0,050 | 38 % |
| 300 | 0,077 | 26 % |
| **800 (supuesto para «medium»)** | **0,122** | **6 %** |
| 1.500 | 0,185 | −22 % |
| 3.000 | 0,320 | −81 % |

Tres cosas que salen de acá:
1. **Nadie sabe hoy cuántos tokens razona 3.7 Flash** con el prompt de NovuChat.
   Google no publica cifras por nivel. Los 800 de la tabla son un supuesto. Es la
   primera cosa que la prueba tiene que medir.
2. **n8n 2.36.5 no permite fijarlo.** El sub-nodo `lmChatGoogleGemini` se
   construye con `supportsThinkingBudget: false` (leído en el paquete
   `@n8n/n8n-nodes-langchain@2.36.5`), y los modelos 3.x usan `thinking_level`,
   que el nodo tampoco tiene. Cómo resolverlo es tarea de la Planificadora;
   desde lo comercial, **no se debería decidir la línea base con el razonamiento
   en «medio» por defecto**, porque se estaría midiendo el caso caro.
3. **El razonamiento también es latencia.** «Medio» en cada una de las 2,2
   llamadas alarga la primera respuesta, que es lo que ve el cliente final. La
   prueba tiene que mirarla junto con la calidad.

---

## 5. Qué tiene que medir la prueba para servir a la decisión

Para esta sesión, la prueba responde una sola pregunta: **cuánto baja cada uno
de los tres multiplicadores del costo, y cuánto sube la calidad**. Sin estas
cifras, la decisión se toma a ciegas.

| Qué | Hoy (3.5 Flash-Lite) | Dónde se mide | Por qué importa |
|---|---|---|---|
| **Tokens de razonamiento por llamada** | ~100 (supuesto) | `usageMetadata.thoughtsTokenCount` de Google; **no en el estimado de n8n** | Es el multiplicador más grande con 3.7 (§4) |
| **Llamadas al modelo por respuesta** | 2,2 (medido) | ejecuciones de n8n | Cada llamada reenvía el prompt entero |
| **Respuestas por conversación** | 8,5 (supuesto de `Analisis/14`) | conteo de la ingesta (`mensajesVentana`) | Mueve Gemini **y** Meta |
| Tokens de entrada reales y aciertos de caché | estimado de n8n | factura o `cachedContentTokenCount` | Separa «con caché» de «sin caché» |
| Calidad: reintentos del candado, transferencias a recepción, conversaciones que pasan de 25 | sin línea base | ingesta y ejecuciones | Es lo que se compra con el costo |
| Latencia de la primera respuesta | sin línea base | ejecuciones de n8n | El razonamiento la alarga |

**Condición para que la comparación sea justa:** las dos versiones, con el
mismo guion de conversaciones (el ensayo del Demo A sirve) y con la cifra de
Google, no con el estimado de n8n.

---

## 6. Recomendación

1. **Probar 3.7 Flash, y también 3.8 Flash**: cuestan lo mismo.
2. **Antes de medir costos, resolver cómo fijar el razonamiento en «low».** Es
   técnico y le corresponde a la Planificadora. Sin eso, la prueba mide un caso
   que no se va a usar.
3. **Medir los tres multiplicadores del §5 con la cifra de Google.**
4. **Decidir la línea base con la tabla de 2027.** Si con 3.7 Flash, en «low»
   y con la mejora medida, el margen de Crecimiento queda por encima del 35 % al
   100 % del cupo, la línea base es sana con los precios de hoy. Si no, hay tres
   salidas antes de tocar la lista:
   - usar el modelo caro solo en los turnos difíciles (agendar, reagendar,
     cancelar) y Flash-Lite en el resto;
   - bajar las llamadas por respuesta, que ayuda con cualquier modelo;
   - bajar el tope de los planes grandes, que es donde el margen se va.
5. **BYOC con 3.7 Flash necesita otra cuenta** antes de ofrecerse a Rubén Roca o a
   Dhermacore: la de hoy se hizo con Flash-Lite.
6. **Cláusula de contrato:** la revisión de precio tiene que dispararse por
   **costo del modelo por conversación**, no solo por cambio de modelo. El
   cambio a 3.7 es justamente el caso que la cláusula actual («el modelo lo
   elige NovuChat») no cubre.

**Lo que este análisis no dice:** que 3.7 Flash no convenga. La calidad tiene un
valor comercial que aquí no está en la cuenta: menos reclamos, menos
transferencias, más citas cerradas y clientes que renuevan. Con muchos clientes
en la mira, una línea base que se confunde también cuesta, aunque no aparezca en
la factura de Google. La prueba sirve para ponerle números a los dos lados.
