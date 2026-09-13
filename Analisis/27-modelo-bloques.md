# La conversación como bloque de 25 respuestas

**13-sep-2026.** Análisis comercial y económico del cambio que propone Andres
en la unidad de cobro: **una conversación es un bloque de hasta 25 respuestas
del asistente a un mismo teléfono dentro de la ventana de 24 horas**. La
respuesta 26 del mismo día abre un bloque nuevo y factura otra conversación; a
las 24 horas la ventana se renueva y la cuenta vuelve a cero.

Dos ejemplos, tal como se enunció:

| Caso | Hoy (tope con corte, `Analisis/15`) | Con bloques |
|---|---|---|
| 26 respuestas a un cliente en un día | 1 conversación; a la 25 el asistente se detiene y avisa a recepción | **2 conversaciones**; el asistente sigue |
| 20 respuestas hoy y 2 mañana | 2 conversaciones (dos ventanas) | 2 conversaciones (dos ventanas): **no cambia** |

Modelo reproducible: `Analisis/27-modelo-bloques.py` (`python3`, reutiliza las
tarifas de `14-modelo-costos.py`; impuestos del 16 % como en `Analisis/21`).

**Conclusión, adelantada.** El cambio **se puede hacer y conviene hacerlo**,
pero no por el dinero: en un mes normal deja entre cero y unos pocos dólares
por comercio. Lo que compra es **continuidad del servicio** —ningún cliente
queda a medias por haber hablado mucho— y una regla más honesta que el tope,
porque convierte en cobro lo que hoy es un corte. Lo que cuesta es **perder el
techo de costo por ventana**, y eso se arregla con un tope de seguridad que no
es comercial. El detalle está abajo.

---

## 1. Qué cambia de verdad, y qué no

La ventana de 24 horas, el ancla en la primera consulta, las cortesías que no
abren nada, el mes calendario del prepago: **nada de eso se toca**. El segundo
ejemplo (20 hoy, 2 mañana) ya da dos conversaciones con la regla vigente, porque
son dos ventanas.

Lo único nuevo es **dentro** de una ventana: hoy la respuesta 26 no existe (el
asistente se detuvo en la 25); con bloques existe, se envía, y **cuenta otra
conversación**. Es la observación de `Analisis/15` §5 llevada a su
consecuencia: «la conversación con tope ya es un paquete de mensajes con precio
fijo». Ahora es un paquete que se puede comprar dos veces en el mismo día.

Dicho en la unidad que cobra Meta: **cada conversación facturada vale como
máximo 25 mensajes de servicio**, sea el primer bloque o el tercero. Por eso el
precio mínimo de la bolsa de `Analisis/23` (0,3632 USD para no perder nunca)
**no cambia**.

---

## 2. La unidad: qué cuesta y qué rinde un bloque

Fuera de la franquicia de 1.000 mensajes, en USD y neto del 16 % de impuestos:

| Respuestas del bloque | Costo | Base (0,210 neto) | Crecimiento (0,191) | Corporativo (0,151) | Q'Taco (0,168) | Bolsa (0,280) |
|---|---|---|---|---|---|---|
| 5 | 0,066 | +0,144 | +0,125 | +0,086 | +0,102 | +0,214 |
| 10 | 0,126 | +0,084 | +0,065 | +0,026 | +0,042 | +0,154 |
| 15 | 0,185 | +0,025 | +0,005 | −0,034 | −0,017 | +0,095 |
| 20 | 0,245 | −0,035 | −0,054 | −0,094 | −0,077 | +0,035 |
| **25 (lleno)** | **0,305** | −0,095 | −0,114 | −0,154 | −0,137 | −0,025 |

Es la misma tabla que ya gobernaba el tope: **un bloque lleno pierde plata en
todos los planes** y lo pagan los bloques cortos. Eso no lo cambia ninguna
unidad de cobro; lo cambia el precio (`Analisis/21` §3). Lo que sí decide la
unidad es qué pasa con la conversación **que sigue** después del bloque lleno.

