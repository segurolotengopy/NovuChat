# La propuesta de Silvana, comparada

**08-sep-2026.** Análisis de «Ajuste Estratégico de Precios y Volúmenes
(Octubre 2026)» contra el modelo de `14-costo-por-conversacion-y-precios.md` y
`16-sensibilidad-topes-y-bolsas.md`.

**El resumen:** la propuesta **mejora la mía en los tres planes** y aporta algo
que a mi análisis le faltaba, que son los impuestos. Contiene **una afirmación de
seguridad mal enunciada** —el 32 % es el caso central, no un piso— pero **el
efecto de eso es mucho menor de lo que dije en la primera versión de este
documento**.

> ⚠️ **Este documento se corrigió el 08/09 por la tarde.** La versión anterior
> recomendaba subir el plan grande a USD 100 o bajarlo a 400 conversaciones.
> **Esa recomendación se retira.** Al analizar el argumento del uso incompleto
> —el que motivó la propuesta de Silvana— resultó que yo había medido el riesgo
> sobre un cliente y no sobre la cartera, que es donde se decide un precio. Con
> la cartera a la vista, **USD 90 por 500 conversaciones es la elección
> correcta**. El §9 tiene el análisis completo.

---

## 1. Lo que la propuesta hace mejor que mi análisis

**Incluye los impuestos, y mi análisis no.** Todos mis márgenes eran **antes** de
IVA e IT. Los de Silvana son después. Es una mejora real y desde ahora hay que
trabajar con su marco, no con el mío. *(El tratamiento del 13 % trimestral
neteado con facturas de compras es una decisión de ella y de contabilidad: lo
tomo como dado, no lo valido.)*

**Su costo de Meta es conservador.** Usa 0,14 Bs por mensaje; el real es 0,1356.
Sobreestima un 3 %, que es el lado correcto para equivocarse.

**El plan Base a 100 conversaciones es elegante, y no creo que sea casualidad.**
100 × 10 mensajes = exactamente los 1.000 de la franquicia de Meta. **Ese plan no
le cuesta a NovuChat ni un centavo de mensajería**, y por eso rinde 79 % después
de impuestos. Es el mejor plan de los seis que hay entre las dos propuestas.

**Conserva las tres protecciones**: el tope de 25, la bolsa a USD 10 por 25, y la
cláusula de revisión.

**Y el argumento comercial es correcto.** «Medio millar de atenciones» vende más
que 300, y el costo unitario decreciente es un buen gancho. No lo discuto: lo que
discuto abajo es cuánto cuesta sostenerlo.

---

## 2. Los números, corregidos

Su tabla omite dos costos: **el modelo de IA y el recordatorio**. Son chicos pero
existen, y con la mezcla de planes que propone mueven el margen entre 2 y 5
puntos.

| Plan | Precio | Meta (ella) | Meta (real) | Modelo | Recordatorio | IVA/IT | **Ganancia real** | **Margen real** | Margen que declara |
|---|---|---|---|---|---|---|---|---|---|
| Base | USD 25 | 0,00 | 0,00 | 0,81 | 0,45 | 4,00 | **19,74** | **79 %** | 84 % |
| Crecimiento | USD 50 | 14,00 | 13,56 | 1,79 | 0,99 | 8,00 | **25,66** | **51 %** | 56 % |
| Corporativo | USD 90 | 46,67 | 45,20 | 4,06 | 2,26 | 14,40 | **24,08** | **27 %** | 32,1 % |

*(A 10 mensajes por conversación, que es su supuesto.)*

**La corrección no cambia el sentido de nada.** Base y Crecimiento siguen siendo
excelentes. Corporativo pasa de 32 % a 27 %, y ahí sí importa, porque 32 % era el
piso que la propuesta promete.

---

## 3. El 32 % no es un piso, es el caso central

La propuesta dice, textualmente, que el margen «**jamás caiga por debajo del
32 %**, asumiendo el peor escenario (donde el cliente consume el 100 % de su
plan)».

**Consumir el 100 % del plan no es el peor escenario.** Es el escenario central.
El peor escenario es consumirlo **con conversaciones largas**, y el tope de 25
que la propia propuesta conserva permite exactamente eso.

