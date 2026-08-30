# Poner el panel `admin/` a andar en Firebase — instructivo de CI/CD

Estado al 2026-08-29: **no existe ningún proyecto Firebase**. Nada de lo que
sigue se ejecutó; ningún agente creó recursos en la nube ni usó una sesión de
`gcloud` o `firebase`. Este archivo es la parte de CI/CD; lo que hay que crear
en la consola está en `admin/DISENO.md` §11, y no se repite acá.

Cuentas: GitHub `segurolotengopy` · Firebase y GCP con `${GOOGLE_ACCOUNT_PANEL}`
(la cuenta nueva del proyecto, **ya no la personal**; el valor real está en `CONFIGURACION.local.md`).

> El repositorio es **público**. Ningún valor real de los que se generen acá va
> a un archivo versionado: van a *Secrets* y *Variables* de GitHub y a
> `CONFIGURACION.local.md`. Ver `CONVENCIONES-REPO-PUBLICO.md`.

---

## 0. Antes de empezar: dos cosas que van a fallar en el navegador

No son de CI/CD, pero se van a manifestar el minuto siguiente a que el
despliegue salga bien, y conviene arreglarlas antes de perder la tarde. Las dos
están en `admin/firebase.json`, que **no es de este agente**: hay que pedírselo
al agente del panel.

**1. La CSP bloquea el inicio de sesión con Google.** La política es
`default-src 'none'` y no declara `frame-src`. Firebase Auth carga un iframe
desde `https://<authDomain>/__/auth/iframe`; sin `frame-src` ese iframe cae en
`default-src 'none'` y queda bloqueado. Síntoma: la pantalla de login aparece,
se hace clic y no pasa nada. Falta algo como:

```
frame-src https://<PROJECT_ID>.firebaseapp.com https://accounts.google.com;
```

**2. La CSP bloquea App Check.** `admin/web/src/lib/firebase.ts` inicializa App
Check con `ReCaptchaEnterpriseProvider`, que carga un script de
`https://www.google.com/recaptcha/` y recursos de `https://www.gstatic.com`.
La política dice `script-src 'self'`. Con la clave cargada, App Check no
arranca. Mientras se prueba, la salida barata es **no definir**
`VITE_APPCHECK_SITE_KEY`: el código ya está guardado con `if (!enEmuladores &&
claveAppCheck)`, así que sin la variable no intenta inicializarlo.

---

## 1. Qué crear, en qué orden

Dos proyectos, como recomienda `admin/DISENO.md` §11: `novuchat-admin-dev` y
`novuchat-admin-prod`. No reutilizar el de los demos: comparten cuota, reglas y
superficie de IAM con algo que va a estar en vivo el 9 y 10 de septiembre.

El pipeline tiene tres destinos (`dev`, `staging`, `production`) y solo hay dos
proyectos. El mapeo sugerido: **`dev` y `staging` apuntan a
`novuchat-admin-dev`**, `production` a `novuchat-admin-prod`. Si prefiere no
usar `staging` por ahora, simplemente no cree su Environment y ese job fallará
al autenticar, sin tocar nada más.

### 1.1 Por proyecto, en la consola

Los pasos de Firebase (Auth, Firestore, App Check, Blaze, presupuesto) están en
`admin/DISENO.md` §11. Acá solo lo que el CI necesita.

**Habilitar las APIs** (una vez por proyecto):

```bash
PROYECTO=novuchat-admin-dev     # repetir con novuchat-admin-prod

gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  iam.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firebaserules.googleapis.com \
  firestore.googleapis.com \
  --project="$PROYECTO"
```

Solo si va a desplegar **Cloud Functions** (exige plan **Blaze**; en Spark el
despliegue falla entero por ese único componente):

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  eventarc.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROYECTO"
```

**Anotar el número de proyecto** — hace falta para la federación:

```bash
gcloud projects describe "$PROYECTO" --format='value(projectNumber)'
```

---

## 2. Federación de identidades — la condición exacta

Esta es la parte que más fácil se hace mal, y con el repositorio **público** el
error no es teórico: una condición laxa por `repository_owner` deja que
**cualquiera que forkee el repositorio** abra un PR desde su fork, obtenga un
token OIDC de GitHub y lo canjee por credenciales de despliegue.

### 2.1 Pool y proveedor

```bash
PROYECTO=novuchat-admin-dev
NUM=$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')

