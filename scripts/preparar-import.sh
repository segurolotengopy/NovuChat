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
#   ./scripts/preparar-import.sh Flujos/novuchat-onboarding.json .env.novuchat
#
# EL SEGUNDO ARGUMENTO ES EL ENTORNO, y para un flujo que no es el Demo A hay
# que pasarlo. De `.env` sale la ruta del webhook que se fija en el disparador:
# sin el segundo argumento, un flujo nuevo recibia la ruta del DEMO A y los dos
# flujos quedaban peleando por la misma URL. Con el entorno del cliente -- que
# todavia no tiene ruta registrada -- n8n crea una nueva, que es lo correcto.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

FLUJO="${1:-Flujos/demo-a-agendamiento.json}"
# La tabla de marcadores. Se puede apuntar a otra con CONFIG_LOCAL_MD, y lo
# unico que la usa asi es la suite: sin eso, la guarda de los dos disparadores
# -la que evita que el webhook del carrito le pise la ruta a Meta- solo se
# podria probar en la maquina del operador, que es donde menos falta hace.
LOCAL="${CONFIG_LOCAL_MD:-CONFIGURACION.local.md}"
ENV_FILE="${2:-.env}"

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

# UN FLUJO PUEDE TENER DOS DISPARADORES CON URL, Y NO COMPARTEN RUTA.
#
# Desde el 22/09/2026 el Demo B tiene, ademas del disparador de WhatsApp, un
# nodo Webhook que recibe el carrito del catalogo web. Los dos entran en
# CON_WEBHOOK, y la version anterior de este bloque le ponia el MISMO
# `webhookId` -el UUID que Meta tiene registrado- a todos: un nodo Webhook sin
# `path` propio se registra en esa misma ruta y le pisa el webhook a Meta, que
# es el que hace andar todo el flujo. El sintoma seria que deja de llegar
# cualquier mensaje de WhatsApp, y el operador no tendria por que relacionarlo
# con haber importado.
#
# La regla es la del propio n8n: un disparador toma su URL del `webhookId`
# SOLO si no declara un `path` propio (el de WhatsApp no lo declara; el nodo
# Webhook si). Asi que la ruta de Meta se le pone unicamente a los que no
# tienen ruta propia, y si hubiera dos de esos se corta: dos disparadores no
# pueden escuchar la misma URL.
def ruta_propia(n):
    return str((n.get("parameters") or {}).get("path") or "").strip()

con_ruta_propia = [n for n in disparadores if ruta_propia(n)]
toman_la_de_meta = [n for n in disparadores if not ruta_propia(n)]
propias = "".join(
    f"\n  {GRIS}·{FIN} {n['name']}: conserva su ruta propia ({ruta_propia(n)})"
    for n in con_ruta_propia)

if len(toman_la_de_meta) > 1:
    webhook = (f"{ROJO}✗{FIN} hay {len(toman_la_de_meta)} disparadores sin ruta propia "
               f"({', '.join(n['name'] for n in toman_la_de_meta)}): no pueden compartir la de Meta. "
               f"Deles un `path` propio en el JSON.") + propias
    print(f"Origen : {flujo}\n")
    print(" ", webhook)
    sys.exit(1)
elif len(uuids) == 1 and toman_la_de_meta:
    for n in toman_la_de_meta:
        n["webhookId"] = uuids[0]
    webhook = (f"{VERDE}+{FIN} webhookId fijado en: "
               + ", ".join(n["name"] for n in toman_la_de_meta)) + propias
elif not uuids:
    webhook = (f"{GRIS}·{FIN} {env_file} no tiene ruta de webhook registrada: n8n crea una nueva "
               f"(correcto para un flujo nuevo; despues se anota en N8N_WEBHOOK_PATH)") + propias
else:
    webhook = (f"{ROJO}✗{FIN} la ruta tiene {len(uuids)} UUID: reviselo a mano") + propias

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

# DEL MAS LARGO AL MAS CORTO, y no alfabetico. `texto.replace()` cambia TODAS
# las apariciones, asi que reemplazar primero REEMPLAZAR_CALENDARIO_BELLEZA
# pisa el prefijo de REEMPLAZAR_CALENDARIO_BELLEZA_2 y el segundo marcador
# queda con el valor del primero. Paso de verdad el 2026-09-06: dos personas
# distintas terminaron apuntando al mismo calendario, que es exactamente la
# colision de citas que ese cambio venia a evitar. Y no fallo: escribio un
# valor plausible y equivocado, que es la peor forma de fallar.
# UN MARCADOR EMPIEZA CON MAYÚSCULA DESPUÉS DE «REEMPLAZAR_» (REEMPLAZAR_PHONE_NUMBER_ID,
# REEMPLAZAR_ID_CALENDARIO@group.calendar.google.com, REEMPLAZAR_NUMERO_DUENO_SIN_+).
# Antes se aceptaba cualquier cosa después de «REEMPLAZAR_», y el flujo de captación,
# que menciona el prefijo en su propio código para reconocer un respaldo sin llenar,
# se leía como dos marcadores falsos y publicar-flujo.sh abortaba (15/09/2026).
presentes = sorted(set(re.findall(r'REEMPLAZAR_[A-Z][^"\\\s]*', texto)))
puestos, sin_valor = [], []
# COINCIDENCIA EXACTA, nunca por prefijo. Antes se aceptaba una fila cuyo
# nombre fuera el comienzo del marcador, y el 2026-09-15 el respaldo de NovuChat
# (REEMPLAZAR_PHONE_NUMBER_ID_NOVUCHAT, sin fila propia) salio con el Phone ID
# del Demo A, tomado de REEMPLAZAR_PHONE_NUMBER_ID, informado en verde. Un
# marcador sin su fila exacta queda sin valor y el script lo dice.
# Y el reemplazo exige que despues del marcador no siga otra letra, digito o
# guion bajo, para no tocar el comienzo de un marcador mas largo sin fila.
for marcador in sorted(presentes, key=len, reverse=True):
    if marcador in tabla:
        valor = tabla[marcador]
        texto = re.sub(re.escape(marcador) + r'(?![A-Za-z0-9_])', lambda _m: valor, texto)
        puestos.append(marcador)
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
