# Una capa agnóstica de mensajería: WhatsApp, Messenger, Instagram, Telegram y los que vengan

**17-sep-2026.** Pedido de Andres: analizar el **modelo de negocio** de una
capa de mensajería independiente del canal —los chats llegan desde WhatsApp,
Messenger, Telegram u otros, se construye un conector por canal y **el resto
(agente, memoria, agenda, cobro, consola) no se toca**—. Costos con las
tarifas de `Analisis/14`; la unidad de cobro de `CLAUDE.md` §2; lo que hoy
está acoplado a WhatsApp, leído en `admin/functions/src/index.ts` e
`ingesta.ts` y en los flujos.

---

## 0. Conclusión

| | |
|---|---|
| **¿Tiene sentido de negocio?** | **Sí, y más de lo que parece:** WhatsApp es el único canal que cobra por mensaje. Messenger, Instagram y Telegram cuestan **cero** en plataforma. Una conversación por esos canales cuesta ~0,008 USD (solo el modelo) contra 0,126 por WhatsApp fuera de la franquicia: **el mismo precio de lista deja un 95 % de margen**. Cada canal que se agrega multiplica conversaciones facturables a costo marginal casi nulo |
| **Cómo se cobra** | **La misma unidad en todos los canales** —conversación de 24 h por contacto, bloque de 25 respuestas— y **los canales como diferenciador de plan**: Base, WhatsApp; Crecimiento, + Messenger e Instagram; Corporativo, + Telegram y chat web. Es el diferenciador que el bloque no podía ser (`CLAUDE.md` §2): al plan chico no le cuesta nada ser generoso con el bloque, pero un canal más **sí** es valor que el cliente reconoce y a NovuChat no le cuesta |
| **Por dónde empezar** | **Messenger e Instagram**: misma app de Meta, misma infraestructura de webhooks, mismo portafolio; en Bolivia Facebook es la red donde viven las PyMEs y sus anuncios. Telegram al final: en Bolivia es marginal. Un **chat web** propio antes que Telegram: es el canal más barato y el sitio ya tiene captación |
| **Lo que hay que cambiar** | Menos de lo que asusta: **la identidad del contacto** (`wa_<teléfono>` → `<canal>_<id>`), **el enrutamiento** (`/rutasWhatsApp/{phoneNumberId}` → `/rutas/{canal}/{id}`), y **el envío**, que hoy vive en el flujo con el token del cliente. Mover el conector fuera de n8n a una Function resuelve de paso el problema de `Analisis/20`: los tokens dejan de estar en n8n |
| **El riesgo** | Las reglas de ventana de Messenger e Instagram son **más estrictas** que las de WhatsApp para escribir después de 24 h: los recordatorios pasan (etiqueta de evento confirmado), el seguimiento de solicitudes pendientes y la reactivación **no** (sin anuncio pagado). Y Telegram no tiene teléfono: un contacto es un id, sin cruce con WhatsApp |
| **Esfuerzo** | **15 a 18 jornadas** en total: 4 la capa, 3 migrar WhatsApp adentro, 3 Messenger + Instagram (más 1–3 semanas de revisión de Meta), 3 chat web, 2 Telegram, 2 consola |

---

## 1. Lo que cuesta cada canal, por conversación

Conversación típica de 10 respuestas, con recordatorio en el 40 %:

| Canal | Costo de plataforma | Modelo | Recordatorio | **Total** | Con precio de lista 0,18 (neto 0,151): margen |
|---|---|---|---|---|---|
| **WhatsApp, fuera de la franquicia** | 0,113 | 0,008 | 0,0045 | **0,126** | 0,025 (17 %) |
| WhatsApp, dentro de la franquicia | 0 | 0,008 | 0,0045 | 0,013 | 0,138 (92 %) |
| **Messenger** | 0 | 0,008 | 0 (etiqueta gratuita) | **0,008** | 0,143 (95 %) |
| **Instagram** | 0 | 0,008 | 0 | **0,008** | 0,143 (95 %) |
| **Telegram** | 0 | 0,008 | 0 | **0,008** | 0,143 (95 %) |
| Chat web propio | 0 (hosting ya pagado) | 0,008 | — (sin canal de retorno) | 0,008 | 0,143 (95 %) |

Dos consecuencias de negocio:

1. **Cada conversación que llega por un canal que no es WhatsApp vale
   nueve veces más para NovuChat.** No hay que bajarle el precio: la lista
   se denomina por conversación, y el cliente compra conversaciones.
2. **La franquicia de 1.000 mensajes deja de ser el eje** para un comercio
   con dos o tres canales: WhatsApp sigue costando lo mismo, pero el
   promedio de la cartera baja. En `Analisis/21` §9, el «peor cliente»
   del plan Corporativo (500 conversaciones al tope) pierde 65 USD; con la
   mitad de sus conversaciones por Messenger pierde 8.