| Plan | A 10 mensajes | A 15 mensajes | Todas al tope de 25 |
|---|---|---|---|
| Base | 79 % | 55 % | **7 %** |
| Crecimiento | 51 % | 25 % | **−28 %** |
| Corporativo | **27 %** | **−6 %** | **−73 %** |

**Corporativo se da vuelta a los 14 mensajes por conversación.** No hace falta un
cliente abusivo: basta un comercio cuyos clientes conversen algo más que el
promedio.

Y no se arregla con el precio. Para garantizar 32 % con 500 conversaciones
**todas al tope**, habría que cobrar **USD 275**.

**Lo que hay que corregir es la frase, no el plan.** El §9 muestra por qué: esta
tabla describe **un cliente en su peor día**, y un precio se decide sobre la
cartera. Puestos uno al lado del otro, el peor cliente pierde USD 66 al mes y uno
normal deja USD 55: **hacen falta 46 clientes malos de cada 100 para que el plan
grande pierda plata**.

### Por qué pasa, y no es un error de cálculo

Es estructural. **El costo marginal de una conversación es plano**: 0,0113 USD
por mensaje, igual en todos los planes, porque después de la franquicia Meta
cobra lo mismo a todos. Un precio unitario decreciente —0,25 / 0,23 / 0,18—
contra un costo unitario constante **comprime el margen mecánicamente**, y
concentra todo el riesgo en el plan más grande.

Dicho de otro modo: el plan Corporativo tiene **cinco veces el volumen del Base y
la misma ganancia absoluta** (USD 24 contra USD 20). Está aceptando cinco veces
la exposición por el mismo dinero.

### Y la exposición no es solo al largo de la conversación

Meta puede mover la tarifa **cada trimestre, con un mes de aviso**:

| Plan | Tarifa actual | +10 % | +25 % | +50 % |
|---|---|---|---|---|
| Base | 79 % | 79 % | **79 %** | **79 %** |
| Crecimiento | 51 % | 49 % | 45 % | 38 % |
| Corporativo | 27 % | 22 % | **14 %** | **2 %** |

**El plan Base es inmune** porque vive dentro de la franquicia. El Corporativo se
queda sin colchón con una subida que Meta puede decidir sola.

---

## 4. El problema de vocabulario, que es fácil y urgente

La propuesta vende **«100 / 220 / 500 atenciones»**.

En el vocabulario que NovuChat ya tiene publicado, **«atención» no es la unidad
que se factura**. El glosario de `novuchat.site/precios` dice, hoy:

> «**Atención.** Una persona distinta atendida en el período. Si el mismo cliente
> vuelve tres veces en el mes, son tres conversaciones y una sola atención. **No
> se factura**: es un dato para que sepas a cuánta gente distinta llegaste.»

Si la presentación vende «500 atenciones» y el sitio dice que las atenciones no
se facturan, **un cliente que mire los dos materiales encuentra la
contradicción**. Y la consola muestra las dos cifras por separado, así que la
vería igual al mes siguiente.

**Es de una línea:** decir **conversaciones** en la presentación. La cifra no
cambia, el atractivo tampoco, y desaparece el problema.

---

## 5. La comparación, plan por plan

Con la mezcla realista —60 % de 5 mensajes, 30 % de 10, 10 % al tope— y después
de impuestos:

| | Mi propuesta | Margen | Propuesta de Silvana | Margen | Quién gana |
|---|---|---|---|---|---|
| Base | USD 20 / 120 | 76 % | **USD 25 / 100** | **79 %** | **Silvana** |
| Crecimiento | USD 40 / 200 | 58 % | **USD 50 / 220** | **59 %** | **Silvana**, y por más volumen |
| Corporativo | USD 70 / 300 | 54 % | **USD 90 / 500** | 37 % | **Silvana**, en dinero: ver §9 |

**En los tres, su propuesta es mejor que la mía**: cobra más, ofrece más y trae
más dinero a la caja. En Corporativo mi margen porcentual es mayor, pero **el
margen porcentual no paga sueldos**: en dólares el suyo rinde más en todo el
rango realista de uso. El §9 lo demuestra.