### Una ventana larga, con las dos reglas

Resultado neto de **una** ventana, plan Crecimiento y bolsa:

| Respuestas que necesitó | Tope: msj / fact. / resultado | Bloques: msj / fact. / resultado (Crecimiento) | (Bolsa) |
|---|---|---|---|
| 25 | 25 / 1 / −0,114 | 25 / 1 / −0,114 | −0,025 |
| 26 | 26 / 1 / −0,126 | 26 / 2 / **+0,065** | **+0,243** |
| 30 | 26 / 1 / −0,126 | 30 / 2 / +0,017 | +0,195 |
| 35 | 26 / 1 / −0,126 | 35 / 2 / −0,043 | +0,135 |
| 50 | 26 / 1 / −0,126 | 50 / 2 / −0,222 | −0,044 |
| 100 | 26 / 1 / −0,126 | 100 / 4 / −0,439 | −0,082 |
| 200 | 26 / 1 / −0,126 | 200 / 8 / **−0,871** | −0,158 |

Se lee así:

- **Una ventana que se pasa poco (26 a ~32 respuestas) deja de perder y gana.**
  El segundo bloque casi vacío se cobra entero. Es el caso más común de las
  conversaciones largas: el pedido que necesitaba dos o tres respuestas más.
- **Una ventana que se pasa mucho pierde más que hoy**, porque hoy el corte le
  ponía un techo de 26 mensajes a cualquier ventana y con bloques no hay
  techo. A 50 respuestas ya se pierde el doble que con el tope; a 200, siete
  veces más.
- **En la bolsa (0,333) todo mejora** hasta las 35 respuestas, y de ahí en más
  pierde centavos.

---

## 3. El mes de un comercio

Mezcla de `Analisis/16`: 60 % de ventanas de 5 respuestas, 30 % de 10, y una
**cola** de ventanas largas. Plan lleno; lo que excede el plan se compra en
bolsas a 0,333. Diferencia de resultado neto **bloques − tope**, en USD por
mes:

| Plan | Cola 2 % | 5 % | 10 % | 20 % | 30 % |
|---|---|---|---|---|---|
| **Si las largas necesitan 35 respuestas** (se pasan poco) | | | | | |
| Base | +0,55 | +1,37 | +2,74 | +3,45 | +5,17 |
| Crecimiento | +0,76 | +1,90 | +3,79 | +7,58 | +11,38 |
| Corporativo | +1,72 | +4,31 | +8,62 | +17,24 | +25,85 |
| Q'Taco (USD 40 / 200) | +0,69 | +1,72 | +3,45 | +6,89 | +10,34 |
| **Si las largas necesitan 50 respuestas** (llenan dos bloques) | | | | | |
| Base | +0,53 | +1,32 | +1,51 | −0,14 | −0,21 |
| Crecimiento | −0,03 | −0,08 | −0,16 | −0,31 | −0,47 |
| Corporativo | −0,07 | −0,18 | −0,35 | −0,71 | −1,06 |
| Q'Taco | −0,03 | −0,07 | −0,14 | −0,28 | −0,42 |

**En dinero, el cambio es casi neutro.** Con la cola del 10 % que se viene
usando como caso central, va de −0,35 a +8,62 USD por comercio y mes según
cuánto se pasen las ventanas largas. No es una palanca de margen: la palanca
sigue siendo cuántos mensajes tiene la conversación típica (`Analisis/25` §1.5).

Lo que sí hace el cambio es **trasladar al comercio el costo de sus clientes
largos**, que hoy lo absorbe NovuChat como pérdida en el tope y como servicio
no prestado después. Y eso se ve en el número que el comercio mira:

| Plan | Cola 10 %, largas de 35 | Cola 20 %, largas de 50 |
|---|---|---|
| Base (100 incluidas) | cubre **91** ventanas reales | 83 |
| Crecimiento (220) | 200 | 183 |
| Corporativo (500) | 455 | 417 |
| Q'Taco (200) | 182 | 167 |

