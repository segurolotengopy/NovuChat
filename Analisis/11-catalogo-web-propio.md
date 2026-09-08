# Catálogo web propio: análisis del diseño de Andres

**07-sep-2026.** Andres propuso un tercer camino después de leer los dos
documentos anteriores. **Es el mejor de los tres**, y resuelve el defecto que
hundía a los otros. Este documento lo analiza, propone dos correcciones y estima
el trabajo. Vive en un worktree aparte porque es una propuesta, no una decisión.

---

## 1. El diseño, tal como lo planteó

1. La empresa sube su catálogo a un Sheets (o un CSV exportado de su sistema),
   con las imágenes **referenciadas por URL** desde el propio archivo.
2. Una pieza de código abierto marca blanca lee el Sheets y publica un catálogo
   web navegable.
3. Desde WhatsApp se deriva al cliente **a ese catálogo exacto**.
4. El cliente navega, elige y hace checkout.
5. En ese momento se arma un carrito con fotos, precios y descripciones, y **se
   manda en JSON a la consola**.
6. La consola ya es la fuente de verdad de la IA, así que el asistente puede
   orientar al cliente sobre ese carrito.
7. Catálogo chico (menos de X productos) → también al prompt. Catálogo grande →
   solo por el JSON del checkout.

---

## 2. Por qué es el mejor de los tres

**Resuelve el defecto fatal de las plataformas externas.** En GloriaFood, TakeApp
o un carrito de plantilla, el pedido vuelve como **un mensaje de texto que el
cliente puede editar antes de mandarlo**: un pedido de 350 Bs llega diciendo 35.

Acá el carrito viaja **de servidor a servidor**, del sitio del catálogo a la
consola, sin pasar por el teléfono del cliente. **No hay nada que editar.** Es la
misma garantía que da el catálogo nativo de Meta, sin depender de Meta.

**Y resuelve el problema del prompt.** El umbral —chico al prompt, grande solo
por el checkout— es exactamente la respuesta correcta al límite de §5 del
análisis anterior: el catálogo deja de crecer dentro de cada mensaje.

**Y resuelve las imágenes sin construir un depósito de archivos.** Referenciadas
por URL desde el CSV, alojadas donde la empresa ya las tiene. Eso borra el día y
medio que costaba montar Firebase Storage con su subida y sus reglas.

---

## 3. Dos correcciones

### 3.1 Invertir una flecha: la consola es la fuente, el Sheets es un formato de importación

Tal como está descrito, el **catálogo** vive en el Sheets y la consola recibe el
**carrito**. Pero entonces, para el caso «catálogo chico → al prompt», la copia
del prompt saldría del Sheets: vuelven a existir dos catálogos.

La corrección es chica y cambia todo: **el CSV/Sheets es un formato de
IMPORTACIÓN, no una fuente de verdad.**

```
CSV / Sheets ──importa──► CONSOLA ──► sitio del catálogo
                          (única)  └─► prompt del asistente
                                   └─► carrito que vuelve
```

Se conserva todo lo que Andres quiere —importar y exportar desde varias fuentes,
manejo autónomo— y **la fuente de verdad queda una sola de verdad**, no una para
el carrito y otra para el catálogo. Además el umbral del punto 7 se resuelve
solo: la consola sabe cuántos ítems tiene.

### 3.2 El enlace tiene que identificar la CONVERSACIÓN, no solo el catálogo

Andres escribió «tiene que ser exactamente a ese catálogo». Es más que eso:
**tiene que ser a ese catálogo Y a esa conversación**, o cuando el carrito
vuelva no se sabrá a quién contestarle.

Eso trae tres requisitos que conviene fijar antes de escribir código:

- **Una ficha por conversación en el enlace**, no el número de teléfono. El
  teléfono en una URL termina en el historial del navegador y en los registros
  de cualquier intermediario.
- **El checkout va firmado**, igual que la ingesta. NovuChat ya tiene esa pieza
  —`firma.ts`, HMAC por número— y se reutiliza tal cual. Sin firma, cualquiera
  que descubra la dirección puede inyectar carritos.
