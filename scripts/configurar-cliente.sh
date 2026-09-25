#!/usr/bin/env bash
# Carga los datos del numero de WhatsApp de un CLIENTE en su propio entorno,
# en un solo paso. Generaliza `configurar-demo-b.sh`, que comparaba solo contra
# el Demo A: aca se compara contra TODOS los entornos y marcadores conocidos.
#
#   1. pide cada valor, ocultando los secretos;
#   2. VALIDA LA FORMA antes de escribir nada;
#   3. comprueba que App ID, WABA ID y PHONE_NUMBER_ID sean DISTINTOS de los de
#      cualquier otro entorno (.env, .env.demo-b, .env.<cliente>...) y de los
#      marcadores de CONFIGURACION.local.md -- incluida la app de
#      WhatsApp-Modular (OTRA_APP_ID). Si alguno coincide, la app quedo colgada
#      de una WABA ajena: paso el 13/09/2026 con NovuChat-Asistente, que Meta
#      colgo de la WABA del Demo B;
#   4. escribe `.env.<cliente>` (ignorado por git, chmod 600) y agrega o
#      actualiza los marcadores `${WA_APP_ID_<CLIENTE>}` etc. en
#      CONFIGURACION.local.md (solo valores NO secretos);
#   5. deja listo el comando de verificacion del canal.
#
# Ningun valor se imprime en pantalla ni queda en el historial de la shell.
#
#   ./scripts/configurar-cliente.sh --cliente NOVUCHAT
#   ./scripts/configurar-cliente.sh --cliente QTACO --dir "$HOME/NovuChat"
#
# --dir es la carpeta donde viven los .env y CONFIGURACION.local.md. Por
# defecto, la raiz del repositorio donde esta el script. Hace falta cuando el
# script se corre desde un worktree: los .env viven solo en la carpeta principal.
set -euo pipefail

CLIENTE=""
DIR="$(cd "$(dirname "$0")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cliente)   CLIENTE="${2:?--cliente necesita un nombre}"; shift 2 ;;
    --cliente=*) CLIENTE="${1#*=}"; shift ;;
    --dir)       DIR="${2:?--dir necesita una carpeta}"; shift 2 ;;
    --dir=*)     DIR="${1#*=}"; shift ;;
    -h|--help)   sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

# El nombre del cliente es el de su carpeta en CLIENTES/: MAYUSCULAS y digitos.
[[ "$CLIENTE" =~ ^[A-Z][A-Z0-9]{1,19}$ ]] || {
  echo "✗ --cliente debe ir en MAYUSCULAS, como su carpeta en CLIENTES/ (p. ej. NOVUCHAT)"; exit 2; }
[[ -d "$DIR" ]] || { echo "✗ No existe la carpeta $DIR"; exit 1; }
cd "$DIR"

LOCAL="CONFIGURACION.local.md"
minus="$(printf '%s' "$CLIENTE" | tr '[:upper:]' '[:lower:]')"
DESTINO=".env.${minus}"

[[ -f .env ]]     || { echo "✗ Falta .env en $DIR (de ahi salen N8N_BASE_URL y la version del Graph API)"; exit 1; }
[[ -f "$LOCAL" ]] || { echo "✗ Falta $LOCAL en $DIR"; exit 1; }

# --- identificadores ya usados por otros entornos (no se muestran) ----------
# Cada linea: "<origen> <clave> <valor>". Se excluyen el propio destino, la
# plantilla y los respaldos (son copias de entornos que ya se leen).
usados="$(mktemp)"
trap 'rm -f "$usados"' EXIT
for f in .env .env.*; do
  [[ -f "$f" ]] || continue
  case "$f" in
    "$DESTINO"|.env.example|*.respaldo|*respaldo*) continue ;;
  esac
  for clave in WA_APP_ID WABA_ID WA_PHONE_ID; do
    v=$(grep -E "^${clave}=" "$f" | head -1 | cut -d= -f2- | tr -d '[:space:]"'"'" || true)
    [[ -n "$v" ]] && printf '%s %s %s\n' "$f" "$clave" "$v" >> "$usados"
  done
done
# Marcadores de CONFIGURACION.local.md, salvo los de este mismo cliente.
while IFS= read -r linea; do
  marca=$(printf '%s' "$linea" | grep -oE '\$\{[A-Z0-9_]+\}' | head -1 | tr -d '${}')
  [[ -z "$marca" || "$marca" == *"_${CLIENTE}" ]] && continue
  v=$(printf '%s' "$linea" | grep -oE '[0-9]{10,20}' | head -1 || true)
  [[ -n "$v" ]] && printf '%s %s %s\n' "$LOCAL" "$marca" "$v" >> "$usados"
