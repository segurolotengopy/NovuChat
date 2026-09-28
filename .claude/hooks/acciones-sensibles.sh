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
ACTUA = r"\b(curl|wget|ssh|scp|docker|systemctl|gcloud|gh|firebase|npm\s+(i|install)|pnpm\s+(add|install)|pip\s+install|git\s+clone)\b|--aplicar|--suscribir|publicar-flujo|subscribed_apps|/subscriptions\b"
# CON EL ESPACIO de «SeguroLo Tengo», a propósito: el dueño del repositorio en
# GitHub se llama `segurolotengopy`, y la primera versión («SeguroLo» a secas,
# sin distinguir mayúsculas) negaba cualquier `gh` que nombrara el repositorio.
# El receptor de clientes de AAB1 (prohibiciones 5 y 7, #260): la app y su
# contenedor, por su nombre exacto. «AAB1» a secas NO, por la misma razón que
# el espacio de arriba: aparece en títulos y cuerpos de PR que documentan B8.
# NovuChat llama a `/{app-id}/subscriptions` con SUS apps
# (`scripts/webhook-meta.sh`), así que esa ruta solo se niega junto a un nombre
# de acá. El separador del nombre admite guion, guion bajo, espacio o nada
# (Docker acepta `receptor_clientes`); «receptor de clientes» en prosa no
# coincide. Lo que una expresión regular no ve: comillas partidas en el nombre,
# el id del contenedor, y la app que llega por un `.env` o por su id numérico
# (`webhook-meta.sh --alta-meta --env-cliente …`); eso se cierra en el script.
SISTEMA_AJENO = r"SeguroLo\s+Tengo|otp-service|WhatsApp-Modular|AAB1[-_\s]?WA[-_\s]?Prod|receptor[-_\s]?clientes"
CANAL_NO_OFICIAL = r"evolution[-_ ]?api|baileys|wppconnect"

# ---------------------------------------------------------------------------
# EL ENLACE DE CONTRASEÑA ES UNA CREDENCIAL (28/09/2026). alta-comercio.mjs y
# asignar-rol.mjs lo escriben en CLIENTES/<CLIENTE>/.enlaces/, y lo abre una
# persona. Acá NO se mira el verbo (cat, grep, sort, diff… son demasiados, y
# la primera versión dejaba pasar la mitad): se mira si algún ARGUMENTO del
# comando es una ruta a esa carpeta o a un archivo de enlace, con comodines
# incluidos, y cualquier comando que la reciba se niega.
#
# No son rutas, y pasan: el texto de un -m, --message, --title o --body de git
# o gh, y un heredoc de git o gh (así un commit que documenta la carpeta
# pasa); el PATRÓN de un grep, rg o git grep; los argumentos de echo y printf;
# un git check-ignore; y un «.enlaces» sin barra que no existe donde se corre.
#
# Y el RECORRIDO que entraría a la carpeta sin nombrarla se niega salvo que la
# excluya (--exclude-dir=.enlaces, -g !.enlaces, --exclude=.enlaces): grep -r,
# rg con ocultos, find con -exec o hacia xargs, cp -r, rsync, tar, zip y scp,
# sobre CLIENTES/, sobre cualquier carpeta dentro de ella o sobre cualquier
# carpeta que la contenga (la copia principal, el directorio personal). Se
# sigue el «cd» de los tramos anteriores del mismo comando.
#
# Límite honesto: con el mismo usuario del sistema una expresión regular no es
# una barrera completa. Es la red contra el agente que lo lee SIN QUERER; la
# defensa de fondo es que el enlace vence en horas y la persona borra el archivo.
# Revisiones de seguridad del PR #254 (H1, H3; N1 a N5).
import fnmatch, os, shlex, subprocess

CWD = str(evento.get("cwd") or os.getcwd())
CARPETA_ENLACES = re.compile(r"(^|/)\.enlaces(/|$)")
ARCHIVO_ENLACE = re.compile(r"(^|/)enlace-(admin|oper)-[a-z0-9-]+\.txt$")
# None: cualquier nombre de cliente (BELLIDO, RUBEN_ROCA…), literal o comodín.
MODELO = ["CLIENTES", None, ".enlaces", "enlace-admin-x.txt"]
COMODIN = re.compile(r"[*?\[]")
PARTIR = re.compile(r"[\s\x27\"(),=:;`<>|&]+")
HEREDOC = re.compile(r"<<-?[ \t]*([\"\x27]?)(\w+)\1[^\n]*\n.*?\n[ \t]*\2[ \t]*(?=\n|$)", re.S)
TEXTO_DE_GIT = {"-m", "--message", "--title", "-t", "--body", "-b", "--notes"}
CON_VALOR = {"-m", "--max-count", "-A", "-B", "-C", "-t", "-T", "--type", "--type-not",
             "--include", "--exclude", "--exclude-dir", "-g", "--glob", "--iglob"}

def es_ruta_de_enlace(t, cwd):
    if CARPETA_ENLACES.search(t):
        # Un «.enlaces» suelto es texto, salvo que exista donde se corre o que
        # se corra dentro de una carpeta de CLIENTES/.
        return ("/" in t or os.path.lexists(os.path.join(cwd, t))
                or "/CLIENTES/" in os.path.realpath(cwd) + "/")
    if ARCHIVO_ENLACE.search(t):
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
        if all(m is None or fnmatch.fnmatchcase(m, p) for m, p in zip(cola_m, cola_t)):
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

