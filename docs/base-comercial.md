# Base comercial — el dinero de cada decisión técnica

> Movido de `CLAUDE.md` el 25/09/2026 (`Analisis/41-arquitectura-por-capas.md`
> §5.5: `CLAUDE.md` queda con invariantes; las cifras y la tabla de estado del
> §7 van acá y a `docs/arquitectura/limites.md`). Los números cambian con las
> decisiones de Andres y se corrigen acá (la última, BYOC, el 11/10/2026);
> la regla que los aplica está en `CLAUDE.md`. Sin secretos ni identificadores.

## Base comercial — el dinero de cada decisión técnica

**Vigente desde el 1 de octubre de 2026; la modalidad BYOC, desde el 07/10/2026 (`Analisis/50`).** Análisis completo y modelo
reproducible en `Analisis/14` a `20`; acá está lo que hay que tener presente al
escribir código, prompts, pantallas o catálogos. **Si una decisión técnica
contradice algo de acá, se discute antes de implementarla.**

### 1. Cada respuesta del asistente cuesta dinero

Desde el 1 de octubre Meta cobra **cada mensaje que envía el asistente** dentro
de la ventana de 24 h, a **0,0113 USD** para Bolivia (mercado «Rest of Latin
America»). Antes eran gratis.

- **Con Meta incluido, Meta es el 94 % del costo del servicio y el modelo de IA el 6 %.** En BYOC el comercio paga Meta: para NovuChat la IA es casi todo el costo variable, y los mensajes se siguen declarando porque son la factura del comercio.
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
- **Con Meta incluido, optimizar tokens ya casi no rinde** (cachear el prefijo
  ahorra 0,07 Bs sobre 1,5 por conversación) **y el modelo puede elegirse por
  calidad** (Haiku con caché sube el costo total un 7 %). **En BYOC no:** la IA
  es casi todo nuestro costo; con Haiku el margen de los planes baja de 72-77 % a
  67-70 % (`Analisis/49`, `50`). Cada flujo declara su costo de IA por
  conversación, y el modelo lo elige NovuChat por contrato.

### 2. La unidad de cobro: un bloque de 25 respuestas en 24 h

**Decidido el 13/09/2026 (`Analisis/27`), reemplaza al tope con corte del 08/09.**

- Se cobra la **conversación**: **hasta 25 respuestas del asistente a un mismo
  teléfono dentro de la ventana fija de 24 h**. La respuesta 26 del mismo día
  abre un bloque nuevo y se factura **otra** conversación; a las 24 h de la
  primera consulta la ventana se renueva y el conteo vuelve a cero. 26
  respuestas en un día = 2 conversaciones; 20 hoy y 2 mañana = 2 también, por
  dos ventanas. **Excepción decidida el 09/10, pendiente en el servidor**
  (`Analisis/50` §3): la respuesta del cliente a un seguimiento que el negocio
  envió dentro de las 48 h extiende su conversación y no abre otra. Hoy la
  ventana es fija de 24 h y esa respuesta abre una conversación que el servidor
  cuenta. **No se cobra por mensaje suelto ni por «asunto»**
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
  (0,3051 USD), así que el precio mínimo de la bolsa con Meta incluido
  (`Analisis/23`) no cambia.
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
- **Modalidad preferida: BYOC, el comercio paga a Meta** (decisión de Andres,
  07/10/2026; `Analisis/50`). **Planes: USD 25 / 50 / 90 por 200 / 500 / 1.000
  conversaciones.** Instalación USD 65 estándar, a medida desde 125 (Andres, 09/10). Margen a uso
  pleno 72 % a 77 % con Gemini Flash-Lite (67 % a 70 % con Haiku 4.5).
- **Opción excepcional, con la mensajería de Meta incluida:** los mismos precios
  por **100 / 220 / 500** conversaciones, y la bolsa de **30 conversaciones por
  USD 10** (`Analisis/21`, `23`). Para el comercio que no tiene ni quiere una
  cuenta de Meta; no es la oferta habitual. **El plan de entrada cabe exacto en la
  franquicia de Meta** (100 × 10 mensajes = 1.000). El volumen del plan grande no
  se estira más allá de 500 sin rehacer `Analisis/21` §9.4. Con el tope de 25, el
  precio mínimo de esa bolsa es 0,3632 USD por conversación.
- **Bolsas BYOC (decisión de Andres, 09/10 y 11/10/2026; `Analisis/50` §3):**
  - **Conversaciones:** 300 por **USD 15**, que no vencen.
  - **Mensajes de seguimiento:** 300 por **USD 10**, para lo que el negocio
    inicia más de 48 horas después del último mensaje de su cliente. Solo con
    titularidad `comercio`: a Meta cada uno le cuesta 0,074 como plantilla de
    marketing, que paga el comercio. Un seguimiento dentro de las 48 horas va en
    la conversación del cliente y no se cobra aparte **en NovuChat**, aunque el
    cliente responda; si sale después de las 24 h es una plantilla que **Meta le
    cobra al comercio** (0,0113 si es de utilidad, 0,074 si Meta la clasifica
    como marketing).