- **La ficha caduca.** Un enlace se comparte por WhatsApp sin pensarlo; sin
  caducidad, el carrito de un desconocido entraría en la conversación de otro.

### 3.3 Y una cosa que hay que decidir antes de programar

**La ventana de 24 horas.** Si el cliente navega, se distrae y hace checkout al
día siguiente, WhatsApp ya no permite un mensaje libre: hace falta una plantilla.
Conviene decidirlo ahora —plantilla de «tu carrito te espera»— y no descubrirlo
cuando un cliente real no reciba nada.

---

## 4. Sobre la pieza de código abierto marca blanca

**Yo no la usaría, y creo que sale más barato no usarla.**

La consola ya es una aplicación React sobre Firebase Hosting, con su API y su
sistema de diseño. Una ruta pública de catálogo —lista, detalle, carrito,
checkout— es alrededor de un día y medio. Integrar una plantilla ajena cuesta
entenderla, alojarla, mantenerla actualizada y hacerla parecerse a NovuChat, y
deja una dependencia más que auditar.

La excepción sería encontrar una plantilla que ya haga exactamente esto y se
pueda leer entera en una tarde. Vale mirar; no vale adoptarla sin leerla.

---

## 5. Cuánto cuesta

| | Qué | Estimado |
|---|---|---|
| A | Sitio del catálogo en la consola: lista, detalle, carrito, checkout | 1,5 días |
| B | Endpoint de checkout, firmado, con la ficha de conversación | medio día |
| C | El enlace desde el flujo: marca, ficha, caducidad | medio día |
| D | Importar CSV/Sheets a la consola, con validación de las URL de imagen | medio día a 1 día |
| E | Entregar el carrito en la conversación y despertar al flujo | medio día |
| F | Pruebas, incluida la del teléfono | medio día |

**Total: unos 4 días.** Más que el catálogo nativo de Meta (2,5 a 3), y a cambio:
sin revisión de Meta, sin depender de nadie, sirve para catálogos de cualquier
tamaño, una sola fuente de verdad, y es de NovuChat.

---

## 6. Comparación de los tres caminos

| | Plataformas externas | Catálogo nativo de Meta | **Catálogo web propio** |
|---|---|---|---|
| El carrito se puede falsificar | **sí** | no | **no** |
| Fuentes de verdad | dos o tres | una | **una** |
| Depende de un tercero | sí | Meta | **no** |
| Revisión previa | no | **sí, días** | no |
| Imágenes | del tercero | hay que montarlas | **de la empresa, por URL** |
| Catálogos grandes | sí | sí | **sí** |
| Costo | 0 | 2,5–3 días | 4 días |
| Vale para el Flujo A | no | no | **sí, si algún día hace falta** |

---

## 7. Recomendación

**El diseño es adecuado y lo haría**, con las dos correcciones de §3. No antes de
las demos: es trabajo de después, y compite en prioridad con la brecha del rol
`ingesta`, la compuerta de reserva y la purga de retención.

**Antes de escribir una línea**, dos decisiones que no son técnicas:

1. ¿El catálogo web lleva la marca de NovuChat o la del comercio? Cambia el
   diseño de la página y el argumento de venta.
2. ¿Qué pasa cuando el carrito llega fuera de la ventana de 24 horas? Sin eso
   resuelto, el diseño tiene un agujero que se descubre con un cliente real.

---

## 8. Escrito (2026-09-07)

Andres decidió las dos preguntas del §7 y pidió construirlo. Quedó hecho en esta
misma rama, sin tocar nada de los demos del 9 y 10.

**Las dos decisiones:**

1. **La marca es la del comercio**, con NovuChat en el pie de la página. El
   cliente final cree —con razón— que le está escribiendo a la panadería; una
   marca que no le presentaron, justo en el momento de pagar, es una venta menos.
