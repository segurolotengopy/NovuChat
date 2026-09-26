# Central: lo que todo comercio ve igual

> Zona de la arquitectura por capas (`Analisis/41-arquitectura-por-capas.md`
> §1). Manifiesto en prosa de la zona y destino de las secciones de
> `admin/DISENO.md` que le pertenecen; el mapa está en `indice.md`. Sin
> secretos ni identificadores.

## Definición

**Lo que todo comercio ve igual en su consola y en su cuenta, independiente de
qué módulos tenga.** La cambia NovuChat.

Ejemplos: Tablero, Configuración del asistente, Conversaciones, Usuarios,
Contactos, Consumo, Cuenta, Pagar, Reclamos, Bitácora, Mi cuenta. Planes,
modalidad, prepago, tipo de cambio, comportamiento verificado, saneo.

**La prueba de ubicación** (`Analisis/41` §1.3): es central lo que responde «sí»
a «¿lo ve todo comercio en su consola o su cuenta, tenga los módulos que
tenga?». Las tres piezas de hoy que responden «sí» a dos preguntas y se parten:
`Tablero.tsx` (central, pero cuenta agendas y catálogo), `Configuracion.tsx`
(central, pero tiene el calendario y el catálogo web) y `Catalogo.tsx` (módulo
Productos, pero tiene duración de cita, vista previa y stock).

**Dependencias permitidas:** Central depende solo de Core. Los módulos pueden
usar sus servicios (planes, tipo de cambio, saneo, comportamiento).

**Vocabulario fijado el 25/09:** *Pagar* es NovuChat cobrando al comercio
(prepago, pagos, cobrador, cobranza) y vive acá; *Cobros* es el comercio
cobrando a su cliente y es un módulo. **Nunca se llama «Cobros»** a lo de esta
zona. *Producción* reemplaza a *prepago* en la consola; el código puede
conservar el nombre.

## Los tres ejes de la cuenta (`Analisis/41` §4)

Son independientes, los tres son datos, y los dos primeros viven en Central:

| Eje | Decide | Vive en |
|---|---|---|
| **Plan** | Qué contrató el comercio: precio en USD, módulos encendidos y el límite de cada uno | `cuenta/estado.plan` + la copia `cuenta/estado.limites` (lo que se hace cumplir) |
| **Modalidad** | La relación con el pago: demostración (nunca se corta, sin costo), prueba (período gratis), producción (prepago con corte) | `cuenta/estado.modalidad`, `estadoDeServicio` en `prepago.ts` |
| **Titularidad del canal** | De quién es la WABA, quién paga Meta, de quién es la franquicia | `rutasWhatsApp/{n}.titularidad` (core, conector de canal) |

Demostración deja de ser plan; BYOC deja de ser plan (es titularidad `comercio`
más un plan). Hay límites que no son de ningún módulo y son de Central: los
**cambios de configuración incluidos al mes** (`cambiosIncluidos`) con su
contador.

## Inventario: qué es central hoy y adónde va (`Analisis/41` §5)

| Pieza | Va a | Nota |
|---|---|---|
| `saneo.ts`, `tipoCambio.ts`, `tipoCambioBcb.ts` | `functions/src/central/servicios/` | Servicios, no módulos |
| `planes.ts`, `prepago.ts` | `central/cuenta/` | Los límites pasan a claves declaradas por cada módulo |
| `pagos.ts`, `pagosConCobrador.ts`, `cobroPrepago.ts`, `cobrador.ts`, `cobranza.ts` | `central/pagar/` | NovuChat cobra al comercio |
| `comportamiento.ts`, `verificarComportamiento.ts` | `central/asistente/` | Pseudo-prompt verificado |
| `mapa.ts` | `central/negocio/` | |
| `reclamos.ts` | `central/reclamos/` | |
| `index.ts` (invitar y quitar usuario) | `central/usuarios.ts` | La parte de alta, baja, suspensión y número va a Plataforma |
| `config/negocio` | Documento de Central, dato del tenant | Sale `calendarioId` hacia `config/agenda` |
| `contactos`, `reclamos`, `bitacora`, `auditoria`, `miembros`, `invitaciones`, `usuarios`, `cuenta/estado`, `pagos` | Central | `plan: 'demostracion'` se migra a `modalidad: 'demostracion'` |
| Storage `pagos/` | Central | |
| `Ingresar`, `MiCuenta`, `Usuarios`, `Contactos`, `Conversaciones`, `Consumo`, `EstadoCuenta`, `Pagar`, `Reclamos`, `Bitacora` (del negocio) | `web/src/central/paginas/` | `EstadoCuenta` y `Pagar` muestran plan, modalidad y titularidad por separado |
| `Tablero` | `central/paginas/` | Deja de contar agendas y catálogo: cada módulo aporta su ranura |
| `Configuracion` | `central/paginas/` | Sale el calendario (a Agenda) y el catálogo web y el logo (a Catálogo web) |
| `ConfiguracionVertical` | `central/componentes/ConfiguracionModulo` | Pasa a leer la tabla de campos del manifiesto |
| `lib/planes.ts`, `prepago.ts`, `atencion.ts`, `pagar.ts`, `cuenta.ts`, `bitacora.ts` | `central/lib/` | Reexportaciones de Functions |

## Lo que la consola tiene que mostrar (base comercial §4)

Mensajes del asistente en el mes contra los 1.000 gratis del número; mensajes
por conversación como distribución y no como promedio; precio en dólares y el
importe en bolivianos del mes en curso. Detalle en `docs/base-comercial.md`.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4bis (25/09/2026, líneas 348-352) -->

## 4bis. Control administrativo del comercio

Cuatro requisitos que Andres definió después del andamiaje inicial. Van juntos
porque los cuatro tocan la ficha del comercio.


<!-- movido de admin/DISENO.md §4bis.1 (25/09/2026, líneas 353-397) -->

### 4bis.1 Personas de referencia del comercio

No confundir con `/miembros`, que son **usuarios del panel**. Las personas de
referencia son los contactos del negocio —el dueño, quien atiende recepción,
quien factura— que en general **no tienen acceso al panel** y muchas veces ni
saben que están anotadas.

**Van en subcolección propia, `/tenants/{t}/contactos/{id}`**, por el mismo
motivo que los datos ampliados de las conversaciones: las reglas de Firestore
**no pueden ocultar campos sueltos en una lectura**. Si estos datos fueran campos
de la ficha del tenant, cualquiera que pueda leer la ficha —incluido el
operador— vería el teléfono del contador. Lo que un rol no debe ver va en otro
documento, no en otro campo.

Quién entra:

| | Ve | Edita |
|---|---|---|
| Admin del negocio | toda la agenda | sí |
| Operador | **nada** | no |
| NovuChat | **solo el marcado `esContactoComercial`** | no |
| NovuChat con acceso de soporte vigente | toda la agenda | no |
| Ingesta (n8n) | nada | no |

Tres decisiones que conviene justificar:

- **El operador queda afuera por completo.** Atender conversaciones no requiere
  el teléfono del contador del negocio. Es mínimo privilegio sin la excepción
  cómoda de "total, es de la misma empresa".
- **NovuChat ve un solo contacto.** Necesita a quién llamar por la factura, y
  nada más. El resto de la agenda exige un acceso de soporte, igual que las
  conversaciones. La casilla en la interfaz lo dice con todas las letras, para
  que el comercio sepa exactamente qué está compartiendo.
- **`rolNegocio` es una lista cerrada** (`dueno`, `recepcion`, `facturacion`,
  `tecnico`, `otro`) y las notas tienen un tope de 500 caracteres. Sin eso, este
  campo se convierte en el cajón de sastre donde termina cayendo información
  personal que nadie previó guardar y que después hay que responder si alguien
  la reclama.

**⚠️ Nota sobre `list`.** Para que NovuChat pueda *listar* los contactos
comerciales, su consulta tiene que traer `where('esContactoComercial','==',true)`.
Las reglas de Firestore no filtran resultados: si la consulta no trae esa
restricción, **falla entera**. Eso es deliberado — el modo de fallar es negar,
nunca devolver de más— y está cubierto por una prueba específica.


<!-- movido de admin/DISENO.md §4bis.2 (25/09/2026, líneas 398-450) -->

### 4bis.2 Contador de personas atendidas (únicos)

**El problema.** `FieldValue.increment(1)` cuenta mensajes, no personas. Una
persona que escribe treinta veces en el mes sumaría treinta. "Personas
atendidas" es un conteo de **únicos** y un contador incremental no puede
deduplicar.

**La opción que se descartó, y por qué.** La solución de manual es un conjunto de
hashes de teléfono por período (`/metricas/{p}/vistos/{hash}`). Se descartó por
dos motivos:

1. **Privacidad. Un hash de teléfono no es anonimización.** El espacio de números
   bolivianos es del orden de 10⁸: enumerarlo entero y comparar hashes es
   cuestión de segundos en una laptop. Sin sal secreta, ese conjunto es una
   segunda copia de los teléfonos, disfrazada de dato técnico. Y con sal secreta
   hay que custodiar y rotar la sal, o sea otro secreto más en la matriz.
2. **Costo y basura.** Crea un documento por persona y por mes que después hay
   que purgar.

**La opción elegida.** Se aprovecha que el documento de la conversación **ya
está indexado por teléfono** (`wa_<telefono>`) y **ya se escribe en cada
mensaje**. Se le agrega un campo `periodoContado`. Si el período que trae no es
el actual, esa persona todavía no fue contada este mes: se incrementa
`personasAtendidas` y se actualiza la marca. Todo dentro de una transacción, para
que dos mensajes simultáneos de la misma persona no la cuenten dos veces.

**No se crea ningún registro nuevo de teléfonos.** Es minimización de datos: se
reutiliza el identificador personal que ya existía en vez de sembrar una segunda
copia en la colección de métricas.

**Costo en Firestore, por mensaje entrante:**

| | Costo |
|---|---|
| Lecturas | **+1** (el documento de la conversación, dentro de la transacción) |
| Escrituras, caso común | **+0** — la conversación ya se escribía; solo se le agrega un campo |
| Escrituras, primera vez de esa persona en el mes | **+1** (el documento de métricas) |

Para un comercio con 500 mensajes al mes de 80 personas distintas: **500 lecturas
y 80 escrituras extra al mes**. A la tarifa de Firestore eso es del orden de una
milésima de dólar. El conteo exacto sale prácticamente gratis.

**Quién puede tocarlo.** `periodoContado` está en la lista blanca de campos que
escribe **solo la ingesta**, y no está entre los campos de gestión interna que
puede tocar una persona del negocio. Nadie puede borrar la marca para volver a
contar a la misma persona, ni al revés. **La métrica tiene que ser inmanipulable
por quien la paga y por quien la cobra**, y por eso `/metricas` también es de
solo lectura para el propietario de NovuChat.

**Recuento.** Si hay que recalcular un período —una corrección, una disputa de
factura— se recorre `/conversaciones` filtrando por `ultimoEn` dentro del mes. Es
caro pero puntual, y no exige haber guardado ninguna estructura extra.


<!-- movido de admin/DISENO.md §4bis.2bis (25/09/2026, líneas 451-496) -->

### 4bis.2bis Atenciones e interacciones

Las otras dos cifras de la oferta comercial. Las definiciones son las de la
cabecera de `web/src/paginas/Cierres.tsx` y no se reinterpretan en ningún lado:

| Cifra | Definición | Cuándo suma |
|---|---|---|
| **Atención** | una conversación iniciada con un cliente, haya terminado bien o no | al primer mensaje del período en esa conversación |
| **Interacción** | una conversación en la que el cliente recibió **más de una** respuesta | al llegar a la **segunda** respuesta saliente del período |

**El problema es el mismo de §4bis.2 y la solución también.** `increment(1)`
cuenta mensajes, no conversaciones: sin deduplicar, una consulta de ocho idas y
vueltas se facturaría como ocho interacciones. Se usan marcas en el documento de
la conversación, que la transacción de la ingesta **ya lee y ya escribe**, así
que las dos cifras nuevas no cuestan ni una lectura ni una escritura extra:

| Campo | Para qué |
|---|---|
| `periodoContado` | ya existía; ahora decide también la atención |
| `respuestasDelPeriodo` | respuestas salientes acumuladas en el mes. Vuelve a cero al cambiar de período |
| `periodoInteraccion` | período en que esta conversación ya sumó su interacción |

**Por qué el contador se calcula y no se incrementa.** Dentro de la transacción
el valor leído es el que vale; calcularlo garantiza que el número guardado y la
decisión que se tomó con él no puedan discrepar. Y **todo ocurre en la misma
transacción que ya existía**: si se escribiera la marca y fallara el contador, la
conversación quedaría contada y la cifra que se factura no.

**Por qué `personasAtendidas` y `atenciones` comparten `periodoContado`.** Hoy
disparan con el mismo hecho, porque el identificador de la conversación **es** el
teléfono (`wa_<telefono>`): una persona y una conversación son la misma cosa. Dos
marcas con el mismo valor solo podrían desincronizarse. Si alguna vez una persona
pudiera tener más de una conversación abierta, las dos cifras dejarían de
coincidir y ahí sí harían falta dos marcas.

**La decisión de contar es una función pura**, `contadoresDelMensaje` en
`functions/src/ingesta.ts`. Sobre estas cifras se factura y lo único que puede
equivocarse es esa decisión: aislada de Firestore se prueba el mes entero mensaje
por mensaje, sin emulador ni red. Las pruebas que sostienen la factura son las de
**cobrar de más**: la segunda conversación del mismo cliente en el mes no suma
otra atención, y la tercera y la cuarta respuesta no suman otra interacción.

**Quién puede tocarlo.** Los dos campos nuevos están en la lista blanca de
`conversacionValida()` y **fuera** de los campos de gestión interna, igual que
`periodoContado`. Ni el comercio ni NovuChat pueden mover la marca.


<!-- movido de admin/DISENO.md §4ter.2 (25/09/2026, líneas 735-776) -->

### 4ter.2 Estado de cuenta visible para el comercio

`/tenants/{t}/cuenta/estado`: plan, situación de pago, monto, próximo
vencimiento y `motivoVisible`. Desde el 15/09, además, la **copia de los
límites** del plan (`limites`: conversaciones, productos, agendas) y la versión
del catálogo con que se asignó (`catalogoPlanes`), y el aviso de consumo del mes
(`avisoConsumo`).

- **El catálogo de planes vive en código** (`functions/src/planes.ts`: Impulso,
  Crecimiento, Pro y el interno `demostracion`); el plan de cada comercio vive
  acá, con su copia. **Quien hace cumplir un límite lee la copia**, no el
  catálogo de hoy: las reglas (productos del catálogo, con el contador
  `contadores/catalogo`), `importarCatalogo` y la ingesta (aviso al 80 %) usan
  la misma función, `limitesDeCuenta`. Sin copia rige el plan; con un plan que
  no es del catálogo (el viejo `'basico'`), el más chico. `tenants/{t}.plan` es
  solo un espejo para la cartera: ningún límite lo lee.
