#!/usr/bin/env bash
# =============================================================================
# ensayo-flujo.sh — publica el flujo de un CLIENTE sobre el número del DEMO A
# para probar un cambio antes de llevarlo al número del cliente, y lo devuelve.
#
# Es la mitad n8n del ensayo; la mitad plataforma es `admin/scripts/ensayo.mjs`
# (el comercio `ensayo` y la ruta del número). Procedimiento completo:
# docs/ensayo/LEEME.md.
#
# QUÉ HACE
#   1. Toma el JSON versionado del cliente (el de la rama con el cambio) y arma
#      `Flujos/ensayo-<cliente>.json` (ignorado por git):
#        - con el NOMBRE del flujo del Demo A, que es el flujo vivo que se va a
#          pisar: el cerrojo de publicar-flujo.sh compara nombres, y acá el
#          cambio de nombre es deliberado y lo hace este script, no una persona;
#        - con los marcadores del ensayo en vez de los del cliente:
#            REEMPLAZAR_PHONE_NUMBER_ID_<C>      -> REEMPLAZAR_PHONE_NUMBER_ID (el del Demo A)
#            REEMPLAZAR_NUMERO_*_<C>             -> REEMPLAZAR_NUMERO_RECEPCION_ENSAYO
#            REEMPLAZAR_CALENDARIO_<C>_<n>       -> REEMPLAZAR_CALENDARIO_ENSAYO_<n>
#          El horario del cliente se conserva: es lo que se está probando.
#   2. preparar-import.sh con el entorno del Demo A (su webhook, sus valores).
#   3. publicar-flujo.sh sobre el Demo A: diagnóstico en seco, o --aplicar.
#
# LOS CERROJOS
#   - Si un nodo del cliente usa una credencial que el Demo A no tiene por ese
#     NOMBRE de nodo, se aborta: publicar-flujo.sh la completaría POR TIPO y un
#     nodo que manda a Meta podría quedar con la credencial de ingesta (la
#     trampa del 15/09). Pasa con los nodos propios de un cliente (Bellido).
#   - Si queda algún marcador del cliente que no sea el horario, se aborta: el
#     ensayo apuntaría a su recepción o a su agenda.
#
#   ./scripts/ensayo-flujo.sh --cliente PLATINUM --flujo Flujos/platinum-agendamiento.json [--aplicar]
#   ./scripts/ensayo-flujo.sh --restaurar [--aplicar]      # el Demo A vuelve a ser el Demo A
#
# --env: el entorno del número de ensayo (por defecto .env, el del Demo A).
# Se corre desde la carpeta que tiene los .env y CONFIGURACION.local.md.
# =============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$AQUI/.." && pwd)"
CLIENTE=""; FLUJO=""; ENV_FILE=".env"; APLICAR=""; RESTAURAR=0
DEMO="$REPO/Flujos/demo-a-agendamiento.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --cliente)   CLIENTE="$2"; shift 2 ;;
    --flujo)     FLUJO="$2"; shift 2 ;;
    --env)       ENV_FILE="$2"; shift 2 ;;
    --aplicar)   APLICAR="--aplicar"; shift ;;
    --restaurar) RESTAURAR=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -f "$ENV_FILE" ] || { echo "✗ Falta $ENV_FILE (corra desde la carpeta de los .env)" >&2; exit 2; }

if [ "$RESTAURAR" = 1 ]; then
  echo "Restaurar el Demo A desde el JSON versionado (${DEMO#"$REPO"/})."
  "$AQUI/preparar-import.sh" "$DEMO" "$ENV_FILE"
  exec "$AQUI/publicar-flujo.sh" --env "$ENV_FILE" --flujo "${DEMO%.json}.local.json" $APLICAR
fi

[ -n "$CLIENTE" ] && [ -f "$FLUJO" ] || { echo "✗ Falta --cliente <NOMBRE> y --flujo <JSON versionado del cliente>" >&2; exit 2; }
printf '%s' "$CLIENTE" | grep -Eq '^[A-Z][A-Z0-9_]{1,30}$' || { echo "✗ --cliente va en MAYÚSCULAS, como su carpeta en CLIENTES/" >&2; exit 2; }
minus=$(printf '%s' "$CLIENTE" | tr 'A-Z_' 'a-z-')
SALIDA="$REPO/Flujos/ensayo-${minus}.json"

# Del entorno del número de ensayo solo se leen estas tres claves, por nombre.
valor() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true; }
N8N_BASE_URL=$(valor N8N_BASE_URL) N8N_API_KEY=$(valor N8N_API_KEY) N8N_WORKFLOW_ID=$(valor N8N_WORKFLOW_ID) \
CLIENTE="$CLIENTE" FLUJO="$FLUJO" DEMO="$DEMO" SALIDA="$SALIDA" python3 - <<'PY'
import json, os, re, sys, urllib.request
c = os.environ["CLIENTE"]
flujo = json.load(open(os.environ["FLUJO"], encoding="utf-8"))
demo = json.load(open(os.environ["DEMO"], encoding="utf-8"))
R, V, FIN = "\033[1;31m", "\033[1;32m", "\033[0m"

