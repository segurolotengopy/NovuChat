# Prepago, alta de clientes y flujo interno de cobro

**Escrito el 2026-09-07 (noche)**, a partir de los nueve pedidos de Andres tras
la reunión con Silvana y de los planes de `Presentación NovuChat4.html`.
Todo lo que se describe está **construido y probado en local** (compila,
445 pruebas en verde, saneo en cero). **Nada está desplegado ni probado con un
teléfono**: la sección 5 dice qué hace falta para que lo esté, y la 6 qué
conviene hacer el miércoles con los primeros clientes.

---

## 0. En una página

| Pedido | Qué hay |
|---|---|
| 1. Alta por consola con todos los datos, con mes de prueba | Pantalla **Negocios → Dar de alta un negocio**: nombre, identificador, razón social, NIT, dueño (nombre, teléfono, correo), flujos, administrador (se le crea la cuenta y se muestra el enlace para su contraseña), teléfonos de cobro, modalidad (**prueba / prepago / demostración**) y plan. El script `alta-comercio.mjs` hace lo mismo desde la terminal. |
| 2. Flujo propio REAL para cobrar prepago | `Flujos/novuchat-cobro-prepago.json`: el negocio le escribe al número de NovuChat, recibe un menú (renovar su plan, cambiar a otro, bolsa, saldo), elige, recibe el **QR real de NovuChat**, manda el comprobante, y NovuChat lo confirma en la consola. Sin agente de IA, a propósito (§2.4). |
| 3. Prepago por mes calendario, bolsas de 150 que no vencen | `admin/functions/src/prepago.ts`: planes de la presentación, consumo por conversación (la misma unidad que factura la consola), bolsas que se gastan después de las incluidas y se conservan entre meses. |
| 4. Corte el 1 sin pago, corte sin conversaciones, respuesta fija y cordial | `configuracionFlujo` e `ingesta` devuelven **409** con el mismo texto neutro que la suspensión. **Los tres flujos ya sabían qué hacer con un 409**: no hubo que tocarlos para cortar. |
| 5. Dos recordatorios antes de fin de mes, uno más cortado; dos por bolsa agotada | `recordatoriosDebidos()` decide; `Flujos/novuchat-recordatorios-prepago.json` manda plantillas dos veces por día y marca solo con el id de mensaje de Meta. Los textos dicen que sus clientes están escribiendo sin atención. |
| 6. Lista de lo que necesitamos para el flujo interno | §5. |
| 7. Qué necesita el prepago para funcionar bien | §4 y §7. |
| 8. Implementado con los primeros clientes | §6: qué es realista el miércoles y qué no. |
| 9. Modalidad prueba: sin mensualidad, bolsa de 20 | `modalidad: 'prueba'`, `periodoPrueba` = mes en curso, `bolsaPrueba: 20`. Al agotarla se corta; al terminar el mes sin elegir plan, se corta. |

**Lo que protege a los demos del 9 y 10:** una cuenta **sin modalidad** es
demostración y no se corta nunca. Los dos negocios de los demos no tienen
modalidad y no hay que ponérsela. Desplegar esto no les cambia nada.

---

## 1. El modelo, con lo que se decidió y lo que se supuso

### 1.1 Lo decidido con Silvana (y así está en el código)

- **Prepago por mes calendario.** El negocio paga el mes por adelantado y
  recibe las conversaciones **incluidas** de su plan para ese mes. Lo que no
  usó no se arrastra.
- **Tres planes**, los de la presentación: Base 250 Bs / 300, Crecimiento
  450 Bs / 1000, Corporativo 850 Bs / 2500. Están en un solo lugar
  (`PLANES`) y la consola los lee de ahí: no hay copia.
- **Bolsas de 150 conversaciones por 50 Bs.** No vencen y se aplican a todos
  los meses: se consumen recién cuando las incluidas del mes se acabaron.
- **Corte el 1 del mes si no está pagado**, y corte al agotar las
  conversaciones (incluidas + bolsas). Al cliente final le llega un mensaje
  fijo, cordial y **neutro**: no dice por qué.
- **Mes calendario de prueba**: sin mensualidad, con 20 conversaciones.
- **Recordatorios**: dos antes de fin de mes (a 7 y a 2 días), uno más el día
  del corte por falta de pago; por bolsa agotada, uno al cortar y otro a los
  dos días. Todos dicen que sus clientes están sin atención.
