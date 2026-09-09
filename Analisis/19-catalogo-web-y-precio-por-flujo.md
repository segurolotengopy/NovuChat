# Dos preguntas del Flujo B: el tamaño del catálogo y el precio por flujo

**08-sep-2026.** Dos análisis pedidos por Andres, con las tarifas de Meta del
1 de octubre. Modelo: `14-modelo-costos.py`.

**Las dos respuestas, adelantadas:**

1. **El corte del catálogo no es económico.** Meter 500 productos en el prompt
   cuesta menos que **un solo mensaje** del asistente. El límite lo ponen la
   legibilidad del chat y la confiabilidad del modelo, no el costo.
2. **No conviene cobrar distinto por flujo.** La diferencia entre A y B existe
   —hoy B cuesta 25 % más— pero **se da vuelta** con el catálogo web, que pasa a
   dejar B un 61 % **más barato** que A. Fijar precios sobre una diferencia que
   está por invertirse es el peor momento posible.

---

# PARTE 1 · Cuántos ítems van a cada lado

## 1. Las tres capas, que hoy se confunden

La corrección 3.1 del análisis del catálogo web dejó una sola fuente de verdad,
y eso hace que la pregunta tenga tres respuestas distintas, no una:

| Capa | Qué contiene | Quién la ve |
|---|---|---|
| **Consola** | **Todo.** Es la fuente única. | El comercio |
| **Catálogo web** | Lo que el comercio quiere vender por chat | El cliente final, navegando |
| **Prompt del asistente** | Lo que el asistente puede citar de memoria | Nadie: es interno |

La pregunta «cuántos ítems van al catálogo web y cuáles quedan solo en la
consola» se descompone en dos cortes independientes, y **cada uno se decide con
un criterio distinto**.

---

## 2. El corte del prompt: cuesta mucho menos de lo que parece

El catálogo, cuando va al prompt, viaja en el prefijo que se reenvía en **cada
llamada al modelo**. Ese era el argumento para acotarlo. Con la caché del
prefijo puesta y las tarifas de octubre, el argumento se cae:

| Ítems en el prompt | Tokens | Sin caché | **Con caché** | Equivale a… |
|---|---|---|---|---|
| 10 | 100 | 0,0036 Bs | 0,0012 Bs | 0,01 mensajes |
| 20 | 200 | 0,0072 Bs | 0,0023 Bs | 0,02 mensajes |
| 50 | 500 | 0,0180 Bs | 0,0058 Bs | 0,04 mensajes |
| 100 | 1.000 | 0,0360 Bs | 0,0117 Bs | 0,09 mensajes |
| 200 | 2.000 | 0,0720 Bs | 0,0234 Bs | 0,17 mensajes |
| **500** | 5.000 | 0,1800 Bs | **0,0585 Bs** | **0,43 mensajes** |

**Quinientos productos en el prompt cuestan menos que la mitad de un mensaje del
asistente.** El token dejó de ser la restricción el día que Meta empezó a cobrar
por mensaje.

Eso invierte el criterio del documento del catálogo web, que proponía un umbral
para que «el catálogo deje de crecer dentro de cada mensaje». **El umbral sigue
existiendo, pero ya no lo fija el costo.**

## 3. Lo que sí cuesta: cuántos mensajes toma cada camino

| Camino | Mensajes del asistente | Costo |
|---|---|---|
| Catálogo en el chat, 20 productos (hoy) | 13 | 1,885 Bs |
| Catálogo en el chat, catálogo grande | 18 | 2,602 Bs |
| **Enlace al catálogo web, cliente decidido** | **4** | **0,589 Bs** |
| Enlace + una consulta antes de decidir | 6 | 0,876 Bs |
| **Enlace + el cliente pregunta igual** | 9 | 1,309 Bs |

**El camino web gana siempre**, incluso en el peor caso, donde el cliente recibe
el enlace y aun así pregunta por chat: ahí se pagan los dos caminos y todavía se
ahorran cuatro mensajes.

