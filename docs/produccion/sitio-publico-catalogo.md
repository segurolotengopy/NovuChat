# Segundo sitio de Hosting para la página pública del catálogo (T-37)

**Versión 1 · 03-oct-2026.** Procedimiento de operación del cambio de `admin/SEGURIDAD.md`
T-37. Sin secretos ni identificadores: los de cada ambiente se leen de las
variables de GitHub y de las credenciales aisladas, y nunca se imprimen.

**Quién lo ejecuta:** Claude, con el «sí» de Andres por paso (todo lo que escribe
en Firebase o en GitHub lo pide antes). Lo único que hace una persona es aprobar
el Environment `production` cuando el CI lo pide.

## 0. Qué cambia y por qué

| Antes | Ahora |
|---|---|
| Un sitio de Hosting: la consola y `/c/<ficha>` en el mismo origen | Dos sitios: `consola` y `catalogo` (otro origen) |
| `firebase.json` con un `hosting` | Un `hosting` por destino (`target`): `consola` → `web/dist`, `catalogo` → `web/dist-catalogo` |
| `SITIO_PUBLICO` opcional; sin él, el enlace salía como `https://<proyecto>.web.app` | `SITIO_PUBLICO` obligatoria: es la dirección del sitio `catalogo`. Sin ella, `enlaceCatalogo` contesta 500 |
| Despliegue: `firebase deploy --only hosting` publica una carpeta | Publica las dos; resuelve los destinos con `firebase target:apply hosting …` desde las variables `FIREBASE_SITE_ID` (o el proyecto) y `HOSTING_SITIO_CATALOGO` |

**Por qué.** El origen de la consola guarda las sesiones de administrador (IndexedDB
es por origen). La página pública la abre cualquier cliente final: si ahí corriera
código ajeno, estaría a un paso de ese origen. T-37 fija el disparador: **antes de
que el primer comercio que no sea de prueba encienda `catalogoWebActivo`**. Q'Taco
lo enciende el lunes 05/10: este procedimiento va antes.

**Lo que NO hace falta, y por qué:**
- **CORS.** La página pide `/api/catalogo/...` por rutas relativas que el propio
  sitio público reescribe a las Functions: es el mismo origen. Las Functions siguen
  con `cors: false`, y la CSP del sitio tiene `connect-src 'self'`. Abrir CORS sería
  dejar que otro origen las llame.
- **Dominios autorizados de Firebase Auth.** La página pública no carga Auth.
- **IAM nuevo para las Functions.** Siguen siendo invocables por `allUsers`
  (`scripts/nube-catalogo.sh` lo diagnostica sin escribir).

## 1. Decisiones que le tocan a Andres (antes de ejecutar)

| # | Decisión | Recomendación | Por qué depende de él |
|---|---|---|---|
| H1 | **Identificador del segundo sitio** de producción y de staging. Es único en todo Firebase: si está tomado, `sites:create` lo rechaza | `novuchat-catalogo-prod` (el que nombra T-37) y `<proyecto de staging>-catalogo` | El cliente final ve ese nombre en el enlace de WhatsApp |
| H2 | **Dirección pública**: `https://<sitio>.web.app` (sin DNS, sirve ya) o dominio propio (por ejemplo, uno bajo el dominio del producto) | `.web.app` el lunes; dominio propio después, sin apuro: los enlaces repartidos siguen valiendo 72 horas y el sitio `.web.app` sigue respondiendo | El dominio exige DNS (registros que solo el dueño del dominio puede crear) |
| H3 | **Cuenta de Google que crea el sitio** | La cuenta dueña del proyecto, con las credenciales aisladas (`gcloud-novuchat-prod`) | Depende de qué cuenta es dueña de cada proyecto |

## 2. Variables y valores (lo que se carga, nunca los valores)

| Dónde | Nombre | Valor |
|---|---|---|
| Environment `staging` | `HOSTING_SITIO_CATALOGO` | el identificador del sitio de staging (H1) |
| Environment `staging` | `SITIO_PUBLICO` | `https://<sitio de staging>.web.app` (hoy es la URL de la consola de staging: el despliegue lo rechaza) |
| Repositorio (producción) | `HOSTING_SITIO_CATALOGO` | el identificador del sitio de producción (H1) |
| Repositorio (producción) | `SITIO_PUBLICO` | la dirección pública (H2) (hoy es la de la consola: el despliegue de producción lo rechaza) |
| Repositorio / Environment `staging` | `HOSTING_DOMINIO_CATALOGO` | **opcional**, solo con dominio propio (H2): el nombre de host, o varios separados por comas. Sin ella, `SITIO_PUBLICO` solo puede ser `<sitio>.web.app` o `<sitio>.firebaseapp.com` del sitio del catálogo |

