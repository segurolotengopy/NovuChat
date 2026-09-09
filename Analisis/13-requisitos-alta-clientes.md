# Requisitos para activar el flujo de reservas en un cliente real

> **Actualizado:** 2026-09-07 (mañana del congelamiento). Reemplaza la versión
> del 06/09: entre medio, **la consola dejó de ser una maqueta** y cuatro de las
> ocho brechas que este documento listaba quedaron cerradas.
>
> **Alcance:** solo el flujo de **reservas y citas**
> (`Flujos/demo-a-agendamiento.json` + `demo-a-recordatorios.json`), que es lo
> que se ofrece a los primeros clientes. Pedidos y cobro queda para después, y
> el cobro real todavía no lo ejecuta ningún flujo.
>
> **Para qué sirve:** saber, antes de sentarse con el primer cliente, qué hay
> que pedirle, qué opciones tiene, cuál conviene ofrecerle en cada caso y qué
> tiene que hacer NovuChat. Está escrito contra lo que **existe hoy** en Meta,
> en n8n y en la consola. Donde la landing promete más de lo que se entrega, se
> dice (§9).
>
> No contiene secretos ni identificadores.

---

## 0. Las decisiones, resumidas

| Tema | Recomendación para los primeros clientes | Por qué, en una línea |
|---|---|---|
| **Número de WhatsApp** | **Chip nuevo** (15 Bs), comprado y registrado **a nombre del cliente**, dedicado al asistente. Incluido en la instalación. | El número actual del negocio sigue en manos de una persona; la consola **no puede responder** mensajes, solo leerlos. |
| **Migrar el número actual** | **No, por ahora.** | Registrarlo en la Cloud API lo saca de la aplicación para siempre y nadie podría contestar a mano. La coexistencia app + API la da Meta solo vía Embedded Signup de un Tech Provider, que no somos. |
| **«Te damos un número de nuestra cuenta»** | **Evitarlo.** Solo como piloto corto y con salida pactada. | Un nombre comercial ajeno bajo la cuenta verificada de NovuChat viola la política de representación de Meta; una sanción cae sobre todos los clientes a la vez. |
| **Dónde vive el número en Meta** | **Portafolio comercial, app y WABA del cliente.** NovuChat lo configura con el cliente al lado, con la misma guía de 11 bloques que ya funcionó dos veces. | Sin App Review, sin Tech Provider, un webhook por cliente que cae directo en su flujo de n8n. |
| **Verificación de negocio del cliente** | **Opcional al inicio.** | Sin verificar puede tener hasta 2 números y 250 conversaciones iniciadas por el negocio por día: los recordatorios de un salón no se acercan a eso. |
| **Google Calendar** | El cliente **comparte** sus calendarios (uno por persona que atiende) con la cuenta de Google de NovuChat, con permiso de editar. | Un minuto desde su celular, sin pantallas de consentimiento, revocable por él. |
| **Recepción humana** | **Obligatoria**: un celular del negocio, distinto del chip, que recibe los avisos del asistente. | Es la única salida cuando el asistente deriva; la consola no envía mensajes. |
| **Consola** | **Se entrega y ya manda de verdad.** Lo que el cliente cambia ahí —precios, horarios, servicios, quién atiende, la voz del asistente— llega al asistente. | Desde la madrugada del 07/09 los tres flujos leen `configuracionFlujo`, y se probó en vivo: se cambió el precio del corte y el asistente lo dijo por WhatsApp. |

**Tiempo real de un alta con todo listo:** una jornada de trabajo de NovuChat
(2,5 h con el cliente para Meta, 2 h a solas para plataforma, n8n y carga en la
consola, 1 h de pruebas) más dos esperas de Meta que no dependen de nadie: la
revisión del nombre para mostrar y la aprobación de la plantilla del
recordatorio (minutos a un día). **48 horas es realista si el cliente llega con
la ficha del §6 completa.** Si llega sin la lista de servicios o sin
calendarios, las 48 horas empiezan cuando los entrega.

---

## 1. Punto de partida: lo que existe hoy

