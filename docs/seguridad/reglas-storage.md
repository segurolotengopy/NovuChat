# Reglas de Storage — el patrón, cómo agregar un camino y cómo desplegarlas

**Versión 1 · 15-sep-2026.** Acompaña a `admin/storage.rules`, a sus pruebas
(`admin/pruebas/storage-reglas.test.ts`, que corre `admin/pruebas/correr-storage.sh`)
y a la plantilla `docs/seguridad/storage.rules.plantilla`.

NovuChat no tuvo depósito de archivos hasta el 15/09: el logo y las fotos del
catálogo viven incrustados en Firestore justamente para no custodiar archivos de
terceros. El flujo de **captación** lo cambió por una sola razón: el PDF o la
imagen con los planes del comercio pesa megas, y Meta tiene que poder
descargarlo desde una URL para mandarlo por WhatsApp. Ese caso, y ningún otro, es
lo que habilita `storage.rules`. Este documento dice cómo está hecho para que el
segundo caso (y el de otro proyecto) salga igual.

---

## 1. El patrón

| # | Regla | Por qué | Dónde se ve |
|---|---|---|---|
| 1 | **Negar por defecto.** La última regla es `match /{todo=**} { allow read, write: if false; }`. | Un camino nuevo nace cerrado; abrirlo exige escribirlo y probarlo. | Final de `storage.rules`; el CI verifica con `grep` que siga ahí (job `calidad`). |
| 2 | **Un camino por caso de uso, con nombres fijos.** `tenants/{t}/captacion/{planes.pdf\|planes.jpg\|planes.png}` y nada más. | Subir de nuevo **reemplaza**: no se acumulan versiones que nadie borra. El nombre no es un canal para inyectar nada. | `nombreValido()`. |
| 3 | **Tipo y tamaño atados a la extensión.** `planes.pdf` → `application/pdf` ≤ 10 MB; `.jpg`/`.png` → su tipo ≤ 5 MB (el tope de imagen de WhatsApp); `size > 0`. | Impide subir un HTML con nombre de PDF que Storage serviría como `text/html`. El `contentType` lo declara el navegador: que el contenido sea de verdad un PDF lo comprueba el servidor (`comprobarArchivoPlanes`) y, antes, la consola por los primeros bytes (`lib/archivoPlanes.ts`). | `contenidoValido()`. |
| 4 | **La identidad es la de Firestore, copiada.** Mismos claims `nc.p`/`nc.t`, mismo vínculo rol ↔ proveedor de sesión (T-19), mismo correo verificado. El tenant sale **de la ruta**, nunca de un metadato. | Si difieren, un mismo usuario tiene dos criterios de acceso según pida un documento o un archivo. | Ayudantes al comienzo de `storage.rules`; las pruebas usan los mismos claims simulados que `reglas.test.ts`. |
| 5 | **Lectura cruzada, y su costo.** Lo que depende del estado del comercio (`flujos`, `estado`) se lee de la ficha con `firestore.get()`: una suspensión corta la escritura al instante. **Cada `firestore.get()` es una lectura de Firestore facturada por evaluación**: se pide UNA vez (la ficha entra como parámetro) y **después** de la identidad y del archivo, para que `&&` corte antes de gastarla. Un tenant inexistente da `null` y se niega por la condición, no por un error de evaluación. | Una regla que lee sin necesidad es una factura que crece con cada intento de un anónimo. | `fichaTenant()`, `puedeEscribir()`. |
| 6 | **Nada es público por reglas; la URL con token es una capacidad.** Meta descarga con la URL de `getDownloadURL`, cuyo token **no pasa por las reglas**: quien la tiene, lee. | Por eso a ese camino solo sube lo que el comercio publicaría igual (su oferta). Nunca listas de clientes, contratos ni datos personales. Revocar = revocar el token en la consola de Firebase o borrar el archivo. | Bloque de la captación. |
| 7 | **Sin listar.** `allow list: if false`. | Los nombres son fijos: no hay nada que buscar, y listar revelaría qué comercios tienen archivo. | Idem. |
| 8 | **Pruebas negando.** Por cada caso que pasa, varios que fallan, armando la petición a mano: otro comercio, operador, ingesta, anónimo, proveedor equivocado, correo sin verificar, comercio suspendido o dado de baja o sin el flujo, tenant inexistente, tipo que no coincide, 10 MB + 1 byte, nombres parecidos (`planes.PDF`, `planes.jpeg`, `.planes.pdf`), `..`, carpetas vecinas, cambio de metadatos a `text/html`. | Una prueba que solo verifica que el botón está deshabilitado no prueba nada (`CLAUDE.md` §7). | `storage-reglas.test.ts`: 37 pruebas. |
| 9 | **CI con tiempo límite.** El paso «Pruebas de reglas de Storage» tiene `timeout-minutes: 8` y el script corta `emulators:exec` con `timeout` (`TIMEOUT_EMULADORES`, 300 s). | El emulador de Storage solo arranca con el CLI y ya se colgó una vez: sin límite, se come el job entero. | `.github/workflows/ci-node-firebase.yml`, `correr-storage.sh`. |
| 10 | **CODEOWNERS.** `/admin/storage.rules` y `/docs/seguridad/` exigen revisión del dueño, igual que `firestore.rules`. | Son las dos mitades del mismo control. | `.github/CODEOWNERS`. |
| 11 | **Semgrep del estándar.** `.github/semgrep.yml` ya incluye `storage.rules` en `devsecops.firestore-reglas-abiertas` (`allow read, write: if true`, `allow write: if true`, `allow write;`…). No ve `allow read: if true`, `allow get/list/create/update/delete` sueltos ni `allow delete;`: ver §5, la propuesta para el estándar. | Una regla abierta tiene que frenar el pipeline, no depender de que alguien la lea. | Hoy: 0 hallazgos en `storage.rules` y `firestore.rules`. |