- **El plan por defecto al renovar es el que ya tiene.** La primera fila del
  menú es «Renovar Plan X».

### 1.2 Lo que se supuso, y conviene confirmar

| Supuesto | Por qué así | Alternativa |
|---|---|---|
| **La bolsa no sostiene el servicio sin mensualidad.** Un negocio con 140 conversaciones de bolsa y el mes sin pagar está cortado; la bolsa lo espera. | «Sin mensualidad no hay servicio»: la bolsa es un extra sobre un plan, no un plan. Si valiera sola, el plan Base de 250 Bs competiría con 50 Bs de bolsa. | Que la bolsa sostenga el servicio hasta agotarse. Es un cambio de dos líneas en `estadoDeServicio`. |
| **Las 20 de prueba se pierden al terminar la prueba** (al pagar o al cambiar de mes). | Son «de prueba»; arrastrarlas al plan pagado regala conversaciones al que nunca las usó. | Pasarlas a la bolsa al contratar. |
| **Un pago cubre el mes en curso si no está cubierto; si ya lo está, el siguiente.** El que paga el 3 de octubre cortado queda cubierto para octubre; el que paga el 25 de septiembre con septiembre pagado queda cubierto para octubre. | Nunca se cobra un mes que ya pasó ni se regala uno. | Prorrateo. No lo recomiendo: complica el mensaje comercial y la conciliación. |
| **Sin prorrateo en el alta.** Un negocio que arranca el 25 en prepago paga el mes entero. | Simplicidad. | **Recomendación:** que todo negocio que arranca después del 15 entre con el mes de prueba y pague desde el 1. Es lo que la consola ofrece por defecto (`prueba`). |
| **Cambiar de plan es pagar el plan nuevo**, y rige desde el mes que ese pago cubre. Las incluidas del mes en curso no cambian a mitad de mes. | Evita recalcular el consumo ya hecho contra un tope distinto. | Cambio inmediato con diferencia de precio. Complica. |
| **La conversación abierta se respeta.** Si un negocio se queda sin conversaciones, el cliente que está a mitad de un pedido (ventana de 24 h abierta) lo termina. Se corta ABRIR conversaciones nuevas. | Esa conversación ya se contó y ya se pagó. Cortar a la mitad sería cobrar sin prestar. Exige que los flujos manden `from` al pedir la configuración (hecho en el JSON; falta republicar). | Cortar en seco. |
| **Suspensión manual y corte prepago son independientes.** Una suspensión desde la consola pisa todo; reactivar la suspensión no paga nada. | Son palancas distintas: una comercial a mano, otra automática. | — |
| **Los pagos los confirma una persona.** El comprobante llega por WhatsApp, se reenvía al celular de NovuChat, y alguien lo confirma en la consola después de mirar el banco. | Prohibición 3, mitad de cobro real: una imagen se edita. El OCR (`cotejo.ts`, ya escrito) puede sugerir después; la confirmación sigue siendo humana. | OCR + cotejo automático como pre-aprobación. Después. |

### 1.3 El documento de la cuenta (`/tenants/{t}/cuenta/estado`)

| Campo | Qué es |
|---|---|
| `modalidad` | `demostracion` (sin cobro ni corte), `prueba`, `prepago`. **Sin este campo, es demostración.** |
| `plan` | `base`, `crecimiento`, `corporativo`. |
| `periodoPagado` | último mes pagado, `aaaa-mm`. Cubre ese mes y los anteriores. |
| `periodoPrueba` | el mes de prueba, `aaaa-mm`. |
| `bolsa` | conversaciones compradas sin usar. No vencen. |
| `bolsaPrueba` | conversaciones de prueba que quedan. Solo valen en el mes de prueba. |
| `corte` | `{ motivo, desde, perdidas }` mientras está cortado. `perdidas` son los mensajes de clientes que llegaron durante el corte. |
| `recordatorios` | `{ clave: { en, idMensaje } }`: qué aviso ya salió. Es lo que impide mandar dos veces. |
| `pagoPendienteId` | el pago que el negocio eligió por WhatsApp y del que se espera comprobante. |
| `estadoPago`, `montoMensual`, `moneda`, `proximoVencimiento` | **derivados**: los escribe el servidor a partir de lo de arriba. Nunca se editan sueltos. |