- El alta (`altaTenant`, `alta-comercio.mjs`) deja Impulso con su copia y el
  contador en 0; el plan se cambia con `actualizarEstadoCuenta` o
  `scripts/asignar-plan.mjs`, que escriben plan, copia, espejo y auditoría en
  una transacción.

- **Solo lectura para el comercio.** Lo escribe NovuChat con
  `actualizarEstadoCuenta`, y queda auditado. Si el comercio pudiera escribirlo
  se pondría "al día" y el documento dejaría de significar nada.
- **Lo lee el admin, no el operador.** La situación financiera del negocio no es
  asunto de quien atiende el chat.
- **Se lee con `tenantLegible`, no con `tenantOperativo`**, así que **un comercio
  suspendido sigue viendo esta pantalla**. Es la coherencia que faltaba: si el
  comercio conserva la vista de sus datos, tiene que ver también *por qué* se le
  cortó el servicio. Un corte sin explicación visible es una llamada de reclamo
  garantizada.
- `suspenderTenant` y `reactivarTenant` escriben acá además de en la ficha, para
  que las dos pantallas no puedan contradecirse.

**Tres textos, tres públicos. No confundirlos:**

| Campo | Quién lo lee | Qué dice |
|---|---|---|
| `cuenta.motivoVisible` | el **comercio**, en el panel | su situación. Es su relación comercial y tiene derecho a conocerla |
| `tenant.motivoSuspension` | **NovuChat**, auditoría | el registro interno |
| `mensajeCortesia` | el **cliente final** por WhatsApp | neutro. **Jamás menciona pagos** (T-18) |


<!-- movido de admin/DISENO.md §4ter.3 (25/09/2026, líneas 777-791) -->

### 4ter.3 Contador de personas atendidas, visible para el comercio

La pantalla de Uso muestra `personasAtendidas` por mes, junto con mensajes y
citas. El conteo de únicos ya estaba diseñado (§4bis.2); lo nuevo es exponerlo.

**Un defecto real que apareció al probarlo:** la consulta original usaba
`orderBy('__name__', 'desc')` y **Firestore no lo admite** — *"does not support
descending key scans"*. Habría fallado en producción la primera vez que alguien
abriera la pantalla. Se reemplazó por la lista explícita de los últimos doce
períodos con `where(documentId(), 'in', [...])` —el tope de `in` es 30— y el
orden se hace en el cliente. Una sola ida y vuelta, sin índice compuesto.

Nadie escribe `/metricas` desde el navegador, **ni el comercio ni NovuChat**: la
métrica que se factura no la toca ninguna de las dos partes interesadas.


<!-- movido de admin/DISENO.md §4ter.4 (25/09/2026, líneas 792-905) -->

### 4ter.4 Reclamos que llegan por correo

`/tenants/{t}/reclamos/{id}`. El comercio crea y lee; **nadie edita ni borra**.
Un reclamo editable no sirve para dirimir nada.

**Se guarda primero y se avisa después.** Un disparador `onDocumentCreated`
manda el correo. Si el proveedor está caído, el reclamo no se pierde: queda en
Firestore y se ve en el panel de NovuChat igual. **El correo es una
notificación, no el registro.** La columna "Aviso" de la pantalla muestra si el
correo salió; sin ella, un canal de correo caído sería invisible durante semanas.

**Un comercio suspendido puede reclamar.** Sería absurdo cortarle el canal justo
cuando tiene el motivo más probable para usarlo.

#### El texto no puede llegar como marcado, y eso se garantiza en origen

Un correo HTML con el texto del reclamo interpolado es **inyección de HTML
directa**: enlaces de phishing que parecen de NovuChat, imágenes remotas que
confirman lectura, CSS que oculta contenido para que el destinatario lea una cosa
distinta de la que está escrita.

El argumento no cambió con el proveedor; **el lugar donde se aplica, sí**. Con
Resend bastaba mandar `text` y omitir `html`. Con FormSubmit el correo lo compone
el tercero, así que el texto sale ya **escapado desde acá** (ver «Lo que SÍ
cambia», más abajo).

Además: el **asunto se limpia de CR, LF y NUL** antes de usarse. Un salto de
línea en un asunto permite inyectar encabezados propios —un `Bcc:` hacia otra
casilla— y desviar una copia del correo. Es un ataque viejo que sigue
funcionando, y tiene prueba propia en `pruebas/saneo.test.ts`.

#### Proveedor de correo: FormSubmit por ahora, Resend después

**Decisión de Andres (2026-08-29): FormSubmit.**

El motivo es de calendario y de superficie. Faltan diez días para el
congelamiento del 8 de septiembre, los reclamos son **internos** —los leen solo
Andres y Silvana— y **FormSubmit no necesita credencial**. En un repositorio
público eso es una preocupación menos: no hay `RESEND_API_KEY` que guardar en
Secret Manager, ni que rotar, ni que se pueda filtrar en un commit.

| Opción | A favor | En contra |
|---|---|---|
| **FormSubmit** *(elegida ahora)* | **sin credencial**: nada que custodiar ni rotar. Alta inmediata, sin dominio propio ni DNS | el correo lo compone un tercero (ver abajo), sin contrato ni acuerdo de tratamiento de datos, y el destino es una dirección sin autenticación |
| **Resend** *(destino previsto)* | nosotros componemos el correo: `text` sin `html`, garantía absoluta. Dominio propio con SPF y DKIM | exige credencial en Secret Manager y verificación de dominio: días de trámite que hoy no hay |
| Postmark | mejor entregabilidad | de pago desde el primer correo |
| SendGrid | veterano, nivel gratuito | revisiones de cuentas nuevas que dejan el canal mudo sin aviso |
| Amazon SES | el más barato | salir del *sandbox* y meter una **segunda nube** en un proyecto que ya tiene tres |

**Cuándo pasar a Resend, y qué cambiar.** Cuando haya clientes reales y dominio
propio. El cambio está acotado a `functions/src/reclamos.ts`:

1. Declarar `RESEND_API_KEY` con `defineSecret` y agregarla a `secrets` de la
   función. Es el único secreto nuevo del proyecto.
2. Cambiar el punto final y el cuerpo: `{ from, to, subject, text }`, **con
   `text` y sin `html`**.
3. Verificar el dominio remitente (SPF y DKIM) antes del primer envío, o los
   correos van a spam. Es un paso de DNS, no de código.
4. **Se puede aflojar el escapado de entidades** de `neutralizar()`, porque con
   Resend la garantía de texto plano vuelve a ser nuestra. Conviene **no
   hacerlo**: no cuesta nada y protege de un cambio futuro de renderizado.
5. `neutralizarEncabezado`, la validación del destino, el destino fuera del
   reclamo y el guardado previo en Firestore **no cambian**. Las pruebas de
   `pruebas/saneo.test.ts` siguen valiendo tal cual.

#### Lo que NO cambia con el proveedor

Las tres propiedades del diseño no dependen de quién manda el correo:

1. **El texto se entrega sin posibilidad de interpretarse como marcado.**
2. **El destinatario sale de `/plataforma/notificaciones`**, jamás del reclamo.
3. **El reclamo se guarda en Firestore antes de enviarse**, con la columna de
   avisos no notificados en la pantalla.

#### Lo que SÍ cambia, y es lo importante

Con Resend, **NovuChat componía el correo**: se mandaba `text`, se omitía `html`,
y la garantía de "nada interpretable" era nuestra y absoluta.

**Con FormSubmit el correo lo compone el tercero, y lo compone en HTML.** Ya no
controlamos el renderizado. La consecuencia práctica es que **la neutralización
tiene que hacerse en origen**, antes de que el texto salga del sistema: por eso
`neutralizar()` escapa las entidades HTML (`&`, `<`, `>`, `"`, `'`) además de
limpiar los caracteres de control.

Si FormSubmit lo renderiza como HTML, se lee el texto literal. Si lo renderiza
como texto plano, se leen las entidades escritas: feo y raro —un reclamo casi
nunca trae un `<`— y muy preferible a que un enlace escrito por otra persona
llegue vivo a una bandeja de entrada.

**Campos especiales de FormSubmit.** `_cc`, `_replyto`, `_next`, `_subject`,
`_template` y `_captcha` cambian el comportamiento del servicio. Si los campos
del reclamo se volcaran al cuerpo de la petición con un *spread*, **un reclamo
con un campo `_cc` desviaría una copia del correo**: es la inyección de
encabezados con otro disfraz. Dos defensas, las dos probadas: la regla de
Firestore tiene lista blanca de claves y no los deja entrar, y la función arma el
cuerpo **campo por campo**, sin ningún *spread*.

**Menos texto sale hacia el tercero.** El aviso lleva como máximo **1000
caracteres** del reclamo; el texto completo queda en Firestore y el correo lo
dice. Es minimización de datos, no una limitación técnica, y es coherente con
que el correo sea una notificación y no el registro. Ver `SEGURIDAD.md`, T-22.

#### El destino del correo nunca sale del reclamo

Los destinatarios se leen de `/plataforma/notificaciones`, que **ninguna sesión
de navegador puede escribir**. Es el control central: si el texto de un reclamo
pudiera influir en a dónde va el correo, el sistema sería un **reenviador** —
alguien escribe lo que quiera y lo hace salir, firmado por NovuChat, hacia donde
quiera. La lista blanca de claves del reclamo existe justamente para que no haya
un campo `destinatario` por donde entre esa idea. Hay una prueba que lo verifica.

---


<!-- movido de admin/DISENO.md §4quater (25/09/2026, líneas 906-907) -->

## 4quater. Bitácora y configuración como fuente de verdad


<!-- movido de admin/DISENO.md §4quater.1 (25/09/2026, líneas 908-981) -->

### 4quater.1 Bitácora: colección nueva, no extensión de `/auditoria`

`/tenants/{t}/bitacora/{eventoId}`. Las dos son inmutables y las dos son
evidencia, pero responden preguntas distintas y **crecen a ritmos distintos**:

| | `/auditoria` | `/bitacora` |
|---|---|---|
| Pregunta | quién cambió qué | qué hizo el sistema |
| Volumen | decenas por año | varios por cada mensaje |
| Retención | años | meses |
| Se lee | entera, de un vistazo | con filtros y paginación |

Mezclarlas tendría tres costos concretos: la pista de auditoría —la que se mira
cuando hay una disputa— quedaría ahogada en ruido de entregas; toda consulta
sobre `/auditoria` pasaría a costar lo que cuesta recorrer la bitácora; y los
índices compuestos que la bitácora necesita se aplicarían a una colección que no
los usa, pagándolos en cada escritura.

**No guarda el texto de los mensajes.** Solo tipo, resultado, código, latencia,
tamaño y el teléfono **enmascarado** (`5917****001`). El motivo es de coherencia:
ya está decidido que el propietario de NovuChat no lee conversaciones sin una
ventana de soporte otorgada por el comercio (T-5). Si la bitácora llevara el
texto sería exactamente esa puerta trasera, y peor: consultable entre todos los
comercios a la vez. Cuando hace falta el texto, la bitácora lleva
`conversacionId` y el camino sigue siendo el de siempre.

El enmascarado no es una convención: **la regla exige el patrón con asteriscos**,
así que un número completo se rechaza en el servidor.

**Quién la lee:** el administrador del comercio y el propietario. El operador
queda afuera — ya tiene la vista de conversaciones, que es la misma información
con más contexto. Se lee con `tenantLegible`, así que un comercio suspendido
conserva su evidencia; y **se escribe aunque esté suspendido**, porque la
evidencia no puede tener agujeros justo en el tramo del corte de servicio. Se
puede permitir precisamente porque no hay contenido personal acumulándose.

#### Filtros, índices y la trampa que el emulador no detecta

**El emulador de Firestore no exige índices compuestos: responde cualquier
consulta.** El servicio real rechaza con «The query requires an index». O sea que
una pantalla de filtros puede pasar todas las pruebas locales y romperse la
primera vez que alguien la usa en producción.

La defensa es estructural: las formas de consulta se declaran en
`web/src/lib/bitacora.ts`, y de ahí salen **dos cosas** — la consulta que arma la
pantalla y la prueba `pruebas/indices.test.ts`, que verifica que cada forma tenga
su índice. La pantalla no puede construir una consulta que la prueba no haya
visto, porque leen la misma lista.

| Filtros | Alcance | Índice |
|---|---|---|
| solo fechas | un comercio | automático (un solo campo) |
| tipo + fechas | un comercio | `(tipo ASC, ts DESC)` |
| resultado + fechas | un comercio | `(resultado ASC, ts DESC)` |
| tipo + resultado + fechas | un comercio | `(tipo, resultado, ts DESC)` |
| las cuatro anteriores | todos | idem, con alcance `COLLECTION_GROUP` |

El rango de fechas no agrega requisitos: es un rango sobre **el mismo campo** por
el que se ordena.

**Filtrar «por comercio» no es un `where`**: es consultar la subcolección de ese
comercio. Así el tenant sigue viviendo en la ruta y no en un campo (T-2). En la
vista de todos, a qué comercio pertenece cada fila sale del *path*.

**⚠️ Y una trampa que sí costó encontrar:** una consulta de grupo de colecciones
**no la autoriza la regla anidada**. Firestore la evalúa contra otro patrón y
hace falta una regla con comodín recursivo. No lo detectó ninguna de las 137
pruebas anteriores: apareció al abrir la pantalla. El comodín está acotado a
`esPropietario()` y **solo a la bitácora** — uno equivalente sobre
`conversaciones` sería la puerta trasera a T-5.

**Paginación por cursor** (`startAfter`, 50 por página), no por desplazamiento
numérico, que en Firestore obliga a leer y pagar todos los documentos salteados.


<!-- movido de admin/DISENO.md §4quater.2 (25/09/2026, líneas 982-1021) -->

### 4quater.2 La configuración del comercio como fuente de verdad

El panel manda, n8n consulta. Eso convierte esta pantalla en **la superficie por
donde entra lo que el asistente va a afirmar como verdad ante un cliente final**,
y la validación deja de ser higiene para ser el único punto donde se puede frenar
un dato antes de que salga por WhatsApp.

**Cinco clases de campo, y la diferencia importa:**

| Clase | Campos | Por qué |
|---|---|---|
| **Enumerados** | `tratamiento`, `estiloEmojis`, `zonaHoraria`, `moneda` | lista cerrada; el código los traduce a una frase fija |
| **Texto libre al prompt** | `nombreNegocio`, `descripcion`, `direccion`, `politicaCancelacion`, `datosQueNoTenemos`, `instruccionesExtra`, `mensajeCierre`, `mensajeErrorTemporal`, `mensajeReservaNoConfirmada`, `mensajeComercioSuspendido` | topeados y entregados en una sección rotulada |
| **Texto validado, no libre** | `direccionMaps` | el enlace de Google Maps del local: vacío, o `https://` de un dominio de mapas de Google y nada más (`enlaceDeMapaValido`, la misma lista en las reglas, en `prompt.ts` y en el flujo). Es el único texto del comercio que el asistente **reenvía tal cual** a un cliente final, en la confirmación de cada cita; texto libre acá sería un enlace a cualquier sitio firmado con el nombre del negocio. Va en el mismo mensaje que la dirección: cero mensajes nuevos (`Analisis/34` §2) |
| **Estructurados** | `horarios`, `ubicacion` | mapas de forma fija: `horarios` con los siete días; `ubicacion` con exactamente `lat` y `lng` numéricos en rango. `ubicacion` nunca entra al texto del prompt: sale en `operacion` y el flujo la usa solo para el pin nativo de WhatsApp cuando el cliente lo pide (un mensaje más, solo en ese caso) |
| **Derivados, NO almacenados** | `horarioAtencion`, `estadoComercio`, `phoneNumberId` | los calcula `configuracionFlujo` |

