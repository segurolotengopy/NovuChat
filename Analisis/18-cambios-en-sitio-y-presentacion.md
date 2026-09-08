# Cambios en `novuchat.site` y en la presentación

**08-sep-2026.** Instrucciones exactas para aplicar las recomendaciones de
`14-costo-por-conversacion-y-precios.md`, `15-unidad-de-cobro.md` y
`16-sensibilidad-topes-y-bolsas.md`. El resumen para leer antes está en
`17-resumen-ejecutivo-precios.md`.

**Dos repositorios distintos.** El sitio vive en `~/Novuchat-site`, que no es un
worktree de NovuChat. La presentación es un archivo suelto en `~/Descargas`.

**No apliqué ninguno de estos cambios**: son instrucciones para que las revise
Silvana y las aplique quien corresponda. Los cambios de precios y volúmenes
**dependen de la decisión del §7 del documento 17** y no deberían aplicarse
antes de que esté tomada.

**Orden recomendado:** primero el sitio (§1 a §5), porque es la fuente que
alimenta el JSON-LD y las páginas en dos idiomas; después la presentación (§6),
copiando de ahí los textos ya aprobados.

---

## 1. `src/contenido/precios.es.ts` — planes y excedente

### 1.1 Volúmenes de los tres planes

Hay **dos lugares por plan**: el campo `conversaciones`, que alimenta el JSON-LD
y los cálculos, y la línea de texto que ve el visitante. Cambiar los dos o
quedan incoherentes.

| Línea | Antes | Después |
|---|---|---|
| 20 | `conversaciones: 300,` | `conversaciones: 120,` |
| 24 | `{ texto: '300 conversaciones al mes' },` | `{ texto: '120 conversaciones al mes' },` |
| 34 | `conversaciones: 1000,` | `conversaciones: 200,` |
| 39 | `{ texto: '1.000 conversaciones al mes' },` | `{ texto: '200 conversaciones al mes' },` |
| 52 | `conversaciones: 2500,` | `conversaciones: 300,` |
| 56 | `{ texto: '2.500 conversaciones al mes' },` | `{ texto: '300 conversaciones al mes' },` |

Los `precioBs` (250, 450, 850) **no se tocan**.

### 1.2 Excedente

Línea 78:

```ts
// antes
excedente: { precioBs: 50, conversaciones: 150 },
// después
excedente: { precioBs: 110, conversaciones: 25 },
```

### 1.3 El tope de mensajes, que hoy no está

Agregar una línea al `incluye` de **cada uno de los tres planes**, para que el
tope se vea en la tarjeta y no solo en el glosario:

```ts
{ texto: 'Hasta 25 respuestas del asistente por conversación' },
```

### 1.4 «Cómo contamos las conversaciones»

Es el bloque que más cambia, porque contiene la frase que deja de ser cierta y
un argumento que conviene reformular.

**Primer párrafo.** Quitar «sin importar cuántos sean» y decir el tope:

```
// antes
'Una conversación son todos los mensajes que intercambias con un mismo cliente
durante 24 horas continuas, sin importar cuántos sean. Si alguien te escribe a
las nueve de la mañana, sigue preguntando al mediodía y cierra su pedido a las
seis de la tarde, eso es una sola conversación.'

// después
'Una conversación son todos los mensajes que intercambias con un mismo cliente
durante 24 horas continuas. Si alguien te escribe a las nueve de la mañana,
sigue preguntando al mediodía y cierra su pedido a las seis de la tarde, eso es
una sola conversación. El asistente responde hasta 25 veces dentro de esa
conversación; si hace falta más, te avisa para que la tome alguien de tu
equipo.'
```

**Segundo párrafo.** El argumento actual —«cobrar por mensaje empuja a responder
corto»— es correcto pero hoy suena a que nosotros estamos libres de ese
incentivo, y no lo estamos (ver `15-unidad-de-cobro.md` §4). Sugerencia:

```
// antes
'Lo hacemos así porque es la única medida que no te castiga por conversar.
Cobrar por mensaje empuja a responder corto, y un asistente que responde corto
vende menos.'

// después
'Lo hacemos así porque no te castiga por conversar: una conversación de tres
mensajes y una de veinte cuestan lo mismo. Cobrar por mensaje te obligaría a
vigilar cuánto habla el asistente, y un asistente que responde corto vende
menos.'
```

**Tercer párrafo:** sin cambios.

### 1.5 Glosario

**Entrada «Conversación»** — agregar el tope:

```
// antes
'Todos los mensajes con un mismo cliente en 24 horas continuas. Es la unidad que
se factura.'

// después
'Todos los mensajes con un mismo cliente en 24 horas continuas, con hasta 25
respuestas del asistente. Es la unidad que se factura.'
```

**Entrada «Excedente»** — actualizar las cifras:

