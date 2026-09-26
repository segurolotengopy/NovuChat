# Módulo Cobros (el comercio cobra a su cliente)

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `cobro.ts`, `qrSimple.ts`, `dibujoQr.ts`, `cotejo.ts`, `cobroVenta.ts`, `mediaIdQr`, `cobroReal`; `Cobros.tsx`, `Cobro.tsx` (QR) |
| **Depende de** | Pedidos o Agenda (quien cierra) |
| **Límite por plan** | — |
| **Configuración** | `config/cobros` (hoy repartido entre `config/venta` y `config/agendamiento`): `mediaIdQr`, `cobroReal`, montos de seña, … |
| **Colecciones** | las de cobro dentro de `cierres` y `pedidos`; `fotosCatalogo` no |
| **Pestañas** | Cobros (`admin`), Cobro / QR (`admin`) |
| **Prompt** | fragmento de cobro del prompt (QR, comprobante) |
| **Herramientas** | las de la seña y del comprobante en los flujos de reservas y venta |
| **Nodos (lo que queda en n8n)** | `preparar-sena`, `respuesta-de-la-sena`, `mensaje-de-la-sena`, `interpretar-lectura` (hoy en `Flujos/src/reservas/`), más los nodos de cobro del Demo B; dibujo del QR y cotejo del comprobante como servicios internos del módulo |
| **Ganchos** | `despuesDelTurno` (cotejo), `alCierre` con Pedidos o Agenda |
| **Mensajes por conversación** | 0 en la venta; la seña agrega los mensajes declarados en §4duodecies (abajo) |
| **Pruebas** | `qr.test.ts`, `sena-cotejo.test.ts`, `sena-servidor.test.ts`, `cobro-venta.test.ts`, `demo-b-cobro.test.ts` |

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
6. **Los comprobantes no se guardan.** Ni la imagen ni el PDF van a Storage ni
   a Firestore: solo el JSON leído y el resultado. Ver la revisión al cierre de
   §4nonies.3.
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
4. **El QR pendiente caduca a las 24 h** (`MINUTOS_QR_VENTA`), que es la
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

`admin/functions/src/cobroVenta.ts`; pruebas en `pruebas/cobro-venta.test.ts`
(el servidor) y `pruebas/demo-b-cobro.test.ts` (el flujo, escrita negando).
