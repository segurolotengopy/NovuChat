# shellcheck shell=bash
# Funciones comunes de los envoltorios `fijar-carrito-comercio.sh` y `fijar-numero-publico-comercio.sh` (se hace `source`, no se ejecuta).
#
# La regla (Andres, 26/11/2026): los VALORES REALES —el id del proyecto, la ruta secreta del carrito, el host de n8n, el número público
# de la línea— se leen DENTRO del proceso, jamás se imprimen, jamás van en la línea de comandos (ps, historial) y nadie los pega.
# Cada valor se guarda en una variable de shell y llega al script de nodo por una variable de entorno de ESE proceso solamente.
#
#   - el PROYECTO sale del `quota_project_id` de las credenciales de gcloud de cada entorno (producción: ~/.config/gcloud-novuchat-prod,
#     staging: ~/.config/gcloud; se pueden cambiar con NOVUCHAT_GCLOUD_PROD y NOVUCHAT_GCLOUD_STAGING). Se calculan los DOS y deben ser
#     distintos, como en `catalogo-externo.sh`;
#   - los marcadores de la TABLA LOCAL (`CONFIGURACION.local.md`, o la de CONFIG_LOCAL_MD) se leen con el MISMO formato de fila que usan
#     `preparar-import.sh` y `resetear-telefono.sh`: | `REEMPLAZAR_X` | valor |; una fila «pendiente» o vacía no vale;
#   - el HOST de n8n sale de `N8N_BASE_URL` del `.env` del comercio (ENV_N8N, o ~/NovuChat/.env.<comercio>-prod): se extrae SOLO esa variable.

# Raíz donde viven la tabla local y los `.env` (la carpeta principal del proyecto, no un worktree).
RAIZ_LOCAL="${NOVUCHAT_RAIZ_LOCAL:-$HOME/NovuChat}"

# id_de_proyecto <carpeta de gcloud> → quota_project_id por stdout (la llamada lo captura; nunca va a la pantalla).
id_de_proyecto() {
  python3 -I -c '
import sys, json, re
try:
    d = json.load(open(sys.argv[1] + "/application_default_credentials.json"))
    q = d.get("quota_project_id")
    assert isinstance(q, str) and re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", q)
    print(q)
except Exception:
    sys.exit(1)
' "$1" 2>/dev/null
}

# resolver_proyecto <staging|produccion>: deja FIJAR_PROYECTO, ID_PROD, ID_STG y GOOGLE_APPLICATION_CREDENTIALS (exportadas solo a los hijos).
resolver_proyecto() {
  local entorno="$1" config_prod="${NOVUCHAT_GCLOUD_PROD:-$HOME/.config/gcloud-novuchat-prod}" config_stg="${NOVUCHAT_GCLOUD_STAGING:-$HOME/.config/gcloud}"
  local v
  for v in "${!CLOUDSDK_@}"; do unset "$v"; done
  export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true
  unset FIRESTORE_EMULATOR_HOST GOOGLE_CLOUD_PROJECT GCLOUD_PROJECT
  ID_PROD="$(id_de_proyecto "$config_prod")" || { echo "✗ no se pudo leer el proyecto de las credenciales de producción" >&2; return 3; }
  ID_STG="$(id_de_proyecto "$config_stg")" || { echo "✗ no se pudo leer el proyecto de las credenciales de staging" >&2; return 3; }
  [[ "$ID_PROD" != "$ID_STG" ]] || { echo "✗ las credenciales de producción y de staging apuntan al mismo proyecto: no se sabe cuál es cuál" >&2; return 2; }
  if [[ "$entorno" == produccion ]]; then
    FIJAR_PROYECTO="$ID_PROD"; export GOOGLE_APPLICATION_CREDENTIALS="$config_prod/application_default_credentials.json"
  else
    FIJAR_PROYECTO="$ID_STG"; export GOOGLE_APPLICATION_CREDENTIALS="$config_stg/application_default_credentials.json"
  fi
  export FIJAR_PROYECTO
}

# valor_de_tabla <CLAVE> → el valor de esa fila de la tabla local por stdout (vacío y código 1 si no está o está «pendiente»).
valor_de_tabla() {
  local tabla="${CONFIG_LOCAL_MD:-$RAIZ_LOCAL/CONFIGURACION.local.md}"
  [[ -f "$tabla" ]] || return 1
  TABLA="$tabla" CLAVE="$1" python3 -I -c '
import os, re, sys
fila = re.compile(r"^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|")
for linea in open(os.environ["TABLA"], encoding="utf-8"):
    m = fila.match(linea)
    if m and m.group(1) == os.environ["CLAVE"] and "pendiente" not in linea.lower():
        v = m.group(2).strip().strip("`").strip()
        if v:
            print(v); sys.exit(0)
sys.exit(1)
'
}

# valor_del_env <NOMBRE> <archivo> → el valor de UNA variable del .env (no se carga el archivo entero).
valor_del_env() {
  [[ -f "$2" ]] || return 1
  grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# Pasa por un filtro la salida de un script de nodo: cada valor real que hubiera quedado escrito sale como «<valor>». Los valores llegan
# por variables de entorno SOLO de ese proceso (nunca como argumentos).
filtrar_valores() {
  VALORES_A_OCULTAR="$(printf '%s\n' "$@")" python3 -I -c '
import sys, os, re
t = sys.stdin.read()
for v in os.environ.get("VALORES_A_OCULTAR", "").split("\n"):
    if len(v) >= 4:
        t = re.sub(re.escape(v), "<valor>", t, flags=re.I)
# Una ruta de Firestore con el phone_number_id (errores del SDK) tampoco se escribe.
t = re.sub(r"rutasWhatsApp/[0-9]{6,25}", "rutasWhatsApp/<id>", t)
sys.stdout.write(t)
'
}
