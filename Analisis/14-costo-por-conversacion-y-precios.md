# Costos y precios de NovuChat desde el 1 de octubre de 2026

**08-sep-2026.** Análisis completo con las **hojas de tarifas oficiales de Meta
vigentes desde el 1 de octubre de 2026** (tarifas y niveles de volumen, en USD),
decodificadas de los archivos que pasó Andres. Reemplaza todas las versiones
anteriores: **no hay ningún cliente que pague antes de esa fecha**, así que los
precios previos ya no describen nada.

**Supuestos fijados en la reunión con Silvana:**

- Solo tarifas de octubre.
- Caché del prefijo del prompt implementada, y caché de 60 s en la lectura de
  la configuración.
- Tope de mensajes del asistente por ventana de 24 h, parametrizado por plan:
  del orden de 20 a 30.
- 12 Bs por USD.

Modelo reproducible: `Analisis/14-modelo-costos.py` (`python3`, sin
dependencias). Los parámetros de conversación vienen de
`06-costo-por-atencion.xlsx`: 25 palabras por pregunta, 40 por respuesta, 1,75
tokens por palabra, prefijo de 2.150 tokens, ventana de memoria de 8 pares.

---

## 1. Las tarifas de octubre, confirmadas

Bolivia (+591) no tiene tarifa propia: cae en **«Rest of Latin America»**, con
Paraguay, Ecuador, Uruguay, Costa Rica, Panamá y diez más. El mercado lo fija el
país del número que **recibe**, no el de la WABA.

| Categoría | USD por mensaje | Bs | Qué es para NovuChat |
|---|---|---|---|
| **Servicio** | **0,0113** | **0,1356** | **Cada respuesta del asistente** dentro de la ventana de 24 h. Hoy gratis; desde octubre se cobra |
| Utilidad | 0,0113 | 0,1356 | El recordatorio de cita. Desde octubre se cobra también dentro de la ventana |
| Autenticación | 0,0113 | 0,1356 | No se usa |
| Marketing | 0,0740 | 0,8880 | Difusión. Ver §9 |

Tres reglas que salen de las hojas y de la página de precios, y que arman todo
el modelo:

1. **Franquicia: 1.000 mensajes de servicio gratis por número de empresa por
   mes.** No acumula; se reinicia cada mes. Cada comercio tiene su número, así
   que cada comercio tiene los suyos.
2. **Los mensajes de servicio no tienen descuento por volumen.** La hoja de
   niveles de octubre solo tiene columnas para utilidad y autenticación, y los
   descuentos empiezan en 100.001 mensajes al mes por portafolio. A la escala de
   NovuChat, ni siquiera el recordatorio llega a ese tramo.
3. **Los mensajes del cliente final no se cobran nunca**, y los del asistente
   solo se pueden enviar dentro de la ventana de 24 h que abre el cliente. Eso
   no cambia.

Los precios solo pueden cambiar el 1 de enero, abril, julio u octubre, con
aviso previo. No es una subasta.

---

## 2. Qué cuesta una conversación

Costo marginal de una conversación del Flujo A (reservas) **una vez agotada la
franquicia del mes**, con el prefijo cacheado:

| Mensajes del asistente | Modelo | Meta · servicio | Meta · recordatorio | **Total** | Meta sobre el total |
|---|---|---|---|---|---|
| 4 | 0,047 | 0,542 | 0,054 | **0,643 Bs** | 93 % |
| 6 | 0,062 | 0,814 | 0,054 | **0,930 Bs** | 93 % |
| 8 | 0,079 | 1,085 | 0,054 | **1,218 Bs** | 93 % |
| **10 (típica)** | 0,097 | 1,356 | 0,054 | **1,508 Bs** | 94 % |
| 15 | 0,138 | 2,034 | 0,054 | **2,226 Bs** | 94 % |
| 20 | 0,177 | 2,712 | 0,054 | **2,943 Bs** | 94 % |
| 25 | 0,217 | 3,390 | 0,054 | **3,661 Bs** | 94 % |
| 30 | 0,257 | 4,068 | 0,054 | **4,379 Bs** | 94 % |