### Cómo se corren las pruebas

```bash
cd admin
FIRESTORE_EMULATOR_PORT=8721 FIRESTORE_EMULATOR_WS_PORT=9181 \
STORAGE_EMULATOR_PORT=9221 EMULATOR_HUB_PORT=4521 EMULATOR_LOGGING_PORT=4621 \
timeout 420 bash pruebas/correr-storage.sh
```

A diferencia de `correr.sh`, no se puede invocar el jar directo: el emulador de
Storage está escrito dentro de firebase-tools (el jar que descarga,
`cloud-storage-rules-runtime`, es solo el motor de reglas), y resuelve
`firestore.get()` contra el emulador de Firestore **del mismo proceso** del CLI.
Por eso los dos van en un solo `firebase emulators:exec`, con un `firebase.json`
temporal y puertos propios. Sin `STORAGE_EMULATOR_PORT`, la suite se salta: así
`correr.sh` (solo Firestore) no se rompe.

---

## 2. Agregar un camino nuevo, en cinco pasos

1. **Escribir el caso antes que la regla.** Qué archivo es, quién lo sube, quién
   lo lee (por el SDK y por la URL con token) y si se comparte con un tercero.
   Si va a salir por URL con token, **solo** puede contener lo que el comercio
   publicaría igual.
2. **Un `match` nuevo con nombres fijos**, copiado del bloque de la plantilla:
   `nombreValido()` con la lista exacta, `contenidoValido()` con tipo y tamaño
   por extensión y `size > 0`, `allow list: if false`, y quién escribe con los
   ayudantes de identidad que ya existen (no inventar otros). Si depende del
   estado del comercio, UNA lectura de la ficha, después de la identidad. Nunca
   tocar la negación final.
