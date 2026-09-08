# Instrucciones para `novuchat.site` — versión definitiva

**08-sep-2026.** Reemplaza a `18-cambios-en-sitio-y-presentacion.md`, que quedó
con los precios anteriores a la propuesta de Silvana. **Este es el documento
vigente para el sitio.**

**Los números finales** salen de `21-propuesta-de-silvana-comparada.md`, que los
analizó y adoptó. La presentación ya está actualizada en
`~/Descargas/Presentación NovuChat5.html`.

**No apliqué ninguno de estos cambios.** Son instrucciones. El sitio vive en
`~/Novuchat-site`, que no es un worktree de NovuChat.

---

## 0. La tabla de referencia — de acá salen todos los números

| | Impulso | Crecimiento | Pro |
|---|---|---|---|
| **Precio** | **USD 25** | **USD 50** | **USD 90** |
| **Conversaciones al mes** | **100** | **220** | **500** |
| Tope de respuestas por conversación | 25 | 25 | 25 |

**Paquete adicional:** USD 10 por 25 conversaciones, no vencen.
**Instalación:** USD 65 estándar (bonificada en la Rueda), desde USD 125 a medida.
**Moneda:** precios en dólares, cobro en bolivianos al Tipo de Cambio Oficial del
Banco Central de Bolivia.

**Los nombres de los planes son los del sitio** —Impulso, Crecimiento, Pro— y la
presentación ya se alineó a ellos. La propuesta de Silvana los llamaba Base,
Crecimiento y Corporativo: **no adoptar esos nombres**, porque `precios.es.ts`
los tiene como un tipo cerrado (`'impulso' | 'crecimiento' | 'pro'`) y cambiarlos
toca el tipado, las rutas de `soluciones/[vertical]` y el JSON-LD.

---

## 1. La moneda: renombrar el campo antes de tocar valores

El campo se llama `precioBs` y está en nueve lugares más el JSON-LD.

**`src/contenido/tipos.ts`**, dos interfaces (líneas 13 y 41):

```ts
precioBs: number;   →   precioUsd: number;
```

**Los nueve usos:**

| Archivo | Hoy | Debe decir |
|---|---|---|
| `src/pages/precios.astro:37` | `{plan.precioBs} Bs <small>/ mes</small>` | `USD {plan.precioUsd} <small>/ mes</small>` |
| `src/pages/precios.astro:81` | `cuesta {excedente.precioBs} Bs` | `cuesta USD {excedente.precioUsd}` |
| `src/pages/index.astro:232` | `{plan.precioBs} Bs <small>/ mes</small>` | `USD {plan.precioUsd} <small>/ mes</small>` |
| `src/pages/soluciones/[vertical].astro:83` | `{plan.precioBs} Bs <small>/ mes</small>` | `USD {plan.precioUsd} <small>/ mes</small>` |
| `src/pages/terminos.astro:45` | `cuesta {excedente.precioBs} Bs` | `cuesta USD {excedente.precioUsd}` |
| `src/pages/en/index.astro:99` | `{plan.precioBs} Bs <small>/ month</small>` | `USD {plan.precioUsd} <small>/ month</small>` |
| `src/pages/en/precios.astro:32` | `{plan.precioBs} Bs <small>/ month</small>` | `USD {plan.precioUsd} <small>/ month</small>` |
| `src/pages/en/precios.astro:72` | `costs {excedente.precioBs} Bs` | `costs USD {excedente.precioUsd}` |
| `src/components/DatosEstructurados.astro:64` | `price: String(plan.precioBs)` | `price: String(plan.precioUsd)` |

**Y la moneda del JSON-LD**, `DatosEstructurados.astro:65`:

```ts
priceCurrency: 'BOB',   →   priceCurrency: 'USD',
```

> **Es el cambio que menos se ve y el que más cuesta si se olvida.** Google
> publica ese precio en los resultados de búsqueda: con `BOB` y el valor 25, un
> buscador anunciaría el plan a 25 bolivianos.

---

## 2. `src/contenido/precios.es.ts`

### 2.1 Precios y volúmenes

