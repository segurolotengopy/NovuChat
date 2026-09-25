# Planes a medida: flujos, niveles y BYOC sin romper la consola ni el prepago

**23-sep-2026.** Andres pide opciones para manejar las modalidades BYOC con
distintos tipos de flujo, flujos personalizados y niveles (básico, medio, pro).
**La oferta ya está definida y los clientes la aceptaron**: lo que está
complicado es sostenerla en la consola y en el prepago. Este documento no
rediscute los precios ni los paquetes: analiza dónde vive cada cosa y qué
cuesta cada opción.

Base: `Analisis/39` (BYOC), `Analisis/29` (dónde vive el plan), `Analisis/27`
(la unidad de cobro), `Analisis/36` (prepago y cobranza), `Analisis/21` (los
tres planes publicados), `admin/DISENO.md` §4sexies (política de capas) y
§4undecies (prepago). Código leído en `origin/main`: `planes.ts`, `prepago.ts`,
`index.ts` (`actualizarEstadoCuenta`), `firestore.rules`, `web/src/lib/pagar.ts`,
`web/src/lib/flujos.ts`.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **Por qué duele** | «Plan» significa hoy **siete cosas a la vez** —precio, cupo de conversaciones, límites de catálogo y agendas, campañas simultáneas, quién le paga a Meta, qué flujos corren y qué nivel de servicio— y las siete viajan en **un identificador de una lista cerrada** (`IdPlanVendible`). La séptima llegó el 24/09, dos días después de escribirse este documento, y es la mejor prueba de la tendencia (§9). La oferta real cruza flujos × niveles × modalidad: eso no entra en una lista cerrada sin un despliegue por venta (§1, §2) |
| **La buena noticia** | **Lo que hace cumplir los límites ya está listo.** `limitesDeCuenta` prefiere la COPIA que vive en la cuenta sobre el plan, y acepta hasta 100.000. No hay que tocar la ingesta, ni las reglas de productos, ni los umbrales. Lo que falta es **cómo se escribe esa copia y de dónde sale el precio** (§4.1) |
| **La recomendación** | **Dos estanterías, no una.** La *vitrina*: los tres planes publicados, en código, autoservicio, sin negociación. El *mostrador*: un **contrato por comercio**, versionado e inmutable, que se vuelve vigente **cuando se paga**. `plan: 'aMedida'` es el único identificador nuevo (§3 opción D, §4) |
| **Los niveles NO son planes** | Básico/medio/pro son **capacidades del flujo**, y viven en `/config/{flujo}`, donde ya vive todo lo propio de un flujo (§4.5). Meterlos en el plan multiplica el catálogo por tres y no habilita nada |
| **Los flujos personalizados no son flujos nuevos** | Ninguno entra al enum de flujos: son **instancias** de los genéricos más configuración, más una línea de desarrollo en el contrato. La regla: **el segundo cliente que pide lo mismo convierte eso en genérico** (§4.6) |
| **Un cupo por comercio, siempre** | Un nivel no trae cupo propio. Dos cupos en un tenant rompen la promesa de «bolsa unificada» que la propuesta de Dhermacore ya vendió, y dejan dos contadores que se contradicen (§4.5) |
| **La trampa más caras de todas** | Un nivel «pro» que promete un modelo mejor mueve el equilibrio de **3.873 a 1.542** conversaciones (`Analisis/39` §2). El contrato tiene que guardar **con qué modelo se fijó el cupo**, o un cambio de calidad pone el mismo precio a perder plata (§5.1) |
| **Lo que hay que dejar de vender** | «Hasta 4 cambios al mes» y «USD 15 por cambio» son límites que **nadie cuenta**: es el caso de `CLAUDE.md` §7. O se cuentan en la consola, o se venden como nivel de soporte (§5.2) |
| **Esfuerzo** | **8 jornadas en siete bloques**, y los tres primeros (≈3,5 jornadas) ya dejan vender y cobrar cualquier combinación (§6) |

---

## 1. Hoy «plan» significa siete cosas a la vez

`planes.ts` define un plan como precio más tres límites, más quién le paga a
Meta. Alrededor de ese identificador se colgó todo lo demás:

