# Anexo técnico y SLA: qué se puede comprometer, con qué evidencia, y qué falta

**21-sep-2026.** Pedido de Andres: un anexo técnico y un acuerdo de nivel de
servicio **realista y conservador**, válido para cualquier cliente sin importar
sus flujos, y un anexo particular para el primer cliente clínico.

Se escribió contra `main` de hoy (`4aa6f3c`). Los hechos salen de dos
relevamientos del repositorio, con fuente en cada afirmación. `ESTADO.md` se
actualizó por última vez el 19/09 en la noche; lo del 20 y 21/09 solo consta en
commits.

**Entregables:**

- Este análisis.
- El anexo general: `docs/contrato/anexo-tecnico-sla.md`.
- El anexo particular de un cliente: vive en `CLIENTES/<CLIENTE>/`, que está en
  `.gitignore`. Lleva datos del comercio y **no va al repositorio público**.

---

## 0. Conclusión

**Hoy NovuChat no puede firmar un porcentaje de disponibilidad sin mentir.** No
porque el servicio se caiga mucho: nadie lo sabe, porque **la disponibilidad no
se mide**. Ningún incidente de los veinte registrados lo detectó un sistema;
todos los encontró una persona o una prueba.

Lo que sí se puede firmar desde el primer día, y es más valioso para una PyME
que un porcentaje:

