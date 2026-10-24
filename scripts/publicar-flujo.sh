#!/usr/bin/env bash
# Actualiza EN SU LUGAR el flujo ya publicado en n8n, usando la API publica.
# Evita el ciclo de importar: no hay que reconectar credenciales, ni reponer
# `Trigger On`, ni arriesgar que cambie la ruta del webhook.
#
# Como funciona:
#   1. lee el flujo vivo por la API (trae los bloques `credentials` y el
#      `webhookId` reales de la instancia);
#   2. los injerta sobre el JSON versionado, emparejando por NOMBRE de nodo;
#   3. escribe el resultado de vuelta en el mismo flujo.
#
# Por defecto SOLO LEE E INFORMA. Escribe unicamente con --aplicar, y antes
# guarda un respaldo del flujo vivo en Flujos/respaldo-<id>-<fecha>.local.json
#
#   ./scripts/publicar-flujo.sh              # diagnostico, no toca nada
#   ./scripts/publicar-flujo.sh --aplicar    # actualiza el flujo
#   ./scripts/publicar-flujo.sh --env .env.novuchat --reiniciar-estado [--aplicar]
#       borra el estado por telefono que guarda n8n (etapa, bienvenida, aviso)
#   ./scripts/publicar-flujo.sh --flujo Flujos/demo-b-venta-cobro.json --aplicar
#   ./scripts/publicar-flujo.sh --env .env.platinum-seguimientos --encender [--aplicar]
#       ENCIENDE (o --apagar) un flujo QUE YA EXISTE, el de N8N_WORKFLOW_ID.
#       No toca el contenido. Muestra el nombre antes de escribir, porque el id
#       sale de un .env y encender el flujo equivocado le escribe a clientes.
#   ./scripts/publicar-flujo.sh --env .env.platinum --flujo Flujos/agendamiento-senas-vencidas.json \
#       --crear [--activar] [--env-nuevo .env.platinum-senas] [--aplicar]
#       CREA un flujo nuevo (POST) tomando las credenciales POR NOMBRE de la
#       instancia y, si el nombre no existe, POR TIPO del flujo de referencia
#       (el N8N_WORKFLOW_ID de --env). Con --activar lo publica; con --env-nuevo
#       escribe un .env igual al de --env con el id nuevo, sin mostrar valores.
#       Se niega si ya hay un flujo con ese nombre (--forzar lo permite).
#
# EL FLUJO DE RUBEN (tenant rroca-ruben) TIENE UNA GUARDIA PROPIA (PR-5): con --aplicar
# se NIEGA si el archivo trae un marcador REEMPLAZAR_* o si una plantilla de aviso no
# esta APPROVED (Flujos/experimental/rroca-ruben/construir.mjs --publicable), y despues
# pide confirmacion explicita (escribir PUBLICAR RUBEN; sin terminal, solo con
# --confirmo-ruben). En seco informa lo que falta, sin abortar. La guardia estricta es del
# flujo CONVERSACIONAL («NovuChat — Venta digital de Rubén…» o rroca-ruben[.prueba][.local].json);
# cualquier otro flujo con rroca-ruben en el nombre exige solo la confirmacion. Con --crear el
# flujo vivo es la referencia de credenciales y no se evalua como destino; --encender revisa el
# flujo VIVO con la guardia. Los demas flujos no cambian.
#
# LOS FLUJOS DE LAS DOCTORAS (tenants rroca-evy y rroca-emma) TIENEN SU GUARDIA: con --aplicar
# (y con ello --crear o --encender) se NIEGAN si `Flujos/experimental/doctoras/construir.mjs
# --publicable --tenant <t>` no aprueba el archivo Y el flujo VIVO de destino, y piden
# confirmacion explicita (escribir PUBLICAR DOCTORAS; sin terminal, solo con --confirmo-doctoras).
# --forzar no salta nada de esto; --apagar nunca pide confirmacion.
#
# EL FLUJO NUEVO DE EVY (tenant rroca-evy, Flujos/experimental/rroca-evy/) TIENE SU GUARDIA, ADITIVA: se reconoce por su CONTENIDO (un nodo «Armar previos»), no por el nombre, porque conserva
# el nombre y el id vivo del flujo viejo de las doctoras. Con --aplicar (y con ello --crear o --encender) se NIEGA si `Flujos/experimental/rroca-evy/construir.mjs --publicable` no aprueba el
# archivo (o el flujo VIVO al encenderlo) y pide escribir PUBLICAR EVY (o --confirmo-evy sin terminal). `--etapa-prueba` pide la etapa prueba. El flujo viejo de Evy y el de Emma siguen
# con la guardia de las doctoras, sin cambios.
#
# EL ARCHIVO Y EL FLUJO VIVO TIENEN QUE SER EL MISMO FLUJO, y el script lo
# comprueba por el nombre antes de escribir: el id sale de `--env` y el archivo
# de `--flujo`, que son dos fuentes distintas. Cada demo tiene su propio env:
#   Demo A          -> .env             (el que se usa por defecto)
#   Demo B          -> .env.demo-b
#   Recordatorios   -> .env.recordatorios
#
# N8N_API_KEY es una credencial de ADMINISTRACION de toda la instancia: quien
# la tenga puede leer y modificar cualquier flujo, incluidos los ajenos. Vive
# solo en .env (ignorado, chmod 600) y en el gestor de contrasenas.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

FLUJO="Flujos/demo-a-agendamiento.json"
APLICAR=0
FORZAR=0
REINICIAR=0
CREAR=0
ACTIVAR=0
ENCENDER=0
APAGAR=0
ENV_NUEVO=""
ENV_FILE=".env"
CONFIRMO_RUBEN=0
CONFIRMO_ANTONIO=0
CONFIRMO_DOCTORAS=0
CONFIRMO_EVY=0
ETAPA_PRUEBA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --flujo)   FLUJO="${2:?--flujo necesita un archivo}"; shift 2 ;;
    --flujo=*) FLUJO="${1#*=}"; shift ;;
    --aplicar) APLICAR=1; shift ;;
    --reiniciar-estado) REINICIAR=1; shift ;;
    --crear)   CREAR=1; shift ;;
    --activar) ACTIVAR=1; shift ;;
    --encender) ENCENDER=1; shift ;;
    --apagar)   ENCENDER=0; APAGAR=1; shift ;;
    --env-nuevo) ENV_NUEVO="${2:?--env-nuevo necesita una ruta}"; shift 2 ;;
    --env-nuevo=*) ENV_NUEVO="${1#*=}"; shift ;;
    --forzar)  FORZAR=1; shift ;;
    --confirmo-ruben) CONFIRMO_RUBEN=1; shift ;;
    --confirmo-antonio) CONFIRMO_ANTONIO=1; shift ;;
    --confirmo-doctoras) CONFIRMO_DOCTORAS=1; shift ;;
    --confirmo-evy) CONFIRMO_EVY=1; shift ;;
    --etapa-prueba) ETAPA_PRUEBA=1; shift ;;
    --env)     ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*)   ENV_FILE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

if [[ $ETAPA_PRUEBA -eq 1 && ( $CREAR -eq 1 || $ACTIVAR -eq 1 || $APAGAR -eq 1 ) ]]; then
  echo "✗ --etapa-prueba va con --encender o con la actualización en su lugar (--aplicar), nunca con --crear, --activar ni --apagar." >&2; exit 2
fi

# Si existe el archivo preparado (con los valores reales ya puestos por
# preparar-import.sh), se usa ESE y no el versionado. Empujar el versionado
# escribiria los marcadores REEMPLAZAR_* encima de la configuracion real.
PREPARADO="${FLUJO%.json}.local.json"
if [[ "$FLUJO" != *.local.json && -f "$PREPARADO" ]]; then
  echo "Usando el archivo preparado en lugar del versionado:"
  echo "  $PREPARADO"
  echo
  FLUJO="$PREPARADO"
fi