**En Meta.** Dos apps de prueba (`NovuChat-Demo-A`, colgada de la WABA
compartida con WhatsApp-Modular, y `NovuChat-Demo-B`, en el portafolio propio
`NovuChat`), cada una con un número de prueba que solo responde a 5
destinatarios registrados. Ninguna sirve para un cliente: **prohibición 6**.
La cuenta de Andres tiene tres portafolios (NovuChat, AAB1 y Segurolotengo).
AAB1 está verificada y tiene un número +591 propio, pero es de **otro producto
en producción**: no se toca (prohibición 5). La plantilla
`recordatorio_cita_manana` está aprobada en la WABA compartida, no en la del
portafolio NovuChat: cada cliente necesita la suya en su propia WABA.

**En n8n.** Tres flujos publicados y activos: agendamiento, recordatorios (cron
17:00) y venta. **Los tres leen su configuración del panel** con esta cadena:

```
¿Es un mensaje? → Config base → Traer configuración → Config del negocio → …
                  (respaldo)    (HTTP al panel, 4 s)   (fusiona: la consola pisa)
```

Falla hacia atrás: si el panel no contesta, se usan los valores escritos en
`Config base`, así que el peor caso es el comportamiento anterior y nunca un
asistente sin catálogo. Un campo vacío en la consola tampoco borra el
respaldo. Sigue habiendo **un flujo por número**: no hay enrutador que reparta
un webhook entre negocios, y eso quedó pendiente sin fecha.

**En la plataforma.** El alta de un cliente real ya es posible, que hasta el 06
no lo era. `alta-comercio.mjs` crea el negocio y su administrador con una clave
aleatoria que nadie ve y un enlace de restablecimiento —que además verifica el
correo, como exigen las reglas—. Hay **veinte alias de secreto declarados**
(`cliente01` … `cliente20`), cada uno con su valor real desde el primer día, así
que dar de alta a un cliente ya no exige tocar código ni desplegar Functions. El
procedimiento de plataforma está en `admin/DISENO.md` §6.1.

### Lo que sigue condicionando el alta

1. **La consola no envía mensajes.** El visor es de solo lectura (DISENO §10).
   Si el asistente deriva a una persona, esa persona contesta desde **otro**
   número. Es lo que sostiene la recomendación del chip y de la recepción
   humana, y es la única de las cuatro restricciones del 06/09 que sigue viva.
2. **El respaldo del flujo todavía es el del demo.** `Config base` conserva
   «Salón & Clínica Demo NovuChat» con su catálogo y su voz. En la copia del
   flujo de un cliente hay que reemplazarlo por los valores de ese cliente: si
   no, el día que el panel no conteste, el asistente de una clínica dental
   atiende como el salón del demo. Es un paso del alta, no un defecto del
   código (§7, paso 11).
3. **Suspender a un comercio no le corta el asistente.** Ver §8: es un defecto
   encontrado al escribir esta actualización, y toca el control comercial que
   sostiene el cobro mensual.

---

## 2. El número de WhatsApp: tres opciones

| | **A · Chip nuevo dedicado** | **B · Migrar el número actual** | **C · Número de NovuChat** |
|---|---|---|---|
| **Para el cliente** | Compra un chip de 15 Bs (o NovuChat se lo entrega) registrado a su CI. Publica el número nuevo: «para reservar, escríbenos al 7…». Mantiene su WhatsApp de siempre. | Borra la cuenta de WhatsApp de su número desde la app (desinstalar no alcanza). Desde ahí **nadie del negocio puede escribir ni leer por ese número desde un celular**. | Nada: escribe a un número que no es suyo. Si se va, no se lo lleva. |
| **Para NovuChat** | Registrar el número en la WABA del cliente (SMS o llamada al chip, PIN de 6 dígitos). | Igual que A, más el riesgo de la transición: el número deja de recibir mientras Meta lo registra, y quien escribía a un humano recibe a un asistente. | Registrar un número ajeno en el portafolio de NovuChat con un nombre para mostrar que no es NovuChat. |
| **Riesgos** | El chip prepago se desactiva si pasa meses sin recarga y la operadora recicla el número. Se mitiga con una recarga mínima cada 2–3 meses, anotada en la ficha. | **Irreversible** en la práctica. La landing promete «podemos conectar el tuyo»: hoy es técnicamente cierto y operativamente dañino. | Política de representación de Meta; una sanción por calidad tumba a todos los clientes; Meta factura a la tarjeta de NovuChat; el cliente no es dueño de su canal. |
| **Veredicto** | ✅ **Recomendado para todos los primeros clientes.** | ⛔ No, hasta que la consola pueda responder. | ⚠️ Solo piloto corto con fecha de salida. |

### Lo que hay que saber del chip (opción A)