**Los enumerados son la decisión más fuerte de este bloque.** `tratamiento` y
`estiloEmojis` determinan la voz del agente, o sea que van *dentro* de sus
instrucciones: es inyección de prompt por diseño. En vez de intentar limpiar
texto libre, se elimina el texto libre. El valor del cliente **no se interpola en
ninguna parte**: solo selecciona cuál de nuestras frases se usa. Es la diferencia
entre elegir de un menú y escribir en el prompt. De paso cierra el defecto de
estilo de `ESTADO.md`: el agente alternaba «usted» y «tú» con el mismo cliente.

**Los derivados no se guardan, y eso es una defensa:**

- `estadoComercio` sale de la ficha del tenant. Si el comercio pudiera fijarlo,
  n8n lo leería de la configuración y **seguiría atendiendo pese a la
  suspensión**. Es el vector más serio del bloque.
- `phoneNumberId` sale del número que validó la firma HMAC. Guardado en la
  configuración, un comercio podría poner el de otro y **enviar mensajes en
  nombre de ese otro**.
- `horarioAtencion` se calcula desde `horarios`. Guardarlo además invitaría a que
  los dos valores se separaran y a que el agente anunciara un horario que la
  pantalla no muestra.

Las reglas los rechazan por lista blanca **y** `configuracionFlujo` nunca los lee
de la configuración aunque aparecieran. Dos barreras, a propósito.


<!-- movido de admin/DISENO.md §4quater.3 (25/09/2026, líneas 1022-1053) -->

### 4quater.3 `direccion` y `datosQueNoTenemos`: el incidente del 28/08

Ante «¿dónde queda su clínica?» el agente **inventó una dirección** —zona y
avenida— que no figuraba en ninguna parte. Para una demo comercial es el peor
defecto posible: un cliente podría presentarse en un lugar que no existe.

**`direccion` es opcional a propósito.** Obligarla tentaría a rellenarla con
cualquier cosa para poder guardar, y un dato inventado por el comercio hace el
mismo daño que uno inventado por el modelo. **Vacía significa «no la tenemos»**,
que es una respuesta correcta y verificable.

**El enlace del mapa y el pin acompañan a la dirección; no la reemplazan**
(`Analisis/34` §2, 17/09/2026). `direccionMaps` vacío significa «sin enlace»: el
asistente da la dirección sola y no menciona ningún mapa. No entra en
`datosQueNoTenemos`: la falta del enlace no es un dato que el cliente pida, y
anunciarla lo invitaría a pedirlo. Y sin `ubicacion` la marca `[ENVIAR_UBICACION]`
se quita del texto y no se manda nada: la respuesta ya lleva la dirección y el
enlace, que es lo que el cliente necesita para llegar. Un pin sin dirección
cargada no existe por construcción: el flujo lo arma con `direccion` y la
regla 6c prohíbe la marca cuando la dirección no está definida.

**`datosQueNoTenemos` se calcula, no se declara.** `configuracionFlujo` la computa
desde los campos que están efectivamente vacíos —dirección, teléfono de
recepción, calendario, horarios, política de cancelación— y le suma los que el
comercio agregó a mano. **Los computados no se pueden quitar desde el panel.**

El porqué: si dependiera de que el comercio se acuerde de escribir «no tenemos
dirección cargada», el olvido más probable del mundo —no cargar la dirección y
tampoco declarar que falta— devuelve exactamente el incidente. **La ausencia de
un dato es un hecho verificable; pedir que alguien la declare es pedirle que se
acuerde de lo que no hizo.**


<!-- movido de admin/DISENO.md §4quater.4 (25/09/2026, líneas 1054-1061) -->

### 4quater.4 `mensajeComercioSuspendido` y una propiedad emergente

Lo escribe el comercio: es su voz ante sus clientes. Pero como **toda escritura
de configuración exige `tenantOperativo`**, nadie puede redactarlo *después* de
que lo suspendieron. O se prepara antes, o rige el texto neutro de la plataforma.
No fue diseñado así: es una consecuencia de que la suspensión cierre las
escrituras, y conviene que quede escrita porque es deseable.


<!-- movido de admin/DISENO.md §4quater.5 (25/09/2026, líneas 1062-1161) -->

### 4quater.5 El comportamiento general se verifica en el servidor ANTES de aplicarse (17/09/2026)

**Las reglas de Andres del 17/09**, que esto hace cumplir: (1) multi-tenant
estricto —una empresa no ve, modifica, crea ni borra nada de otra, ni de
NovuChat, ni ninguna otra configuración; solo los superadministradores—; (2) el
«comportamiento general» del asistente es un campo por empresa, un pseudo-prompt
para campañas y ofertas, y **se verifica por seguridad antes de aplicarse**: ese
texto no puede retirar, permitir, sobreescribir ni ejecutar nada sobre otros
tenants, sobre NovuChat ni sobre otra configuración; se enmarca en lo que tiene
esa empresa; (3) lo que NovuChat configura por script se ve en la consola.

**El problema que resuelve.** `instruccionesExtra` es el único campo de la
consola que, en la práctica, es un prompt escrito por el cliente. El flujo lo
inserta delimitado y subordinado (§4quater.2), y eso baja el riesgo, pero nadie
miraba el contenido: 1.500 caracteres alcanzan para fabricar un bloque
`[CONTEXTO DEL SISTEMA]` entero, para pedirle al asistente que niegue ser una IA
(prohibición 4) o para hablar en nombre de otro comercio.

**El contrato de datos**, tres campos de `config/negocio`:

| Campo | Qué es | Quién lo escribe |
|---|---|---|
| `instruccionesExtra` (string ≤ 1.500) | **lo propuesto** | el admin del comercio, desde la consola, como hoy |
| `instruccionesVigentes` (string ≤ 1.500) | **lo que el flujo lee** | solo el SDK Admin: la Function `verificarComportamiento` o los scripts de NovuChat (`cargar-negocio.mjs`, `migrar-instrucciones.mjs`). Las reglas lo niegan desde el navegador a **todo** rol, incluido el admin del comercio y el propietario |
| `instruccionesRevision` (mapa) | `{ estado: 'pendiente' \| 'aprobado' \| 'rechazado', motivo ≤ 300, revisadoEn, hash, capa, revisadoPor }` | solo el SDK Admin. `hash` = primeros 16 hexadecimales del SHA-256 del texto revisado, tal cual está escrito: la consola lo compara con `instruccionesExtra` y sabe si la revisión corresponde a lo que está en pantalla o a un texto anterior |

`configuracionFlujo` entrega `datosDelNegocio.instruccionesExtra` —la clave que
los flujos ya leen; **el flujo no cambia**— con el texto de
`instruccionesVigentes`. Sin vigente, vacío, aunque lo propuesto tenga texto.

**Por qué el flujo lee solo lo vigente.** Es la misma lógica de los campos
derivados (§4quater.2, T-27): dos barreras. La regla impide que el navegador
escriba lo vigente —se mira el *diff* y no las claves del documento, como con
`stock`, así que borrarlo también se rechaza y la consola guarda con
`updateDoc`— y `configuracionFlujo` nunca lee lo propuesto. Un texto rechazado
no llega al asistente y el anterior aprobado sigue rigiendo; un texto que no se
pudo verificar queda `pendiente` y **tampoco se aplica**: ante la duda, no. El
comercio ve en la consola qué escribió, qué está vigente y por qué difieren.

**La verificación, en dos capas y las dos del servidor**
(`functions/src/comportamiento.ts`, puro; `verificarComportamiento.ts`, el
disparador `onDocumentWritten` sobre `tenants/{t}/config/negocio`, que actúa solo
cuando cambió `instruccionesExtra` y la revisión guardada no es ya de ese texto):

1. **Patrones, determinista y primero.** Rechaza sin preguntarle a nadie:
   corchetes, llaves, ángulos y comillas angulares (imitan los bloques del
   sistema y los delimitadores del corpus); los rótulos literales del prompt
   («contexto del sistema», «mensaje del cliente», «información del negocio»);
   `TRANSFERIR` en mayúsculas; verbos de anulación con objeto de sistema («ignora
   las instrucciones anteriores», «olvidá tus reglas»); «instrucciones del
   sistema», «prompt del sistema»; cambios de rol en español e inglés («a partir
   de ahora eres», «you are now», «developer mode»); pedir negar que es una IA
   («di que eres una persona», «no digas que eres un bot», «decí que sos la
   recepcionista»); «prompt» y «system»; cualquier identificador con guion bajo
   (`agendar_cita`, `consultar_disponibilidad`: se rechaza la forma, no solo los
   nombres de hoy); nombres de la plataforma (`tenant`, `firestore`, `n8n`,
   `webhook`, `gemini`); NovuChat invocado como autoridad («NovuChat autoriza»,
   «por orden de NovuChat»); y **el identificador o el nombre de otro tenant**,
   leídos de `/tenants` con el SDK Admin y comparados como frase entera, con
   motivo genérico «menciona otro comercio»: los nombres ajenos no se le muestran
   al comercio. Las coincidencias **débiles** —«regla» (reglas de higiene),
   «herramienta» (una ferretería), «consola» (una tienda de videojuegos), un
   verbo de anulación sin objeto («ignora los mensajes en inglés»), «NovuChat»
   suelto, «token»— **no rechazan nunca solas**: dejan el caso dudoso, con la
   palabra señalada, para la capa 2. La lista está en el código con el porqué de
   cada entrada, y `pruebas/comportamiento.test.ts` exige que cada patrón tenga
   un texto que lo dispare.
2. **Modelo, segundo.** Una llamada a Gemini (`GEMINI_API_KEY`, el mismo secreto
   que la comprobación de fotos) con temperatura 0 y respuesta cerrada: APROBADO
   o RECHAZADO y una línea de motivo. El texto va como dato delimitado y con la
   orden de no obedecerlo; la capa 1 ya garantizó que no contiene `<` ni `>`.
   Si el modelo no responde, divaga o la clave no está, el estado queda
   `pendiente` con motivo «no se pudo verificar» y **no se aprueba por defecto**.

Resultado: se escribe `instruccionesRevision` siempre; `instruccionesVigentes`
solo si aprobó. Vacío aprueba sin llamar al modelo (vigente vacío). Todo queda
en `/auditoria` (`revisar_comportamiento`: estado, capa, hash, motivo, cantidad
de caracteres; nunca el texto). La escritura es una transacción condicionada a
que lo propuesto siga siendo el texto revisado: si el comercio guardó otra vez
mientras el modelo pensaba, el veredicto viejo no se escribe.

**Lo que carga NovuChat ya está revisado.** `cargar-negocio.mjs` escribe
propuesto, vigente y revisión aprobada (`revisadoPor: 'cargar-negocio'`) en la
misma transacción, y la Function no revisa dos veces porque ve el hash. Antes de
escribir pasa el texto por la misma capa de patrones y **niega** si no la pasa:
lo que NovuChat carga tiene que poder editarse después desde la consola sin que
la verificación lo rechace por un carácter que puso NovuChat (el JSON de Platinum
tenía «cuánto dura» con comillas angulares; ya no). `migrar-instrucciones.mjs`
(seco por defecto) copia lo propuesto a vigente, una vez, en los comercios
anteriores al contrato: sin eso, al desplegar, Platinum se quedaba sin sus
precios y objeciones en silencio.

**Lo que esto NO hace, dicho ahora.** No sanea: rechaza. Un texto rechazado
vuelve al comercio con el motivo, y la consola le muestra qué está vigente
mientras tanto. Tampoco reemplaza la delimitación del flujo ni la lista blanca de
claves: es una tercera barrera sobre el único campo que las otras dos no podían
cerrar del todo.

---


<!-- movido de admin/DISENO.md §4septies (25/09/2026, líneas 1507-1513) -->

## 4septies. Retención de conversaciones: 12 meses

**Decidido por Andres el 2026-09-07.** Era el riesgo abierto más incómodo: el
sistema guarda mensajes de WhatsApp de clientes finales que **nunca aceptaron
nada ante NovuChat**. Consintieron escribirle a una peluquería; nosotros somos
la infraestructura de esa peluquería, no su contraparte.


<!-- movido de admin/DISENO.md §La regla (25/09/2026, líneas 1514-1519) -->

### La regla

**Las conversaciones y sus mensajes se borran a los 12 MESES de su último
mensaje.** No de su creación: una conversación que sigue viva no se corta por la
mitad.


<!-- movido de admin/DISENO.md §Qué se borra y qué no, que es donde está la decisión de verdad (25/09/2026, líneas 1520-1534) -->

### Qué se borra y qué no, que es donde está la decisión de verdad

| Dato | Qué pasa a los 12 meses | Por qué |
|---|---|---|
| `conversaciones/{id}` y sus mensajes | **se borra** | es el contenido personal: lo que la persona escribió |
| `cierres/{id}/privado/datos` | **se borra** | nombre y teléfono completo del cliente final |
| `cierres/{id}` (público) | **se conserva** | teléfono enmascarado, importe y tipo: es el respaldo de lo que se facturó |
| `metricas/{periodo}` | **se conserva** | son cuentas, no personas |
| `contactos` del comercio | **no caduca** | son del negocio, no de sus clientes; los borra el comercio |
| `bitacora` y `auditoria` | **se conserva 24 meses** | es el registro de quién cambió qué, y protege al comercio tanto como a NovuChat |

La asimetría es deliberada: **se borra el contenido, se conserva la cuenta.** Un
comercio que reclame una factura de hace ocho meses tiene con qué defenderse, y
la persona que escribió por un corte de pelo no queda en una base para siempre.


<!-- movido de admin/DISENO.md §Por qué doce y no seis ni veinticuatro (25/09/2026, líneas 1535-1542) -->

### Por qué doce y no seis ni veinticuatro

Doce meses cubre el ciclo comercial completo —una discusión de facturación, una
auditoría, un cliente que vuelve al año— y es el plazo que un comercio entiende
sin explicación. Seis obliga a explicarle a un negocio por qué perdió el
historial de la temporada pasada; veinticuatro acumula dos años de datos ajenos
sin que nadie los use.


<!-- movido de admin/DISENO.md §Cómo se implementa (25/09/2026, líneas 1543-1551) -->

### Cómo se implementa

