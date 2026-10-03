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
# despliegue, GitHub, contenedores o instalación. El verbo cuenta como palabra
# de comando, no dentro de un nombre de archivo, y el texto de un commit o de
# un PR no cuenta como nombre (ver ACTUA y quitar_texto).
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
#
# EL VERBO COMO PALABRA DE COMANDO, no como pedazo de un nombre de archivo
# (revisión de seguridad del #264, LOW). Con `\b`, `docker-compose.yml`,
# `docs/ssh-vm.md` o `gh-pages` contaban como acción, y el gancho negaba un
# `grep` de la documentación. Ahora el verbo va precedido por el inicio, un
# espacio o una puntuación de shell (comillas, `;`, `|`, `&`, `(`, `$`, la
# comilla invertida), con una ruta opcional delante (`/usr/bin/curl` sigue
# contando), y NO lo sigue ni letra, ni dígito, ni punto, ni guion.
# `docker-compose` va explícito. Dentro de `bash -c "…"`, `$(…)`, `sudo`,
# `timeout` o `xargs` el verbo sigue viéndose: lo precede un espacio o una
# comilla. Lo que no es un verbo (`--aplicar`, `subscribed_apps`,
# `/subscriptions`) se mira como antes.
# También `=` (`--rsh=ssh`, `a=curl`), `{` y `,` (la expansión de llaves de
# bash) y `:-` (`${X:-curl}`): revisión de seguridad del #272.
# Y la barra invertida: `\git` es `git` sin alias para bash, y con `\b` contaba
# (revisión de seguridad del cambio del #334, HIGH).
VERBO = r"(?:^|(?<=[\s;&|(`\x27\"$={,\\])|(?<=:-))(?:[^\s;&|(`\x27\"$={,]*/)?"
ACTUA = (VERBO + r"(?:curl|wget|ssh|scp|docker-compose|docker|systemctl|gcloud|gh|firebase)(?![\w.-])"
         r"|" + VERBO + r"(?:npm\s+(?:i|install)|pnpm\s+(?:add|install)|pip3?\s+install|git\s+clone)(?![\w.-])"
         r"|--aplicar|--suscribir|--desuscribir|webhook-meta\.sh\b[^\n;&|]*--(?:alta-meta|alta-waba)"
         r"|publicar-flujo|subscribed_apps|/subscriptions\b")