- **A nombre del cliente.** En Bolivia el chip se registra con el carnet del
  titular; que sea el dueño del negocio, no Andres. Si NovuChat lo compra, se
  registra igual a nombre del cliente y se le entrega con recibo. Es su canal:
  si mañana se va, se lleva el número.
- **Nunca instalar WhatsApp en ese chip.** Ni la app normal ni Business. Un
  número virgen se registra en minutos; uno que tuvo cuenta hay que liberarlo
  borrándola y esperar. Foto de perfil, descripción y dirección se cargan desde
  WhatsApp Manager, no desde una app.
- **El chip hace falta físicamente una sola vez**, para recibir el SMS o la
  llamada de Meta. Después puede quedar en un cajón del negocio, en un celular
  básico. Conviene que lo guarde el cliente.
- **Mantenerlo vivo:** recarga mínima cada 2–3 meses, con fecha en la ficha.
- **El PIN de dos pasos** va al gestor de contraseñas de NovuChat **y** al
  cliente por escrito. Perderlo es un ticket a Meta de semanas.
- **Su número actual no se toca.** En su WhatsApp Business pone un mensaje de
  bienvenida que diga «para reservar, escríbenos al [número nuevo]». Ese número
  es, además, el de recepción (§5).

---

## 3. Dónde vive el número en Meta

| Opción | Cómo funciona | Veredicto |
|---|---|---|
| **1 · Portafolio, app y WABA del cliente** | El dueño crea su portafolio en `business.facebook.com` con NovuChat al lado; se crea una app y una WABA ahí; se agrega el chip; el webhook de esa app apunta al flujo del cliente en n8n. NovuChat opera con un usuario de sistema **del portafolio del cliente**. | ✅ **Para los primeros clientes.** Sin App Review ni Tech Provider. Es la guía de 11 bloques ya ejecutada dos veces, con dos agregados: número real en vez de número de prueba, y tarjeta. |
| **2 · WABA del cliente bajo el portafolio de NovuChat** | NovuChat crea una WABA por cliente en su propio portafolio. | ⛔ Mismo problema que la opción C del §2. |
| **3 · Tech Provider + Embedded Signup** | Botón «Conectar WhatsApp» en `novuchat.site`; Meta crea portafolio y WABA del cliente en 5 minutos y la comparte con la app de NovuChat. Habilita la coexistencia app + API. | 🔜 **El destino a escala.** Exige NovuChat verificada (NIT propio, en trámite), app en Live con condiciones del servicio, App Review con acceso avanzado, y **un enrutador en n8n**. Semanas. |

### Qué necesita el cliente para la opción 1

- **Una cuenta personal de Facebook del dueño**, activa. Meta exige una persona
  para crear portafolios y apps. Si el dueño no tiene o no quiere, puede ser un
  socio de confianza: es quien queda como propietario del canal.
- **Datos del negocio completos**: nombre comercial, dirección, correo y, a ser
  posible, web o red social. Meta se niega a crear activos sobre un portafolio
  incompleto y **no dice por qué** (hallazgo del 30/08: «Tu cuenta no se pudo
  crear»).
- **El chip a mano** para el código de registro, y el celular de recepción para
  las pruebas.
- **El nombre para mostrar**, una foto de perfil cuadrada, la categoría y una
  descripción de dos líneas. Un nombre que coincida con el nombre comercial
  pasa sin revisión o en horas.
- **La política de privacidad de la app**: se usa `novuchat.site/privacidad`,
  que ya describe el tratamiento por WhatsApp y Meta.
- **Permisos para NovuChat en ese portafolio**, y conviene de las dos formas:
  Andres como **administrador** solo mientras dura el alta, y el **portafolio
  NovuChat como socio** con acceso a la WABA y a la app para la operación de
  largo plazo. Así la cuenta personal de Andres no es el punto único de falla.

### Verificación de negocio del cliente: cuándo sí

No hace falta para arrancar. Sin verificar, el negocio tiene hasta **2 números
por WABA** y **250 conversaciones iniciadas por él por día** (las que inicia el
cliente final no cuentan). Hace falta cuando quiera más de dos números, cuando
pase de 250 recordatorios diarios, o para la tilde verde, que Meta otorga a su
criterio. Lo aprendido en AAB1: NIT o Matrícula de Comercio, factura de
servicios de los últimos 90 días, y **nombre legal y dirección en el mismo
documento**, iguales carácter por carácter a los del portafolio. La factura de
celular no sirve; un rechazo cuesta una o dos semanas.

