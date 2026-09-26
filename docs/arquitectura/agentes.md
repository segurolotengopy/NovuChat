# Agentes por zona: zonas efectivas y en qué difieren de `Analisis/41` §8.1

> Los agentes de `.claude/agents/` de la rearquitectura por capas
> (`central`, `core-functions`, `core-flujos`, `modulo`, `consola`,
> `plataforma-consola`, `metodo`, `analista-de-solicitudes`) declaran cada uno
> su zona de escritura, que el gancho `.claude/hooks/zona-de-escritura.sh`
> hace cumplir (ver `zona-de-escritura.md`). Esta tabla es la **zona
> efectiva** de cada uno al 26/09/2026 y, donde difiere de la tabla de
> `Analisis/41` §8.1, el porqué. `Analisis/41` es de la revisora y no se
> edita desde acá: las diferencias se le informan en el hito (observación 6 de
> la revisión de seguridad del PR #204). Sin secretos ni identificadores.

## Reglas que valen para todos

- La zona se escribe en `.claude/zona` del worktree del agente (una línea por
  prefijo) o en `NOVUCHAT_ZONA`; la variable manda. **`.claude/zona` lo
  escribe quien lanza al agente** (la sesión coordinadora) al crear el
  worktree, no el agente, y **nunca se versiona**: está en `.gitignore` y la
  prueba del gancho falla si git lo rastrea (`zona-de-escritura.md`).
- **Todo cambio en `.claude/hooks/` y `.claude/agents/` exige revisión humana
  de Andres antes de fusionarse**, aunque el agente `metodo` los tenga en su
  zona: son superficie de control, no documentación.
- `.claude/settings.json` y `admin/package.json` **no están en la zona
  ordinaria de ningún agente**: se conceden solo en el PR que los necesite,
  declarándolo en el cuerpo del PR y en la instrucción que lanza al agente.
- Un archivo compartido (`admin/firestore.rules`) no se puede partir por
  sección con el gancho: el agente declara qué sección toca y la revisión del
  PR cubre el resto.
- Hasta que F2 cree las carpetas por zona, los archivos viven donde están hoy
  (`admin/functions/src/*.ts`, `admin/web/src/paginas/*.tsx`,
  `Flujos/src/comun/`): en el primer PR de cada agente la zona es la lista de
  archivos que su ficha nombra, y se declara.

## Zonas efectivas

| Agente | Zona efectiva (`.claude/zona` o `NOVUCHAT_ZONA`) | §8.1 dice | Diferencia y por qué |
|---|---|---|---|
| **central** | `admin/functions/src/central/`, `admin/web/src/central/`, `admin/pruebas/central/`, `admin/firestore.rules` (solo `cuenta` y `pagos`) | `functions/src/central/`, `web/src/central/`, `pruebas/central/`, reglas de `cuenta` y `pagos` | Igual. `firestore.rules` entra entero por el gancho; la sección la cubre la revisión |
| **core-functions** | `admin/functions/src/core/`, `admin/pruebas/core/` | `functions/src/core/`, `pruebas/core/` | Igual. `registro.ts` es de la coordinadora |
| **core-flujos** | `Flujos/src/core/`, `Flujos/prompts/core/`, `admin/scripts/ensamblar-flujo.mjs`, `admin/scripts/ensamblar-flujo.d.mts`, `admin/pruebas/core/` | `Flujos/src/core/`, `Flujos/prompts/core/`, `ensamblar-flujo.mjs` | **Agrega `admin/pruebas/core/`** (compartida con `core-functions`): las suites de los nodos comunes y del ensamblador (`ensamblador.test.ts`, `flujos-*.test.ts`) son pruebas del core de flujos y en F3 dejan `new Function` para importar `Flujos/src/`; sin esa carpeta el agente no puede escribir su prueba. Agrega el `.d.mts` del ensamblador, que es el mismo archivo tipado |
| **modulo** (`<m>`) | `admin/functions/src/modulos/<m>/`, `admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`, `admin/pruebas/modulos/<m>/`, `Flujos/prompts/modulos/<m>.md`, `docs/arquitectura/modulos/<m>.md`, `admin/firestore.rules` (solo sus colecciones) | `functions/src/modulos/<m>/`, `web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`, `pruebas/modulos/<m>/`, y las reglas de sus colecciones | **Agrega `Flujos/prompts/modulos/<m>.md`** (el fragmento de prompt es parte del manifiesto, §3.1) y **`docs/arquitectura/modulos/<m>.md`** (el manifiesto en prosa lo mantiene el dueño del módulo, no `metodo`). **`firestore.rules` entra entero** porque el gancho no distingue secciones: la restricción a sus colecciones la cubre la revisión y `registro.test.ts` |
| **consola** | `admin/web/src/central/paginas/Tablero.tsx`, `admin/web/src/central/paginas/Configuracion.tsx`, `admin/web/src/central/componentes/`, `admin/pruebas/central/` | `web/src/central/paginas/Tablero`, `Configuracion`, `ConfiguracionModulo`, `plataforma/` | **Quita `plataforma/`**: `Prompts/rearquitectura-por-capas.md` ya separa Plataforma en un agente propio (`plataforma-consola`, fila «plataforma-consola» de su tabla), y el §1.2 del plano pide que lo del operador no comparta zona con lo del comercio. **Agrega `admin/pruebas/central/`** (compartida con `central`) para las pruebas de pantalla |
| **plataforma-consola** | `admin/functions/src/plataforma/`, `admin/web/src/plataforma/`, `admin/pruebas/plataforma/`, `admin/scripts/plataforma/`, `admin/firestore.rules` (solo la ficha del tenant, `accesosSoporte`, `/plataforma/*`) | No existe como fila en §8.1 (Plataforma está dentro de `consola`); sí existe en la tabla de `Prompts/rearquitectura-por-capas.md` como **plataforma-consola** (`web/src/plataforma/`, `functions/src/plataforma/`) | **Nuevo respecto de §8.1**, con el nombre del prompt porque `plataforma.md` ya existe (operador del alta) y no se toca. Agrega `admin/pruebas/plataforma/` y `admin/scripts/plataforma/` (§5.5 del plano manda los scripts de operador a esa carpeta) |
| **metodo** | `docs/`, `bitacora/`, `.claude/hooks/`, `.claude/agents/`, `CLAUDE.md`, `ESTADO.md`, `Prompts/COORDINACION.md`, `scripts/estado-generado.sh`, `admin/vitest.config.ts`, `admin/LEEME.md` | `docs/`, `bitacora/`, `.claude/hooks/`, `.claude/agents/`, `CLAUDE.md` | **Agrega** `ESTADO.md` y `Prompts/COORDINACION.md` (solo en el PR final de una tanda), `scripts/estado-generado.sh` (el «script de estado generado» de F6 vive en `scripts/`), `admin/vitest.config.ts` y `admin/LEEME.md` (separar pruebas puras y documentarlo). **Quita** de la zona ordinaria `.claude/settings.json` y `admin/package.json` (observación 5): se conceden por PR |
| **analista-de-solicitudes** | `CLIENTES/<T>/solicitudes/` | No está en §8.1 (es del §12.4) | Solo lectura del repositorio; `Bash` únicamente para consultas de solo lectura (`git log`, `ls`, `grep`, `estado-de-versiones.sh` sin `--aplicar`) |
| **seguridad** (existente) | Solo lectura | Solo lectura | Igual |
| **Coordinadora** (la sesión) | `registro.ts`, `docs/arquitectura/indice.md`, tablero, cola de fusión | Igual | Sin gancho: es la sesión de Andres |

## Cómo se actualiza esta tabla

Cada PR que cambie la zona de un agente actualiza su ficha en
`.claude/agents/<agente>.md` **y** esta fila, en el mismo PR. La coordinadora
lleva las diferencias al informe de hito para que la revisora las incorpore a
`Analisis/41` o las rechace.
