# Clínica Platinum: reservas con seña de 50 Bs, siete agendas y USD 180 por 2.000 conversaciones

**16-sep-2026.** Análisis de factibilidad comercial pedido por Andres antes de
ofertar. El cliente pidió al inicio reservas y recordatorios con **7
calendarios** (el nivel Corporativo de la oferta); ahora quiere **cobrar 50 Bs
fijos antes de confirmar cada reserva**, lo que implica un **flujo mixto**
(agenda + QR del comercio + cotejo del comprobante + seguimiento del pago) y
una **consola operada por NovuChat** (la clínica solo monitorea). Precio en
estudio: **USD 180 por 2.000 conversaciones al mes**.

Unidad de cobro vigente: **una conversación es un bloque de hasta 25
respuestas del asistente a un teléfono en la ventana de 24 h; la respuesta 26
factura otra** (`CLAUDE.md` §2, `Analisis/27`). Tarifas de Meta desde el
01/10/2026 (`Analisis/14`). Impuestos 16 %. Modelo reproducible:
`Analisis/30-platinum-modelo.py`.

Se asume que «180» son **dólares** (2.268 Bs al TCO de 12,60): la lista se
denomina en USD (`CLAUDE.md` §3). Datos del cliente: `CLIENTES/PLATINUM/`.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **¿Se puede hacer el flujo mixto?** | Sí, pero **no existe**: ningún flujo lee el cobro real, los tres nodos del OCR no están hechos, y la reserva con seña necesita una pieza nueva (retener el horario mientras llega el comprobante). Unas **3 a 4 jornadas**, más media para las 7 agendas |
| **¿Conviene USD 180 por 2.000?** | **No.** Son 0,09 USD por conversación: la mitad del plan más grande de la lista (0,18) y un cuarto de la bolsa. Con la conversación con seña, que tiene unos 13 mensajes, **se pierde plata a partir de ~980 conversaciones al mes**, y una clínica de 7 odontólogos con campañas en Facebook puede llegar a ese volumen |
| **Lo que sí conviene** | **USD 180 por hasta 1.000 conversaciones** (0,18: la misma tarifa del plan Corporativo, con el doble de volumen), bolsa de 30 por USD 10 más allá, **instalación a medida** por el flujo mixto y la consola operada, y el contrato con las cláusulas del §6 |
| **La condición de fondo** | Que la conversación con seña cierre en **≤ 12 mensajes**. Es una decisión de diseño del flujo (§3), no de precio |

---

## 1. Qué cambia en la conversación cuando hay seña

Hoy, una reserva sin fricción son 8 mensajes del asistente; la típica, 10
(`Analisis/14` §2). El flujo mixto agrega:

| Pieza | Mensajes por conversación | Quién lo paga |
|---|---|---|
| Elegir odontólogo entre 7 (`Analisis/24` §3) | +1 a +2 | la clínica, en su plan |
| El QR de 50 Bs con el resumen de la cita, en un solo mensaje | +1 | la clínica |
| «Recibí tu comprobante, los datos coinciden, tu cita queda reservada» — **el mismo mensaje** que hoy confirma la cita | 0 | — |
| Comprobante ilegible o que no cuadra (una de cada cinco, supuesto) | +0,2 | la clínica |
| Aviso a recepción con el comprobante (texto libre desde el número de la clínica, `Analisis/27` §5.4.1) | +1 por cita pagada | **NovuChat** (no se factura) |
| Recordatorio 24 h antes (plantilla de utilidad) | +1 por cita | NovuChat |
| Lectura del comprobante con Gemini (imagen o PDF) | ≈ 0,0005 USD | NovuChat; despreciable |

**La conversación con seña queda en 12 a 13 mensajes**, contra 10 de una
reserva simple. Eso, y no el QR en sí, es lo que mueve la economía.

Hay una regla del proyecto que acá pesa más que en ningún otro cliente: **el
asistente nunca dice «pago acreditado»** (prohibición 3). El cotejo del
comprobante confirma que la imagen coincide con la cita; **quien confirma que
entraron los 50 Bs es la clínica, mirando su banco**. Comercialmente hay que
decirlo antes de firmar: la seña le quita trabajo a recepción con los que no
aparecen, pero le agrega la verificación del pago. La pantalla «Cobros» de la
consola lista los comprobantes cotejados para eso.

---