Una función programada diaria que borra por lotes lo vencido, con su registro en
la bitácora de plataforma. **Pendiente de escribir**: la decisión es de hoy, el
código va después de las demos del 9 y 10. Hasta entonces no hay volumen que lo
justifique —dos comercios de demostración— pero **tiene que existir antes del
primer cliente real**, porque a partir de ahí los datos son de terceros de
verdad.


<!-- movido de admin/DISENO.md §Lo que hay que decir en los términos (25/09/2026, líneas 1552-1566) -->

### Lo que hay que decir en los términos

Dos frases, y la segunda depende de la opción de calendario de §4:

> Guardamos las conversaciones de WhatsApp durante 12 meses desde el último
> mensaje, y después se borran automáticamente. Conservamos por más tiempo solo
> el registro de operaciones facturadas, sin el contenido de los mensajes ni el
> teléfono completo.

> Para agendar citas, el asistente accede a la agenda de Google que el negocio
> autoriza. Ese acceso lo concede el propio negocio desde su cuenta de Google y
> lo puede revocar cuando quiera, sin pasar por NovuChat.

---


<!-- movido de admin/DISENO.md §4undecies (25/09/2026, líneas 1919-1964) -->

## 4undecies. Prepago estricto: pagos, cortes, cobranza y el cobrador (20/09/2026)

> Ficha de diseño del frente A (`Prompts/prepago-estricto.md`, coordinado por
> `Prompts/prepago-y-modularizacion-en-paralelo.md`). La escribió el agente de
> diseño sobre `main` al 20/09 y la integró la coordinadora, que reemplazó la
> §4undecies.5 por el contrato **real** del proyecto de cobros (verificado ese
> día a pedido de Andres) y alineó los nombres de plantillas con
> `docs/plantillas-cobranza.md` (bloque A-5).

**Estado de la base sobre la que se diseña.** `main` al 20/09 (después de `v0.6.0`).
La rama `integracion/prepago-sobre-flujos-vivos` (08/09, `87714d1`) aporta el
módulo puro `prepago.ts`; todo lo demás de esa rama (`cuentas.ts`,
`cobroPrepago.ts`, `cobroTextos.ts`, `cache.ts`, `costos.ts`, su `planes.ts` con el
tope de 25 con corte, `AltaNegocio.tsx`, `CuentaNegocio.tsx`) **no se reaplica**: o lo
reemplazó `main` (bloques de 25, `atencion.ts`, `planes.ts` con catálogo), o
contradice las decisiones de este frente (el comprobante por WhatsApp que NovuChat
«daba por bueno»). Es integración, no cherry-pick.

**Lo que se descubrió leyendo y que condiciona el diseño:**

1. **El flujo reporta el entrante aunque el panel conteste 409.** En
   `Flujos/demo-a-agendamiento.json`, `Normalizar entrada` conecta con `¿Comercio
   operativo?` **y** con `Reportar mensaje (entrante)`, y este último está arriba
   (y=120 contra y=280), así que con `executionOrder: v1` corre primero. Si
   `configuracionFlujo` corta con 409, la ingesta **igual recibe el mensaje del
   cliente**: ahí se cuentan las `perdidas`, sin tocar ningún flujo (que son de B).
2. **Los tres flujos ya saben cortar con un 409.** `Config del negocio` trata el 409
   de `Traer configuración` como «no operativo» y `Comercio no operativo` manda
   `mensajeCortesia` sin llamar al modelo. El corte del prepago **reutiliza ese
   409**: cero cambios en `Flujos/`, cero mensajes nuevos.
3. **La ingesta ya lee `cuenta/estado` dentro de su transacción**
   (`ingesta.ts:1027-1029`) y ya lee `metricas/{periodo}` condicionalmente para el
   aviso del 80 % (`1053-1054`). El prepago se cuelga de esas dos lecturas; no abre
   otra transacción.
4. **`actualizarEstadoCuenta` ya es parcial** (`index.ts:509-516`, `viene()` en
   `533`, probado en `pruebas/estado-cuenta.test.ts`). De la fase 0 de `Analisis/29`
   falta solo que deje de aceptar los campos que pasan a ser derivados (§4undecies.2).
5. **El cobrador entrega el QR como PNG en base64, no como texto.** `dibujoQr.ts`
   **no sirve** para el prepago: no hay cadena que redibujar. Se comparte
   `firma.ts` (el esquema HMAC) y nada más.
6. **La condición de IAM de la cuenta de despliegue solo ve secretos `INGESTA_*` y
   `GEMINI_API_KEY`** (`.github/DESPLIEGUE-FIREBASE.md:73-75`). Los dos secretos del
   cobrador exigen ampliar esa condición y dar `secretAccessor` a `sa-functions`,
   secreto por secreto (`firma.ts:69-85`). Son pasos de nube: **en espera de la
   compuerta del demo**.


<!-- movido de admin/DISENO.md §4undecies.1 (25/09/2026, líneas 1965-2080) -->

### 4undecies.1 La colección `/tenants/{t}/pagos/{pagoId}`

**Un documento por pago, en cualquier estado.** El identificador es opaco y lo
genera el servidor: `randomBytes(16).toString('base64url')` (22 caracteres, 128
bits). Es también la **referencia externa** que viaja al cobrador (§4undecies.5):
un solo valor, generado una vez, sin tenant ni período adentro, y dentro del juego
de caracteres que el cobrador admite (`[A-Za-z0-9:_.-]`, hasta 120).

| Campo | Tipo | Quién lo escribe | Por qué |
|---|---|---|---|
| `tipo` | `'mensualidad' \| 'bolsa' \| 'instalacion'` | Functions | `instalacion` es el agregado de `Analisis/29` §2.5: hoy los USD 65 no tienen dónde registrarse. No suma meses ni bolsas |
| `plan` | `IdPlanVendible` (`planes.ts:42`) | Functions | Solo en `mensualidad`. Del catálogo, nunca texto libre |
| `meses` | entero 1..6 | Functions | Solo en `mensualidad`. El tope 6 se hace cumplir acá (`MESES_MAXIMO = 6` en `prepago.ts`), no en la pantalla |
| `cantidad` | entero 1..12 | Functions | Solo en `bolsa` |
| `montoUsd` | número | Functions | El de la lista (`PLANES[plan].precioUsd × meses`, `BOLSA.precioUsd × cantidad`, `INSTALACION_USD`) |
| `monto` | entero | Functions | Bolivianos, redondeados con `importeBs`. Es lo que va al QR |
| `moneda` / `monedaLista` | `'BOB'` / `'USD'` | Functions | Constantes, para que el documento se explique solo |
| `tcoAplicado` | número 5..40 | Functions | El TCO del BCB del **día de emisión**. Sin él, `importeBs` lanza y el pago no se crea |
| `tcoFuente` | string | Functions | `'BCB'` en los automáticos; lo que declare el propietario en los manuales |
| `tcoFecha` | `aaaa-mm-dd` | Functions | Reemplaza al `tcoPeriodo` (`aaaa-mm`) de la rama: el TCO ya no es mensual |
| `montoRecibidoBs` | entero o `null` | Functions | Lo que entró de verdad (el cobrador lo informa; el propietario lo declara) |
| `motivoDiferencia` | string ≤ 300 | Functions | Obligatorio si `montoRecibidoBs !== monto` en un manual: un descuento tiene nombre y firma |
| `estado` | `'pendiente' \| 'confirmado' \| 'vencido' \| 'anulado'` | Functions | Desaparecen `esperando_comprobante`, `comprobante_recibido`, `rechazado` de la rama: ya no hay comprobante que alguien «dé por bueno» |
| `medio` | `'qr' \| 'efectivo' \| 'transferencia'` | Functions | `qr` solo lo escribe el cliente del cobrador; los otros dos, solo `registrarPagoManual` |
| `canal` | `'consola' \| 'whatsapp' \| 'manual'` | Functions | Por dónde pidió el pago el comercio. Primera medida del §8 de `Analisis/36` |
| `referencia` | string ≤ 120 | Functions | En `qr`: **igual a `pagoId`** (la referencia externa). En `transferencia`: número de operación. En `efectivo`: «recibido por <nombre>» |
| `cobro` | `{ id, estado, venceEn, creadoEn, fichaQr, qrRuta }` o ausente | Functions (A-2) | `id` es el `cons-…` del cobrador; `estado` es el último estado del cobrador visto. `fichaQr` es un valor al azar de 32 hex (como `cobroReal.ficha`, `cobro.ts:152`) con el que `imagenDePago` sirve el PNG. `qrRuta` es la ruta en Storage |
| `confirmadoPor` | `{ origen: 'banco', cobroId, riel, confirmadoPorCobrador, avisoId? } \| { origen: 'propietario', uid }` | Functions | Las dos únicas fuentes que confirman (decisión 5). No existe `origen: 'comprobante'` ni `'webhook'` |
| `evidencia` | ruta de Storage o ausente | Functions | `tenants/{t}/pagos/{pagoId}/evidencia.(jpg\|png\|pdf)`. Obligatoria si `medio === 'transferencia'` |
| `descripcion` | string | Functions | `descripcionDe(pago)` de `prepago.ts`: «Crecimiento · 3 meses» |
| `cubiertoHasta` | `aaaa-mm` | Functions | Lo que la cuenta quedó cubriendo tras aplicar. Es lo que muestra el historial |
| `creadoEn`, `creadoPor` | Timestamp, uid o `'whatsapp:<últimos 4>'` | Functions | |
| `confirmadoEn`, `venceEn`, `anuladoEn`, `anuladoPor`, `motivoAnulacion` | | Functions | `venceEn` = vencimiento del cobro (72 h) solo en `qr` |

**Transiciones válidas** (todo lo demás se rechaza con `failed-precondition`):

```
(crear qr)      → pendiente
(crear manual)  → confirmado           ← nace confirmado; nunca pasa por pendiente
pendiente → confirmado   por avisoCobrador o barridoCobros, SOLO si estadoCobro(id) === 'CONFIRMADO'
pendiente → vencido      por barridoCobros, cuando el cobrador dice VENCIDO
pendiente → anulado      por anularPagoPendiente (admin del tenant o propietario), por
                         registrarPagoManual (que anula el QR vivo antes de cargar), o cuando el
                         cobrador dice ANULADO o RECHAZADO
confirmado, vencido, anulado → (terminales). Un confirmado NO se corrige: se compensa con otro asiento.
```

`PAGO_DETECTADO`, `EN_REVISION` y `BORRADOR` del cobrador **no mueven** el pago de
NovuChat: sigue `pendiente` (con `cobro.estado` actualizado, para que la consola
pueda decir «el banco detectó un pago y lo está conciliando»). `BORRADOR` se resuelve
reintentando `crearCobro` con la misma referencia, que retoma el mismo cobro.

**Idempotencia por referencia.** La clave es que `pagoId === referenciaExterna === id del documento`:

- Crear: `tx.create(refPago)` falla si el documento ya existe, y el cobrador devuelve
  el mismo cobro ante la misma referencia (200 en vez de 201). Un reintento de red
  no produce dos QR ni dos documentos.
- Confirmar: la transacción relee `pagos/{pagoId}`; si ya está `confirmado`,
  responde `{ aplicado: false, ya: true }` y no suma meses otra vez.
- Resolver `referenciaExterna → tenant`: colección raíz `/cobrosPendientes/{pagoId}`
  con `{ tenantId, pagoId, cobroId, fichaQr, venceEn, creadoEn }`, escrita en la misma
  transacción que crea el pago y borrada al cerrarlo. Es además la lista de trabajo
  del barrido horario: no hace falta ninguna consulta de grupo entre tenants.

**Un solo pendiente por cuenta.** `cuenta/estado.pagoPendienteId` se escribe en la
misma transacción que crea el pago. Antes de crear, la transacción lee la cuenta y,
si `pagoPendienteId` apunta a un pago que sigue `pendiente` y cuyo `venceEn` no
pasó, rechaza con `failed-precondition` y **devuelve ese pago** (id, importe,
`fichaQr`, `venceEn`) para que la consola muestre el QR vivo y el botón «cancelar y
emitir otro». Si el pendiente ya venció según el reloj, el barrido lo cierra; la
consola ofrece «emitir otro», que primero llama a `anularPagoPendiente`.

**Quién escribe: solo Functions con el SDK Admin.** Ninguna regla admite escritura
desde el navegador, ni para el propietario: si pudiera, no habría auditoría de quién
confirmó qué. Las puertas son `crearCobroPrepago` (admin del tenant o propietario,
A-2), `pagoPorWhatsapp` (A-4, vía la misma función interna), `registrarPagoManual`
(propietario, A-1), `anularPagoPendiente` (admin o propietario, A-1), `avisoCobrador`
y `barridoCobros` (A-2).

**Quién lee:** el administrador del tenant con `tenantLegible` (un comercio cortado
tiene que ver sus pagos) y el propietario. El operador no (misma regla que
`/cuenta`, `firestore.rules:1521-1525`).

**La regla**, calcada de `/cuenta` (a continuación de `match /cuenta/{documento}`):

```
      // /pagos/{pagoId} — LOS PAGOS DEL PREPAGO: mensualidades, bolsas e
      // instalación, con su TCO. Solo los escribe el SDK Admin; nadie desde el
      // navegador, ni el propietario (quedaría sin auditoría). Los lee el
      // administrador del comercio, también cortado (tenantLegible), y NovuChat.
      match /pagos/{pagoId} {
        allow get, list: if (esAdmin(tenantId) && tenantLegible(tenantId))
                         || esPropietario();
        allow create, update, delete: if false;
      }
```

Y en la raíz, junto a `/plataforma`: `match /cobrosPendientes/{pagoId} { allow read, write: if false; }`.

**Pruebas de reglas (`pruebas/reglas.test.ts`, sección «Pagos del prepago»), escritas negando:**

| Caso | Esperado |
|---|---|
| el admin de A lee `tenants/A/pagos/p1` | pasa (control positivo) |
| el admin de A lista `tenants/A/pagos` ordenado por `creadoEn` | pasa |
| el admin de **B** lee o lista `tenants/A/pagos` | falla |
| el **operador** de A lee `tenants/A/pagos/p1` | falla |
| el admin de A hace `setDoc`/`updateDoc` con `estado: 'confirmado'` | falla |
| el admin de A crea un pago a mano | falla |
| el **propietario** (Google) escribe un pago | falla |
| el propietario con sesión de contraseña lee | falla (T-19) |
| el admin de A **suspendido** lee sus pagos | pasa (`tenantLegible`) |
| el admin de A **dado de baja** lee | falla |
| cualquiera lee o escribe `/cobrosPendientes/x` | falla |
| el admin de A escribe `cuenta/estado.pagoPendienteId` | falla |


<!-- movido de admin/DISENO.md §4undecies.2 (25/09/2026, líneas 2081-2128) -->

### 4undecies.2 `cuenta/estado` se deriva de los pagos

**El principio:** los campos de situación de pago **no se escriben a mano**. Se
escriben junto con cada cambio de la cuenta, calculados por `estadoDeServicio`
(`prepago.ts`), desde una sola función `camposDerivados(estado, corteGuardado)`
(tomada de `cuentas.ts` de la rama, con un ajuste: el corte no se borra si está en
modo observación, §4undecies.4).

