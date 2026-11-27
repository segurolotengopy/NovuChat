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
  servicio="$(printf '%s' "$id" | tr 'A-Z' 'a-z')"
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
