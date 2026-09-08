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

# EL PUERTO ES COMPARTIDO ENTRE WORKTREES, Y ESO YA COSTO UNA TARDE.
#
# Si otra sesion (otro worktree del mismo repo, otra terminal) ya tiene un
# emulador en este puerto, el `java` de abajo falla por puerto ocupado, el
# `curl` de mas abajo responde 200 --contesta el emulador AJENO-- y las pruebas
# corren contra el, que ademas se limpia entre SUS pruebas. El resultado son
# fallos ALEATORIOS y distintos en cada corrida, casi todos PERMISSION_DENIED
# sobre documentos que la semilla si creo: la otra sesion los borro en el medio.
# Se diagnostico el 2026-09-08 despues de perseguirlo como si fuera un defecto
# de las reglas.
#
# Por eso: si el puerto ya responde, se corta con instrucciones en vez de correr
# contra un emulador que no es nuestro.
if curl -fsS -o /dev/null "http://127.0.0.1:${PUERTO}/" 2>/dev/null; then
  echo "✗ El puerto ${PUERTO} ya tiene un emulador." >&2
  echo "  Probablemente sea otra sesion o otro worktree. Correr las pruebas" >&2
  echo "  contra el da fallos aleatorios, no un diagnostico." >&2
  echo >&2
  echo "  Use un puerto propio:" >&2
  echo "    FIRESTORE_EMULATOR_PORT=8677 FIRESTORE_EMULATOR_WS_PORT=9677 bash pruebas/correr.sh" >&2
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
