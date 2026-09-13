# Puesta en producción con el primer cliente real: Q' Taco Mexican Grill

**13-sep-2026.** Recomendaciones pedidas por Andres, con la propuesta comercial
del 11/09 y el material de referencia de `~/Documentos/NovuChat/QTaco` a la
vista (propuesta, menú completo en PDF, borrador de prompt y XML de Silvana).
Escrito contra lo que **existe hoy** en `main`, en n8n y en Meta, y contra
`Analisis/13` (alta de clientes), `07` (cobro real), `14` y `20`.

No contiene secretos ni identificadores.

---

## 0. Las decisiones, resumidas

| Tema | Recomendación | Por qué, en una línea |
|---|---|---|
| **Qué se construye** | **Un solo flujo de n8n** («Q'Taco Restaurante»), no tres. Nace del Flujo B (venta y cobro) y le agrega la reserva de mesas. | Un número de Meta tiene un webhook y un disparador. Los «tres flujos» de la propuesta son tres intenciones del mismo agente. |
| **Reservas de mesa** | **No es la agenda por funcionario del Flujo A.** Versión 1: la solicitud se registra y se avisa al restaurante, y el asistente dice «solicitud registrada» hasta que una persona confirme. Versión 2, si la quieren: un calendario «Salón» con cupo por franja. | Hoy nada verifica disponibilidad de mesas. Decir «tu mesa está reservada» sin que nadie la mire es prometer algo que no se controla. |
| **Cobro** | **Cobro real con el QR del restaurante**, y nunca simulado. El asistente **jamás** dice «pago confirmado». | Prohibición 3. El borrador de prompt de Silvana dice exactamente «¡Pago confirmado! Tu pedido ya está en cocina»: hay que corregirlo antes de que llegue a un nodo. |
| **Catálogo** | El menú se carga **en la consola**, que es la fuente de verdad, y se publica el catálogo web. **No se carga «un XML».** | 69 precios en el menú: por encima de 40 va resumen al prompt y la lista completa al catálogo web (`CLAUDE.md` §5). Un XML sería una segunda fuente de verdad. |
| **Campañas de Facebook** | No es un flujo: es la Promo Dúo en el catálogo, más leer el campo `referral` del payload para saber que el cliente vino de un anuncio. | Además es la única forma de **medir** la ventana de punto de entrada gratuito con un cliente real, que hoy no se puede prometer (`CLAUDE.md` §6). |
| **Número** | Chip **a nombre del dueño de Q'Taco**, sin WhatsApp instalado nunca, en el portafolio, app y WABA **del cliente**. | `Analisis/13` §2 y §3. El canal es de él; NovuChat opera como socio del portafolio. |
| **Aviso al restaurante** | **Plantilla utility aprobada**, no texto libre. | Los nodos «Avisar al dueño» y «Avisar a recepción» mandan texto libre; fuera de la ventana de 24 h del dueño Meta lo rechaza (error 131047). En los demos no se vio porque el «dueño» era un probador que había escrito antes. |
| **Antes de cobrar el primer mes** | Tope de 25 respuestas en el flujo, y que suspender un comercio corte de verdad (brecha 6 de `Analisis/13`). | Meta cobra cada mensaje desde el 01/10. Sin tope, una conversación larga se paga entera; sin corte, un moroso sigue consumiendo. |
| **Economía de la oferta** | Aceptable, **a condición de medir mensajes por conversación** el primer mes y dejarlo pactado. | 200 conversaciones por USD 40 es 0,20 por conversación, por debajo del plan de lista (0,227). El margen depende de cuántos mensajes tenga un pedido, y un pedido conversado es más largo que una cita. |

---

## 1. Lo que promete la propuesta y lo que existe

La propuesta vende un «ecosistema híbrido multiflujo»: ventas del menú, campañas
de Facebook y reservas, en un solo número. Es vendible y es construible, pero
conviene tener claro qué parte ya existe, qué parte es trabajo nuevo, y qué
frase hay que corregir antes de que la lea el cliente.

### 1.1 «Tres flujos simultáneos» es un flujo con tres intenciones

Cada app de Meta tiene una sola URL de webhook y cada nodo *WhatsApp Trigger* una
sola credencial (`Analisis/20` §2). Un número = un disparador = un flujo de n8n.
Lo que la propuesta llama tres flujos es **un agente que reconoce tres
intenciones**, exactamente como el Flujo B ya distingue gastronomía de retail.

Punto de partida: `Flujos/demo-b-venta-cobro.json` (22 nodos). Ya trae pedido
con cantidades, modalidad de entrega, carrito del catálogo nativo, envío de QR,
comprobante por imagen, aviso al dueño y registro del cierre. Le falta la reserva
de mesas y el cobro real.

**Hay una decisión de plataforma detrás.** Cada número está atado a **un**
flujo: `/rutasWhatsApp/{numero}.flujo` es un valor, no una lista, y la ingesta
escribe conversaciones y cierres bajo ese flujo (`ingesta.ts`, `flujo:
ruta.flujo || 'agendamiento'`). Un comercio puede tener varios flujos
(`tenants/{id}.flujos`), pero el diseño supone **un número por vertical**
(`DISENO.md` §4bis.4). Q'Taco es el primer caso de dos capacidades en un mismo
número. Opciones:

| Opción | Qué implica | Veredicto |
|---|---|---|
| A · El número va a `venta`; las reservas son una capacidad más de ese flujo | Documento `/config/reservas` propio, pestaña «Reservas» en `flujos.ts`, y la reserva se registra como un cierre de tipo `reserva` bajo `venta`. `rutasWhatsApp` no cambia. | ✅ **Para Q'Taco.** Es lo que la política de capas (§4sexies) ya prevé: lo propio de un flujo trae su documento y su pestaña. |
| B · Permitir que `rutasWhatsApp.flujo` sea una lista | Toca ingesta, reglas, consola y las pruebas de aislamiento. | ⛔ No ahora. Es un cambio de modelo para un cliente. Se decide cuando haya un segundo caso. |
| C · Dos números para Q'Taco, uno por vertical | Duplica chip, portafolio y franquicia de Meta; el cliente publica dos números. | ⛔ Contradice la propuesta («un solo número»). |

**No confundir la reserva de mesas con `agendamiento`.** El Flujo A agenda a
una persona con un servicio de duración fija en su calendario. Un restaurante
reserva **cupo**: N personas en una franja, sin funcionario ni servicio. Meter
las mesas en el modelo de funcionarios obligaría a inventar un «funcionario
Salón» con «servicio Mesa de 2 horas», y el candado contra doble reserva
(`DISENO.md` §4quinquies.4) haría una llamada a Calendar por reserva. Se puede,
pero es forzar el modelo. Mejor una capacidad chica y honesta:

- **Versión 1 (recomendada para arrancar):** el asistente pide fecha, hora,
  personas y nombre, **registra la solicitud** y avisa al restaurante. Le dice al
  cliente que la reserva queda confirmada cuando el restaurante responda. Una
  persona confirma desde su WhatsApp. Cero riesgo de doble reserva, y el
  restaurante conserva el control de su salón. Costo: 1 mensaje al cliente + 1
  plantilla al restaurante.
- **Versión 2:** calendario de Google «Reservas Q'Taco» y un cupo máximo de
  personas por franja en `Config del negocio`; el asistente consulta el
  calendario, suma personas en la franja y confirma solo si cabe. Es el modelo
  del Flujo A adaptado, sin funcionarios. Vale la pena si el restaurante llena el
  salón con frecuencia; si no, la versión 1 alcanza y es más barata.

Lo que **no** hay que hacer es lo que hace el borrador de prompt: confirmar «tu
mesa está reservada» sin que nada la registre. Con los demos no importaba; con
un cliente que llega un sábado a las 20:00 y no tiene mesa, sí.

### 1.2 El cobro es real, y eso cambia tres cosas

Q'Taco cobra de verdad: el dinero va a su cuenta. Es el primer flujo en modo
**cobro real**, y `CLAUDE.md` es explícito en que los dos modos son excluyentes.

1. **El QR es el del restaurante**, sin rótulo «SIMULADO», subido desde la
   pantalla «Configuración de QR» de la consola. Con un QR de la familia
   cifrada (el caso boliviano habitual, `Analisis/07` §2), el comercio declara
   titular, **número de cuenta**, vigencia, reutilizable y monto abierto. Ojo con
   la vigencia: pedir al banco un QR con vencimiento largo, no el de un día.
2. **El asistente dice que el comprobante llegó y que los datos coinciden.
   Nunca que el pago está acreditado.** Silvana escribió «¡Pago confirmado! Tu
   pedido ya está en cocina»; reemplazar por algo como «recibí tu comprobante;
   el restaurante lo revisa y te confirma cuando el pedido entre a cocina». Quien
   confirma es el banco y una persona del restaurante, con el botón «marcar como
   comprobado» de la pantalla Cobros, que registra quién y cuándo.
3. **Los nodos de cobro real no existen todavía en n8n.** Lo que está hecho es
   la plataforma: cotejo del comprobante (`cotejo.ts`), reconocimiento del QR
   (`qrSimple.ts`), dibujo (`dibujoQr.ts`), la pantalla de cobros. Lo que falta
   está descrito en `Analisis/07` §4: tres nodos y el prompt de lectura del
   comprobante. Y dos datos que la consola espera y nadie escribe
   (`DISENO.md` §4nonies.3): **el `media id` del comprobante no se guarda** y
   **un pedido conversado no se guarda como pedido** (solo como cierre, sin
   ítems). Sin ellos, la pantalla Pedidos que el cocinero va a mirar está vacía.

**Mínimo viable para el día 1, si no da el tiempo para el OCR:** el flujo reenvía
la imagen del comprobante al celular del restaurante con el resumen del pedido.
El `media id` que llega en el webhook pertenece a la WABA del cliente, así que
el mismo id sirve para reenviarla con el nodo de WhatsApp, sin descargar nada.
Es lo que el dueño hace hoy con las capturas, pero ya ordenado y con el pedido
al lado. El cotejo automático se suma después, sin cambiar lo que ve el cliente.

### 1.3 El menú no es un XML, y tiene 69 precios

La propuesta dice «carga de catálogo XML» y el borrador de prompt dice «utiliza
la base de datos XML». El XML de Silvana tiene nueve ítems; el menú en PDF tiene
**69 precios** y variantes (tacos por unidad y por orden, diez carnes, proteína
extra). Cargar un XML al prompt crearía una segunda fuente de verdad, que es el
problema que costó una noche eliminar (`ESTADO.md`, 07/09).

- El menú entero va a **la consola**, con el lector de `.xlsx` que ya existe
  (`plantilla-catalogo.mjs` genera la planilla). Categorías: entradas,
  especialidades, sopas, platos fuertes, tacos, bebidas, promociones.
- Con 69 ítems, **al prompt va el resumen** —categorías y rango de precios— y
  **al catálogo web va la lista completa**. Es la regla de `CLAUDE.md` §5, y en
  un restaurante es además lo cómodo: nadie lee 69 platos en un chat.
- **Las variantes se modelan, no se describen.** «Orden de 3 tacos, carne a
  elección» con diez carnes es un ítem con variante, no diez ítems. Si el
  catálogo de la consola no soporta variantes hoy, se carga el ítem base y el
  asistente pregunta la carne, que es lo que hace el prompt para la Promo Dúo.
- **Lo que no se puede pedir por chat no se publica** (§5): platos de salón que
  no viajan, «a consultar», sin stock. Cada uno genera conversaciones pagadas
  que no cierran.
- **El costo de delivery no se «estima».** El borrador dice «puedes estimar un
  estándar». Eso es inventar un precio. Va en `Config del negocio` como tarifa
  fija o por zona, y si el restaurante cobra según distancia, el asistente dice
  que el restaurante confirma el costo con la dirección.

### 1.4 Campañas de Facebook: una intención, un campo del payload, y una medición

«Promo Q'Taco Dúo» es un ítem del catálogo con precio y descripción; el agente
ya lo maneja. Lo que sí es nuevo y barato:

- Cuando alguien escribe desde un anuncio de clic a WhatsApp, el mensaje trae
  `messages[0].referral` con el titular del anuncio y `ctwa_clid`. `Normalizar
  entrada` hoy no lo lee. Leerlo permite (a) que el asistente sepa por qué vino
  el cliente sin preguntarle y (b) **guardar en la conversación que nació de un
  anuncio**.
- Eso último es lo que permite **medir la ventana de punto de entrada
  gratuito** (`Analisis/14` §7.5): 72 horas sin costo de Meta para las
  conversaciones que llegan de un anuncio. Si se confirma con Q'Taco, es el
  argumento comercial más fuerte para cualquier negocio que haga publicidad, y
  hoy no se puede prometer porque nadie lo midió. Q'Taco es el cliente ideal para
  medirlo: sus picos vienen de campañas.

### 1.5 La economía de USD 40 por 200 conversaciones

El plan de lista es USD 50 por 220 (0,227 por conversación); la propuesta ofrece
0,20. Es una bonificación de cierre, y no hay problema en hacerla, **siempre que
se sepa de qué depende el margen**: del número de mensajes del asistente por
conversación. Cada mensaje cuesta 0,0113 USD después de los 1.000 gratis del
número.

| Mensajes por conversación | Mensajes en el mes (200 conv.) | Pagados a Meta | Costo Meta (USD) | Margen sobre USD 40 |
|---|---|---|---|---|
| 8 (una cita, sin fricción) | 1.600 | 600 | 6,8 | ≈ 32 |
| 12 (pedido corto con QR y comprobante) | 2.400 | 1.400 | 15,8 | ≈ 23 |
| 18 (pedido conversado con dudas del menú) | 3.600 | 2.600 | 29,4 | ≈ 9 |
| 25 (el tope, en todas) | 5.000 | 4.000 | 45,2 | negativo |

El modelo de IA suma alrededor de un 6 % del costo. Tres consecuencias:

1. **El tope de 25 no es opcional para Q'Taco**: sin él, no hay piso.
2. **Un pedido tiene que cerrar en pocos mensajes**: resumen del menú y enlace al
   catálogo web en un mensaje, pedido completo en otro, QR con el resumen en el
   mismo mensaje, confirmación del comprobante en uno. La regla vieja de
   «respuestas cortas» del borrador de Silvana («no envíes mensajes
   excesivamente largos») juega en contra: **mensajes completos, pocos**.
3. **Medir la distribución de mensajes por conversación el primer mes** y dejar
   escrito en el contrato que el plan se revisa con ese dato. La consola todavía
   no muestra ni los mensajes del mes contra los 1.000 gratis ni la distribución
   (`CLAUDE.md` §4): para el primer cliente se saca de las ejecuciones de n8n o
   de la ingesta, pero conviene construirlo pronto porque es lo que predice la
   factura de Meta.

Y la vía de escape es la del §1.4: si buena parte del tráfico de Q'Taco nace de
anuncios y la ventana gratuita se confirma, el costo de Meta cae casi a cero
para esas conversaciones.

---

## 2. Meta y el chip: qué cambia respecto de los demos

La guía de once bloques (`GUIA-META-NOVUCHAT.md`) sirve tal cual, con los
agregados de `Analisis/13` §7. Lo que es **distinto** de un número de prueba:

### 2.1 El chip

- **Registrado a nombre del dueño de Q'Taco**, con su carnet. Si el chip que ya
  tienen está a nombre de Andres, se cambia de titular antes de registrarlo en
  Meta, o se compra otro (15 Bs). El número es el canal del cliente; si se va, se
  lo lleva. Un número a nombre de NovuChat con el nombre comercial de otro es
  además un problema de política de representación de Meta.
- **Nunca instalar WhatsApp en ese chip**, ni la app normal ni Business. Un
  número virgen se registra en minutos; uno que tuvo cuenta hay que liberarlo y
  esperar.
- El chip hace falta físicamente **una sola vez**, para el SMS o la llamada de
  registro. Después queda en un cajón del restaurante, con saldo. **Recarga
  mínima cada 2–3 meses**, con fecha en la ficha: si la operadora recicla el
  número, se pierde el canal y todo lo publicado.
- **PIN de verificación en dos pasos** (6 dígitos): al gestor de contraseñas de
  NovuChat **y** al cliente por escrito. Perderlo es un ticket a Meta de semanas.
- El **WhatsApp actual del restaurante no se toca**. Es el número de recepción:
  donde llegan los avisos y desde donde una persona contesta cuando el
  asistente deriva. En su mensaje de bienvenida: «para pedidos y reservas,
  escríbenos al [número nuevo]».

### 2.2 En Meta, en el portafolio del cliente

Orden del día 1 con el cliente (2 h 30), igual que `Analisis/13` §7:

1. **Portafolio comercial de Q'Taco** en `business.facebook.com`, creado con la
   cuenta personal de Facebook del dueño, con nombre, dirección, correo y red
   social completos (un portafolio incompleto falla sin decir por qué). Invitar a
   Andres como administrador **mientras dura el alta** y al **portafolio
   NovuChat como socio** con acceso a la WABA y a la app: así la cuenta personal
   de Andres no es el punto único de falla.
2. **App** `QTaco-Asistente` en ese portafolio, sin la palabra «WhatsApp» en el
   nombre. App ID y App Secret al gestor.
3. **WhatsApp → WABA del cliente → agregar el número real.** El chip recibe el
   código. Fijar el PIN. **Nombre para mostrar** «Q' Taco Mexican Grill»: si
   coincide con el nombre comercial pasa sin revisión o en horas. Foto de perfil
   cuadrada, categoría «Restaurante», descripción de dos líneas, dirección y
   horario **desde WhatsApp Manager**, nunca desde una app.
4. **App en Live** con `novuchat.site/privacidad`.
5. **Usuario de sistema del portafolio del cliente**, token sin vencimiento con
   `whatsapp_business_messaging` y `whatsapp_business_management`; `debug_token`
   debe mostrar la app del cliente.
6. **`subscribed_apps`** sobre la WABA del cliente: solo la app del cliente en la
   lista. Es el paso que no existe en la interfaz (bloque 7 de la guía).
7. **Método de pago en la WABA y alerta de gasto.** Desde el 01/10 Meta cobra
   cada mensaje del asistente después de los 1.000 gratis del número; sin método
   de pago el envío se rechaza cuando se agota la franquicia. Meta factura por
   WABA. Decidir de quién es la tarjeta: la de NovuChat, porque el plan incluye
   WhatsApp, y **verificar en este primer alta que Meta acepte la misma tarjeta
   en varias WABA de distintos negocios** (`Analisis/13` §3). Descargar la
   tarjeta de tarifas y confirmar `service` y `utility` de Bolivia.
8. **Plantillas utility en la WABA del cliente**, creadas el día 1 porque la
   aprobación tarda de minutos a un día:
   - `nuevo_pedido` (cliente, ítems, total, modalidad, dirección);
   - `nueva_reserva` (nombre, fecha, hora, personas);
   - `comprobante_recibido` si el reenvío del comprobante va aparte.
   Ver §3.1: sin estas, el aviso al restaurante no llega.
9. **Verificación de negocio de Q'Taco: opcional.** Sin verificar tiene 2
   números y 250 conversaciones iniciadas por él por día; ningún restaurante se
   acerca. Se ofrece como extra cuando quiera la tilde verde.
10. **Webhook** de la app → URL de **Production** del *WhatsApp Trigger* del
    flujo de Q'Taco, campo `messages`. `verificar-meta.sh` con las variables del
    cliente: cuatro verdes. Un número real **no tiene el límite de 5
    destinatarios**: la prohibición 6 aplica al de prueba, no a este.

### 2.3 Lo que NO se hace

- No se usa ninguna de las dos apps de prueba ni sus números (prohibición 6).
- No se crea la WABA de Q'Taco bajo el portafolio de NovuChat (`Analisis/13` §3,
  opción 2): una sanción caería sobre todos los clientes a la vez.
