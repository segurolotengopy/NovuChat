# Sensibilidad de los topes de mensajes y de las bolsas

**08-sep-2026.** Análisis de sensibilidad de las dos palancas que quedaron
abiertas en `14-costo-por-conversacion-y-precios.md`: **el tope de mensajes por
conversación** y **el precio y tamaño de las bolsas**. Las dos se analizan
juntas porque interactúan: el tope fija el costo marginal de una conversación, y
ese costo es exactamente el que la bolsa tiene que cubrir.

Tarifas de Meta del 1 de octubre de 2026, 12 Bs/USD. Modelo:
`14-modelo-costos.py`.

**Los dos resultados que cambian lo propuesto:**

1. **El tope creciente por plan (20 / 25 / 30) está al revés.** Económicamente,
   el plan chico es el que puede permitirse el tope más generoso. Conviene un
   **tope único para los tres**.
2. **La bolsa del prepago pierde 176 Bs cada vez que se vende.** 150
   conversaciones por 50 Bs cobra el 22 % de lo que cuesta.

---

## 1. El tope: qué mueve y qué no

### 1.1 Lo que cuesta una conversación que llega al tope

| Tope | Costo de esa conversación | Contra una de 10 mensajes | Conversaciones gratis al mes si todas llegaran al tope |
|---|---|---|---|
| 8 | 1,218 Bs | 0,81× | 125 |
| 10 | 1,508 Bs | 1,00× | 100 |
| 12 | 1,795 Bs | 1,19× | 83 |
| 15 | 2,226 Bs | 1,48× | 66 |
| **20** | **2,943 Bs** | 1,95× | 50 |
| 25 | 3,661 Bs | 2,43× | 40 |
| 30 | 4,379 Bs | 2,90× | 33 |
| 40 | 5,814 Bs | 3,86× | 25 |

La última columna es la que suele pasarse por alto: **el tope no solo fija el
peor caso por conversación, fija cuántas conversaciones entran en la franquicia
de 1.000 mensajes.**

### 1.2 El tope solo importa si la cola es gruesa

El tope únicamente actúa sobre las conversaciones que lo tocan. Cuánto cuesta
depende de un número que **hoy nadie tiene medido**: qué porcentaje de las
conversaciones se irían largas si no hubiera tope. Lo llamamos «cola».

Margen del plan según el tope y la cola. Mezcla: 60 % de 4 mensajes, el resto de
10, y la cola en el tope.

**Impulso — 250 Bs, 120 conversaciones**

| Tope | Cola 2 % | 5 % | 10 % | 20 % | 30 % |
|---|---|---|---|---|---|
| 10 | 94 % | 94 % | 94 % | 94 % | 94 % |
| 15 | 94 % | 94 % | 94 % | 94 % | 94 % |
| 20 | 94 % | 94 % | 94 % | 93 % | 86 % |
| 25 | 94 % | 94 % | 94 % | 86 % | 76 % |
| 30 | 94 % | 94 % | 93 % | 79 % | 65 % |

**Crecimiento — 450 Bs, 200 conversaciones**

| Tope | Cola 2 % | 5 % | 10 % | 20 % | 30 % |
|---|---|---|---|---|---|
| 10 | 86 % | 86 % | 86 % | 86 % | 86 % |
| 15 | 86 % | 85 % | 83 % | 80 % | 77 % |
| 20 | 85 % | 83 % | 80 % | 73 % | 67 % |
| 25 | 84 % | 81 % | 77 % | 67 % | 57 % |
| 30 | 84 % | 80 % | 73 % | 61 % | 48 % |

**Pro — 850 Bs, 300 conversaciones**

| Tope | Cola 2 % | 5 % | 10 % | 20 % | 30 % |
|---|---|---|---|---|---|
| 10 | 81 % | 81 % | 81 % | 81 % | 81 % |
| 15 | 81 % | 80 % | 79 % | 76 % | 73 % |
| 20 | 80 % | 79 % | 76 % | 71 % | 66 % |
| 25 | 80 % | 77 % | 73 % | 66 % | 58 % |
| 30 | 79 % | 76 % | 71 % | 61 % | 51 % |

