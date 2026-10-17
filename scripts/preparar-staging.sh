#!/usr/bin/env bash
# =============================================================================
# preparar-staging.sh — las escrituras en la nube y en GitHub del proyecto de
#                       STAGING, en orden, EN SECO por defecto
# =============================================================================
# Existe porque Andres autoriza y no opera (CLAUDE.md): cada paso que escribe
# en Google Cloud o en GitHub lo corre Claude con el «sí» de Andres, y este
# script es la forma revisable de esos pasos. Ningún valor real vive acá: el
# proyecto se pasa por --proyecto, los identificadores numéricos se consultan
# en el momento, y los valores de los secretos se generan y viajan por una
# tubería sin imprimirse jamás. Diseño y porqués: docs/staging/DISENO.md.
#
#   ./scripts/preparar-staging.sh <fase> --proyecto <id-staging> [--aplicar]
#       [--sitio-catalogo <id>]   id del segundo sitio de Hosting; por omisión
#                                 <proyecto>-catalogo (único en todo Firebase)
#
#   Fases, en el orden en que hay que correrlas (docs/staging/DISENO.md §8):
#     apis        habilita las APIs que el despliegue usa
#     firestore   crea la base (default) en us-east1, la región de las Functions
#     app         registra la app web de la consola y carga sus VITE_* en el
#                 Environment `staging` de GitHub (valores públicos por diseño)
#     wif         pool y proveedor de identidad federada PROPIOS de staging
#     cuentas     sa-deploy-staging y sa-functions con los mismos roles acotados
#                 que producción; el binding del Environment `staging`
#     secretos    los secretos que las Functions declaran (26): aleatorios, salvo
#                 SALIDA_PERSONA_RUTAS, que nace con `{}`; y su secretAccessor
#                 para sa-functions
#     salida-persona  SOLO sobre un staging que ya existe: amplía la condición de
#                 desplegadorSecretos con SALIDA_PERSONA_, crea SALIDA_PERSONA_RUTAS
#                 (`{}`) y su secretAccessor. Se corre UNA vez (idempotente)
#     sitio       el SEGUNDO sitio de Hosting de staging (T-37: la página pública del
#                 catálogo, otro origen que la consola). Va ANTES de `github`
#     storage     el rol del agente de Storage (DESPUÉS de crear el bucket a mano)
#     invocadores roles/run.invoker para allUsers en cada Function HTTP o
#                 callable desplegada (DESPUÉS del primer despliegue; idempotente)
#     github      secretos y variables de GitHub; la última es
#                 GCP_PROJECT_ID_STAGING, que es el interruptor de los jobs
#     verificar   solo lectura: lo que quedó, y el Policy Troubleshooter de los
#                 permisos que más veces fallaron en producción
#
#   Sin --aplicar imprime cada comando y no ejecuta nada. Con --aplicar ejecuta
#   uno por uno y se detiene en el primero que falle. Todas las fases son
#   idempotentes: lo que ya existe se salta con aviso.
#
# Credenciales: gcloud con la configuración aislada del proyecto
# (CLOUDSDK_CONFIG, por defecto ~/.config/gcloud-novuchat-prod: la misma cuenta
# de Google es dueña de producción y de staging); gh con GH_CONFIG_DIR.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

FASE="${1:-}"; shift || true
if [[ "$FASE" == "-h" || "$FASE" == "--help" || -z "$FASE" ]]; then
  sed -n '2,47p' "$0" | sed 's/^# \{0,1\}//'; exit 0
fi
P=""; APLICAR=0; SIN_STORAGE=0; SITIO_CAT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --proyecto)    P="${2:?--proyecto necesita el ID}"; shift 2 ;;
    --proyecto=*)  P="${1#*=}"; shift ;;
    --aplicar)     APLICAR=1; shift ;;
    --sin-storage) SIN_STORAGE=1; shift ;;
    --sitio-catalogo)   SITIO_CAT="${2:?--sitio-catalogo necesita el id}"; shift 2 ;;
    --sitio-catalogo=*) SITIO_CAT="${1#*=}"; shift ;;
    -h|--help)     sed -n '2,47p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
case "$FASE" in
  apis|firestore|app|wif|cuentas|secretos|salida-persona|sitio|storage|invocadores|github|verificar) ;;
  *) echo "Uso: $0 <apis|firestore|app|wif|cuentas|secretos|salida-persona|sitio|storage|invocadores|github|verificar> --proyecto <id> [--aplicar] [--sitio-catalogo <id>]" >&2; exit 2 ;;
