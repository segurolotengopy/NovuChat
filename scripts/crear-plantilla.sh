#!/usr/bin/env bash
# Crea (envia a revision) una PLANTILLA de WhatsApp en la WABA del entorno,
# por la API, sin pasar por el editor de Meta.
#
# Por que existe: cada cliente necesita sus plantillas en SU WABA (recordatorio
# de cita, solicitud sin confirmar, aviso interno), y hasta el 17/09/2026 se
# creaban a mano en el editor, donde tres intentos costaron una tarde
# (memoria «meta-plantillas-restricciones»). Aca las reglas aprendidas van
# escritas y se comprueban ANTES de mandar:
#   - categoria UTILITY por defecto y vocabulario sin lenguaje comercial: el
#     clasificador de Meta lee las palabras, no el destinatario. Se rechaza
#     un cuerpo con «interes», «promocion», «oferta», «descuento», «te
#     esperamos», «continuar la atencion», «prospecto»;
#   - sin botones (Meta no acepta wa.me en botones; y un boton «Llamar» llama
#     a la empresa, no al cliente);
#   - el cuerpo no empieza ni termina con variable, no hay dos variables
#     pegadas, y cada {{n}} lleva su ejemplo;
#   - validez personalizada al MAXIMO que admite la categoria (utility: 12 h),
#     para que un telefono apagado no descarte el aviso a los 10 minutos.
#
# Sin --aplicar SOLO muestra la carga util que mandaria (sin ningun valor del
# entorno). Con --aplicar la envia y muestra id, estado y categoria devueltos.
#
#   ./scripts/crear-plantilla.sh --env .env.platinum \
#       --nombre solicitud_cita_sin_confirmar --idioma es \
#       --cuerpo 'Se registró tu solicitud de cita en {{1}} para {{2}}. Estado: sin confirmar. Responde este mensaje si quieres retomarla.' \
#       --ejemplos 'Clínica Platinum|el sábado 20 a las 10:00' [--aplicar]
#
# --encabezado y --pie (24/09/2026) agregan un encabezado de TEXTO y un pie,
# fijos y sin variables (hasta 60 caracteres cada uno): es la forma de la
# plantilla `solicitud_contacto` de NovuChat, que hay que volver a pedir en
# la WABA de Silvana. Un flujo que manda solo parametros de cuerpo sigue
# calzando: el encabezado y el pie fijos no llevan parametros.
#
# Despues: ./scripts/listar-plantillas.sh --env .env.platinum --detalle
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

ENV_FILE=".env"
NOMBRE=""; IDIOMA="es"; CATEGORIA="UTILITY"; CUERPO=""; EJEMPLOS=""; VALIDEZ=""; APLICAR=0
ENCABEZADO=""; PIE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)        ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*)      ENV_FILE="${1#*=}"; shift ;;
    --nombre)     NOMBRE="${2:?}"; shift 2 ;;
    --idioma)     IDIOMA="${2:?}"; shift 2 ;;
    --categoria)  CATEGORIA="${2:?}"; shift 2 ;;
    --cuerpo)     CUERPO="${2:?}"; shift 2 ;;
    --ejemplos)   EJEMPLOS="${2:?}"; shift 2 ;;
    --encabezado) ENCABEZADO="${2:?}"; shift 2 ;;
    --pie)        PIE="${2:?}"; shift 2 ;;
    --validez-seg) VALIDEZ="${2:?}"; shift 2 ;;
    --aplicar)    APLICAR=1; shift ;;
    -h|--help)    sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- la carga util, comprobada -------------------------------------------------
NOMBRE="$NOMBRE" IDIOMA="$IDIOMA" CATEGORIA="$CATEGORIA" CUERPO="$CUERPO" \
EJEMPLOS="$EJEMPLOS" VALIDEZ="$VALIDEZ" ENCABEZADO="$ENCABEZADO" PIE="$PIE" TMP="$TMP" python3 - <<'PY'
import json, os, re, sys
R, A, V, FIN = "\033[1;31m", "\033[1;33m", "\033[1;32m", "\033[0m"
nombre, idioma, categoria = os.environ["NOMBRE"], os.environ["IDIOMA"], os.environ["CATEGORIA"].upper()
cuerpo, ejemplos, validez = os.environ["CUERPO"], os.environ["EJEMPLOS"], os.environ["VALIDEZ"]
encabezado, pie = os.environ["ENCABEZADO"], os.environ["PIE"]
problemas = []
# Encabezado y pie: fijos. Meta admite variables en el encabezado, pero el
# flujo no manda parametros de encabezado, y una variable ahi lo haria fallar
# con #132000 despues de aprobada.
for rotulo, texto in (("--encabezado", encabezado), ("--pie", pie)):
    if not texto:
        continue
    if len(texto) > 60:
        problemas.append(f"{rotulo}: mas de 60 caracteres")
    if re.search(r"\{\{\d+\}\}", texto):
        problemas.append(f"{rotulo}: no admite variables (el flujo no manda parametros ahi)")
    if "\n" in texto:
        problemas.append(f"{rotulo}: sin saltos de linea")
