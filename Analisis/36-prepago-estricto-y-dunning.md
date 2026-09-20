# Prepago estricto: pagar por consola, por el WhatsApp de NovuChat o por un superadministrador, con el cobro sobre ManejoQRSimple

> **Escrito el 17/09 contra una base que ya cambió; revisar antes de construir
> (nota del 20/09/2026).** Desde entonces salió **`v0.6.0` a producción
> (19/09)** con la seña, los medios, los seguimientos, Maps y el candado: todo
> `Analisis/30` a `34` está construido y publicado. Cuatro cosas de este
> documento hay que cotejarlas con `main` antes de escribir una línea:
>
> 1. **La transacción de la ingesta ya se volvió a abrir** (seña y
>    seguimientos). El §7 supone que el prepago es quien la abre; ya no lo es,
>    y la reaplicación del módulo es sobre una ingesta distinta.
> 2. **Ya hay maquinaria de QR en producción** —`qrSimple.ts`, `dibujoQr.ts`,
>    `cotejo.ts`, `firma.ts`— que el prepago debe **reutilizar** en vez de
>    rehacer.
> 3. **`cobro.ts` NO es esto.** Ese es el QR **del comercio cobrándole a su
>    cliente**, donde NovuChat no toca la plata. El prepago es **NovuChat
>    cobrándole al comercio**: otra dirección del dinero, otras credenciales,
>    otras pantallas. Compartirlas sería el peor error posible de este frente.
> 4. **`seguimientos.ts` ya existe** para los recordatorios de leads: los de
>    cobranza del §3 deberían salir de ahí y no de una pieza nueva.
>
> Lo que **no** cambia: el modelo de prepago (§2), el calendario de cobranza
> (§3), los tres caminos de pago (§4) y la economía (§5), que no dependen de
> nada de lo anterior.

**17-sep-2026.** Análisis financiero y comercial pedido por Andres. **Solo
análisis; ningún desarrollo.** Objetivo: que el cobro de NovuChat sea prepago
estricto —el cliente paga por adelantado, por uno o varios meses— con tres
formas de pagar: **autoatención por la consola**, **autoatención por el
WhatsApp interno de NovuChat**, y **carga manual por un superadministrador**
de un pago hecho en efectivo o por transferencia. Vale para los comercios en
un plan; **no para los que están en PRUEBA** ni para los de demostración. Las
reglas de corte son las del documento «Dunning de NovuChat» que adjuntó
Andres. La base de cobro es **ManejoQRSimple**, que ya cobra por QR Simple
contra la API oficial de Banco Económico.

Fuentes leídas: `CLAUDE.md` (Base comercial §3), `admin/DISENO.md` §4ter.2
(estado de cuenta), la rama `integracion/prepago-sobre-flujos-vivos`
(`functions/src/prepago.ts`, bloqueada desde el 08/09), `Analisis/29` (fases
1 y 2 de la pantalla del propietario), y de ManejoQRSimple —solo como
referencia— `CLAUDE.md`, `docs/ESTADO.md`, `docs/01-arquitectura.md` y
`docs/Integraciones/baneco/02-hallazgos-produccion.md`.

---

## 0. Conclusión

| | |
|---|---|
| **¿Se puede?** | Sí, y **más de lo que parece ya está hecho**: la rama del prepago tiene el módulo puro que decide si un mes está cubierto, aplica un pago de **N meses** o de bolsas, y calcula los recordatorios; ManejoQRSimple ya emite QR de un solo uso con monto y vencimiento y **confirma el pago contra el banco en ~45 s**, probado con plata real el 13/09 y con varias cuentas de cobro desde el 16/09 |
| **Qué es el cobro** | NovuChat es **un comerciante más de ManejoQRSimple** (una cuenta de cobro con alias `novuchat`): pide un cobro, muestra el QR, y espera la confirmación del satélite. **El comprobante nunca confirma; el banco sí.** Por eso acá, y solo acá, la consola puede decir «pago confirmado por el banco» |
| **Las reglas de corte** | Las del documento, con dos correcciones: (1) **la presión no es que recepción reciba los mensajes en su celular** —con la Cloud API el número no está en ningún teléfono—, es que **el comercio ve en su consola cuántos clientes escribieron y no fueron atendidos**; (2) el mensaje al cliente final **no dice «mantenimiento preventivo»**, que es falso: dice, como ya está escrito, que por este medio no se lo puede atender y que se comunique con el negocio, y suma el teléfono del negocio |
| **Varios meses** | Sí: hasta **6 meses**, sin descuento de precio, con el importe en Bs fijado al TCO del día en que se emite el cobro. El beneficio para el cliente es la certeza cambiaria; el costo para NovuChat es acotado (2 a 7 % del importe si el boliviano se deprecia 1–2 % mensual). Doce meses no: la cláusula de revisión por tarifa de Meta es trimestral |
| **Cuánto cuesta cobrar** | **Siete centavos de dólar por cliente y por mes**, y nada más: son las cuatro plantillas de recordatorio más los dos mensajes del QR y su confirmación. **El cobro por QR no tiene comisión bancaria** (Andres, 17/09/2026: el servicio del banco es gratuito). Contra lo manual —transferencia, comprobante, una persona que revisa—, que a 100 clientes son **unas 17 horas al mes** |
| **Esfuerzo** | **10 a 12 jornadas**: 7 a 9 en NovuChat (reaplicar la rama del prepago, integrar, consola, WhatsApp interno, carga manual, cobranza) y 2 a 3 en ManejoQRSimple (pase a producción, API para consumidores, aviso firmado de confirmación) |