## 2. La economía de USD 180 por 2.000

### 2.1 Por conversación

| Mensajes del asistente | Costo (fuera de la franquicia) | Ingreso neto a 0,09 | Margen |
|---|---|---|---|
| 8 | 0,106 | 0,076 | −0,031 |
| 10 | 0,130 | 0,076 | −0,055 |
| **13 (con seña)** | **0,166** | 0,076 | **−0,091** |
| 25 (bloque lleno) | 0,310 | 0,076 | −0,234 |

**Fuera de la franquicia, a 0,09 USD toda conversación pierde**, incluso la
más corta. El plan solo cierra mientras los 1.000 mensajes gratis del número
tapen el grueso del mes, y eso son 77 conversaciones de 13 mensajes.

### 2.2 El mes, según cuánto use la clínica

Ingreso neto de impuestos: **151,20 USD**. Costo con recordatorio, aviso a
recepción y OCR en el 40 % de las conversaciones (las que terminan en cita
pagada).

| Conversaciones al mes | 10 msj: margen | **13 msj: margen** | 16 msj: margen | Lo que pagaría por lista (Corporativo + bolsas) |
|---|---|---|---|---|
| 300 | +123 (82 %) | +113 (74 %) | +102 (67 %) | USD 90 |
| 500 | +97 (64 %) | +79 (52 %) | +61 (41 %) | USD 90 |
| 800 | +58 (38 %) | +30 (19 %) | +1 (1 %) | USD 190 |
| **1.000** | +32 (21 %) | **−4 (−3 %)** | −40 | USD 260 |
| 1.250 | −1 | −45 | −90 | USD 340 |
| 1.500 | −33 | −87 | −141 | USD 430 |
| **2.000** | −98 | **−170 (−112 %)** | −242 | USD 590 |

**Punto de equilibrio:** 1.246 conversaciones a 10 mensajes; **977 a 13**; 803
a 16; 524 si todas llenan el bloque.

Dos lecturas:

1. **Hasta 800 conversaciones, USD 180 es prácticamente el precio de lista**
   (Corporativo más diez bolsas son 190). La oferta no regala nada ahí.
2. **El regalo está entre 800 y 2.000**, y ahí es donde pierde NovuChat: a plena
   carga, Meta sola cuesta 282 USD contra 151 de ingreso. La franquicia de
   1.000 mensajes cubre el 4 % del tráfico.

### 2.3 ¿Va a llegar la clínica a ese volumen?

El argumento de `Analisis/21` §9 —«el plan Pro no llega a las 500 y eso es
ingreso directo»— **vale para una cartera, no para un contrato a medida**: si
este cliente sí usa lo que compró, no hay otros 99 que lo compensen.

Y este cliente puede usarlo. Siete odontólogos a seis pacientes por día y 24
días son unas **1.000 citas al mes**. Si la mitad se agenda por WhatsApp y por
cada cita hay una consulta que no cierra (campañas de Facebook), son **700 a
1.000 conversaciones**: justo el punto de equilibrio. Y con 2.000 «incluidas»
la clínica no tiene ningún motivo para cuidar el consumo.

**Lo que 21 §9.4 ya había calculado:** USD 90 por 1.000 da vuelta la cartera
(−10 %). USD 180 por 2.000 es exactamente esa proporción.

### 2.4 Lo que el bloque de 25 protege acá, y lo que no

Con 2.000 incluidas, un bloque adicional no le cuesta nada a la clínica y le
cuesta 0,305 USD a NovuChat: **el bloque no protege el margen de un plan que
nunca se llena**. Lo único que pone techo es el par de umbrales (operador a
50, bloqueo a 100): **1,19 USD por ventana**, que a 0,09 son 16
conversaciones de ingreso. Los umbrales tienen que estar publicados en el
flujo de Platinum antes del 1 de octubre (`Analisis/27` §5.4.3); conviene
verificarlo, porque el flujo se creó el 16/09 desde `main` y el JSON con
umbrales está pendiente de publicar (`CLAUDE.md` §7).

---

## 3. Alternativas con el mismo precio

