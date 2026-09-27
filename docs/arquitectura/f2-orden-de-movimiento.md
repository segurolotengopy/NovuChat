# F2: el orden de movimiento

> Diseño del agente `Plan` (27/09/2026), pedido por el plano
> (`Prompts/rearquitectura-por-capas.md`, bloque F2: «primero el agente de
> diseño entrega la forma de `registro.ts` y el orden de movimiento»). Lo que
> la revisora tiene que decidir está al final. Se borra con
> `admin/pruebas/frontera/destinos-f2.ts`, al cerrar F2.

Medición al 27/09, antes de la tanda cero: 285 archivos, 94 suites, 47 sin
zona (42 fuera de `admin/pruebas/`), 19 cruces; `index.ts` exporta **55**
Functions (el plano dice 52).

## Cómo se mueve

1. **Mueve la coordinadora, con un script revisado; los agentes de zona no.**
   Mover un archivo obliga a editar las importaciones de quienes lo usan, y
   casi ninguno está en la zona del agente: `index.ts`, `ingesta.ts`, las
   suites y los scripts de la raíz, `App.tsx`, `vitest.config.ts`, el CI. La
   tanda 1 toca 13 consumidores y ninguno es de `core-functions`; la de planes
   y prepago, 54. Además cada movimiento cambia `deuda.json`, que es solo de
   la coordinadora. El script (`admin/pruebas/frontera/mudanza.mjs`) reescribe
   con el mismo lector que usa la frontera, en seco por defecto; el modo que
   escribe se llama `--escribir` (nunca `--aplicar`, que dispara
   `acciones-sensibles.sh`). Un verificador `solo-rutas.mjs` compara cada
   archivo viejo con el nuevo con los literales reemplazados: si no quedan
   iguales, el cambio no es solo de rutas. Los agentes revisan cada tanda en
   solo lectura y después hacen la lógica de F2 en su carpeta ya poblada.
2. **Sin archivos puente** en la ruta vieja: un `export * from './core/…/x.js'`
   no lo resuelve Node al quitar tipos (rompe `alta-comercio.mjs`,
   `sembrar.mjs`, `fijar-umbrales.mjs`, `cargar-negocio.mjs`,
   `migrar-instrucciones.mjs`, `lib/contador-catalogo.mjs`, `ensayo.mjs`), y
   git deja de ver el renombre, con lo que el control de la deuda rechaza la
   entrada movida.
3. **Una rama de movimiento no se rebasa: se regenera** con el script sobre el
   `main` nuevo (es determinista). Así se resuelven los choques en `index.ts`,
   `App.tsx`, `deuda.json` y `destinos-f2.ts`.
4. **Los PR de movimiento solo mueven.** Los cortes (C1, C2, C3) van aparte:
   si en la misma tanda cambia el contenido, git puede dejar de ver el
   renombre y la deuda queda «inexplicada».
5. **Los que se parten se mueven enteros en F2 y se parten en F3** (§5 dice
   «Va a» para F2; §7 pone el corte de `ingesta` y `prompt` en F3b; H2 exige
   cero lógica). `ingesta.ts` no se mueve: queda en la raíz con su línea de
   coordinador en `ZONA_POR_ARCHIVO`. `index.ts` no sale de la raíz (`main`).

## Las tandas

F = `admin/functions/src/`, W = `admin/web/src/`, P = `admin/pruebas/`,
S = `admin/scripts/`. Cada tanda lleva `medir-zonas.mjs` antes y después.

