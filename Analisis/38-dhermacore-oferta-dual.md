# Dhermacore e Infoproductos: USD 99 por 800 conversaciones en dos líneas

**22-sep-2026.** Análisis de rentabilidad de la propuesta comercial del 22/09
(«Ecosistema dual: Dhermacore & Productos Digitales»), pedido por Andres antes
de firmarla. Tarifas de Meta de `Analisis/14` (vigentes desde el 01/10/2026);
unidad de cobro de `Analisis/27`; impuestos 16 %. Modelo reproducible:
`Analisis/38-dhermacore-modelo.py`.

La oferta en una línea: **setup USD 125** por dos líneas a medida y **USD 99 al
mes por hasta 800 conversaciones compartidas** entre dos números, con bolsa de
30 por USD 10, reactivación de 30 mensajes por USD 10 y cuatro cambios de
campaña al mes.

**Dato del cliente que manda sobre todo lo demás (Andres, 22/09):** *al menos el
70 % de los clientes de Dhermacore entra desde campañas de Meta.*

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **¿Conviene USD 99 por 800?** | **Sí, y con holgura, mientras el 70 % siga entrando por anuncios.** A plena carga con 14 mensajes por conversación deja **+53 USD al mes (64 %)**, y el punto de equilibrio se va a **1.605 conversaciones**: el doble de lo vendido |
| **Por qué cambia tanto** | Una conversación que nace de un anuncio de clic a WhatsApp abre la **ventana de punto de entrada gratuito**: Meta no cobra **ningún** mensaje de la empresa durante 72 horas, y esos mensajes **tampoco gastan franquicia**. Con 70 % de CTWA, el renglón de Meta baja de 104 a 15 USD |
| **Cuánto margen hay para equivocarse** | Con 800 conversaciones de 14 mensajes alcanza con que **el 30 % venga de anuncios** para no perder. El cliente dice 70 %: hay más del doble de colchón |
| **El mismo contrato sin la ventana gratuita** | **−38 USD al mes** (equilibrio en 588 conversaciones). Ese es el escenario si se apagan las campañas, si Meta cambia la regla en un 1 de enero/abril/julio/octubre, o si el 70 % resulta ser 20 % |
| **La condición que no es negociable** | **Medirlo desde el primer día.** Hoy **no se puede**: el flujo lee el `referral` del anuncio pero **no lo reporta a `ingesta.ts`**, así que el servidor no sabe qué fracción entró por campaña. Es un cambio chico y va antes de firmar |
| **El setup sigue sin cubrir** | USD 125 netos son 105 contra 3 a 6 jornadas de trabajo: cubre entre el 9 % y el 18 %, y lo que falta se recupera en **9 a 21 meses**. **Recomendado: USD 250**, 50/50 |
| **Tres cláusulas del PDF hay que corregirlas** | La imagen que «consume 2 mensajes de la cuota» **no existe en el servidor**; cuatro cambios de campaña al mes; y el «rescate a las 48 h», que conviene dejar explícito porque **cae dentro de las 72 h gratuitas** y por eso se puede incluir |

---

## 1. La ventana de punto de entrada gratuito es el negocio entero

`Analisis/31` §1 ya lo tenía anotado en una fila de una tabla: si el lead viene
de un anuncio de clic a WhatsApp, **todo es gratis dentro de las 72 h del punto
de entrada**, incluidas las plantillas. Lo que cambia con el dato de Andres es
que para este cliente esa fila deja de ser una nota al pie y pasa a ser el
**70 % del tráfico**.

La cuenta a plena carga (800 conversaciones de 14 mensajes) queda así:

| Renglón | USD | % |
|---|---|---|
| Meta, servicio del 30 % que **no** viene de anuncios | 15,37 | 51 % |
| Modelo (Gemini) | 8,64 | 29 % |
| Meta, avisos a la persona del equipo (utilidad) | 4,97 | 17 % |
| Meta, seguimiento de rescate del 30 % | 1,08 | 4 % |
| Lectura de comprobantes | 0,03 | 0 % |
| **Total** | **30,10** | **margen +53,06 (64 %)** |

