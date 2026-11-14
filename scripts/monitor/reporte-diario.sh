#!/usr/bin/env bash
# =============================================================================
# reporte-diario.sh — arma el reporte diario del monitor externo de n8n.
# =============================================================================
#
# Por qué existe (política del 11/10/2026: cada monitor genera un reporte
# periódico que prueba que sigue vivo). Lee por la ENTRADA ESTÁNDAR la lista de
# corridas del workflow `monitor-n8n.yml` (la respuesta de la API de GitHub
# `actions/workflows/<archivo>/runs`) y escribe por la salida estándar el texto
# del comentario para la Issue «Monitor n8n».
#
# El texto se arma SOLO con números y palabras de una lista cerrada: nunca se
# copia un título de corrida, una rama, un commit ni un mensaje de la API (el
# repositorio es público y una Issue la lee cualquiera).
#
# Entrada (variables de entorno):
#   REPORTE_AHORA_EPOCH   «ahora» en segundos (por omisión, el reloj)
#   REPORTE_HORAS         ventana en horas (por omisión 24)
#   REPORTE_ESPERADAS     corridas esperadas en la ventana (por omisión 144)
#   REPORTE_MINIMO        mínimo de corridas para dar el monitor por vivo (por
#                         omisión 24: una por hora; el cron de GitHub se atrasa)
#   REPORTE_CERTIFICADO   vigente | por_vencer | vencido | sin_datos
#   REPORTE_DIAS          días que le quedan al certificado (entero)
#
# Salida: 0 todo bien · 1 hay algo que avisar (GitHub manda UN correo al día):
# el monitor casi no corrió, la última corrida falló, o el certificado está por
# vencer o vencido · 2 entrada inválida.
# Pruebas: admin/pruebas/plataforma/monitor-n8n-reporte.test.ts
set -uo pipefail

mal_uso() { echo "::error::$1" >&2; exit 2; }
entero() { [[ "$2" =~ ^-?[0-9]{1,12}$ ]] || mal_uso "$1 debe ser un entero."; }

AHORA="${REPORTE_AHORA_EPOCH:-$(date -u +%s)}"
HORAS="${REPORTE_HORAS:-24}"
ESPERADAS="${REPORTE_ESPERADAS:-144}"
MINIMO="${REPORTE_MINIMO:-24}"
CERT="${REPORTE_CERTIFICADO:-sin_datos}"
DIAS="${REPORTE_DIAS:-}"
entero REPORTE_AHORA_EPOCH "$AHORA"
entero REPORTE_HORAS "$HORAS"
entero REPORTE_ESPERADAS "$ESPERADAS"
entero REPORTE_MINIMO "$MINIMO"
case "$CERT" in vigente | por_vencer | vencido | sin_datos) ;; *) CERT="sin_datos" ;; esac
[[ "$DIAS" =~ ^-?[0-9]{1,5}$ ]] || DIAS=""

DESDE=$((AHORA - HORAS * 3600))

# Solo se leen `conclusion`, `status`, `event` y `created_at` de cada corrida.
# Las corridas manuales (simulacros) no cuentan.
CUENTAS="$(jq -r --argjson desde "$DESDE" '
  if (type != "object") or ((.workflow_runs | type) != "array") then error("forma") else . end
  | [ .workflow_runs[]
      | select(.event == "schedule")
      | select((.created_at | type) == "string")
      | { t: (.created_at | fromdateiso8601), c: (.conclusion // "en_curso") }
      | select(.t >= $desde) ] as $r
  | ($r | map(select(.c != "en_curso")) | sort_by(.t) | last | .c // "ninguna") as $ultima
  | ($r | map(select(.c == "en_curso")) | length) as $enCurso
  | [ ($r | length),
      ($r | map(select(.c == "success")) | length),
      ($r | map(select(.c == "failure")) | length),
      (if ($ultima | IN("success", "failure", "cancelled", "skipped", "ninguna")) then $ultima else "otra" end),
      $enCurso
    ] | @tsv' 2>/dev/null)" || mal_uso "La lista de corridas no tiene la forma esperada."

IFS=$'\t' read -r TOTAL BIEN MAL ULTIMA EN_CURSO <<<"$CUENTAS"
entero total "$TOTAL"; entero bien "$BIEN"; entero mal "$MAL"; entero en_curso "$EN_CURSO"

AVISOS=()
[ "$TOTAL" -ge "$MINIMO" ] || AVISOS+=("El monitor corrió $TOTAL veces en $HORAS h (mínimo $MINIMO): casi no está vigilando.")
[ "$ULTIMA" != "failure" ] || AVISOS+=("La última sonda falló: n8n no respondió desde la red de GitHub.")
case "$CERT" in
  por_vencer) AVISOS+=("Al certificado le quedan ${DIAS:-pocos} días: la renovación automática no está corriendo.") ;;
  vencido) AVISOS+=("El certificado está vencido.") ;;
esac

if [ "${#AVISOS[@]}" -eq 0 ]; then echo "**Monitor de n8n: vivo, sin novedades.**"; else echo "**Monitor de n8n: REVISAR.**"; fi
echo
echo "- Sondas en $HORAS h: $TOTAL de ~$ESPERADAS esperadas ($BIEN bien, $MAL con falla)."
# «Última sonda» es la última TERMINADA: una corrida en curso (una caída tarda
# unos 6 minutos en declararse) no puede tapar una falla reciente.
SUFIJO=""
[ "$EN_CURSO" -le 0 ] || SUFIJO=" (en curso ahora: $EN_CURSO)"
echo "- Última sonda terminada: \`$ULTIMA\`$SUFIJO."
echo "- Certificado: \`$CERT\`${DIAS:+ ($DIAS días)}."
for a in "${AVISOS[@]:-}"; do [ -z "$a" ] || echo "- ⚠ $a"; done
echo
echo "Cómo leerlo: \`docs/produccion/monitor-n8n.md\`. Reporte automático; una sola red que falla es sospecha, no incidente."

[ "${#AVISOS[@]}" -eq 0 ] || { echo "::error::El reporte diario del monitor de n8n tiene ${#AVISOS[@]} aviso(s)." >&2; exit 1; }
exit 0
