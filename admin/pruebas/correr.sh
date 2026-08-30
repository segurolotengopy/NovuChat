#!/usr/bin/env bash
# Levanta el emulador de Firestore, corre las pruebas de reglas y lo apaga.
#
# Por qué este script y no `firebase emulators:exec`: en algunos entornos el
# detector de arranque del CLI falla (reporta "port taken" aunque el puerto esté
# libre) y deja el proceso Java huérfano ocupando el puerto. Invocar el jar
# directamente es determinista y no necesita ninguna sesión de Firebase iniciada:
# el emulador es 100 % local y usa un proyecto ficticio `demo-*`.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUERTO="${FIRESTORE_EMULATOR_PORT:-8231}"
PUERTO_WS="${FIRESTORE_EMULATOR_WS_PORT:-9150}"
PROYECTO="demo-novuchat-pruebas"

JAR="$(ls -1 "$HOME/.cache/firebase/emulators/"cloud-firestore-emulator-v*.jar 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$JAR" ]]; then
  echo "No hay jar del emulador en ~/.cache/firebase/emulators/." >&2
  echo "Descárguelo una vez con: firebase setup:emulators:firestore" >&2
  exit 1
fi

java -Duser.language=en -jar "$JAR" \
  --host 127.0.0.1 --port "$PUERTO" --websocket_port "$PUERTO_WS" \
  --database-edition standard --project_id "$PROYECTO" \
  --rules "$RAIZ/firestore.rules" --single_project_mode true \
  > "$RAIZ/firestore-emulador.log" 2>&1 &
EMU_PID=$!
trap 'kill "$EMU_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PUERTO}/" 2>/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:${PUERTO}/" || { echo "El emulador no respondió."; exit 1; }

cd "$RAIZ" || exit 1
FIRESTORE_EMULATOR_PORT="$PUERTO" npx vitest run "$@"
