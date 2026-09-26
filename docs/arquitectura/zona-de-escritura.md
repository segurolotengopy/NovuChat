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
2. **El archivo `.claude/zona`** en la raíz del proyecto (la que dice
   `CLAUDE_PROJECT_DIR`; si no está, el directorio de trabajo).

La segunda fuente existe por una observación de la revisión de seguridad
(26/09/2026): dos subagentes lanzados desde una misma sesión **comparten el
entorno**, así que una variable no los distingue; en cambio, cada agente
trabaja en su propio worktree (`.claude/worktrees/`) y ahí `.claude/zona`
lleva su zona **versionada en su rama**. La variable queda para lanzar una
sesión con zona desde afuera (`NOVUCHAT_ZONA=… claude`) o para un
`.claude/settings.local.json` con `env`, y manda sobre el archivo.

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
- Una ruta relativa se resuelve contra `CLAUDE_PROJECT_DIR`, no contra el
  directorio desde donde se lanzó el proceso.

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
