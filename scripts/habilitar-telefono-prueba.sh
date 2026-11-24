#!/usr/bin/env bash
# =============================================================================
# habilitar-telefono-prueba.sh — agrega (o quita) UN teléfono de la lista blanca de pruebas de un comercio, SIN imprimir la tabla local.
#
#   ./scripts/habilitar-telefono-prueba.sh --tenant <comercio> --tel <dígitos>            # agrega
#   ./scripts/habilitar-telefono-prueba.sh --tenant <comercio> --tel <dígitos> --quitar   # quita
#
# QUÉ HACE. La lista blanca que usa `resetear-telefono.sh` sale de la tabla local (`CONFIGURACION.local.md`): la fila `REEMPLAZAR_TELEFONOS_DE_PRUEBA_<COMERCIO>` (y la general
# `REEMPLAZAR_TELEFONOS_DE_PRUEBA`). Este script toca SOLO la fila del comercio: la crea si no existe (al final del bloque de filas `REEMPLAZAR_*`), agrega o quita el teléfono y deja lo demás
# byte a byte igual. Es idempotente (agregar dos veces o quitar uno que no está no cambia nada) y la escritura es atómica (archivo temporal en la misma carpeta y renombre; conserva el modo).
#   - El teléfono son 8 a 15 dígitos; el comercio, minúsculas, dígitos y guion. El teléfono viaja SOLO como argumento: ningún archivo versionado lo lleva.
#   - NUNCA imprime la tabla, un teléfono ni la fila: la salida dice solo si se agregó, se quitó o ya estaba, y cuántos teléfonos tiene la fila.
#   - No habilita nada más: el flujo PUBLICADO responde a cualquier número; esta lista solo gobierna el reinicio de teléfonos de prueba y las ejecuciones de prueba.
#   - Se niega si la fila del comercio está marcada «pendiente» (la lista blanca la ignora): se resuelve a mano antes.
# Variable opcional: CONFIG_LOCAL_MD (otra tabla; se usa en las pruebas).
# =============================================================================
set -euo pipefail
set +x
TENANT=""; TEL=""; QUITAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant) TENANT="${2:?}"; shift 2 ;;
    --tel)    TEL="${2:?}"; shift 2 ;;
    --quitar) QUITAR=1; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guion)" >&2; exit 2; }
[[ "$TEL" =~ ^[0-9]{8,15}$ ]] || { echo "✗ --tel: solo dígitos (8 a 15)" >&2; exit 2; }
TABLA="${CONFIG_LOCAL_MD:-$HOME/NovuChat/CONFIGURACION.local.md}"
[ -f "$TABLA" ] || { echo "✗ No existe la tabla local" >&2; exit 1; }

TABLA="$TABLA" TENANT="$TENANT" TEL="$TEL" QUITAR="$QUITAR" python3 -I - <<'PY'
import fcntl, os, re, sys, tempfile
tabla, tenant, tel, quitar = os.environ["TABLA"], os.environ["TENANT"], os.environ["TEL"], os.environ["QUITAR"] == "1"
clave = "REEMPLAZAR_TELEFONOS_DE_PRUEBA_" + tenant.upper().replace("-", "_")
fila = re.compile(r'^(\|\s*`)(REEMPLAZAR_[^`]*)(`\s*\|)([^|]*)(\|.*)$')
# Un candado exclusivo durante TODO el proceso: dos ejecuciones a la vez no se pisan (el archivo de candado vive junto a la tabla y no lleva datos).
candado = open(os.path.join(os.path.dirname(os.path.abspath(tabla)), ".tabla-candado.local.md"), "a"); fcntl.flock(candado, fcntl.LOCK_EX)
with open(tabla, encoding="utf-8", newline="") as f:
    lineas = f.read().split("\n")
idx = None; ultima_reemplazar = None; iguales = 0
for i, l in enumerate(lineas):
    m = fila.match(l.rstrip("\r"))
    if not m: continue
    ultima_reemplazar = i
    if m.group(2) == clave:
        if "pendiente" in l.lower():
            print("✗ La fila del comercio está marcada «pendiente»: resuélvala antes (la lista blanca la ignora)", file=sys.stderr); sys.exit(1)
        iguales += 1
        if idx is None: idx = i
if iguales > 1:
    print("✗ Hay más de una fila del comercio en la tabla: déjela en una sola antes (la lista blanca las junta todas)", file=sys.stderr); sys.exit(1)
crlf = any(l.endswith("\r") for l in lineas[:-1])
def telefonos(valor):
    return [x.strip() for x in valor.strip().strip("`").split(",") if x.strip()]
cambio = False
if idx is None:
    if quitar:
        print("= No había fila del comercio: nada que quitar"); sys.exit(0)
    nueva = "| `" + clave + "` | " + tel + " | lista blanca de teléfonos de prueba del comercio (habilitar-telefono-prueba.sh) |"
    if ultima_reemplazar is None:
        print("✗ La tabla no tiene filas REEMPLAZAR_*: no se sabe dónde agregar la fila", file=sys.stderr); sys.exit(1)
    # Después de la ÚLTIMA fila REEMPLAZAR_* contigua del bloque donde cayó la primera.
    j = ultima_reemplazar
    while j + 1 < len(lineas) and fila.match(lineas[j + 1].rstrip("\r")): j += 1
    lineas.insert(j + 1, nueva + ("\r" if crlf else "")); cambio = True; cuenta = 1; accion = "agregado (fila nueva)"
else:
    m = fila.match(lineas[idx].rstrip("\r")); cr = "\r" if lineas[idx].endswith("\r") else ""
    tels = telefonos(m.group(4))
    if quitar:
        if tel in tels:
            tels = [t for t in tels if t != tel]; cambio = True; accion = "quitado"
        else: accion = "no estaba (sin cambios)"
    else:
        if tel not in tels:
            tels.append(tel); cambio = True; accion = "agregado"
        else: accion = "ya estaba (sin cambios)"
    cuenta = len(tels)
    if cambio:
        lineas[idx] = m.group(1) + m.group(2) + m.group(3) + " " + ",".join(tels) + " " + m.group(5) + cr
if cambio:
    modo = os.stat(tabla).st_mode & 0o777
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(tabla)), prefix=".tabla-", suffix=".local.md", text=False)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write("\n".join(lineas).encode("utf-8")); out.flush(); os.fsync(out.fileno())
        os.chmod(tmp, modo); os.replace(tmp, tabla)
    except BaseException:
        try: os.unlink(tmp)
        except OSError: pass
        raise
print("✓ Teléfono " + accion + " en la fila del comercio (" + tenant + "): la fila queda con " + str(cuenta) + " teléfono(s)")
PY
