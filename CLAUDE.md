# NovuChat — instrucciones de proyecto

Asistentes conversacionales de WhatsApp para PyMEs bolivianas, construidos con
**n8n + IA**. Proyecto conjunto de **Andres** (arquitectura, infraestructura,
comercial) y **Silvana** (diseño funcional, guiones, material comercial).

**Objetivo inmediato:** dos demos comerciales el **9 y 10 de septiembre de
2026**. Congelamiento de cambios el **8 de septiembre**.

Antes de trabajar, leé `ESTADO.md` (dónde estamos) y `CONFIGURACION.md`
(parámetros e identificadores). Al terminar una sesión, actualizá `ESTADO.md`.

## Idioma y estilo

Español latinoamericano (Bolivia), sin voceo. Respuestas técnicas rigurosas y
detalladas; interactivas en los puntos críticos. Andres tiene 25 años de
experiencia en arquitectura y gestión de proyectos, y experiencia media
programando: explicá el *porqué* de las decisiones, no solo el *cómo*.

## Arquitectura

```
WhatsApp (Meta Cloud API)
   └── webhook ──► n8n autoalojado en OCI (2.36.5)
                     └── AI Agent (Gemini en demos, Claude en producción)
                           ├── memoria por número de teléfono
                           ├── Google Calendar (consultar / agendar)
                           └── envío de respuesta + alerta al negocio
```

## PROHIBICIONES DURAS

1. **NUNCA** reintroducir un canal NO oficial de WhatsApp — Evolution API,
   Baileys, WPPConnect, dispositivos vinculados o equivalentes. Se probó y se
   retiró el 2026-08-22 por rotura silenciosa y riesgo de baneo. El único
   canal es la **Cloud API oficial de Meta**. Referencia:
   `~/WhatsApp-Modular/docs/13-laboratorio-evolution.md`.
2. **NUNCA** escribir un token, App Secret, Client Secret o API key en un
   archivo del repositorio — incluidos los JSON de flujos exportados, los
   sticky notes de n8n y los ejemplos. Solo en `.env` (ignorado) y en el
   gestor de contraseñas.
3. **NUNCA** presentar un cobro como algo que no es. Tiene dos mitades:
   - **Cobro simulado**: el QR de demostración lleva el rótulo impreso en la
     imagen **y** en el caption, y la confirmación dice "simulado".
   - **Cobro real** (QR del comercio, el dinero va a su cuenta): el asistente
     **NUNCA** dice "pago acreditado", "pago verificado" ni "recibimos tu
     pago". El OCR de un comprobante **no es una acreditación bancaria**: una
     imagen se edita. Se dice que el comprobante llegó y que los datos
     coinciden; quien confirma que entró la plata es el banco, y el negocio.
   Los dos modos son excluyentes: nunca los dos a la vez en un mismo negocio.
4. **NUNCA** hacer que el agente niegue ser una IA. Se presenta como asistente
   virtual y, si le preguntan, lo dice con naturalidad.
5. **NUNCA** tocar la app de Meta `Demo SeguroLo Tengo` ni el `otp-service`:
   son de WhatsApp-Modular, un sistema financiero en producción. Comparten la
   VM y la WABA, pero son productos distintos.
6. **NUNCA** publicar el número de prueba a terceros: solo responde a los 5
   destinatarios registrados (ver ESTADO.md, riesgo de demo).

## Reglas de diseño de los flujos n8n

- **Memoria con clave de sesión explícita** = número de origen
  (`messages[0].from`). Sin esto, dos clientes comparten memoria. Es el
  defecto más grave que puede tener uno de estos flujos.
- **Filtro de eventos** antes del agente: solo pasan payloads con `messages`.
  Los acuses de estado se descartan.
- **Normalización de entrada** que cubra `text`, `interactive`, `order`,
  `image` y cualquier otro tipo con respuesta cortés. Nunca acceder a
  `.text.body` sin pasar por ahí.
- **Fecha, hora y zona inyectadas al prompt** (`America/La_Paz`, UTC-4 fijo).
  Sin esto, "mañana en la tarde" se calcula mal.
- **Modelo como sub-nodo intercambiable**: cambiar Gemini por Anthropic no
  debe requerir tocar nada más del flujo.
- **Todo lo configurable por negocio** vive en el nodo `Config del negocio`,
  no disperso por el lienzo. Es lo que sostiene la promesa de instalar un
  cliente nuevo en 48 horas.
- **Nodos Code en JavaScript**: la imagen de n8n desplegada no trae Python.
- **Cada mensaje que envía el flujo cuesta dinero** desde el 01/10/2026. Un
  cambio que agregue un mensaje por conversación cuesta 0,0113 USD por
  conversación en todos los clientes. Ver «Base comercial» §1: todo cambio de
  flujo declara cuántos mensajes agrega o quita.