- No se migra el número actual del restaurante: dejaría al negocio sin poder
  contestar a mano, porque la consola no envía mensajes.
- No se toca AAB1, `Demo SeguroLo Tengo` ni `otp-service` (prohibición 5).

---

## 3. Lo que un cliente real va a hacer y los demos no hicieron

Estas son las trampas concretas. Las tres primeras son defectos con un cliente
real, no mejoras.

### 3.1 El aviso al restaurante sale como texto libre: fuera de 24 h no llega

`Avisar al dueño` (Flujo B) y `Avisar a recepción` (Flujo A) mandan `textBody`
al número del negocio. La Cloud API solo permite texto libre **dentro de las
24 h posteriores al último mensaje de ese número**. El dueño de Q'Taco nunca le
escribe a su propio asistente, así que la ventana está cerrada casi siempre y
Meta rechaza el envío (error 131047, *re-engagement message*). En los demos no
se vio porque el «dueño» era uno de los cinco probadores, que había escrito
antes.

**Corrección:** los avisos se envían con una **plantilla utility** aprobada
(§2.2, paso 8), con el nodo de WhatsApp en modo plantilla y las variables del
pedido o la reserva. Cuesta un mensaje utility por aviso, que se declara: **+1
mensaje por pedido confirmado y +1 por reserva**, a la tarifa utility de
Bolivia, que hay que confirmar en la tarjeta de tarifas de la WABA. El
recordatorio del Flujo A ya usa este mecanismo, así que el patrón existe.

