# Módulo Cobros (el comercio cobra a su cliente)

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `cobro.ts`, `qrSimple.ts`, `dibujoQr.ts`, `cotejo.ts`, `cobroVenta.ts`, `cotejoVenta.ts`, `comprobantes.ts`, `verComprobante.ts` (el visor: la callable `verComprobante`), `mediaIdQr`, `cobroReal`; `Cobros.tsx`, `Cobro.tsx` (QR) |
| **Depende de** | Pedidos o Agenda (quien cierra) |
| **Límite por plan** | — |
| **Configuración** | `config/cobros` (hoy repartido entre `config/venta` y `config/agendamiento`): `mediaIdQr`, `cobroReal`, montos de seña, … |
| **Colecciones** | las de cobro dentro de `cierres` y `pedidos`; `fotosCatalogo` no. Almacenamiento: `comprobantes` (Storage, regla 2). Raíz: `topesDelVisor/{uid}` (el contador del tope del visor; las reglas lo niegan todo, solo lo escribe la callable) |
| **Pestañas** | Cobros (`admin`), Cobro / QR (`admin`) |
| **Prompt** | fragmento de cobro del prompt (QR, comprobante) |
| **Herramientas** | las de la seña y del comprobante en los flujos de reservas y venta |
| **Nodos (lo que queda en n8n)** | `preparar-sena`, `respuesta-de-la-sena`, `mensaje-de-la-sena`, `interpretar-lectura` (en `Flujos/src/modulos/cobros/` desde FL1), más los nodos de cobro del Demo B; dibujo del QR y cotejo del comprobante como servicios internos del módulo |
| **Ganchos** | `despuesDelTurno` (cotejo), `alCierre` con Pedidos o Agenda |
| **Mensajes por conversación** | 0 en la venta; la seña agrega los mensajes declarados en §4duodecies (abajo) |
| **Pruebas** | `qr.test.ts`, `sena-cotejo.test.ts`, `sena-servidor.test.ts`, `cobro-venta.test.ts`, `demo-b-cobro.test.ts`; regla 2 (§4duodecies.6): `calificar.test.ts`, `cobro-v2.test.ts`, `cotejo-venta.test.ts`, `comprobantes.test.ts` (en `pruebas/modulos/cobros/`), «Comprobantes de pago» en `storage-reglas.test.ts` y, en la ingesta, `pruebas/cobro-v2-ingesta.test.ts`; el visor (§4duodecies.7): `ver-comprobante.test.ts` y `visor-reglas.test.ts` |

**Observación:** declarado por dos verticales «y gana venta»; con módulo, es uno solo con su propio `config/cobros`. **Los rótulos del cobro simulado son de Plataforma** (§4sexies.3, abajo). **Nunca confundir con Pagar** (NovuChat cobra al comercio), que es de Central. La prohibición 3 de `CLAUDE.md` manda: cobro simulado con rótulo, cobro real sin «pago acreditado», y los dos modos son excluyentes

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4sexies.3 (25/09/2026, líneas 1383-1412) -->

### 4sexies.3 Los rótulos del cobro simulado NO los edita el comercio

**Coincido con el criterio de Andres, y iría más lejos.** No solo no debe
editarlos libremente: no debe poder editarlos en absoluto, y ni siquiera deben
existir por comercio.

Los rótulos —el texto impreso en el QR, el epígrafe y la confirmación— viven en
`/plataforma/cobroSimulado`, son de NovuChat y son **los mismos para todos**.
Ningún navegador los escribe, tampoco el del propietario. La razón: sostienen la
prohibición 3 de `CLAUDE.md`, que es una regla del proyecto y no una preferencia
del cliente. Un comercio podría querer sacar «SIMULACRO» porque «queda feo en la
demo», y ese es precisamente el caso que hay que impedir — no con una advertencia
en la pantalla, sino haciendo que el campo no exista.

**Y `mediaIdQr` tampoco lo escribe el comercio**, aunque parezca un identificador
técnico inocente. Apunta a la **imagen**, y la imagen lleva el rótulo impreso:
quien pueda cambiarlo sube un QR sin rotular y saltea la prohibición **sin editar
un solo texto**. Es el camino que no salta a la vista y es el que había que
cerrar. Lo registra NovuChat, lo cual además es coherente con el hallazgo 19 —un
media ID queda ligado al número que lo sube— y el número también lo asigna
NovuChat.

**El sistema falla hacia el rótulo.** Si el documento de plataforma faltara,
rigen los textos de respaldo del código; una cadena vacía tampoco sirve para
borrar un rótulo. Sin `mediaIdQr` no se envía QR, que es lo correcto: mejor no
mandar nada que mandar una imagen sin rotular.

Lo que el comercio **sí** decide es lo comercial: cuánto cobra de envío, cuánto
recarga por flota, cuánto tarda y desde qué monto entrega.


<!-- movido de admin/DISENO.md §4nonies.2 (25/09/2026, líneas 1852-1872) -->

### 4nonies.2 Cobros — la pantalla de la plata

Arriba, un tablero corto: **pagos, montos y verificaciones**, por día, semana,
mes **o entre dos fechas**. Abajo, el listado de los cobros hechos con QR, con
fecha, hora y monto de cada uno.

De cada cobro se puede abrir un modal con **los ítems, el detalle de la compra y
el comprobante**. Modal y no columna: acá lo que se recorre son montos, y el
detalle es la excepción que se consulta, no la regla.

**Y un botón para marcar el pago como comprobado**, después de que la persona lo
verificó con su banco.

**ESE BOTÓN ES DE UNA PERSONA Y NUNCA DEL SISTEMA, y ahí está la PROHIBICIÓN 3.**
El OCR coteja un comprobante; no acredita nada. Quien afirma que la plata entró
es el comercio mirando su cuenta. Por eso el registro tiene que guardar **quién**
marcó y **cuándo**, igual que cualquier otro sello de la consola, y por eso la
etiqueta dice «comprobado por el negocio» y no «pago acreditado». Si algún día
el asistente usa ese estado para contestarle a un cliente, tiene que decir que
lo confirmó el negocio, no NovuChat.