**Un plan cubre entre un 5 % y un 17 % menos de clientes reales que los que
dice el número.** Es el efecto comercial más importante del cambio, y es el que
hay que decir en voz alta: «100 conversaciones» ya no significa «100 clientes
en el mes» sino «100 bloques», y un comercio con clientes charlatanes va a
sentir que le cobran dos por uno. El contrapeso es real: **antes de este cambio
ese cliente se quedaba sin atender**, y una venta que se cae vale más que 0,25
USD.

---

## 4. Lo comercial, cara a cara

| | Tope con corte (08/09) | Bloques de 25 (13/09) |
|---|---|---|
| **Qué pasa en la respuesta 26** | El asistente se detiene, manda una frase fija y avisa a recepción. Una persona sigue a mano | El asistente sigue. Se factura otra conversación. Conviene avisar a recepción igual |
| **Previsibilidad para el comercio** | Alta: N conversaciones = N clientes-día como máximo | Alta pero menor: N bloques; no sabe de antemano cuántos clientes se pasan |
| **Facilidad de explicar** | «Hasta 25 respuestas; si hace falta más, la toma tu equipo» | «Hasta 25 respuestas; si hace falta más, sigue y cuenta otra» — **igual de simple** |
| **Reclamo esperable** | «El asistente dejó colgado a mi cliente» | «Me cobraron dos conversaciones por un cliente» |
| **Alineación con el costo** | Techo por ventana: 26 mensajes | Techo por conversación facturada: 25 mensajes. **Sin techo por ventana** |
| **Riesgo de cola para NovuChat** | Acotado | Acotado por bloque, **no acotado por ventana** |
| **El argumento publicado** («no te castiga por conversar») | Sigue en pie hasta 25 | Sigue en pie hasta 25; de ahí se paga otra. Hay que decirlo |

Tres observaciones:

1. **El reclamo cambia de lado y mejora.** Hoy el reclamo posible es que el
   asistente abandonó una venta; con bloques es que se cobró de más por un
   cliente que habló mucho. El segundo es discutible con la consola a la vista
   (`bloquesAdicionales` dice exactamente cuántas fueron); el primero no tiene
   defensa.
2. **Se parece más al cobro por respuesta que se descartó en `Analisis/15`**,
   pero conserva lo que aquel análisis defendía: redondeo hacia arriba en
   bloques de 25 y máximo por conversación conocido. La incertidumbre que se
   traslada al comercio es chica —solo la cola— y visible.
3. **El aviso a recepción al llegar a 25 hay que conservarlo** aunque el corte
   se vaya: `Analisis/16` §1.4 sigue teniendo razón en que una conversación que
   pasa de 25 «no es un cliente exigente, es una conversación que se atascó».
   Que una persona mire cuesta **un** mensaje de Meta —el aviso sale por
   WhatsApp desde el número del negocio, §5.4—: 0,0113 USD por ventana larga,
   que no se le factura al comercio. **Hoy ese aviso no existe en el código**
   (§5.4.2).

---

## 5. El riesgo nuevo, y los dos umbrales de corte que lo cierran

Con el tope, ninguna ventana costaba más de 0,317 USD, pasara lo que pasara.
Con bloques y sin ningún techo:

| Respuestas en un día a un teléfono | Bloques facturados | Costo | Resultado Corporativo | Resultado bolsa |
|---|---|---|---|---|
| 25 | 1 | 0,31 | −0,15 | −0,03 |
| 100 | 4 | 1,20 | −0,60 | −0,08 |
| 200 | 8 | 2,40 | −1,19 | −0,16 |
| 500 | 20 | 5,99 | −2,96 | −0,39 |

No es una pérdida grande en dinero, pero es **una pérdida sin límite que nadie
decidió**: un bucle del flujo, un reintento de Meta mal manejado (`Analisis/25`
§3.3) o un cliente que insiste pueden fabricarla. Y del lado del comercio, un
bucle se le factura como 20 conversaciones.

