# Mudanza de un flujo a `Flujos/clientes/<tenant>/`

Procedimiento general para pasar un flujo de `Flujos/experimental/<x>/` a su carpeta de cliente, `Flujos/clientes/<tenant>/` (regla de zonas: «Flujo de cliente»). Es la etapa 0 de la migración de flujos: **solo se cambia de lugar; no se cambia un byte de lo que el flujo es ni de lo que está publicado.** El patrón sale de `Flujos/clientes/novuchat/PROPIO.md`, sección «Camino de la mudanza». Ejemplo ejecutado: Walisuma (12/11/2026).

Costo de una mudanza: 0 mensajes por conversación agregados o quitados, 0 escrituras en la nube, una corrida de CI.

## Por qué una mudanza nunca publica

Un flujo versionado puede llevar cambios que todavía no se publicaron. Si la mudanza reaplicara el JSON a n8n, esos cambios saldrían a producción sin que nadie los hubiera decidido, escondidos en un PR que parece de carpetas. Por eso la decisión de Andres del 12/11/2026 separa tres cosas:

- **«Byte a byte»** se compara contra el **JSON versionado en `main`**, no contra lo que corre en n8n: el JSON de después de la mudanza tiene la misma huella sha256 que el de antes.
- **La diferencia frente a lo vivo se declara** en la fila del flujo (tablero y `docs/versiones-por-cliente.md`); no se corrige en la mudanza.
- **Publicar es un botón aparte, por flujo**, con su propio PR o su propia autorización. Una mudanza no lo contiene.

## Prohibido en un PR de mudanza

- Correr `scripts/publicar-flujo.sh` (con o sin `--aplicar`), `flujo-de-prueba.mjs` o `scripts/preparar-import.sh` contra n8n.
- Cualquier cambio en `Flujos/src/`, en la plantilla (`flujo.plantilla.json`) o en los datos del tenant (`admin/scripts/datos/<tenant>/`).
- Regenerar los JSON con `construir.mjs` sin `--verificar`: si el armado difiere del versionado, la mudanza cambió algo y no es una mudanza.
- Arreglar de paso un defecto del flujo. Lo que hoy no cumple entra como excepción declarada, no como parche.

Si un paso exige romper una de estas prohibiciones, el cambio no es una mudanza: se hace en otro PR.

## Pasos

### 0. Requisito previo

El flujo tiene su fila en el tablero `docs/arquitectura/migracion.md` (la crea el PR de la definición de «migrado»), con la **diferencia frente al vivo declarada**: «sin publicar», «versionado adelantado», «igual al vivo» o «no verificado». Sin fila no se muda: la fila es lo que impide que la mudanza esconda un atraso.

### 1. Huella antes

Desde `origin/main`, sin tocar nada:

```bash
git show origin/main:Flujos/experimental/<x>/<flujo>.json | sha256sum
git show origin/main:Flujos/experimental/<x>/<flujo>.prueba.json | sha256sum   # si existe
```

Se anotan las huellas completas en el PR (en este documento y en los ejemplos solo se escriben los primeros y los últimos caracteres). Para un flujo vivo se corre además `./scripts/estado-de-versiones.sh` y se guarda su salida.

### 2. Mover

```bash
git mv Flujos/experimental/<x> Flujos/clientes/<tenant>
```

Una sola operación, sin editar archivos antes. `git diff -M --stat` debe mostrar los JSON y los archivos de `src/` como renombres con 0 líneas cambiadas.

### 3. Reapuntar rutas

Dentro de la carpeta movida, las rutas relativas a otro flujo pasan de `../<otro-flujo>/` a `../../experimental/<otro-flujo>/`. La profundidad es la misma (`Flujos/experimental/<x>/` y `Flujos/clientes/<tenant>/` están a dos niveles de `Flujos/`), así que `../../src/` (módulos comunes) y `../../../admin/` (datos) no cambian. Fuera de la carpeta, cada referencia a la ruta vieja se reapunta. La lista de comprobación, con los grep exactos (se corren desde la raíz del repositorio; `<x>` es el nombre viejo, `<tenant>` el nuevo):

| Dónde | Grep exacto | Qué se reapunta |
|---|---|---|
| `construir.mjs` y `src/` de la carpeta | `grep -n "\.\./" Flujos/clientes/<tenant>/construir.mjs` y `grep -rn "\.\./" Flujos/clientes/<tenant>/src` | Toda ruta con `../`: a otros flujos (`../../experimental/<otro>/`), a `Flujos/src/` (`../../src/`) y a `admin/scripts/datos/` (`../../../admin/`). Mirar también las claves `raiz`, `librerias` y `comun` del ensamblado. |
| Pruebas | `grep -rIn "experimental/<x>\|'<x>/src\|join(FLUJOS, '<x>')" admin/pruebas` | Importaciones de `construir.mjs`, constantes `CARPETA` y listas de fuentes (`fuente('<x>/src/...')` pasa a `fuente('../clientes/<tenant>/src/...')` si `fuente` parte de `Flujos/experimental/`). |
| `guardado-obligatorio.test.ts` | `grep -n "experimental/<x>" admin/pruebas/guardado-obligatorio.test.ts` | La línea con la ruta del flujo. |
| `publicar-flujo.sh` | `grep -n "experimental/<x>" scripts/publicar-flujo.sh` | Solo si el script nombra al flujo (guardias de otros flujos usan esta forma). Si aparece, el cambio del script va en un PR aparte: tocarlo aquí es riesgo de publicar. |
| `estado-de-versiones.sh` | `grep -n "<x>" scripts/estado-de-versiones.sh` | Idem: si lo nombra, se reapunta y se verifica la salida igual antes y después (paso 6). |
| `vitest.config.ts` | `grep -n "<x>" admin/vitest.config.ts` | Rutas de suites, si las nombra. |
| `verificar-saneo.sh` | `grep -n "experimental\|<x>" scripts/verificar-saneo.sh` | Exclusiones por ruta, si las hay. |
| Documentos | `grep -rIn "experimental/<x>" . --exclude-dir=node_modules --exclude-dir=.git` | `PROPIO.md`, `DISENO.md`, `docs/`, `ESTADO.md`. La bitácora (`bitacora/`) es historia y no se reescribe. |