<!-- movido de admin/DISENO.md §4duodecies (25/09/2026, líneas 2594-2606) -->

## 4duodecies. Seña por QR en reservas

> **Decidido el 17/09/2026** (`Analisis/30` §4, `Analisis/07` §4; rama
> `flujos/sena-por-qr`). El flujo de reservas cobra una **seña** por QR para
> retener el horario. Es la primera vez que el flujo de agendamiento cobra, y
> por eso esta sección toca las tres capas: el documento del flujo, dos
> pantallas que hasta ahora eran solo de venta, y una Function nueva que
> coteja. **Prohibición 3 de `CLAUDE.md` en cada texto**: nadie —ni el
> asistente, ni la consola, ni el servidor— dice «pago acreditado», «pago
> verificado» ni «recibimos tu pago». Se dice que el comprobante llegó y que
> los datos coinciden; quien confirma que entró la plata es el negocio en su
> banco.


<!-- movido de admin/DISENO.md §4duodecies.1 (25/09/2026, líneas 2607-2639) -->

### 4duodecies.1 Las decisiones, en orden

1. **La seña es un parámetro del flujo de agendamiento** (§4sexies): vive en
   `/config/agendamiento` como `senaImporte` (entero en la moneda del negocio;
   `0` = sin seña) y `senaMinutosRetencion` (entero, 5..180, respaldo 30). Un
   restaurante no retiene horarios: no va a `/config/negocio`.
2. **El QR del comercio (`cobroReal`) vive en el documento del flujo que
   cobra.** `/config/venta` si el negocio vende; `/config/agendamiento` si solo
   reserva. `registrarQrDeCobro` elige leyendo `tenants/{t}.flujos` (venta
   gana; sin ninguno de los dos, rechaza) y devuelve `documento`. Un negocio
   con los dos flujos tiene UN QR, en venta, y los dos flujos mandan el mismo.
   `cobroReal` lo escribe solo la callable, como hasta ahora: no entra en la
   lista blanca del navegador en ninguno de los dos documentos.
3. **Quien coteja es el servidor** (§7 de `CLAUDE.md`): la Function
   `cotejarComprobante` recibe lo que un modelo leyó del comprobante y
   devuelve `cuadra | no_cuadra | ilegible`. El flujo no compara nada, y el
   modelo tampoco decide: solo transcribe.
4. **La cita se retiene por hecho, no por dicho.** `agendar_cita` la crea con
   el título `PENDIENTE DE SEÑA · …` cuando la seña está activa (lo pone la
   expresión del nodo, no el modelo). Al cotejo `cuadra` el flujo quita el
   prefijo. Un flujo programado borra las pendientes con más de
   `senaMinutosRetencion` minutos, sin escribirle al cliente, y lo reporta.
5. **El cierre con seña lo crea el servidor al cotejar**, con `monto` y
   `cotejo`. Con seña activa el flujo no registra cierre al agendar: una cita
   pendiente que vence no es un cierre. Sin seña, todo sigue como hoy.
6. **De la seña, los comprobantes no se guardan; de la venta con regla 2, sí
   (decisión de Andres, 03/10/2026, que REEMPLAZA a «los comprobantes no se
   guardan»).** Se guarda la IMAGEN del comprobante de una venta durante **90
   días**, como evidencia: el OCR puede fallar y la foto puede salir borrosa.
   **Solo la lee el servidor**: `storage.rules` niega todo acceso a
   `tenants/{t}/comprobantes/**`, también al administrador, al operador y al
   propietario; **nada en la consola**; y se **borra con la baja** del comercio
   (la purga diaria, dentro de las 24 h). Contrato en §4duodecies.6. La **seña**
   no cambia: sigue sin guardar la imagen, solo el JSON leído y el resultado
   (ver la revisión al cierre de §4nonies.3).
7. **Mensajes por conversación**: +1 (el QR, imagen con caption) en las que
   llegan a reservar. La confirmación del comprobante es un mensaje fijo, sin
   modelo. El aviso a recepción por cita pagada, con diferencia o ilegible lo
   paga NovuChat y no se cuenta al comercio.


<!-- movido de admin/DISENO.md §4duodecies.2 (25/09/2026, líneas 2640-2650) -->

### 4duodecies.2 Los campos

| Dónde | Campo | Tipo | Quién escribe | Qué pantalla lo muestra |
|---|---|---|---|---|
| `config/agendamiento` | `senaImporte` | int 0..10000 (0 = sin seña) | admin del negocio, con `tieneAgenda` (`configAgendamientoValida()`) | **Configuración de QR**, bloque «Seña para reservar» (`ConfiguracionVertical`, `CAMPOS.agendamiento`) |
| `config/agendamiento` | `senaMinutosRetencion` | int 5..180 (respaldo 30) | ídem | ídem |
| `config/venta` o `config/agendamiento` | `cobroReal` | map (`activo`, `cargaUtil`, `cuentas`, `nombreCuenta`, `banco`, `ficha`, …) | solo `registrarQrDeCobro` (Admin SDK) | **Configuración de QR**: lee el documento que le toca por `flujos` |
| `conversaciones/wa_{tel}` | `solicitud` (`etapa`, `desde`, `qrEnviadoEn`, `evento`, `cotejos`, `seguimientos`) | map | la ingesta y `cotejarComprobante` | ninguna todavía |
| `cierres/cita_<eventoId>` | `monto`, `moneda`, `cotejo` (`resultado`, `diferencias`, `montoLeido`, `banco`, `idMeta`, `intentos`, `en`) | number, string, map | `cotejarComprobante` | **Cobros**: columna «Comprobante» y el detalle (diferencias, monto leído, banco, intentos, fecha) |
| `metricas/{aaaa-mm}` | `senasEnviadas`, `senasCotejadas`, `senasVencidas` | int | la ingesta, `cotejarComprobante`, `senaVencida` | **Consumo**: «Señas: N enviadas · M cotejadas · K vencidas», solo si el mes trae alguna |