```
// antes
'Si superas las conversaciones de tu plan, cada bloque adicional de 150
conversaciones cuesta 50 Bs. No se corta el servicio ni se te cobra sorpresa: te
avisamos al llegar al 80 %.'

// después
'Si superas las conversaciones de tu plan, cada bloque adicional de 25
conversaciones cuesta 110 Bs y no vence. Te avisamos al llegar al 80 % de tu
plan, y nunca se te cobra sin que lo apruebes.'
```

> ⚠️ **Verificar contra el prepago antes de publicar.** El sistema de cobro
> (rama `claude/novuchat-prepago-clientes-49caf7`) **corta el servicio** al
> agotarse las conversaciones. La frase actual dice «no se corta el servicio», y
> eso ya no es cierto. Hay que alinear las dos cosas: o el texto dice que se
> corta, o el prepago no corta. **Es una decisión comercial, no de redacción.**

---

## 2. `src/contenido/precios.en.ts` — la versión en inglés

**Los mismos cambios del §1**, en las mismas posiciones. Es el único archivo de
contenido con versión en inglés; `faq`, `inicio` y `verticales` son solo
en español.

| Antes | Después |
|---|---|
| `conversaciones: 300 / 1000 / 2500` | `120 / 200 / 300` |
| `'300 conversations a month'` y equivalentes | `'120 conversations a month'`, etc. |
| `excedente: { precioBs: 50, conversaciones: 150 }` | `{ precioBs: 110, conversaciones: 25 }` |

**Primer párrafo de `comoContamos`:** quitar «no matter how many» y agregar el
tope: `The assistant replies up to 25 times within that conversation; if more is
needed, we let you know so someone on your team can take over.`

**Glosario, entrada `Overage`:** `each additional block of 25 conversations
costs 110 Bs and never expires.`

Agregar a los tres planes: `{ texto: 'Up to 25 assistant replies per
conversation' }`.

---

## 3. `src/contenido/faq.es.ts`

**«¿Necesito un número nuevo de WhatsApp?»** — hoy ofrece conectar el número
existente, que según `13-requisitos-alta-clientes.md` §2 no conviene ofrecer a
los primeros clientes:

```
// antes
'No necesariamente. Podemos conectar el tuyo si es WhatsApp Business, o darte
uno de nuestra cuenta verificada. Si conectamos el tuyo, dejas de usar la
aplicación en el celular para ese número: las conversaciones pasan a verse en la
consola.'

// después
'Sí, y lo conseguimos nosotros: un número nuevo a tu nombre, dedicado al
asistente, incluido en la instalación. Tu WhatsApp de siempre sigue igual y es
donde te avisamos cuando una conversación necesita a una persona. Conectar tu
número actual es posible, pero entonces dejarías de poder responder desde el
celular con ese número, así que hoy no lo recomendamos.'
```

**«¿Qué pasa si no pago un mes?»** — hoy dice que se suspende el asistente y se
conserva el acceso en modo lectura. **Verificar contra el prepago** que sea
exactamente eso lo que ocurre, incluido el mensaje neutro al cliente final. Si
coincide, no se toca.

**«¿Los costos de WhatsApp y de la inteligencia artificial son aparte?»** —
sigue siendo cierto y **conviene reforzarlo**, porque ahora es un diferenciador
real frente a quien cobre por mensaje. Agregar al final:

```
'Tampoco te cobramos por cada mensaje que responde el asistente, aunque a
nosotros WhatsApp nos los cobre.'
```

**«¿Qué necesitan de mí para empezar?»** — reemplazar «Tu número de WhatsApp (o
te damos uno)» por «Un número nuevo, que conseguimos nosotros», y agregar «tus
horarios y quién atiende cada servicio», que es lo que pide la ficha de alta del
documento 13.

**Pregunta nueva, recomendada.** El tope va a generarla igual; mejor
contestarla antes:

```
pregunta: '¿Qué pasa si una conversación se hace muy larga?'
respuesta: 'El asistente responde hasta 25 veces por conversación. Si una
consulta necesita más que eso, casi siempre es porque se trabó: te avisamos al
número que nos des y la toma alguien de tu equipo, con todo el contexto de lo
que ya se habló. Pasa en una de cada diez conversaciones, más o menos.'
```

---

## 4. `src/contenido/inicio.es.ts`

**`instalacion48`, paso «Desarrollo»** — hoy dice «conectamos tu número de
WhatsApp, o te damos uno». Alinear con la FAQ: «damos de alta tu negocio,
cargamos tu configuración y conseguimos el número nuevo de tu asistente».

**`capacidades`** — sin cambios. Las seis siguen siendo ciertas.

**`compromiso`** — sin cambios. Es la banda oscura con las tres prohibiciones y
todas se sostienen.

---

## 5. `src/pages/como-funciona.astro`

