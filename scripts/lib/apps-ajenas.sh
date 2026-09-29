# shellcheck shell=bash
# =============================================================================
# apps-ajenas.sh — el candado que impide escribir en Meta con una app de
# WhatsApp-Modular (CLAUDE.md, prohibiciones 5 y 7). Se carga con `source`.
#
# POR QUÉ (revisión de seguridad del PR #264). webhook-meta.sh (--alta-meta,
# --alta-waba) y verificar-meta.sh (--suscribir, --desuscribir) escriben con la
# app que traiga el .env, y el comando no la nombra: el gancho de acciones
# sensibles no la puede ver. Un .env con el id de AAB1-WA-Prod, o con un token
# emitido para esa app, reescribiría su webhook o quitaría su suscripción a una
# WABA: se caen el OTP de SeguroLoTengo y el receptor de clientes. Lo mismo
# vale para todo script que escribe en Graph con el token del .env (revisión
# del #265): registrar-numero.sh --dar-de-baja daría de baja un número de ese
# sistema; nombre-visible.sh gastaría su cupo de nombre; crear-plantilla.sh y
# plantillas-cliente.sh crearían plantillas en su WABA; enviar-prueba.sh,
# enviar-plantilla.sh y subir-qr.sh mandarían desde su número.
#
# LAS DOS CAPAS de `negar_app_ajena`, antes de cualquier escritura:
#   1. la huella sha256 del id, sin red;
#   2. el nombre que devuelve Graph, normalizado.
# Si Graph no contesta un nombre y un id, o contesta otro id que el del
# entorno, también corta: sin saber qué app es, no se escribe.
#
# SE CARGA ANTES DEL .env: al final todo queda `readonly`, y un .env que
# intente redefinir la lista o las funciones hace fallar el `source` (con
# `set -e`, el script sale sin escribir). Revisión de seguridad del #265.
# Límite honesto: cargar un .env con `source` es EJECUTARLO, y uno hostil
# puede redefinir `python3`, `exit` o el PATH. El candado cubre el .env
# equivocado (copiado de otro proyecto), no el malicioso: quien escribe el
# .env ya tiene los secretos. La solución de fondo es leerlo como datos.
# =============================================================================

# Nombres de apps de WhatsApp-Modular, por fragmento normalizado (NFKD sin
# diacríticos, casefold, solo letras y dígitos): «aab1» cubre AAB1-WA-Prod y
# cualquier otra app de AAB1; «segurolotengo», la app de demostración «Demo
# SeguroLo Tengo». Ninguna app de NovuChat se llama así (NovuChat-Demo-A,
# NovuChat-Asistente…). Los homoglifos (una A cirílica) no se cubren: para
# eso está la huella.
APPS_AJENAS_FRAGMENTOS="aab1 segurolotengo"

# sha256 del id de cada app ajena, sin el id: el repositorio es público. El id
# de una app no es un secreto (viaja en el client_id del registro insertado),
# así que la huella no esconde nada: evita publicarlo y sirve cuando Graph no
# está. Las entregó la sesión de WhatsApp-Modular el 28/09/2026 (printf %s
# "<id>" | sha256sum); la de AAB1-WA-Prod, cotejada contra su configuración
# viva. No existe otra app de Meta de ese proyecto. En grupos de 8 con «:», que
# se quitan al comparar: escrita de corrido, una huella puede traer 10 dígitos
# seguidos y verificar-saneo.sh la toma por un id de Meta (con razón).
# NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA solo puede AGREGAR huellas (la usa la
# suite, que no tiene los ids reales).
APPS_AJENAS_HUELLAS="
97340ef7:a7b04dc8:27d6875c:6ee38b49:d53d527d:13e63754:245307d5:4034ef74
120b32ec:4e3c67fb:1785a6d8:1dced2ae:481bd0df:d38136ea:f5a73091:6cfbc739
"

# sha256 del phone_number_id de cada NÚMERO de WhatsApp-Modular (revisión de
# seguridad del #277, MEDIUM). La app del token no alcanza: un .env de
# NovuChat con un token propio y el WA_PHONE_ID de un número ajeno, copiado
# por error, pasaría la capa de la app, y `registrar-numero.sh --dar-de-baja`
# le cortaría el OTP a SeguroLoTengo. Las entregó la sesión de
# WhatsApp-Modular el 29/09/2026, con el mismo formato que las de las apps:
#   1. el número del OTP de SeguroLoTengo, en uso, cotejado en vivo contra el
#      otp-service (su nombre visible es «AAB1»: la segunda capa también lo
#      corta);
#   2. el número de prueba de Meta de la Fase 0 (app de demostración), en
#      desuso, tomado de su .env local.
# No hay otros. NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA solo puede AGREGAR.
APPS_AJENAS_NUMEROS_HUELLAS="
f6deee9a:ec3542cf:4fbe734c:74e151b6:cea4b0a7:fbd04e07:99a50717:8432edbf
57f8cfb2:d8b6bd3b:c46050ca:3d8718cc:d09842cd:70f68d4b:28454469:a19d36bf
"