| Campo de `cuenta/estado` | Origen | Quién lo escribe |
|---|---|---|
| `modalidad` | `'demostracion' \| 'prueba' \| 'prepago'`; ausente = demostración | `actualizarEstadoCuenta({ modalidad })` (propietario, auditado) para `prueba` o `demostracion`; `aplicarPago` la pone en `prepago` al confirmar la primera mensualidad |
| `plan`, `limites`, `catalogoPlanes` | como hoy | `actualizarEstadoCuenta({ plan })` **y** `aplicarPago` de una mensualidad de otro plan («cambiar de plan es pagar el plan nuevo») |
| `periodoPagado` | `aaaa-mm`, último mes cubierto | solo `aplicarPago` |
| `periodoPrueba`, `bolsaPrueba` | mes de prueba y sus 20 conversaciones | `actualizarEstadoCuenta({ modalidad: 'prueba' })` los inicializa |
| `bolsa` | conversaciones compradas sin usar | `aplicarPago` suma; la ingesta descuenta (`consumoDeConversacion`) |
| `pagoPendienteId` | id del pago `pendiente` | la transacción que crea el pago; se borra al confirmar, vencer o anular |
| `corte` | `{ motivo, desde, perdidas, mensajesPerdidos, aplicado }` | la ingesta (§4undecies.3) y `aplicarPago` (lo borra al reactivar) |
| `estadoPago` | **derivado**: `al_dia`, `pendiente` (en gracia o con `pagoPendienteId`), `vencido` (cortado por `sin_pago`), `sin_cargo` (demostración) | `camposDerivados` |
| `proximoVencimiento` | **derivado**: `finDelPeriodoMs(periodoPagado)`; ausente en demostración | `camposDerivados` |
| `montoMensual`, `moneda` | **derivados**: `PLANES[plan].precioUsd`, `'USD'` | `camposDerivados` |
| `telefonosPago` | lista ≤ 5 de teléfonos que pueden pagar por WhatsApp | callable `fijarTelefonosPago` (admin del tenant, auditada). Va acá y no en la ficha porque la ficha la lee el operador y la ingesta |
| `corteActivo` | `true` para encender el corte en **este** tenant antes que en toda la plataforma | `fijarCortePrepago` (propietario) |

**Lo que hoy pisa esos campos, línea por línea, y qué se hace (bloque A-1):**

| Archivo:línea | Qué escribe | Resolución |
|---|---|---|
| `index.ts:314` (`suspenderTenant`) | `estadoPago: 'vencido'` | se quita: suspender corta el **servicio**, no afirma nada sobre el pago |
| `index.ts:353` (`reactivarTenant`) | `estadoPago: 'al_dia'` | se quita: no se afirma «al día» sin un pago que lo respalde |
| `index.ts:536-563` | acepta `estadoPago`, `montoMensual`, `moneda`, `proximoVencimiento` | se **rechazan** con `invalid-argument` «se deriva de los pagos» |
| `index.ts:115-121` (`exigirAdminDe`) | no mira proveedor ni correo verificado | exige `sign_in_provider === 'password'` y `email_verified`, igual que `esAdmin()` de las reglas, porque A-2 y A-3 agregan callables de admin |
| `pruebas/estado-cuenta.test.ts:146-158` | prueban que esos campos se aceptan | se reescriben negando |
| `web/src/paginas/EstadoCuenta.tsx:54-55, 86-99`, `Tablero.tsx:352, 490-491` | pintan `estadoPago`, `montoMensual`, `proximoVencimiento` | siguen leyendo los mismos nombres: ahora son derivados |
| `scripts/asignar-plan.mjs` | escribe plan sin tocar el resto | no cambia |

`actualizarEstadoCuenta` gana `modalidad` (cerrada, `esModalidad`), `periodoPrueba`
(`aaaa-mm`, opcional; por defecto el mes en curso al pasar a `prueba`) y
`corteActivo` (booleano), y recalcula `camposDerivados` en la misma transacción
(`index.ts:607-663`), leyendo `metricas/{periodo}` para `consumidas`.

**Migración (`Analisis/29` §2.6), antes del primer pago:** los comercios con `plan:
'demostracion'` quedan como están (sin `modalidad`; además `estadoDeServicio` trata
`plan === 'demostracion'` como demostración, doble salvaguarda). El tenant
`novuchat` igual. Los comercios reales reciben `modalidad` y `periodoPagado` **a
mano, uno por uno**, con `actualizarEstadoCuenta` o un `migrar-prepago.mjs` seco por
defecto. Ningún comercio recibe `modalidad: 'prepago'` sin un pago o una decisión
explícita de Andres.


<!-- movido de admin/DISENO.md §4undecies.3 (25/09/2026, líneas 2129-2264) -->

### 4undecies.3 Reaplicación de `prepago.ts` sobre la ingesta de hoy

#### Qué se conserva tal cual del módulo del 08/09

`MODALIDADES`, `esModalidad`, `TipoCambio`/`esTipoCambio`/`TCO_MINIMO`/`TCO_MAXIMO`,
`importeBs` (lanza sin TCO válido), `MONEDA_LISTA`/`MONEDA_COBRO`, `esPeriodo`,
`sumarMeses`, `periodoSiguiente`, `periodoAnterior`, `diasDelPeriodo`, `diaDelMes`,
`finDelPeriodoMs`, `inicioDelPeriodoMs`, `fechaFinDelPeriodo`, `fechaCorta` (en hora
de Bolivia, UTC−4), `CuentaCruda`, `Corte`, `MotivoCorte`, `corteDe`, `consumidasDe`,
`consumoDeConversacion`, `Pago`, `montoUsdDe`, `descripcionDe`, `CuentaTrasPago`,
`aplicarPago`, `resumenDeCuenta`, `VOSEO`, y la mitad de `estadoDeServicio`.

#### Qué se corrige

| Qué | Cómo | Por qué |
|---|---|---|
| **`PLANES`, `BOLSA`, `PLAN_POR_DEFECTO`, `esPlan`** de la rama | se **borran**; `prepago.ts` importa `PLANES`, `BOLSA`, `esIdPlan`, `limitesDeCuenta` de `planes.ts` | la rama dice `base/crecimiento/corporativo`; `main` dice `impulso/crecimiento/pro` (`planes.ts:76-80`). Las incluidas se leen de la **copia** `cuenta.limites.conversaciones` vía `limitesDeCuenta`, como el aviso del 80 % y el límite de productos |
| **`periodoDe`** de la rama (Bolivia) | se borra; se usa `periodoDe` de `planes.ts:218` (UTC) para todo lo que sea **id de agregado o de aviso** | dos funciones con el mismo nombre y distinta zona son el defecto que `planes.ts` ya documenta. La **cobertura** se decide por instantes: `cubierto = ahoraMs <= finDelPeriodoMs(periodoPagado)`. Lo único que usa el mes UTC es `consumidas`, y en las 4 horas de desfase falla hacia el lado seguro |
| **`estadoDeServicio(cuenta, consumidas, periodo)`** | pasa a `estadoDeServicio(cuenta, consumidas, ahoraMs)` y devuelve además `fase: 'cubierto' \| 'gracia' \| 'cortado'` y `graciaHasta: number \| null` | la gracia es tiempo, no mes |
| **Gracia de 48 h** | `GRACIA_MS = 48 h`. Con `periodoPagado === periodoAnterior(mesActualBolivia)` y `ahoraMs < inicioDelPeriodoMs(mesActual) + GRACIA_MS` → `fase: 'gracia'`, `operativo: true`. Pasado eso → `cortado`, `sin_pago` | **D0 = día 1 del mes sin cobertura, 00:00 Bolivia; el corte rige desde las 00:00 del día 3.** Es el único reparto en el que «vence hoy» (D0), «48 horas» y «corte a las 00:00» son verdad a la vez |
| **`prueba`** | igual que `prepago` para la cobertura (`enPrueba = periodoPrueba === mesActual`), con gracia; **sin cobranza**: `recordatoriosDebidos` solo emite `conversion` | decisión 5 |
| **Calendario** | `DIAS_AVISO_RENOVACION = [7, 2]` → `[5, 1]`; se agregan `vencida` (D0), `cortePago` (D+2) y `cortePago2` (D+4, con `perdidas`) | `Analisis/36` §3.1 |
| **`PLANTILLAS`** | se reescriben con los **nombres y cuerpos de `docs/plantillas-cobranza.md`** (A-5): `mensualidad_vence_pronto` (D-5), `mensualidad_vence_manana` (D-1), `mensualidad_vencida_gracia` (D0), `asistente_sin_atender` (D+2), `asistente_sin_atender_perdidas` (D+4), `conversaciones_agotadas`, `prueba_termina`, `pago_confirmado` | los cuerpos de la rama tienen voseo residual y lenguaje de venta; la prueba de `VOSEO` los vigila |
| **`corte`** | gana `mensajesPerdidos` y `aplicado: boolean`; `perdidas` pasa a contar **teléfonos distintos** que consultaron durante el corte (marca `corteVisto` en la conversación, cero lecturas extra) | «[N] clientes te escribieron» tiene que ser clientes, no mensajes |
| **`MENSAJE_CORTESIA`** | pasa a ser función: `mensajeCortesia(numeroRecepcion)` → el texto de hoy + « Puede comunicarse al {número}.» si hay número válido | corrección 2 de `Analisis/36` §3.2. Nunca «mantenimiento», nunca «pago» |
| **`aplicarPago` con 6 meses** | suma `BOLSA.conversaciones` de regalo cuando `meses === 6` | «a partir de 6» con tope 6 es «al pagar 6» |
| **`meses`** | tope 6 (`MESES_MAXIMO`), no 12 | decisión 4 |

#### Dónde se decide en la ingesta, y cómo se cuentan las `perdidas`

Todo dentro de la transacción que ya existe (`ingesta.ts:1026-1200`). No se abre otra.

1. **Lecturas (1027-1029).** El `Promise.all` pasa a `[conversacion, cuentaDoc,
   plataformaDoc]` sumando `tx.get(db.doc('plataforma/prepago'))`. Es +1 lectura por
   mensaje y evita un caché cuya invalidación habría que probar.
2. **Métricas (1053-1054).** `const necesitaMetricas = conteo.conversacion &&
   (avisoConsumoPendiente(cuenta, periodo) || modalidadDe(cuenta) !== 'demostracion')`.
   Solo un mensaje que **abriría** una conversación puede chocar con `sin_conversaciones`.
3. **Decisión (nuevo bloque entre 1058 y 1060):**
   ```ts
   const servicio = estadoDeServicio(cuenta, consumidasDe(metricasDoc?.data()), ahoraMs);
   const aplica = corteAplicable(cuenta, plataformaDoc.data());  // §4undecies.4
   const corteGuardado = corteDe(cuenta);
   const rechazo = rechazoPorPrepago(servicio.motivo, conteo.atencion);   // de la rama
   ```
   `sin_pago` rechaza todo; `sin_conversaciones` rechaza solo lo que **abriría** una
   conversación (una ventana ya abierta se atiende hasta el final: ya se pagó).
4. **Si hay `rechazo`**: se escribe `cuenta.corte` con `merge` (`motivo`, `desde`,
   `aplicado: aplica`, `perdidas += (entrante consulta && conversacion.corteVisto !== desde ? 1 : 0)`,
   `mensajesPerdidos += (entrante ? 1 : 0)`) y `camposDerivados`; se marca
   `corteVisto: desde` en la conversación.
   - **Con `aplica === true` (cortado):** se escribe el mensaje en `mensajes` y
     `ultimoMensaje`/`ultimoEn` (el comercio tiene que ver **quién** le escribió), pero
     **ningún contador de facturación se mueve**. La respuesta HTTP es **200** con
     `servicio: { estado: 'cortado', motivo }` (no 409: el 409 de la ingesta significa
     «ficha no activa»).
   - **Con `aplica === false` (observación):** todo sigue como hoy. El corte queda con
     `aplicado: false`; la bitácora **no** recibe `corte_servicio`, la auditoría recibe
     `corte_observado` (una vez por corte).
5. **Sin rechazo y con corte guardado:** `corte: FieldValue.delete()` +
   `camposDerivados`; bitácora `reanudacion_servicio` solo si el corte tenía `aplicado: true`.
6. **Bolsa (dentro del `if (conteo.atencion)`):** `consumoDeConversacion(servicio)`
   descuenta `bolsa` o `bolsaPrueba`; si `cortaDespues`, anota `corte: { motivo:
   'sin_conversaciones', desde, perdidas: 0, aplicado: aplica }`; **este mensaje se atiende**.
7. **Escrituras (1072-1184):** se envuelven en `escribirMensaje(tx, conteo)` para que el
   caso «cortado» escriba solo el mensaje. `avisoConsumo` (1190-1197) no cambia.
8. **Retorno (1199) y respuesta (1264-1271):** se agrega `servicio: { estado, motivo, fase, graciaHasta }`.

**Bitácora y auditoría.** `TipoEvento` (`ingesta.ts:511-544`) suma `'corte_servicio'
| 'reanudacion_servicio' | 'pago_registrado'`. Las tres listas (`ingesta.ts`,
`firestore.rules:2035-2060`, `web/src/lib/bitacora.ts:52-70`) se tocan juntas o
`pruebas/bitacora-tipos.test.ts` rompe. El entrante durante el corte se registra como
`mensaje_entrante` con `resultado: 'rechazado'` y `codigo: 'cortado'`.

#### `configuracionFlujo` (línea 1304 en adelante)

1. `config/negocio` se lee **antes** del `if (comercio.estado !== 'activo')` (1354),
   porque la cortesía ahora lleva `numeroRecepcion`.
2. **Leer siempre `cuenta/estado`, `metricas/{periodo}` y `plataforma/prepago`**, no
   solo con teléfono (1389-1394).
3. `if (!servicio.operativo && corteAplicable(...) && !(servicio.motivo ===
   'sin_conversaciones' && telefono && !ventanaVencida(marcas, ahora)))` → `409 {
   estado: servicio.motivo, mensajeCortesia }`. **Los flujos ya obedecen ese 409.** No
   se toca `atencion.estado`: el corte entra por `¿Comercio operativo?`, que está antes.
4. **En gracia o en observación:** 200 normal, más `prepago: { modalidad, fase,
   motivo, graciaHasta, disponibles, corteAplicado }`. Ningún flujo decide con eso.

**Reactivación en ≤ 60 s:** `configuracionFlujo` no cachea nada hoy, así que el
siguiente turno ya lee la cuenta con `periodoPagado` nuevo.

#### Qué se reutiliza como molde

- **`seguimientos.ts`** para la cobranza: `recordatoriosPrepago` (POST, devuelve lo
  debido hoy para **todos** los tenants con modalidad, autenticado con
  `rutaAutenticada` y `ruta.flujo === 'onboarding'`) y `recordatorioPrepagoEnviado`
  (POST `{ tenantId, clave }`, **marca antes de enviar** en `cuenta.recordatorios[clave]`
  en una transacción que responde `repetido` si ya estaba). Se adopta el criterio de
  `seguimientos.ts:35-39` («un seguimiento perdido es mejor que dos») y **se descarta**
  el de la rama (`marcarRecordatorioPrepago` exigía `idMensaje`, o sea marcaba después).