esac
[[ "$P" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "✗ --proyecto: ID de proyecto de Google Cloud inválido" >&2; exit 2; }
# T-37: la página pública del catálogo vive en un segundo sitio de Hosting. Su id
# es único en todo Firebase; por omisión, el del proyecto más «-catalogo».
SITIO_CAT="${SITIO_CAT:-${P}-catalogo}"
[[ "$SITIO_CAT" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ && "$SITIO_CAT" != "$P" ]] \
  || { echo "✗ --sitio-catalogo: id de sitio de Hosting inválido, o igual al sitio de la consola (el del proyecto)" >&2; exit 2; }

export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
unset CLOUDSDK_ACTIVE_CONFIG_NAME
REPO="segurolotengopy/NovuChat"
REGION="us-east1"
SA_DEPLOY="sa-deploy-staging@${P}.iam.gserviceaccount.com"
SA_FUNCTIONS="sa-functions@${P}.iam.gserviceaccount.com"
URL_STAGING="https://${P}.web.app"
URL_CATALOGO="https://${SITIO_CAT}.web.app"   # SITIO_PUBLICO de staging: NUNCA la de la consola (T-37)

V=$'\e[32m'; A=$'\e[33m'; X=$'\e[31m'; F=$'\e[0m'
titulo() { printf '\n%s== %s ==%s\n' "$A" "$*" "$F"; }
nota()   { echo "  ${A}·${F} $*"; }
hecho()  { echo "  ${V}✓${F} $*"; }
falla()  { echo "  ${X}✗${F} $*" >&2; }

# correr <descripción> -- <comando...>: en seco imprime; con --aplicar ejecuta.
correr() {
  local que="$1"; shift; [[ "${1:-}" == "--" ]] && shift
  if (( APLICAR )); then
    echo "  → $que"; "$@"; hecho "$que"
  else
    # En seco se muestra el comando real: `gc` es la función de abajo. Lo que
    # sigue a --body (secretos y variables de GitHub) se imprime como <valor>:
    # la pantalla y el historial no son lugar para identificadores ni secretos.
    local primero="$1" ocultar=0; shift
    [[ "$primero" == gc ]] && primero="gcloud --project $P --quiet"
    printf '  [seco] %s\n         $ %s' "$que" "$primero"
    for a in "$@"; do
      if (( ocultar )); then printf ' %s' '<valor>'; ocultar=0
      else printf ' %q' "$a"; [[ "$a" == "--body" ]] && ocultar=1; fi
    done; printf '\n'
  fi
}
# gcloud con el proyecto fijo, siempre.
gc() { gcloud --project "$P" --quiet "$@"; }
existe() { "$@" >/dev/null 2>&1; }

numero_proyecto() { gc projects describe "$P" --format='value(projectNumber)'; }
ids_de_github() { # imprime: id_repo id_dueño prefijo_sub
  local id_repo id_duenio prefijo
  id_repo="$(gh api "repos/$REPO" --jq .id)"
  id_duenio="$(gh api "repos/$REPO" --jq .owner.id)"
  prefijo="$(gh api "repos/$REPO/actions/oidc/customization/sub" --jq .sub_claim_prefix)"
  [[ -n "$id_repo" && -n "$id_duenio" && -n "$prefijo" ]] || { falla "no se pudieron leer los identificadores del repositorio con gh"; exit 1; }
  echo "$id_repo $id_duenio $prefijo"
}

# --- Fases -------------------------------------------------------------------
fase_apis() {
  titulo "APIs de $P"
  local apis=(iamcredentials sts iam firebase firebasehosting firebaserules firestore
              firebasestorage storage cloudfunctions run cloudbuild artifactregistry
              eventarc secretmanager cloudscheduler pubsub identitytoolkit serviceusage
              cloudresourcemanager policytroubleshooter)
  # policytroubleshooter: sin ella, `verificar` devuelve «?» en cada permiso
  # (el error se tragaba; medido el 26/09).
  local lista=(); for a in "${apis[@]}"; do lista+=("$a.googleapis.com"); done
  correr "habilitar ${#lista[@]} APIs" -- gc services enable "${lista[@]}"
}

fase_firestore() {
  titulo "Firestore (default) en $REGION"
  if existe gc firestore databases describe --database='(default)'; then
    nota "la base (default) ya existe"; return
  fi
  # La región es la de las Functions (admin/functions/src/core/region.ts): un
  # disparador de Firestore en otra región no se despliega.
  correr "crear la base (default) en $REGION" -- gc firestore databases create \
    --database='(default)' --location="$REGION" --type=firestore-native
}

fase_app() {
  titulo "App web de la consola y sus VITE_* (Environment staging)"
  local fb=(firebase); command -v firebase >/dev/null || fb=(npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION:-15.28.1}")
  local app_id
  app_id="$("${fb[@]}" apps:list WEB --project "$P" --json 2>/dev/null \
    | jq -r '(.result // [])[] | select(.displayName == "Consola (staging)") | .appId' | head -1 || true)"
  if [[ -n "$app_id" ]]; then nota "la app «Consola (staging)» ya existe"
  else
    correr "registrar la app web «Consola (staging)»" -- "${fb[@]}" apps:create WEB "Consola (staging)" --project "$P" --non-interactive
    (( APLICAR )) || { nota "en seco no hay app: las VITE_* se cargan al aplicar"; return; }
    app_id="$("${fb[@]}" apps:list WEB --project "$P" --json | jq -r '(.result // [])[] | select(.displayName == "Consola (staging)") | .appId' | head -1)"
  fi
  [[ -n "$app_id" ]] || { falla "no se encontró el appId de la app web"; exit 1; }
  # La configuración del SDK es pública por diseño (viaja en el bundle), pero
  # no se imprime: va directo de la CLI de Firebase a las variables de GitHub.
  local cfg
  cfg="$("${fb[@]}" apps:sdkconfig WEB "$app_id" --project "$P" --json | jq -c '.result.sdkConfig')"
  [[ "$cfg" != "null" && -n "$cfg" ]] || { falla "apps:sdkconfig no devolvió .result.sdkConfig (¿cambió la forma del JSON?)"; exit 1; }
  local nombre clave
  for par in VITE_FIREBASE_API_KEY:apiKey VITE_FIREBASE_AUTH_DOMAIN:authDomain \
             VITE_FIREBASE_PROJECT_ID:projectId VITE_FIREBASE_APP_ID:appId \
             VITE_FIREBASE_STORAGE_BUCKET:storageBucket; do
    nombre="${par%%:*}"; clave="${par##*:}"
    local valor; valor="$(jq -r --arg k "$clave" '.[$k] // empty' <<< "$cfg")"
    [[ -n "$valor" ]] || { falla "sdkConfig sin $clave"; exit 1; }
    if (( APLICAR )); then
      gh variable set "$nombre" --env staging --repo "$REPO" --body "$valor" >/dev/null
      hecho "$nombre cargada en el Environment staging"
    else
      nota "[seco] gh variable set $nombre --env staging (valor de sdkConfig.$clave)"
    fi
  done
  # La clave de App Check de producción está atada a su dominio y NO sirve
  # acá. No se carga como variable (GitHub rechaza una variable vacía con 422,
  # medido el 26/09): el job construir-staging la fija vacía en el workflow.
  # El NÚMERO del proyecto: construir-staging verifica con él que el appId
  # (1:<número>:web:…) sea de una app de staging, sin conocer el de producción.
  correr "GCP_PROJECT_NUMBER_STAGING (Environment staging)" -- gh variable set GCP_PROJECT_NUMBER_STAGING --env staging --repo "$REPO" --body "$(numero_proyecto)"
}

fase_wif() {
  titulo "Identidad federada PROPIA de $P (pool github, proveedor novuchat)"
  local num id_repo id_duenio prefijo
  num="$(numero_proyecto)"
  read -r id_repo id_duenio prefijo <<< "$(ids_de_github)"
  if existe gc iam workload-identity-pools describe github --location=global; then nota "el pool github ya existe"
  # El nombre visible de un proveedor admite hasta 32 caracteres (medido el
  # 26/09: «<dueño>/<repo> (staging)» pasaba de largo y el alta fallaba).
  else correr "crear el pool github" -- gc iam workload-identity-pools create github --location=global --display-name="GitHub Actions"; fi
  # La condición compara IDENTIFICADORES, no nombres (DESPLIEGUE-FIREBASE.md,
  # «Estado real»): resiste un cambio de nombre y cierra la puerta a los forks.
  # Y solo el sujeto del Environment `staging`: ningún otro job canjea acá.
  local condicion="assertion.repository_id == '${id_repo}' && assertion.repository_owner_id == '${id_duenio}' && assertion.sub == '${prefijo}:environment:staging'"
  if existe gc iam workload-identity-pools providers describe novuchat --location=global --workload-identity-pool=github; then
    correr "actualizar la condición del proveedor novuchat" -- gc iam workload-identity-pools providers update-oidc novuchat \
      --location=global --workload-identity-pool=github --attribute-condition="$condicion"
  else
    correr "crear el proveedor novuchat" -- gc iam workload-identity-pools providers create-oidc novuchat \
      --location=global --workload-identity-pool=github --display-name="NovuChat staging" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --allowed-audiences="https://iam.googleapis.com/projects/${num}/locations/global/workloadIdentityPools/github/providers/novuchat" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id" \
      --attribute-condition="$condicion"
  fi
}

# --- Secretos: el binding con condición y la creación de un secreto ---------------
SECRETO_SALIDA_PERSONA="SALIDA_PERSONA_RUTAS"
PREFIJO_SALIDA_PERSONA="SALIDA_PERSONA_"

# 0 si sa-deploy-staging ya tiene el binding de desplegadorSecretos con la
# condición «secretos-de-las-functions». Solo lectura.
binding_de_secretos_existe() {
  gc projects get-iam-policy "$P" --format=json 2>/dev/null | python3 -I -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
m = "serviceAccount:" + sys.argv[1]
sys.exit(0 if any(b.get("role", "").endswith("/desplegadorSecretos") and m in b.get("members", [])
                  and (b.get("condition") or {}).get("title") == "secretos-de-las-functions"
                  for b in d.get("bindings", [])) else 1)' "$SA_DEPLOY"
}

# Edita EN SU LUGAR la condición del binding (política leída con su etag): agrega
# `|| resource.name.startsWith("projects/<número>/secrets/<prefijo>")`.
# Salidas: 0 ya cubierto · 10 cambió (el archivo queda listo para set-iam-policy)
#          · 3 no encontré el binding, o tiene más de un miembro (no se toca nada).
# Nunca imprime la expresión entera ni el número del proyecto.
ampliar_condicion_secretos() { # <archivo-política> <número> <prefijo>
  python3 -I - "$1" "$2" "$SA_DEPLOY" "$3" <<'PY'
import json, sys
ruta, n, sa, prefijo = sys.argv[1:5]
d = json.load(open(ruta)); miembro = f'serviceAccount:{sa}'
clausula = f'resource.name.startsWith("projects/{n}/secrets/{prefijo}")'
for b in d.get('bindings', []):
    c = b.get('condition') or {}
    if b.get('role', '').endswith('/desplegadorSecretos') and miembro in b['members'] and c.get('title') == 'secretos-de-las-functions':
        if len(b['members']) != 1:
            print('  \x1b[31m✗\x1b[0m el binding con condición tiene más de un miembro: no toco nada'); sys.exit(3)
        if f'secrets/{prefijo}"' in c['expression']:
            print(f'  \x1b[32m✓\x1b[0m la condición ya cubre {prefijo}'); sys.exit(0)
        c['expression'] = c['expression'] + ' || ' + clausula
        d['version'] = 3  # obligatorio con permisos condicionados
        json.dump(d, open(ruta, 'w'))
        print(f'  \x1b[33m·\x1b[0m la condición no cubre {prefijo}: se agrega una cláusula por prefijo')
        sys.exit(10)
print('  \x1b[31m✗\x1b[0m no encuentro el binding con condición de sa-deploy-staging (¿falta la fase cuentas?): no toco nada'); sys.exit(3)
PY
}

# El valor inicial de un secreto, por una tubería (nunca a la pantalla). El mapa de
# timbres nace VACÍO: `{}` es un JSON válido, ningún alias = ningún timbre
# (destinoDeTimbre devuelve null y no se toca nada). Los demás, 64 hex aleatorios.
valor_inicial() {
  if [[ "$1" == "$SECRETO_SALIDA_PERSONA" ]]; then printf '{}'
  else openssl rand -hex 32 | tr -d '\n'; fi
}

asegurar_secreto() { # <nombre>: lo crea si falta y da secretAccessor a sa-functions
  local s="$1"
  if existe gc secrets describe "$s"; then nota "$s ya existe"
  elif (( APLICAR )); then
    valor_inicial "$s" | gc secrets create "$s" --replication-policy=automatic --data-file=- >/dev/null
    if [[ "$s" == "$SECRETO_SALIDA_PERSONA" ]]; then hecho "$s creado (mapa vacío {}: ningún timbre)"
    else hecho "$s creado (valor aleatorio, no mostrado)"; fi
  elif [[ "$s" == "$SECRETO_SALIDA_PERSONA" ]]; then
    nota "[seco] printf '{}' | gcloud secrets create $s --data-file=-"
  else
    nota "[seco] openssl rand -hex 32 | gcloud secrets create $s --data-file=-"
  fi
  correr "$s: secretAccessor para sa-functions" -- gc secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA_FUNCTIONS" --role=roles/secretmanager.secretAccessor
}

fase_cuentas() {
  titulo "Cuentas de servicio y roles (los mismos acotados que producción)"
  local num prefijo r
  num="$(numero_proyecto)"
  read -r _ _ prefijo <<< "$(ids_de_github)"
  for cuenta in sa-deploy-staging:"Despliegue de la consola (CI, staging)" sa-functions:"Cuenta de las Cloud Functions"; do
    if existe gc iam service-accounts describe "${cuenta%%:*}@${P}.iam.gserviceaccount.com"; then nota "${cuenta%%:*} ya existe"
    else correr "crear ${cuenta%%:*}" -- gc iam service-accounts create "${cuenta%%:*}" --display-name="${cuenta#*:}"; fi
  done
  # sa-deploy-staging: hosting, reglas, índices, Storage (solo ver el bucket),
  # Functions gen2 (Run + Build + Artifact Registry + Eventarc) y Scheduler
  # (sondeoCobros y barridoCobros son onSchedule). NUNCA roles/firebase.viewer:
  # trae 290 permisos, entre ellos leer Firestore, Auth y Storage, y la cuenta
  # de despliegue no lee datos, ni acá ni en producción. La configuración
  # pública del SDK la sirve Hosting en /__/firebase/init.json, sin credenciales.
  for r in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin \
           roles/serviceusage.serviceUsageConsumer roles/firebasestorage.viewer \
           roles/cloudfunctions.developer roles/run.admin roles/artifactregistry.writer \
           roles/cloudbuild.builds.editor roles/eventarc.admin roles/cloudscheduler.admin; do
    correr "sa-deploy-staging: $r" -- gc projects add-iam-policy-binding "$P" --member="serviceAccount:$SA_DEPLOY" --role="$r" --condition=None
  done
  # Actuar como: sa-functions (con la que corren), App Engine (firebase deploy lo
  # exige aunque nadie corra con ella) y cómputo (construye las Functions).
  # Los dominios van en variables: el saneo del repositorio público solo
  # exceptúa los correos *.iam.gserviceaccount.com, y estas dos cuentas de
  # Google no llevan ese dominio.
  local dominio_appengine="appspot.gserviceaccount.com" dominio_computo="developer.gserviceaccount.com"
  local sa_computo="${num}-compute@${dominio_computo}"
  for cuenta in "$SA_FUNCTIONS" "${P}@${dominio_appengine}" "$sa_computo"; do
    correr "sa-deploy-staging actúa como ${cuenta%%@*}" -- gc iam service-accounts add-iam-policy-binding "$cuenta" \
      --member="serviceAccount:$SA_DEPLOY" --role=roles/iam.serviceAccountUser
  done
  # Secretos: rol a medida que NO lee valores ni cambia accesos, con condición
  # por prefijo (INGESTA_, GEMINI_API_KEY, COBRADOR_, SALIDA_PERSONA_).
  if existe gc iam roles describe desplegadorSecretos; then nota "el rol desplegadorSecretos ya existe"
  else correr "crear el rol desplegadorSecretos" -- gc iam roles create desplegadorSecretos --title="Desplegador de secretos" \
      --permissions=secretmanager.secrets.get,secretmanager.versions.get,secretmanager.versions.list,secretmanager.secrets.getIamPolicy --stage=GA; fi
  # IDEMPOTENCIA: `add-iam-policy-binding` con OTRA expresión no reemplaza el binding
  # de condición que ya existe: agregaría uno paralelo. Por eso, si el binding ya
  # está, esta fase no lo toca; ampliarlo es trabajo de la fase `salida-persona`,
  # que lo edita en su lugar con `set-iam-policy` (con etag).
  if binding_de_secretos_existe; then
    nota "el binding con condición «secretos-de-las-functions» ya existe: no se toca (para ampliarlo, fase salida-persona)"
  else
    local cond="expression=resource.name.startsWith(\"projects/${num}/secrets/INGESTA_\") || resource.name.startsWith(\"projects/${num}/secrets/GEMINI_API_KEY\") || resource.name.startsWith(\"projects/${num}/secrets/COBRADOR_\") || resource.name.startsWith(\"projects/${num}/secrets/SALIDA_PERSONA_\"),title=secretos-de-las-functions"
    correr "sa-deploy-staging: desplegadorSecretos con condición" -- gc projects add-iam-policy-binding "$P" \
      --member="serviceAccount:$SA_DEPLOY" --role="projects/${P}/roles/desplegadorSecretos" --condition="$cond"
  fi
  # sa-functions: lo que las Functions usan y nada más (fase A de producción).
  for r in roles/datastore.user roles/firebaseauth.admin roles/eventarc.eventReceiver roles/run.invoker roles/logging.logWriter; do
    correr "sa-functions: $r" -- gc projects add-iam-policy-binding "$P" --member="serviceAccount:$SA_FUNCTIONS" --role="$r" --condition=None
  done
  # Cómputo: solo construye (fase C de producción). Un proyecto nuevo le da
  # Editor por defecto; se lo quita y le deja lo de Cloud Build.
  correr "cómputo: roles/cloudbuild.builds.builder" -- gc projects add-iam-policy-binding "$P" \
    --member="serviceAccount:${sa_computo}" --role=roles/cloudbuild.builds.builder --condition=None
  correr "cómputo: quitar roles/editor" -- gc projects remove-iam-policy-binding "$P" \
    --member="serviceAccount:${sa_computo}" --role=roles/editor --condition=None
  # El binding de la federación: SOLO el sujeto del Environment `staging`.
  correr "federación → sa-deploy-staging (sujeto environment:staging)" -- gc iam service-accounts add-iam-policy-binding "$SA_DEPLOY" \
    --role=roles/iam.workloadIdentityUser \
    --member="principal://iam.googleapis.com/projects/${num}/locations/global/workloadIdentityPools/github/subject/${prefijo}:environment:staging"
}

secretos_declarados() { # de firma.ts, cobroPrepago.ts y captacion/verificarComportamiento: lo que el código exige
  # En todas las subcarpetas (F2 mueve los archivos a core/, central/ y
  # modulos/<m>/): con `admin/functions/src/*.ts` un secreto de un archivo
  # movido dejaba de crearse en staging.
  grep -rhoE --include='*.ts' "define(Secret)\('[A-Z_0-9]+'" admin/functions/src | sed -E "s/.*'([A-Z_0-9]+)'/\1/" | sort -u
}

fase_secretos() {
  titulo "Secretos de las Functions (los que el código declara, con valores aleatorios)"
  local n=0
  while read -r s; do
    n=$((n + 1))
    asegurar_secreto "$s"
  done < <(secretos_declarados)
  nota "$n secretos declarados por el código"
  nota "GEMINI_API_KEY queda con un valor aleatorio: las Functions que llaman a Gemini fallarán en staging"
  nota "hasta que Andres cargue una clave propia de staging: gcloud secrets versions add GEMINI_API_KEY --data-file=- --project $P"
}

fase_salida_persona() {
  titulo "Salida de persona (H2-3): SALIDA_PERSONA_RUTAS en $P, sobre un staging ya creado"
  # Por qué existe (17/10/2026): el despliegue a staging falló desde #510 con 403 en
  # secretmanager.secrets.get de SALIDA_PERSONA_RUTAS. Dos causas: el secreto no
  # existía (la fase `secretos` se corrió cuando eran 25) y la condición por prefijo
  # de desplegadorSecretos no cubría SALIDA_PERSONA_. Esta fase arregla las dos sin
  # repetir las otras. Idempotente; seco por omisión.
  local num tmp respaldo rc
  num="$(numero_proyecto)"
  tmp="$(mktemp)"; respaldo="$(mktemp)"; chmod 600 "$tmp" "$respaldo"
  gc projects get-iam-policy "$P" --format=json > "$tmp"
  cp "$tmp" "$respaldo"
  if ampliar_condicion_secretos "$tmp" "$num" "$PREFIJO_SALIDA_PERSONA"; then rc=0; else rc=$?; fi
  case "$rc" in
    0) rm -f "$respaldo" ;;
    10)
      # set-iam-policy lleva el etag leído: si alguien cambió la política entretanto,
      # FALLA en vez de pisarla. El binding no se quita ni se vuelve a poner: se edita
      # su expresión en la misma escritura atómica, así que no hay instante sin permiso.
      nota "respaldo de la política ANTES del cambio (solo identidades y roles, sin secretos): $respaldo"
      correr "ampliar la condición de desplegadorSecretos con $PREFIJO_SALIDA_PERSONA" -- gc projects set-iam-policy "$P" "$tmp" ;;
    *) falla "no se pudo preparar el cambio de la condición (código $rc): no se escribió nada"; rm -f "$respaldo" "$tmp"; exit 1 ;;
  esac
  rm -f "$tmp"
  asegurar_secreto "$SECRETO_SALIDA_PERSONA"
  nota "con valor {} no hay ningún timbre: cargar un alias es otro paso (scripts/nube-salida-persona.sh --agregar-alias, en producción)"
  nota "después de esta fase, el despliegue a staging ya encuentra el secreto y puede leer sus metadatos"
}