**Cómo se leen estas tablas:**

- **En Impulso el tope casi no mueve nada.** La fila del 94 % se sostiene hasta
  colas del 10 % con cualquier tope. La razón es la franquicia: 120
  conversaciones a 8,4 mensajes de promedio son unos 1.008 mensajes, o sea que
  el plan vive **dentro de los 1.000 gratis** y el tope solo decide cuánto se
  desborda.
- **En Crecimiento y Pro el tope decide el margen.** Entre el mejor y el peor
  caso hay 38 puntos porcentuales en Crecimiento y 30 en Pro.
- **La cola importa más que el tope.** Moverse de una cola del 2 % al 30 % pesa
  más que mover el tope de 10 a 30. Es el número que hay que medir primero.

### 1.3 El hallazgo: el tope creciente está al revés

Cuánto cuesta subir el tope de 20 a 30, con una cola del 10 %:

| Plan | Tope 20 | Tope 30 | Diferencia | Sobre el precio |
|---|---|---|---|---|
| Impulso | 15,5 Bs | 17,5 Bs | 2,0 Bs | **0,8 %** |
| Crecimiento | 90,9 Bs | 119,6 Bs | 28,7 Bs | **6,4 %** |
| Pro | 204,2 Bs | 247,3 Bs | 43,1 Bs | **5,1 %** |

**Ser generoso con el tope cuesta ocho veces menos en el plan chico que en los
grandes.** La propuesta de 20 / 25 / 30 —el tope crece con el plan— hace
exactamente lo contrario de lo que la economía sugiere.

Pero **la economía no puede mandar sola acá**, porque un plan caro con un tope
más chico que el barato es invendible: «pagás más y te cortan antes» no se
explica en una reunión.

**La salida es no usar el tope como diferenciador de plan.**

### 1.4 Recomendación sobre el tope

**Un tope único de 25 mensajes del asistente por conversación, igual para los
tres planes.**

- **Se fija por calidad de servicio, no por plan.** 25 respuestas del asistente
  en 24 horas es mucho más de lo que necesita una reserva o un pedido normal.
  Una conversación que pasa de ahí **no es un cliente exigente: es una
  conversación que se atascó**, y lo correcto es que la tome una persona.
- **Es defendible en una reunión**, que es lo que el tope escalonado no era:
  «hasta 25 respuestas por conversación, en todos los planes; si hace falta más,
  lo toma tu equipo».
- **El costo de la generosidad se cobra donde corresponde**, en el volumen
  incluido de cada plan, que ya está calculado en `14-…` §5.
- **Con cola del 10 % y tope 25**, los márgenes quedan en 94 / 77 / 73 %. Con
  cola del 20 %, en 86 / 67 / 66 %. Aguanta.

**Lo que el tope le cuesta al cliente, y que este análisis no puede costear.**
Cada conversación que toca el tope se deriva a una persona. Con una cola del
10 %: 12 derivaciones al mes en Impulso —una cada dos días y medio— y 30 en Pro,
una por día. Es manejable, pero **es trabajo humano que el comercio tiene que
poder absorber**, y hay que decirlo en la venta.

---

## 2. Las bolsas

### 2.1 La bolsa actual pierde plata en cada venta

Una conversación de bolsa se consume **siempre fuera de la franquicia**: se
aplica después de las incluidas, y las incluidas ya agotaron los 1.000 gratis.
Paga tarifa completa, sin excepción.

| Largo de la conversación | Costo |
|---|---|
| 6 mensajes | 0,930 Bs |
| 10 mensajes | 1,508 Bs |
| 15 mensajes | 2,226 Bs |
| 20 mensajes | 2,943 Bs |
| 25 mensajes | 3,661 Bs |

**La bolsa del prepago son 150 conversaciones por 50 Bs: 0,333 Bs cada una.** Es
el **22 %** de lo que cuesta una conversación típica.