<!-- movido de admin/DISENO.md §4duodecies.3 (25/09/2026, líneas 2651-2673) -->

### 4duodecies.3 Lo que muestra cada pantalla, y lo que no

- **Configuración de QR** (`Cobro.tsx`) es una sola pantalla para los dos
  flujos que cobran. Decide el documento por la lista de flujos, igual que el
  servidor; explica por flujo qué hace el asistente con el QR; y monta al pie
  los parámetros propios de cada flujo en SU documento (§4sexies.2): costos de
  entrega a `venta`, seña a `agendamiento`. El QR de demostración solo se
  muestra a un negocio con venta: en reservas la seña va siempre por el camino
  real, y los dos modos no conviven (prohibición 3).
- **Cobros** (`Cobros.tsx`) gana la columna **«Comprobante»** —«Datos
  coinciden», «Hay una diferencia», «Ilegible», o nada— al lado de «Estado».
  Parecen la misma y no lo son: la primera es lo que leyó el servidor; la
  segunda, lo que afirmó una persona contra su banco. **Un cotejo que cuadra
  no comprueba nada**, y por eso el botón «Comprobar» sigue al lado de un
  cotejo que cuadra, y la ayuda lo dice: NovuChat coteja datos, no confirma
  dinero.
- **Consumo** (`Consumo.tsx`) agrega una línea con las tres cifras de señas,
  solo cuando el mes trae alguna: no se facturan, pero explican por qué un mes
  tiene más mensajes que conversaciones y cuántas reservas se caen.
- **Lo que ninguna pantalla muestra**: la imagen del comprobante (no se
  guarda) y la `solicitud` de la conversación (es estado del flujo, no un dato
  del negocio; si algún día hace falta, va en «Conversaciones»).


<!-- movido de admin/DISENO.md §4duodecies.4 (25/09/2026, líneas 2674-2679) -->

### 4duodecies.4 Lo que este bloque NO hace

Imágenes y PDF que no son comprobante, audio, seguimientos de la solicitud, y
el candado con un solo calendario: son los bloques 3, 4 y 5 de `Analisis/30`.
Los dos primeros están hechos: §4terdecies (medios) y §4quaterdecies (seguimiento).


<!-- movido de admin/DISENO.md §4duodecies.5 (25/09/2026, líneas 2680-2750) -->

### 4duodecies.5 El mismo cobro, en una VENTA (23/09/2026)

> **`Analisis/07` §4, que estaba escrito para el Demo B desde el 06/09 y no se
> había construido.** Toda la maquinaria de §4duodecies se porta al flujo de
> venta con **una sola diferencia**, y de ella sale todo lo demás:
>
> **En una reserva el importe esperado se LEE de la configuración; en una venta
> se FIJA cuando sale el QR.** La seña es un número fijo (`senaImporte`); el
> total de un pedido cambia con cada conversación.

**Las decisiones, en orden:**

1. **El total viaja con el QR, no con el comprobante.** El flujo lo reporta en
   el mismo mensaje que reporta el QR (`evento: 'qr_enviado'`, campo `monto`) y
   la ingesta lo guarda en `solicitud.monto` **dentro de la transacción que ya
   cuenta ese mensaje**. El cotejo lo lee de ahí. Es «por hecho, no por dicho»
   aplicado al dinero: el número quedó escrito cuando salió el QR y nada de lo
   que el modelo escriba después lo mueve.
2. **Si el pedido vino del carrito web, gana el total del SERVIDOR.**
   `pedidos/{id}.total` lo calculó `catalogoWeb.ts` con el costo de envío
   incluido y sin pasar por el navegador. Cuando la referencia de la solicitud
   es un `cat_…`, `cotejarComprobante` lee ese documento y descarta lo que
   mandó el flujo.
3. **Sin total no se coteja contra cero.** `409 sin_total`, y el comprobante lo
   mira una persona. Con cero, el cliente leería «el comprobante dice 350 y el
   pedido es de 0», que es un motivo falso.
4. **El QR pendiente caduca a las 24 h** (`MINUTOS_QR_VENTA`; **esta es la
   «regla 1»**, la de todo flujo que no mande `reglaCobro: 2`; la regla 2, de 15
   minutos, está en §4duodecies.6), que es la
   ventana de la conversación. No hay horario que liberar —eso es de la
   agenda—, pero un pendiente que no caduca convierte cualquier imagen en un
   pago. No hace falta un flujo programado: lo resuelve el reloj en el cotejo.
5. **El estado del cobro sale en los DOS modos** (`configuracionFlujo.cobro`,
   `cobroVenta.ts`), real y simulado. La compuerta del comprobante tiene que
   funcionar también en la demostración, o el camino que se prueba delante de
   un prospecto no es el que corre en producción.
6. **El cierre es `cierres/venta_<referencia>`**, con la misma cuenta que
   `idDesdeReferencia` de `cierres.ts`, para que no se cuente dos veces.
   Métricas propias: `cobrosCotejados` y `cobrosVencidos`.
7. **Lo que NO se porta, y por qué:** la retención del horario (no hay horario)
   y el adelanto a favor (lo contrario de una cita cancelada con seña es una
   devolución de dinero, y eso no lo decide un asistente).

**Campos nuevos**

| Dónde | Campo | Tipo | Quién escribe |
|---|---|---|---|
| `conversaciones/wa_{tel}` | `solicitud.monto` | number \| null | la ingesta, con `qr_enviado` |
| `metricas/{aaaa-mm}` | `cobrosCotejados`, `cobrosVencidos` | int | `cotejarComprobante` |

**Mensajes por conversación: −1** en las que llegan a pagar (el texto del
asistente viaja en el **pie** del QR y deja de salir aparte), **0** en el resto.
El mensaje fijo del cotejo reemplaza a la confirmación que hoy escribe el
modelo. Los avisos al negocio los paga NovuChat.

