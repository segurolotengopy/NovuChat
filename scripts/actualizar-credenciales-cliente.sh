#!/usr/bin/env bash
# =============================================================================
# actualizar-credenciales-cliente.sh — pone en las credenciales de n8n que YA
# usan los flujos de un cliente los valores de su .env actual (App ID, App
# Secret, token y WABA), sin mostrarlos y sin cambiar ningún nodo.
#
# POR QUÉ EXISTE (21/09/2026, Platinum pasa a su propia WABA). Cuando un
# cliente cambia de app de Meta, los flujos son los mismos: lo único que cambia
# son los valores de dos credenciales (el disparador y el envío). Cambiarlas de
# nodo obligaría a tocar el JSON versionado y a reasignar nodo por nodo —la
# trampa del 15/09, cuando la credencial de ingesta terminó en los nodos que
# envían a Meta—. Actualizar los VALORES de la credencial deja cada nodo como
# está. La API pública de n8n 2.36.5 lo permite: PATCH /credentials/{id} con
# `isPartialData` (verificado en el paquete publicado).
#
# EL CERROJO. Una credencial de envío compartida por dos clientes, actualizada
# con el token de uno, deja al otro mandando con la app ajena. Antes de escribir
# se recorren TODOS los flujos de la instancia: si una credencial la usa algún
# flujo que no es de este cliente, no se escribe nada.
#
# Qué actualiza, por tipo:
#   whatsAppTriggerApi                  clientId = WA_APP_ID, clientSecret = WA_APP_SECRET
#   whatsAppApi                         accessToken = WA_TOKEN, businessAccountId = WABA_ID
#   httpHeaderAuth «Graph WhatsApp …»   Authorization: Bearer WA_TOKEN
# La credencial de ingesta (httpHeaderAuth de la plataforma) NO se toca: el
# alias y su secreto no cambian cuando cambia el número.
#
# SE CORRE EN LA TERMINAL DE UNA PERSONA o la corre Claude con el OK de Andres:
# lee valores de un .env pero no los imprime nunca. En seco (por defecto) solo
# muestra el plan: credenciales, nodos y flujos, por nombre e id.
#
#   ./scripts/actualizar-credenciales-cliente.sh --env-cliente .env.platinum \
#       --flujo-env .env.platinum-seguimientos --flujo-env .env.platinum-senas [--aplicar]
#
# --env-cliente   de dónde salen los valores nuevos y el flujo principal
#                 (N8N_WORKFLOW_ID)
# --flujo-env     otros entornos del mismo cliente: se toma su N8N_WORKFLOW_ID
# --flujo-id      o un id de flujo suelto
# --env-n8n       dónde están N8N_BASE_URL y N8N_API_KEY (por defecto .env)
# =============================================================================
set -euo pipefail

ENV_CLIENTE=""; ENV_N8N=".env"; APLICAR=0
FLUJOS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    --env-n8n)     ENV_N8N="$2"; shift 2 ;;
    --flujo-env)
      [ -f "$2" ] || { echo "✗ No existe $2" >&2; exit 2; }
      wf=$(grep -E '^N8N_WORKFLOW_ID=' "$2" | head -1 | cut -d= -f2- | tr -d '[:space:]"' || true)
      [ -n "$wf" ] || { echo "✗ $2 no tiene N8N_WORKFLOW_ID" >&2; exit 2; }
      FLUJOS+=("$wf"); shift 2 ;;
    --flujo-id)    FLUJOS+=("$2"); shift 2 ;;
    --aplicar)     APLICAR=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ENV_CLIENTE" ] && [ -f "$ENV_CLIENTE" ] || { echo "✗ Falta --env-cliente <archivo>" >&2; exit 2; }
[ -f "$ENV_N8N" ] || { echo "✗ Falta $ENV_N8N (N8N_BASE_URL y N8N_API_KEY)" >&2; exit 2; }

# CADA VALOR DE SU ARCHIVO, POR NOMBRE. No se cargan los .env enteros: el de la
# instancia (.env) es TAMBIÉN el entorno del Demo A y trae su propio WA_APP_ID
# y WABA_ID. Cargado después del cliente, los pisaba: la primera corrida en seco
# (21/09) anunció la app del Demo A para las credenciales de Platinum. Con
# --aplicar habría puesto la app de otro cliente en su disparador.
valor() { grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true; }
N8N_BASE_URL=$(valor "$ENV_N8N" N8N_BASE_URL); N8N_API_KEY=$(valor "$ENV_N8N" N8N_API_KEY)
WA_APP_ID=$(valor "$ENV_CLIENTE" WA_APP_ID); WA_APP_SECRET=$(valor "$ENV_CLIENTE" WA_APP_SECRET)
WA_TOKEN=$(valor "$ENV_CLIENTE" WA_TOKEN); WABA_ID=$(valor "$ENV_CLIENTE" WABA_ID)
PRINCIPAL=$(grep -E '^N8N_WORKFLOW_ID=' "$ENV_CLIENTE" | head -1 | cut -d= -f2- | tr -d '[:space:]"' || true)
[ -n "$PRINCIPAL" ] || { echo "✗ $ENV_CLIENTE no tiene N8N_WORKFLOW_ID" >&2; exit 2; }
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}" "${WA_APP_ID:?}" "${WA_TOKEN:?}" "${WABA_ID:?}"
if [ -z "${WA_APP_SECRET:-}" ]; then
  # En seco se muestra el plan igual; escribir sin el App Secret dejaría el
  # disparador sin poder validar la firma de Meta.
  [ "$APLICAR" = 1 ] && { echo "✗ WA_APP_SECRET no está en $ENV_CLIENTE: el disparador lo necesita" >&2; exit 2; }
  echo "! WA_APP_SECRET vacío en $ENV_CLIENTE: con --aplicar el script se niega."
