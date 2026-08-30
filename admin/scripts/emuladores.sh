#!/usr/bin/env bash
# =============================================================================
# Levanta los emuladores de Auth y Firestore para trabajar A MANO con el panel.
# =============================================================================
#
# POR QUÉ NO ES UN SIMPLE `firebase emulators:start`
# --------------------------------------------------
# En esta máquina `firebase emulators:start --only auth,firestore` FALLA. El
# emulador de Firestore hace que el CLI ponga un vigilante de `chokidar` sobre
# `firestore.rules` (para recargar las reglas en caliente), y ese vigilante no se
# puede crear porque el kernel llegó al límite de INSTANCIAS de inotify:
#
#     Error: ENOSPC: System limit for number of file watchers reached,
#            watch '.../admin/firestore.rules'
#
# El CLI lo tapa con un «Error: An unexpected error has occurred.» genérico, que
# durante un buen rato se interpretó como «puerto ocupado». No lo es.
# El arreglo definitivo lo tiene que hacer Andres con sudo (ver LEEME.md).
#
# Mientras tanto, este script esquiva el problema partiendo el arranque:
#   · Firestore  -> se invoca el jar DIRECTAMENTE, sin CLI y sin vigilante.
#   · Auth       -> `firebase emulators:start --only auth`, que al no tener
#                   reglas que vigilar arranca sin tocar inotify.
#
# Contrapartida a saber: como Firestore no pasa por el hub, **la interfaz del
# emulador (puerto 4231) muestra solo Authentication**. Los datos de Firestore se
# ven en el panel, que es de lo que se trata.
#
# Todo es 100 % local, con un proyecto ficticio `demo-*`. No usa ninguna sesión
# de Firebase ni de gcloud, y no toca ningún recurso en la nube.
# =============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROYECTO="${PROYECTO_EMULADOR:-demo-novuchat-panel}"
# Puertos DISTINTOS de los de `pruebas/correr.sh` (8231/9150), para que se
# pueda dejar este entorno levantado y correr `pnpm pruebas:reglas` igual.
PUERTO_FS="${FIRESTORE_EMULATOR_PORT:-8232}"
PUERTO_WS="${FIRESTORE_EMULATOR_WS_PORT:-9151}"
PUERTO_AUTH="${AUTH_EMULATOR_PORT:-9299}"

azul()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
rojo()  { printf '\033[1;31m%s\033[0m\n' "$*"; }

# --- Diagnóstico temprano de inotify -----------------------------------------
# `|| true` en los dos: /proc tiene descriptores de procesos ajenos que no se
# pueden leer, así que `find` sale con codigo distinto de cero. Sin esto,
# `set -e` mas `pipefail` matan el script antes de imprimir una sola linea.
LIMITE=$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || echo 0)
USADAS=$( { find /proc/*/fd -lname 'anon_inode:inotify' 2>/dev/null || true; } | wc -l )
if [[ "$LIMITE" -gt 0 && "$USADAS" -ge $((LIMITE - 8)) ]]; then
  rojo "AVISO: instancias de inotify en uso: ${USADAS} de ${LIMITE}."
  rojo "El emulador de Auth puede fallar con «An unexpected error has occurred»."
  rojo "Arreglo (una sola vez, requiere sudo):"
  rojo "  echo 'fs.inotify.max_user_instances=1024' | sudo tee /etc/sysctl.d/99-inotify.conf"
  rojo "  sudo sysctl --system"
  echo
fi

JAR="$(ls -1 "$HOME/.cache/firebase/emulators/"cloud-firestore-emulator-v*.jar 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$JAR" ]]; then
  rojo "No hay jar del emulador de Firestore en ~/.cache/firebase/emulators/."
  rojo "Descárguelo una vez con:  firebase setup:emulators:firestore"
  exit 1
fi

PIDS=()
limpiar() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap limpiar EXIT INT TERM

# --- Firestore, por el jar ---------------------------------------------------
azul "Arrancando Firestore en 127.0.0.1:${PUERTO_FS} ..."
java -Duser.language=en -jar "$JAR" \
  --host 127.0.0.1 --port "$PUERTO_FS" --websocket_port "$PUERTO_WS" \
  --database-edition standard --project_id "$PROYECTO" \
  --rules "$RAIZ/firestore.rules" --single_project_mode true \
  > "$RAIZ/firestore-emulador.log" 2>&1 &
PIDS+=($!)

# --- Auth, por el CLI --------------------------------------------------------
azul "Arrancando Auth en 127.0.0.1:${PUERTO_AUTH} ..."
( cd "$RAIZ" && firebase emulators:start --only auth --project "$PROYECTO" ) \
  > "$RAIZ/auth-emulador.log" 2>&1 &
PIDS+=($!)

esperar() {
  local nombre="$1" url="$2"
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then verde "  OK  ${nombre} listo"; return 0; fi
    sleep 1
  done
  rojo "  --  ${nombre} no respondio. Revise ${RAIZ}/*-emulador.log"
  return 1
}

esperar "Firestore" "http://127.0.0.1:${PUERTO_FS}/"
esperar "Auth" "http://127.0.0.1:${PUERTO_AUTH}/emulator/v1/projects/${PROYECTO}/config"

# --- Configuración del frontend para apuntar a los emuladores ----------------
# `web/.env.local` está en .gitignore. Ninguno de estos valores es secreto: con
# un proyecto `demo-*` el SDK ni siquiera valida la clave.
cat > "$RAIZ/web/.env.local" <<ENV
VITE_FIREBASE_API_KEY=clave-ficticia-de-emulador
VITE_FIREBASE_AUTH_DOMAIN=${PROYECTO}.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=${PROYECTO}
VITE_FIREBASE_APP_ID=1:0:web:0
VITE_APPCHECK_SITE_KEY=sin-appcheck-en-emuladores
VITE_USAR_EMULADORES=true
VITE_AUTH_EMULATOR_PORT=${PUERTO_AUTH}
VITE_FIRESTORE_EMULATOR_PORT=${PUERTO_FS}
ENV

echo
verde "Emuladores en marcha."
echo "  Firestore              127.0.0.1:${PUERTO_FS}"
echo "  Auth                   127.0.0.1:${PUERTO_AUTH}"
echo "  Interfaz del emulador  http://127.0.0.1:4231/auth   (solo Auth, ver arriba)"
echo
echo "En OTRA terminal:"
echo "  cd admin && pnpm sembrar     # carga los datos de prueba"
echo "  cd admin && pnpm web:dev     # arranca el panel en http://127.0.0.1:5230"
echo
echo "IMPORTANTE: al invocar el jar directamente se pierde la RECARGA EN CALIENTE"
echo "de firestore.rules, que la hacia el vigilante del CLI (el mismo que rompe"
echo "por inotify). Si edita las reglas, REINICIE este script o va a seguir"
echo "probando contra las anteriores."
echo
echo "Ctrl-C aca apaga los dos emuladores."
wait
