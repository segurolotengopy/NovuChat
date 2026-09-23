# Guardar imágenes: la biblioteca del comercio y los medios que envía el cliente final

**22-sep-2026.** Andres pidió dos cosas: que el asistente pueda **responder con
imágenes**, y que se **guarden también las imágenes que envían los clientes
finales**. Este análisis dice qué implica cada una, qué se reutiliza, qué hay
que decidir antes de construir, y qué contrato cambia.

Escrito contra `main` `8510a0b`, con un relevamiento del repositorio con fuente
en cada afirmación.

**Lo segundo no es una función nueva sobre terreno neutro: revierte una
decisión escrita tres veces** (`admin/DISENO.md` §1900-1910 y §2686-2694,
`Flujos/LEEME-flujos.md` §558-561, `Analisis/34` §4.1). La decisión de Andres
manda; este documento la ejecuta con los recaudos que esa decisión exige.

---

## 0. Conclusión

| | |
|---|---|
| **Responder con imágenes** | **Se puede y conviene.** El camino de envío existe y está probado: el QR de la seña sale como `type: image` con enlace y caption. Falta el depósito de dónde sacarlas: una **biblioteca por comercio**. Unas **3 jornadas** |
| **Guardar lo que envía el cliente final** | **Se puede, pero no todo.** El clasificador ya etiqueta cada medio en cinco categorías. **Guardar por categoría**: comprobantes sí; fotos de boca o dientes y documentos de salud, **no por defecto**. Unas **3 jornadas**, más la purga |
| **Condición que no se negocia** | **La purga automática tiene que existir y estar desplegada antes de guardar el primer archivo.** Hoy no hay ninguna función programada que borre nada. Guardar medios sin purga es acumular datos ajenos sin fecha de vencimiento. **1 jornada** |
| **Lo que cambia en el contrato** | El anexo dice hoy que los medios **no se guardan**. Guardarlos **reduce un compromiso**, y por el §13.3 del propio anexo **eso exige el acuerdo del cliente**, no basta avisar |
| **Lo que cuesta** | El almacenamiento es despreciable. Lo caro es la custodia: un medio guardado es un dato personal más que proteger, y en una clínica muchos son datos de salud |

---

## 1. Lo que ya existe, y es más de lo que parece

- **Enviar una imagen ya funciona.** `Enviar QR de la seña` manda
  `type: 'image'` con `image.link` y `caption`, en los tres flujos de
  agendamiento. El Demo B prefiere el identificador de medio y cae al enlace.
- **Servir un PNG desde nuestro origen ya funciona**: la Function
  `imagenDeCobro` sirve el QR direccionado por una **ficha al azar de 128
  bits**, para que nadie pueda recorrer la cartera.
- **Validar un archivo subido ya funciona**: extensión, tamaño y **firma
  mágica** en el navegador (`archivoPlanes.ts`), y comprobación en el servidor
  sin guardar nada (`captacion.ts`).
- **Las reglas de Storage están desplegadas** desde `v0.5.4`, con identidad por
  claim, tenant en la ruta, `list: false`, negación final verificada en CI y
  una suite que prueba negando.
- **Comprimir en el navegador ya funciona**: `foto.ts` encoge a 900 px y
  convierte a WebP.
- **El clasificador de medios entrantes ya etiqueta** cada archivo con una
  lista cerrada: `publicidad | boca_o_dientes | comprobante |
  documento_salud | otro`.

**Lo que no existe:** una biblioteca de medios (ni pantalla, ni ruta, ni
concepto), el guardado del `mediaId` entrante, y **cualquier purga
automática**.

---

## 2. Responder con imágenes: la biblioteca del comercio

### 2.1 Qué es

Una carpeta por comercio con imágenes y PDF que **el comercio sube una vez**
—indicaciones previas, una promoción, un instructivo, un plano de cómo
llegar— y que el asistente envía cuando corresponde.

### 2.2 Las cuatro decisiones de diseño

**1. Quién elige qué imagen se manda.** El asistente **no elige libremente**.
Cada pieza de la biblioteca tiene una **clave** (`indicaciones-blanqueamiento`,
`como-llegar`) y el flujo la manda en puntos definidos, igual que el QR: el
servidor decide, no el modelo. Si se quisiera que el modelo la pida, lo hace
con una marca de una **lista cerrada** que el servidor valida contra las
claves existentes, como ya se hace con `[CONTACTO_RECEPCION]`. Nunca con una
URL escrita por el modelo.