# huella_en <valor> <huellas…>: 0 si el sha256 del valor está entre las huellas.
huella_en() {
  local h
  h=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].strip().encode()).hexdigest())' "$1")
  # shellcheck disable=SC2086  # sin comillas a propósito: una huella por palabra
  case " $(echo $2 | tr -d :) " in *" $h "*) return 0 ;; esac
  return 1
}

# huella_ajena <app-id> y numero_ajeno <phone-number-id>: 0 si es de la lista.
huella_ajena() { huella_en "$1" "$APPS_AJENAS_HUELLAS ${NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA:-}"; }
numero_ajeno() { huella_en "$1" "$APPS_AJENAS_NUMEROS_HUELLAS ${NOVUCHAT_NUMEROS_AJENOS_HUELLAS_EXTRA:-}"; }

# El clasificador de una respuesta de Graph (sobre la entrada estándar):
# argumentos id-esperado, fragmentos y el campo del nombre («name» de una
# app, «verified_name» de un número). Imprime «propia <nombre>», «ajena
# <nombre>», «distinta <nombre>» (otro id) o «error <motivo>».
APPS_AJENAS_CLASIFICAR='
import json,re,sys,unicodedata
id_env, fragmentos, campo = sys.argv[1], sys.argv[2].split(), sys.argv[3]
try: d = json.loads(sys.stdin.read() or "{}")
except ValueError: print("error Graph no devolvió JSON"); sys.exit()
if not isinstance(d, dict): print("error Graph no devolvió un objeto"); sys.exit()
if "error" in d:
    e = d["error"]
    print("error", e.get("message", "?") if isinstance(e, dict) else e); sys.exit()
nombre = str(d.get(campo) or "")
if not nombre: print("error Graph no devolvió el nombre"); sys.exit()
# Sin id no se sabe de quién es: lo que manda es la app dueña del token, o el
# número que Graph dice que es, no lo que diga el .env.
if not d.get("id"): print("error Graph no devolvió el id"); sys.exit()
if str(d["id"]).strip() != id_env.strip(): print("distinta", nombre); sys.exit()
plano = "".join(c for c in unicodedata.normalize("NFKD", nombre) if not unicodedata.combining(c)).casefold()
plano = re.sub(r"[^a-z0-9]", "", plano)
print("ajena" if any(f in plano for f in fragmentos) else "propia", nombre)'