### 5.1 Lo decidido: operador a las 50, bloqueo a las 100

Andres fijó dos umbrales, en la misma unidad que el bloque (respuestas del
asistente dentro de la ventana de 24 h) y **parametrizables por empresa**:

| Umbral | Por defecto | Qué pasa a partir de ahí |
|---|---|---|
| **Operador** | 50 (fin del bloque 2) | El asistente **no vuelve a llamar al modelo**. Cada consulta recibe un aviso fijo de uso extendido, y recepción recibe **un** aviso para que una persona tome la conversación |
| **Bloqueo** | 100 (fin del bloque 4) | **No se envía nada más** a ese teléfono hasta que la ventana se renueve (a las 24 h de su primer mensaje). Recepción recibe un aviso |

Los dos se leen de `cuenta/estado` (`umbralOperador`, `umbralBloqueo`), que
escribe NovuChat y el comercio solo lee. Si la pareja no es coherente —bloqueo
menor o igual que operador, valor fuera de 1 a 500— rigen los de respaldo,
enteros, no una mezcla.

### 5.2 Qué le hacen al techo

Techo de costo de **una** ventana, con las reglas puestas una al lado de la
otra (USD, fuera de la franquicia):

| Regla | Mensajes enviados | Bloques facturados | Costo | Resultado Corporativo | Resultado bolsa |
|---|---|---|---|---|---|
| Sin umbrales (200 respuestas) | 200 | 8 | 2,398 | −1,189 | −0,158 |
| **Operador a 50 con aviso fijo por consulta, bloqueo a 100** | 100 | 4 | **1,169** | −0,564 | −0,049 |
| Operador a 50 con un solo aviso y silencio (alternativa) | 51 | 3 | 0,615 | −0,162 | +0,225 |
| Tope con corte del 08/09 (referencia) | 26 | 1 | 0,317 | −0,166 | −0,037 |

Tres cosas que salen de la tabla:

1. **El techo vuelve a existir y es de 1,17 USD por ventana** —**1,19**
   contando los dos avisos a recepción, §5.4—, contra el infinito de los
   bloques solos. En dinero es peor que el tope viejo, pero el
   tope viejo pagaba ese ahorro con un cliente abandonado a la respuesta 26.
2. **Los 50 avisos fijos entre un umbral y el otro cuestan 0,565 USD y le
   facturan 2 bloques al comercio.** Es el precio de no dejar en silencio a un
   cliente que sigue escribiendo mientras espera a la persona. La alternativa
   —un solo aviso y callar— cuesta la mitad y pierde tres veces menos, pero
   deja al cliente sin respuesta desde la consulta 52 y vuelve inalcanzable el
   umbral de bloqueo. **Queda lo decidido: aviso por consulta.** Si el primer
   mes muestra clientes que insisten decenas de veces, la alternativa está a
   un cambio de flujo.
3. **Con el aviso a recepción a las 50 el comercio interviene antes del
   bloqueo.** Una persona que toma la conversación a la 50 evita los 50 avisos
   siguientes: el techo real depende de cuánto tarde recepción, no del número.

### 5.3 Por qué el servidor decide y el flujo obedece

Un saliente ya enviado no se puede rechazar. Por eso el estado del teléfono
—normal, operador o bloqueado— se calcula **sobre lo que ya se envió** y se
entrega al flujo **antes de llamar al modelo**, en `configuracionFlujo`, que
ahora acepta el `telefono` del cliente y devuelve `atencion.estado`. La ingesta
calcula lo mismo con la misma función, anota el estado en la conversación
(`atencionEstado`) y con esa marca se avisa a recepción **una sola vez por
umbral y por ventana**. Las dos cifras quedan contadas en el mes
(`derivadasAOperador`, `bloqueadas`): son la cola larga que `Analisis/16` pedía
medir, ya escrita.