- **`firma.ts`**: el esquema HMAC de `rutaAutenticada` (`firma.ts:195-200`:
  `sha256(secreto, "${marca}." + cuerpoCrudo)`, ventana de 5 min, `timingSafeEqual`) es
  lo que NovuChat le propone al cobrador para el aviso (§4undecies.5). Se exportan
  `firmaValida` y `VENTANA_MS` (hoy privados, líneas 108 y 112).
- **`dibujoQr.ts`**: **no se usa** (el cobrador entrega PNG). Si el banco algún día
  devuelve la cadena EMV, `imagenDePago` puede redibujar con `dibujarQr`.
- **`atencion.ts`** como molde de módulo puro compartido con la consola
  (`web/src/lib/prepago.ts` reexporta, como `web/src/lib/planes.ts:23-35`).
- **`cobro.ts:200-243` (`imagenDeCobro`)** como molde de `imagenDePago`: pública, por
  ficha al azar de 128 bits, 404 si el pago no está `pendiente`.

#### Qué NO se comparte con `cobro.ts` / `sena.ts` / `cotejo.ts`

Son el comercio cobrándole a su cliente (decisión 2). `prepago.ts`, `pagos.ts`,
`cobrador.ts` y `cobroPrepago.ts` **no importan** `cobro.ts`, `sena.ts`, `cotejo.ts` ni
`qrSimple.ts`; `Pagar.tsx`/`EstadoCuenta.tsx` no importan nada de
`Cobros.tsx`/`Cobro.tsx`. Una prueba de fuente (`pruebas/prepago-separacion.test.ts`,
al estilo de `comportamiento-pantalla.test.ts`) lo exige y busca que ningún texto del
prepago contenga «seña» y ninguno de la seña contenga «mensualidad». Los datos
tampoco se cruzan: `config/{flujo}.cobroReal` y `tenants/{t}/pagos` no se tocan en
una misma Function. El prepago **sí** puede decir «pago confirmado por el banco» (es
el único lugar); la seña **nunca** (prohibición 3).

#### Choques del módulo del 08/09 con `main`

| Función de la rama | Choca con | Resolución |
|---|---|---|
| `PLANES`/`esPlan`/`PLAN_POR_DEFECTO` | `planes.ts:42-108` | se borran; importar |
| `periodoDe` (Bolivia) | `planes.ts:218` (UTC) | se borra; cobertura por instantes |
| `estadoDeServicio` leyendo `PLANES[plan].conversaciones` | `limitesDeCuenta` | se usa la copia |
| `recordatoriosDebidos` con `PLANES[estado.plan].nombre` | `PLANES_ASIGNABLES[plan].nombre` | importar |
| `rechazoPorPrepago` / `ventanaAbierta` | `atencion.ts` ya tiene `ventanaVencida` (`108-111`) | `ventanaAbierta` no se reaplica |
| `topeMensajes24h`, `estadoDelTope`, `limites` | bloques de 25 + umbrales | no se reaplican |
| `salientes`, `distribucion`, `ventanaCerrada` (costos) | otro frente (`Analisis/27` §8) | no se reaplican |
| `estadoPago: 'pendiente'` escrito por `marcarRecordatorioPrepago` | derivados | solo `camposDerivados` lo escribe |
| Aviso del 80 % (`planes.ts:244-270`) | no choca | conviven en la misma transacción |


<!-- movido de admin/DISENO.md §4undecies.4 (25/09/2026, líneas 2265-2327) -->

### 4undecies.4 La bandera de modo observación

**Dónde vive: `plataforma/prepago`** (documento nuevo; `match /plataforma/{documento}`
de `firestore.rules:2117-2120` ya lo cubre: lo lee el propietario, nadie lo escribe
desde el navegador), **más `cuenta/estado.corteActivo` por tenant.**

```
plataforma/prepago
  corteActivo:   false        ← global. Ausente = false. Es el interruptor que la decisión 2 deja apagado
  actualizadoEn, actualizadoPor, motivo
  cobrador: { baseUrl, consumidor: 'novuchat', vigenciaHoras: 72 }   ← §4undecies.5 (no es secreto)
plataforma/prepago/historial/{id}     ← cada cambio de la bandera: { corteActivo, uid, en, motivo, tenantId? }
```

**Por qué las dos.** La global es la compuerta que el prompt exige («A-0 entra a
`main` en modo observación y así se queda hasta que Andres decida»). La de tenant
existe para el ensayo de extremo a extremo con el TENANT de ensayo: se enciende en
uno solo, se observa un ciclo completo, y recién después la global.
`corteAplicable(cuenta, plataforma) = modalidad !== 'demostracion' &&
(plataforma.corteActivo === true || cuenta.corteActivo === true)`. Un `corteActivo:
false` por tenant **no exime**: la exención es `modalidad: 'demostracion'` (o sin
modalidad, o `plan: 'demostracion'`). La lista de excepciones sigue siendo una sola.

**Qué hace apagada.** La ingesta calcula `estadoDeServicio`, escribe `cuenta.corte` con
`aplicado: false`, cuenta `perdidas` y `mensajesPerdidos` («lo que se habría perdido»),
deja auditoría `corte_observado`, y **atiende igual**: `configuracionFlujo` responde
200 y los contadores se mueven como hoy. Encendida: 409 en `configuracionFlujo`, cero
contadores en la ingesta, bitácora `corte_servicio`. Lo único que cambia es `aplica`;
el cálculo es el mismo, que es lo que permite mirar un ciclo entero antes de encender.

**Quién la enciende.** Callable `fijarCortePrepago({ corteActivo, motivo, tenantId? })`,
`exigirPropietario`, escribe el documento y una entrada en `historial` en una
transacción. Sin `tenantId` toca la global; con él, `cuenta/estado.corteActivo` y la
auditoría del tenant (`accion: 'corte_prepago'`). Ningún script con `--aplicar`: es
una decisión, y se quiere que quede quién y cuándo. Encender la global la decide
Andres «después del demo y con un pago confirmado de punta a punta»; Claude la
ejecuta con su OK.

**Cómo se ve en la consola.** Propietario, en `Tenants.tsx`: franja «Prepago en **modo
observación**: los cortes se calculan y no se aplican» (o «Corte **activo** desde el
dd/mm») con el botón que llama a `fijarCortePrepago`; en cada fila `modalidad`, `fase`
y, si hay `corte`, «cortaría por sin_pago desde el dd/mm · N clientes» en gris si
`aplicado: false` y en rojo si `true`. Comercio (`EstadoCuenta.tsx`): `corte` **solo si
`aplicado === true`**; un corte observado no existe para él. La consola importa
`estadoDeServicio` y `corteDe` vía `web/src/lib/prepago.ts` y no calcula nada.

**Pruebas negativas (`pruebas/prepago-ingesta.test.ts`, ingesta real contra el emulador, alias `cliente16`):**

| Caso | Esperado |
|---|---|
| tenant **sin modalidad**, `periodoPagado` vacío, bandera global **encendida** | 200, contadores se mueven, sin `corte` |
| tenant `modalidad: 'demostracion'`, bandera encendida, `consumidas` = 99.999 | igual: nunca se corta |
| tenant `plan: 'demostracion'` sin modalidad | igual |
| tenant `prepago` con `periodoPagado` de hace dos meses, bandera **apagada** | 200, contadores se mueven, `corte.aplicado === false`, `perdidas` sube, auditoría `corte_observado`, bitácora **sin** `corte_servicio` |
| mismo tenant, bandera apagada, `cuenta.corteActivo: false` | ídem (no exime nada, tampoco corta) |
| mismo tenant, `cuenta.corteActivo: true` | 200 con `servicio.estado: 'cortado'`, mensaje escrito, **ningún** contador se mueve, `perdidas` cuenta **una** vez por teléfono, bitácora `corte_servicio` una vez |
| `periodoPagado` = mes anterior, ahora = día 2 a las 23:00 Bolivia, corte activo | `fase: 'gracia'`, se atiende |
| ídem, ahora = día 3 a las 00:01 Bolivia | cortado |
| `configuracionFlujo` con tenant cortado y corte activo | 409 con `mensajeCortesia` que contiene `numeroRecepcion` y **no** contiene «pago», «deuda», «mantenimiento» |
| `configuracionFlujo` con `sin_conversaciones`, corte activo y teléfono con ventana abierta | 200 |
| `fijarCortePrepago` llamada por el admin del tenant | `permission-denied`, documento intacto |
| `fijarCortePrepago` por propietario con sesión de contraseña | `permission-denied` |


<!-- movido de admin/DISENO.md §4undecies.5 (25/09/2026, líneas 2328-2466) -->

### 4undecies.5 El contrato con el cobrador: el real, verificado el 20/09/2026

**El contrato existe y está fusionado** en el proyecto de cobros (PR #38, bloque 1;
documento `docs/10-contrato-consumidores.md`, todavía en la rama `docs/estado-pr-38`
de ese repositorio). A-2 lo consume **tal cual**; el doble
`admin/pruebas/dobles/cobrador.ts` lo reproduce **exactamente**, no una versión
imaginada. Lo que sigue es lo verificado en su código (`packages/functions/src/api/`).

**Identidad.** Consumidor `novuchat`. `Authorization: Bearer <token>`; el token lo
configura el cobrador como `CONSUMIDOR_TOKEN_NOVUCHAT` (mínimo 32 caracteres) y
NovuChat lo guarda en Secret Manager como `COBRADOR_TOKEN` (`defineSecret`, `.value()`
solo en ejecución). Un token de consumidor **no abre** ninguna ruta del dueño, y lo
ajeno responde **404, nunca 403**. Cupo: **60 QR por hora** por consumidor
(`429 CUPO_POR_HORA_AGOTADO`). Base: `plataforma/prepago.cobrador.baseUrl` (no es
secreto), sin barra final; las rutas van bajo `/api/v1/`.

**Montos: texto decimal con punto** (`"150.50"`), nunca número ni centavos.
`monto` en NovuChat es entero en Bs, así que viaja como `String(monto) + ".00"`.
**Fechas** ISO 8601 con zona. **Errores** siempre `{ error: { codigo, mensaje } }`;
se mira `codigo`, que es estable. Sin `telefonoCliente`: no existe en este contrato.
El `concepto` **lo ve el pagador en su app bancaria**: va «NovuChat · <plan> · N
meses», sin nombre del comercio ni datos de persona.

| Operación | Petición | Respuesta |
|---|---|---|
| **`crearCobro`** | `POST /api/v1/cobros` `{ referenciaExterna, concepto (≤100), monto: "150.00", horasDeVigencia: 72 }`. `referenciaExterna` = `pagoId` (letras, números y `: _ . -`, ≤120) | **201** nuevo o **200** ya existía (**mismo cobro, mismo QR**): `{ cobro: { id: "cons-<64 hex>", referenciaExterna, estado, monto, moneda: "BOB", concepto, creadoEn, qr: { version, venceEn, imagenDisponible } \| null, pago: null }, imagenQrBase64 }`. `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA` si se repite la referencia con otro importe; `400 CUERPO_INVALIDO` / `MONTO_INVALIDO`; `429`; `502 PROVEEDOR_RECHAZO` / `QR_SUELTO_EN_EL_PROVEEDOR` (no reintentar con la misma referencia hasta revisar); `503 SERVICIO_NO_DISPONIBLE` (reintentable) |
| **`estadoCobro`** | `GET /api/v1/cobros/:id` o `GET /api/v1/cobros/por-referencia/:referencia` | `{ cobro }` con la misma forma; `pago` **solo** con `CONFIRMADO`: `{ confirmadoEn, ocurridoEn, monto, riel: "api-baneco" \| "scraping-yape" \| null, confirmadoPor: "automatico" \| "revision-manual" }`. No toca el banco: lee el estado que mantiene el satélite |
| **`anularCobro`** | `POST /api/v1/cobros/:id/anular` `{ motivo? }` | `200 { resultado: "ANULADO" }` (repetirlo sobre uno anulado devuelve lo mismo); `409 PAGADO_NO_SE_ANULA` (hay plata: consultar el estado); `409 PAGO_TARDIO_EN_REVISION` (pago sobre QR vencido; lo decide una persona) |
| **`listarCobros`** | `GET /api/v1/cobros?desde&hasta&limite` (ISO con zona; `hasta` exclusivo; rango ≤ 92 días; `limite` 1..100) | `{ desde, hasta, limite, truncado, cobros: [...] }`. Solo para conciliar (mensual, propietario) |
| **imagen del QR** | `GET /api/v1/cobros/:id/qr` | `{ imagenQrBase64, venceEn }`; `404 SIN_IMAGEN`. Viene también en `crearCobro`; sirve para pedirla de nuevo |

**Estados del cobrador y qué hace NovuChat con cada uno:**

| Estado | Significado | Pago de NovuChat |
|---|---|---|
| `BORRADOR` | reservado, el QR no se emitió (falló el banco); `qr: null` | sigue `pendiente`; se reintenta `crearCobro` con la **misma** referencia, que lo retoma |
| `QR_ACTIVO` | se puede pagar | `pendiente` |
| `PAGO_DETECTADO` | el banco reportó un abono; **todavía no conciliado** | `pendiente` (la consola puede decir «el banco detectó un pago y lo está conciliando»); **no se acredita nada** |
| `CONFIRMADO` | plata conciliada; terminal | `confirmado` (la única transición que suma meses) |
| `EN_REVISION` | monto distinto, fuera de vigencia, duplicado; lo mira una persona | `pendiente`; se avisa a NovuChat por auditoría |
| `VENCIDO` | venció sin pago y quedó anulado en el banco | `vencido`; se limpia `pagoPendienteId` |
| `ANULADO` / `RECHAZADO` | terminales | `anulado` |

**Una referencia externa no se recicla:** para volver a cobrar lo mismo se emite un
pago nuevo con otro `pagoId`. **`ENVIADO` y `COMPROBANTE_RECIBIDO` no existen** para un
consumidor. El banco vence los QR **por día**: un cobro vencido en nuestro reloj sigue
pagable hasta la medianoche si no se anula; por eso el barrido anula, no «olvida».

#### El aviso de confirmación (bloque 2 de C, en curso: rama `feat/aviso-de-confirmacion`)

Lo que ese bloque **ya decidió** en su dominio, y NovuChat toma como dado: un aviso por
cobro (clave `cobroId`), reconstruido al enviarlo desde el cobro y su evidencia (no una
copia guardada), reintentos **sin tope** con espera 30 s → 1 min → 5 min → 15 min →
1 h → 6 h → 1 día, y el cuerpo `AvisoDeConfirmacion`:

```
{ evento: "cobro.confirmado", idEvento: <cobroId, estable entre reentregas>,
  consumidorId: "novuchat", cobroId, referenciaExterna, montoCentavos,
  confirmadoEn: ISO, ocurridoEn: ISO | null, riel: "watcher-baneco" | "scraper-yape" | null }
```

