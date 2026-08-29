#!/usr/bin/env bash
# Completa las variables VACIAS de un archivo .env tomando los valores de la
# tabla de marcadores de CONFIGURACION.local.md (§0), que no se versiona.
#
# Existe para que nadie —persona o agente— tenga que abrir el archivo local y
# copiar valores a mano: el traspaso ocurre sin que los valores se muestren en
# ninguna pantalla. La salida informa nombres de variable y estado, NUNCA
# valores.
#
#   ./scripts/completar-env.sh                 # completa .env
#   ./scripts/completar-env.sh --env .env.demo-b
#   ./scripts/completar-env.sh --simular       # dice que haria, sin escribir
#
# Los secretos (WA_TOKEN, WA_APP_SECRET) NO estan en CONFIGURACION.local.md y
# se cargan a mano desde el gestor de contrasenas. Ver CONFIGURACION.md §4.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
LOCAL="CONFIGURACION.local.md"
SIMULAR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*)    ENV_FILE="${1#*=}"; shift ;;
    --simular)  SIMULAR=1; shift ;;
    -h|--help)  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "✗ No existe $ENV_FILE (copie .env.example)"; exit 1; }
[[ -f "$LOCAL"    ]] || { echo "✗ No existe $LOCAL — sin el no hay de donde tomar los valores"; exit 1; }

[[ $SIMULAR -eq 0 ]] && cp -p "$ENV_FILE" "${ENV_FILE}.respaldo"

SIMULAR="$SIMULAR" ENV_FILE="$ENV_FILE" LOCAL="$LOCAL" python3 - <<'PY'
import os, re, sys

simular  = os.environ["SIMULAR"] == "1"
env_file = os.environ["ENV_FILE"]
local    = os.environ["LOCAL"]

VERDE, ROJO, GRIS, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[0m"

# --- tabla de marcadores: | `${NOMBRE}` | valor | ... -------------------------
# Se descartan las filas marcadas "pendiente": son marcadores cuyo valor real
# todavia no existe (por ejemplo los del Demo B antes de crear el numero).
#
# Un .env se consume con `source`, asi que solo se aceptan valores ATOMICOS:
# sin espacios, comillas, comillas invertidas, parentesis ni signo peso. Una
# celda con prosa ("`proyecto` · numero `123`") no es un valor: se informa para
# que la resuelva una persona. Escribirla igual rompe el archivo para todos los
# scripts que lo leen, que es exactamente lo que paso la primera vez.
INSEGURO = re.compile(r'[\s`"\'()$&;|<>*?!\\]')

tabla, ambiguos = {}, {}
fila = re.compile(r'^\|\s*`\$\{([A-Z0-9_]+)\}`\s*\|([^|]*)\|')
for linea in open(local, encoding="utf-8"):
    if "pendiente" in linea.lower():
        continue
    m = fila.match(linea)
    if m:
        valor = m.group(2).strip().strip("`").strip()
        if not valor:
            continue
        if INSEGURO.search(valor):
            ambiguos[m.group(1)] = True
        else:
            tabla[m.group(1)] = valor

# --- recorrido del .env, preservando comentarios y orden ----------------------
lineas   = open(env_file, encoding="utf-8").read().splitlines(keepends=True)
salida   = []
puestas, ya_estaban, faltan = [], [], []
recortadas, riesgosas = [], []
valores  = {}

asignacion = re.compile(r'^(\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$')
for linea in lineas:
    m = asignacion.match(linea.rstrip("\n"))
    if not m:
        salida.append(linea); continue
    sangria, clave, valor = m.group(1), m.group(2), m.group(3).strip()
    if valor:
        # Higiene de lo cargado a mano. Un valor pegado con espacios sobrantes
        # o envuelto en comillas invertidas hace que `source .env` EJECUTE ese
        # texto como una orden, y el fallo es silencioso: la variable queda
        # vacia y aparece un "no se encontro la orden" que nadie relaciona.
        limpio = valor.strip().strip("`").strip()
        if limpio != valor:
            recortadas.append(clave)
        if INSEGURO.search(limpio):
            riesgosas.append(clave)
        ya_estaban.append(clave); valores[clave] = limpio
        salida.append(f"{sangria}{clave}={limpio}\n"); continue
    if clave in tabla:
        puestas.append(clave); valores[clave] = tabla[clave]
        salida.append(f"{sangria}{clave}={tabla[clave]}\n")
    else:
        faltan.append(clave); salida.append(linea)

# --- URL del webhook: se compone, no se copia --------------------------------
if "N8N_WEBHOOK_URL" in faltan and valores.get("N8N_BASE_URL") and valores.get("N8N_WEBHOOK_PATH"):
    url = valores["N8N_BASE_URL"].rstrip("/") + "/" + valores["N8N_WEBHOOK_PATH"].lstrip("/")
    salida = [f"N8N_WEBHOOK_URL={url}\n" if re.match(r'^\s*N8N_WEBHOOK_URL=\s*$', l) else l
              for l in salida]
    faltan.remove("N8N_WEBHOOK_URL"); puestas.append("N8N_WEBHOOK_URL (compuesta)")

if not simular:
    with open(env_file, "w", encoding="utf-8") as f:
        f.writelines(salida)

print(f"{'(simulacro) ' if simular else ''}Archivo: {env_file}\n")
for c in puestas:    print(f"  {VERDE}+{FIN} {c}")
for c in ya_estaban: print(f"  {GRIS}={FIN} {c} {GRIS}(ya tenia valor){FIN}")
for c in faltan:
    if c in ambiguos:
        print(f"  {ROJO}✗{FIN} {c} {ROJO}— la celda de {local} no es un valor unico{FIN}")
    else:
        print(f"  {ROJO}✗{FIN} {c} {ROJO}— a mano{FIN}")

if recortadas:
    print(f"\n  {GRIS}recortadas (espacios o comillas sobrantes): {', '.join(recortadas)}{FIN}")
if riesgosas:
    print(f"  {ROJO}✗ con caracteres que bash interpreta: {', '.join(riesgosas)}{FIN}")
    print(f"  {GRIS}  revise esas lineas: `source .env` puede ejecutarlas.{FIN}")

print()
if faltan:
    print(f"{ROJO}{len(faltan)} variable(s) sin completar.{FIN} Los secretos salen del gestor")
    print(f"{GRIS}de contrasenas, nunca de un archivo del repositorio (CONFIGURACION.md §4).{FIN}")
    sys.exit(1)
print(f"{VERDE}Todas las variables tienen valor.{FIN}")
PY
estado=$?

if [[ $SIMULAR -eq 0 ]]; then
  chmod 600 "$ENV_FILE"
  echo
  echo "Respaldo del archivo anterior: ${ENV_FILE}.respaldo"
fi
exit $estado
