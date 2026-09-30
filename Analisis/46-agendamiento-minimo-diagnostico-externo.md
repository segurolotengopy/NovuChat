# 46 — Agendamiento mínimo: diagnóstico externo del flujo de Bellido

**Origen:** análisis externo, hecho por otra sesión de Claude.ai a pedido de
Andres el 30/09/2026, sobre el JSON de `Flujos/bellido-agendamiento.json`.
Se guarda tal como llegó (§1 a §4). La segunda parte —el ciclo entre
Antigravity y Claude— está en el §6.

**Estado:** diagnóstico, más una construcción experimental autorizada el
30/09 como excepción a la pausa (§6). No cambia `Analisis/41`, y la
migración de Bellido sigue sin decidir.

---

## 1. Lectura del flujo

Lo miré con el inventario del JSON, no solo con la imagen: 96 nodos, de los
cuales 28 son `IF`, 24 son `Code`, 17 son llamadas HTTP a la plataforma, 5 son
nodos de Gemini para leer comprobantes, imágenes y audios, y solo **7 hacen el
agendamiento propiamente dicho** (el agente, el modelo, la memoria y las
cuatro herramientas de Calendar). La percepción es correcta, y se puede decir
con precisión de dónde viene la complicación.

## 2. De dónde salen los 96 nodos

| Grupo | Nodos aprox. | Por qué existe | ¿Lo necesita un consultorio con un calendario y un menú de 4? |
|---|---|---|---|
| Agendamiento (agente + herramientas + memoria) | 7 | El servicio | Sí |
| Menú interactivo, contacto directo, ubicación, redes, emergencia, plantillas al doctor | ~20 | Las 4 opciones del menú y el aviso al doctor | Sí, pero en 6–8 nodos, no en 20 |
| **Seña por QR**: preparar seña, enviar QR, leer comprobante (PDF e imagen), cotejar en servidor, reenviar QR, señas huérfanas | ~18 | Heredado del Demo A (agenda con seña) | **No** si el doctor no cobra seña por el chat |
| Medios: transcribir audio, describir imagen o documento, clasificar publicidad | ~10 | Los pacientes mandan audios y fotos | Audio sí; clasificación de imágenes, dudoso |
| **Guardas contra errores del modelo**: deshacer cita solapada, reintento tras cruce, olvidar turno fallido, quitar horas no verificadas, candado | ~15 | Cada una nació de un incidente real (R1, R4, R5, R9…) | **No, si el diseño no le pide al modelo que calcule horarios** |
| Reportar a la plataforma (mensajes, contacto, ubicación, redes, conteo) | ~12 | El modelo comercial: contar conversaciones y cambios | Sí, pero en 1 o 2 llamadas, no en 12 |
| Config del negocio, normalizar, respaldo | ~6 | Multi-tenant | Sí |

El hallazgo de fondo, y coincide con lo que la batería del 29/09 demostró:
**la mitad de la complejidad está ahí para corregir al modelo**. El diseño le
pide a Flash-Lite que reste eventos de un calendario, calcule los huecos,
respete horarios de atención y elija horas en punto; como se equivoca, se
agregaron candados, reintentos y limpiezas de horas falsas. Cada incidente
sumó nodos. Es exactamente el patrón que el skill de Gemini llama
antipatrón: «arreglar la salida en vez de la especificación».

## 3. Cómo se ve el servicio sencillo bien diseñado

El principio: **el código calcula, el modelo conversa.** Unos 20 nodos:

1. Disparador de WhatsApp → normalizar (2).
2. Menú de 4 opciones por botones o lista; tres de ellas (ubicación,
   contacto, hablar con recepción) se resuelven **sin modelo**, con un
   `Switch` y un envío (5).
3. Opción «cita»: el modelo hace **solo extracción** —intención (agendar,
   cancelar, mover), día o franja pedida, nombre del paciente— con
   `responseSchema` (1 nodo, salida JSON).
4. **El código consulta el calendario (`freebusy` de un solo calendario),
   cruza con el horario de atención y devuelve los 3 huecos libres reales**
   (1 nodo Code + 1 Calendar). No hay forma de ofrecer una hora ocupada ni un
   sábado cerrado, y «día lleno» es una rama trivial.
