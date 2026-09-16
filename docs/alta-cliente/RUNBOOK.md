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
| 2 · Meta | Portafolio, app, WABA, número, token, plantilla | persona, guiada por `meta-whatsapp` | — |
| 3 · Canal | Entorno `.env.<cliente>` y verificación | persona (secretos) + `meta-whatsapp` | `fase: canal` |
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
  onboarding), chip nuevo **a nombre del cliente**, portafolio **del cliente**
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

| Paso | Tropiezo conocido |
|---|---|
| App `<Cliente>-Asistente` | Nombres con **un guion como mucho**; sin la palabra «WhatsApp» |
| WhatsApp → WABA | Una app nueva en un portafolio con WABA **se cuelga de la existente**. Crear WABA nueva en Configuración → Cuentas → Cuentas de WhatsApp y **comparar su ID** con los de los demás entornos |
| Número | «Ya está en uso» = tiene cuenta de WhatsApp: volver a la etapa 1 |
| PIN de dos pasos | Administrador de WhatsApp → Números → el número → Verificación en dos pasos. Al gestor y por escrito |
| Live | Se llama **Publicar**, en el menú izquierdo. Privacidad y borrado de datos: `https://novuchat.site/privacidad` |
| Usuario de sistema | Sin verificar, el portafolio admite **un solo administrador** de sistema: crear como **Empleado**, con control total de la app y **solo** su WABA |
| Token | Vencimiento **Nunca**, permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Los alcances salen vacíos en `debug_token`: la prueba es listar los números de la WABA. «Revocar» invalida **todos**: hacerlo antes de cargarlo en n8n |
| `subscribed_apps` | No tiene pantalla: `verificar-meta.sh --suscribir` |
| Método de pago | En la WABA, con alerta de gasto: desde el 01/10 Meta cobra cada mensaje |
| Plantilla del aviso interno | Utilidad, redactada como **aviso de una solicitud existente** (sin «prospecto», «interés», «atención»); **sin botones** (Meta prohíbe `wa.me` en botones); validez personalizada al máximo |
| Nombre visible | **Decidirlo antes de agregar el número**: sale del nombre del portafolio, y cambiarlo después tiene cupo mensual (NovuChat lo agotó reintentando). Se pide **una vez y no se reintenta**: la pantalla sigue mostrando el viejo con «Editar» gris aunque Meta ya aprobó el nuevo. El estado real lo da `verificar-meta.sh` (nombre vigente y cambio pedido) |

## 3 · Canal

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
node admin/scripts/alta-comercio.mjs --proyecto <proyecto> --tenant <id> --nombre "<Nombre>" --flujos <flujo> --admin <correo> --nombre-admin "<Nombre>"
node admin/scripts/asignar-numero.mjs --proyecto <proyecto> --listar
node admin/scripts/asignar-numero.mjs --proyecto <proyecto> --tenant <id> --numero <phone_number_id> --waba <waba_id> --flujo <flujo> --alias <clienteNN>
```

- El administrador del comercio entra con **contraseña**, nunca con la cuenta de
  Google del propietario. **El enlace para ponerla no se imprime**: desde el
  15/09/2026 `alta-comercio.mjs` lo escribe en `~/enlace-admin-<tenant>.txt` con
  permisos 600, fuera de todo repositorio, y la salida solo dice dónde quedó.
  Quien tenga ese enlace fija la contraseña de la cuenta administradora, así que
  no se pega en ningún chat ni se reenvía, y el archivo se borra al usarlo. Si
  alguna vez queda a la vista, se invalida cambiando la contraseña de esa cuenta
  con el SDK Admin (`updateUser` con una clave aleatoria, más
  `revokeRefreshTokens`) y se emite uno nuevo.
- El secreto del alias va a n8n como Header Auth `Authorization` = `Bearer <valor>`,
  y lo lee **una persona**: `gcloud secrets versions access latest --secret=INGESTA_CLIENTENN --project <proyecto>`.
  Si ese valor se expone, se da de baja el cliente o se reasigna el alias, se rota:
  `docs/produccion/rotar-secreto-ingesta.md` (una versión nueva no rige hasta redesplegar).
- **Si el comercio tiene el flujo de captación (`onboarding`)**, su contenido
  —nombre del asistente, rubros, planes en dólares, cargos únicos y
  aclaraciones— se carga desde la pestaña «Captación» o de una vez desde un JSON
  versionado, también primero en seco:

  ```bash
  node admin/scripts/cargar-captacion.mjs --proyecto <proyecto> --tenant <id> --archivo admin/scripts/datos/captacion-<id>.json
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
  node admin/scripts/cargar-negocio.mjs --proyecto <proyecto> --tenant <id> --archivo admin/scripts/datos/negocio-<id>.json --local "$HOME/NovuChat/CONFIGURACION.local.md"
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
- En la consola, con el administrador: revisar lo cargado, número de recepción,
  horario, catálogo y **«Cómo trata al cliente»** (tú, usted, vos o impersonal).
  Lo que dice la consola gana sobre el respaldo del flujo: NovuChat quedó en
  «Impersonal» y el asistente hablaba como un formulario («Se registra el
  nombre…»).

## 5 · Flujo

1. **Sincronizar con `main` antes de nada:** los mecanismos comunes cambian en
   paralelo (umbrales del servidor, orden de reporte, avisos). Revisar
   `git log origin/main -- Flujos/ admin/functions/src/` y partir del flujo
   vigente de ese vertical.
2. Un flujo nuevo trae su suite en `admin/pruebas/` (el JSON versionado se
   ejecuta), queda saneado (`REEMPLAZAR_*`) y pasa `verificar-saneo.sh`.
3. `./scripts/preparar-import.sh Flujos/<flujo>.json .env.<cliente>` — **con**
   el segundo argumento: sin él, el flujo se lleva la ruta de webhook del Demo A.
   Cada marcador `REEMPLAZAR_*` del flujo necesita **su fila exacta** en la tabla
   de `CONFIGURACION.local.md` (Phone ID, recepción y horario del cliente). Antes
   del 15/09 el script aceptaba una fila de otro cliente cuyo nombre fuera
   prefijo del marcador, y NovuChat salió con el Phone ID del Demo A.
4. En n8n: importar, credenciales, `Trigger On` = Messages, **Publish**. URL de
   Production al webhook de la app del cliente. Completar `N8N_WEBHOOK_*` y
   `N8N_WORKFLOW_ID` en `.env.<cliente>`: `verificar-meta.sh` con cuatro verdes.

## 6 · Aceptación (dos teléfonos, resultado REAL en `CLIENTES/<NOMBRE>/estado.md`)

Saludo y respuesta, dos celulares a la vez sin cruce, sticker y audio, «¿eres un
robot?», el flujo principal de punta a punta, el aviso llegando a recepción,
cuatro mensajes en tres segundos, y un cambio en la consola que el asistente
responda. Anotar cuántos mensajes salió cada prueba.

## 7 · Pase a producción (solo si cambió la consola)

Skill `pase-a-produccion`: acta en `docs/produccion/`, revisión del agente
`seguridad`, **la etiqueta va después de fusionar sus arreglos**, y la aprueba
la cuenta revisora de `production`.

---

## Reglas del repositorio público que frenan un commit

- Números de 10 o más dígitos: solo con seis ceros seguidos (`1000000033`).
  Tampoco números de corrida de Actions en documentos.
- Nada de UUID en `id` de nodos, rutas con el usuario del sistema ni correos de
  personas.
- CodeQL rechaza reconocer un host por subcadena (`includes('dominio')`), también
  en pruebas.