| Línea | Hoy | Debe decir |
|---|---|---|
| 19 | `precioBs: 250,` | `precioUsd: 25,` |
| 20 | `conversaciones: 300,` | `conversaciones: 100,` |
| 24 | `{ texto: '300 conversaciones al mes' },` | `{ texto: '100 conversaciones al mes' },` |
| 33 | `precioBs: 450,` | `precioUsd: 50,` |
| 34 | `conversaciones: 1000,` | `conversaciones: 220,` |
| 39 | `{ texto: '1.000 conversaciones al mes' },` | `{ texto: '220 conversaciones al mes' },` |
| 51 | `precioBs: 850,` | `precioUsd: 90,` |
| 52 | `conversaciones: 2500,` | `conversaciones: 500,` |
| 56 | `{ texto: '2.500 conversaciones al mes' },` | `{ texto: '500 conversaciones al mes' },` |
| 78 | `excedente: { precioBs: 50, conversaciones: 150 },` | `excedente: { precioUsd: 10, conversaciones: 25 },` |

**Hay dos lugares por plan** —el campo que alimenta el JSON-LD y la línea que ve
el visitante—. Cambiar los dos o quedan incoherentes.

En `instalacion`: `estandar: 800` → `estandar: 65`; `aMedidaDesde: 1500` →
`aMedidaDesde: 125`.

### 2.2 El tope, que hoy no está en ninguna parte

Agregar al `incluye` de **los tres planes**:

```ts
{ texto: 'Hasta 25 respuestas del asistente por conversación' },
```

### 2.3 «Cómo contamos las conversaciones»

**Primer párrafo** — quitar «sin importar cuántos sean», que deja de ser cierto:

```
'Una conversación son todos los mensajes que intercambias con un mismo cliente
durante 24 horas continuas. Si alguien te escribe a las nueve de la mañana,
sigue preguntando al mediodía y cierra su pedido a las seis de la tarde, eso es
una sola conversación. El asistente responde hasta 25 veces dentro de esa
conversación; si hace falta más, te avisamos para que la tome alguien de tu
equipo.'
```

**Segundo párrafo** — el argumento actual suena a que NovuChat está libre del
incentivo de responder corto, y no lo está:

```
'Lo hacemos así porque no te castiga por conversar: una conversación de tres
mensajes y una de veinte cuestan lo mismo. Cobrar por mensaje te obligaría a
vigilar cuánto habla el asistente, y un asistente que responde corto vende
menos.'
```

**Tercer párrafo:** sin cambios.

### 2.4 Glosario

**«Conversación»** → agregar el tope: `'…en 24 horas continuas, con hasta 25
respuestas del asistente. Es la unidad que se factura.'`

**«Excedente»** → `'Si superas las conversaciones de tu plan, cada bloque
adicional de 25 conversaciones cuesta USD 10 y no vence. Te avisamos al llegar al
80 % de tu plan.'`

> ⚠️ **Quitar de esa definición la frase «No se corta el servicio».** El sistema
> de prepago **sí corta** al agotarse las conversaciones. Es la única
> contradicción del sitio que no es de redacción sino de producto: hay que
> alinear el texto con el prepago, o el prepago con el texto.

**«Atención»** → **no se toca, y es importante que no se toque.** Dice que la
atención no se factura, y es correcto. La unidad que se cobra es la
*conversación*, en el sitio, en la presentación y en la consola. Ver §5.

---

## 3. `src/contenido/precios.en.ts`

Los mismos cambios, en las mismas posiciones. Es el único contenido con versión
en inglés.

| Hoy | Debe decir |
|---|---|
| `precioBs: 250 / 450 / 850` | `precioUsd: 25 / 50 / 90` |
| `conversaciones: 300 / 1000 / 2500` | `100 / 220 / 500` |
| `'300 conversations a month'`, etc. | `'100 conversations a month'`, etc. |
| `excedente: { precioBs: 50, conversaciones: 150 }` | `{ precioUsd: 10, conversaciones: 25 }` |

**Primer párrafo de `comoContamos`:** quitar «no matter how many» y agregar
`The assistant replies up to 25 times within that conversation; if more is
needed, we let you know so someone on your team can take over.`

**Glosario, `Overage`:** `each additional block of 25 conversations costs USD 10
and never expires.`

**Y en los tres planes:** `{ texto: 'Up to 25 assistant replies per conversation' }`.

---

## 4. La nota de moneda, en tres lugares

**Página de precios**, cerca de las tarjetas:

```
Los precios están expresados en dólares estadounidenses. El cobro se realiza en
bolivianos, al Tipo de Cambio Oficial que publica el Banco Central de Bolivia.
```

