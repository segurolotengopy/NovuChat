#!/usr/bin/env bash
# Los pasos de NUBE que el despliegue del prepago necesita ANTES de la etiqueta,
# hechos por la cuenta propietaria, sin que el valor de un secreto pase nunca
# por la pantalla, el historial, un archivo ni el modelo.
#
# Por qué existe: el despliegue que trae el prepago (A-0, A-1, A-2) declara dos
# secretos nuevos y dos Functions programadas. Sin estos pasos, `firebase deploy`
# falla antes de publicar (secretos inexistentes o fuera de la condición de IAM;
# API de Cloud Scheduler deshabilitada; la cuenta de despliegue sin permiso para
# crear trabajos). Andres autoriza; Claude opera: este script hace los pasos, y
# lo corre Claude con su «sí». Ver .github/DESPLIEGUE-FIREBASE.md §secretos.
#
#   ./scripts/nube-prepago.sh              # diagnóstico: qué falta y qué haría
#   ./scripts/nube-prepago.sh --aplicar    # lo hace (idempotente: repetir es inofensivo)
#
# Lo que hace, en orden:
#   1. habilita cloudscheduler.googleapis.com (la cuenta de despliegue no puede);
#   2. crea COBRADOR_TOKEN y COBRADOR_AVISO_SECRETO con un valor al azar de 48
#      caracteres, generado por python y entregado a gcloud por una tubería:
#      nunca se imprime ni se escribe en disco. Cuando el cobrador se conecte,
#      el MISMO valor se carga allá (CONSUMIDOR_TOKEN_NOVUCHAT y
#      CONSUMIDOR_AVISO_SECRETO_NOVUCHAT) con otro script, también sin mostrarlo;
#   3. da roles/secretmanager.secretAccessor sobre cada uno a sa-functions;
#   4. amplía la condición «secretos-de-las-functions» de la cuenta de despliegue
#      (rol desplegadorSecretos: lee metadatos, NO el valor) con COBRADOR_;
#   5. da roles/cloudscheduler.admin a la cuenta de despliegue (crear, cambiar y
#      borrar los dos trabajos, el del sondeo y el del barrido);
#   6. da a sa-functions roles/storage.objectViewer (la evidencia de un pago
#      manual) y roles/storage.objectCreator (el PNG del QR) sobre el bucket de
#      la consola. Hasta hoy ninguna Function usaba Storage.
#
# Lo que NO hace: escribir plataforma/prepago.cobrador.baseUrl (el cobrador no
# tiene URL pública todavía), ni encender el corte, ni tocar el cobrador. Y no
# lee nunca el valor de un secreto: para verificar, cuenta versiones y permisos.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

APLICAR=0
case "${1:-}" in
  --aplicar) APLICAR=1 ;;
  "") ;;
  -h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Opción desconocida: $1" >&2; exit 2 ;;
esac

export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
P="$(grep -o '"quota_project_id": *"[^"]*"' "$CLOUDSDK_CONFIG/application_default_credentials.json" | sed 's/.*"\([^"]*\)"$/\1/')"
[[ -n "$P" ]] || { echo "✗ no encuentro el proyecto en $CLOUDSDK_CONFIG" >&2; exit 1; }
N="$(gcloud projects describe "$P" --format='value(projectNumber)')"
SA_FN="sa-functions@${P}.iam.gserviceaccount.com"
SA_DEP="sa-deploy-prod@${P}.iam.gserviceaccount.com"
BUCKET="gs://${P}.firebasestorage.app"
SECRETOS=(COBRADOR_TOKEN COBRADOR_AVISO_SECRETO)
V=$'\e[32m'; A=$'\e[33m'; F=$'\e[0m'
ok()    { echo "  ${V}✓${F} $*"; }
falta() { echo "  ${A}·${F} $*"; }
hacer() { if (( APLICAR )); then echo "  → $*"; else echo "  (haría) $*"; fi; }
PENDIENTES=0

if (( APLICAR )); then echo "Proyecto: ${P:0:4}…  ·  APLICANDO"; else echo "Proyecto: ${P:0:4}…  ·  diagnóstico (no escribe)"; fi

# --- 1. API de Cloud Scheduler ------------------------------------------------
echo "1. Cloud Scheduler"
if gcloud services list --enabled --project "$P" --filter='config.name=cloudscheduler.googleapis.com' --format='value(config.name)' | grep -q .; then
  ok "API habilitada"
else
  falta "API deshabilitada"; hacer "habilitar cloudscheduler.googleapis.com"; PENDIENTES=$((PENDIENTES + 1))
  if (( APLICAR )); then gcloud services enable cloudscheduler.googleapis.com --project "$P" --quiet; fi
fi