Ese peor caso es el que hay que vigilar. **Mandar el enlace no ahorra nada si el
asistente sigue conversando el pedido igual.** El ahorro aparece cuando el
enlace *reemplaza* la conversación, no cuando la acompaña.

## 4. Lo que fija el umbral de verdad

Tres límites, ninguno económico:

**Legibilidad del chat.** Un mensaje con la lista de productos:

| Productos | Caracteres | |
|---|---|---|
| 5 | ~150 | legible |
| 10 | ~300 | legible |
| 20 | ~600 | en el límite |
| 40 | ~1.200 | ilegible en un chat |
| 80 | ~2.400 | ilegible |

**La lista interactiva de WhatsApp** admite 10 filas por sección y 10 secciones.
Es un tope duro del canal, no nuestro.

**La confiabilidad del modelo.** Es el límite que no se puede calcular desde
acá. El prompt del Demo A maneja 8 servicios y funciona; **nadie probó con 100**.
Cuanto más larga la lista, más probable que el asistente cite mal un precio, y
**cada corrección es un mensaje cobrado** más un riesgo de prohibición 6.

## 5. Recomendación sobre el catálogo

**Al catálogo web: todo lo que el comercio quiera vender.** No hay razón para
acotarlo. Una página web muestra 500 productos sin problema, y es el camino más
barato.

**Al prompt: hasta 40 ítems, con el nombre y el precio.** Por debajo de 40 el
asistente puede cotizar de memoria, que evita el enlace en la consulta rápida
—«¿cuánto está la casaca negra?»— y ahí sí gana el chat. Por encima de 40 la
lista deja de ser legible y el riesgo de que el modelo cite mal crece sin
compensación.

**Por encima de 40, al prompt va un resumen, no la lista:** las categorías, el
rango de precios y la instrucción de mandar el enlace. Así el asistente sabe
**qué vende el negocio** sin conocer cada ítem, que es lo que necesita para no
inventar y para derivar bien.

**Solo en la consola, fuera del catálogo web:** lo que no se puede vender por
chat sin una persona. Productos sin stock, los que se cotizan a medida, los que
necesitan medida o instalación, y los servicios sin precio del Flujo A —los que
hoy quedan «a consultar»—. **Publicar en el catálogo web algo que no se puede
comprar es la forma más cara de generar una conversación**: el cliente pregunta,
el asistente no puede cerrar, y son mensajes pagados sin venta.

| Cuántos ítems | Al prompt | Al catálogo web |
|---|---|---|
| 1 a 40 | la lista completa con precios | todos |
| 41 a 200 | resumen: categorías y rango de precios | todos |
| más de 200 | resumen, y revisar si el chat es el canal correcto | todos |

**Los 40 son una recomendación, no una medición.** El número que falta es a
partir de cuántos ítems el asistente empieza a equivocarse, y eso se prueba con
un catálogo real y las suites de aceptación, no con una hoja de cálculo.

---

# PARTE 2 · ¿Conviene cobrar distinto por flujo?

## 6. La diferencia existe, y está por darse vuelta

| Escenario | Flujo A | Flujo B | B contra A |
|---|---|---|---|
| **Hoy**: A 10 mensajes, B 13 (catálogo en el chat) | 1,508 Bs | 1,885 Bs | **+25 %** |
| **Con catálogo web**: A 10, B 4 | 1,508 Bs | 0,589 Bs | **−61 %** |
| Los dos optimizados: A 6, B 4 | 0,930 Bs | 0,589 Bs | −37 % |
| Los dos largos: A 20, B 20 | 2,943 Bs | 2,889 Bs | −2 % |

**Hoy el Flujo B es el caro y en unas semanas va a ser el barato.** Dos causas
que se compensan y luego se invierten:

- B manda más mensajes: la lista de bienvenida, el QR y la confirmación son tres
  que A no tiene. El catálogo web se lleva casi todos.
