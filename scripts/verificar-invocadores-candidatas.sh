#!/usr/bin/env bash
# Verifica, en SOLO LECTURA, que las Functions candidatas del aviso «This deployment is in an unexpected state» tengan INVOCADOR
# (roles/run.invoker con al menos un miembro) en su servicio de Cloud Run. Lo corre el workflow de STAGING tras el despliegue cuando la
# compuerta bajó el aviso a warning (PR #1137): ese aviso hace que firebase-tools OMITA el invoker de la Function afectada, pero no dice cuál.
#
#   PROYECTO=<id> CANDIDATAS=fnUno,fnDos [REGION=us-east1] ./scripts/verificar-invocadores-candidatas.sh
#
# Para cada candidata lee `gcloud run services get-iam-policy <función en minúsculas> --region <región> --project <id>`; no escribe nada.
#   · Una HTTP o callable pública tiene `allUsers`; una programada (schedule) tiene la cuenta de servicio del planificador: por eso se acepta
#     CUALQUIER miembro con roles/run.invoker; lo que NO se acepta es un servicio SIN ninguno.
#   · Una Function de EVENTOS (Firestore, Storage, Pub/Sub por Eventarc) NO lleva invocador en su servicio: firebase-tools no se lo pone ni
#     al crearla ni al actualizarla, y a Eventarc le da el permiso a nivel de PROYECTO; el aviso no le quita nada. Por eso, SOLO cuando el
#     servicio no trae invocador, se lee `gcloud functions describe <función> --gen2` (solo lectura) y se da por buena si tiene `eventTrigger`
#     con su `eventType`. Si esa lectura falla o no hay disparador de eventos, sigue siendo «SIN invocador» (I-A de la revisión de #1137).
#   · Si la política no se puede leer (sin permiso, sin sesión, servicio inexistente) también FALLA: no se da por bueno lo que no se verificó.
# Salida: 0 todas con invocador · 1 alguna sin invocador o sin poder leerla · 2 uso. Imprime solo nombres de Functions (no secretos).
set -euo pipefail
set +x
[[ "${PROYECTO:-}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "::error::verificar-invocadores-candidatas: PROYECTO inválido o ausente" >&2; exit 2; }
REGION="${REGION:-us-east1}"
[[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]+$ ]] || { echo "::error::verificar-invocadores-candidatas: REGION inválida" >&2; exit 2; }
[[ -n "${CANDIDATAS:-}" ]] || { echo "No hay candidatas: nada que verificar."; exit 0; }
IFS=',' read -r -a IDS <<< "$CANDIDATAS"
FALLAS=()
for id in "${IDS[@]}"; do
  [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "::error::candidata con forma inválida (se rechaza)"; FALLAS+=("(nombre inválido)"); continue; }
  # El servicio de Cloud Run de una Function: su id en minúsculas y con «-» en lugar de «_» (M-C de la revisión de #1137).
  servicio="$(printf '%s' "$id" | tr '[:upper:]_' '[:lower:]-')"
  if politica="$(gcloud run services get-iam-policy "$servicio" --region "$REGION" --project "$PROYECTO" --format=json 2>/dev/null)"; then
    if printf '%s' "$politica" | python3 -I -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ok = any(b.get("role") == "roles/run.invoker" and b.get("members") for b in d.get("bindings", []))
sys.exit(0 if ok else 1)'; then
      echo "✓ $id: tiene invocador"
    elif gcloud functions describe "$id" --gen2 --region "$REGION" --project "$PROYECTO" --format=json 2>/dev/null | python3 -I -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ev = d.get("eventTrigger") if isinstance(d, dict) else None
sys.exit(0 if isinstance(ev, dict) and isinstance(ev.get("eventType"), str) and ev["eventType"] else 1)'; then
      echo "✓ $id: es de eventos (su permiso de invocación es de proyecto, no del servicio)"
    else
      echo "::error::✗ $id: SIN invocador (roles/run.invoker)"; FALLAS+=("$id")
    fi
  else
    echo "::error::✗ $id: no se pudo leer la política IAM de su servicio"; FALLAS+=("$id")
  fi
done
if (( ${#FALLAS[@]} > 0 )); then
  echo "::error::Verificar a mano y, si falta, conceder el invocador: ./scripts/nube-visor.sh --servicio <s> --entorno staging (seco) y luego con --aplicar --confirmo staging; para una Function fuera de su lista cerrada, gcloud run services add-iam-policy-binding con --project y --region. Functions: ${FALLAS[*]}"
  exit 1
fi
echo "Todas las candidatas tienen invocador."
