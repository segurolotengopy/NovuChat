# Conversaciones: la búsqueda, los no leídos y la pantalla nueva (H1 en `main`; H2 en construcción)

Zona **Core** (ingesta, normalización, callable) y **Central** (pantalla y bandera),
con scripts de **Plataforma**. Este documento describe lo que **hay en `main`**,
con `archivo:línea` leído en `origin/main` (`dd3ab137`, 16/10/2026); no repite el
contrato de H2, al que apunta al final. Lo que no se pudo comprobar desde el
repositorio está en la sección «Lo que este documento no afirma».

La unidad es la **conversación**, nunca la «atención» (`CLAUDE.md`, vocabulario).
Costo de todo H1: **0 mensajes por conversación**, ni una lectura ni una
escritura de Firestore más por mensaje en la ingesta (los campos nuevos van en los
`create`/`set` que ya existían).

## 1. Qué es H1 y dónde llegó

H1 es la pantalla real de Conversaciones (lista y hilo al estilo de WhatsApp Web,
con búsqueda por teléfono, nombre y palabra, filtros y no leídos), **sin** Tomar,
Devolver ni campo para escribir: eso es H2. Se construyó en siete piezas y cada
una está en una etiqueta de producción:

| Pieza | PR (merge) | Qué trae | Etiqueta |
|---|---|---|---|
| H1-1 | #467 (`b7530103`) | `core/conversacion/normalizacion.ts` | `v0.15.0` |
| H1-2 | #469 (`ef61926c`) | reglas, los tres índices y las dos exenciones | `v0.15.0` |
| H1-3 | #477 (`51bc95dd`) | pantalla nueva detrás de la bandera `consolaConversaciones` | `v0.15.0` |
| H1-4 | #479 (`1b717f4b`) | `derivados.ts`, `acceso.ts` y `buscarConversaciones.ts` (todavía sin exportar) | `v0.15.0` |
| (aparte) | #485 (`09587bc7`) | el carrito web escribe los derivados (§3) | `v0.15.0` |
| H1-5 | #489 (`9f351f28`) | scripts de la bandera y del relleno | `v0.15.1` |
| H1-6 | #492 (`712bb490`) | la ingesta escribe los derivados y `index.ts` exporta `buscarConversaciones` | `v0.15.2` |