3. **Las pruebas negando, en `storage-reglas.test.ts`.** El caso que pasa, y
   todos los que no: los de la tabla del §1, adaptados. Si el camino depende de
   una capacidad (`flujos`), un comercio con la lista sin ella y uno con ficha
   vieja.
4. **Si lo usa la consola:** el módulo que valida antes de subir (como
   `lib/archivoPlanes.ts`, con los mismos topes que la regla y los primeros
   bytes), los mensajes de error en castellano, y que la consola funcione aunque
   Storage no esté configurado (`storage` puede ser `null`, ver
   `lib/firebase.ts`).
5. **Revisión y despliegue.** Pasa por CODEOWNERS y por la revisión del agente
   `seguridad`; se despliega en el mismo comando que las reglas de Firestore
   (`FIREBASE_DEPLOY_ONLY` con `storage`). Si el camino es de un flujo nuevo,
   además su línea en la tabla de capacidades de `admin/DISENO.md` §4sexies.

---

> **Aviso del 17/09/2026, tras dos intentos fallidos de `v0.5.3`.** El
> despliegue de reglas de Storage por CI **no** puede depender del bucket por
> defecto del proyecto: con la identidad federada de la cuenta de despliegue,
> `GET /v1alpha/projects/{p}/defaultBucket` responde 404 aunque el bucket
> exista, el dueño reciba 200 y el verificador de políticas diga que
> `firebasestorage.defaultBucket.get` está concedido. firebase-tools lo
> traduce a «Firebase Storage has not been set up», que apunta a la causa
> equivocada. Por eso `firebase.json` declara las reglas sobre el destino
> `principal` y el workflow lo resuelve con `firebase target:apply storage
> principal <bucket>` desde `vars.VITE_FIREBASE_STORAGE_BUCKET` antes de
> simular. Con un destino explícito firebase-tools no consulta esa API.

## 3. Despliegue

Nada de esto lo hace un agente: lo hace una persona, con la cuenta dueña del
proyecto, en el orden de abajo. **Verificado en el código de firebase-tools
15.29.0** (la versión que fija `admin/pnpm-lock.yaml`; se cita la copia de
`admin/node_modules/.pnpm/firebase-tools@15.29.0…/node_modules/firebase-tools/`,
y en 14.27.0 las mismas funciones están en las mismas líneas salvo que se
indique).

### 3.1 El bucket por defecto (una persona, en la consola de Firebase)

Consola de Firebase → **Storage** → **Comenzar** → **modo producción** (todo
cerrado hasta que se desplieguen estas reglas) → ubicación. El proyecto ya está
en Blaze (tiene Functions de 2.ª generación), que es lo que Firebase exige hoy
para crear un bucket.

Sin bucket, `firebase deploy --only storage` corta: `deploy/storage/prepare.js:31`
llama a `getDefaultBucket`, que en `gcp/storage.js:32-50` pide
`GET https://firebasestorage.googleapis.com/v1alpha/projects/<proyecto>/defaultBucket`
y, ante un 404, lanza «Firebase Storage has not been set up on project…». **Ojo
con `deploy.sh`**: agrega `storage` solo, en cuanto existen `admin/storage.rules`
y la clave `storage` en `firebase.json` (las dos ya están en esta rama), así que
un despliegue con `deploy.sh` falla hasta que el bucket exista.

Anotar el **nombre exacto del bucket** que muestra la consola (los buckets
nuevos se llaman `<proyecto>.firebasestorage.app`; los viejos, `…appspot.com`):
es el valor de `VITE_FIREBASE_STORAGE_BUCKET`.

### 3.2 El rol del agente de Storage (una vez por proyecto)

Las reglas de captación leen la ficha del comercio con `firestore.get()`. Para
eso la cuenta de servicio de Storage necesita
`roles/firebaserules.firestoreServiceAgent`; **sin él, toda regla que lee
Firestore deniega**.