**Dos defectos que aparecieron al construirlo, y quedaron cerrados:**

- **La carga útil del QR viajaba al flujo.** `configuracionFlujo` volcaba el
  documento del vertical ENTERO, y adentro va `cobroReal.cargaUtil`: el código
  del QR llegaba a n8n en cada consulta y quedaba en los datos de ejecución.
  Contradecía lo que §4duodecies.1 dice con todas las letras («la imagen NO
  viaja acá: viaja su ficha»). Afectaba a los dos verticales que cobran y
  estaba en producción desde que existe el cobro real.
- **Un QR vencido se seguía sirviendo.** `imagenDeCobro` miraba `activo` y
  revalidaba el código, pero no `venceEl`. `registrarQrDeCobro` rechaza
  registrar uno vencido y `activar-cobro-real.mjs` se niega a encenderlo, pero
  ninguno de los dos mira lo que pasa DESPUÉS: un QR encendido en junio con
  vencimiento en septiembre se servía en octubre, el cliente escaneaba, el
  banco rechazaba y el negocio se enteraba por un reclamo.

`admin/functions/src/modulos/cobros/cobroVenta.ts`; pruebas en `pruebas/cobro-venta.test.ts`
(el servidor) y `pruebas/demo-b-cobro.test.ts` (el flujo, escrita negando).


### 4duodecies.6 La regla 2 del cobro de venta: plazo de 15 minutos, tres intentos y la imagen guardada (03/10/2026)

> **Origen:** reglas dictadas por Andres el 03/10/2026 para todo cobro con QR,
> no solo de un cliente; plan en `NOVUCHAT_plan-consolidado-C1-C4-comprobante`
> (C1a es esta sección más el servidor; C1b, de la coordinadora, es la
> integración en `ingesta.ts`, `index.ts` y `registro.ts`). **Cero mensajes por
> conversación agregados o quitados por el servidor**: los textos al cliente
> son del flujo (C3).

**D1. La regla nueva se ELIGE POR FLUJO, no se activa al desplegar.** El flujo
manda `reglaCobro: 2` con `qr_enviado`; **sin ese campo, la regla de 24 h
(§4duodecies.5.4, la «regla 1») sigue exactamente igual**. Desplegar C1 no
cambia ningún flujo publicado. La regla 1 se retira cuando ningún flujo la use.

**Decisiones de Andres que fijan los umbrales (03/10/2026).**

- **P1.** El destinatario se acepta por cuenta o por nombre, como hoy: **un dato
  que figura y no coincide descalifica**. Se aceptan el nombre en orden
  invertido, truncado y con **una letra de diferencia** en palabras de 5 o más
  letras (aproximado). «Juan Pérez» frente a «Juan López» es inválido; un nombre
  muy distinto sin cuenta visible, también.
- **P1b (03/10/2026, afinada tras la revisión).** El emparejamiento es **uno a
  uno** y la **dirección importa** (esperado, leído): un prefijo vale solo si la
  palabra truncada es la LEÍDA del comprobante (el banco trunca) y es principio
  de la esperada, con 4 letras o más (completo) o con 3 (débil); ANA no valida
  ANABEL, PAZ no valida PAZOS, EVA no valida EVANGELINA. Las iniciales y los
  prefijos de 3 letras son **débiles**: solo dan `aproximado`, y si todas las
  coincidencias son débiles («Juan Perez» frente a «J P» o «JUA PER») el nombre
  es `insuficiente`. Un prefijo de 2 letras no es nada. **Una inicial, de cualquiera de los dos lados, es siempre débil** (dos iniciales iguales tampoco dan `exacto`). **Nota:** el nombre esperado con más de 8 palabras se trunca a 8 y lo leído con más de 8 se rechaza (un nombre real no llega a tanto, no es un hallazgo). Mejora posible para C4, no se construye: que la consola advierta cuando el nombre configurado lleva iniciales. El nombre del destinatario vale **por sí solo** solo si
  coinciden al menos **dos palabras** (sin partículas); con una sola palabra
  coincidente hace falta que coincida la cuenta, y si no el resultado es
  inválido con motivo `destino_no_coincide`. Orden invertido y nombre truncado
  siguen valiendo con dos o más palabras; la letra de diferencia aplica por
  palabra, con al menos dos coincidentes («PERES GOMES» frente a «Perez Gomez»
  es aproximado; «JUAN» solo frente a «Juan Perez», inválido).
- **P2.** Modo simulado: el **plazo** aplica; los intentos y la validación, no
  (eso es del flujo, C3). Por eso `cotejarComprobanteVenta` contesta **409
  `cobro_simulado`** (defensivo) cuando el comercio no tiene cobro real activo
  (encendido y con ficha y código, el mismo criterio de `configuracionFlujo`).
- **P3.** Los pedidos del carrito web (`pedidos/cat_…`) **no se anulan**: quedan
  «recibido».
- **P4.** El borrado por baja ocurre **dentro de las 24 h** siguientes (la
  purga diaria).
- **P5.** `en_revision` no tiene cierre.

**Qué hace la regla 2.**

| Cosa | Valor |
|---|---|
| Plazo base | `venceEn` = envío del QR + **15 min** (`MINUTOS_QR_VENTA_REGLA_2`) |
| Prórroga | **una sola**, `prorrogaHasta` = primer comprobante recibido a tiempo + **10 min** (`MINUTOS_PRORROGA`), fijada una vez |
| Límite efectivo | `max(venceEn, prorrogaHasta)` (`limiteDe`) |
| Reenvío del QR | **no estira** nada, pero **solo es reenvío si la referencia Y el total coinciden** con los del cobro abierto: conserva `venceEn`, intentos, comprobantes y `qrEnviadoEn`. Con otro total u otra referencia es un **cobro nuevo, con plazo nuevo** |
| `qr_enviado` sobre `en_revision` | **no reabre el cobro**: el mismo pedido (misma referencia y total) es `ignorado` y no cambia nada; un pedido distinto es un cobro nuevo |
| Intentos | **3** comprobantes inválidos (`MAX_INTENTOS_INVALIDOS`); el tercero pasa a `en_revision` |
| Vencimiento | **perezoso**: se calcula al leer; se anota cuando alguien lo toca (un comprobante, `anulacion_avisada`, `cobro_cancelado` o un QR nuevo) y se cuenta una vez |
| Tardío | un comprobante pasado el límite y hasta **24 h** después: `tardio`, **sin cierre**, se deriva al comercio; después de eso, otra conversación (409) |

