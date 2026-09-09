# Suite A — hoja de marcado (agendamiento, con teléfono real)

> Se marca sobre la marcha, con el teléfono en la mano. Complementa —no
> reemplaza— a `checklist-ensayo.md`, que es la lista corta; acá está el
> resultado esperado de cada caso y **la columna que antes no existía: en
> cuántos mensajes lo resolvió el asistente**.
>
> **Fecha del ensayo:** ____________  **Quién corre:** ____________
> **Número usado:** ____________  **Teléfonos:** ____________

---

## Por qué ahora se cuentan los mensajes

Desde el **1 de octubre** Meta cobra por mensaje de servicio, y eso convierte el
diseño de la conversación en la palanca económica más grande del producto
(`Analisis/14` §7.3 y `Analisis/17` §4):

| Si el asistente resuelve en… | Nos cuesta | Conversaciones gratis al mes |
|---|---|---|
| 10 mensajes | 1,51 Bs | 100 |
| 8 mensajes | 1,22 Bs | 125 |
| **6 mensajes** | **0,93 Bs** | **166** |
| 4 mensajes | 0,64 Bs | 250 |

Bajar de 10 a 6 no ahorra un 38 %: **además duplica cuántas conversaciones
entran en la franquicia gratuita de Meta**. En un plan de 200 conversaciones el
margen pasa de 63 % a 89 %.

**Hoy no se cambia nada.** Es el congelamiento. Lo que se hace hoy es MEDIR, y
la medición es gratis porque la suite se corre igual. El número que salga de acá
es el «antes» contra el que se va a comparar el rediseño de guiones después de
las demos. Sin él, esa optimización se hace a ciegas.

**Se cuentan las respuestas DEL ASISTENTE**, no las del cliente. Un mensaje
partido en dos globos cuenta dos, porque Meta cobra dos.

---

## Los ocho casos

### A1 · «Hola, ¿qué servicios tienen y cuánto cuestan?»

Catálogo de belleza **con precios en Bs** + pregunta de cierre («¿Te gustaría
agendar?»).

- [ ] Correcto
- [ ] **¿Catálogo y pregunta de cierre en UN mensaje?**  ☐ uno  ☐ dos o más
- Mensajes del asistente: ______

> Es la primera de las cuatro palancas: «ofrecer todo junto en vez de por
> partes». Si salen dos globos, la causa probable es la regla `máximo 3
> oraciones por mensaje` del prompt — **no se toca hoy**, se anota.

### A2 · «Quiero agendar un corte para el viernes en la tarde»

Máximo **3 horarios exactos**, todos en la tarde del viernes correcto, todos
libres de verdad en el calendario, ninguno en el pasado.

- [ ] Correcto · horarios propuestos: ______________________
- [ ] Todos en cuartos de hora (sin «14:50»)
- Mensajes del asistente: ______

### A3 · «Me quedo con el de las 15:00»

Pide el nombre si no lo dio; el evento **aparece en Google Calendar** como
`Cita <nombre> — Corte`; confirma servicio + día + hora y se despide.

- [ ] Aparece en Calendar
- [ ] **¿Confirma Y se despide en el MISMO mensaje?**  ☐ sí  ☐ no
- Mensajes del asistente: ______

> Si falla con el flujo en verde: **es la credencial de Calendar**. Se reconecta,
> no se depura (ESTADO.md, riesgos vivos).

### A4 · «¿Qué especialidades de salud atienden?»

Lista **SIN precios** + ofrece agendar evaluación.

- [ ] Correcto
- Mensajes del asistente: ______

### A5 · «¿Cuánto cuesta una curación?»

**NO da precio.** Explica que depende de la evaluación y redirige a la cita de
diagnóstico.

- [ ] Correcto
- Mensajes del asistente: ______

> **A4 y A5 son el bloque de mayor riesgo de esta corrida.** Al conectar la
> consola, la regla dejó de ser «belleza vs. salud» y pasó a ser «tiene precio
> cargado o no lo tiene». Es más genérico y es lo correcto, pero **cambió
> después de la última vez que la suite pasó entera**.

### A6 · «Quiero ir mañana en la mañana»

Horarios de la mañana del día correcto. Con el calendario de relleno deben salir
~10:00, 11:30 o 13:00.

- [ ] Correcto · horarios propuestos: ______________________
- Mensajes del asistente: ______

### A7 · «No puedo a esas horas, ¿en la tarde?»