- **El servidor todavía corta en 100 / 220 / 500, vende solo la bolsa de 30 por
  10 y no distingue los mensajes salientes del negocio** (`planes.ts`,
  `ingesta.ts`). Los topes y la bolsa de conversaciones esperan al bloque de
  Central; la extensión de 48 h y la bolsa de seguimiento, al bloque de Core
  (depende de #439). Hasta entonces, a cada cliente BYOC se le asignan las
  conversaciones por contrato, una bolsa se registra como pago manual y la
  respuesta del cliente después de 24 h se compensa por contrato.
- **Aviso de consumo al 80 % del plan, para todos** (decisión de Andres,
  15/09/2026; antes decía 70 % como vigilancia interna). Es lo que promete el
  sitio: al llegar al 80 % de las conversaciones incluidas, se avisa al comercio
  y NovuChat lo ve. Es donde el margen se erosiona, y es una conversación
  comercial, no un problema de precio. Lo marca el servidor, no la pantalla.
- **La bolsa se llama «bolsa»**, nunca «excedente» (decisión del 15/09).
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
  Andres, 23/09/2026, `Analisis/39`; preferida desde el 07/10, `Analisis/50`). El
  plan `byoc` de `planes.ts` (USD 50 por 2.000) sigue en el código; sale más
  barato que Pro de lista, así que su destino (retirarlo o dejarlo para contratos
  de volumen) lo decide Andres.
  **Lo que decidió preferirla no es el margen: es el cupo.** Meta limita los
  portafolios por cuenta personal y los números por portafolio sin verificar, y
  con la cola de clientes esos cupos se agotan; el portafolio del comercio no
  consume ninguno. Tres reglas que van con la modalidad:
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
| **Conversaciones incluidas** (BYOC 200 / 500 / 1.000; Meta incluido 100 / 220 / 500; hoy el servidor corta en 100 / 220 / 500) | `ingesta.ts`, dentro de la transacción que ya cuenta: `estadoDeServicio` (`prepago.ts`, puro) decide `sin_conversaciones` con la copia `cuenta.limites.conversaciones`, descuenta la bolsa y anota `cuenta.corte`; `configuracionFlujo` corta con el 409 que los flujos ya obedecen | **En `main` en modo observación** desde el 20/09 (`prepago/modulo-y-cortes`, `DISENO.md` §4undecies): el corte se calcula, se anota con `aplicado: false` y se cuenta lo perdido, pero **no corta** hasta que Andres encienda `plataforma/prepago.corteActivo` con `fijarCortePrepago`. Solo con `modalidad`; una demostración no se corta nunca. `pruebas/plataforma/prepago-ingesta.test.ts`, `prepago-configuracion.test.ts` |
| **Bloque de 25 respuestas por conversación** (la 26 factura otra) | `ingesta.ts`, en la misma transacción que cuenta (`mensajesVentana`, `bloquesAdicionales`) | **Hecho el 13/09** en `cobro/bloques-de-25`, con `pruebas/conteo-bloques.test.ts` |
| **Umbrales de operador y bloqueo** (50 / 100, por empresa) | `atencion.ts` decide; la ingesta anota `atencionEstado` y cuenta; `configuracionFlujo` devuelve `atencion.estado` si el flujo manda `telefono` | **Servidor en `main` desde el 13/09** (`pruebas/umbrales-atencion.test.ts`). **Flujos A y B obedecen en el JSON versionado** (`flujos/umbrales-atencion`, `pruebas/flujos-umbrales.test.ts`): `Traer configuración` manda `telefono` y `¿Atención normal?` bifurca antes del agente. **Falta publicarlos**, después de `v0.2.0`, y probarlos contra un teléfono real |
| **Ítems del catálogo** que van al prompt | `configuracionFlujo`, al armar la respuesta | Hoy hay `limit(200)`, sin corte por plan |
| **Productos del catálogo por plan** (20 / 100 / 500) | `firestore.rules` al crear o borrar un producto, en el mismo lote que el contador `contadores/catalogo`; la importación en lote por la callable `importarCatalogo` (`limiteCatalogo.ts`). El número es `limitesDeCuenta` de `planes.ts`: la copia `cuenta/estado.limites.productos` y, sin copia, el plan | **Hecho el 15/09** en `consolidado/planes-catalogo-storage`, con `pruebas/reglas.test.ts` («Límite de productos por plan») y `pruebas/modulos/productos/limite-catalogo.test.ts`. **Falta desplegarlo**, y el contador va ANTES que las reglas: `docs/seguridad/reglas-storage.md` §Despliegue |
| **Campañas simultáneas por plan** (0 / 3 / 10; el plan `byoc` de 2.000, 10; confirmado por Andres el 24/09) | `firestore.rules` en `config/campanas`: `lista.size() <= limiteCampanas()`, con la copia `cuenta/estado.limites.campanas` (0 a 10) o el plan; `configuracionFlujo` recorta al tope de hoy | **Hecho el 24/09** en `claude/bellido-eleccion-del-menu`, con `pruebas/campanas-reglas.test.ts` y `pruebas/campanas.test.ts` (`DISENO.md` §4sexdecies). **Falta desplegar** reglas y Functions |
| **Mensajes de seguimiento fuera de 48 h y extensión de 48 h** (`Analisis/50` §3) | `ingesta.ts`: hora del último entrante, evento «seguimiento» con reserva antes del envío, contador y corte propios; bolsa de 300 por 10 en Pagar | **No existe todavía.** Bloque de Core, después de fusionar #439 |
| **Aviso de consumo al 80 %** de las conversaciones del plan | `ingesta.ts`, en la transacción que ya cuenta: marca `cuenta/estado.avisoConsumo` una vez por mes. La consola lo muestra (tablero, estado de cuenta, cartera) y no lo calcula | **Hecho el 15/09** en `consolidado/planes-catalogo-storage`, con `pruebas/aviso-consumo.test.ts` (la ingesta real) y `pruebas/central/planes.test.ts`. Falta desplegar Functions |

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