if not re.fullmatch(r"[a-z0-9_]{1,512}", nombre):
    problemas.append("--nombre: minusculas, digitos y guion bajo")
if categoria not in ("UTILITY", "MARKETING", "AUTHENTICATION"):
    problemas.append("--categoria: UTILITY, MARKETING o AUTHENTICATION")
if not cuerpo.strip():
    problemas.append("--cuerpo vacio")
if len(cuerpo) > 1024:
    problemas.append("--cuerpo: mas de 1024 caracteres")
variables = re.findall(r"\{\{(\d+)\}\}", cuerpo)
if variables != [str(i) for i in range(1, len(variables) + 1)]:
    problemas.append("las variables tienen que ser {{1}}, {{2}}… en orden y sin saltos")
if re.match(r"\s*\{\{\d+\}\}", cuerpo) or re.search(r"\{\{\d+\}\}\s*$", cuerpo):
    problemas.append("el cuerpo no puede empezar ni terminar con una variable")
if re.search(r"\}\}\s*\{\{", cuerpo):
    problemas.append("dos variables pegadas: Meta las rechaza")
if "\n" in cuerpo and categoria == "UTILITY":
    pass  # los saltos de linea en el cuerpo se aceptan; en las variables, no
COMERCIAL = r"inter[eé]s|promoci[oó]n|oferta|descuento|te esperamos|continuar la atenci[oó]n|prospecto|gratis|precio"
hallado = re.findall(COMERCIAL, cuerpo, re.I)
if categoria == "UTILITY" and hallado:
    problemas.append(f"vocabulario que el clasificador toma como MARKETING: {', '.join(sorted(set(h.lower() for h in hallado)))}")
lista_ejemplos = [e.strip() for e in ejemplos.split("|")] if ejemplos else []
if variables and len(lista_ejemplos) != len(variables):
    problemas.append(f"hacen falta {len(variables)} ejemplos separados por | (--ejemplos), hay {len(lista_ejemplos)}")
maximo = {"UTILITY": 43200, "MARKETING": 2592000, "AUTHENTICATION": 900}[categoria] if categoria in ("UTILITY", "MARKETING", "AUTHENTICATION") else 43200
ttl = int(validez) if validez else maximo
if ttl < 30 or ttl > maximo:
    problemas.append(f"--validez-seg fuera de rango para {categoria}: 30..{maximo}")
if problemas:
    print(f"{R}✗ No se envia:{FIN}")
    for p in problemas: print(f"    {p}")
    sys.exit(2)
componente = {"type": "BODY", "text": cuerpo}
if variables:
    componente["example"] = {"body_text": [lista_ejemplos]}
componentes = []
if encabezado:
    componentes.append({"type": "HEADER", "format": "TEXT", "text": encabezado})
componentes.append(componente)
if pie:
    componentes.append({"type": "FOOTER", "text": pie})
carga = {
    "name": nombre, "language": idioma, "category": categoria,
    "message_send_ttl_seconds": ttl,
    "components": componentes,
}
open(os.path.join(os.environ["TMP"], "carga.json"), "w", encoding="utf-8").write(json.dumps(carga, ensure_ascii=False))
print(f"{V}Carga util (sin ningun valor del entorno):{FIN}")
print(json.dumps(carga, ensure_ascii=False, indent=2))
print(f"\n{A}Validez: {ttl} s ({ttl // 3600} h) · categoria {categoria} · {len(variables)} variable(s){FIN}")
PY

if [[ $APLICAR -ne 1 ]]; then
  echo
  echo "Seco: no se envio nada. Agregue --aplicar para mandarla a revision."
  exit 0
fi

COD=$(curl -s --max-time 30 -o "$TMP/rta.json" -w '%{http_code}' -X POST \
  "${G}/${WABA_ID}/message_templates" \
  -H "Authorization: Bearer ${WA_TOKEN}" -H "Content-Type: application/json" \
  --data-binary @"$TMP/carga.json" || echo 000)

if [[ "$COD" == "200" ]]; then
  python3 - "$TMP/rta.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"\033[1;32m✓ Plantilla enviada a revision:\033[0m id {d.get('id')} · estado {d.get('status')} · categoria {d.get('category')}")
if d.get("category") and d.get("category") != "UTILITY":
    print("  ⚠ Meta la clasifico distinto de UTILITY: revise el vocabulario antes de usarla.")
print("  La aprobacion tarda de minutos a dias. Consultela con listar-plantillas.sh --detalle.")
PY
else
  printf '\033[1;31m✗ Meta la rechazo: HTTP %s\033[0m\n' "$COD"
  python3 -c "
import json,sys
try:
    e=json.load(open('$TMP/rta.json')).get('error',{})
    print('  ', e.get('message',''), '|', e.get('error_user_msg',''))
except Exception: pass"
  exit 1
fi
