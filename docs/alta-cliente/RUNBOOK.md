# Alta de un cliente — el procedimiento, con las fallas ya resueltas

**Versión 1 · 14-sep-2026.** Escrito después del primer cliente real (NovuChat
mismo), que llevó dos días por redescubrir cada tropiezo. Este documento es la
fuente única del alta: los agentes `alta-cliente`, `meta-whatsapp`,
`plataforma` y `flujos-n8n` lo siguen, y el flujo guardado `/alta-cliente` lo
recorre por etapas.

**Meta de tiempo:** 2 h 30 con el cliente (Meta) y 1 h a solas (plataforma,
flujo y aceptación).

No contiene secretos ni identificadores. La carpeta de cada cliente es
`CLIENTES/<NOMBRE>/` en la carpeta principal (`~/NovuChat`), **no versionada**:
ahí va su ficha (`ficha.md`, desde `plantilla-ficha.md`) y su estado
(`estado.md`).

---

## Etapas y quién hace qué

| Etapa | Qué | Quién | Flujo guardado |
|---|---|---|---|
| 0 · Preparar | Carpeta del cliente, ficha, decisiones | agente `alta-cliente` | `/alta-cliente` con `fase: preparar` |
| 1 · Chip | Comprobar que el número no tenga WhatsApp | persona | — |
| 2 · Meta | Alta por `wa.aab1.website/alta`: portafolio, WABA, número, método de pago (ya no app, usuario de sistema ni token por cliente) | persona, guiada por `meta-whatsapp` | — |
| 3 · Canal | Ficha del receptor y verificación de solo lectura (ver la etapa 3; `.env.<cliente>` solo para clientes anteriores al 08/10) | persona (secretos) + `meta-whatsapp` | `fase: canal` |
| 4 · Plataforma | Comercio, administrador, número y alias | `plataforma`, con confirmación | `fase: plataforma` |
| 5 · Flujo | JSON del flujo, pruebas, importación | `flujos-n8n`, con confirmación | `fase: flujo` |
| 6 · Aceptación | Dos teléfonos, suite completa | persona | — |
| 7 · Pase | Solo si cambió código de la consola | skill `pase-a-produccion` | — |

**Regla de ejecución:** los agentes pueden ejecutar lo que escribe en
producción, en Meta o en GitHub **solo con confirmación humana en el momento**.
Lo hace cumplir `.claude/hooks/acciones-sensibles.sh`. Nunca leen el valor de
un secreto: eso lo hace una persona.

---

## 0 · Preparar (antes de ver al cliente)

- Copiar `docs/alta-cliente/plantilla-ficha.md` a `CLIENTES/<NOMBRE>/ficha.md`.
- Decidir con el cliente: **un flujo por número** (agendamiento, venta,
  onboarding), que es su **flujo propio**: piezas propias en
  `Flujos/clientes/<tenant>/` más el núcleo común obligatorio, incluido y nunca
  copiado (etapa 5; un cliente con dos tipos de negocio es un tenant con
  varios flujos, no varios tenants), chip nuevo **a nombre del cliente**, portafolio **del cliente**
  y el **nombre visible definitivo**, que es el nombre del portafolio.
- Pedir con anticipación: cuenta personal de Facebook del dueño, datos completos
  del negocio (nombre, dirección, correo, web o red social), foto cuadrada,
  método de pago, y el celular de recepción (una persona que atiende).

## 1 · Chip

1. Desde otro teléfono, abrir `https://wa.me/591<número>`. «No está en
   WhatsApp» = limpio: **no instalarle WhatsApp nunca**.
2. Si abre un chat, tiene cuenta de otro. **En un teléfono de prueba, nunca en
   el personal**: instalar **WhatsApp Business** (no la normal: evita que quede
   como cuenta agregada con solo «Cerrar sesión»), registrar el número, Ajustes →
   Cuenta → **Eliminar mi cuenta**, esperar 3 minutos.
3. Si pide PIN de dos pasos o dice baneado: **otro chip**. No insistir: WhatsApp
   bloquea la verificación por intentos.

## 2 · Meta (con el cliente, en su portafolio)