El consumo del mes no está acá: es `metricas/{aaaa-mm}.conversaciones`, la
misma cifra que la consola muestra y que la ingesta ya contaba. Disponibles =
máx(0, incluidas − consumidas) + bolsa (+ bolsaPrueba en el mes de prueba).

Y los pagos: `/tenants/{t}/pagos/{id}` con `tipo`, `plan`/`meses` o
`cantidad`, `monto`, `descripcion`, `estado` (`esperando_comprobante` →
`comprobante_recibido` → `confirmado` | `rechazado`), `canal`
(`whatsapp`/`panel`), `confirmadoPor`, `cubiertoHasta`. Nadie lo escribe desde
el navegador.

---

## 2. Qué se construyó, pieza por pieza

### 2.1 El núcleo puro: `admin/functions/src/prepago.ts`

Planes, períodos en hora de Bolivia, `estadoDeServicio()`,
`consumoDeConversacion()`, `aplicarPago()`, `recordatoriosDebidos()`, los
cuerpos de las tres plantillas y el resumen de cuenta. No importa Firebase.
**Lo usa el servidor para cortar y lo importa la consola para mostrar el
saldo**: un solo cálculo, dos lectores, y no puede haber dos saldos distintos.
45 pruebas mes por mes en `pruebas/prepago.test.ts`.

### 2.2 El corte: `ingesta.ts`

- `configuracionFlujo` lee la cuenta y el agregado del mes (dos lecturas más)
  y, si el servicio no está operativo, contesta **409** con
  `{ estado: 'sin_pago' | 'sin_conversaciones', mensajeCortesia }`. Es el
  mismo 409 de la suspensión y el mismo texto. **Los tres flujos ya lo
  manejaban** (`estado-comercio.test.ts`, 17 casos), así que cortan sin
  cambios.
- `ingesta` lee cuenta y métricas **dentro de la transacción** que ya leía la
  conversación. Si el mensaje se rechaza, materializa el corte y cuenta la
  pérdida. Si abre una conversación, descuenta la bolsa que corresponda y, si
  era la última, anota el corte para la siguiente. Dos mensajes simultáneos no
  pueden gastar la misma última conversación.
- La excepción de la ventana abierta exige `from` en el cuerpo de «Traer
  configuración». Está en el JSON de A y de B; **falta republicarlos**.

### 2.3 Lo que hace NovuChat desde la consola: `cuentas.ts`

`altaTenant` (extendida: ficha comercial, cuenta del administrador con enlace de
contraseña, cuenta prepago con su modalidad), `editarTenant`,
`configurarCuenta`, `registrarPago` (pago visto por fuera), `confirmarPago`
y `rechazarPago`. **El único acto que suma meses o bolsas es
`aplicarPagoEnCuenta`**, al que se llega por `registrarPago` o
`confirmarPago`, los dos con rol de propietario y auditados.

### 2.4 El flujo interno: `cobroTextos.ts`, `cobroPrepago.ts` y el JSON

- `cobroPrepago` (endpoint para n8n, autenticado con el secreto del **número
  de NovuChat** y exigiendo `flujo: 'interno'`): resuelve quién escribe por el
  teléfono (`tenants.telefonosCobro`), decide con `decidirRespuesta()` (puro,
  23 pruebas) y aplica los efectos. Devuelve texto, menú, ficha del QR y aviso
  ya armados.
- **Sin agente de IA, a propósito.** Son cuatro opciones fijas con precio fijo
  y hay dinero de por medio. Un menú no se equivoca de monto ni inventa un
  descuento; un modelo puede. «Muy similar a B» en la estructura —trigger,
  filtro, config base, normalización, lista interactiva, QR, comprobante,
  aviso al dueño—, sin el agente. Si más adelante hace falta contestar
  preguntas libres, se agrega un agente SOLO para el texto libre.
- El flujo de n8n es transporte: 15 nodos, la lógica en un solo nodo Code
  (`Despachar respuesta`) probado desde el JSON. Ante cualquier error del
  servidor manda el texto de error temporal y **nada de menú ni QR**.