# negar_app_ajena <app-id> app|token|numero: sale con código 3 si la app es ajena por
# huella (antes de tocar la red) o por nombre, si Graph contestó un error o no
# trajo nombre e id, o si el id que contestó no es el del entorno. Usa G.
#   app   → GET /{app-id}?fields=id,name con el app access token APPID|SECRET
#           (WA_APP_SECRET), para lo que escribe en la app (--alta-meta)
#   token → GET /app?fields=id,name con WA_TOKEN: lo que manda en
#           /{WABA}/subscribed_apps es la app DUEÑA DEL TOKEN, no el WA_APP_ID
#           del .env. Exige también un WABA_ID con forma de id.
#   numero → igual que token, para lo que escribe en /{WA_PHONE_ID}/…
#           (registro, baja, nombre visible, mensajes, medios): exige un
#           WA_PHONE_ID con forma de id en vez del WABA_ID, y mira además el
#           NÚMERO: su huella (sin red, antes de todo) y, con la app ya
#           propia, GET /{WA_PHONE_ID}?fields=id,verified_name con WA_TOKEN,
#           que corta por los mismos fragmentos, por otro id o si Graph no
#           contesta.
# El id del destino se exige con forma de id porque va en la ruta de la URL:
# un «123/../456» escribiría en otro objeto.
# La credencial va por la entrada estándar (`-H @-`), no en los argumentos de
# curl: así no se ve en `ps` (revisión de seguridad del #265).
negar_app_ajena() {
  local id="$1" modo="$2" json v
  if ! [[ $id =~ ^[1-9][0-9]{3,20}$ ]]; then
    echo "✗ WA_APP_ID no tiene forma de id de app: se corta sin escribir" >&2; exit 3
  fi
  if ! [[ ${G:-} =~ ^https://graph\.facebook\.com/v[0-9]+\.[0-9]+$ ]]; then
    echo "✗ La URL de Graph no es la esperada (WA_GRAPH_VERSION): se corta sin escribir" >&2; exit 3
  fi
  case "$modo" in
    app) ;;
    token)
      if ! [[ ${WABA_ID:-} =~ ^[1-9][0-9]{3,20}$ ]]; then
        echo "✗ WABA_ID no tiene forma de id: se corta sin escribir" >&2; exit 3
      fi ;;
    numero)
      if ! [[ ${WA_PHONE_ID:-} =~ ^[1-9][0-9]{3,20}$ ]]; then
        echo "✗ WA_PHONE_ID no tiene forma de id: se corta sin escribir" >&2; exit 3
      fi ;;
    *) echo "✗ negar_app_ajena: modo «$modo» desconocido (app, token o numero)" >&2; exit 3 ;;
  esac
  if huella_ajena "$id"; then
    echo "✗ La app …${id: -4} es de WhatsApp-Modular (huella): NovuChat no escribe con ella (CLAUDE.md, prohibiciones 5 y 7)" >&2
    exit 3
  fi
  # El número de destino, por huella y sin red, antes de preguntar nada.
  if [ "$modo" = "numero" ] && numero_ajeno "$WA_PHONE_ID"; then
    echo "✗ El número …${WA_PHONE_ID: -4} es de WhatsApp-Modular (huella): NovuChat no escribe en él (CLAUDE.md, prohibiciones 5 y 7)" >&2
    exit 3
  fi
  if [ "$modo" != "app" ]; then
    json=$(command curl -s --max-time 30 -H @- "$G/app?fields=id,name" <<<"Authorization: Bearer ${WA_TOKEN:-}" || true)
  else
    json=$(command curl -s --max-time 30 -H @- "$G/$id?fields=id,name" <<<"Authorization: Bearer ${id}|${WA_APP_SECRET:-}" || true)
  fi
  v=$(printf '%s' "$json" | python3 -c "$APPS_AJENAS_CLASIFICAR" "$id" "$APPS_AJENAS_FRAGMENTOS" name || echo "error la respuesta de Graph no se pudo leer")
  case "$v" in
    propia\ *) echo "  app: ${v#propia } (…${id: -4})" ;;
    ajena\ *)
      echo "✗ La app «${v#ajena }» es de WhatsApp-Modular: NovuChat no escribe con ella (CLAUDE.md, prohibiciones 5 y 7)" >&2
      exit 3 ;;
    distinta\ *)
      echo "✗ El token es de la app «${v#distinta }», no de la …${id: -4} del entorno: se corta sin escribir" >&2
      exit 3 ;;
    *)
      echo "✗ No se pudo saber qué app es la …${id: -4} (${v#error }): sin eso no se escribe con ella" >&2
      exit 3 ;;
  esac
  [ "$modo" = "numero" ] || return 0
  # Segunda capa del número: su nombre visible según Graph, contra los mismos
  # fragmentos (el del OTP se llama «AAB1»). Si Graph no dice qué número es,
  # o dice otro, tampoco se escribe.
  json=$(command curl -s --max-time 30 -H @- "$G/$WA_PHONE_ID?fields=id,verified_name" <<<"Authorization: Bearer ${WA_TOKEN:-}" || true)
  v=$(printf '%s' "$json" | python3 -c "$APPS_AJENAS_CLASIFICAR" "$WA_PHONE_ID" "$APPS_AJENAS_FRAGMENTOS" verified_name || echo "error la respuesta de Graph no se pudo leer")
  case "$v" in
    propia\ *) echo "  número: ${v#propia } (…${WA_PHONE_ID: -4})" ;;
    ajena\ *)
      echo "✗ El número «${v#ajena }» es de WhatsApp-Modular: NovuChat no escribe en él (CLAUDE.md, prohibiciones 5 y 7)" >&2
      exit 3 ;;
    distinta\ *)
      echo "✗ Graph contestó otro número que el …${WA_PHONE_ID: -4} del entorno: se corta sin escribir" >&2
      exit 3 ;;
    *)
      echo "✗ No se pudo saber de quién es el número …${WA_PHONE_ID: -4} (${v#error }): sin eso no se escribe en él" >&2
      exit 3 ;;
  esac
}

# curl_token <argumentos de curl…>: curl con `Authorization: Bearer $WA_TOKEN`
# leída de la entrada estándar (`-H @-`), nunca en los argumentos: ahí la ve
# cualquier usuario de la máquina en `ps` o en /proc/<pid>/cmdline (revisión
# de seguridad del #265, LOW-B). La entrada estándar queda tomada por la
# cabecera: un cuerpo con secretos va en un archivo (`--data-binary @archivo`)
# dentro de un directorio de `mktemp -d` (700), no en `-d`.
curl_token() {
  command curl "$@" -H @- <<<"Authorization: Bearer ${WA_TOKEN:-}"
}

# `source nombre` sin «/» busca PRIMERO en el PATH (revisión de seguridad de
# los pendientes del #265): el `[ -f ]` de un script mira un archivo y el
# `source` podría cargar otro, el .env equivocado que este candado quiere
# evitar. Todo script que carga la biblioteca queda sin esa búsqueda.
shopt -u sourcepath

readonly APPS_AJENAS_FRAGMENTOS APPS_AJENAS_HUELLAS APPS_AJENAS_NUMEROS_HUELLAS APPS_AJENAS_CLASIFICAR
readonly -f huella_en huella_ajena numero_ajeno negar_app_ajena curl_token