**Decisión de Andres del 08/10/2026: todos los clientes van por AAB1 y el alta
se hace solo por `wa.aab1.website/alta`** (portafolio, WABA, número, método de
pago). Los mensajes salen con el **token del alta de AAB1** (usuario de sistema con
alcance de **una sola WABA** del cliente, sin vencimiento), que carga y custodia
la sesión que opera el receptor en la credencial de n8n (puente S1). NovuChat
no lo lee, no lo exporta, no lo copia a otra credencial y no lo usa fuera del
nodo de envío (mensajes y medios); nunca en una llamada a `subscribed_apps`,
`/subscriptions` ni `register`. **Ya no se pide al
cliente** crear una app, un usuario de sistema ni un token propios, ni
**asignar a NovuChat como socio** de su WABA. Las operaciones sobre el receptor
las ejecuta la sesión de WhatsApp-Modular con autorización de Andres
(`CLAUDE.md`, prohibición 5).

Los pasos que siguen se **conservan tal como estaban**, en dos tablas: lo que
sigue vigente y lo que esa decisión retiró (con su tropiezo conocido, por si
alguna vez se vuelve a necesitar).

**Lo que respondió el 09/10/2026 la sesión que opera el receptor** (fuente: respuesta de la sesión que opera el receptor (WhatsApp-Modular) del 09/10/2026, recibida por la sesión Principal):

1. **Plantilla del aviso interno.** La crea esa sesión con el token de negocio del alta de AAB1-WA-Prod, siempre con «sí» de Andres en su chat. NovuChat no usa ese token para crear plantillas ni para nada de lo anterior (`CLAUDE.md`, prohibición 5). El texto y las variables son un **contrato que NovuChat entrega por escrito** (categoría UTILITY, solo BODY, con ejemplos). La aprobación de Meta se midió en **12 a 28 horas**: se piden el **mismo día del alta**.
2. **`subscribed_apps` ya no es un paso por cliente.** Lo hace el alta (paso 2). Si AAB1-WA-Prod ya está suscrita, no se repite el POST, para no borrar un override (riesgo R1 de esa sesión). Es aparte el `cliente:alta` del receptor (override por WABA, alias y destino). Se verifica **leyendo** `subscribed_apps`.

| Paso vigente | Tropiezo conocido |
|---|---|
| WhatsApp → WABA | Una app nueva en un portafolio con WABA **se cuelga de la existente**. Crear WABA nueva en Configuración → Cuentas → Cuentas de WhatsApp y **comparar su ID** con los de los demás entornos |
| Número | «Ya está en uso» = tiene cuenta de WhatsApp: volver a la etapa 1 |
| PIN de dos pasos | Administrador de WhatsApp → Números → el número → Verificación en dos pasos. Al gestor y por escrito |
| Método de pago | En la WABA, con alerta de gasto: desde el 01/10 Meta cobra cada mensaje |
| Plantilla del aviso interno | Utilidad, redactada como **aviso de una solicitud existente** (sin «prospecto», «interés», «atención»); **sin botones** (Meta prohíbe `wa.me` en botones); validez personalizada al máximo |
| Nombre visible | **Decidirlo antes de agregar el número**: sale del nombre del portafolio, y cambiarlo después tiene cupo mensual (NovuChat lo agotó reintentando). Se pide **una vez y no se reintenta**: la pantalla sigue mostrando el viejo con «Editar» gris aunque Meta ya aprobó el nuevo. El estado real lo da `verificar-meta.sh` (nombre vigente y cambio pedido) |

**Retirado el 08/10/2026 (ya no se pide por cliente):**

| Paso retirado | Tropiezo conocido |
|---|---|
| App `<Cliente>-Asistente` | Nombres con **un guion como mucho**; sin la palabra «WhatsApp» |
| Live | Se llama **Publicar**, en el menú izquierdo. Privacidad y borrado de datos: `https://novuchat.site/privacidad` |
| Usuario de sistema | Sin verificar, el portafolio admite **un solo administrador** de sistema: crear como **Empleado**, con control total de la app y **solo** su WABA |
| Token | Vencimiento **Nunca**, permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Los alcances salen vacíos en `debug_token`: la prueba es listar los números de la WABA. «Revocar» invalida **todos**: hacerlo antes de cargarlo en n8n |
| `subscribed_apps` | Ya no es un paso por cliente (lo hace el alta; ver arriba). Antes: no tiene pantalla, `verificar-meta.sh --suscribir` |

## 3 · Canal

**Con la decisión del 08/10 cambia lo que reemplaza a `.env.<cliente>` y a `verificar-meta.sh`** (fuente: respuesta de la sesión que opera el receptor (WhatsApp-Modular) del 09/10/2026, recibida por la sesión Principal):