- **Cada flujo nuevo se revisa contra la política de capas** de
  `admin/DISENO.md` §4sexies: lo común (identidad, horarios, voz, catálogo,
  usuarios) no se repite por flujo; lo propio de un flujo (agendas, QR, costos
  de entrega) es excluyente y trae su documento `/config/{flujo}`, su línea en
  la tabla de capacidades de las reglas y su pestaña en `web/src/lib/flujos.ts`.
  Un negocio tiene uno o más flujos (`tenants/{id}.flujos`), y la consola
  habilita pestañas por flujo. Nunca una consola que solo sirve a un flujo.

## Base comercial — el dinero de cada decisión técnica

**Vigente desde el 1 de octubre de 2026.** Análisis completo y modelo
reproducible en `Analisis/14` a `20`; acá está lo que hay que tener presente al
escribir código, prompts, pantallas o catálogos. **Si una decisión técnica
contradice algo de acá, se discute antes de implementarla.**

### 1. Cada respuesta del asistente cuesta dinero

Desde el 1 de octubre Meta cobra **cada mensaje que envía el asistente** dentro
de la ventana de 24 h, a **0,0113 USD** para Bolivia (mercado «Rest of Latin
America»). Antes eran gratis.

- **Meta es el 94 % del costo del servicio. El modelo de IA es el 6 %.**
- **Franquicia: 1.000 mensajes gratis por número de empresa y por mes.** No
  acumula. Cada comercio tiene su número, así que tiene los suyos.
- Los mensajes de servicio **no tienen descuento por volumen**.

**Consecuencias operativas, y son obligatorias:**

- **Todo cambio de flujo declara cuántos mensajes agrega o quita**, igual que
  hoy declara qué prueba lo cubre. Juntar dos mensajes en uno es una mejora
  medible, no un gusto estético.
- **Un mensaje largo y completo es más barato que dos cortos.** La regla vieja
  de «máximo 3 oraciones por mensaje» juega en contra: el límite tiene que ser
  de mensajes, no de largo.
- **Optimizar tokens ya casi no rinde.** Cachear el prefijo ahorra 0,07 Bs sobre
  1,5 por conversación. No gastar tiempo ahí; gastarlo en acortar la
  conversación.
- **La elección de modelo puede tomarse por calidad.** Pasar a Claude Haiku con
  caché sube el costo total un 7 %.

### 2. La unidad de cobro, y su tope

- Se cobra la **conversación**: ventana fija de 24 h por teléfono. **No se cobra
  por mensaje ni por «asunto»**, y está analizado y decidido en `Analisis/15`.
- **Tope de 25 respuestas del asistente por conversación, igual en los tres
  planes.** No escalonado por plan: económicamente el plan chico es el que más
  barato tiene ser generoso, y un plan caro con tope menor es invendible.
- Al llegar al tope: **una** respuesta fija, aviso a recepción, y **ninguna
  llamada más al modelo** hasta que abra una ventana nueva. Ese último mensaje
  también se cobra.
- El tope **hay que decirlo en la oferta**. «Sin importar cuántos sean» dejó de
  ser cierto.

### 3. Precios en dólares, cobro en bolivianos

- **La lista de precios se denomina en dólares.** Todo el costo se paga en USD;
  denominar en Bs descalzaba el margen contra el tipo de cambio.
- **Se cobra en bolivianos al Tipo de Cambio Oficial que publica el BCB.**
  Bolivia tiene régimen flexible desde el 29/06/2026 y el BCB publica un TCO
  diario (12,60 al 08/09/2026). **NovuChat no publica un tipo de cambio propio:**
  un proveedor que fija el tipo de cambio con el que cobra invita a la sospecha.
- **Planes: USD 25 / 50 / 90 por 100 / 220 / 500 conversaciones**, más la bolsa
  de **30 conversaciones por USD 10**, que no vence. Instalación USD 65. Es la
  propuesta de Silvana, analizada y adoptada en `Analisis/21`. **El plan de
  entrada cabe exacto en la franquicia de Meta** —100 × 10 mensajes = 1.000— y
  por eso es el más rentable y el inmune a subidas de tarifa.
- **Bolsa: USD 10 por 30 conversaciones** (0,333 cada una), que no vencen.
  `Analisis/23`. **El tope de mensajes fija el precio mínimo de la bolsa:** con
  tope 25 el mínimo para no perder nunca es 0,3632 USD/conv. **Si el tope sube,
  hay que recalcular la bolsa.**
- **El volumen del plan grande no se estira más allá de 500** sin rehacer la
  cuenta de `Analisis/21` §9.4: entre 750 y 1.000 la cartera se da vuelta.
- **Vigilar los comercios que pasen del 70 % de su plan.** Es donde el margen se
  erosiona, y es una conversación comercial, no un problema de precio.
- **Agendas por plan: 1 / 5 / hasta 10.** `Analisis/24`. El techo NO es el número
  de personas: es que el candado contra la doble reserva hace **una llamada a
  Google Calendar por cada calendario configurado**, y con 20 se rompe el
  criterio de latencia. **No prometer «hasta 20» sin hacer antes el arreglo del
  §4** —que la verificación revise solo el calendario que recibió la cita—, que
  además acelera a todos los negocios.
