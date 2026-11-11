#!/usr/bin/env python3
"""Resuelve por NOMBRE el id del flujo de alertas en `settings.errorWorkflow`.

Uso:  resolver-error-workflow.py <flujo.json> <lista-de-flujos.json> <salida.json>

El JSON versionado de un flujo con relé lleva
`"settings": {"errorWorkflow": "REEMPLAZAR_ID_ERROR_WORKFLOW"}`: el id lo asigna
n8n y nunca se versiona. Esta pieza lo busca por nombre en la lista que devolvió
`GET /api/v1/workflows` del n8n DESTINO y escribe el id en la copia de salida.

FALLA (código 1, sin escribir la salida) si:
  - la lista no es legible, o llegó partida (`nextCursor`);
  - el flujo «NovuChat — Error de envío incierto» no existe en ese n8n;
  - existe más de uno con ese nombre (no se elige uno);
  - el id que devuelve n8n no tiene la forma esperada;
  - el marcador aparece en otro lugar que no sea `settings.errorWorkflow`.
Un archivo sin el marcador sale idéntico (código 0). Se informan nombres, nunca ids.
"""
import json
import re
import sys

MARCADOR = "REEMPLAZAR_ID_ERROR_WORKFLOW"
NOMBRE = "NovuChat — Error de envío incierto"


def fallar(motivo):
    print(f"✗ ABORTADO: {motivo}", file=sys.stderr)
    sys.exit(1)


def main(argv):
    if len(argv) != 4:
        fallar("uso: resolver-error-workflow.py <flujo.json> <lista.json> <salida.json>")
    ruta_flujo, ruta_lista, ruta_salida = argv[1:4]
    try:
        flujo = json.load(open(ruta_flujo, encoding="utf-8"))
    except Exception:
        fallar("el flujo no es un JSON legible")
    ajustes = flujo.get("settings") if isinstance(flujo, dict) else None
    en_ajustes = isinstance(ajustes, dict) and ajustes.get("errorWorkflow") == MARCADOR
    # El marcador solo es válido en settings.errorWorkflow.
    sin_ajuste = json.loads(json.dumps(flujo))
    if en_ajustes:
        del sin_ajuste["settings"]["errorWorkflow"]
    if MARCADOR in json.dumps(sin_ajuste, ensure_ascii=False):
        fallar(f"el marcador {MARCADOR} aparece fuera de settings.errorWorkflow")
    if en_ajustes:
        try:
            lista = json.load(open(ruta_lista, encoding="utf-8"))
        except Exception:
            fallar("n8n no entregó la lista de flujos; no se puede resolver el flujo de alertas")
        datos = lista.get("data") if isinstance(lista, dict) else None
        if not isinstance(datos, list):
            fallar("la lista de flujos de n8n no tiene la forma esperada")
        if lista.get("nextCursor"):
            fallar("la lista de flujos llegó partida (nextCursor); no se decide con una lista parcial")
        halladas = [w for w in datos if isinstance(w, dict) and w.get("name") == NOMBRE]
        if not halladas:
            fallar(f"en el n8n destino no existe el flujo «{NOMBRE}»; cárguelo primero (scripts/cargar-alerta-n8n.sh)")
        if len(halladas) > 1:
            fallar(f"hay {len(halladas)} flujos llamados «{NOMBRE}» en el n8n destino; no se elige uno")
        id_ = halladas[0].get("id")
        if not isinstance(id_, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", id_):
            fallar(f"el id del flujo «{NOMBRE}» no tiene la forma esperada")
        ajustes["errorWorkflow"] = id_
        print(f"  + settings.errorWorkflow resuelto por nombre («{NOMBRE}»); el id no se muestra")
    with open(ruta_salida, "w", encoding="utf-8") as f:
        json.dump(flujo, f, ensure_ascii=False, indent=2)
        f.write("\n")


main(sys.argv)