### Quién paga a Meta, y cuánto

- Las conversaciones que **inicia el cliente final** (todo el flujo de reservas)
  no tienen costo en Meta desde fines de 2024.
- Los **recordatorios** son plantillas iniciadas por el negocio fuera de la
  ventana de 24 h: se cobran por mensaje según la tarifa de Bolivia. Un salón
  con 15 citas por día son unos 450 recordatorios al mes.
- Para enviarlos, la WABA del cliente **necesita un método de pago**. Meta
  factura **por WABA**. Como el plan incluye el costo de WhatsApp, lo práctico
  es que la tarjeta de NovuChat quede como método de pago de esa WABA, con
  alerta de gasto. **Verificar en el primer alta** que Meta acepte la misma
  tarjeta en varias WABA de distintos negocios; si no, el cliente pone la suya
  y se descuenta del plan.
- Descargar la tarjeta de tarifas de esa WABA y confirmar la tarifa `utility`
  de Bolivia antes de prometer nada por escrito.

---

## 4. Google Calendar: tres opciones

| | **G1 · OAuth con la cuenta del cliente** | **G2 · El cliente comparte sus calendarios** | **G3 · NovuChat crea los calendarios** |
|---|---|---|---|
| **El cliente** | Se sienta con Andres, Andres abre la credencial en n8n, el cliente escribe su contraseña de Google y acepta. Ve el aviso «Google no ha verificado esta aplicación». | Desde su celular: Calendario → el de cada persona → Compartir con la cuenta de NovuChat → «Hacer cambios en eventos». Un minuto. | Nada. Recibe una invitación por calendario. |
| **NovuChat** | Una credencial `Google Calendar OAuth2 API` por cliente, creada desde el nodo, con el cliente OAuth propio de n8n. | Anota los IDs en la consola y usa **una sola** credencial de NovuChat en todos los flujos. | Crea un calendario por persona en la cuenta de NovuChat y los comparte con edición. |
| **El dato** | En la cuenta del cliente. NovuChat no lo ve fuera de n8n. | En la cuenta del cliente, pero NovuChat tiene escritura y ve los eventos, con el teléfono del cliente final en la descripción. | En la cuenta de NovuChat. El cliente no es dueño de su agenda. |
| **Riesgos** | Si el cliente cambia la contraseña o revoca, la cita falla con el flujo en verde (ya pasó el 06/09). Tope de 100 usuarios mientras Google no verifique la app. | Menos aislamiento entre clientes: una credencial alcanza a todos. Hay que decirlo en el contrato. | Al irse, el cliente pierde la agenda. |
| **Veredicto** | ✅ Para quien ya vive en Google Calendar y no quiere compartir. | ✅ **Recomendado como defecto.** | ⚠️ Solo si no usa Google Calendar; mejor en una cuenta nueva del cliente. |

En cualquiera de las tres, **todos los calendarios de un negocio tienen que ser
alcanzables desde la misma credencial**, y eso se verifica en el alta creando y
borrando un evento de prueba en **cada** calendario; no cuando un cliente
reclame. Pedir **un calendario secundario por persona que atiende** («Agenda
María»), nunca el principal de la cuenta.

---

## 5. Recepción humana

El asistente deriva en cuatro situaciones: tercer rechazo de horarios, falla de
una herramienta, cita que no se pudo verificar, y cancelación que no encuentra.
En todas manda un aviso a `numeroRecepcion`. Como la consola no envía mensajes,
**esa persona tiene que poder escribirle al cliente final desde su propio
WhatsApp**, que es otro número. Por eso:

- `numeroRecepcion` es **obligatorio** y distinto del chip: normalmente el
  WhatsApp actual del negocio.
- Debe ser boliviano (`prefijosPermitidos: 591`) y un celular que alguien mira
  en horario de atención.
- Se le explica al cliente que el aviso trae el número del cliente final y lo
  último que pasó, y que la conversación sigue desde su WhatsApp.

---

## 6. La ficha de alta: lo que se le pide al cliente

Casi todo esto se carga **en la consola**, que es de donde el asistente lo lee.

**Identidad y voz**