**Qué rechaza la compuerta de despliegue** (`scripts/comprobar-origen-catalogo.sh`,
probada negando en `sitio-publico.test.ts`): compara el **host normalizado** de
`SITIO_PUBLICO` (minúsculas, sin esquema, usuario, ruta, puerto ni punto final) y
rechaza siempre `<sitio de la consola>` y `<proyecto>` en `.web.app` y
`.firebaseapp.com`, y el host de `PROD_URL` / `STAGING_URL`: la consola responde en
todos esos, no solo en su dominio propio. Acepta solo `<HOSTING_SITIO_CATALOGO>.web.app`,
`<HOSTING_SITIO_CATALOGO>.firebaseapp.com` o un host listado en
`HOSTING_DOMINIO_CATALOGO`. Además, antes de publicar, el job consulta a Firebase
(`hosting:sites:get`, solo lectura) que el sitio exista **en ese proyecto**: una
variable de un Environment hereda el valor del repositorio si el Environment no la
define, y así se detecta también un id de producción que cayó en staging.
`firebase.json` usa `consola` → `FIREBASE_SITE_ID` (o el id del proyecto si no existe
la variable); el ejemplo de `.firebaserc` lo nombra así.

`FIREBASE_SITE_ID` no cambia: es el sitio de la consola (por omisión, el del proyecto).

## 3. Lista exacta de comandos

**Preparación común** (solo lectura; desde `admin/` de la copia principal, una sola
vez por sesión de operación). Nunca `firebase login` ni `firebase logout`: el CLI de
la máquina tiene guardada otra cuenta que no es dueña de los proyectos.

```bash
export CLOUDSDK_CONFIG="$HOME/.config/gcloud-novuchat-prod"; unset CLOUDSDK_ACTIVE_CONFIG_NAME
export GOOGLE_APPLICATION_CREDENTIALS="$CLOUDSDK_CONFIG/application_default_credentials.json"
export XDG_CONFIG_HOME="<carpeta temporal de la sesión>/fbcfg"     # configuración propia del CLI
export GH_CONFIG_DIR="$HOME/.config/gh-pro"
FB="npx --yes firebase-tools@15.28.1"                              # la misma versión que fija el CI
P_PROD="$(grep -o '"quota_project_id": *"[^"]*"' "$GOOGLE_APPLICATION_CREDENTIALS" | sed 's/.*"\([^"]*\)"$/\1/')"
P_STG="$(gh variable get GCP_PROJECT_ID_STAGING)"
CUENTA="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
```

**3.1 Verificar permisos ANTES de pedir nada** (Policy Troubleshooter; cada ciclo de
etiqueta y aprobación fallido cuesta horas). Todos tienen que dar `GRANTED`.
`hosting:sites:create` exige `firebasehosting.sites.update` en el CLI
(firebase-tools, `commands/hosting-sites-create.js`) y la API pide además
`firebasehosting.sites.create`: se miran los dos, en los dos proyectos, para la
cuenta que crea el sitio (H3):

```bash
for P in "$P_STG" "$P_PROD"; do
  for PERM in firebasehosting.sites.create firebasehosting.sites.update; do
    gcloud policy-troubleshoot iam "//cloudresourcemanager.googleapis.com/projects/$P" \
      --principal-email="$CUENTA" --permission="$PERM" --format='value(access)'
  done
done
```

y los de publicar con las cuentas de CI (`sa-deploy-prod@$P_PROD.iam.gserviceaccount.com`
y `sa-deploy-staging@$P_STG.iam.gserviceaccount.com`), cada una en su proyecto, con
`--permission=firebasehosting.sites.update`, `firebasehosting.versions.create` y
`firebasehosting.releases.create` (mismo comando, cambiando `--principal-email` y
`--permission`). `roles/firebasehosting.admin` es del proyecto entero: cubre un
segundo sitio sin cambios de IAM. Si alguno da `NOT_GRANTED`, se corrige en IAM
**antes**; no se sigue.

