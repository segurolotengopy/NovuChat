#!/usr/bin/env bash
# =============================================================================
# Levanta TODO el prototipo de Conversaciones, con puertos propios, y lo siembra:
#
#   Firestore (jar)  127.0.0.1:8701      Auth (CLI)  127.0.0.1:9701
#   Consola (Vite)   http://127.0.0.1:5731
#
# Puertos DISTINTOS de los del resto del repo (8231/8232/9299/5230) para que
# conviva con otras sesiones y worktrees. Todo es local, con un proyecto ficticio
# «demo-…»: no usa ninguna sesión de Firebase ni de gcloud y no toca la nube.
#
# POR QUÉ EL JAR Y NO `firebase emulators:start` PARA FIRESTORE: igual que
# scripts/emuladores.sh, el vigilante de archivos del CLI falla en esta máquina
# (inotify). Firestore se arranca por el jar; Auth, que no vigila archivos, por
# el CLI.
#
# Los registros y los pid quedan en .estado/ (ignorado por git). Para apagar:
#   bash parar.sh
# =============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"          # …/admin
ESTADO="$AQUI/.estado"
PROYECTO="demo-novuchat-prototipo"
PUERTO_FS=8701; PUERTO_WS=9702; PUERTO_AUTH=9701; PUERTO_WEB=5731

mkdir -p "$ESTADO"
if [[ -s "$ESTADO/pids" ]]; then
  echo "Ya hay un prototipo levantado (pids en $ESTADO/pids). Apáguelo antes con: bash $AQUI/parar.sh" >&2
  exit 1
fi
for p in $PUERTO_FS $PUERTO_AUTH $PUERTO_WEB; do
  if curl -s -o /dev/null "http://127.0.0.1:$p/" 2>/dev/null; then
    echo "El puerto $p ya responde: lo usa otra sesión. No se arranca para no mezclar datos." >&2
    exit 1
  fi
done

JAR="$(ls -1 "$HOME/.cache/firebase/emulators/"cloud-firestore-emulator-v*.jar 2>/dev/null | sort -V | tail -1 || true)"
[[ -n "$JAR" ]] || { echo "No hay jar del emulador de Firestore en ~/.cache/firebase/emulators/." >&2; exit 1; }
[[ -d "$RAIZ/node_modules" ]] || { echo "Falta instalar: cd $RAIZ && pnpm install" >&2; exit 1; }

esperar() {  # nombre url
  for _ in $(seq 1 90); do
    if curl -s -o /dev/null "$2" 2>/dev/null; then echo "  OK  $1"; return 0; fi
    sleep 1
  done
  echo "  --  $1 no respondió; mire los registros en $ESTADO/" >&2
  return 1
}
iniciar() {  # nombre registro comando...
  local nombre="$1" registro="$2"; shift 2
  nohup "$@" > "$ESTADO/$registro" 2>&1 &
  echo "$! $nombre" >> "$ESTADO/pids"
}

echo "Arrancando Firestore y Auth..."
cd "$RAIZ"
iniciar firestore firestore.log java -Duser.language=en -jar "$JAR" \
  --host 127.0.0.1 --port "$PUERTO_FS" --websocket_port "$PUERTO_WS" \
  --database-edition standard --project_id "$PROYECTO" \
  --rules "$RAIZ/firestore.rules" --single_project_mode true
iniciar auth auth.log "$RAIZ/node_modules/.bin/firebase" emulators:start --only auth \
  --project "$PROYECTO" --config "$AQUI/firebase.prototipo.json"
esperar Firestore "http://127.0.0.1:$PUERTO_FS/"
esperar Auth "http://127.0.0.1:$PUERTO_AUTH/emulator/v1/projects/$PROYECTO/config"

echo "Sembrando datos ficticios..."
FIRESTORE_EMULATOR_HOST="127.0.0.1:$PUERTO_FS" FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:$PUERTO_AUTH" \
  PROYECTO_EMULADOR="$PROYECTO" node "$AQUI/sembrar.mjs"

echo "Arrancando la consola en modo desarrollo..."
iniciar web web.log env \
  VITE_FIREBASE_API_KEY=clave-ficticia-de-emulador \
  VITE_FIREBASE_AUTH_DOMAIN="$PROYECTO.firebaseapp.com" \
  VITE_FIREBASE_PROJECT_ID="$PROYECTO" \
  VITE_FIREBASE_APP_ID=1:0:web:0 \
  VITE_USAR_EMULADORES=true \
  VITE_AUTH_EMULATOR_PORT="$PUERTO_AUTH" \
  VITE_FIRESTORE_EMULATOR_PORT="$PUERTO_FS" \
  pnpm --filter @novuchat/admin-web exec vite --host 127.0.0.1 --port "$PUERTO_WEB" --strictPort
esperar Consola "http://127.0.0.1:$PUERTO_WEB/"

echo
echo "LISTO. Abra  http://127.0.0.1:$PUERTO_WEB/ingresar"
echo "  Pestaña «Soy un comercio». Correo: admin.prototipo@ejemplo.com"
echo "  Contraseña: Prototipo-2026-ficticia"
echo "  Pantalla:   http://127.0.0.1:$PUERTO_WEB/negocio/comercio-prototipo/conversaciones"