Sección **«Qué necesitamos de ti»**, primera viñeta:

```
// antes
<li>Tu número de WhatsApp, o te damos uno de nuestra cuenta verificada</li>
// después
<li>Un número nuevo para tu asistente, que conseguimos y configuramos nosotros</li>
```

Agregar una viñeta al final de esa misma lista, que hoy falta y la ficha de alta
sí pide:

```
<li>Quién atiende cada servicio, si tienes más de una persona</li>
```

---

## 6. La presentación (`Presentación NovuChat4.html`)

Los textos de precios conviene copiarlos del sitio una vez aprobados, para que
no vuelvan a divergir.

### Lámina 10 — Planes

| Elemento | Antes | Después |
|---|---|---|
| Plan Base | «Hasta **300 chats**» | «Hasta **120 conversaciones**» |
| Plan Crecimiento | «Hasta **1,000 chats**» | «Hasta **200 conversaciones**» |
| Plan Corporativo | «Hasta **2,500 chats**» | «Hasta **300 conversaciones**» |
| Pie | «1 chat equivale a 24 horas continuas de interacción. Paquete extra: 50 Bs / 150 chats.» | «Una conversación son 24 horas continuas con un mismo cliente, con hasta 25 respuestas del asistente. Paquete extra: 110 Bs / 25 conversaciones.» |
| Crecimiento | «+ Procesamiento de Audios» | **Quitar**, o rotular «Próximamente» |
| Corporativo | «Solución de Fidelización (Por Uso)» | **Quitar**, o rotular «Próximamente» |

**Unificar «chats» con «conversaciones».** El sitio dice conversaciones y la
presentación dice chats; es la misma cosa y conviene un solo nombre.

### Lámina 4 — Nuestra solución integral

Tarjeta «Asistente IA 24/7»: quitar «**responde audios**». No existe.

### Lámina 5 — Industrias

| Rubro | Qué quitar o rotular |
|---|---|
| Comercio y Retail | «Validación **autónoma** de comprobantes de pago por QR» → el cobro real está construido en la consola pero **ningún flujo lo ejecuta**. Rotular «Próximamente» |
| Gastronomía | «Reserva inteligente de mesas y confirmación de asistencia» → no existe |
| Colegios y Universidades | **Quitar la tarjeta entera** o rotularla. No hay flujo para ese rubro, y las dos viñetas prometen cosas que nadie construyó |

Si se quitan tarjetas, la lámina queda con dos y hay que rehacer la grilla, que
hoy es de cuatro.

### Lámina 2 — El problema

«El 80 % no vuelve porque no hay un sistema que los incentive a regresar»:
**cifra sin fuente**. En la landing ya reemplazamos una cifra igual de huérfana
por el dato de Harvard Business Review. Dos opciones: quitarla, o reemplazarla
por el mismo dato citable que usa el sitio.

### Lámina 3 — La gráfica

«Responder en el primer minuto aumenta las probabilidades de conversión en un
**391 %**». El sitio dice «**siete veces más probable**» citando el mismo estudio
de 2011. **391 % es 4,9 veces, no siete.** Son dos cifras distintas para el mismo
hecho, en dos materiales que un cliente puede ver juntos.

**Corregir la presentación al número del sitio**, y no al revés: el del sitio
tiene la fuente escrita al lado.

### Lámina 11 — Setup

«Consultas SQL en tiempo real» e «Integración a ERPs/Sistemas Propios» en el
Setup A Medida: no existen como producto. **No hace falta quitarlos** —el setup a
medida es, por definición, desarrollo— pero conviene que la lámina diga que es
desarrollo a medida cotizado caso por caso, y no una función disponible.

---

## 7. Lista de verificación antes de publicar

- [ ] Las cantidades nuevas están aprobadas (§7 del documento 17).
- [ ] `precios.es.ts` y `precios.en.ts` dicen lo mismo, en los seis lugares.
- [ ] Ninguna página dice «sin importar cuántos sean».
- [ ] El tope de 25 aparece en los tres planes, en el glosario y en la FAQ.
- [ ] La contradicción del excedente está resuelta: o el texto dice que se corta
      el servicio, o el prepago no corta.
- [ ] La presentación y el sitio usan la **misma palabra** —conversaciones— y la
      **misma cifra** para el estudio de la velocidad de respuesta.
- [ ] Nada promete audios, fidelización, reserva de mesas, colegios ni
      validación autónoma de comprobantes sin rótulo de «Próximamente».
- [ ] `pnpm listo` pasa en el sitio. Si algún dato quedó sin confirmar, va a
      `pendientes.ts` y **no** al texto de la página: ese es el mecanismo que ya
      existe para no publicar datos sin confirmar.
- [ ] La cláusula de revisión de precio está en el contrato, no solo en el sitio.