| # | Qué | Cruces al terminar |
|---|---|---|
| **T0** | Nada se mueve. Se cierran las pruebas que pasarían en vacío al mover y se agregan las compuertas (ver abajo) | 19 |
| **T1** piloto | `F/atencion.ts → F/core/conteo/`; `F/cierres.ts → F/core/turno/`; `W/lib/atencion.ts → W/core/lib/`; `P/central/{contrato-f1b-consola,copia-por-contrato-consola}.test.ts → P/plataforma/` (`docs/arquitectura/tandas/t1.json`). `SUITES_PURAS`: las dos movidas y `central/contrato-f1b-puras` (regla 4). La `ruta` del análisis de seguridad NO cambia (decisión de la revisora, 27/09) | 16 |
| T2 | `firma`, `claims`, `autorizacion → F/core/seguridad/`; `region`, `opcionesGlobales → F/core/` (`opcionesGlobales` sigue primero en `index.ts`) | 16 |
| T3 | `F/prompt.ts → F/core/prompt/`, entero | 16 |
| T4 | `saneo`, `tipoCambio`, `tipoCambioBcb → F/central/servicios/`; `comportamiento`, `verificarComportamiento → F/central/asistente/`; `mapa → F/central/negocio/`; `reclamos → F/central/reclamos/` | 16 |
| C1 | El registro de eventos (`registrar`, `Evento`, `TipoEvento`, `enmascarar`) de `ingesta.ts` a `F/core/turno/bitacora.ts`, sin tocar una línea. **Decide la revisora** | 11 |
| C2 | `textoPlano`, `sinMarcas → F/core/prompt/texto.ts`; la llamada a Gemini → `F/central/servicios/gemini.ts` | 7 |
| T5 | `planes`, `prepago → F/central/cuenta/`; `pagos`, `pagosConCobrador`, `cobroPrepago`, `cobrador`, `cobranza → F/central/pagar/` (54 consumidores). Segundo seco de `migrar-ejes.mjs` en 0 | 7 |
| Módulos | productos (`lib/csv.ts` pasa a `W/central/lib/`), cobros (+C3: el tipo `ResultadoCotejo` sube a Cobros), agenda, inventario y pedidos, catálogo web, campañas, captación (`lib/archivoPlanes.ts` pasa a `W/central/lib/`). Se preparan en paralelo y se fusionan de a uno, regenerando | 4 |
| W1 | `W/lib/{planes,prepago,pagar,cuenta,bitacora}.ts → W/central/lib/`; `sesion`, `contexto → W/core/lib/` | 4 |
| W2 | Las páginas de Central → `W/central/paginas/`; `ConfiguracionVertical → W/central/componentes/ConfiguracionModulo.tsx`; `Tenants → W/plataforma/paginas/` | 4 |
| FL1 | `Flujos/src/comun → Flujos/src/core/`; de `reservas/`: dos a `core/medios/`, cuatro a `modulos/cobros/`, siete a `modulos/agenda/`. 8/8 JSON idénticos | 4 |
| FL2 | Extraer los Code de Demo B y del onboarding (`core-flujos`). El onboarding parte de `dd13823` (con los PR #237 y #238 de la cartera, que cambiaron su topología); la cartera no tiene nada más en curso sobre ese flujo (27/09) | 4 |
| S1, S2 | Scripts de Plataforma → `S/plataforma/`; de carga → `S/datos/`. Con los runbooks y `.claude/agents` en el mismo PR, y aviso a la cartera. **Antes: `rutas-escritas.test.ts` con parser** (pendiente de la revisión del #239, abajo). **Nunca el 01/10 de 08:00 a 12:00** (la cartera usa `asignar-plan.mjs`) | 4 |
| Pz | Las suites de la raíz con zona por su grafo → `P/core|central|plataforma/` | 4 |
| P1 | Partir `index.ts` (callables → `F/plataforma/tenants.ts` y `F/central/usuarios.ts`), solo después de C1 | 4 |
| Z | Zona para los 42 sin zona (`App.tsx`, `main.tsx`, `consola.tsx` → coordinador por archivo). **Decide la revisora** | 4 |
| Cierre | Borrar `destinos-f2.ts` y `medir-zonas.mjs`; `ZONA_POR_ARCHIVO` para `ingesta.ts`, `index.ts` y el ensamblador | 4 (9 sin C1) |

Después, en el carril de lógica, cada agente en su carpeta: conectar el
registro (fuera las siete copias de la lista de flujos), `tieneModulo`, el
límite de agendas, los chequeos de inventario y catálogo. `tenants.modulos` en
ventana y **en dos pasos** (escribir `modulos` conservando `flujos`, desplegar,
recién después quitar `flujos`), con Bellido y Platinum en prueba.

## La tanda cero: qué cierra

| Prueba que pasaba en vacío al mover | Por qué | Cómo queda |
|---|---|---|
| `core/registro.test.ts` §5 | Recorría un solo nivel de `functions/src`: un archivo movido dejaba de revisarse | Todas las subcarpetas, con control de que las ve |
| `core/registro.test.ts` §7 | Buscaba la zona por la clave vieja del inventario: un archivo movido se saltaba | `zonaDeCodigo` más las partes pendientes por nombre; control: las 19 Functions de los manifiestos se verifican todas |
| `central/ejes.test.ts` | Tres carpetas fijas, un nivel | `functions/src` y `scripts` enteros |
| `prepago-separacion.test.ts` | Lista filtrada con `existsSync` en la raíz y especificadores como texto: la única guarda de que Cobros no importe Pagar | Busca por nombre en todo `functions/src` y compara los imports resueltos (contraprueba: `cobro.ts` movido e importado desde `pagos.ts` falla) |
| `scripts/preparar-staging.sh` | `grep admin/functions/src/*.ts`: un secreto de un archivo movido dejaba de crearse en staging | `grep -r --include='*.ts'` (25 secretos, igual que antes) |
| `SUITES_PURAS` | Una ruta vieja no falla: la suite cae a «emulador» | `vitest.config.ts` corta si una entrada no existe |

Y dos compuertas nuevas, en `admin/pruebas/frontera/` (zona de la
coordinadora):

- **`rutas-escritas.test.ts`**: todo import relativo de todo script (también
  los sin zona), todo literal `functions/(src|lib)/…` y todo
  `join(FUENTES, '…')` llevan a un archivo que existe. Contraprueba: mover
  `atencion.ts` la hace fallar.
- **`despliegue.test.ts`**: los 55 nombres que exporta `index.ts` y el
  `__endpoint` de cada uno (región, cuenta de servicio, secretos, disparador,
  instancias) son exactamente los de `despliegue.json`. Una Function nueva
  fuera de F2 lo regenera con `ACTUALIZAR_DESPLIEGUE=si`, y el diff va a la
  vista.

La tanda cero cierra además el último LOW de la cuarta revisión del #236: el
lector de la frontera toma por calculado todo `createRequire`,
`getBuiltinModule`, `.require` o `['require']` fuera del patrón que sigue.

**Las herramientas de mudanza** (PR #241, antes de la tanda 1), en
`admin/pruebas/frontera/`:

- `mudanza.ts`: la lógica, probada en `mudanza.test.ts` sobre un árbol
  inventado. Reescribe un literal solo en contextos conocidos (import/export,
  `import()`, `require`, `vi.mock`, `new URL`, `join`/`resolve`, lecturas,
  `SUITES_PURAS`); uno que coincide con una ruta movida en otro lugar se avisa.
- `mudanza.mjs <tanda.json>`: en seco por defecto. Valida la tanda antes de
  nada (rutas relativas normales, dentro de las raíces, misma extensión, `de`
  versionado, `a` libre, sin enlaces); con `--escribir` exige el worktree
  limpio, hace `git mv -n` de toda la tanda antes de mover, reescribe, lista los
  cruces de la deuda que la tanda salda y falla si la ruta vieja queda en
  código (completa o sin `admin/`; los comentarios se corrigen a mano).
- **La tanda va versionada en el PR**: `docs/arquitectura/tandas/tN.json`, con
  `movimientos` (`{ de, a }`) y `suitesPuras` (las suites que la tanda agrega a
  `SUITES_PURAS`; `asignar-rol.test.ts` está vetada).
- **La compuerta solo vale corrida desde la BASE**, nunca con la copia del
  PR (que podría decirse «todo en orden» a sí misma desde cualquier archivo que
  importa):
  `git show origin/main:admin/pruebas/frontera/desde-la-base.sh | bash -s -- docs/arquitectura/tandas/tN.json`.
  Extrae la herramienta del merge-base y la corre contra el worktree del PR.
  Un PR de tanda no puede tocar la herramienta ni lo que ella importa
  (`destinos-f2.ts`, `functions/src/registro.ts`). La tanda solo vive en
  `docs/arquitectura/tandas/`, sin claves de más, y sus rutas solo aceptan
  `[A-Za-z0-9._-/]`.
- `solo-rutas.mjs docs/arquitectura/tandas/tN.json [base]`:
  **reproducibilidad**. Lee la tanda del commit, la valida contra el árbol de
  la base, vuelve a correr el plan sobre el `merge-base` y exige cada archivo
  del PR byte a byte. A mano solo se acepta: quitar deuda saldada; en
  `vitest.config.ts`, las suites declaradas (el resto del archivo, idéntico por
  AST); en un comentario, la CITA de la ruta nueva y nada más (un
  `/*#__PURE__*/` le quitaría App Check a la consola); y los `.md`, que se
  listan si cambian más que la cita, para revisarlos a mano.

Ensayo completo de la tanda 1 con la herramienta y la tanda versionada (en un
worktree descartable): 5 movidos y 15 reescritos, 3 comentarios corregidos a
mano, 3 entradas de deuda saldadas y 3 suites a `SUITES_PURAS` (las dos de F1b
movidas y `central/contrato-f1b-puras`); `solo-rutas` pasa, y con un
`/*#__PURE__*/` plantado falla; `functions:build` (sin
`lib/atencion.js` viejo) y `web:build` en verde; 2.491 pruebas puras en verde en
50 archivos, instantánea de despliegue idéntica, `registro.test.ts` 53 en
verde, 16 cruces y los 8 flujos idénticos.

**Pendiente de la revisión de seguridad del #239**, para ese PR o antes de la
tanda que lo necesita:

- **Antes de S1 y S2** (mover scripts): `rutas-escritas.test.ts` lee rutas con
  expresiones regulares y no ve `join(aqui, …)` sin constante base,
  `resolve`/`path.join`/`new URL`, plantillas, variables intermedias ni rutas
  en `.sh` sin comillas; pasarlo al parser y marcar como error todo
  `join(BASE, <no literal>)` hacia `admin/functions`. Además, una compuerta
  para las referencias a `admin/scripts/*` desde `admin/package.json`, los
  runbooks y `.claude/agents`.
- **Lector de la frontera:** marcar como calculado todo import de `module`
  distinto de `import { createRequire }`, todo acceso por clave no literal,
  `_load`, `new Function` y `eval`, y la exportación de un alias de
  `createRequire` (evasiones deliberadas; `o.require` hoy da un falso
  positivo sin casos).
- **Citas de ruta que la tanda 2 dejó sin corregir** (la compuerta no las
  acepta todavía): el comentario de `admin/vitest.config.ts` que cita
  `functions/src/opcionesGlobales.ts` (la regla de ese archivo exige los
  comentarios idénticos; que acepte `reemplazarRutas`) y
  `sembrar-demos.mjs:437` y `superadmin.mjs:85`, donde la ruta cierra una
  oración con punto (que el límite de `reemplazarRutas` acepte `.` seguido de
  espacio o fin de línea). El control de restos de `mudanza.mjs` no debería
  listar `docs/arquitectura/tandas/`, y debería mirar también `.github/*.md`
  (la tanda 2 corrigió a mano `DESPLIEGUE-FIREBASE.md`, que no revisaba).
  La tanda 3 dejó sin corregir `functions/src/prompt.ts` en tres casos
  distintos: los comentarios de `alta-comercio.mjs:71`, `asignar-numero.mjs:90`
  y `completar-flujos.mjs:29` (la ruta cierra la oración con punto, como
  arriba); dos comentarios de `admin/firestore.rules` (229 y 671: la compuerta
  no reconoce comentarios en las reglas), y el valor `_umbral-del-prompt` de
  `scripts/datos/negocio-demo-venta-{resto,walisuma}.json` (es un dato, no un
  comentario).
- **La separación seña/prepago es solo directa:** existe el camino
  `sena.ts → ingesta.ts → prepago.ts`. Una prueba transitiva, o el corte de
  `ingesta` en F3b.

## Para la revisora

1. **`ruta: './admin'` achica el análisis de seguridad**: Semgrep, Trivy,
   Checkov y OSV dejan de mirar `Flujos/*.json`, los `scripts/` de la raíz y
   `.github/`. Y la `ruta` está en `ci-node-firebase.yml`, no en
   `.devsecops.yml` (que ya dice `./admin`). Conviene decidirlo antes de T1.
2. **Contradicciones de `Analisis/41` con el código:** §5.1 manda `ingesta.ts`
   (coordinador) a `core/turno/`, contra «carpeta = zona»; `index.ts` «va a»
   `plataforma/tenants.ts` pero `main` lo ata a la raíz; 42 archivos sin
   destino (entre ellos `App.tsx`, `main.tsx` y `consola.tsx`, que importan
   todas las zonas) y sin destino para las suites de coordinador y las que solo
   leen JSON de flujos; F2 pide `tenants.modulos`, `tieneModulo` y límites
   (lógica) y H2 exige cero lógica en el diff; «74 suites» y «52 Functions»
   son hoy 94 y 55, y mover las fuentes cambia rutas **dentro** de las suites;
   §8.3 permite mover los módulos en paralelo, pero la deuda es exclusiva de la
   coordinadora y los PR chocan en `index.ts` y `App.tsx`; §5.4 reparte
   `reservas/` entre Agenda y Cobros y el inventario manda dos a `core/medios`.
3. **`tenants.modulos` en dos pasos** (§6.2 dice «reemplazar»).
4. **C1**: si se baja el registro de eventos de `ingesta.ts` al Core en F2
   (salda 5 cruces y habilita partir `index.ts`).
5. **Zonas sin dueño en `agentes.md`**: `W/core/`, `Flujos/manifiestos/`,
   `F/index.ts`, `F/ingesta.ts`, `.github/`.