fase_storage() {
  titulo "Agente de Storage: rol para que storage.rules pueda leer Firestore"
  local num; num="$(numero_proyecto)"
  # Existe recién después de crear el bucket en la consola (docs/seguridad/reglas-storage.md §3.1).
  correr "service-…@gcp-sa-firebasestorage: roles/firebaserules.firestoreServiceAgent" -- gc projects add-iam-policy-binding "$P" \
    --member="serviceAccount:service-${num}@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
    --role=roles/firebaserules.firestoreServiceAgent --condition=None
}

# LAS FUNCTIONS QUE TIENEN QUE SER INVOCABLES POR CUALQUIERA: las HTTP y las
# callables, es decir las desplegadas sin disparador de evento y sin la etiqueta
# de programada que pone Firebase. Da el mismo conjunto que el manifiesto
# (31 callables + 16 HTTP = 47 el 26/09/2026) y que producción. Cada una se
# autentica DENTRO de su código (firma, token o sesión); `allUsers` solo deja
# que la petición llegue. Sin él Google responde 403 antes del código.
invocables() {
  gc functions list --regions "$REGION" \
    --filter='-eventTrigger:* AND -labels.deployment-scheduled=true' \
    --format='value(name.basename())' | tr 'A-Z' 'a-z'
}

fase_sitio() {
  titulo "Segundo sitio de Hosting (T-37): $SITIO_CAT en $P"
  # La página pública del catálogo tiene su propio sitio, con otro origen que la
  # consola. El CLI de firebase de esta máquina tiene guardada OTRA cuenta que no
  # es dueña de los proyectos: se usa su configuración propia y las credenciales
  # aisladas de gcloud (nunca `firebase login` ni `logout`). Procedimiento
  # completo y porqués: docs/produccion/sitio-publico-catalogo.md.
  # Configuración PROPIA del CLI: un directorio temporal nuevo por corrida (nunca
  # una ruta fija y previsible en /tmp). En seco no se crea nada: se muestra el
  # nombre que tendría.
  local cfg="${FB_CFG:-}"
  if [[ -z "$cfg" ]]; then
    if (( APLICAR )); then cfg="$(mktemp -d)"; else cfg="<directorio temporal de la corrida>"; fi
  fi
  local fb=(env "XDG_CONFIG_HOME=$cfg" "GOOGLE_APPLICATION_CREDENTIALS=$CLOUDSDK_CONFIG/application_default_credentials.json" npx --yes firebase-tools@15.28.1)
  # En seco NO se consulta nada (el encabezado promete que no ejecuta): solo
  # con --aplicar se mira si el sitio ya existe, para ser idempotente.
  if (( APLICAR )); then mkdir -p "$cfg"; fi
  if (( APLICAR )) && "${fb[@]}" hosting:sites:get "$SITIO_CAT" --project "$P" >/dev/null 2>&1; then
    nota "el sitio $SITIO_CAT ya existe en $P: nada que crear"; return
  fi
  correr "crear el sitio $SITIO_CAT" -- "${fb[@]}" hosting:sites:create "$SITIO_CAT" --project "$P" --non-interactive
}