**Términos** (`src/pages/terminos.astro`), con más precisión:

```
Los precios se expresan en dólares estadounidenses. La facturación se emite en
bolivianos por el importe resultante de aplicar el Tipo de Cambio Oficial
publicado por el Banco Central de Bolivia correspondiente al primer día hábil
del mes facturado, que se mantiene durante todo ese mes y se muestra en la
consola del comercio.
```

**FAQ**, pregunta nueva:

```
pregunta: '¿En qué moneda pago?'
respuesta: 'Los precios están en dólares y el cobro se hace en bolivianos, al
Tipo de Cambio Oficial del Banco Central de Bolivia. Tomamos el del primer día
hábil de cada mes y lo mantenemos todo ese mes, así que sabes exactamente cuánto
vas a pagar antes de hacerlo, y puedes verificarlo en la página del Banco
Central.'
```

> **Falta una decisión, y es la única que bloquea estos tres textos:** si se toma
> el TCO del día de pago o el del primer día hábil del mes. Están escritos con la
> **segunda** opción, recomendada en `14-…` §5ter. Si se decide la otra, hay que
> ajustar las tres redacciones.

---

## 5. Lo que NO hay que escribir — la lista de «no meter la pata»

Cada línea de acá tiene detrás un análisis. **Ninguna es una opinión de estilo.**

### 5.1 Vocabulario

| No escribir | Escribir | Por qué |
|---|---|---|
| «chats» | **conversaciones** | El sitio, la consola y la factura usan una sola palabra |
| «atenciones» para lo que se cobra | **conversaciones** | El glosario del propio sitio dice que la atención **no se factura**. Un cliente que mire los dos materiales ve la contradicción |
| «sin importar cuántos sean» | «hasta 25 respuestas del asistente» | Deja de ser cierto con el tope |

### 5.2 Funciones que no existen

**No prometer sin el rótulo «Próximamente»**, y solo si de verdad está en camino:

- **Audios.** El asistente **no** escucha audios: responde con cortesía pidiendo
  que lo escriban. Y cada audio transcrito sería además una respuesta cobrada.
- **Fidelización con puntos.** No existe.
- **Difusión masiva por plantillas.** La vía existe, pero **cada mensaje de
  difusión cuesta 0,89 Bs**: mandar a 1.000 contactos vale más que el plan
  entero. Si alguna vez se ofrece, es **aparte y por paquete**, nunca incluida.
- **Validación autónoma de comprobantes.** El cobro real está construido en la
  consola, pero **ningún flujo lo ejecuta todavía**: el asistente sigue enviando
  el QR de demostración. Decir que el asistente **recibe** el comprobante, no que
  lo valida solo.
- **Reserva de mesas. Colegios y universidades.** No hay flujo para ninguno.
- **Consultas SQL, integración a ERPs.** No es una función disponible: es
  desarrollo a medida, cotizado caso por caso. Decirlo así.

### 5.3 Cifras sin fuente

- **Nunca una estadística sin la fuente al lado.** El sitio ya usa el estudio de
  Harvard Business Review de 2011 para «siete veces más probable» y «el 23 % de
  las empresas nunca responde». **Si hace falta un número, que sea ese.**
- **No decir «391 % más conversión».** Es el mismo estudio expresado de otra
  forma —391 % son 4,9 veces, no siete— y tener dos cifras para el mismo hecho en
  dos materiales es peor que no tener ninguna.
- **No decir «el 80 % no vuelve».** No tiene fuente.

### 5.4 Promesas sobre el cobro

- **Nunca «pago acreditado», «pago verificado» ni «recibimos tu pago».** El
  asistente dice que **recibió el comprobante** y que los datos coinciden. Quien
  confirma que entró la plata es el banco. Es la prohibición 3 de `CLAUDE.md` y
  no se negocia por una razón comercial.
- En demostraciones, el QR va rotulado como simulado **en la imagen y en el
  texto**.

### 5.5 Márgenes y garantías

- **No publicar ningún porcentaje de margen ni «piso garantizado».** El 32 % que
  aparece en el análisis interno es el caso central, no un piso, y no es
  información para el cliente.
- **No prometer que las conversaciones desde anuncios no consumen el plan.**
  Meta regala 72 horas cuando el cliente llega por un anuncio de clic a WhatsApp,
  y probablemente sea cierto, **pero no está medido con un cliente real**.