| Lo que decide | Dónde vive hoy | ¿Aguanta la oferta nueva? |
|---|---|---|
| **Precio mensual** | `PLANES[plan].precioUsd` | **No.** Cada acuerdo tiene su número (Dhermacore, 99) |
| **Cupo de conversaciones** | `PLANES[plan].conversaciones`, copiado a `cuenta/estado.limites` | **Sí**, la copia ya manda |
| **Productos y agendas** | igual que arriba, y una tabla de respaldo en `firestore.rules` | **Sí**, con una salvedad (§5.3) |
| **Quién le paga a Meta** | `PLANES[plan].pagaMeta` | **Sí**, pero es una propiedad de la modalidad, no del precio |
| **Qué flujos corren** | `tenants/{t}.flujos`, **fuera del plan** | **Sí** — y es el modelo correcto, el que hay que imitar |
| **Campañas simultáneas** | `PLANES[plan].campanas` (0 / 3 / 10), desde el 24/09, con su propia tabla de respaldo en las reglas | **Sí** para los publicados; **no** para un acuerdo con otro número |
| **Nivel de servicio** (soporte, cambios incluidos, profundidad del flujo) | **en ninguna parte** | **No existe** |

Las dos filas que dicen «no» son exactamente las dos que la oferta nueva
necesita. Y la fila de flujos, que ya está resuelta, es el modelo a copiar:
**se guarda por comercio, la consola lo lee, las reglas lo hacen cumplir, y
nadie lo metió en el precio.**

### 1.1 El cuello de botella exacto

No es el catálogo: es el **pago**.

```
Pago = { tipo: 'mensualidad'; plan: IdPlanVendible; meses: number }
montoUsdDe(pago) = PLANES[pago.plan].precioUsd * pago.meses
```

Un pago de mensualidad **solo puede nombrar un plan de la lista cerrada**, y su
importe **solo puede salir de esa lista**. De ahí se deriva todo lo demás:
`montoMensual` (`prepago.ts:496`), el importe del QR, la descripción del cobro y
las plantillas de cobranza. Por eso `Analisis/39` §6 concluyó que BYOC tenía que
ser un plan del catálogo: no por principio, **por esta línea de código**.

`actualizarEstadoCuenta` cierra la otra puerta: el plan «es cerrado», y un plan
fuera del catálogo se rechaza. Está bien que se rechace —un valor por defecto
silencioso era el defecto que pisaba planes—, pero significa que **no hay
ninguna manera de registrar un acuerdo a medida.**

---

## 2. La combinatoria no entra en una lista cerrada

Con tres tipos de flujo genéricos (reservas, venta, captación), tres niveles y
dos modalidades de Meta, el catálogo tendría que tener **hasta 3 × 3 × 2 = 18**
entradas antes de contar los acuerdos con precio propio, los combinados de dos
flujos y las dos líneas de un mismo comercio. Dhermacore ya vendió una
combinación que no existe: **dos líneas, dos flujos distintos, cupo compartido
de 800, USD 99, soporte preferencial.**

Y cada entrada nueva cuesta, hoy, esto:

| Paso | Por qué |
|---|---|
| PR sobre `planes.ts` | el catálogo es código versionado, a propósito |
| Tocar la tabla de respaldo de `firestore.rules` | tiene los productos por plan escritos a mano (`'impulso': 20, … 'byoc': 500`) |
| Ajustar `pruebas/planes.test.ts` | compara el catálogo con `CLAUDE.md` y con el sitio |
| Desplegar Functions y reglas | el límite nuevo no rige hasta que se despliega |
| Y esperar | **un despliegue en medio de una venta** |

Eso es media jornada por acuerdo, con un despliegue en el camino. A dos o tres
clientes por mes, es un impuesto permanente; y el día que haya cola, es el
cuello de botella. **Un catálogo en código es la decisión correcta para lo que
se publica y la equivocada para lo que se negocia.**

---

## 3. Las cuatro opciones

### Opción A — Una entrada de catálogo por combinación

Seguir como ahora: cada acuerdo se agrega a `PLANES`.

- **A favor:** no se toca ni una línea del prepago, la consola o las reglas. Todo
  el camino de cobro ya funciona. Es lo que se hizo con `byoc` y salió bien.
- **En contra:** media jornada y un despliegue por venta; el catálogo se llena de
  precios de un solo cliente; `pruebas/planes.test.ts` pierde sentido cuando la
  mayoría de las entradas no se publican; y **el precio negociado de un cliente
  queda escrito en un repositorio público** (hoy `byoc: 50` ya está ahí).
- **Cuándo conviene:** hasta cinco o seis modalidades **estables y repetibles**.
  No para acuerdos con nombre propio.