gcloud iam workload-identity-pools create github \
  --project="$PROYECTO" --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc novuchat \
  --project="$PROYECTO" --location=global \
  --workload-identity-pool=github \
  --display-name="segurolotengopy/NovuChat" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --allowed-audiences="https://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/github/providers/novuchat" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name" \
  --attribute-condition="assertion.repository == 'segurolotengopy/NovuChat' && assertion.repository_owner == 'segurolotengopy' && assertion.sub in ['repo:segurolotengopy/NovuChat:environment:dev','repo:segurolotengopy/NovuChat:environment:staging','repo:segurolotengopy/NovuChat:environment:production','repo:segurolotengopy/NovuChat:environment:production-rollback']"
```

La condición de atributos, aparte por si hay que leerla o pegarla suelta:

```cel
assertion.repository == 'segurolotengopy/NovuChat' &&
assertion.repository_owner == 'segurolotengopy' &&
assertion.sub in [
  'repo:segurolotengopy/NovuChat:environment:dev',
  'repo:segurolotengopy/NovuChat:environment:staging',
  'repo:segurolotengopy/NovuChat:environment:production',
  'repo:segurolotengopy/NovuChat:environment:production-rollback'
]
```

**Por qué está escrita así, cláusula por cláusula:**

- `assertion.repository == '...'` ata el token a **este** repositorio. Es lo que
  cierra la puerta del fork: el token de un fork trae
  `repository: otro/NovuChat` y no pasa. Comparar solo `repository_owner`
  **no** alcanza, porque el dueño del fork es quien forkeó, no usted — y peor,
  una condición del tipo `repository_owner == 'segurolotengopy'` aceptaría
  cualquier otro repositorio suyo, presente o futuro.
- `assertion.sub in [...]` ata el token a un **Environment** de GitHub. El
  `sub` de un job que declara `environment: dev` es exactamente
  `repo:segurolotengopy/NovuChat:environment:dev`. Un job que **no** declara
  `environment:` tiene un `sub` de la forma `...:ref:refs/heads/main` o
  `...:pull_request`, y **no pasa**. Es una segunda cerradura independiente: aun
  si alguien lograra ejecutar código en el repositorio real, sin Environment no
  hay credenciales.
- Se usa `assertion.sub` y no `attribute.environment` a propósito: el claim
  `environment` **solo existe** cuando el job declara `environment:`, y mapear
  un claim ausente hace fallar el canje con un error que no explica nada. `sub`
  está siempre presente.

`production-rollback` está en la lista por un motivo concreto: el job
`post-despliegue` hace el health check de producción y, si falla, ejecuta el
rollback clonando el canal `previa` sobre `live`. Necesita credenciales, y por
tanto un Environment. **No puede usar `production`**, porque su revisor
obligatorio dejaría el rollback esperando aprobación humana — lo contrario de
un rollback. Por eso tiene el suyo, **sin reglas de protección**.

> ⚠️ Consecuencia a tener presente: **cualquier job que pida `id-token: write`
> sin declarar `environment:` no va a poder autenticarse.** Hoy el único es
> `previsualizar` (canales de vista previa en PR), que está apagado por defecto
> (`vars.FIREBASE_PREVIEW`). Si algún día lo enciende, hay que darle su propio
> Environment y agregar su `sub` a la lista — nunca aflojar la condición.

### 2.2 Cuenta de servicio de despliegue y quién puede suplantarla

Una cuenta por proyecto. **No se genera ninguna clave JSON**; si alguna
herramienta la pide, es señal de que el paso anterior quedó mal.

```bash
gcloud iam service-accounts create sa-deploy-dev \
  --project="$PROYECTO" --display-name="Despliegue del panel (CI)"

