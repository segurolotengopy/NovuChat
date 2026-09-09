# Cuántas agendas puede ofrecer cada plan

**08-sep-2026.** Análisis de la propuesta de limitar las agendas por plan —**1 en
Impulso, hasta 5 en Crecimiento, hasta 20 en Pro**— contra lo que el sistema
puede hacer hoy.

**La respuesta corta: 1 y 5 no tienen ningún problema. Las 20 sí chocan**, y no
por el número de personas sino por **cómo el candado contra la doble reserva
revisa los calendarios**. Es una limitación del código, no del diseño, y se
arregla con un cambio acotado.

---

## 1. Qué es una «agenda» en el sistema

Un **funcionario** con calendario propio de Google. La ficha vive en
`tenants/{id}/funcionarios` y se ve así:

```json
{ "nombre": "María", "servicios": ["corte", "manicure"], "calendario": "…@group.calendar.google.com" }
```

El flujo la usa en tres lugares: para elegir a quién ofrecer, para consultar
disponibilidad y para agendar. La consola ya tiene la pestaña «Agenda» para
cargarlas.

---

## 2. Los cuatro límites, uno por uno

### 2.1 Cuántas caben en la configuración · **no es problema**

`configuracionFlujo` lee los funcionarios con `.limit(50)`. **El techo duro es
50**, muy por encima de las 20 propuestas. No hay que tocar nada.

### 2.2 Cuánto ocupan en el prompt · **no es problema**

Cada ficha son unos 62 tokens, de los cuales 26 son el identificador del
calendario, que es largo:

| Agendas | Tokens en el prefijo |
|---|---|
| 1 | 62 |
| 5 | 312 |
| **20** | **1.249** |
| 50 | 3.124 |

Con la caché del prefijo puesta, 1.249 tokens cuestan menos de un centavo de
boliviano por conversación. **El prompt no es la restricción**, igual que se
concluyó para el catálogo en `19-…` §2.

### 2.3 La consulta de disponibilidad · **no es problema**

`consultar_disponibilidad` resuelve **un solo calendario** por llamada
—funcionario → área → defecto— y consulta ese. **No recorre todas las agendas**,
así que su costo no crece con el número de personas. Está bien resuelto.

### 2.4 El candado contra la doble reserva · **acá está el choque**

Cuando el agente afirma que agendó, el flujo verifica que la cita exista y que no
se superponga con otra. Para eso:

- **`Calendarios a revisar` emite un item por CADA calendario configurado.**
- **`Verificar en el calendario` corre una vez por item.**

O sea: **una llamada a la API de Google por cada agenda del negocio, en cada
conversación que termina en cita.**

| Agendas | Llamadas en la verificación | Sobre lo medido hoy con 3 |
|---|---|---|
| 3 (hoy) | 3 | — |
| 5 | 5 | +0,6 a +0,8 s |
| 10 | 10 | +2,1 a +2,8 s |
| **20** | **20** | **+5,1 a +6,8 s** |

Los tiempos medidos el 29 de agosto con 3 calendarios fueron **de 1,6 a 5,6 s**,
contra un criterio de **p50 ≤ 6 s y p90 ≤ 10 s**. Sumarle cinco o siete segundos
al turno que agenda —que ya es el más lento— **rompe el criterio**.

Y hay un segundo efecto: el `executionTimeout` de n8n está en 60 s. No se llega
ahí con 20, pero el margen se achica.

> **El límite es de latencia, no de correctitud.** Con 20 agendas el candado
> sigue funcionando bien: el `limit: 50` de eventos es **por calendario**, no
> total, así que no se pierde ninguna superposición. Lo que pasa es que tarda.

---

## 3. Lo que no es técnico pero cuesta plata

Con muchas personas, el asistente tiene que preguntar **con quién** quiere el
cliente, y ofrecer nombres. Eso son mensajes, y **desde el 1 de octubre cada
mensaje cuesta**.

| Mensajes extra por conversación | Sobre 500 conversaciones | Del plan Pro |
|---|---|---|
| 1 | USD 5,65/mes | **6 %** |
| 2 | USD 11,30/mes | **13 %** |
| 3 | USD 16,95/mes | 19 % |