2. **Fuera de la ventana de 24 horas se manda una plantilla** de «tu carrito te
   espera». Hay que darla de alta en Meta: es lo único de todo esto que depende
   de un tercero y de un plazo de aprobación.

**Las dos correcciones del §3 se aplicaron tal cual.** El CSV entra como formato
de importación y la consola queda como única fuente de verdad; el enlace lleva una
ficha por conversación —no el teléfono—, va firmado con la pieza que ya existía y
caduca a las 72 horas.

**Lo que quedó, contra el presupuesto del §5:**

| | Qué | Estimado | Dónde quedó |
|---|---|---|---|
| A | Sitio del catálogo: lista, detalle, carrito, checkout | 1,5 días | `admin/web/src/publico/` |
| B | Endpoint de checkout, firmado, con la ficha | medio día | `admin/functions/src/catalogoWeb.ts` |
| C | El enlace desde el flujo: marca, ficha, caducidad | medio día | `enlaceCatalogo` + `admin/CATALOGO-WEB.md` §4.1 |
| D | Importar CSV/Sheets, con validación de las URL | medio día a 1 | `admin/web/src/lib/csv.ts` y la pestaña de catálogo |
| E | Entregar el carrito y despertar al flujo | medio día | `despertarFlujo` + `fijarWebhookCarrito` |
| F | Pruebas | medio día | `admin/pruebas/catalogo-web.test.ts` (50) |

**Lo que NO está hecho, y no es un olvido:**

- **Los dos nodos de n8n y la plantilla de Meta.** No se tocó ningún JSON de
  `Flujos/`: son la exportación de lo que corre en n8n y editarlos a mano los
  separa de la realidad, además de que el congelamiento es mañana. Están
  especificados nodo por nodo en `admin/CATALOGO-WEB.md` §4.
- **La prueba contra un teléfono real**, que exige el proyecto de nube creado.
- **La reentrega si el webhook del flujo falla.** El pedido queda guardado y
  visible en la consola, marcado `entregadoAlFlujo: false`; hoy hay que mirarla.
- **La purga de las fichas caducadas**, que entra en la retención de 12 meses
  junto con todo lo demás.

Y una consecuencia que conviene conocer: la página pública y la consola comparten
origen. Se aceptó con argumentos en `admin/SEGURIDAD.md` T-37, junto con lo que
hay que hacer —un segundo sitio de Hosting— antes de tener volumen real.

---

## 9. Dos correcciones del análisis comercial (08/09)

`Analisis/19-catalogo-web-y-precio-por-flujo.md` revisó este diseño con las
tarifas de Meta del 1 de octubre y corrigió dos cosas.

**1. El umbral del punto 7 sobrevive, pero el motivo era otro.** Acá se dijo que
el umbral evita que «el catálogo deje de crecer dentro de cada mensaje», y la
implementación lo justificó por costo y latencia. Medido: **500 ítems en el
prompt cuestan 0,0585 Bs, o sea 0,43 mensajes del asistente.** El catálogo entero
de una ferretería cuesta menos de medio mensaje; el token dejó de ser la
restricción el día que Meta empezó a cobrar por mensaje. El umbral se mantiene
por legibilidad del chat y confiabilidad del modelo, y los 40 son una
recomendación, no una medición.

**2. Los ítems «a consultar» no van al catálogo web.** No estaba dicho en ninguna
parte de este documento y la primera implementación los publicaba, con un texto
que invitaba a agregarlos al carrito. Publicar algo que no se puede comprar es la
forma más cara de generar una conversación: el cliente pregunta, el asistente no
puede cerrar, y cada mensaje se paga. Corregido en los tres endpoints.

Y una tercera conclusión, que no corrige nada pero cambia la prioridad: **con el
catálogo web el Flujo B pasa de costar 25 % más que el A a costar 61 % menos**,
porque un pedido baja de 13 mensajes a 4. Sobre un plan de 200 conversaciones el
margen del flujo de pedidos va de 46 % a 98 %. Eso no justifica cobrar distinto
por flujo —la diferencia se está por invertir— pero sí prioriza poner esto en
marcha.
