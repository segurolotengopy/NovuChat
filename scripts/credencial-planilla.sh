#!/usr/bin/env bash
# =============================================================================
# LA CREDENCIAL DE LA PLANILLA DE PROSPECTOS, SIN QUE NADIE VEA LA CLAVE
# =============================================================================
#
# POR QUE EXISTE. El flujo de captacion guarda cada prospecto (telefono,
# nombre, empresa, rubro) en una planilla de Google (decision de Andres del
# 27/09/2026, opcion B). n8n necesita una credencial de CUENTA DE SERVICIO
# (`googleApi`) para escribir ahi. Crearla a mano obliga a descargar una clave
# privada y pegarla en la interfaz: justo lo que CLAUDE.md prohibe que pase por
# una persona o por un archivo del repositorio (prohibicion 2).
#
# QUE HACE, en el proyecto de la consola (el `quota_project_id` de
# ~/.config/gcloud-novuchat-prod, memoria «proyecto GCP de la consola»):
#   0. (tambien en seco) lee N8N_BASE_URL y N8N_API_KEY del .env SIN ejecutarlo
#      como shell, comprueba que n8n responde y que no hay ya una credencial
#      con ese nombre (no se duplica: se rota);
#   1. activa la API de Google Sheets si no esta activa;
#   2. crea la cuenta de servicio `n8n-planillas` SIN NINGUN ROL: solo puede
#      tocar lo que una persona le comparta a mano (la planilla, como editor);
#   3. crea una clave en un directorio temporal en RAM (/dev/shm, 700), la
#      sube a n8n como «Google Sheets NovuChat (cuenta de servicio)» y borra el
#      archivo. SI LA CLAVE NO LLEGA A n8n, SE BORRA TAMBIEN DE IAM: no quedan
#      claves huerfanas (revision de seguridad del 27/09, M2). Si no se sabe si
#      llego (corte de red), no se borra y se avisa para comprobarlo.
# Imprime solo el correo de la cuenta de servicio (hay que compartirle la
# planilla), el prefijo del id de la clave y el id de la credencial en n8n.
# Nunca la clave ni la clave de la API de n8n (que no pasa por el shell).
#
# LA CLAVE NO VENCE (la politica del proyecto lo permite): rotarla cada 90
# dias como maximo. Rotar: borrar la credencial en n8n y la clave en IAM, y
# correr de nuevo. Baja: borrar la credencial y `gcloud iam service-accounts
# delete`. La planilla se comparte solo con esta cuenta y con personas del
# equipo, nunca «cualquiera con el enlace»: tiene datos personales.
#
#   ENV_FILE=~/NovuChat/.env.novuchat ./scripts/credencial-planilla.sh            # seco
#   ENV_FILE=~/NovuChat/.env.novuchat ./scripts/credencial-planilla.sh --aplicar  # con el «si» de Andres
#   HTTP_NODE=1 ...   si el flujo usa la credencial en un nodo HTTP Request (API de Sheets v4)
set -euo pipefail

# El .env se resuelve ANTES del cd: una ruta relativa se lee desde donde se
# llama (M1).
ENV_FILE=$(realpath -e -- "${ENV_FILE:-.env.novuchat}" 2>/dev/null) \
  || { echo "✗ Falta el .env (ENV_FILE)"; exit 1; }
cd "$(dirname "$0")/.." || exit 1

APLICAR=0
[[ "${1:-}" == "--aplicar" ]] && APLICAR=1
HTTP_NODE="${HTTP_NODE:-0}"

unset CLOUDSDK_ACTIVE_CONFIG_NAME
export CLOUDSDK_CONFIG="$HOME/.config/gcloud-novuchat-prod"
ADC="$CLOUDSDK_CONFIG/application_default_credentials.json"
PROYECTO=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["quota_project_id"])' "$ADC")
CUENTA="n8n-planillas"
CORREO="${CUENTA}@${PROYECTO}.iam.gserviceaccount.com"
NOMBRE_CRED="Google Sheets NovuChat (cuenta de servicio)"
export ENV_FILE NOMBRE_CRED HTTP_NODE