| Si las conversaciones son de… | Costo de la bolsa | Se cobra | **Pérdida por bolsa vendida** |
|---|---|---|---|
| 10 mensajes | 226 Bs | 50 Bs | **−176 Bs** |
| 20 mensajes | 442 Bs | 50 Bs | **−392 Bs** |

Y como la bolsa la compra quien agotó su plan, **cada venta de bolsa se lleva
más margen que el que dejó la mensualidad**: 176 Bs de pérdida contra los 175 Bs
de margen que deja un Impulso entero.

### 2.2 Qué debería costar

Precio necesario para un margen de 3× sobre el costo, redondeado a 10 Bs:

| Tamaño | Si son de 10 mensajes | 15 | 20 | 25 |
|---|---|---|---|---|
| 10 | 50 Bs | 70 Bs | 90 Bs | 110 Bs |
| **25** | **110 Bs** | 170 Bs | 220 Bs | 270 Bs |
| 50 | 230 Bs | 330 Bs | 440 Bs | 550 Bs |
| 100 | 450 Bs | 670 Bs | 880 Bs | 1.100 Bs |
| 150 | 680 Bs | 1.000 Bs | 1.320 Bs | 1.650 Bs |

**Una bolsa de 150 debería costar entre 680 y 1.650 Bs**, no 50. Es decir: **el
tamaño de la bolsa está mal antes que el precio.** Una bolsa que cuesta más que
el plan Pro no es un complemento, es otro plan.

### 2.3 Selección adversa: quien compra bolsa no es el cliente promedio

Un comercio compra bolsa porque agotó su plan. Por definición **conversa más que
el promedio**, y es razonable suponer que también más largo.

Bolsa de 25 conversaciones precificada a 110 Bs, suponiendo 10 mensajes:

| Si en realidad se consume a… | Costo | Margen |
|---|---|---|
| 10 mensajes | 37,7 Bs | 66 % |
| 15 mensajes | 55,6 Bs | 49 % |
| 20 mensajes | 73,6 Bs | 33 % |
| 25 mensajes | 91,5 Bs | **17 %** |

**El margen de la bolsa se derrite si el comprador conversa largo.** Por eso la
bolsa hay que precificarla contra un largo pesimista, no contra el promedio. Con
el tope de 25 del §1.4, el peor caso está acotado y **110 Bs por 25 deja 17 % en
el peor escenario y 66 % en el esperado**. Es un rango aceptable; a 80 Bs no lo
sería.

### 2.4 Que no venzan transfiere el riesgo de tarifa

El prepago decidió que **las bolsas no vencen**. Comercialmente está bien: es
generoso y evita el reclamo de «pagué y lo perdí». Pero Meta puede cambiar la
tarifa **cada trimestre**, y una bolsa vendida hoy puede consumirse dentro de
seis meses a otro costo.

Bolsa de 25 a 110 Bs, según cuánto suba la tarifa de servicio:

| Subida de la tarifa | Costo | Margen |
|---|---|---|
| 0 % | 37,7 Bs | 66 % |
| +10 % | 41,1 Bs | 63 % |
| +25 % | 46,2 Bs | 58 % |
| +50 % | 54,6 Bs | 50 % |
| +100 % | 71,6 Bs | 35 % |

**El riesgo es tolerable a este tamaño de bolsa, y no lo sería con bolsas
grandes.** Una bolsa de 150 no vencida es un compromiso de tarifa a plazo
indefinido sobre 150 conversaciones. Otro argumento para bolsas chicas.

Dos mitigaciones, y **la primera es suficiente**:

1. **Bolsas chicas** (10 a 25). El compromiso se consume rápido.
2. Vencimiento a 12 meses. Es la mitigación completa, pero pelea con la decisión
   comercial ya tomada y con el argumento de generosidad. **No hace falta si las
   bolsas son chicas.**

### 2.5 La bolsa no puede competir con el plan

Si una conversación de bolsa sale más barata que una de plan, el cliente compra
bolsas y no sube nunca de plan. El orden correcto es: **incluida < subir de plan
< bolsa.**