- Esa sesión entrega una **ficha por mensaje, sin secretos**: id de la WABA y de la línea, nombre visible y estado, pago, plantillas y su estado, y `debug_token`.
- Propone el comando de solo lectura `alta:verificar` en su repositorio; necesita el «sí» de Andres y lo pide la sesión Principal. Hasta que exista, la ficha es la verificación.
- **El token del cliente NO va a ningún `.env` de NovuChat.** Mientras dure el puente S1, lo carga esa sesión en la credencial de n8n por PATCH, y NovuChat no lo lee ni lo copia. Después, con el relé B9 (PR #138 fusionado; B9b en revisión), NovuChat recibe una clave del relé por cliente. NovuChat conserva su credencial de Gemini y la de ingesta.

**Solo para clientes anteriores al 08/10/2026** (el bloque de abajo es lo que hace el script hoy; no se lo usa para cargar el token del cliente):

```bash
./scripts/configurar-cliente.sh --cliente <NOMBRE> --dir ~/NovuChat
cd ~/NovuChat && ./scripts/verificar-meta.sh --env .env.<nombre>
```

Tres verdes; el cuarto (webhook) después de la etapa 5.

## 4 · Plataforma

Credenciales **en una carpeta propia**, para no pisar las de otras sesiones
(las corre una persona, con la cuenta dueña del proyecto):

```bash
unset CLOUDSDK_ACTIVE_CONFIG_NAME   # si vale "default", gcloud no crea la configuración en la carpeta nueva
export CLOUDSDK_CONFIG="$HOME/.config/gcloud-novuchat-prod" GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud-novuchat-prod/application_default_credentials.json"
gcloud auth login && gcloud auth application-default login && gcloud auth application-default set-quota-project <proyecto>
```

Después, siempre **primero en seco** y luego con `--aplicar`:

```bash
node admin/scripts/plataforma/alta-comercio.mjs --proyecto <proyecto> --tenant <id> --nombre "<Nombre>" --flujos <flujo> --admin <correo> --nombre-admin "<Nombre>" [--cliente <CARPETA>]
node admin/scripts/plataforma/asignar-plan.mjs --proyecto <proyecto> --operador <correo> --tenant <id> --plan <impulso|crecimiento|pro> [--modalidad <demostracion|prueba|prepago>]
# Solo si el comercio firmó un contrato a medida (F1b), en la misma corrida o después:
node admin/scripts/plataforma/asignar-plan.mjs --proyecto <proyecto> --operador <correo> --tenant <id> [--conversaciones <N|plan>] [--cambios <N|plan>] [--precio <USD|plan>] [--periodo-prueba <aaaa-mm>] [--bolsa-prueba <N>]
node admin/scripts/modulos/productos/contar-catalogo.mjs --proyecto <proyecto> --tenant <id>
node admin/scripts/plataforma/asignar-numero.mjs --proyecto <proyecto> --listar
node admin/scripts/plataforma/asignar-numero.mjs --proyecto <proyecto> --operador <correo> --tenant <id> --numero <phone_number_id> --waba <waba_id> --flujo <flujo> --alias <clienteNN>
```

- **El plan y el contador del catálogo.** `alta-comercio.mjs` deja al comercio
  en **Impulso**, con la copia de sus límites en `cuenta/estado.limites` (lo que
  leen las reglas y las Functions) y el contador `contadores/catalogo` en 0. Si
  contrató **Crecimiento** o **Pro**, `asignar-plan.mjs` (en seco y después con
  `--aplicar`) cambia el plan, la copia, el espejo de la ficha y deja la
  auditoría. El plan sale del catálogo de `admin/functions/src/central/cuenta/planes.ts`: no
  hay texto libre. Desde F1 (26/09) `demostracion` es una **modalidad**, no un plan: los demos son Pro con modalidad demostración. `--operador` es obligatorio en `asignar-plan.mjs` y `asignar-numero.mjs`: es quien queda en la auditoría. La modalidad (`demostracion`, `prueba`, `prepago`, que la consola muestra como «Producción»), el modelo y la titularidad del número se fijan con el mismo script o desde Negocios.
- **Lo pactado fuera de la lista va POR CONTRATO (F1b, decisión de Andres del
  26/09/2026).** Un contrato a medida no es un plan nuevo: es el plan de lista
  más la copia de la cuenta fijada a mano, con el mismo script o desde
  Negocios (fila de cada eje, con sesión reciente). Todo con `--operador`, en
  seco primero, y con auditoría del antes y el después:
  - `--conversaciones N` (1 a 100.000) y `--cambios N` (0 a 100): la copia
    `cuenta/estado.limites` manda sobre el plan, y un cambio de plan posterior
    **la conserva**. `plan` en lugar de `N` la quita.
  - `--precio USD` (de 1 a 1.000, con punto y hasta dos decimales:
    `120`, `37.50`): la mensualidad pactada (`precioPorContrato`). Manda sobre
    el precio del plan en **todo** lo que cobra: el QR de Pagar, el pago manual
    de Negocios (que la acepta sin motivo y pide motivo para cualquier otro
    importe), los recordatorios y `montoMensual`. Un cambio de plan no la toca;
    `--precio plan` la quita. Se rechaza si hay una mensualidad pendiente que
    quedaría fuera de contrato: primero se anula el cobro.
  - Conversaciones y precio van **siempre juntos y decididos**: más
    conversaciones sin precio es regalar consumo (`docs/base-comercial.md`).
  - `--periodo-prueba aaaa-mm` y `--bolsa-prueba N` (1 a 1.000): una prueba
    pactada distinta de la de lista (un mes y 20 conversaciones). Solo con
    modalidad prueba (la que tiene, o `--modalidad prueba` en la misma
    corrida); el mes no puede ser pasado, ni estar a más de 3 meses del mes en
    curso, ni cruzarse con un mes ya pagado. Detalle en
    `docs/pase-a-produccion/RUNBOOK.md` §3.1.
- `contar-catalogo.mjs` en seco **comprueba** que el contador exista y coincida
  con los productos. Un comercio nuevo no lo necesita con `--aplicar`; uno dado
  de alta **antes del 15/09** sí, una vez, antes de desplegar las reglas del
  límite de productos: sin contador, la consola lo crea sola en la primera alta
  o baja (`importarCatalogo`), pero ningún producto se crea ni se borra por las
  reglas mientras falte.

- El administrador del comercio entra con **contraseña**, nunca con la cuenta de
  Google del propietario. **El enlace para ponerla no se imprime** (desde el
  15/09/2026): `alta-comercio.mjs` lo escribe en
  `CLIENTES/<CLIENTE>/.enlaces/enlace-admin-<tenant>.txt` de la **copia
  principal** (`~/NovuChat`, aunque se corra desde un worktree), con la carpeta
  en 700 y el archivo en 600, y la salida solo dice dónde quedó. `CLIENTES/`
  está ignorada por git. `<CLIENTE>` es la carpeta que creó la etapa 1 (por
  defecto, el tenant en mayúsculas con `_` por `-`; si no coincide,
  `--cliente <CARPETA>`), y si no existe el script se detiene **antes** de
  crear nada, también en seco. `asignar-rol.mjs` hace lo mismo con
  `enlace-<rol>-<tenant>.txt` cuando crea la cuenta de un operador.
  - **Hasta el 28/09/2026 iba a `~/enlace-admin-<tenant>.txt`.** Ese día había
    dos olvidados en el directorio personal, del 16 y del 17/09 (Bellido y
    Platinum), y `~/` es solo para proyectos. Por eso ahora queda junto al
    resto del cliente, donde se ve al cerrar su alta.
  - **No va por la salida estándar** porque este paso lo corre también el
    agente `plataforma`, y lo que imprime un comando que corre un agente entra
    a su contexto.
  - **Lo abre una persona, nunca un agente.** El agente informa la ruta y
    nada más; `.claude/settings.json` le niega leer cualquier `.enlaces/` y el
    gancho `acciones-sensibles.sh` le niega todo comando por Bash que reciba
    esa carpeta o un archivo de enlace (comodines incluidos) y la búsqueda
    recursiva sobre `CLIENTES/` que no la excluya (`--exclude-dir=.enlaces`).
    El enlace no existe ni como variable en los scripts: lo pide y lo escribe
    `enlace-privado.mjs`, sin seguir enlaces simbólicos. La persona abre el
    archivo, manda el enlace al administrador por el canal acordado y **borra
    el archivo**.
  Quien tenga ese enlace fija la contraseña de la cuenta administradora, así que
  no se pega en ningún chat ni se reenvía, y el archivo se borra al usarlo. Si
  alguna vez queda a la vista, se invalida cambiando la contraseña de esa cuenta
  con el SDK Admin (`updateUser` con una clave aleatoria, más
  `revokeRefreshTokens`) y se emite uno nuevo.
  **Decirle el mínimo antes de que elija:** la consola pide **8 caracteres** y
  admite frases largas, pero la pantalla del enlace la sirve Firebase con su
  propia política, que hoy acepta desde 6. El 16/09/2026 una persona puso 11,
  Firebase se los aceptó, la consola vieja le pedía 12 y quedó bloqueada con una
  contraseña válida: hubo que rotarla y emitir otro enlace. El mínimo de la
  consola bajó a 8 por eso; el hueco se cierra recién cuando se configure la
  *password policy* de Firebase Auth (`admin/DISENO.md` §11, paso 14c-bis).
- El secreto del alias va a n8n como Header Auth `Authorization` = `Bearer <valor>`,
  y lo lee **una persona**: `gcloud secrets versions access latest --secret=INGESTA_CLIENTENN --project <proyecto>`.
  Si ese valor se expone, se da de baja el cliente o se reasigna el alias, se rota:
  `docs/produccion/rotar-secreto-ingesta.md` (una versión nueva no rige hasta redesplegar).
- **Si el comercio tiene el flujo de captación (`onboarding`)**, su contenido
  —nombre del asistente, rubros, planes en dólares, cargos únicos y
  aclaraciones— se carga desde la pestaña «Captación» o de una vez desde un JSON
  versionado, también primero en seco:

  ```bash
  node admin/scripts/datos/cargar-captacion.mjs --proyecto <proyecto> --tenant <id> --archivo admin/scripts/datos/captacion-<id>.json
  ```

  El script rechaza lo que no cumple el contrato (más de 8 rubros, un precio
  negativo, más de 5 planes sin `archivoPlanes`) y un comercio sin `onboarding`
  en `flujos`. El de NovuChat es `admin/scripts/datos/captacion-novuchat.json`.
- **La configuración del comercio —negocio, horario, catálogo y agendas— se
  carga de una vez desde un JSON versionado**, después de `alta-comercio.mjs` y
  antes de entrar a la consola (la consola no tiene pantalla para el horario, y
  cargar tres pestañas a mano no se puede repetir). El archivo es
  `admin/scripts/datos/negocio-<id>.json` (el de Clínica Platinum,
  `negocio-platinum.json`, sale de `CLIENTES/PLATINUM/conocimiento-asistente.md`
  §2 y §4) y **no lleva el número de recepción ni los calendarios**: lleva
  marcadores (`numeroRecepcionMarcador`, `calendarioMarcador`) que el script
  resuelve desde la tabla de `CONFIGURACION.local.md`. Esa tabla la completa
  **una persona, a mano** —`configurar-cliente.sh` escribe los marcadores
  `${WA_…_<CLIENTE>}` del canal, no estos— con una fila por marcador, en el
  mismo formato que las demás filas de la tabla:

  ```
  | `REEMPLAZAR_NUMERO_RECEPCION_<CLIENTE>` | 591… | recepción de <Cliente> |
  | `REEMPLAZAR_CALENDARIO_<CLIENTE>_1` | <64 hex>@group.calendar.google.com | agenda 1 |
  ```

  Primero en seco (desde un worktree, `--local` apunta a la tabla de la carpeta
  principal):

  ```bash
  node admin/scripts/datos/cargar-negocio.mjs --proyecto <proyecto> --tenant <id> --archivo admin/scripts/datos/negocio-<id>.json --local "$HOME/NovuChat/CONFIGURACION.local.md"
  ```

  Valida con el mismo contrato que `firestore.rules` (largos, enumerados de
  voz, los siete días del horario, teléfono, calendario de 64 hexadecimales
  exactos, servicios de cada agenda presentes en el catálogo del archivo),
  rechaza claves fuera del contrato y exige el comercio activo y con
  `agendamiento` en `flujos` para las agendas. Un marcador que falta en la
  tabla se avisa en rojo en seco y **niega** el `--aplicar`. Escribe en una
  transacción `config/negocio`, `config/agendamiento`, `catalogo/{id}` y
  `funcionarios/{id}` (con el horario del negocio) con sello
  `cargar-negocio`, deja auditoría y relee todo como evidencia. Lo que ya
  existía y el archivo no nombra queda como está y se informa.
  **El comportamiento general (`instruccionesExtra`) queda APROBADO y VIGENTE
  en la misma carga** (desde el 17/09/2026): el script escribe también
  `instruccionesVigentes` —que es lo único que el flujo lee— e
  `instruccionesRevision` aprobada con `revisadoPor: 'cargar-negocio'`, porque
  ese texto lo revisó NovuChat. Antes lo pasa por la misma capa de patrones que
  la Function `verificarComportamiento` y **niega** si no la pasa (corchetes,
  comillas angulares, nombres de herramientas, pedir negar que es una IA…):
  lo que NovuChat carga tiene que poder editarse después desde la consola sin
  que la verificación lo rechace. Lo que el comercio escriba después en ese
  campo pasa por las dos capas del servidor y recién entonces rige
  (`admin/DISENO.md` §4quater.5). Comercios cargados ANTES del 17/09: una vez,
  `node admin/scripts/plataforma/migrar-instrucciones.mjs --proyecto <proyecto>` en seco y
  con `--aplicar`, antes de desplegar `configuracionFlujo`.
- En la consola, con el administrador: revisar lo cargado, número de recepción,
  horario, catálogo y **«Cómo trata al cliente»** (tú, usted, vos o impersonal).
  Lo que dice la consola gana sobre el respaldo del flujo: NovuChat quedó en
  «Impersonal» y el asistente hablaba como un formulario («Se registra el
  nombre…»).

## 5 · Flujo

**Regla de flujo propio por defecto** (decisión de Andres del 09/10/2026;
`docs/arquitectura/tenants.md`, «El flujo de un cliente»): cada cliente tiene
su flujo, compuesto por **piezas propias** declaradas en
`Flujos/clientes/<tenant>/` (con `PROPIO.md`, que declara los mensajes por
conversación que agregan o quitan) más el **núcleo común obligatorio** —sesión
por `messages[0].from`, filtro de eventos, conteo, candado por hecho, rótulos
de cobro, `NIEGA_IA`, aviso con botón, uso extendido, comercio no operativo,
entrada verificada del receptor (verificador interno, `wabaIdEsperado` fijo, sin «Continue on Fail», repetidos descartados entre ejecuciones), normalización de entrada y filtro de promesas sin respaldo—,
que se **incluye** desde core y módulos y **nunca se copia**.

- Una prueba de CI comparará byte a byte lo incluido contra su fuente. **No
  existe todavía** (PR posterior): hasta entonces, quien arma el flujo verifica
  a mano que no copió el núcleo, y el revisor lo mira.
- La **segunda vez** que otro cliente pide una pieza propia, pasa a módulo.
- Seguridad y protección valen para todos sin excepción.
- Un cliente con dos tipos de negocio (el caso de Rubén Roca: citas y ventas)
  es **un tenant con varios flujos** (cuatro en ese caso), no varios tenants.
- Los barridos comunes (uno por tipo, que recorre los tenants) no son flujos de
  cliente: son la excepción declarada a «flujo propio», no a seguridad ni
  protección (cada iteración usa solo el número, la credencial y los datos de
  su tenant).

1. **Sincronizar con `main` antes de nada:** los mecanismos comunes cambian en
   paralelo (umbrales del servidor, orden de reporte, avisos). Revisar
   `git log origin/main -- Flujos/ admin/functions/src/` y partir del flujo
   vigente de los módulos que el cliente enciende (no del JSON de otro
   cliente: «basado en» es basarse en funcionalidades, `CLAUDE.md`).
2. Un flujo nuevo trae su suite en `admin/pruebas/` (el JSON versionado se
   ejecuta), queda saneado (`REEMPLAZAR_*`) y pasa `verificar-saneo.sh`.
3. `./scripts/preparar-import.sh Flujos/<flujo>.json .env.<cliente>` — **con**
   el segundo argumento: sin él, el flujo se lleva la ruta de webhook del Demo A.
   Cada marcador `REEMPLAZAR_*` del flujo necesita **su fila exacta** en la tabla
   de `CONFIGURACION.local.md` (Phone ID, recepción y horario del cliente). Antes
   del 15/09 el script aceptaba una fila de otro cliente cuyo nombre fuera
   prefijo del marcador, y NovuChat salió con el Phone ID del Demo A.
4. En n8n, para clientes del esquema vigente (alta por AAB1, desde el 08/10/2026): importar el flujo, asignar las credenciales de NovuChat (Gemini e ingesta) y **Publish**. **Retirado el 08/10:** `Trigger On` = Messages, la URL de Production al webhook de la app del cliente y completar `N8N_WEBHOOK_*`/`N8N_WORKFLOW_ID` en `.env.<cliente>` (valían para una app propia del cliente; no se siguen).
   **Con la decisión del 08/10 este paso cambia** (fuente: respuesta de la sesión que opera el receptor (WhatsApp-Modular) del 09/10/2026, recibida por la sesión Principal). Los mensajes llegan por la salida del receptor de AAB1 y **nunca** por un WhatsApp Trigger con credenciales de AAB1-WA-Prod (`CLAUDE.md`, prohibición 7). La entrada del flujo del cliente es un **nodo Webhook normal** (no WhatsApp Trigger) más un **HTTP Request al verificador interno del receptor** (firma, timestamp, `deliveryId` y cuerpo; host, puerto y ruta en la documentación del receptor, `docs/25` §6 de WhatsApp-Modular), con `wabaIdEsperado` fijo, **sin «Continue on Fail»**, con *Remove Duplicates* en la operación «Remove Items Processed in Previous Executions» por `deliveryId` y **sin HMAC en n8n** (`CLAUDE.md`, prohibición 5). Los pasos:
   a. NovuChat importa el flujo (la ruta nace al importar) y lo activa.
   b. NovuChat pasa a esa sesión el **alias** (minúsculas, dígitos y guiones, hasta 40 caracteres) y la **URL interna** del webhook de n8n. La ruta es una URL de capacidad: no va a archivos versionados.
   c. Esa sesión corre `cliente:alta --waba <id> --alias <alias> --destino <URL>` en seco y después con `--aplicar`, con «sí» de Andres.
   d. Prueba con «hola» y lectura de la cola.
   Varios clientes con un flujo: **un alias por WABA, mismo destino** solo si el flujo trae una lista cerrada `WABA → tenant` en `Config del negocio`, verifica contra esa lista y deriva el tenant de la WABA que devuelve el verificador, **nunca del cuerpo recibido**; sin esa lista, con flujo propio por defecto, **un destino por WABA** (`wabaIdEsperado` es uno solo por flujo). Cambios posteriores: `cliente:destino`, `cliente:pausar`, `cliente:baja`. Límites: **10 altas por semana** (planificar con 10; el panel dice 200) y el cliente carga su tarjeta (sin tarjeta, error 141006). Regla: el número entra **directo a la WABA del cliente** desde `/alta`.

## 6 · Aceptación (dos teléfonos, resultado REAL en `CLIENTES/<NOMBRE>/estado.md`)

Saludo y respuesta, dos celulares a la vez sin cruce, sticker y audio, «¿eres un
robot?», el flujo principal de punta a punta, el aviso llegando a recepción,
cuatro mensajes en tres segundos, y un cambio en la consola que el asistente
responda. Anotar cuántos mensajes salió cada prueba.

## 7 · Pase a producción (solo si cambió la consola)

Skill `pase-a-produccion`: acta en `docs/produccion/`, revisión del agente
`seguridad`, **la etiqueta va después de fusionar sus arreglos**, y la aprueba
la cuenta revisora de `production`.

## 8 · Después de la aceptación: el pase del comercio a PRODUCCIÓN

La etapa que sigue a la aceptación es **el pase del comercio de PRUEBA a
PRODUCCIÓN**, con la activación del prepago: precondiciones verificadas con
`admin/scripts/plataforma/pase-a-produccion.mjs` (solo lectura), número y WABA del
comercio, `prueba` → primer pago → `prepago`, un ciclo de cobranza en
observación y, recién entonces, el corte encendido solo en ese comercio. El
procedimiento es `docs/pase-a-produccion/RUNBOOK.md`; su aplicación a cada
cliente, `CLIENTES/<NOMBRE>/pase-a-produccion.md`. No es la etapa 7: aquella es
el pase de una versión del código; esta, el de un comercio. Los demos y
`novuchat` no pasan nunca.

---

## Reglas del repositorio público que frenan un commit

- Números de 10 o más dígitos: solo con seis ceros seguidos (`1000000033`).
  Tampoco números de corrida de Actions en documentos.
- Nada de UUID en `id` de nodos, rutas con el usuario del sistema ni correos de
  personas.
- CodeQL rechaza reconocer un host por subcadena (`includes('dominio')`), también
  en pruebas.