```bash
NUMERO=$(gcloud projects describe <proyecto> --format='value(projectNumber)')
gcloud projects add-iam-policy-binding <proyecto> \
  --member="serviceAccount:service-${NUMERO}@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
  --role="roles/firebaserules.firestoreServiceAgent" --condition=None
```

**Por qué a mano y no «lo hace el deploy»**, verificado en
`lib/rulesDeploy.js` de 15.29.0:

- línea 17: `CROSS_SERVICE_FUNCTIONS = /firestore\.(get|exists)/`; línea 18:
  `CROSS_SERVICE_RULES_ROLE = "roles/firebaserules.firestoreServiceAgent"`;
- líneas 61-88, `checkStorageRulesIamPermissions`: si las reglas usan
  `firestore.get`/`exists`, arma la cuenta
  `service-<número>@gcp-sa-firebasestorage.iam.gserviceaccount.com` (línea 69) y
  **pregunta** si concede el rol (líneas 74-82);
- líneas 65-67: **con `nonInteractive`, sale sin mirar nada**. El CI despliega
  con `--non-interactive`, así que el rol nunca se concede solo;
- línea 106: solo se llama al subir un ruleset nuevo de Storage (en 14.27.0,
  línea 101).

El comentario de `admin/storage.rules` (líneas 139-147) dice lo mismo. La cuenta
`service-…@gcp-sa-firebasestorage…` existe recién después del paso 3.1.

### 3.3 Permisos de la cuenta de despliegue para `--only storage`

Lo que firebase-tools exige y llama, en 15.29.0:

| Qué | Dónde | Permiso | Rol que lo trae |
|---|---|---|---|
| Chequeo previo del objetivo `storage` | `deploy/index.js:60-64` (`TARGET_PERMISSIONS.storage`) | `firebaserules.releases.create`, `firebaserules.rulesets.create`, `firebaserules.releases.update` | `roles/firebaserules.admin` (ya lo tiene, `.github/DESPLIEGUE-FIREBASE.md` §2.2) |
| Compilar y probar las reglas | `gcp/rules.js:161` (`projects:test`) | `firebaserules.projects.test` | ídem |
| Ruleset vigente y su contenido | `gcp/rules.js:44` (releases), `:68` (ruleset) | `firebaserules.releases.list`, `firebaserules.rulesets.get` | ídem |
| Subir el ruleset y publicarlo como `firebase.storage/<bucket>` | `gcp/rules.js:120`, `:132`/`:146`; nombre en `rulesDeploy.js:153-163` | `rulesets.create`, `releases.create`/`update` | ídem |
| ¿Está habilitada la API de Storage? | `gcp/storage.js:33` → `ensureApiEnabled.js:25-44` (`GET services/firebasestorage.googleapis.com`) | `serviceusage.services.get` | `roles/serviceusage.serviceUsageConsumer` (ya lo tiene) |
| Si la API estuviera apagada, la habilita | `ensureApiEnabled.js:46` y `:106-118` | `serviceusage.services.enable` | **no se le da**: la API queda habilitada en el paso 3.1 |
| El bucket por defecto | `gcp/storage.js:39` (`defaultBucket`, v1alpha) | `firebasestorage.defaultBucket.get` | `roles/firebasestorage.viewer` — **nuevo**, agregado a `DESPLIEGUE-FIREBASE.md` §2.2 |

La columna «Rol que lo trae» sale de la documentación de IAM, no del código:
**comprobar con Policy Troubleshooter** (`gcloud policy-troubleshoot iam`) antes
del primer despliegue, para no gastar un ciclo de etiqueta y aprobación en un
permiso que falta. Borrar rulesets viejos (`gcp/rules.js:79` y `:107`) solo
ocurre si se llega al tope de 1000 y con confirmación: no hace falta concederlo.

### 3.4 Variables de GitHub