### 5.6 El número de WhatsApp

- **No ofrecer conectar el número actual del negocio** como si fuera lo
  recomendado. Hoy hacerlo deja al comercio sin poder responder desde el celular
  con ese número. Se ofrece **un número nuevo, a nombre del cliente, incluido en
  la instalación**.
- La redacción propuesta en el §6 **no cierra la puerta**: conectar el número
  propio se vuelve razonable cuando NovuChat sea Tech Provider ante Meta.

---

## 6. `src/contenido/faq.es.ts`

**«¿Necesito un número nuevo de WhatsApp?»**

```
'Sí, y lo conseguimos nosotros: un número nuevo a tu nombre, dedicado al
asistente, incluido en la instalación. Tu WhatsApp de siempre sigue igual y es
donde te avisamos cuando una conversación necesita a una persona. Conectar tu
número actual es posible, pero entonces dejarías de poder responder desde el
celular con ese número, así que hoy no lo recomendamos.'
```

**«¿Los costos de WhatsApp y de la inteligencia artificial son aparte?»** —
sigue siendo cierto y **ahora es un diferenciador**. Agregar al final:

```
'Tampoco te cobramos por cada mensaje que responde el asistente, aunque a
nosotros WhatsApp nos los cobre.'
```

**«¿Qué necesitan de mí para empezar?»** — reemplazar «Tu número de WhatsApp (o
te damos uno)» por «Un número nuevo, que conseguimos nosotros», y agregar «tus
horarios y quién atiende cada servicio».

**«¿Qué pasa si no pago un mes?»** — verificar contra el prepago que sea
exactamente lo que ocurre, incluido el mensaje neutro al cliente final.

**Pregunta nueva, sobre el tope:**

```
pregunta: '¿Qué pasa si una conversación se hace muy larga?'
respuesta: 'El asistente responde hasta 25 veces por conversación. Si una
consulta necesita más que eso, casi siempre es porque se trabó: te avisamos al
número que nos des y la toma alguien de tu equipo, con todo el contexto de lo
que ya se habló. Pasa en una de cada diez conversaciones, más o menos.'
```

---

## 7. Otros archivos

**`src/contenido/inicio.es.ts`**, paso «Desarrollo» de `instalacion48`: hoy dice
«conectamos tu número de WhatsApp, o te damos uno». Cambiar por «damos de alta tu
negocio, cargamos tu configuración y conseguimos el número nuevo de tu
asistente». El resto de `inicio.es.ts` no se toca: las seis capacidades y el
compromiso siguen siendo ciertos.

**`src/pages/como-funciona.astro`**, sección «Qué necesitamos de ti»:

```
// primera viñeta
<li>Un número nuevo para tu asistente, que conseguimos y configuramos nosotros</li>
// viñeta nueva al final
<li>Quién atiende cada servicio, si tienes más de una persona</li>
```

---

## 8. Lista de verificación antes de publicar

- [ ] `grep -rn "precioBs" src/` no devuelve nada.
- [ ] `priceCurrency` dice `USD` y no `BOB`.
- [ ] Los seis lugares de precios y volúmenes coinciden en `precios.es.ts` y
      `precios.en.ts`: **25 / 50 / 90** y **100 / 220 / 500**.
- [ ] Ninguna página dice «sin importar cuántos sean», «chats» ni «atenciones»
      para lo que se cobra.
- [ ] El tope de 25 aparece en los tres planes, en el glosario y en la FAQ.
- [ ] La contradicción del excedente está resuelta: o el texto no dice «no se
      corta el servicio», o el prepago no corta.
- [ ] Está decidido qué día del TCO se toma, y los tres textos del §4 dicen lo
      mismo.
- [ ] Nada de la lista del §5.2 aparece sin rótulo de «Próximamente».
- [ ] Ninguna estadística sin fuente al lado, y **una sola cifra** para el
      estudio de la velocidad de respuesta.
- [ ] El sitio y `~/Descargas/Presentación NovuChat5.html` dicen **los mismos
      números, la misma moneda y las mismas palabras**. Es el error más fácil de
      cometer, porque son dos archivos que nadie compara.
- [ ] `pnpm listo` pasa. Lo que quede sin confirmar va a `pendientes.ts`, no al
      texto de la página.