---

## 6. Recomendación

**Adoptar la propuesta de Silvana, con dos correcciones y una aclaración.**

### 6.1 Corregir «atenciones» por «conversaciones» (§4)

De una línea, y evita una contradicción visible.

### 6.2 El plan Corporativo se deja como está: USD 90 / 500

**Retiro la recomendación anterior de subirlo a USD 100 o bajarlo a 400.** El
análisis del §9 muestra que el plan grande es, en cartera, el mejor de los tres,
y que el riesgo que yo había señalado es de cola y se administra mirando, no
cambiando el precio.

**Lo que sí hay que hacer es vigilar**, y está en el §9.3.

### 6.3 Cambiar cómo se enuncia el 32 %

Aunque se adopte USD 100 / 500, **el 32 % no es un piso garantizado: es el
resultado del caso central.** Conviene decirlo así internamente y no ponerlo por
escrito como garantía ante un cliente, porque no lo es.

Lo que **sí** es sólido, y conviene usar como tal: **el plan Base es inmune a
cualquier subida de tarifa de Meta** —79 % incluso con la tarifa al doble—
porque a 10 mensajes por conversación vive **exactamente** dentro de la
franquicia. Es el plan que más conviene vender y el que más tranquilo deja.

Con una salvedad honesta: esa inmunidad vale **mientras el promedio no pase de
10 mensajes**. Justo por encima empieza a pagar, y al tope de 25 el Base también
cae a 7 %. La franquicia lo protege del precio de Meta, no del largo de las
conversaciones. **Ningún plan está protegido de eso: solo el tope y el diseño de
la conversación.**

---

## 7. Lo que hay que verificar antes del evento

1. **Que la presentación diga «conversaciones»** y no «atenciones», y que el pie
   con la letra chica coincida con el sitio.
2. **Que el tratamiento impositivo esté confirmado** con quien lleve la
   contabilidad. El 16 % de IVA e IT y el neteo del 13 % son supuestos de la
   propuesta, no verificados acá.
3. **Que la presentación y el sitio digan los mismos números.** Hoy el sitio
   sigue con 300 / 1.000 / 2.500 y precios en bolivianos: las instrucciones para
   alinearlo están en `18-cambios-en-sitio-y-presentacion.md`, que hay que
   actualizar con los volúmenes que se aprueben.
4. **Que el prepago se cargue con los volúmenes definitivos** antes de
   desplegarse, para no migrar cuentas ya creadas.

---

## 8. Lo que este análisis no cambia

Todo lo demás de la propuesta se sostiene y no hace falta volver a discutirlo: el
tope de 25 mensajes, la bolsa de 25 conversaciones por USD 10, la cláusula de
revisión ante movimientos del tipo de cambio, y los precios en dólares cobrados
en bolivianos al Tipo de Cambio Oficial del BCB.

---

## 9. El argumento que cambia la conclusión: el uso incompleto

**Agregado el 08/09 por la tarde**, a partir de la observación de Andres: los
planes Crecimiento y Corporativo dan un ingreso parecido en promedio, y **es
probable que un comercio del plan grande no llegue a las 500 conversaciones**, de
modo que lo no usado es ingreso directo.

**El argumento es correcto, y es más fuerte de lo que yo había concedido.**
Tiene nombre en otros rubros —es lo que sostiene a un gimnasio— y acá funciona
mejor todavía, por una razón concreta.

### 9.1 El límite del plan no genera conversaciones

Las conversaciones las genera **la clientela del comercio**, no el número que
figura en su plan. Un salón que recibe 200 consultas al mes va a tener 200
tenga contratadas 220 o 500. De ahí sale lo siguiente:

| Uso real del comercio | En Crecimiento (USD 50) | En Corporativo (USD 90) | Diferencia |
|---|---|---|---|
| 100 conversaciones | 40,74 | 74,34 | **+33,60** |
| 150 | 34,45 | 68,05 | **+33,60** |
| 200 | 28,17 | 61,77 | **+33,60** |
| 220 | 25,66 | 59,26 | **+33,60** |