- [ ] Nombre comercial (nombre para mostrar en WhatsApp) y descripción de dos líneas de qué hace el negocio.
- [ ] Dirección exacta. Si se deja vacía, el asistente sabe que no la tiene y lo dice; **no la inventa**.
- [ ] Horario de atención por día. La consola lo agrupa sola: «lunes a sábado, de 09:00 a 19:00; domingo: cerrado».
- [ ] Trato (tuteo o usted) y estilo de emojis. Son opciones cerradas de la consola, no texto libre.
- [ ] Política de cancelación en una frase.
- [ ] Foto de perfil cuadrada y categoría del negocio (esto va en Meta, no en la consola).

**Servicios y personas**

- [ ] Servicios con **nombre definitivo**: el nombre no se puede editar después, porque los funcionarios guardan la referencia. Cambiarlo es dar de baja y cargar de nuevo.
- [ ] Precio en Bs de cada uno. **Dejarlo vacío significa «se cotiza»** —es lo correcto para un tratamiento dental—; cero significa gratis. El asistente cotiza en el chat lo que tiene precio y ofrece evaluación para lo que no.
- [ ] Duración de cada servicio **en múltiplos de 15 minutos**. Con 50 minutos quedan huecos de 10 que no se venden y el asistente propone horarios como «14:50».
- [ ] Personas que atienden, con el nombre tal como quieren que el asistente las nombre, y qué servicios hace cada una.
- [ ] Un calendario de Google **por persona**, compartido según §4, con su ID.

**Número y Meta**

- [ ] Chip nuevo registrado a nombre del dueño, sin WhatsApp instalado, con saldo.
- [ ] Cuenta personal de Facebook del dueño, o de quien será propietario del canal.
- [ ] Datos completos del portafolio: nombre, dirección, correo, web o red social.
- [ ] Dos horas y media con NovuChat, con el chip y el celular de recepción a mano.

**Recepción y consola**

- [ ] Celular de recepción (el WhatsApp actual del negocio), formato internacional.
- [ ] Correo del administrador de la consola y, si quiere, de un operador. **Tiene que ser una casilla a la que acceda de verdad**: el alta le manda un enlace para poner su contraseña, y completarlo es lo que verifica el correo.
- [ ] Dos o tres celulares para las pruebas de aceptación.

**Comercial y legal**

- [ ] Plan elegido (Impulso: una persona, una agenda; Crecimiento: varias personas y recordatorio automático).
- [ ] Aceptación de `novuchat.site/terminos`, del acceso al calendario según §4 y de la retención de conversaciones, ya decidida en **12 meses**.
- [ ] Datos de facturación.

---

## 7. Lo que hace NovuChat, en orden

**Día 1, con el cliente (2 h 30, la guía de Meta bloque por bloque en SU cuenta)**

1. Portafolio comercial del cliente completo. Invitar a Andres como administrador y al portafolio NovuChat como socio.
2. App `<Negocio>-Asistente` en ese portafolio; App ID y App Secret al gestor. Sin la palabra «WhatsApp» en el nombre.
3. Producto WhatsApp → WABA del cliente. **Agregar el número real**: el chip recibe el código; fijar el PIN de 6 dígitos; nombre para mostrar; perfil.
4. App en **Live** con `novuchat.site/privacidad`.
5. Usuario de sistema del portafolio del cliente, token **sin vencimiento** con los dos permisos; `debug_token` debe mostrar la app del cliente.
6. `subscribed_apps` sobre la WABA del cliente. Solo la app del cliente en la lista.
7. Método de pago en la WABA y alerta de gasto. Descargar tarifas.
8. Crear la plantilla `recordatorio_cita_manana` en la WABA del cliente (utility, es, 3 variables) y dejarla en revisión.

**Día 1 o 2, a solas (≈2 h)**

9. **Plataforma**, tres pasos sin código ni despliegue (`admin/DISENO.md` §6.1):
   `alta-comercio.mjs --tenant … --flujos agendamiento --admin … --aplicar`;
   tomar el valor del **alias libre que sigue** (`cliente01`, `cliente02`, …) y
   cargarlo como credencial de cabecera en n8n; `asignarNumero` desde la consola
   con el `phone_number_id` y la WABA del cliente, más `aliasSecreto` en
   `/rutasWhatsApp/{numero}`.
10. **Cargar la ficha del §6 en la consola.** Es lo que el asistente va a leer:
    identidad, horarios, catálogo con precios y duraciones, funcionarios con su
    calendario, voz y mensajes.
