# 04 — Latencia del Demo A (Agendamiento): hallazgos, ajustes y protocolo de medición

> **Alcance y honestidad del documento.** Todo lo que sigue es **análisis
> estático** del archivo `Flujos/demo-a-agendamiento.json`. Quien escribe esto
> no tiene credenciales ni acceso a la instancia de n8n, a Meta ni a Google, y
> por lo tanto **no midió nada**. Los tiempos de las tablas son *estimaciones
> razonadas*, no mediciones. Lo único que se comprueba con certeza es lo que
> dice el JSON. La verificación real exige un teléfono y está descrita en la
> sección 5.
>
> **Fecha:** 2026-08-28 · **Objetivo:** respuesta en menos de 10 segundos.
> **Congelamiento:** 8 de septiembre de 2026.

---

## 1. Cómo se gasta el tiempo en este flujo (el modelo mental)

Antes de la tabla conviene entender **dónde puede irse el tiempo**, porque de
ahí sale el orden de prioridades.

El camino principal es una cadena sin bifurcaciones:

```
WhatsApp Trigger → ¿Es un mensaje? → Config del negocio → Normalizar entrada
   → AI Agent (Sofía)  ← aquí se va el 90 % del tiempo
   → Procesar respuesta → Responder al cliente ( → ¿Transferir? → Avisar )
```

Los cuatro nodos previos al agente y los dos posteriores son cómputo local: en
conjunto valen **decenas de milisegundos**. Da igual optimizarlos.

El nodo `AI Agent (Sofía)` **no es una llamada**: es un bucle. Cada vuelta del
bucle se llama **iteración** y cuesta una llamada completa a Gemini:

1. n8n manda a Gemini el *system message* + el historial de memoria + las
   descripciones de las dos herramientas + el mensaje del cliente.
2. Gemini responde una de dos cosas: **el texto final** (fin del bucle) o
   **una petición de herramienta** (`consultar_disponibilidad` o
   `agendar_cita`).
3. Si pidió una herramienta, n8n llama a Google Calendar, mete el resultado en
   la conversación y **vuelve al paso 1**.

Por eso la variable dominante es **cuántas iteraciones hace el agente**, no
cuántos tokens tiene el prompt. Órdenes de magnitud aproximados, para un flujo
como este:

| Componente | Costo típico por ocurrencia |
|---|---|
| Una iteración del agente (una llamada a Gemini 2.5 Flash) | 2 – 6 s |
| Una llamada a Google Calendar (`getAll`, 20 eventos) | 0,3 – 1,0 s |
| Un envío por la Cloud API de WhatsApp | 0,3 – 0,8 s |
| Los seis nodos locales (IF, Set, dos Code) juntos | 0,05 – 0,15 s |
| Un reintento del modelo tras un 503 | +1 llamada + la espera configurada |

Con esa aritmética se explica el salto que se observó en producción:

- **Turno simple** (saludo, catálogo, precios): 1 iteración → **3 – 6 s**.
- **Turno de agendamiento sano**: 2 iteraciones + 1 llamada a Calendar →
  **6 – 12 s**. Esta es la ejecución de 11 s que ya se vio.
- **Turno con encadenamiento**: 4 iteraciones + 3 llamadas a Calendar (el
  agente consulta la mañana, luego la tarde, luego el día siguiente) →
  **18 – 30 s**.
- **Ese mismo turno con un 503 de Gemini y tres intentos separados por 2 s**:
  **+8 – 15 s** → así se llega a los **48 s** observados.

**Conclusión operativa: el enemigo son las iteraciones de más, y en segundo
lugar la cola de reintentos.** El tamaño del prompt es ruido en comparación.

---

## 2. Verificación de los cuatro ajustes ya aplicados

Se comprobaron **en el JSON** (no en la instancia; hay que reimportar y
*Publish* para que existan en producción):

| Ajuste | Estado en el JSON | Nota |
|---|---|---|
| `consultar_disponibilidad`: `returnAll: false`, `limit: 20` | ✅ presente | Correcto |
| `AI Agent (Sofía)`: `options.maxIterations: 5` | ✅ presente | Correcto |
| `settings.executionTimeout: 60` | ✅ presente | Ver advertencia abajo |
| `Google Gemini Chat Model`: `retryOnFail`, `maxTries: 3`, `waitBetweenTries` | ✅ presente | La espera se bajó a 1000 ms (ver H-4) |

