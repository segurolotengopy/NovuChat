#!/usr/bin/env bash
# Carga los datos del segundo numero (Demo B) en un solo paso:
#
#   1. pide cada valor, ocultando los secretos;
#   2. VALIDA LA FORMA antes de escribir nada;
#   3. comprueba que los identificadores sean DISTINTOS de los del Demo A
#      -- el punto de verificacion mas importante de la guia de Meta: si son
#      iguales, la app quedo colgada de la WABA compartida;
#   4. escribe `.env.demo-b` (ignorado por git) y actualiza la tabla de
#      marcadores de CONFIGURACION.local.md;
#   5. deja listo el comando de verificacion del canal.
#
# Ningun valor se imprime en pantalla ni queda en el historial de la shell.
#
#   ./scripts/configurar-demo-b.sh
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
LOCAL="CONFIGURACION.local.md"
DESTINO=".env.demo-b"

[[ -f .env ]]     || { echo "✗ Falta .env (el del Demo A, para comparar)"; exit 1; }
[[ -f "$LOCAL" ]] || { echo "✗ Falta $LOCAL"; exit 1; }

# --- valores del Demo A, para la comparacion (no se muestran) ----------------
A_PHONE=$(grep -E '^WA_PHONE_ID=' .env | cut -d= -f2- | tr -d '[:space:]')
A_WABA=$(grep  -E '^WABA_ID='     .env | cut -d= -f2- | tr -d '[:space:]')
A_APP=$(grep   -E '^WA_APP_ID='   .env | cut -d= -f2- | tr -d '[:space:]')

pedir() {  # $1=rotulo  $2=regex  $3=descripcion de la forma  $4=oculto(si/no)
  local v
  while true; do
    if [[ "${4:-no}" == "si" ]]; then read -r -s -p "  $1: " v; echo
    else read -r -p "  $1: " v; fi
    v="$(printf '%s' "$v" | tr -d '[:space:]')"
    if [[ -z "$v" ]]; then echo "     (vacio; se omite)"; RESP=""; return 0; fi
    if [[ "$v" =~ $2 ]]; then RESP="$v"; return 0; fi
    echo "     ✗ no tiene la forma esperada: $3. Reintente."
  done
}

echo "Datos del segundo numero (portafolio NovuChat)."
echo "Los secretos no se muestran mientras los escribe."
echo

pedir "App ID de NovuChat-Demo-B" '^[0-9]{10,20}$' "solo digitos, 10 a 20";      APP_B="$RESP"
pedir "PHONE_NUMBER_ID"           '^[0-9]{10,20}$' "solo digitos, 10 a 20";      PHONE_B="$RESP"
pedir "WABA_ID"                   '^[0-9]{10,20}$' "solo digitos, 10 a 20";      WABA_B="$RESP"
pedir "Numero visible (opcional)" '^.{5,25}$'      "el numero tal como se ve";   NUM_B="$RESP"
pedir "Token permanente"          '^EAA[A-Za-z0-9_-]{50,}$' "empieza con EAA"  si; TOKEN_B="$RESP"
pedir "App Secret"                '^[0-9a-f]{32}$' "32 caracteres hexadecimales" si; SECRET_B="$RESP"

echo
echo "== Comprobacion contra el Demo A =="
mal=0
comparar() { # $1=rotulo $2=nuevo $3=viejo
  if [[ -z "$2" ]]; then printf '  - %s: no cargado\n' "$1"; return; fi
  if [[ "$2" == "$3" ]]; then
    printf '  \033[1;31m✗ %s es IGUAL al del Demo A\033[0m\n' "$1"; mal=1
  else
    printf '  \033[1;32m✓ %s distinto del Demo A\033[0m\n' "$1"
  fi
}
comparar "PHONE_NUMBER_ID" "$PHONE_B" "$A_PHONE"
comparar "WABA_ID"         "$WABA_B"  "$A_WABA"
comparar "App ID"          "$APP_B"   "$A_APP"

if [[ $mal -eq 1 ]]; then
  echo
  echo "  La app quedo colgada de la WABA compartida: el numero de prueba es el"
  echo "  mismo y el bloqueo sigue vivo. Hay que rehacer el bloque 2 de la guia."
  echo "  NO se escribio nada."
  exit 1
fi

# --- .env.demo-b --------------------------------------------------------------
[[ -f "$DESTINO" ]] && cp -p "$DESTINO" "${DESTINO}.respaldo"
GRAPH=$(grep -E '^WA_GRAPH_VERSION=' .env | cut -d= -f2- | tr -d '[:space:]')
TO=$(grep    -E '^WA_TO='            .env | cut -d= -f2- | tr -d '[:space:]')

{
  echo "# Entorno del Demo B. Generado por scripts/configurar-demo-b.sh."
  echo "# Ignorado por git: contiene valores reales y el repositorio es publico."
  echo "WA_TOKEN=$TOKEN_B"
  echo "WA_APP_SECRET=$SECRET_B"
  echo "WA_PHONE_ID=$PHONE_B"
  echo "WABA_ID=$WABA_B"
  echo "WA_APP_ID=$APP_B"
  echo "WA_GRAPH_VERSION=${GRAPH:-v26.0}"
  echo "WA_TO=$TO"
  echo "N8N_BASE_URL=$(grep -E '^N8N_BASE_URL=' .env | cut -d= -f2-)"
  echo "N8N_API_KEY=$(grep -E '^N8N_API_KEY=' .env | cut -d= -f2-)"
  echo "# El webhook y el workflow del Demo B se completan al crear el flujo:"
  echo "N8N_WEBHOOK_PATH="
  echo "N8N_WEBHOOK_URL="
  echo "N8N_WORKFLOW_ID="
} > "$DESTINO"
chmod 600 "$DESTINO"

# --- tabla de marcadores ------------------------------------------------------
cp -p "$LOCAL" "${LOCAL}.respaldo"
APP_B="$APP_B" PHONE_B="$PHONE_B" WABA_B="$WABA_B" NUM_B="$NUM_B" LOCAL="$LOCAL" python3 - <<'PY'
import os, re
local = os.environ["LOCAL"]
valores = {
    "WA_APP_ID_B":      os.environ["APP_B"],
    "WA_PHONE_ID_B":    os.environ["PHONE_B"],
    "WABA_ID_B":        os.environ["WABA_B"],
    "WA_TEST_NUMBER_B": os.environ["NUM_B"],
}
lineas = open(local, encoding="utf-8").read().splitlines(keepends=True)
puestos = []
for i, l in enumerate(lineas):
    m = re.match(r'^(\|\s*`\$\{([A-Z0-9_]+)\}`\s*\|)([^|]*)(\|.*)$', l.rstrip("\n"))
    if m and m.group(2) in valores and valores[m.group(2)]:
        lineas[i] = f"{m.group(1)} {valores[m.group(2)]} {m.group(4)}\n"
        puestos.append(m.group(2))
open(local, "w", encoding="utf-8").writelines(lineas)
print("  marcadores actualizados: " + (", ".join(puestos) if puestos else "ninguno"))
PY

echo
echo "Listo."
echo "  $DESTINO escrito (chmod 600, ignorado por git)"
echo
echo "Ahora, la verificacion del canal:"
echo "  ./scripts/verificar-meta.sh --env $DESTINO"
echo "  ./scripts/verificar-meta.sh --env $DESTINO --suscribir   # si falta la suscripcion"