**3.2 Staging primero (es el ensayo del cambio).** `desplegar-staging` corre solo en
un push a `main` que toque `admin/`: **el sitio y las variables de staging tienen que
existir antes de fusionar**, o ese job falla cerrado (a propósito).

`scripts/preparar-staging.sh` ya lo hace, en seco por defecto (fases `sitio` y
`github`; el id del sitio es `<proyecto>-catalogo` salvo `--sitio-catalogo <id>`):

```bash
./scripts/preparar-staging.sh sitio  --proyecto "$P_STG"            # en seco: imprime
./scripts/preparar-staging.sh sitio  --proyecto "$P_STG" --aplicar  # crea el sitio (idempotente)
./scripts/preparar-staging.sh github --proyecto "$P_STG" --aplicar  # carga SITIO_PUBLICO y HOSTING_SITIO_CATALOGO
```

(La fase `github` carga además el resto de las variables y, **última**, el interruptor
`GCP_PROJECT_ID_STAGING`; si staging ya está encendido, usar los comandos de abajo,
que tocan solo lo del catálogo.) Equivalente a mano:

```bash
# a) El segundo sitio de staging (escribe en Firebase)
$FB hosting:sites:create "$SITIO_CAT_STG" --project "$P_STG" --non-interactive
$FB hosting:sites:list --project "$P_STG"

# b) Variables del Environment staging (escribe en GitHub; los valores no se imprimen)
gh variable set HOSTING_SITIO_CATALOGO --env staging --repo segurolotengopy/NovuChat --body "$SITIO_CAT_STG"
gh variable set SITIO_PUBLICO          --env staging --repo segurolotengopy/NovuChat --body "https://$SITIO_CAT_STG.web.app"

# c) Fusionar el PR a main -> el CI despliega staging -> humo-staging corre el punto 5
#    (scripts/humo-sitio-publico.sh contra el sitio nuevo). Verlo en la corrida.
```

**3.3 Producción.**

```bash
# d) El segundo sitio de producción (escribe en Firebase)
$FB hosting:sites:create "$SITIO_CAT" --project "$P_PROD" --non-interactive
$FB hosting:sites:list --project "$P_PROD"

# e) Variables del repositorio (escribe en GitHub)
gh variable set HOSTING_SITIO_CATALOGO --repo segurolotengopy/NovuChat --body "$SITIO_CAT"
gh variable set SITIO_PUBLICO          --repo segurolotengopy/NovuChat --body "https://$SITIO_CAT.web.app"
gh variable list --env production    # que ninguna de las dos exista también ahí: el Environment ganaría

# f) Etiqueta y aprobación del Environment `production`: las hace Andres (domingo 12:00).
#    El CI: construir (verifica el paquete público) -> desplegar-produccion (resuelve los
#    dos destinos, publica Functions con el SITIO_PUBLICO nuevo y los dos sitios).
```

**3.4 Verificación posterior a producción** (solo lectura; un script del repositorio,
no `curl` suelto: a `*.web.app` el `curl` directo de Bash está denegado, el script sí corre):

```bash
SITIO_PUBLICO_URL="https://$SITIO_CAT.web.app" CONSOLA_URL="$(gh variable get PROD_URL)" \
  ./scripts/humo-sitio-publico.sh
# Con un enlace REAL del ensayo (la ficha que llega por WhatsApp; no se imprime):
SITIO_PUBLICO_URL="https://$SITIO_CAT.web.app" FICHA_DE_PRUEBA="<32 hexadecimales del enlace>" \
  ./scripts/humo-sitio-publico.sh
./scripts/nube-catalogo.sh        # diagnóstico: las Functions del catálogo siguen invocables
```

El mismo script corre solo en el job `desplegar-produccion` (paso «Humo del sitio
público del catálogo», solo lectura, hace fallar el job) cuando el despliegue incluye
hosting. **Si ese paso falla, el job queda en rojo pero NO dispara el rollback de la
consola**: el rollback automático responde solo al health check de la consola (la
consola está bien y revertirla no arregla el sitio público). Un fallo ahí se atiende
a mano (Hosting → sitio `catalogo` → Historial → Revertir, o `catalogoWebActivo = false`). Esperado: 200 en `/c/<ficha>` con la CSP del catálogo (sin marcos, Google ni Firebase),
404 en `/` y `/index.html`, 405 en `/api/catalogo/<x>/checkout`, 404 en `/api/ingesta/`,
el JavaScript sin el SDK de Firebase, y con ficha real el JSON con ítems. Además, el
ensayo con teléfono: **el enlace que llega por WhatsApp empieza por la dirección del
sitio público**, no por la de la consola, y abre la página.