11. **n8n.** Copia del flujo de agendamiento y del de recordatorios con el
    nombre del cliente, vía `preparar-import.sh`. Corregir `Trigger On` a mano.
    **Reemplazar los valores de `Config base` (y `Config base del
    recordatorio`) por los del cliente**: son el respaldo si el panel no
    contesta, y hoy traen los del demo. Credenciales nuevas: WhatsApp Trigger,
    WhatsApp API, cabecera de la configuración, HMAC de cierres e ingesta, y
    Calendar según §4. Gemini es la compartida. Publicar.
12. Webhook de la app del cliente → URL de **Production** del WhatsApp Trigger;
    campo `messages`. `verificar-meta.sh` con las variables del cliente: cuatro
    verdes.
13. Prueba de escritura en **cada** calendario (crear y borrar un evento) con la
    credencial que va a usar el flujo.

**Pruebas de aceptación (≈1 h, desde los celulares del cliente)**

14. Suite A1–A8 de `Demo-Recursos/checklist-ensayo.md` contra el número real,
    con dos celulares a la vez, más: cancelar una cita, un audio y un sticker,
    «¿eres un robot?», y **el aviso llegando al celular de recepción**. Un
    número real no tiene el límite de 5 destinatarios.
15. **La prueba que va a hacer el cliente solo:** cambiar un precio en la
    consola y preguntarlo por WhatsApp. Tiene que contestar el nuevo. Ojo con
    hacerlo dentro de una conversación abierta: la memoria guarda ocho turnos y
    el modelo puede repetir su propia respuesta anterior. El prompt ya lo cubre;
    conviene verificarlo igual, porque es exactamente lo que hace un cliente
    probando.
16. Dejar una cita para el día siguiente y confirmar a las 17:00 que el
    recordatorio salió solo (`ver-ejecuciones.sh --env`).
17. Entregar: acceso a la consola, el PIN por escrito, la fecha de la próxima
    recarga del chip, y la explicación de qué cambia solo desde la consola y qué
    sigue pasando por NovuChat (el número, los calendarios y la plantilla).

---

## 8. Brechas: lo cerrado y lo que queda

**Cerradas entre la noche del 06 y la mañana del 07 de septiembre**

| # | Brecha | Cómo se cerró |
|---|---|---|
| 1 | Alias de secreto sin desplegar | Veinte alias declarados (`cliente01`…`cliente20`), cada uno con secreto propio y valor real desde el primer día. Dar de alta ya no toca código. |
| 2 | Alta del administrador de un comercio real | `alta-comercio.mjs`: clave aleatoria que nadie ve, enlace de restablecimiento, y el correo queda verificado al completarlo. **Era el bloqueo de verdad**: sin esto el alta era imposible, no incómoda. |
| 3 | Catálogo y reglas fuera del prompt | Cayó sola al conectar la consola. El System Message ya no tiene ni un precio ni un nombre de servicio; las reglas se parten por **precio** y no por rubro, que es lo genérico. Queda reprobar la suite A. |
| 4 | El flujo no lee la consola | Los tres flujos leen `configuracionFlujo` con respaldo. Probado en vivo. Es lo que vuelve verdadera la promesa de `/precios`. |
| 5 | Política de retención | Decidida: **12 meses**. Falta el código de la purga. |

**Abiertas**

| # | Brecha | Tiempo | Cuándo |
|---|---|---|---|
| 6 | **Suspender un comercio no le corta el asistente** (ver abajo) | 1 h con pruebas | Antes del primer cliente que pague |
| 7 | El respaldo de los flujos es el del demo | Es un paso del alta (§7.11), no código | En cada alta |
| 8 | Compuerta de reserva: el límite de 50 eventos | Se resuelve con dos consultas dirigidas, no subiendo el límite | Después de las demos |
| 9 | Migrar la ingesta al rol `ingesta` | Medio día a un día | Antes del segundo cliente |
| 10 | Código de la purga de retención a 12 meses | Medio día | Después de las demos |
| 11 | Verificación de NovuChat con NIT propio y App Review | Semanas, casi todo espera de Meta | **Empezar ya**: es el camino a Embedded Signup y a «conecta tu número» |

### La brecha 6, en detalle

`ESTADO.md` dice que `estadoComercio` manda siempre desde el panel y que
suspender a un comercio en la consola le corta el servicio. **Leyendo el código,
no ocurre**, y la cadena es esta:

1. Para un comercio no activo, `configuracionFlujo` responde **409** con
   `{estado, mensajeCortesia}` — **sin `tenantId`**.
