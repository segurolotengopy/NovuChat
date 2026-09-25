#!/usr/bin/env bash
# =============================================================================
# EL NOMBRE VISIBLE DE UN NUMERO DE WHATSAPP: leerlo y pedir el cambio, por API
# =============================================================================
#
# POR QUE EXISTE. El nombre visible es lo que ve el paciente arriba del chat, y
# hasta hoy se cambiaba a mano en WhatsApp Manager. Eso contradice «Andres
# autoriza; Claude opera» y, peor, la pantalla MIENTE: el 15/09/2026 el
# Administrador seguia mostrando el nombre viejo con «Editar» en gris mientras
# Meta ya habia aprobado el nuevo. La API lo dice sin ambiguedad, y tambien
# acepta el cambio -- comprobado el 24/09/2026 con el numero del Dr. Bellido,
# `{"success":true}` -- aunque la documentacion publica no lo documente.
#
# EL CUPO ES LO PELIGROSO. El nombre visible tiene un cupo de cambios por mes y
# pedirlo varias veces hizo que Meta cortara los intentos del mes entero
# (NovuChat, 13-15/09/2026). Un `POST` de mas no es un error recuperable: es un
# intento quemado. Por eso el script, antes de pedir nada:
#
#   1. lee el estado y lo muestra;
#   2. se NIEGA si el numero ya se llama asi -- el caso mas facil de gastar sin
#      querer, porque la pantalla puede mostrar otra cosa;
#   3. se NIEGA si ya hay un cambio pedido y sin aplicar;
#   4. pide UNA vez, y vuelve a leer para decir que quedo.
#
# COMO SE LEE EL RESULTADO. Un cambio aceptado NO se aplica en el acto: queda
# `verified_name` con el nombre VIEJO y `new_display_name` con el nuevo, los dos
# en `AVAILABLE_WITHOUT_REVIEW`. Eso es «aprobado y todavia sin aplicar», y se
# aplica solo. Mientras tanto, el paciente sigue viendo el viejo.
#
# El token no se imprime nunca ni viaja por la linea de comandos, donde seria
# visible en `/proc/<pid>/cmdline`: va en un archivo de cabeceras con permisos
# 600 que se borra al salir.
#
#   ./scripts/nombre-visible.sh --env .env.bellido                      # solo leer
#   ./scripts/nombre-visible.sh --env .env.bellido --pedir "Dr. Andres Bellido"
#
# Salida: 0 si leyo (o si pidio y Meta acepto), 1 si Meta rechazo o si el
# cambio no corresponde, 2 si la llamada esta mal.
set -euo pipefail

ENV_FILE=""; NUEVO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)   ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*) ENV_FILE="${1#*=}"; shift ;;
    --pedir) NUEVO="${2:?--pedir necesita el nombre nuevo}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ENV_FILE" ]] || { echo "Falta --env" >&2; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo "No existe $ENV_FILE" >&2; exit 2; }

set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
. "$ENV_FILE"
set +a
: "${WA_TOKEN:?Falta WA_TOKEN}"
: "${WA_PHONE_ID:?Falta WA_PHONE_ID}"
GRAPH="https://graph.facebook.com/${WA_GRAPH_VERSION:-v21.0}"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
umask 077
printf 'Authorization: Bearer %s\n' "$WA_TOKEN" > "$TMP/cabeceras"

leer() {
  curl -sS --max-time 20 -H @"$TMP/cabeceras" \
    "${GRAPH}/${WA_PHONE_ID}?fields=verified_name,name_status,new_display_name,new_name_status" \
    > "$TMP/estado.json"
}

leer
NUEVO="$NUEVO" python3 - "$TMP/estado.json" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
if 'error' in d:
    print('  ✗ Meta:', d['error'].get('message', '?')); sys.exit(1)
pedido = d.get('new_display_name')
print(f"  Nombre visible : {d.get('verified_name')} · {d.get('name_status')}")
print(f"  Cambio pedido  : {pedido or 'ninguno'} · {d.get('new_name_status') or 'NONE'}")
nuevo = os.environ.get('NUEVO', '')
if not nuevo:
    sys.exit(0)
if d.get('verified_name') == nuevo:
    print('\n  ✗ Ya se llama así: no se pide nada (el cupo del mes es limitado).'); sys.exit(1)
if pedido == nuevo:
    print('\n  ✗ Ese cambio YA está pedido y esperando aplicarse. No se pide otra vez.'); sys.exit(1)
if d.get('new_name_status') not in (None, '', 'NONE'):
    print('\n  ✗ Hay otro cambio en curso. Espere a que se resuelva.'); sys.exit(1)
PY

[[ -n "$NUEVO" ]] || exit 0

printf '\n  Pidiendo: «%s»\n' "$NUEVO"
curl -sS --max-time 30 -X POST -H @"$TMP/cabeceras" \
  --data-urlencode "new_display_name=${NUEVO}" "${GRAPH}/${WA_PHONE_ID}" > "$TMP/respuesta.json"
python3 - "$TMP/respuesta.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
if d.get('success') is True:
    print('  ✓ Meta aceptó el pedido.')
else:
    print('  ✗ Meta:', (d.get('error') or {}).get('message', json.dumps(d, ensure_ascii=False)))
    sys.exit(1)
PY

printf '\n  Estado después:\n'
leer
python3 - "$TMP/estado.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(f"  Nombre visible : {d.get('verified_name')} · {d.get('name_status')}")
print(f"  Cambio pedido  : {d.get('new_display_name') or 'ninguno'} · {d.get('new_name_status') or 'NONE'}")
if d.get('new_display_name'):
    print('\n  El nombre nuevo está aprobado pero TODAVÍA NO se aplicó: el cliente')
    print('  sigue viendo el viejo hasta que Meta lo cambie solo. Se comprueba')
    print('  volviendo a correr este script, no mirando WhatsApp Manager.')
PY
