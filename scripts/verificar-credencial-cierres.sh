#!/usr/bin/env bash
# Comprueba SI EL VALOR QUE PEGÓ EN LA CREDENCIAL DE n8n es el correcto.
#
# POR QUÉ EXISTE. n8n guarda las credenciales cifradas y no las expone por su
# API, así que desde afuera es imposible saber qué token tiene una credencial.
# Y el endpoint contesta 401 tanto si el token es el del otro número como si
# está mal copiado: dos causas distintas, el mismo síntoma. Eso dejó una tarde
# entera de "el nodo da 401" sin poder avanzar.
#
# Este script cierra esa ambigüedad: se pega el valor tal como quedó en el campo
# «Header Value» y dice a qué número corresponde, o si no corresponde a ninguno.
#
# El valor NO se muestra, NO se guarda y NO queda en el historial de la shell:
# se lee oculto y vive solo en memoria mientras corre.
#
#   ./scripts/verificar-credencial-cierres.sh
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
URL="https://us-east1-novuchat-demo.cloudfunctions.net/registrarCierre"

echo "Pegue el valor del campo «Header Value» de la credencial de n8n,"
echo "tal cual está, con «Bearer» o sin él. No se va a mostrar."
read -r -s -p "Valor: " VALOR
echo
[[ -n "$VALOR" ]] || { echo "✗ Vacío. No se probó nada."; exit 1; }

probar() {   # $1 = archivo de entorno, $2 = rótulo
  local env_file="$1" etiqueta="$2" numero cod
  [[ -f "$env_file" ]] || { printf '  %-22s: falta %s\n' "$etiqueta" "$env_file"; return; }
  numero=$(grep -m1 '^WA_PHONE_ID=' "$env_file" | cut -d= -f2- | tr -d '[:space:]')
  [[ -n "$numero" ]] || { printf '  %-22s: sin WA_PHONE_ID\n' "$etiqueta"; return; }

  # Referencia única y de tipo válido: si el token sirve, esto REGISTRA un
  # cierre de prueba. Se borra al final para no ensuciar la facturación.
  cod=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
        -H 'Content-Type: application/json' \
        -H "X-NovuChat-Numero: ${numero}" \
        -H "Authorization: ${VALOR}" \
        --data "{\"tipo\":\"cita\",\"referencia\":\"verificacion_${etiqueta}_$$\",\"telefono\":\"59100000000\"}" \
        || echo 000)

  case "$cod" in
    200) printf '  \033[1;32m✓ %-20s: ES ESTE. El valor corresponde a este número.\033[0m\n' "$etiqueta" ;;
    401) printf '    %-20s: no\n' "$etiqueta" ;;
    *)   printf '    %-20s: respuesta inesperada (HTTP %s)\n' "$etiqueta" "$cod" ;;
  esac
}

echo
echo "== ¿A qué número corresponde este valor? =="
probar ".env"        "Demo A"
probar ".env.demo-b" "Demo B"

echo
echo "Si dice «no» en los dos, el valor no es ninguno de los dos tokens:"
echo "vuelva a copiarlo con  grep '^NOVUCHAT_HMAC=' .env | cut -d= -f2-"
echo
echo "Los cierres de verificación que se hayan creado se borran con:"
echo "  cd admin && node scripts/limpiar-cierres-de-prueba.mjs --proyecto novuchat-demo"