**Un negocio con 20 personas conversa más que uno con una.** Si la elección de
funcionario agrega dos mensajes de promedio, se lleva 13 % del plan Pro. No lo
vuelve inviable —el plan rinde 27 % a plena carga— pero **hay que contarlo**, y
es una razón más para que el prompt ofrezca las personas en un solo mensaje en
vez de en tres.

Es la regla de `CLAUDE.md` §1 aplicada a este caso: **el diseño de la
conversación con muchas agendas es una decisión económica.**

---

## 4. El arreglo que desbloquea las 20

**El candado no necesita revisar todas las agendas: solo la que recibió la
cita.**

La lógica de `Comprobar reserva` compara eventos que se superponen **en el mismo
calendario** —usa `organizer.email` para saber cuál es— y descarta explícitamente
los de calendarios distintos, porque dos personas distintas a la misma hora no se
pisan. O sea que **consultar los otros 19 calendarios es trabajo tirado**: sus
eventos se descartan igual.

La verificación revisa todos porque no sabe en cuál quedó la cita. Hacer que lo
sepa es lo que resuelve el problema:

- **Opción A, la más limpia:** que `agendar_cita` deje registrado en qué
  calendario escribió, y que `Calendarios a revisar` emita **un solo item** con
  ese. Pasa de N llamadas a 1, con cualquier número de agendas.
- **Opción B, más barata de implementar:** emitir solo los calendarios de los
  funcionarios **que participaron de la conversación** —los que el agente
  mencionó— en vez de todos. Cubre el caso normal y deja el resto igual.

Con cualquiera de las dos, **el número de agendas deja de afectar la latencia** y
las 20 dejan de ser un problema. Es medio día de trabajo, y además **mejora el
tiempo de todos los negocios**, incluidos los de 3 agendas.

---

## 5. Recomendación

### 5.1 Los límites que se pueden ofrecer hoy, sin tocar nada

| Plan | Propuesto | **Se puede hoy** | Por qué |
|---|---|---|---|
| Impulso | 1 | **1** | Sin problema. El caso de una sola persona ya está resuelto |
| Crecimiento | 5 | **5** | Sin problema. Suma menos de un segundo a la verificación |
| Pro | 20 | **8** | Por encima de 8 la verificación empieza a comprometer el p90 de 10 s |

**Las 8 son una estimación prudente, no una medición.** Sale de sumar entre 1,5 y
2 segundos a un turno que ya llega a 5,6 s. **Antes de publicar cualquier número
por encima de 5, conviene medirlo**: se crea un negocio de prueba con 10 y 20
calendarios y se cronometra el turno que agenda. Es media hora de trabajo y
convierte una estimación en un dato.

### 5.2 Lo que yo publicaría

**1 / 5 / «varias personas, sin límite práctico»** para el plan Pro, y hacer el
arreglo del §4 antes de que llegue un cliente que necesite más de 8.

Poner «hasta 20» por escrito hoy es prometer algo que el sistema hace mal: la
cita se agenda bien, pero la respuesta tarda el doble y el cliente final lo nota.
**Y lo que se promete en un plan no se puede bajar después.**

Si se prefiere un número concreto para la presentación, **«hasta 10 agendas»** es
defendible: está por encima de lo que necesita cualquier PyME de las que se están
visitando, y queda cerca del límite estimado sin cruzarlo del todo.

### 5.3 Y una nota comercial

**Las 20 agendas describen a un negocio que ya no es el cliente de estos
planes.** Veinte profesionales con agenda propia es una clínica grande o un
centro médico, y ese cliente necesita —y puede pagar— un Setup a Medida. Ponerlo
dentro del plan Pro de USD 90 es regalar la venta más grande del catálogo.

---

## 6. Lo que hay que verificar

1. **Medir el turno que agenda con 10 y con 20 calendarios**, contra el criterio
   de p50 ≤ 6 s y p90 ≤ 10 s. Es lo que convierte el «8» del §5.1 en un número
   real.
2. **Confirmar que la consola limita las agendas por plan.** Hoy la pestaña
   «Agenda» permite cargar funcionarios sin tope: si el límite es comercial, la
   regla tiene que estar en `firestore.rules`, no solo en la pantalla, porque
   esconder un campo no impide la petición.
3. **Que todas las agendas sean alcanzables desde la misma credencial de
   Google**, que es el requisito del alta (`13-…` §4) y que con 20 calendarios es
   más fácil de incumplir.