# UN `git push` TAMBIÉN ACTÚA, pero solo frente a un sistema ajeno (revisión de
# seguridad del #323, L2): `git push <repositorio ajeno>` o un push desde la
# carpeta de otro proyecto (`git -C <carpeta> push`, `cd <carpeta> && git
# push`) escribe en él y hasta hoy solo pedía confirmación. Se agrega aparte de
# ACTUA y solo para SISTEMA_AJENO: para el canal no oficial (prohibición 1) un
# push de una rama de NovuChat que mencione «evolution» no toca nada ajeno.
# Entre `git` y `push` caben hasta seis palabras (`-C <carpeta>`, `-c k=v`,
# `--no-pager`). Costo: una rama propia con el nombre de un sistema ajeno en su
# nombre no se puede empujar; se renombra.
PUSH = VERBO + r"git(?:\s+[^\s;&|]+){0,6}?\s+push(?![\w.-])"
ACTUA_AJENO = ACTUA + r"|" + PUSH
# LA MISMA FORMA SIRVE PARA LO PROPIO. Antes la regla del push forzado y la
# confirmación de CONFIRMAR buscaban `git push` pegado, y una opción global entre
# `git` y `push` (`git -C <carpeta> push --force`) no se negaba ni pedía
# confirmación (revisión de seguridad del #334). Ahora ambas parten de PUSH.
# FORZADO: tras el push, `--force` (y con él `--force-with-lease` y
# `--force-if-includes`), un `-f` suelto o dentro de un grupo de letras (`-fu`,
# `-uf`) o un refspec que empieza con `+` (`+rama`, `origin +HEAD:x`), con o sin
# comillas. Como la regla anterior, mira todo lo que sigue en la línea: prefiere
# negar de más antes que dejar pasar un empujón forzado.
FORZADO = PUSH + r"[^\n]*?\s[\"\x27]?(?:--force\b|-[A-Za-z0-9]*f[A-Za-z0-9]*\b|\+[^\s;&|\"\x27])"
# SIN REGRESIÓN: las formas de antes (`git push` pegado, con `\b` delante) se
# siguen mirando además de las nuevas, y lo que una negaba o confirmaba sigue
# igual, salvo el texto de un commit que quitar_texto quita (ver lecturas) (revisión de seguridad, HIGH: `\git push` dejó de verse al pasar a VERBO).
PUSH_PEGADO = r"\bgit\s+push\b"
FORZADO_PEGADO = PUSH_PEGADO + r".*(\s--force\b|\s-f\b|\s--force-with-lease\b)"
# Una barra invertida al final de la línea une con la siguiente: se une antes de
# buscar, o `git \<salto> -C x push --force` se veía como dos comandos.
UNIDO = re.compile(r"(?<!\\)((?:\\\\)*)\\\n")
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
# «WhatsApp-Modular» es el nombre de la carpeta; el repositorio en GitHub se
# llama `WhatsAppModular`, sin guion (comprobado el 01/10/2026 en su remoto), y
# con el guion solo el nombre de la carpeta coincidía: un `gh repo clone` o un
# `gh pr merge --repo …/WhatsAppModular` no se negaba. Por eso el separador es
# opcional, como el de las otras dos apps.
SISTEMA_AJENO = r"SeguroLo\s+Tengo|otp-service|WhatsApp[-_\s]?Modular|AAB1[-_\s]?WA[-_\s]?Prod|receptor[-_\s]?clientes"
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
# EL TEXTO QUE PUBLICA un git o un gh, POR SUBCOMANDO (revisión de seguridad
# del #272, MEDIUM). La misma letra no es texto en todos lados: en `gh pr
# merge`, `-m` es `--merge`; en `git fetch`, `-t` es `--tags`; en `gh api`,
# `-p -m` hace de `-m` el valor de `-p`. Quitar la palabra que sigue borraba
# el OBJETIVO del comando. Nada se quita en gh api, gh pr merge ni git
# clone/fetch/push; ni si git lleva opciones globales antes del subcomando
# (`-c alias.x=!…`, `-C`, `--config-env`).
TEXTO_POR_SUB = {
    ("git", "commit"): {"-m", "--message"}, ("git", "tag"): {"-m", "--message"},
    ("git", "merge"): {"-m"}, ("git", "notes"): {"-m", "--message"}, ("git", "stash"): {"-m", "--message"},
    ("gh", "pr", "create"): {"-t", "--title", "-b", "--body"}, ("gh", "pr", "edit"): {"-t", "--title", "-b", "--body"},
    ("gh", "pr", "comment"): {"-b", "--body"}, ("gh", "pr", "review"): {"-b", "--body"},
    ("gh", "issue", "create"): {"-t", "--title", "-b", "--body"}, ("gh", "issue", "edit"): {"-t", "--title", "-b", "--body"},
    ("gh", "issue", "comment"): {"-b", "--body"}, ("gh", "release", "create"): {"-t", "--title", "-n", "--notes"},
}
# Banderas sin valor que pueden ir justo antes de la de texto. Cualquier otra
# bandera delante podría tomar la de texto como SU valor, y entonces lo que
# sigue no es texto.
BOOLEANAS = {"--draft", "--fill", "--web", "--allow-empty", "--all", "--no-verify", "--quiet",
             "--signoff", "--amend", "--no-edit", "--verbose", "--approve", "--comment", "--request-changes"}

