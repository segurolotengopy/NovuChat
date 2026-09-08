# ¿Conviene cambiar la unidad de cobro?

**08-sep-2026.** Análisis **comercial** de tres modalidades: seguir cobrando por
**conversación de 24 horas**, pasar a cobrar **por respuesta del asistente**, o
pasar a una **conversación general** —un asunto, dure lo que dure—.

Los costos vienen de `14-costo-por-conversacion-y-precios.md` y del modelo
`14-modelo-costos.py`, con las tarifas de Meta del 1 de octubre de 2026.

**Conclusión, adelantada:** conviene **quedarse en la conversación de 24 horas**
y decir en voz alta el tope de mensajes. Cobrar por respuesta arregla un problema
que el tope ya arregla, y lo paga con lo único que un cliente chico no perdona,
que es no saber cuánto va a pagar. La conversación general es la más linda de
vender y la única que empeora el negocio sin techo. El detalle está abajo,
incluido el argumento que hoy está publicado y que habría que corregir igual.

---

> ## ✅ DECIDIDO — 2026-09-08, Andres
>
> **Se sigue con el modelo actual: la unidad de cobro es la conversación de 24
> horas.** No se cambia a cobro por respuesta ni a conversación general.
>
> **La decisión queda sujeta a revisión con los parámetros del §8.** No es una
> decisión definitiva: es la correcta con lo que se sabe hoy, y se vuelve a mirar
> cuando haya datos de clientes reales. Los tres números que la revisan están en
> el §8 y **los tres salen de datos que el sistema ya escribe**; falta ponerlos
> en una pantalla.
>
> **Lo que esta decisión NO posterga**, porque es condición de haberla tomado:
>
> - **Publicar el tope de mensajes.** La frase «sin importar cuántos sean» de
>   `novuchat.site/precios` deja de ser cierta y hay que reescribirla **antes de
>   vender** (§4).
> - **Mostrar los mensajes en la consola**, junto a las conversaciones (§7).
>
> **Cuándo se revisa:** a los tres meses del primer cliente pagando, o antes si
> se dispara cualquiera de los tres disparadores del §7.

---

## 1. La pregunta, bien planteada

NovuChat **no vende uso: vende planes**. Un cliente paga 250 Bs y recibe una
cantidad incluida. La unidad de cobro no decide cuánto factura NovuChat: decide
cuatro cosas concretas.

| Qué decide la unidad | Por qué importa |
|---|---|
| **En qué se expresa el volumen incluido** | «300 conversaciones» o «2.400 respuestas» |
| **Cómo se cobra el excedente** | Es donde el cliente siente la unidad de verdad |
| **Cuándo se corta el servicio** | El prepago corta al agotarse, y corta contando algo |
| **Qué historia se cuenta** | Lo que el cliente entiende, y lo que teme |

Así planteada, la pregunta no es «¿por qué cobramos?», es **«¿en qué unidad
denominamos el plan, el excedente y el corte?»**. Es una decisión más chica de lo
que parece, y por eso conviene tomarla con datos y no con intuición.

---

## 2. Lo que cuesta cada unidad

Costo real por unidad facturada, fuera de la franquicia de 1.000 mensajes:

| Largo de la conversación | Por conversación 24 h | Por respuesta | Por asunto (1,3 ventanas) |
|---|---|---|---|
| 4 mensajes | 0,643 Bs | 0,1608 Bs | 0,836 Bs |
| 6 mensajes | 0,930 Bs | 0,1550 Bs | 1,209 Bs |
| 8 mensajes | 1,218 Bs | 0,1523 Bs | 1,584 Bs |
| 10 mensajes | 1,508 Bs | 0,1508 Bs | 1,960 Bs |
| 15 mensajes | 2,226 Bs | 0,1484 Bs | 2,894 Bs |
| 20 mensajes | 2,943 Bs | 0,1472 Bs | 3,827 Bs |
| 30 mensajes | 4,379 Bs | 0,1460 Bs | 5,692 Bs |

**La columna del medio es casi una línea recta.** Entre una conversación de 4
mensajes y una de 30, el costo por respuesta varía un 9 %; el costo por
conversación varía **6,8 veces**.

Eso es todo el argumento económico a favor de cobrar por respuesta, y es un
argumento fuerte: **la unidad que se cobra sería la unidad que se paga**. El
margen dejaría de depender de cuánto conversen los clientes del comercio.

---

## 3. Las tres modalidades, cara a cara

