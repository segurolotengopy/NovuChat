#!/usr/bin/env bash
# =============================================================================
# acciones-sensibles.sh — control PreToolUse de los comandos Bash de NovuChat.
# =============================================================================
#
# Decisión de Andres (14/09/2026): los agentes PUEDEN ejecutar lo que escribe en
# producción, en Meta o en GitHub, pero SOLO con confirmación humana en el
# momento. Este control lo hace cumplir para cualquier agente y para la sesión
# principal: un permiso escrito en una instrucción se puede olvidar; un control
# automático, no.
#
#   deny  -> nunca, ni con confirmación (prohibiciones de CLAUDE.md, estado
#            compartido entre sesiones, secretos que pasarían por el modelo).
#   ask   -> pide confirmación a la persona (escribe en producción, Meta o GitHub).
#   nada  -> sigue la evaluación normal de permisos de settings.json.
#
# LAS PROHIBICIONES MIRAN LA ACCIÓN, NO LA MENCIÓN. La primera versión negaba
# cualquier comando que nombrara el sistema ajeno, y bloqueó hasta un `grep` de
# la documentación. Ahora niega solo cuando el comando además actúa: red, nube,
# despliegue, GitHub, contenedores o instalación.
#
# Recibe por stdin el JSON del evento (tool_name, tool_input.command) y responde
# por stdout con hookSpecificOutput.permissionDecision. Sale siempre con 0: un
# fallo de este script no debe dejar la herramienta en un estado indefinido, y
# las reglas `deny` de settings.json siguen vigentes igual.
set -uo pipefail

python3 -c '
import json, re, sys

try:
    evento = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if evento.get("tool_name") != "Bash":
    sys.exit(0)
cmd = str((evento.get("tool_input") or {}).get("command") or "")

# Un comando que ACTÚA fuera de la máquina o instala algo.
ACTUA = r"\b(curl|wget|ssh|scp|docker|systemctl|gcloud|gh|firebase|npm\s+(i|install)|pnpm\s+(add|install)|pip\s+install|git\s+clone)\b|--aplicar|--suscribir|publicar-flujo|subscribed_apps"
# CON EL ESPACIO de «SeguroLo Tengo», a propósito: el dueño del repositorio en
# GitHub se llama `segurolotengopy`, y la primera versión («SeguroLo» a secas,
# sin distinguir mayúsculas) negaba cualquier `gh` que nombrara el repositorio.
SISTEMA_AJENO = r"SeguroLo\s+Tengo|otp-service|WhatsApp-Modular"
CANAL_NO_OFICIAL = r"evolution[-_ ]?api|baileys|wppconnect"

NUNCA = [
    (lambda c: re.search(SISTEMA_AJENO, c, re.I) and re.search(ACTUA, c),
     "Prohibición 5 de CLAUDE.md: la app Demo SeguroLo Tengo, el otp-service y WhatsApp-Modular no se tocan."),
    (lambda c: re.search(CANAL_NO_OFICIAL, c, re.I) and re.search(ACTUA, c),
     "Prohibición 1 de CLAUDE.md: el único canal es la Cloud API oficial de Meta."),
    (lambda c: re.search(r"\bgh\s+auth\s+switch\b|\bgcloud\s+config\s+set\b", c),
     "Cambia la identidad compartida por todas las sesiones. Use la variable de entorno por comando (GH_CONFIG_DIR, CLOUDSDK_CONFIG)."),
    (lambda c: re.search(r"\bgcloud\s+secrets\s+versions\s+access\b", c),
     "El valor de un secreto no debe pasar por el modelo. Que lo corra una persona en su terminal."),
    (lambda c: re.search(r"\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b)", c),
     "Push forzado prohibido."),
]
CONFIRMAR = [
    (r"(^|\s)--aplicar(\s|$)", "Escribe en producción (Firestore, Auth o n8n)."),
    (r"verificar-meta\.sh\b.*--suscribir", "Escribe en Meta: suscribe la app a la WABA."),
    (r"\bgh\s+pr\s+(merge|close)\b|\bgh\s+workflow\s+run\b", "Cambia GitHub: fusión, cierre o ejecución de un workflow."),
    (r"\bgit\s+push\b", "Publica en GitHub."),
    (r"\bfirebase\s+deploy\b|\bdeploy\.sh\b", "Despliega."),
]

def responder(decision, motivo):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": motivo,
    }}, ensure_ascii=False))
    sys.exit(0)

for condicion, motivo in NUNCA:
    if condicion(cmd):
        responder("deny", motivo)
for patron, motivo in CONFIRMAR:
    if re.search(patron, cmd):
        responder("ask", motivo + " Requiere confirmación humana (decisión del 14/09/2026).")
'
exit 0