- El QR es el **real de NovuChat**: se registra como cobro real del negocio
  `novuchat` con la misma pantalla que usan los comercios, se dibuja desde el
  texto validado y se envía por su ficha. Sin rótulos de simulacro, porque no
  es un simulacro. Y el asistente **nunca** dice «pago acreditado»: dice que
  recibió el comprobante y que lo revisa el equipo.

### 2.5 Recordatorios: `recordatoriosPrepago`, `marcarRecordatorioPrepago` y el JSON

El endpoint recorre los negocios activos, materializa el corte si nadie lo anotó
(el 1 del mes a las 09:00 antes de que escriba ningún cliente), y devuelve los
avisos debidos que no se mandaron. El flujo corre a las 09:00 y a las 17:00,
manda la plantilla y marca **solo con el identificador de mensaje de Meta**:
un envío fallido no se marca y vuelve a salir en la corrida siguiente. Es la
lección del recordatorio de citas del 06/09.

### 2.6 La consola

- **Negocios**: columna «Servicio» con el mismo cálculo con el que el servidor
  corta, «Disponibles», y enlaces a «Cuenta» y «Consumo». Botón «Dar de alta».
- **Dar de alta un negocio**: el formulario completo y, al terminar, el enlace
  de contraseña (se muestra una vez, no se guarda) y los pasos que siguen.
- **Cuenta (NovuChat)**: servicio, ficha comercial editable, **pagos por
  confirmar** con Confirmar/Rechazar, registrar un pago visto por fuera, y
  fijar plan, modalidad y saldos a mano.
- **Estado de cuenta (comercio)**: situación, conversaciones disponibles /
  usadas / incluidas / de bolsa, plan, hasta cuándo, **cómo pagar** (escribir
  *pagar* al WhatsApp de NovuChat desde su número de cobro) y sus pagos. Se ve
  también cortado: un corte sin explicación es un reclamo garantizado.
- **Tablero del comercio**: la tarjeta «Cuenta» muestra el saldo real.

### 2.7 Reglas, scripts y pruebas

- `firestore.rules`: `/pagos` (lee el admin del comercio y NovuChat; nadie
  escribe desde el navegador) y tres tipos nuevos de bitácora
  (`corte_servicio`, `reanudacion_servicio`, `pago_registrado`). 8 pruebas.
- `scripts/alta-comercio.mjs` (extendido), `scripts/asignar-numero.mjs`
  (número + flujo + alias, que la consola no hace) y
  `scripts/activar-cobro-novuchat.mjs` (ficha `novuchat` y encendido del QR).
- Suite: **445 pruebas** (92 nuevas): 223 de reglas, 45 de prepago, 23 del
  cobro, 16 de los flujos internos, y las de siempre.

---

## 3. Cómo se ve, de punta a punta

```
                         ┌── mes de prueba (20 conv.) ──┐
alta (consola/script) ──►│ o prepago con el mes pagado  │
                         └──────────────┬───────────────┘
                                        ▼
        cliente final escribe ──► configuracionFlujo ──► 200: se atiende
                                        │                 (ingesta cuenta la
                                        │                  conversación y gasta
                                        │                  bolsa si toca)
                                        └──► 409 sin_pago / sin_conversaciones
                                             ──► el flujo manda el aviso neutro
                                                 y anota la pérdida

  −7 y −2 días ──► plantilla «vence el 30, tus clientes quedarán sin atención»
  día 1 sin pago ──► corte + plantilla «detenido desde el 1, X mensajes sin atención»
  bolsa agotada ──► corte + plantilla al momento y otra a los 2 días

  el negocio escribe «pagar» al WhatsApp de NovuChat
        ──► menú: Renovar Plan X · cambiar a Y/Z · Bolsa 150 · Ver saldo
        ──► elige ──► pago «esperando comprobante» + QR de NovuChat
        ──► manda la foto ──► «comprobante recibido» + aviso y foto al celular de NovuChat
  NovuChat mira el banco ──► Confirmar en la consola ──► meses/bolsa sumados,
        corte levantado, servicio reanudado al instante (no hay caché)
```

---

## 4. Qué necesita el prepago para funcionar bien (pedido 7)

**Lo que ya está resuelto por construcción:**

