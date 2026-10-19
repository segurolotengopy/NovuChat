#!/usr/bin/env python3
"""Resetea SOLO las 3 fichas de prueba del chat de captacion NovuChat.

Uso (desde la copia base, con el entorno del chat cargado y sin imprimir nada):
  set -a; . ./.env.novuchat; set +a
  python3 -I scripts/resetear-fichas-chat-novuchat.py --sufijos A,B,C [--respaldo CLIENTES/NOVUCHAT] [--aplicar]

Lee N8N_BASE_URL / N8N_API_KEY / N8N_WORKFLOW_ID del entorno (no los imprime).
Nunca toca las fichas de prospectos: solo las que terminan en los sufijos dados.
Regla de Andres (11/10): se resetea antes de decir «pueden probar» y se le avisa.
Seco por defecto; --aplicar escribe. Antes de escribir, respalda el estado
completo (modo 600). Solo cambia staticData: nodos, conexiones y settings se
reescriben TAL CUAL estan publicados. Verifica al final releyendo el flujo.
"""
import datetime, json, os, sys, urllib.request

def opcion(nombre):
    return sys.argv[sys.argv.index(nombre) + 1] if nombre in sys.argv else None


# Los 8 digitos finales de los telefonos de prueba van por argumento, nunca en el
# repositorio (es publico): --sufijos aaaaaaaa,bbbbbbbb,cccccccc
SUFIJOS = tuple(x for x in (opcion("--sufijos") or "").split(",") if x)
if not SUFIJOS or any(not (x.isdigit() and len(x) == 8) for x in SUFIJOS):
    sys.exit("✗ Falta --sufijos con los 8 digitos finales de cada telefono de prueba, separados por coma.")
# Son las 3 fichas de prueba, ni una mas: un cuarto sufijo (o uno repetido) es
# casi seguro un telefono de un prospecto pegado por error.
if len(SUFIJOS) > 3 or len(set(SUFIJOS)) != len(SUFIJOS):
    sys.exit("✗ --sufijos admite como maximo 3 sufijos distintos (las 3 fichas de prueba).")
APLICAR = "--aplicar" in sys.argv
DESTINO = opcion("--respaldo") or "."

base = os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1"
wid = os.environ["N8N_WORKFLOW_ID"]
cab = {"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Content-Type": "application/json"}


def llamar(metodo, cuerpo=None):
    req = urllib.request.Request(f"{base}/workflows/{wid}", method=metodo, headers=cab,
                                 data=json.dumps(cuerpo, ensure_ascii=False).encode() if cuerpo else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.load(r)


_, vivo = llamar("GET")
sd = vivo.get("staticData") or {}
mapa = (sd.get("global") or {}).get("chatNovuchat")
if not isinstance(mapa, dict):
    sys.exit("✗ No hay staticData.global.chatNovuchat: no se toca nada.")

claves = list(mapa)
objetivo = [k for k in claves if any(str(k).endswith(s) for s in SUFIJOS)]
# Un sufijo que coincide con mas de una ficha es ambiguo (dos telefonos con los
# mismos 8 digitos finales): no se adivina cual es la de prueba, no se borra nada.
for s in SUFIJOS:
    n = sum(1 for k in claves if str(k).endswith(s))
    if n > 1:
        sys.exit(f"✗ El sufijo …{s[-4:]} coincide con {n} fichas: es ambiguo, no se toca nada.")
print(f"Flujo vivo : {vivo.get('name')}  activo={vivo.get('active')}  nodos={len(vivo['nodes'])}")
print(f"Fichas totales: {len(claves)}   a borrar: {len(objetivo)}   se conservan: {len(claves) - len(objetivo)}")
for k in objetivo:
    f = mapa[k] if isinstance(mapa[k], dict) else {}
    print(f"  borrar …{str(k)[-4:]}  campos={len(f)}")
sufijos_hallados = {s for s in SUFIJOS if any(str(k).endswith(s) for k in objetivo)}
for s in SUFIJOS:
    if s not in sufijos_hallados:
        print(f"  (…{s[-4:]} no tenia ficha)")

if not APLICAR:
    print("\nSeco: no se escribio nada. Agregue --aplicar.")
    sys.exit(0)
if not objetivo:
    print("\nNada que borrar.")
    sys.exit(0)

sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
ruta = os.path.join(DESTINO, f"respaldo-estado-chat-novuchat-{sello}.local.json")
fd = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(sd, f, ensure_ascii=False, indent=2)
print(f"\nRespaldo del estado completo: {ruta}")

nuevo = json.loads(json.dumps(sd))
for k in objetivo:
    del nuevo["global"]["chatNovuchat"][k]
cod, _ = llamar("PUT", {"name": vivo["name"], "nodes": vivo["nodes"], "connections": vivo["connections"],
                        "settings": vivo.get("settings", {}), "staticData": nuevo})
print(f"PUT HTTP {cod}")

_, despues = llamar("GET")
m2 = ((despues.get("staticData") or {}).get("global") or {}).get("chatNovuchat") or {}
quedan = [k for k in m2 if any(str(k).endswith(s) for s in SUFIJOS)]
perdidas = set(claves) - set(objetivo) - set(m2)
print(f"Verificacion: fichas ahora={len(m2)}  de prueba que quedan={len(quedan)}  otras perdidas={len(perdidas)}")
print(f"Flujo activo tras el PUT: {despues.get('active')}")
sys.exit(0 if not quedan and not perdidas else 1)