# --- 2 y 3. Secretos y acceso de sa-functions ---------------------------------
echo "2-3. Secretos del cobrador"
for s in "${SECRETOS[@]}"; do
  if gcloud secrets describe "$s" --project "$P" >/dev/null 2>&1; then
    ok "$s existe ($(gcloud secrets versions list "$s" --project "$P" --filter='state=ENABLED' --format='value(name)' | wc -l) versión habilitada)"
  else
    falta "$s no existe"; hacer "crear $s con 48 caracteres al azar (sin mostrarlos)"; PENDIENTES=$((PENDIENTES + 1))
    if (( APLICAR )); then
      python3 -c 'import secrets,sys; sys.stdout.write(secrets.token_urlsafe(36))' \
        | gcloud secrets create "$s" --project "$P" --replication-policy=automatic --data-file=- --quiet >/dev/null
    fi
  fi
  if (( APLICAR )) || gcloud secrets describe "$s" --project "$P" >/dev/null 2>&1; then
    if gcloud secrets get-iam-policy "$s" --project "$P" --format=json 2>/dev/null \
        | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(b['role']=='roles/secretmanager.secretAccessor' and 'serviceAccount:$SA_FN' in b['members'] for b in d.get('bindings',[])) else 1)"; then
      ok "sa-functions puede leer $s"
      continue
    fi
  fi
  falta "sa-functions no puede leer $s"; hacer "dar secretAccessor sobre $s a sa-functions"; PENDIENTES=$((PENDIENTES + 1))
  if (( APLICAR )); then
    gcloud secrets add-iam-policy-binding "$s" --project "$P" \
      --member="serviceAccount:$SA_FN" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
  fi
done

# --- 4 y 5. La cuenta de despliegue -------------------------------------------
echo "4-5. Cuenta de despliegue"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
gcloud projects get-iam-policy "$P" --format=json > "$TMP"
set +e
python3 - "$TMP" "$N" "$SA_DEP" "$APLICAR" <<'PY'
import json, sys
ruta, n, sa, aplicar = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == '1'
d = json.load(open(ruta)); miembro = f'serviceAccount:{sa}'
clausula = f'resource.name.startsWith("projects/{n}/secrets/COBRADOR_")'
pref = '  → ' if aplicar else '  (haría) '
cambio = False
for b in d['bindings']:
    c = b.get('condition') or {}
    if b['role'].endswith('/desplegadorSecretos') and miembro in b['members'] and c.get('title') == 'secretos-de-las-functions':
        if len(b['members']) != 1:
            print('  \x1b[31m✗\x1b[0m el permiso con condición tiene más de un miembro: no toco nada'); sys.exit(3)
        if 'secrets/COBRADOR_' in c['expression']:
            print('  \x1b[32m✓\x1b[0m la condición ya cubre COBRADOR_')
        else:
            print('  \x1b[33m·\x1b[0m la condición no cubre COBRADOR_')
            print(pref + 'agregar a la condición: || ' + clausula.replace(n, '<número>'))
            c['expression'] = c['expression'] + ' || ' + clausula; cambio = True
        break
else:
    print('  \x1b[31m✗\x1b[0m no encuentro el permiso con condición de la cuenta de despliegue: no toco nada'); sys.exit(3)
if any(b['role'] == 'roles/cloudscheduler.admin' and miembro in b['members'] and not b.get('condition') for b in d['bindings']):
    print('  \x1b[32m✓\x1b[0m la cuenta de despliegue ya puede crear trabajos de Scheduler')
else:
    print('  \x1b[33m·\x1b[0m la cuenta de despliegue no puede crear trabajos de Scheduler')
    print(pref + 'dar roles/cloudscheduler.admin a la cuenta de despliegue')
    d['bindings'].append({'role': 'roles/cloudscheduler.admin', 'members': [miembro]}); cambio = True
if cambio:
    d['version'] = 3  # obligatorio con permisos condicionados
    json.dump(d, open(ruta, 'w'))
    sys.exit(10)
PY
rc=$?
set -e
if (( rc == 3 )); then exit 3; fi
if (( rc == 10 )); then
  PENDIENTES=$((PENDIENTES + 1))
  if (( APLICAR )); then
    # set-iam-policy lleva el etag que se leyó: si otro cambió la política entretanto, falla en vez de pisarla.
    gcloud projects set-iam-policy "$P" "$TMP" --quiet >/dev/null && ok "política del proyecto actualizada"
  fi
fi

# --- 6. Storage para sa-functions ---------------------------------------------
echo "6. Storage de la consola"
POL_B="$(gcloud storage buckets get-iam-policy "$BUCKET" --format=json)"
for rol in roles/storage.objectViewer roles/storage.objectCreator; do
  if echo "$POL_B" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(b['role']=='$rol' and 'serviceAccount:$SA_FN' in b['members'] for b in d.get('bindings',[])) else 1)"; then
    ok "sa-functions tiene $rol"
  else
    falta "sa-functions no tiene $rol"; hacer "dar $rol sobre el bucket de la consola a sa-functions"; PENDIENTES=$((PENDIENTES + 1))
    if (( APLICAR )); then
      gcloud storage buckets add-iam-policy-binding "$BUCKET" \
        --member="serviceAccount:$SA_FN" --role="$rol" --quiet >/dev/null
    fi
  fi
done

if (( APLICAR )); then
  echo "Hecho. Corra el diagnóstico de nuevo: todo tiene que salir en ✓."
elif (( PENDIENTES )); then
  echo "Diagnóstico: $PENDIENTES paso(s) pendiente(s); no se escribió nada. Con --aplicar se hace lo marcado «(haría)»."
else
  echo "Diagnóstico: no falta nada."
fi