**3.5 Dominio propio (H2, opcional y posterior).** `firebase-tools` no tiene comando
para dominios personalizados: se agrega en la consola de Firebase (Hosting → sitio
`catalogo` → Agregar dominio personalizado) y los registros DNS los crea quien tenga
el dominio. Cuando el dominio esté activo: cargar `HOSTING_DOMINIO_CATALOGO` con el
host (sin ella la compuerta de despliegue rechaza cualquier dominio que no sea
`.web.app` o `.firebaseapp.com` del sitio), después `gh variable set SITIO_PUBLICO …`
con la dirección nueva y **redesplegar las Functions** (el parámetro se lee al desplegar).
Los enlaces ya repartidos siguen valiendo hasta que venzan (72 horas).

## 4. Riesgos y reversa

| Riesgo | Mitigación |
|---|---|
| El primer push a `main` con este cambio falla `desplegar-staging` si falta el sitio o las variables de staging | Crear sitio y variables (3.2 a y b) **antes** de fusionar |
| Producción se niega a desplegar mientras `SITIO_PUBLICO` sea el origen de la consola | Es el control: cargar 3.3 e antes de la etiqueta |
| Los enlaces del catálogo de **demos** ya repartidos con la dirección de la consola dejan de funcionar al desplegar | Vencen solos a las 72 horas; ningún comercio real los tiene (T-37) |
| La vista previa del catálogo en la consola ya no va en un marco (otro origen): se abre en otra pestaña | Cambio deliberado de `Catalogo.tsx`; la alternativa, nombrar la dirección de cada sitio en las dos CSP, mete direcciones por ambiente en el repositorio |
| Sin copia «previa» para el sitio público en el primer despliegue (el rollback automático clona solo la consola) | Reversa: consola de Firebase → Hosting → sitio `catalogo` → Historial → Revertir; y, si la página no sirve, `catalogoWebActivo = false` en el comercio: el asistente vuelve a la carta en texto |
| **Redesplegar una etiqueta anterior a T-37 desde Actions falla** si se lanza sobre `main` (el workflow nuevo espera `web/dist-catalogo`, que esa etiqueta no produce, y su `firebase.json` tiene un solo sitio) | Para volver a una etiqueta anterior: `gh workflow run <workflow> --ref <etiqueta> -f destino=produccion -f confirmar=DESPLEGAR` (ver los inputs del workflow): corre el workflow y el `firebase.json` de esa etiqueta, de un solo sitio. **Y devolver `SITIO_PUBLICO` a la dirección de la consola**: la etiqueta vieja no tiene un sitio público y publica `/c/**` en la consola; los enlaces nuevos tienen que apuntar ahí mientras tanto |
| `firebase deploy --only hosting` publica los dos sitios en la misma corrida | El orden interno es storage → firestore → functions → hosting: las Functions ya están cuando el sitio nuevo empieza a reescribir hacia ellas |

**Reversa completa** (si hubiera que deshacer T-37): `git revert` del commit de este
cambio, nueva etiqueta, y devolver `SITIO_PUBLICO` a la dirección de la consola. El
sitio `catalogo` puede quedar vacío; no cuesta nada.

## 5. Lo que este procedimiento no cubre

- **ZAP (DAST) sobre el sitio público.** `dast-y-humo` sigue apuntando solo a la
  consola de staging. Conviene un segundo objetivo (la página pública recibe
  desconocidos); pendiente de decisión de Andres, porque cambia el workflow reutilizable.
- **Probar la página en un navegador real con la CSP puesta.** Se probó el paquete
  servido con las cabeceras reales de `firebase.json` (`node
  admin/scripts/datos/catalogo-demo.mjs`, que lee el destino `catalogo` y sirve
  `web/dist-catalogo`; `admin/scripts/probar-csp.mjs` sirve la consola), no con
  Chrome: la verificación visual queda para el ensayo con teléfono.