### 3.2 Ráfagas de mensajes del mismo cliente

Un cliente real escribe «hola», «quiero pedir», «2 órdenes de tacos», «de
asada» en cuatro mensajes seguidos. Cada uno dispara una ejecución; las cuatro
corren a la vez, comparten la memoria del teléfono y responden en cualquier
orden. Con cinco probadores disciplinados no pasa; con un restaurante en hora
pico pasa todo el tiempo.

**Recomendación:** probarlo a propósito en la aceptación (cuatro mensajes en
tres segundos) y, si se cruzan, agregar una espera corta por teléfono antes del
agente que junte lo que llegó en los últimos segundos en un solo turno. Además
de ordenar las respuestas, **ahorra mensajes**: cuatro entradas producen una
respuesta y no cuatro.

### 3.3 Reintentos de Meta e idempotencia

Si n8n tarda en responder 200 o cae un instante, Meta reenvía el mismo evento.
`Normalizar entrada` no mira `messages[0].id`, así que un reenvío se procesa dos
veces: dos respuestas, dos avisos, y con cobro real dos registros del mismo
comprobante. **Descartar por id de mensaje** (una tabla chica en la base de n8n,
o la ingesta rechazando un id repetido) antes de llamar al modelo. La ingesta ya
guarda el id de Meta del mensaje, así que el lugar natural es ahí.