| Oferta | USD por conversación | Margen a plena carga, 13 msj | Comentario |
|---|---|---|---|
| USD 180 por 600 | 0,300 | +63 (41 %) | Muy caro contra la lista: 600 por lista son 130 |
| USD 180 por 800 | 0,225 | +30 (19 %) | La tarifa de Crecimiento. Segura |
| **USD 180 por 1.000** | **0,180** | **−4 (−3 %) · +32 a 10 msj · +8 a 12** | **La tarifa de Corporativo, con el doble de volumen.** Cierra si la conversación queda en ≤ 12 mensajes |
| USD 180 por 1.250 | 0,144 | −45 | Por debajo de la lista |
| USD 180 por 2.000 | 0,090 | −170 | La oferta en estudio |

**Recomendación: USD 180 por hasta 1.000 conversaciones**, y bolsa de 30 por
USD 10 más allá. Argumentos para la mesa:

- Es **el doble del plan más grande publicado por el doble de precio**: nadie
  tiene que explicar una tarifa distinta.
- 1.000 conversaciones son **más de 40 por día hábil**, más de lo que 7
  agendas pueden convertir en citas. Para la clínica es, en la práctica,
  «sin límite».
- Si un mes las supera, paga 0,333 por las siguientes. Es la regla de todos.

Y una condición que va en el diseño, no en el contrato: **la conversación con
seña tiene que cerrar en 12 mensajes o menos.** A 1.000 conversaciones cada
mensaje de más cuesta 12 USD al mes (11,30 de Meta). Las tres decisiones que
lo logran: ofrecer los odontólogos con horarios **en un solo mensaje**; el QR
**con el resumen de la cita** en el mismo mensaje; y la confirmación del
comprobante **y** de la cita en uno solo.

### 3.1 Lo que se cobra aparte

| Concepto | Propuesta | Por qué |
|---|---|---|
| **Instalación a medida** | **USD 250 a 350** (lista: «desde USD 125») | Flujo mixto nuevo (3–4 jornadas), 7 calendarios compartidos y verificados, consola cargada por NovuChat. `Analisis/24` §5.3: siete agendas con cobro es el cliente del setup a medida, no del plan |
| **Consola operada por NovuChat** | Incluir en los 180 **un cupo definido** (por ejemplo, hasta 4 cambios de configuración por mes: precios, horarios, campañas, agendas) y **USD 15 por cambio adicional** | «No va a configurar, solo monitorear» es horas de una persona cada mes. Sin cupo, es ilimitado y gratis |
| **La seña** | **Nada.** Los 50 Bs van a la cuenta de la clínica; NovuChat no cobra por comprobante | `CLAUDE.md` §6: no se cobra distinto por flujo. Y cobrar por pago cotejado convertiría a NovuChat en algo parecido a un procesador, que no es |

El flujo mixto con seña es además **producto reutilizable** (cualquier
consultorio, salón o taller que cobre reserva), lo que justifica que NovuChat
absorba parte del desarrollo y no lo cargue entero a Platinum.

---

## 4. Factibilidad técnica: lo que hay y lo que falta

| Pieza | Estado | Falta | Esfuerzo |
|---|---|---|---|
| QR real del comercio: registro, validación, redibujado | Hecho en la consola (`Configuración de QR`, `Analisis/07` y `08`) | **Ningún flujo lee `cobroReal`**: el asistente sigue mandando el QR de demostración (`ESTADO.md`) | ½ jornada |
| Lectura del comprobante (OCR) | Diseñado (`Analisis/07` §4: descargar de Meta con token, leer con Gemini, cotejar con las funciones ya probadas) | Los tres nodos en el flujo, y el prompt de lectura | 1 jornada, con prueba contra comprobantes reales de dos bancos |
| **Retener el horario mientras llega la seña** | **No existe.** Hoy la cita se crea al confirmar | Crear el evento como «PENDIENTE DE SEÑA» al enviar el QR; al llegar el comprobante cotejado, pasarlo a confirmado; un flujo programado (como el de recordatorios) que borre los pendientes vencidos a los 30 min, **sin mandarle mensaje al cliente** (ahorra 0,0113 y evita el reclamo) | 1 jornada |
| Cotejo del importe fijo | El cotejo compara importe y cuenta destino | Importe fijo de 50 Bs: más simple que el pedido de restaurante | incluido |
| 7 agendas | Publicado «hasta 10»; hoy prudente hasta 8 (`Analisis/24` §5.1) | **El arreglo del §4 de `Analisis/24`** (verificar solo el calendario que recibió la cita) antes de operar con 7: hoy el candado hace 7 llamadas a Google por cita y suma ~2 s | ½ jornada, y acelera a todos los clientes |
| Umbrales 50/100 en el flujo vivo | Servidor en `main`; JSON de los flujos listo, **sin publicar** | Publicar y probar con teléfono (aceptación 24a–c de `CLIENTES/PLATINUM/aceptacion.md`) | ½ jornada |
| Consola operada por NovuChat | Sin pantalla del propietario (`Analisis/29`): los cambios se hacen por script o Function | Fase 1 de `Analisis/29` (plan, umbrales, suspender) hace de esto trabajo de minutos y no de scripts | 2 jornadas, ya justificadas por otros motivos |
| Aviso a recepción con el comprobante | Texto libre, se pierde si recepción no escribió en 24 h (`Analisis/25` §3.1) | Plantilla de utilidad para el aviso interno (ya está pendiente en la ficha de Platinum) | pendiente de Meta |