Lo que ese bloque **no decidió todavía**, y NovuChat le pide (fila C de
`Prompts/COORDINACION.md`): transporte `POST` a una URL registrada por consumidor
(`https://<región>-<proyecto>.cloudfunctions.net/avisoCobrador`, configurada allá, no
viaja en ninguna petición); cabeceras `X-Firma: sha256=<hex>` y `X-Marca-Tiempo`
(milisegundos desde la época), con `hex = HMAC-SHA256(secreto, "<marca>." + cuerpo
crudo)`, que es byte a byte `firma.ts:198-199`; secreto por consumidor
(`CONSUMIDOR_AVISO_SECRETO_NOVUCHAT` allá, `COBRADOR_AVISO_SECRETO` en Secret Manager
acá; distinto del token de salida: comprometer uno no permite fabricar lo otro);
tolerancia ±5 min (`VENTANA_MS`); respuesta 2xx = entregado. Si C elige otro esquema,
A-2 cambia `verificarAviso` y nada más.

**Del lado de NovuChat (`avisoCobrador`, `onRequest`, `cors: false`):**

- Verifica la firma con `firmaValida` (tiempo constante). Fuera de ventana, firma
  inválida o cuerpo > 64 KiB: `401` sin explicar.
- **El aviso no es fuente de verdad** (lo dice el contrato, §1): después de la firma,
  `avisoCobrador` **llama a `estadoCobro(cobroId)`** con el token de salida y solo si la
  respuesta autenticada dice `CONFIRMADO` aplica el pago. Es la decisión 5 literal:
  aunque el secreto del aviso se filtrara, nadie acredita un mes sin que el cobrador,
  autenticado, lo afirme. El barrido llega al mismo resultado sin aviso.
- Respuesta idempotente: `200 { recibido: true, aplicado: boolean, estado }`. Un aviso
  repetido devuelve `aplicado: false, estado: 'confirmado'` y no suma nada. Un
  `referenciaExterna` desconocido: `200 { recibido: true, aplicado: false, estado:
  'desconocido' }` (para que el cobrador cierre el aviso) y un renglón en el log con
  el `cobroId` (no tiene datos de personas).
- **Qué aplica:** una transacción sobre `pagos/{pagoId}` + `cuenta/estado` +
  `tenants/{t}` (espejo del plan) + `cobrosPendientes/{pagoId}` (se borra):
  `aplicarPago` puro, `camposDerivados`, `corte: delete`, `pagoPendienteId: delete`,
  `estado: 'confirmado'`, `confirmadoPor: { origen: 'banco', cobroId, riel,
  confirmadoPorCobrador, avisoId }`, `montoRecibidoBs` desde `pago.monto`. Después,
  bitácora `pago_registrado` y, si había corte aplicado, `reanudacion_servicio`;
  auditoría `pago_aplicado`; y se encola la confirmación por WhatsApp
  (`cuenta.confirmacionesPendientes[pagoId]`, que `recordatoriosPrepago` devuelve como
  tipo `confirmacion` con la plantilla `pago_confirmado`).

#### El barrido horario

`barridoCobros`: `onSchedule('every 60 minutes')` (`firebase-functions/v2/scheduler`;
exige Cloud Scheduler habilitado, paso de nube tras la compuerta; la lógica vive en
`barrerCobrosPendientes(ahoraMs)` exportada para probarla sin scheduler). Recorre
`/cobrosPendientes` (≤ 500 por corrida), llama `estadoCobro` por cada uno y aplica la
tabla de estados de arriba. Un `QR_ACTIVO` con `venceEn` pasado hace más de 24 h →
`anularCobro` y cierra; si responde `PAGADO_NO_SE_ANULA`, vuelve a consultar y aplica.
Además, `EstadoCuenta.tsx` al abrirse con un `pagoPendienteId` llama a
`consultarPagoPendiente` (callable admin), que hace un `estadoCobro` puntual: es la
«consulta al abrir la pantalla» de `Analisis/36` §6.

#### Anulación al cargar un pago manual

`registrarPagoManual` lee `cuenta.pagoPendienteId`; si hay un pendiente, llama
`anularCobro` **antes** de la transacción: `ANULADO` → sigue y marca el pendiente
`anulado` (`motivoAnulacion: 'pago_manual'`); `409 PAGADO_NO_SE_ANULA` → aborta con
`failed-precondition` «ese QR ya se pagó: se aplica el cobro del banco, no el manual»
y aplica el confirmado por el camino normal; `409 PAGO_TARDIO_EN_REVISION` → aborta y
deja el pendiente para que lo resuelva el cobrador. Si el cobrador no responde:
aborta, no carga nada. Nunca dos pagos vivos por el mismo mes.

#### El QR como imagen PNG

`crearCobro` devuelve `imagenQrBase64`. `crearCobroPrepago` lo decodifica, comprueba
que sea PNG (8 bytes de firma, ≤ 512 KiB) y lo guarda con el SDK Admin en Storage:
`tenants/{t}/pagos/{pagoId}/qr.png`. Dos lectores:

- **La consola** lo lee con el SDK de Storage bajo la regla de §4undecies.7. Muestra
  importe en Bs, USD, TCO y fuente, vencimiento, y «lo puede pagar desde cualquier banco».
- **WhatsApp (A-4)**: Meta descarga desde `…/imagenDePago?f=<fichaQr>`, Function pública
  que busca `cobrosPendientes` por ficha y sirve el PNG con `Cache-Control: public,
  max-age=300` y `nosniff`, **404 si el pago ya no está `pendiente`**. No se pasa al
  vuelo desde el cobrador: cada descarga de Meta sería una llamada autenticada más.

#### Lo que todavía depende de C (bloques 2 a 4)

Sin bloque 2, NovuChat confirma solo por barrido (≤ 1 h) y por la consulta al abrir la
pantalla: **funciona igual, más lento**. Sin bloque 3, todos los cobros van a la cuenta
del proceso del cobrador: para el ensayo hace falta que ese proceso corra con la
cuenta `novuchat`. Sin bloque 4, la API es un proceso local sin URL pública: el ensayo
de punta a punta queda **listo pero sin ejecutar**.


<!-- movido de admin/DISENO.md §4undecies.6 (25/09/2026, líneas 2467-2479) -->

### 4undecies.6 Costo en mensajes, por bloque

| Bloque | Mensajes que agrega | Quién los paga |
|---|---|---|
| **A-0** | **0.** El corte reutiliza el 409 que ya manda la cortesía. Durante un corte aplicado, cada consulta de un cliente final recibe **1** cortesía desde el número del comercio, como hoy con la suspensión; en observación, 0 | comercio (dentro de su franquicia), solo si está cortado |
| **A-1**, **A-2**, **A-3** | 0 | — |
| **A-4** | por pago: **2** (QR con importe y vencimiento; confirmación). Por ciclo de cobranza: **3** plantillas sin corte (D-5 con QR, D-1, D0); **5** con corte (+ D+2, D+4); **1** por `sin_conversaciones`; **1** de conversión en prueba | **NovuChat**, desde su número y su franquicia de 1.000: a 100 clientes, unos 500 mensajes al mes, dentro de la franquicia. Coherente con `Analisis/36` §5.1 (≈ 0,045 USD por cliente y mes sin corte, ≈ 0,07 con corte, 0 de comisión) |
| **A-5** | 0 (son las plantillas de A-4, presentadas a Meta) | — |

Optimización pendiente y no incluida: durante un corte aplicado, mandar la cortesía
**una vez por teléfono y por 24 h** en vez de una por mensaje. Se decide después de
ver `mensajesPerdidos` reales.


<!-- movido de admin/DISENO.md §4undecies.7 (25/09/2026, líneas 2480-2560) -->

### 4undecies.7 Reparto por archivos y pruebas

Alias de secreto libres para las suites nuevas (usados: `cliente17` a `cliente20`):
**A-0 usa `cliente16`, A-2 `cliente15`, A-4 `cliente14`**.

#### A-0 — `prepago/modulo-y-cortes`

| | |
|---|---|
| **Crea** | `admin/functions/src/prepago.ts` (puro, reaplicado con §4undecies.3); `admin/functions/src/cobranza.ts` (`recordatoriosPrepago`, `recordatorioPrepagoEnviado`, molde `seguimientos.ts`); `admin/web/src/lib/prepago.ts` (reexporta); `admin/scripts/migrar-prepago.mjs` (seco por defecto) |
| **Modifica** | `ingesta.ts`: `Promise.all` (1027), condición de `metricasDoc` (1053), bloque de decisión tras 1058, `escribirMensaje`, retorno (1199) y respuesta (1264); `configuracionFlujo`: orden de lectura de `config/negocio` (1354/1374), lecturas de cuenta/métricas/plataforma (1389-1394), 409 del corte, campo `prepago`; `TipoEvento` (511-544). `index.ts`: exports; `actualizarEstadoCuenta` acepta `modalidad`, `periodoPrueba`, `corteActivo` y recalcula `camposDerivados` (607-663); nueva `fijarCortePrepago`. `firestore.rules`: tipos de bitácora (2035-2060). `web/src/lib/bitacora.ts:52-70`. `ESTADO.md`, `CLAUDE.md` §7 fila «Conversaciones incluidas» |
| **Pruebas nuevas** | `pruebas/prepago.test.ts` (pura: períodos, gracia hora por hora en los bordes, `estadoDeServicio` por modalidad, `aplicarPago` mes por mes incluidos 6 meses con bolsa de regalo y tope 6, `recordatoriosDebidos` día por día D-5..D+4 e idempotencia por clave, `mensajeCortesia` con y sin número y sin «pago»/«mantenimiento», `PLANTILLAS` sin voseo); `pruebas/prepago-ingesta.test.ts` (tabla de §4undecies.4, más: contadores idénticos a hoy con modalidad ausente; `sin_conversaciones` descuenta `bolsa` y no corta la ventana abierta); `pruebas/prepago-configuracion.test.ts` (409 con teléfono de recepción; 200 en gracia; 200 con demostración); `pruebas/cobranza.test.ts` (lista solo tenants con modalidad; nunca demostración; prueba solo `conversion`; marcar antes: segunda llamada `repetido`; tenant sin `telefonosPago` va en `sinTelefono`) |
| **Modifica pruebas** | `estado-cuenta.test.ts` (+ modalidad cerrada; `corteActivo` solo booleano) |
| **Necesita** | nada. Entra a `main` en observación |

#### A-1 — `prepago/pagos-y-carga-manual` (sobre A-0)

| | |
|---|---|
| **Crea** | `admin/functions/src/pagos.ts`: `aplicarPagoEnTransaccion(tx, refs, pago, confirmacion)` (**la única puerta que suma meses o bolsas**; A-2 la llama dentro de su transacción), `camposDerivados`, `registrarPagoManual` (propietario; exige `medio`, `referencia`, `tcoAplicado`/`tcoFuente`/`tcoFecha`, `montoRecibidoBs`, `evidencia` si transferencia, comprobando que el objeto exista en Storage; `motivoDiferencia` si difiere; anula el QR vivo vía `cobrador.anularCobro` si existe), `anularPagoPendiente` (admin del tenant o propietario), `fijarTelefonosPago` (admin), `consultarPagoPendiente` (admin). `admin/functions/src/tipoCambio.ts`: `tipoCambioDelDia()` lee `plataforma/tipoCambio { tco, fecha, fuente }`, lanza `SinTipoDeCambio` si falta o `fecha` tiene más de 4 días (fines de semana del BCB). `admin/scripts/fijar-tipo-cambio.mjs` (de la rama, con `fecha` diaria). Reglas `/pagos` y `/cobrosPendientes`. Storage: `match /tenants/{tenantId}/pagos/{pagoId}/{archivo}` con `archivo in ['qr.png','evidencia.jpg','evidencia.png','evidencia.pdf']`, `get` para admin legible o propietario, `create/update` de `evidencia.*` solo `esPropietario()` con tipo y tamaño (≤ 5 MB imagen, ≤ 10 MB PDF), `list`/`delete` `false`, `qr.png` solo lo escribe el Admin SDK |
| **Modifica** | `index.ts:314, 353` (quitar `estadoPago`); `536-563` (rechazar los derivados); `115-121` (`exigirAdminDe` con proveedor); exports. `firestore.rules`, `storage.rules`, `web/src/lib/cuenta.ts` (`pendiente` = «En gracia / cobro pendiente»). `ESTADO.md` |
| **Pruebas nuevas** | `pruebas/pagos.test.ts` (callables reales con `.run()`): el admin **no** puede `registrarPagoManual` ni en su comercio; propietario con contraseña no; sin TCO válido no registra; transferencia sin evidencia no; evidencia declarada que no existe en Storage no; importe distinto sin motivo no; confirmado no se anula; segundo pendiente con uno vivo → `failed-precondition` y devuelve el vivo; `anularPagoPendiente` del admin de B sobre A → `permission-denied`; `suspenderTenant` ya no toca `estadoPago`; `fijarTelefonosPago` rechaza > 5 y formatos malos. `pruebas/reglas.test.ts` sección «Pagos del prepago» (tabla de §4undecies.1). `pruebas/storage-reglas.test.ts` sección «Evidencia de pagos». `pruebas/tipo-cambio.test.ts` |
| **Modifica pruebas** | `estado-cuenta.test.ts:146-158` (ahora rechazan) |
| **Necesita** | A-0. `registrarPagoManual` llama a `anularCobro` solo si `cobrador.ts` existe: A-1 lo define como inyección (`anular: (cobroId) => Promise<Resultado>`) y A-2 la enchufa |

#### A-2 — `prepago/cliente-cobrador` (en paralelo con A-1, contra el doble)