5. El modelo redacta la respuesta con esos 3 huecos y el trato configurado
   (1 nodo, sin herramientas).
6. Confirmación por **botón**, no por interpretación del «sí» o del «ya»: el
   paciente toca la hora (1 envío interactivo + 1 `IF`). Se acaba el
   problema del «ya» y del «ya pues».
7. Crear, cancelar o mover el evento en código (2 nodos Calendar). Aviso al
   doctor por plantilla (1).
8. Audio: transcribir antes del paso 3 (2 nodos). Reporte a la plataforma:
   una sola llamada al final del turno (1).

Sin agente con herramientas, sin memoria de 8 turnos (el estado de la
conversación vive en un objeto pequeño por teléfono), sin candados, sin seña.
Flash-Lite alcanza de sobra porque nunca decide nada crítico; el costo por
conversación baja porque el prompt es de 1.500 caracteres y hay dos llamadas
cortas en vez de un agente con cinco iteraciones.

## 4. Qué haría con esto, y qué no

- **No reescribir Bellido en medio del piloto**: hoy responde (cuando Gemini
  tiene saldo) y lleva tres correcciones esperando publicación. Migrarlo
  ahora es sumar riesgo sobre riesgo.
- **Sí construir el «agendamiento mínimo» como flujo aparte**, en el número
  de prueba, y correrle **la misma batería de 69 turnos** del 29/09. Es un
  trabajo de uno o dos días y puede hacerlo Antigravity en n8n a partir de la
  lista de arriba, sin cuota de Claude. Si supera al flujo actual (y en «día
  lleno», «ya» y «reagendar» tiene que superarlo por construcción), Bellido
  migra cuando termine la prueba, y ese flujo pasa a ser la base para
  cualquier cliente de agenda con un calendario.
- Es, además, la respuesta honesta a la pregunta de Silvana: no era subir la
  IA, era **dejar de pedirle a la IA lo que debe hacer el código**.

---

## 5. Verificación de la sesión revisora (30/09/2026)

Hecha en solo lectura sobre `origin/main`, antes de guardar el análisis.

**Los números se confirman.** `Flujos/bellido-agendamiento.json` tiene 96
nodos: 28 `if`, 24 `code`, 17 `httpRequest`, 6 `whatsApp`, 5 `googleCalendar`,
5 `googleGemini`, 4 `googleCalendarTool`, 2 `agent`, 1 `lmChatGoogleGemini`, 1
`memoryBufferWindow`, 1 `set` y el disparador. Los 5 nodos `googleCalendar`
fuera del agente son justamente las guardas del §2 (verificar y deshacer por
hecho). La seña está apagada en Bellido (`senaActiva` vacío, según
`CLIENTES/BELLIDO/`): los ~18 nodos de seña corren sin uso.

**Coincide con lo que ya estaba decidido o medido:**
- La batería del 29/09 concluyó que ningún prompt mejoró al vigente y que la
  aritmética de horas va en código.
- `Analisis/41` §6.3 ya pedía, para F3b, el estado de la conversación por
  teléfono en el servidor, en vez de la memoria del agente.

**Tres reglas del proyecto que el flujo mínimo tiene que conservar:**
1. **Candado por hecho** (`CLAUDE.md`, regla mandatoria del 17/09). El diseño
   mínimo elimina la causa principal —el modelo ya no agenda—, pero no la
   carrera: entre el `freebusy` del paso 4 y la creación del paso 7 pasan
   minutos, y otro paciente o recepción puede tomar esa hora. El paso 7 tiene
   que volver a verificar el calendario después de crear y deshacer si hay
   cruce; la suite reproduce ese caso, y la prueba con teléfono real
   insistiendo sobre una hora ocupada sigue siendo obligatoria.
2. **Solo se ofrece lo que se cumple.** Todo error del modelo o del
   calendario sale con el aviso a recepción y el botón para escribirle; el
   paso 2 ya lo tiene como opción del menú, pero también hace falta en las
   ramas de error de los pasos 3 a 7.
3. **Cada mensaje cuesta.** El diseño agrega un envío interactivo (los 3
   huecos con botones) y puede quitar otros; el prototipo declara cuántos
   mensajes por conversación agrega o quita frente al actual antes de
   compararse en la batería.

