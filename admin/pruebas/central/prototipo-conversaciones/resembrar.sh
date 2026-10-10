#!/usr/bin/env bash
# Vuelve a sembrar los datos ficticios SIN reiniciar nada (con la hora de ahora:
# así «ventana por vencer» vuelve a estar por vencer). Requiere arrancar.sh en marcha.
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIRESTORE_EMULATOR_HOST=127.0.0.1:8701 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9701 \
  PROYECTO_EMULADOR=demo-novuchat-prototipo node "$AQUI/sembrar.mjs" 2>&1 | grep -v -E "MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings"
