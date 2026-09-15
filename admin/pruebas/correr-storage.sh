#!/usr/bin/env bash
# Levanta los emuladores de Firestore Y Storage, corre las pruebas de
# storage.rules y los apaga.
#
# POR QUÉ ES DISTINTO DE correr.sh
# --------------------------------
# correr.sh invoca el jar de Firestore directamente para esquivar el CLI. Con
# Storage eso no se puede: el emulador de Storage está escrito dentro de
# firebase-tools (el jar que descarga es solo el motor de reglas) y únicamente
# arranca con el CLI. Además, las reglas de Storage leen la ficha del comercio
# con `firestore.get()`, y el emulador de Storage resuelve esa lectura contra
# el emulador de Firestore registrado EN EL MISMO PROCESO del CLI
# (firebase-tools, emulator/storage/rules/runtime.js, fetchFirestoreDocument).
# Por eso los dos van juntos en un solo `firebase emulators:exec`.
#
# CONFIGURACIÓN PROPIA, NO admin/firebase.json. Se genera un firebase.json
# temporal con puertos propios y solo lo que hace falta:
#   · sin reglas de Firestore en la configuración: las carga la prueba con
#     `initializeTestEnvironment`, y así el CLI no pone un vigilante de
#     inotify sobre firestore.rules (el ENOSPC documentado en
#     scripts/emuladores.sh);
#   · sin UI: no hace falta y es un puerto menos que puede chocar.
#
# Mismo cuidado que correr.sh con los puertos: si alguno ya responde, se corta
# en vez de correr contra un emulador ajeno (fallos aleatorios, 2026-09-08).
#
# Todo es local, con el proyecto ficticio `demo-*`: no usa ninguna sesión de
# Firebase ni de gcloud.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROYECTO="demo-novuchat-pruebas"
# Por defecto, puertos distintos de correr.sh (8231/9150) y de
# scripts/emuladores.sh (8232/9151/9299), para que convivan.
PUERTO_FS="${FIRESTORE_EMULATOR_PORT:-8233}"
PUERTO_WS="${FIRESTORE_EMULATOR_WS_PORT:-9152}"
PUERTO_ST="${STORAGE_EMULATOR_PORT:-9233}"
PUERTO_HUB="${EMULATOR_HUB_PORT:-4462}"
PUERTO_LOG="${EMULATOR_LOGGING_PORT:-4463}"

FIREBASE="$RAIZ/node_modules/.bin/firebase"
if [[ ! -x "$FIREBASE" ]]; then
  echo "No está firebase-tools en admin/node_modules (instale las dependencias: pnpm install)." >&2
  exit 1
fi

# Un puerto está ocupado si acepta una conexión TCP, sea lo que sea que escuche.
ocupado() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

for p in "$PUERTO_FS" "$PUERTO_WS" "$PUERTO_ST" "$PUERTO_HUB" "$PUERTO_LOG"; do
  if ocupado "$p"; then
    echo "✗ El puerto $p ya está en uso." >&2
    echo "  Probablemente sea otra sesión u otro worktree. Correr las pruebas" >&2
    echo "  contra un emulador ajeno da fallos aleatorios, no un diagnóstico." >&2
    echo >&2
    echo "  Use puertos propios, por ejemplo:" >&2
    echo "    FIRESTORE_EMULATOR_PORT=8703 FIRESTORE_EMULATOR_WS_PORT=9163 \\" >&2
    echo "    STORAGE_EMULATOR_PORT=9203 EMULATOR_HUB_PORT=4503 EMULATOR_LOGGING_PORT=4603 \\" >&2
    echo "    bash pruebas/correr-storage.sh" >&2
    exit 1
  fi
done

TMP="$(mktemp -d "$RAIZ/pruebas/.emu-storage.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
# La copia de las reglas vive junto a la configuración: el CLI resuelve la ruta
# relativa al directorio del firebase.json. Las pruebas cargan el ORIGINAL
# (admin/storage.rules) con initializeTestEnvironment, que reemplaza a éstas.
cp "$RAIZ/storage.rules" "$TMP/storage.rules"
cat > "$TMP/firebase.json" <<JSON
{
  "storage": { "rules": "storage.rules" },
  "emulators": {
    "firestore": { "host": "127.0.0.1", "port": ${PUERTO_FS}, "websocketPort": ${PUERTO_WS} },
    "storage":   { "host": "127.0.0.1", "port": ${PUERTO_ST} },
    "hub":       { "host": "127.0.0.1", "port": ${PUERTO_HUB} },
    "logging":   { "host": "127.0.0.1", "port": ${PUERTO_LOG} },
    "ui":        { "enabled": false },
    "singleProjectMode": true
  }
}
JSON

# La prueba se SALTA si no ve STORAGE_EMULATOR_PORT: así `correr.sh`, que corre
# todas las suites solo con Firestore, no se rompe.
export STORAGE_EMULATOR_PORT="$PUERTO_ST"
export FIRESTORE_EMULATOR_PORT="$PUERTO_FS"

cd "$RAIZ"
"$FIREBASE" emulators:exec \
  --config "$TMP/firebase.json" \
  --project "$PROYECTO" \
  --only firestore,storage \
  "npx vitest run pruebas/storage-reglas.test.ts $*"