| | **Conversación 24 h** (hoy) | **Por respuesta** | **Conversación general** |
|---|---|---|---|
| **Alineación con el costo** | Mala: varía ×6,8 | **Perfecta** | La peor: varía ×6,8 y además crece |
| **Previsibilidad para el cliente** | **Alta**: sabe cuántas compró | Baja: no controla cuántos mensajes hacen falta | Alta |
| **Facilidad de explicar** | Alta | Media | **La más alta** |
| **Riesgo de cola para NovuChat** | Acotado con el tope | **Nulo** | **Sin techo** |
| **Alineación con WhatsApp** | Exacta: es la ventana de Meta | Exacta: es lo que Meta cobra | **Ninguna**: inventa un límite que Meta no tiene |
| **Costo de cambiar** | — | Medio | Alto |

### Por qué la conversación general se cae sola

Es la más atractiva de vender: «una conversación es un cliente atendido, tarde lo
que tarde». Y es la única de las tres que **empeora el negocio sin límite**.

Un asunto que se estira dos días son **dos ventanas de 24 horas**, cada una con
sus mensajes cobrados, facturadas como una sola unidad:

| Asuntos que abarcan más de una ventana | Costo por unidad facturada |
|---|---|
| 0 % | 1,508 Bs |
| 10 % | 1,658 Bs (+10 %) |
| 25 % | 1,885 Bs (+25 %) |
| 40 % | 2,111 Bs (+40 %) |
| 60 % | 2,412 Bs (+60 %) |

Y ese porcentaje **no lo controla nadie**: depende de si el cliente final
contesta hoy o mañana. En un rubro de citas —donde el cliente escribe, lo piensa,
y confirma al día siguiente— puede ser alto.

Hay además un problema técnico que la vuelve cara de construir: **fuera de la
ventana de 24 horas no se puede escribir sin plantilla**. Un asunto de tres días
obliga a plantillas para retomarlo, cada una cobrada. La ventana de 24 horas no
es una convención de NovuChat: es el límite real de WhatsApp, y toda la
plataforma —`HORAS_VENTANA_ATENCION`, `atencionDesde`, el contador de la consola,
el corte del prepago— está construida sobre ella.

**Descartada.** No por difícil: por cara y por no acotada.

---

## 4. El argumento del incentivo, que está publicado y está incompleto

Hoy `novuchat.site/precios` dice, con estas palabras:

> «Una conversación son todos los mensajes que intercambias con un mismo cliente
> durante 24 horas continuas, **sin importar cuántos sean**. […] Lo hacemos así
> porque es la única medida que no te castiga por conversar. **Cobrar por mensaje
> empuja a responder corto, y un asistente que responde corto vende menos.**»

El argumento es correcto y hay que tomarlo en serio: si el cliente paga por
mensaje, va a querer que el asistente hable poco, y un asistente que corta la
conversación vende menos. Es un argumento comercial de peso contra la modalidad
por respuesta.

**Pero está incompleto, y desde octubre la parte que falta importa.**

El incentivo a responder corto **ya existe**. Solo que hoy lo tiene NovuChat, no
el cliente: cada respuesta le cuesta 0,1356 Bs, y todo el §7 del análisis de
costos es, precisamente, una lista de formas de que el asistente hable menos.
Cobrar por conversación no elimina ese incentivo: **lo mueve al lado que el
cliente no puede auditar.**

Dicho de frente:

| Modalidad | Quién quiere que el asistente hable menos | ¿El cliente lo puede ver? |
|---|---|---|
| Por conversación | NovuChat | **No** |
| Por respuesta | El cliente | Sí |

Ninguna de las dos es limpia. La diferencia es que en una el conflicto es visible
y negociable, y en la otra es invisible. Eso no alcanza para cambiar de unidad,
pero sí obliga a dos cosas: **no usar ese argumento como si NovuChat estuviera
libre de él**, y medir el largo de la conversación como métrica de calidad, no
solo de costo.

### Y hay una frase que hay que corregir igual

«**Sin importar cuántos sean**» deja de ser cierta el día que entre el tope de 20
a 30 mensajes. No es un detalle de redacción: es exactamente lo que un cliente
podría reclamar. Se cambie o no la unidad, **esa frase hay que reescribirla antes
de vender**.

---

## 5. El hallazgo que resuelve la discusión

**La conversación con tope ya es un paquete de mensajes con precio fijo.**

El tope de 20 / 25 / 30 mensajes que propone el análisis de costos convierte la
unidad actual en algo que se describe así: *hasta 20 respuestas del asistente en
24 horas, por un precio fijo*. Eso **es** cobro por mensaje, con dos diferencias,
y las dos favorecen al cliente:

1. **Se redondea hacia arriba**: el que usa 6 mensajes paga lo mismo que el que
   usa 20. No lo castiga por conversar.
2. **El techo es conocido de antemano.** El cliente sabe el máximo por
   conversación y el máximo del mes.

Con el tope puesto, la variación de costo por unidad deja de ser ×6,8 y pasa a
ser ×4,6 como máximo (de 4 a 20 mensajes), y **el peor caso está acotado**: una
conversación no puede costar más de 2,94 Bs en el plan Impulso. El problema que
la modalidad por respuesta venía a resolver, **ya está resuelto**.

