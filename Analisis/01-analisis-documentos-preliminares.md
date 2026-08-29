# 01 — Análisis documento por documento de `Preliminares/`

> Cada sección evalúa: qué aporta, qué está bien resuelto, y qué debe
> corregirse o verificarse antes de usarlo. Las correcciones se consolidan
> como criterios en `02-criterios-implementacion.md`.

---

## 1. `Ayuda Memoria_ Pruebas de Demos de Agendamiento WhatsApp Completo.docx`

**Qué es.** Casos de prueba para los demos comerciales del **9 y 10 de
septiembre** en dos verticales: Belleza (catálogo con precios en Bs, reserva
inmediata) y Salud (especialidades sin precios, manejo de la objeción de
precio, derivación a evaluación). Incluye los pasos de integración de Google
Calendar como *Tool* del AI Agent y una tabla de alternativas económicas de
integración con WhatsApp.

**Fortalezas.**

- Las tablas Input → Output esperado → **Criterio de éxito** son, en la
  práctica, *tests de aceptación* ya escritos. Se adoptan tal cual como
  checklist de ensayo (ver `03-plan-demos.md` §4).
- El caso "tercer rechazo → transferencia a humano" es la regla de negocio
  más valiosa del documento: evita que el agente entre en bucle delante de
  un cliente y es un diferenciador comercial honesto ("la IA sabe cuándo
  ceder el chat").
- La distinción Belleza (con precios) / Salud (sin precios, sin diagnóstico)
  es correcta también desde el punto de vista de responsabilidad profesional.
- Los 4 pasos de Google Calendar (nodo como Tool, OAuth2, Get Many + Create,
  instrucción explícita en el System Message) son exactamente el camino
  correcto en n8n.

**Correcciones necesarias.**

- **Tabla de alternativas de WhatsApp — desactualizada y en conflicto con una
  decisión ya tomada.** Evolution API, WPPConnect y Baileys son canales *no
  oficiales* (simulan WhatsApp Web): el propio proyecto los probó en
  laboratorio y los **retiró el 22/08/2026** después de que la imagen dejó de
  entregar mensajes sin error visible (migración de WhatsApp a identidades
  `@lid`) y con baneo del número como riesgo permanente
  (`WhatsApp-Modular/docs/13-laboratorio-evolution.md`). Para demos ante
  clientes reales el riesgo es aún menos aceptable que en laboratorio: un
  baneo el 9 de septiembre no tiene plan B.
- **El dato "WhatsApp Cloud API: 1.000 conversaciones gratis al mes" quedó
  obsoleto.** Desde julio de 2025 Meta cobra **por plantilla entregada**, no
  por conversación; las conversaciones de servicio (las que inicia el
  cliente, que son el 100 % de los demos) **no tienen costo**, y el número
  de prueba no factura en absoluto. La referencia vigente en el proyecto es
  `WhatsApp-Modular/docs/04-plan-fases-y-costos.md` y la tarjeta de tarifas
  del WhatsApp Manager (única fuente válida para BO/PY).
- **Los recordatorios "24 h antes"** (prometidos en la presentación) exigen
  iniciar conversación con **plantilla aprobada**, y la creación de
  plantillas útiles está condicionada por la Business Verification de AAB1
  (enviada el 27/08, sin resolución aún). No prometerlos en vivo.

---

## 2. `Ayuda Memoria Flujo restaurantes y retail.docx`

**Qué es.** Guiones completos de venta para Gastronomía (delivery/recojo,
notas especiales, QR, post-pago, fidelización) y Retail (variantes
obligatorias, envío departamental con nombre + CI, confirmación del celular),
más siete directrices técnicas de n8n y tres notas de programación.

**Fortalezas.**

- Las directrices técnicas son de calidad profesional: parsear el carrito
  *antes* del agente, condicionantes de memoria en el prompt ("si ya eligió
  Delivery, no volver a preguntar"), pausa de la venta ante un mensaje tipo
  imagen, y la **bifurcación final** (respuesta al cliente + alerta
  silenciosa al dueño). Todas se adoptan.
- La regla "sin Nombre + CI no hay QR" para envío por flota es una validación
  de negocio bien puesta en el prompt y fácil de verificar en el ensayo.
- El uso del metadato `from` para confirmar el celular proactivamente es un
  detalle de experiencia excelente y gratuito.

**Correcciones y verificaciones necesarias.**

- **El "carrito nativo" (mensaje tipo `order`) depende de tener un catálogo
  de Meta conectado a la WABA.** En el número de prueba es probable que no se
  pueda montar un catálogo completo. Hay que **verificarlo temprano** (ver
  `03-plan-demos.md` §5); si no está disponible, el demo captura el pedido
  por lista interactiva + texto libre, que el agente entiende igual. El
  parser debe cubrir ambos casos desde el día uno.
- **Las listas interactivas** (Interactive Message List/Buttons) sí están
  disponibles en la Cloud API estándar; en n8n se envían con el nodo
  WhatsApp (operación de mensaje interactivo) o vía HTTP Request al Graph
  API. La directriz es correcta; solo hay que tener en cuenta que los flujos
  JSON de ejemplo (ver §4) todavía no la implementan.
- **El cobro por QR es un simulacro y debe decirlo.** El repositorio
  WhatsApp-Modular ya aprendió esta lección y la convirtió en guardarraíl
  estructural (`docs/16`): el QR de demo lleva datos de comercio de relleno,
  el caption dice explícitamente que es demostración y la "verificación" por
  temporizador se etiqueta `simulado`. NovuChat debe heredar la misma
  disciplina: **nunca mostrar una confirmación de pago falsa que parezca
  real**, ni siquiera en un demo — sobre todo en un demo, porque el cliente
  potencial va a preguntar "¿y esto ya cobra?".

---

## 3. `guia novuchat.docx` y `gemini-code-1787888836369.md` (misma guía, dos formatos)

**Qué es.** La guía de implementación técnica: arquitectura orientada a
eventos, 4 fases del lienzo n8n (ingesta y ruteo → memoria → LLM → ejecución
y respuesta), el System Prompt maestro, 3 *tools* (agenda, carrito+QR,
puntos) y dos reglas de control de costos (ventana de 6 mensajes, timeout de
sesión de 60 minutos).

**Fortalezas.**

- La separación en 4 fases con un **IF que descarta acuses de estado** antes
  de invocar al LLM es la decisión de ahorro más importante de toda la guía
  (cada acuse de entrega que pasara al agente sería una ejecución y tokens
  desperdiciados, o peor, un bucle).
- El System Prompt maestro es bueno: no inventar precios, máximo 3 oraciones,
  español boliviano con "Bs", recálculo inmediato ante cambios de opinión.
- Windowing + timeout de sesión son exactamente los mecanismos correctos para
  proteger los márgenes de los planes de 150–350 Bs.

**Correcciones necesarias.**

- **El modelo `claude-3-5-sonnet-20260620` no existe** (mezcla el nombre de un
  modelo de 2024 con una fecha de 2026). Para producción con Claude se debe
  tomar el identificador vigente de la documentación de Anthropic en el
  momento de construir (hoy la familia incluye Claude Sonnet y Haiku 4.5,
  con Haiku como opción de mejor costo por conversación para este caso).
  Para los demos, la decisión del 28/08 es **Gemini** (ver §Decisiones).
- La pregunta final de la guía (¿memoria en Supabase o en los nodos de n8n?)
  ya tiene respuesta en la infraestructura real: el n8n de OCI tiene su
  **PostgreSQL 16 con pgvector dedicado** (`n8n-db`). Para demos alcanza la
  memoria de ventana con clave por número; para producción, *Postgres Chat
  Memory* contra esa misma base — sin servicios externos nuevos ni costo
  adicional.
- La guía propone Webhook genérico + HTTP Request manual hacia Claude. En
  n8n 2.x es preferible el trío nativo **WhatsApp Trigger + AI Agent +
  sub-nodo de modelo**, que ya resuelve el ciclo de *function calling*
  (Fase D completa) sin Switch manual. La arquitectura conceptual de la guía
  se conserva; la implementación se simplifica.

---

## 4. Los tres borradores de flujo (`gemini-code-*.json`)

**Qué son.** Tres lienzos n8n generados con Gemini: Demo 1 de agendamiento
con calendario fingido, Demo completa con Google Calendar real como Tool, y
Demo Restaurantes/Retail con parser de carrito/imágenes y doble salida
(cliente + dueño).

**Fortalezas.**

- La estructura de nodos es la correcta (Trigger → \[parser\] → AI Agent con
  modelo + memoria \[+ tool\] → envío), y el tercer flujo ya trae el nodo
  Code de normalización y la bifurcación al dueño.
- Los System Message recogen fielmente las reglas de las ayudas memoria.

**Defectos a corregir (los tres flujos).**

1. **Memoria sin clave de sesión — defecto crítico.** `Window Buffer Memory`
   está con parámetros por defecto. Con un Chat Trigger eso funciona; con un
   **WhatsApp Trigger no hay sesión implícita**, así que dos celulares
   escribiendo a la vez comparten memoria: el agente le confirmaría a un
   cliente la cita del otro. La clave de sesión debe definirse como *custom
   key* = número de origen (`messages[0].from`). En un demo con público es
   el error más probable y más visible.
2. **Falta el filtro de eventos** que la propia guía exige (Fase A): el
   WhatsApp Trigger también recibe acuses (`statuses`) y hay que descartarlos
   antes del agente.
3. **Modelo OpenAI (`gpt-4o-mini`/`gpt-4o`)**: se reemplaza por el sub-nodo
   **Google Gemini Chat Model** (decisión del 28/08). El resto del flujo no
   cambia — esa es la ventaja del AI Agent.
4. **El Google Calendar Tool está vacío** (`parameters: {}`): hay que
   configurar las dos operaciones (Get Many para disponibilidad, Create para
   agendar), la ventana horaria del negocio y el calendario concreto, y
   describir la herramienta para el agente (el esquema
   `gestionar_agenda_citas` del quinto JSON sirve de base, ver §5).
5. **"Nunca reveles que eres una Inteligencia Artificial"** — se recomienda
   retirar esta regla. Contradice el posicionamiento comercial del propio
   pitch ("IA real vs chatbots"), es contraria a las políticas de las
   plataformas de IA y de mensajería comercial, y el costo de que un cliente
   descubra el engaño es mayor que el de la transparencia. La alternativa:
   presentarse como "asistente virtual" (como ya hace: "Sofía, asistente
   virtual") y **no negar** ser una IA si preguntan directamente.
6. Detalles menores: número del dueño incrustado como texto a reemplazar
   (`NUMERO_DEL_DUENO_AQUI` — debe ir en una variable/credencial, nunca
   hardcodeado en el flujo exportable), y el texto del trigger asume
   siempre `messages[0].text.body` (revienta con mensajes no textuales si el
   parser no está delante — solo el tercer flujo lo tiene).

---

## 5. `gemini-code-1787889621732.json` (esquema de la *tool* de agenda)

Esquema JSON de `gestionar_agenda_citas` con acciones
consultar/agendar/cancelar/reagendar, fecha ISO, hora 24 h, y el teléfono del
cliente como identificador. **Bien diseñado** — dos observaciones:

- "Si el cliente dice 'mañana', calcular la fecha exacta" exige que el agente
  **conozca la fecha y hora actuales y la zona horaria**: hay que inyectar
  `{{ $now }}` (con `GENERIC_TIMEZONE=America/La_Paz` en el n8n) en el System
  Message. Sin esto, "mañana en la tarde" produce fechas erróneas — es un
  clásico que arruina demos de agendamiento.
- En n8n conviene materializarlo como **dos tools separadas** (consultar /
  agendar) sobre nodos Google Calendar Tool, en lugar de una sola tool
  polimórfica: menos ambigüedad para el modelo y menos ramas de error.

---

## 6. Plantillas comunitarias `3081` (RAG) y `3088` (citas médicas)

- **3081 — WhatsApp AI RAG Chatbot** (Qdrant + Google Drive + embeddings
  OpenAI): útil como referencia de patrón, pero **sobredimensionado para los
  demos** (tres servicios adicionales que montar y pagar). Si un demo
  necesita "conocimiento del negocio" (menú, catálogo), para 20–50 ítems
  basta ponerlo en el System Message o en una hoja de Google Sheets leída al
  vuelo. Para producción, el equivalente sin servicios nuevos es el
  **pgvector ya instalado** en `n8n-db`.
- **3088 — Bot de citas médicas** (plantillas + Google Sheets + Schedule
  Trigger): su valor está en dos patrones que los borradores no tienen:
  **verificación de consentimiento antes de escribir** (filtro de opt-in) y
  el envío programado de recordatorios vía plantilla. Ambos son de fase de
  producción (requieren plantillas aprobadas → Business Verification), pero
  el patrón de consentimiento/opt-out debe entrar desde el demo: el flujo
  `reservas-bot` de WhatsApp-Modular ya estableció que **la BAJA es una
  obligación de la política de privacidad publicada (AAB1), no una
  cortesía**, y que debe persistir fuera de la sesión.

---

## 7. `Presentación NovuChat.html` (pitch deck) y `Simulador.html`

- El pitch define promesas que se convierten en **requisitos técnicos**:
  respuesta < 1 minuto (fácil), "entiende audios" (exige transcripción —
  decidir si entra en el demo o se muestra como roadmap; Gemini es multimodal
  y puede transcribir el audio descargado del Graph API, pero agrega nodos y
  puntos de falla), fidelización por puntos (Plan Pro — mostrar en Sheets,
  no construir un sistema), y despliegue en 48 h (define el estándar de
  plantillización de los flujos: por negocio solo deberían cambiar prompt,
  catálogo/precios, calendario y número del dueño).
- Los planes (150/250/350 Bs con excedentes de 35 Bs por 50 pedidos) implican
  un **costo variable por pedido que hay que conocer**: con conversaciones de
  servicio gratis en Meta y Gemini/Claude Haiku como cerebro, el costo por
  pedido queda en fracciones de centavo de dólar y los márgenes del plan
  cierran holgados; el enemigo real del margen es un flujo sin windowing ni
  timeout (ver criterios C-13).
- El **Simulador** es el plan B perfecto para la rueda de negocios (no
  depende de red, ni de Meta, ni del LLM) y además sirve como guion de
  ensayo. Mantenerlo actualizado con los textos reales de los flujos.

---

## 8. Inventario de inconsistencias entre documentos (tabla de decisión)

| # | Tema | Documento(s) | Realidad / decisión |
|---|---|---|---|
| 1 | Evolution API como opción recomendada | Ayuda memoria agendamiento §4 | Retirada el 22/08 (ToS, baneo, rotura `@lid`). **No vuelve.** Canal: Meta Cloud API, número de prueba |
| 2 | "1.000 conversaciones gratis/mes" | Ídem | Modelo por mensaje desde jul-2025; conversaciones de servicio sin costo; número de prueba no factura |
| 3 | LLM: OpenAI vs Claude | JSONs vs guía | **Gemini para demos, Claude para producción** (decisión 28/08) |
| 4 | `claude-3-5-sonnet-20260620` | Guía técnica | Modelo inexistente; tomar identificador vigente al construir |
| 5 | Memoria sin clave de sesión | Los 3 JSONs | Custom key = teléfono; producción: Postgres Chat Memory en `n8n-db` |
| 6 | Carrito nativo (`order`) en el demo | Ayuda memoria restaurantes | Depende de catálogo Meta en la WABA; verificar en número de prueba; fallback: lista interactiva + texto |
| 7 | "Nunca reveles que eres IA" | JSONs demo 1 y 2 | Retirar; contradice el pitch y las políticas; no negar si preguntan |
| 8 | Recordatorios 24 h antes | Pitch + 3088 | Requieren plantilla aprobada → Business Verification (enviada 27/08, pendiente). Roadmap, no demo en vivo |
