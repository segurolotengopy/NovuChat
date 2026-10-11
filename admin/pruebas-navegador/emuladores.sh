#!/usr/bin/env bash
# =============================================================================
# Levanta los emuladores de Auth y Firestore PARA LAS PRUEBAS DE NAVEGADOR, en puertos propios
# (Firestore 8332, Auth 9399), distintos de los de `scripts/emuladores.sh` (8232, 9299): las dos cosas pueden convivir.
# Con `E2E_CARRIL=2` (1 a 4) los puertos se desplazan 20: así varios carriles corren a la vez sin pisarse.
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
# Carril (`E2E_CARRIL=1..4`): suma carril×10 a los puertos, igual que `entorno.ts`; cada carril tiene sus propios emuladores.
CARRIL="${E2E_CARRIL:-0}"
[[ "$CARRIL" =~ ^[0-4]$ ]] || { echo "E2E_CARRIL tiene que ser un solo dígito de 0 a 4."; exit 1; }
D=$((CARRIL * 10))
PUERTO_FS=$((8332 + D)); PUERTO_WS=$((9251 + D)); PUERTO_AUTH=$((9399 + D))
PUERTO_HUB=$((4400 + D)); PUERTO_LOG=$((4500 + D))

JAR="$(ls -1 "$HOME/.cache/firebase/emulators/"cloud-firestore-emulator-v*.jar 2>/dev/null | sort -V | tail -1 || true)"
[[ -n "$JAR" ]] || { echo "No hay jar del emulador de Firestore. Una sola vez:  firebase setup:emulators:firestore"; exit 1; }

TMP="$(mktemp -d)"
cat > "$TMP/firebase.json" <<JSON
{ "emulators": { "auth": { "port": ${PUERTO_AUTH}, "host": "127.0.0.1" }, "hub": { "port": ${PUERTO_HUB}, "host": "127.0.0.1" }, "logging": { "port": ${PUERTO_LOG}, "host": "127.0.0.1" }, "ui": { "enabled": false }, "singleProjectMode": true } }
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