Lo que **no** cambia: Meta cobra los anuncios (clic a WhatsApp, clic a
Messenger) por subasta, y eso lo paga el comercio. El punto de entrada
gratuito de 72 h de WhatsApp tiene su equivalente en Messenger sin costo
alguno, porque Messenger no cobra nada.

---

## 2. Cómo se cobra: una unidad, canales por plan

### 2.1 La unidad no cambia

**Conversación = hasta 25 respuestas del asistente a un mismo contacto en la
ventana de 24 h desde su primera consulta**, en cualquier canal. La ventana
de 24 h **es nuestra**, no de WhatsApp: Telegram no tiene ventana y la
regla se aplica igual, porque la escribe `ingesta.ts` y no el canal. Lo
único que hay que decir en el glosario del sitio es que «contacto» es la
persona **en ese canal**: quien escribe por WhatsApp e Instagram el mismo
día son dos conversaciones, porque no hay forma honesta de saber que es la
misma persona (Instagram no da teléfono, Telegram tampoco).

### 2.2 Tres formas de cobrar los canales

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A. Canales por plan** | Base: WhatsApp. Crecimiento: + Messenger e Instagram. Corporativo: + Telegram y chat web. Todas las conversaciones cuentan igual | Diferenciador real que no erosiona margen; empuja al plan medio, que hoy es el de mejor relación (`Analisis/21`); una sola unidad | El plan chico queda «solo WhatsApp», que en Bolivia es lo que la mayoría necesita: no duele |
| B. Cargo por canal | USD 10 al mes por canal adicional | Margen puro, simple de explicar | Rompe «todo se cobra en conversaciones»; un cargo fijo por algo que cuesta cero se discute |
| C. Todo incluido | Cualquier canal en cualquier plan | Máxima simplicidad | Regala el único diferenciador nuevo que no cuesta; el plan chico con cuatro canales compite con el grande |

**Recomendación: A.** Y una regla que va con ella: **la instalación de un
canal adicional se cobra** (USD 30–65 según el canal, por el trabajo de
conectar la página o el bot), porque es tiempo de NovuChat aunque Meta no
cobre nada.

### 2.3 Lo que le pasa a los planes

Con canales por plan, el argumento de venta de Crecimiento pasa a ser
«te atendemos donde te escriban»: WhatsApp, Messenger e Instagram con el
mismo asistente, la misma agenda y el mismo catálogo. Para un salón que vive
de Instagram o una tienda que vende por Facebook, es el motivo para no
comprar Base. **El precio no se mueve**: USD 25 / 50 / 90.

---

## 3. Los canales, uno por uno: reglas que cambian el producto

| | WhatsApp (hoy) | Messenger | Instagram | Telegram | Chat web |
|---|---|---|---|---|---|
| **Costo por mensaje** | 0,0113 (servicio) | 0 | 0 | 0 | 0 |
| **Ventana para responder** | 24 h desde el último mensaje del cliente | 24 h | 24 h | Sin límite | Mientras la pestaña esté abierta |
| **Escribir después de la ventana** | Plantilla aprobada (utilidad 0,0113, marketing 0,074) | Solo con **etiqueta**: `CONFIRMED_EVENT_UPDATE` (recordatorio de cita ✔), `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`; lo comercial, solo con mensaje patrocinado (anuncio) | Igual que Messenger | Libre | No hay |
| **Recordatorio de cita 24 h antes** | ✔ plantilla de utilidad | ✔ gratis, con etiqueta | ✔ gratis | ✔ gratis | ✘ (se manda por otro canal o no se manda) |
| **Seguimiento de solicitud pendiente a las 24–48 h** (`Analisis/31`) | ✔ plantilla de utilidad | **✘** no hay etiqueta para eso | ✘ | ✔ | ✘ |
| **Reactivación (marketing)** | ✔ plantilla, 0,074 | ✘ salvo anuncio pagado | ✘ | ✔ (y el usuario puede bloquear) | ✘ |
| **Botones y listas** | Botones (3) y listas (10) | Respuestas rápidas (13), botones | Respuestas rápidas | Teclados en línea | Lo que se dibuje |
| **Identidad del contacto** | Teléfono | PSID por página (no es el teléfono) | IGSID | id de usuario | Anónima, o lo que el formulario pida |
| **Qué necesita el alta** | Chip, WABA, número, verificación de negocio | La **página de Facebook** del comercio concede permiso a la app de NovuChat (inicio de sesión de Facebook para empresas) | Cuenta profesional de Instagram **vinculada a la página** | El comercio crea un bot con BotFather y entrega el token, o NovuChat opera un bot por comercio | Un fragmento en el sitio del comercio |
| **Revisión de Meta** | Ya hecha para WhatsApp | `pages_messaging`, una vez por app; 1–3 semanas | `instagram_manage_messages`; misma revisión | No hay | No hay |
| **Presencia en Bolivia** | Dominante: es el teléfono | Alta: Facebook es la red de las PyMEs y de sus anuncios | Media, concentrada en belleza, moda y comida | Baja | Depende del sitio del comercio |