# --- LA GUARDIA DEL FLUJO DE RUBEN (tenant rroca-ruben, PR-5) ------------------
# Se reconoce por el nombre del archivo o por el nombre del flujo de ORIGEN, sin
# distinguir mayusculas, antes de leer el .env y de hablar con n8n; y se REPITE
# despues de leer el flujo VIVO (destino): si el vivo es el de Ruben, la guardia
# y la confirmacion valen aunque el archivo se llame de otra forma, con --forzar
# o con --env. El JSON versionado lleva marcadores REEMPLAZAR_* y las plantillas
# de aviso en PENDING: publicarlo asi deja el aviso a Rubén sin salir fuera de su
# ventana, o la entrada del receptor con una ruta falsa.
# `--apagar` no escribe contenido y es seguro: nunca pide confirmacion.
ruben_guardia() {  # $1 = motivo (texto), $2 = JSON a revisar, $3 = estricto | confirmar
  if [[ "$3" != "estricto" ]]; then
    # Otro flujo del tenant (p. ej. el de rescate): no lleva la Config base con las plantillas,
    # asi que `--publicable` no aplica; solo se exige la confirmacion.
    echo "Flujo del tenant rroca-ruben que no es el conversacional ($1): solo se pide la confirmacion."
    if [[ $APLICAR -eq 1 ]]; then ruben_confirmar; fi
    return 0
  fi
  echo "Flujo de Rubén (rroca-ruben): se revisa la guardia de publicación ($1)."
  if node Flujos/experimental/rroca-ruben/construir.mjs --publicable --flujo "$2"; then
    GUARDIA_OK=1
  else
    GUARDIA_OK=0
  fi
  if [[ $APLICAR -eq 1 ]]; then
    if [[ $GUARDIA_OK -ne 1 ]]; then
      printf '\033[1;31m✗ NEGADO: el flujo de Rubén no se publica con marcadores sin sustituir ni con plantillas sin aprobar.\033[0m\n' >&2
      exit 1
    fi
    ruben_confirmar
  elif [[ $GUARDIA_OK -ne 1 ]]; then
    printf '\033[0;33m  (en seco se sigue; con --aplicar se niega)\033[0m\n\n'
  fi
}
# Clasifica un flujo del tenant: vacio (no es de Ruben) | confirmar (cualquier flujo con rroca-ruben
# en el nombre del archivo o del flujo) | estricto (el CONVERSACIONAL: el que genera construir.mjs,
# «NovuChat — Venta digital de Rubén (rroca-ruben…)», o sus archivos rroca-ruben[.prueba][.local].json).
ruben_clase() {  # $1 = archivo JSON ; $2 = nombre del archivo en minusculas
  python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, re, sys
ruta, base = sys.argv[1], sys.argv[2]
try:
    nombre = str(json.load(open(ruta, encoding="utf-8")).get("name", "")).lower()
except Exception:
    nombre = ""
if re.fullmatch(r"rroca-ruben(\.prueba)?(\.local)?\.json", base) or nombre.startswith("novuchat — venta digital de rub"):
    print("estricto")
elif base.startswith("rroca-ruben") or "rroca-ruben" in nombre:
    print("confirmar")
PY
}
ruben_confirmar() {
  if [[ $CONFIRMO_RUBEN -ne 1 ]]; then
    if [[ -t 0 ]]; then
      read -r -p "Va a escribir el flujo de Rubén en n8n. Escriba PUBLICAR RUBEN para confirmar: " RESPUESTA
      [[ "$RESPUESTA" == "PUBLICAR RUBEN" ]] || { echo "✗ Sin confirmación: no se publica." >&2; exit 1; }
    else
      echo "✗ NEGADO: sin terminal, el flujo de Rubén solo se publica con --confirmo-ruben." >&2
      exit 1
    fi
  fi
}
ES_RUBEN=0
if [[ $ENCENDER -eq 0 && $APAGAR -eq 0 && -f "$FLUJO" ]]; then
  CLASE_RUBEN="$(ruben_clase "$FLUJO" "$(basename "$FLUJO" | tr '[:upper:]' '[:lower:]')")"
  if [[ -n "$CLASE_RUBEN" ]]; then
    ES_RUBEN=1
    ruben_guardia "archivo de origen" "$FLUJO" "$CLASE_RUBEN"
  fi
fi

# --- LA GUARDIA DEL FLUJO DE ANTONIO (tenant rroca-antonio, PR-C) --------------
# Mismo diseno que la de Ruben, y aparte: no cambia nada para los demas flujos. Se
# reconoce por el nombre del archivo o del flujo de ORIGEN que contenga rroca-antonio
# (sin distinguir mayusculas) y se REPITE sobre el flujo VIVO (destino). Con --aplicar,
# --crear o --encender exige (1) que `construir.mjs --publicable` apruebe el flujo (sin
# marcadores REEMPLAZAR_*, plantillas de aviso APPROVED y catalogo
# cargados) y (2) la confirmacion explicita: escribir PUBLICAR ANTONIO, o --confirmo-antonio
# sin terminal. --forzar NO salta nada de esto. `--apagar` nunca pide confirmacion.
antonio_guardia() {  # $1 = motivo (texto), $2 = JSON a revisar, $3 = estricto | confirmar
  if [[ "$3" != "estricto" ]]; then
    echo "Flujo del tenant rroca-antonio que no es el conversacional ($1): solo se pide la confirmacion."
    if [[ $APLICAR -eq 1 ]]; then antonio_confirmar; fi
    return 0
  fi
  echo "Flujo de Antonio (rroca-antonio): se revisa la guardia de publicación ($1)."
  if node Flujos/experimental/rroca-antonio/construir.mjs --publicable --flujo "$2"; then
    GUARDIA_ANTONIO_OK=1
  else
    GUARDIA_ANTONIO_OK=0
  fi
  if [[ $APLICAR -eq 1 ]]; then
    if [[ $GUARDIA_ANTONIO_OK -ne 1 ]]; then
      printf '\033[1;31m✗ NEGADO: el flujo de Antonio no se publica con marcadores sin sustituir, plantillas sin aprobar o con el catálogo sin cargar.\033[0m\n' >&2
      exit 1
    fi
    antonio_confirmar
  elif [[ $GUARDIA_ANTONIO_OK -ne 1 ]]; then
    printf '\033[0;33m  (en seco se sigue; con --aplicar se niega)\033[0m\n\n'
  fi
}
# vacio (no es de Antonio) | confirmar (cualquier flujo con rroca-antonio en el nombre del archivo o
# del flujo) | estricto (el CONVERSACIONAL: «NovuChat — El Puente de Antonio (rroca-antonio…)» o sus
# archivos rroca-antonio[.prueba][.local].json).
antonio_clase() {  # $1 = archivo JSON ; $2 = nombre del archivo en minusculas
  python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, re, sys
ruta, base = sys.argv[1], sys.argv[2]
try:
    nombre = str(json.load(open(ruta, encoding="utf-8")).get("name", "")).lower()
except Exception:
    nombre = ""
if re.fullmatch(r"rroca-antonio(\.prueba)?(\.local)?\.json", base) or nombre.startswith("novuchat — el puente de antonio"):
    print("estricto")
elif "rroca-antonio" in base or "rroca-antonio" in nombre:
    print("confirmar")
PY
}
antonio_confirmar() {
  if [[ $CONFIRMO_ANTONIO -ne 1 ]]; then
    if [[ -t 0 ]]; then
      read -r -p "Va a escribir el flujo de Antonio en n8n. Escriba PUBLICAR ANTONIO para confirmar: " RESPUESTA
      [[ "$RESPUESTA" == "PUBLICAR ANTONIO" ]] || { echo "✗ Sin confirmación: no se publica." >&2; exit 1; }
    else
      echo "✗ NEGADO: sin terminal, el flujo de Antonio solo se publica con --confirmo-antonio." >&2
      exit 1
    fi
  fi
}
ES_ANTONIO=0
if [[ $ENCENDER -eq 0 && $APAGAR -eq 0 && -f "$FLUJO" ]]; then
  CLASE_ANTONIO="$(antonio_clase "$FLUJO" "$(basename "$FLUJO" | tr '[:upper:]' '[:lower:]')")"
  if [[ -n "$CLASE_ANTONIO" ]]; then
    ES_ANTONIO=1
    antonio_guardia "archivo de origen" "$FLUJO" "$CLASE_ANTONIO"
  fi
fi

# --- LA GUARDIA DE LOS FLUJOS DE LAS DOCTORAS (tenants rroca-evy y rroca-emma) -----
# Mismo diseno que la de Antonio, y aparte: no cambia nada para los demas flujos. Se
# reconoce por el nombre del archivo o del flujo de ORIGEN que contenga rroca-evy o
# rroca-emma (sin distinguir mayusculas) y se REPITE sobre el flujo VIVO (destino). Con
# --aplicar (y con ello --crear o --encender) exige (1) que
# `Flujos/experimental/doctoras/construir.mjs --publicable --tenant <t> --flujo <json>`
# apruebe el flujo (sin marcadores REEMPLAZAR_*, plantilla de aviso APPROVED, horario
# confirmado, y que el flujo sea el de ESA doctora) y (2) la confirmacion explicita: escribir
# PUBLICAR DOCTORAS, o --confirmo-doctoras sin terminal. --forzar NO salta nada de esto.
# `--apagar` nunca pide confirmacion. Si el nombre menciona a las dos doctoras, se NIEGA.
# ETAPA PRUEBA: `--etapa-prueba` (con --encender o con la actualización en su lugar --aplicar) usa la etapa `prueba` EN TODOS los casos: archivo de origen, flujo vivo de destino y encendido
# (etapaPrueba = si, solo teléfonos de prueba, recepción dentro de ellos). Sin `--etapa-prueba` rige la completa, que RECHAZA etapaPrueba = si. Con --crear, --activar o --apagar se NIEGA (2).
# ETAPA: `--crear` SIN `--activar` usa `--etapa crear` (tolera plantilla sin APPROVED y horario pendiente);
# --encender, --aplicar sobre un flujo activo y --crear --activar usan la completa, salvo con --etapa-prueba.
doctoras_guardia() {  # $1 = motivo (texto), $2 = JSON a revisar, $3 = tenant (rroca-evy | rroca-emma | ambos)
  # Etapa `crear`: SOLO al crear un flujo INACTIVO (--crear sin --activar ni --encender); todo lo demás exige la etapa completa (o la `prueba`, con --etapa-prueba).
  local etapa=encender
  [[ $CREAR -eq 1 && $ACTIVAR -eq 0 && $ENCENDER -eq 0 ]] && etapa=crear
  [[ $ETAPA_PRUEBA -eq 1 ]] && etapa=prueba
  echo "Flujo de las doctoras ($3): se revisa la guardia de publicación ($1; etapa $etapa)."
  if [[ "$3" == "rroca-evy" || "$3" == "rroca-emma" ]] \
     && node Flujos/experimental/doctoras/construir.mjs --publicable --tenant "$3" --flujo "$2" --etapa "$etapa"; then
    GUARDIA_DOCTORAS_OK=1
  else
    GUARDIA_DOCTORAS_OK=0
  fi
  if [[ $APLICAR -eq 1 ]]; then
    if [[ $GUARDIA_DOCTORAS_OK -ne 1 ]]; then
      printf '\033[1;31m✗ NEGADO: el flujo de las doctoras no se publica con marcadores sin sustituir, plantillas sin aprobar, horario sin confirmar o con los datos de otra doctora.\033[0m\n' >&2
      exit 1
    fi
    doctoras_confirmar
  elif [[ $GUARDIA_DOCTORAS_OK -ne 1 ]]; then
    printf '\033[0;33m  (en seco se sigue; con --aplicar se niega)\033[0m\n\n'
  fi
}
# Imprime el tenant (rroca-evy | rroca-emma), "ambos" o nada (no es de las doctoras).
doctoras_clase() {  # $1 = archivo JSON ; $2 = nombre del archivo en minusculas
  python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, sys
ruta, base = sys.argv[1], sys.argv[2]
try:
    datos = json.load(open(ruta, encoding="utf-8"))
    nombre = str(datos.get("name", "")).lower()
    # El flujo NUEVO de Evy (nodo «Armar previos») tiene su propia guardia: la de las doctoras no lo reclama.
    if any(isinstance(n, dict) and n.get("name") == "Armar previos" for n in (datos.get("nodes") or [])):
        sys.exit(0)
except SystemExit:
    raise
except Exception:
    nombre = ""
t = [x for x in ("rroca-evy", "rroca-emma") if x in base or x in nombre]
if len(t) == 1:
    print(t[0])
elif len(t) == 2:
    print("ambos")
PY
}
doctoras_confirmar() {
  if [[ $CONFIRMO_DOCTORAS -ne 1 ]]; then
    if [[ -t 0 ]]; then
      read -r -p "Va a escribir un flujo de las doctoras en n8n. Escriba PUBLICAR DOCTORAS para confirmar: " RESPUESTA
      [[ "$RESPUESTA" == "PUBLICAR DOCTORAS" ]] || { echo "✗ Sin confirmación: no se publica." >&2; exit 1; }
    else
      echo "✗ NEGADO: sin terminal, los flujos de las doctoras solo se publican con --confirmo-doctoras." >&2
      exit 1
    fi
  fi
}
TENANT_DOCTORAS=""
if [[ $ENCENDER -eq 0 && $APAGAR -eq 0 && -f "$FLUJO" ]]; then
  TENANT_DOCTORAS="$(doctoras_clase "$FLUJO" "$(basename "$FLUJO" | tr '[:upper:]' '[:lower:]')")"
  if [[ -n "$TENANT_DOCTORAS" ]]; then
    doctoras_guardia "archivo de origen" "$FLUJO" "$TENANT_DOCTORAS"
  fi