**Advertencia sobre `executionTimeout: 60`.** Este parámetro no acelera nada:
solo evita que una ejecución colgada quede viva para siempre. Y tiene un
efecto secundario que hay que tener presente en la demo: **si la ejecución
vence, el cliente no recibe ninguna respuesta**, ni siquiera un mensaje de
error. Sesenta segundos de silencio delante de un prospecto son peores que una
respuesta lenta. Dos consecuencias prácticas:

- El guion del presentador debe tener una salida manual si a los ~20 s no
  llegó nada (retomar la conversación en voz, no quedarse mirando el teléfono).
- Queda sin verificar si la instancia tiene `EXECUTIONS_TIMEOUT_MAX` definido
  a un valor menor, en cuyo caso el ajuste del flujo se recorta solo. Se
  comprueba abriendo la ejecución y viendo si el corte ocurre antes de 60 s.

---

## 3. Tabla de hallazgos, ordenada por relación ahorro/riesgo

El ahorro es **estimado**. "Turno" = un mensaje del cliente y su respuesta.

| # | Hallazgo | Ahorro estimado | Riesgo | Decisión |
|---|---|---|---|---|
| **H-1** | **El prompt inducía encadenamiento de herramientas.** La regla 3 decía *"usa SIEMPRE la herramienta `consultar_disponibilidad`"*. Ese **SIEMPRE**, sin acotar, empuja al modelo a consultar el calendario incluso cuando el cliente solo saluda o pregunta precios, y a partir el día en varias consultas (mañana / tarde / otro día). Cada consulta extra es **una iteración más**, es decir una llamada completa a Gemini además de la llamada a Calendar. | **4 – 12 s** en turnos de agendamiento; **2 – 5 s** en saludos y catálogo | Bajo | ✅ **Aplicado** |
| **H-2** | **`maxOutputTokens: 512` con un modelo de razonamiento.** En la familia Gemini 2.5 los *tokens de pensamiento* se contabilizan contra el techo de salida. Con 512, una respuesta que piense un poco puede cortarse con `finishReason: MAX_TOKENS` y devolver **texto vacío o una llamada de herramienta malformada**; el agente entonces reintenta y gasta otra iteración entera. Es un candidato fuerte para explicar la ejecución de 48 s. | 0 s en el caso bueno; **3 – 8 s** y una respuesta vacía menos en el caso malo | Bajo | ✅ **Aplicado** (→ 1024) |
| **H-3** | **El modelo es `gemini-2.5-flash`, que razona antes de responder.** Es la palanca individual más grande que queda: `gemini-2.0-flash` no tiene esa fase y responde bastante más rápido. Pero cambiar de modelo cambia la calidad del agendamiento y **el modelo debe elegirse desde el desplegable de n8n, nunca escribirse a mano** (hallazgo 9 de `ESTADO.md`). | **1,5 – 4 s por iteración** | Medio (calidad) | ⛔ **No aplicado** — prueba A/B en la interfaz, sección 5, paso 3 |
| **H-4** | **La cola de reintentos costaba hasta 4 s de pura espera.** Con `maxTries: 3` y `waitBetweenTries: 2000`, un 503 de Gemini agrega dos esperas de 2 s **más** dos llamadas completas. Bajar la espera a 1000 ms conserva la protección y recorta la cola. | Hasta **2 s** cuando hay reintento | Bajo | ✅ **Aplicado** |
| **H-5** | **La consulta de calendario no fijaba zona horaria.** Sin `timeZone`, la API devuelve las horas en la zona por defecto del calendario y el modelo tiene que razonar la conversión, lo que alarga la generación y es una fuente de errores de hora. | **0,2 – 0,5 s** y menos riesgo de proponer una hora equivocada | Bajo | ✅ **Aplicado** (`America/La_Paz`) |
| **H-6** | **`contextWindowLength: 10`.** Diez intercambios de historial se reenvían **en cada iteración**. Una conversación de demo se resuelve en 5 – 7 turnos, así que 8 es suficiente. El ahorro es real pero chico. | **0,2 – 0,5 s** | Bajo | ✅ **Aplicado** (→ 8) |
| **H-7** | **Tamaño del `systemMessage`.** Se auditó como pedía el encargo: ~2 300 caracteres, unos 600 tokens. **No es una palanca de latencia.** Seiscientos tokens de prefijo en un modelo Flash cuestan del orden de **decenas de milisegundos**, tres órdenes de magnitud por debajo del problema. De hecho el prompt **creció** a ~2 900 caracteres al agregarle las reglas de H-1: se cambia ruido por segundos. | Negativo y despreciable (≈ −0,05 s), a cambio de H-1 | Nulo | ✅ **Aplicado a sabiendas** |
| **H-8** | **El resultado de Calendar entra íntegro al contexto.** Cada evento llega con `creator`, `organizer`, `iCalUID`, `htmlLink`, `reminders` y demás: 20 eventos son fácilmente 800 – 1 200 tokens que además **se reenvían en la iteración siguiente**. Lo ideal sería recortar campos, pero no se pudo verificar que el nodo de esta versión exponga esa opción, y bajar el `limit` de 20 a 10 podría ocultar horarios ocupados y hacer que el agente ofrezca un turno tomado — un error visible en demo. | **0,3 – 0,8 s** | Medio (corrección) | ⛔ **No aplicado** — `limit` se deja en 20 a propósito |
| **H-9** | **Contención de CPU en la VM.** 2 OCPU ARM compartidas con Odoo, Nginx Proxy Manager y `otp-service`. No aparece en el JSON y puede explicar por sí sola una parte de la varianza entre 11 s y 48 s. Se mide, no se adivina (sección 5, paso 2). | Desconocido | — | Fuera del flujo |
| **H-10** | **Riesgo de ejecuciones duplicadas.** La WABA está compartida con `Demo SeguroLo Tengo`. Si por cualquier motivo entraran dos ejecuciones por un mismo mensaje, el cliente recibiría dos respuestas y la segunda parecería "lentísima". Se verifica de un vistazo en la lista de ejecuciones. | — | — | Verificar |
| **H-11** | **Acuse inmediato ("un momento…" o indicador de escritura).** *Enmascara* la latencia, no la reduce: agrega una llamada a la Cloud API **antes** del agente, o sea que retrasa un poco la respuesta real, y suma un nodo más que puede fallar en vivo. A once días del congelamiento, no vale el riesgo. | 0 s reales | Medio | ⛔ **No aplicado** |
| **H-12** | **No hay llamadas secuenciales paralelizables.** Se revisó expresamente. La única bifurcación es `Procesar respuesta` → (`Responder al cliente`, `¿Transferir a humano?`), y el orden es el correcto: el mensaje al cliente sale primero y el aviso a recepción después. Nada que ganar acá. | 0 s | — | Sin cambios |
| **H-13** | **No hay nodos que se ejecuten de más.** El IF `¿Es un mensaje?` descarta los acuses de estado antes del agente, como manda `CLAUDE.md`, y los dos nodos Code son locales. | 0 s | — | Sin cambios |