La comprobación final es el mismo grep de documentos sobre todo el repositorio: **sin resultados**, salvo la bitácora y la fila de `docs/versiones-por-cliente.md` que cuenta la mudanza.

### 4. Verificar el armado

```bash
node Flujos/clientes/<tenant>/construir.mjs --verificar
```

Debe salir 0 («al día») para cada JSON. Si sale 1, alguna ruta reapuntada cambió lo que se arma: se corrige la ruta, nunca el JSON.

### 5. Huella después, igual

```bash
sha256sum < Flujos/clientes/<tenant>/<flujo>.json
sha256sum < Flujos/clientes/<tenant>/<flujo>.prueba.json
```

Cada huella es idéntica a la del paso 1. Además, `git diff -M --stat origin/main -- Flujos` muestra solo renombres con 0 líneas cambiadas, salvo `construir.mjs` (rutas) y las rutas escritas en `PROPIO.md` y `DISENO.md`. Cualquier otra diferencia es un defecto de la mudanza.

### 6. Flujo vivo: el estado de versiones no cambia

Para un flujo que corre en n8n, `./scripts/estado-de-versiones.sh` da la misma salida antes y después. Si cambia, la mudanza modificó lo que se compara con lo vivo: se deshace.

### 7. Filas

- `docs/versiones-por-cliente.md`: una fila del flujo (o la existente con la ruta nueva), con la excepción que corresponda y la huella abreviada.
- Tablero `docs/arquitectura/migracion.md`: el estado pasa a «mudado» y se anota la huella. Si el tablero todavía no existe cuando se abre el PR de la mudanza, la fila se agrega cuando entre el PR de la definición; el PR de la mudanza lo declara.

### 8. Suites

Se corren las del flujo (`admin/pruebas/tenants/<tenant>/`), `crm-hallazgos-flujos`, `guardado-obligatorio`, `core/nucleo-comun`, `fronteras`, `./scripts/verificar-saneo.sh --patrones` y, al final, `pnpm --dir admin pruebas:puras` completo. Las huellas sha256 completas no disparan el saneo si se escriben abreviadas (primeros y últimos caracteres): un tramo largo de dígitos en una huella completa choca con la regla de secuencias largas.

El PR se abre en borrador y declara: huellas iguales, que no publica, y el costo en las tres unidades.

## Ejemplo ejecutado: Walisuma (12/11/2026)

- Antes: `Flujos/experimental/walisuma/`, sin publicar (sin flujo vivo que comparar).
- Huellas antes y después, iguales: `walisuma.json` `1ca574f2…70cc1` y `walisuma.prueba.json` `0375d63e…49043`.
- `git mv Flujos/experimental/walisuma Flujos/clientes/walisuma`; `git diff -M --stat origin/main -- Flujos`: 12 archivos, renombres con 0 líneas cambiadas salvo `construir.mjs` (24 líneas de rutas) y `PROPIO.md` (2 líneas); `DISENO.md` y `src/` sin cambios.
- Rutas reapuntadas en `construir.mjs`: `../comun-sin-agente/`, `../rroca-ruben/`, `../venta-minima/` y `../venta-digital/` pasaron a `../../experimental/…`; las rutas a `../../src/…` no cambiaron.
- Fuera de la carpeta: `armado.test.ts`, `crm.test.ts` y `mundo.ts` de `admin/pruebas/tenants/walisuma/`, las dos líneas de `crm-hallazgos-flujos.test.ts` y la línea de `guardado-obligatorio.test.ts`. Ni `publicar-flujo.sh`, ni `estado-de-versiones.sh`, ni `vitest.config.ts`, ni `verificar-saneo.sh` nombraban a Walisuma.
- `construir.mjs --verificar`: sale 0 («walisuma.json al día (64 nodos)» y «walisuma.prueba.json al día (59 nodos)»).
- No se corrió `publicar-flujo.sh`, `flujo-de-prueba.mjs` ni `preparar-import.sh`; no se tocó n8n.

## Lo que este procedimiento no cubre

- **Publicar** el flujo ni reaplicarlo: botón aparte, por flujo.
- **Unificar** los nodos comunes con las variantes de `Flujos/src/core` (quitar copias): es una etapa posterior, con su suite y sin quitar un caso.
- **Saber qué corre en n8n:** la mudanza declara la diferencia con lo vivo, no la mide. Si no se verificó, la fila lo dice.
- **Arreglar** defectos del flujo, sus excepciones o su prompt.
- **Flujos congelados** (se retiran en un PR aparte) y los barridos comunes, que no pertenecen a un tenant.
- **Datos del tenant** (`admin/scripts/datos/<tenant>/`) y reglas o documentos de la consola.
- **Renombrar** el flujo, su tenant o sus nodos: cambia la huella y deja de ser una mudanza.