SA="sa-deploy-dev@${PROYECTO}.iam.gserviceaccount.com"

# Roles mínimos para hosting + reglas + índices
for R in roles/firebasehosting.admin \
         roles/firebaserules.admin \
         roles/datastore.indexAdmin \
         roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:${SA}" --role="$R" --condition=None
done

# Solo si además despliega Cloud Functions (Gen2 = Cloud Run + Cloud Build)
for R in roles/cloudfunctions.developer \
         roles/run.admin \
         roles/artifactregistry.writer \
         roles/cloudbuild.builds.editor \
         roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:${SA}" --role="$R" --condition=None
done
```

Y la parte que hace que la federación pueda suplantarla — **solo desde el
Environment que corresponde**:

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project="$PROYECTO" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/github/subject/repo:segurolotengopy/NovuChat:environment:dev"
```

`principal://` (singular, sujeto exacto) y no `principalSet://.../attribute.repository/...`:
el `principalSet` por repositorio autorizaría a **todos** los Environments del
repositorio contra la misma cuenta, que es justo lo que se quiere evitar entre
dev y producción. En `novuchat-admin-prod` se repite todo con `sa-deploy-prod`, y con **dos**
bindings: `...:environment:production` (despliegue) y
`...:environment:production-rollback` (health check y rollback).

**Cómo comprobar que quedó bien, sin desplegar nada:** en GitHub, *Actions →
Run workflow → destino `dev`*. Si la condición está mal, el paso «Autenticar en
GCP» falla con `Unable to acquire impersonated credentials` o
`The given credential is rejected by the attribute condition`, **antes** de
tocar Firebase. Es el orden que conviene: primero que falle la puerta, después
lo demás.

---

## 3. Camino recomendado para probar rápido

**Recomendación: despliegue manual a `dev` con `workflow_dispatch`.** Ya está
implementado: job `desplegar-dev` en `.github/workflows/ci-node-firebase.yml`.

En GitHub: *Actions → «CI/CD Node → Firebase» → Run workflow → destino `dev`*.

**Por qué no los canales de vista previa de Hosting**, que era la otra opción:

1. Un canal de vista previa publica **solo el frontend**. No despliega reglas de
   Firestore, ni índices, ni Functions. El panel sin reglas desplegadas no lee
   un solo documento: vería la pantalla de login y nada más. No sirve para
   «probar la consola andando».
2. Exige que el proveedor OIDC confíe en el evento `pull_request`. Con el
   repositorio público eso amplía la superficie exactamente donde no conviene, y
   obliga a aflojar la condición del punto 2.
3. Necesita un PR abierto, y por tanto un remoto configurado y la rama
   protegida. Es montar la operación, que es justo lo que se quiere evitar hoy.

El despliegue manual a `dev`, en cambio, no necesita PR, no expone nada a los
forks, y publica hosting + reglas + índices de una sola vez.

**Sobre Functions en el primer intento:** requieren plan **Blaze**. Si
`novuchat-admin-dev` queda en Spark, deje
`FIREBASE_DEPLOY_ONLY_DEV = hosting,firestore:rules,firestore:indexes` (es el
valor por omisión del job) o el despliegue **falla entero** por ese único
componente. El panel se puede recorrer sin Functions; lo que no va a andar es
la ingesta desde n8n ni el envío de reclamos.

---

## 4. Cloud Functions con workspaces de pnpm

Este es el punto que rompió el despliegue en otro proyecto. Lo investigué
leyendo el código de `firebase-tools` 14.27 que está instalado en
`admin/node_modules`, no de memoria:
`lib/deploy/functions/prepareFunctionsUpload.js` línea 56.

**Qué hace `firebase deploy` realmente:** comprime **solo** el directorio
`source` de `firebase.json` — acá `admin/functions/` — excluyendo `node_modules`
y `.git`. No sube el monorepo. Después Cloud Build instala las dependencias del
lado del servidor **con npm**, no con pnpm.

De ahí salen tres problemas, y los tres están resueltos o acotados en el job
`construir`:

| # | Problema | Estado |
|---|---|---|
| 1 | `functions/lib/` está en `admin/functions/.gitignore`, así que **no viene del checkout**. Sin construirlo, se sube un paquete cuyo `main: lib/index.js` apunta a un archivo inexistente. | **Resuelto.** `construir` compila y sube `functions/lib/` como artefacto; los tres jobs de despliegue lo bajan a `admin/functions/`. Era un fallo seguro y no estaba cubierto. |
| 2 | `pnpm-lock.yaml` vive en `admin/`, **no** en `admin/functions/`, así que no entra al zip. Cloud Build instalaría sin lockfile y resolvería el último semver compatible: el despliegue deja de ser reproducible y una versión menor de `firebase-functions` puede romper producción sin que cambie una línea de código. | **Resuelto.** `construir` ejecuta `npm install --package-lock-only` dentro de `functions/`, y ese `package-lock.json` sí entra al zip. Cloud Build usa `npm ci`. |
| 3 | Si alguna dependencia usara el protocolo `workspace:*`, npm fallaría con `EUNSUPPORTEDPROTOCOL` en Cloud Build — lejos del código y con un mensaje opaco. **Es el fallo clásico de este desajuste.** | **No ocurre hoy** (verificado: `functions/package.json` declara `firebase-admin` y `firebase-functions` con semver normal), y hay un paso que rompe la compilación si alguien lo introduce. |

**Si aun así falla**, el orden para diagnosticar:

1. `firebase deploy --only functions --debug` y mirar el log de Cloud Build en
   la consola, no la salida del CLI.
2. Confirmar que el zip subido trae `lib/`, `package.json` y
   `package-lock.json`. Si falta `lib/`, el artefacto no se descargó.
3. Si Cloud Build se queja de una dependencia que no existe en el registro
   público, es una dependencia interna del workspace: hay que publicarla o
   copiar el código dentro de `functions/`.
4. Salida de emergencia si el lockfile diera guerra: borrar
   `functions/package-lock.json` del paso de `construir`. Se pierde
   reproducibilidad, se gana un despliegue.

**No verificado:** nada de esto se ejecutó contra un proyecto real, porque no
existe ninguno. El análisis del empaquetado sí está verificado contra el código
de `firebase-tools`; el comportamiento de Cloud Build **no**.

---

## 5. Secretos y variables en GitHub

`Settings → Secrets and variables → Actions`. Los **secretos** de producción
conviene cargarlos en el Environment `production`, no a nivel repositorio.

### 5.1 Environments a crear

`Settings → Environments`. Los nombres importan: son los que aparecen en el
`sub` del token OIDC y tienen que coincidir con la condición del punto 2.

| Environment | Revisor obligatorio | Para qué |
|---|---|---|
| `dev` | no | despliegue manual de prueba |
| `staging` | no | push a `main` (opcional por ahora) |
| `production` | **sí** — regla §4: nadie aprueba su propio cambio | tags `v*` |
| `production-rollback` | **no** — a propósito | health check y rollback automático |

### 5.2 Secretos

| Secreto | Valor esperado | De dónde sale |
|---|---|---|
| `GCP_WIF_PROVIDER` | `projects/<NUM>/locations/global/workloadIdentityPools/github/providers/novuchat` | `<NUM>` es el número de proyecto del punto 1.1 |
| `GCP_SA_DEPLOY_DEV` | `sa-deploy-dev@novuchat-admin-dev.iam.gserviceaccount.com` | punto 2.2 |
| `GCP_SA_DEPLOY_STAGING` | igual que el de dev si comparten proyecto | punto 2.2 |
| `GCP_SA_DEPLOY_PROD` | `sa-deploy-prod@novuchat-admin-prod.iam.gserviceaccount.com` | punto 2.2, en el Environment `production` |
| `GITLEAKS_LICENSE` | opcional; vacío en cuentas personales | gitleaks.io |
| `RELEASE_TOKEN` | opcional; PAT fine-grained con `contents:write` | solo si quiere que el tag de `release.yml` dispare los `ci-*` |