- A paga el recordatorio, que es una plantilla cobrada. B no manda ninguna.

Sobre un plan de 200 conversaciones, la diferencia es material en las dos
direcciones:

| | Costo mensual | Margen sobre 450 Bs |
|---|---|---|
| Flujo A, 10 mensajes | 166 Bs | 63 % |
| Flujo B hoy, 13 mensajes | 241 Bs | 46 % |
| Flujo B con catálogo web, 4 mensajes | **9 Bs** | **98 %** |

## 7. Por qué no conviene cobrar distinto

**Primero, porque la diferencia se invierte.** Poner hoy un recargo al Flujo B
—17 % de un plan— obligaría a quitarlo en semanas y a explicar por qué. Fijar
precios sobre una diferencia inestable es lo que hay que evitar.

**Segundo, porque el sistema ya cobra distinto sin decirlo.** Un comercio con los
dos flujos tiene **dos números, y por lo tanto dos franquicias de 1.000
mensajes**:

| 100 conversaciones de reservas + 100 de pedidos | Costo mensual |
|---|---|
| Si compartieran un número | 203,6 Bs |
| **Con un número por flujo (lo que ya hacemos)** | **68,0 Bs** |

**El negocio con dos flujos ya sale 135,6 Bs más barato al mes**, sin tocar el
precio. La estructura que teníamos por una limitación técnica —un flujo, un
número— resultó ser un descuento por multiproducto que se aplica solo.

**Tercero, porque la diferencia ya está atada a una función, no a un flujo.** Lo
que encarece al Flujo A es el recordatorio, que es una plantilla cobrada. Y el
recordatorio **ya está en el plan Crecimiento** y no en el Impulso. O sea que la
diferenciación por costo **ya existe en la oferta**, expresada como
característica, que es como un cliente la entiende.

**Cuarto, por el costo de la complejidad.** Dos listas de precios significan dos
tablas en el prepago, dos columnas en la consola, dos discursos en la venta y la
pregunta inevitable de qué paga un negocio con los dos flujos. Todo eso para
repartir una diferencia que la franquicia ya compensa.

## 8. Recomendación sobre el precio por flujo

**No cobrar distinto por flujo. Cobrar por volumen y por funciones**, que es lo
que la oferta ya hace.

Y aprovechar comercialmente lo que el sistema ya regala: **al comercio que suma
el segundo flujo le sale más barato de lo que parece**, porque estrena una
franquicia entera de Meta. Es un argumento real para vender reservas y pedidos
juntos, y hoy no lo estamos usando.

### Cuándo sí habría que revisarlo

- **Si un flujo nuevo tuviera un costo estructuralmente distinto que no
  converge.** El candidato claro es el cobro real con lectura del comprobante:
  agrega llamadas al modelo con visión, que hoy no se pagan en ningún flujo. Si
  se enciende, hay que medirlo antes de incluirlo en los planes.
- **Si el catálogo web no llega a ponerse en marcha.** Mientras el Flujo B
  siga mandando 13 mensajes por pedido, cuesta un 25 % más y el margen del plan
  cae de 63 % a 46 %. **No justifica un precio distinto, pero sí prioriza el
  catálogo web**, que es la conclusión a la que ya se había llegado por otro
  camino en `14-…` §7.2.

---

## 9. Lo que hay que medir

Las dos partes dependen de números que hoy nadie tiene, y los dos se sacan de
los mismos datos que la ingesta ya escribe:

1. **A partir de cuántos ítems el asistente cita mal un precio.** Se prueba con
   un catálogo real contra la suite del Demo B. Es lo que confirma o mueve los
   40 de la §5.
2. **Cuántos clientes usan el enlace y cuántos preguntan igual.** Decide si el
   catálogo web ahorra 9 mensajes o solo 4. Se ve comparando los mensajes por
   conversación antes y después de encenderlo, en el mismo comercio.