- **`FIREBASE_DEPLOY_ONLY`** (Environments `staging` y `production`): hoy
  `hosting,firestore:rules,firestore:indexes,functions`. Agregarle `,storage`
  **recién después** de 3.1 y 3.2. Mientras la variable exista sin `storage`,
  las reglas de Storage no se despliegan (el valor por defecto del workflow ya
  incluye `storage`, pero solo rige si la variable no existe).
- **`VITE_FIREBASE_STORAGE_BUCKET`** (variable nueva, con las otras `VITE_*`):
  el nombre del bucket del paso 3.1, con o sin `gs://`. El workflow la pasa a la
  compilación desde esta rama (antes no la pasaba: la consola habría salido con
  Storage apagado aunque la variable existiera). Sin ella, la consola compila
  igual y «Subir» queda deshabilitado con su explicación.
- La CSP de `admin/firebase.json` ya incluye `https://firebasestorage.googleapis.com`
  en `connect-src`.

### 3.5 El orden del primer despliegue (con el contador de catálogo)

Esta rama trae también el límite de productos por plan, cuyas reglas **niegan
crear o borrar un producto si el comercio no tiene contador**. Por eso el orden
importa, y es este:

0. **Antes de tocar nada:** 3.1, 3.2, el rol de 3.3 comprobado, y
   `VITE_FIREBASE_STORAGE_BUCKET` creada.
1. **Functions.** `importarCatalogo`, `actualizarEstadoCuenta` parcial, el aviso
   de consumo de la ingesta y `altaTenant` con plan y contador. Van primero
   porque la consola nueva llama a `importarCatalogo` (para importar y para
   crear el contador que falte), y la ingesta es la que marca el aviso.
   Pasada del pipeline con `FIREBASE_DEPLOY_ONLY=functions`.
2. **Los scripts, primero en seco y después con `--aplicar`** (credenciales
   aisladas, `docs/alta-cliente/RUNBOOK.md` etapa 4):

   ```bash
   node admin/scripts/contar-catalogo.mjs --proyecto <proyecto>            # seco: dice qué haría
   node admin/scripts/contar-catalogo.mjs --proyecto <proyecto> --aplicar  # crea o corrige cada contador
   node admin/scripts/asignar-plan.mjs --proyecto <proyecto> --tenant demo-agendamiento --plan demostracion
   node admin/scripts/asignar-plan.mjs --proyecto <proyecto> --tenant demo-agendamiento --plan demostracion --aplicar
   # lo mismo para demo-venta (demostracion), novuchat y cada comercio con su plan contratado
   ```

   `contar-catalogo.mjs` avisa del comercio que ya esté por encima de su
   límite y **no borra nada**. `asignar-plan.mjs` escribe la copia de límites
   que leen las reglas; sin ella rige el respaldo por plan, y el viejo
   `'basico'` cae en Impulso (20 productos).
3. **Consola** (`hosting`) **y reglas** (`firestore:rules,storage`), **en la
   misma pasada**: `FIREBASE_DEPLOY_ONLY=hosting,firestore:rules,firestore:indexes,functions,storage`
   (el valor definitivo). La consola nueva mueve el contador en cada alta y
   baja, y las reglas viejas no conocen `/contadores`: con la consola nueva y
   las reglas viejas, altas y bajas fallan; con la consola vieja y las reglas
   nuevas, también (no mueve el contador). En un mismo `firebase deploy` la
   ventana es de segundos: firebase-tools prepara y sube todo y recién después
   publica, en el orden de `VALID_DEPLOY_TARGETS` (`deploy/index.js:30-42`:
   `storage`, `firestore`, `functions`, `hosting`; ver `:172-197`).
4. **Comprobar:** en la consola, dar de alta y de baja un producto en un
   comercio de prueba, ver «N de 20 productos (plan Impulso)», subir un PDF de
   planes en «Captación» y abrir su URL, y `contar-catalogo.mjs` en seco con
   todos los contadores al día.

