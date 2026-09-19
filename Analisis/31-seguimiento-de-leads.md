# Seguimiento de leads: escribirle a quien no terminó la reserva

**16-sep-2026.** Pedido de Andres, a continuación de `Analisis/30`: qué
significa —en Meta, en costo, en la unidad de cobro y en el sistema— mandar
mensajes a los números que empezaron una reserva y no la terminaron, y qué se
puede ofrecer a Clínica Platinum **si el plan es de 500 conversaciones**
(Corporativo, USD 90). Tarifas de `Analisis/14`; regla de conteo de
`admin/functions/src/ingesta.ts`; restricciones de plantillas de Meta
aprendidas el 14/09.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **Hay tres seguimientos distintos**, y Meta los cobra distinto | (1) dentro de la ventana de 24 h: texto libre, 0,0113 USD; (2) después de la ventana, sobre una solicitud que ya existe: plantilla de **utilidad**, 0,0113; (3) reenganche comercial: plantilla de **marketing**, 0,0740, con consentimiento y riesgo de calidad |
| **Cuánto cuestan con 500 conversaciones** | Los dos primeros, unos **3,4 USD al mes** para 200 leads sin cita: el 4,5 % del ingreso neto del plan. **Se pueden incluir.** El tercero, 14,8 USD: **nunca incluido**, se vende por paquete |
| **Cómo entran en la unidad de cobro** | Un seguimiento **no se factura como conversación** (una respuesta nuestra sobre una ventana vencida no abre nada: `ingesta.ts`). **La respuesta del paciente sí**: abre una ventana nueva y consume el plan. Es lo correcto: el seguimiento vende conversaciones |
| **Qué ofrecer a Platinum** | Incluido en los 500: **un** recordatorio de la solicitud pendiente por lead (2 h si sigue en ventana; a las 24–48 h por plantilla de utilidad). Aparte: **paquete de reactivación** de 50 mensajes de marketing por USD 10, con lista de consentimiento y campaña aprobada por la clínica |
| **Lo que hay que construir** | Un flujo programado como el de recordatorios, una marca de «solicitud pendiente» en la conversación, dos plantillas, y contadores en el mes. **2 jornadas** para lo incluido; 2 más para el paquete de marketing |

---

## 1. Los tres seguimientos, y por qué no son el mismo mensaje

Meta no distingue «seguimiento» de «respuesta»: distingue **si hay ventana
abierta** y, si no la hay, **qué categoría tiene la plantilla**.

| | (1) Dentro de la ventana | (2) Fuera, utilidad | (3) Fuera, marketing |
|---|---|---|---|
| **Cuándo** | Hasta 24 h después del último mensaje del paciente | Cualquier momento | Cualquier momento |
| **Ejemplo** | «Te dejé reservado el sábado 10:00 con el Dr. Sandoval. ¿Lo confirmo?» (2 h de silencio) | «Tu solicitud de cita del 20/09 quedó sin confirmar. Si sigues interesado, responde este mensaje» (a las 24–48 h) | «Este mes el blanqueamiento sigue a 500 Bs. ¿Agendamos?» (a la semana) |
| **Formato** | Texto libre, lo escribe el asistente o es fijo | Plantilla aprobada, sin lenguaje comercial | Plantilla aprobada como Marketing |
| **Costo Meta** | 0,0113 USD (servicio) | 0,0113 USD (utilidad) | **0,0740 USD** |
| **Consentimiento** | El paciente escribió primero | Es la actualización de una solicitud suya | **Opt-in explícito** exigido por Meta; la persona puede bloquear y reportar |
| **Riesgo para el número** | Ninguno | Ninguno si la plantilla está bien redactada | Bloqueos y reportes bajan la calificación de calidad y el cupo de mensajes iniciados por la empresa |
| **Si el lead vino de un anuncio de clic a WhatsApp** | Gratis, dentro de las 72 h del punto de entrada | Gratis dentro de las 72 h, plantilla incluida | Gratis dentro de las 72 h |

Dos cosas aprendidas el 14/09 que acá mandan:

- **El clasificador de Meta lee el vocabulario, no la intención.** «Interés»,
  «continuar la atención», «te esperamos» convierten una plantilla en
  Marketing aunque se pida como Utilidad. La (2) tiene que redactarse como
  **estado de una solicitud existente**, igual que `solicitud_contacto`: «Se
  registró tu solicitud de cita para {{1}}. Estado: sin confirmar. Responde
  este mensaje para retomarla.» Sin botones a WhatsApp, sin promoción, sin
  precio.
- **Validez de la plantilla: el máximo**, no los 10 minutos por defecto. Un
  seguimiento que se descarta porque el teléfono estaba apagado es plata
  tirada… aunque lo no entregado no se cobra.

Y un límite práctico: un número nuevo puede iniciar **250 conversaciones por
día** hasta escalar (`Analisis/25` §2.2). Sobra para 200 leads al mes; no
sobra para «mandarle a toda la base».

---

## 2. Cómo entra en la unidad de cobro

La regla de `ingesta.ts` ya lo resuelve, y bien:

- **Un saliente sobre una ventana vencida no abre ni atención ni bloque.** Un
  seguimiento de tipo (2) o (3) **no se le factura al comercio como
  conversación**, igual que el recordatorio de cita. Cuesta 0,0113 o 0,0740 a
  NovuChat y punto.
- **La respuesta del paciente abre una ventana nueva** y se factura como
  conversación. Si el plan está lleno, sale de la bolsa (0,333).
- **El seguimiento de tipo (1) está dentro de la ventana**: suma una respuesta
  al bloque de 25. Es un mensaje más en esa conversación, y hay que
  declararlo (`CLAUDE.md` §1): **+1 mensaje en las conversaciones que se
  quedaron a medio camino**, no en todas.

Lo que **no** conviene hacer: cobrar el seguimiento como conversación. A 0,18
sería rentable, pero rompe el glosario publicado («se cobra lo que el cliente
inicia») y convierte cada seguimiento en un reclamo posible.

---

## 3. La cuenta con 500 conversaciones

Supuestos: plan Corporativo (USD 90, neto 75,60), 500 conversaciones, **200
sin cita** (40 %), de las cuales 100 llegaron a elegir horario. Tasas de
respuesta conservadoras: 15 % al (1), 20 % al (2), 10 % al (3). La mitad de
las respuestas termina en cita. Valor de una cita: 500 Bs ≈ 40 USD.

| Seguimiento | Mensajes | Costo Meta | Conversaciones nuevas | Citas recuperadas | Valor para la clínica |
|---|---|---|---|---|---|
| (1) Dentro de la ventana | 100 | **1,13** | 0 (misma ventana) | ~15 | ~600 USD |
| (2) Utilidad, 24–48 h | 200 | **2,26** | ~40 | ~20 | ~800 USD |
| (3) Marketing, día 7 | 200 | **14,80** | ~20 | ~8 | ~320 USD |

**Los dos primeros cuestan 3,4 USD al mes** —el 4,5 % del ingreso neto— y le
devuelven a la clínica unas 35 citas: **cada dólar que NovuChat gasta en
seguimiento vale unos 400 para el cliente.** Es el argumento de venta, y es
más fuerte que cualquier descuento.

Lo que le pasa al plan: las ~40 conversaciones nuevas del (2) **llenan el plan
antes**. Si Platinum ya está en 500, son dos bolsas (USD 20, neto 16,80)
contra un costo de 40 × 0,166 = 6,6: el seguimiento incluido **se paga solo
en cuanto el plan está lleno**, y mientras no lo está, cuesta ~10 USD al mes
(3,4 de mensajes + 6,6 de las conversaciones que provoca) sobre un margen de
9,8 a plena carga con seña. Es decir: **incluirlo es neutro a plena carga y
levemente negativo por debajo**; lo que lo justifica es la venta.

El (3) es otra cosa: 14,8 USD son el 20 % del neto, más el riesgo del
número. **Nunca incluido** (`Analisis/14` §9). Como paquete: **50 mensajes de
marketing por USD 10** (0,20 cada uno; costo 0,074; margen 56 % neto). Una
campaña de 200 son USD 40, y le devuelve a la clínica ~8 citas: 320 USD. Se
vende.

---

## 4. Qué ofrecer a Platinum, con 500