1. **Tiempos de respuesta y de contención ante incidentes**, en horario hábil.
   Se miden con la hora del reporte y la de la contención. **Contener** es algo
   que el sistema ya sabe hacer en minutos: apagar el flujo
   (`publicar-flujo.sh`, #129) o suspender la atención automática con el
   mensaje neutro (`suspenderTenant`).
2. **Garantías por construcción**: lo que el código impide, no lo que el prompt
   pide. Por ejemplo, que no haya doble reserva cuando la herramienta de agendar
   se ejecutó, que los comercios estén aislados entre sí, que nunca se diga
   «pago acreditado» y que la conversación la cuente el servidor.
3. **Transparencia mensual**: consumo, incidentes y latencia, con datos que el
   comercio puede cotejar en su consola.

**El porcentaje de disponibilidad entra en una segunda fase**, cuando existan
tres cosas que hoy no existen: un monitor externo, una alerta de errores de
ejecución y el reinicio automático de n8n. Son unas **1,5 jornadas** (§5).
Entonces se compromete **98 % en horario cubierto**, con créditos en
conversaciones de bolsa.

Es la misma política que Andres fijó el 21/09 para el asistente —**solo se
ofrece lo que se cumple**— aplicada al contrato.

---

## 1. De qué depende el servicio, y qué está en nuestras manos

| Pieza | Quién la opera | Redundancia | Si falla |
|---|---|---|---|
| Canal de WhatsApp (Cloud API) | Meta | La de Meta | No entra ni sale nada. Fuera de nuestro control |
| n8n (flujos de todos los clientes) | NovuChat | **Ninguna: una sola VM** (OCI, ARM 2 OCPU) compartida con otros productos, sin reinicio automático documentado ni infraestructura versionada | **Ningún cliente recibe respuesta y nadie se entera** (no hay monitor). Un reinicio borra la memoria de todas las conversaciones abiertas (`memoryBufferWindow`) |
| Functions y Firestore (consola, ingesta, configuración) | Google, desplegado por NovuChat | La de Google; `minInstances: 1` en las dos funciones del camino del mensaje | Con la configuración caída, el flujo sigue con su respaldo. Con la ingesta caída, responde igual y no cuenta esos mensajes |
| Modelo de IA (Gemini) | Google | 3 reintentos | Mensaje fijo de error y botón de recepción (desde el 21/09) |
| Google Calendar | Google | 2 intentos en la verificación | **El candado cierra**: avisa que la cita no quedó registrada y transfiere (#113). Nunca afirma una cita que no pudo verificar |
| Cobro por QR (seña del comercio) | El banco del comercio | — | El comprobante se coteja; el pago lo confirma el comercio. NovuChat nunca dice «acreditado» |

**Consecuencia para el SLA:** lo único con redundancia cero y bajo nuestro
control es la VM de n8n. Todo el compromiso de disponibilidad depende de
detectar su caída y de levantarla rápido. Hoy no se detecta y no se levanta
sola.

---

## 2. La evidencia, resumida

### 2.1 Lo que existe

- **Despliegue con compuerta.** Etiqueta sobre `main`, aprobación en el
  Environment `production`, seis minutos de punta a punta. Hosting se revierte
  solo; Functions y reglas, con `git revert` y una etiqueta nueva.
- **Respaldo diario de la VM** a Object Storage, con 180 días de retención.
  **Nunca se probó restaurarlo** y el script no está versionado.
- **Aislamiento entre comercios** probado negando (`reglas.test.ts`,
  164/164 en el último registro).
- **La latencia está instrumentada** (`latenciaMs` en la bitácora), pero no se
  agrega en ningún lado.
- **Mecanismos de contención:** encender o apagar un flujo
  (`publicar-flujo.sh`), suspender un comercio (`suspenderTenant`, sin
  pantalla), y los umbrales de uso extendido 50/100 por empresa.

### 2.2 Lo que no existe

| Hueco | Por qué impide prometer |
|---|---|
| Monitor de disponibilidad | Sin medición no hay porcentaje, ni crédito, ni aviso al cliente |
| Alerta de errores de ejecución (ningún flujo tiene `errorWorkflow`) | Un envío rechazado por Meta solo se ve entrando a n8n |
| Reinicio automático y VM versionada | Una caída del viernes a las 19:00 dura hasta que alguien la ve |
| Respaldo de Firestore (sin export ni PITR); restauración de la VM nunca probada | No hay RPO ni RTO que se puedan firmar |
| Staging (ni consola ni n8n) | Los flujos se prueban en producción, con teléfonos reales |
| Guardia fuera de horario; horario de soporte definido | Somos dos personas |
| Purga de 12 meses (decidida el 07/09, sin código) | No se puede prometer que un dato se borra a los 12 meses |
| Modo binario en disco y poda de ejecuciones en la VM, sin verificar | «Los audios y comprobantes no se guardan» depende de esa configuración |
| Límite de agendas por plan en el servidor | El plan promete un número que el servidor no hace cumplir |
| «No niega ser IA» en los flujos de agenda | Es solo prompt; el corrector existe en Demo B y onboarding, no en agenda |
| Registro de la publicación de los arreglos del 20 y 21/09 | No consta qué versión del flujo corre para cada cliente |

### 2.3 Los incidentes, en una cifra

Hay **20 incidentes o defectos en producción entre el 28/08 y el 21/09**. Todos
se corrigieron. **Ninguno lo detectó un sistema**, y **ninguno tiene su
duración registrada.** Es un proyecto que tiene un mes, y la tendencia es la
esperable: los primeros eran de arquitectura, como un cliente que recibía la
respuesta de otro o un token que caducaba; los últimos son de conversación, como
el modelo que ignora una instrucción o una cancelación sin confirmar. Por eso el
compromiso se apoya en **contener rápido**, no en «no fallar».

### 2.4 Latencia

La única medición válida es de **5 turnos del 29/08**, con 1 calendario: p50 de
unos 3,8 s y peor caso de 5,3 s. Con 3 calendarios se midió de 1,6 a 5,6 s. No
hay mediciones de los clientes actuales, ni de audio (se estiman 2 a 4 s más),
ni de 7 agendas. **No se compromete una cifra con crédito**: se informa
mensualmente contra un objetivo.

---

## 3. Qué se compromete, y por qué cada número

### 3.1 Horario cubierto

**Lunes a viernes de 09:00 a 19:00 y sábados de 09:00 a 13:00, hora de
Bolivia**, sin feriados nacionales. Son unas **234 horas al mes**. Fuera de ese
horario, **mejor esfuerzo**: el asistente sigue atendiendo, pero nadie se
compromete a reaccionar.

¿Por qué no 24/7? Porque son dos personas y no hay guardia. Prometer 24/7
sin guardia es la promesa que más rápido se rompe, y la que más daña cuando se
rompe.

### 3.2 Incidentes: acuse, contención, solución

| Severidad | Definición | Acuse | **Contención** | Solución o plan escrito |
|---|---|---|---|---|
| **1 · Crítica** | El asistente no responde a nadie; responde mal a todos; **riesgo de doble reserva, de cobro mal presentado o de datos de otro comercio** | 2 h hábiles | **4 h hábiles** | 2 días hábiles |
| **2 · Alta** | Una capacidad falla y el resto funciona (recordatorios, seña, lectura de audio, consola) | 4 h hábiles | 1 día hábil | 3 días hábiles |
| **3 · Normal** | Textos, configuración, consultas, mejoras | 1 día hábil | — | 5 días hábiles |

**Contener** significa dejar de hacer daño, no arreglar: apagar el flujo,
suspender la atención automática con el mensaje neutro, o bajar el umbral de
derivación para que todo pase a recepción. Los tres mecanismos existen y
tardan minutos. Por eso las 4 h hábiles son conservadoras aun con dos
personas.

**Se mide desde el reporte del cliente** por el canal oficial, o desde que
NovuChat lo detecta, lo que ocurra primero.

### 3.3 Disponibilidad: dos fases

- **Fase inicial**, desde la firma hasta que existan los prerrequisitos P1 a P3
  (§5): **no hay porcentaje comprometido.** Rigen los tiempos del §3.2 y el
  informe mensual. Se dice así en el anexo, no se esconde.
- **Fase medida**, desde el mes siguiente a la activación del monitor:
  **98 % mensual dentro del horario cubierto.** Equivale a unas **4,7 horas**
  de caída admitida sobre 234 horas.

¿Por qué 98 % y solo en horario cubierto? Con una sola VM, sin réplica, la
recuperación depende de que alguien actúe. En horario cubierto, con alerta al
teléfono y reinicio automático, 4,7 h al mes es holgado. Fuera de horario, una
caída del viernes a la noche puede durar hasta el lunes: medirla contra el
SLA sería firmar algo que la arquitectura no sostiene.

**Qué cuenta como «disponible»:** el monitor externo recibe respuesta de n8n y
de `configuracionFlujo`. **No cuenta como caída:** una caída de Meta, Google
Calendar o el proveedor del modelo; el mantenimiento anunciado; lo que el
cliente cambió en su consola; ni un número restringido por Meta.

### 3.4 Créditos

Se pagan en **conversaciones de bolsa** (valor de lista: USD 10 por 30), nunca
en dinero. Así el crédito vale para el cliente y le cuesta poco a NovuChat: una
conversación de bolsa cuesta, en promedio, un tercio de su precio.

| Evento | Crédito, en % de la mensualidad convertido a bolsa |
|---|---|
| Disponibilidad entre 95 % y 98 % | 10 % |
| Disponibilidad entre 90 % y 95 % | 25 % |
| Disponibilidad debajo de 90 % | 50 %, y derecho a rescindir sin penalidad |
| Contención de severidad 1 fuera de plazo | 10 % por incidente |
| **Tope mensual** | **50 % de la mensualidad** |

El crédito por contención **rige desde el primer día**, porque se mide con dos
horas que ya existen: la del reporte y la de la contención. El de
disponibilidad, solo en la fase medida.

### 3.5 Latencia: objetivo, no compromiso

**Objetivo: p90 ≤ 10 s por respuesta de texto; con audio o imagen, p90 ≤ 15 s.**
Se informa cada mes y **no genera crédito**. Motivo: la mitad del tiempo es del
modelo y de Google Calendar, y solo hay cinco mediciones. Pasará a compromiso
cuando haya tres meses de datos agregados.

### 3.6 Cambios

- **Lo que el comercio cambia en su consola** (precios, horarios, catálogo,
  comportamiento del asistente verificado) llega en el mensaje siguiente, en
  menos de un minuto: la configuración se cachea 60 s. Es inmediato por
  construcción.
- **Lo que opera NovuChat** (textos del flujo, capacidades nuevas, parámetros
  sin pantalla) se resuelve en **2 días hábiles** desde el pedido completo. Los
  cambios de flujo se publican desde `main`, se prueban con un teléfono real y
  aplican a todos los clientes de ese vertical a la vez (`Analisis/20`).
- **Mantenimiento:** se anuncia con 24 h de anticipación y se hace fuera del
  horario cubierto. Un arreglo de seguridad urgente puede hacerse en cualquier
  momento, con aviso.

### 3.7 Garantías por construcción

Son el corazón del anexo: lo que el código hace cumplir, con su prueba.

| Garantía | Condición honesta |
|---|---|
| **Sin doble reserva**: si se ejecutó `agendar_cita`, se verifica en el calendario y un cruce se deshace | Revisa hasta 50 eventos por calendario. Si el calendario no responde, **no se registra la cita** y se transfiere |
| **Aislamiento entre comercios** | Ningún comercio ve ni modifica lo de otro; se prueba negando en cada cambio de reglas |
| **Nunca «pago acreditado»** | El comprobante se coteja; el pago lo confirma el comercio con su banco |
| **La conversación la cuenta el servidor**, con la definición del contrato, y el comercio la ve en su consola | La ingesta caída unos minutos deja mensajes sin contar: **a favor del cliente**, nunca en contra |
| **El comportamiento del asistente escrito por el comercio se verifica antes de aplicarse** | Lo que no pasa la verificación no llega al asistente |
| **Techo de costo por conversación desbocada** (umbrales 50/100) | Parametrizable por empresa |
| **Ante un error o una consulta sin respuesta, el asistente pasa con recepción** (aviso y botón) | Desde el 21/09. La recepción la atiende el comercio |

«**No niega ser una IA**» se declara como **instrucción del asistente**, no
como garantía, hasta que el corrector de Demo B llegue a los flujos de agenda
(P7).

### 3.8 Datos

- **Se guardan:** los mensajes de texto de la conversación, las citas y los
  eventos de la bitácora sin texto.
- **No se guardan:** audios, imágenes ni comprobantes. **Condición:** verificar
  el modo binario y la poda en la VM (P5) antes de firmarlo.
- **Retención:** mientras dure el contrato. **Al terminar**, el borrado se hace
  a pedido en 30 días hábiles, con constancia escrita. **No se promete** la
  purga automática de 12 meses hasta que exista su código (P5).
- **Respaldo:** no se compromete RPO ni RTO hasta P4. Lo que sí se compromete:
  la configuración del asistente está versionada y se puede reconstruir.

### 3.9 Lo que queda fuera del SLA

La disponibilidad y las decisiones de Meta: caídas, restricciones del número,
calificación de calidad, rechazo de plantillas y cambios de tarifa. También
Google Calendar, el proveedor del modelo y el banco. La exactitud de los datos
que carga el comercio. El contenido comercial o clínico que el comercio
aprueba. La atención de recepción. Y el uso más allá de los umbrales.

**Sobre la IA:** un asistente con un modelo de lenguaje **puede equivocarse al
redactar**. Lo que se compromete no es que nunca se equivoque. Es que no puede
hacer lo que el código impide, que transfiere lo que no sabe, y que un error
reportado se contiene en los plazos del §3.2.

### 3.10 Obligaciones del cliente

Estas cosas sostienen el servicio y no dependen de NovuChat:

- Entregar por escrito los datos del negocio y confirmar los supuestos.
- Mantener compartidos los calendarios.
- Tener recepción atendiendo las transferencias en su horario.
- Verificar los pagos en su banco.
- No instalar WhatsApp en el número del asistente.
- Avisar con 48 h los cambios de horario o de precios que no haga él mismo en
  la consola.
- Usar el canal oficial para reportar.

### 3.11 Informe mensual

Se entrega los primeros 5 días hábiles del mes, con estos datos:

- Conversaciones y bloques adicionales.
- Mensajes del asistente contra la franquicia de Meta.
- Avisos de consumo, derivaciones a operador y bloqueos.
- Incidentes, con sus tiempos.
- Latencia p50 y p90 (cuando se agregue).
- Disponibilidad (en fase medida).

Casi todo ya se escribe en la ingesta. Falta agregar la latencia.

---

## 4. Lo publicado que contradice este SLA

La política del 21/09 dice que una promesa sin respaldo se cumple o se quita.
Estas cuatro no tienen respaldo operativo:

| Dónde | Dice | Cambiar a |
|---|---|---|
| Presentación y resumen ejecutivo | «Asistente IA 24/7», «atiende 24 horas» | «Responde a toda hora; el soporte de NovuChat, en horario hábil» |
| Guion de la presentación | «nunca duerme», «su recepcionista recibe el aviso **al instante**» | El aviso depende de una plantilla o de que recepción haya escrito en 24 h: «recibe un aviso» |
| `atencion.ts`, `MENSAJE_USO_EXTENDIDO` | «una persona del equipo va a continuar esta conversación **en breve**» | Sin plazo: «una persona del equipo va a continuar esta conversación». **Es un texto que ven los clientes finales** |
| «Instalación en 48 horas» | Condicionada en `Analisis/13` a que la ficha esté completa | Decirlo con la condición, como `Analisis/13` |

---

## 5. Prerrequisitos, en orden

| # | Qué | Desbloquea | Esfuerzo |
|---|---|---|---|
| **P1** | Monitor externo de n8n (`/healthz`) y de `configuracionFlujo` cada 5 min, con alerta al teléfono | La fase medida | ½ jornada |
| **P2** | Flujo de errores de n8n (`errorWorkflow` en todos los flujos) que avisa por correo | Detectar lo que hoy no se ve | ½ jornada |
| **P3** | Política de reinicio de los contenedores de n8n y la VM versionada. **Solo los contenedores de n8n**: la VM aloja otros productos que no se tocan (prohibición 5) | La fase medida | ½ jornada |
| **P4** | Export diario de Firestore; prueba de restauración de Firestore y de la VM | Poder firmar RPO y RTO | 1 jornada |
| **P5** | Purga de 12 meses; verificar el modo binario y la poda en la VM | Las promesas de datos | 1 jornada |
| **P6** | Registrar en `ESTADO.md` qué versión del flujo corre para cada cliente | Saber qué se está garantizando | ½ hora |
| **P7** | Corrector «no niega ser IA» en los flujos de agenda | Pasar de instrucción a garantía | ½ jornada |
| **P8** | Quitar «en breve» y las promesas del §4 | Coherencia con el contrato | ½ hora |
| **P9** | Agregar la latencia por mes | El informe | ½ jornada |

**P1 a P3 suman 1,5 jornadas** y convierten la fase inicial en fase medida.
**Todo junto, unas 5 jornadas.** Nada de esto cambia la conversación ni agrega
mensajes. P3 y P5 tocan la VM de producción: van con OK de Andres, **después
del demo** y fuera del horario cubierto.

---

## 6. Qué medir para endurecer el SLA dentro de tres meses

- Disponibilidad en horario cubierto y fuera de él. Si fuera de horario se
  mantiene alta, se puede discutir extender la cobertura.
- Tiempo real de contención de cada incidente de severidad 1.
- Latencia p90 por vertical y por tipo de entrada.
- Incidentes por mes y quién los detectó. **El objetivo es que el monitor
  detecte antes que el cliente.**