### 5.4 Corrección del 13/09: los avisos a recepción, y el techo que hoy no existe

Revisión de este documento contra el código y los flujos. Cifras de las
secciones 7 y 8 de `27-modelo-bloques.py`.

#### 5.4.1 Cada aviso a recepción es un mensaje de Meta

El nodo «Avisar a recepción» de `Flujos/demo-a-agendamiento.json` es un nodo de
WhatsApp que manda **texto libre desde el número del negocio**
(`phoneNumberId`) a `numeroRecepcion`. De ahí salen tres cosas:

- **Cuesta 0,0113 USD** y consume la franquicia de 1.000 del número del
  comercio. No se factura al comercio: es costo de NovuChat.
- **Un texto libre solo llega si recepción le escribió a ese número en las
  últimas 24 h.** Si no, Meta lo rechaza (fuera de la ventana de servicio) y el
  aviso se pierde en silencio. Para que sea confiable hace falta una plantilla
  de utilidad aprobada, que cuesta lo mismo. Es un defecto previo a este
  cambio, pero los umbrales se apoyan en ese aviso: sin él, el paso a
  operador es un aviso fijo al cliente y nadie del lado del negocio se entera.
- **Hay que declararlo**, como cualquier mensaje que agrega el flujo
  (`CLAUDE.md` §1).

Techo de **una** ventana con los avisos contados (USD, fuera de la franquicia):

| Regla | Avisos a recepción | Costo | Resultado Corporativo | Resultado bolsa | Parte de Meta |
|---|---|---|---|---|---|
| Tope con corte del 08/09 (aviso al tope) | 1 | 0,328 | −0,177 | −0,048 | 94 % |
| **Umbrales 50 / 100, como está en el código** | 2 | **1,192** | −0,587 | −0,072 | 97 % |
| Umbrales 50 / 100 + aviso al abrir el bloque 2 | 3 | 1,203 | −0,598 | −0,083 | 97 % |
| Un solo aviso y silencio (alternativa) | 1 | 0,627 | −0,173 | +0,213 | 94 % |

Con los umbrales, el techo por conversación facturada es **0,298 USD**, 0,3547
bruto de impuestos: sigue debajo del precio mínimo de la bolsa (0,3632), así
que la conclusión del §1 no cambia. En la ventana que llega al bloqueo, Meta
es el 97 % del costo, porque los 50 avisos fijos no llaman al modelo.

#### 5.4.2 El aviso al abrir el bloque 2 está decidido pero no programado

`CLAUDE.md` §2 dice que se conserva «el aviso a recepción al empezar el
segundo bloque», y la observación 3 del §4 lo recomienda. En el código no
está: `avisoDeTransicion` (`atencion.ts`) solo devuelve `operador` o
`bloqueado`, y `bloqueNuevo` en `ingesta.ts` solo suma `bloquesAdicionales`.
Hay que decidir una de dos cosas:

- **Programarlo**: una tercera transición en `avisoDeTransicion`, con su
  prueba en `umbrales-atencion.test.ts`. Suma un mensaje por ventana que pase
  de 25 (+0,011 USD; techo de 1,203).
- **Sacarlo** de `CLAUDE.md` §2 y de la observación 3.

La recomendación es programarlo: es la única alerta que llega **antes** de que
el cliente reciba avisos fijos, y cuesta un centavo por ventana larga.

#### 5.4.3 Hoy ninguna ventana tiene techo, y el 1 de octubre importa

Los umbrales se **cuentan** en el servidor, pero el flujo todavía no los
obedece (§6). El tope con corte del 08/09 tampoco llegó nunca a n8n: la tabla
de `CLAUDE.md` §7 lo marcaba «No existe todavía». En producción, hoy, una
ventana crece sin límite. Hasta el 30/09 no cuesta nada, porque las
respuestas son gratis. **Desde el 01/10, un bucle de 500 respuestas cuesta
5,99 USD y se le factura al comercio como 20 conversaciones** (§5). La media
jornada de n8n del §6 tiene fecha: **antes del 1 de octubre**.

