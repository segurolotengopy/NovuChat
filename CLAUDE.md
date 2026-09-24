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

- **NUNCA una cita encima de otra con un cliente real. Es una regla
  mandatoria de Andres (17/09/2026), no una preferencia.** El candado contra
  la doble reserva se dispara **por lo que el modelo HIZO, no por lo que
  DIJO**: si `agendar_cita` se ejecutó en la vuelta, se verifica en el
  calendario y, si hay cruce, se deshace; el detector de texto («quedó
  agendada», «agendé»…) es solo una red secundaria. El 17/09 el modelo agendó
  dos veces dentro de un intervalo que acababa de recibir de
  `consultar_disponibilidad`, con la regla de intervalos ya publicada en el
  prompt, y la segunda vez el candado no corrió porque dijo «he reprogramado»
  y esa forma no estaba en la lista. **El prompt no es una barrera**: una
  instrucción se ignora bajo insistencia y cambia con cada modelo. Ningún
  flujo de reservas se publica sin este disparador, su suite reproduce el
  caso «verbo no previsto y la herramienta sí corrió», y todo cambio del
  candado se prueba contra un teléfono real insistiendo sobre una hora
  ocupada.
- **El asistente solo ofrece lo que el flujo cumple. Política general de
  NovuChat, para todo cliente (Andres, 21/09/2026).** Ante un error o una
  consulta que no sabe responder, lo único que ofrece es **pasar con
  recepción**, que es siempre el aviso a recepción **más** el botón para
  escribirle directo. Nunca «lo consulto», «te aviso luego», «te llamamos» o
  «te escribirán» sin un mecanismo detrás. Se hace cumplir en código, como el
  candado: toda promesa sin respaldo se cumple (se transfiere) o se quita del
  texto; todo lo que se transfiere y todo error del modelo sale con el botón
  (en los flujos de agenda lo decide `Mensaje a enviar`); y una respuesta que es
  solo una marca nunca se toma por vacía. El 21/09 el prompt decía «ofrece
  consultarlo con recepción», el paciente aceptó dos veces y recibió «tuve un
  problema técnico». Pruebas: `platinum-flujo.test.ts`, «solo se ofrece lo que
  se cumple».
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
- **El orden de las ramas es el del lienzo.** Los flujos corren con
  `executionOrder: v1`: n8n termina una rama entera antes de empezar la
  siguiente, de arriba hacia abajo (a igual altura, la de la izquierda). Mover
  un nodo cambia el comportamiento. En particular, **`Reportar mensaje
  (entrante)` va arriba de la rama del agente**: si la respuesta se reporta
  antes que el mensaje que la provocó, el aviso de uso extendido no sale nunca
  y la primera respuesta de cada ventana no se cuenta (revisión del PR #66,
  `pruebas/flujos-umbrales.test.ts` lo verifica por posición).
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

### 2. La unidad de cobro: un bloque de 25 respuestas en 24 h

**Decidido el 13/09/2026 (`Analisis/27`), reemplaza al tope con corte del 08/09.**

- Se cobra la **conversación**: **hasta 25 respuestas del asistente a un mismo
  teléfono dentro de la ventana fija de 24 h**. La respuesta 26 del mismo día
  abre un bloque nuevo y se factura **otra** conversación; a las 24 h de la
  primera consulta la ventana se renueva y el conteo vuelve a cero. 26
  respuestas en un día = 2 conversaciones; 20 hoy y 2 mañana = 2 también, por
  dos ventanas. **No se cobra por mensaje suelto ni por «asunto»**
  (`Analisis/15`).
- **El asistente no se corta a las 25.** Sigue atendiendo, y lo que sigue se
  cobra. El corte a las 25 con respuesta fija queda sin efecto; lo que sí se
  conserva es el **aviso a recepción** al empezar el segundo bloque, porque una
  conversación que pasa de 25 casi siempre es una que se atascó.
- **Igual en los tres planes.** El bloque no se usa como diferenciador de plan
  (`Analisis/16` §1.3: un plan caro con bloque menor es invendible).
- **La cifra la escribe el servidor** (`ingesta.ts`, `RESPUESTAS_POR_CONVERSACION`,
  contador `mensajesVentana` en la conversación; `conversaciones` y
  `bloquesAdicionales` en el agregado del mes). n8n no cuenta nada.
- **Un bloque lleno cuesta lo mismo que costaba una conversación en el tope**
  (0,3051 USD), así que el precio mínimo de la bolsa (`Analisis/23`) no cambia.
