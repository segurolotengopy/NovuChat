# 03 — Plan de los dos demos (9–10 de septiembre de 2026)

> Cada demo se construye en n8n 2.36.5 (instancia de OCI,
> `${N8N_BASE_URL}`) sobre los borradores de Silvana con
> las correcciones del documento 02. Este plan define alcance, arquitectura
> de nodos, criterios de aceptación y cronograma.

---

## 1. Demo A — Agendamiento con calendario real (Belleza y Salud)

**Objetivo comercial.** Mostrar que la IA convierte una consulta en una cita
concreta: entiende lenguaje natural ("el viernes en la tarde"), consulta
disponibilidad **real**, maneja la objeción de precio (Salud) y sabe ceder el
chat a un humano al tercer rechazo.

**Base:** `gemini-code-1787586202718.json` (Demo Completa con Calendario).

**Arquitectura de nodos:**

```
WhatsApp Trigger (app NovuChat-Demo)
  → IF ¿es mensaje? (descarta statuses)                    [criterio B-2]
  → Code: normalizar entrada (text/interactive/otros)      [criterio B-3]
  → AI Agent "Sofía"
       ├─ Modelo: Google Gemini Chat Model (flash vigente) [criterio B-7]
       ├─ Memoria: Window Buffer, key = tel. origen, k=10  [criterio B-1]
       ├─ Tool 1: Calendar · consultar disponibilidad (Get Many)
       └─ Tool 2: Calendar · crear cita (Create)           [criterio B-4]
  → WhatsApp Send (respuesta al cliente)
  → [rama al detectar transferencia] WhatsApp Send al número de recepción
```

**System Message:** el del borrador, con estos cambios: se retira "nunca
reveles que eres una IA" (A-5); se inyecta fecha/hora actual y zona
America/La_Paz (B-5); se explicita el horario de atención y la duración por
tipo de servicio; y se instruye el uso obligatorio de las tools para
disponibilidad y confirmación (nunca fingir horarios: el borrador Demo 1
"fingía" el calendario — ese modo queda solo como respaldo de ensayo).

**Preparación de datos:** calendario de Google dedicado al demo, con eventos
de relleno que ocupen las franjas "atractivas" para forzar la propuesta de
alternativas y hacer visible la consulta real en pantalla (compartir la vista
del calendario en el proyector mientras el bot agenda es el momento clave del
demo).

---

## 2. Demo B — Venta y cobro (Gastronomía y Retail)

**Objetivo comercial.** Mostrar el ciclo completo de venta: pedido con notas
especiales, captura de variantes, reglas de logística (Nombre + CI antes del
QR en envíos por flota), cobro por QR (simulado y rotulado), confirmación al
recibir el comprobante y **alerta simultánea al dueño**.

**Base:** `gemini-code-1787783925658.json` (Restaurantes y Retail).

**Arquitectura de nodos:** la del borrador, corregida:

```
WhatsApp Trigger → IF ¿es mensaje? → Code: parser ampliado
  (text · interactive · order (si hay catálogo) · image → "comprobante" · resto → cortesía)
  → AI Agent NovuChat
       ├─ Gemini flash · Memoria por teléfono (k=15)
       └─ Tool: calcular total + entregar QR estático DEMO  [criterio C-12]
  → WhatsApp Send (cliente)
  → WhatsApp Send (dueño) — solo al confirmarse pedido      [criterio B-6]
  → (opcional) Google Sheets: fila con el resumen del pedido
```

**Saludo con lista interactiva:** nodo WhatsApp independiente que responde el
primer "Hola" con la lista de 3 opciones (Delivery / Recoger / Ver menú),
antes de ceder el control al agente — tal como indican las directrices de
Silvana. Si el envío de listas desde el nodo diera problemas en el número de
prueba, el fallback es un menú numerado en texto (el parser ya entiende
ambos).

**Sobre el carrito nativo:** el mensaje tipo `order` requiere catálogo de
Meta conectado a la WABA; en el número de prueba puede no estar disponible.
**Verificarlo en la primera semana** (ver §5). El demo funciona igual sin
él: el pedido entra por lista + texto libre y el agente lo estructura.

**El QR:** imagen estática con caption "🧪 DEMOSTRACIÓN — este QR no cobra".
La confirmación tras recibir la foto del comprobante dice "Pago verificado
(simulado)". Al presentar, se explica que en producción esto lo dispara el
webhook del banco — honestidad que además abre la conversación sobre el plan
de implementación con el cliente.

---

## 3. Qué NO entra en los demos (y cómo se responde si preguntan)

| Tema | Por qué no | Respuesta en el demo |
|---|---|---|
| Recordatorios 24 h antes | Requieren plantilla aprobada (Business Verification de AAB1 pendiente, enviada 27/08) | Se muestra el diseño en el Simulador / roadmap |
| Audios del cliente | Transcripción agrega nodos y puntos de falla a 12 días de la fecha | "Lo soporta la plataforma; lo activamos en la instalación" — decidir si se intenta después del ensayo general si sobra tiempo |
| Fidelización por puntos | Es del Plan Pro; en demo basta ilustrarla | Mensaje final "sumaste 15 puntos" emitido por el prompt + hoja de Sheets de muestra |
| Cobro real por QR | Sin webhook de acreditación bancaria no existe verificación | QR rotulado como simulacro (C-12) |
| Número propio del negocio | Depende de la Business Verification | Número de prueba; se explica que el cliente final tendrá su número verificado |