### Ahorro agregado esperado

Sumando solo lo aplicado y para el turno que hoy duele (pedir horarios):

- **Caso típico:** de 8 – 12 s a **5 – 8 s**.
- **Caso malo** (el que produjo los 48 s): de 25 – 48 s a **10 – 18 s**.

Esto **todavía no garantiza el objetivo de <10 s en el peor caso**. Si tras
medir el p90 sigue por encima de 10 s, la carta que queda es H-3 (cambiar a
`gemini-2.0-flash`), y esa decisión debe tomarse **con datos y antes del 6 de
septiembre**, para que el ensayo general la valide.

---

## 4. Qué se aplicó al JSON y qué se dejó intacto por política

**Aplicado** en `Flujos/demo-a-agendamiento.json`:

1. `AI Agent (Sofía)` → `systemMessage`: bloque nuevo **ECONOMÍA DE
   HERRAMIENTAS** (responder directo sin herramientas en saludos, catálogo y
   precios; una sola llamada a `consultar_disponibilidad` por mensaje y con el
   día completo en un único rango; `agendar_cita` una sola vez; prohibido
   repetir una llamada con los mismos parámetros). La regla 3 perdió el
   "usa SIEMPRE" que inducía el encadenamiento.
2. `Google Gemini Chat Model` → `maxOutputTokens`: 512 → **1024**.
3. `Google Gemini Chat Model` → `waitBetweenTries`: 2000 → **1000**.
4. `Memoria por teléfono` → `contextWindowLength`: 10 → **8**.
5. `consultar_disponibilidad` → `options.timeZone`: **`America/La_Paz`**, y
   `toolDescription` reescrita para repetir el límite de una llamada por turno
   (el modelo lee esa descripción en cada iteración, así que es el lugar más
   efectivo para poner la restricción).

