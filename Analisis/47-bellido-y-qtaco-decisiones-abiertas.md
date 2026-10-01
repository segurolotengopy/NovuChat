# Bellido desde noviembre y Q'Taco reducido: las decisiones abiertas, en dólares

**01-oct-2026.** Sesión de análisis financiero y comercial. Es corto a propósito,
porque el presupuesto de tokens de Claude es escaso. Pone cifras a las
decisiones que `ESTADO.md` («Requiere a Andres» 4 y 5) deja abiertas. **No
reabre lo ya decidido:** el precio de Bellido desde noviembre es **USD 25 al
mes, sin instalación** (Andres, 01/10; `CLIENTES/BELLIDO/condiciones-piloto.md`).

Modelo reproducible: `Analisis/47-modelo-bellido-qtaco.py`. Los costos de Gemini
salen de `Analisis/43`:
- **Bellido** corre «Agenda mínima». Se midieron las cifras reales de Google:
  0,0015 USD por conversación (`43` §8, PR #274).
- **Q'Taco** usaría el Demo B, que es un flujo con agente: 0,0067 USD por
  conversación (`43` §2.3).

Las demás cifras de costo son:
- impuestos: 16 %;
- chip y costo fijo prorrateado entre 10 comercios: USD 3,68;
- Meta: 0,0113 USD por mensaje, con 1.000 mensajes gratis por número.

> **Decisión del 01/10/2026:** en Bellido, **Andres paga Meta, los cambios y los recordatorios**.
> La recomendación del §1 sobre esas tres preguntas queda superada. Q'Taco pasa a la cartera.
> Meta lo paga Andres **con su propia tarjeta, cargada en la WABA de Bellido**, que está en el
> portafolio del doctor. No lo paga AAB1, que no puede pagar la WABA de otro portafolio (§1).

---

## 1. Bellido: Impulso, USD 25 por 100 conversaciones

| Mes | Meta | Gemini | **Margen** |
|---|---|---|---|
| 100 conversaciones, sin recordatorio | 0,45 | 0,15 | **16,72 USD (67 %)** |
| 100 conversaciones, con recordatorio de 24 h | 0,90 | 0,15 | 16,26 USD (65 %) |
| 100 conversaciones, si Meta pasa las plantillas a Marketing | 5,92 | 0,15 | 11,25 USD (45 %) |

Con 5 respuestas por cita, 100 conversaciones son 500 mensajes de servicio. Caben
en la franquicia: **Meta solo cobra las plantillas.** Esas son el aviso al doctor
por cada cita y, si se ofrece, el recordatorio. Con este diseño, Bellido no
paga Meta de servicio hasta las 200 conversaciones al mes. **Meta le cobra al doctor**,
no a NovuChat: la WABA está en su portafolio. Las columnas «Meta» de la tabla son lo que
paga él; el margen de NovuChat es ese margen más esa columna.

### Las tres decisiones de su anexo

| Decisión | Recomendación | Por qué |
|---|---|---|
| **¿Quién paga Meta?** | **(2) El doctor, con la tarjeta de su WABA, que es como ya funciona.** Se le dice la cifra estimada en el contrato | La WABA de Bellido está en el portafolio del doctor, y Meta le cobra a la tarjeta cargada ahí: AAB1 no puede pagar la WABA de otro portafolio (borrador de la cartera del 01/10 sobre el recordatorio). Con «Agenda mínima» son **USD 0,45 a 0,90 al mes**, solo plantillas (aviso al doctor y recordatorio). Que NovuChat lo «incluya» obligaría a reembolsar menos de un dólar al mes: no vale la pena. **Hay que decírselo con la cifra y con el riesgo** (prohibición 3): si Meta pasa una plantilla a Marketing, sube a unos USD 6 al mes. El control es el `pricing_analytics` que mide FinOps-Ecosistema |
| **¿Cuántos cambios incluidos?** | **(1) cero**, como dice el catálogo para Impulso | Un cambio, valuado a USD 15, es el **60 % del precio**; dos son el 120 %. Lo que pida el doctor se cotiza |
| **¿Recordatorio de 24 h?** | **(2) módulo cotizado**, cuando haya presupuesto para construirlo | Cuesta 0,0113 USD por recordatorio, unos USD 0,45 al mes. Una consulta de 250 Bs son unos USD 19,8, así que **una sola inasistencia evitada paga 44 meses de recordatorios**. Es valor real para el doctor y casi no cuesta. Lo que cuesta es construirlo sobre «Agenda mínima»: tokens de Claude, hoy escasos. Su plantilla (`recordatorio_cita`) está pedida y pendiente de aprobación |

---

## 2. Q'Taco reducido: el alcance

| Alcance (`ESTADO.md`, «Requiere a Andres» 4) | Precio | Margen al 60 % | Margen al 100 % | Qué hay que construir |
|---|---|---|---|---|
| **(c) Demo B tal cual, sin mesas** | 40 por 200 (la propuesta del 11/09) | 67 % | 43 % | **Nada**: alta y aceptación |
| (c) lo mismo, al precio de lista | 50 por 220 (Crecimiento) | 68 % | 47 % | Nada |
| (b) pedidos con cobro real, sin mesas | 50 por 220 | 62 % | 36 % | Activar el cobro real, con las tres deudas del cobro real que anota la matriz de la cartera (D05, D07, D10) |
| (a) reservas de mesa y avisos por plantilla | 50 por 220 | 66 % | 44 % | Un módulo de mesas (2 a 3 jornadas según la matriz de la cartera, D06), con excepción firmada al congelamiento de código |

**Lo que dice:**
- **En margen, las tres opciones son parecidas.** Lo que las separa es **lo que
  hay que construir antes de cobrar**: (c) no exige nada y (a) exige un módulo
  completo. Con la obra pausada por el costo en tokens, **(c) es la que cobra
  antes con menos gasto**. Coincide con la recomendación de la revisora.
- **El cobro real (b) es el que menos margen deja**: el QR y el comprobante suman
  2 respuestas por conversación. Conviene agregarlo cuando el cliente ya esté
  cobrando con (c), si lo pide.
- **¿40/200 o lista?** La diferencia es de USD 6 al mes al 100 % de uso. Si
  Q'Taco responde a la propuesta del 11/09, respetar los 40/200 cuesta poco y
  evita reabrir la negociación. Si se le hace una propuesta nueva, va a precio
  de lista.
- **El Demo B es un flujo con agente.** Si Q'Taco crece, rehacerlo con el
  criterio de «Agenda mínima» (que el código calcule) bajaría su costo de Meta
  y de Gemini. Hoy no hace falta: con este volumen, el margen ya alcanza.

---

## 3. Lo que más importa medir en octubre

1. **Respuestas reales por conversación** en Bellido. Es lo que decide si Meta
   cobra servicio. Con 5 por conversación caben 200 conversaciones gratis; con
   10, solo 100.
2. **La categoría con que Meta aprueba cada plantilla**: utilidad o marketing.
   Es lo único que puede mover el margen de Bellido más de 20 puntos.
3. Ambas las mide FinOps-Ecosistema (`pricing_analytics`) o salen del conteo de
   la ingesta. Esta sesión no construye otra medición.