### 3.4 El respaldo del flujo es el del demo

`Config base` del Flujo B dice «Resto & Tienda Demo NovuChat», con hamburguesas
y rótulos de cobro simulado. Si el panel no contesta, el asistente de Q'Taco
atiende como el demo y **manda un QR rotulado como simulado**. En la copia del
flujo de Q'Taco, `Config base` se reemplaza entero por los valores del
restaurante (`Analisis/13` §7.11), y los campos del cobro simulado se vacían.

### 3.5 Tope de 25 y corte por suspensión, antes del primer cobro

- El **tope de 25 respuestas por conversación** no existe en el flujo vivo. Está
  hecho en `integracion/prepago-sobre-flujos-vivos` con 35 pruebas y hay que
  reaplicarlo nodo por nodo sobre el flujo de Q'Taco (media jornada, `ESTADO.md`
  08/09). Es obligatorio antes del 01/10, por el §1.5.
- **Suspender un comercio ya corta el asistente**: se corrigió el 07/09 en los
  tres flujos (commit `2e251f9`, 17 pruebas en `estado-comercio.test.ts`) y se
  republicó esa noche. Lo que queda, al reaplicar el prepago, es confirmar que
  el segundo camino del 409 (`sin_pago`, `sin_conversaciones`) corta igual.
  *(Corregido el 13/09: la primera versión de esta viñeta lo daba por abierto.)*