---

## 4. Criterios de aceptación (ensayo general)

Suite mínima, derivada de las tablas de Silvana — cada fila debe pasar en un
teléfono real antes del 8/09:

**Demo A:** (1) "¿qué servicios tienen y cuánto cuestan?" → catálogo con
precios y pregunta de cierre; (2) "quiero un corte el viernes en la tarde" →
exactamente ≤ 3 horarios reales del calendario, en el rango pedido; (3) "me
quedo con el de las 15:30" → evento creado en el calendario con nombre y
servicio, confirmación y despedida; (4) versión Salud: "¿cuánto cuesta una
curación?" → sin precio, ofrece evaluación; (5) dos rechazos de horario →
nuevas opciones coherentes con lo ya dicho (la memoria retiene "mañana");
(6) tercer rechazo → disculpa + transferencia a humano y el chat queda en
manos de recepción.

**Demo B:** (1) "Hola" → lista interactiva de 3 opciones; (2) pedido +
"sin tomate y la gaseosa zero" → registra notas y, según lo elegido antes,
pregunta o no la modalidad (escenarios A y B de la ayuda memoria); (3)
dirección → total con envío + QR rotulado DEMO; (4) foto del comprobante →
confirmación "simulado" + tiempo estimado **y** alerta llegando al celular
"del dueño"; (5) retail: pedido de chaqueta → pregunta talla; "¿envían a
Oruro?" → pide Nombre + CI y confirma el celular con el metadato `from`, y
**no entrega QR** hasta tenerlos.

**Casos hostiles (ambos demos):** sticker/audio/ubicación → respuesta cortés
sin crash; dos celulares conversando a la vez → cero cruce de memorias;
mensaje fuera de guion ("¿venden pizza?" al salón de belleza) → respuesta
honesta sin inventar; "¿eres un robot?" → no lo niega, con gracia; silencio
de 30+ min y regreso → hilo nuevo limpio.

---

## 5. Cronograma propuesto (28/08 → 10/09)

| Fechas | Hito |
|---|---|
| 28–30/08 | **Bloques Meta de la app NovuChat-Demo**: crear app, WABA y número de prueba; registrar los 5 destinatarios; token permanente de usuario de sistema; webhook apuntando a n8n y verificado en verde. **Verificar temprano**: envío de lista interactiva y disponibilidad (o no) de catálogo/carrito en el número de prueba |
| 30–31/08 | Credenciales en n8n (Meta, Gemini/AI Studio, OAuth de Google Calendar y Sheets). Importar y corregir el flujo del Demo A (siguiente iteración de este trabajo: JSONs adaptados) |
| 1–3/09 | Demo A funcional de punta a punta; suite de aceptación A en verde |
| 3–5/09 | Demo B funcional; suite B en verde; hoja de Sheets del dueño |
| 6–7/09 | **Ensayo general** con Silvana: suites completas + casos hostiles, desde los celulares reales del demo; grabar el video de respaldo; actualizar el Simulador con los textos reales |
| 8/09 | Congelamiento: no se toca ningún flujo; export a Git; checklist de la mochila (celulares cargados y registrados, QR impreso del "menú", proyector, plan B abierto) |
| 9–10/09 | Demostraciones comerciales |

**Regla de congelamiento:** después del 8/09 cualquier cambio se anota para
después del evento. Los demos fallan por el retoque de último minuto, no por
lo que se ensayó.

---

## 6. Contingencias

1. **Cae la red / Meta / el LLM en plena rueda:** Simulador.html (offline,
   ya existe) + video grabado el 6–7/09. Quien presenta ensaya también el
   plan B.
2. **La Business Verification se aprueba antes del 9/09:** no cambiar nada
   para el demo (congelamiento); el número propio y las plantillas entran en
   la fase de producción.
3. **El nivel gratuito de Gemini limita el ritmo (rate limit) durante el
   ensayo:** los límites del nivel gratuito son por minuto y por día; para
   un demo conversacional alcanzan con holgura, pero si el ensayo los toca,
   habilitar facturación en AI Studio (costo marginal) o bajar k de la
   memoria.
4. **El nodo WhatsApp de n8n no cubre algún mensaje interactivo:** fallback
   por HTTP Request directo al Graph API con la misma credencial (patrón ya
   dominado en WhatsApp-Modular).

---

## 7. Después del demo: puente a producción

En cuanto haya retorno comercial real, el orden de conversión es: (1) esperar
la Business Verification y montar el número propio bajo el portafolio AAB1;
(2) cambiar el sub-nodo de modelo a Claude (Haiku 4.5 como punto de partida)
y medir calidad/costo por conversación contra los márgenes de los planes;
(3) memoria a Postgres Chat Memory en `n8n-db`; (4) plantillas UTILITY para
recordatorios de cita con consentimiento y BAJA persistente (patrón de la
plantilla comunitaria 3088 + criterio A-6); (5) plantillizar el flujo por
cliente para sostener la promesa de despliegue en 48 h.
