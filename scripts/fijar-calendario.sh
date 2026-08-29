#!/usr/bin/env bash
# Fija el ID del calendario del demo en los DOS lugares donde vive: la tabla de
# marcadores de CONFIGURACION.local.md y el .env. Los dos estan ignorados por
# git; ninguno de los dos valores se muestra en pantalla.
#
# Existe por un motivo concreto: el 2026-08-29 un ID pegado a mano perdio su
# primer caracter. Google devolvia 404 al crear la cita, el agente confirmaba
# igual, y ADEMAS la lectura de disponibilidad fallaba en silencio, con lo cual
# el agente inventaba los horarios. Costo horas encontrarlo. Este script valida
# la forma antes de escribir.
#
#   ./scripts/fijar-calendario.sh          # lo pide sin mostrarlo
set -euo pipefail

cd "$(dirname "$0")/.."
LOCAL="CONFIGURACION.local.md"
ENV_FILE=".env"

[[ -f "$LOCAL" ]]    || { echo "✗ No existe $LOCAL"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "✗ No existe $ENV_FILE"; exit 1; }

echo "Pegue el ID del calendario (no se va a mostrar) y pulse Enter."
echo "Se toma de Google Calendar: Configuracion del calendario -> Integrar calendario."
read -r -s -p "ID: " ID
echo
ID="$(printf '%s' "$ID" | tr -d '[:space:]')"

# Dos formas validas: calendario secundario (hex@group...) o el primario, que
# es la direccion de correo de la cuenta.
# EXACTAMENTE 64 hexadecimales. No "32 o mas": ese fue el error de la primera
# version de este script, que acepto un ID truncado -- justo lo que existe para
# impedir. Un validador que no rechaza el caso que motivo escribirlo no valida.
SECUNDARIO='^[0-9a-fA-F]{64}@group\.calendar\.google\.com$'
PRIMARIO='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'

# El orden de las comprobaciones importa. Un ID de calendario TIENE forma de
# correo, asi que si se prueba primero la forma de correo, un ID de grupo
# malformado cae ahi y pasa. Por eso primero se decide POR EL SUFIJO y recien
# despues se valida: lo que termina en @group.calendar.google.com se juzga
# unicamente con la regla estricta, sin red de rescate.
if [[ "$ID" == *"@group.calendar.google.com" ]]; then
  if [[ ! "$ID" =~ $SECUNDARIO ]]; then
    hex="${ID%@group.calendar.google.com}"
    echo "✗ ID de calendario de grupo malformado."
    echo "  La parte hexadecimal tiene ${#hex} caracteres y deben ser 64."
    echo "  No se escribio nada."
    exit 1
  fi
  echo "  forma: calendario secundario · ${#ID} caracteres, 64 hexadecimales"
elif [[ "$ID" =~ $PRIMARIO ]]; then
  echo "  forma: calendario primario (correo) · ${#ID} caracteres"
  echo "  aviso: el primario es la agenda personal de la cuenta. Para el demo"
  echo "         conviene un calendario propio, no el primario."
else
  echo "✗ No tiene forma de ID de calendario de Google."
  echo "  Esperado: 64 hexadecimales + @group.calendar.google.com, o un correo."
  echo "  Longitud recibida: ${#ID}. No se escribio nada."
  exit 1
fi

cp -p "$LOCAL" "${LOCAL}.respaldo"
cp -p "$ENV_FILE" "${ENV_FILE}.respaldo"

ID="$ID" LOCAL="$LOCAL" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os, re
nuevo = os.environ["ID"]; local = os.environ["LOCAL"]; env_file = os.environ["ENV_FILE"]

# --- tabla de marcadores ------------------------------------------------------
lineas = open(local, encoding="utf-8").read().splitlines(keepends=True)
fila = re.compile(r'^(\|\s*`REEMPLAZAR_ID_CALENDARIO@group\.calendar\.google\.com`\s*\|)([^|]*)(\|.*)$')
n = 0
for i, l in enumerate(lineas):
    m = fila.match(l.rstrip("\n"))
    if m:
        antes = m.group(2).strip().strip("`").strip()
        lineas[i] = f"{m.group(1)} {nuevo} {m.group(3)}\n"
        n += 1
        print(f"  {local}: {len(antes)} -> {len(nuevo)} caracteres")
open(local, "w", encoding="utf-8").writelines(lineas)
if n == 0:
    raise SystemExit("✗ No se encontro la fila del marcador en la tabla.")

# --- .env ---------------------------------------------------------------------
lineas = open(env_file, encoding="utf-8").read().splitlines(keepends=True)
m = 0
for i, l in enumerate(lineas):
    if re.match(r'^\s*CALENDAR_ID=', l):
        antes = l.split("=", 1)[1].strip()
        lineas[i] = f"CALENDAR_ID={nuevo}\n"
        m += 1
        print(f"  {env_file}: {len(antes)} -> {len(nuevo)} caracteres")
open(env_file, "w", encoding="utf-8").writelines(lineas)
if m == 0:
    print(f"  aviso: {env_file} no tenia CALENDAR_ID; no se agrego.")
PY

chmod 600 "$ENV_FILE"
echo
echo "Listo. Ahora:  ./scripts/preparar-import.sh && ./scripts/publicar-flujo.sh --aplicar"