### Opción B — Un contrato por comercio, sin catálogo de piezas

Cada comercio tiene un documento con su precio, su cupo y sus flujos. El
catálogo en código queda solo para los tres publicados.

- **A favor:** cubre cualquier combinación sin desplegar; es el modelo que ya usan
  los umbrales de atención por empresa y el pseudo-prompt.
- **En contra:** **sin lista de precios no hay con qué comparar**. Nadie sabe si
  un acuerdo quedó por debajo del costo, ni cuánto se resignó al negociar. Y dos
  vendedores cotizan distinto el mismo paquete.
- **Cuándo conviene:** si los acuerdos fueran todos únicos. No es el caso: los
  niveles ya están definidos y son repetibles.

### Opción C — Cotizador por piezas, sin precio negociado

El mensual se **calcula**: precio por flujo × nivel, más cupo, más soporte. Nada
se escribe a mano.

- **A favor:** una tabla chica en código cubre toda la combinatoria; el precio es
  reproducible y auditable; Silvana cotiza sola.
- **En contra:** **las ventas reales no se descomponen.** Dhermacore no compró
  «venta pro + reservas medio + 800 conversaciones»: compró un paquete de 99. Un
  cotizador que no admite el número pactado obliga a inventar piezas para que la
  suma cierre, y eso es peor que escribir el número.
- **Cuándo conviene:** como **calculadora de referencia**, no como fuente del
  precio.

### Opción D — Híbrido: vitrina en código, mostrador por contrato ✅

1. **La vitrina**: los tres planes publicados siguen en `planes.ts`, con su
   prueba contra el sitio y `CLAUDE.md`. Autoservicio, sin negociación.
2. **La lista de precios**: una tabla de **piezas** en código (flujo × nivel,
   tramos de cupo, niveles de soporte, setup). Es la Opción C, pero como
   **referencia**: dice cuánto vale de lista lo que se está regalando.
3. **El mostrador**: un **contrato por comercio**, versionado e inmutable, con el
   precio pactado, el cupo, los flujos, los niveles y las premisas de costo. Se
   vuelve vigente **cuando se paga**.
4. **Un solo identificador nuevo**: `plan: 'aMedida'`, para que toda la
   maquinaria que hoy resuelve por plan siga resolviendo.

- **A favor:** cubre la combinatoria sin desplegar; conserva la auditoría (lo
  pactado queda inmutable, con quién lo autorizó y contra qué lista); no saca los
  precios públicos de código; y **no toca el camino que hace cumplir los
  límites**, que es el que no conviene mover.
- **En contra:** hay que construirlo: 8 jornadas, de las cuales 3,5 habilitan
  vender y cobrar.

---

## 4. La recomendación, en detalle

### 4.1 Lo que ya funciona y no hay que tocar

`limitesDeCuenta` (`planes.ts`) **prefiere la copia de `cuenta/estado.limites`
sobre el plan**, límite por límite, y acepta cualquier entero hasta
`LIMITE_MAXIMO` = 100.000. La ingesta, el aviso del 80 %, el corte del prepago y
la regla de productos leen esa copia.

**Es decir: el servidor ya sabe hacer cumplir un acuerdo a medida.** Lo único
que falta es quién escribe la copia y de dónde sale el precio. Cualquier opción
que empiece por rediseñar el cumplimiento de límites está resolviendo un
problema que no existe.

### 4.2 El contrato

Un documento por versión, inmutable, y un puntero al vigente:

```
tenants/{t}/contratos/{version}     ← inmutable, uno por acuerdo
tenants/{t}/cuenta/contrato         ← puntero al vigente + la copia que se lee
```

| Campo | Para qué |
|---|---|
| `precioUsd`, `setupUsd` | el mensual pactado y el pago único. La lista se denomina en dólares; el importe en bolivianos sigue siendo derivado del TCO |
| `conversaciones`, `productos`, `agendas` | se copian a `cuenta/estado.limites` igual que hoy: el cumplimiento no cambia |
| `pagaMeta` | `'comercio'` en BYOC. Decide qué dice la consola y qué dice el contrato |
| `flujos` y `niveles` | qué corre y con qué profundidad. `tenants/{t}.flujos` pasa a ser espejo de esto |
| `soporte` | el nivel, atado a los tiempos del anexo técnico (`Analisis/37`) |
| `modeloPremisa` | con qué modelo de IA se fijó el cupo. Es la premisa de costo, no una promesa al cliente (§5.1) |
| `piezas` y `precioLista` | lo que costaría de lista; con el pactado al lado, se ve cuánto se resignó |
| `autorizadoPor`, `propuesta` | quién lo aprobó y contra qué documento firmado |
| `vigenteDesde`, `estado` | `propuesto` → `vigente` → `reemplazado`. Nunca se edita: se reemplaza |

