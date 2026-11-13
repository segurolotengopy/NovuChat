# Mudanza de un flujo a `Flujos/clientes/<tenant>/`

Procedimiento general para pasar un flujo de `Flujos/experimental/<x>/` a su carpeta de cliente, `Flujos/clientes/<tenant>/` (regla de zonas: «Flujo de cliente»). Es la etapa 0 de la migración de flujos: **solo se cambia de lugar; no se cambia un byte de lo que el flujo es ni de lo que está publicado.** El patrón sale de `Flujos/clientes/novuchat/PROPIO.md`, sección «Camino de la mudanza». Ejemplo ejecutado: Walisuma (12/11/2026).

Costo de una mudanza: 0 mensajes por conversación agregados o quitados, 0 escrituras en la nube, una corrida de CI.

## Por qué una mudanza nunca publica

Un flujo versionado puede llevar cambios que todavía no se publicaron. Si la mudanza reaplicara el JSON a n8n, esos cambios saldrían a producción sin que nadie los hubiera decidido, escondidos en un PR que parece de carpetas. Por eso la decisión de Andres del 12/11/2026 separa tres cosas:

- **«Byte a byte»** se compara contra el **JSON versionado en `main`**, no contra lo que corre en n8n: el JSON de después de la mudanza tiene la misma huella sha256 que el de antes.
- **La diferencia frente a lo vivo se declara** en la fila del flujo (tablero y `docs/versiones-por-cliente.md`); no se corrige en la mudanza.
- **Publicar es un botón aparte, por flujo**, con su propio PR o su propia autorización. Una mudanza no lo contiene.

## Prohibido en un PR de mudanza

- **Cualquier escritura en n8n**: `scripts/publicar-flujo.sh --aplicar` (y `--crear`, `--encender`), `flujo-de-prueba.mjs`, `scripts/preparar-import.sh` contra n8n, una importación o un Publish. La única lectura permitida es el modo seco de `./scripts/estado-de-versiones.sh` (paso 6), que llama a esos scripts sin aplicar nada.
- Cualquier cambio en `Flujos/src/`, en la plantilla (`flujo.plantilla.json`) o en los datos del tenant (`admin/scripts/datos/<tenant>/`).
- Regenerar los JSON con `construir.mjs` sin `--verificar`: si el armado difiere del versionado, la mudanza cambió algo y no es una mudanza.
- Arreglar de paso un defecto del flujo. Lo que hoy no cumple entra como excepción declarada, no como parche.

Si un paso exige romper una de estas prohibiciones, el cambio no es una mudanza: se hace en otro PR.

## Pasos

### 0. Requisito previo

El flujo tiene su fila en el tablero `docs/arquitectura/migracion.md` (la crea el PR de la definición de «migrado»), con la **diferencia frente al vivo declarada**: «sin publicar», «versionado adelantado», «igual al vivo» o «no verificado». Sin fila no se muda: la fila es lo que impide que la mudanza esconda un atraso.

#### Regla de las carpetas compartidas (medida el 12/11/2026)

Una carpeta que **otros flujos importan** no se muda hasta que se cumpla **una** de dos condiciones:

- (a) la parte compartida **sube a `Flujos/src/`** (etapa 1 de la migración), con lo que nadie la importa por ruta de carpeta; o
- (b) **el mismo PR reapunta a todos sus importadores** y los JSON de todos ellos siguen **byte a byte iguales** (huella antes y después de cada uno, `--verificar` en 0 para cada importador).

Importadores medidos con grep (`[.][.]/(experimental/)?<x>/` en `*.mjs` y `*.js` de `Flujos/`, fuera de la propia carpeta; y `experimental/<x>/`, `../<x>/` o `fuente('<x>/` en `admin/pruebas` y `admin/scripts`, archivos que incluyen las pruebas de la propia carpeta):

| Carpeta | Flujos que la importan | Archivos de `admin/pruebas` y `admin/scripts` |
|---|---|---|
| `rroca-ruben` | `walisuma` (ya en `clientes/`), `rroca-antonio`, `casa-bermejo` | 24 |
| `rroca-antonio` | ninguno | 16 |
| `venta-minima` | `walisuma`, `doctoras`, `rroca-emma`, `rroca-evy`, `casa-bermejo` | 23 |
| `venta-digital` | `walisuma`, `rroca-antonio`, `rroca-ruben`, `casa-bermejo` | 16 |
| `comun-sin-agente` | 12 carpetas (casi todas: `venta-minima`, `captacion-minima`, `rroca-antonio`, `doctoras`, `rescate-22h`, `agenda-minima`, `walisuma`, `rroca-ruben`, `rroca-emma`, `chat-novuchat`, `casa-bermejo`, `rroca-evy`), incluidos sus `herramientas/bateria.mjs` | 48 |