done < <(grep -E '^\|\s*`\$\{(WA_APP_ID|OTRA_APP_ID|WABA_ID|WA_PHONE_ID)[A-Z0-9_]*\}`' "$LOCAL" || true)

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

echo "Datos del numero de ${CLIENTE} (se escriben en ${DIR}/${DESTINO})."
echo "Los secretos no se muestran mientras los escribe."
echo

pedir "App ID"                    '^[0-9]{10,20}$' "solo digitos, 10 a 20";      APP="$RESP"
pedir "PHONE_NUMBER_ID"           '^[0-9]{10,20}$' "solo digitos, 10 a 20";      PHONE="$RESP"
pedir "WABA_ID"                   '^[0-9]{10,20}$' "solo digitos, 10 a 20";      WABA="$RESP"
pedir "Numero visible (opcional)" '^.{5,25}$'      "el numero tal como se ve";   NUM="$RESP"
pedir "Token permanente"          '^EAA[A-Za-z0-9_-]{50,}$' "empieza con EAA"  si; TOKEN="$RESP"
pedir "App Secret (opcional)"     '^[0-9a-f]{32}$' "32 caracteres hexadecimales" si; SECRET="$RESP"

for obligatorio in APP PHONE WABA TOKEN; do
  [[ -n "${!obligatorio}" ]] || { echo "✗ Falta un dato obligatorio ($obligatorio). NO se escribio nada."; exit 1; }
done
[[ "$PHONE" != "$WABA" ]] || { echo "✗ PHONE_NUMBER_ID y WABA_ID son iguales: son dos IDs distintos. NO se escribio nada."; exit 1; }

echo
echo "== Comprobacion contra los demas entornos =="
mal=0
comparar() { # $1=rotulo $2=valor nuevo
  local hallado
  hallado=$(awk -v v="$2" '$3 == v { print $1 " (" $2 ")" }' "$usados" | sort -u | paste -sd, - || true)
  if [[ -n "$hallado" ]]; then
    printf '  \033[1;31m✗ %s coincide con %s\033[0m\n' "$1" "$hallado"; mal=1
  else
    printf '  \033[1;32m✓ %s distinto de todos (termina en %s)\033[0m\n' "$1" "${2: -4}"
  fi
}
comparar "App ID"          "$APP"
comparar "WABA_ID"         "$WABA"
comparar "PHONE_NUMBER_ID" "$PHONE"
echo "  ($(cut -d' ' -f1 "$usados" | sort -u | wc -l | tr -d ' ') origenes revisados, $(wc -l < "$usados" | tr -d ' ') identificadores)"

if [[ $mal -eq 1 ]]; then
  echo
  echo "  Un identificador ya pertenece a otro entorno: la app o el numero quedaron"
  echo "  en una WABA ajena. Revise el portafolio y la WABA antes de seguir."
  echo "  NO se escribio nada."
  exit 1
fi