(El recordatorio va al 40 % de las conversaciones, las que terminan en cita.)

**Meta es el 94 % del costo. El modelo es el 6 %.** Dos consecuencias:

- **El costo es lineal en mensajes: 0,1356 Bs cada uno.** Una conversación de
  20 mensajes cuesta el doble que una de 10, exactamente.
- **La caché del prefijo ya no decide nada.** Ahorra 0,07 Bs por conversación
  sobre 1,5. Está bien tenerla, pero no es una palanca. Tampoco lo es el modelo:
  pasar a Claude Haiku con caché sumaría 0,10 Bs por conversación, un 7 %, y no
  mueve la conclusión. **La decisión de modelo puede tomarse por calidad.**

### El Flujo B es más caro que el A

Pedidos manda más mensajes por conversación que reservas: la lista interactiva
de bienvenida, la imagen del QR y la confirmación son tres mensajes que el
Flujo A no envía. Sin recordatorio, una conversación típica de pedidos cuesta
**1,86 Bs** contra 1,51 del Flujo A. Hasta septiembre el B era el flujo barato;
desde octubre es el caro. Vale para el diseño: **cada lista, cada imagen y cada
confirmación por separado es un mensaje cobrado.**

---

## 3. La franquicia de 1.000 mensajes es el eje del modelo

El costo de un comercio **no es lineal en conversaciones**. Los primeros 1.000
mensajes del mes son gratis, y con conversaciones de 10 mensajes eso son unas
**100 conversaciones**. Después, cada una cuesta 1,5 Bs.

| Conversaciones al mes | Mensajes | Gratis | Pagados | Costo mensual | Bs por conversación |
|---|---|---|---|---|---|
| 50 | 500 | 500 | 0 | 8 Bs | 0,15 |
| **100** | 1.000 | 1.000 | 0 | **15 Bs** | **0,15** |
| 150 | 1.500 | 1.000 | 500 | 91 Bs | 0,60 |
| 200 | 2.000 | 1.000 | 1.000 | 166 Bs | 0,83 |
| 300 | 3.000 | 1.000 | 2.000 | 317 Bs | 1,06 |
| 500 | 5.000 | 1.000 | 4.000 | 618 Bs | 1,24 |
| 1.000 | 10.000 | 1.000 | 9.000 | 1.372 Bs | 1,37 |

**La franquicia vale 135,6 Bs al mes por número.** Es un subsidio de Meta al
comercio chico, y es lo que hace rentable el plan de entrada: un comercio que no
pasa de 100 conversaciones le cuesta a NovuChat 15 Bs al mes.

De esto sale la regla de diseño de los planes: **el plan de entrada tiene que
caber dentro de la franquicia, y los planes grandes tienen que saber que cada
conversación adicional cuesta 1,5 Bs de verdad.**

---

## 4. Los planes actuales no cierran

Con las conversaciones típicas de 10 mensajes:

| Plan | Precio | Incluye | Mensajes | Costo mensual | Margen |
|---|---|---|---|---|---|
| Impulso | 250 Bs | 300 | 3.000 | 317 Bs | **−67 Bs** |
| Crecimiento | 450 Bs | 1.000 | 10.000 | 1.372 Bs | **−922 Bs** |
| Pro | 850 Bs | 2.500 | 25.000 | 3.634 Bs | **−2.784 Bs** |

El tope de 20 a 30 mensajes no cambia esta tabla: el problema no es la
conversación larga, es que **1.000 conversaciones cuestan 1.372 Bs aunque todas
sean normales**.

### Cuántas conversaciones soporta cada precio

| Precio | 70 % de margen · 10 mensajes | 60 % · 10 mensajes | 70 % · 6 mensajes | 60 % · 6 mensajes |
|---|---|---|---|---|
| 250 Bs | 130 | 150 | 220 | 250 |
| 450 Bs | 170 | 200 | 290 | 330 |
| 850 Bs | 250 | 310 | 410 | 510 |