fi

FLUJOS_OBJ="$PRINCIPAL ${FLUJOS[*]:-}" APLICAR="$APLICAR" \
  N8N_BASE_URL="$N8N_BASE_URL" N8N_API_KEY="$N8N_API_KEY" \
  WA_APP_ID="$WA_APP_ID" WA_APP_SECRET="${WA_APP_SECRET:-}" WA_TOKEN="$WA_TOKEN" WABA_ID="$WABA_ID" \
  python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error

BASE = os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1"
CLAVE = os.environ["N8N_API_KEY"]
OBJ = [f for f in os.environ["FLUJOS_OBJ"].split() if f]
APLICAR = os.environ["APLICAR"] == "1"
V, R, A, G, FIN = "\033[1;32m", "\033[1;31m", "\033[1;33m", "\033[0;90m", "\033[0m"

def api(metodo, ruta, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(BASE + ruta, data=datos, method=metodo,
        headers={"X-N8N-API-KEY": CLAVE, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode(errors="replace")[:300]
        return e.code, {"message": cuerpo}

# Todos los flujos de la instancia, para el cerrojo.
todos, cursor = [], None
while True:
    cod, pag = api("GET", "/workflows?limit=100" + (f"&cursor={cursor}" if cursor else ""))
    if cod != 200:
        print(f"{R}✗ n8n no devolvió los flujos (HTTP {cod}): {pag.get('message','')}{FIN}"); sys.exit(1)
    todos += pag.get("data", [])
    cursor = pag.get("nextCursor")
    if not cursor: break
por_id = {w["id"]: w for w in todos}
faltan = [f for f in OBJ if f not in por_id]
if faltan:
    print(f"{R}✗ No existen en n8n: {', '.join(faltan)}{FIN}"); sys.exit(1)

def es_objetivo(tipo, nombre):
    if tipo in ("whatsAppTriggerApi", "whatsAppApi"): return True
    return tipo == "httpHeaderAuth" and str(nombre or "").startswith("Graph WhatsApp")

uso = {}  # id de credencial -> {tipo, nombre, flujos:set, nodos:list}
for w in todos:
    for n in w.get("nodes", []):
        for tipo, c in (n.get("credentials") or {}).items():
            cid = c.get("id")
            if not cid: continue
            u = uso.setdefault(cid, {"tipo": tipo, "nombre": c.get("name", ""), "flujos": set(), "nodos": []})
            u["flujos"].add(w["id"])
            if w["id"] in OBJ: u["nodos"].append(f"{w['name']} › {n['name']}")

candidatas = {cid: u for cid, u in uso.items()
              if u["flujos"] & set(OBJ) and es_objetivo(u["tipo"], u["nombre"])}
print("Flujos del cliente:")
for f in OBJ:
    w = por_id[f]; print(f"  {f}  «{w['name']}»  activo: {w.get('active')}")
print()
if not candidatas:
    print(f"{R}✗ Esos flujos no usan ninguna credencial de disparador ni de envío.{FIN}"); sys.exit(1)

bloqueo = False
for cid, u in candidatas.items():
    ajenos = [por_id[f]["name"] for f in u["flujos"] if f not in OBJ]
    marca = f"{R}✗ COMPARTIDA{FIN}" if ajenos else f"{V}✓{FIN}"
    print(f"  {marca} {u['tipo']:<20} id={cid}  «{u['nombre']}»  ({len(u['nodos'])} nodos)")
    for x in u["nodos"]: print(f"      {G}{x}{FIN}")
    if ajenos:
        bloqueo = True
        for a in ajenos: print(f"      {R}también la usa: «{a}»{FIN}")
if bloqueo:
    print(f"\n{R}✗ NO SE ESCRIBIÓ NADA: una credencial la usa un flujo de otro cliente.{FIN}")
    print("  Actualizarla le cambiaría la app a ese otro cliente. Separarla primero.")
    sys.exit(1)

tipos = {u["tipo"] for u in candidatas.values()}
if "whatsAppTriggerApi" not in tipos:
    print(f"{A}! Ningún flujo del cliente usa un disparador: ¿falta --flujo-env del principal?{FIN}")

def datos_para(u):
    if u["tipo"] == "whatsAppTriggerApi":
        return {"clientId": os.environ["WA_APP_ID"], "clientSecret": os.environ["WA_APP_SECRET"]}
    if u["tipo"] == "whatsAppApi":
        return {"accessToken": os.environ["WA_TOKEN"], "businessAccountId": os.environ["WABA_ID"]}
    return {"name": "Authorization", "value": "Bearer " + os.environ["WA_TOKEN"]}

if not APLICAR:
    print(f"\n{G}Seco: no se escribió nada. Con --aplicar se actualizan los valores de esas "
          f"{len(candidatas)} credenciales con los de App …{os.environ['WA_APP_ID'][-4:]} y WABA …{os.environ['WABA_ID'][-4:]}.{FIN}")
    sys.exit(0)

mal = 0
for cid, u in candidatas.items():
    cod, resp = api("PATCH", f"/credentials/{cid}", {"data": datos_para(u), "isPartialData": True})
    if cod == 200:
        print(f"  {V}✓ actualizada{FIN} «{u['nombre']}» ({u['tipo']})")
    else:
        mal += 1
        print(f"  {R}✗ HTTP {cod}{FIN} «{u['nombre']}»: {str(resp.get('message',''))[:200]}")
if mal:
    print(f"\n{R}✗ {mal} credencial(es) sin actualizar. Las otras SÍ quedaron con los valores nuevos.{FIN}"); sys.exit(1)
print(f"\n{V}✓ Listo.{FIN} Siguiente: credenciales-flujo.sh para cada flujo, y verificar-meta.sh --env <cliente>.")
PY