fi

# --- LA GUARDIA DEL FLUJO NUEVO DE EVY (tenant rroca-evy, Flujos/experimental/rroca-evy/) ---
# Aditiva: no cambia nada para los demas flujos. Se reconoce por el CONTENIDO (un nodo «Armar previos») y no por el nombre. Con --aplicar (y con ello --crear o --encender) exige que
# `Flujos/experimental/rroca-evy/construir.mjs --publicable --flujo <json> --etapa <e>` apruebe el flujo, y la confirmacion explicita (PUBLICAR EVY, o --confirmo-evy sin terminal).
# --forzar NO salta nada de esto; `--apagar` nunca pide confirmacion. Etapas: `crear` (--crear sin --activar ni --encender), `prueba` (--etapa-prueba) y `encender` (la completa).
evy_guardia() {  # $1 = motivo (texto), $2 = JSON a revisar
  local etapa=encender
  [[ $CREAR -eq 1 && $ACTIVAR -eq 0 && $ENCENDER -eq 0 ]] && etapa=crear
  [[ $ETAPA_PRUEBA -eq 1 ]] && etapa=prueba
  echo "Flujo nuevo de Evy (rroca-evy): se revisa la guardia de publicación ($1; etapa $etapa)."
  if node Flujos/experimental/rroca-evy/construir.mjs --publicable --flujo "$2" --etapa "$etapa"; then
    GUARDIA_EVY_OK=1
  else
    GUARDIA_EVY_OK=0
  fi
  if [[ $APLICAR -eq 1 ]]; then
    if [[ $GUARDIA_EVY_OK -ne 1 ]]; then
      printf '\033[1;31m✗ NEGADO: el flujo de Evy no se publica con marcadores sin sustituir, ids de imagen sin resolver, plantilla sin aprobar (etapa completa) o la etapa de prueba mal armada.\033[0m\n' >&2
      exit 1
    fi
    evy_confirmar
  elif [[ $GUARDIA_EVY_OK -ne 1 ]]; then
    printf '\033[0;33m  (en seco se sigue; con --aplicar se niega)\033[0m\n\n'
  fi
}
# Imprime "nuevo" si el JSON es el flujo nuevo de Evy: basta el nodo «Armar previos» (el MISMO predicado con que `doctoras_clase` lo suelta: un archivo RENOMBRADO no se escapa de las dos guardias).
# Imprime "emma" si, además, el nombre del archivo o del flujo dice rroca-emma: el flujo nuevo es solo de Evy y se NIEGA para otra doctora.
evy_clase() {  # $1 = archivo JSON ; $2 = nombre del archivo en minusculas
  python3 - "$1" "$2" <<'PY' 2>/dev/null || true
import json, sys
ruta, base = sys.argv[1], sys.argv[2]
try:
    datos = json.load(open(ruta, encoding="utf-8"))
except Exception:
    sys.exit(0)
nombre = str(datos.get("name", "")).lower()
nodos = datos.get("nodes") or []
if any(isinstance(n, dict) and n.get("name") == "Armar previos" for n in nodos):
    print("emma" if ("rroca-emma" in base or "rroca-emma" in nombre) else "nuevo")
PY
}
evy_confirmar() {
  if [[ $CONFIRMO_EVY -ne 1 ]]; then
    if [[ -t 0 ]]; then
      read -r -p "Va a escribir el flujo de Evy en n8n. Escriba PUBLICAR EVY para confirmar: " RESPUESTA
      [[ "$RESPUESTA" == "PUBLICAR EVY" ]] || { echo "✗ Sin confirmación: no se publica." >&2; exit 1; }
    else
      echo "✗ NEGADO: sin terminal, el flujo de Evy solo se publica con --confirmo-evy." >&2
      exit 1
    fi
  fi
}
ES_EVY_NUEVO=0
if [[ $ENCENDER -eq 0 && $APAGAR -eq 0 && -f "$FLUJO" ]]; then
  CLASE_EVY="$(evy_clase "$FLUJO" "$(basename "$FLUJO" | tr '[:upper:]' '[:lower:]')")"
  if [[ "$CLASE_EVY" == "emma" ]]; then
    printf '\033[1;31m✗ NEGADO: el flujo nuevo de Evy (nodo «Armar previos») no se publica con el nombre de otra doctora (rroca-emma).\033[0m\n' >&2
    exit 1
  elif [[ -n "$CLASE_EVY" ]]; then
    ES_EVY_NUEVO=1
    evy_guardia "archivo de origen" "$FLUJO"
  fi
fi

[[ -f "$ENV_FILE" ]] || { echo "✗ Falta $ENV_FILE"; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
. "./$ENV_FILE"
set +a
: "${N8N_API_KEY:?Falta N8N_API_KEY en .env (n8n: Settings -> n8n API)}"
: "${N8N_WORKFLOW_ID:?Falta N8N_WORKFLOW_ID en .env (esta en la URL del editor)}"
: "${N8N_BASE_URL:?Falta N8N_BASE_URL en .env}"
[[ -f "$FLUJO" ]] || { echo "✗ No existe $FLUJO"; exit 1; }

API="${N8N_BASE_URL%/}/api/v1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- 1. leer el flujo vivo ----------------------------------------------------
COD=$(curl -s --max-time 30 -o "$TMP/vivo.json" -w '%{http_code}' \
      -H @- "${API}/workflows/${N8N_WORKFLOW_ID}" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)

if [[ "$COD" != "200" ]]; then
  printf '\033[1;31m✗ No se pudo leer el flujo: HTTP %s\033[0m\n' "$COD"
  case "$COD" in
    401) echo "   La clave de API no es valida o caduco." ;;
    404) echo "   Ese N8N_WORKFLOW_ID no existe. Reviselo en la URL del editor." ;;
    000) echo "   No hubo respuesta: revise N8N_BASE_URL y la conectividad." ;;
  esac
  head -c 300 "$TMP/vivo.json" 2>/dev/null || true
  exit 1
fi

# --- la guardia, repetida sobre el flujo VIVO (destino) ------------------------
# El nombre del archivo de origen no prueba nada sobre el destino: el id sale de
# N8N_WORKFLOW_ID. Si el flujo vivo es el de Rubén, se exige lo mismo que arriba.
CLASE_VIVO="$(ruben_clase "$TMP/vivo.json" "")"
if [[ -n "$CLASE_VIVO" ]]; then
  if [[ $ENCENDER -eq 1 ]]; then
    # Activar = publicar: se revisa el flujo VIVO con la guardia (si es el conversacional) y despues
    # pide la confirmacion (no hay contenido nuevo que revisar).
    ruben_guardia "encender el flujo vivo" "$TMP/vivo.json" "$CLASE_VIVO"
  elif [[ $APAGAR -eq 0 && $ES_RUBEN -eq 0 && $CREAR -eq 0 ]]; then
    # Con --crear `vivo.json` es la REFERENCIA de credenciales, no el destino: no se evalua.
    ES_RUBEN=1
    ruben_guardia "flujo vivo de destino" "$FLUJO" "$CLASE_VIVO"
  fi
fi

CLASE_VIVO_ANTONIO="$(antonio_clase "$TMP/vivo.json" "")"
if [[ -n "$CLASE_VIVO_ANTONIO" ]]; then
  if [[ $ENCENDER -eq 1 ]]; then
    antonio_guardia "encender el flujo vivo" "$TMP/vivo.json" "$CLASE_VIVO_ANTONIO"
  # Si el destino vivo es el estricto y el origen no lo era (p. ej. un archivo «confirmar» con --forzar), la guardia estricta se vuelve a correr.
  elif [[ $APAGAR -eq 0 && $CREAR -eq 0 && ( $ES_ANTONIO -eq 0 || ( "$CLASE_VIVO_ANTONIO" == estricto && "${CLASE_ANTONIO:-}" != estricto ) ) ]]; then
    ES_ANTONIO=1
    antonio_guardia "flujo vivo de destino" "$FLUJO" "$CLASE_VIVO_ANTONIO"
  fi
fi

