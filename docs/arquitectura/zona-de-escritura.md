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
2. **Todos los `.claude/zona` que aparezcan, a la vez** (intersección):
   subiendo desde el `cwd` que Claude Code manda en el evento (el worktree
   donde trabaja el agente) y desde el archivo destino, cada recorrido hasta
   su primera **raíz git real** (un `.git` directorio, o un archivo
   `gitdir:` cuya ruta existe; un `.git` vacío plantado no cuenta). La de
   `CLAUDE_PROJECT_DIR` (si no está, el directorio de trabajo) entra solo de
   respaldo, cuando el `cwd` no dio ninguna: así una sesión con zona puede
   lanzar subagentes con zona en otros worktrees. El destino tiene que caber
   en cada zona, con sus prefijos relativos a la carpeta de esa zona.
   `NOVUCHAT_ZONA`, si está, manda sola y se ancla en `CLAUDE_PROJECT_DIR`,
   como antes (por eso no sirve para subagentes con worktree). La raíz de una ruta es la carpeta más cercana,
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
- Una ruta relativa se juzga **contra el `cwd` del evento**, que es contra lo
  que la herramienta la escribe (si el evento no trae `cwd`, contra
  `CLAUDE_PROJECT_DIR`). Los prefijos relativos, contra la raíz de su zona.
- **Con la zona activa no se escribe un `.git` ni un `.claude/zona`**: sería
  plantar desde adentro una raíz o una zona nuevas. Y si aparecen igual (por
  `Bash`), no amplían nada **dentro del worktree**: el recorrido sigue hasta
  la raíz real y todas las zonas se aplican a la vez. **Límite declarado
  (LOW, tercera revisión de #210):** un `.git` directorio, o un archivo
  `gitdir:` que apunte a una carpeta existente, plantado con `Bash` en una
  subcarpeta donde el agente deja su `cwd`, corta el recorrido; desde ahí un
  Edit/Write a la copia principal (que no tiene zona) no se rechaza. Exige
  `Bash` con intención y un `cwd` persistente en esa subcarpeta, y ese agente
  ya puede escribir directo con `Bash`. Remedio, si hiciera falta: validar el
  enlace inverso de git (`.git/worktrees/<n>/gitdir`). Por lo mismo, **la
  coordinadora tampoco reescribe con Edit/Write un `.claude/zona` que ya
  existe**: lo crea por primera vez, o lo cambia con Bash.

## Fallo cerrado

Con la zona activa, el gancho **niega antes que dejar pasar** lo que no pudo
comprobar. También niega si un `.claude/zona` existe pero no deja ningún
prefijo (vacío o solo comentarios): es un error de quien lanzó al agente, no
una zona abierta. Y en los demás casos: sin `python3` en el `PATH`, con un evento que no es JSON, con un
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
