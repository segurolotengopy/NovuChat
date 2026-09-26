# La zona de escritura: el gancho que limita a cada agente a su carpeta

> Pieza del método de la arquitectura por capas
> (`Analisis/41-arquitectura-por-capas.md` §1 «carpeta = zona», §8.1 «cada
> agente escribe solo en su carpeta», §9.1 «el gancho de Claude Code sobre
> Edit y Write rechaza una escritura fuera de la zona del agente»). El gancho
> es `.claude/hooks/zona-de-escritura.sh`; su prueba,
> `.claude/hooks/probar-zona-de-escritura.sh`. Sin secretos ni
> identificadores.

## Qué hace

Es un control `PreToolUse` de Claude Code sobre `Edit`, `Write` y `MultiEdit`,
registrado en `.claude/settings.json`. Cuando el agente tiene una zona
definida, toda escritura fuera de ella recibe `permissionDecision: deny` con
un mensaje que dice la ruta, la zona y qué hacer («si el cambio corresponde a
otra zona, se anota en el PR y lo hace el agente dueño»). Cuando no hay zona,
no hace nada: la sesión de Andres sigue igual que siempre.

Es el candado por hecho aplicado a la arquitectura: la política escrita es un
prompt, y el prompt no es una barrera.

## De dónde sale la zona (dos fuentes, en este orden)

1. **La variable de entorno `NOVUCHAT_ZONA`**, si existe y no está vacía.
2. **El archivo `.claude/zona` de la primera de estas raíces que lo tenga**:
   la del `cwd` que Claude Code manda en el evento (el worktree donde trabaja
   el agente), la del archivo destino, y `CLAUDE_PROJECT_DIR` (si no está, el
   directorio de trabajo). La raíz de una ruta es la carpeta más cercana,
   subiendo, que tiene `.git` (directorio en la copia principal, archivo en un
   worktree).

**Corregido el 26/09/2026, antes de F2.** Hasta ese día el archivo se buscaba
solo en `CLAUDE_PROJECT_DIR`, y un subagente lanzado con worktree recibe el de
la sesión que lo lanzó, que es la copia principal. Resultado: **dentro del
worktree del agente el gancho no rechazaba nada**. Se midió con un agente de
prueba que escribió su `.claude/zona` (`docs/`) y después escribió en
`admin/` sin un rechazo. Las pruebas del gancho armaban el evento sin `cwd` y
con `CLAUDE_PROJECT_DIR` apuntando al proyecto con zona, así que no lo veían;
los casos nuevos arman la copia principal sin zona con el worktree del agente
adentro, y fallan con el gancho anterior.

**Claude Code ejecuta el gancho desde la copia principal**
(`"$CLAUDE_PROJECT_DIR"/.claude/hooks/zona-de-escritura.sh` en
`.claude/settings.json`): un cambio del gancho rige para los agentes recién
cuando la copia principal se pone al día con `main`. Antes de lanzar agentes
con zona, la coordinadora lo comprueba con un agente de prueba que intente
escribir fuera de su zona.

La segunda fuente existe por una observación de la revisión de seguridad
(26/09/2026): dos subagentes lanzados desde una misma sesión **comparten el
entorno**, así que una variable no los distingue; en cambio, cada agente
trabaja en su propio worktree (`.claude/worktrees/`) y ahí `.claude/zona`
lleva su zona. **El archivo lo escribe quien lanza al agente** (la sesión
coordinadora) al crear el worktree, **no el agente, y nunca se versiona**:
está en `.gitignore`, y la prueba del gancho falla si git lo rastrea
(`git ls-files --error-unmatch .claude/zona` tiene que fallar). Si llegara a
`main`, toda sesión sobre `main` o sobre un worktree nuevo heredaría esa zona
—`deny` para todos, incluida la sesión de Andres— y dos ramas con zonas
distintas chocarían. La variable queda para lanzar una sesión con zona desde
afuera (`NOVUCHAT_ZONA=… claude`) o para un `.claude/settings.local.json` con
`env`, y manda sobre el archivo.