**No se tocó, por las reglas de diseño de `CLAUDE.md`:**

- **La clave de sesión de la memoria** sigue siendo
  `={{ $('Normalizar entrada').item.json.from }}` con `sessionIdType:
  customKey`. Bajar la ventana de contexto no la afecta. Reducir memoria por
  la vía de quitar la clave de sesión ahorraría tiempo y **mezclaría las
  conversaciones de dos clientes**: es el defecto más grave posible acá.
- **El filtro de eventos** `¿Es un mensaje?` antes del agente se mantiene tal
  cual, aunque un IF cuesta milisegundos: es lo que impide que los acuses de
  estado disparen llamadas a Gemini.
- **La normalización de entrada** conserva las ramas `text`, `interactive`,
  `image` y el `default` cortés que cubre `order` y cualquier otro tipo. No se
  simplificó pese a que acortar el nodo "ahorraría" microsegundos.
- **La fecha, hora y zona `America/La_Paz` (UTC-4)** siguen inyectadas al
  prompt, palabra por palabra con la misma expresión. Es el bloque más caro en
  tokens del encabezado y **aun así no se toca**: sin él, "mañana en la tarde"
  se calcula mal.
- **`modelName`** no se editó a mano en el JSON. `ESTADO.md` documenta que
  escribir el nombre del modelo a mano rompe el nodo; debe elegirse desde el
  desplegable.
- **`limit: 20`** en la consulta de calendario se mantiene: bajarlo ahorraría
  décimas y podría hacer que el agente ofrezca un horario ya ocupado.

**Observación al margen, fuera del encargo de latencia:** el nodo
`Config del negocio` lleva el `PHONE_NUMBER_ID` literal en el JSON y el
repositorio pasó a ser público en esta misma sesión. No es un secreto
criptográfico, pero conviene que quien esté aplicando la convención de
marcadores `${...}` decida qué hacer con él. No se modificó acá para no pisar
ese trabajo.

---

## 5. Protocolo de medición — qué tiene que hacer Andres

Nada de lo anterior está comprobado hasta que se mida contra un teléfono real.
El orden importa: primero se establece la línea de base, después se aísla el
culpable, y solo entonces se decide si hace falta H-3.

### Paso 0 — Poner los cambios en producción (sin esto no se mide nada)

1. En n8n: `⋯ → Import from File…` con `Flujos/demo-a-agendamiento.json`, o
   editar los cinco parámetros a mano en el lienzo.
2. Revisar los dos parámetros que **se pierden o llegan vacíos al importar**:
   `Trigger On = Messages` en el WhatsApp Trigger (con *Receive Message Status
   Updates* vacío), y las credenciales de cada nodo.
3. Confirmar que en `consultar_disponibilidad` aparece la opción *Timezone*
   con `America/La_Paz`. Si esa opción no existe en esta versión del nodo,
   quitarla y avisar: el ahorro de H-5 se pierde, nada más.
4. **Pulsar Publish.** En n8n un cambio guardado pero no publicado no llega a
   producción, y se mediría el flujo viejo creyendo que es el nuevo.

### Paso 1 — Línea de base: dónde se mide el tiempo en n8n

n8n da tiempos por nodo, que es exactamente lo que hace falta:

1. **Overview → Executions**. Cada fila muestra el tiempo total de la
   ejecución. Ese es el número que hay que llevar a la tabla.
2. Abrir una ejecución. En el lienzo, **cada nodo muestra su tiempo de
   ejecución** debajo del nombre. Sumados dan el total; el que se lleve casi
   todo será `AI Agent (Sofía)`.
