# El catálogo nativo de WhatsApp: qué de las notas de Silvana aplica al Flujo B

**07-sep-2026.** Análisis de `Demo-Recursos/catalogo-whatsapp-notas-silvana.md`
contra lo que el sistema hace hoy. Tres cosas se confirman, una está desactualizada
y hay una recomendación distinta a la del documento.

---

## 1. Lo que está bien, y conviene no discutir

**El aviso del chip es correcto y es de los caros.** Si alguien instala WhatsApp
—normal o Business— en el número que va a usar la API, el número queda atrapado y
hay que borrar la cuenta y esperar a que se libere. Vale la pena que esté escrito
en el guion de instalación, no solo en una nota.

**El catálogo nativo es la interfaz correcta para una tienda con muchos
productos.** Un menú de 150 platos no se lee en un chat; se navega. Y el carrito
nativo evita que el cliente dicte su pedido a mano, que es donde el asistente se
equivoca.

**El instinto del tope comercial es correcto**, aunque el motivo que da el
documento no sea el que manda. Ver §5.

---

## 2. Lo que ya no es cierto

El documento dice:

> «la Brecha 4 indica que lo que el cliente edita ahí todavía no llega al flujo
> del asistente»

**Eso era cierto hasta la madrugada del 7 de septiembre. Ya no.** Los tres flujos
leen su configuración del panel, y está probado en vivo: se cambió el precio del
corte en la consola y el asistente lo dijo por WhatsApp. La pestaña de catálogo
además se edita —precio, área, duración— desde ayer.

O sea que «la solución definitiva» que el documento pone en futuro **ya existe
para el texto del catálogo**. Lo que no existe es su publicación como catálogo
nativo de Meta, que es otra cosa y es de lo que trata el resto de esto.

---

## 3. Lo que ya está construido y el documento no sabe

**El Flujo B ya entiende un carrito del catálogo nativo.** `Normalizar entrada`
tiene su rama `order` y lee `product_items` con cantidad, precio unitario y
`product_retailer_id`. Si mañana se conectara un catálogo de Meta, el pedido
llegaría y el flujo no se rompería.

**Pero llegaría medio ciego.** Al agente le entra el SKU crudo:

```
El cliente envió un CARRITO de compras con estos ítems:
- 2 x PLAN_BASE (precio unitario: 250 BOB)
```

`PLAN_BASE` no significa nada para el modelo salvo que coincida con algo que
tenga en el catálogo del prompt. **Ese es el punto de sincronía**: el SKU del
catálogo de Meta tiene que ser el identificador del ítem en la consola. Si cada
uno se carga por su lado, el asistente recibe pedidos que no puede nombrar.

---

## 4. La recomendación distinta: el feed lo genera NovuChat, no un Google Sheets

El documento propone que el cliente llene una plantilla de Google Sheets y que
Meta la consuma como origen de datos por enlace. **Funciona, y es más rápido para
hoy.** Pero crea una **segunda fuente de verdad de los productos**, justo después
de que este proyecto pasara una noche eliminando exactamente ese problema: la
consola escribía en un lado y el flujo leía de otro.

Con la hoja de cálculo quedarían **tres**: la consola, el Sheet y el catálogo de
Meta. El día que un precio esté distinto en dos de ellos, nadie va a saber cuál
manda, y el que se entera es el cliente final.

**La ruta que aprovecha lo que ya existe:** el comercio edita en la consola —que
ya puede— y **NovuChat publica el feed** que Meta consume. Un endpoint público
que emite el catálogo del negocio en el formato de Meta, leído de Firestore, y
Meta lo actualiza solo cada pocas horas. Una sola fuente, cero trabajo para el
comercio después de la carga inicial, y el SKU sale del identificador del ítem,
con lo que el problema de §3 se resuelve de arriba.

| | Google Sheets | Feed desde la consola |
|---|---|---|
| Fuentes de verdad | tres | una |
| Quién carga | el cliente, en un Excel | el cliente, en la consola |
| SKU coherente con el asistente | por casualidad | por construcción |
| Listo para hoy | sí | no, es trabajo |

**Para la rueda de negocios de esta semana, el Sheet sirve.** Como camino
permanente, no: hay que darle fecha al feed y retirarlo.

---

## 5. El tope comercial es correcto, pero por otra razón

El documento justifica el tope de 20 productos por las **horas de carga**. Con un
feed —o incluso con el Sheet— esa carga tiende a cero, así que ese argumento se
cae solo y el tope quedaría sin fundamento.

**El límite real es otro, y es técnico:** el catálogo viaja **dentro del prompt,
en cada mensaje**. Crece en línea recta con la cantidad de productos, para
siempre. Con unas decenas no se nota; con cientos, cada respuesta del asistente
cuesta más, tarda más y se vuelve menos precisa —un modelo con mil ítems delante
elige peor que uno con treinta—.

Para un supermercado la respuesta no es un prompt más grande: es el **catálogo
nativo con búsqueda**, y que el prompt lleve solo lo que hace falta para la
conversación en curso. Eso es un cambio de arquitectura, no un cambio de precio.

**Entonces el tope se sostiene, pero se explica distinto:** el Setup Estándar
cubre lo que entra en la cabeza del asistente; por encima de eso hace falta otra
arquitectura, y eso es lo que cuesta más. Conviene medirlo antes de fijar el
número: probar latencia y calidad de respuesta con 20, 50 y 150 ítems y poner el
tope donde se degrade, en vez de elegirlo a ojo.