---

## 1. Lo que ya existe, y lo que decide

### 1.1 En NovuChat: el módulo del prepago (rama bloqueada el 08/09)

`prepago.ts` es puro —sin Firebase— y lo importan el servidor y la consola
para que nunca calculen dos saldos distintos. Decide con cuatro frases: el
cliente paga el mes calendario por adelantado; compra bolsas que no vencen;
si el 1 del mes no está pagado o se acabaron las conversaciones, se corta con
un mensaje fijo y neutro; un mes de prueba con 20 conversaciones. Lo que
importa acá:

| Ya está | Dónde | Comentario |
|---|---|---|
| `periodoPagado` (`aaaa-mm`): último mes cubierto | `cuenta/estado` | **Un pago de N meses ya existe**: `aplicarPago({ tipo: 'mensualidad', meses: N })` suma N al último mes cubierto. El prepago de varios meses no es un desarrollo: es una decisión |
| Modalidades `demostracion` / `prueba` / `prepago` | `prepago.ts` | Sin modalidad = demostración = se atiende siempre. Pagar una mensualidad convierte la cuenta en `prepago` |
| Corte `sin_pago` / `sin_conversaciones`, con `perdidas` | `cuenta/estado.corte` | `perdidas` cuenta los mensajes de clientes finales que llegaron durante el corte: **es la cifra de presión honesta** (§3) |
| Recordatorios por plantilla desde el número de NovuChat, idempotentes | `recordatoriosDebidos` | Hoy: 7 y 2 días antes del fin de mes, aviso el día del corte, segundo aviso a los 2 días. **Hay que cambiarlos a los del documento** (§3) |
| TCO mensual fijo en `plataforma/tipoCambio`; `importeBs` redondea al boliviano y **lanza sin TCO válido** | `prepago.ts` | El QR necesita un importe en Bs: acá se decide el TCO (§4) |
| `MENSAJE_CORTESIA` al cliente final, neutro, sin mencionar pagos | `prepago.ts`, DISENO T-18 | Es el «modo mantenimiento» del documento, ya escrito y ya honesto |
| `pagoPendienteId` | `cuenta/estado` | Un cobro emitido y no confirmado. Encaja con el cobro de ManejoQRSimple |
| `actualizarEstadoCuenta` (propietario), `suspenderTenant` / `reactivarTenant` con auditoría | `index.ts` | La carga manual de un pago se apoya en esto |

Lo que **no** existe: la colección de pagos con su TCO (fase 2 de
`Analisis/29`), la conexión con un cobrador, la pantalla «Pagar», y el
corte con período de gracia (hoy corta el 1).

### 1.2 En ManejoQRSimple: el cobro contra el banco