Nótese lo plana que es la escalera: **850 Bs compran apenas el doble de
conversaciones que 250 Bs**, porque después de la franquicia todas cuestan lo
mismo. El plan grande no puede vender volumen: tiene que vender otra cosa.

---

## 5. Propuesta de planes

Mismos precios, volúmenes que cierran, tope por plan como lo pide Andres:

| Plan | Precio | Conversaciones | Tope de mensajes por conversación | Qué más incluye |
|---|---|---|---|---|
| **Impulso** | 250 Bs | **120** | 20 | Una persona, una agenda |
| **Crecimiento** | 450 Bs | **200** | 25 | Varias personas con agenda propia, recordatorio automático, pedidos |
| **Pro** | 850 Bs | **300** | 30 | Soporte prioritario, varios números |

Margen de cada plan según cómo conversen los clientes del comercio:

| Plan | Mezcla realista | Todas de 10 mensajes | Todas de 15 | Todas al tope |
|---|---|---|---|---|
| Impulso · 120 · tope 20 | 16 Bs → **94 %** | 45 Bs → 82 % | 131 Bs → 47 % | 218 Bs → 13 % |
| Crecimiento · 200 · tope 25 | 122 Bs → **73 %** | 166 Bs → 63 % | 310 Bs → 31 % | 597 Bs → −33 % |
| Pro · 300 · tope 30 | 273 Bs → **68 %** | 317 Bs → 63 % | 532 Bs → 37 % | 1.178 Bs → −39 % |

Mezcla realista: 60 % cortas de 5 mensajes, 30 % típicas de 10, 10 % que llegan
al tope. Promedio: 8 a 9 mensajes por conversación.

**Por qué estos números:**

- **Impulso cabe en la franquicia.** 120 conversaciones a 8 mensajes de promedio
  son 960 mensajes: NovuChat no le paga nada a Meta por servicio. Es el plan más
  rentable de los tres y el que más conviene vender.
- **Crecimiento y Pro pagan cada conversación adicional a 1,5 Bs.** Por eso el
  salto de volumen es chico. Lo que justifica el precio son las funciones, que
  es lo que el sitio ya dice: varios funcionarios, recordatorios, pedidos,
  soporte.
- **La escalera de volumen queda ×1 / ×1,7 / ×2,5** contra una de precio
  ×1 / ×1,8 / ×3,4. Ahora el precio crece más rápido que el volumen, que es lo
  correcto cuando cada unidad cuesta.

### Cuánto se puede subir el volumen si se aplican las mejoras del §7

La tabla de arriba es la **conservadora**: supone las conversaciones de hoy, de
8 a 9 mensajes de promedio. Con el catálogo web puesto y el prompt acortado a 5
o 6 mensajes, la franquicia rinde el doble:

| Plan | Precio | Conservador (hoy) | Con las mejoras del §7 | Margen entonces |
|---|---|---|---|---|
| Impulso | 250 Bs | 120 | **200** | 85 % |
| Crecimiento | 450 Bs | 200 | **350** | 63 % |
| Pro | 850 Bs | 300 | **550** | 60 % |

(Columna optimista calculada con 5,5 mensajes de promedio por conversación: 60 %
cortas de 4, 30 % de 6, 10 % de 10.)

**Recomendación: publicar la columna conservadora y trabajar para la otra.** Un
volumen prometido no se puede bajar; uno ampliado a los tres meses es una buena
noticia para el cliente y un argumento de renovación. Vender 200 conversaciones
antes de que el catálogo web esté probado con un teléfono es tomar el riesgo por
adelantado, y no hace falta.

### Excedente

Costo marginal fuera de franquicia: **1,5 Bs por conversación**. El excedente
actual —50 Bs por 150, 0,33 Bs cada una— está a un quinto del costo.

**Propuesta: 100 Bs por 25 conversaciones** (4 Bs cada una, 2,7× el costo). O
40 Bs por 10, que es lo mismo y es más fácil de explicar: «cada 10
conversaciones de más, 40 Bs». Avisar al llegar al 80 %, como ya está previsto.

---

## 6. El tope por plan: qué protege y qué no