Tres cosas que salen de la tabla:

1. **Messenger e Instagram son «WhatsApp gratis con una ventana más dura».**
   Sirven perfecto para atender, agendar y recordar; **no sirven para
   perseguir** al que no terminó. El seguimiento de leads de `Analisis/31`
   queda como ventaja exclusiva de WhatsApp y Telegram, y eso hay que
   decirlo en la oferta.
2. **El alta por Messenger es más simple que por WhatsApp**: no hay chip, ni
   número, ni WABA, ni verificación. El comercio entra con su Facebook y
   autoriza la página. Es el camino natural para que un comercio **pruebe**
   NovuChat antes de meterse con un número de WhatsApp.
3. **Telegram es el más libre y el menos útil en Bolivia.** Se construye
   porque es barato (2 jornadas, sin revisión de nadie) y porque hay
   rubros —tecnología, servicios profesionales— donde aparece; no porque
   mueva la aguja.

---

## 4. Lo que está acoplado a WhatsApp, y qué se toca

Recorrido por el código para verificar la premisa «los conectores se arman y
el resto no se toca». Es casi cierta; hay tres puntos donde no.

| Pieza | Hoy | Con la capa | Se toca |
|---|---|---|---|
| **Disparador** | Nodo WhatsApp Trigger de n8n con la credencial (App ID + Secret) del cliente: **un flujo por cliente** (`Analisis/20`) | El conector recibe el webhook de cada canal, verifica la firma, deduplica, descarga medios y entrega un **mensaje normalizado** al flujo por un webhook genérico con el `tenantId` resuelto | Conector nuevo; el flujo cambia el disparador por un Webhook genérico |
| **Enrutamiento** | `/rutasWhatsApp/{phoneNumberId}` → tenant y flujo (`index.ts`) | `/rutas/{canal}/{identificadorExterno}`: phone_number_id, id de página, id de cuenta de Instagram, id de bot | **Sí**: generalizar la colección y `asignarNumero` → `asignarCanal` |
| **Identidad del contacto** | `wa_<teléfono>`: la memoria del agente, la conversación y el candado usan el teléfono (`ingesta.ts` 580, 929) | `<canal>_<id>`: `wa_591…`, `fb_<psid>`, `ig_<igsid>`, `tg_<id>`, `web_<uuid>`. La memoria de n8n usa la misma clave | **Sí**: un campo `canal` y un `contactoId`; el conteo no cambia |
| **Normalización de entrada** | `Normalizar entrada` en cada flujo, específica del payload de Meta | Se muda al conector; el flujo recibe siempre `{ canal, contactoId, tipo, texto, medios[], nombrePerfil, referral }` | El nodo del flujo se simplifica |
| **Envío** | Nodo WhatsApp de n8n con el token del cliente; el QR por HTTP con el token | Function `enviar(tenantId, contactoId, contenido)`: resuelve canal y credencial (Secret Manager), traduce botones/listas/ubicación/imagen a lo que el canal soporta, y **degrada** lo que no (una lista de 10 en Messenger se parte; un mensaje de tipo ubicación en Telegram es `sendLocation`) | **Sí, y es el cambio más valioso**: los tokens salen de n8n; un flujo puede servir a varios clientes |
| **Plantillas y recordatorios** | Flujo de recordatorios manda plantilla de utilidad | `enviar` con `tipo: 'recordatorio'`: WhatsApp → plantilla; Messenger → etiqueta `CONFIRMED_EVENT_UPDATE`; Telegram → texto | El flujo de recordatorios no cambia; el conector decide |
| **Ingesta y cobro** | `ingesta.ts` cuenta por teléfono y ventana | Cuenta por `contactoId` y ventana; agrega `canal` al mensaje y al agregado del mes (`conversaciones.porCanal`) | Un campo, y los índices |
| **Umbrales, bloques, aviso del 80 %** | En el servidor, por conversación | Igual, por conversación: **no se tocan** | No |
| **Agente, herramientas de agenda, catálogo, prompt** | No saben del canal | Siguen sin saber, salvo un dato en el prompt («el cliente escribe por Instagram») para el tono | No |
| **Consola** | Todo dice «WhatsApp» y muestra teléfonos | Insignia del canal en conversaciones y consumo por canal; el alta de canales (página, cuenta, bot) | Sí, 2 jornadas |
| **Sitio y contrato** | «Asistentes de WhatsApp» | «El asistente de tu negocio, en WhatsApp y donde te escriban». El glosario define contacto por canal | Texto |