---

## 6. DECIDIDO: catálogo nativo solo en el Flujo B (Andres, 07-sep)

El punto 3 de las notas —«la consola arma el catálogo de WhatsApp de forma
invisible en el fondo»— **es el camino, y es el mismo que propone §4**: la
diferencia está en cómo se alimenta, no en la idea. Queda adoptado.

**Y queda descartado para el Flujo A**, con la razón de Andres, que es mejor que
la técnica: **en agendamiento el catálogo es REFERENCIAL**. No es una tienda: es
la lista que el asistente usa para saber de qué hablar y cuánto cuesta. Vive en
la consola, entra al prompt, y ahí termina. Nadie va a poner un corte de pelo en
un carrito de compras.

La razón técnica apunta al mismo lado y conviene tenerla escrita porque cierra la
discusión: **Meta exige precio en cada producto del catálogo**, así que un
servicio que se cotiza después de evaluar —ortodoncia, cirugía— **no se puede
listar**. Es justamente lo que la consola modela desde ayer con el precio
opcional y el «a consultar». Aunque quisiéramos, la mitad del catálogo de una
clínica no entraría.

| | Flujo A — agendamiento | Flujo B — venta |
|---|---|---|
| Qué es el catálogo | **referencial**: de qué habla el asistente | **una tienda**: lo que el cliente compra |
| Dónde vive | consola → prompt | consola → prompt **y** catálogo de Meta |
| Carrito nativo | no | sí |
| Servicios sin precio | sí, «a consultar» | no entran |

Es una capacidad por flujo, igual que la agenda o el cobro: encaja sin forzar
nada en la política de capas de `admin/DISENO.md` §4sexies. **Una clínica no va a
tener catálogo de WhatsApp, y está bien.**

---

## 6bis. Cuánto cuesta el punto 3 (estimado el 07-sep, sobre el código real)

**Lo que ya está hecho y no se vuelve a pagar:** el catálogo editable en la
consola con precios, la conexión consola→flujo, y `Normalizar entrada` que ya
entiende un carrito (`order` con `product_items`).

**Lo que falta, verificado contra el repositorio:**

| | Qué | Estimado |
|---|---|---|
| **A** | **Imágenes de producto.** No existe ninguna: el catálogo no tiene campo de imagen y **Firebase Storage no está configurado** (`firebase.json` no lo menciona y no hay `storage.rules`). Hace falta el depósito con sus reglas y CORS, subir/recortar/previsualizar/borrar en la consola, y servirlas en una dirección pública que Meta pueda leer. | **1,5 días** |
| **B** | **El feed.** Endpoint público por comercio que emite el catálogo en el formato de Meta, leído de Firestore, con su ficha para que no se pueda recorrer la cartera. | **medio día** |
| **C** | **El Flujo B.** Enviar el mensaje de catálogo —hoy solo sabe enviar una lista interactiva— y que el SKU sea el identificador del ítem, para que un carrito llegue con productos que el agente sabe nombrar. Más la prueba con teléfono. | **medio día** |
| **D** | **Lado Meta.** Crear el catálogo, conectar el feed, vincularlo a la WABA. Manual y por comercio. | **1 h** el primero, **15 min** los siguientes |

**Total: 2,5 a 3 días de trabajo efectivo.** El grueso es A, que nadie había
contado porque el documento de Silvana da por hecho que el catálogo se llena con
texto.

**Por qué las imágenes no son opcionales.** Aunque Meta no las exigiera —hay que
confirmarlo en su especificación de feeds—, un catálogo visual sin fotos no
sirve para nada: el valor entero de la propuesta es que el cliente **navegue** en
vez de leer. Un carrito de recuadros grises es peor que la lista de texto que ya
existe.

### El riesgo que no se acorta con más horas

**Meta revisa los catálogos de comercio contra su política.** Puede tardar días y
puede rechazar categorías enteras. Eso no es esfuerzo, es calendario: hay que
empezarlo con margen y **no prometerle una fecha a un cliente antes de tener el
primer catálogo aprobado**.

### Un camino intermedio que cuesta medio día

El Flujo B **ya envía una lista interactiva** (`action.sections`). Alimentarla
desde el catálogo de la consola —en vez del texto fijo de hoy— da buena parte de
la experiencia con **cero imágenes, cero feed, cero revisión de Meta**. Las listas
de WhatsApp tienen un tope de filas que hay que verificar, así que sirve para un
catálogo chico, que es exactamente el Setup Estándar.

**Recomendación:** hacer eso primero. Cubre al cliente de 20 productos, que es el
tramo que se está vendiendo, y deja el catálogo nativo para cuando aparezca el
primer comercio grande — que es también cuando conviene medir el tope del §5.

## 7. Qué haría, en orden

1. **Nada antes de las demos.** Esto no toca el guion del 9 y 10.
2. **Para la rueda de negocios:** la plantilla de Google Sheets como parche
   consciente, con fecha de retiro escrita.
3. **Después de las demos:** la lista interactiva alimentada por la consola —medio
   día, sin Meta de por medio—, que cubre al cliente de 20 productos.
4. **Cuando aparezca el primer comercio grande:** el catálogo nativo completo,
   2,5 a 3 días, **al Flujo B únicamente**. El Flujo A no lo lleva ni lo va a
   llevar. Empezar el trámite con Meta antes que el código.
4. **Antes de venderle a un comercio grande:** medir con 20, 50 y 150 productos y
   fijar el tope con ese dato.