Lo que queda sin resolver es más chico: un comercio cuyos clientes conversen
sistemáticamente al tope rinde menos que uno de conversaciones cortas. Eso se
maneja con el volumen incluido del plan, que es lo que el análisis de costos ya
propone.

---

## 6. Qué cuesta cambiar de unidad

No es gratis, y conviene tenerlo a la vista antes de decidir.

| Qué hay que tocar | Por respuesta | Conversación general |
|---|---|---|
| `novuchat.site/precios`, glosario y FAQ | Reescribir la sección «Cómo contamos» entera, y **contradecir en público un argumento propio** | Reescribir |
| Presentación comercial | Rehacer los tres planes | Rehacer |
| `prepago.ts`, planes, bolsas, corte | Cambiar la unidad del saldo y del corte | Ídem, más definir cuándo termina un asunto |
| `ingesta.ts`, contadores | Ya cuenta mensajes (`respuestasDelPeriodo`): **el dato existe** | Contador nuevo, con una regla de cierre de asunto que hoy no existe |
| Consola: pantalla de consumo | Cambiar la cifra principal | Ídem |
| Contratos ya firmados | Ninguno todavía: es el mejor momento para cambiar | Ídem |

**Dos observaciones que pesan.** La primera: como todavía **no hay ningún
cliente pagando**, el costo de cambiar nunca va a ser más bajo que hoy. Si se va
a cambiar, es ahora. La segunda: el sistema **ya cuenta mensajes**, así que la
modalidad por respuesta no exige instrumentación nueva, solo cambiar qué número
se muestra y se cobra.

---

## 7. Recomendación

**Quedarse en la conversación de 24 horas, con el tope, y decirlo.**

Tres razones, en orden:

1. **El tope ya captura casi toda la alineación** que daría el cobro por
   respuesta (§5), sin transferirle al cliente la incertidumbre.
2. **La previsibilidad es el argumento de venta más fuerte que tiene NovuChat**
   frente a una PyME que automatiza por primera vez. «300 conversaciones» se
   entiende y se compara; «2.400 respuestas» obliga al cliente a estimar cuántas
   respuestas necesita una venta, que es justo lo que no sabe.
3. **La unidad ya está construida** en el prepago, en la consola, en el sitio y
   en la presentación. Cambiarla cuesta trabajo real y compra poco.

**Con dos condiciones, que no son opcionales:**

- **Publicar el tope.** Cambiar «sin importar cuántos sean» por algo como «hasta
  20 respuestas del asistente por conversación; si hace falta más, la toma una
  persona de tu equipo». Un límite que se explica es una característica; el mismo
  límite descubierto por el cliente es un reclamo.
- **Mostrar los mensajes en la consola**, junto a las conversaciones. Es el
  número que predice la factura de Meta y el que permite ver venir un comercio
  caro. Que sea la métrica interna aunque no sea la unidad de cobro.

### Cuándo sí habría que cambiar a cobro por respuesta

Vale la pena dejar escrito el disparador, para no volver a discutirlo desde
cero:

- Si al medir con clientes reales resulta que **más de un tercio de las
  conversaciones llegan al tope**. Querría decir que el tope está apretando el
  servicio y que la conversación dejó de ser una unidad natural.
- Si aparece un segmento de **conversaciones muy largas por naturaleza**
  —soporte técnico, consultas médicas— donde el tope no tiene sentido. Ahí
  conviene un plan por respuesta para ese segmento, no cambiar la unidad de
  todos.
- Si Meta subiera la tarifa de servicio de forma que el margen no aguante el
  redondeo hacia arriba. Con 0,0113 USD aguanta con holgura.

### Lo que no conviene hacer nunca

**Cobrar por respuesta y además por conversación**, o poner un excedente
denominado en mensajes sobre un plan denominado en conversaciones. Dos unidades
en la misma factura es la forma más rápida de que un cliente deje de entender lo
que paga, y de que la consola muestre un número que no coincide con la factura.

---

## 8. Qué medir para revisar esto en tres meses

Con los primeros clientes andando, tres números deciden si esta recomendación
sigue en pie. Los tres salen de datos que el sistema ya escribe:

1. **Distribución del largo de las conversaciones**, no el promedio. Si la cola
   por encima del tope es gruesa, la unidad está mal elegida.
2. **Ventanas de 24 horas por asunto.** Si un mismo teléfono abre dos ventanas
   por el mismo motivo con frecuencia, el cliente **ya está pagando dos** por lo
   que él considera una conversación, y eso es un reclamo esperando. Es el único
   dato que podría rehabilitar la conversación general, y hoy nadie lo tiene.
3. **Dispersión del margen entre comercios.** Si un comercio rinde 85 % y otro
   30 % con el mismo plan, la unidad no está repartiendo bien el costo.