**Total: 3 a 4 jornadas para el flujo mixto**, más media para las agendas,
más lo que ya está pendiente por otras razones. Nada de esto se prueba sin
teléfono y sin comprobantes reales.

---

## 5. Lo que puede cambiar la cuenta a favor: los anuncios

Platinum llega con campañas de Facebook («Vi el anuncio», prueba 19 de la
aceptación). Si el paciente entra por un **anuncio de clic a WhatsApp**, Meta
abre 72 horas donde **todos los mensajes son gratis** (`Analisis/14` §7.5): la
conversación con seña pasa de 0,166 a 0,015 USD. Con la mitad del tráfico
naciendo de anuncios, el punto de equilibrio a 13 mensajes sube de 977 a
más de 1.700 conversaciones.

**No se promete** (`CLAUDE.md` §6) hasta medirlo. Pero **este es el cliente
para medirlo**: el primer mes, guardar en la conversación el origen del
webhook (`referral`) y el objeto `pricing` de cada mensaje enviado. Si se
confirma, es la razón para revisar el precio a los tres meses **hacia
abajo**, y un argumento comercial que ningún competidor da.

---

## 6. El contrato: lo que hay que dejar escrito

Además de lo que ya pide `Analisis/25` §4 para Q'Taco (definición de
conversación como bloque de 25 en 24 h, USD cobrado en Bs al TCO del BCB con
el TCO anotado en cada pago, revisión si Meta cambia la tarifa, retención de
12 meses):

1. **Conversaciones incluidas: 1.000 al mes**, sin acumular; bolsa de 30 por
   USD 10 más allá.
2. **Revisión a los tres meses con dos datos**: la distribución de mensajes
   por conversación y la proporción de conversaciones nacidas de anuncios.
   Puede bajar el precio (§5) o subirlo (si la conversación pasa de 13).
3. **La seña la confirma la clínica.** El asistente informa que el comprobante
   llegó y coincide; la cita queda reservada **sujeta a la verificación del
   pago por la clínica**. Va en el contrato y en el mensaje al paciente.
4. **Horarios retenidos 30 minutos** a la espera del comprobante; vencido el
   plazo se liberan sin aviso.
5. **Devoluciones y reprogramaciones de la seña son de la clínica**, no de
   NovuChat. El asistente puede reprogramar la cita; el dinero no lo toca.
6. **Cupo de cambios de configuración** operados por NovuChat (§3.1).
7. **Los umbrales de atención** (50 / 100 respuestas por ventana) existen y se
   muestran en «Estado de cuenta»; no son un diferenciador ni se negocian.

---

## 7. Qué medir el primer mes

| Dato | Para qué | Dónde |
|---|---|---|
| Mensajes por conversación (distribución) | Si la conversación con seña quedó en ≤ 12 | `ventanas.respuestas` cuando exista (`Analisis/27` §8); hasta entonces, las ejecuciones de n8n |
| Conversaciones nacidas de anuncios y su `pricing` | El §5 | `referral` del webhook; objeto `pricing` de los estados |
| Comprobantes cotejados / ilegibles / que no cuadran | Cuántos mensajes extra cuesta el OCR y cuánto trabajo le deja a recepción | pantalla «Cobros» |
| Horarios retenidos que vencieron sin seña | Si los 30 minutos son muchos o pocos, y cuántas citas se pierden por pedir seña | el flujo programado que los borra |
| Bloques adicionales sobre conversaciones | La cola, como en todos los clientes | consumo del mes |