**Esto no es un patrón nuevo en el proyecto.** Es el del pseudo-prompt por
empresa: se escribe una versión propuesta, algo la promueve a vigente, y las
reglas niegan que el navegador escriba la vigente. Y es el de los umbrales de
atención: parámetros comerciales por comercio, validados con el mismo predicado
que usa el servidor. **Lo que no existe es el equivalente para el precio.**

Quien lo escribe es una callable del propietario, con auditoría —la colección
`tenants/{t}/auditoria` ya existe y la usa el cambio de plan—, nunca el
navegador y nunca a mano en la consola de Firebase.

### 4.3 Lo que cambia en el prepago

Cuatro cambios, todos dentro de `prepago.ts`, que es puro y está probado:

1. **El pago nombra el contrato, no el plan**:
   `{ tipo: 'mensualidad'; plan: 'aMedida'; contrato: string; meses: number }`.
2. **El precio se le pasa**: `montoUsdDe(pago, plan)` en vez de leerlo del
   catálogo global. Sigue siendo pura, y es más fácil de probar.
3. **El período pagado queda sellado con la versión del contrato**, igual que hoy
   queda sellado con el TCO aplicado. **Lo pagado no se re-tarifa**: si el
   contrato cambia en el mes 3 de un prepago de 6, los meses cubiertos conservan
   el precio con el que se cobraron, y el nuevo rige desde el primer mes no
   cubierto.
4. **Sin prorrateo.** Una mejora a mitad de mes se cobra como bolsa o como línea
   de desarrollo, nunca como un mensual partido. Prorrateo + TCO del día +
   prepago de hasta 6 meses es una factura que no se puede reconstruir, y
   reconstruirla es el requisito de `CLAUDE.md` §3.

Lo que **no** cambia: el corte sigue en modo observación hasta que Andres
encienda `plataforma/prepago.corteActivo`, y una demostración no se corta nunca.

### 4.4 Lo que cambia en la consola

- **Pantalla del propietario** (`Analisis/29`): es donde se arma el contrato.
  Elegir flujos, niveles, cupo y soporte; ver el **precio de lista al lado del
  pactado**; y guardar una versión nueva. Muestra el diff contra el vigente: qué
  gana y qué pierde el comercio. Nunca edita en su lugar.
- **Consola del comercio**: «Estado de cuenta» dice lo contratado leyendo la
  copia, y en BYOC agrega la fila que ahora importa más que ninguna —**mensajes
  del asistente del mes contra los 1.000 gratis del número**—, porque con BYOC
  NovuChat deja de ver la factura de Meta y esa cifra es lo único que se la
  predice al comercio (`Analisis/39` §4).
- **El comercio no ve el modelo de precios.** Ve su precio. La tabla de piezas es
  interna.

### 4.5 Los niveles son capacidades del flujo, no planes

Un nivel no cambia cuánto se puede consumir: cambia **qué hace el flujo**.
Reservas básico recuerda; medio agenda con candado; pro cobra seña y hace
seguimiento. Eso es exactamente lo que `DISENO.md` §4sexies define como «lo
propio de un flujo», y su lugar es `/config/{flujo}`, con su línea en la tabla
de capacidades de las reglas y su pestaña en `flujos.ts`.

Tres consecuencias:

- **El nivel se hace cumplir donde el flujo lee su configuración**
  (`configuracionFlujo`), no en el precio. Un nivel que solo existe en el
  contrato no existe (`CLAUDE.md` §7).
- **Un cupo por comercio, siempre.** Un nivel no trae cupo propio. Dos cupos en un
  tenant rompen la «bolsa unificada» que la propuesta de Dhermacore ya vendió y
  dejan dos contadores que se contradicen.
- **Subir de nivel no es cambiar de plan.** Es una versión nueva del contrato con
  el mismo cupo y otro precio. La consola no tiene que ofrecer 18 planes.

### 4.6 Los flujos personalizados