Dos cosas que conviene mirar de cerca:

- **El modelo pasó a ser el 29 % del costo.** Es la primera vez en todo el
  proyecto que Gemini pesa algo: no porque haya subido, sino porque Meta se
  desplomó. Sigue sin ser una palanca (8,64 USD al mes), pero ya no es ruido.
- **El aviso a la persona del equipo se paga siempre.** Va a otro teléfono, esa
  conversación no nace de un anuncio, y es plantilla de utilidad. Con 800
  conversaciones son 4,97 USD: barato, pero es el renglón que **no** se puede
  optimizar con campañas.

### 1.1 Cuánto tiene que fallar el supuesto para doler

Margen mensual con 800 conversaciones, según qué fracción entre por anuncio:

| Tráfico por anuncio | 10 msj | 12 msj | **14 msj** | 16 msj |
|---|---|---|---|---|
| 0 % | +0 | −19 | **−38** | −57 |
| 25 % | +24 | +9 | −5 | −20 |
| **30 %** | — | — | **0 (equilibrio)** | — |
| 40 % | +38 | +26 | +14 | +2 |
| 50 % | +47 | +37 | +27 | +17 |
| **70 % (lo que dice el cliente)** | +66 | +60 | **+53** | +47 |
| 90 % | +71 | +70 | +69 | +68 |

**Fracción mínima para no perder, con las 800 usadas:** 0 % si la conversación
queda en 10 mensajes, 17 % a 12, **30 % a 14**, 39 % a 16, 52 % a 20.

Y el punto de equilibrio en conversaciones, con 70 % de CTWA: **1.605 al mes** a
14 mensajes (1.830 a 12, 1.429 a 16). Vendemos 800.

### 1.2 Lo que sigue costando: los mensajes de la conversación

La ventana gratuita no vuelve gratis el diseño descuidado. **Para el 30 % que no
viene de anuncios, cada imagen sigue siendo un mensaje de servicio completo**
(0,0113): el tipo no cambia el precio (`Analisis/34` §1). Y las dos líneas de
este cliente están del lado caro del catálogo —`Analisis/14` §2 ya decía que
pedidos cuesta más que reservas—:

| Línea | Qué manda | Mensajes del asistente |
|---|---|---|
| Dhermacore (enrutamiento) | clasificación de campaña, información del tratamiento, 1 a 2 imágenes, derivación a la recepción del doctor | 9 a 12 |
| Libros (venta + QR) | catálogo, portada, detalle, QR de cobro, aviso de comprobante recibido, enlace de descarga | 12 a 16 |

El promedio razonable para modelar sigue siendo **13 a 14 mensajes**.

---

## 2. Qué hay que medir, y por qué hoy no se puede

**El flujo ya ve el anuncio.** `Normalizar entrada` lee el `referral` que manda
Meta y lo deja en `anuncio`, con el titular; el prompt del asistente lo usa
(«Llegó desde un anuncio: …»). El comentario del propio nodo dice que sirve
«para medir la ventana de punto de entrada gratuito (`CLAUDE.md` §6)».

**Pero no lo reporta.** `Reportar mensaje (entrante)` le manda a `ingesta.ts`
teléfono, dirección, tipo, texto, id de Meta y nombre de contacto. **El anuncio
no viaja**, y `ingesta.ts` no tiene ningún campo donde guardarlo. Resultado: el
servidor no puede decir qué fracción del mes entró por campaña, que es
exactamente el número del que depende este contrato.

**Lo que hay que hacer, y es chico:** agregar el origen al cuerpo que ya se
manda, guardarlo en la conversación al abrirla y contarlo en el agregado del
mes, junto a `conversaciones` y `bloquesAdicionales`. Con eso:

1. Se sabe si el 70 % es 70 %, y se revisa el contrato con un dato y no con una
   discusión.