# --- .env.<cliente> -----------------------------------------------------------
[[ -f "$DESTINO" ]] && cp -p "$DESTINO" "${DESTINO}.respaldo"
# LO DEL FLUJO NO CAMBIA CUANDO CAMBIA EL NUMERO (21/09/2026). Al mover un
# cliente a su propia WABA (Platinum) el flujo de n8n es el mismo: su id, su
# ruta de webhook y el token de verificacion se conservan del entorno anterior.
# Antes salian vacios y todo lo que seguia (publicar, ver ejecuciones, el
# webhook) fallaba. Se leen sin mostrarlos.
previo() { [[ -f "${DESTINO}.respaldo" ]] && grep -E "^$1=" "${DESTINO}.respaldo" | head -1 | cut -d= -f2- || true; }
PREV_WF=$(previo N8N_WORKFLOW_ID); PREV_PATH=$(previo N8N_WEBHOOK_PATH)
PREV_URL=$(previo N8N_WEBHOOK_URL); PREV_VERIF=$(previo WA_WEBHOOK_VERIFY_TOKEN)
# El token de verificacion del webhook con el nombre que lee webhook-meta.sh
# --alta-meta (24/09/2026: el .env de NovuChat no lo tenia con ningun nombre,
# y el alta del webhook en la app nueva se habria negado).
PREV_META_VERIF=$(previo META_VERIFY_TOKEN)
GRAPH=$(grep -E '^WA_GRAPH_VERSION=' .env | cut -d= -f2- | tr -d '[:space:]' || true)
umask 077
{
  echo "# Entorno de ${CLIENTE}. Generado por scripts/configurar-cliente.sh."
  echo "# Ignorado por git: contiene valores reales y el repositorio es publico."
  echo "WA_TOKEN=$TOKEN"
  echo "WA_APP_SECRET=$SECRET"
  echo "WA_PHONE_ID=$PHONE"
  echo "WABA_ID=$WABA"
  echo "WA_APP_ID=$APP"
  echo "WA_GRAPH_VERSION=${GRAPH:-v26.0}"
  echo "# Numero real: sin lista de destinatarios. WA_TO es para pruebas manuales."
  echo "WA_TO=$(grep -E '^WA_TO=' .env | cut -d= -f2- | tr -d '[:space:]' || true)"
  echo "N8N_BASE_URL=$(grep -E '^N8N_BASE_URL=' .env | cut -d= -f2- || true)"
  echo "N8N_API_KEY=$(grep -E '^N8N_API_KEY=' .env | cut -d= -f2- || true)"
  echo "# El webhook y el workflow: del entorno anterior si existia; si no, se"
  echo "# completan al crear el flujo del cliente."
  echo "N8N_WEBHOOK_PATH=${PREV_PATH}"
  echo "N8N_WEBHOOK_URL=${PREV_URL}"
  echo "N8N_WORKFLOW_ID=${PREV_WF}"
  if [[ -n "$PREV_VERIF" ]]; then echo "WA_WEBHOOK_VERIFY_TOKEN=${PREV_VERIF}"; fi
  if [[ -n "$PREV_META_VERIF" ]]; then echo "META_VERIFY_TOKEN=${PREV_META_VERIF}"; fi
} > "$DESTINO"
chmod 600 "$DESTINO"

# --- marcadores en CONFIGURACION.local.md (solo valores no secretos) ---------
cp -p "$LOCAL" "${LOCAL}.respaldo"
APP="$APP" PHONE="$PHONE" WABA="$WABA" NUM="$NUM" LOCAL="$LOCAL" CLIENTE="$CLIENTE" python3 - <<'PY'
import os, re
local, c = os.environ["LOCAL"], os.environ["CLIENTE"]
valores = {
    f"WA_APP_ID_{c}":      (os.environ["APP"],   f"App ID de la app de {c}"),
    f"WABA_ID_{c}":        (os.environ["WABA"],  f"WABA de {c}"),
    f"WA_PHONE_ID_{c}":    (os.environ["PHONE"], f"PHONE_NUMBER_ID del numero de {c}"),
    f"WA_NUMBER_{c}":      (os.environ["NUM"],   f"Numero visible de {c}"),
}
lineas = open(local, encoding="utf-8").read().splitlines(keepends=True)
puestos = set()
for i, l in enumerate(lineas):
    m = re.match(r'^(\|\s*`\$\{([A-Z0-9_]+)\}`\s*\|)([^|]*)(\|.*)$', l.rstrip("\n"))
    if m and m.group(2) in valores and valores[m.group(2)][0]:
        lineas[i] = f"{m.group(1)} {valores[m.group(2)][0]} {m.group(4)}\n"
        puestos.add(m.group(2))
faltan = [k for k, (v, _) in valores.items() if v and k not in puestos]
if faltan:
    if lineas and not lineas[-1].endswith("\n"):
        lineas[-1] += "\n"
    lineas.append(f"\n## Cliente {c} (escrito por configurar-cliente.sh)\n\n")
    lineas.append("| Marcador | Valor | Qué es |\n|---|---|---|\n")
    for k in faltan:
        lineas.append(f"| `${{{k}}}` | {valores[k][0]} | {valores[k][1]} |\n")
open(local, "w", encoding="utf-8").writelines(lineas)
print("  marcadores actualizados: " + (", ".join(sorted(puestos)) or "ninguno"))
print("  marcadores agregados:    " + (", ".join(faltan) or "ninguno"))
PY

echo
echo "Listo."
echo "  ${DIR}/${DESTINO} escrito (chmod 600, ignorado por git)"
echo
echo "Ahora, la verificacion del canal (la 4.a comprobacion, el webhook, falla"
echo "hasta que exista el flujo de n8n y se complete N8N_WEBHOOK_URL):"
# verificar-meta.sh no cambia de carpeta: lee el --env relativo a donde se corre.
echo "  cd ${DIR} && ./scripts/verificar-meta.sh --env ${DESTINO}"
