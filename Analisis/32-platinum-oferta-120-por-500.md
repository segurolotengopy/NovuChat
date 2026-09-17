# Platinum: USD 120 por 500 conversaciones con seña, seguimientos y reactivación

**16-sep-2026.** Tercera vuelta sobre la oferta a Clínica Platinum, después de
`Analisis/30` (USD 180 por 2.000: no conviene) y `Analisis/31` (seguimiento de
leads). Propuesta de Andres:

| Incluido en **USD 120 al mes** | Aparte |
|---|---|
| 500 conversaciones (bloques de 25 respuestas en 24 h) | **Reactivación** después de las 48 h: **30 mensajes de marketing por USD 10** |
| Recordatorio de cita a quienes agendaron | |
| Seña por QR del comercio con cotejo del comprobante | |
| Un recordatorio de solicitud pendiente por lead | |
| Aviso de horario liberado, **solo dentro de las 48 h** de la solicitud | |

Tarifas de `Analisis/14`; modelo `Analisis/30-platinum-modelo.py`; impuestos
16 %. Ingreso neto: **100,80 USD**. Precio por conversación: **0,24** (la lista
Corporativo es 0,18; la bolsa, 0,333).

---

## 0. ¿Conviene? Sí, con tres condiciones

**Es la mejor forma de las tres que se analizaron.** Pone el precio fijo bajo
y hace que el crecimiento lo pague la bolsa: si la clínica usa 500, NovuChat
gana el 25 % con la conversación con seña; si usa más, cada conversación extra
deja 0,114 USD neto. No hay ningún volumen en el que pierda, salvo que la
conversación se vaya a 18 mensajes o más.

Las tres condiciones:

1. **Instalación a medida aparte** (USD 250–350). Nada de lo incluido existe
   todavía: ni la seña, ni los seguimientos, ni el aviso de horario liberado.
   Son unas **6 jornadas**; a 25 USD de margen por mes, incluirlas en la cuota
   es regalar dos años de la cuenta.
2. **Cupo de operación de la consola.** El margen de plena carga son 25–31 USD
   al mes: **una hora y media de trabajo**. Si NovuChat opera la consola sin
   cupo, la cuenta rinde cero.
3. **La conversación con seña en 12–13 mensajes**, como en `Analisis/30` §3.
   Hay holgura hasta 18; no hay que gastarla.

---

## 1. El mes, con todo lo incluido

Costo de los seguimientos incluidos (`Analisis/31` §3): 1,13 (en ventana) +
2,26 (solicitud pendiente, utilidad) + 0,57 (horario liberado, 50 avisos) =
**3,96 USD al mes**. Las conversaciones que reactivan se cuentan dentro de las
500 o salen de la bolsa.

| Conversaciones | 10 msj | **12 msj** | **13 msj (con seña)** | 16 msj | 25 msj (todas llenas) |
|---|---|---|---|---|---|
| 300 | +69 (68 %) | +62 (61 %) | +58 (58 %) | +48 (47 %) | +15 (15 %) |
| 400 | +56 (56 %) | +46 (46 %) | +42 (41 %) | +27 (27 %) | −16 |
| **500** | +43 (43 %) | **+31 (31 %)** | **+25 (25 %)** | +7 (7 %) | −47 |

**Se pierde a partir de 18 mensajes por conversación**, con las 500 usadas.
Con una cola del 10 % de ventanas que llenan el bloque y el resto a 12, el
margen queda en unos 24 USD. Con los umbrales 50/100 el techo por ventana
sigue en 1,19 USD (`Analisis/27` §5.4): a 0,24 son cinco conversaciones de
ingreso, no dieciséis como a 0,09.

### 1.1 Más allá de las 500: la bolsa trabaja a favor

Una conversación extra se cobra 0,333 (0,28 neto) y cuesta 0,166 con seña:
**+0,114 cada una**. Y comparado con las otras dos ofertas:

| Uso mensual | **USD 120 + bolsas** | USD 180 por 1.000 (`30`) | Lista: 90 + bolsas |
|---|---|---|---|
| 500 | 120 | 180 | 90 |
| 600 | 160 | 180 | 130 |
| 680 | 180 | 180 | 150 |
| 800 | 220 | 180 | 190 |
| 1.000 | 290 | 180 | 260 |

Por debajo de 680 conversaciones la clínica paga menos que con 180/1.000; por
encima, NovuChat cobra más. **Las dos partes ganan con el mismo contrato en el
tramo donde cada una está**, y para la clínica el precio empieza donde puede
comprobarlo. Si Platinum pasa de 800 dos meses seguidos, se le ofrece el
escalón de 180 por 1.000: para entonces hay datos reales de mensajes por
conversación, que es lo que `Analisis/30` pedía antes de firmar ese número.

### 1.2 Sobre la lista

Son USD 30 más que Corporativo por el mismo volumen. Lo que los explica, en
una línea para la mesa: **la seña por QR, el seguimiento de los que no
terminaron, el aviso de horario liberado y la consola operada por NovuChat**.
Ninguna de las cuatro está en el plan de lista. El 33 % de sobreprecio es
moderado para cuatro servicios; el riesgo comercial es que el cliente compare
solo el volumen, y por eso la propuesta escrita tiene que listar los cuatro
con nombre.

---

## 2. La reactivación: 30 por USD 10