**Calificar (`calificarComprobante`, `cotejo.ts`).** Monto igual: válido. Leído
**mayor** con diferencia ≤ `max(1,00 Bs, 2 % del esperado)`: aproximado, con
`montoDistinto`. Leído **menor: siempre inválido**. Fecha con hora: dentro de
`qrEnviadoEn − 10 min` y `recibido + 10 min`; **sin hora**: aproximada si
coincide con el día de La Paz del QR o de la recepción. «No es comprobante»
(cuenta como intento): falta el monto, o la fecha, o a la vez la cuenta y el
nombre. `cotejarComprobante` (la seña) **no se toca**.

**Contratos.**

*Obligaciones de C1b (la coordinadora; los puntos c y d son de otras zonas y
NO los toca C1a).*
(a) Los `cambios` de `solicitudDeCobroTras` se **mezclan DESPUÉS** de lo que
arma `solicitudTras`. (b) `solicitudDeCobroTras` se llama en **TODO
`qr_enviado` de cualquier módulo** (agenda y venta comparten
`conversaciones/{t}.solicitud`); con efecto `ignorado` o `sin_id_meta` la
ingesta **no toca la solicitud ni cuenta el QR**, y con `qr_enviado` debe pasar
`reglaCobro`, `idMeta`, `referencia` y `monto`; **`referencia` es siempre el
pedido** (el `cat_…` o su id), **nunca el id del mensaje del QR**, y `monto` el
total cotizado: con ellos se decide si un `qr_enviado` es reenvío o cobro nuevo. (c) `registrarCierre` con
`cita_agendada` (`core/turno/cierres.ts:140-142`) **no debe pasar a `agendada`**
una solicitud de regla 2 en `en_revision`, `cancelada` o vencida por reloj.
(d) `seguimientos.ts:128` **no debe emitir recordatorio** sobre una regla 2
vencida de forma perezosa que sigue escrita `qr_enviado`.

*Ingesta (C1b).* `reglaCobro?: 2` solo con `qr_enviado`; eventos nuevos
`cobro_cancelado` y `anulacion_avisada`; con regla 2, un `qr_enviado` **sin
`idMeta` no abre cobro** (ni solicitud ni `senasEnviadas`). La ingesta llama a
`solicitudDeCobroTras(previa, evento, ahoraMs)` (pura, `cobroVenta.ts`), que
devuelve `{ cambios, efecto, metricas, … }`: `cambios` se **mezcla** sobre
`solicitud` y `metricas` se suman al mes, **dentro de la transacción que ya
existe** (0 escrituras extra). **Cuidado con `merge`:** una solicitud nueva de
regla 1 que reemplaza a una de regla 2 debe mezclar `CAMPOS_REGLA_2_EN_NULO`
(lo devuelve `solicitudDeCobroTras` con efecto `regla_1`), o el `reglaCobro: 2`
anterior sobreviviría.

*`solicitud` con regla 2.* `reglaCobro`, `venceEn`, `prorrogaHasta`,
`intentosInvalidos`, `comprobantes` (hasta 6: `{idMeta, estado, motivo, en,
ruta|null, avisar, intentos, importe, montoLeido, montoDistinto}`), `subidas`
(hasta 6: `{idMeta, ruta}`), `anulacionAvisadaEn`; etapas nuevas `en_revision` (no vence por
reloj) y `cancelada`; `agendada` es la venta cerrada.

*`configuracionFlujo.cobro`* (`cobroParaElFlujo`): los campos de siempre,
idénticos en regla 1, y además `regla` (1|2), `venceEn`, `prorrogaHasta`,
`intentosInvalidos`, `intentosRestantes`, `enRevision`, `anulado: {pedido,
haceMin} | null` (solo si la etapa es `vencida`, sin aviso previo y a lo sumo
24 h después del límite). Sale en los dos modos, real y simulado.

*`POST cotejarComprobanteVenta`* (`cotejoVenta.ts`; mismas opciones y misma
autenticación que `cotejarComprobante`). Cuerpo `{telefono, legible, leido:
{monto, cuentaDestino, nombreCuenta, fecha, hora, banco}, idMeta, ruta?}`;
`idMeta` es obligatorio. 200 con `estado` (`valido | aproximado | reintentar |
en_revision | tardio | ya_resuelto`), `motivo` (código fijo), `intentos`,
`intentosRestantes`, `importe`, `moneda`, `montoLeido`, `montoDistinto`,
`cierreId | null`, `evento`, `avisarComercio`. 409 con `sin_cobro_pendiente |
cobro_cancelado | sin_total | regla_1 | cobro_simulado` (**nunca
`sin_sena_pendiente`**). Motivos:
`ok`; aproximado: `monto_distinto`, `fecha_sin_hora`, `nombre_aproximado`;
inválido: `monto_menor`, `monto_mayor`, `fecha_anterior`, `fecha_posterior`,
`cuenta_distinta`, `nombre_distinto`, `destino_no_coincide`,
`destino_no_verificable`; no es
comprobante: `falta_monto`, `falta_fecha`, `falta_destino`, `ilegible`; y
`tardio`, `en_revision`, `ya_resuelto`. Nada de lo leído de la imagen vuelve al
cliente, salvo `montoLeido`: sale en **toda** respuesta con un comprobante
legible (aproximado, inválido y tardío incluidos) para que el flujo diga «el
comprobante dice X y el pedido es Y»; `montoDistinto` es `true` solo cuando se
aceptó como aproximado por la tolerancia.
**Una transacción:** `valido`/`aproximado` crean `cierres/venta_<ref>` (con
`cotejo.resultado: 'cuadra'` y `cotejo.calidad`) y suman `cierres`; un
**inválido NO crea cierre ni suma `cierres`**, suma `cobrosInvalidos`; el
tercero pasa a `en_revision` con `avisarComercio`; un tardío no cierra la venta.
Un `idMeta` repetido (reintento de n8n, porque la primera respuesta se perdió)
**repite lo que se contestó** —`estado` (`invalido` sale como `reintentar`),
`motivo`, `intentos` e `intentosRestantes` **de entonces**, `montoLeido`,
`cierreId` y el `avisarComercio` original— con `repetido: true`. **Con `repetido: true` el flujo avisa al comercio solo si en ESTA ejecución
todavía no avisó** (el reintento existe porque se pudo perder la primera
respuesta); un `idMeta` ya procesado por OTRA ejecución se descarta antes, con el
filtro de repetidos de la entrada; no cuenta ni escribe nada. Un comprobante recibido en
`en_revision` se anota con motivo `en_revision`; el tercer inválido se anota ya
como `en_revision`.
La `ruta` solo se anota si coincide con el patrón del comercio y del `idMeta`.