- **Una sola unidad y una sola cifra.** La conversación es la misma que
  factura la consola (`ingesta.ts`, ventana de 24 h, cortesías excluidas). No
  se inventó otro contador: el corte usa el número que el cliente ve.
- **Un solo cálculo.** Servidor y consola importan el mismo módulo.
- **El corte no depende de los flujos.** Es un 409 que ya manejaban.
- **La reanudación es inmediata.** n8n no cachea la configuración; confirmar
  un pago reanuda al siguiente mensaje.
- **Idempotencia.** Un pago se confirma una vez (el documento guarda su
  estado); un recordatorio sale una vez (clave en `recordatorios`).
- **Los demos no se tocan.** Sin modalidad no hay prepago.

**Lo que hay que atender para que funcione en la práctica:**

1. **Quién confirma los pagos y cuándo.** Un comprobante que llega un sábado a
   la noche deja al negocio cortado hasta que alguien lo mire. Hace falta un
   acuerdo de horario (por ejemplo: se confirma dentro de las dos horas entre
   09:00 y 21:00) y que Silvana y Andres puedan confirmar los dos. El rol
   «contador» de la lista de pendientes encaja acá: alguien que registra, y el
   superadministrador confirma.
2. **El número de WhatsApp de NovuChat** (§5.1). Sin él no hay flujo de cobro
   ni recordatorios; la consola muestra todo y los pagos se registran a mano.
3. **Las plantillas aprobadas por Meta** (§5.4). Sin ellas no hay
   recordatorios fuera de la ventana de 24 h.
4. **El teléfono de cobro cargado en cada negocio.** Es lo que identifica
   quién escribe y a quién se le recuerda. Si falta, el negocio no puede pagar
   por WhatsApp y el endpoint de recordatorios lo lista en `sinTelefono`.
5. **Republicar A y B con el `from`**, para que la conversación abierta se
   respete al agotar conversaciones. Sin eso, el corte es en seco (funciona,
   pero corta a la mitad al último cliente).
6. **Avisar al negocio cuando el pago se confirma.** Hoy lo ve en su consola y
   en que el asistente vuelve a responder. Conviene una cuarta plantilla
   (`nc_pago_confirmado`) que le diga «listo, cubierto hasta el 31/10». Es
   media hora de trabajo cuando el número exista.
7. **Aviso a NovuChat del corte.** Hoy el corte avisa al negocio. Conviene que
   el flujo de recordatorios mande también un resumen al celular de NovuChat
   («hoy se cortaron 2, vencen 3»), para llamar antes de que el cliente se
   enoje. Trivial de agregar al flujo.
8. **Vigencia del QR de NovuChat.** Un QR vencido deja a todos sin poder
   pagar. `activar-cobro-novuchat.mjs` se niega a encender uno vencido, y la
   consola avisa a seis meses, pero alguien tiene que renovarlo. Pedir al
   banco el QR de comercio con la vigencia más larga posible.
9. **El secreto del número interno es el más sensible del sistema.** Con él se
   puede marcar recordatorios de cualquier negocio y crear pagos en curso (no
   confirmarlos: eso exige sesión de propietario). Vive solo en Secret Manager
   y en la credencial de n8n, como los demás.
10. **Facturas.** El prepago cobra, pero no emite factura. Queda para la etapa
    de contabilidad (`ESTADO.md`, rol contador).

---

## 5. Lo que necesitamos para el flujo interno (pedido 6)

En orden. Los primeros tres son trámites con terceros y son los que mandan en
el calendario.

### 5.1 Un número de WhatsApp propio de NovuChat en la Cloud API

- **Un número real** (el +591 77182022 de la presentación, o uno nuevo), no un
  número de prueba: los de prueba solo responden a 5 destinatarios
  (prohibición 6) y el flujo de cobro tiene que responderle a cualquier
  cliente.
- **Con su propia app de Meta y su propio webhook.** Una app tiene UNA URL de
  webhook, y todos los números suscritos a la app entregan ahí. Hoy cada demo
  tiene su app; el número interno necesita la suya (`NovuChat-Interno`) o el
  enrutador por `phone_number_id` que está anotado como pendiente. La app
  nueva: publicada, con `subscribed_apps` hecho por API (hallazgo 2) y
  `messages` suscrito.