| | |
|---|---|
| Precio por mensaje | 0,333 USD (0,28 neto) |
| Costo Meta (marketing) | 0,074 |
| **Margen** | **0,206 por mensaje, 6,18 por paquete (74 %)** |
| Para la clínica | 30 mensajes → ~3 respuestas → ~1,5 citas de 500 Bs ≈ 60 USD de valor por 10 USD |

Mejor que los 50 por USD 10 que proponía `Analisis/31`: más margen y un
paquete más chico, que se compra sin pensarlo. Con 200 leads sin cita al mes
son hasta siete paquetes (USD 70); lo esperable es que compren dos o tres.

Cada respuesta a una reactivación **abre una conversación** que se factura
(dentro de las 500 o de la bolsa). Eso también hay que decirlo: la
reactivación vende conversaciones, no las regala.

Las reglas no cambian: plantilla aprobada como Marketing, solo a números con
consentimiento registrado (el «aviso de horario liberado» es la forma natural
de obtenerlo), texto aprobado por la clínica, tope mensual **en el servidor**,
y se apaga si baja la calificación del número. El límite de 48 h es
comercial, no de Meta: la plantilla de utilidad de «solicitud pendiente» vale
igual a las 72 h; es la frontera que define cuándo el seguimiento deja de
estar incluido y pasa a ser paquete. Conviene dejarla así de clara en el
contrato.

---

## 3. Lo que hay que construir para poder cobrar esto

| Pieza | Doc | Jornadas |
|---|---|---|
| Flujo mixto: QR real en el flujo, tres nodos del OCR, retención del horario 30 min, cotejo del importe fijo | `Analisis/30` §4 | 3–4 |
| Arreglo del candado para 7 calendarios (verificar solo el que recibió la cita) | `Analisis/24` §4 | ½ |
| Estado de la solicitud, flujo «Seguimientos», plantilla de solicitud pendiente, lista de no contactar, contadores | `Analisis/31` §5 | 2 |
| Aviso de horario liberado: evento al cancelar una cita, cruce con las solicitudes en espera del mismo odontólogo, plantilla de utilidad, corte a las 48 h | `Analisis/31` §4 | 1 |
| Paquete de reactivación: consentimiento, campaña, tope en el servidor, pantalla | `Analisis/31` §5 | 2 |
| Publicar los umbrales en el flujo de Platinum, antes del 01/10 | `Analisis/27` §5.4.3 | ½ |

**Unas 9 a 10 jornadas**, de las cuales 6 son producto reutilizable (seña,
seguimientos, reactivación sirven a cualquier consultorio o salón). Es lo que
justifica cobrar la instalación a medida en 250–350 y no las 10 jornadas.

---

## 4. Lo que va en la propuesta escrita

1. **USD 120 al mes por hasta 500 conversaciones**, bolsa de 30 por USD 10, con
   la definición de conversación (bloque de 25 respuestas en 24 h; la 26
   factura otra) y la de seguimiento (**no se factura**; la respuesta del
   paciente sí).
2. **Los cuatro servicios incluidos, con nombre** (§1.2), y qué es «un
   recordatorio por lead» y «48 h».
3. **Reactivación: 30 mensajes por USD 10**, solo a números con consentimiento,
   campaña aprobada por la clínica, máximo uno por número y por mes.
4. **Instalación a medida: USD 250–350**, con lo que incluye (§3).
5. **Consola operada: hasta 4 cambios por mes**; USD 15 por cambio adicional.
6. **La seña la confirma la clínica** (prohibición 3): el asistente coteja, no
   acredita. Horarios retenidos 30 minutos.
7. **Precio en USD, cobro en Bs al TCO del BCB**; revisión si Meta cambia la
   tarifa; revisión a los 3 meses con mensajes por conversación y origen de
   los leads (anuncios: ventana gratuita de 72 h, que acá juega a favor de
   los seguimientos).
8. **Escalón**: si pasa de 800 conversaciones dos meses seguidos, opción de
   USD 180 por 1.000.

### 4.1 Nota del 17/09/2026: lo que la construcción precisa en el contrato

Al construir los bloques 1 a 5 (`ESTADO.md` del 17/09) tres cláusulas quedaron
más precisas de lo que dice el §4, y conviene escribirlas así:

- **Cláusula 6, la seña.** La retención del horario es un parámetro del
  comercio (`senaMinutosRetencion`, 30 por defecto), no una cifra fija del
  contrato: «retenido N minutos, 30 salvo que la clínica pida otro valor». Y
  hay que decir qué pasa cuando el comprobante **no cuadra** o **es
  ilegible**: el horario sigue retenido, una persona de la clínica lo revisa
  y decide; el asistente no acepta ni rechaza el pago en ningún caso. Vencido
  el plazo, la cita se libera **sin aviso al paciente** (es lo que ya decía
  `Analisis/30` §6.4).
- **Cláusula 2, «un recordatorio por lead».** Es **uno por solicitud**: o el
  texto a las 2–4 h si la ventana sigue abierta, o la plantilla de utilidad a
  las 24–48 h, nunca los dos. No se manda a quien pidió que no le escriban, a
  quien pasó a una persona ni a un teléfono que ya pasó al operador. El
  texto en ventana sí cuenta como respuesta de la conversación (bloque de
  25); la plantilla no abre conversación.
- **Nada nuevo en dinero.** El pin de ubicación nativo (bloque 1) es un
  mensaje más solo cuando el paciente lo pide; el QR de la seña es el único
  mensaje que la seña agrega por reserva. Ninguna de las dos cosas cambia el
  precio ni la unidad de cobro.