_clientes = []
def clientes_real():
    """CLIENTES/ de la copia principal (la del .git común), o vacío."""
    if not _clientes:
        r = ""
        try:
            base = os.environ.get("CLAUDE_PROJECT_DIR") or CWD
            env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
            comun = subprocess.run(["git", "-C", base, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                   capture_output=True, text=True, timeout=5, env=env).stdout.strip()
            if comun:
                r = os.path.realpath(os.path.join(os.path.dirname(comun), "CLIENTES"))
        except Exception:
            pass
        _clientes.append(r)
    return _clientes[0]

def alcanza_clientes(ruta, cwd):
    p = os.path.realpath(os.path.join(cwd, os.path.expanduser(ruta)))
    if "/CLIENTES/" in p + "/" or os.path.isdir(os.path.join(p, "CLIENTES")):
        return True
    c = clientes_real()
    return bool(c) and os.path.commonpath([p, c]) in (p, c)

def excluye_enlaces(args):
    for i, a in enumerate(args):
        valor = a.split("=", 1)[1] if "=" in a else (args[i + 1] if i + 1 < len(args) else "")
        if re.match(r"^--exclude(-dir)?(=|$)", a) and ".enlaces" in valor:
            return True
        if re.match(r"^(-g|--i?glob)(=|$)", a) and valor.startswith("!") and ".enlaces" in valor:
            return True
        if a == "-path" and ".enlaces" in valor and "-prune" in args:
            return True
    return False

def partir_busqueda(args):
    """(patrones, rutas) de un grep, un rg o un git grep."""
    patrones, rutas, con_e, i = [], [], False, 0
    while i < len(args):
        a = args[i]
        if a in ("-e", "--regexp", "-f", "--file"):
            con_e = True
            patrones += args[i + 1:i + 2]
            i += 2
        elif a.startswith("--regexp=") or a.startswith("--file="):
            con_e = True
            patrones.append(a.split("=", 1)[1])
            i += 1
        elif a in CON_VALOR:
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            rutas.append(a)
            i += 1
    if not con_e and rutas:
        patrones.append(rutas.pop(0))
    return patrones, rutas

def recorre_clientes(cabeza, args, cwd, hacia_xargs):
    if excluye_enlaces(args):
        return False
    opciones = [a for a in args if a.startswith("-")]
    if cabeza in ("grep", "egrep", "fgrep"):
        if not any(re.match(r"^-[a-zA-Z]*[rR]", o) or o in ("--recursive", "--dereference-recursive") for o in opciones):
            return False
        rutas = partir_busqueda(args)[1] or ["."]
    elif cabeza == "rg":
        if not any(re.match(r"^-u+$|^-[a-zA-Z]*\.|^--hidden$|^--no-ignore", o) for o in opciones):
            return False
        rutas = partir_busqueda(args)[1] or ["."]
    elif cabeza == "find":
        if not (hacia_xargs or any(a in ("-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fls") for a in args)):
            return False
        rutas = []
        for a in args:
            if a.startswith("-") or a in ("(", "!"):
                break
            rutas.append(a)
        rutas = rutas or ["."]
    elif cabeza in ("cp", "rsync", "tar", "zip", "scp"):
        if cabeza in ("cp", "scp", "zip") and not any(
                re.match(r"^-[a-zA-Z]*[rRa]", o) or o in ("--recursive", "--archive") for o in opciones):
            return False
        rutas = [a for a in args if not a.startswith("-")]
    else:
        return False
    return any(alcanza_clientes(r, cwd) for r in rutas)

def toca_enlace(c):
    try:
        lista = comandos(sin_heredoc_de_git(c))
    except ValueError:
        # Comillas sin cerrar: no se puede partir, se decide sobre el texto crudo.
        return bool(re.search(r"(^|[/\s\x27\"])\.enlaces([/\s\x27\"]|$)|enlace-(admin|oper)-[a-z0-9-]+\.txt", c))
    hacia_xargs = bool(re.search(r"\|\s*(\S*/)?xargs\b", c))
    cwd = CWD
    for palabras in lista:
        sin_entorno = [w for w in palabras if not re.match(r"^\w+=", w)] or [""]
        cabeza, args = os.path.basename(sin_entorno[0]), sin_entorno[1:]
        if cabeza == "cd":
            destino = args[0] if args else "~"
            if destino != "-":
                cwd = os.path.realpath(os.path.join(cwd, os.path.expanduser(destino)))
            continue
        if cabeza in ("echo", "printf") or (cabeza == "git" and args[:1] == ["check-ignore"]):
            continue
        texto = set()
        if cabeza in ("grep", "egrep", "fgrep", "rg"):
            texto = set(partir_busqueda(args)[0])
        elif cabeza == "git" and args[:1] == ["grep"]:
            texto = set(partir_busqueda(args[1:])[0])
        for i, w in enumerate(sin_entorno):
            if w in texto:
                continue
            if i > 0 and sin_entorno[i - 1] == "-path" and "-prune" in sin_entorno:
                continue  # find … -path */.enlaces -prune: la está excluyendo
            if cabeza in ("git", "gh") and re.search(r"\s", w) and (
                    sin_entorno[i - 1] in TEXTO_DE_GIT or re.match(r"^--(message|title|body|notes)=", w)):
                continue
            if any(es_ruta_de_enlace(p, cwd) for p in [w] + PARTIR.split(w) if p):
                return True
        if recorre_clientes(cabeza, args, cwd, hacia_xargs):
            return True
    return False

NUNCA = [
    (lambda c: re.search(SISTEMA_AJENO, c, re.I) and re.search(ACTUA, c),
     "Prohibiciones 5 y 7 de CLAUDE.md: la app Demo SeguroLo Tengo, el otp-service, WhatsApp-Modular y el receptor de clientes de AAB1 (la app AAB1-WA-Prod, su contenedor y su suscripción) no se tocan; toda operación sobre el receptor la ejecuta la sesión de WhatsApp-Modular con autorización de Andres."),
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
