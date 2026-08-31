#!/usr/bin/env bash
# Lista las plantillas de mensaje de la WABA y su estado de aprobacion.
#
# Sirve para responder con datos, y no con suposiciones, si se pueden mandar
# recordatorios fuera de la ventana de 24 horas: eso exige una plantilla
# APROBADA, y las plantillas pertenecen a la WABA, no a la app.
#
#   ./scripts/listar-plantillas.sh
#   ./scripts/listar-plantillas.sh --env .env.demo-b
#   ./scripts/listar-plantillas.sh --detalle   # componentes y variables
#
# --detalle existe para una comprobacion que la APROBACION NO HACE: que la
# plantilla tenga exactamente los componentes y la cantidad de variables que
# el flujo le manda. Si no calzan, Meta aprueba igual y el envio falla en
# produccion con #132000 (number of parameters does not match).
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
ENV_FILE=".env"; DETALLE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)   ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*) ENV_FILE="${1#*=}"; shift ;;
    --detalle) DETALLE=1; shift ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "✗ Falta $ENV_FILE"; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
. "./$ENV_FILE"
set +a
: "${WA_TOKEN:?Falta WA_TOKEN}"
: "${WABA_ID:?Falta WABA_ID}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

CAMPOS=""
if [[ $DETALLE -eq 1 ]]; then CAMPOS=",components"; fi
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
COD=$(curl -s --max-time 25 -o "$TMP" -w '%{http_code}' \
  "${G}/${WABA_ID}/message_templates?limit=100&fields=name,status,category,language${CAMPOS}" \
  -H "Authorization: Bearer ${WA_TOKEN}" || echo 000)

if [[ "$COD" != "200" ]]; then
  printf '\033[1;31m✗ No se pudo consultar: HTTP %s\033[0m\n' "$COD"
  head -c 300 "$TMP"; echo
  echo "  Si es 200 vacio, la WABA no tiene plantillas. Si es 403, al token le"
  echo "  falta el permiso whatsapp_business_management."
  exit 1
fi

python3 - "$TMP" <<'PY'
import json, re, sys, collections
d = json.load(open(sys.argv[1], encoding="utf-8"))
plantillas = d.get("data", [])
V, R, A, G, FIN = "\033[1;32m", "\033[1;31m", "\033[1;33m", "\033[0;90m", "\033[0m"

if not plantillas:
    print(f"{A}La WABA no tiene ninguna plantilla.{FIN}")
    print(f"{G}Sin plantilla aprobada no se puede escribir fuera de la ventana de 24 h.{FIN}")
    raise SystemExit(0)

print(f"{len(plantillas)} plantilla(s) en la WABA:\n")
color = {"APPROVED": V, "REJECTED": R, "PENDING": A}
por_estado = collections.Counter()
for p in sorted(plantillas, key=lambda x: (x.get("status", ""), x.get("name", ""))):
    est = p.get("status", "?")
    por_estado[est] += 1
    c = color.get(est, A)
    print(f"  {c}{est:<10}{FIN} {p.get('name','?'):<34} "
          f"{G}{p.get('category','?')} · {p.get('language','?')}{FIN}")
    # Con --detalle Graph devuelve `components`. Lo que interesa no es el texto
    # sino la FORMA: que componentes exige y cuantas variables tiene el cuerpo,
    # porque eso es lo que el nodo de n8n tiene que reproducir exactamente.
    comps = p.get("components")
    if comps is None:
        continue
    tipos, nvars = [], 0
    for c in comps:
        t = str(c.get("type", "?")).upper()
        if t == "BODY":
            nvars = len(set(re.findall(r"\{\{\s*(\d+)\s*\}\}", c.get("text", ""))))
            tipos.append(f"BODY({nvars} var)")
        elif t == "BUTTONS":
            tipos.append(f"BUTTONS({len(c.get('buttons', []))})")
        else:
            tipos.append(t)
    print(f"             {G}componentes: {', '.join(tipos) or 'ninguno'}{FIN}")

print()
aprobadas = por_estado.get("APPROVED", 0)
if aprobadas:
    print(f"{V}Hay {aprobadas} aprobada(s): la WABA SI puede enviar fuera de la ventana.{FIN}")
    print(f"{G}Crear una plantilla nueva en esta misma WABA es viable sin tocar la app ajena.{FIN}")
else:
    print(f"{A}Ninguna aprobada todavia.{FIN}")
PY