- **Dos umbrales de corte, en la misma unidad y parametrizables por empresa**
  (`cuenta/estado`: `umbralOperador`, `umbralBloqueo`; respaldo 50 / 100 en
  `atencion.ts`): a las **50** respuestas en la ventana el asistente deja de
  llamar al modelo, responde con un aviso fijo de uso extendido y avisa a
  recepción; a las **100** no envía nada más a ese teléfono hasta que la
  ventana se renueve. Con eso el techo de costo de una ventana es 1,17 USD
  (`Analisis/27` §5). Entre los dos umbrales cada consulta cuesta un mensaje
  fijo y se factura como respuesta: es el precio de no dejar en silencio al
  cliente que espera a la persona. Los umbrales **no son un diferenciador de
  plan** y no hace falta publicarlos: se muestran en «Estado de cuenta».
- El bloque **hay que decirlo en la oferta y en el contrato**, y se dice: el
  sitio, la consola y la propuesta de Q'Taco (`Analisis/25` §4) tienen que
  usar la misma frase.

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
- **Aviso de consumo al 80 % del plan, para todos** (decisión de Andres,
  15/09/2026; antes decía 70 % como vigilancia interna). Es lo que promete el
  sitio: al llegar al 80 % de las conversaciones incluidas, se avisa al comercio
  y NovuChat lo ve. Es donde el margen se erosiona, y es una conversación
  comercial, no un problema de precio. Lo marca el servidor, no la pantalla.
- **La bolsa se llama «bolsa»**, nunca «excedente» (decisión del 15/09): 30
  conversaciones por USD 10, que no vencen.
- **Productos del catálogo por plan: 20 / 100 / 500** (lo promete el sitio). La
  consola tiene que permitir buscar, filtrar y ordenar hasta 500.
- **Agendas por plan: 1 / 5 / hasta 10.** `Analisis/24`. El techo NO es el número
  de personas: es que el candado contra la doble reserva hace **una llamada a
  Google Calendar por cada calendario configurado**, y con 20 se rompe el
  criterio de latencia. **No prometer «hasta 20» sin hacer antes el arreglo del
  §4** —que la verificación revise solo el calendario que recibió la cita—, que
  además acelera a todos los negocios.
- **La unidad se llama «conversación», nunca «atención».** El glosario publicado
  dice que la atención —persona distinta en el período— **no se factura**. Usar
  «atenciones» para lo que se cobra contradice el sitio y la consola.
- **BYOC: el comercio trae su portafolio, su número y su tarjeta** (decisión de
  Andres, 23/09/2026; `Analisis/39`). **Las dos modalidades conviven:** los
  planes de arriba siguen para el comercio chico, y BYOC —**USD 50 por 2.000
  conversaciones**, plan `byoc` en `planes.ts`, fuera de `PLANES_PUBLICADOS`—
  se ofrece caso por caso. **Lo que decide no es el margen: es el cupo.** Meta
  limita a 2 portafolios por cuenta personal sin verificar, 2 números por
  portafolio y 1 usuario de sistema administrador, y con la cola de clientes esos
  cupos se agotan; un comercio con portafolio verificado no consume ninguno.
  Tres reglas que van con la modalidad:
  - **El tope se fija contra el modelo que corre.** Los 2.000 salen de Gemini
    (equilibrio 3.873). Con Haiku 4.5 el equilibrio cae a 1.542 y con Sonnet 5
    a 771: **cambiar de modelo en un comercio BYOC sin rehacer la cuenta lo pone
    a perder plata.** El contrato dice que el modelo lo elige NovuChat.
  - **La factura de Meta del comercio no son «centavos»:** va de 21 a 112 USD al
    mes con 800 conversaciones, según cuánto de su tráfico nazca de un anuncio.
    Decirla como calderilla es presentar un cobro como algo que no es.
  - **BYOC no levanta el techo de n8n:** un webhook por app sigue siendo un flujo
    por cliente (`Analisis/20`). Eso solo lo cierra Tech Provider.
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
| **Agendas por plan** (1 / 5 / hasta 10) | `firestore.rules`, al crear un funcionario: contar los activos y leer el plan de `cuenta/estado` | **No existe todavía.** Hoy se pueden cargar sin tope. El número ya viaja en la copia `cuenta/estado.limites.agendas` (`planes.ts`); falta la regla, con un contador como el del catálogo |
| **Conversaciones incluidas** (100 / 220 / 500) | `ingesta.ts`, dentro de la transacción que ya cuenta: `estadoDeServicio` (`prepago.ts`, puro) decide `sin_conversaciones` con la copia `cuenta.limites.conversaciones`, descuenta la bolsa y anota `cuenta.corte`; `configuracionFlujo` corta con el 409 que los flujos ya obedecen | **En `main` en modo observación** desde el 20/09 (`prepago/modulo-y-cortes`, `DISENO.md` §4undecies): el corte se calcula, se anota con `aplicado: false` y se cuenta lo perdido, pero **no corta** hasta que Andres encienda `plataforma/prepago.corteActivo` con `fijarCortePrepago`. Solo con `modalidad`; una demostración no se corta nunca. `pruebas/prepago-ingesta.test.ts`, `prepago-configuracion.test.ts` |
| **Bloque de 25 respuestas por conversación** (la 26 factura otra) | `ingesta.ts`, en la misma transacción que cuenta (`mensajesVentana`, `bloquesAdicionales`) | **Hecho el 13/09** en `cobro/bloques-de-25`, con `pruebas/conteo-bloques.test.ts` |
| **Umbrales de operador y bloqueo** (50 / 100, por empresa) | `atencion.ts` decide; la ingesta anota `atencionEstado` y cuenta; `configuracionFlujo` devuelve `atencion.estado` si el flujo manda `telefono` | **Servidor en `main` desde el 13/09** (`pruebas/umbrales-atencion.test.ts`). **Flujos A y B obedecen en el JSON versionado** (`flujos/umbrales-atencion`, `pruebas/flujos-umbrales.test.ts`): `Traer configuración` manda `telefono` y `¿Atención normal?` bifurca antes del agente. **Falta publicarlos**, después de `v0.2.0`, y probarlos contra un teléfono real |
| **Ítems del catálogo** que van al prompt | `configuracionFlujo`, al armar la respuesta | Hoy hay `limit(200)`, sin corte por plan |
| **Productos del catálogo por plan** (20 / 100 / 500) | `firestore.rules` al crear o borrar un producto, en el mismo lote que el contador `contadores/catalogo`; la importación en lote por la callable `importarCatalogo` (`limiteCatalogo.ts`). El número es `limitesDeCuenta` de `planes.ts`: la copia `cuenta/estado.limites.productos` y, sin copia, el plan | **Hecho el 15/09** en `consolidado/planes-catalogo-storage`, con `pruebas/reglas.test.ts` («Límite de productos por plan») y `pruebas/limite-catalogo.test.ts`. **Falta desplegarlo**, y el contador va ANTES que las reglas: `docs/seguridad/reglas-storage.md` §Despliegue |
| **Aviso de consumo al 80 %** de las conversaciones del plan | `ingesta.ts`, en la transacción que ya cuenta: marca `cuenta/estado.avisoConsumo` una vez por mes. La consola lo muestra (tablero, estado de cuenta, cartera) y no lo calcula | **Hecho el 15/09** en `consolidado/planes-catalogo-storage`, con `pruebas/aviso-consumo.test.ts` (la ingesta real) y `pruebas/planes.test.ts`. Falta desplegar Functions |

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