Las etiquetas apuntan a `fcd39fab` (`v0.15.0`, #490), `9f351f28` (`v0.15.1`) y
`712bb490` (`v0.15.2`). La pertenencia de cada PR a su etiqueta se comprobó con
`git merge-base --is-ancestor`. En GitHub Actions, el trabajo `desplegar-produccion`
de las tres corridas terminó en `success` el 12/10/2026 (UTC). **Hasta `v0.15.2` la
callable no existía en producción**: H1-4 la trajo sin exportarla y H1-6 la exportó
(`admin/functions/src/index.ts:97`).

## 2. Los campos derivados

Los escribe el Core para **todos** los comercios, inertes para el flujo del cliente
(decisión P1 de Andres, 09/10/2026: Bellido recibe los campos; no recibe ni el
relleno ni la bandera, §8).

**Documento de la conversación** (`tenants/{t}/conversaciones/wa_<teléfono>`),
calculado por `camposDeConversacionPorMensaje`
(`admin/functions/src/core/conversacion/derivados.ts:73`):

| Campo | Cuándo | Qué es |
|---|---|---|
| `telefonoTrozos` | siempre | todos los finales del teléfono de 4 dígitos o más (`trozosDeTelefono`, `normalizacion.ts:121`) |
| `nombrePalabras` | si el nombre del contacto deja palabras | hasta 6 raíces (`MAX_PALABRAS_CONSULTA`) |
| `ultimoEntranteEn`, `ventanaVenceEn` | **solo un entrante** | el instante y ese instante más 24 h (`VENTANA_HORAS`); los dos nacen del mismo `ahoraMs` |
| `noLeidos`, `sinLeer` | **solo un entrante** | `increment(1)` y `true` |

Reglas que hay detrás, cada una con prueba que la niega
(`admin/pruebas/core/conversacion-derivados.test.ts`,
`admin/pruebas/core/ingesta-conversaciones.test.ts`):

- **La ventana la mueve solo un mensaje del cliente** (D8). Lo que el negocio
  escribe no renueva la ventana de 24 h de Meta. Un reloj que no sea finito o se
  salga del rango de un `Timestamp` omite los dos campos de ventana y conserva el
  resto: no tira abajo la ingesta (`derivados.ts:73-89`).
- **Contestar no es leer** (D7). Un saliente nunca toca `noLeidos` ni `sinLeer`.
  La persona del negocio solo puede bajarlos a `0` y a `false` (reglas, §6).
- **La dirección rara cuenta como entrante en la ingesta.** `normalizar` ya
  convierte todo lo que no es exactamente `'saliente'` en `'entrante'`
  (comportamiento de siempre, que mueve la facturación); la protección de
  `derivados.ts` para direcciones raras no actúa por ese camino
  (`ingesta.ts:1079-1084`).

**Documento del mensaje** (`.../mensajes/{id}`), calculado por
`camposDeMensajeIndexado` (`derivados.ts:97`): `tenantId` (siempre, igual al
segmento de la ruta; es lo que acota la búsqueda entre comercios) y `palabras`
(hasta 30, omitido si el texto no deja ninguna). **No guarda el texto otra vez**:
el texto completo sigue siendo el de siempre.

## 3. La ingesta que los escribe

Todo en `admin/functions/src/ingesta.ts`, dentro de la transacción que ya existía:

- Import de las dos funciones: `ingesta.ts:30`.
- `derivadosDeConversacion` (`ingesta.ts:1098-1111`), usada en las dos ramas:
  el `tx.set` del **corte aplicado** (`ingesta.ts:1132-1141`, la persona del
  negocio tiene que ver quién le escribió aunque el asistente no atienda) y el
  `tx.set` **normal** (`ingesta.ts:1219`, `...derivadosDeConversacion()` en
  `ingesta.ts:1267`).
- `escribirMensaje` (`ingesta.ts:1113-1124`): `camposDeMensajeIndexado(mensaje.texto, tenantId)`,
  con `tenantId` de la **ruta autenticada**, nunca del cuerpo. El id del mensaje
  sigue siendo el automático de 20 caracteres, y la búsqueda lo exige.
- **El reloj no retrocede** (`ingesta.ts:1085-1107`). `ahoraMs` se toma antes de la
  transacción y no cambia al reintentarla; si ya hay un `ultimoEntranteEn` más
  nuevo (un choque entre mensajes simultáneos) se conserva el mayor. Solo cuenta
  un `Timestamp` de verdad y un previo que adelante al reloj **más de 5 minutos**
  se ignora como dato malo (`MARGEN_RELOJ_MS`).
- **Un nombre nuevo sin palabras borra el viejo** (`ingesta.ts:1108-1110`): con
  `merge: true`, un contacto que pasa de «María Pérez» a un emoji dejaría las
  palabras de antes y la búsqueda lo hallaría por un nombre que ya no tiene. El
  campo se borra con `FieldValue.delete()`. Va en la ingesta y no en
  `derivados.ts` para no romper la paridad con el relleno.
- **La respuesta a n8n no cambia**: tiene exactamente las mismas claves de siempre
  en entrante, saliente y cortado
  (`pruebas/core/ingesta-conversaciones.test.ts`, «lo que NO cambia»).

- **La línea del último entrante (H2-3b)**: la ingesta escribe `phoneNumberId` en la conversación SOLO con un
  entrante (se mueve junto con `ultimoEntranteEn`: la ventana de Meta es por par número-cliente); un saliente no
  lo toca ni lo borra ni lo crea. Va en el mismo `tx.set` de los derivados y sale de la ruta autenticada, nunca
  del cuerpo (dígitos de 6 a 25). Las reglas lo toleran en `conversacionValida` pero se lo prohíben al token de
  ingesta por SDK cliente. `enviarComoPersona` sale por esa ruta (del mismo comercio y activa); si no
  corresponde, o el valor está malformado, o cambió entre la lectura y la transacción, rechaza sin enviar. Las
  conversaciones anteriores no lo tienen y se ven con la regla de antes (exactamente una ruta activa).
  **Costo**: ingesta, 0 lecturas y 0 escrituras extra; envío, +1 lectura de la conversación.

**Segundo escritor: el carrito web.** `modulos/catalogo-web/catalogoWeb.ts:1217-1237` (#485) escribe en
el mensaje `order` los campos `tenantId` y `palabras`, y en la conversación
`noLeidos`, `sinLeer` y `telefonoTrozos`, pero **no** `ultimoEntranteEn` ni
`ventanaVenceEn`: un carrito web no abre ni renueva la ventana de 24 h de Meta.

**Las reglas de Firestore no ven estos campos.** `conversacionValida()` y
`mensajeValido()` (`admin/firestore.rules:1879` y `:1956`) listan con `hasOnly`
los campos permitidos y no nombran los derivados. No importa hoy porque la ingesta
y el carrito escriben con el SDK Admin, que no pasa por las reglas; sí importaría
si algún día un cliente con reglas tuviera que escribir esos documentos.

## 4. La normalización congelada

`admin/functions/src/core/conversacion/normalizacion.ts` es la **única** regla que
convierte un teléfono en trozos y un texto en palabras, y se usa en cuatro
lugares: la ingesta, la callable, la consola y los scripts de relleno. Por eso
vive en Core, **sin `import`, sin `enum` y sin `namespace`** (los `.mjs` la cargan
con `--experimental-strip-types`, sin empaquetador; la prueba
`pruebas/core/conversacion-normalizacion.test.ts` lo hace cumplir).

Constantes (`normalizacion.ts:38-52`): `VENTANA_HORAS = 24`, `POR_VENCER_HORAS = 6`,
`MINIMO_DIGITOS = 4`, `MAX_PALABRAS_POR_MENSAJE = 30`, `MAX_PALABRAS_CONSULTA = 6`,
`MAX_LARGO_PALABRA = 40`, `MAX_RESULTADOS_BUSQUEDA = 20`, prefijo de país por
defecto `591`.

**Regla congelada desde H1-6** (`normalizacion.ts:21-24`): cambiar `raizDe`
(`:79`), `normalizarTexto` (`:65`, NFKD, minúsculas y sin marcas) o `palabrasDe`
(`:99`) deja sin hallar todo lo ya indexado, y cambiarla **exige rellenar los
mensajes guardados**. La prueba de corpus fijo la congela.

- **`raizDe`** quita la «s» final y luego la «e» final, cada paso solo si la palabra
  queda con más de 3 letras: «alfajor»/«alfajores» y «chocolate»/«chocolates»
  coinciden; «mes», «pan» y «dos» no se acortan.
- **Tope de 40 caracteres por palabra** (`normalizacion.ts:47-48` y `:105`; se
  agregó en la ronda de seguridad de H1-6, `02df24b6`). La normalización NFKD puede
  engordar un carácter («ⅷ» pasa a «viii»); sin tope, un texto de 4.096 de esos
  daría una «palabra» de 16.384 caracteres que iría al documento del mensaje y
  chocaría con el límite de un valor indexado. Una palabra de más de 40 letras
  **no se indexa ni se busca**; como la búsqueda usa la misma función, tampoco
  halla nada.
- **Dos cambios a propósito frente al prototipo** (`normalizacion.ts:13-19`):
  `raizDe` también quita la «e», y `normalizarTexto` usa NFKD en vez de NFD.

## 5. La callable `buscarConversaciones`

`admin/functions/src/core/conversacion/buscarConversaciones.ts`, región `us-east1`.
Existe porque la **palabra** dentro de los mensajes obliga a un `collectionGroup`
sobre todas las conversaciones del comercio, y abrir una regla `{path=**}/mensajes`
dejaría a cualquier cuenta autenticada preguntar por los mensajes de otro comercio
(decisión D3). Esa regla **no existe**, y esta callable es la única puerta. Teléfono
y nombre se buscan desde la consola, directo a Firestore, bajo `/tenants/{t}`.

- **Entrada** `{tenantId, texto, cursor?}`; el servidor ignora cualquier otra clave
  (el envoltorio `onCall` está en `:288-298`; `atender`, en `:313`, solo lee las claves que usa). Texto de 1 a 100 caracteres con al menos una palabra de 3
  letras (`MAX_TEXTO`, `:135`).
- **Salida** `{palabras, resultados:[{conversacionId, telefono, mensajeId, ts,
  direccion, fragmento}], cursor}` (`:155-169`). Nunca el texto completo: un
  fragmento de hasta 100 caracteres (`ANCHO_FRAGMENTO`, `:137`).
- **La consulta** (`CONSULTA_PALABRAS`, `:126`; armada en `:379-383`):
  `collectionGroup('mensajes')` con `tenantId == el pedido`, `array-contains` de la
  palabra **más larga** (`palabraParaIndice`), orden `ts` descendente y 20 por
  lote. Con varias palabras hay una segunda pasada (`mensajeContiene`) y se leen
  hasta **3 lotes** por llamada (`MAX_LOTES`, `:139`; 60 lecturas como máximo).
- **Tope por usuario: 120 búsquedas por hora y 600 por día** (`TOPE_POR_HORA` y
  `TOPE_POR_DIA`, `:146-147`), contadas en el servidor en una transacción sobre
  `topesDeBusqueda/{uid}` (`consumirCupoDeBusqueda`, `:223`; hora y día de La Paz).
  Global por usuario, no por comercio. El cupo se consume **antes** de leer, a
  propósito; un rechazo por permiso, texto o cursor mal formado no cuenta. Un
  contador ilegible se trata como agotado (`tope_ilegible`). Son más altos que los
  30/100 del visor de comprobantes porque la consola llama a esta callable en cada
  búsqueda por texto (rebote de 350 ms). `topesDeBusqueda` queda cerrado al
  navegador por la **negación final** de las reglas (`firestore.rules:2575`), que
  prueba `buscar-conversaciones.test.ts`; no hay un `match` explícito.
- **App Check solo en producción**, concurrencia 10 solo fuera de staging, hasta 5
  instancias y ninguna mínima (`opcionesDeBuscarConversaciones`, `:198`).
- **Errores con mensajes fijos** (`MENSAJES`, `:116`), sin detalle: «Inicie
  sesión.», el de sin permiso, «Escriba al menos una palabra de 3 letras.», «La
  búsqueda cambió; vuelva a buscar.» (cursor), el del tope y «La búsqueda no está
  disponible en este momento. Intente de nuevo.» Una falla de infraestructura sale
  como `unavailable`, jamás como un permiso.
- **El cursor** tiene una forma cerrada (`wa_<teléfono>/<id de 20 caracteres>`,
  `:149`), la ruta se **arma** bajo el comercio pedido y el cursor que **sale**
  pasa por la misma guarda (`esDocumentoPropio`, `:305`). Un resultado vacío con
  `cursor !== null` significa «sin resultados en lo reciente; se puede buscar más
  atrás», no el final; el final es `cursor: null`.
- **El texto buscado nunca se registra** (`registrar`, `:261`): solo comercio, uid,
  rol, cuántas palabras, cuántos resultados y un código; tampoco teléfonos.

### Acceso por claims

`exigirLectorDeConversaciones` (`core/conversacion/acceso.ts:60`) comprueba el
permiso **sobre el comercio pedido**, nunca «el primero del token»:

1. La forma del `tenantId` (`ID_COMERCIO`, `acceso.ts:48`) se valida antes de armar
   ninguna ruta; una forma mala recibe el mismo «sin permiso» que quien no tiene rol.
2. El rol sale de los claims: `esAdminDe` o `esOperDe` (sesión de contraseña y
   correo verificado, `core/seguridad/autorizacion.ts:80`), o el propietario de
   NovuChat (sesión de Google) con una ventana de soporte vigente
   (`soporteVigenteDe`, `core/seguridad/vigencia.ts:53`, que lee
   `accesosSoporte/{uid}`).
3. El comercio debe estar `activo` o `suspendido` (`acceso.ts:77-80`). Un
   suspendido sí lee sus conversaciones; uno dado de baja o inexistente, no. Es
   **más estricto que las reglas** para el soporte, a propósito.
4. **Sin `cuentaVigenteDe`** (D13): la callable entrega fragmentos que la misma
   persona ya lee en la consola con ese token, y dos criterios de «quién lee una
   conversación» serían peor que un token vivo una hora más.

## 6. Reglas, índices y exenciones

- **Lectura** (`firestore.rules:324`, `puedeLeerConversaciones`): la persona del
  negocio (admin u oper) con el comercio legible, o el propietario con soporte vigente.
- **La persona solo marca leída** (`firestore.rules:1851-1877`, con
  `marcaLeidaValida`, `:1872`): puede tocar `etiquetas`, `notaInterna`,
  `noContactar`, `noLeidos` y `sinLeer`, y estos dos solo hacia `0` y `false`
  (borrar el campo o cualquier otro valor se niega). `atendidaPor` salió de lo que
  la persona escribe: nadie lo leía y era editable sin efecto. Tampoco puede
  escribir `turno`: no está en esa lista ni en `conversacionValida()`.
- **Los mensajes siguen inmutables** (`firestore.rules:1949`); ninguna regla de
  `collectionGroup` sobre ellos.
- **Tres índices** (`admin/firestore.indexes.json`):
  1. `mensajes`, `COLLECTION_GROUP`: `tenantId` ASC, `palabras` CONTAINS, `ts` DESC
     (`:123-139`), el de la callable.
  2. `conversaciones`, `COLLECTION`: `sinLeer` ASC, `ultimoEn` DESC (`:141-153`), el
     filtro «No leídas».
  3. `conversaciones`, `COLLECTION`: `atencionEstado` ASC, `ultimoEn` DESC
     (`:155-167`), el filtro «Necesita humano».
- **Dos exenciones de campo único** (`fieldOverrides`, `:200-209`): `mensajes.palabras`
  y `mensajes.tenantId` con `indexes: []`. Sin ellas Firestore indexaría cada
  palabra y cada comercio de cada mensaje con índices simples que nadie consulta.
- `pruebas/central/conversaciones-indices.test.ts` exige que cada forma de consulta
  de la pantalla (`FORMAS_CONSULTA`, `web/src/central/lib/conversaciones.ts:173`)
  tenga su índice declarado, y `buscar-conversaciones.test.ts` comprueba la forma del
  de la callable. **El emulador no exige índices**: una consulta sin índice falla
  solo en producción, y la callable usada antes de que el suyo esté `READY` responde
  `unavailable`.

## 7. La pantalla nueva y la bandera `consolaConversaciones`

- **La bandera** es `tenants/{id}.consolaConversaciones`, con dos valores:
  `'clasica'` y `'nueva'` (`admin/functions/src/central/consola-conversaciones.ts:28`).
  **Desde el 24/10/2026 la nueva es la de por defecto** (`PANTALLA_POR_DEFECTO`):
  ausente, desconocida, de otro tipo, ficha ausente o error de lectura es `'nueva'`;
  solo un `'clasica'` explícito (válvula de emergencia, escrito por el script) da la
  de siempre. Tomar y escribir como persona NO siguen al default: exigen `'nueva'`
  explícito y excluyen a Bellido (`accesoPersona.ts`). El script ya no excluye a
  Bellido para la bandera (sí el relleno, y lo que agregue `NOVUCHAT_TENANTS_EXCLUIDOS`).
- **Es solo presentación.** Elige qué se pinta; lo que el servidor permite no cambia
  con ella. La escribe NovuChat, nunca el comercio: `firestore.rules` no deja a
  ningún navegador escribir `tenants/{id}`; el único camino es el script (§8).
- **El selector** (`web/src/central/paginas/Conversaciones.tsx:25-29`) lee la
  bandera en vivo con `useConsolaConversaciones`
  (`web/src/central/componentes/ConsolaConversaciones.tsx:22`): mientras carga no
  pinta ninguna de las dos, y un error de lectura es el default (`'nueva'`). La pantalla de
  siempre sigue intacta en `ConversacionesClasica.tsx`. La ruta es
  `/negocio/:tenantId/conversaciones/:conversacionId?` (`web/src/App.tsx:258`), con
  `?m=<mensaje>` si se llega desde una búsqueda.
- **Qué lee `ConversacionesNueva.tsx`** (todo bajo `/tenants/{t}`; no hay un
  `where('tenantId', …)` que el usuario pudiera cambiar): la primera página de 50 en
  vivo y las siguientes con «Cargar más» (sin vivo); contadores con
  `getCountFromServer`; teléfono (≥ 4 dígitos) por `telefonoTrozos` y rango por
  prefijo; nombre por `nombrePalabras`; **la palabra, solo con la callable**; el
  hilo se suscribe a su propio documento, así que un enlace profundo funciona aunque
  la conversación no esté en las 50 primeras.
- **Filtros**: Todas, Necesita humano, No leídas y Ventana por vencer
  (`lib/conversaciones.ts:103-110`). Sin «El asistente atiende»: en H1 nadie toma
  conversaciones y sería idéntico a «Todas». «Necesita humano» sale solo de
  `atencionEstado` ∈ {`operador`, `bloqueado`} con actividad en las últimas 24 h
  (decisión P2), o de `necesitaHumano === true`, que H1 no escribe.
- **Qué escribe** (`ConversacionesNueva.tsx:35-46`): solo «No contactar» y la marca
  de leída `{noLeidos: 0, sinLeer: false}`, y solo si quien mira es admin u oper del
  negocio, el comercio está `activo`, la pestaña está visible y hay algo por marcar
  (`puedeGestionarConversaciones`, `lib/conversaciones.ts:460`). El propietario
  **nunca** escribe. Una marca que falla no se reintenta mientras `noLeidos` siga
  valiendo lo mismo (`marcaBloqueada`).
- **Todo texto de un cliente pasa por `TextoSeguro`**, nunca como HTML; el
  fragmento resaltado se parte en tramos y cada uno se pinta como texto.
- **Errores de la búsqueda** por el **código** del error, nunca por su mensaje
  (`textoErrorBusqueda`, `lib/conversaciones.ts:597`). Un `not-found` o `internal`
  (callable sin desplegar) dice que la búsqueda por palabra todavía no está
  disponible y deja el teléfono y el nombre.

## 8. Los scripts de la bandera y del relleno

Los dos están en `admin/scripts/plataforma/`, **secos por omisión**, con la misma
cadena de salvaguardas:

- **Bellido no se toca** (decisión P1): los dos se niegan con salida 2, sin abrir
  Firebase, si el id es de Bellido o está en `TENANTS_EXCLUIDOS`
  (`aplicar-consola-conversaciones.mjs:86`, más la variable
  `NOVUCHAT_TENANTS_EXCLUIDOS`, que solo agrega), y una segunda vez si el **nombre**
  de la ficha lo nombra.
- **Un solo comercio por corrida** (`--tenant`, sin comas).
- **Lista blanca de proyectos** (staging y producción por variable); contra
  producción, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`.
  El id de un proyecto real **nunca** se imprime: se imprime `staging` o `produccion`.
- **Respaldo obligatorio con `--aplicar`**, ruta absoluta, carpeta 0700 y archivo
  0600, nunca se pisa; solo en `/tmp` o `/var/tmp` o en una carpeta ignorada por git
  de la **copia principal** del proyecto (nunca un worktree ni `~/`). Se vuelve a
  leer con la forma que `--revertir` exige y, justo antes de escribir, se revalida
  que la ruta real sea la misma.
- **Salidas**: 0 sin diferencias o escrito y comprobado; 1 el seco encontró
  diferencias; 2 uso o salvaguarda (nada escrito); 3 error de ejecución; 130 Ctrl-C.

**`aplicar-consola-conversaciones.mjs`**: `--pantalla nueva|clasica` (un valor
desconocido se rechaza, a diferencia de la lectura de la consola). El seco lee solo
el campo; `--aplicar` escribe **solo** `consolaConversaciones`, con la precondición
de la hora de actualización leída, relee y compara (una escritura). Idempotente.
`--revertir --aplicar` restaura el valor previo o **elimina** el campo si no existía,
y no pisa un cambio ajeno.

**`rellenar-conversaciones.mjs`**: agrega **solo** `telefonoTrozos` y
`nombrePalabras` (`CAMPOS_DERIVADOS`, `:89`) a las conversaciones antiguas del
comercio, calculados con las mismas funciones de Core (importadas, no copiadas;
`derivarDe` es una copia mínima de `derivados.ts` y una prueba de paridad falla si
divergen). Páginas de 300 por id, lotes de hasta 400 con `update` y la precondición
`lastUpdateTime`: una conversación que cambió entre la lectura y la escritura **se
salta y se cuenta**, no se reintenta a ciegas. Solo agrega un campo que **no existe**.
Nunca imprime un teléfono ni un nombre. `--revertir` borra solo lo que el script
agregó y que siga valiendo lo mismo; si la ingesta lo reescribió **idéntico**, el
campo se borra igual y esa conversación queda sin buscador por teléfono (o por
nombre) hasta su próximo mensaje, y la salida lo avisa.

## 9. Qué NO se rellena, y por qué

- **Los mensajes antiguos no se tocan** (D9). Quedan sin `palabras`, y la consulta de
  la callable pasa por ese índice: **la búsqueda por palabra solo halla los mensajes
  que entraron después de `v0.15.2`**. Teléfono y nombre sí funcionan sobre las
  conversaciones rellenadas.
- **El relleno no escribe `ultimoEntranteEn`, `ventanaVenceEn`, `noLeidos` ni
  `sinLeer`.** Salen de un mensaje entrante y no se derivan de lo que la
  conversación ya tiene. Las antiguas quedan **sin pastilla de ventana y como
  leídas** (la consola lee un documento viejo así: `fichaDeDocumento`) hasta su
  próximo mensaje entrante. (El plan del 09/10, D15, preveía escribir la ventana de
  las últimas 24 h; el script que llegó a `main` no lo hace, y vale el script.)
  Consecuencia operativa, escrita en el encabezado del script: la bandera `nueva`
  se enciende **al menos 24 h después** de desplegar la ingesta con H1-6, para que
  toda ventana abierta tenga su ancla escrita por la ingesta.

## 10. Orden de puesta en producción y reversión

**Orden**: índices (esperar `READY` los tres), Functions (etiqueta), invocador de la
callable, ensayo y, **al final, la bandera**. El invocador lo concede
`scripts/nube-visor.sh --servicio buscarconversaciones` (lista cerrada de siete
servicios: también `tomarconversacion`, `devolverconversacion`, `enviarcomopersona`, `reclamarsalidapersona` y `confirmarsalidapersona`): una Function nueva puede quedar sin `roles/run.invoker` para `allUsers`
y responder un 403 de Google en HTML antes de correr el código. Sale en seco por
omisión, con el «sí» de Andres y en la ventana 23:30–01:30
(`.github/DESPLIEGUE-FIREBASE.md`, sección del invocador).

**Reversión hacia adelante, no hacia atrás.** Redesplegar una etiqueta anterior
**falla** si la nueva agregó una Function: el despliegue de producción corre
`firebase deploy --non-interactive` sin `--force` salvo que
`vars.FIREBASE_DEPLOY_FORCE` lo active (`.github/workflows/ci-node-firebase.yml:2046-2048`
y `:2093`), y firebase-tools se niega a borrar una Function que está en la nube y
no en el código. Para H1-6 la reversión es la rama **`core/h1-6-reversion`**
(`07adc3d9`, existe en `origin`, **no está fusionada**): quita los tres `...spread`
de la ingesta (la ingesta deja de escribir derivados) y conserva el export de la
callable; trae `pruebas/core/ingesta-reversion.test.ts`, que dice lo contrario de
`ingesta-conversaciones.test.ts`. La bandera se apaga con
`aplicar-consola-conversaciones.mjs --revertir`, y el relleno con `--revertir`. Una
reversión **completa** (borrar la Function) exigiría un script revisado de
`functions:delete` con lista cerrada, que **no existe**.

Cada etiqueta futura que agregue Functions necesita su rama de reversión hacia
adelante lista y probada **antes** de etiquetar (contrato de H2, §5b).

## 11. Pruebas

Suites de H1 y dónde corren (`admin/vitest.config.ts`): **sin emulador**
(`pnpm pruebas:puras`) `conversaciones-logica`, `conversaciones-indices`,
`consola-conversaciones`, `conversacion-normalizacion`, `conversacion-derivados`,
`aplicar-consola-conversaciones` y `rellenar-conversaciones`; **con emulador**
(`pnpm pruebas:emulador`) `buscar-conversaciones`, `ingesta-conversaciones`,
`conversaciones-ids-reglas`, `conversaciones-scripts-emulador` y las de reglas. La
prueba de navegador es `admin/pruebas-navegador/conversaciones-nueva.spec.ts`.

## 12. H2 en construcción

H2 es la intervención de una persona: **tomar** una conversación, **devolverla**,
la **pausa del asistente decidida por el servidor** y **enviar texto** dentro de la
ventana de 24 h. El **contrato único de H2** (16/10/2026, entregado como
`NOVUCHAT_contrato-H2-intervencion_2026-10-16.md` en `~/CLAUDE_DESCARGAS/`, **fuera
del repositorio**) es la fuente de verdad de los nombres entre piezas y este
documento no lo duplica. En una línea por tema:

- **Datos**: campo `turno` en la conversación, `autor` y `autorUid` en el mensaje y
  `tenants/{t}/salida/{claveIdempotencia}`; los escribe solo el servidor.
- **Callables** (Core, `us-east1`): `tomarConversacion`, `devolverConversacion` y
  `enviarComoPersona`; las tres exigen en el servidor que el comercio tenga
  `consolaConversaciones === 'nueva'` y que no sea Bellido.
- **Pausa**: con `turno.responde === 'persona'`, la ingesta y `configuracionFlujo`
  devuelven `atencion: { estado: 'bloqueado' }` y aviso vacío, sin escribir
  `bloqueado` en `atencionEstado`.
- **Envío**: callable + «timbre» + reclamo atómico en un flujo de n8n; secretos solo
  en n8n.
- **Medios y plantilla fuera de ventana**: H3, no se diseñan aquí.

**Hoy nada de eso existe en `main`.** En `admin/functions/src/` no hay el campo `turno` de la
conversación (la carpeta `core/turno/` es otra cosa: el turno del coordinador),
tampoco `tomarConversacion`, `devolverConversacion` ni `enviarComoPersona`; la pantalla
nueva no tiene Tomar, Devolver ni campo de escritura, y lo único que llama es
`buscarConversaciones`. Cuando H2 llegue a `main`, este documento se actualiza con
lo que haya, no con lo que prometa el contrato.

## Lo que este documento no afirma

No se puede comprobar desde el repositorio y por eso no se dice:

- Si los tres índices están en estado `READY` en producción y si las dos
  exenciones se aplicaron.
- Si el invocador público de `buscarConversaciones` ya se concedió en producción
  (`nube-visor.sh`).
- Si la bandera `consolaConversaciones` está encendida en algún comercio y si el
  relleno se corrió: esa operación es de Cartera y no deja rastro versionado.
- Que no haya `5xx` ni `TypeError` en la ingesta tras `v0.15.2`: lo prueba la suite
  contra el emulador, no se leyeron los registros de producción.
- Las `v0.15.x` se comprobaron por Git y por los trabajos de GitHub Actions
  (`desplegar-produccion` en `success`), no leyendo las Functions desplegadas.
