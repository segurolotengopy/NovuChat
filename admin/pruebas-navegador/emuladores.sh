#!/usr/bin/env bash
# =============================================================================
# Levanta los emuladores de Auth y Firestore PARA LAS PRUEBAS DE NAVEGADOR, en puertos propios
# (Firestore 8332, Auth 9399), distintos de los de `scripts/emuladores.sh` (8232, 9299): las dos cosas pueden convivir.
# Firestore va con las reglas REALES (`firestore.rules`): una regla que rechaza un guardado se ve acá como lo vería el comercio.
#
# Por qué se arma así y no con un simple `firebase emulators:start`: en esta máquina el CLI falla al vigilar `firestore.rules`
# (límite de inotify, ver `scripts/emuladores.sh`). Firestore se levanta con el jar directo; Auth por el CLI, con una
# configuración mínima en un directorio temporal (solo Auth, sin interfaz).
#
# Uso:  bash pruebas-navegador/emuladores.sh      (Ctrl-C los apaga)   y, en otra terminal:  pnpm pruebas:navegador
# =============================================================================
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROYECTO="demo-novuchat-e2e"
PUERTO_FS=8332; PUERTO_WS=9251; PUERTO_AUTH=9399

JAR="$(ls -1 "$HOME/.cache/firebase/emulators/"cloud-firestore-emulator-v*.jar 2>/dev/null | sort -V | tail -1 || true)"
[[ -n "$JAR" ]] || { echo "No hay jar del emulador de Firestore. Una sola vez:  firebase setup:emulators:firestore"; exit 1; }

TMP="$(mktemp -d)"
cat > "$TMP/firebase.json" <<JSON
{ "emulators": { "auth": { "port": ${PUERTO_AUTH}, "host": "127.0.0.1" }, "ui": { "enabled": false }, "singleProjectMode": true } }
JSON

PIDS=()
limpiar() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; rm -rf "$TMP"; }
trap limpiar EXIT INT TERM

java -Duser.language=en -jar "$JAR" --host 127.0.0.1 --port "$PUERTO_FS" --websocket_port "$PUERTO_WS" \
  --database-edition standard --project_id "$PROYECTO" --rules "$RAIZ/firestore.rules" --single_project_mode true \
  > "$TMP/firestore.log" 2>&1 &
PIDS+=($!)
( cd "$RAIZ" && firebase emulators:start --only auth --project "$PROYECTO" --config "$TMP/firebase.json" ) > "$TMP/auth.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 90); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${PUERTO_FS}") 2>/dev/null && (exec 3<>"/dev/tcp/127.0.0.1/${PUERTO_AUTH}") 2>/dev/null; then
    echo "Emuladores listos: Firestore 127.0.0.1:${PUERTO_FS}, Auth 127.0.0.1:${PUERTO_AUTH} (proyecto ${PROYECTO})."
    echo "Si el guardado de Configuración falla, mire el motivo exacto en: ${TMP}/firestore.log"
    wait; exit 0
  fi
  sleep 1
done
echo "Los emuladores no respondieron. Revise ${TMP}/firestore.log y ${TMP}/auth.log"; exit 1