| | |
|---|---|
| **Crea** | `admin/functions/src/cobrador.ts`: cliente HTTP del contrato real (`fetch` nativo de Node 22; `crearCobro`, `estadoCobro`, `estadoPorReferencia`, `anularCobro`, `listarCobros`, `imagenQr`; timeout 10 s; `defineSecret('COBRADOR_TOKEN')`, `defineSecret('COBRADOR_AVISO_SECRETO')`; `verificarAviso(peticion)` con `firmaValida`/`VENTANA_MS` de `firma.ts`; tipos de estado y códigos de error del contrato, y nada más). `admin/functions/src/cobroPrepago.ts`: `crearCobroPrepago` (callable, admin del tenant o propietario; TCO del día; pendiente único; `concepto` sin datos del comercio; guarda `qr.png`; escribe `cobrosPendientes`; reintenta con la misma referencia si el cobrador devolvió `BORRADOR`), `avisoCobrador` (`onRequest`, `cors: false`), `barridoCobros` (`onSchedule` + `barrerCobrosPendientes` exportada), `imagenDePago` (`onRequest` pública por ficha). `admin/pruebas/dobles/cobrador.ts`: doble en memoria que implementa **exactamente** §4undecies.5 (rutas `/api/v1/…`, 201/200 por referencia, `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA`, `429`, `PAGADO_NO_SE_ANULA`, `PAGO_TARDIO_EN_REVISION`, `SIN_IMAGEN`, 404 para lo ajeno, montos como texto, `firmarAviso(secreto, cuerpo, marcaMs)`), inyectable por `process.env['COBRADOR_DOBLE']` o por parámetro; se descarta cuando C exista |
| **Modifica** | `firma.ts` (exportar `firmaValida` y `VENTANA_MS`; nada más); `index.ts` (exports); `firestore.rules` (`/cobrosPendientes` deny si A-1 no lo puso); `.github/DESPLIEGUE-FIREBASE.md` (los dos secretos y la condición `COBRADOR_`) |
| **Pruebas nuevas** | `pruebas/cobrador-doble.test.ts` (el doble cumple el contrato: mismo `id` ante la misma referencia; otro importe → 409; anular pagado → `PAGADO_NO_SE_ANULA`; lo ajeno → 404). `pruebas/cobro-prepago.test.ts` (emulador + doble, alias `cliente15`): crear deja `pendiente`, `pagoPendienteId`, `cobrosPendientes`, `qr.png`; segundo crear → `failed-precondition` con el vivo; el admin de B **no** crea cobro en A; aviso bien firmado y doble en `CONFIRMADO` → `confirmado`, `periodoPagado` +N, `corte` borrado, `pagoPendienteId` borrado, bitácora `pago_registrado`; **aviso bien firmado pero doble en `QR_ACTIVO` o `PAGO_DETECTADO` → no aplica** (el aviso no confirma); firma inválida → 401 y nada cambia; marca fuera de ±5 min → 401; aviso repetido → `aplicado: false` y meses no se duplican; sin aviso, `barrerCobrosPendientes` confirma; `VENCIDO` → `vencido` y limpia; `registrarPagoManual` con QR vivo → lo anula primero; con `PAGADO_NO_SE_ANULA` → aplica el del banco y rechaza el manual; `imagenDePago` con ficha de pago confirmado → 404 |
| **Necesita** | la firma de `aplicarPagoEnTransaccion` y `camposDerivados` de A-1 (acordadas por este documento; A-2 desarrolla contra un stub y se integra cuando A-1 esté en `main`). Y la compuerta del demo para los secretos y el Scheduler |

#### A-3 — `prepago/consola-pagar` (con A-1 en `main`)

> **Estado al 23/09/2026: A-3 se parte en dos ramas.** La primera,
> `prepago/consola-pagar`, es **la mitad del comercio** y está hecha: «Pagar»
> con plan, meses, bolsas e instalación; importe en USD y en Bs con el TCO del
> día y su fuente; el QR por ficha; «ya pagué» y «cancelar»; historial de
> pagos; la cobertura, la gracia y `perdidas` en «Cuenta»; y la columna de
> corte en la cartera (en gris si es observado). La segunda, la **mitad del
> propietario** (`CuentaNegocio.tsx`: modalidad, plan, umbrales, suspender y
> reactivar, carga manual con evidencia, botón de `fijarCortePrepago`), es
> íntegramente las fases 1-2 de `Analisis/29` y va en su propia rama: son dos
> jornadas y ninguna de las dos mitades necesita a la otra para entrar.
>
> Dos desviaciones del plano de abajo, y por qué:
> - **No hay callable `cotizarPago`.** La pantalla lee `plataforma/tipoCambio`
>   con una regla nueva y acotada (`allow get: if request.auth != null` sobre
>   ESE documento) y arma el importe con `importeBs`, la misma función del
>   servidor. Una callable más para leer un dato público es una Function más
>   que desplegar, y el TCO del BCB no es de nadie.
> - **El QR no sale de Storage**, sale de `imagenDePago` por la ficha opaca que
>   ya devuelve `consultarPagoPendiente` (A-2). Es la única forma de ponerlo en
>   un `<img src>`, y la Function devuelve 404 en cuanto el cobro se cierra.

| | |
|---|---|
| **Crea** | `admin/web/src/paginas/Pagar.tsx` (plan, meses 1-6, bolsas; importe USD y Bs con TCO y fuente **leídos del servidor** vía `cotizarPago` callable o de `plataforma/tipoCambio`; el QR desde Storage; «cancelar y emitir otro»); `admin/web/src/paginas/CuentaNegocio.tsx` (propietario, fases 1-2 de `Analisis/29`: modalidad, plan, umbrales, suspender/reactivar, **cargar pago manual** con subida de evidencia, historial de `/auditoria` y de `/pagos`, bandera por tenant); `admin/web/src/componentes/HistorialPagos.tsx` |
| **Modifica** | `EstadoCuenta.tsx` (botón Pagar, `fase`/gracia, `corte.perdidas` solo si `aplicado`, historial, `telefonosPago` editable por el admin vía callable); `Tenants.tsx` (franja de modo observación, columnas modalidad/fase/corte, botón `fijarCortePrepago`); `Tablero.tsx:352,490` (derivados; sin cambio de nombre); `App.tsx` (rutas `/negocio/:tenantId/cuenta/pagar`, `/negocio/:tenantId/cuenta-novuchat`); `web/src/lib/prepago.ts` |
| **Pruebas nuevas** | `pruebas/prepago-pantalla.test.ts` (lectura de fuentes): `Pagar.tsx` y `EstadoCuenta.tsx` **no importan** `cobro`, `sena`, `Cobros`, `Cobro`; ningún texto contiene «seña»; el importe en Bs **no se calcula en la pantalla**; `perdidas` se pinta condicionado a `aplicado`; `Tenants.tsx` llama a `fijarCortePrepago` y no escribe `plataforma/`. `pruebas/indices.test.ts` si `pagos` necesita orden compuesto (no debería) |
| **Necesita** | A-1 (callables y regla), A-2 para el QR real (hasta entonces «cobro no disponible») |

#### A-4 — módulo de `Flujos/src/` (encolado detrás de B-1): la interfaz que necesitará

El número de NovuChat (ruta con `flujo: 'onboarding'`, tenant `novuchat`) autentica
como hoy con `X-NovuChat-Numero` + token. Functions que el módulo llama, todas
autenticadas con `rutaAutenticada` y `ruta.flujo === 'onboarding'`:

| Function | Cuerpo | Devuelve |
|---|---|---|
| `pagoPorWhatsapp` (POST) | `{ telefono, accion: 'menu' \| 'estado' \| 'pagar', tenantId?, plan?, meses? (1\|3\|6), bolsas? }` | `{ conocido: false }` si el teléfono no está en ningún `cuenta/estado.telefonosPago`; `{ elegir: [{ tenantId, nombre }] }` si está en varios y no vino `tenantId` (nunca se infiere de un nombre); `{ tenantId, resumen, estado: { fase, cubiertoHasta, disponibles, corte }, pago?: { pagoId, descripcion, monto, venceEn, qrUrl } }`. `qrUrl` = `imagenDePago?f=<ficha>`; el flujo la pone en `image.link` y el `caption` con importe y vencimiento. Un solo mensaje |
| `recordatoriosPrepago` (POST) | `{}` | `{ recordatorios: [{ tenantId, telefono, clave, tipo, plantilla, parametros[], qrUrl? }], confirmaciones: [{ tenantId, telefono, pagoId, plantilla, parametros[] }] }` |
| `recordatorioPrepagoEnviado` (POST) | `{ tenantId, clave }` **antes** de enviar | `{ marcado, repetido }` |
| `configuracionFlujo` | como hoy | sin cambios |

El módulo reporta cada saliente a la ingesta del número de NovuChat como hoy. El
disparador programado corre cada hora (las plantillas salen entre 09:00 y 19:00
Bolivia; la lista lo filtra en el servidor).


<!-- movido de admin/DISENO.md §4undecies.8 (25/09/2026, líneas 2561-2593) -->

### 4undecies.8 Contradicciones entre `Analisis/36` y el código de hoy, y su resolución

| # | Dónde | Qué dice | Qué hay | Resolución |
|---|---|---|---|---|
| 1 | `Analisis/36` §1.1, `Analisis/29` §2.4 | `actualizarEstadoCuenta` pisa campos; fase 0 pendiente | ya es parcial (`index.ts:509-516, 533`) | fase 0 = rechazar los derivados (`536-563`), `suspender`/`reactivar` sin `estadoPago` (`314`, `353`), `exigirAdminDe` con proveedor (`115-121`) |
| 2 | `Analisis/36` §1.1, `Analisis/29` §2.5 | TCO **mensual** en `plataforma/tipoCambio.periodo` | decisión 6: TCO del **día de emisión** | `tcoFecha` (`aaaa-mm-dd`) en el pago y en `plataforma/tipoCambio`; no se emite con un TCO de más de 4 días |
| 3 | `Analisis/36` §1.2 y prompt de C; prompt coordinador («se comparte `dibujoQr.ts`») | el QR viene como «texto e imagen» | el banco devuelve **solo PNG** | el contrato entrega `imagenQrBase64`; `dibujoQr.ts` no se usa; pregunta abierta al banco anotada en el proyecto de cobros |
| 4 | `Analisis/36` §4.2 | «el teléfono tiene que estar en `usuarios` del comercio con rol admin» | `/miembros` no tiene teléfono; `/contactos` es «personas de referencia» | `cuenta/estado.telefonosPago` (≤ 5), fijado por el admin por callable auditada |
| 5 | `Analisis/36` §3.1 | D0 «venció hoy», corte «D+2 00:00», gracia 48 h | ambiguo | **D0 = día 1, 00:00 Bolivia; corte 00:00 del día 3** |
| 6 | `Analisis/36` §4.1 y §1.2 | referencia `tenant/periodo/pagoId` | decisión 3 (opaca) y el contrato real (sin `/`) | `pagoId` solo (128 bits al azar); resolución por `/cobrosPendientes` |
| 7 | `Analisis/36` §4.1, §1.2 y `Prompts/prepago-estricto.md` bloque 2 | «importe en centavos» | el contrato real pide **texto decimal** `"150.00"` | `cobrador.ts` convierte; NovuChat guarda entero en Bs |
| 8 | `Analisis/36` §7 fila 1 | «esta es la vez que se abre la transacción» | la seña y los seguimientos ya la abrieron (`ingesta.ts:1060-1070`) | el prepago se cuelga de las lecturas que ya existen; no abre otra |
| 9 | `CLAUDE.md` §7 tabla | «Conversaciones incluidas: Hecho en la rama de prepago» | no está en `main` | A-0 lo pone en modo observación; la fila se corrige |
| 10 | rama `prepago.ts` | `PLANES` `base/crecimiento/corporativo`; `periodoDe` Bolivia | `planes.ts:76-80`; `periodoDe` UTC (`218`) | §4undecies.3 |
| 11 | rama `cuentas.ts`/`cobroPrepago.ts` | `confirmarPago` por el propietario mirando un comprobante por WhatsApp | decisión 5 | no se reaplican |
| 12 | rama `cobroPrepago.ts` | marcar el recordatorio **después** de enviar | `seguimientos.ts:35-39` marca **antes** | se adopta «antes» |
| 13 | `Analisis/36` §3.3 | «el aviso del 80 % es el D-5 de `sin_conversaciones`» | el aviso del 80 % **no manda WhatsApp** (`planes.ts:122-127`) | se mantiene solo en consola; si se quiere por WhatsApp es +1 plantilla y se decide con el costo a la vista |
| 14 | `Analisis/36` §2.2 | «a partir de 6 meses, una bolsa de regalo» con tope 6 | — | «al pagar 6 meses» |
| 15 | `Analisis/36` §2.3 | subir de plan a mitad de mes, prorrateado | no está en ningún bloque | pendiente; hoy «cambiar de plan» es pagar el nuevo desde el mes que cubre |
| 16 | `Analisis/36` §4.1 paso 4 | «la pantalla cambia sola» | `EstadoCuenta.tsx` ya usa `onSnapshot` (línea 46) | se cumple sin nada nuevo |
| 17 | `Analisis/36` §4.2 | «al confirmar el banco, el mismo número escribe» | ninguna Function manda WhatsApp (`Analisis/35` pendiente) | se encola en `confirmacionesPendientes` y lo manda el flujo programado de A-4 en ≤ 1 h; la reactivación del servicio sigue siendo ≤ 60 s |
| 18 | `Analisis/36` §1.2 y prompt de C | «lo que falta para que otro producto la consuma» | bloques 0 y 1 de C **fusionados** el 20/09 | A-2 consume el contrato real; el doble lo reproduce |

**Reglas que no se discuten, verificadas contra este diseño:** nada bancario en
NovuChat (solo `fetch` a un contrato); confirman el banco (vía `estadoCobro`
autenticado) o el propietario con evidencia en Storage y auditoría; seña y prepago
separados en credenciales, colecciones, pantallas y textos, con prueba de fuente;
multi-tenant probado negando en reglas, Storage y callables; límites en el servidor
(meses ≤ 6, pendiente único, TCO obligatorio, `telefonosPago` ≤ 5); precios USD, cobro
Bs al TCO del BCB del día de emisión guardado en el pago; PRUEBA sin cobranza;
demostración no se corta; el mensaje al cliente final nunca dice «pago» ni
«mantenimiento»; identificadores por últimos 4 en logs; ningún secreto en el repositorio.


<!-- movido de admin/DISENO.md §4quindecies (25/09/2026, líneas 2902-2933) -->

## 4quindecies. La consola nunca da un mensaje genérico: resalta el campo

**Política, decidida el 19/09/2026 por Andres**, después de que un
administrador con todo lo demás bien no pudiera guardar su QR: la pantalla le
escribía una lista suelta debajo del botón —«Tienes que confirmar que…»— y él
tenía que adivinar cuál de los ocho controles era. Dos de esos controles eran
casillas que ni siquiera se veían sin bajar.

**La regla, para toda la consola:**

1. **Todo problema sabe a qué campo pertenece.** El servidor no devuelve
   cadenas sueltas: devuelve `{ campo, texto }`. Si un problema no corresponde
   a ningún control —se cayó la red, falta permiso— no se mezcla con los
   demás: va aparte, al pie, porque no hay nada que el usuario pueda tocar.
2. **El campo se resalta**, con `aria-invalid` y el mensaje debajo del control
   (`.campo-error`, `aria-describedby`), no solo en un resumen lejano.
3. **El foco va al primer campo que falta**, y se desplaza hasta él: en un
   formulario largo, un aviso fuera de la pantalla no existe.
4. **El resumen de arriba nombra el campo**, con el mismo rótulo que se ve en
   la pantalla: «Se puede usar muchas veces: tienes que confirmar…».

Cubierto por `pruebas/qr.test.ts` («Cada problema dice a qué campo pertenece»),
que exige que TODO problema de cualquier QR traiga un campo conocido: un
mensaje nuevo sin campo rompe la suite, que es como se sostiene una política.

Lo mismo vale al revés: **no se le pide al comercio un dato que se puede
deducir**. Las coordenadas del pin se pedían en dos campos, con la instrucción
de hacer clic derecho en Google Maps; nadie iba a hacerlo. Se sacan del enlace
que el comercio ya pega (`functions/src/mapa.ts`), y la pantalla solo informa
si quedaron detectadas.