- **La unidad se llama «conversación», nunca «atención».** El glosario publicado
  dice que la atención —persona distinta en el período— **no se factura**. Usar
  «atenciones» para lo que se cobra contradice el sitio y la consola.
- **Al escribir código que muestre precios:** el campo se denomina en dólares, el
  importe en bolivianos es derivado, y **hay que registrar el TCO aplicado a cada
  pago** o no se puede reconstruir una factura. En el JSON-LD del sitio,
  `priceCurrency` es `USD`.

### 4. Consola: lo que tiene que mostrar

- **Mensajes del asistente en el mes, contra los 1.000 gratis del número.** Es la
  cifra que predice la factura de Meta, y hoy no está.
- **Mensajes por conversación, como distribución y no como promedio.** Es lo que
  revisa el tope y la unidad de cobro.
- **Precio en dólares y el importe en bolivianos del mes en curso.**

### 5. Catálogo

- **Hasta 40 ítems: la lista completa con precios va al prompt.** Por encima, un
  resumen con categorías y rango, y el enlace al catálogo web.
- **El corte no es económico:** 500 ítems en el prompt cuestan menos que medio
  mensaje. Lo fijan la legibilidad del chat y la confiabilidad del modelo.
- **Al catálogo web va todo lo que el comercio quiera vender.** Lo que no se
  puede comprar por chat —sin stock, a cotizar, a medida— **no se publica**:
  genera conversaciones pagadas que no cierran.
- **Mandar el enlace no ahorra si el asistente conversa el pedido igual.** El
  ahorro aparece cuando el enlace reemplaza la conversación.

### 6. Lo que NO hay que hacer

- **No cobrar distinto por flujo.** La diferencia entre reservas y pedidos se
  invierte con el catálogo web, y un comercio con dos flujos ya paga menos
  porque estrena una segunda franquicia de Meta.
- **No construir un flujo de n8n con varios disparadores** para atender a varios
  clientes: obliga a que el token viaje en los datos de ejecución y se tira
  cuando llegue Tech Provider (`Analisis/20`).
- **No prometer la ventana de punto de entrada gratuito** —conversaciones que
  nacen de un anuncio— hasta medirla con un cliente real.

### 7. Todo límite comercial se hace cumplir en el SERVIDOR

**Un límite que solo existe en la pantalla no existe.** La consola arma la
petición desde el navegador: esconder un campo, deshabilitar un botón o no
dibujar una fila **no impide nada**. Es el mismo criterio que `admin/DISENO.md`
§4sexies.2 ya aplica a la política de capas, ahora extendido a lo comercial.

**Dónde va cada límite:**

| Límite | Se hace cumplir en | Estado |
|---|---|---|
| **Agendas por plan** (1 / 5 / hasta 10) | `firestore.rules`, al crear un funcionario: contar los activos y leer el plan de `cuenta/estado` | **No existe todavía.** Hoy se pueden cargar sin tope |
| **Conversaciones incluidas** (100 / 220 / 500) | `ingesta.ts`, dentro de la transacción que ya cuenta | Hecho en la rama de prepago |
| **Tope de 25 mensajes por conversación** | El flujo de n8n, antes de llamar al modelo | No existe todavía |
| **Ítems del catálogo** que van al prompt | `configuracionFlujo`, al armar la respuesta | Hoy hay `limit(200)`, sin corte por plan |

**La regla al agregar cualquier límite nuevo:**

1. **La regla del servidor es la que manda**, y es la que se prueba. Una prueba
   que solo verifica que el botón está deshabilitado no prueba nada.
2. **La pantalla acompaña**, para que el comercio no descubra el límite con un
   error rojo: avisa antes, explica por qué, y ofrece subir de plan.
3. **La prueba se escribe negando**: el negocio con el plan chico **no puede**
   crear la agenda número 2, ni construyendo la petición a mano. Es el patrón
   que `pruebas/reglas.test.ts` ya usa para el aislamiento entre comercios.
4. **Y el límite se lee del plan, no se escribe en el código.** Los números de
   esta sección cambian; la regla que los aplica, no.

## Flujo de trabajo

- Los JSON de `Flujos/` son la fuente de verdad versionada. Tras editar en la
  interfaz de n8n, **exportar** (⋯ → Download) y reemplazar el archivo.
- En n8n cada cambio exige volver a pulsar **Publish** para que llegue a
  producción.
- n8n Community no comparte flujos entre usuarios: la cuenta de Andres es
  dueña de lo productivo; Silvana desarrolla e intercambia por export/import.
- Antes de dar algo por terminado, probarlo contra un teléfono real y
  reportar el resultado **real**, no el esperado.
- **Nunca editar a mano el flujo de un cliente.** Se edita el JSON versionado y
  se reaplica con `publicar-flujo.sh`. Hoy hay un flujo por cliente —lo obliga
  la credencial del disparador, porque cada app de Meta tiene un solo webhook—
  y un cambio se aplica a todos o a ninguno: un cliente con el prompt viejo es
  un defecto que nadie nota hasta que reclama. Ver `Analisis/20`.