#### 5.4.4 El plan Base deja de caber en la franquicia cuando hay cola

Con bloques se envían mensajes que el tope cortaba, así que la franquicia se
gasta antes. Plan Base, 100 ventanas, 10 % de ellas de 50 respuestas:

| Regla | Mensajes al mes | Fuera de la franquicia | Meta, servicio |
|---|---|---|---|
| Tope | 860 | 0 | 0,00 USD |
| Bloques | 1.100 | 100 | 1,13 USD |

«El plan de entrada cabe exacto en la franquicia» (`CLAUDE.md` §3) vale para
la conversación típica de 10 mensajes, no para un comercio con clientes
largos. El margen igual mejora (+1,51 USD al mes, §3), porque esas ventanas se
cobran en bolsas: no es un problema de precio, pero la frase necesita esa
salvedad.

---

## 6. Qué hay que tocar

| Qué | Dónde | Estado |
|---|---|---|
| Contar el bloque y facturarlo | `ingesta.ts`: `RESPUESTAS_POR_CONVERSACION`, contador `mensajesVentana` por conversación, `conversaciones` y `bloquesAdicionales` en el agregado del mes | **Hecho**, 15 pruebas puras en `pruebas/conteo-bloques.test.ts` |
| Explicarlo en la consola | `Consumo.tsx`: glosario y una línea con los bloques adicionales, solo si hubo | **Hecho** |
| Publicarlo | `novuchat.site`: `precios.es.ts` (el párrafo que `/terminos` cita como definición contractual), `precios.astro`, `tipos.ts` | **Hecho** en la rama `cobro/bloques-de-25` del sitio |
| La base comercial | `CLAUDE.md` §2 y §7 | **Hecho** |
| Los dos umbrales, parametrizables por empresa | `atencion.ts` (puro, compartido con la consola): `umbralesDeAtencion`, `estadoDeAtencion`, `avisoDeTransicion`. La ingesta anota `atencionEstado` y cuenta `derivadasAOperador` y `bloqueadas`; `configuracionFlujo` devuelve `atencion` si recibe `telefono`; `actualizarEstadoCuenta` acepta `umbralOperador` y `umbralBloqueo` | **Hecho**, 22 pruebas puras en `pruebas/umbrales-atencion.test.ts`. Sin pantalla del propietario para cargarlos: se cargan por la función |
| Mostrarlos al comercio | `EstadoCuenta.tsx` (los límites que rigen) y `Consumo.tsx` (derivadas y bloqueadas del mes) | **Hecho** |
| Que el flujo obedezca | n8n: mandar `telefono` en `Traer configuración`, un IF sobre `atencion.estado` antes del agente, el aviso fijo y el aviso a recepción (`avisarRecepcion`) | **Pendiente**. Media jornada, con prueba contra un teléfono real. Hasta entonces los umbrales se cuentan pero no cortan. **Fecha límite: antes del 01/10/2026**; hoy ninguna ventana tiene techo (§5.4.3) |
| El aviso a recepción al abrir el bloque 2 | `atencion.ts`: una tercera transición en `avisoDeTransicion`, con su prueba | **Decidido en `CLAUDE.md` §2, no programado** (§5.4.2) |
| Que el aviso a recepción llegue | n8n: plantilla de utilidad en «Avisar a recepción» en vez de texto libre, que Meta rechaza si recepción no escribió en 24 h | **Pendiente** (§5.4.1). Cuesta lo mismo: 0,0113 USD por aviso |
| El prepago | Al reaplicar `integracion/prepago-sobre-flujos-vivos`: `consumoDeConversacion` descuenta saldo también en `bloqueNuevo`. Y el corte por `sin_conversaciones` **no puede rechazar un saliente ya enviado**: la decisión de si hay saldo para el bloque 2 se toma en `configuracionFlujo`, antes del modelo | **Pendiente** |
| La propuesta de Q'Taco | `Analisis/25` §4: «al llegar al tope una respuesta fija y aviso a recepción» pasa a la definición nueva. Antes de firmar | **Pendiente** |