2. Se puede **cruzar con la factura de Meta** a fin de mes y confirmar que la
   ventana gratuita se está aplicando de verdad. Es la medición que `CLAUDE.md`
   §6 exige antes de prometerla, y este es el cliente para hacerla.
3. Sirve para toda la cartera: es el dato que decide si algún día se puede
   publicar un plan más barato para comercios que pautan.

**Va antes de firmar**, no después. Un contrato cuyo margen depende de un
supuesto que no se mide es un contrato que se renegocia a ciegas.

---

## 3. Lo que sí hay que proteger en el contrato

El riesgo de esta oferta ya no es el volumen: es que **el supuesto se caiga**.
Tres formas en que se cae, y qué poner:

| Cómo se cae | Qué pasa | Qué poner en el contrato |
|---|---|---|
| Dhermacore apaga las campañas un mes | El tráfico orgánico paga todo: −38 USD con las 800 usadas | **Revisión del volumen si el tráfico por anuncio baja del 40 % dos meses seguidos.** El 40 % y no el 30 % deja margen para actuar antes de perder |
| Meta cambia la regla | Solo puede cambiar el 1 de enero, abril, julio u octubre, con aviso previo (`Analisis/14` §1) | Cláusula de revisión de precios ante un cambio de tarifas de Meta, con aviso de un mes |
| El 70 % era optimista | Con 20 % y 14 mensajes, el equilibrio vuelve a ~650 | Lo resuelve la medición del §2, en el primer mes |

**Y no prometer la ventana gratuita en la oferta escrita.** `CLAUDE.md` §6 lo
prohíbe hasta medirla, y además es mala idea comercialmente: si mañana Meta la
quita, el cliente entiende que se le sacó algo que se le había vendido. El
precio se le da como precio; lo que la ventana permite es **darlo**.

---

## 4. Las tres cláusulas del PDF

### 4.1 «Cada imagen consume 2 mensajes de la cuota» no existe

El PDF lo dice como condición del servicio. **El servidor cuenta uno.**
`ingesta.ts` hace `mensajesVentana = previasVentana + 1` por cada saliente, sea
texto, imagen, documento o QR: no hay noción de crédito doble en ningún lado.

Es el caso de `CLAUDE.md` §7: **un límite que solo existe en el contrato no
existe.** Y con la ventana gratuita en juego pierde todo sentido: la cláusula
existía para frenar el costo de las imágenes, y para el 70 % del tráfico las
imágenes no cuestan nada. **Quitarla.**

### 4.2 Cuatro cambios de campaña al mes

Con +53 USD de margen ya no es el problema que era, pero sigue siendo tiempo de
persona: cuatro cambios con sus pruebas son más de dos horas al mes, y el margen
son cinco. **Dejarlo en dos incluidos**, los demás a los USD 15 que la propuesta
ya tiene. Si se quiere sostener los cuatro, que sea a cambio del setup de 250.

### 4.3 El rescate a las 48 h: decirlo bien, porque está bien pensado

El seguimiento a las 48 horas **cae dentro de las 72 h de la ventana gratuita**.
Para el 70 % del tráfico es **gratis**; para el resto cuesta 0,0113 si la
plantilla queda como utilidad, o 0,0740 si Meta la clasifica como marketing —y
el clasificador **lee el vocabulario, no la intención** (`Analisis/31` §1): hay
que redactarla como estado de una solicitud existente, sin «interés», sin «te
esperamos», sin precio.

Así redactada **se puede incluir**: 1,08 USD al mes con 800 conversaciones. Lo
que no se incluye es el reenganche comercial posterior, que es marketing puro y
va en el paquete de reactivación que la propia propuesta ya tiene (30 mensajes
por USD 10, margen 74 %). Y ese paquete **todavía no existe**: ni plantilla
aprobada, ni lista de consentimiento, ni tope en el servidor.

---

## 5. Lo técnico que hay que verificar antes de prometer