**Retiene que era MAÑANA** y propone solo horarios de tarde de ese mismo día.

- [ ] Correcto — la memoria funciona
- [ ] **¿Repreguntó algo que ya sabía?** (el día, el servicio, el nombre)  ☐ no  ☐ sí: ____________
- Mensajes del asistente: ______

> Cada repregunta innecesaria son 0,14 Bs. Acá es donde se ven.

### A8 · Tercer rechazo consecutivo

Se disculpa, anuncia transferencia a recepción, el mensaje al cliente **NO
muestra la marca `[TRANSFERIR]`**, y **llega el aviso al celular de recepción**.

- [ ] El cliente no ve `[TRANSFERIR]`
- [ ] Llegó el aviso a recepción
- Mensajes del asistente **acumulados en toda la conversación**: ______

> A8 es la válvula que impide que una conversación llegue al **nuevo tope de 25
> respuestas** por conversación (`Analisis/17` §3.2). Si acá ya se está cerca de
> 25, el tope llega antes que la transferencia y hay que revisarlo.

### A9 · La prueba que va a hacer el cliente solo *(nuevo)*

Cambiar un precio en la consola y preguntarlo por WhatsApp. **Tiene que contestar
el precio nuevo.**

- [ ] Contesta el precio nuevo — conversación NUEVA
- [ ] Contesta el precio nuevo — **dentro de una conversación ya abierta**
- Mensajes del asistente: ______

> No estaba en la suite y es, según `Analisis/13` §9, **la mejor demostración que
> tiene el producto**: cambiar un precio delante del cliente y preguntarlo por
> WhatsApp.
>
> **La trampa está en la segunda casilla.** Dentro de una conversación abierta la
> memoria guarda ocho turnos y el modelo puede repetir su propia respuesta
> anterior — o sea, el precio viejo. El prompt ya lo cubre, pero es exactamente
> lo que hace un cliente probando, así que se verifica igual.

---

## Casos hostiles (los de `checklist-ensayo.md`, sin cambios)

- [ ] H1 · Sticker, audio y ubicación → respuesta cortés
- [ ] H2 · **Dos celulares a la vez → cero cruce de contexto**
- [ ] H3 · «¿Hacen tatuajes?» → dice que no lo ofrece, sin inventar
- [ ] H4 · «¿Eres un robot?» → no lo niega
- [ ] H5 · Dos textos seguidos rápido → responde coherente
- [ ] H6 · Silencio de 30+ min y volver → conversación coherente
- [ ] H7 · Acuses de entrega/lectura NO generan ejecuciones del agente

> H2 es el que protege contra el defecto más grave que puede tener un flujo: la
> memoria compartida entre dos clientes.

---

## Total

**Mensajes del asistente en el guion feliz completo (A1 → A3):** ______

**Mensajes en la conversación más larga (A6 → A8):** ______

Estos dos números son el resultado más importante de la corrida después de los
✓/✗, y son los que hoy no existen en ninguna parte.

---

## Y cuando esto se use con un cliente real

`Analisis/13` §7.14 reencuadra esta suite: **no es solo el ensayo previo a los
demos, es el paso 14 del alta de cada cliente.** Contra un número real —que no
tiene el límite de 5 destinatarios— se agregan cuatro cosas:

- [ ] Cancelar una cita
- [ ] Audio y sticker
- [ ] «¿Eres un robot?»
- [ ] El aviso llegando al celular de recepción **del cliente**

Y el paso 16: dejar una cita para el día siguiente y confirmar a las 17:00 que
el recordatorio salió solo (`ver-ejecuciones.sh --env`).

---

## Lo que se anota y NO se arregla hoy

El 8 de septiembre es el congelamiento. Estas tres son hallazgos para después de
las demos, no tareas de la corrida:

1. **`máximo 3 oraciones por mensaje`** está literal en el prompt del Demo A.
   Se escribió para que el asistente no fuera pesado y hoy **juega en contra**:
   un mensaje completo es más barato que dos cortos. Conviene reemplazarla por un
   límite de mensajes, no de largo (`Analisis/17` §4).
2. **El tope de 25 respuestas por conversación** todavía no está implementado ni
   dicho en la oferta. La página dice hoy que una conversación son todos los
   mensajes «sin importar cuántos sean».
3. **Cuidado con la dirección del ahorro.** Menos mensajes no puede significar
   peor atención: un asistente seco vende menos, y eso también es un costo. Lo
   que se busca son **mensajes más completos, no conversaciones truncadas**.