2. En n8n, `Traer configuración` tiene `onError: continueRegularOutput`, así que
   el 409 no corta el flujo.
3. Los dos nodos de fusión (`Config del negocio` y `Config del recordatorio`)
   exigen `typeof r.tenantId === 'string'` para dar por buena la respuesta. Un
   409 no lo trae, así que **caen al respaldo**.
4. En el respaldo, `estadoComercio` vale `"operativo"`, escrito a mano.
5. `¿Comercio operativo?` compara contra `"operativo"` y **deja pasar**.

Consecuencia: un comercio suspendido **sigue siendo atendido** por el asistente
y **sigue enviando recordatorios, que Meta cobra**, que es justo el defecto que
la conexión del panel decía haber cerrado. La corrección es chica —que el nodo
acepte el cuerpo del 409 y trate una respuesta con `estado` como suspendida, en
vez de confundirla con «el panel no contestó»— pero distingue dos casos que hoy
son el mismo: *el panel dijo que está suspendido* y *el panel no dijo nada*.
Solo el segundo debe caer al respaldo.

**No entra antes del congelamiento.** Ningún cliente paga todavía, así que no
hay nada que cortar; y tocar los tres flujos a un día de las demos es
exactamente lo que la regla del congelamiento evita.

---

## 9. Qué decir en la oferta

| Dice hoy `novuchat.site` | Situación real | Qué ofrecer |
|---|---|---|
| «Tu número de WhatsApp, o te damos uno de nuestra cuenta verificada» | Conectar el actual deja al negocio sin poder contestar a mano; darle uno de la cuenta de NovuChat es un riesgo de política. | «**Un número nuevo para tu asistente**, a tu nombre, que conseguimos y configuramos nosotros. Tu WhatsApp de siempre sigue igual y es donde te avisamos cuando alguien necesita una persona.» Chip incluido. |
| «Podemos conectar el tuyo si es WhatsApp Business» | Técnicamente posible, operativamente dañino hasta que la consola envíe o exista coexistencia. | Reservarlo para más adelante; no ofrecerlo a los primeros clientes. |
| «Verificación oficial de tu número ante Meta» | Se cumple con el registro del número y la revisión del nombre para mostrar. La verificación de negocio es del cliente y opcional al inicio. | Mantener la frase y explicar en la reunión qué incluye. Ofrecer acompañar la verificación de negocio como extra. |
| «Mira las conversaciones, cambia horarios y precios y controla todo desde el celular» | **Verdadero desde el 07/09** y probado en vivo. | Decirlo sin matices, y **demostrarlo**: cambiar un precio delante del cliente y preguntarlo por WhatsApp es la mejor demostración que tiene el producto. |
| «Recordatorio automático 24 horas antes» | Funciona; exige plantilla aprobada en la WABA del cliente y método de pago. Se le corrigieron tres defectos el 06/09 y la corrida completa se ve hoy a las 17:00. | Ofrecerlo solo con Crecimiento y confirmarlo en la entrega con una cita real. |
| «Instalación en 48 horas desde que tenemos tu información» | Realista con la ficha completa y la sesión de Meta el primer día. | Entregar la ficha en la reunión de análisis y contar las 48 horas desde que vuelve completa. |
| «Nadie de NovuChat lee tus conversaciones sin que tú abras el acceso» | Cierto para la consola. Con la opción G2 de calendario, la cuenta de NovuChat sí ve los eventos de la agenda. | Decirlo y dejarlo elegir entre G1 y G2. |
| «Se suspende el asistente, pero conservas tus datos» (falta de pago) | **Hoy no se suspende**: ver la brecha 6. | No prometerlo por escrito hasta cerrar la brecha 6. Es de una hora de trabajo y ningún cliente paga todavía. |

**Recomendación por plan para el flujo de reservas:**

- **Impulso (250 Bs, 300 conversaciones):** una persona, un calendario, sin
  recordatorio automático. Chip incluido.
- **Crecimiento (450 Bs, 1.000 conversaciones):** varias personas con agenda
  propia, recordatorio a las 17:00, aviso a recepción. Es el plan que el flujo
  actual ilustra mejor; recomendarlo a salones y consultorios con más de una
  persona.
- **Instalación (800 Bs, bonificada a los diez primeros):** chip, sesión de Meta
  con el cliente, calendarios, carga de la ficha en la consola y pruebas con sus
  celulares. No incluye la verificación de negocio de Meta.