echo "Credencial de la planilla · proyecto ${PROYECTO:0:4}… · $([[ $APLICAR == 1 ]] && echo APLICAR || echo seco)"

# Lector del .env: solo las dos variables, sin ejecutar nada como shell.
LEER_ENV='
import os, re
def leer_env():
    env = {}
    for l in open(os.environ["ENV_FILE"]):
        m = re.match(r"\s*(?:export\s+)?(N8N_BASE_URL|N8N_API_KEY)\s*=\s*(.*)$", l.rstrip("\n"))
        if m:
            v = m.group(2).strip()
            env[m.group(1)] = v[1:-1] if len(v) > 1 and v[0] == v[-1] and v[0] in "\"\x27" else v
    return env
'

# 0. n8n responde y la credencial no existe (tambien en seco)
python3 - <<PY || exit 1
$LEER_ENV
import json, sys, urllib.request
env = leer_env()
if set(env) != {"N8N_BASE_URL", "N8N_API_KEY"}:
    print("  ✗ faltan N8N_BASE_URL o N8N_API_KEY en el .env"); sys.exit(1)
if not env["N8N_BASE_URL"].startswith("https://"):
    print("  ✗ N8N_BASE_URL no es https"); sys.exit(1)
req = urllib.request.Request(env["N8N_BASE_URL"].rstrip("/") + "/api/v1/credentials?limit=250",
                             headers={"X-N8N-API-KEY": env["N8N_API_KEY"]})
datos = json.load(urllib.request.urlopen(req, timeout=30)).get("data", [])
n = sum(c.get("name") == os.environ["NOMBRE_CRED"] for c in datos)
if n:
    print(f"  ✗ ya existe «{os.environ['NOMBRE_CRED']}» en n8n ({n}): rotar, no duplicar"); sys.exit(1)
print("  ✓ n8n responde y no hay credencial con ese nombre")
PY

# 1. API de Sheets
if gcloud services list --enabled --project "$PROYECTO" --format='value(config.name)' 2>/dev/null \
    | grep -qx 'sheets.googleapis.com'; then
  echo "  ✓ API de Google Sheets activa"
elif [[ $APLICAR == 1 ]]; then
  gcloud services enable sheets.googleapis.com --project "$PROYECTO" --quiet
  echo "  ✓ API de Google Sheets activada"
else
  echo "  · activaria la API de Google Sheets"
fi

# 2. Cuenta de servicio, sin roles
RECIEN=0
if gcloud iam service-accounts describe "$CORREO" --project "$PROYECTO" >/dev/null 2>&1; then
  echo "  ✓ cuenta de servicio existe: $CORREO"
  if [[ -n $(gcloud iam service-accounts keys list --iam-account "$CORREO" --project "$PROYECTO" \
               --managed-by=user --format='value(name)') ]]; then
    echo "  ✗ la cuenta ya tiene claves de usuario: borrar la vieja (y su credencial) antes de rotar"; exit 1
  fi
elif [[ $APLICAR == 1 ]]; then
  gcloud iam service-accounts create "$CUENTA" --project "$PROYECTO" --quiet \
    --display-name "n8n: planilla de prospectos (captacion)" \
    --description "Sin roles. Solo escribe en la planilla que se le comparte a mano."
  echo "  ✓ cuenta de servicio creada: $CORREO"
  RECIEN=1
else
  echo "  · crearia la cuenta de servicio $CORREO (sin roles)"
fi

if [[ $APLICAR == 0 ]]; then
  echo "  · crearia una clave, la subiria a n8n como «$NOMBRE_CRED» (httpNode=$HTTP_NODE) y borraria el archivo"
  echo "Seco: no se escribio nada. Agregue --aplicar (con el OK de Andres)."
  exit 0
