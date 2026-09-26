# El ciclo de vida del cliente: altas, solicitudes, reclamos y colisiones

> Documento de entrada para toda sesión de cliente
> (`Prompts/operacion-de-clientes.md`) y para los agentes `alta-cliente` y
> `analista-de-solicitudes`. Es el §12 de
> `Analisis/41-arquitectura-por-capas.md` (25/09/2026), movido acá **sin
> cambiar una letra** y con los punteros a los runbooks en las etapas que los
> tienen: la **etapa 3** (alta técnica) remite a `docs/alta-cliente/RUNBOOK.md`
> y la **etapa 6** (pase a producción) a `docs/pase-a-produccion/RUNBOOK.md`.
> Sin secretos ni identificadores.

## Cómo se lee, y qué runbook corresponde a cada etapa

| # | Etapa | Compuerta: archivo en `CLIENTES/<T>/` | Procedimiento |
|---|---|---|---|
| 0 | Propuesta comercial con factibilidad | `cumplimiento.md` | §12.3 (cláusulas prohibidas) sobre el borrador, antes de enviarlo |
| 1 | Ficha y cumplimiento | `ficha.md` | `docs/alta-cliente/plantilla-ficha.md` |
| 2 | Análisis de solicitudes | `pedidos.md`, `solicitudes/<n>.md` | §12.4, con el agente `analista-de-solicitudes` (solo lectura) |
| 3 | **Alta técnica** | entorno del cliente completo, `verificar-meta.sh` en verde | **`docs/alta-cliente/RUNBOOK.md`**, con el flujo guardado `/alta-cliente` y los agentes `alta-cliente`, `meta-whatsapp`, `plataforma`, `flujos-n8n` |
| 4 | Adecuación | solo por módulos con bandera; ensayo obligatorio | §12.5; `docs/ensayo/LEEME.md`; congelamiento del §12.10 mientras F2 y F3 estén en obra |
| 5 | Aceptación | `aceptacion.md` sin celdas vacías | filas de los módulos encendidos más las particularidades, con identificador de ejecución por fila |
| 6 | **Pase a producción** | `pase-a-produccion.md`, `anexo-particular.md` | **`docs/pase-a-produccion/RUNBOOK.md`**; `docs/contrato/anexo-tecnico-sla.md` |
| 7 | Operación | `estado.md`, `pedidos.md`, `aceptacion.md` al día | §12.6 (colisiones), §12.7 (reclamos con circuito), `docs/versiones-por-cliente.md` y `scripts/estado-de-versiones.sh` |
| 8 | Baja o suspensión | — | Functions existentes; pantalla en Plataforma (F1); datos retenidos 12 meses (`docs/arquitectura/central.md` §4septies) |

**Las tres reglas que no se negocian:** sin `cumplimiento.md` no se envía una
propuesta; sin `pedidos.md` no se construye nada; sin `aceptacion.md` llena no
hay pase. Y **un tenant nunca posee código** (`docs/arquitectura/tenants.md`):
lo que un cliente necesita y no existe nace como módulo con bandera, para
todos.

## Lo que pasó en 26 días, medido (§12.1)

Es el diagnóstico que justifica el ciclo; se conserva porque las cifras son la
línea de base contra la que se mide si el proceso funciona.