**Rollback:** reglas de Firestore y de Storage se vuelven atrás publicando el
ruleset anterior desde la consola de Firebase (Reglas → historial). Con las
reglas nuevas revertidas, los contadores quedan como datos inertes.

---

## 4. Lo que queda afuera, y está dicho

- El `contentType` es declarado: la regla no ve el contenido. La defensa del
  contenido es la comprobación del servidor y la de la consola.
- La URL con token no se vence sola: un archivo que no debería estar se borra.
- No hay App Check exigido en Storage ni en las Functions callables (ninguna
  declara `enforceAppCheck`): un administrador con sesión válida es quien puede
  subir o llamarlas. Exigirlo es un cambio aparte, para todas a la vez.

---

## 5. Propuesta para el estándar SeguridadGeneral

**No se tocó ese repositorio.** Lo que sigue es lo que habría que llevarle, para
que el próximo proyecto con Storage no reescriba esto.

### 5.1 Plantilla

Llevar `docs/seguridad/storage.rules.plantilla` como plantilla del estándar
(junto a la de `firestore.rules`), con el §1 de este documento como su guía.
Supuestos que la plantilla declara y que cada proyecto cambia: claims con
espacio de nombres, vínculo rol ↔ proveedor, ficha del tenant en
`/tenants/{id}` con `estado` y `flujos`. Y en el checklist del estándar: «si hay
`storage.rules`, hay pruebas con emulador, el paso de CI tiene
`timeout-minutes`, y la negación final está».

### 5.2 Regla de Semgrep

`devsecops.firestore-reglas-abiertas` ya incluye `storage.rules`, pero solo ve
`read, write` y `write` abiertos. Propuesta, probada con Semgrep 1.174.0 contra
una muestra con cuatro reglas malas (las cuatro detectadas) y contra
`admin/storage.rules` y `admin/firestore.rules` de este repositorio (0
hallazgos):

```yaml
  - id: devsecops.storage-acceso-abierto
    message: >-
      Regla de Storage (o Firestore) que abre una operación a cualquiera:
      `allow <op>: if true` o `allow <op>;` sin condición. En Storage eso vuelve
      público un archivo, o deja subir cualquier cosa de cualquier tamaño.
    severity: ERROR
    languages: [generic]
    paths:
      include:
        - "*.rules"
    pattern-either:
      - pattern: "allow read: if true"
      - pattern: "allow get: if true"
      - pattern: "allow list: if true"
      - pattern: "allow create: if true"
      - pattern: "allow update: if true"
      - pattern: "allow delete: if true"
      - pattern: "allow get, list: if true"
      - pattern: "allow create, update: if true"
      - pattern: "allow read;"
      - pattern: "allow get;"
      - pattern: "allow list;"
      - pattern: "allow create;"
      - pattern: "allow update;"
      - pattern: "allow delete;"
      - pattern: "allow write;"
    metadata:
      category: security
      cwe: "CWE-284: Improper Access Control"

  - id: devsecops.storage-solo-autenticado
    message: >-
      Condición que solo pide sesión (`request.auth != null`). En una
      plataforma multi-tenant cualquier usuario de CUALQUIER comercio la cumple:
      hay que atar el camino al tenant de la ruta y al rol del token, y en
      Storage además el tipo y el tamaño del archivo.
    severity: WARNING
    languages: [generic]
    paths:
      include:
        - "*.rules"
    pattern-either:
      - pattern: "if request.auth != null;"
      - pattern: "if request.auth != null }"
    metadata:
      category: security
      cwe: "CWE-639: Authorization Bypass Through User-Controlled Key"
```

Límites conocidos de la propuesta: Semgrep en modo `generic` compara texto, así
que una condición abierta escrita de otra forma (`if 1 == 1`) no la ve, y la
**ausencia** de la negación final no se puede expresar como patrón: eso lo
sigue cubriendo el control con `grep` del job `calidad`, que convendría llevar
también al workflow reutilizable del estándar.