# Credenciales: cada nodo con credencial tiene que existir en el Demo A VIVO
# con el mismo nombre y el mismo tipo de credencial —publicar-flujo.sh injerta
# las del flujo vivo por nombre de nodo—, o la completaría por tipo.
req = urllib.request.Request(os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1/workflows/" + os.environ["N8N_WORKFLOW_ID"],
                             headers={"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Accept": "application/json"})
try:
    vivo = json.load(urllib.request.urlopen(req, timeout=30))
except Exception as e:
    print(f"{R}✗ No se pudo leer el Demo A vivo en n8n: {e}{FIN}"); sys.exit(1)
if vivo.get("name") != demo["name"]:
    print(f"{R}✗ El flujo vivo de este entorno no es el Demo A («{vivo.get('name')}»). No se generó nada.{FIN}"); sys.exit(1)
cred_demo = {n["name"]: (n.get("credentials") or {}) for n in vivo["nodes"]}
malos = [f"{n['name']} ({', '.join(n['credentials'])})" for n in flujo["nodes"]
         if n.get("credentials") and not set(n["credentials"]) <= set(cred_demo.get(n["name"], {}))]
if malos:
    print(f"{R}✗ Estos nodos del cliente usan credenciales que el Demo A no tiene en ese nodo:{FIN}")
    for m in malos: print(f"    {m}")
    print("  publicar-flujo.sh los completaría POR TIPO, y un envío a Meta podría quedar con la")
    print("  credencial de ingesta. Para ensayar este cliente hace falta darle a esos nodos una")
    print("  credencial de ensayo por nombre. No se generó nada.")
    sys.exit(1)

# LAS CREDENCIALES SON LAS DEL DEMO A, nodo por nodo, con su id y su nombre.
# publicar-flujo.sh corrige cada credencial por el NOMBRE que trae el JSON, y el
# JSON del cliente nombra las SUYAS: el primer seco del 21/09 anunció el envío
# con «WhatsApp Clínica Platinum (envío)» y la ingesta de la clínica sobre el
# disparador del Demo A. El ensayo habría contestado desde el número del
# cliente. Acá se reemplazan antes de generar nada.
cambiadas = 0
for n in flujo["nodes"]:
    if n.get("credentials"):
        n["credentials"] = {t: dict(cred_demo[n["name"]][t]) for t in n["credentials"]}
        cambiadas += 1
propias = set()
for n in flujo["nodes"]:
    for t, cr in (n.get("credentials") or {}).items():
        propias.add(cr.get("name", ""))
texto = json.dumps(flujo, ensure_ascii=False)
texto = texto.replace(f"REEMPLAZAR_PHONE_NUMBER_ID_{c}", "REEMPLAZAR_PHONE_NUMBER_ID")
texto = re.sub(rf"REEMPLAZAR_NUMERO_[A-Z_]*?_{c}\b", "REEMPLAZAR_NUMERO_RECEPCION_ENSAYO", texto)
texto = re.sub(rf"REEMPLAZAR_CALENDARIO_{c}_([0-9]+)", r"REEMPLAZAR_CALENDARIO_ENSAYO_\1", texto)
restos = sorted(set(m for m in re.findall(rf"REEMPLAZAR_[A-Z0-9_]*{c}[A-Z0-9_]*", texto)
                    if not m.startswith("REEMPLAZAR_HORARIO_")))
if restos:
    print(f"{R}✗ Quedan marcadores del cliente que apuntarían a sus datos: {', '.join(restos)}. No se generó nada.{FIN}")
    sys.exit(1)
salida = json.loads(texto)
salida["name"] = demo["name"]
json.dump(salida, open(os.environ["SALIDA"], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
usados = sorted(set(re.findall(r"REEMPLAZAR_[A-Z0-9_]+", texto)))
print(f"{V}✓{FIN} Flujo de ensayo generado desde {os.environ['FLUJO']} ({len(salida['nodes'])} nodos), "
      f"con el nombre del Demo A.")
print(f"  Marcadores: {', '.join(usados)}")
print(f"  Credenciales: las del Demo A vivo en {cambiadas} nodos: {', '.join(sorted(x for x in propias if x))}")
PY

"$AQUI/preparar-import.sh" "$SALIDA" "$ENV_FILE"
rm -f "$SALIDA"
"$AQUI/publicar-flujo.sh" --env "$ENV_FILE" --flujo "${SALIDA%.json}.local.json" $APLICAR