Las dos fuentes usan la misma sintaxis: prefijos de ruta permitidos separados
por `:` (en el archivo, también uno por línea; las líneas que empiezan con `#`
son comentarios), relativos a la raíz del proyecto o absolutos.

```
# .claude/zona del agente metodo
docs/
bitacora/
.claude/hooks/
.claude/agents/
CLAUDE.md
```

- Un prefijo que termina en `/` es una carpeta; uno que no, es un archivo
  exacto o una carpeta (`CLAUDE.md` acepta solo ese archivo; `docs` vale como
  `docs/`). `CLAUDE.md.bak` o `docs-viejos/` no entran.
- Un prefijo absoluto sirve para carpetas fuera del proyecto (por ejemplo, el
  scratchpad de la sesión).
- **Un prefijo que resuelva a la raíz del proyecto, a `/` o a un ancestro de
  la raíz se rechaza**: una zona así no limita nada, y el gancho responde
  `deny` a toda escritura hasta que la zona nombre carpetas concretas.

Las zonas por agente son las de `Analisis/41` §8.1 y están escritas en cada
agente de `.claude/agents/` (`central`, `core-functions`, `core-flujos`,
`modulo`, `consola`, `plataforma-consola`, `metodo`,
`analista-de-solicitudes`).

## Rutas, `..` y enlaces simbólicos

Destino y prefijos se resuelven con `realpath`; cuando el archivo todavía no
existe (un `Write` nuevo), se resuelve la carpeta padre existente más cercana
y se vuelve a pegar el resto. Así:

- `docs/../admin/firestore.rules` se evalúa como `admin/firestore.rules`.
- Un enlace simbólico dentro de la zona que apunte afuera (`docs/enlace →
  admin/`) se rechaza, también para un archivo nuevo debajo del enlace.
- Una ruta relativa se resuelve contra la raíz elegida (la del `cwd` del
  evento si tiene zona o si no hay otra; si no, la que tenga la zona), no
  contra el directorio desde donde se lanzó el proceso.

## Fallo cerrado

Con la zona activa, el gancho **niega antes que dejar pasar** lo que no pudo
comprobar: sin `python3` en el `PATH`, con un evento que no es JSON, con un
evento o un `tool_input` que no son objetos, o sin `file_path`, responde
`deny` («gancho no operativo»). Sin zona, no opina, como siempre. Sale siempre
con 0: un fallo del script no debe dejar la herramienta en un estado
indefinido.

## Lo que no cubre

- **`Bash`.** Un `sed -i` o un `cat >` desde Bash no pasan por acá. Lo
  sensible lo cubre `acciones-sensibles.sh`; el resto, la revisión del PR y la
  prueba de fronteras de importación (`fronteras.test.ts`, F2).
- **Secciones de un archivo.** El gancho distingue archivos, no partes: un
  agente con `admin/firestore.rules` en su zona puede editar cualquier regla.
  Cada agente que comparte un archivo lo declara y la revisión del PR cubre
  la sección.
- **Un agente que se muda a una carpeta sin zona y escribe ahí.** Si el
  `cwd` y el destino están en la copia principal (sin `.claude/zona`), el
  gancho no opina. Es el mismo nivel que `Bash`: lo cubren la revisión del PR
  y que el agente trabaja en su worktree. Si escribe desde su worktree en la
  principal, o desde la principal en su worktree, se rechaza.
- **Quién fija la zona.** El gancho no decide: la fija quien lanza al agente,
  en `.claude/zona` de su worktree o en `NOVUCHAT_ZONA`.

## Cómo se prueba

`.claude/hooks/probar-zona-de-escritura.sh` invoca el gancho como lo invoca
Claude Code (JSON por stdin, `CLAUDE_PROJECT_DIR`) con un intento fuera de la
zona, uno adentro y los bordes: sin zona, otra herramienta, ruta relativa,
archivo exacto, prefijo absoluto, `..`, `CLAUDE_PROJECT_DIR` distinto de la
raíz del worktree, `.claude/zona` sin variable, enlace simbólico hacia afuera,
prefijo demasiado amplio, JSON inválido, `tool_input` que no es objeto y
`python3` ausente. Sale con 1 si un caso falla; la salida real va al PR que
toque el gancho.