| Ya está | Evidencia |
|---|---|
| QR Simple interoperable emitido por la API oficial de Banco Económico, **de un solo uso**, con monto en centavos y vencimiento; anulable | Pruebas P1–P8 en producción con plata propia, 13/09/2026 |
| **Confirmación por consulta autenticada al banco** (`statusQR` / `paidQR`) desde un satélite; el webhook del banco y el comprobante del cliente **solo disparan la verificación, nunca confirman** | Regla 1 y BANECO-1; P2 confirmó en 41 s, P3 desde otro banco (BNB) en 48 s |
| Máquina de estados (`ENVIADO` → `PAGO_DETECTADO` → `CONFIRMADO`; `VENCIDO` → renovación versionada; `EN_REVISION`), evidencia por cobro, cierre diario conciliado | `qr-core`, P9 |
| **Varias cuentas de cobro**, cada una con alias, credenciales y datos | ESTADO 16/09/2026 |
| API HTTP y consola del comerciante (demo), Firestore como estado | `packages/functions`, `demo-web` |

Lo que **falta** ahí, y no es de NovuChat: el pase a producción formal
(la cuenta de pruebas del banco, A4; la comisión por abono, C9, **ya
respondida: no hay comisión**), y un
**contrato para consumidores**: hoy la API es la del demo. Para NovuChat hace
falta `crearCobro` con referencia externa y un **aviso firmado** cuando el
cobro pasa a `CONFIRMADO`. El envío del QR por WhatsApp que ManejoQRSimple
delega en otro proyecto **no se usa**: NovuChat manda el QR desde su propio
número.

**Decisión de integración.** Dos formas, y conviene la primera:

| | A. NovuChat como comerciante de ManejoQRSimple (servicio) | B. NovuChat importa `qr-core` + `baneco-gateway` y corre su propio satélite |
|---|---|---|
| Credenciales del banco | Quedan en ManejoQRSimple, donde ya están protegidas | Se duplican en NovuChat |
| Cambios de banco o de proveedor | Los absorbe ManejoQRSimple, detrás de sus puertos | Cada consumidor los absorbe |
| Acoplamiento | Por API: `crearCobro`, `estadoCobro`, `anularCobro`, aviso de confirmación | Por código: versiones de paquetes |
| Qué falta | El contrato para consumidores (2–3 jornadas en ManejoQRSimple) | Poco, pero rompe la regla «nada fuera de `baneco-gateway` conoce la API» |

**A.** Es, además, lo que ManejoQRSimple dice de sí mismo: un sistema de
cobros que otros productos usan por puertos. NovuChat es su primer cliente
de verdad. Y hace que el módulo sirva igual a cualquier proyecto que cobre
(el registro `~/Claude-Proyectos/proyectos/manejoqrsimple.md` lo anota).

---

## 2. El modelo de prepago estricto

### 2.1 Estados de una cuenta, y quién puede pagar

| Estado | Qué significa | ¿Se cobra? | ¿Puede pagar? |
|---|---|---|---|
| `demostracion` | Los negocios de demo de NovuChat | No | No |
| `prueba` | Mes calendario de prueba, 20 conversaciones | No: **sin recordatorios de cobro**, como pide Andres | **Sí, para pasar a un plan**: pagar es la conversión. El único aviso en prueba es «tu prueba termina el día X; elige un plan», que es conversión, no cobranza |
| `prepago` cubierto | `periodoPagado` ≥ mes actual | Recordatorios D-5 y D-1 antes del vencimiento | Sí: renovar, adelantar meses, comprar bolsas |
| `prepago` en gracia | Venció el último mes cubierto; 48 h de gracia | D0 | Sí |
| `prepago` cortado (`sin_pago`) | Pasó la gracia; el asistente responde el mensaje neutro | D+2 y un segundo aviso a los 2 días | Sí, y **se reactiva solo** al confirmar el banco |
| `prepago` cortado (`sin_conversaciones`) | Se acabaron incluidas y bolsas | Aviso inmediato con QR de bolsa | Sí: bolsa o cambio de plan |
| `suspendido` (manual) | Decisión de NovuChat, no de pago | — | Reactiva NovuChat |

**La regla del prepago estricto en una frase:** *ningún mes se atiende sin
estar pagado, salvo las 48 horas de gracia, y ningún pago se acredita sin que
el banco lo confirme o un superadministrador lo cargue con evidencia.*

### 2.2 Varios meses por adelantado

`aplicarPago` ya suma N meses. Lo que hay que decidir es comercial:

| Pregunta | Recomendación | Por qué |
|---|---|---|
| ¿Descuento por pagar varios meses? | **No en el precio.** Hasta 6 meses al mismo precio; a partir de 6, **una bolsa de 30 conversaciones de regalo** | Una bolsa cuesta a NovuChat como máximo 5 USD y vale 10 para el cliente; un 5 % de descuento sobre 6 meses de Corporativo son 27 USD. El regalo en especie es más barato y se vende igual |
| ¿Tope de meses? | **6** | La cláusula del contrato revisa el precio cuando Meta cambia la tarifa, y Meta puede cambiarla cada trimestre (`Analisis/14`). Doce meses prepagados a precio fijo es tomar el riesgo de Meta por cuenta propia |
| ¿En qué moneda queda fijado? | **En bolivianos, al TCO del día en que se emite el cobro**, y ese TCO se guarda en el pago | Es lo que un QR necesita (un importe fijo) y resuelve la pregunta abierta en `Analisis/14` §5ter: ni «día de pago» ni «primer día hábil»: **día de emisión del cobro**, con el QR válido pocos días |
| ¿Quién carga el riesgo cambiario? | NovuChat | Es chico y acotado: |

| Plan | 3 meses, 1 %/mes | 3 meses, 2 %/mes | 6 meses, 1 %/mes | 6 meses, 2 %/mes |
|---|---|---|---|---|
| Base (25) | 1,5 USD (2 %) | 2,9 (3,9 %) | 5,1 (3,4 %) | 10,0 (6,6 %) |
| Crecimiento (50) | 3,0 | 5,8 | 10,2 | 19,9 |
| Corporativo (90) | 5,3 | 10,5 | 18,4 | 35,9 |

Pérdida en USD si el boliviano se deprecia 1 o 2 % por mes durante el
período prepagado. **A 12 meses sube al 12 %**: otra razón para el tope de 6.
Y el valor que compra el cliente con el prepago es exactamente ese: **sabe
cuánto paga en bolivianos**, que para una PyME vale más que el descuento.

### 2.3 Bolsas y cambio de plan

- **Bolsa**: mismo cobro, `tipo: 'bolsa'`, N bolsas; no vence; se aplica al
  confirmar. Es lo que el aviso de `sin_conversaciones` ofrece con QR.
- **Subir de plan a mitad de mes**: se cobra la diferencia prorrateada por
  días restantes, redondeada al boliviano, y el nuevo plan rige al confirmar.
  Bajar de plan: desde el mes siguiente, sin devolución. Son dos funciones
  puras más en `prepago.ts`, con prueba.
- **Alta a mitad de mes**: no hace falta prorratear la primera mensualidad,
  porque **el mes de prueba ya cubre el mes parcial**. Si un comercio entra
  sin prueba, se le regala el resto del mes: es más barato que explicar un
  prorrateo.

---

## 3. La cobranza (dunning), adaptada a NovuChat

### 3.1 El calendario, comparado

| Momento | Documento de Andres | Rama del prepago hoy | **Recomendación** | Mensaje |
|---|---|---|---|---|
| D-5 | Recordatorio amigable con QR | D-7 | **D-5, con el QR en la plantilla** (encabezado de imagen) | «Tu mensualidad de NovuChat vence el [fecha]. Este QR la renueva: Bs [importe] ([plan], [N] meses).» |
| D-1 | Alerta de vencimiento | D-2 | **D-1** | «Mañana vence tu mensualidad. Con el QR de arriba tu asistente sigue atendiendo sin cortes.» |
| D0 | Vencida; 48 h de gracia | Corte el día 1 | **D0: vencida, 48 h de gracia, el servicio sigue** | «Tu mensualidad venció hoy. Tienes 48 horas para pagar antes de que el asistente deje de atender.» |
| D+2 | Corte | Segundo aviso | **D+2 00:00 Bolivia: corte** | «Tu asistente dejó de atender a tus clientes. Al pagar se reactiva solo, en menos de dos minutos.» |
| D+4 | — | — | Segundo aviso de corte, con `perdidas` | «Desde el corte, [N] clientes te escribieron y no fueron atendidos. Este QR lo reactiva.» |
| D+30 | — | — | Baja comercial (no técnica): la cuenta pasa a `suspendido` y se archiva la relación; los datos se conservan según retención | Correo, no WhatsApp |

**Costo de la cobranza por cliente y por mes:** cuatro plantillas de utilidad
× 0,0113 = **0,045 USD**; con los dos avisos de corte, 0,07. La plantilla con
imagen cuesta lo mismo. A 100 clientes, **7 USD al mes**. El período de
gracia cuesta, como máximo, dos días de servicio de un cliente que después
no paga: 2/30 del costo mensual de ese cliente, entre 0,10 y 3 USD.