`FlujoId` es una lista cerrada de tres, con espejos en `firestore.rules`
(`tieneAgenda`, `tieneCobro`) y en `prompt.ts`. **No se le agrega un flujo por
cliente**: las reglas no pueden autorizar lo que no conocen, y un flujo que solo
existe para uno no tiene quién lo pruebe.

La regla que propongo, en tres pasos:

1. **Todo acuerdo personalizado se arma con flujos genéricos más configuración.**
   Dhermacore es el ejemplo: «enrutamiento por campaña a la recepción de cada
   doctor» es reservas con configuración de derivación, y «venta de libros con
   QR» es venta. No hace falta ningún flujo nuevo.
2. **Lo que de verdad no entra se vende como línea de desarrollo**, con su precio,
   su plazo y su cláusula de mantenimiento en el contrato. Y se declara el costo
   real: cada pieza propia de un cliente multiplica el trabajo de propagar un
   cambio (`Analisis/20`).
3. **El segundo cliente que pide lo mismo lo convierte en genérico.** Es la
   frontera entre una instancia y un módulo, y conviene que sea explícita: la
   segunda vez se paga desarrollo una vez más y el módulo queda para todos.

---

## 5. Las trampas

### 5.1 El nivel «pro» que promete un modelo mejor

En BYOC el modelo de IA es el 99 % del costo. El cupo de 2.000 se fijó contra
Gemini; con Haiku 4.5 el equilibrio cae a 1.542 y con Sonnet 5 a 771
(`Analisis/39` §2). Un nivel «pro» que se venda como «mejor IA» **pone el mismo
precio a perder plata sin que nadie toque el precio**.

Por eso el contrato guarda `modeloPremisa`, y cambiar el modelo de un comercio
obliga a rehacer la cuenta del cupo. Y por eso el contrato tiene que seguir
diciendo que **la elección de modelo es de NovuChat**: es lo que mantiene cierta
la regla de que el modelo se elige por calidad.

### 5.2 «Hasta 4 cambios al mes» y «USD 15 por cambio»

Son dos límites que **hoy nadie cuenta**. Es el caso de `CLAUDE.md` §7: un
límite que solo existe en el contrato no existe. Dos salidas honestas:

- **Contarlos**: un contador por período en la cuenta, que el propietario
  incrementa al aplicar un cambio, visible para el comercio. Media jornada.
- **Dejar de venderlos por número** y vender **nivel de soporte** con los tiempos
  del anexo técnico, que sí se pueden sostener.

Recomiendo la segunda: un número que nadie lleva es un reclamo esperando, y el
§13.3 del anexo exige el acuerdo del cliente para reducir un compromiso ya dado.

### 5.3 El respaldo de un contrato roto tiene que ser el plan más chico

Hoy, sin copia de límites, rige el plan; y un plan desconocido cae en Impulso:
ante la duda, hacia el límite menor. Con `aMedida` **no hay plan del que caer**,
así que hay que decidirlo explícitamente: un `aMedida` sin contrato legible cae
en **Impulso**, nunca en lo último pactado. Vale para la tabla de respaldo de
`firestore.rules`, que tiene los productos por plan escritos a mano y necesita su
entrada nueva.

### 5.4 El contrato y el anexo particular tienen que ser el mismo registro

El anexo particular de un cliente (`Analisis/37`, y el de Platinum) ya es una
tabla de «capacidad activa / se activa con acta / no incluida». Eso **es** el
contrato. Si la consola guarda una cosa y el anexo dice otra, la diferencia es
exactamente lo que un cliente discute. El anexo se genera del contrato, o el
contrato cita el anexo firmado; las dos cosas sirven, tener dos verdades no.

### 5.5 Dos líneas son un tenant con dos flujos

Nunca dos comercios: con dos tenants el cupo compartido no se puede hacer
cumplir. Las dos franquicias de 1.000 mensajes de Meta se aprovechan igual,
porque son por número (`Analisis/39` §7).

### 5.6 El precio negociado se registra con quién lo autorizó

No como control burocrático: porque es el único modo de saber después si un
acuerdo quedó por debajo del costo, y de revisarlo en la renovación. La lista de
piezas sirve justamente para eso.

---

## 6. Qué construir, y en qué orden