- **Nota del 13/09:** la definición del tope cambió el mismo día
  (`Analisis/27`): la conversación pasa a ser un **bloque de 25 respuestas**
  y el asistente no se corta a las 25. El §4 de este documento y la propuesta
  hay que reescribirlos con esa regla antes de firmar.
- El **prefijo cacheable** no urge: ahorra 0,07 Bs por conversación.

### 3.6 Lo que llega por WhatsApp desde un restaurante

- **Audios.** Los clientes de un restaurante mandan notas de voz. Hoy se
  responde con cortesía pidiendo texto; está bien para arrancar. Transcribirlos
  es un nodo más y un costo de modelo, para después.
- **Ubicación.** Para el delivery, el tipo `location` ya se normaliza. Que el
  prompt la pida como alternativa a escribir la dirección.
- **Fuera de horario.** El asistente sabe la hora de La Paz y el horario del
  restaurante; que tome el pedido para la próxima apertura o lo diga, pero que
  no mande el QR de un pedido que nadie va a preparar.
- **El cliente que paga y se arrepiente**, o manda el comprobante de otro
  pedido. Por eso la confirmación la da una persona, y por eso Cobros registra
  quién marcó cada pago.

### 3.7 Operación: quién mira qué

- **Recepción humana obligatoria**: la consola no envía mensajes (`Analisis/13`
  §5). Quien recibe el aviso contesta desde el WhatsApp actual del restaurante.
