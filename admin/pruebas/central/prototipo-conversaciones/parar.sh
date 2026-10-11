#!/usr/bin/env bash
# Apaga lo que levantó arrancar.sh (Firestore, Auth y la consola).
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVO="$AQUI/.estado/pids"
[[ -s "$ARCHIVO" ]] || { echo "No hay nada registrado como levantado."; exit 0; }
while read -r pid nombre; do
  # El proceso arrancado puede haber dejado hijos (java, node): se apagan primero.
  pkill -TERM -P "$pid" 2>/dev/null || true
  if kill "$pid" 2>/dev/null; then echo "  apagado: $nombre ($pid)"; fi
done < "$ARCHIVO"
rm -f "$ARCHIVO"
