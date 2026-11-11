#!/usr/bin/env python3
"""Resuelve por NOMBRE el id del flujo de alertas en `settings.errorWorkflow`.

Uso:  resolver-error-workflow.py <flujo.json> <lista-de-flujos.json> <salida.json>
      resolver-error-workflow.py --n8n <flujo.json> <salida.json>
            (pide la lista al n8n de N8N_BASE_URL con N8N_API_KEY, ambas del entorno del proceso;
             la clave viaja por la entrada estándar de curl, nunca en argv)

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
Si `settings.errorWorkflow` ya trae un id (p. ej. un .local.json preparado contra OTRO n8n), se
comprueba que sea el id del único flujo con ese nombre en el n8n destino; si no, FALLA. Un archivo
sin `errorWorkflow` sale idéntico (código 0). Se informan nombres, nunca ids.

Los flujos archivados se ignoran (campo `isArchived` o `archived` si la API lo trae). NO VERIFICADO
en n8n 2.36.5 que la API pública devuelva ese campo en `GET /workflows`; si no viene, no se filtra nada.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

MARCADOR = "REEMPLAZAR_ID_ERROR_WORKFLOW"
NOMBRE = "NovuChat — Error de envío incierto"


def fallar(motivo):
    print(f"✗ ABORTADO: {motivo}", file=sys.stderr)
    sys.exit(1)


def main(argv):
    if len(argv) == 4 and argv[1] == "--n8n":
        base, clave = (os.environ.get("N8N_BASE_URL") or "").rstrip("/"), os.environ.get("N8N_API_KEY") or ""
        if not base or not clave:
            fallar("para consultar n8n hacen falta N8N_BASE_URL y N8N_API_KEY")
        with tempfile.TemporaryDirectory() as tdir:
            lista = os.path.join(tdir, "lista.json")
            r = subprocess.run(["curl", "-s", "--max-time", "30", "-o", lista, "-w", "%{http_code}", "-H", "@-",
                                f"{base}/api/v1/workflows?limit=250"],
                               input=f"X-N8N-API-KEY: {clave}\n", capture_output=True, text=True)
            if r.stdout.strip() != "200":
                fallar(f"n8n no entregó la lista de flujos (HTTP {r.stdout.strip() or '000'}); sin ella no se resuelve ni se comprueba el flujo de alertas")
            resolver(argv[2], lista, argv[3])
        return
    if len(argv) != 4:
        fallar("uso: resolver-error-workflow.py <flujo.json> <lista.json> <salida.json>  |  --n8n <flujo.json> <salida.json>")
    resolver(*argv[1:4])


def resolver(ruta_flujo, ruta_lista, ruta_salida):
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
    concreto = isinstance(ajustes, dict) and isinstance(ajustes.get("errorWorkflow"), str) \
        and ajustes.get("errorWorkflow") != MARCADOR and ajustes.get("errorWorkflow") != ""
    if en_ajustes or concreto:
        try:
            lista = json.load(open(ruta_lista, encoding="utf-8"))
        except Exception:
            fallar("n8n no entregó la lista de flujos; no se puede resolver el flujo de alertas")
        datos = lista.get("data") if isinstance(lista, dict) else None
        if not isinstance(datos, list):
            fallar("la lista de flujos de n8n no tiene la forma esperada")
        if lista.get("nextCursor"):
            fallar("la lista de flujos llegó partida (nextCursor); no se decide con una lista parcial")
        halladas = [w for w in datos if isinstance(w, dict) and w.get("name") == NOMBRE
                    and w.get("isArchived") is not True and w.get("archived") is not True]
        if not halladas:
            fallar(f"en el n8n destino no existe el flujo «{NOMBRE}»; cárguelo primero (scripts/cargar-alerta-n8n.sh)")
        if len(halladas) > 1:
            fallar(f"hay {len(halladas)} flujos llamados «{NOMBRE}» en el n8n destino; no se elige uno")
        id_ = halladas[0].get("id")
        if not isinstance(id_, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", id_):
            fallar(f"el id del flujo «{NOMBRE}» no tiene la forma esperada")
        if concreto:
            if ajustes["errorWorkflow"] != id_:
                fallar(f"settings.errorWorkflow no es el id del flujo «{NOMBRE}» de este n8n (archivo preparado contra otro n8n); vuelva a correr preparar-import.sh contra el destino")
            print(f"  = settings.errorWorkflow coincide con «{NOMBRE}» del n8n destino")
        else:
            ajustes["errorWorkflow"] = id_
            print(f"  + settings.errorWorkflow resuelto por nombre («{NOMBRE}»); el id no se muestra")
    with open(ruta_salida, "w", encoding="utf-8") as f:
        json.dump(flujo, f, ensure_ascii=False, indent=2)
        f.write("\n")


main(sys.argv)