### 3.2 Dos correcciones al documento, y una regla que ya existe

1. **La presión operativa no es la que dice el documento.** Con la Cloud API
   de Meta el número del comercio **no está en ningún celular**: cuando el
   asistente se apaga, nadie recibe los mensajes en un teléfono. La presión
   real, y es más fuerte, es **visible en la consola**: el comercio suspendido
   sigue viendo sus conversaciones (`tenantLegible`, DISENO §4ter.2) y el
   estado de cuenta le muestra `corte.perdidas`: «12 clientes te escribieron
   desde el corte y nadie les respondió». Ese número es el que hace pagar.
2. **«Mantenimiento preventivo» es falso, y no se dice.** El proyecto tiene
   una regla para el cliente final —jamás mencionar pagos (T-18)— y otra más
   general —nunca presentar algo como lo que no es—. El texto que ya existe
   cumple las dos: *«Gracias por escribirnos. En este momento no podemos
   atenderle por este medio. Le pedimos comunicarse directamente con el
   negocio.»* Se le agrega **el teléfono de recepción del comercio**, que
   ayuda al cliente final y le recuerda al comercio que ahora atiende él.
3. **La reactivación es automática e inmediata.** Al confirmar el banco
   (~45 s) la cuenta vuelve a `operativo`; el flujo lo ve en el próximo
   `configuracionFlujo` (TTL de caché de 60 s). «Se reactiva solo en menos de
   dos minutos» es una promesa que el sistema cumple, y es el argumento para
   que el comercio pague con el QR y no llame.

### 3.3 Sin conversaciones: es otro corte, con otro tono

Quedarse sin conversaciones no es morosidad: es éxito. El aviso sale en el
momento, con el QR de una bolsa y la opción de subir de plan, y el corte
también se levanta solo al confirmar. El aviso del 80 % (ya en `main`) es el
D-5 de este caso.

---

## 4. Los tres caminos de pago

### 4.1 Autoatención por la consola

1. En «Estado de cuenta», el botón **Pagar**: elegir plan, meses (1 a 6) y
   bolsas; ver el importe en USD y en Bs con el TCO del día y su fuente.
2. NovuChat pide el cobro a ManejoQRSimple (`crearCobro`: importe en
   centavos, vencimiento 72 h, referencia `tenant/periodo/pagoId`, cuenta
   `novuchat`), guarda `/tenants/{t}/pagos/{pagoId}` en `pendiente` con el
   TCO y marca `cuenta.pagoPendienteId`.
3. La pantalla muestra el QR y «lo puede pagar desde cualquier banco».
4. ManejoQRSimple confirma contra el banco y avisa (firmado); la Function
   aplica `aplicarPago`, escribe el pago como `confirmado por el banco` y la
   pantalla cambia sola.
5. Si vence sin pago: el pago queda `vencido`, `pagoPendienteId` se limpia,
   se puede emitir otro. **Un solo cobro pendiente por cuenta**: evita dos QR
   vivos por el mismo mes.

Es la fase 2 de `Analisis/29` («pagos con su TCO, estado derivado de los
pagos»), con el cobrador enchufado.

### 4.2 Autoatención por el WhatsApp interno de NovuChat

El número de NovuChat ya tiene un flujo (captación). Se le agrega una
intención para **administradores registrados** —el teléfono tiene que estar
en `usuarios` del comercio con rol admin; un desconocido no puede pagar por
otro—:

- «pagar» / «renovar» → el flujo llama a la misma Function del §4.1 (plan y
  meses por botones: 1, 3, 6) y **manda el QR como imagen** con el importe y
  el vencimiento. Un mensaje.
- Al confirmar el banco, el mismo número escribe: «Pago confirmado por el
  banco. Tu servicio queda cubierto hasta el [mes].» Un mensaje.
- «estado» → cuánto lleva consumido, hasta cuándo está cubierto.

Los recordatorios del §3.1 salen por este mismo número, así que el comercio
paga **respondiendo al recordatorio**, sin abrir nada. Es el camino que más
se va a usar.

**Mensajes que agrega:** 2 por pago (QR y confirmación), a cargo de
NovuChat; con la franquicia de 1.000 del número de NovuChat, gratis hasta 500
pagos por mes.

### 4.3 Carga manual por un superadministrador

Para efectivo o transferencia directa. `registrarPagoManual`, solo
propietario, con:

| Campo | Obligatorio | Por qué |
|---|---|---|
| tenant, tipo (mensualidad / bolsa), plan, meses o cantidad | sí | Lo mismo que un pago automático |
| importe recibido en Bs y **TCO aplicado** | sí | Sin TCO no se reconstruye la factura; `importeBs` lanza si falta |
| medio (`efectivo` / `transferencia`) y referencia (número de operación, o «efectivo, recibido por X») | sí | La evidencia |
| comprobante adjunto (imagen o PDF) | transferencia: sí | Se guarda en Storage con las reglas del comercio, no en el chat |
| motivo si el importe no coincide con la lista | si difiere | Un descuento manual tiene que tener nombre y firma |

Escribe el pago como `confirmado por el propietario`, aplica `aplicarPago`,
y deja auditoría (`/auditoria`, como `suspenderTenant`). **Una regla más:**
un pago manual **no puede coexistir con un cobro QR pendiente** del mismo
mes sin anular el QR antes (`anularCobro`), o el cliente paga dos veces.
Conciliación mensual: los pagos manuales contra el extracto de la cuenta, a
mano; es la única parte que no automatiza el banco.

**Cuándo conviene el camino manual:** el comercio que paga en efectivo en
una visita, el que transfiere desde una cuenta empresarial con firmas, y el
que negocia algo fuera de lista. **Motivo económico para preferir la
transferencia no hay ninguno**: el QR no tiene comisión, y además se acredita
solo. Debería ser la minoría; si a los tres meses es la mayoría, el QR no está
siendo ofrecido bien.

---

## 5. La economía del cobro

### 5.1 Lo que cuesta cobrar así, por cliente y por mes

| Concepto | USD | Comentario |
|---|---|---|
| Recordatorios (4 plantillas de utilidad) | 0,045 | 0,07 si hay corte |
| QR y confirmación por WhatsApp (2 mensajes) | 0,023 | Gratis dentro de la franquicia del número de NovuChat |
| Comisión bancaria del abono | **0** | El cobro por QR Simple es un servicio gratuito del banco (Andres, 17/09/2026). Cierra la pregunta C9 que ManejoQRSimple tenía abierta, y conviene que ese proyecto lo anote |
| Satélite, Functions, Firestore | ≈ 0 | Ya corren |
| **Total** | **≈ 0,07** | Contra 25 a 90 USD de ingreso: **menos del 0,3 %** del plan más chico. Y dentro de la franquicia del número de NovuChat, 0,045 |

### 5.2 Contra lo manual

Cobrar a mano —mandar el número de cuenta, esperar el comprobante, mirarlo,
entrar al banco, marcar la cuenta— son **unos 10 minutos por cliente y por
mes** cuando todo sale bien, y media hora cuando no. A 30 clientes, 5 horas
al mes; a 100, **17 horas**: dos jornadas de una persona, todos los meses,
haciendo lo que un satélite hace en 45 segundos. Y con un riesgo que el
automático no tiene: un comprobante editado que alguien da por bueno.

### 5.3 Caja y morosidad

- **Prepago estricto = cero cuentas por cobrar.** Nunca hay un mes atendido
  sin pagar, salvo las 48 h de gracia.
- **El prepago de varios meses adelanta caja** (tres meses de Corporativo
  son 270 USD el día uno) a cambio del riesgo cambiario de §2.2, que es
  menor que cualquier descuento que se pudiera dar.
- **Cada mes prepagado es un ciclo de cobranza menos**: con 3 meses, un
  cliente pasa de 12 a 4 vencimientos al año, y de 48 a 16 recordatorios.
- **La reactivación automática es la que cuida el ingreso**: un corte que
  se levanta en dos minutos rara vez se convierte en baja; uno que exige
  llamar a alguien, sí.

### 5.4 Lo que cambia para el cliente

Nada del precio. Cambia que **paga con cualquier banco escaneando un QR**,
que sabe cuánto en bolivianos antes de pagar, que puede adelantar meses para
olvidarse, y que si se le pasa, el asistente vuelve solo al pagar.

---

