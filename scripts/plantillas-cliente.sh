#!/usr/bin/env bash
# =============================================================================
# plantillas-cliente.sh — crea y consulta, por la Graph API, las plantillas de
# UTILIDAD con las que un flujo avisa a una persona fuera de la ventana de 24 h.
#
# POR QUÉ. Un mensaje que inicia la empresa (el aviso al doctor en una
# emergencia, el aviso a recepción) solo se entrega como texto libre si esa
# persona escribió al número en las últimas 24 h. Con una plantilla aprobada
# se entrega siempre. Las restricciones que ya pagamos (memoria del 14/09):
# categoría UTILIDAD, redactada como aviso de una solicitud que YA EXISTE, sin
# «prospecto/interés/atención», sin botones, las variables ni al principio ni
# al final, con ejemplos, y validez al máximo.
#
# SE CORRE EN LA TERMINAL DE UNA PERSONA: lee el token del .env del cliente.
#
#   ./scripts/plantillas-cliente.sh --env-cliente ~/NovuChat/.env.bellido --listar
#   ./scripts/plantillas-cliente.sh --env-cliente ~/NovuChat/.env.bellido --crear [--aplicar]
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_CLIENTE=""; MODO=""; APLICAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    --listar)      MODO="listar"; shift ;;
    --crear)       MODO="crear"; shift ;;
    --aplicar)     APLICAR=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODO" ] && [ -f "$ENV_CLIENTE" ] || { echo "Uso: --env-cliente <.env.x> --listar | --crear [--aplicar]" >&2; exit 2; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_CLIENTE"
set +a
: "${WA_TOKEN:?}" "${WABA_ID:?}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

export MODO APLICAR WA_TOKEN WABA_ID G
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
VERDE, ROJO, GRIS, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[0m"
G, WABA, TOKEN = os.environ["G"], os.environ["WABA_ID"], os.environ["WA_TOKEN"]
modo, aplicar = os.environ["MODO"], os.environ["APLICAR"] == "1"

# LAS PLANTILLAS. Nombres fijos: el flujo las envía por nombre.
PLANTILLAS = [
  {"name": "alerta_emergencia", "language": "es", "category": "UTILITY",
   "message_send_ttl_seconds": 43200,
   "components": [{"type": "BODY",
     "text": "Alerta de emergencia registrada en el asistente. Paciente: {{1}}. Teléfono: {{2}}. Escribió: {{3}}. Se le indicó comunicarse con recepción.",
     "example": {"body_text": [["Mateo Quispe", "59170000000", "mi bebé no respira bien"]]}}]},
  {"name": "solicitud_cita", "language": "es", "category": "UTILITY",
   "message_send_ttl_seconds": 43200,
   "components": [{"type": "BODY",
     "text": "Se registró una solicitud de cita en el asistente. Paciente: {{1}}. Teléfono: {{2}}. Motivo: {{3}}. Responde a esta solicitud desde este WhatsApp.",
     "example": {"body_text": [["Mateo Quispe", "59170000000", "control de niño sano, quiere hablar con una persona"]]}}]},
]

def llamar(metodo, url, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")

cod, rta = llamar("GET", f"{G}/{WABA}/message_templates?fields=name,status,category,language,quality_score,rejected_reason&limit=100")
if cod != 200: print(f"{ROJO}✗ GET message_templates → {cod}: {rta.get('error', rta).get('message', rta)}{FIN}"); sys.exit(1)
vigentes = {(t["name"], t["language"]): t for t in rta.get("data", [])}
print(f"Plantillas en la WABA …{WABA[-4:]}: {len(vigentes)}")
for (n, l), t in sorted(vigentes.items()):
    print(f"  {n:<22} {l:<4} {t.get('category',''):<10} {t.get('status','')}" + (f"  ({t.get('rejected_reason')})" if t.get('rejected_reason') and t.get('rejected_reason') != 'NONE' else ""))
if modo == "listar": sys.exit(0)

for p in PLANTILLAS:
    clave = (p["name"], p["language"])
    if clave in vigentes:
        print(f"{GRIS}= {p['name']} ya existe: {vigentes[clave].get('status')}{FIN}"); continue
    print(f"{VERDE}+ {p['name']} ({p['category']}){FIN}" + ("" if aplicar else "  (se crearía)"))
    print(f"    «{p['components'][0]['text']}»")
    if aplicar:
        cod, rta = llamar("POST", f"{G}/{WABA}/message_templates", p)
        if cod not in (200, 201): print(f"  {ROJO}✗ {cod}: {rta.get('error', rta).get('message', rta)}{FIN}"); continue
        print(f"  {VERDE}✓ enviada a revisión: id {rta.get('id')} · estado {rta.get('status')}{FIN}")
if not aplicar: print(f"{GRIS}Seco: no se creó nada. Agregue --aplicar.{FIN}")
PY