- **Andres autoriza; Claude opera** (pedido una y otra vez; 15/09/2026). Todo
  paso de un procedimiento —despliegues, etiquetas, scripts con `--aplicar`,
  IAM, rotación de secretos, n8n, variables de GitHub— lo ejecuta Claude después
  del OK de Andres en el chat. Nunca se le pasan comandos para que los corra, ni
  con marcadores para reemplazar. Si una salvaguarda impide un paso (no leer el
  valor de un secreto), se automatiza en un script revisado del repositorio que
  lo hace sin mostrar el valor (`scripts/rotar-ingesta.sh`), y lo corre Claude
  con confirmación. Lo único de Andres es lo que el sistema exige a una persona:
  aprobar el Environment `production`, Meta, un teléfono.
- **Alta de un cliente:** seguir `docs/alta-cliente/RUNBOOK.md`. El flujo
  guardado `/alta-cliente` lo recorre por etapas con los agentes `alta-cliente`,
  `meta-whatsapp`, `plataforma` y `flujos-n8n`. Los agentes ejecutan lo que
  escribe en producción, en Meta o en GitHub **solo con confirmación humana**
  (`.claude/hooks/acciones-sensibles.sh`), y nunca leen el valor de un secreto.
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
  la credencial del disparador, porque cada app de Meta tiene un solo webhook—.
  Ver `Analisis/20`.
- **Un cambio se aplica PREFERENTEMENTE A TODOS, y toda excepción se registra**
  (Andres, 24/09/2026; antes decía «a todos o a ninguno»). El motivo del cambio
  es que empezamos a sacar **productos empaquetados**: un cliente puede quedarse
  a propósito en una versión —porque compró un paquete, porque está en una
  prueba, porque su pase a producción viene después—, y una regla absoluta
  obligaba a mentir o a incumplirla en silencio, que es peor.
  - **El riesgo que la regla vieja cubría sigue existiendo:** un cliente con el
    prompt viejo es un defecto que nadie nota hasta que reclama. Lo que cambia
    no es la vigilancia, es que ahora la diferencia se **declara** en vez de
    prohibirse.
  - **Dónde se registra:** `docs/versiones-por-cliente.md`, una fila por flujo
    publicado, con la excepción y su porqué. Sin fila, un cliente atrasado es un
    defecto, no una excepción.
  - **Cómo se comprueba:** `./scripts/estado-de-versiones.sh` compara cada flujo
    vivo con el versionado y falla si hay un atraso **sin declarar**. Se corre
    antes de dar por cerrada una jornada que haya publicado algo.