| Cifra | Valor |
|---|---|
| Clientes con número real atendiendo | 3 (Bellido, Platinum, NovuChat) |
| Filas de aceptación llenas en los dos clientes con pacientes reales | **0 de 91** |
| Incidentes en que un cliente afectó a otro, quedó atrás del vertical o se confundió con otro | **23** (tabla completa en el relevamiento del 25/09) |
| Reclamos reales que pasaron por la pantalla «Reclamos» | 0; la callable que mueve estados no tiene ningún llamador |
| Propuestas comerciales con cláusulas que el servidor no puede cumplir | 2 de 2 (Q'Taco: «pago confirmado» y tope con corte; Dhermacore: «cada imagen consume 2 mensajes» y cambios sin contador) |
| Etapas del ciclo de vida que el runbook cubre | 3 de 8 |

Los 23 incidentes, por causa: **6** por copiar el demo al cliente y heredar lo
que nadie borró (marcadores, credenciales, alias, `webhookId`); **4** por una
lección que no cruzó de un flujo a otro o un cliente que quedó atrás del
vertical; **5** por un recurso compartido entre clientes (credencial de
Calendar, portafolio al tope, texto de un cliente en código común, un arreglo
pedido por uno que rompió a los tres); **3** por dos superficies o dos fuentes
de configuración sin regla de cuál manda; **5** defectos del producto que el
cliente encontró porque la aceptación no se corre. La raíz es una sola: **el
tenant es una copia editada a mano**, y el proceso no decide qué hacer con cada
pedido antes de construirlo.

### 12.2 Las ocho etapas, con su compuerta

Cada etapa termina con un archivo lleno en `CLIENTES/<T>/`, y la siguiente no
arranca sin él. Documento de entrada: `docs/clientes/CICLO-DE-VIDA.md`, que
remite al runbook de alta en la etapa 3 y al de pase en la 6.

| # | Etapa | Compuerta (lo que tiene que existir para pasar) | Hoy |
|---|---|---|---|
| 0 | **Propuesta comercial con factibilidad** | `cumplimiento.md`: cada cláusula de la propuesta mapeada a una capacidad de un módulo o a un límite que el servidor hace cumplir; ninguna cláusula de la lista prohibida (§12.3). **Se corre sobre el borrador, antes de enviarlo** | No existe; el análisis llega después de enviada |
| 1 | **Ficha y cumplimiento** | `ficha.md` con particularidades, supuestos declarados, quién paga Meta, plan, modalidad prevista, datos de terceros que **no** se cargan | La ficha tiene datos técnicos; lo demás va a mano |
| 2 | **Análisis de solicitudes** (§12.4) | `pedidos.md` con cada pedido clasificado, sus opciones «así se puede», esfuerzo real y decisión comercial | No existe |
| 3 | **Alta técnica** | El runbook de alta; `verificar-meta.sh` en verde; entorno del cliente completo (`N8N_WORKFLOW_ID` incluido) | Existe y funciona |
| 4 | **Adecuación** | Solo por módulos con bandera (§12.5); ensayo obligatorio; costo en mensajes declarado; ninguna línea de un cliente en código común | Se hizo sin etapa: 19 nodos en un JSON, bloques en el vertical |
| 5 | **Aceptación** | `aceptacion.md` sin celdas vacías, con identificador de ejecución por fila; la suite es la unión de las filas que trae cada módulo encendido más las particularidades del cliente | Archivo vacío en los dos clientes que atienden |
| 6 | **Pase a producción** | El runbook de pase: ejes escritos (plan, modalidad, titularidad), contrato con quién paga Meta y los cambios incluidos, acta con evidencia | Runbook del 22/09, nunca ejecutado |
| 7 | **Operación** (§12.6, §12.7) | Reclamos con circuito; pedidos registrados y contados; correcciones por severidad; versión de módulo por tenant al día | Por chat, audio y Excel; sin registro de quién pidió qué |
| 8 | **Baja o suspensión** | Functions existentes con pantalla en Plataforma; datos retenidos 12 meses | Sin pantalla; nunca ejercitada |

### 12.3 La regla de atención: «así se puede»

**Regla de Andres (25/09/2026), para todo cliente.** A un pedido no se le
contesta «sí» ni «no»: se le contesta con una alternativa viable, preferentemente
sobre algo que ya existe. El cliente es flexible si lo que se le propone está en
el rango de lo que puede aceptar, y muchas veces lo existente o lo fácil es lo
que hubiera preferido de haberlo conocido.

Es la cara comercial de una regla que el sistema ya tiene para el asistente,
«solo se ofrece lo que se cumple» (21/09): el asistente nunca promete lo que el
flujo no hace, y NovuChat nunca dice «no» sin poner sobre la mesa lo que sí
hace. Las dos juntas cierran el círculo: lo que NovuChat ofrece al cliente es
exactamente lo que el flujo va a cumplirle a sus clientes.

**Cómo se aplica en el análisis de cada pedido:** se escriben siempre **tres
opciones**, y se recomienda una:

- **A. Lo pedido, literal.** Con su esfuerzo real y su costo.
- **B. Sobre lo existente.** Qué módulo o configuración de hoy cubre la
  necesidad de fondo, aunque no la forma pedida.
- **C. La variante que conviene más.** Lo que el cliente no imaginó porque no
  sabe qué hay: a veces es mejor para él y más barata para NovuChat.

La necesidad de fondo se escribe antes que las opciones: el doctor que pide «el
menú de 3 botones en una lista de 4 filas» necesita que el paciente elija sin
escribir; el que pide «citas de octubre desde un .ics» necesita no recargar 40
citas a mano. Las opciones se juzgan contra la necesidad, no contra la frase.

**Lista de cláusulas prohibidas en propuestas y guiones** (cada una ya se pagó):

| Cláusula | Por qué no | Qué se ofrece en su lugar |
|---|---|---|
| «Pago confirmado», «acreditado», «verificado» | Prohibición 3 de `CLAUDE.md`: el OCR no acredita | «Recibimos tu comprobante y los datos coinciden; el comercio confirma contra su banco» |
| «Cada imagen consume N mensajes» | El servidor cuenta un mensaje por saliente; no existe | Contar lo que se cuenta: respuestas del asistente |
| Cambios «ilimitados» o sin número | No hay contador; el SLA promete dos días hábiles por cambio | «N cambios incluidos al mes», con el contador de F1 |
| «Suspensión automática por falta de pago» | El corte del prepago está en observación | Se promete cuando `corteActivo` esté encendido |
| «Recordatorio 24 h antes» sin plantilla aprobada | Fuera de 24 h solo llega una plantilla de utilidad aprobada | Se promete cuando la plantilla esté aprobada en la WABA del cliente |
| «Tres flujos simultáneos» | Es un flujo con tres intenciones | Decirlo así en el contrato; el lenguaje comercial puede quedar |
| Cualquier afirmación clínica, médica o financiera del asistente | El asistente informa; no diagnostica ni garantiza | Lista de afirmaciones prohibidas por cliente, como Platinum |
| «Seguimiento de solicitudes pendientes» en Messenger o Instagram | Sin etiqueta para eso fuera de 24 h (`Analisis/35`) | Solo en WhatsApp y Telegram |

### 12.4 El análisis de solicitud: reutilizar, crear, dónde reside, cuánto cuesta

Todo pedido se anota en `CLIENTES/<T>/pedidos.md`, venga por audio, Excel,
WhatsApp, reunión o chat, con fecha, quién lo pidió y por qué medio. Un pedido
trivial ocupa una fila; uno que no lo es, un archivo `solicitudes/<n>.md` con
esta estructura. **El análisis es un entregable en sí mismo, con techo de una
hora, y no implica construir**: muchas veces termina en una cotización, y el
cliente decide.

```
Solicitud literal      lo que dijo, con fecha, quién y medio
Necesidad de fondo     qué quiere lograr (no la forma en que lo pidió)
Ubicación              prueba de ubicación del §1.3: configuración | módulo existente
                       | módulo nuevo | core | dato del tenant | no
Reutilización          qué existe ya que la cubre, en el registro de módulos y en
                       ~/Claude-Proyectos/proyectos/ ; qué porcentaje de la necesidad cubre
Lo que se crea         dónde reside (zona y carpeta), a quién más le sirve, si nace
                       con bandera, mensajes por conversación que agrega o quita
Esfuerzo real          jornadas, con las señales de dificultad oculta marcadas (abajo)
Opciones               A literal · B sobre lo existente · C la variante mejor,
                       cada una con esfuerzo, plazo y precio; la recomendada
Decisión comercial     incluido (cuenta contra cambiosIncluidos) | cotizado (precio,
                       nada se construye hasta el OK) | mapa de producto (módulo, fecha)
                       | repriorizado (cliente especial: criterio y qué desplaza)
Estado                 analizado → propuesto al cliente → aceptado → construido →
                       verificado con el cliente (fila en aceptacion.md)
```

**Las solicitudes engañan en los dos sentidos.** Lo que parece simple toca Meta,
código común o el dinero; lo que parece difícil ya existe. Casos reales:

| Pedido | Parecía | Es | Por qué |
|---|---|---|---|
| «Andres sin acento» en el nombre visible | Trivial | Difícil | El nombre visible de Meta tiene cupo mensual de cambios y la pantalla no dice la verdad; se pide una vez, por API |
| Menú de 3 botones a lista de 4 filas | Trivial | Medio | Cambia la topología de nodos propios del cliente; títulos de 20 caracteres; el botón no guardaba su elección desde el 18/09 |
| Emergencia sin el 168 ni «si no respira» | Trivial | Trivial, pero **decisión clínica del doctor**: queda escrita con su nombre | Texto de configuración; el riesgo es de responsabilidad, no de código |
| Siete agendas en Platinum | Configuración | Difícil | El candado hace una llamada a Calendar por agenda: con siete se rompe la latencia (`Analisis/24`) |
| Recordatorio 24 h antes | Trivial, «ya está en el demo» | Medio | Exige plantilla de utilidad aprobada en la WABA del cliente y el flujo programado; se decidió no prometerlo a Bellido |
| Citas de octubre desde un `.ics` | Difícil | Trivial | Existe `citas-a-calendario.mjs` |
| Fotos de antes y después (Dhermacore) | Difícil | Medio | El módulo de medios guardados ya está diseñado (`Analisis/38`) |
| Rescate a las 48 h (Dhermacore) | Nuevo | Existe | Es el módulo de seguimientos |
| «Vacunas y cremas van al doctor» | Trivial | Trivial | Configuración: palabras que transfieren |
| Un corrector del día de la semana «para Bellido» | Un cliente | Los tres | Vive en código común: fue a los tres flujos y se rompió en los tres |

**Señales de dificultad oculta**, para marcar en «Esfuerzo real»: toca código
común (va a todos); toca la topología de n8n (no es ensamblable hasta F3);
toca Meta (plantilla, revisión, cupo, portafolio); toca el candado, el cobro o
el conteo (dinero y regla mandatoria); exige desplegar Functions (etiqueta y
aprobación); toca datos de terceros; exige prueba con teléfono real; entra por
ventana de mantenimiento. **Señales de facilidad oculta:** es un campo de
configuración que ya existe; es un módulo que se enciende; existe en otro
vertical o en otro proyecto de `~/Claude-Proyectos/`; es un script que ya está
en `admin/scripts/`.

### 12.5 Cotizar, incluir y repriorizar

- **Cotizar no es construir.** El análisis del §12.4 se entrega al cliente con
  sus tres opciones y precios; lo que se construye es lo que el cliente acepta,
  y recién entonces entra a la cola. Un análisis que termina en «no acepta» es
  un análisis bien hecho.
- **Qué se incluye y qué se cobra**, para que la decisión no se invente en cada
  mesa (los números los fija Andres; la estructura es esta): configuración que
  el cliente hace solo en su consola, sin cupo; configuración que opera
  NovuChat, contra `cambiosIncluidos` y después por unidad; encender un módulo
  existente, con su instalación; módulo nuevo, cotizado por jornada, y como
  nace reutilizable NovuChat puede cofinanciarlo si lo va a vender a otros.
- **Clientes especiales y repriorización.** Un cliente puede adelantar un
  módulo en el mapa de producto (estratégico, primero en su rubro, volumen,
  referencia). Tres reglas: el criterio y lo que desplaza quedan escritos en su
  `pedidos.md`; **la prioridad adelanta un módulo para todos, nunca mete código
  en el tenant** (es la misma pieza, antes); y nunca pasa por encima de un
  hotfix de seguridad o de protección ni de una fase en obra de la
  rearquitectura.

### 12.6 Colisiones entre tenants: tres tipos, tres salidas

| Tipo | Ejemplos del 25/09 | Salida |
|---|---|---|
| **Tenant contra vertical (deriva)** | Platinum atrás de #170 y #171; Demo A sin el bloque de Platinum; Demo B atrás de #165 | Versión de módulo por tenant y excepción declarada (`docs/versiones-por-cliente.md`). Falta la comparación del JSON del cliente contra el módulo del que salió: `estado-de-versiones.sh` hoy solo compara el flujo vivo con su propio JSON. Con el JSON generado (F2, F5) la deriva desaparece por construcción |
| **Pedido de un tenant sobre código común** | Corrector de día de semana; constante de audio; nombre de la clínica en un comentario del vertical | Prueba de ubicación: nace como módulo con bandera, encendido en quien lo pidió y apagado en los demás. Nunca texto ni nombre de un cliente en código común. Las correcciones de seguridad y de protección van a todos, sin excepción (SLA §8) |
| **Tenants compitiendo por un recurso** | Credencial de Calendar `invalid_client` en tres a la vez; portafolio al tope; umbrales bajados para probar que degradaron a otros teléfonos; un solo número de ensayo | Inventario de recursos compartidos (§12.9) con una decisión por recurso: por tenant, por número, o compartido con cola |

### 12.7 Reclamos y correcciones con circuito

- **Un canal de entrada que registra**, aunque el reclamo llegue por el
  WhatsApp de recepción, por audio o por reunión: la persona de NovuChat lo
  carga en «Reclamos» del comercio, con categoría y fecha. La regla del 17/09
  manda: lo que se instruye por chat tiene que verse en la consola del
  comercio.
- **Una pantalla en Plataforma que mueve el estado** (la callable existe y
  nadie la llama), con auditoría de quién y cuándo.
- **Cinco pasos fijos** para cualquier reclamo de falla: ejecuciones de n8n
  leídas; causa y severidad según el SLA §5; corrección como hotfix (severidad
  1) o en la ventana de 02:00 a 03:00; publicación **a todos** con excepciones
  declaradas; **verificación con el cliente anotada en su `aceptacion.md`**.
- **Errores de redacción del modelo** están excluidos por el SLA §11, pero un
  patrón que se repite es un pedido de barrera por hecho, y entra al §12.4.

### 12.8 Estructura obligatoria de `CLIENTES/<T>/`

La carpeta está ignorada por git y vive en la copia base, no en un worktree.

| Archivo | Etapa | Contenido |
|---|---|---|
| `cumplimiento.md` | 0 | Cláusulas de la propuesta contra capacidades y límites; veredicto por cláusula |
| `ficha.md` | 1 | Datos del negocio, canal, plataforma, particularidades, supuestos, quién paga Meta, plan y modalidad previstos, datos de terceros que no se cargan |
| `pedidos.md` y `solicitudes/<n>.md` | 2 y 7 | Cada pedido con su análisis, decisión y estado; el contador de cambios del mes |
| `estado.md` | 3 a 8 | Bitácora del cliente, lo más nuevo arriba |
| `aceptacion.md` | 5 y 7 | Filas generadas de los módulos encendidos más las particularidades; identificador de ejecución por fila; se vuelve a llenar en cada verificación con el cliente |
| `pase-a-produccion.md` | 6 | El runbook de pase aplicado; acta |
| `anexo-particular.md` | 6 | Lo del contrato que es de este cliente: cambios incluidos, titularidad, excepciones de versión, afirmaciones prohibidas |
| `guia-meta.md`, material del cliente | 3 | Lo que ya existe |

### 12.9 Inventario de recursos compartidos

| Recurso | Compartido entre | Decisión |
|---|---|---|
| Credencial OAuth de Google Calendar | Demo A, Platinum, Bellido | Por tenant; o calendarios compartidos a una cuenta de NovuChat con credencial propia por tenant. Un `invalid_client` no puede tumbar a tres |
| Portafolios de Meta creados por Andres | Tope de 2 por persona; 2 números por portafolio sin verificar | Verificar «NovuChat Produccion» es lo que destraba (20 números, apps fuera del tope de 15). Hasta entonces, cliente nuevo = portafolio del cliente |
| Número de ensayo (Demo A) | Todos los clientes de reservas | Un ensayo a la vez, con cola escrita en `COORDINACION.md`; segundo número de ensayo antes del quinto cliente; para clientes con nodos propios el ensayo no sirve hasta F5 |
| Umbrales de atención | Todos los teléfonos del comercio | Nunca bajarlos en un comercio que atiende; umbral por teléfono de prueba como arreglo de fondo |
| Clave de Gemini, VM de OCI, instancia de n8n Community | Todos, incluido el otro producto que vive en la VM | Compartidos y aceptados; capacidad medida antes del cliente cincuenta (`Analisis/20` §6) |
| Tarjeta de NovuChat en Meta | Todas las cuentas del portafolio donde esté | Nunca en el portafolio de un cliente; tarjeta dedicada con tope y alerta por WABA |
| Proyecto Firebase y Secret Manager | Todos | Aislamiento por reglas y claims (probado); un alias de secreto por número |
| Memoria del agente en n8n | Teléfonos del mismo flujo | Clave = teléfono; quien escribe a dos números del mismo tenant comparte ventana, bloque y umbrales (`Analisis/38`), y hay que decirlo en la mesa |

### 12.10 Congelamiento durante la obra, y qué sigue abierto

Mientras F2 y F3 estén en curso, **ningún cliente recibe código a medida**. Lo
que sí sigue: configuración (es dato y se aplica en cualquier momento),
comercial, Meta, aceptación, y hotfix de seguridad o de protección. Todo pedido
que exija código se analiza igual (§12.4), se cotiza si corresponde, y queda en
`pedidos.md` con fecha comprometida «después de F3b». Se les dice a los
clientes en prueba. **Desde la reorientación del 26/09/2026** (`Analisis/41`
§6.3 y §12.10), los cambios incluidos son de configuración y su SLA de dos días
hábiles se cumple durante la obra, porque la configuración no está congelada:
el pase de un cliente ya no espera a F3 (H4 se parte por cliente).

De los pedidos abiertos al 25/09: los siete del audio de Bellido son
configuración o decisión del doctor salvo la lista de cuatro filas (topología,
espera F3); las decisiones de Platinum son comerciales y de Meta; Q'Taco y
Dhermacore pasan por el §12.3 antes de retomarse.