| | Bs por conversación |
|---|---|
| Incluida en Impulso | 2,08 |
| Incluida en Crecimiento | 2,25 |
| Incluida en Pro | 2,83 |
| **Subir de Impulso a Crecimiento** (200 Bs por 80 conversaciones más) | **2,50** |
| **Bolsa de 25 a 110 Bs** | **4,40** |

Con la bolsa a 4,40 Bs por conversación, el orden se cumple: **al cliente que
compra bolsas dos meses seguidos le conviene subir de plan**, que es lo que
tiene que pasar. La bolsa es un puente, no un sustituto.

### 2.6 Recomendación sobre las bolsas

**Bolsa de 25 conversaciones por USD 10**, en reemplazo de las 150 por 50 Bs.

> **Actualizado el 08/09:** los precios pasaron a estar denominados en dólares
> (`14-…` §5ter). Los 110 Bs de este análisis equivalen a USD 9,17; se redondea
> a **USD 10** (120 Bs), que deja **69 % de margen esperado y 24 % en el peor
> caso** de la selección adversa — algo mejor que los 110 Bs analizados abajo.
> El resto del análisis se conserva en bolivianos porque es donde se hicieron
> las mediciones.

- Es el tamaño que mantiene bajo el riesgo de tarifa (§2.4) y el que sobrevive a
  la selección adversa (§2.3).
- Preserva el orden contra el plan (§2.5).
- Es una compra chica: 110 Bs se aprueba sin pensarlo, 680 Bs se discute.
- **Se puede seguir diciendo que no vence**, que era la parte linda de la
  decisión original.

**La alternativa de 100 Bs, y su letra chica.** Un precio más redondo para el
discurso comercial sería **100 Bs por 25 conversaciones** (4,00 Bs cada una).
Sigue cumpliendo el orden contra el plan (§2.5) y deja **62 % de margen
esperado**, pero **solo 8 % en el peor caso** de la selección adversa, contra
17 % de la opción de 110.

| | Margen esperado (10 msj) | Peor caso (25 msj) | Bs por conversación |
|---|---|---|---|
| 25 por **110 Bs** | 66 % | **17 %** | 4,40 |
| 25 por **100 Bs** | 62 % | **8 %** | 4,00 |

Los 10 Bs de diferencia compran más de la mitad del colchón. **Recomiendo los
110 Bs**; si se prefiere el número redondo, que sea una decisión tomada sabiendo
que la bolsa deja de rendir con un comercio muy conversador.

---

## 3. Resumen de cambios propuestos

| | Está hoy en el prepago | Propuesto | Por qué |
|---|---|---|---|
| **Tope de mensajes** | No existe | **25, único para los tres planes** | El escalonado está al revés económicamente y es invendible al revés. §1.3 |
| **Bolsa** | 150 conversaciones por 50 Bs | **25 conversaciones por USD 10** | La actual pierde 176 Bs por venta. §2.1 |
| Vencimiento de la bolsa | No vencen | Sin cambio | Con bolsas chicas el riesgo de tarifa es tolerable. §2.4 |

Los dos cambios son de datos, no de arquitectura: viven en la tabla de planes de
`functions/src/prepago.ts`, que el propio diseño dejó en un solo lugar y puro. El
tope es lo único que además necesita código en los flujos.

---

## 4. Lo que hay que medir para cerrar esto

Este análisis depende de **un solo número que nadie tiene**: la **cola**, o sea
qué porcentaje de las conversaciones se irían largas sin tope. Todo lo demás sale
de las tarifas publicadas.

- Con cola ≤ 10 %, cualquier tope entre 20 y 30 funciona y la decisión es de
  servicio, no de costo.
- Con cola ≥ 20 %, el tope pasa a decidir el margen de Crecimiento y Pro, y
  **conviene bajarlo a 20 y trabajar el prompt** para acortar la conversación
  (`14-…` §7.3).

**Se mide con los datos que la ingesta ya escribe**: `respuestasDelPeriodo` por
conversación. Falta agruparlo y mirarlo como distribución, no como promedio. Es
la primera pantalla que conviene tener cuando haya clientes reales, y es la misma
que pide la revisión de la unidad de cobro (`15-unidad-de-cobro.md` §8).
