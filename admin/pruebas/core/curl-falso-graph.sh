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
# -T/--upload-file (revisión de seguridad del #265, LOW-C), también con las
# opciones cortas agrupadas o pegadas a su valor (-sXPOST, -d@cuerpo, -Fx=y),
# como las lee curl: en un grupo, la primera opción que lleva valor se queda
# con el resto del grupo, o con el argumento siguiente si no queda resto.
#
# Contesta: a una escritura, éxito; a `fields=id,name` (la consulta del
# candado), $RESPUESTA_GRAPH; a `subscribed_apps`, $SUSCRITAS_GRAPH; a lo
# demás, una lista vacía. Respeta -o (escribe ahí) y -w '%{http_code}' (200).
entrada=""; datos=""; salida=""; formato=""; tipo=LEE
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  a="${args[i]}"; sig="${args[i + 1]:-}"
  case "$a" in
    --request) [ "$sig" = GET ] || tipo=ESCRIBE ;;
    --request=*) [ "${a#--request=}" = GET ] || tipo=ESCRIBE ;;
    --data | --data-* | --json | --form | --form-* | --upload-file)
      tipo=ESCRIBE
      case "$sig" in @-) ;; @*) datos+=$(cat "${sig#@}") ;; esac ;;
    --data=* | --json=* | --form=*) tipo=ESCRIBE ;;  # --data-x=y ya entra arriba
    --output) salida="$sig" ;;
    --write-out) formato="$sig" ;;
    --*) ;;
    -?*)
      # Un grupo de opciones cortas: -s, -sS, -sXPOST, -d@cuerpo, -o archivo…
      grupo="${a#-}"
      while [ -n "$grupo" ]; do
        c="${grupo:0:1}"; resto="${grupo:1}"
        case "$c" in
          X | d | F | T | o | w | H | K | m | u | A | e | b | c | r | x | E) ;;
          *) grupo="$resto"; continue ;;
        esac
        valor="$resto"; [ -n "$valor" ] || valor="$sig"
        case "$c" in
          X) [ "$valor" = GET ] || tipo=ESCRIBE ;;
          d | F | T)
            tipo=ESCRIBE
            case "$valor" in @-) ;; @*) datos+=$(cat "${valor#@}") ;; esac ;;
          o) salida="$valor" ;;
          w) formato="$valor" ;;
        esac
        break
      done ;;
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