def texto_publicado(palabras):
    """(índices que son texto, índices «--bandera=texto») de un git o un gh, sin variables delante."""
    if not palabras:
        return set(), set()
    cabeza = os.path.basename(palabras[0])
    clave = ("git", palabras[1] if len(palabras) > 1 else "") if cabeza == "git" else (
        ("gh",) + tuple(palabras[1:3]) if cabeza == "gh" else None)
    banderas = TEXTO_POR_SUB.get(clave) if clave else None
    if not banderas:
        return set(), set()
    texto, con_igual = set(), set()
    for k in range(len(clave), len(palabras)):
        w, previa = palabras[k], palabras[k - 1]
        # Una bandera con «=» ya trae su valor (`--base=main`): no toma la siguiente.
        if k > len(clave) and previa.startswith("-") and "=" not in previa and previa not in BOOLEANAS:
            continue  # la anterior puede tomar esta como su valor
        if k in texto:
            continue  # es el texto de una bandera anterior, no una bandera
        if w in banderas and k + 1 < len(palabras) and not palabras[k + 1].startswith("-"):
            texto.add(k + 1)
        elif "=" in w and w.split("=", 1)[0] in banderas and w.startswith("--"):
            con_igual.add(k)
    return texto, con_igual

# LOW: un texto quitado todavía se puede ejecutar por otro camino
# (`git log -1 --format=%s | sh`, `xargs`, `eval`). Si el comando tiene un
# intérprete como palabra de comando, no se quita nada.
INTERPRETE = re.compile(r"(?:^|(?<=[\s;&|(`\x27\"$={,]))(?:[^\s;&|(`\x27\"$={,]*/)?"
                        r"(?:sh|bash|zsh|dash|ksh|fish|eval|source|xargs|python3?|node|perl|ruby|php)(?![\w.-])"
                        r"|(?:^|[;&|(]\s*)\.\s")
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

# Un texto que la shell EJECUTA aunque vaya de mensaje: `$(…)` o la comilla
# invertida en un -m/--body entre comillas dobles o en un heredoc sin comillas.
EJECUTA = re.compile(r"\$\(|`")

def sin_heredoc_de_git(c):
    def cambio(m):
        linea = c[:m.start()].rsplit("\n", 1)[-1]
        tramo = [w for w in re.split(r"&&|\|\||;|\|", linea)[-1].split() if not re.match(r"^\w+=", w)]
        # Un heredoc sin comillas expande `$(…)`: ese no es solo texto.
        publica = bool(tramo) and ((tramo[0] == "git" and ("git", tramo[1] if len(tramo) > 1 else "") in TEXTO_POR_SUB)
                                   or (tramo[0] == "gh" and ("gh",) + tuple(tramo[1:3]) in TEXTO_POR_SUB))
        if publica and (m.group(1) or not EJECUTA.search(m.group(0))):
            return m.group(0).split("\n", 1)[0]
        return m.group(0)
    return HEREDOC.sub(cambio, c)

def comandos(c):
    # EL SALTO DE LÍNEA SEPARA COMANDOS, como en bash (revisión de seguridad
    # del #272, tercera ronda): con `\n` como espacio, `gh pr create -t x -b y`
    # y en la línea siguiente `docker logs -t <contenedor>` eran un solo
    # comando, y el `-t` de la segunda línea se tomaba por un título. Dentro
    # de comillas el salto sigue siendo parte de la palabra.
    # La continuación de línea une solo con una cantidad IMPAR de barras: `\\`
    # al final es una barra literal y el salto separa (quinta revisión del #272).
    c = re.sub(r"(?<!\\)((?:\\\\)*)\\\n", r"\1", c)
    lx = shlex.shlex(c, posix=True, punctuation_chars="();<>|&\n")
    lx.whitespace = " \t\r"
    lx.whitespace_split = True
    lx.commenters = ""
    todos, actual = [], []
    for t in lx:
        if t and set(t) <= set("();|&\n<>") and set(t) & set("();|&\n"):
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
    # El texto de git/gh (y su heredoc) se exceptúa solo con el mismo criterio
    # estructural de quitar_texto (revisión de seguridad del #272, LOW-A).
    texto_seguro = sin_reuso(c)
    try:
        lista = comandos(sin_heredoc_de_git(c) if texto_seguro else c)
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
        publicado, con_igual = texto_publicado(sin_entorno) if texto_seguro else (set(), set())
        for i, w in enumerate(sin_entorno):
            if w in texto:
                continue
            if i > 0 and sin_entorno[i - 1] == "-path" and "-prune" in sin_entorno:
                continue  # find … -path */.enlaces -prune: la está excluyendo
            if re.search(r"\s", w) and (i in publicado or i in con_igual) and not EJECUTA.search(w):
                continue
            if any(es_ruta_de_enlace(p, cwd) for p in [w] + PARTIR.split(w) if p):
                return True
        if recorre_clientes(cabeza, args, cwd, hacia_xargs):
            return True
    return False

