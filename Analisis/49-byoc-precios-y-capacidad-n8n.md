# BYOC: precios por escalón, modelo de IA y bolsas; y cuántos flujos caben en n8n

> Sesión de análisis comercial y financiero, 05/10/2026, a pedido de Andres.
> Modelo reproducible: `Analisis/49-modelo-byoc-y-capacidad-n8n.py`.
> Continúa `Analisis/48` (Q'Taco: Crecimiento o BYOC) y `Analisis/39` (BYOC).
> **Nada de esto está decidido:** son propuestas para conversar. No cambia
> `docs/base-comercial.md` ni `planes.ts`. Sin secretos ni identificadores.

## 0. Conclusión, adelantada

| Pregunta | Respuesta |
|---|---|
| **¿Qué tabla BYOC se puede ofrecer hoy?** | Con el modelo que corre (Gemini 3.5 Flash-Lite): **1.000 conversaciones por USD 35, 2.000 por 50 (la de lista), 5.000 por 90 y 10.000 por 150**. Deja entre 56 % y 66 % a uso pleno (§1). |
| **¿Aguanta un modelo mejor?** | Con **Haiku 4.5**, sí, pero el margen a uso pleno cae a entre 12 % y 47 %. Con **Gemini 3.8 Flash (precio de 2027)** o **Sonnet 5.5**, solo sobrevive el escalón de 1.000 y a medias (§2). |
| **¿Y una tabla pensada para Haiku?** | **25 por 200, 50 por 500 y 90 por 1.000**: entre 67 % y 70 % de margen a uso pleno (§3). |
| **¿Cuánto cobrar las bolsas en BYOC?** | **USD 8 por 50 conversaciones, 15 por 100 y 40 por 300**: cerca de 77 % de margen y más caras por conversación que subir de plan (§4). |
| **¿Haiku solo en BYOC y Flash-Lite en el resto?** | **Viable, pero no para prometerlo todavía**: el servidor ya guarda el modelo por comercio y ningún flujo lo obedece. Faltan 3 a 5 jornadas, una batería comparativa y nombrar a Anthropic en la política de privacidad (§5). |
| **¿Cuántos flujos caben en n8n?** | La versión Community **no limita flujos ni ejecuciones**. Con la VM actual estimo **holgura hasta unos 100 clientes** (100 a 200 flujos, 30.000 conversaciones al mes) y **techo cerca de 300**. Antes que la CPU fallan el historial de ejecuciones y los flujos de barrido por cliente (§6). |

**Todo lo de IA es estimado, no medido**, salvo Flash-Lite. La batería de Q'Taco contra Haiku (pedida para el 06/10) y una medición de CPU de la VM son las dos cifras que faltan.

## 1. Tabla BYOC con el modelo de hoy (Flash-Lite)

Base pedida por Andres: USD 35 por 1.000 conversaciones. El segundo escalón es el BYOC que ya está en lista (`planes.ts`, 50 por 2.000).

| Escalón | USD por conversación | Nos queda al 50 % de uso | Nos queda al 100 % | Meta del comercio al 100 % |
|---|---|---|---|---|
| 1.000 por 35 | 0,035 | 25 (72 %) | 23 (66 %) | 57 |
| 2.000 por 50 | 0,025 | 36 (72 %) | 32 (64 %) | 124 |
| 5.000 por 90 | 0,018 | 63 (71 %) | 54 (59 %) | 328 |
| 10.000 por 150 | 0,015 | 104 (69 %) | 84 (56 %) | 667 |

USD al mes. «Nos queda» descuenta impuestos (16 %), infraestructura prorrateada (2,18 USD) e IA (0,004 USD por conversación). La columna de Meta supone 5 respuestas y 1 aviso por conversación, con los 1.000 mensajes gratis del número.

**Condiciones para que se sostenga:**

1. **Solo para flujos de diseño mínimo** («el código calcula», como Agenda mínima y Venta mínima). Un flujo de agente con herramientas cuesta entre 0,021 y 0,051 USD por conversación (`Analisis/43` §2.3): con eso, el escalón de 1.000 deja 6 USD a uso pleno y los demás pierden.
2. **El modelo de IA lo elige NovuChat**, por contrato (`Analisis/39` §2).
3. **Cambios incluidos bajos.** Cada cambio se valúa en USD 15: en el escalón de 35 no cabe ninguno gratis. Propuesta: 0, 1, 2 y 2.
4. **Decir la factura de Meta.** A uso pleno, Meta pesa más que el plan en todos los escalones.

**El riesgo comercial:** la tabla es más barata para el cliente que Crecimiento y Pro, y deja menos a NovuChat.

| Cliente hoy | Paga hoy | Pagaría en BYOC 35 (con Meta) | Nos queda hoy | Nos quedaría |
|---|---|---|---|---|
| Crecimiento, 220 conversaciones | 50 | 39 | 34 | 26 |
| Pro, 500 conversaciones | 90 | 58 | 47 | 25 |

A cambio, cada cliente BYOC libera un cupo de Meta y saca a NovuChat del riesgo de la tarifa de Meta. La barrera para que no se pasen todos es lo que BYOC exige (portafolio, número y tarjeta propios) y, si Andres lo decide, una instalación más alta que la de lista.

**Q'Taco** (`Analisis/48`): con 35 por 1.000 y 220 conversaciones, NovuChat queda con unos 26 USD (hoy 17 con el contrato de 40 y sin vender bolsas) y Q'Taco paga unos 47 en total (35 más unos 12 de Meta).

## 2. Los mismos escalones con un modelo mejor

Perfil de un flujo mínimo: unos 6.600 tokens de entrada y 800 de salida por conversación, en 6 llamadas. Los modelos que razonan (Gemini 3.8 Flash, Sonnet 5.5) suman unos 150 tokens de salida por llamada.

| Modelo | USD por millón (entrada / salida) | USD por conversación | Contra hoy |
|---|---|---|---|
| Gemini 3.5 Flash-Lite (hoy) | 0,30 / 2,50 | 0,004 | 1 |
| Claude Haiku 4.5 | 1,00 / 5,00 | 0,011 | 2,7 veces |
| Gemini 3.8 Flash (2027) | 1,50 / 7,50 | 0,023 | 5,7 veces |
| Claude Sonnet 5.5 | 2,00 / 10,00 | 0,030 | 7,6 veces |

**Lo que nos queda (USD al mes, al 50 % de uso / al 100 %):**

| Escalón | Flash-Lite | Haiku 4.5 | Gemini 3.8 Flash 2027 | Sonnet 5.5 |
|---|---|---|---|---|
| 1.000 por 35 | 25 / 23 | 22 / 17 | 16 / 5 | 12 / −3 |
| 2.000 por 50 | 36 / 32 | 29 / 19 | 17 / −6 | 10 / −21 |
| 5.000 por 90 | 63 / 54 | 47 / 20 | 17 / −40 | −2 / −78 |
| 10.000 por 150 | 104 / 84 | 71 / 18 | 11 / −103 | −27 / −178 |

**Precio que iguala el margen de hoy (USD al mes):**

| Escalón | Hoy | Haiku 4.5 | Gemini 3.8 Flash 2027 | Sonnet 5.5 |
|---|---|---|---|---|
| 1.000 | 35 | 43 | 57 | 66 |
| 2.000 | 50 | 66 | 94 | 112 |
| 5.000 | 90 | 129 | 201 | 246 |
| 10.000 | 150 | 229 | 372 | 462 |

Dicho como recargo: unos **8 USD por cada 1.000 conversaciones con Haiku, 22 con Gemini 3.8 y 31 con Sonnet 5.5**. Antes de subir de modelo en todo el flujo, conviene medir la alternativa barata: el modelo caro solo en los turnos difíciles.

## 3. Una tabla pensada para Haiku 4.5

Pedida por Andres: 25 por 200, 50 por 500 y 90 por 1.000. USD al mes, a uso pleno.

| Concepto | 25 por 200 | 50 por 500 | 90 por 1.000 |
|---|---|---|---|
| Impuestos (IVA 13 % + IT 3 %) | 4,00 | 8,00 | 14,40 |
| IA (Haiku, 0,0106 por conversación) | 2,12 | 5,30 | 10,60 |
| Infraestructura (prorrateada) | 2,18 | 2,18 | 2,18 |
| **Margen** | **16,70 (67 %)** | **34,52 (69 %)** | **62,82 (70 %)** |
| Margen al 50 % de uso | 71 % | 74 % | 76 % |
| USD por conversación | 0,125 | 0,100 | 0,090 |

**Cuántas conversaciones caben si se exige 70 % de margen** (cifras redondeadas a 5; las exactas, en el modelo):

| Precio | 70 % sobre el precio cobrado | 70 % sobre lo neto de impuestos | Equilibrio (sin ganancia) |
|---|---|---|---|
| 25 USD | 125 | 390 | 1.775 |
| 50 USD | 455 | 985 | 3.755 |
| 90 USD | 985 | 1.935 | 6.925 |

El 70 % sobre el precio cobrado es exigente: impuestos e infraestructura ya se llevan entre el 18 % y el 25 %, y el máximo posible sin gastar nada en IA es 75 % en el plan de 25 y 82 % en el de 90.

Sensibilidades: si Haiku saliera un 30 % más caro al medirlo, el margen baja entre 2,5 y 3,5 puntos según el escalón. Si el fijo se reparte entre 5 comercios y no entre 10, el plan de 25 baja a 58 %.

## 4. Bolsas de conversaciones en BYOC

| Bolsa | Precio (USD) | Por conversación | Impuestos | IA (Haiku) | Margen |
|---|---|---|---|---|---|
| 50 conversaciones | 8 | 0,160 | 1,28 | 0,53 | 6,19 (77 %) |
| 100 conversaciones | 15 | 0,150 | 2,40 | 1,06 | 11,54 (77 %) |
| 300 conversaciones | 40 | 0,133 | 6,40 | 3,18 | 30,42 (76 %) |

- **El costo no es el límite:** una conversación extra cuesta unos 0,013 USD entre IA e impuestos. El precio lo decide la estrategia.
- **La bolsa cuesta más por conversación que el plan** (0,160 a 0,133 contra 0,125 a 0,090), para que al que se queda corto todos los meses le convenga subir de plan. Ejemplo: plan de 25 más una bolsa de 300 son 65 USD; el plan de 50 da lo mismo por 50.
- **El servidor hoy solo conoce una bolsa** (30 conversaciones por USD 10, `planes.ts`), y el pago solo acepta la lista cerrada de productos. Estas tres habría que construirlas.

## 5. ¿Haiku solo en BYOC y Flash-Lite en el resto?

Consultado el 05/10 con la sesión Principal de NovuChat y con la de WhatsApp-Modular, las dos en solo lectura.

| Tema | Conclusión | Fuente |
|---|---|---|
| El dato existe | `tenants/{t}.modelo`, lista cerrada con `claude-haiku-4-5`, asignable desde Plataforma (`central/ejes.ts`) | Código, verificado |
| Los flujos no lo obedecen | Los mínimos llaman a Gemini por HTTP con el modelo escrito en el nodo; los de agente usan el sub-nodo de Gemini | Código, verificado |
| Qué hay que construir | Que el modelo viaje en la configuración que el flujo ya consulta; un adaptador por flujo mínimo (petición y lectura de la salida estructurada); credencial de Anthropic en n8n | Principal |
| Qué se queda en Gemini | Los audios (Claude no recibe audio) y el comprobante de pago hasta medirlo: es cobro real | Principal |
| Esfuerzo y momento | 3 a 5 jornadas de agente, después de los bloques de rearquitectura en curso | Principal |
| Canal en BYOC | El comercio no necesita app propia: su titular hace el registro integrado en el alta de AAB1 y los mensajes siguen entrando por el receptor. Todo lo que opere el receptor lo ejecuta WhatsApp-Modular | WhatsApp-Modular (medido con dos casos) |
| Tiempo del modelo | No afecta al receptor si el flujo contesta antes de llamar al modelo. Sí retiene más ejecuciones a la vez en n8n (sin medir) | WhatsApp-Modular |
| Privacidad | La política publicada no nombra a Anthropic: hay que agregarlo como proveedor que recibe datos, en la política y en el contrato | WhatsApp-Modular |
| Política de Meta sobre el proveedor de IA | Nada verificado: leer la fuente antes de afirmar | WhatsApp-Modular |

**Reglas que toca:** el modelo distinto por cliente es una excepción que se declara en `docs/versiones-por-cliente.md`; la orden del 29/09 pide evidencia antes de cambiar de modelo; y sin un regreso automático a Gemini, BYOC dependería de un solo proveedor.

**Recomendación:** ofrecer BYOC hoy con Flash-Lite (§1); dejar Haiku como opción de «modelo superior» con recargo (§2 o §3) después de medirlo; y no atar Haiku a BYOC por regla, porque hoy no hay evidencia de que mejore la calidad y duplica pruebas y prompts.

## 6. Cuántos flujos caben en n8n (Community, en la VM de OCI)

### 6.1 Lo que hay

- **VM:** 2 núcleos ARM y 11,6 GB de memoria, en el nivel gratuito ya reducido, compartida con otros servicios en producción (entre ellos el de OTP, que es financiero).
- **n8n 2.36.5 Community:** modo normal (un proceso), PostgreSQL propio, 1,2 GB de tope de memoria para su contenedor, guarda todas las ejecuciones con poda a 14 días y un tope de entre 10.000 y 20.000.
- **Licencia:** Community no limita flujos ni ejecuciones. El modo cola con trabajadores está incluido (necesita Redis y PostgreSQL). **No incluye** alta disponibilidad (varias instancias principales), vista de trabajadores, entornos, control de versiones ni secretos externos.

### 6.2 Carga medida (24/09 al 05/10/2026; solo fechas, estados y duraciones)

| Dato | Valor |
|---|---|
| Flujos | 20, de los cuales 11 activos |
| Ejecuciones | 5.750 (unas 480 por día); 4 con error |
| Duración | mediana 0,3 s; el 90 % bajo 2,9 s; el 99 % bajo 7 s |
| Hora más cargada | 193 ejecuciones, 170 segundos de ejecución (menos del 5 % de la hora) |
| Ejecuciones a la vez, máximo | 6 |
| Un solo flujo de barrido (cada 5 minutos) | 3.204 ejecuciones: el 56 % del total |

### 6.3 Estimación

Supuestos: cliente de 300 conversaciones al mes; unas 30 ejecuciones por conversación (5 con modelo, de unos 4 s; el resto, acuses de estado muy cortos); la prueba oficial de n8n da 220 ejecuciones por segundo en 2 núcleos con un flujo de 2 nodos, y los nuestros recorren unos 40, así que la cota es de unas 11 por segundo en máquina dedicada y tomo un cuarto por ser compartida; 20 % del día en la hora pico, con ráfagas de 3 veces.

| Escenario | Clientes | Flujos activos | Conversaciones al mes | Ejecuciones por día |
|---|---|---|---|---|
| Hoy | pilotos y demos | 11 | pocas centenas | 480 |
| Holgado | unos 100 | 100 a 200 | 30.000 | 30.000 |
| Techo del modo actual | unos 300 | 300 a 600 | 90.000 | 90.000 |
| Más allá | modo cola con trabajadores y una VM más grande | | | |

El modelo da 110 y 330 clientes (33.000 y 99.000 conversaciones al mes); la tabla los redondea hacia abajo. **Coincide con `Analisis/20` §6 en el número de clientes (unos 300), no en las ejecuciones:** aquel análisis contaba 1.200 ejecuciones al mes por cliente (120 conversaciones de 10 mensajes, 360.000 en total) y este cuenta 9.000 (300 conversaciones y 30 ejecuciones por conversación, porque incluye los acuses de estado), es decir unos 2,7 millones al mes en el techo. `Analisis/20` pedía medirlo antes del cliente cincuenta, y sigue sin medirse.

### 6.4 Lo que falla antes que la CPU

1. **El historial de ejecuciones.** Con 100 clientes, el tope por cantidad guarda menos de un día (hoy no se alcanza: manda la poda de 14 días). Se pierde el diagnóstico y la medición de costos de IA, que lee esas ejecuciones. Salidas: no guardar los acuses de estado, o subir el tope usando disco.
2. **Los flujos de barrido por cliente.** Uno cada 5 minutos son 8.640 ejecuciones al mes por cliente, tanto como todo su tráfico de conversaciones (9.000). Conviene un barrido para todos o una cadencia menor.
3. **Un solo punto de falla, en una máquina compartida.** Community no trae alta disponibilidad. Conviene revisar los límites de recursos del contenedor de n8n y separarlo en otra VM antes de los 50 clientes; el detalle va en la documentación privada de la infraestructura.
4. **La memoria de n8n.** El tope de 1,2 GB alcanza hoy y se puede subir: la VM tiene de sobra.
5. **La operación.** Cada cambio se publica flujo por flujo con los scripts, y cada cliente suma sus credenciales.

Agrandar la VM deja de ser gratis: `Analisis/14` §8 lo estimó en unos 55 USD al mes, sin verificar contra la tarifa actual.

## 7. Supuestos, límites y lo que falta medir

- **IA:** Flash-Lite a 0,004 USD por conversación sale del patrón medido en Agenda mínima (`Analisis/43` §8) más comprobante y audio. Haiku, Gemini 3.8 y Sonnet son estimaciones con el mismo perfil de tokens; los modelos de Claude cuentan los tokens distinto. Precios de Claude: lista de Anthropic a septiembre de 2026.
- **Impuestos:** 16 % del precio (IVA e IT). No incluye el impuesto a las utilidades ni retenciones por pagos al exterior.
- **Infraestructura:** 21,82 USD fijos al mes entre 10 comercios (`Analisis/43` §5).
- **Capacidad de n8n:** la CPU por ejecución no está medida; la cifra sale de la prueba oficial y de una reducción prudente. Falta medir la carga de la VM durante el piloto o con una prueba de carga.
- **Pendiente:** batería de Q'Taco contra Haiku (encargo de Andres para el 06/10) y, con eso, rehacer §2 y §3 con cifras medidas.

Fuentes externas: documentación de n8n («Enable queue mode» y «Measure performance», docs.n8n.io) y la documentación de modelos de Anthropic.