- **Un flujo de error en n8n** que avise a NovuChat cuando una ejecución falla,
  y `ver-ejecuciones.sh` cada mañana la primera semana. Con un cliente real, una
  ejecución fallida es un pedido perdido.
- **Respaldo diario de la VM** ya existe; verificar que el flujo de Q'Taco y sus
  credenciales están en él (la `N8N_ENCRYPTION_KEY` es lo que permite
  restaurarlas).
- **Modelo:** el arquitectura dice Gemini en demos y Claude en producción. Para
  el primer cliente, arrancar con el que pasó la suite de aceptación, y cambiar
  el sub-nodo solo con la suite corrida contra el nuevo. El costo del cambio es
  un 7 %; la calidad se prueba, no se supone.

---

## 4. El contrato y la ficha: lo que hay que dejar escrito

De la propuesta, corregir antes de firmar:

| Dice la propuesta | Corregir a |
|---|---|
| «carga de catálogo XML» | «carga del menú completo en la consola y publicación del catálogo web» |
| «envía su código QR para procesar el pago» | «envía el QR del restaurante; el restaurante confirma cada pago contra su banco» |
| «configuración de 3 flujos simultáneos» | está bien como lenguaje comercial; internamente es un flujo con tres intenciones |
| «Confirma la disponibilidad para asegurar el espacio» | en versión 1: «registra la solicitud y el restaurante la confirma» |