fi

# 3. Clave -> n8n, sin que el valor salga del proceso
umask 077
DIR=$(mktemp -d -p /dev/shm 2>/dev/null || mktemp -d)
chmod 700 "$DIR"
KEY_ID=""; SUBIDA=0; DUDA=0
limpiar() {
  shred -u "$DIR"/* 2>/dev/null || rm -f "$DIR"/*
  rmdir "$DIR" 2>/dev/null || true
  if [[ -n "$KEY_ID" && $SUBIDA == 0 ]]; then
    if [[ $DUDA == 1 ]]; then
      echo "  ! no se sabe si la credencial llego a n8n: comprobarlo antes de borrar la clave ${KEY_ID:0:8}… de IAM"
    elif gcloud iam service-accounts keys delete "$KEY_ID" --iam-account "$CORREO" \
           --project "$PROYECTO" --quiet >/dev/null 2>&1; then
      echo "  ↺ clave ${KEY_ID:0:8}… borrada de IAM (no llego a n8n)"
    else
      echo "  ✗ quedo la clave ${KEY_ID:0:8}… en IAM: hay que borrarla"
    fi
  fi
}
trap limpiar EXIT
trap 'exit 130' INT TERM HUP

for intento in 1 2 3; do
  if gcloud iam service-accounts keys create "$DIR/clave.json" \
       --iam-account "$CORREO" --project "$PROYECTO" --quiet >/dev/null; then
    break
  fi
  [[ $RECIEN == 1 && $intento -lt 3 ]] || exit 1
  sleep 5
done
KEY_ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["private_key_id"])' "$DIR/clave.json")
echo "  ✓ clave ${KEY_ID:0:8}… creada (archivo en RAM, se borra al salir)"

set +e
CLAVE="$DIR/clave.json" python3 - <<PY
$LEER_ENV
import json, os, sys, urllib.request, urllib.error
env = leer_env()
k = json.load(open(os.environ["CLAVE"]))
huella = (k["private_key_id"], k["private_key"][40:80])
data = {"email": k["client_email"], "privateKey": k["private_key"], "inpersonate": False,
        "httpNode": os.environ["HTTP_NODE"] == "1"}
if os.environ["HTTP_NODE"] == "1":
    data["scopes"] = "https://www.googleapis.com/auth/spreadsheets"
del k
try:
    cuerpo = json.dumps({"name": os.environ["NOMBRE_CRED"], "type": "googleApi", "data": data}).encode()
    del data
    req = urllib.request.Request(env["N8N_BASE_URL"].rstrip("/") + "/api/v1/credentials",
        data=cuerpo, method="POST",
        headers={"X-N8N-API-KEY": env["N8N_API_KEY"], "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=60))
except urllib.error.HTTPError as e:
    # n8n no creo nada. Solo el mensaje, y nunca si podria repetir lo enviado.
    crudo = e.read().decode(errors="replace")
    try:
        msg = str(json.loads(crudo).get("message", ""))[:200]
    except Exception:
        msg = "(respuesta no JSON, omitida)"
    if "PRIVATE KEY" in msg or huella[0] in msg or huella[1] in msg:
        msg = "(omitido: podria contener datos enviados)"
    print(f"  ✗ n8n respondio {e.code}: {msg}")
    sys.exit(1)
except Exception as e:
    print(f"  ✗ sin respuesta clara de n8n ({type(e).__name__}): no se sabe si se creo")
    sys.exit(3)
print(f"  ✓ credencial en n8n: «{r.get('name')}» (id {r.get('id')})")
PY
RC=$?
set -e
case $RC in
  0) SUBIDA=1 ;;
  3) DUDA=1; exit 3 ;;
  *) exit 1 ;;
esac
echo "Falta un paso de una persona: compartir la planilla con $CORREO como EDITOR (solo con esa cuenta y personas del equipo)."