`comun-sin-agente` y `venta-digital` son proveedoras: no son flujos de un cliente y se quedan en `experimental/` hasta la etapa 1. Antes de una mudanza se repite esta medición (los números cambian) y se pega el resultado en el PR.

**Consecuencia para el paso 3:** la regla «`../<otro>/` pasa a `../../experimental/<otro>/`» vale solo mientras `<otro>` sigue en `experimental/`. Cuando `<otro>` ya se mudó, la ruta correcta es `../<otro>/` (ya está en `Flujos/clientes/`). Se mira dónde está hoy cada carpeta importada, no se aplica la regla de memoria.

### 1. Huella antes

Desde `origin/main`, sin tocar nada:

```bash
git show origin/main:Flujos/experimental/<x>/<flujo>.json | sha256sum
git show origin/main:Flujos/experimental/<x>/<flujo>.prueba.json | sha256sum   # si existe
```

Se anotan las huellas completas en el PR (en este documento y en los ejemplos solo se escriben los primeros y los últimos caracteres). Para un flujo vivo se corre además el modo seco de `./scripts/estado-de-versiones.sh` con el `.env` del cliente (paso 6) y se guarda su salida.

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
| Pruebas | `grep -rIn "experimental/<x>\|'<x>/src\|<x>/src/\|join(FLUJOS, '<x>')" admin/pruebas` y, aparte, `grep -rIn "<x>/src" admin/pruebas` | Importaciones de `construir.mjs`, constantes `CARPETA`, listas de fuentes y rutas armadas con plantilla de texto (`fuente(`<x>/src/nodos/${a}.js`)`), que el grep por comillas simples no ve. Para pruebas que parten de `FLUJOS = Flujos/experimental`, la forma es `'../clientes/<tenant>/src/...'` (por ejemplo `fuente('<x>/src/lib/a.js')` pasa a `fuente('../clientes/<tenant>/src/lib/a.js')`, y `fuente(`<x>/src/nodos/${a}.js`)` a `fuente(`../clientes/<tenant>/src/nodos/${a}.js`)`); las que parten de la raíz usan `Flujos/clientes/<tenant>/...`. Al terminar, el segundo grep no debe devolver ninguna ruta sin el prefijo `clientes/<tenant>/`. |
| `guardado-obligatorio.test.ts` | `grep -n "experimental/<x>" admin/pruebas/guardado-obligatorio.test.ts` | La línea con la ruta del flujo. |
| `publicar-flujo.sh` | `grep -n "experimental/<x>" scripts/publicar-flujo.sh` | Solo si el script nombra al flujo (guardias de otros flujos usan esta forma). Si aparece, el cambio del script va en un PR aparte: tocarlo aquí es riesgo de publicar. |
| `estado-de-versiones.sh` | `grep -n "<x>" scripts/estado-de-versiones.sh` | Idem: si lo nombra, se reapunta y se verifica la salida igual antes y después (paso 6). |
| `vitest.config.ts` | `grep -n "<x>" admin/vitest.config.ts` | Rutas de suites, si las nombra. |
| `verificar-saneo.sh` | `grep -n "experimental\|<x>" scripts/verificar-saneo.sh` | Exclusiones por ruta, si las hay. |
| Documentos | `grep -rIn "experimental/<x>" . --exclude-dir=node_modules --exclude-dir=.git` | `PROPIO.md`, `DISENO.md`, `docs/`, `ESTADO.md`. La bitácora (`bitacora/`) es historia y no se reescribe. |

#### Referencias entrantes (las que otros tienen a la carpeta movida)

Las filas de arriba cubren lo que sale de la carpeta; faltan las que **llegan** a ella desde otras carpetas. Se buscan con (desde la raíz; `<x>` es el nombre viejo):

```bash
grep -rlE "[.][.]/<x>/" Flujos --include=*.mjs --include=*.js --exclude-dir=<x> --exclude-dir=node_modules
grep -rlE "experimental/<x>/|[.][.]/<x>/|fuente\('<x>/" admin/pruebas admin/scripts
```

Cada resultado se reapunta en el mismo PR (regla de las carpetas compartidas, arriba). Si el primer grep da resultados y no se cumple (a) ni (b), no se muda.

#### `scripts/publicar-flujo.sh` y `.env`: el orden importa

