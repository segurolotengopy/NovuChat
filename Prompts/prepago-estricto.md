# Prepago estricto: pagar por consola, por WhatsApp o por carga manual — construcción con varios agentes

> **Alcance: todos los comercios en un plan.** Los que están en **PRUEBA** no
> reciben cobranza (solo el aviso de conversión) y los de **demostración** no
> están sujetos a nada de esto: son la salvaguarda que impide que un despliegue
> apague un demo. Ningún comercio concreto es parte del diseño; los parámetros
> (plan, modalidad, umbrales, teléfono de recepción) se leen de `cuenta/estado`
> y de `config/` de cada tenant.

Eres la sesión coordinadora de un frente de trabajo: hacer que el cobro de
NovuChat sea **prepago estricto**, con tres formas de pagar —autoatención por
la consola, autoatención por el WhatsApp interno de NovuChat, y carga manual
por un superadministrador de un pago en efectivo o por transferencia—, pagos
de **uno a seis meses adelantados**, y las reglas de corte y cobranza
acordadas. El cobro se apoya en **el proyecto de cobros por QR Simple**, que
ya funciona contra la API oficial del banco; NovuChat es uno de sus
comerciantes y **no reimplementa nada bancario**.

Las decisiones están en `Analisis/36-prepago-estricto-y-dunning.md`; este
prompt las ejecuta. **No se rediscute** el precio, la unidad de cobro, el
calendario de cobranza ni quién confirma un pago.

Lee primero, en este orden: `CLAUDE.md` entero (prohibiciones, Base comercial
§2, §3 y §7, Flujo de trabajo), `ESTADO.md`, `CONFIGURACION.md`,
`admin/DISENO.md` §4ter.2 (estado de cuenta, y los tres textos con sus tres
públicos), y después:

- `Analisis/36-prepago-estricto-y-dunning.md` — todo: lo que ya existe (§1), el modelo (§2), la cobranza (§3), los tres caminos (§4), la economía (§5), los riesgos (§6), el plan por bloques (§7) y qué medir (§8).
- `Analisis/29-pantalla-del-propietario.md` — fases 0, 1 y 2: arreglar `actualizarEstadoCuenta`, la cuenta del negocio para el propietario, y los pagos con su TCO.
- `Analisis/27-modelo-bloques.md` §8 — por qué la transacción de la ingesta se abre con cuidado y una vez por frente.
- **La nota del 20/09 al principio de `Analisis/36`**, y el `ESTADO.md` de `main`: el documento se escribió antes de `v0.6.0`. Antes de escribir una línea hay que cotejar contra `main` la ingesta (ya reabierta por la seña y los seguimientos), la maquinaria de QR que ya existe (`qrSimple.ts`, `dibujoQr.ts`, `cotejo.ts`, `firma.ts`) y `seguimientos.ts`, que es de donde deberían salir los recordatorios de cobranza.
- `Analisis/17` §3.0 y `Analisis/14` §5ter — el tipo de cambio: por qué es del BCB y por qué la pregunta «día de pago o primer día del mes» queda resuelta como **día de emisión del cobro**.
- La rama **`integracion/prepago-sobre-flujos-vivos`**: `admin/functions/src/prepago.ts` es el corazón de esto y **ya está escrito y probado**. Léelo antes de escribir una línea.

Si `Analisis/36` está sin versionar en el worktree principal, tu primera tarea
es llevarlo a tu rama con un commit propio, sin tocar nada más de esa carpeta:
hay otras sesiones trabajando ahí.

## Las decisiones que no se tocan

1. **Solo dos cosas confirman un pago:** la consulta autenticada al banco, que
   hace el proyecto de cobros, o **el propietario cargándolo con evidencia y
   auditoría**. El comprobante del cliente y el webhook del banco son
   disparadores de verificación, **nunca** confirmación. NovuChat no habla con
   el banco, no guarda credenciales bancarias y no reimplementa la máquina de
   estados del cobro. Un pago marcado como confirmado que no existe en el
   banco no es un defecto: es fraude.
2. **La unidad, los planes y la bolsa no cambian**: conversación de 24 h por
   contacto con bloque de 25 respuestas; USD 25 / 50 / 90 por 100 / 220 / 500;
   bolsa de 30 por USD 10 que no vence. Están en `prepago.ts` y en
   `planes.ts`, en un solo lugar cada uno.
3. **Precios en dólares, cobro en bolivianos al TCO del BCB.** El TCO que rige
   es **el del día en que se emite el cobro**, y se guarda en el pago junto al
   importe y su fuente. `importeBs` redondea al boliviano y **lanza si el TCO
   no es válido**: sin TCO no se cobra. NovuChat no publica un tipo de cambio
   propio.