Y agregar, porque son las reglas de `CLAUDE.md` y la base comercial:

- **Qué es una conversación** (ventana de 24 h por teléfono, hasta 25 respuestas)
  y qué pasa al llegar al tope: una respuesta fija y aviso a recepción. Ya está
  en la propuesta; que quede en el contrato.
- **Precio en USD, cobro en Bs al TCO del BCB del día del pago**, y el TCO
  aplicado se registra en cada pago.
- **El plan se revisa con la medición del primer mes** (mensajes por
  conversación, conversaciones nacidas de anuncios).
- **El número es del cliente**, el PIN se le entrega por escrito, y NovuChat
  opera como socio del portafolio.
- **Quién confirma un pago:** el restaurante, contra su banco. El asistente
  informa que llegó un comprobante y si coincide. Nada más.
- **Retención de conversaciones: 12 meses.**
- **Suspensión por falta de pago:** no prometerla por escrito hasta cerrar la
  brecha 6.

Ficha de alta (además de `Analisis/13` §6, adaptada a un restaurante):

- Menú completo con precios, en la planilla de la consola; qué platos **no** se
  venden por chat.
- Costo de delivery (fijo o por zona) y zonas que cubre; tiempo de cocina;
  modalidades (delivery, recojo, salón).
- QR de cobro del restaurante con vigencia larga, titular y número de cuenta.
- Horario por día; política de reservas (anticipación mínima, tamaño máximo de
  grupo, cuánto se espera al cliente).