## 6. Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| Un pago marcado como confirmado que no existe en el banco («es fraude, no un bug», dice ManejoQRSimple) | Solo dos caminos confirman: la consulta autenticada al banco, o el propietario con evidencia y auditoría. El comprobante y el webhook del banco solo disparan verificación. NovuChat **no** reimplementa nada de esto |
| Doble pago (QR pagado después de cargar un pago manual, o dos QR del mismo mes) | Un solo cobro pendiente por cuenta; la carga manual exige anular el QR vivo; si aun así llega un pago de más, **se acredita como meses adelantados**, nunca se pierde |
| El QR vence antes del recordatorio siguiente | Vigencia 72 h desde D-5 cubre D-1; el D0 y el D+2 llevan QR nuevo. Es lo que ManejoQRSimple llama renovación versionada |
| El importe del QR es de un mes y el cliente quiere pagar tres | El recordatorio lleva el QR de un mes y un botón «pagar más meses» que abre el §4.2; en consola se elige antes de emitir |
| El TCO se mueve entre la emisión y el pago | No importa: el importe del QR es la oferta, y el TCO guardado en el pago es el que rige. Es la respuesta a la pregunta abierta de `Analisis/14` |
| Un teléfono desconocido «paga» por un comercio | Solo administradores registrados del comercio; y aunque un tercero pagara, el dinero entra a NovuChat y se acredita al comercio: no hay vector |
| El aviso firmado de ManejoQRSimple se pierde | NovuChat consulta `estadoCobro` al abrir la pantalla y en un barrido cada hora; el aviso solo acelera |
| Meta rechaza las plantillas de cobranza como Marketing | Se redactan como estado de una cuenta existente («tu mensualidad vence…»), sin promoción; ver la memoria de plantillas |
| El comercio en corte reclama que no sabía | D-5, D-1, D0, D+2 por WhatsApp y la pantalla de estado de cuenta que un suspendido sigue viendo. Cuatro avisos y una pantalla |

---

## 7. Qué habría que construir (sin construirlo)

| # | Qué | Dónde | Jornadas |
|---|---|---|---|
| 1 | Reaplicar la rama del prepago sobre `main` (ya tocó la ingesta; `Analisis/27` §8 pedía abrirla una sola vez, y esta es la vez) con: gracia de 48 h, calendario D-5/D-1/D0/D+2/D+4, `perdidas` en el aviso, teléfono del comercio en `MENSAJE_CORTESIA` | NovuChat, `prepago.ts` e ingesta | 2 |
| 2 | Colección `pagos` con TCO, medio y confirmador; `registrarPagoManual`; auditoría; pantalla del propietario (fases 1–2 de `Analisis/29`) | NovuChat | 2 |
| 3 | Contrato para consumidores: `crearCobro` con referencia externa, `estadoCobro`, `anularCobro`, aviso firmado de `CONFIRMADO`; cuenta `novuchat`; pase a producción (A4) | **ManejoQRSimple** | 2–3 |
| 4 | Cliente del cobrador en NovuChat + Function que aplica el pago al confirmar + barrido horario | NovuChat | 1,5 |
| 5 | Consola: «Pagar» (plan, meses, bolsas, importe en USD y Bs, QR), historial de pagos | NovuChat | 1,5 |
| 6 | WhatsApp interno: intención «pagar / estado» para administradores, QR como imagen, confirmación; recordatorios con QR en el encabezado; plantillas a revisión de Meta | NovuChat, flujo de NovuChat | 1,5 |
| — | **Total** | | **10 a 12** |

Orden: 3 y 1 en paralelo (son proyectos distintos), después 2 y 4, y al
final 5 y 6. **Ya no queda ningún número por confirmar**: al no haber
comisión bancaria, el costo de cobrar está cerrado. Lo único que no depende de
NovuChat es el pase a producción de ManejoQRSimple (la cuenta de pruebas del
banco, A4).

---

## 8. Qué medir el primer trimestre

| Dato | Para qué |
|---|---|
| Pagos por camino (consola / WhatsApp / manual) | Si el manual es minoría; si el WhatsApp es el que más se usa |
| Días entre D-5 y el pago | Si D-5 alcanza o conviene D-7 |
| Cortes por `sin_pago`, y cuántos se reactivan en menos de 24 h | La eficacia del calendario y del aviso con `perdidas` |
| Meses prepagados por pago (promedio) | Cuánta caja adelanta el prepago y cuántos ciclos ahorra |
| Diferencia entre el TCO de emisión y el del día del pago | El costo real del riesgo cambiario que asume NovuChat |
| Cobros emitidos que vencen sin pago, sobre emitidos | Si la vigencia de 72 h es corta, o si el QR se está ofreciendo en el momento equivocado |