4. **Prepago estricto:** ningún mes se atiende sin estar pagado, salvo las
   **48 horas de gracia**. Hasta **6 meses** adelantados, **sin descuento de
   precio**; a partir de 6, una bolsa de regalo. Doce meses no: la cláusula de
   revisión por tarifa de Meta es trimestral.
5. **PRUEBA no recibe cobranza.** Su único aviso es de conversión («tu prueba
   termina el día X, elige un plan»). Una cuenta **sin modalidad, o en
   demostración, no se corta nunca**: es la salvaguarda de los demos, y se
   prueba negando.
6. **El mensaje al cliente final es neutro y verdadero.** Jamás menciona pagos
   (T-18) y **jamás dice «mantenimiento»**, que sería falso. Rige el texto que
   ya existe (`MENSAJE_CORTESIA`), al que se le suma **el teléfono de
   recepción del comercio**. La presión sobre el comercio es otra: **el número
   de clientes que escribieron y no fueron atendidos** (`corte.perdidas`),
   visible en su consola, que un comercio cortado sigue viendo.
7. **La reactivación es automática.** Al confirmar el banco, la cuenta vuelve a
   operativa y el flujo lo ve en el próximo `configuracionFlujo` (TTL de caché
   de 60 s). «Se reactiva solo en menos de dos minutos» es una promesa que el
   sistema tiene que cumplir.
8. **Un solo cobro pendiente por cuenta.** La carga manual exige anular el QR
   vivo antes. Si aun así entra un pago de más, **se acredita como meses
   adelantados**: nunca se pierde y nunca se devuelve por otro canal.
9. **El QR del prepago no es el QR de la seña.** `cobro.ts` es el comercio
   cobrándole a su cliente, con la cuenta del comercio y sin que NovuChat toque
   la plata; el prepago es NovuChat cobrándole al comercio, con su propia
   cuenta de cobro. **Credenciales, pantallas y colecciones separadas**; se
   comparten el dibujo del QR y la firma, nada más.
10. **Todo se hace cumplir en el servidor**, con prueba negativa; la consola
   solo muestra. Y **Andres autoriza; tú operas**: nada en producción, en el
   banco, en Meta o en GitHub sin su «sí» en el chat.

## Reutilizar antes de escribir

**Consulta primero `~/Claude-Proyectos/proyectos/`.** Para este frente importa
saber que:

- **El cobro por QR ya existe y no tiene comisión bancaria**
  (`manejoqrsimple.md`): el servicio del banco es gratuito, así que el costo de
  cobrar es solo el de los mensajes. Ese proyecto ya emite QR de un solo uso
  con monto y vencimiento, confirma contra el banco en unos 45 segundos y
  soporta varias cuentas de cobro.
- **La factura fiscal no es parte de este frente.** Existe un proyecto de
  facturación; lo que este frente tiene que garantizar es que **el pago quede
  guardado con importe, TCO, fuente, medio y quién lo confirmó**, que es lo
  que haría falta para emitirla después.
- **El módulo puro del prepago ya está escrito** en la rama
  `integracion/prepago-sobre-flujos-vivos`. Reaplicarlo y corregirlo, no
  reescribirlo.

No busques por el disco ni leas otros proyectos por tu cuenta: pídele a Andres
las rutas exactas y léelas **solo como referencia**. La prohibición 5 de
`CLAUDE.md` marca lo que no se toca bajo ninguna circunstancia.

**El contrato con el proyecto de cobros lo trabaja otra sesión**, con el
prompt `cobrador-contrato-para-consumidores.md` de esta misma carpeta. Tú
consumes ese contrato; si todavía no existe, se construye contra un doble de
prueba y se integra cuando esté.

## Cómo trabajar

- **Worktree y rama propios** (`git worktree add`); nunca cambiar de rama en
  `~/NovuChat` ni `git add -A`. Un bloque = una rama = un PR contra `main`.
- **Ningún secreto** en el repositorio; identificadores por últimos 4 dígitos.
- **Cada bloque declara su costo en mensajes** y quién los paga. Para
  referencia: los recordatorios y el QR salen del número de NovuChat y
  consumen **su** franquicia, no la del comercio; son 4 plantillas por ciclo
  (0,045 USD) más 2 mensajes por pago (0,023).
- **Los límites se prueban negando**: la cuenta en demostración no se corta; la
  cuenta en prueba no recibe cobranza; el comercio no puede escribir su propio
  estado de cuenta; un teléfono que no es administrador no puede pagar por un
  comercio.