> El proveedor y los correos de las cuentas de servicio **no son secretos
> criptográficos**: son identificadores. Van como secretos igual, porque el
> repositorio es público y publicarlos facilita el reconocimiento. Lo que
> protege el despliegue es la condición de atributos, no que estén ocultos.

### 5.3 Variables

| Variable | Valor | Nota |
|---|---|---|
| `MODO` | `A` | repositorio público |
| `GHAS_ENABLED` | `false` | cuenta personal |
| `NODE_VERSION` | `22` | coincide con `nodejs22` de `firebase.json` |
| `COVERAGE_MIN` | `70` | hoy no se aplica: falta el script `test` |
| `BLOQUEAR_EN` | `CRITICAL,HIGH` | |
| `WORKFLOW_PRODUCCION` | `ci-node-firebase.yml` | |
| `APROBADORES_PROD` | `segurolotengopy` | logins separados por coma |
| `TAG_FIRMADO_REQUERIDO` | `false` | |
| `GCP_PROJECT_ID_DEV` | `novuchat-admin-dev` | |
| `GCP_PROJECT_ID_STAGING` | `novuchat-admin-dev` | mismo proyecto que dev |
| `GCP_PROJECT_ID_PROD` | `novuchat-admin-prod` | |
| `DEV_URL` | `https://novuchat-admin-dev.web.app` | |
| `STAGING_URL` | igual que `DEV_URL` | |
| `PROD_URL` | `https://novuchat-admin-prod.web.app` | |
| `FIREBASE_DEPLOY_ONLY_DEV` | `hosting,firestore:rules,firestore:indexes` | agregar `,functions` **solo con Blaze** |
| `FIREBASE_DEPLOY_ONLY` | `hosting,firestore:rules,firestore:indexes,functions` | staging y producción |
| `FIREBASE_SITE_ID` | no crear salvo sitio de Hosting con nombre propio | por omisión usa `GCP_PROJECT_ID_PROD` |
| `HEALTH_PATH` | `/` | el panel es una SPA, no expone `/healthz` |
| `FIREBASE_PREVIEW` | no crear | encenderla exige tocar la condición OIDC |
| `VITE_FIREBASE_API_KEY` | de la app web del proyecto | Configuración del proyecto → Tus apps |
| `VITE_FIREBASE_AUTH_DOMAIN` | `novuchat-admin-dev.firebaseapp.com` | idem |
| `VITE_FIREBASE_PROJECT_ID` | `novuchat-admin-dev` | idem |
| `VITE_FIREBASE_APP_ID` | `1:...:web:...` | idem |
| `VITE_APPCHECK_SITE_KEY` | **dejar sin crear al principio** | ver punto 0.2 |

> ⚠️ Las `VITE_*` viajan en el bundle y son públicas por diseño; no son
> secretos. Pero hoy son **variables de repositorio**, así que las dos ramas de
> la matriz (`staging` y `production`) reciben **los mismos valores**: el bundle
> de producción se construiría apuntando al proyecto de dev. Para separarlos de
> verdad hay que declarar `environment:` en el job `construir` y mover las
> `VITE_*` a cada Environment. Está anotado en el propio workflow.

---

## 6. Orden sugerido para la primera vez

1. Crear `novuchat-admin-dev` y habilitar APIs (punto 1.1).
2. Pool, proveedor y condición de atributos (punto 2.1).
3. Cuenta de servicio y binding por Environment (punto 2.2).
4. Environment `dev` en GitHub, sin revisor.
5. Cargar `GCP_WIF_PROVIDER`, `GCP_SA_DEPLOY_DEV`, `GCP_PROJECT_ID_DEV`,
   `DEV_URL` y las `VITE_FIREBASE_*`. **Sin `VITE_APPCHECK_SITE_KEY`.**
6. *Run workflow* con destino `dev`. Si falla al autenticar, es el punto 2; si
   falla al desplegar, es Firebase.
7. Abrir la URL, iniciar sesión. Si el login no responde, es la CSP del
   punto 0.1.
8. Recién con eso andando: Blaze, Functions, App Check, y `-prod`.