`scripts/publicar-flujo.sh` tiene **rutas fijas** a `construir.mjs` en sus guardias (líneas 159, 226, 299, 364 y 476 el 12/11/2026): `Flujos/experimental/rroca-ruben/`, `rroca-antonio/`, `doctoras/`, `rroca-evy/` y `rroca-emma/`. Al mudar uno de esos, la guardia busca un archivo que ya no existe, **falla cerrada** y el flujo vivo no se puede publicar. Por eso el cambio de esas rutas va **en el mismo PR de la mudanza** (con la prueba que lo cubre: `scripts` y `frontera/rutas-escritas`), nunca después: un PR posterior dejaría el flujo vivo sin publicación mientras tanto, y reabrir la guardia con prisa es el riesgo que la guardia existe para evitar. El cambio es solo de ruta; no se toca la lógica de la guardia.

La columna «Flujo versionado» de `docs/versiones-por-cliente.md` (la lee `estado-de-versiones.sh`) apunta hoy a `Flujos/experimental/` en las filas de `venta-minima/venta-minima.qtaco.json`, `rroca-ruben/`, `rroca-evy/`, `rroca-emma/`, `chat-novuchat/`, `captacion-minima/` y `rroca-antonio/`, además de las filas sin entorno (por ejemplo `casa-bermejo/`). Se obtiene la lista vigente con `grep -n "Flujos/experimental/" docs/versiones-por-cliente.md` y cada fila se reapunta en la mudanza de su flujo. Los `.env.<cliente>` de las filas con entorno no contienen la ruta, pero son los que hacen falta para el paso 6: sin el `.env` de la fila, no se muda un flujo vivo.

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

Para un flujo que corre en n8n se usa **solo el modo seco** de `./scripts/estado-de-versiones.sh`: compara lo vivo con lo versionado y **no escribe nada en n8n** (por dentro llama a `preparar-import.sh` y a `publicar-flujo.sh` sin `--aplicar`; esa es la única excepción a la prohibición de esos scripts). Condiciones:

- Se corre con el `.env.<cliente>` del cliente (en un worktree, con enlaces a los `.env` de la copia base). **Quien no tenga ese `.env` no muda un flujo vivo.**
- La salida debe ser **0 o 1 antes y la misma después**. La salida **3** («sin poder comprobar») **no vale**: comparar dos veces «no pude comprobar» es cumplir en vacío.
- Se borra el `.local.json` que el script deje al correr (es el JSON con los marcadores repuestos; contiene valores del cliente y nunca se versiona ni se sube).
- Si la salida cambia, la mudanza modificó lo que se compara con lo vivo: se deshace.

### 7. Filas

- `docs/versiones-por-cliente.md`: una fila del flujo (o la existente con la ruta nueva), con la excepción que corresponda y la huella abreviada.
- Tablero `docs/arquitectura/migracion.md`: el estado pasa a «mudado» y se anota la huella. Si el tablero todavía no existe cuando se abre el PR de la mudanza, la fila se agrega cuando entre el PR de la definición; el PR de la mudanza lo declara.

### 8. Suites

Se corren las del flujo (`admin/pruebas/tenants/<tenant>/`), `crm-hallazgos-flujos`, `guardado-obligatorio`, `core/nucleo-comun`, `fronteras`, `./scripts/verificar-saneo.sh --patrones` y, al final, `pnpm --dir admin pruebas:puras` completo. Las huellas sha256 completas no disparan el saneo si se escriben abreviadas (primeros y últimos caracteres): un tramo largo de dígitos en una huella completa choca con la regla de secuencias largas.

El PR se abre en borrador y declara: huellas iguales, que no publica, y el costo en las tres unidades.

## Ejemplo ejecutado: Walisuma (12/11/2026)

- Antes: `Flujos/experimental/walisuma/`, sin publicar (sin flujo vivo que comparar).
- Huellas antes y después, iguales: `walisuma.json` `1ca574f2…70cc1` y `walisuma.prueba.json` `0375d63e…49043`.
- `git mv Flujos/experimental/walisuma Flujos/clientes/walisuma`; `git diff -M --stat origin/main -- Flujos`: 12 archivos, renombres con 0 líneas cambiadas salvo `construir.mjs` (22 líneas de rutas) y `PROPIO.md` (2 líneas); `DISENO.md` y `src/` sin cambios.
- Walisuma cumple la regla de carpetas compartidas porque nadie la importa (sus importadores son salientes) y no tiene flujo vivo: no hubo paso 6 ni cambio en `publicar-flujo.sh`.
- Rutas reapuntadas en `construir.mjs`: `../comun-sin-agente/`, `../rroca-ruben/`, `../venta-minima/` y `../venta-digital/` pasaron a `../../experimental/…`; las rutas a `../../src/…` no cambiaron.
- Fuera de la carpeta: `armado.test.ts`, `crm.test.ts` y `mundo.ts` de `admin/pruebas/tenants/walisuma/`, las dos líneas de `crm-hallazgos-flujos.test.ts` y la línea de `guardado-obligatorio.test.ts`. Ni `publicar-flujo.sh`, ni `estado-de-versiones.sh`, ni `vitest.config.ts`, ni `verificar-saneo.sh` nombraban a Walisuma.
- `construir.mjs --verificar`: sale 0 («walisuma.json al día (64 nodos)» y «walisuma.prueba.json al día (59 nodos)»).
- No se corrió `publicar-flujo.sh`, `flujo-de-prueba.mjs` ni `preparar-import.sh`; no se tocó n8n.