El tope de 20 / 25 / 30 mensajes del asistente por ventana **acota la
conversación**, no el plan:

| Plan | Costo de una conversación al tope | Cuántas al tope hunden el plan |
|---|---|---|
| Impulso · tope 20 | 2,94 Bs | no se hunde: 120 al tope son 218 Bs contra 250 |
| Crecimiento · tope 25 | 3,66 Bs | **135 de 200** (68 %) |
| Pro · tope 30 | 4,38 Bs | **190 de 300** (63 %) |

Con estos topes, **un cliente abusivo no puede costar más de 4,4 Bs**, y hace
falta que dos de cada tres conversaciones del comercio sean al tope para que el
plan pierda. Es una protección razonable contra el caso individual y contra un
comercio cuyos clientes conversan mucho, pero **no reemplaza el volumen
correcto**: con 1.000 conversaciones incluidas ningún tope salva al plan.

**Implementación.** El tope exige contar los mensajes del asistente por teléfono
dentro de la ventana. La ingesta ya escribe `respuestasDelPeriodo` por
conversación en Firestore; lo que falta es que el flujo lo lea antes de
responder, o que lleve el conteo en su propia memoria por teléfono. Al llegar al
tope: una respuesta fija, aviso a recepción, y **ningún mensaje más** hasta que
abra una ventana nueva. Ese último mensaje también cuesta 0,1356 Bs; conviene
que sea uno solo.

**Lo que la consola debería mostrar** desde octubre: mensajes del asistente en
el mes contra los 1.000 gratis del número, y el promedio de mensajes por
conversación. Son los dos números que anticipan el costo, y hoy la pantalla de
consumo muestra conversaciones, no mensajes.

---

## 7. Opciones de mejora, cuantificadas

Todas se miden en lo mismo: **mensajes del asistente por conversación**, a
0,1356 Bs cada uno. Ordenadas por lo que rinden.

### 7.1 El multiplicador que cambia el tamaño de todo lo demás

La franquicia son 1.000 **mensajes**, no conversaciones. Cuántas conversaciones
entran gratis depende de cuán larga sea cada una:

| Mensajes por conversación | Conversaciones gratis al mes |
|---|---|
| 4 | **250** |
| 5 | 200 |
| 6 | 166 |
| 8 | 125 |
| 10 | 100 |

**Acortar la conversación no ahorra en proporción: multiplica.** Pasar de 10 a 5
mensajes no baja el costo a la mitad — duplica cuántas conversaciones son
gratis, y recién después baja el costo de las que sobran. Es la razón por la que
todo lo que sigue rinde más de lo que parece.

### 7.2 Catálogo web en el Flujo B · ahorra 68 %

Ya está construido en el worktree `NovuChat-catalogo-web` (§11). Hoy un pedido
son unos 13 mensajes: lista interactiva, navegación, cantidades, total, QR,
confirmación. Con el catálogo web son 4 o 5: saludo con el enlace, total con el
QR cuando vuelve el carrito, y confirmación.

| | Mensajes | Costo |
|---|---|---|
| Flujo B hoy | ~13 | 1,860 Bs |
| Con catálogo web | 4 | **0,589 Bs** |
| Con catálogo web | 5 | 0,725 Bs |

**Ahorra 1,27 Bs por pedido, el 68 %.** Y como el carrito viaja de servidor a
servidor, además cierra el defecto del pedido editable. **Es la mejor mejora
disponible y ya está hecha**: falta ponerla en marcha.

Una advertencia del propio diseño: si el enlace sale **fuera** de la ventana de
24 h es una plantilla utility, 0,136 Bs. Sigue siendo barato, pero conviene que
el enlace salga como respuesta a un mensaje del cliente, no como iniciativa.

### 7.3 Menos mensajes en el Flujo A · ahorra 38 %

| Mensajes | Costo | Contra 10 |
|---|---|---|
| 10 | 1,508 Bs | — |
| 8 | 1,218 Bs | −19 % |
| **6** | **0,930 Bs** | **−38 %** |
| 4 | 0,643 Bs | −57 % |