**Lo que queda para la decisión de Andres:** la rearquitectura está pausada y
la orden del 29/09 limita lo que se construye; un flujo nuevo en n8n, aunque
sea en el número de prueba y lo arme Antigravity, necesita su autorización
escrita (`Analisis/41` §12.10). La forma y los límites de ese encargo son la
segunda parte, en el §6.

## 6. Segunda parte: el ciclo Antigravity ↔ Claude (30/09/2026)

**Autorización.** El 30/09/2026 Andres autorizó por escrito construir y
verificar «Agenda mínima v0» como **excepción a la pausa** (`Analisis/41`
§6.4, por §12.10). La excepción cubre esto y nada más: un flujo aparte,
inactivo y experimental, sobre el número del Demo A con el comercio
`ensayo`. No retoma F2 ni F3, y no reemplaza al arreglo del flujo vigente de
Bellido, que sigue su propio camino.

**Los tres documentos del ciclo.** Llegaron de la misma sesión externa y
están en `~/Claude-Proyectos/coordinacion/agendamiento-minimo/`:
- `00-GUIA`: roles y calendario;
- `01-PROMPT`: Antigravity construye;
- `02-PROMPT`: Claude verifica.

La idea central es separar los roles. **Antigravity construye y corrige, sin
gastar cuota de Claude. Una sesión de Claude verifica con la batería del
29/09 y devuelve hallazgos numerados. Andres decide.** Claude nunca corrige lo
que construyó Antigravity, y Antigravity nunca discute el veredicto.

**Calendario:**
- **30/09 y 01/10:** Antigravity construye, una vez que Gemini vuelva a
  responder.
- **02/10 desde las 04:00:** la sesión constructora hace la primera
  verificación.
- **Fin de semana:** las rondas 2 y 3, si hacen falta.

**Correcciones de la revisora antes de pegar.** Las versiones que se usan son
las corregidas, en `~/Descargas/NOVUCHAT_agenda-minima-0{1,2}-…_2026-09-30.md`:

| Marca | Corrección | Por qué |
|---|---|---|
| R1 | Solo credenciales del Demo A; los flujos del sistema financiero que comparten la instancia de n8n no se abren (prohibiciones 5 y 7) | El prompt original mandaba copiar la credencial de Bellido. «NovuChat ingesta (Bellido)» reporta a su comercio, un cliente en prueba con bolsa contada, y las de Graph y WhatsApp envían desde su número real |
| R2 | La configuración de Bellido llega por el comercio `ensayo` (`ensayo.mjs`) | Con la configuración real, la prueba de emergencia le escribía al doctor y la de día lleno llenaba su agenda |
| R3 | Flujo inactivo; candado también después de crear; caso 13 de cruce | Una app de Meta tiene un solo webhook. Verificar solo antes de crear deja abierta la carrera (regla mandatoria del 17/09) |
| R4 | Workspace en `.claude/worktrees/agenda-minima/`, rama `experimental/agenda-minima` | La carpeta principal la comparten varias sesiones |
| R5 | Nunca «eso lo confirma recepción» sin transferir | Política «solo se ofrece lo que se cumple» (21/09) |
| R6 | El estado viaja en el id del botón cuando se puede | `staticData` no se guarda en una ejecución manual |
| R7 | El texto va dentro del mensaje interactivo; los mensajes se cuentan | Cada mensaje cuesta 0,0113 USD desde el 01/10 |
| R8 | Marcadores en el JSON exportado; ninguna secuencia de 10 dígitos o más | El repositorio es público |

**Quién verifica.** La sesión constructora, por decisión de Andres del 30/09,
y no la cartera: la cartera sigue con Bellido comercial. Antes de que
Antigravity empiece, la constructora hace tres cosas:
- prepara el worktree;
- carga `ensayo` con la configuración de Bellido;
- deja en `PREPARACION.md` los **nombres** de las credenciales del Demo A.

Cada `--aplicar` de esa preparación pasa por el «sí» de Andres.

**Un número para dos trabajos.** El número del Demo A es el único donde se
ensaya. Por eso Agenda mínima y cualquier ensayo del arreglo de Bellido (PR
#286) no pueden usarlo a la vez. Va primero el arreglo, porque protege a un
cliente real.