**Los tres «sí» son identidad, enrutamiento y envío.** Los tres son de la
plataforma, no del agente ni de la consola; y el tercero es el que
`Analisis/20` ya pedía por otro motivo. **La premisa se cumple si el
conector se saca de n8n:** mientras el conector sea un nodo de n8n con la
credencial del cliente, cada canal nuevo multiplica flujos.

### 4.1 El contrato del mensaje normalizado (lo único que el resto conoce)

```
Entrada  { canal, tenantId, flujo, contactoId, nombrePerfil,
           tipo: texto | boton | lista | imagen | documento | audio | ubicacion | otro,
           texto, medios: [{ tipo, ruta temporal }], referral, idMensaje, recibidoEn }
Salida   { tenantId, contactoId,
           tipo: texto | opciones | imagen | documento | ubicacion | recordatorio,
           contenido, opciones: [{ id, titulo }] }
```

El conector traduce `opciones` a botones, lista, respuestas rápidas o
teclado según el canal, y a texto numerado si el canal no tiene nada. El
flujo nunca sabe cuál fue.

---

## 5. Esfuerzo, orden y lo que se gana en cada paso

| # | Qué | Jornadas | Qué se gana |
|---|---|---|---|
| 1 | **La capa**: rutas por canal, `contactoId`, mensaje normalizado, Function `enviar` con Secret Manager, `canal` en la ingesta | 4 | Los tokens salen de n8n; un flujo por vertical en vez de por cliente (`Analisis/20`) |
| 2 | **WhatsApp adentro de la capa**, migrando Platinum y los demos, con las suites existentes | 3 | Nada visible para el cliente; todo lo demás depende de esto |
| 3 | **Messenger + Instagram**: conector, alta por página, revisión de Meta | 3 (+ 1–3 semanas de Meta) | El plan Crecimiento tiene su diferenciador; un alta sin chip |
| 4 | **Chat web** en el sitio del comercio (y en el catálogo web propio) | 3 | El canal más barato; captación desde la web del comercio |
| 5 | **Telegram** | 2 | Completa la oferta; sin revisión de nadie |
| 6 | **Consola y sitio** | 2 | Insignias, consumo por canal, alta de canales, glosario |

**15 a 18 jornadas.** El paso 1 y 2 valen por sí solos aunque nunca se
construya otro canal: son la deuda de `Analisis/20`. Conviene hacerlos
**después** de cerrar Platinum (seña, seguimiento, medios), porque tocan la
ingesta y el envío que esos bloques también tocan, y abrir la transacción dos
veces es lo que `Analisis/27` §8 pedía evitar.

---

## 6. Riesgos, y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| **Vender seguimiento de leads en un canal donde no se puede** (Messenger, Instagram) | La oferta lo dice: «seguimiento de solicitudes pendientes en WhatsApp y Telegram». La consola muestra el canal de cada conversación |
| **Doble cobro de la misma persona en dos canales** | Es honesto y está definido (contacto por canal); se explica en el glosario. Si el comercio pide unirlos, el paciente puede dar su teléfono por Instagram y el asistente lo anota: no se cruza automáticamente |
| **La app de Meta, revisada una vez, sirve a todos los clientes** — y si Meta la restringe, se caen todos | Es el mismo riesgo que ya existe con WhatsApp como Tech Provider (`Analisis/25` de AAB1). Un portafolio limpio, una app por producto, cumplimiento estricto de las reglas de ventana |
| **Un bot de Telegram por comercio operado por NovuChat** concentra tokens | Secret Manager, igual que los de WhatsApp; nunca en n8n |
| **Chat web sin identidad**: un contacto anónimo puede abrir conversaciones sin límite | Umbrales por contacto y por IP; sin canal de retorno no hay recordatorio, y el asistente pide el WhatsApp para confirmar la cita — que es, además, la forma de convertir un visitante en contacto de WhatsApp |
| **El sitio dice «WhatsApp» en todas partes** | Se cambia con la oferta, no antes; hasta que exista el segundo canal, el sitio está bien como está |

---

## 7. Qué medir para saber si valió la pena

- **Conversaciones por canal por comercio**, y su costo real: es lo que
  demuestra el 95 % de margen o lo desmiente.
- **Comercios que compran Crecimiento por los canales** y no por el volumen.
- **Altas por Messenger sin número de WhatsApp**: si aparece el comercio que
  prueba por Facebook y después pasa a WhatsApp, la capa además vende.
- **Conversiones por canal** (citas y pedidos sobre conversaciones): si
  Instagram convierte la mitad que WhatsApp, el precio por conversación
  sigue siendo el mismo, pero el comercio va a preguntar por qué.