- **Alias de secreto: `cliente20`**, reservado para el número interno. Así no
  hay que declarar un secreto nuevo ni desplegar por eso. Queda documentado que
  la capacidad de clientes baja a 19 hasta ampliar la reserva.
- Comando: `node admin/scripts/asignar-numero.mjs --proyecto <id> --tenant
  novuchat --phone-number-id <id> --waba-id <id> --flujo interno --alias
  cliente20 --aplicar`.

### 5.2 El negocio `novuchat` y su QR

1. `node admin/scripts/alta-comercio.mjs --proyecto <id> --tenant novuchat
   --nombre NovuChat --flujos venta,interno --admin cobros@... --modalidad
   demostracion --aplicar` (el administrador entra con contraseña; los
   superadministradores entran con Google y no pueden ser admin de un negocio).
2. Entrar como ese administrador a **Pedidos y cobro** y registrar el **QR de
   comercio** de NovuChat: reutilizable, monto abierto, vigencia larga, a
   nombre de la cuenta de NovuChat.
3. `node admin/scripts/activar-cobro-novuchat.mjs --proyecto <id> --aplicar`.

### 5.3 Credenciales y flujos en n8n

- Credencial **WhatsApp API** con el token del sistema que alcance al número
  interno; credencial **WhatsApp Trigger** con el App Secret de la app nueva;
  credencial **Header Auth** «Cobro NovuChat interno (auto)» con el valor de
  `INGESTA_CLIENTE20` (`gcloud secrets versions access latest
  --secret=INGESTA_CLIENTE20`).
- Importar `Flujos/novuchat-cobro-prepago.json` y
  `Flujos/novuchat-recordatorios-prepago.json`; en `Config base` reponer
  `REEMPLAZAR_PHONE_NUMBER_ID_NOVUCHAT` y
  `REEMPLAZAR_NUMERO_ADMIN_NOVUCHAT_SIN_+` (el celular al que llegan los
  comprobantes); elegir **Messages** en el trigger (hallazgo 10); publicar.
- Apuntar el webhook de la app nueva al trigger del flujo de cobro (URL de
  producción).
- Republicar A y B (`publicar-flujo.sh --aplicar`) para el `from`.

### 5.4 Tres plantillas en Meta (categoría Utilidad, idioma `es`)

| Nombre | Variables | Cuerpo |
|---|---|---|
| `nc_renovacion_pendiente` | negocio, plan, fecha, monto | Hola, te escribe NovuChat 👋 El servicio de {{1}} ({{2}}) vence el {{3}}. Si no renuevas antes del día 1, tu asistente deja de responder y tus clientes van a escribir sin recibir atención. Renovar cuesta Bs {{4}}: responde *pagar* y te mando el QR. |
| `nc_servicio_cortado` | negocio, fecha, perdidas | Hola, te escribe NovuChat. El asistente de {{1}} está detenido desde el {{2}} porque el mes no está pagado. Desde entonces {{3}} mensajes de tus clientes quedaron sin atención. Responde *pagar* y lo reactivamos hoy mismo. |
| `nc_sin_conversaciones` | negocio, plan, perdidas, precioBolsa | Hola, te escribe NovuChat. {{1}} agotó las conversaciones de su {{2}} y el asistente dejó de responder: {{3}} mensajes de tus clientes quedaron sin atención. Responde *bolsa* para sumar 150 conversaciones por Bs {{4}} y seguir atendiendo. |

Los cuerpos son los de `PLANTILLAS` en `prepago.ts` (hay una prueba que
verifica que digan «sin atención» y no voseen). La aprobación de Meta tarda de
horas a días. Hasta entonces, el flujo de recordatorios corre y falla el envío
(queda sin marcar, se reintenta); la consola muestra el estado igual.

### 5.5 Desplegar

`firebase deploy --only functions,firestore:rules,hosting` desde `admin/`
(las Functions nuevas: `registrarPago`, `confirmarPago`, `rechazarPago`,
`configurarCuenta`, `editarTenant`, `cobroPrepago`, `recordatoriosPrepago`,
`marcarRecordatorioPrepago`; `altaTenant` cambia; `ingesta` y
`configuracionFlujo` cambian). Ver §6 para el **cuándo**.