- Celular de recepción (el WhatsApp actual), correo del administrador de la
  consola y del operador de cocina.
- Cuenta personal de Facebook del dueño, datos completos del portafolio, el
  chip y dos horas y media.

---

## 5. Orden de trabajo sugerido

Sin fechas, porque dependen del cierre; en el orden que evita rehacer.

1. **Corregir la propuesta** (§4) y cerrar con Q'Taco. Entregar la ficha.
2. **Día 1 con el cliente: Meta** (§2), incluidas las plantillas utility, que
   son lo que más espera.
3. **Plataforma:** `alta-comercio.mjs --flujos venta`, alias de secreto,
   `asignarNumero`, carga del menú, QR real, catálogo web publicado. Cero
   código.
4. **Flujo `Flujos/qtaco-restaurante.json`**, copia del B con: `Config base`
   del restaurante; avisos por plantilla (§3.1); reserva de mesas versión 1;
   cobro real sin rótulos, con reenvío del comprobante al restaurante; lectura de
   `referral`; descarte por id de mensaje. Cada cambio declara mensajes que
   agrega o quita. Publicar con `publicar-flujo.sh` desde el JSON versionado.
5. **Tope de 25 y brecha 6** (§3.5), antes del 01/10 y antes del primer cobro.
6. **Aceptación** desde los celulares del restaurante: pedido con delivery,
   pedido con recojo, Promo Dúo con carnes, reserva, comprobante, cuatro
   mensajes en ráfaga, un audio, «¿eres un robot?», cambiar un precio en la
   consola y preguntarlo, y **el aviso llegando al celular del restaurante sin
   que ese celular haya escrito antes**. Reportar el resultado real.
7. **Primer mes:** medir mensajes por conversación y conversaciones nacidas de
   anuncios. Con eso se decide la versión 2 de reservas, el OCR del comprobante y
   si la ventana gratuita se puede prometer a los siguientes clientes.
8. **Después, y en paralelo:** guardar el `media id` y el pedido conversado como
   pedido (§1.2), para que Pedidos y Cobros dejen de avisar que les falta el
   dato; mensajes del mes contra los 1.000 gratis en la consola.

Lo que **no** conviene hacer con Q'Taco: el flujo con varios disparadores
(`Analisis/20`, nivel 2), la verificación de negocio como requisito, migrar su
número actual, o arrancar el Tech Provider porque «ya hay un cliente». El Tech
Provider se empieza sí, pero como trámite de NovuChat con NIT propio, en su
propia pista.
