# Módulo Catálogo web

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `catalogoWeb.ts` (sitio público, fichas, `fijarWebhookCarrito`), `publico/` |
| **Depende de** | Productos, Pedidos |
| **Límite por plan** | — |
| **Configuración** | `config/marca` (logo, colores) |
| **Colecciones** | `/fichasCatalogo` |
| **Pestañas** | la vista previa del catálogo web como ranura en Catálogo; el logo y los colores en Configuración del módulo |
| **Prompt** | el enlace al catálogo web en el resumen de Productos cuando el catálogo pasa de 40 ítems |
| **Herramientas** | — |
| **Nodos (lo que queda en n8n)** | ninguno propio |
| **Ganchos** | `antesDelTurno` (enlace) |
| **Mensajes por conversación** | 0. **Mandar el enlace no ahorra si el asistente conversa el pedido igual**: el ahorro aparece cuando el enlace reemplaza la conversación (`docs/base-comercial.md` §5) |
| **Pruebas** | `catalogo-web.test.ts`, `demo-b-catalogo.test.ts` |

**Observación:** exige el segundo sitio de Hosting antes del primer comercio que lo encienda (`admin/SEGURIDAD.md`). `catalogoWeb.ts` **se parte**: el checkout que escribe `pedidos` va a Pedidos. `config/marca` y el logo (hoy en `Configuracion.tsx`) pasan acá. `publico/` sigue sin cargar Firebase

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4octies (25/09/2026, líneas 1567-1573) -->

## 4octies. Catálogo web propio

**Escrito el 2026-09-07, sobre el diseño de Andres de
`Analisis/11-catalogo-web-propio.md` y con las dos correcciones de su §3.**
Es trabajo POSTERIOR a los demos del 9 y 10: vive en la rama
`disenio/catalogo-web` y no toca ningún flujo de n8n en producción.


<!-- movido de admin/DISENO.md §4octies.0 (25/09/2026, líneas 1574-1598) -->

### 4octies.0 Qué es, en una frase

El comercio publica su catálogo como una página web con su propia marca; el
asistente le manda el enlace a un cliente por WhatsApp; el cliente navega, elige
y confirma; **y el carrito vuelve de servidor a servidor a la conversación**, sin
pasar por el teléfono del cliente.

```
   WhatsApp                    Consola (Firebase)                Navegador
   (n8n)                                                         del cliente

   «quiero pedir» ──► POST /api/catalogo/enlace
                        └─► ficha opaca, caduca a 72 h
   manda el enlace ◄────────┘
                                                    GET /api/catalogo/<ficha>
                                                       └─► catálogo + marca ──►
                                                                        navega
                                                    POST …/<ficha>/checkout ◄──
                                                       ├─ RECALCULA los precios
                                                       ├─ escribe /pedidos
                                                       ├─ mensaje `order` en el hilo
   despierta al flujo ◄────────────────────────────────┘
   responde (o plantilla)
```


<!-- movido de admin/DISENO.md §4octies.0bis (25/09/2026, líneas 1599-1623) -->

### 4octies.0bis Solo para el flujo de VENTA

**Decidido por Andres el 08/09.** Un catálogo web con carrito y checkout es una
tienda. El flujo de agendamiento **no vende**: su catálogo es referencial —la
lista que el asistente usa para saber de qué hablar y cuánto cuesta— y sus ítems
son en buena parte «a consultar», que desde §4octies.5bis ni siquiera se
publican. Un salón que encendiera esto obtendría una vitrina medio vacía con un
botón de comprar que no compra nada.

**Es la misma decisión que se tomó para el catálogo nativo de Meta**
(§4sexies.3bis) y por las mismas razones. Que las dos caigan del mismo lado no
es casualidad: las dos son tiendas.

Se comprueba en tres lugares, y el que manda es el segundo:

| Dónde | Qué hace |
|---|---|
| `firestore.rules` | `catalogoWebActivo` solo se puede poner en `true` con `tieneCobro`. Escrito como implicación —o está apagado, o el negocio vende— para que un salón pueda seguir guardando el resto de su configuración |
| `catalogoWeb.ts` | `enlaceCatalogo` no emite ficha, y `fichaVigente` no abre ninguna, si el comercio no tiene `venta`. Una ficha emitida antes de esta regla deja de servir |
| `Configuracion.tsx` | la sección no se le ofrece a quien no vende. **Es cosmético**: esconder no protege, la petición se construye igual desde la consola del navegador |