fase_invocadores() {
  titulo "Invocadores: allUsers en las Functions HTTP y callables de $P"
  # Por qué existe (26/09/2026): el primer despliegue a staging se hizo en lotes
  # por la cuota de CPU, y 29 de 47 servicios quedaron SIN invocador: el humo
  # dio 403 de Google en vez de los códigos de nuestro código. Una Function
  # HTTP nueva no nace invocable si su creación no salió limpia.
  local s total=0 faltan=0
  while IFS= read -r s; do
    [[ -n "$s" ]] || continue
    total=$((total + 1))
    if gc run services get-iam-policy "$s" --region "$REGION" --format=json 2>/dev/null | grep -q '"allUsers"'; then
      continue
    fi
    faltan=$((faltan + 1))
    correr "$s: roles/run.invoker para allUsers" -- gc run services add-iam-policy-binding "$s" \
      --region "$REGION" --member=allUsers --role=roles/run.invoker
  done < <(invocables)
  hecho "$total Functions HTTP o callables; $faltan sin invocador al empezar"
}

fase_github() {
  titulo "GitHub: secretos y variables del Environment staging y del repositorio"
  local num; num="$(numero_proyecto)"
  correr "secreto GCP_WIF_PROVIDER (Environment staging)" -- gh secret set GCP_WIF_PROVIDER --env staging --repo "$REPO" \
    --body "projects/${num}/locations/global/workloadIdentityPools/github/providers/novuchat"
  correr "secreto GCP_SA_DEPLOY_STAGING (Environment staging)" -- gh secret set GCP_SA_DEPLOY_STAGING --env staging --repo "$REPO" --body "$SA_DEPLOY"
  # T-37: SITIO_PUBLICO es la dirección del SEGUNDO sitio, no la de la consola
  # (el despliegue de staging rechaza el origen de la consola), y el despliegue
  # necesita el id de ese sitio para resolver el destino `catalogo`.
  correr "SITIO_PUBLICO (Environment staging): el sitio público del catálogo" -- gh variable set SITIO_PUBLICO --env staging --repo "$REPO" --body "$URL_CATALOGO"
  correr "HOSTING_SITIO_CATALOGO (Environment staging)" -- gh variable set HOSTING_SITIO_CATALOGO --env staging --repo "$REPO" --body "$SITIO_CAT"
  local solo="hosting,firestore:rules,firestore:indexes,functions,storage"
  (( SIN_STORAGE )) && solo="hosting,firestore:rules,firestore:indexes,functions"
  correr "FIREBASE_DEPLOY_ONLY (Environment staging)" -- gh variable set FIREBASE_DEPLOY_ONLY --env staging --repo "$REPO" --body "$solo"
  correr "STAGING_URL (repositorio)" -- gh variable set STAGING_URL --repo "$REPO" --body "$URL_STAGING"
  # ÚLTIMA: es el interruptor. Con ella cargada, el próximo push a main
  # construye, despliega y prueba staging.
  correr "GCP_PROJECT_ID_STAGING (repositorio) — el interruptor" -- gh variable set GCP_PROJECT_ID_STAGING --repo "$REPO" --body "$P"
}