## Ejemplo ejecutado: Casa Bermejo (13/11/2026)

- Antes: `Flujos/experimental/casa-bermejo/`, sin publicar. Nadie lo importa (el grep de entrantes en `Flujos/` da vacío); él importa `comun-sin-agente`, `rroca-ruben`, `venta-minima` y `venta-digital`, todas aún en `experimental/`, y nada de Walisuma.
- Huellas antes y después, iguales: `casa-bermejo.json` `273fb2c9…3cd35f37`, `casa-bermejo.prueba.json` `5ae99a40…67f25` y `flujo.plantilla.json` `a55a0db5…0fcd30`.
- `git diff -M --stat origin/main -- Flujos`: 12 archivos, renombres con 0 líneas cambiadas salvo `construir.mjs` (23 líneas de rutas) y `PROPIO.md` y `DISENO.md` (una línea cada uno).
- Fuera de la carpeta: `armado.test.ts`, `alias-ar.test.ts`, `catalogo-flujo.test.ts`, `pedido-lineas.test.ts` y `mundo.ts` de `admin/pruebas/tenants/casa-bermejo/`, `venta-casa-bermejo-lib.test.ts` y `guardado-obligatorio.test.ts`; las filas de `docs/versiones-por-cliente.md` y del tablero. `excepciones.ts`, `scripts/` y `vitest.config.ts` sin cambios.
- `construir.mjs --verificar`: sale 0 (57 y 52 nodos). `pnpm --dir admin pruebas:puras`: 232 archivos, 14662 pruebas pasadas, 3 omitidas.
- Tropiezo: la primera corrida falló porque `armado.test.ts` armaba una ruta con plantilla de texto (`fuente(`casa-bermejo/src/nodos/${a}.js`)`) que el grep original no cubría; de ahí el grep ampliado del paso 3.

## Las claves `experimental/<x>/…` de `excepciones.ts` NO se tocan en la mudanza

En `admin/pruebas/core/migracion/excepciones.ts` quedan claves como `experimental/<x>/<flujo>.json`. **No se cambian en la mudanza y no son huérfanas:** la prueba las compara por identificador, y `idDeFlujo` (`admin/pruebas/core/migracion/comprobaciones.ts`) quita el prefijo `experimental/` o `clientes/` (`ruta.replace(/^(experimental|clientes)\//, '')`), de modo que `experimental/walisuma/walisuma.json` y `clientes/walisuma/walisuma.json` son el mismo identificador. Cambiar la carpeta del flujo no obliga a editar la lista. Tocar `excepciones.ts` (o su TOPE) pasa por el agente `seguridad`: es la lista cerrada que solo puede bajar, y una mudanza no es motivo para abrirla. Se comprueba con `grep -n "<x>" admin/pruebas/core/migracion/excepciones.ts` (solo para saber qué excepciones lleva el flujo y declararlas en la columna «falta» del tablero).

## Lo que este procedimiento no cubre

- **Publicar** el flujo ni reaplicarlo: botón aparte, por flujo.
- **Unificar** los nodos comunes con las variantes de `Flujos/src/core` (quitar copias): es una etapa posterior, con su suite y sin quitar un caso.
- **Saber qué corre en n8n:** la mudanza declara la diferencia con lo vivo, no la mide. Si no se verificó, la fila lo dice.
- **Arreglar** defectos del flujo, sus excepciones o su prompt.
- **Flujos congelados** (se retiran en un PR aparte) y los barridos comunes, que no pertenecen a un tenant.
- **Datos del tenant** (`admin/scripts/datos/<tenant>/`) y reglas o documentos de la consola.
- **Renombrar** el flujo, su tenant o sus nodos: cambia la huella y deja de ser una mudanza.