**Consecuencia:** el punto de la tabla comparativa del análisis que decía «vale
para el Flujo A, si algún día hace falta» queda cerrado. No es una deuda: es una
decisión.


<!-- movido de admin/DISENO.md §4octies.1 (25/09/2026, líneas 1624-1642) -->

### 4octies.1 Las dos correcciones del análisis, aplicadas

**§3.1 — El CSV es un formato de IMPORTACIÓN, no una fuente de verdad.** El
diseño original tenía el catálogo viviendo en un Sheets. Con eso, la copia que va
al prompt saldría del Sheets y la del sitio también: dos catálogos que se
desincronizan el primer martes que alguien corrija un precio en el lugar
equivocado. Acá el archivo entra por `web/src/lib/csv.ts`, se valida, se escribe
en `/catalogo`, y desde ese momento **manda la consola**. Se puede volver a
exportar, pero lo exportado es una copia.

**§3.2 — El enlace identifica la CONVERSACIÓN, no solo el catálogo.** Las tres
consecuencias que el análisis pedía fijar antes de programar, y dónde quedaron:

| Requisito | Dónde |
|---|---|
| Una ficha por conversación, **no el teléfono en la URL** | `/fichasCatalogo/{ficha}`, 128 bits al azar, cerrada a todo navegador |
| El checkout va **firmado** | reutiliza `firma.ts`: el mismo secreto por número de la ingesta, en los dos sentidos |
| La ficha **caduca** | 72 horas, y cinco carritos como máximo. El porqué de los dos números está en `SEGURIDAD.md` T-36 |


<!-- movido de admin/DISENO.md §4octies.2 (25/09/2026, líneas 1643-1665) -->

### 4octies.2 Las dos decisiones que no eran técnicas

Las dos las señalaba el §7 del análisis como previas a escribir código.

**La marca es la del COMERCIO**, con NovuChat en el pie. El cliente final cree
—con razón— que está hablando con la panadería: si al tocar el enlace aparece una
marca que no le presentaron, duda, y una duda en el momento de pagar es una venta
perdida. El logo y el color viven en `/config/negocio` (`logoUrl`, `colorMarca`)
porque son IDENTIDAD, que por §4sexies es común a cualquier flujo.

El color es **exactamente `#rrggbb`** y nada más. No es tiquismiquis: termina
dentro de una propiedad personalizada de CSS, y un valor libre ahí es una
inyección de CSS que filtra cada visita a un tercero sin ejecutar JavaScript. Es
el mismo criterio con el que la voz del asistente es un enumerado.

**Fuera de la ventana de 24 horas se manda una plantilla.** Si el cliente navega,
se distrae y confirma al día siguiente, WhatsApp ya no permite un mensaje libre.
`checkoutCatalogo` calcula si la ventana sigue abierta —con `atencionDesde`, la
misma ancla que usa la ingesta— y se lo dice al flujo en el campo `accion`:
`responder` o `plantilla_carrito_espera`. **Lo calcula la función y no n8n** para
que no haya dos relojes dando dos respuestas sobre el mismo pedido. La plantilla
hay que darla de alta en Meta: está en `admin/CATALOGO-WEB.md` §4.


<!-- movido de admin/DISENO.md §4octies.3 (25/09/2026, líneas 1666-1674) -->

### 4octies.3 Por qué no se adoptó una pieza de código abierto

Se coincide con el §4 del análisis. La consola ya es una aplicación React sobre
Firebase Hosting con su API y su sistema de diseño; una ruta pública de catálogo
—lista, detalle, carrito, checkout— es lo que hay en `web/src/publico/`, unas
quinientas líneas. Integrar una plantilla ajena cuesta entenderla, alojarla,
mantenerla actualizada, hacerla parecerse a NovuChat, y deja una dependencia más
que auditar en un producto que ya tiene una CSP con `default-src 'none'`.


<!-- movido de admin/DISENO.md §4octies.4 (25/09/2026, líneas 1675-1691) -->

### 4octies.4 Dos aplicaciones en un sitio, y por qué se partió el punto de entrada

`main.tsx` mira la ruta y carga **un trozo distinto**: `/c/<ficha>` monta el
catálogo; todo lo demás monta la consola. No es una optimización cosmética.