TENANT_VIVO_DOCTORAS="$(doctoras_clase "$TMP/vivo.json" "")"
if [[ -n "$TENANT_VIVO_DOCTORAS" ]]; then
  if [[ $ENCENDER -eq 1 ]]; then
    doctoras_guardia "encender el flujo vivo" "$TMP/vivo.json" "$TENANT_VIVO_DOCTORAS"
  # Con --crear `vivo.json` es la REFERENCIA de credenciales, no el destino. Si el destino vivo es de una doctora y el origen no lo era (o era la otra), la guardia se corre con el tenant del VIVO.
  # Si el origen es el flujo NUEVO de Evy, el destino viejo (el de las doctoras) lo reemplaza: ya pasó la guardia nueva y la de las doctoras no se aplica al archivo nuevo.
  elif [[ $APAGAR -eq 0 && $CREAR -eq 0 && $ES_EVY_NUEVO -eq 0 && "$TENANT_VIVO_DOCTORAS" != "$TENANT_DOCTORAS" ]]; then
    doctoras_guardia "flujo vivo de destino" "$FLUJO" "$TENANT_VIVO_DOCTORAS"
  fi
fi

# El flujo NUEVO de Evy solo reemplaza al flujo vivo de Evy (el nuevo o el viejo), NUNCA a otro: ni a Emma (aunque la renombren), ni a otro cliente (Q'Taco, el chat de NovuChat, Bellido), ni con --forzar.
if [[ $ES_EVY_NUEVO -eq 1 && $CREAR -eq 0 && $APAGAR -eq 0 ]]; then
  CLASE_VIVO_PARA_NUEVO="$(evy_clase "$TMP/vivo.json" "")"
  if [[ "$CLASE_VIVO_PARA_NUEVO" != "nuevo" && "$CLASE_VIVO_PARA_NUEVO" != "emma" && "$TENANT_VIVO_DOCTORAS" != "rroca-evy" ]]; then
    printf '\033[1;31m✗ NEGADO: el flujo nuevo de Evy no puede reemplazar un flujo vivo que no es de Evy (vivo: %s). Ni con --forzar.\033[0m\n' "${TENANT_VIVO_DOCTORAS:-otro cliente}" >&2
    exit 1
  fi
fi

# El flujo VIVO es el nuevo de Evy: encenderlo revisa el flujo vivo con la guardia nueva; reemplazarlo con un archivo que NO es el nuevo (p. ej. restaurar el viejo) pide la confirmacion.
CLASE_VIVO_EVY="$(evy_clase "$TMP/vivo.json" "")"
if [[ "$CLASE_VIVO_EVY" == "emma" && $APAGAR -eq 0 ]]; then
  printf '\033[1;31m✗ NEGADO: el flujo vivo es el flujo nuevo de Evy con el nombre de otra doctora (rroca-emma).\033[0m\n' >&2
  exit 1
fi
if [[ -n "$CLASE_VIVO_EVY" ]]; then
  if [[ $ENCENDER -eq 1 ]]; then
    evy_guardia "encender el flujo vivo" "$TMP/vivo.json"
  elif [[ $APAGAR -eq 0 && $CREAR -eq 0 && $ES_EVY_NUEVO -eq 0 && $APLICAR -eq 1 ]]; then
    echo "El flujo vivo es el flujo NUEVO de Evy y el archivo no lo es (restauración): se pide la confirmación."
    evy_confirmar
  fi
fi

# --- ENCENDER O APAGAR UN FLUJO QUE YA EXISTE ---------------------------------
# `--activar` solo servia al CREAR: un flujo ya creado y apagado no se podia
# encender desde aca, y habia que hacerlo a mano en la interfaz. Eso contradice
# «Andres autoriza, Claude opera» (CLAUDE.md) y, peor, deja un paso de
# produccion sin registro. Esto es ese paso, con el nombre a la vista para que
# nadie encienda el flujo equivocado.
if [[ $ENCENDER -eq 1 || $APAGAR -eq 1 ]]; then
  # La ruta de la API es en INGLES (`activate` / `deactivate`); el verbo en
  # castellano es solo para el mensaje. Ponerlo en la URL da un 405 confuso.
  RUTA=$([[ $APAGAR -eq 1 ]] && echo deactivate || echo activate)
  QUE=$([[ $APAGAR -eq 1 ]] && echo apagar || echo encender)
  NOMBRE=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('name',''))" "$TMP/vivo.json")
  ESTABA=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('active'))" "$TMP/vivo.json")
  echo
  echo "  Flujo  : $NOMBRE"
  echo "  Estado : activo=$ESTABA  ->  $([[ $APAGAR -eq 1 ]] && echo False || echo True)"
  echo
  if [[ $APLICAR -eq 0 ]]; then
    printf '\033[0;90m  Seco: no se escribio nada. Agregue --aplicar.\033[0m\n\n'
    exit 0
  fi
  COD=$(curl -s --max-time 30 -o "$TMP/estado.json" -w '%{http_code}' -X POST \
        -H @- "${API}/workflows/${N8N_WORKFLOW_ID}/${RUTA}" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)
  if [[ "$COD" != "200" ]]; then
    printf '\033[1;31m✗ HTTP %s al %s el flujo\033[0m\n' "$COD" "$QUE"
    head -c 300 "$TMP/estado.json" 2>/dev/null || true
    exit 1
  fi
  AHORA=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('active'))" "$TMP/estado.json")
  printf '\033[1;32m✓ %s: activo=%s\033[0m\n\n' "$NOMBRE" "$AHORA"
  exit 0
fi

# --- 1b. las credenciales de la instancia: nombre, tipo e id, nunca valores ----
# Sirven para asignar a cada nodo la credencial que el JSON versionado NOMBRA.
# Si la API no las lista, se sigue como antes (heredando del flujo vivo).
# El codigo HTTP se guarda: con --aplicar, una lista que no llego (403, 5xx) o
# que llego partida (nextCursor) no es base para decidir credenciales.
CRED_COD=$(curl -s --max-time 30 -o "$TMP/credenciales.json" -w '%{http_code}' \
     -H @- "${API}/credentials?limit=250" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)

# --- crear un flujo NUEVO ------------------------------------------------------
# Hasta el 17/09/2026 un flujo nuevo solo entraba por la interfaz: importar el
# archivo, conectar las credenciales a mano y publicar. Eso es una persona
# operando, que es justo lo que este proyecto no quiere (CLAUDE.md, «Andres
# autoriza; Claude opera»), y ademas es donde n8n asigno sola la credencial de
# ingesta a los nodos de Meta el 15/09. Aca el flujo se crea por la API con las
# credenciales resueltas igual que al actualizar: por NOMBRE (lo que el JSON
# versionado nombra, con id vacio) y, si ese nombre no existe, por TIPO desde
# el flujo de referencia de --env (el conversacional del mismo cliente), que
# ya tiene conectadas las de Meta, Google y la ingesta de ese comercio.
#
# Los flujos programados de un cliente (senas vencidas, seguimientos) nacen
# asi: mismo --env que su flujo conversacional, --crear, y --env-nuevo para
# dejar escrito el id nuevo en un .env propio, con el que despues se actualizan
# con el camino normal del script.
if [[ $CREAR -eq 1 ]]; then
  curl -s --max-time 30 -o "$TMP/lista.json" \
       -H @- "${API}/workflows?limit=250" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || true
  APLICAR="$APLICAR" FORZAR="$FORZAR" FLUJO="$FLUJO" TMP="$TMP" CRED_COD="$CRED_COD" python3 - <<'PY'