# EL TEXTO DE UN COMMIT O DE UN PR NO ES UNA ACCIÓN (revisión de seguridad del
# #264, LOW). `gh pr create --body "…receptor-clientes…"` nombra el receptor y
# usa `gh`, pero el nombre está en el texto que se publica, no en lo que se
# toca. Se quita el valor de -m, --message, --title, --body, --notes (y sus
# formas con «=») de un git o un gh, y el heredoc de un git o un gh, antes de
# buscar nombre y acción. El emparejamiento sigue sobre el comando ENTERO: un
# nombre en cualquier otro argumento, o en otro tramo del mismo comando, niega.
# No se quita un texto que la shell ejecuta (`$(…)`, comilla invertida), ni se
# quita nada si el comando no se puede partir (comillas sin cerrar).
# `--body "$(cat <<\x27EOF\x27 … EOF)"`: la forma habitual de un cuerpo de PR. Con el
# heredoc entre comillas no se expande nada, y su cuerpo ya lo quitó
# sin_heredoc_de_git: lo que queda es `$(cat <<\x27EOF\x27\n)`, que es solo texto.
CAT_HEREDOC = re.compile(r"^(?:--\w+=)?\$\(\s*cat\s+<<-?\s*([\"\x27])\w+\1\s*\)$")

def solo_texto(w):
    return not EJECUTA.search(w) or bool(CAT_HEREDOC.match(w))

def es_de_tabla(palabras):
    if not palabras:
        return False
    cabeza = os.path.basename(palabras[0])
    return (cabeza == "git" and ("git", palabras[1] if len(palabras) > 1 else "") in TEXTO_POR_SUB) or (
        cabeza == "gh" and ("gh",) + tuple(palabras[1:3]) in TEXTO_POR_SUB)

def sin_reuso(c):
    """Si el texto de git/gh se puede exceptuar en toca_enlace (el enlace de
    contraseña), donde además el heredoc de un git o un gh es texto. Para las
    prohibiciones 1, 5 y 7 rige quitar_texto, más estricta.

    CUÁNDO NO SE QUITA NADA (revisión de seguridad del #272, LOW-A). El texto
    quitado se puede volver a ejecutar desde OTRO tramo sin intérprete:
    `git commit -m <nombre>; docker restart "$_"`, `… "$(git log -1
    --format=%s)"`, una función `git() {…}`, un `trap … DEBUG`, `awk
    system()`. La condición es estructural, no una lista:
      1. un tramo que no es de la tabla trae un verbo de ACTUA, `$` o la
         comilla invertida;
      2. en un tramo de la tabla, una palabra fuera del texto trae `$` o la
         comilla invertida (una variable delante solo si ejecuta: `$(`);
      3. el comando YA SIN TEXTO tiene un intérprete como palabra de comando
         (sobre el crudo, un cuerpo de PR que dice «bash» lo bloqueaba).
    """
    try:
        lista = comandos(sin_heredoc_de_git(c))
    except ValueError:
        return False
    # Una línea unida con barra, o un comentario, pueden hacer que bash vea
    # otra cosa que el tokenizador: el texto no se exceptúa (quinta revisión).
    if "\\\n" in c or any(w.startswith("#") for palabras in lista for w in palabras):
        return False
    tramos = []
    for palabras in lista:
        entorno = [w for w in palabras if re.match(r"^\w+=", w)]
        sin_entorno = [w for w in palabras if not re.match(r"^\w+=", w)]
        if any(EJECUTA.search(w) for w in entorno):
            return False
        if es_de_tabla(sin_entorno) and any(w.split("=", 1)[0] not in ENTORNO_INOCUO for w in entorno):
            return False  # GIT_EDITOR=$SHELL git commit -e: git ejecuta el texto
        if not es_de_tabla(sin_entorno):
            junto = " ".join(sin_entorno)
            if re.search(ACTUA, junto) or "$" in junto or "`" in junto:
                return False
            tramos.append(" ".join(entorno + sin_entorno))
            continue
        texto, con_igual = texto_publicado(sin_entorno)
        quedan = []
        for k, w in enumerate(sin_entorno):
            if (k in texto or k in con_igual) and not solo_texto(w):
                return False  # un $( que no es `cat <<\x27EOF\x27`: su heredoc ya se quitó
            if k in texto and solo_texto(w):
                continue
            if k in con_igual and solo_texto(w):
                quedan.append(w.split("=", 1)[0] + "=")
                continue
            if k not in texto and k not in con_igual and ("$" in w or "`" in w):
                return False
            quedan.append(w)
        tramos.append(" ".join(entorno + quedan))
    return not INTERPRETE.search(" ; ".join(tramos))

