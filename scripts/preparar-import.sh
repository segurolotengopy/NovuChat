#!/usr/bin/env bash
# Genera el archivo LISTO PARA IMPORTAR en n8n a partir del JSON versionado:
#
#   1. fija el `webhookId` del disparador en la ruta que Meta ya tiene
#      registrada (si no, n8n inventa una ruta nueva y no llega nada);
#   2. reemplaza cada marcador REEMPLAZAR_* por su valor real, tomado de la
#      tabla de CONFIGURACION.local.md.
#
# La salida es `<nombre>.local.json`, que esta en .gitignore: lleva valores
# sensibles y el repositorio es PUBLICO. El JSON versionado no se toca.
#
# La salida por pantalla informa NOMBRES de marcador y estado, nunca valores.
#
#   ./scripts/preparar-import.sh                                  # Demo A
#   ./scripts/preparar-import.sh Flujos/demo-b-venta-cobro.json   # Demo B
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

FLUJO="${1:-Flujos/demo-a-agendamiento.json}"
LOCAL="CONFIGURACION.local.md"
ENV_FILE=".env"

[[ -f "$FLUJO" ]] || { echo "✗ No existe $FLUJO"; exit 1; }
[[ -f "$LOCAL" ]] || { echo "✗ No existe $LOCAL — sin el no hay valores"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "✗ No existe $ENV_FILE"; exit 1; }

FLUJO="$FLUJO" LOCAL="$LOCAL" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import json, os, re, sys

flujo, local, env_file = os.environ["FLUJO"], os.environ["LOCAL"], os.environ["ENV_FILE"]
VERDE, ROJO, GRIS, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[0m"

salida = flujo[:-5] + ".local.json" if flujo.endswith(".json") else flujo + ".local.json"

# --- 1. webhookId: el UUID de la ruta registrada en Meta ----------------------
env = dict(l.strip().split("=", 1) for l in open(env_file, encoding="utf-8")
           if "=" in l and not l.strip().startswith("#"))
UUID = re.compile(r'^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')
uuids = [s for s in env.get("N8N_WEBHOOK_PATH", "").split("/") if UUID.match(s)]

d = json.load(open(flujo, encoding="utf-8"))
# Solo los disparadores que REALMENTE tienen webhook. Un scheduleTrigger
# termina en "trigger" pero no expone ninguna URL: ponerle un webhookId es
# ruido en el mejor caso y una colision de rutas en el peor.
CON_WEBHOOK = ("whatsapptrigger", "webhook", "formtrigger", "chattrigger")
disparadores = [n for n in d["nodes"]
                if any(c in n["type"].lower() for c in CON_WEBHOOK)]

if len(uuids) == 1 and disparadores:
    for n in disparadores:
        n["webhookId"] = uuids[0]
    webhook = f"{VERDE}+{FIN} webhookId fijado en: " + ", ".join(n["name"] for n in disparadores)
elif not uuids:
    webhook = f"{ROJO}✗{FIN} N8N_WEBHOOK_PATH no tiene un UUID — n8n va a inventar una ruta nueva"
else:
    webhook = f"{ROJO}✗{FIN} la ruta tiene {len(uuids)} UUID: reviselo a mano"

texto = json.dumps(d, ensure_ascii=False, indent=2) + "\n"

# --- 2. marcadores REEMPLAZAR_* ----------------------------------------------
# Filas de tabla:  | `REEMPLAZAR_LO_QUE_SEA` | valor |
# Las marcadas "pendiente" se saltean: su valor real todavia no se registro.
tabla, pendientes = {}, set()
fila = re.compile(r'^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|')
for linea in open(local, encoding="utf-8"):
    m = fila.match(linea)
    if not m:
        continue
    clave, valor = m.group(1), m.group(2).strip().strip("`").strip()
    if "pendiente" in linea.lower() or not valor:
        pendientes.add(clave)
    else:
        tabla[clave] = valor

presentes = sorted(set(re.findall(r'REEMPLAZAR_[^"\\\s]*', texto)))
puestos, sin_valor = [], []
for marcador in presentes:
    # el marcador mas largo primero evita reemplazos parciales
    clave = next((k for k in sorted(tabla, key=len, reverse=True) if marcador.startswith(k)), None)
    if clave:
        texto = texto.replace(clave, tabla[clave])
        puestos.append(clave)
    else:
        sin_valor.append(marcador)

json.loads(texto)                      # no escribir un JSON roto
open(salida, "w", encoding="utf-8").write(texto)

print(f"Origen : {flujo}")
print(f"Salida : {salida}\n")
print(" ", webhook)
for c in sorted(set(puestos)):  print(f"  {VERDE}+{FIN} {c}")
for c in sorted(set(sin_valor)):
    nota = "sin valor en la tabla" if c not in pendientes else "marcado como pendiente"
    print(f"  {ROJO}✗{FIN} {c} {ROJO}— {nota}{FIN}")

print()
if sin_valor:
    print(f"{ROJO}Quedan {len(set(sin_valor))} marcador(es) para reponer a mano en n8n.{FIN}")
    print(f"{GRIS}Para que la proxima importacion sea automatica, anote esos valores en{FIN}")
    print(f"{GRIS}la tabla de marcadores de {local} y vuelva a correr este script.{FIN}")
    sys.exit(1)
print(f"{VERDE}Archivo listo: importelo tal cual, sin reponer nada a mano.{FIN}")
PY