**Compatibilidad.** Los documentos de conversación que no tienen
`mensajesVentana` arrancan en cero: ninguna conversación abierta antes del
despliegue factura un bloque que no le corresponde. El campo tiene el mismo
nombre que en la rama del prepago, para que al reaplicarla el dato ya exista.

---

## 7. Qué medir para revisar esto

Los tres números de `Analisis/15` §8 siguen valiendo, y ahora uno de ellos ya se
escribe solo: **`bloquesAdicionales` sobre `conversaciones` es la cola.** Si
en los primeros tres meses de un cliente pagando la cola pasa del 10 %, hay
que mirar dos cosas antes de tocar el precio: si el flujo está gastando
respuestas de más (la regla de un mensaje completo, `Analisis/14` §7) y si el
comercio publica en el catálogo cosas que no se pueden comprar por chat
(`CLAUDE.md` §5). Si pasa del 30 %, el bloque de 25 está mal dimensionado para
ese rubro, y ahí se discute el tamaño del bloque, no la unidad.

---

## 8. Consola: conversaciones agrupadas por teléfono y por bloque — análisis, SIN implementar

Pedido de Andres del 13/09: en la pantalla «Conversaciones», agrupar por
teléfono y, dentro de cada teléfono, por conversación facturada (el bloque de
25 o menos), con búsqueda por número de celular. **Solo análisis; no se
implementa todavía.**

### 8.1 Lo que hay hoy, y por qué no alcanza

- Un documento por teléfono, para siempre: `conversaciones/wa_<teléfono>`, con
  la subcolección `mensajes`. La pantalla lista los 50 teléfonos más recientes
  por `ultimoEn` y, al abrir uno, pinta hasta 300 mensajes en orden.
- **Ningún mensaje sabe a qué ventana ni a qué bloque pertenece.** Lo único que
  existe es el estado *vigente* en el documento del teléfono: `atencionDesde`,
  `mensajesVentana`, `atencionEstado`. Las ventanas de ayer no dejaron rastro
  más que en los contadores del mes.
- El historial de mensajes es **inmutable por regla** (`firestore.rules`, la
  ingesta escribe y nadie corrige). Cualquier agrupación tiene que salir de lo
  que se escribe en el momento, no de una migración posterior.

Reconstruir ventanas y bloques desde el navegador leyendo los mensajes sería
frágil: habría que reproducir la regla de las cortesías, el ancla fija de 24 h
y el reinicio del contador, y un error ahí produce una pantalla que **no
coincide con lo facturado**, que es exactamente el reclamo que la pantalla
existe para evitar.

### 8.2 Diseño recomendado

**Principio: la consola no recalcula nada; muestra lo que la ingesta decidió.**
La transacción que cuenta ya sabe, con cada mensaje, en qué ventana cae y en
qué bloque va. Basta con dejarlo escrito.

1. **Sello en cada mensaje, gratis.** El documento de `mensajes` que ya se
   escribe suma tres campos: `ventana` (el ancla de la ventana, en
   milisegundos: identifica el «día» de ese cliente), `bloque` (1, 2, 3…) y
   `respuestaN` (qué número de respuesta es dentro de la ventana; `null` en los
   entrantes). Cero lecturas y cero escrituras adicionales: viajan en la
   escritura que ya existe. Y como salen de la misma transacción que factura,
   **lo que la pantalla agrupa es lo que se cobró, por construcción.**
2. **Un resumen por ventana.** Subcolección `conversaciones/wa_x/ventanas/{ancla}`
   con `desde`, `hasta` (`desde` + 24 h), `respuestas`, `bloques`, `estadoFinal`
   (normal / operador / bloqueado) y `periodo`. Se escribe **al abrir** la
   ventana y **al cerrarla** (cuando la consulta siguiente abre otra; la ingesta
   ya sabe cuántas respuestas tuvo la que cierra). Dos escrituras por ventana,
   o sea dos por conversación facturada como mínimo: a la tarifa de Firestore,
   nada. La ventana en curso se lee del documento del teléfono, como hoy.