| Bloque | Qué | Jornadas |
|---|---|---|
| **0** | `plan: 'aMedida'` en `planes.ts`, su entrada en la tabla de respaldo de las reglas (cae en Impulso) y la tabla de piezas como lista de precios interna | 1 |
| **1** | Callable `fijarContrato` del propietario: versión inmutable, copia de límites a `cuenta/estado`, espejo de `flujos`, auditoría, y **pruebas negando** (el comercio no lo escribe ni armando la petición a mano) | 1,5 |
| **2** | Prepago: el pago nombra el contrato, `montoUsdDe` recibe el plan, el período pagado queda sellado con la versión, sin prorrateo | 1 |
| **3** | Pantalla del propietario: armar el contrato, ver lista contra pactado, diff contra el vigente | 1,5 |
| **4** | Consola del comercio: «Estado de cuenta» desde el contrato, y la fila de mensajes contra los 1.000 gratis | 0,5 |
| **5** | Niveles como capacidades del flujo: `/config/{flujo}.nivel`, reglas, `configuracionFlujo` | 1,5 |
| **6** | `DISENO.md` con el diseño, y el anexo particular generado del contrato | 1 |

**Con los bloques 0 a 2 —3,5 jornadas— ya se vende y se cobra cualquier
combinación.** El resto es dejar de operarlo a mano.

---

## 7. Lo que NO conviene hacer

- **Un plan por combinación.** 18 entradas, un despliegue por venta, y los precios
  negociados de cada cliente en un repositorio público.
- **Un cupo por flujo o por nivel.** Rompe la bolsa unificada ya vendida y deja
  dos contadores que se contradicen.
- **Un `FlujoId` por cliente.** Las reglas no autorizan lo que no conocen.
- **Prorratear.** Con TCO del día y prepago de hasta 6 meses, la factura deja de
  poder reconstruirse.
- **Editar el contrato en su lugar.** Se reemplaza por una versión nueva; lo
  pagado conserva la suya.
- **Mostrarle al comercio el modelo de precios.** Ve su precio, no la tabla.

---

## 8. Lo que falta decidir, y es de Andres

1. **¿Los tres planes publicados siguen siendo autoservicio puro?** La
   recomendación asume que sí: vitrina sin negociación, mostrador para todo lo
   demás.
2. **Los «cambios incluidos»: contador o nivel de soporte** (§5.2). Hay un cliente
   con cuatro al mes ya vendidos, así que esto tiene fecha.
3. **Qué nivel trae qué capacidad, flujo por flujo.** Están definidos
   comercialmente; hay que escribirlos como capacidades para poder hacerlos
   cumplir (bloque 5).
4. **Si el nivel «pro» promete un modelo mejor**, y con qué cupo (§5.1).

---

## 9. Nota del 25-sep-2026: la séptima cosa

Este documento se escribió contra `origin/main` del 23/09. Dos días después, el
catálogo ganó una dimensión más, y conviene leerla como confirmación del
diagnóstico y no como un detalle:

- **`Plan.campanas`** (Andres, 24/09): cuántas campañas de Meta simultáneas
  admite el plan, **0 / 3 / 10**. Es la séptima cosa que decide el mismo
  identificador.
- **Se dejó FUERA de `Limites` a propósito**, y el motivo está escrito en el
  código: en la copia de la cuenta todo número vale de 1 en adelante, y un 0 es
  legítimo para campañas; meterlo ahí habría vuelto «incompletas» todas las
  cuentas que ya existen. **Es exactamente el problema que el contrato de §4.2
  resuelve**: un acuerdo a medida necesita un lugar donde convivan límites,
  cantidades y premisas sin que el formato de uno rompa la validación del otro.
- **Ahora hay DOS tablas de respaldo por plan escritas a mano en
  `firestore.rules`** —productos y campañas—, y las dos hay que tocarlas al
  agregar un plan. El costo por venta del §2 subió, no bajó.
- **`planQuePuedePedir`** (también del 24/09) hace cumplir en el servidor qué
  plan puede pagarse un comercio: los publicados siempre, y uno fuera de lista
  solo para renovar el que ya tiene. **Es un punto de contacto nuevo para el
  diseño**: con contratos, un comercio solo puede pagar **su** contrato vigente,
  nunca elegir uno; y `aMedida` no puede ser pedible por nadie desde el
  navegador.

Nada de esto cambia la recomendación. La refuerza: en cuarenta y ocho horas, la
lista cerrada absorbió una dimensión más y duplicó las tablas que hay que
mantener a mano.

**Antes de construir cualquier bloque del §6 hay que releer `planes.ts`,
`prepago.ts` y `firestore.rules` contra el `main` del día.** Este documento cita
líneas que ya se movieron una vez.