*`POST guardarComprobante`* (`comprobantes.ts`). Binario; cabeceras
`X-NovuChat-Telefono`, `X-NovuChat-IdMeta`, `Content-Type`. jpeg, png y webp
hasta **5 MB**, pdf hasta **10 MB**; el tipo se comprueba **por los bytes** y
debe coincidir con el declarado. 200 `{ruta}`, o 400, 401, **413**, **415**,
**409** (no hay cobro de regla 2 abierto, en revisión o recién vencido para ese
teléfono) o 502 (Storage falló: el flujo sigue con `ruta: null`). **Se aceptan imágenes** mientras el cobro está en `qr_enviado` o `vencida`
hasta 24 h después del límite efectivo (`limiteDe`, también un `qr_enviado`
vencido por reloj que nadie anotó) y en `en_revision` hasta 24 h desde que
entró (`solicitud.desde`); fuera de eso, 409 `sin_cobro_pendiente`. **El tope de
6 cuenta SUBIDAS**: cada imagen nueva anota `{idMeta, ruta}` en
`solicitud.subidas` dentro de una transacción (una escritura por imagen) y la
séptima da 409 `demasiados_comprobantes`; un `idMeta` ya subido pasa. El nombre
del objeto es el **sha256 del `idMeta` crudo en base64url** (43 caracteres), no
un saneo con pérdida, y `rutaValidaDe` compara contra ese mismo hash. **Una
evidencia nunca se sobrescribe**: se guarda con `ifGenerationMatch: 0`, hay una
sola extensión por `idMeta` y el mismo `idMeta` repetido responde 200 con la
misma ruta sin reescribir (si la primera vez Storage falló, el reintento sí
guarda). Ruta:
`tenants/{t}/comprobantes/{aaaa-mm-dd}/{sha256 del idMeta en base64url}.{jpg|png|webp|pdf}`, con
el día de La Paz y **sin el teléfono**; `cacheControl: private`. **Solo
autentica con el token por número**: la firma HMAC cubre el cuerpo y
`firma.ts` se niega a verificar más de 64 KB, así que una imagen no puede
firmarse (n8n usa el token). Una petición que trae `X-NovuChat-Signature` se
rechaza con 401 antes de autenticar, aunque la firma sea válida.

*`purgarComprobantes`* (`onSchedule`, 03:30 `America/La_Paz`): borra las
carpetas de **más de 90 días** (91 sí, 90 y 89 no) y **toda** la carpeta de un
comercio `dado_de_baja`. Una lectura por comercio y un listado por comercio
activo. El `Almacen` es inyectable (`fijarAlmacenDeComprobantesDePrueba`, solo
con `COMPROBANTES_DOBLE`), como el de `cobroPrepago.ts`.

*Métricas* `metricas/{aaaa-mm}`: `cobrosQrEnviados`, `cobrosValidos`,
`cobrosAproximados`, `cobrosInvalidos`, `cobrosEnRevision`, `cobrosCancelados`,
`cobrosTardios` (se mantienen `cobrosCotejados` y `cobrosVencidos`).

**El contador `cierres` baja para los flujos con regla 2.** Los inválidos dejan
de crear cierre, así que la tasa cierres/conversaciones de los comercios que
usen la regla 2 baja desde que se despliegue y un flujo la use. **Los períodos
anteriores no cambian** (`/cierres` no se borra). El cierre es un registro de lo
que terminó bien: **no se factura** (se factura la conversación).

**Prohibición 3.** Ninguna frase de este módulo dice «acreditado», «verificado»
ni «recibimos tu pago»: los motivos son códigos y el detalle del cierre dice que
los datos coinciden o que son aproximados. Quien confirma que entró la plata es
el banco, y el negocio.

