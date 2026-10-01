#!/usr/bin/env bash
# =============================================================================
# registrar-numero.sh — estado y registro de un número en la Cloud API, con el
# CÓDIGO DE ERROR REAL de Meta, y sin mostrar nunca el token ni el PIN.
#
# POR QUÉ EXISTE. Desde 2026-09 la pantalla de Meta separa VERIFICAR el número
# (el código por SMS) de REGISTRARLO en la Cloud API (el PIN de dos pasos). El
# botón «Registrar» de la interfaz solo dice «Se produjo un error durante el
# registro. Vuelve a intentarlo», y cada reintento a ciegas acerca el bloqueo
# por intentos (#133016, que dura horas). La API sí dice qué pasó: PIN
# incorrecto (#133005), demasiados intentos (#133016), número sin verificar…
#
#   ./scripts/registrar-numero.sh --env .env.bellido --estado      # solo mira
#   ./scripts/registrar-numero.sh --env .env.bellido --registrar   # pide el PIN oculto
#   ./scripts/registrar-numero.sh --env .env.platinum --dar-de-baja  # pide escribir los últimos 4
#
# --dar-de-baja existe para mover un número a OTRA WABA (Platinum, 21/09/2026:
# de la WABA de NovuChat a la del portafolio de la clínica): antes de sacarlo de
# la WABA vieja hay que darlo de baja de la Cloud API. Desde ese momento el
# número NO RECIBE NI MANDA NADA hasta que se registre en la WABA nueva, así que
# pide escribir a mano los últimos 4 dígitos del Phone ID: un Enter de más no
# corta a un cliente.
#
# Lee WA_TOKEN, WA_PHONE_ID y WA_APP_ID del entorno del cliente (escrito por
# configurar-cliente.sh). El PIN lo pega una persona, oculto; no queda en el
# historial ni en la salida. Solo se imprime la respuesta de Meta.
#
# APPS AJENAS (prohibiciones 5 y 7; revisión de seguridad del #265). Con un
# .env de otro sistema, --dar-de-baja le cortaría un número en producción.
# Antes de --registrar y --dar-de-baja, `negar_app_ajena` corta si el token es
# de una app de ese sistema, o si no se sabe de qué app es. El token y el PIN
# no van en los argumentos de curl (se verían en `ps`): la cabecera por la
# entrada estándar y el cuerpo en un archivo 600.
# =============================================================================
set -euo pipefail

ENV_FILE=""; MODO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env)        ENV_FILE="$2"; shift 2 ;;
    --estado)     MODO="estado"; shift ;;
    --registrar)  MODO="registrar"; shift ;;
    --dar-de-baja) MODO="baja"; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ] || { echo "✗ Falta --env <archivo> (p. ej. .env.bellido)" >&2; exit 2; }
[ -n "$MODO" ] || { echo "✗ Falta --estado, --registrar o --dar-de-baja" >&2; exit 2; }

# El candado de apps ajenas, ANTES del .env: queda readonly.
# shellcheck source=scripts/lib/apps-ajenas.sh
source "$(dirname "$0")/lib/apps-ajenas.sh"
set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_FILE"
set +a
: "${WA_TOKEN:?WA_TOKEN no está en $ENV_FILE}"
: "${WA_PHONE_ID:?WA_PHONE_ID no está en $ENV_FILE}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

# La respuesta de Meta nunca trae el token ni el PIN; se imprime tal cual,
# formateada si hay python3.
mostrar() { if command -v python3 >/dev/null; then python3 -m json.tool 2>/dev/null || cat; else cat; fi; }

case "$MODO" in
  estado)
    echo "Estado del número …${WA_PHONE_ID: -4} según Meta:"
    curl_token -s --max-time 20 \
      "${G}/${WA_PHONE_ID}?fields=display_phone_number,verified_name,name_status,code_verification_status,status,quality_rating,platform_type,is_pin_enabled,messaging_limit_tier" \
      | mostrar
    echo
    echo "Lectura: code_verification_status=VERIFIED es el SMS ya pasado;"
    echo "         status=CONNECTED es que está REGISTRADO en la Cloud API;"
    echo "         is_pin_enabled dice si el número ya tiene PIN de dos pasos."
    ;;
  registrar)
    negar_app_ajena "${WA_APP_ID:-}" numero
    echo "Registro del número …${WA_PHONE_ID: -4} en la Cloud API."
    echo "El PIN son 6 dígitos que elige el dueño del número (NO el código del SMS)."
    echo "Si el número ya tiene PIN, tiene que ser ESE. No se muestra al escribir."
    read -r -s -p "  PIN de dos pasos: " PIN; echo
    printf '%s' "$PIN" | grep -Eq '^[0-9]{6}$' || { echo "✗ El PIN son exactamente 6 dígitos." >&2; exit 1; }
    TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
    # printf es del shell: el PIN no pasa por los argumentos de ningún proceso.
    (umask 077; printf '{"messaging_product":"whatsapp","pin":"%s"}' "$PIN" > "$TMP/cuerpo.json")
    unset PIN
    RESP=$(curl_token -s --max-time 30 -X POST "${G}/${WA_PHONE_ID}/register" \
      -H "Content-Type: application/json" --data-binary @"$TMP/cuerpo.json")
    echo "$RESP" | mostrar
    if echo "$RESP" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
      echo; echo "✓ Registrado. Ahora --estado tiene que decir status=CONNECTED."
    else
      echo; echo "✗ Meta no registró el número. El código de arriba dice por qué:"
      echo "   133005 = PIN incorrecto (el número ya tenía otro PIN)"
      echo "   133016 = demasiados intentos: esperar; no reintentar"
      echo "   133006 = hay que volver a verificar el número (SMS)"
      echo "   100/33 = el PHONE_NUMBER_ID no es de esta WABA o el token no la ve"
    fi
    ;;
  baja)
    negar_app_ajena "${WA_APP_ID:-}" numero
    echo "BAJA del número …${WA_PHONE_ID: -4} de la Cloud API (entorno ${ENV_FILE})."
    echo "Desde ahora NO recibe ni manda mensajes hasta registrarlo en la WABA nueva."
    read -r -p "  Para confirmar, escriba los últimos 4 dígitos del Phone ID: " CONF
    [ "$CONF" = "${WA_PHONE_ID: -4}" ] || { echo "✗ No coincide. No se hizo nada." >&2; exit 1; }
    RESP=$(curl_token -s --max-time 30 -X POST "${G}/${WA_PHONE_ID}/deregister")
    echo "$RESP" | mostrar
    if echo "$RESP" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
      echo; echo "✓ Dado de baja. --estado ya no tiene que decir CONNECTED."
      echo "  Siguiente: sacarlo de la WABA vieja en WhatsApp Manager y agregarlo en la nueva."
    else
      echo; echo "✗ Meta no lo dio de baja: el código de arriba dice por qué. El número sigue como estaba."
    fi
    ;;
esac