Antes, `main.tsx` importaba `App`, y `App` arrastra —por la cadena de sesión— el
SDK de Firebase entero: Auth, Firestore, Functions y App Check. El catálogo lo
abre un cliente final desde WhatsApp, casi siempre con datos móviles: **no
necesita nada de eso** y, sobre todo, el código que gestiona sesiones de
administrador no tiene por qué existir en la página que ve un desconocido. Con la
partición, el catálogo pesa unos 205 kB de JavaScript contra los 813 kB de la
consola, y el segundo trozo ni se descarga.

La contracara está en `SEGURIDAD.md` T-37: las dos aplicaciones comparten origen.
Se aceptó por ahora, con la separación en un segundo sitio de Hosting anotada como
lo que hay que hacer antes de tener volumen real.


<!-- movido de admin/DISENO.md §4octies.5 (25/09/2026, líneas 1692-1722) -->

### 4octies.5 El umbral del catálogo al prompt (punto 7 del diseño)

`configuracionFlujo` mandaba el catálogo entero —hasta 200 ítems— en cada consulta
del flujo, y el flujo lo pega en el prompt.

Desde ahora: **por debajo de 40 ítems, el catálogo entero al prompt; por encima,
solo un resumen** —cuántos hay, qué áreas, entre qué precios— y el detalle llega
por el sitio y por el JSON del checkout. El umbral vive en `prompt.ts`, en un
solo lugar, porque lo usan `configuracionFlujo` y `catalogoWeb`.

**Corrección del 08/09: el motivo NO es el costo, y decirlo mal mandaba a
optimizar al revés.** Esta sección justificaba el umbral con «más dinero, más
latencia». `Analisis/19` §2 lo midió con las tarifas de octubre y la caché de
prefijo puesta: **500 ítems en el prompt cuestan 0,0585 Bs, o sea 0,43 mensajes
del asistente**. El catálogo entero de una ferretería cuesta menos de medio
mensaje; el token dejó de ser la restricción el día que Meta empezó a cobrar por
mensaje. Lo que hay que achicar es la cantidad de MENSAJES, no el prompt.

El umbral sobrevive por otras dos razones: **legibilidad** —40 ítems son ~1.200
caracteres en un globo de chat, y la lista interactiva de WhatsApp admite 10
filas por sección— y **confiabilidad del modelo**, que es la que no se puede
calcular: el Demo A maneja 8 servicios y nadie probó con 100. Cada precio mal
citado es un mensaje cobrado más un riesgo de la prohibición 3. Los 40 son una
recomendación, no una medición: el número real se saca con un catálogo real
contra las suites de aceptación.

**Solo se resume si el comercio tiene el catálogo web encendido.** Sin sitio
adonde derivar, resumir sería quitarle información al asistente a cambio de nada.
Un comercio sin catálogo web se comporta exactamente como antes de este cambio,
tenga los ítems que tenga.


<!-- movido de admin/DISENO.md §4octies.5bis (25/09/2026, líneas 1723-1750) -->

### 4octies.5bis Sin precio no se publica

**Agregado el 08/09, contra `Analisis/19` §5.** Un ítem sin precio significa «a
consultar»: hay que evaluar, medir, ver el stock o hablar con alguien. En la
consola y en el prompt eso está bien —el asistente tiene que saber que el negocio
lo ofrece, para no decir que no existe—. **En una página con botón de comprar,
no.**

> «Publicar en el catálogo web algo que no se puede comprar es la forma más cara
> de generar una conversación: el cliente pregunta, el asistente no puede cerrar,
> y son mensajes pagados sin venta.»

Desde el 1 de octubre cada mensaje del asistente se paga, así que un ítem sin
precio en la vitrina no es una oportunidad: es una conversación garantizada que
no puede terminar en nada. La regla se aplica en los tres endpoints —no se
publica, no entra al checkout, y no se manda el enlace si el catálogo entero se
cotiza— y la consola se lo dice al comercio en las dos pantallas donde importa.

**Lo que esta regla NO cubre.** El análisis nombra tres clases que tampoco
deberían publicarse —sin stock, a medida, y lo que necesita instalación— y de las
tres el sistema solo sabe reconocer esta. Distinguir las otras exige una marca
por ítem en la consola, que no existe. Mientras tanto, el comercio las saca
dándolas de baja.

