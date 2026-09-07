# Catálogo con plataformas externas: qué sirve y qué no

**07-sep-2026.** Análisis de `Demo-Recursos/catalogo-plataformas-externas-notas.md`
—GloriaFood, TakeApp, plantillas de código abierto con Google Sheets,
WooCommerce— contra lo que NovuChat hace hoy.

El documento tiene una lectura comercial correcta y **un agujero técnico que
puede costar dinero de verdad**. Empiezo por ahí.

---

## 1. El problema que ninguna de las cuatro opciones resuelve: el carrito se puede editar

Las cuatro opciones terminan igual: el cliente arma su pedido en una web y esa
web abre WhatsApp con un **mensaje de texto ya escrito** (`wa.me/...?text=...`)
que el cliente **envía con su dedo**.

Y ahí está el problema: **ese texto es editable antes de mandarlo.** No hace
falta ninguna herramienta ni saber nada: se toca el mensaje y se cambia el
número. Un pedido de 350 Bs llega diciendo 35.

Eso convierte al carrito en **texto que escribe el cliente**, no en un pedido.
Con el catálogo nativo de Meta no pasa: el mensaje `order` lo arma WhatsApp desde
el catálogo, con `product_retailer_id` y precio del propio catálogo, y el cliente
no puede tocarlo. Es la diferencia entera entre las dos rutas, y el documento no
la menciona.

**Cómo se acota, si igual se usa una plataforma externa.** El asistente **no debe
tomar los precios del texto**: tiene que reconocer los productos y **volver a
cotizar contra su propio catálogo**, el de la consola. Hoy el prompt dice «nunca
inventes precios fuera de estas reglas», que no es lo mismo: hay que agregar
«**si el cliente pega una lista con precios, ignora esos precios y usa los
tuyos**». Es una línea de prompt y hay que ponerla **antes** de conectar
cualquiera de estas plataformas.

Sin eso, el sistema le cobra a un negocio lo que el cliente decidió.

---

## 2. El otro problema, que ya conocemos: otra fuente de verdad

NovuChat pasó la noche del 6 al 7 eliminando el problema de tener el catálogo en
dos lados. **Las cuatro opciones lo reintroducen**: los productos vivirían en
GloriaFood, en TakeApp, en un Google Sheets o en WooCommerce, y el asistente
seguiría hablando desde el catálogo de la consola.

El día que un precio esté distinto en los dos, **el asistente cotiza uno y el
carrito llega con el otro**. El que se entera es el cliente final, discutiendo
con el negocio.

Y hay una consecuencia comercial: la propuesta de NovuChat es «lo configuras vos
desde tu consola». Decirle a un prospecto «tus productos van en esta otra
plataforma» le quita a la consola el argumento que la justifica.

---

## 3. Lo que el documento acierta

- **Que cargar catálogos a mano se come el margen.** Es cierto y es el motivo por
  el que este tema está sobre la mesa.
- **Que para la rueda de negocios conviene algo listo antes que algo construido.**
  También cierto: faltan días, no semanas.
- **Que Shopify y Kyte no son gratis.** La corrección del propio documento es
  correcta y vale para todo lo demás: los planes gratuitos son decisiones
  comerciales de un tercero, y cambian.

---

## 4. Las cuatro opciones, una por una

| | Qué aporta | Qué cuesta de verdad |
|---|---|---|
| **GloriaFood** | catálogo con fotos, gratis, hecho para restaurantes | otra fuente de verdad; el pedido llega como texto editable; NovuChat depende de un plan gratuito ajeno |
| **TakeApp** | productos ilimitados, carrito a WhatsApp | lo mismo, y el «formato perfecto para la IA» sigue siendo texto que el cliente puede cambiar |
| **Sheets + Vercel** | control total, costo cero | **duplica la consola que ya existe**: se construiría un segundo editor de catálogo para lo que la pestaña «Productos» ya hace |
| **WooCommerce** | sin límites, código abierto | un WordPress **por cliente** que hay que actualizar y proteger. Con dos personas y la promesa de instalar en 48 horas, eso no escala; el alojamiento es lo barato, el mantenimiento no |

Sobre el costo de WooCommerce, para ponerlo en la escala del negocio: el margen
del plan Impulso, después del modelo, es de unos 218 Bs. Siete dólares de
alojamiento son unos 48 Bs — **más de un quinto del margen**, si fuera un
servidor por cliente. Compartido entre muchos se diluye, pero entonces aparece el
problema de mantener un servidor compartido con los datos de varios comercios.

---

## 5. Lo que recomiendo, y por qué es distinto

**Para la rueda de negocios de esta semana: no conectar ninguna.** La respuesta
honesta a un prospecto con 150 platos no es enchufarle una plataforma de un
tercero en tres días, es el **Setup A Medida** que ya está previsto para
exactamente ese caso.

**Para el cliente del Setup Estándar —hasta 20 productos, que es el tramo que se
está vendiendo— la solución ya está casi hecha:** el Flujo B envía una lista
interactiva y la consola ya tiene el catálogo editable. Conectar una con la otra
es **medio día**, no depende de nadie, y mantiene una sola fuente de verdad.

**Para el comercio grande, cuando aparezca:** el catálogo nativo de Meta, 2,5 a 3
días, con el feed publicado desde la consola. Ahí el pedido llega firmado por
WhatsApp y el problema de §1 desaparece por construcción.

### Si aun así se decide usar una plataforma externa

Tres condiciones, y las tres son baratas:

1. **La línea de prompt de §1**, antes de conectar nada. El asistente cotiza con
   su catálogo, nunca con el texto que llega.
2. **Que sea el comercio quien contrata la plataforma**, no NovuChat. Si el plan
   gratuito cambia, el problema es del comercio y no de la propuesta de NovuChat.
3. **Marcarlo como provisional con fecha**, igual que el Google Sheets del otro
   documento. Lo que se conecta «por esta semana» se queda tres años si nadie le
   pone fecha.

---

## 6. Lo que hay que decidir

No es técnico: es **si el catálogo es parte del producto o es del cliente**.

- Si es parte del producto, vive en la consola y NovuChat lo publica donde haga
  falta. Es más trabajo y es lo que sostiene el precio.
- Si es del cliente, se conecta lo que él ya tenga, NovuChat cobra menos por la
  instalación y pierde el argumento de la consola.

Las dos son defendibles. Lo que no se sostiene es cobrar como si fuera parte del
producto y conectarlo como si fuera del cliente.