**2. Enlace o identificador de medio.** El identificador de Meta dura 30 días
y **queda ligado al número que lo subió**, así que en multi-cliente no se
comparte y hay que refrescarlo. **Recomendación: enlace servido por una
Function propia** con ficha al azar, como el QR de cobro. Ventajas: se revoca
borrando, no se enumera, y no depende del calendario de Meta. El enlace de
descarga de Storage, en cambio, es una capacidad que no pasa por las reglas:
quien la tiene, lee.

**3. Cómo se sustituye el control de «nombres fijos».** Las reglas actuales
tienen un principio explícito: un camino por caso de uso, con nombres fijos, y
ninguna carpeta donde el comercio suba lo que quiera. Una biblioteca es
exactamente eso. La excepción se argumenta así, y va escrita en las reglas:
- el **nombre lo genera el servidor** (identificador al azar + extensión de
  una lista cerrada), no el comercio;
- **`list` sigue cerrado**: el índice de la biblioteca vive en Firestore, con
  las reglas de siempre, y Storage guarda solo los bytes;
- **tope por plan con contador**, como el del catálogo, o la biblioteca se
  vuelve una cuota sin dueño.

**4. Qué se acepta.** JPEG y PNG para enviar por WhatsApp (webp y gif sirven
para la web, no para un mensaje), hasta 5 MB, más PDF hasta 10 MB para
documentos. Validación por firma mágica, no por extensión. Y **moderación con
el modelo que muestra pero no bloquea**, como la del catálogo: un comercio que
sube algo impropio queda marcado para que una persona lo mire.

### 2.3 Lo que cuesta

Cada imagen enviada es **un mensaje**: 0,0113 USD. Por eso la regla de
`Analisis/34` sigue en pie: una foto de producto se manda por el enlace del
catálogo, que es gratis; un PDF de indicaciones **vale la pena solo si
reemplaza dos o tres mensajes de texto**. Cada pieza de la biblioteca declara,
en la pantalla, cuántos mensajes agrega.

---

## 3. Guardar lo que envía el cliente final

### 3.1 El problema, dicho sin vueltas

Quien escribe al asistente **no es cliente de NovuChat y no consintió nada
ante NovuChat**: consintió escribirle a una clínica. Hoy eso se resuelve no
guardando: el medio entra como binario, se lee, y de ahí sale texto. Guardarlo
convierte a NovuChat en custodio de archivos ajenos, y en una clínica **muchos
son datos de salud**.

### 3.2 La salida: guardar por categoría, no todo

El clasificador ya devuelve una de cinco etiquetas. Se guarda **según la
etiqueta**, y el criterio queda en el servidor:

| Categoría | ¿Se guarda? | Por qué | Retención |
|---|---|---|---|
| `comprobante` | **Sí** | Hay dinero de por medio: si el paciente reclama que pagó, el comercio necesita ver lo que llegó. Es la misma razón por la que la evidencia de un pago manual ya se guarda hoy | 12 meses, como las conversaciones |
| `publicidad`, `otro` | **Configurable por comercio**, apagado por defecto | Una captura de una promoción no es sensible, pero tampoco es necesaria | 90 días |
| `boca_o_dientes`, `documento_salud` | **No.** Solo si el comercio lo activa explícitamente **y** el paciente lo consiente en el chat | Son datos de salud de una persona que no es cliente de NovuChat | 30 días, y borrado a pedido |
| Audio | **No**, en ninguna categoría | La transcripción ya está en la conversación. La voz es un dato biométrico y no agrega nada que el texto no tenga | — |

**Guardar el derivado y no el original** sigue siendo la mejor opción donde
alcance: del QR se guarda el texto, del comprobante el JSON cotejado. La
categoría dice cuándo el original agrega algo que el derivado no.

### 3.3 Lo que hay que construir

1. **La ingesta guarda el `mediaId`**, que hoy el flujo tiene en memoria y
   tira.
2. **La descarga tiene que ser sincrónica con el mensaje**: la URL de Meta
   dura unos 5 minutos. Se baja con el token y se guarda en nuestro origen;
   nunca se guarda un enlace a Meta.
3. **Permisos por rol.** El operador atiende conversaciones; un comprobante de
   pago no es asunto suyo, igual que hoy la evidencia de pagos excluye al
   operador.
4. **Consentimiento en el chat** para las categorías de salud, con su registro.
5. **Purga automática**, sin la cual nada de esto se enciende.

---

## 4. La purga: de tarea pendiente a condición

La política existe desde el 07/09 —las conversaciones se borran a los 12 meses
del último mensaje— y **el código no existe**: no hay ninguna función
programada que borre. Además, la tabla de qué se borra **no menciona archivos**.