- **Resultado real, no esperado**, anotado en `admin/pruebas/` y en el archivo
  de aceptación; `ESTADO.md` al cerrar cada bloque; la ficha
  `~/Claude-Proyectos/proyectos/novuchat.md` si cambió un módulo reutilizable.

## Cómo repartir el trabajo entre agentes

Subagentes en paralelo (`Agent`), cada uno en su worktree (`isolation:
worktree`); tú integras. Revisión del agente `seguridad` antes de pedir el OK
de fusión de cada PR.

| Agente | Tipo | Qué hace | Cuándo |
|---|---|---|---|
| **Diseño** | `Plan` | El diseño de la colección `/tenants/{t}/pagos/{id}` (estados, TCO, medio, confirmador, idempotencia), el contrato que se le pide al cobrador, la bandera de **modo observación** del bloque 0, y el plan de reaplicación de la rama del prepago sobre `main` sin abrir dos veces la transacción de la ingesta. Entrega `admin/DISENO.md` §4undecies | Primero, solo |
| **Prepago (servidor)** | `general-purpose` | Bloques 0 y 1: reaplicar el módulo puro con las correcciones, gracia de 48 h, calendario nuevo, `perdidas`, teléfono en el mensaje de cortesía; colección de pagos, `registrarPagoManual`, auditoría, fase 0 de `Analisis/29` | Después del diseño |
| **Cobrador (cliente)** | `general-purpose` | Bloque 2: cliente del cobrador, Function que aplica el pago al confirmar, barrido horario, idempotencia por referencia, anulación | Contra el doble de prueba; integra cuando exista el contrato |
| **Consola** | `general-purpose` | Bloque 3: «Pagar» (plan, meses, bolsas, importe en USD y Bs con su TCO, QR), historial de pagos, estado de cuenta con `perdidas`; pantalla del propietario (fases 1–2 de `Analisis/29`) | Con el bloque 1 en `main` |
| **WhatsApp interno** | `flujos-n8n` | Bloque 4: intención «pagar / estado» para administradores registrados, QR como imagen, confirmación; recordatorios con el QR en el encabezado | Con el bloque 2 en `main` |
| **Plantillas de Meta** | `meta-whatsapp` | Bloque 5: redactar y presentar a revisión las plantillas de cobranza **como estado de una cuenta existente** (utilidad, sin lenguaje comercial, sin botones a WhatsApp); las presenta Andres | **El día 1**, en paralelo con todo: la revisión tarda |
| **Seguridad** | `seguridad` | Reglas de Firestore de `pagos` (nadie escribe desde el navegador), verificación de la firma del aviso del cobrador, que ninguna credencial bancaria entre al repositorio, evidencia de pagos manuales en Storage | Antes de cada OK de fusión |
| **DevSecOps y despliegue** | `devsecops`, `deploy` | Functions nuevas en el pipeline; staging; producción la aprueba Andres en el Environment | Al cerrar cada bloque |

**Regla de integración, y es dura.** Este frente puede **apagarle el servicio a
un cliente que pagó**, así que:

1. Nada se fusiona sin la prueba negativa de que **demostración y prueba no se
   cortan nunca**.
2. El bloque 0 se despliega en **modo observación**: el corte se calcula, se
   registra y se le avisa a NovuChat, **pero no corta**, hasta que haya al
   menos un pago confirmado de punta a punta y un ciclo completo de
   recordatorios observado. Encender el corte es una decisión de Andres, no
   un despliegue.
3. Ningún bloque posterior se fusiona antes de un **ensayo de extremo a
   extremo con un cobro real de monto mínimo** en un tenant de prueba: QR
   emitido, pagado desde otro banco, confirmado, mes acreditado, cuenta
   reactivada.
4. Si algo del prepago rompe la atención de un comercio operativo, **se
   detiene todo el frente** y se revierte el bloque.

## Qué construir, por bloques

### Bloque 0 — El módulo puro, reaplicado y corregido (2 jornadas)
Rama `prepago/modulo-y-cortes`. Reaplicar `prepago.ts` de
`integracion/prepago-sobre-flujos-vivos` sobre `main`. **Esa rama es del
08/09 y `main` ya no es el que ella conocía**: la ingesta la reabrieron la
seña y los seguimientos, así que la reaplicación es una integración, no un
`cherry-pick`, y el primer paso es leer la ingesta de hoy. Correcciones: **gracia de 48 h** antes
del corte; calendario **D-5, D-1, D0, D+2, D+4** en vez del actual;
`corte.perdidas` en el aviso de D+4; teléfono de recepción en
`MENSAJE_CORTESIA`; **bandera de modo observación**. Pruebas puras mes por mes
y las negativas de arriba. **Costo: 4 plantillas por ciclo de cobranza, 6 si
hay corte, todas de NovuChat.**