**Integrado (C1b, de la coordinadora, 04/10/2026).** Las tres Functions
(`cotejarComprobanteVenta`, `guardarComprobante`, `purgarComprobantes`) están
exportadas en `index.ts` y declaradas en el manifiesto de `cobros` en
`registro.ts` (`functions`, `almacenamiento: ['comprobantes']`, `mensajes: 0`),
y `ingesta.ts` entiende `reglaCobro`, `cobro_cancelado` y `anulacion_avisada`
y llama a `solicitudDeCobroTras` en todo `qr_enviado` (obligaciones (a) y (b));
`solicitudTras` no pasa a `agendada` una regla 2 en `en_revision`, `cancelada`
o vencida, escrita o por reloj (obligación (c)), con el predicado puro exportado
`cierreBloqueadoPorCobro(previa, ahoraMs)` de `ingesta.ts`, **`en_revision` bloquea
siempre** (no vence por reloj: lo resuelve una persona) y `cancelada`, `vencida` y
`qr_enviado` vencido, **solo mientras sigue siendo ese caso** (hasta 24 h después
del límite efectivo): pasado ese plazo es otra conversación y `cita_agendada`
crea su solicitud `agendada` con `CAMPOS_REGLA_2_EN_NULO`. `registrarCierre` (`core/turno/cierres.ts`), con `tipo: 'venta'`, regla 2 y
**cobro real activo** (`config/venta.cobroReal`: encendido, con ficha y código),
responde 409 y no crea cierre ni suma `cierres` si el cobro está a tiempo
(`qr_enviado`) o bloqueado: en cobro real el único que cierra una venta es
`cotejarComprobanteVenta`; el modo simulado y la regla 1 cierran como siempre
(`cierreDeVentaLoHaceElCotejo`). Con cobro real, una venta sin teléfono válido
responde 400, y un cierre `cita` sobre un `qr_enviado` de regla 2 a tiempo se
registra (su propio `cierres`) **sin mover la solicitud**. Un `horarios_ofrecidos` no reemplaza un cobro `en_revision`, y con
`reglaCobro: 2` una `referencia` vacía o igual al `idMeta` se trata como
`sin_id_meta`. La suite es
`pruebas/cobro-v2-ingesta.test.ts`. **Nada de esto corre en producción hasta el
despliegue** (3 Functions, 1 job de Scheduler, invocador para las 2 HTTP), que
es posterior al 05/10, en ventana y con el «sí» de Andres; y la regla 2 la
elige el flujo, así que desplegar no cambia ningún flujo publicado. **Falta la
obligación (d)** (`seguimientos.ts`, otro PR): hasta entonces, una regla 2
vencida de forma perezosa que sigue escrita `qr_enviado` todavía podría recibir
un recordatorio.

**Requisitos del flujo (C3) y dependencias duras.**
- `referencia` del `qr_enviado` de regla 2 debe ser un **id de pedido estable y
  distinto del `idMeta` del mensaje del QR**. El Demo B manda `cobroPedido || id
  del mensaje del QR`: en un pedido conversacional sin carrito `cobroPedido` va
  vacío y la ingesta lo trata como `sin_id_meta` (no abre cobro). El flujo debe
  mandar un id propio del pedido.