3. **La pantalla, en tres niveles:**
   - **Cliente** (teléfono, nombre de perfil si lo dio, último mensaje, cuántas
     conversaciones facturadas lleva en el mes).
   - **Día** = ventana de 24 h desde su primer mensaje: fecha y hora de inicio,
     respuestas, bloques, y si pasó al operador o se bloqueó.
   - **Conversación** = bloque de hasta 25: los mensajes de ese bloque, con el
     número de respuesta al margen (1 a 25) y la marca «facturada» en cada
     bloque. El bloque 2 de un día es la línea que explica por qué ese cliente
     figura dos veces en el consumo del mes.
   Con los sellos del punto 1, agrupar los 300 mensajes de un teléfono en el
   navegador es trivial y no exige ningún índice compuesto nuevo; el listado de
   días sale de `ventanas` ordenado por `desde`, índice de un solo campo.
4. **Búsqueda por celular.** El identificador del documento **es** el teléfono
   (`wa_<teléfono>`), así que la búsqueda por prefijo es una consulta por
   `documentId()` con rango (`>= 'wa_591'`, `< 'wa_591'`), sin índice ni
   campo nuevo, y sigue anclada bajo `/tenants/{tenantId}`: no hay forma de
   buscar en otro negocio. Se exige un mínimo de 4 dígitos para no convertir la
   búsqueda en un listado; con el número completo, es una lectura directa.
5. **Reglas y pruebas.** `ventanas` se lee con el mismo permiso que
   `conversaciones` y **nadie la escribe desde el navegador** (igual que
   `mensajes`); una prueba negativa más en `reglas.test.ts`. Los sellos de los
   mensajes son campos nuevos en un documento que las reglas ya protegen.

### 8.3 Lo que esto compra, además de la pantalla

- **La conciliación de una factura deja de ser un recuento de mensajes.** Hoy
  reconstruir un período es recorrer `/conversaciones` filtrando por `ultimoEn`
  (`ingesta.ts`, «RECUENTO»). Con `ventanas` es sumar `bloques` de los
  documentos del período: exacto, barato y explicable cliente por cliente.
- **La distribución de respuestas por conversación** que pide `CLAUDE.md` §4 y
  `Analisis/16` sale de `ventanas.respuestas` sin instrumentación aparte.
- **Los mensajes anteriores al despliegue no tienen sello.** No se migran (el
  historial es inmutable): la pantalla los agrupa bajo «anteriores al cambio»
  y listo. Ningún cliente pagó todavía, así que no hay factura vieja que
  explicar.

### 8.4 Costo, esfuerzo y riesgos

| | |
|---|---|
| **Lecturas y escrituras** | Sellos: cero adicionales. `ventanas`: +2 escrituras por ventana. La pantalla lee `ventanas` en vez de recorrer mensajes para listar días: **menos** lecturas que hoy cuando el teléfono tiene historial |
| **Esfuerzo** | Ingesta (sellos + `ventanas`) con pruebas puras: media jornada. Reglas y prueba negativa: una hora. Pantalla en tres niveles con búsqueda: una jornada. **Unas dos jornadas** |
| **Riesgo principal** | Que alguien, con prisa, agrupe en el navegador «por fecha» en vez de por el sello. La regla es una sola: **la pantalla nunca decide dónde empieza una conversación; lo lee** |
| **Privacidad** | Nada nuevo: el comercio ya ve los teléfonos de sus clientes; NovuChat sigue necesitando la ventana de soporte para abrir un hilo |
| **Dependencias** | Conviene hacerlo **junto con la reaplicación del prepago**, que también toca la transacción de la ingesta, para no abrirla dos veces |
