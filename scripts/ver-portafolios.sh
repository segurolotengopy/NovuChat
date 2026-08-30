#!/usr/bin/env bash
# Averigua a que portafolio comercial pertenece la WABA y, si el token lo
# permite, cuantos portafolios ve la identidad que lo emitio.
#
# Existe para responder con datos la pregunta que condiciona el Demo B: si la
# cuenta ya llego al limite de portafolios, la opcion de crear uno nuevo para
# obtener un segundo numero de prueba no es viable y hay que rediseniar.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; . ./.env; set +a
: "${WA_TOKEN:?Falta WA_TOKEN}"; : "${WABA_ID:?Falta WABA_ID}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

consulta() { curl -s --max-time 25 -H "Authorization: Bearer ${WA_TOKEN}" "$1"; }

echo "== Dueño de la WABA =="
consulta "${G}/${WABA_ID}?fields=id,name,owner_business_info,account_review_status,business_verification_status" > /tmp/waba.json
python3 - /tmp/waba.json <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if "error" in d:
    print("  x " + str(d["error"].get("message", ""))[:160]); raise SystemExit
b = d.get("owner_business_info") or {}
print("  WABA        : " + str(d.get("name", "?")))
print("  portafolio  : " + str(b.get("name", "?")) + "  (id " + str(b.get("id", "?")) + ")")
for k, etq in (("account_review_status", "revision de la cuenta"),
               ("business_verification_status", "verificacion del negocio")):
    if d.get(k):
        print("  " + etq.ljust(22) + ": " + str(d[k]))
PY

echo
echo "== Portafolios visibles para esta identidad =="
consulta "${G}/me/businesses?limit=25&fields=id,name,verification_status" > /tmp/negocios.json
python3 - /tmp/negocios.json <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if "error" in d:
    print("  No se puede listar con este token: " + str(d["error"].get("message", ""))[:130])
    print("  Es esperable: el token es de usuario de SISTEMA y esta acotado a su portafolio.")
    print("  Listar portafolios exige un token de usuario con permiso business_management.")
    raise SystemExit
neg = d.get("data", [])
print("  " + str(len(neg)) + " portafolio(s):")
for n in neg:
    print("    - " + str(n.get("name", "?")) + "  (id " + str(n.get("id", "?")) + ") "
          + str(n.get("verification_status", "")))
if len(neg) >= 2:
    print()
    print("  Ya hay 2 o mas: probablemente no se pueda crear otro con este perfil.")
PY
rm -f /tmp/waba.json /tmp/negocios.json