3. Abrir el **panel de registro del agente** (el panel lateral de *Logs* al
   hacer clic en el nodo del agente). Ahí se ve la lista de llamadas: cada
   llamada al modelo y cada llamada a herramienta, **con su duración**.

   **Esta es la pantalla que importa.** Lo que hay que anotar de cada
   ejecución es:

   - **cuántas llamadas al modelo** aparecen (= iteraciones);
   - **cuántas llamadas a `consultar_disponibilidad`**;
   - **cuánto tardó cada una**.

   Con esos tres números el diagnóstico es inmediato: seis llamadas al modelo
   en un turno significa que el agente encadenó y el problema es de prompt;
   dos llamadas al modelo de 20 s cada una significa que el problema es
   Gemini o la red de la VM.

4. Hacer esto para **una batería fija de 10 mensajes** — usar los de
   `Demo-Recursos/checklist-ensayo.md` para que sea comparable entre corridas
   — y anotar en una tabla: mensaje, tiempo total, nº de iteraciones, nº de
   llamadas a Calendar.

> **Por qué medir también con cronómetro en el teléfono:** el tiempo de n8n no
> incluye el viaje del mensaje por la infraestructura de Meta. Lo que el
> prospecto percibe es **tiempo de n8n + 1 a 2 s de ida y vuelta por la Cloud
> API**. El criterio de aceptación de la sección 6 está expresado sobre el
> tiempo de n8n justamente porque es el único reproducible; el cronómetro es
> el control de realidad.

### Paso 2 — Aislar al culpable: ¿Gemini, Calendar o el agente?

Cuatro pruebas, de la más barata a la más cara. La lógica es ir restando
componentes hasta que el tiempo se caiga.

**a) Turno sin herramientas.** Enviar *"Hola, ¿qué servicios de belleza
tienen?"*. Ese turno **no debe llamar a ninguna herramienta** (es justamente
lo que impone la nueva regla). Todo lo que tarde es Gemini + el sobrecosto de
n8n.
- Si tarda **menos de 5 s**: Gemini está sano y el problema son las
  iteraciones o Calendar.
- Si tarda **más de 8 s**: el problema es Gemini o la VM, y ninguna
  optimización de prompt lo va a arreglar.
- Si **igual llama a `consultar_disponibilidad`**: la regla nueva no está
  surtiendo efecto y hay que endurecerla más (o el flujo no se publicó).

**b) Turno con calendario.** Enviar *"¿Tienen algo mañana en la tarde?"*.
Restar el tiempo de (a). La diferencia es el costo del calendario **más** las
iteraciones extra. En el panel de registro debe verse **exactamente una**
llamada a `consultar_disponibilidad`. Si hay dos o tres, el encadenamiento
sigue vivo.

**c) Aislar Google Calendar, sin IA de por medio.** Flujo de prueba nuevo y
desechable: `Manual Trigger → Google Calendar (Get Many Events)` apuntando al
mismo calendario, mismo rango de un día, `limit 20`. Ejecutarlo cinco veces y
mirar el tiempo del nodo.
- 0,3 – 1 s es normal.
- Más de 3 s de forma sostenida indica un problema de red saliente de la VM o
  de la credencial OAuth (renovación de token), no del agente.

**d) Aislar Gemini, sin herramientas de por medio.** Otro flujo desechable:
`Manual Trigger → Basic LLM Chain` con **el mismo** `Google Gemini Chat Model`
y un prompt corto ("Responde en una oración: ¿qué hora es en Bolivia?").
Ejecutarlo diez veces seguidas y anotar los tiempos.
- Este es el costo **de una sola iteración** en el mejor caso posible.
  Multiplicado por el número de iteraciones que se contó en el paso 1, tiene
  que dar aproximadamente el tiempo del agente. Si no da, la diferencia está
  en el tamaño del contexto (memoria + resultado de Calendar, H-6 y H-8).
- Si alguna de las diez corridas se dispara a 15 s o devuelve **503**, ya está
  identificado el enemigo: es la capacidad gratuita de Gemini, y la respuesta
  correcta es **habilitar facturación en Google AI Studio** antes del 8 de
  septiembre, no seguir afinando el flujo. Está anotado como decisión
  pendiente en `ESTADO.md` y esta medición es la que la resuelve.

**e) Descartar la VM (H-9).** Con una sesión SSH abierta contra la VM,
ejecutar `uptime` y `docker stats --no-stream` **mientras** se corre la
batería del paso 1. Si el *load average* supera 2,0 en 2 OCPU, o el
contenedor de n8n está clavado en el 100 % de CPU, parte de la latencia es
contención con Odoo y `otp-service`, y el remedio es de infraestructura
(reprogramar tareas pesadas fuera del horario de la demo), no del flujo.