**A igual uso, el plan grande deja USD 33,60 más, siempre.** Es exactamente la
diferencia de precio menos su impuesto: **margen puro**. El costo no cambia
porque el uso no cambió.

### 9.2 En dólares, el plan grande gana en casi todo el rango

| Uso del plan | Corporativo: ganancia | Margen |
|---|---|---|
| 20 % (100 conv) | **74,34** | 83 % |
| 40 % (200) | 61,77 | 69 % |
| 50 % (250) | 55,49 | 62 % |
| 70 % (350) | 42,93 | 48 % |
| 90 % (450) | 30,36 | 34 % |
| 100 % (500) | 24,08 | 27 % |

**Corporativo lleno deja USD 24,08. Crecimiento lleno deja USD 25,66.** Casi lo
mismo, que es lo que dice la propuesta. Pero **Corporativo supera a Crecimiento
en dólares hasta un uso del 97 %**, y ningún comercio de los que se están
visitando va a usar 500 conversaciones al mes: son diecisiete por día.

### 9.3 Dónde estaba mi error, y qué queda del riesgo

**Medí el riesgo sobre un cliente y no sobre la cartera.** Un precio se decide
sobre la cartera. Con la cartera a la vista:

| Escenario de la cartera de clientes grandes | Ganancia media por cliente |
|---|---|
| Optimista: la mayoría usa poco | **57,85** (64 %) |
| Realista: lo compra quien espera volumen | **48,74** (54 %) |
| **Pesimista: se autoselecciona el que más usa** | **38,84** (43 %) |
| *Referencia: Crecimiento lleno* | *25,66 (51 %)* |

**Incluso el escenario pesimista rinde más que Crecimiento lleno.** El riesgo que
señalé sigue existiendo, pero en proporción es chico:

- Un cliente al 100 % y al tope de 25 mensajes pierde **USD 65,65** al mes.
- Uno normal, al 50 % y 10 mensajes, deja **USD 55,49**.
- **Hacen falta 46 clientes así de cada 100** para que la cartera del plan grande
  pierda plata.

**Eso no es un riesgo de precio: es un riesgo de vigilancia.** La acción no es
cambiar el plan, es **marcar en la consola a los comercios que pasen del 70 % de
su plan** y mirar cuántos mensajes por conversación tienen. A partir de ahí se
conversa con ese cliente, se le ofrece una bolsa o se le revisa el flujo, que es
trabajo comercial normal.

### 9.4 Pero el argumento tiene un techo, y las 500 están cerca

Si el volumen prometido es sobre todo posicionamiento, cabe preguntarse por qué
no prometer mil. Porque **la cartera se da vuelta**:

| Plan | Cartera pesimista | Peor cliente | Tolera clientes al tope |
|---|---|---|---|
| USD 90 / 300 | 57,95 (64 %) | −4,63 | 94 de cada 100 |
| **USD 90 / 500** | **38,84 (43 %)** | **−65,65** | **46 de cada 100** |
| USD 90 / 750 | 14,85 (17 %) | −141,92 | 22 de cada 100 |
| USD 90 / 1.000 | **−9,22 (−10 %)** | −218,20 | 10 de cada 100 |

**Entre 750 y 1.000 el argumento se rompe.** Las 500 quedan del lado correcto y
con holgura, pero **no son un número que se pueda seguir estirando**: si más
adelante alguien propone «mil para el evento», la respuesta ya está calculada.

### 9.5 Conclusión

**El plan Corporativo queda en USD 90 por 500 conversaciones.** La propuesta de
Silvana es la correcta en los tres planes, y la observación de Andres es la que
lo demuestra: el margen porcentual del plan grande es menor, pero **el dinero que
entra a la caja es mayor en todo el rango de uso realista**, y el peor caso es
absorbible por la cartera.

Lo único que queda de mi objeción original, y sigue en pie:

1. **No poner el 32 % por escrito como piso garantizado.** Es el caso central.
2. **Vigilar los comercios por encima del 70 % de su plan** (§9.3). Es la
   pantalla que el `14-…` §10bis ya pedía, ahora con un motivo comercial
   concreto.
3. **No estirar el volumen más allá de 500** sin rehacer esta cuenta (§9.4).