- **C3 no se publica antes de que C1c esté completo** (la guarda de regla 2 en el
  cotejo de regla 1 de `sena.ts`, y lo que C1c termine de `registrarCierre`), ni
  antes de C1b-d (#413, `seguimientos.ts`).
- **Con cobro real, el flujo no llama a `registrarCierre` de venta** (o usa el id
  del pedido como `referencia`): cierra solo `cotejarComprobanteVenta`. Una venta
  con otra `referencia` sobre una solicitud ya `agendada` por el cotejo contaría
  dos veces (seguimiento declarado, no implementado).

**Deuda para F3b.** Hoy Core (`registrarCierre`) lee `config/venta` y conoce la
regla 2; sale cuando F3b inyecte ganchos (el gancho `alCierre` de Cobros ya está
en el manifiesto).

### 4duodecies.7 El visor de comprobantes: `verComprobante` (09/10/2026)

> **Origen:** pedido de Andres (07/10/2026) y decisiones del 09/10; plan único en
> el PR-1 (servidor) y PR-2 (consola, después de fusionar el PR-1). **Cero
> mensajes por conversación**: es una callable de la consola, no toca el flujo.
> Reemplaza a «no hay visor en la consola» de §4duodecies.6.

**Qué es.** Los comprobantes de las ventas con regla 2 se guardan 90 días en
Storage (`comprobantes.ts`) y `storage.rules` sigue negando todo acceso directo,
incluido el del administrador. La **única puerta** es la callable `verComprobante`
(`modulos/cobros/verComprobante.ts`): devuelve los bytes, **sin URL firmada ni
enlace**, para el administrador y el operador de ESE comercio y para el soporte
de NovuChat mientras tenga una ventana vigente (`accesosSoporte`). El propietario
sin ventana no.

**Contrato (PR-1 servidor ↔ PR-2 consola).**

| | |
|---|---|
| Entrada | SOLO `{tenantId, cierreId}`. `tenantId` cumple `ID_TENANT`; `cierreId` cumple `^venta_[A-Za-z0-9_-]{1,120}$`. El servidor ignora cualquier otra clave y **el cliente nunca manda una ruta**. |
| Salida | exactamente `{mime, base64}`; `mime` ∈ `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. |
| Errores (mensaje fijo) | `unauthenticated` «Inicie sesión.»; `invalid-argument` «Solicitud inválida.»; `permission-denied` «Sin permiso para ver este comprobante.»; `failed-precondition` «Este cobro no tiene un comprobante que se pueda mostrar.»; `not-found` «No hay un comprobante guardado para este cobro.»; `resource-exhausted` «Alcanzó el tope de comprobantes por hora o por día.»; `unavailable` «No se pudo abrir el comprobante. Intente más tarde.» |

**Orden en el servidor** (un rechazo se audita SOLO después de la identidad y la
ficha; antes, cero escrituras en Firestore y, salvo sin sesión, una línea de log
con código y uid; sin sesión (`unauthenticated`) no deja ni la línea):
1 sesión; 2 forma de la entrada; 3 rol del token PARA ESE comercio
(`esAdminDe`, `esOperDe` o `esPropietario` como candidato a soporte; cualquier
otro, denegado); 4 `cuentaVigenteDe` (la cuenta sigue habilitada, con el rol y
con la sesión posterior a la última revocación; Auth caído = `unavailable`, no
«sin permiso»); 5 soporte: `soporteVigenteDe`; 6 la ficha, `activo` o
`suspendido` (**el suspendido sí puede ver**; dado de baja o inexistente, no);
7 `tieneModulo(ficha, 'cobros')` del registro; 8 el tope; 9 el cierre: tipo
`venta` y `cotejo.calidad` ∈ {`valido`, `aproximado`}; 10 la ruta (la guardada en
`privado/datos.rutaComprobante` si pasa `rutaValidaDe`; si no, derivada del
`idMeta` sobre el día del cotejo y el anterior, 4 extensiones, hasta 8
`getMetadata`); 11 tamaño sin descargar (10 MB PDF, 5 MB imagen); 12 descarga;
13 el tipo por los **bytes** (`tipoPorFirma`), de acuerdo con la extensión: nunca
el `contentType` guardado; 14 la **auditoría fail-closed**; 15 la respuesta.

**Auditoría.** `tenants/{t}/auditoria` con `auditar` (`central/comunes.ts`):
`{accion:'comprobante_visto', uid, rol ('admin'|'oper'|'soporte'), cierreId,
resultado ('ok'|'rechazado'), motivo?, en}`. Motivos cerrados: `sin_modulo`,
`tope`, `sin_comprobante`, `no_elegible`, `demasiado_grande`, `error_almacen`,
`tipo_no_coincide`. Sin teléfono, ruta, `idMeta`, hash ni bytes. Es
**fail-closed**: los bytes salen solo si la auditoría confirmó; si no se pudo
anotar, `unavailable`. **No usa la bitácora** (`registrar()` se traga los errores
y la ingesta puede escribir en ella).

**D2. El tope: 30 por hora y 100 por día por usuario.** Un documento contador
transaccional `topesDelVisor/{uid}` en la raíz (`hora`, `vistasHora`, `dia`,
`vistasDia`, `actualizadoEn`; hora y día de La Paz). Es global (no por comercio),
cuenta todo intento autorizado que pasa la verificación del módulo y se evalúa
antes de leer el cierre; si rechaza, no escribe. Un contador ilegible falla
cerrado. Sin índice compuesto. Las reglas niegan el documento a todos
(`allow read, write: if false`, con prueba negativa en `visor-reglas.test.ts`).
No va en `planes.ts` ni en `limites.md`: es una protección del servicio, no un
límite comercial del plan.

**D3. App Check, solo en esta callable.** `opcionesDeVerComprobante(process.env)`:
`memory: '512MiB'`, `maxInstances: 3`, `concurrency: 4` y `enforceAppCheck` según
`APP_CHECK_DEL_VISOR` (`{produccion: true, staging: false}`; el emulador, apagado).
**En staging** (`CPU_FRACCIONARIA='si'`, `gcf_gen1` con 512 MiB = 0,333 vCPU)
**no se fija `concurrency`**: firebase-tools rechaza una concurrencia mayor que 1
con menos de 1 vCPU. Sin variable de entorno nueva (el CI de producción exige un
`.env` exacto). Las pruebas llaman con `.run()`, que salta App Check: se prueba la
función pura. **Exigir App Check en las demás Functions o en Firestore es un
cambio APARTE y de riesgo** (antes hay que medir cuántos tokens verificados
llegan hoy), y no entra con este visor. Riesgo conocido: si el build de la
etiqueta sale sin la clave del sitio, con `produccion: true` el visor queda
inutilizable (todo `unauthenticated`); es una compuerta antes de etiquetar.

**Quién lo ve (D4).** Con el PR-2, el operador ve en Cobros el listado, los totales y
«Ver comprobante», y NO ve «Comprobar» (la regla de actualización exige
administrador) ni «Exportar». La callable lee `privado` en su nombre y devuelve
solo `{mime, base64}`. La pestaña Cobros se le muestra al operador SOLO si el negocio
tiene el módulo `pedidos` (decisión de Andres, 09/10/2026; `rolesConModulo` en el
registro): al operador de un comercio de reservas no se le muestra. Es presentación,
no un límite: las reglas de `cierres` ya dejaban leer los cierres a todo miembro
del negocio antes de este visor. **Consentimiento de soporte (D7):** hoy no
existe una pantalla que otorgue una ventana de soporte (`otorgarAccesoSoporte` y
`revocarAccesoSoporte` no tienen quien las llame); el servidor ya acepta soporte
vigente, y el texto del consentimiento llega con la pantalla (PR opcional).

**Qué cambió en el resto del módulo.** `comprobantes.ts`: el `Almacen` gana
`metadatos(ruta)` (tamaño sin descargar; `null` si es 404) y `leer(ruta)` (`null`
si es 404; otro error se relanza), y se exporta `almacenDeComprobantes()`.
`cotejoVenta.ts`: ahora escribe `privado/datos.rutaComprobante` (hasta aquí no la
escribía en ninguna rama) al crear el cierre y, con `merge`, en la rama de un
cierre previo; solo si `rutaValidaDe` la acepta para ESE comercio y ESE mensaje.
El objeto se guarda sin `firebaseStorageDownloadTokens`.

**Costo.** 0 mensajes por conversación. Por vista: 4 lecturas de Firestore (5 con
soporte), 2 escrituras (el tope y la auditoría), de 1 a 8 `getMetadata` y una
descarga de hasta 10 MB (~13 MB en base64). Por venta: 0 escrituras extra (1 en la
rama de un cierre previo). Nube: un servicio Cloud Run nuevo (`vercomprobante`),
una publicación de reglas de Firestore y una de Storage (solo un comentario), 0 índices; **una callable nueva no nace
invocable**: tras desplegar se verifica el invocador.

**Costo declarado: los rechazos `tope` y `sin_modulo` escriben un asiento por
llamada, sin cota propia.** Decisión de la coordinadora (09/10/2026): se acepta.
La cota real la fijan `maxInstances` 3 × `concurrency` 4 y que quien llama tenga
rol válido en ese comercio (sin rol no se escribe nada). Solo cuesta escrituras y
ensucia la auditoría; no filtra datos. No se cambia el contrato ni el contador:
el tope cuenta todo intento autorizado que pasó el módulo, antes de mirar el
cierre y el almacén (lo fija `ver-comprobante.test.ts`, T18).