### 5.6 La prueba real, antes del primer cobro a un cliente

Con un negocio de prueba cuyo teléfono de cobro sea el celular de Andres:
escribir «hola» → menú; «pagar» → QR; mandar una captura → «comprobante
recibido» + aviso y foto al celular de NovuChat; confirmar en la consola →
«Operativo». Después: configurarlo cortado (`periodoPagado` vacío) → el número
del negocio contesta el aviso neutro; confirmar un pago → vuelve a atender.
Y una corrida manual del flujo de recordatorios con una plantilla aprobada.

---

## 6. Qué hacer el miércoles con los primeros clientes (pedido 8)

**Lo que sí se puede el 9:** dar de alta a cada cliente con **mes de prueba**
(septiembre), con su administrador, su enlace de contraseña, sus teléfonos de
cobro y su plan propuesto; que carguen catálogo y configuración; que tengan su
consola. Todo eso funciona **con o sin** las Functions nuevas desplegadas:
`alta-comercio.mjs` escribe la cuenta con su modalidad, y si el servidor viejo
todavía corre, simplemente no la lee (no corta, no cobra). El prepago empieza a
regir cuando se despliegue, y **el primer corte posible es el 1 de octubre**:
hay tres semanas de margen.

**Lo que no depende de nosotros el 9:** el número de WhatsApp de cada cliente
(trámite Meta, días) y el número interno de NovuChat (§5.1). Sin el interno, los
pagos se registran a mano en la consola («Registrar un pago visto por fuera») y
los avisos los manda una persona. Es un camino completo, no un parche.

**Cuándo desplegar.** El congelamiento del 8 dice «no tocar nada más», y tiene
razón: se desplegaron funciones y reglas el 6 y el 7. Mi recomendación:

1. **No desplegar antes de los demos.** El código no afecta a los demos, pero
   un despliegue de Functions la víspera es un riesgo que no compra nada: el
   corte recién importa el 1 de octubre.
2. **Miércoles 9:** altas con `alta-comercio.mjs` (o con la consola, si se
   decide desplegar solo Hosting, que es lo más inocuo).
3. **Jueves 10 a la noche o viernes 11:** desplegar todo, correr §5.6 con el
   negocio de prueba, y republicar A y B.
4. **Semana del 14:** número interno, QR, plantillas, flujos en n8n.

**Para cada cliente del 9, a mano y en este orden:**

```bash
cd admin && pnpm functions:build
node scripts/alta-comercio.mjs --proyecto <id> \
  --tenant <id-del-negocio> --nombre "<Nombre>" --flujos agendamiento \
  --admin <correo> --nombre-admin "<Nombre>" \
  --modalidad prueba --plan base \
  --telefonos-cobro 591XXXXXXXX --dueno "<Nombre>" --telefono-dueno 591XXXXXXXX \
  --razon-social "<Razón social>" --nit <NIT> --aplicar
#   → copiar el enlace de contraseña y mandárselo al administrador
gcloud secrets versions access latest --secret=INGESTA_CLIENTE01 --project <id>
#   → credencial de cabecera en n8n
node scripts/asignar-numero.mjs --proyecto <id> --tenant <id-del-negocio> \
  --phone-number-id <id> --waba-id <id> --flujo agendamiento --alias cliente01 --aplicar
#   (cuando Meta entregue el número)
```

---

## 7. Lo que queda afuera, dicho con todas las letras

- **Nada probado con un teléfono.** Los flujos internos se importan y se
  prueban cuando exista el número (§5.1). Las pruebas ejecutan el código de
  los nodos desde el JSON, no a n8n.
- **OCR del comprobante:** no. La confirmación es humana, y está bien que lo
  sea al principio. `cotejo.ts` queda para sugerir después.
- **Aviso de pago confirmado al negocio** (plantilla cuarta) y **resumen
  diario a NovuChat**: pendientes, triviales cuando haya número.
- **Prorrateo, facturas, descuentos por pago adelantado, rol contador:**
  no. El menú cobra un mes por vez; varios meses se registran desde la consola.
- **Enrutador de número compartido:** sigue pendiente. El número interno
  necesita su app.
- **`sembrar.mjs`** (emulador) no siembra cuentas prepago; las pruebas de
  reglas sí siembran un pago por comercio.