Es trabajo de prompt: ofrecer catálogo y horarios de una vez, no preguntar lo que
ya se sabe, confirmar y despedirse en el mismo mensaje. **La regla de «máximo 3
oraciones» ahora juega en contra**: se escribió para que el asistente no fuera
pesado, y hoy un mensaje completo es más barato que dos cortos. Conviene
reemplazarla por un límite de mensajes, no de largo.

**El efecto combinado con la franquicia es grande.** Un plan de 200
conversaciones:

| Mensajes por conversación | Mensajes al mes | Costo | Margen sobre 450 Bs |
|---|---|---|---|
| 10 | 2.000 | 166 Bs | 63 % |
| **6** | **1.200** | **50 Bs** | **89 %** |

A 6 mensajes, 200 conversaciones **casi entran enteras en la franquicia**.

### 7.4 La franquicia es por número, no por comercio · ahorra 136 Bs/mes

«Cada número telefónico de la empresa recibirá 1.000 mensajes de servicio
gratuitos». Un comercio con dos flujos —reservas y pedidos— **tiene dos números,
y por lo tanto 2.000 mensajes gratis**:

| Comercio | Un número | Dos números | Ahorro |
|---|---|---|---|
| 300 conversaciones × 10 mensajes | 271 Bs | 136 Bs | **136 Bs/mes** |
| 200 conversaciones × 8 mensajes | 81 Bs | 0 Bs | 81 Bs/mes |

La decisión de «un número por flujo», que hasta ahora era una limitación
—obligaba a mantener dos flujos de n8n—, **pasa a tener un valor económico de
136 Bs al mes por número**, que es más de la mitad del plan Impulso.

**Dónde está el límite.** Que un comercio con dos flujos reales tenga dos
números es la estructura que ya existe y su franquicia le corresponde. Repartir
**un mismo flujo** entre varios números para cosechar franquicias sería otra
cosa, y es de las que Meta cierra. La recomendación es no cruzar esa línea, y sí
contarle al comercio que sumar el segundo flujo le sale más barato de lo que
parece.

### 7.5 La ventana de punto de entrada gratuito · ahorra 94 %

Si el cliente llega por un anuncio de clic a WhatsApp o por el botón de una
página de Facebook, y el negocio responde dentro de 24 h, se abren **72 horas
donde todo es gratis**, plantillas incluidas. Una conversación de 10 mensajes
pasa de 1,508 Bs a **0,097 Bs**: solo el modelo.

Es un argumento comercial nuevo —«las conversaciones que llegan de tus anuncios
no consumen tu plan»— y una recomendación operativa: al comercio le conviene que
su tráfico nazca de anuncios. El anuncio lo paga él con su presupuesto de
marketing, y **eso sí es una subasta**. La página de precios lo describe como
vigente y no aparece entre los cambios de octubre, pero **hay que medirlo con un
cliente real antes de prometerlo**.

### 7.6 Lo que ya no rinde

**Caché del prefijo y elección de modelo.** Ahorran 0,07 y 0,10 Bs sobre 1,5.
Están bien hechas y no hay que tocarlas, pero no hay nada más que sacar de ahí.
**La decisión de modelo pasa a tomarse por calidad**, que es una buena noticia.

### 7.7 Una tensión nueva que conviene mirar

Los tres últimos cambios que entraron a `main` —lista interactiva armada desde
el catálogo, pedido de varios productos, preguntar siempre las unidades— **suman
mensajes por conversación**. Son correctos para la calidad del pedido y cada uno
tiene su motivo. Desde octubre, cada uno también cuesta 0,1356 Bs por
conversación.

No es un argumento para revertirlos: es un criterio nuevo para las revisiones.
**Todo cambio de flujo debería declarar cuántos mensajes agrega o quita**, igual
que hoy declara qué prueba lo cubre. El catálogo web (§7.2) es justamente el
cambio que devuelve con creces lo que estos tres consumen.

---

## 8. A escala: 100 y 300 comercios

Todos en el Impulso propuesto, 120 conversaciones de 10 mensajes:

| | 100 comercios | 300 comercios |
|---|---|---|
| Ingreso | 25.000 Bs | 75.000 Bs |
| Costo variable (modelo + Meta) | 4.533 Bs | 13.598 Bs |
| Fijos de plataforma | 34 Bs | 730 Bs |
| **Costo sobre ingreso** | **18 %** | **19 %** |

Los fijos son los de siempre: la VM de OCI entra en Always Free hoy y a 300
flujos hay que pagarla (~55 USD, estimación); Secret Manager 1,32 USD; Firebase
dentro de la capa gratuita con la caché de configuración puesta. **AWS no se
usa.** Y lo que sí se rompe a 300 comercios no es el costo: son los 20 números
por WABA verificada y los 300 flujos de n8n a mantener a mano, que ya están
descritos en `13-requisitos-alta-clientes.md`.

Con la mezcla de planes que se venda, el costo directo queda entre el 20 % y el
35 % del ingreso. **Es un negocio que cierra, con márgenes más finos que los que
se pensaban en agosto, y donde cada mensaje cuenta.**

---

## 9. Qué cambia en la oferta

| Dice hoy | Qué hacer |
|---|---|
| 300 / 1.000 / 2.500 chats | **120 / 200 / 300 conversaciones**, con tope de 20 / 25 / 30 mensajes del asistente por conversación |
| «1 chat equivale a 24 horas continuas de interacción» | «Una conversación son hasta N respuestas del asistente en 24 horas.» El tope hay que decirlo, no esconderlo: es lo que hace honesto el precio |
| Excedente 50 Bs por 150 | **40 Bs por 10 conversaciones** |
| «Difusión masiva por plantillas aprobadas» en Pro | **Nunca incluida.** Marketing cuesta 0,89 Bs por mensaje: 1.000 contactos son 888 Bs, más que el plan. Si se ofrece, por paquete y aparte |
| «Procesamiento de audios», «responde audios» | No existe. Y cada audio transcrito sería además una respuesta cobrada |
| «Validación autónoma de comprobantes por QR» | Ningún flujo la ejecuta todavía |
| «Reserva de mesas», «Colegios», «Consultas SQL», «Integración a ERPs», «Fidelización» | No existen; rotular como próximamente o quitar |
| «El 80 % no vuelve»; «391 % más conversión» | Sin fuente la primera; la segunda contradice al sitio, que dice «siete veces» citando HBR |

Y una cláusula nueva en el contrato: **el precio se revisa cuando Meta cambie
la tarifa**, que puede ocurrir cada trimestre con un mes de aviso. Con el 94 %
del costo en manos de Meta, comprometer un precio por un año sin esa cláusula
es tomar el riesgo de Meta por cuenta propia.

---

## 10. Cómo verificar el 1 de octubre

- **El webhook de estado de cada mensaje** trae el objeto `pricing`. Hoy las
  respuestas del asistente llegan con `"billable": false` y `"type":
  "free_customer_service"`. **El 1 de octubre pasan a `"billable": true`.** Si
  la ingesta guardara ese campo, el cambio se vería solo, mensaje por mensaje,
  y la consola podría mostrar el costo real en vez del estimado.
- **`pricing_analytics`** en la API de la WABA da el desglose facturado por
  categoría y nivel. Es la conciliación contra la factura de Meta.
- **Meta Business Suite → Facturación**, para el cargo real del mes.
- Las hojas de tarifas se descargan de
  `developers.facebook.com/documentation/business-messaging/whatsapp/pricing`,
  sección «Tarjetas de puntuación a partir del 1 de octubre de 2026», fila
  «Rest of Latin America». Vienen como XLSX aunque la descarga las nombre `.csv`.

**Lo único que este modelo no puede confirmar desde acá:** el precio de lectura
de caché de Flash-Lite (supuse 25 % de la entrada). Pesa 0,02 Bs por
conversación; no cambia nada.

---

## 11. Cómo se cruza esto con lo que está en marcha

Al 8 de septiembre hay tres frentes abiertos en worktrees, y **dos de ellos
cambian este análisis**.

### `claude/novuchat-prepago-clientes-49caf7` — el sistema de cobro

