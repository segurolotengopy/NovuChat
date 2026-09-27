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
| **T1** piloto | `F/atencion.ts → F/core/conteo/`; `F/cierres.ts → F/core/turno/`; `W/lib/atencion.ts → W/core/lib/`; `P/central/{contrato-f1b-consola,copia-por-contrato-consola}.test.ts → P/plataforma/`. `ruta` de `ci-node-firebase.yml` a `./admin` (regla 3, si la revisora lo confirma). `SUITES_PURAS`: las dos movidas y `central/contrato-f1b-puras` (regla 4) | 16 |
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
| FL2 | Extraer los Code de Demo B y del onboarding (`core-flujos`). **El onboarding espera los PR de la cartera sobre `Flujos/novuchat-onboarding.json`** (#237 fusionado; #238 en curso) y parte del JSON con ellos ya fusionados | 4 |
| S1, S2 | Scripts de Plataforma → `S/plataforma/`; de carga → `S/datos/`. Con los runbooks y `.claude/agents` en el mismo PR, y aviso a la cartera | 4 |
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

Las herramientas de mudanza (`mudanza.mjs`, `solo-rutas.mjs`) van en un PR
propio antes de la tanda 1.

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