| | Qué | Reglas |
|---|---|---|
| **Incluido en el plan** | **Recordatorio de solicitud pendiente**: uno por lead. A las 2 h si sigue en ventana (texto del asistente); si no, a las 24–48 h por plantilla de utilidad | Una sola vez por solicitud. Nunca a quien dijo que no, pidió que no le escriban o fue derivado a una persona. Se registra en la bitácora |
| **Incluido, si la clínica lo pide** | **Aviso de horario liberado**: el paciente que no encontró horario acepta que se le avise si se libera uno (opt-in registrado en la conversación) | Es utilidad —una alerta que la persona pidió—, y es el opt-in que después habilita el marketing |
| **Aparte** | **Reactivación**: 50 mensajes de marketing por USD 10, por campaña, con texto aprobado por la clínica y solo a números con consentimiento | La clínica aprueba cada campaña; NovuChat la programa. Tope de una por mes por número. Se corta si la calificación del número baja |
| **No se ofrece** | Escribirle a bases de datos externas, a números que nunca escribieron, o «a todos los del mes» | Es spam para Meta y para la persona; arriesga el número, que es el canal del cliente |

Con el flujo mixto de `Analisis/30`, el (2) tiene una variante que vale más:
**«Tu horario quedó retenido a la espera de la seña»** dentro de los 30
minutos de retención. Es texto libre en ventana (el paciente acaba de
escribir), cuesta 0,0113 y recupera al que se fue a pagar y no volvió. Es el
seguimiento con mejor tasa que va a haber, porque el paciente ya decidió.

---

## 5. Lo que hay que construir

| Pieza | Qué | Hay | Esfuerzo |
|---|---|---|---|
| **Estado de la solicitud** en la conversación | `solicitud: { etapa: horarios \| elegido \| qr_enviado \| agendada, desde, seguimientos }`, escrito por la ingesta a partir de los eventos que ya llegan (`cita_agendada`, `plantilla_enviada`, y uno nuevo: `horario_ofrecido`) | Los eventos y `ultimoEn` existen; la etapa no | ½ jornada, con pruebas puras |
| **Flujo programado «Seguimientos»** | Cada hora: conversaciones con solicitud pendiente, sin cita, sin seguimiento previo, `ultimoEn` entre 2 y 4 h (→ texto en ventana) o entre 24 y 48 h (→ plantilla). Marca `seguimientos` antes de enviar, como el candado de los recordatorios | El flujo de recordatorios es el molde | 1 jornada, con prueba contra teléfono |
| **Dos plantillas de utilidad** | «solicitud de cita sin confirmar» y «horario liberado» | Ninguna | Redacción media hora; aprobación de Meta, días |
| **Lista de no molestar** | `noContactar: true` en la conversación cuando el paciente lo pide o fue derivado; el flujo la respeta | No existe | incluida arriba |
| **Contadores del mes** | `seguimientos`, `seguimientosMarketing`, `reactivadas` (conversaciones que nacieron de un seguimiento: se sabe porque el entrante llega dentro de las 24 h de uno) | `bloquesAdicionales` y los umbrales son el patrón | ½ jornada |
| **Paquete de marketing** | Consentimiento por número, campaña con texto aprobado, tope mensual **en el servidor** (`CLAUDE.md` §7), pantalla de la campaña en la consola | Nada | 2 jornadas |
| **Medición de origen** | Guardar `referral` del webhook para saber qué leads están en ventana gratuita de 72 h | Pendiente desde `Analisis/25` §1.4 | ½ jornada |

**Lo incluido: unas 2 jornadas.** Nada se prueba sin teléfono, y la plantilla
depende de Meta.

---

## 6. Qué medir

| Dato | Para qué |
|---|---|
| Tasa de respuesta por tipo de seguimiento | Si el 15/20/10 % del §3 es real; a partir de eso se decide si el (2) va a las 24 o a las 48 h |
| Citas que nacieron de un seguimiento | El argumento de venta con número propio del cliente |
| Bloqueos y reportes del número | El termómetro del marketing: si sube, el paquete se apaga |
| Leads en ventana de 72 h | Si los seguimientos a leads de anuncios salen gratis, que es donde más leads hay |