# Variables que pueden ir delante de un git o un gh sin cambiar qué ejecuta
# (GH_CONFIG_DIR es la que recomienda este mismo gancho). Cualquier otra
# (GIT_EDITOR, EDITOR, GIT_SSH_COMMAND, PAGER…) puede hacer que git ejecute
# el texto: entonces no se quita (revisión de seguridad del #272, tercera ronda).
ENTORNO_INOCUO = {"GH_CONFIG_DIR", "GH_REPO", "GH_HOST", "GH_PROMPT_DISABLED", "NO_COLOR",
                  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE",
                  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE"}

def git_local_inocuo(palabras):
    """Una de las pocas formas CONOCIDAS de git local que acompañan a un commit
    (revisión de seguridad del #329: lista cerrada, no «cualquier opción»).

    El subcomando va pegado a `git` (sin `-c`, `-C` ni `--git-dir` en medio),
    sin `$` ni comilla invertida, y sin un verbo de ACTUA. Y solo estas formas:
      - `git add [-A|--all|-u|--update|--] <rutas…>`: rutas sin opciones y sin
        «:» (los pathspec mágicos);
      - `git status [-s|--short|-b|--branch|-sb|--porcelain]`;
      - `git push [-u|--set-upstream] [<remoto> [<rama>]]`: el remoto es un
        nombre (sin «/» ni «:», o sea, no una URL ni un transporte `ext::`) y
        la rama un nombre sin «:» (no un refspec).
    Todo lo demás, incluida cualquier otra opción de push (`--receive-pack`,
    `--exec`, `--mirror`…), anula la excepción del texto de git/gh."""
    if len(palabras) < 2 or palabras[0] != "git":
        return False
    junto = " ".join(palabras)
    if "$" in junto or "`" in junto or re.search(ACTUA, junto):
        return False
    sub, args = palabras[1], palabras[2:]
    if sub == "add":
        return all(a in ("-A", "--all", "-u", "--update", "--")
                   or (not a.startswith("-") and re.fullmatch(r"[\w.@+/,-]+", a) is not None) for a in args)
    if sub == "status":
        return all(a in ("-s", "--short", "-b", "--branch", "-sb", "--porcelain") for a in args)
    if sub == "push":
        opciones = [a for a in args if a.startswith("-")]
        resto = [a for a in args if not a.startswith("-")]
        if any(a not in ("-u", "--set-upstream") for a in opciones) or len(resto) > 2:
            return False
        if resto and re.fullmatch(r"[A-Za-z0-9._-]+", resto[0]) is None:
            return False
        return len(resto) < 2 or re.fullmatch(r"[A-Za-z0-9._/-]+", resto[1]) is not None
    return False

def quitar_texto(c):
    """El comando sin el texto que publica, o None si no se quita nada.

    UNA SOLA INVOCACIÓN, O NADA (revisión de seguridad del #272, tercera
    ronda). Tres rondas mostraron que el texto quitado se puede reusar desde
    otro tramo, desde la línea siguiente o desde un heredoc que la expresión
    lee distinto que bash. En vez de seguir tapando formas, el texto se quita
    solo cuando el comando entero es UN git o UN gh de la tabla (más, a lo
    sumo, tramos de git local inocuo: ver git_local_inocuo):
      - sin heredoc (un cuerpo de PR va en --body-file);
      - un solo tramo de la tabla: sin otro `;`, `&&`, `|` o `&` fuera de
        comillas que lleve a algo que no sea una de las formas cerradas de
        `git add`, `git status` o `git push`, y sin salto de línea;
      - sin `$` ni comilla invertida en ninguna palabra, tampoco en el texto;
      - sin variables delante salvo las de ENTORNO_INOCUO;
      - y el resto, ya sin texto, sin un intérprete.
    `git commit -m "…" && gh pr create …` con un nombre ajeno en el texto se
    parte en dos llamadas. El costo es ese; a cambio no hay nada que leer.
    """
    # Sin salto de línea ni \r (quinta revisión del #272, MEDIUM): el
    # tokenizador no modela el comentario de bash ni todas las formas de unir
    # líneas, y un comando de varias líneas podía verse como UNO. Sin saltos,
    # un comentario solo recorta: bash ejecuta un prefijo del mismo git/gh.
    # Un -m de varias líneas con un nombre ajeno y un verbo va en -F.
    if "<<" in c or "\n" in c or "\r" in c:
        return None
    try:
        lista = comandos(c)
    except ValueError:
        return None
    # Un tramo de la tabla y, a lo sumo, otros que son git local sin riesgo
    # (formas cerradas de add, push y status): `git add … && git commit -m "…" && git push`
    # es la cadena de todos los días y, con el push como acción frente a un
    # sistema ajeno, se negaría solo por nombrarlo en el mensaje. Esos tramos
    # no pueden leer el texto del commit (sin `$`, sin comilla invertida, sin
    # variables, sin opciones globales) y se conservan enteros: un nombre ajeno
    # EN ellos (`git push <repositorio ajeno>`) sigue contando.
    # Con más de un tramo, una redirección (`<`, `>`) no se admite: `comandos`
    # la descarta y su destino pasaría por una ruta o un remoto (revisión del
    # #329, L2). Un `*` tampoco entra en las rutas de `git add` (L3): la shell
    # lo expande antes que git y un archivo con nombre de opción lo cambiaría.
    if len(lista) > 1 and re.search(r"[<>]", c):
        return None
    tabla = [p for p in lista if es_de_tabla([w for w in p if not re.match(r"^\w+=", w)])]
    if len(tabla) != 1:
        return None
    for p in lista:
        if p is not tabla[0] and not git_local_inocuo(p):
            return None
    tramos = []
    for p in lista:
        if p is not tabla[0]:
            tramos.append(" ".join(p))
            continue
        entorno = [w for w in p if re.match(r"^\w+=", w)]
        sin_entorno = [w for w in p if not re.match(r"^\w+=", w)]
        if any(w.split("=", 1)[0] not in ENTORNO_INOCUO or EJECUTA.search(w) for w in entorno):
            return None
        if any("$" in w or "`" in w for w in sin_entorno):
            return None
        texto, con_igual = texto_publicado(sin_entorno)
        quedan = []
        for k, w in enumerate(sin_entorno):
            if k in texto:
                continue
            quedan.append(w.split("=", 1)[0] + "=" if k in con_igual else w)
        tramos.append(" ".join(entorno + quedan))
    t = " ; ".join(tramos)
    return None if INTERPRETE.search(t) else t

# `${X:+curl}`, `${X-curl}`, `${X:=curl}`: la expansión deja el verbo suelto
# (revisión de seguridad del #272, LOW-B). Se abre antes de buscar ACTUA.
EXPANSION = re.compile(r"\$\{[#!]?\w+(?:\[[^\]]*\])?:?[-+=?]")

def nombra_y_actua(patron_nombre, c, actua=ACTUA):
    # Primero sobre el crudo, que es barato: quitar texto solo quita, así que
    # si el crudo no coincide, lo saneado tampoco (y el heredoc, que es
    # cuadrático, no corre para cada comando).
    crudo = EXPANSION.sub(" ", c)
    if not (re.search(patron_nombre, crudo, re.I) and re.search(actua, crudo)):
        return False
    t = quitar_texto(c)
    if t is None:
        return True
    t = EXPANSION.sub(" ", t)
    return bool(re.search(patron_nombre, t, re.I) and re.search(actua, t))

def lecturas(c):
    """Los textos sobre los que se busca un push, uno por uno.

    Con la forma abierta de PUSH, una palabra «push» (o un «-f») dentro del
    mensaje de un commit (`git commit -m "arreglo del push"`) contaría como push
    y pediría confirmación o se negaría sin motivo. Por eso, cuando quitar_texto
    puede quitar el texto que se publica (un solo git o gh de la tabla), se mira
    el comando sin él. Si no puede, se mira el comando entero y también unido por
    la barra invertida: quitar_texto se llama sobre el ORIGINAL porque ya rechaza
    cualquier salto de línea, y unir antes anularía ese resguardo (un comentario
    con una barra al final no continúa la línea en bash)."""
    t = quitar_texto(c)
    return [t] if t is not None else [c, UNIDO.sub(r"\1", c)]

def forzado(c):
    return any(re.search(FORZADO, b) or re.search(FORZADO_PEGADO, b) for b in lecturas(c))

def empuja(c):
    return any(re.search(PUSH, b) or re.search(PUSH_PEGADO, b) for b in lecturas(c))

NUNCA = [
    (lambda c: nombra_y_actua(SISTEMA_AJENO, c, ACTUA_AJENO),
     "Prohibiciones 5 y 7 de CLAUDE.md: la app Demo SeguroLo Tengo, el otp-service, WhatsApp-Modular y el receptor de clientes de AAB1 (la app AAB1-WA-Prod, su contenedor y su suscripción) no se tocan; toda operación sobre el receptor la ejecuta la sesión de WhatsApp-Modular con autorización de Andres."),
    (lambda c: nombra_y_actua(CANAL_NO_OFICIAL, c),
     "Prohibición 1 de CLAUDE.md: el único canal es la Cloud API oficial de Meta."),
    (lambda c: re.search(r"\bgh\s+auth\s+switch\b|\bgcloud\s+config\s+set\b", c),
     "Cambia la identidad compartida por todas las sesiones. Use la variable de entorno por comando (GH_CONFIG_DIR, CLOUDSDK_CONFIG)."),
    (lambda c: re.search(r"\bgcloud\s+secrets\s+versions\s+access\b", c),
     "El valor de un secreto no debe pasar por el modelo. Que lo corra una persona en su terminal."),
    (forzado,
     "Push forzado prohibido."),
    # El enlace de contraseña: ver toca_enlace() arriba.
    (toca_enlace,
     "El enlace de contraseña es una credencial: lo abre una persona, nunca un agente (docs/alta-cliente/RUNBOOK.md, etapa 4)."),
]
CONFIRMAR = [
    (r"(^|\s)--aplicar(\s|$)", "Escribe en producción (Firestore, Auth o n8n)."),
    # --desuscribir no contiene «--suscribir», y los modos de escritura de
    # webhook-meta.sh no estaban (revisión de seguridad del #265). La app la
    # decide el .env: el candado de scripts/lib/apps-ajenas.sh corta las
    # ajenas; esto pide la confirmación de cualquier escritura.
    (r"verificar-meta\.sh\b.*--(de)?suscribir", "Escribe en Meta: suscribe o desuscribe la app de la WABA."),
    (r"webhook-meta\.sh\b.*--(alta-meta|alta-waba|preparar|cerrar)\b", "Escribe en Meta o en n8n: el webhook de la app o de la WABA, o el flujo temporal."),
    (r"\bgh\s+pr\s+(merge|close)\b|\bgh\s+workflow\s+run\b", "Cambia GitHub: fusión, cierre o ejecución de un workflow."),
    (empuja, "Publica en GitHub."),
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
    if (patron(cmd) if callable(patron) else re.search(patron, cmd)):
        responder("ask", motivo + " Requiere confirmación humana (decisión del 14/09/2026).")
'
exit 0