import json, os, re, sys
aplicar = os.environ["APLICAR"] == "1"
forzar  = os.environ["FORZAR"] == "1"
tmp, flujo = os.environ["TMP"], os.environ["FLUJO"]
V, R, G, A, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[1;33m", "\033[0m"

referencia = json.load(open(f"{tmp}/vivo.json", encoding="utf-8"))
nuevo = json.load(open(flujo, encoding="utf-8"))
print(f"Referencia : {referencia.get('name')}   nodos: {len(referencia.get('nodes', []))}")
print(f"Nuevo      : {nuevo.get('name')}   ({flujo}, nodos: {len(nuevo['nodes'])})\n")

# El nombre tiene que ser unico en la instancia: dos flujos con el mismo nombre
# es exactamente lo que el cerrojo de la actualizacion no puede distinguir.
try:
    lista = json.load(open(f"{tmp}/lista.json", encoding="utf-8")).get("data") or []
except Exception:
    lista = []
repetidos = [w for w in lista if w.get("name") == nuevo.get("name")]
if repetidos and not forzar:
    print(f"{R}✗ Ya existe un flujo llamado «{nuevo.get('name')}» (id {repetidos[0].get('id')}).{FIN}")
    print("  Para actualizarlo use el camino normal con su .env; --forzar crea otro igual.")
    sys.exit(1)

# Por TIPO se rellena solo si la referencia tiene UNA credencial de ese tipo
# (por id distinto); con varias, elegir la primera sin avisar podria dar la de
# otro negocio, como en --aplicar.
cred_por_tipo, tipos_varios = {}, {}
for v in referencia.get("nodes", []):
    for tipo, ref in (v.get("credentials") or {}).items():
        if ref.get("id"):
            tipos_varios.setdefault(tipo, {})[ref["id"]] = ref
for tipo, por_id in tipos_varios.items():
    if len(por_id) == 1:
        cred_por_tipo[tipo] = next(iter(por_id.values()))
lista_llego = True
try:
    crudo_cred = json.load(open(f"{tmp}/credenciales.json", encoding="utf-8"))
    lista_cred = crudo_cred.get("data") or []
    hay_mas = bool(crudo_cred.get("nextCursor"))
    lista_llego = isinstance(crudo_cred.get("data"), list)
except Exception:
    lista_cred, hay_mas, lista_llego = [], False, False
if os.environ.get("CRED_COD") != "200":
    lista_llego = False
if not aplicar and not lista_llego:
    print(f"  {A}!{FIN} con --aplicar se abortaria: n8n no entrego la lista de credenciales (HTTP {os.environ.get('CRED_COD')}); no se decide por TIPO sin ella.")
if not aplicar and hay_mas:
    print(f"  {A}!{FIN} con --aplicar se abortaria: hay mas de 250 credenciales y la lista llego partida.")
if aplicar and not lista_llego:
    print(f"{R}✗ ABORTADO: n8n no entrego la lista de credenciales (HTTP {os.environ.get('CRED_COD')}); no se decide por TIPO sin ella.{FIN}")
    sys.exit(1)
if aplicar and hay_mas:
    print(f"{R}✗ ABORTADO: hay mas de 250 credenciales y la lista llego partida; no se decide con una lista parcial.{FIN}")
    sys.exit(1)
indice = {}
for c in lista_cred:
    indice.setdefault((c.get("type"), c.get("name")), []).append(c)

por_nombre, por_tipo, faltantes, ambiguas, ambiguas_tipo = [], [], [], [], []
for n in nuevo["nodes"]:
    for tipo, ref in list((n.get("credentials") or {}).items()):
        nombre = (ref or {}).get("name") or ""
        halladas = indice.get((tipo, nombre), []) if nombre else []
        if len(halladas) == 1:
            n["credentials"][tipo] = {"id": halladas[0]["id"], "name": nombre}
            por_nombre.append((n["name"], nombre))
        elif len(halladas) > 1:
            # Dos credenciales con el mismo nombre y tipo: no hay forma de saber
            # cual es la del negocio, y rellenar por TIPO tomaria la de otro.
            ambiguas.append((n["name"], nombre, len(halladas)))
        elif nombre:
            # Un nombre declarado que no existe es un faltante: el relleno por
            # TIPO es solo para referencias SIN nombre.
            faltantes.append((n["name"], tipo, nombre))
        elif len(tipos_varios.get(tipo, {})) > 1:
            ambiguas_tipo.append((n["name"], tipo, len(tipos_varios[tipo])))
        elif tipo in cred_por_tipo:
            n["credentials"][tipo] = cred_por_tipo[tipo]
            por_tipo.append((n["name"], tipo, cred_por_tipo[tipo].get("name", "")))
        else:
            faltantes.append((n["name"], tipo, nombre))

for nodo, nombre in por_nombre: print(f"  {V}+{FIN} credencial por nombre: {nodo} <- «{nombre}»")
for nodo, tipo, nombre in por_tipo: print(f"  {A}+{FIN} credencial por TIPO ({tipo}): {nodo} <- «{nombre}» (de la referencia)")
for nodo, tipo, nombre in faltantes: print(f"  {R}✗{FIN} {nodo}: sin credencial {tipo} («{nombre}») ni por nombre ni en la referencia")
for nodo, nombre, cuantas in ambiguas: print(f"  {R}✗{FIN} {nodo}: hay {cuantas} credenciales llamadas «{nombre}»; no se elige una por TIPO")
for nodo, tipo, cuantas in ambiguas_tipo: print(f"  {R}✗{FIN} {nodo}: la referencia tiene {cuantas} credenciales {tipo} distintas; no se elige una por TIPO")
if ambiguas:
    print(f"\n{R}✗ ABORTADO: un nombre de credencial repetido no se resuelve por tipo.{FIN}")
    sys.exit(1)
if ambiguas_tipo:
    print(f"\n{R}✗ ABORTADO: varias credenciales del mismo tipo en la referencia; ponga el nombre de la credencial en el JSON.{FIN}")
    sys.exit(1)
if faltantes:
    print(f"\n{R}✗ ABORTADO: n8n no publica un flujo con un nodo sin credencial.{FIN}")
    sys.exit(1)

# Un disparador con webhook necesita una ruta propia: n8n la inventa al crear.
# Un scheduleTrigger no tiene ruta. Nada que injertar en ninguno de los dos.
cuerpo = {
    "name": nuevo["name"],
    "nodes": nuevo["nodes"],
    "connections": nuevo["connections"],
    "settings": nuevo.get("settings", {}),
}
serializado = json.dumps(cuerpo, ensure_ascii=False)
marcas = sorted(set(re.findall(r'REEMPLAZAR_[A-Z][^"\\\s]*', serializado)))
if marcas:
    print(f"\n{R}✗ ABORTADO: el archivo todavia tiene marcadores sin reponer.{FIN}")
    for m in marcas: print(f"    {m}")
    print(f"{G}  Corra primero:  ./scripts/preparar-import.sh {flujo} <env>{FIN}")
    sys.exit(2)
open(f"{tmp}/cuerpo.json", "w", encoding="utf-8").write(serializado)
print()
if not aplicar:
    print(f"{A}Diagnostico solamente. Nada se creo.{FIN}")
    print(f"{G}Para crearlo:  agregue --aplicar (y --activar para publicarlo){FIN}")
PY
  [[ $APLICAR -eq 1 ]] || exit 0

  COD=$(curl -s --max-time 60 -o "$TMP/rta.json" -w '%{http_code}' -X POST \
        -H @- -H "Content-Type: application/json" \
        --data-binary @"$TMP/cuerpo.json" "${API}/workflows" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)
  if [[ "$COD" != "200" && "$COD" != "201" ]]; then
    printf '\033[1;31m✗ No se pudo crear: HTTP %s\033[0m\n' "$COD"
    head -c 500 "$TMP/rta.json" 2>/dev/null || true; echo
    exit 1
  fi
  NUEVO_ID=$(python3 -c "import json; print(json.load(open('$TMP/rta.json')).get('id',''))")
  printf '\033[1;32m✓ Flujo creado (HTTP %s): id %s\033[0m\n' "$COD" "$NUEVO_ID"
  [[ -n "$NUEVO_ID" ]] || { echo "  La respuesta no trajo id."; exit 1; }

  if [[ $ACTIVAR -eq 1 ]]; then
    COD=$(curl -s --max-time 60 -o "$TMP/act.json" -w '%{http_code}' -X POST \
          -H @- "${API}/workflows/${NUEVO_ID}/activate" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)
    if [[ "$COD" == "200" ]]; then
      printf '\033[1;32m✓ Flujo activado (publicado).\033[0m\n'
    else
      printf '\033[1;31m✗ Creado pero NO activado: HTTP %s\033[0m\n' "$COD"
      head -c 500 "$TMP/act.json" 2>/dev/null || true; echo
      exit 1
    fi
  fi

  # El .env nuevo: copia del de --env con el id nuevo. Se escribe, no se
  # muestra: la clave de la API no pasa por la pantalla ni por el chat.
  if [[ -n "$ENV_NUEVO" ]]; then
    if [[ -e "$ENV_NUEVO" && $FORZAR -ne 1 ]]; then
      echo "  ✗ Ya existe $ENV_NUEVO: no se pisa (use --forzar). Ponga a mano N8N_WORKFLOW_ID=$NUEVO_ID"
      exit 1
    fi
    # Con --forzar el archivo puede existir: la umask no le cambia el modo, y la
    # redireccion lo trunca y le escribe los secretos con el modo que tenia. Se
    # cierra antes (revision de seguridad del PR #279).
    [[ -e "$ENV_NUEVO" ]] && chmod 600 "$ENV_NUEVO"
    ( umask 077
      { grep -v -E '^(N8N_WORKFLOW_ID|N8N_WEBHOOK_PATH|N8N_WEBHOOK_URL)=' "$ENV_FILE"
        echo "N8N_WORKFLOW_ID=$NUEVO_ID"; } > "$ENV_NUEVO" )
    chmod 600 "$ENV_NUEVO"
    echo "  ✓ $ENV_NUEVO escrito con el id nuevo (sin ruta de webhook: el flujo es programado)."
    echo "    De ahora en mas: ./scripts/publicar-flujo.sh --env $ENV_NUEVO --flujo $FLUJO"
  fi
  exit 0
fi

# --- 1b. reiniciar el estado guardado (opcional) ------------------------------
# n8n guarda por flujo unos datos estaticos (`staticData`): en la captacion, el
# estado de cada telefono (etapa, si ya se dio la bienvenida, si ya se aviso a
# una persona, y los datos del prospecto). La API los DEVUELVE al leer el flujo
# y los acepta al escribirlo, pero no hay ninguna pantalla para borrarlos.
#
# Hace falta despues de una prueba: el 15/09/2026 los cuatro telefonos de prueba
# quedaron en `etapa: cerrado` y `avisado: true` --este ultimo por un aviso que
# Meta habia rechazado--, y en ese estado el flujo ya no ofrece el boton hacia
# una persona ni vuelve a avisar. Sin esto, probar exige un telefono nuevo.
#
# Solo toca `staticData`: los nodos, las conexiones y los ajustes se reescriben
# TAL CUAL estan publicados, no desde el archivo. Guarda antes una copia.
if [[ $REINICIAR -eq 1 ]]; then
  APLICAR="$APLICAR" TMP="$TMP" python3 - <<'PY'
import json, os, datetime
tmp = os.environ["TMP"]
vivo = json.load(open(f"{tmp}/vivo.json", encoding="utf-8"))
conv = ((vivo.get("staticData") or {}).get("global") or {}).get("conversaciones") or {}
print(f"Flujo vivo : {vivo.get('name')}")
print(f"  telefonos con estado guardado: {len(conv)}")
for tel, c in list(conv.items())[:20]:
    print(f"    …{tel[-4:]}  etapa={c.get('etapa')!r} bienvenida={c.get('bienvenida')} "
          f"avisado={c.get('avisado')} respuestas={c.get('respuestas')}")
if os.environ["APLICAR"] != "1":
    print("\nDiagnostico solamente. Nada se escribio. Para borrarlo: --reiniciar-estado --aplicar")
    raise SystemExit(0)
sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
respaldo = f"Flujos/respaldo-estado-{vivo.get('id','sinid')}-{sello}.local.json"
fd = os.open(respaldo, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(fd, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(vivo.get("staticData"), f, ensure_ascii=False, indent=2)
print(f"  respaldo del estado: {respaldo}")
cuerpo = {
    "name": vivo["name"],
    "nodes": vivo["nodes"],
    "connections": vivo["connections"],
    "settings": vivo.get("settings", {}),
    "staticData": {"global": {"conversaciones": {}}},
}
open(f"{tmp}/cuerpo.json", "w", encoding="utf-8").write(json.dumps(cuerpo, ensure_ascii=False))
PY
  [[ $APLICAR -eq 1 ]] || exit 0
  COD=$(curl -s --max-time 60 -o "$TMP/rta.json" -w '%{http_code}' -X PUT \
        -H @- -H "Content-Type: application/json" \
        --data-binary @"$TMP/cuerpo.json" "${API}/workflows/${N8N_WORKFLOW_ID}" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)
  if [[ "$COD" == "200" ]]; then
    RESTAN=$(curl -s --max-time 30 -H @- "${API}/workflows/${N8N_WORKFLOW_ID}" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(((d.get("staticData") or {}).get("global") or {}).get("conversaciones") or {}))')
    printf '\033[1;32m✓ Estado reiniciado (HTTP 200). Telefonos con estado ahora: %s\033[0m\n' "$RESTAN"
  else
    printf '\033[1;31m✗ No se pudo reiniciar: HTTP %s\033[0m\n' "$COD"
    head -c 300 "$TMP/rta.json" 2>/dev/null || true
    exit 1
  fi
  exit 0
fi

APLICAR="$APLICAR" FORZAR="$FORZAR" ENV_FILE="$ENV_FILE" FLUJO="$FLUJO" TMP="$TMP" CRED_COD="$CRED_COD" python3 - <<'PY'
import json, os, sys, datetime

aplicar  = os.environ["APLICAR"] == "1"
forzar   = os.environ["FORZAR"] == "1"
env_file = os.environ["ENV_FILE"]
tmp     = os.environ["TMP"]
flujo   = os.environ["FLUJO"]
V, R, G, A, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[1;33m", "\033[0m"

vivo  = json.load(open(f"{tmp}/vivo.json", encoding="utf-8"))
nuevo = json.load(open(flujo, encoding="utf-8"))

webhooks = [n.get("webhookId") for n in vivo.get("nodes", [])
            if n.get("webhookId") and "trigger" in n["type"].lower()]
print(f"Flujo vivo : {vivo.get('name')}")
if webhooks:
    print(f"  webhook  : /webhook/{webhooks[0]}/webhook")
print(f"  activo   : {vivo.get('active')}   nodos: {len(vivo.get('nodes', []))}")
print(f"Origen     : {flujo}   nodos: {len(nuevo['nodes'])}\n")

# --- CERROJO: el archivo y el flujo vivo tienen que ser EL MISMO flujo --------
# El id del flujo sale de N8N_WORKFLOW_ID, que vive en `.env`, y el archivo se
# elige con --flujo. Son dos fuentes distintas, asi que nada impedia pedir
# `--flujo Flujos/demo-b-venta-cobro.json` contra el `.env` del Demo A y
# ESCRIBIR EL DEMO B ENCIMA DEL DEMO A. El diagnostico lo mostraba —«nodo del
# flujo vivo que ya no existe: agendar_cita», veinte veces— pero en una lista de
# cuarenta lineas de color, arriba del todo, y con --aplicar no habria hecho
# ninguna pregunta. Se llego a un paso de hacerlo el 08/09/2026.
#
# El nombre es la comprobacion correcta y no el id: el id hay que ir a buscarlo
# a la URL del editor, el nombre esta escrito en el JSON versionado y es lo que
# uno mira en n8n. --forzar existe para el unico caso legitimo, que es renombrar
# un flujo a proposito.
nombre_vivo, nombre_nuevo = vivo.get("name"), nuevo.get("name")
if nombre_vivo and nombre_nuevo and nombre_vivo != nombre_nuevo and not forzar:
    print(f"{R}✗ El archivo y el flujo vivo NO son el mismo flujo.{FIN}")
    print(f"    vivo   ({env_file}): {nombre_vivo}")
    print(f"    origen ({flujo}): {nombre_nuevo}")
    print("  Revise --env: el id del flujo sale de ahi y el archivo de --flujo.")
    print("  Si de verdad quiere renombrar el flujo vivo, use --forzar.")
    sys.exit(1)

# --- injerto de credenciales y webhookId, por nombre de nodo -----------------
por_nombre = {n["name"]: n for n in vivo.get("nodes", [])}
con_cred, sin_par, nuevos = [], [], []

# Mapa tipo-de-credencial -> referencia, tomado del flujo vivo. Sirve para los
# nodos NUEVOS: n8n rechaza publicar un flujo con un nodo sin credencial, asi
# que un nodo nuevo nunca podria entrar. Declarando el tipo en el JSON con id
# vacio, aca se completa desde una credencial ya conectada del mismo tipo.
cred_por_tipo = {}
for v in vivo.get("nodes", []):
    for tipo, ref in (v.get("credentials") or {}).items():
        if ref.get("id"):
            cred_por_tipo.setdefault(tipo, ref)

heredadas_por_tipo = []
declaradas = {n["name"]: dict(n.get("credentials") or {}) for n in nuevo["nodes"]}
for n in nuevo["nodes"]:
    par = por_nombre.get(n["name"])
    if par is None:
        nuevos.append(n["name"])
        continue
    if par.get("credentials"):
        n["credentials"] = par["credentials"]
        con_cred.append(n["name"])
    if par.get("webhookId"):
        n["webhookId"] = par["webhookId"]

# Relleno de credenciales por TIPO. Va DESPUES del injerto por nombre y vale
# para cualquier nodo cuya referencia quedo con id vacio: uno nuevo, o uno que
# ya existe en la instancia pero sin credencial conectada -- que es el estado
# en que queda un nodo si un PUT anterior escribio los nodos y n8n rechazo
# publicar. Sin esto no hay forma de salir: n8n no publica un flujo con un
# nodo sin credencial, y el nodo no puede recibirla si nunca entra.
for n in nuevo["nodes"]:
    for tipo, ref in (n.get("credentials") or {}).items():
        if not (ref or {}).get("id") and tipo in cred_por_tipo:
            n["credentials"][tipo] = cred_por_tipo[tipo]
            heredadas_por_tipo.append((n["name"], tipo))

# Asignacion por NOMBRE: gana la credencial que el JSON versionado nombra.
# Heredar del flujo vivo copiaba cualquier error hecho en la interfaz: el
# 15/09/2026, al importar el flujo de NovuChat, n8n puso la unica credencial
# Header Auth que existia (la de ingesta) en todos los nodos Header Auth,
# incluidos los que envian a Meta. Meta respondia 190 y el diagnostico lo
# informaba en verde como «credenciales heredadas».
try:
    crudo_cred = json.load(open(f"{tmp}/credenciales.json", encoding="utf-8"))
    lista_cred = crudo_cred.get("data")
    hay_mas = bool(crudo_cred.get("nextCursor"))
except Exception:
    lista_cred, hay_mas = None, False
corregidas, faltantes, ambiguas = [], [], []
if isinstance(lista_cred, list):
    indice = {}
    for c in lista_cred:
        indice.setdefault((c.get("type"), c.get("name")), []).append(c)
    for n in nuevo["nodes"]:
        for tipo, ref in (declaradas.get(n["name"]) or {}).items():
            nombre = (ref or {}).get("name")
            if not nombre:
                continue
            halladas = indice.get((tipo, nombre), [])
            if len(halladas) == 1:
                actual = (n.get("credentials") or {}).get(tipo) or {}
                if actual.get("id") != halladas[0].get("id"):
                    corregidas.append((n["name"], actual.get("name") or "ninguna", nombre))
                n.setdefault("credentials", {})[tipo] = {"id": halladas[0]["id"], "name": nombre}
            elif len(halladas) > 1:
                ambiguas.append((n["name"], nombre, len(halladas), tipo))
            else:
                faltantes.append((n["name"], nombre, tipo))
else:
    print(f"  {A}!{FIN} la API no listo las credenciales: se heredan del flujo vivo sin comprobar el nombre")

for nombre in por_nombre:
    if nombre not in {n["name"] for n in nuevo["nodes"]}:
        sin_par.append(nombre)

for c in con_cred: print(f"  {V}+{FIN} credenciales heredadas: {c}")
for c in nuevos:   print(f"  {A}!{FIN} nodo nuevo, sin par en el flujo vivo: {c}")
for nodo, tipo in heredadas_por_tipo:
    print(f"  {V}+{FIN} credencial heredada POR TIPO ({tipo}): {nodo}")
for c in sin_par:  print(f"  {A}!{FIN} nodo del flujo vivo que ya no existe: {c}")
for nodo, antes, despues in corregidas:
    print(f"  {A}~{FIN} credencial corregida: {nodo}: vivo «{antes}» -> «{despues}»")
for nodo, nombre, _tipo in faltantes:
    print(f"  {R}✗{FIN} {nodo}: la credencial «{nombre}» no existe en n8n (creela con ese nombre exacto); queda la del flujo vivo")
for nodo, nombre, cuantas, _tipo in ambiguas:
    print(f"  {R}✗{FIN} {nodo}: hay {cuantas} credenciales llamadas «{nombre}»; queda la del flujo vivo")

# Con --aplicar, un nodo cuya credencial NO se pudo resolver por nombre y que
# la recibio por TIPO (relleno desde otra del mismo tipo: no es la del flujo
# vivo ni la nombrada) puede quedar con la credencial de OTRO negocio. Se
# aborta antes de escribir. El seco solo muestra el diagnostico.
por_relleno = set(heredadas_por_tipo)
sin_resolver = [(f[0], f[2]) for f in faltantes] + [(a[0], a[3]) for a in ambiguas]
riesgo = sorted({nodo for nodo, tipo in sin_resolver if (nodo, tipo) in por_relleno})
if riesgo and aplicar:
    print(f"\n{R}✗ ABORTADO antes de escribir: estos nodos recibirian una credencial por TIPO sin que su nombre se resolviera:{FIN}")
    for nodo in riesgo: print(f"    {nodo}")
    print(f"{G}  Cree la credencial con el nombre exacto del JSON (o deje una sola con ese nombre) y reintente.{FIN}")
    sys.exit(1)
if riesgo:
    print(f"  {A}!{FIN} con --aplicar se abortaria: {', '.join(riesgo)} (credencial por TIPO sin nombre resuelto)")

# Sin lista de credenciales confiable no hay nombre que resolver: un 403 o un
# 5xx dejaba pasar el relleno por TIPO como si todo estuviera bien. Con
# --aplicar se aborta; el seco avisa.
bloqueo = None
if os.environ.get("CRED_COD") != "200":
    bloqueo = f"n8n no entrego la lista de credenciales (HTTP {os.environ.get('CRED_COD')})"
elif not isinstance(lista_cred, list) and heredadas_por_tipo:
    bloqueo = "la respuesta de credenciales no es una lista y hay credenciales rellenadas por TIPO"
elif hay_mas:
    bloqueo = "hay mas de 250 credenciales y la lista llego partida: no se decide con una lista parcial"
if bloqueo and aplicar:
    print(f"\n{R}✗ ABORTADO antes de escribir: {bloqueo}.{FIN}")
    sys.exit(1)
if bloqueo:
    print(f"  {A}!{FIN} con --aplicar se abortaria: {bloqueo}")

# Un nodo NUEVO cuya referencia no declara nombre recibe «alguna» credencial del
# tipo. Con mas de una en el flujo vivo, no hay forma de saber cual es la suya.
ids_vivo = {}
for v in vivo.get("nodes", []):
    for tipo, ref in (v.get("credentials") or {}).items():
        if (ref or {}).get("id"):
            ids_vivo.setdefault(tipo, set()).add(ref["id"])
sin_nombre = sorted((nodo, tipo) for nodo, tipo in heredadas_por_tipo
                    if nodo in nuevos and not ((declaradas.get(nodo) or {}).get(tipo) or {}).get("name"))
ambiguos_sn = [f"{nodo} ({tipo})" for nodo, tipo in sin_nombre if len(ids_vivo.get(tipo, ())) > 1]
if ambiguos_sn and aplicar:
    print(f"\n{R}✗ ABORTADO antes de escribir: nodo nuevo sin nombre de credencial y varias del mismo tipo en el flujo vivo:{FIN}")
    for x in ambiguos_sn: print(f"    {x}")
    print(f"{G}  Declare el nombre de la credencial en el JSON y reintente.{FIN}")
    sys.exit(1)
if ambiguos_sn:
    print(f"  {A}!{FIN} con --aplicar se abortaria: {', '.join(ambiguos_sn)} (sin nombre de credencial, varias del tipo)")
for nodo, tipo in sin_nombre:
    if f"{nodo} ({tipo})" not in ambiguos_sn:
        print(f"  {R}!{FIN} {nodo}: sin nombre de credencial; recibe la unica del tipo {tipo} del flujo vivo, sin comprobar el nombre")

if not con_cred:
    print(f"\n  {R}Ningun nodo heredo credenciales.{FIN} Revise que el ID sea el del")
    print(f"  {G}flujo que ya tiene las credenciales conectadas, no el recien importado.{FIN}")

# --- que se perdio por el camino ---------------------------------------------
# n8n descarta parametros en silencio al importar un JSON: la opcion queda
# fuera del flujo publicado y nadie se entera hasta que el comportamiento
# cambia. Este bloque compara el flujo vivo contra el origen y avisa.
NOTAS = {
    "options.singleEvents":
        "Sin esta opcion, Calendar devuelve los eventos repetitivos como serie\n"
        "      y no como instancias sueltas: el agente puede leer mal la\n"
        "      disponibilidad y ofrecer un horario ocupado.",
    "returnAll":
        "Si falta, n8n aplica el valor por defecto del nodo. Conviene tenerlo\n"
        "      explicito: con returnAll activo se trae la agenda entera, que fue\n"
        "      una de las causas de la latencia alta.",
    "options.maxIterations":
        "Acota cuantas veces el agente puede llamar a una herramienta. Sin\n"
        "      limite, un turno se dispara a decenas de segundos.",
    "updates":
        "Es el `Trigger On` del disparador. Si queda vacio, no entra ningun\n"
        "      mensaje y el sintoma es identico al de un webhook mal puesto.",
}

def aplanar(d, prefijo=""):
    plano = {}
    if isinstance(d, dict):
        for k, v in d.items():
            ruta = f"{prefijo}{k}"
            if isinstance(v, dict):
                plano.update(aplanar(v, ruta + "."))
            else:
                plano[ruta] = v
    return plano

perdidos, cambiados, config_dif, solo_vivo, props_dif = [], [], [], [], []
for n in nuevo["nodes"]:
    par = por_nombre.get(n["name"])
    if par is None:
        continue
    pv, pn = aplanar(par.get("parameters", {})), aplanar(n.get("parameters", {}))
    for clave, valor in pn.items():
        # Los campos de `Config del negocio` llevan valores reales, asi que se
        # comparan pero se informan por LONGITUD, nunca mostrando el valor. Sin
        # esto el detector era ciego al defecto mas caro que tuvimos: un ID de
        # calendario al que le faltaba un caracter, que hacia fallar la reserva
        # y, peor, hacia que el agente inventara la disponibilidad.
        if clave.startswith("assignments"):
            continue   # se comparan aparte, por campo, mas abajo
        if clave not in pv or pv[clave] is None:
            if valor not in (None, "", [], {}):
                perdidos.append((n["name"], clave, valor))
        elif pv[clave] != valor:
            cambiados.append((n["name"], clave, pv[clave], valor))
    # Parametros que SOLO tiene el vivo: --aplicar los borraria. Por clave,
    # nunca por valor. Se ignoran los vacios (n8n a veces los guarda asi).
    for clave, valor in pv.items():
        if clave.startswith("assignments"):
            continue
        if clave not in pn and valor not in (None, "", [], {}):
            solo_vivo.append((n["name"], clave))
    # Propiedades del nodo que cambian el comportamiento. Si el origen no las
    # declara se toma el valor por defecto de n8n (False / el del vivo en
    # type), para no contar lo que n8n agrega.
    for prop in ("type", "typeVersion"):
        if par.get(prop) != n.get(prop):
            props_dif.append((n["name"], prop))
    for prop in ("disabled", "retryOnFail", "alwaysOutputData", "executeOnce"):
        if bool(par.get(prop, False)) != bool(n.get(prop, False)):
            props_dif.append((n["name"], prop))
    # Los campos de un nodo Set viven en una LISTA, no en un diccionario, asi
    # que el aplanado no los alcanza: hay que emparejarlos por nombre. Se
    # informan por LONGITUD, nunca mostrando el valor, porque son datos reales
    # del negocio. Sin esto el detector era ciego al defecto mas caro que
    # tuvimos: un ID de calendario al que le faltaba un caracter, que rompia la
    # reserva y hacia que el agente inventara la disponibilidad.
    def campos(nodo):
        d = nodo.get("parameters", {}).get("assignments", {})
        return {c.get("name"): str(c.get("value", "")) for c in d.get("assignments", [])} \
               if isinstance(d, dict) else {}

    cv, cn = campos(par), campos(n)
    for campo in sorted(set(cv) | set(cn)):
        if cv.get(campo) != cn.get(campo):
            config_dif.append((n["name"], campo,
                               len(cv.get(campo, "")), len(cn.get(campo, ""))))

    # En AMBOS sentidos (uno que solo tiene el vivo, --aplicar lo borraria),
    # con None y False como iguales. Se informa nodo y propiedad, nunca valor.
    for meta in ("onError", "maxTries", "waitBetweenTries", "continueOnFail"):
        a_, b_ = par.get(meta), n.get(meta)
        if a_ != b_ and not (a_ in (None, False) and b_ in (None, False)):
            props_dif.append((n["name"], meta))

if perdidos:
    print(f"\n  {A}El flujo vivo no tiene esto explicito, y el origen si:{FIN}")
    for nodo, clave, valor in perdidos:
        # Por LONGITUD: el valor puede ser una URL de capacidad o un id real.
        print(f"    {A}!{FIN} {nodo} · {clave}: origen {len(json.dumps(valor, ensure_ascii=False))} car. (vivo: ausente)")
        nota = NOTAS.get(clave) or NOTAS.get(clave.split(".")[-1])
        if nota:
            print(f"      {G}{nota}{FIN}")
    print(f"  {G}Puede ser un valor por defecto que n8n no guarda, o un parametro que{FIN}")
    print(f"  {G}descarto al importar. Aplicar los deja explicitos en los dos casos.{FIN}")

if cambiados:
    print(f"\n  {A}Valores distintos entre el flujo vivo y el origen (se informa longitud, no valor):{FIN}")
    for nodo, clave, va, vb in cambiados:
        # Por LONGITUD, nunca el valor (URL de capacidad, phoneNumberId...).
        lon = lambda x: len(json.dumps(x, ensure_ascii=False))
        print(f"    {A}~{FIN} {nodo} · {clave}: vivo {lon(va)} car. -> origen {lon(vb)} car.")

if config_dif:
    print(f"\n  {A}Campos de configuracion distintos (se informa longitud, no valor):{FIN}")
    for nodo, campo, la, lb in config_dif:
        aviso = f"  {R}<- longitud distinta{FIN}" if la != lb else ""
        print(f"    {A}~{FIN} {nodo} · {campo}: vivo {la} car. -> origen {lb} car.{aviso}")

# --- diferencias de ESTRUCTURA -------------------------------------------------
# VERDE FALSO (03/10/2026): un nodo nuevo en el origen, un nodo que solo existe
# en el vivo, o un cambio de conexiones o de `settings` NO contaban como
# diferencia (solo los «valores distintos» de nodos presentes en los dos
# lados), y el diagnostico decia «coincide con el origen» con el flujo vivo
# atrasado (Platinum Seguimientos: 11 nodos vivos, 12 en el JSON). Se informan
# SOLO nombres de nodo y de clave de settings, nunca valores.
# Para no dar falsos positivos: las conexiones se normalizan (sin ramas de
# salida vacias al final, sin origenes sin destinos), y de `settings` solo se
# comparan las claves que el origen declara (n8n agrega las suyas por defecto).
# Las posiciones ABSOLUTAS no se comparan, pero el ORDEN RELATIVO de los
# destinos de un nodo con dos o mas destinos SI: con executionOrder v1 n8n
# corre las ramas de arriba hacia abajo (a igual altura, de izquierda a
# derecha), asi que mover un nodo por encima de otro cambia el comportamiento.
def _conex(c):
    out = {}
    for origen, tipos in (c or {}).items():
        t2 = {}
        for tipo, ramas in (tipos or {}).items():
            ramas = [[(d.get("node"), d.get("type"), d.get("index", 0)) for d in (r or [])] for r in (ramas or [])]
            while ramas and not ramas[-1]:
                ramas.pop()
            if ramas:
                t2[tipo] = ramas
        if t2:
            out[origen] = t2
    return out

estructura = []   # (nombre, motivo)
for c in nuevos:
    estructura.append((c, "nodo nuevo en el origen, no esta en el flujo vivo"))
for c in sin_par:
    estructura.append((c, "nodo solo en el flujo vivo, no esta en el origen"))
cv_, cn_ = _conex(vivo.get("connections")), _conex(nuevo.get("connections"))
for origen in sorted(set(cv_) | set(cn_)):
    if origen in nuevos or origen in sin_par:
        continue
    if cv_.get(origen) != cn_.get(origen):
        estructura.append((origen, "conexiones de salida distintas"))
# Orden de las ramas: destinos de cada nodo (con >= 2), por (y, x), a cada lado.
def _orden_ramas(flujo_):
    pos = {x["name"]: tuple(x.get("position") or (0, 0)) for x in flujo_.get("nodes", [])}
    out = {}
    for origen, tipos in (flujo_.get("connections") or {}).items():
        dest = {d.get("node") for ramas in (tipos or {}).values() for r in (ramas or []) for d in (r or [])}
        if len(dest) >= 2 and all(d in pos for d in dest):
            out[origen] = sorted(dest, key=lambda d: (pos[d][1], pos[d][0], d))
    return out
ov_, on_ = _orden_ramas(vivo), _orden_ramas(nuevo)
for origen in sorted(set(ov_) & set(on_)):
    if origen in nuevos or origen in sin_par:
        continue
    if set(ov_[origen]) == set(on_[origen]) and ov_[origen] != on_[origen]:
        estructura.append((origen, "orden de ramas distinto (el orden de los destinos en el lienzo cambia)"))
# Propiedades de nodo y parametros presentes solo en el vivo (nombre y clave, nunca valor).
for nodo_, prop in props_dif:
    estructura.append((nodo_, f"propiedad distinta: {prop}"))
for nodo_, clave in solo_vivo:
    estructura.append((nodo_, f"parametro presente solo en el vivo, --aplicar lo borraria: {clave}"))
sv_, sn_ = vivo.get("settings") or {}, nuevo.get("settings") or {}
claves_set = sorted(k for k in sn_ if sv_.get(k) != sn_.get(k))
if claves_set:
    estructura.append(("(settings del flujo)", "claves distintas: " + ", ".join(claves_set)))
# Claves de settings que solo tiene el vivo: --aplicar las borraria. Se ignora
# una clave SOLO si el vivo tiene el valor por defecto de n8n 2.36.5; con
# cualquier otro valor (p. ej. saveDataErrorExecution "none") cambia el
# comportamiento y cuenta. Se informa el nombre de la clave, nunca el valor.
# Origen de los defectos (npm pack de n8n@2.36.5 y n8n-workflow@2.36.3):
#  - saveDataErrorExecution, saveDataSuccessExecution, saveManualExecutions y
#    saveExecutionProgress: «DEFAULT» = usar el valor de la instancia
#    (n8n-workflow, interfaces.d.ts, IWorkflowSettings y WorkflowSettings).
#  - callerPolicy: «workflowsFromSameOwner» (n8n/dist/modules/mcp/tools/
#    workflow-builder/workflow-operations.js: «Defaults to ...»).
#  - binaryMode: «separate» (n8n-workflow, constants.js, BINARY_MODE_SEPARATE).
#  - availableInMCP: false (opcional, desactivado por defecto).
# callerIds no tiene defecto comprobable: si el vivo lo trae, cuenta.
SETTINGS_DEFECTO_N8N = {
    "saveDataErrorExecution": "DEFAULT", "saveDataSuccessExecution": "DEFAULT",
    "saveManualExecutions": "DEFAULT", "saveExecutionProgress": "DEFAULT",
    "callerPolicy": "workflowsFromSameOwner", "binaryMode": "separate", "availableInMCP": False,
}
solo_set = sorted(k for k in sv_ if k not in sn_
                  and not (k in SETTINGS_DEFECTO_N8N and type(sv_[k]) is type(SETTINGS_DEFECTO_N8N[k])
                           and sv_[k] == SETTINGS_DEFECTO_N8N[k]))
if solo_set:
    estructura.append(("(settings del flujo)", "claves solo en el vivo, --aplicar las borraria: " + ", ".join(solo_set)))

if estructura:
    print(f"\n  {A}Diferencias de estructura entre el flujo vivo y el origen ({len(estructura)}):{FIN}")
    for nombre, motivo in estructura:
        print(f"    {A}~{FIN} {nombre} · {motivo}")

if not perdidos and not cambiados and not config_dif and not corregidas and not estructura:
    print(f"\n  {V}El flujo vivo coincide con el origen: no hay nada que reponer.{FIN}")

# --- cuerpo para el PUT: la API rechaza campos de solo lectura ---------------
cuerpo = {
    "name":        nuevo.get("name", vivo.get("name")),
    "nodes":       nuevo["nodes"],
    "connections": nuevo["connections"],
    "settings":    nuevo.get("settings", vivo.get("settings", {})),
}
serializado = json.dumps(cuerpo, ensure_ascii=False)

# Defensa dura: nunca escribir marcadores encima de la configuracion real de
# produccion. Un `Config del negocio` con REEMPLAZAR_* deja el flujo sin
# calendario ni telefonos, y el sintoma aparece recien con el primer cliente.
import re as _re
# UN MARCADOR EMPIEZA CON MAYÚSCULA DESPUÉS DE «REEMPLAZAR_» (REEMPLAZAR_PHONE_NUMBER_ID,
# REEMPLAZAR_ID_CALENDARIO@group.calendar.google.com, REEMPLAZAR_NUMERO_DUENO_SIN_+).
# Antes se aceptaba cualquier cosa después de «REEMPLAZAR_», y el flujo de captación,
# que menciona el prefijo en su propio código para reconocer un respaldo sin llenar,
# se leía como dos marcadores falsos y publicar-flujo.sh abortaba (15/09/2026).
marcas = sorted(set(_re.findall(r'REEMPLAZAR_[A-Z][^"\\\s]*', serializado)))
if marcas:
    print(f"\n{R}✗ ABORTADO: el archivo todavia tiene marcadores sin reponer.{FIN}")
    for m in marcas:
        print(f"    {m}")
    print(f"{G}  Corra primero:  ./scripts/preparar-import.sh {flujo}{FIN}")
    raise SystemExit(2)

# --- respaldo del flujo vivo, solo cuando se va a escribir --------------------
# Va DESPUES de todos los abortos: un aborto no deja el respaldo de un PUT que
# nunca ocurrio. Modo 600: el flujo vivo trae la configuracion real del negocio.
if aplicar:
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    respaldo = f"Flujos/respaldo-{vivo.get('id','sinid')}-{sello}.local.json"
    fd = os.open(respaldo, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(vivo, f, ensure_ascii=False, indent=2)
    print(f"  {G}respaldo del flujo vivo: {respaldo}{FIN}\n")

open(f"{tmp}/cuerpo.json", "w", encoding="utf-8").write(serializado)

print()
if not aplicar:
    print(f"{A}Diagnostico solamente. Nada se escribio.{FIN}")
    print(f"{G}Para aplicar:  ./scripts/publicar-flujo.sh --aplicar{FIN}")
PY

[[ $APLICAR -eq 1 ]] || exit 0

# --- 2. escribir de vuelta ----------------------------------------------------
COD=$(curl -s --max-time 60 -o "$TMP/rta.json" -w '%{http_code}' -X PUT \
      -H @- -H "Content-Type: application/json" \
      --data-binary @"$TMP/cuerpo.json" "${API}/workflows/${N8N_WORKFLOW_ID}" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" || echo 000)

if [[ "$COD" == "200" ]]; then
  printf '\033[1;32m✓ Flujo actualizado en su lugar (HTTP 200).\033[0m\n'
  python3 -c "
import json,sys
d=json.load(open('$TMP/rta.json'))
print('  nombre:',d.get('name'),'| activo:',d.get('active'),'| nodos:',len(d.get('nodes',[])))"
  echo "  Revise en n8n que siga publicado y mande un mensaje de prueba."
else
  printf '\033[1;31m✗ La actualizacion fallo: HTTP %s\033[0m\n' "$COD"
  head -c 500 "$TMP/rta.json" 2>/dev/null || true
  echo
  echo "  El flujo vivo NO se modifico, o quedo a medias: compare contra el respaldo."
  exit 1
fi
