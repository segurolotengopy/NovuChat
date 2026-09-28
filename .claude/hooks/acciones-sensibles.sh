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

# ---------------------------------------------------------------------------
# EL ENLACE DE CONTRASEÑA ES UNA CREDENCIAL (28/09/2026). alta-comercio.mjs y
# asignar-rol.mjs lo escriben en CLIENTES/<CLIENTE>/.enlaces/, y lo abre una
# persona. Acá NO se mira el verbo (cat, grep, sort, diff… son demasiados, y
# la primera versión dejaba pasar la mitad): se mira si algún ARGUMENTO del
# comando es una ruta a esa carpeta o a un archivo de enlace, con comodines
# incluidos, y cualquier comando que la reciba se niega. Una palabra con
# espacios de un git o un gh (el mensaje de un commit, el cuerpo de un PR) no es
# una ruta, y el texto de un heredoc de git o gh tampoco: así un commit que
# documenta la carpeta pasa. Un grep de la documentación con el patrón
# escapado (\.enlaces) tampoco es una ruta, y pasa.
#
# Y la búsqueda RECURSIVA que entraría a la carpeta sin nombrarla (grep -r
# sobre CLIENTES o sobre una carpeta que la contiene, rg con ocultos, find
# con -exec) se niega salvo que la excluya (--exclude-dir=.enlaces, -g !.enlaces).
#
# Límite honesto: con el mismo usuario del sistema una expresión regular no es
# una barrera completa. Es la red contra el agente que lo lee SIN QUERER; la
# defensa de fondo es que el enlace vence en horas y la persona borra el archivo.
# Revisión de seguridad del PR #254.
import fnmatch, os, shlex

CWD = str(evento.get("cwd") or os.getcwd())
CARPETA_ENLACES = re.compile(r"(^|/)\.enlaces(/|$)")
ARCHIVO_ENLACE = re.compile(r"(^|/)enlace-(admin|oper)-[a-z0-9-]+\.txt$")
MODELO = ["CLIENTES", "X", ".enlaces", "enlace-admin-x.txt"]
COMODIN = re.compile(r"[*?\[]")
PARTIR = re.compile(r"[\s\x27\"(),=:;`<>|&]+")
HEREDOC = re.compile(r"<<-?[ \t]*([\"\x27]?)(\w+)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
EXCLUYE = re.compile(r"^--exclude(-dir)?=|^--i?glob=!|^!")

def es_ruta_de_enlace(t):
    if CARPETA_ENLACES.search(t) or ARCHIVO_ENLACE.search(t):
        return True
    if not COMODIN.search(t):
        return False
    partes = [p for p in t.split("/") if p not in ("", ".")]
    for fin in (4, 3):  # la ruta termina en el archivo, o en la carpeta
        modelo = MODELO[:fin]
        k = min(len(partes), len(modelo))
        cola_t, cola_m = partes[-k:], modelo[-k:]
        if ".enlaces" not in cola_m:
            continue
        oculta = cola_t[cola_m.index(".enlaces")]
        # Un * de la shell no entra a una carpeta oculta: hace falta un «.» delante.
        if not oculta.startswith("."):
            continue
        if k < 2 and "enlace" not in t:
            continue  # un «.*» suelto es demasiado general para negarlo
        if all(fnmatch.fnmatchcase(m, p) for m, p in zip(cola_m, cola_t)):
            return True
    return False

def sin_heredoc_de_git(c):
    def cambio(m):
        linea = c[:m.start()].rsplit("\n", 1)[-1]
        tramo = [w for w in re.split(r"&&|\|\||;|\|", linea)[-1].split() if not re.match(r"^\w+=", w)]
        if tramo and tramo[0] in ("git", "gh"):
            return m.group(0).split("\n", 1)[0]
        return m.group(0)
    return HEREDOC.sub(cambio, c)

def comandos(c):
    lx = shlex.shlex(c, posix=True, punctuation_chars=True)
    lx.whitespace_split = True
    lx.commenters = ""
    todos, actual = [], []
    for t in lx:
        if t and set(t) <= set("();|&"):
            if actual:
                todos.append(actual)
            actual = []
        elif t and set(t) <= set("<>"):
            continue  # una redirección: su destino es otro argumento del mismo comando
        else:
            actual.append(t)
    if actual:
        todos.append(actual)
    return todos

def contiene_clientes(ruta):
    p = os.path.abspath(os.path.join(CWD, os.path.expanduser(ruta)))
    return "/CLIENTES" in p + "/" or os.path.isdir(os.path.join(p, "CLIENTES"))

def busqueda_recursiva(cabeza, args):
    if any(EXCLUYE.search(a) and ".enlaces" in a for a in args):
        return False
    opciones = [a for a in args if a.startswith("-")]
    rutas = [a for a in args if not a.startswith("-")]
    if cabeza in ("grep", "egrep", "fgrep"):
        recursiva = any(re.match(r"^-[a-zA-Z]*[rR]", o) or o in ("--recursive", "--dereference-recursive") for o in opciones)
        rutas = rutas[1:] or ["."]  # el primero es el patrón; sin rutas, busca en el directorio actual
    elif cabeza == "rg":
        recursiva = any(re.match(r"^-u+$|^-[a-zA-Z]*\.|^--hidden$|^--no-ignore", o) for o in opciones)
        rutas = rutas[1:] or ["."]
    elif cabeza == "find":
        recursiva = any(a in ("-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fls") for a in args)
        rutas = [a for a in rutas if not a.startswith("{")] or ["."]
    else:
        return False
    return recursiva and any(contiene_clientes(r) for r in rutas)

def toca_enlace(c):
    try:
        lista = comandos(sin_heredoc_de_git(c))
    except ValueError:
        # Comillas sin cerrar: no se puede partir, se decide sobre el texto crudo.
        return bool(re.search(r"(^|[/\s\x27\"])\.enlaces([/\s\x27\"]|$)|enlace-(admin|oper)-[a-z0-9-]+\.txt", c))
    for palabras in lista:
        sin_entorno = [w for w in palabras if not re.match(r"^\w+=", w)] or [""]
        cabeza, args = os.path.basename(sin_entorno[0]), sin_entorno[1:]
        for w in palabras:
            if re.search(r"\s", w) and cabeza in ("git", "gh"):
                continue
            if EXCLUYE.search(w):
                continue
            if any(es_ruta_de_enlace(p) for p in [w] + PARTIR.split(w) if p):
                return True
        if busqueda_recursiva(cabeza, args):
            return True
    return False

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
    # El enlace de contraseña: ver toca_enlace() arriba.
    (toca_enlace,
     "El enlace de contraseña es una credencial: lo abre una persona, nunca un agente (docs/alta-cliente/RUNBOOK.md, etapa 4)."),
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