**Consecuencia que se aceptó:** el catálogo web deja de servir para el Flujo A
tal como está cargado hoy, porque los servicios de salud son justamente los que
se cotizan. Es lo correcto: un catálogo de servicios sin precio no es una tienda.


<!-- movido de admin/DISENO.md §4octies.5ter (25/09/2026, líneas 1751-1774) -->

### 4octies.5ter El logo se sube, y los colores se eligen de cinco

**Pedido por Andres el 08/09.** Antes el logo era una URL que el comercio pegaba
y el color un `#rrggbb` libre. Las dos cosas cambiaron.

**El logo se sube desde la consola y se guarda incrustado** en
`/tenants/{t}/config/marca`, recortado a 320 px por el navegador antes de
guardar. No hay depósito de archivos: montar Storage —bucket, reglas, CORS— para
UN archivo por comercio es mucha superficie, y nos volvería custodios de archivos
ajenos. Va en documento propio y no en `/config/negocio` porque
`configuracionFlujo` lee ese documento en cada consulta del flujo, y el logo le
agregaría decenas de kilobytes a cada mensaje del asistente.

Los tipos son **PNG, JPEG y WebP**. SVG **no**, aunque sea una imagen: puede
llevar `<script>` adentro y esto termina en un `src`.

**El color pasó a ser una de cinco paletas** (`web/src/lib/paletas.ts`). La razón
de diseño pesa más que la de seguridad: la página necesita **tres** tonos que
combinen y un comercio elige uno solo; pedirle los tres termina en texto que no
se lee. Las cinco están calculadas juntas y sus quince relaciones de contraste
cumplen WCAG AA —medido en una prueba que recalcula, no en una tabla copiada—.
De paso, el enumerado elimina la inyección de CSS en vez de validarla: el
servidor manda el NOMBRE y el navegador lo traduce contra su tabla.


<!-- movido de admin/DISENO.md §4octies.6 (25/09/2026, líneas 1775-1789) -->

### 4octies.6 Qué se agregó a las reglas

| Ruta | Cambio |
|---|---|
| `/catalogo/{item}` | `imagenUrl`, validada como `https://…` por `urlImagenValida()` |
| `/config/negocio` | `catalogoWebActivo` (booleano, nace apagado) y `paleta` (una de cinco) |
| `/config/marca` | **nueva.** El logo incrustado. Es el único documento de `/config` que el comercio puede CREAR: nace cuando sube su primer logo, que puede ser meses después del alta |
| `/pedidos/{id}` | **nueva.** La leen los mismos que las conversaciones; no la escribe ningún navegador |
| `/fichasCatalogo/{f}` | **nueva.** Negada para todos, explícitamente y no por descarte |
| `/bitacora` | dos tipos más: `catalogo_enlace` y `carrito_recibido` |

`catalogoWebActivo` nace **apagado** y encenderlo es un acto deliberado del
comercio: publicar los precios de alguien en una dirección pública no puede ser el
valor por defecto de nada.


<!-- movido de admin/DISENO.md §4octies.7 (25/09/2026, líneas 1790-1809) -->

### 4octies.7 Lo que este diseño NO resuelve, dicho ahora

- **No hay purga de fichas caducadas.** Una ficha vencida no sirve para nada —la
  función la rechaza— pero el documento queda, con un teléfono adentro. Entra en
  la purga de retención de §4septies, que todavía no existe para ninguna
  colección.
- **NovuChat no manda ningún mensaje de WhatsApp.** Quien habla con Meta sigue
  siendo n8n y nadie más. Si el webhook del flujo falla, el pedido **ya está
  guardado** y la consola lo muestra: el comercio no pierde la venta, pero el
  cliente no recibe respuesta automática. Queda anotado como `error_flujo` en la
  bitácora y `entregadoAlFlujo: false` en el pedido. **Falta la reentrega**: hoy
  hay que mirar la consola.
- **Las fotos son de la empresa.** Si borra una de su Drive, deja de verse. Es la
  contrapartida buscada de no montar un depósito de archivos, y la consola la
  muestra rota a propósito para que el comercio lo note.
- **Nada de esto se probó contra un teléfono real**, porque no hay proyecto de
  nube creado. Ver §9.

---
