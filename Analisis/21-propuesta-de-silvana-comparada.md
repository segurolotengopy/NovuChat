# La propuesta de Silvana, comparada

**08-sep-2026.** Análisis de «Ajuste Estratégico de Precios y Volúmenes
(Octubre 2026)» contra el modelo de `14-costo-por-conversacion-y-precios.md` y
`16-sensibilidad-topes-y-bolsas.md`.

**El resumen:** la propuesta **mejora la mía en dos de los tres planes** y aporta
algo que a mi análisis le faltaba, que son los impuestos. Pero contiene **una
afirmación de seguridad que no se sostiene** —el margen sí puede caer por debajo
del 32 %, y bastante— y **un problema de vocabulario que un cliente puede ver**.

Ninguno de los dos invalida el trabajo. Los dos se arreglan sin tocar la
estrategia comercial.

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

## 3. El problema serio: el piso de 32 % no es un piso

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

Y el problema no se arregla con el precio. Para garantizar 32 % con 500
conversaciones **todas al tope**, habría que cobrar **USD 275**.

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
| Corporativo | **USD 70 / 300** | **54 %** | USD 90 / 500 | 37 % | Yo, pero por lo aburrido |

**En dos de tres, su propuesta es mejor que la mía**: cobra más, ofrece más y
rinde igual o mejor. El único desacuerdo es Corporativo, y ahí no discuto el
precio de 90 sino el volumen de 500.

---

## 6. Recomendación

**Adoptar la propuesta de Silvana, con dos correcciones y una aclaración.**

### 6.1 Corregir «atenciones» por «conversaciones» (§4)

De una línea, y evita una contradicción visible.

### 6.2 Arreglar el plan Corporativo

Tres opciones, todas defendibles. Las ordeno por cuánto respetan su objetivo
comercial:

| Opción | A 10 msj | A 15 msj | Con mezcla | Con tarifa +25 % | Qué se conserva |
|---|---|---|---|---|---|
| **USD 100 / 500** | **32 %** | 3 % | 42 % | 21 % | **El «medio millar»**, y hace verdadera su promesa de 32 % en el caso central |
| USD 110 / 500 | 37 % | 10 % | 45 % | 27 % | El «medio millar», con colchón real |
| USD 90 / 400 | 41 % | 14 % | 49 % | 31 % | El precio de 90 |

**Recomiendo USD 100 / 500.** Es el cambio más chico que hace cierta su propia
promesa: 32 % exacto en el escenario central, conserva el titular de las 500 y el
precio queda redondo. La subida de 90 a 100 es un 11 % sobre un plan que casi
nadie va a comparar contra otro proveedor.

Si el precio de 90 es innegociable para el evento, **USD 90 / 400** es la
alternativa sólida. «400 conversaciones» sigue sonando a volumen y el plan aguanta
una conversación larga y una subida de tarifa.

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