Construido el 07/09 con Silvana: planes, saldo por conversación, bolsas que no
vencen, mes de prueba de 20 conversaciones, corte por 409, alta desde la consola
y un flujo interno de cobro por WhatsApp. 5.400 líneas, 92 pruebas nuevas, nada
desplegado.

**La arquitectura es la correcta y no hay que tocarla.** El conflicto es de
números: está cargado con **Base 300 / Crecimiento 1.000 / Corporativo 2.500 y
bolsas de 150 por 50 Bs**, que son los volúmenes que este análisis muestra
insostenibles desde octubre (§4), y un excedente a un quinto del costo (§5).

**La buena noticia es que el arreglo es chico.** El propio diseño dice que los
planes están «en un solo lugar», `functions/src/prepago.ts`, que además es puro
y se prueba sin emulador. Cambiar los volúmenes y el precio de la bolsa es
editar esa tabla y sus pruebas. **Hacerlo antes de que el prepago se despliegue**
evita migrar cuentas ya creadas.

Dos piezas del prepago que este análisis vuelve más importantes de lo que
parecían:

- **«No corta una conversación abierta».** Correcto, y además ahora tiene un
  costo medible: los mensajes de esa conversación se pagan igual. Con el tope
  del §6 puesto, el peor caso está acotado.
- **El número interno de NovuChat gasta su propia franquicia.** El flujo de
  cobro manda menús, QR y recordatorios a los comercios desde el alias
  `cliente20`. Con 300 comercios y unos pocos mensajes de cobro cada uno, ese
  número puede pasar los 1.000 gratis y empezar a costar. Es chico, pero
  **conviene contarlo como costo de plataforma y no olvidarlo**.

### `disenio/catalogo-web` — el ahorro más grande disponible

Es la mejora del §7.2: **68 % del costo de un pedido**. Ya tiene el sitio, el
carrito que no se falsifica, las fotos, la importación desde planilla y 50
pruebas. Falta lo que el propio documento enumera: dos nodos de n8n, la
plantilla de Meta, y la prueba contra un teléfono real.

**Este análisis le agrega un argumento que antes no tenía.** El catálogo web se
propuso para resolver los catálogos grandes y el pedido editable. Desde octubre
también es, de lejos, la mayor reducción de costo del sistema. **Deja de ser una
mejora de producto y pasa a ser parte del modelo de negocio.**

### `fix/suspender-corta-de-verdad` — cerrada

El defecto que este documento reportó el 07/09 —el 409 de un comercio suspendido
caía al respaldo y el asistente seguía atendiendo— está corregido en esa rama.
Conviene confirmar que la corrección cubre **los dos** caminos del 409, porque
el prepago agrega el suyo (`sin_pago` y `sin_conversaciones`) sobre el mismo
mecanismo.

### La numeración de `Analisis/`, resuelta desde acá

Tres ramas escribieron a la vez y las tres reclamaban el número 11. **Esta rama
se corrió para dejar libres los números de las otras dos**, que ya estaban
confirmados en un commit antes que los de acá:

| Número | Documento | Rama |
|---|---|---|
| 11 | `11-prepago-y-alta-de-clientes.md` | `claude/novuchat-prepago-clientes-49caf7` |
| 12 | `11-catalogo-web-propio.md` → **renumerar a 12** | `disenio/catalogo-web` |
| **13** | `13-requisitos-alta-clientes.md` | esta rama (antes 08, que chocaba con `08-qr-simple-lo-que-cambia.md`) |
| **14** | `14-costo-por-conversacion-y-precios.md` + `14-modelo-costos.py` | esta rama (antes 11) |
| **15** | `15-unidad-de-cobro.md` | esta rama (antes 12) |

**Queda una sola renumeración pendiente y no es de esta rama:** el catálogo web
tiene que pasar de 11 a 12 cuando se fusione. Es un `git mv` y dos referencias.

El documento y su modelo comparten número a propósito —`14-…md` y `14-…py`—,
igual que el `06-costo-por-atencion.xlsx` que este análisis extiende.
