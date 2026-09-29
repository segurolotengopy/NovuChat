#!/usr/bin/env bash
# curl FALSO para las suites que corren los scripts de Meta sin red
# (apps-ajenas-escrituras.test.ts). Va adelante en el PATH con el nombre
# `curl`: `command curl` también lo encuentra.
#
# Anota cada llamada en $REGISTRO_CURL, una línea:
#   ESCRIBE|LEE <argumentos> ‹entrada estándar› «cuerpo leído de @archivo»
# y marca como ESCRITURA toda forma que curl convierte en POST, PUT o DELETE:
# -X/--request con cualquier verbo distinto de GET (-X POST, -XPOST,
# --request POST, --request=POST), -d/--data*, --json, -F/--form*,
# -T/--upload-file (revisión de seguridad del #265, LOW-C).
#
# Contesta: a una escritura, éxito; a `fields=id,name` (la consulta del
# candado), $RESPUESTA_GRAPH; a `subscribed_apps`, $SUSCRITAS_GRAPH; a lo
# demás, una lista vacía. Respeta -o (escribe ahí) y -w '%{http_code}' (200).
entrada=""; datos=""; salida=""; formato=""; tipo=LEE
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  a="${args[i]}"; sig="${args[i + 1]:-}"
  case "$a" in
    -X | --request) [ "$sig" = GET ] || tipo=ESCRIBE ;;
    -X?*) [ "${a#-X}" = GET ] || tipo=ESCRIBE ;;
    --request=*) [ "${a#--request=}" = GET ] || tipo=ESCRIBE ;;
    -d | --data | --data-* | --json | -F | --form | --form-* | -T | --upload-file)
      tipo=ESCRIBE
      case "$sig" in @-) ;; @*) datos+=$(cat "${sig#@}") ;; esac ;;
    --data=* | --json=* | --form=*) tipo=ESCRIBE ;;  # --data-x=y ya entra arriba
    -o) salida="$sig" ;;
    -w) formato="$sig" ;;
  esac
  [ "$a" = "@-" ] && entrada=$(cat)
done
printf '%s %s ‹%s› «%s»\n' "$tipo" "$*" "$entrada" "$datos" >> "$REGISTRO_CURL"
if [ "$tipo" = ESCRIBE ]; then
  cuerpo='{"success":true,"id":"1","status":"PENDING","category":"UTILITY"}'
else
  case " $* " in
    *fields=id,name*) cuerpo="$RESPUESTA_GRAPH" ;;
    *subscribed_apps*) cuerpo="$SUSCRITAS_GRAPH" ;;
    *) cuerpo='{"data":[]}' ;;
  esac
fi
if [ -n "$salida" ]; then printf '%s' "$cuerpo" > "$salida"; else printf '%s' "$cuerpo"; fi
case "$formato" in *http_code*) printf 200 ;; esac
exit 0