fase_verificar() {
  titulo "Verificación (solo lectura)"
  echo "  APIs habilitadas: $(gc services list --enabled --format='value(config.name)' | wc -l)"
  gc iam service-accounts list --format='table(email,displayName)' | sed 's/^/  /'
  echo "  Secretos: $(gc secrets list --format='value(name)' | wc -l) (declarados por el código: $(secretos_declarados | wc -l))"
  echo "  Variables del Environment staging:"; gh variable list --env staging --repo "$REPO" --json name --jq '.[].name' | sed 's/^/    /'
  echo "  Secretos del Environment staging:"; gh secret list --env staging --repo "$REPO" --json name --jq '.[].name' | sed 's/^/    /'
  local s sin=0 total=0
  while IFS= read -r s; do
    [[ -n "$s" ]] || continue; total=$((total + 1))
    gc run services get-iam-policy "$s" --region "$REGION" --format=json 2>/dev/null | grep -q '"allUsers"' \
      || { falla "$s sin invocador allUsers (fase invocadores)"; sin=$((sin + 1)); }
  done < <(invocables)
  (( sin == 0 )) && hecho "las $total Functions HTTP o callables son invocables"
  # Los permisos que más veces hundieron un despliegue de producción, antes
  # de gastar una corrida (memoria «despliegues: verificar antes de aprobar»).
  local num; num="$(numero_proyecto)"
  for perm in firebasehosting.sites.update firebaserules.releases.update iam.serviceAccounts.actAs \
              secretmanager.versions.list cloudfunctions.functions.create run.services.update eventarc.triggers.create; do
    local recurso="//cloudresourcemanager.googleapis.com/projects/${P}"
    [[ "$perm" == iam.serviceAccounts.actAs ]] && recurso="//iam.googleapis.com/projects/${P}/serviceAccounts/${SA_FUNCTIONS}"
    [[ "$perm" == secretmanager.versions.list ]] && recurso="//secretmanager.googleapis.com/projects/${num}/secrets/INGESTA_DEMOA"
    local acceso
    acceso="$(gc policy-troubleshoot iam "$recurso" --principal-email="$SA_DEPLOY" --permission="$perm" --format='value(access)' 2>/dev/null || echo "?")"
    if [[ "$acceso" == "GRANTED" ]]; then hecho "sa-deploy-staging: $perm"; else falla "sa-deploy-staging: $perm → ${acceso:-desconocido}"; fi
  done
}

"fase_${FASE//-/_}"