**f) Descartar duplicados (H-10).** Después de enviar **un** mensaje, mirar la
lista de ejecuciones: **debe haber exactamente una**. Dos ejecuciones por un
mensaje significan doble consumo, doble respuesta y una percepción de
lentitud que ninguna optimización arregla.

### Paso 3 — Decidir sobre H-3 (el cambio de modelo), con datos

Solo si tras el paso 2 el p90 sigue por encima de 10 s:

1. En el nodo `Google Gemini Chat Model`, **elegir del desplegable**
   `models/gemini-2.0-flash`. Nunca escribirlo a mano.
2. Repetir **la misma batería de 10 mensajes** del paso 1.
3. Comparar dos cosas, no una: el tiempo **y la calidad**. En particular que
   el agente siga (i) calculando bien "mañana en la tarde", (ii) llamando a la
   herramienta con fechas ISO 8601 en `-04:00`, y (iii) sin ofrecer horarios
   ocupados.
4. Si el tiempo mejora y la calidad se sostiene, dejarlo y **exportar el JSON
   al repositorio**. Si la calidad cae, volver a 2.5 Flash y aceptar los
   tiempos, ajustando el guion del presentador para cubrir la espera.

---

## 6. Criterio de aceptación numérico

Sobre la batería de **10 mensajes** de `Demo-Recursos/checklist-ensayo.md`,
medida en el tiempo total que reporta la lista de ejecuciones de n8n:

| Métrica | Umbral para dar la latencia por cerrada |
|---|---|
| Mediana (p50) del tiempo total | **≤ 6 s** |
| p90 (el 9.º peor de 10) | **≤ 10 s** |
| Peor caso de los 10 | **≤ 15 s** |
| Ejecuciones con error o vencidas | **0 de 10** |
| Respuestas vacías o cortadas | **0 de 10** |
| Iteraciones en turnos sin calendario | **≤ 2** |
| Iteraciones en turnos con calendario | **≤ 3** |
| Llamadas a `consultar_disponibilidad` por mensaje | **≤ 1** |
| Ejecuciones por mensaje enviado | **exactamente 1** |

Las tres últimas filas son las que de verdad importan: **son causa, no
síntoma.** Si las iteraciones están dentro del límite y el tiempo igualmente
no cierra, entonces el problema no es el flujo sino Gemini o la VM, y hay que
ir a los pasos 2d y 2e.

Se recomienda repetir la batería **dos veces en horarios distintos** (por
ejemplo mañana y media tarde de Bolivia): la capacidad gratuita de Gemini y la
carga de la VM varían con la hora, y las demos son a una hora concreta. Medir
una sola vez y a una sola hora es cómo se llega al 9 de septiembre creyendo
que el problema estaba resuelto.

---

## 7. Lo que queda sin verificar

Se dice explícitamente para que nadie lo dé por hecho:

- **Ninguna medición de tiempo de este documento es real.** Todas son
  estimaciones a partir del JSON y de órdenes de magnitud conocidos.
- **No está comprobado que los cambios reduzcan la latencia.** Es una
  hipótesis razonada: menos iteraciones, menos segundos. Lo confirma o lo
  refuta el paso 1.
- **No está comprobado que el modelo obedezca las nuevas reglas del prompt.**
  Los modelos de lenguaje no cumplen instrucciones de forma determinista; la
  prueba 2a y 2b está diseñada precisamente para detectar si desobedece.
- **No está comprobado que la opción `timeZone` exista** en el nodo Google
  Calendar Tool de esta versión de n8n. Se verifica de un vistazo en el paso 0.
- **No está comprobado el comportamiento de `maxOutputTokens` con los tokens
  de razonamiento** de Gemini 2.5 en esta instancia. Se confirma si en el
  registro del agente aparece alguna respuesta cortada o vacía.
- **No está comprobado que la causa de los 48 s fuera el encadenamiento.**
  Es la explicación que mejor encaja con el salto desde 11 s, pero la
  ejecución concreta no se pudo abrir. **Si esa ejecución todavía está en la
  lista de n8n, abrirla y contar las iteraciones cierra la pregunta en dos
  minutos** y vale más que todo este análisis estático.