| Promesa del PDF | Estado | Qué hacer |
|---|---|---|
| **Bolsa compartida entre las dos líneas** | **Se puede.** Las rutas van `phoneNumberId → tenantId + flujo`, y el contador vive en `cuenta/estado` del comercio | Darlo de alta como **un comercio con dos flujos**, nunca como dos comercios: con dos tenants la bolsa compartida no se puede hacer cumplir |
| **…y su efecto colateral** | La conversación se identifica por `tenants/{id}/conversaciones/wa_<telefono>`, **sin el número de la empresa**: quien escriba a las dos líneas comparte una ventana, un bloque de 25 y los mismos umbrales | Es a favor del cliente y en contra de la separación de marcas que la propuesta promete. Decirlo |
| **Origen del anuncio medido** | **No llega al servidor** (§2) | Antes de firmar |
| **Enrutamiento por campaña a la recepción de cada doctor** | **No existe.** Ningún flujo clasifica por campaña ni deriva a números distintos | 1 a 2 jornadas. La pieza de «pasar con una persona» sí existe |
| **Venta con QR y validación humana** | Existe en el Demo B y en la seña de Platinum (`v0.6.0`) | Adaptación |
| **Envío autónomo de imágenes** | Existe para el QR y el catálogo; la galería por campaña, no | ½ jornada |
| **Recepción y lectura de comprobantes** | Existe desde `v0.6.0` | — |
| **Reactivación / remarketing** | **No existe** | 2 jornadas, y no se vende hasta tenerlo |
| **250 conversaciones iniciadas por día** | Límite de Meta para números nuevos | Alcanza, pero conviene saberlo antes de una campaña grande |

Y la regla que acá pesa: **el asistente nunca dice «pago acreditado», «pago
verificado» ni «recibimos tu pago»** (prohibición 3). La propuesta está bien
redactada en esto —la persona valida el comprobante y despacha el enlace—, y el
flujo tiene que decir lo mismo: que el comprobante llegó y que los datos
coinciden, nunca que el dinero entró.

---

## 6. Más allá de las 800: la bolsa

| Mensajes | Nacida de un anuncio | Sin anuncio |
|---|---|---|
| 12 | cuesta 0,016 → **+0,264** | cuesta 0,156 → +0,124 |
| 14 | cuesta 0,017 → **+0,263** | cuesta 0,180 → +0,100 |
| 25 (bloque lleno) | cuesta 0,024 → **+0,256** | cuesta 0,311 → −0,031 |

Una conversación de bolsa nacida de un anuncio deja **94 % de margen**. El
crecimiento de este cliente es el mejor negocio del contrato, y no hay ningún
volumen en el que la bolsa pierda mientras venga de campañas.

---

## 7. La oferta que yo llevaría a la mesa

| Concepto | Propuesta del PDF | Recomendado |
|---|---|---|
| Setup dual | USD 125 | **USD 250**, 50/50 |
| Licencia mensual | USD 99 por 800 | **igual**: USD 99 por 800 compartidas |
| Bolsa | 30 por USD 10 | igual |
| Cambios incluidos | 4 al mes | **2 al mes**, los demás a USD 15 |
| Rescate a las 48 h | incluido | **incluido**, con la plantilla redactada como estado de solicitud |
| Reactivación posterior | 30 mensajes por USD 10 | igual, **cuando exista** |
| Imagen = 2 mensajes | condición del servicio | **quitarla** |
| Origen del anuncio | no figura | **medido desde el primer día** |
| Revisión | no figura | **si el tráfico por anuncio baja del 40 % dos meses seguidos**, y ante un cambio de tarifas de Meta |

**El precio mensual se sostiene.** Lo que no se sostiene es el setup: 105 USD
netos contra 3 a 6 jornadas de trabajo, con dos altas de Meta, un flujo nuevo y
uno adaptado. A 250 el contrato queda sano desde el primer mes; a 125, la cuenta
recién se empareja entre el noveno y el vigésimo primer mes, y eso suponiendo
que el cliente no se vaya antes.