### Bloque 1 — Pagos con su TCO, y la carga manual (2 jornadas)
Rama `prepago/pagos-y-carga-manual`. Colección `/tenants/{t}/pagos/{id}`
(pendiente / confirmado / vencido / anulado, con importe USD y Bs, TCO y
fuente, medio, referencia, quién confirmó); `registrarPagoManual` del
propietario con evidencia obligatoria y auditoría; fase 0 de `Analisis/29`
(que `actualizarEstadoCuenta` no pise campos y tenga pruebas). El estado de
cuenta se **deriva de los pagos**, no se escribe a mano. **Costo: 0 mensajes.**

### Bloque 2 — El cliente del cobrador (1,5 jornadas)
Rama `prepago/cliente-cobrador`. Contra `docs/10-contrato-consumidores.md`
del proyecto de cobros: `POST /api/v1/cobros` con `referenciaExterna`
`tenant/periodo/pagoId`, monto como texto decimal, vigencia 72 h, concepto
sin datos del comercio; guardar el pendiente; **sondear `estadoCobro` por
referencia** mientras haya un cobro pendiente (cada pocos minutos, más el
barrido horario), y aplicar `aplicarPago` **idempotentemente** solo cuando el
estado sea `CONFIRMADO`; verificar la firma del aviso cuando exista;
`anularCobro` al cargar un pago manual, tratando el `409` de pagado como «hay
plata: consultá el estado». **Costo: 0
mensajes** (los del QR están en el bloque 4).

### Bloque 3 — Consola: «Pagar» y el propietario (1,5 jornadas)
Rama `prepago/consola-pagar`. Elegir plan, meses (1 a 6) y bolsas; ver el
importe en USD y en Bs con el TCO del día y su fuente; el QR; el historial de
pagos; `perdidas` en el estado de cuenta. Y las fases 1–2 de `Analisis/29`
para el propietario. **Costo: 0 mensajes.**

### Bloque 4 — WhatsApp interno de NovuChat (1,5 jornadas)
Rama `prepago/whatsapp-pago`. Intención «pagar / renovar / estado» **solo para
teléfonos que son administradores registrados del comercio**; meses por
botones (1, 3, 6); el QR como imagen con importe y vencimiento; la
confirmación cuando el banco confirma. Los recordatorios salen por este mismo
número, así que el comercio paga respondiendo al recordatorio. **Costo: 2
mensajes por pago, de NovuChat; gratis hasta unos 500 pagos al mes dentro de
su franquicia.**

### Bloque 5 — Plantillas de Meta (arranca el día 1)
Rama `prepago/plantillas-cobranza`. Cinco plantillas de **utilidad** redactadas
como estado de una cuenta existente. Sin «aprovechá», sin precios de promoción,
sin botones a WhatsApp, con validez máxima. Si Meta insiste en clasificarlas
como Marketing, el aviso va por correo: **no se acepta Marketing para un aviso
de cobranza.**

### Lo que NO se construye
- **Nada bancario en NovuChat**: ni credenciales, ni consulta al banco, ni
  máquina de estados del cobro, ni OCR que «confirme» un pago.
- **Tarjeta, débito automático ni pasarela internacional**: no están en el
  análisis y no hay demanda.
- **Factura fiscal**: es otro proyecto; acá solo se guarda lo necesario para
  emitirla.
- **Descuento por pagar varios meses**, ni 12 meses.
- **Cobrar distinto por flujo o por canal** (`CLAUDE.md` §6).
- **Mensajes al cliente final que mencionen el pago o inventen un
  mantenimiento**, en ningún estado.

## Entregables al cerrar
- Un PR por bloque con: mensajes declarados, pruebas (puras, negativas, de
  reglas), y el resultado **real** del ensayo que le toque.
- El ensayo de extremo a extremo con un cobro real de monto mínimo,
  documentado con lo que pasó y en cuánto tiempo.
- `admin/DISENO.md` con la sección nueva; `ESTADO.md` al cerrar cada bloque;
  `~/Claude-Proyectos/proyectos/novuchat.md` con el prepago como módulo.
- Una nota en `Analisis/36` si algo de lo construido cambia una regla, y el
  texto de las cláusulas para el contrato (§2.2 y §6).
- La medición del §8 de `Analisis/36` lista para el primer trimestre: pagos por
  camino, días entre D-5 y el pago, cortes y reactivaciones en menos de 24 h,
  meses prepagados por pago, diferencia de TCO entre emisión y pago, cobros
  vencidos sin pago.