Antes de guardar el primer medio:

- escribir la función programada de purga, con su registro en la bitácora;
- **agregar los objetos de Storage a la tabla de retención**, con el plazo por
  categoría del §3.2;
- verificar en la máquina las tres condiciones que hoy están sin comprobar: el
  modo binario en disco, la poda de ejecuciones y que la credencial del modelo
  sea de nivel pago, porque en el nivel gratuito el contenido puede usarse para
  entrenar y por ahí viajan fotos de pacientes.

Es la tarea **P5** de `Analisis/37`, que pasa de «antes de firmar el anexo» a
**«antes de guardar nada»**.

---

## 5. Lo que cambia en el contrato, y por qué no basta con avisar

El anexo dice hoy: «**Qué no se guarda:** los audios, las imágenes y los
comprobantes que envían los clientes finales. Se leen para responder y se
descartan.»

Guardarlos **reduce un compromiso con el cliente**. El propio anexo, en su
§13.3, dice que una versión que reduce compromisos **requiere el acuerdo del
cliente**, y que sin ese acuerdo sigue rigiendo la versión anterior o el
cliente puede rescindir sin penalidad.

Entonces:

1. **Versión 2 del anexo**, con la cláusula nueva: qué se guarda, por
   categoría, cuánto tiempo, quién lo ve, y cómo se pide el borrado.
2. **Acuerdo escrito de cada cliente ya firmado.** Para una clínica, además,
   la cláusula de consentimiento del paciente.
3. **Mientras un cliente no acepte, para él no se guarda nada.** El criterio es
   por comercio, en el servidor, no una bandera global.

Esto no es burocracia: es exactamente lo que evita que el primer cliente se
entere de que guardamos fotos de sus pacientes leyendo un comunicado.

---

## 6. Amenazas nuevas, porque hoy no hay ninguna

El modelo de amenazas no tiene **ni una** entrada sobre archivos: cero
menciones a Storage en `admin/SEGURIDAD.md`. Con esto hay que agregar, como
mínimo:

| # | Amenaza | Control |
|---|---|---|
| Nueva | Un comercio lee medios de otro | Tenant en la ruta y claim, `list: false`, prueba negando |
| Nueva | Un enlace de medio filtrado da acceso sin sesión | Servir por Function con ficha al azar, revocable; nunca enlace de descarga directo |
| Nueva | Un comercio agota la cuota subiendo archivos | Contador y tope por plan |
| Nueva | El asistente reenvía a un cliente final algo que nadie miró | Moderación con el modelo al subir, y aviso en pantalla |
| Nueva | Un medio de salud guardado sin consentimiento | Guardado por categoría, apagado por defecto, purga corta |
| Nueva | Un archivo con contenido activo (SVG, HTML disfrazado) | Lista cerrada de tipos por firma mágica; SVG prohibido, como ya lo está el logo |

---

## 7. Esfuerzo y orden

| # | Qué | Jornadas |
|---|---|---|
| **1** | **Purga automática** y los objetos de Storage en la tabla de retención; verificar las tres condiciones de la máquina | 1,5 |
| 2 | Biblioteca: reglas nuevas con nombres generados, contador por plan, Function que sirve por ficha | 1 |
| 3 | Biblioteca: pantalla de la consola, con subida, moderación y el aviso de cuántos mensajes agrega cada pieza | 1 |
| 4 | Envío desde el flujo por clave, con la marca validada contra la lista cerrada | 0,5 |
| 5 | Guardado por categoría de lo entrante: `mediaId`, descarga sincrónica, permisos por rol | 1,5 |
| 6 | Consentimiento en el chat para las categorías de salud, y su registro | 0,5 |
| 7 | Amenazas, documentación, anexo versión 2 y el pedido de acuerdo a los clientes | 1 |
| | **Total** | **7 jornadas** |

**El orden importa.** El punto 1 va primero y solo; los puntos 2 a 4 (enviar)
se pueden hacer sin tocar nada de lo entrante; los puntos 5 y 6 **no se
encienden para ningún comercio hasta que ese comercio acepte la versión 2 del
anexo.**

---

## 8. Qué medir

- Cuántas piezas sube cada comercio y cuántas veces se envía cada una. Una
  biblioteca que nadie usa es cuota pagada.
- Mensajes que agrega cada pieza, contra los que ahorra.
- Cuántos medios entrantes cae en cada categoría. Si `otro` es la mayoría, el
  clasificador necesita revisión antes de que decida qué se guarda.
- Cuántos borrados a pedido llegan. Es la señal de si la política de retención
  quedó bien puesta.
