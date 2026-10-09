# El registro de módulos

> Pieza con nombre propio de la arquitectura por capas
> (`Analisis/41-arquitectura-por-capas.md` §1.1, §3 y §3.3). Destino de la
> política de capas de `admin/DISENO.md` §4sexies, que el registro reemplaza.
> Sin secretos ni identificadores.

## Definición

**Un solo archivo que lista los módulos con sus manifiestos.** Lo leen las
reglas (generadas o verificadas contra él), las Functions, la consola y el
ensamblador de flujos. Es un archivo TypeScript puro (`registro.ts`) que la
consola, las Functions, las pruebas y el ensamblador importan; las reglas de
Firestore lo verifican con una prueba, porque las reglas no importan nada.

Lo escribe la **coordinadora** (`Analisis/41` §8.1): cada agente de módulo
escribe solo en su carpeta y en su línea del registro.

## Qué se deriva del registro: las siete copias de hoy (`Analisis/41` §3.3)

| Copia de hoy | Con el registro |
|---|---|
| `firestore.rules`: `flujosTenant`, `tieneAgenda`, `tieneCobro`, `tieneOnboarding` | `tieneModulo(m)` lee `tenants/{t}.modulos`; una prueba verifica que cada documento y colección de cada manifiesto exige su módulo |
| `index.ts`: `VERTICALES` | Desaparece |
| `prompt.ts`: `VERTICALES_CONOCIDOS`, `documentoDeVertical` | El prompt se arma con `registro.modulos.filter(encendidos).map(m => m.prompt)` |
| `cobro.ts`: elige `venta` o `agendamiento` | Cobros tiene su propio `config/cobros` |
| `catalogoWeb.ts`: `tieneVenta()` | `tieneModulo('catalogo-web')` |
| `captacion.ts:371` | `tieneModulo('captacion')` |
| `web/src/central/lib/flujos.ts` | `registro.modulos.flatMap(m => m.pestanas)` |

`tenants/{t}.modulos` **reemplaza** a `flujos` (decisión del 25/09): nadie está
en producción; mantener dos listas es la séptima copia otra vez.
`Flujos/manifiestos/*.json` se generan del registro más los módulos encendidos
del tenant.

## Cómo se sostiene (`Analisis/41` §9)

`registro.test.ts` obliga a que cada módulo traiga reglas con prueba negativa,
manifiesto completo y declaración de mensajes; `fronteras.test.ts` lee los
`import` de cada archivo y falla si una zona importa hacia arriba o un módulo
importa a otro sin `dependeDe`. Sin esas dos pruebas en verde nada se fusiona
(`Analisis/41` §8.2).

## El registro y el flujo propio de cada cliente (09/10/2026)

El registro lista **módulos**; no lista las piezas propias de un cliente. Cada
cliente tiene su flujo en `Flujos/clientes/<tenant>/` (regla completa en
`tenants.md`, «El flujo de un cliente»): piezas propias declaradas en
`PROPIO.md` más el **núcleo común obligatorio**, que se incluye desde core y
módulos y nunca se copia. Lo que el registro y sus pruebas siguen haciendo
cumplir es lo común; lo propio entra por su declaración.

- **Compuerta futura, no vigente:** una prueba de CI que compare byte a byte lo
  incluido contra la fuente del núcleo. No existe todavía; se construye en un PR
  posterior y recién entonces cuenta como garantía.
- **La segunda vez que otro cliente pide una pieza propia, pasa a módulo**: se
  le abre manifiesto en el registro, con su versión.
- **Barridos comunes** (un barrido por tipo que recorre los tenants): excepción
  declarada a «flujo propio».
- **Fuera de este documento y de este PR:** la versión por cliente en
  `registro.ts`, las columnas de `docs/versiones-por-cliente.md`
  (`estado-de-versiones.sh`) y el cambio de `fronteras.test.ts` para la nueva
  carpeta. Los hace la coordinadora o un PR posterior.
- **Dependencias de la zona «Flujo de cliente» (BORRADOR, propuesta del análisis
  A, sin prueba todavía):** un flujo de cliente puede incluir core y módulos;
  nada fuera de su carpeta puede incluirlo. Se agrega a `fronteras.test.ts`
  cuando exista la zona (hoy `Flujos/experimental/` está fuera de zonas y de
  esa prueba).

## registro.ts (F2, PR 1)

**Dónde vive:** `admin/functions/src/registro.ts`, un solo archivo con
`IDS_MODULOS` (en orden topológico), los nueve manifiestos (`REGISTRO`),
`carpetasDe(m)`, `manifiestoDe(m)` y dos puentes transitorios:
`PUENTE_DE_FLUJOS` (cada flujo de hoy expresado como módulos, que se borra con
la migración `tenants.flujos` → `tenants.modulos`) y `MODULOS_COMUNES_HOY`
(Productos y Campañas, que hoy tiene todo comercio). En el PR 1 **no lo
importa nadie**: existe, se verifica y mide.

**Por qué no importa nada:** lo van a importar cuatro mundos que no comparten
resolución de módulos. Las Functions compilan con `rootDir: src` e importan
`./registro.js`; la consola lo toma con `../../../functions/src/registro`
(como ya hace con `planes.ts`); las pruebas, con la extensión `.ts`; y los
scripts `.mjs`, que Node carga quitando tipos. Node quita tipos pero no
traduce `./x.js` a `./x.ts`, así que un solo `import` relativo rompería la
carga desde los scripts. Por la misma razón la sintaxis es solo la que Node
sabe borrar (sin `enum`, `namespace` ni propiedades de parámetro). Y el
registro **no lleva rutas de archivos que F2 mueve**: las carpetas de un
módulo se derivan del id. Desde el cierre de F2 la carpeta ES la zona, y lo
que no sale de la carpeta lo anota `admin/pruebas/frontera/frontera.ts`
(`ZONA_POR_ARCHIVO` y `SE_PARTE`).

**Cómo se verifica:** `admin/pruebas/core/registro.test.ts` (corre en el proyecto `emulador`, no en
`pnpm pruebas:puras`) comprueba el registro contra el código de hoy en ocho grupos:
estructura y cero `import`; pestañas contra `web/src/central/lib/flujos.ts` y
`App.tsx`; listas blancas de `firestore.rules`; colecciones y Storage;
límites contra `planes.ts` y las reglas; herramientas contra los nodos de
`Flujos/*.json`; Functions contra `index.ts`; y las copias de la lista de
flujos (`prompt.ts`, `flujos.ts`, `index.ts`, reglas y los dos scripts de
alta). Lo que hoy es una incoherencia conocida del código está en una lista
con nombre que solo puede achicarse.

**La medición de F2, retirada:** hasta el cierre, una herramienta de medición
(`scripts/`, retirada) clasificaba cada archivo por el inventario de destinos y se citaba en cada
informe de tanda. Ya no existe: el inventario se borró con ella. Lo que
medía lo dicen ahora los largos de `deuda.json` (`cruces`, `sinZona`,
`sinResolver`), que `fronteras.test.ts` hace cumplir y el CI compara con la
base. La historia: los cruces bajaron de 19 a 3 y los archivos sin zona, de 42
(26/09) y 47 (28/09) a 0.

## fronteras.test.ts (F2, PR 2)

**Dónde vive:** `admin/pruebas/frontera/fronteras.test.ts` (pura, en
`SUITES_PURAS`), con la regla en `admin/pruebas/frontera/frontera.ts`, que
las herramientas de la carpeta importan también, para que todas cuenten
igual. `ZONA_POR_ARCHIVO` y `SE_PARTE` viven ahí mismo.

**Por qué en `pruebas/frontera/` y no en `pruebas/core/`:** esa carpeta no
está en la zona de ningún agente (`agentes.md`), así que el gancho rechaza que
un agente la edite. En `pruebas/core/`, un agente de Core podía «arreglar» su
propia prueba roja agregando el cruce a la deuda o cambiando la zona de un
archivo en `ZONA_POR_ARCHIVO`, sin salir de su zona (revisión de seguridad del
#231). La regla, la deuda, `ZONA_POR_ARCHIVO` y `SE_PARTE` los cambia solo la coordinadora.

**La zona de un archivo**, en este orden: su línea en `ZONA_POR_ARCHIVO`
(lo que no sale de la carpeta: el registro, los puntos de entrada de la
consola, las herramientas que tocan todas las zonas, `ingesta.ts` e `index.ts`
como coordinador y las herramientas de construcción de flujos como core); y la
carpeta (`core/`, `central/`, `plataforma/`, `modulos/<m>/` bajo cada raíz de
código y `scripts/datos/` para tenants). `SE_PARTE` solo ANOTA las piezas de
otra zona que hay dentro de un archivo y que F3 separa; no cambia su zona y
solo se achica. Las dos tienen su prueba: cada clave existe, y `SE_PARTE`
nombra zonas reales distintas de la del archivo.

**El coordinador de turno** es `ingesta.ts`, en la raíz de Functions hasta F3b;
`index.ts` es coordinador y solo reexporta (salvo `core/opcionesGlobales.ts`,
que va primero). La prueba toma de `index.ts` el archivo que reexporta la
Function `ingesta` y exige que sea coordinador: si alguien lo muda a una
carpeta de zona sin darle su línea, queda como core y la prueba lo ve.

**La regla:** registro < core < central < plataforma < módulo < coordinador <
tenants. Una zona importa de la suya o de las de abajo, y un módulo importa a
otro solo si lo declara, directa o indirectamente, en `dependeDe`.
- **Los imports se leen con el parser de TypeScript**, no con expresiones
  regulares: estáticos, de tipo, reexportaciones, `import x = require()`,
  dinámicos, `require` y `import('…').T`. Un texto con `/*` o un `export` sin
  punto y coma ya no los esconde.
- **Un cruce no se lava:** un import a un archivo sin zona (o, desde una
  prueba, a un ayudante de prueba) se sigue hasta el primer archivo con zona,
  y el cruce se atribuye al origen con su camino («vía …»).
- **El código no importa `functions/src/index.ts`** (sería un atajo a
  cualquier zona) **ni `admin/pruebas/`**. Las reexportaciones de `index.ts`
  no cuentan (son el inventario de despliegue), y una prueba puede importarlo
  para llamar a una callable.
- **Lo que el lector no puede seguir se informa:** un import relativo roto, un
  `import()` o `require` con ruta calculada y un alias (`@/`, `~/`, `#`, ruta
  absoluta). Hoy no se acepta ninguno: `sinResolver` está vacío y solo se
  achica.
- Un script que importa `functions/lib/*.js` (compilado) depende de su fuente
  en `functions/src/`.
- Las pruebas en carpeta de zona siguen la misma regla; `registro.test.ts` es
  la única transversal (compara el registro con el código de todas las
  zonas).

**La deuda conocida, que solo se achica:** los 19 cruces que existían el
26/09 estaban en la prueba, uno por uno, con lo que los saca. Al cierre de F2
quedan 3, los tres hacia `ingesta.ts` (`core/turno/cierres.ts`,
`modulos/agenda/seguimientos.ts` y `modulos/agenda/sena.ts`), que deshace el
coordinador de F3. Un cruce nuevo falla; una entrada cuyo cruce ya no existe
también falla, para que se saque. Los **archivos sin zona fuera de las
pruebas** eran 42 el 26/09, 47 el 28/09 y son 0 al cierre: es una lista exacta, no un número (ubicar uno y
agregar otro no se compensan), y está vacía.

**Negando:** la mitad de la suite es un árbol inventado donde cada forma de
cruce tiene que fallar. Contraprueba sobre el código real, hecha al
escribirla: un import de `planes.ts` plantado en `atencion.ts`, un puente
plantado en `web/src/central/lib/errores.ts` (Central desde F2; antes sin zona) hacia Plataforma, y una
entrada de la deuda borrada hacen fallar la suite.

**Tercera vuelta de la revisión (#231):** un import de tipo seguido de uno de
valor al mismo archivo cuenta como de valor, y una entrada de la deuda
marcada «solo tipo» falla si pasa a valor; lo que un puente no deja seguir
(calculado, alias, roto) también se informa; y el import calculado aceptado
(el de la herramienta de medición, ya retirada) se aceptaba por cantidad
exacta.

**La deuda no crece en un PR (27/09):** las cuatro listas (cruces, archivos
sin zona, imports que no se pueden seguir y pruebas transversales) viven en
`admin/pruebas/frontera/deuda.json`, y `calidad` compara cada una con la de la
base del PR con `deuda-solo-baja.mjs` (misma carpeta), **en su versión de la
base**, para que un PR no afloje el comparador que lo juzga. Falla si alguna
lista crece en cantidad, o si aparece una entrada nueva que no se explica por
un archivo movido (`git diff -M` del PR): saldar un cruce trivial y anotar otro
no se compensan. El lector reconoce además `createRequire(…)`,
`require.resolve` y `module.require`, y toma por calculado (a `sinResolver`,
que tampoco puede crecer) todo `require` que no puede seguir.

**Hasta dónde protege:** el gancho frena a los agentes con zona. El CI frena
a un PR que toca `deuda.json` o el comparador (corre el de la base; si la base
lo perdió, bloquea). El **analizador** (`frontera.ts`, `fronteras.test.ts`) corre en la versión del PR: un PR que lo afloja y a la vez
mete un cruce queda en verde, y lo frena solo la revisión humana. Lo mismo un
PR que cambia `.github/workflows/`. Por eso el paso de la deuda emite un aviso
cuando el PR toca `admin/pruebas/frontera/*.ts`, y la revisión de `seguridad`
de cada PR lo señala, mientras `CODEOWNERS` tenga un único propietario.

**La tanda cero de F2** (historia, en la sección «Mover archivos entre zonas») agrega a esta carpeta
`rutas-escritas.test.ts` (las rutas que los scripts escriben hacia Functions
existen) y `despliegue.test.ts` (los 55 nombres de `index.ts` y su
`__endpoint`, contra `despliegue.json`), y cierra las pruebas que pasaban en
vacío al mover un archivo.

**Lo que no cubre:** `Flujos/src/`. Los nodos de n8n no se importan entre sí:
los compone el ensamblador. La frontera Core/módulo de los flujos tiene que
venir de `ensamblador.test.ts` o `registro.test.ts` cuando en F3 existan
`Flujos/src/core/` y `Flujos/src/modulos/`. Tampoco las pruebas fuera de una
carpeta de zona: no las analiza nadie (ver «Límite conocido»).

## Mover archivos entre zonas

> Lo que decidió F2 (diseño del 27/09/2026, cerrado el 01/10/2026) y sigue
> valiendo para cualquier mudanza futura. La carpeta es la zona; mover un
> archivo es cambiar de carpeta.

**Cómo se mueve**

1. **Mueve la coordinadora, con un script revisado; los agentes de zona no.**
   Mover un archivo obliga a editar las importaciones de quienes lo usan, y
   casi ninguno está en la zona del agente: `index.ts`, `ingesta.ts`, las
   suites y los scripts de la raíz, `App.tsx`, `vitest.config.ts`, el CI.
   Además cada movimiento cambia `deuda.json`, que es solo de la coordinadora.
   El script (`admin/pruebas/frontera/mudanza.mjs`) reescribe con el mismo
   lector que usa la frontera, en seco por defecto; el modo que escribe se
   llama `--escribir` (nunca `--aplicar`, que dispara `acciones-sensibles.sh`).
2. **Sin archivos puente** en la ruta vieja: un `export * from './core/…/x.js'`
   no lo resuelve Node al quitar tipos (rompe los scripts que cargan
   Functions), y git deja de ver el renombre, con lo que el control de la
   deuda rechaza la entrada movida.
3. **Una rama de movimiento no se rebasa: se regenera** con el script sobre el
   `main` nuevo (es determinista). Así se resuelven los choques en `index.ts`,
   `App.tsx` y `deuda.json`.
4. **Los PR de movimiento solo mueven.** Los cortes van aparte: si en la misma
   tanda cambia el contenido, git puede dejar de ver el renombre y la deuda
   queda «inexplicada».
5. **Los que se parten se mueven enteros y se parten después** (F3).
   `ingesta.ts` no se mueve: queda en la raíz con su línea de coordinador en
   `ZONA_POR_ARCHIVO`.

**Las herramientas de mudanza**, en `admin/pruebas/frontera/`:

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
  `movimientos` (`{ de, a }`) y `suitesPuras`.
- **La compuerta solo vale corrida desde la BASE**, nunca con la copia del PR:
  `desde-la-base.sh`, leído de `origin/main` y pasado a `bash -s -- <tanda.json>`.
  Un PR de tanda no puede tocar la herramienta ni lo que ella importa: la lista
  es `HERRAMIENTA` en `mudanza.ts`, y `mudanza.test.ts` exige que cada archivo
  exista, que tocar uno no pase y que lo que importan las herramientas esté en
  la lista. **Una tanda futura que mueva `sembrar.mjs` o `datos/catalogo-demo.mjs`
  necesita antes un PR de herramienta** (`referencias-a-scripts.test.ts` y
  `rutas-escritas.ts` las miran).
- `solo-rutas.mjs`: **reproducibilidad**. Vuelve a correr el plan sobre el
  `merge-base` y exige cada archivo del PR byte a byte. A mano solo se acepta:
  quitar deuda saldada; en `vitest.config.ts`, las suites declaradas; en un
  comentario, la CITA de la ruta nueva y nada más.

**La regla Z (zona por regla para lo que no la tenía, 28/09):** los puntos de
entrada y lo que toca todas las zonas (`App.tsx`, `main.tsx`, `consola.tsx`,
`correr.sh`, `correr-storage.sh`, `storage-reglas.test.ts`) van al coordinador,
archivo por archivo, en `ZONA_POR_ARCHIVO`; los componentes de la consola que
no conocen ningún módulo, a `web/src/central/`; los scripts de operador, a
`scripts/plataforma/`; las semillas y cargas, a `scripts/datos/`; las
herramientas de desarrollo, al coordinador (no hay una sexta zona).

**La tanda cero** cerró las pruebas que pasaban en vacío al mover un archivo
(las que miraban un solo nivel de carpeta o una clave vieja del inventario,
`SUITES_PURAS` con una ruta que no existe) y agregó dos compuertas:
`rutas-escritas.test.ts` (las rutas que escriben los scripts llevan a un
archivo que existe) y `despliegue.test.ts` (los nombres que exporta `index.ts`
y su `__endpoint`, contra `despliegue.json`; una Function nueva lo regenera con
`ACTUALIZAR_DESPLIEGUE=si`, y el diff va a la vista). El lector de la frontera
toma por calculado todo `createRequire`, `getBuiltinModule`, `.require` o
`['require']` fuera del patrón que sigue.

## Límite conocido

**`ruta: './admin'` achica el análisis de seguridad:** Semgrep, Trivy, Checkov
y OSV no miran `Flujos/*.json`, los `scripts/` de la raíz ni `.github/`. La
`ruta` está en `ci-node-firebase.yml`, no en `.devsecops.yml` (que ya dice
`./admin`). Decisión de la revisora (27/09): no cambia con F2. Además, las
suites que quedan en la raíz de `admin/pruebas/` no se analizan como origen de
importaciones (la raíz no es una carpeta de zona).

## Pendiente

- **Lector de la frontera** (revisión de seguridad del #239): marcar como
  calculado todo import de `module` distinto de `import { createRequire }`,
  todo acceso por clave no literal, `_load`, `new Function` y `eval`, y la
  exportación de un alias de `createRequire`.
- **`pruebas/correr-storage.sh` exporta solo el puerto** del emulador: hoy no es
  un riesgo, porque ninguna suite de Storage lanza scripts.
- **Zonas que estaban sin dueño, asignadas el 02/10/2026 en `agentes.md`:**
  `web/src/core/` (`consola`), `Flujos/manifiestos/` (`core-flujos`),
  `functions/src/index.ts` y `functions/src/ingesta.ts` (la coordinadora) y
  `.github/` (`devsecops`).
- **El corte de `ingesta.ts` y `prompt.ts`** es de F3b.

## Lo que sigue

En el carril de lógica, cada agente en su carpeta: conectar el registro (fuera
las siete copias de la lista de flujos), `tieneModulo`, el límite de agendas,
los chequeos de inventario y catálogo. `tenants.modulos` en ventana y **en dos
pasos** (escribir `modulos` conservando `flujos`, desplegar, recién después
quitar `flujos`), con Bellido y Platinum en prueba.

## La política de capas del 06/09, que el registro reemplaza

Lo que sigue es `admin/DISENO.md` §4sexies tal como estaba. Es el antecedente
directo del registro: la separación entre lo común (`config/negocio`) y lo
propio de cada flujo (`config/{flujo}`) se conserva; lo que cambia es que el
eje pasa de *vertical* a *módulo* y que la lista de flujos deja de estar
reimplementada en siete lugares.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4sexies (25/09/2026, líneas 1283-1288) -->

## 4sexies. Flujos, consola y usuarios: la política de capas

Con los dos demos operativos, el modelo ya no puede asumir agendamiento. El
problema no es agregar campos: es **agregarlos sin que el panel se convierta en
un formulario con la unión de todo**.


<!-- movido de admin/DISENO.md §4sexies.0 (25/09/2026, líneas 1289-1343) -->

### 4sexies.0 La política (registrada el 2026-09-06, a pedido de Andres)

El producto tiene **tres capas**:

| Capa | Qué es | Dónde vive |
|---|---|---|
| **FLUJOS** | Lo que corre en n8n: reservas (A), pedidos y cobro (B), y los que vengan | `Flujos/*.json` |
| **CONSOLA** | Donde el negocio carga lo que el asistente va a afirmar como verdad | `admin/web` + `firestore.rules` |
| **USUARIOS** | Los negocios clientes, con su gente y sus roles | `/tenants/{id}`, claims |

Y cuatro reglas que se aplican a **todo flujo nuevo**:

1. **Un negocio tiene uno o más flujos.** Se guardan como lista en
   `tenants/{id}.flujos`. `vertical` (valor único) queda como el flujo
   principal y como respaldo de las fichas anteriores a la lista; cuando las
   dos cosas están, **manda la lista**. Cada flujo del negocio corre en SU
   número de WhatsApp (`/rutasWhatsApp`, §4bis.4): dos flujos en un mismo
   número exigirían un enrutador que hoy no existe.
2. **Lo común no se repite por flujo.** Identidad, dirección, horarios, voz
   del asistente, mensajes fijos, catálogo, usuarios, contraseña, consumo,
   conversaciones, reclamos y bitácora son de cualquier negocio, tenga el flujo
   que tenga. Viven en `/config/negocio` y en las colecciones comunes, y sus
   pantallas se muestran siempre.
3. **Lo propio de un flujo es excluyente y trae su pestaña.** Reservas
   necesita agendas por persona; pedidos necesita costos de entrega y un QR.
   Un negocio de pedidos no ve —ni puede escribir— la agenda, y al revés. Cada
   flujo con parámetros propios tiene: su documento `/config/{flujo}` con lista
   blanca propia en las reglas, su línea en la tabla de capacidades
   (`tieneAgenda`, `tieneCobro`), su entrada en `web/src/central/lib/flujos.ts` con las
   pestañas que agrega, y su rama en `documentoDeVertical` (`prompt.ts`).
4. **La consola habilita pestañas por flujo, no por negocio.** El menú se
   arma con las pestañas comunes más las de cada flujo de la lista. Y es
   cosmético: quien cierra la puerta es la regla, que lee la misma lista.

**Cómo se revisa un flujo nuevo** (la lista de control, en orden):

1. Abrir su nodo `Config del negocio` y anotar cada parámetro.
2. Clasificar cada uno: ¿lo tendría cualquier negocio? → común, va a
   `/config/negocio` (si no está, se agrega a SU lista blanca). ¿Solo tiene
   sentido con este flujo? → propio.
3. Si hay parámetros propios: documento `/config/{flujo}`, función
   `config{Flujo}Valida()` en las reglas, línea en la tabla de capacidades,
   `altaTenant`/`asignarNumero` crean el documento, `documentoDeVertical` lo
   nombra, `flujos.ts` declara la pestaña, y una pantalla la dibuja.
4. Si hay colecciones propias (como `funcionarios`), su regla exige la
   capacidad del flujo, no el rol solo.
5. Pruebas: el negocio CON el flujo escribe; el negocio SIN el flujo no puede,
   ni con la petición armada a mano; un negocio con varios flujos escribe
   todos los suyos.
6. Semillas y `sembrar-demos.mjs` escriben `flujos`.
7. Si el flujo todavía no lee la consola (`configuracionFlujo`), lo que se
   muestre tiene que ser lo que el flujo usa de verdad, y el resto se anota
   como deuda en `ESTADO.md`. Prometer un campo que el asistente ignora es
   peor que no ofrecerlo.


<!-- movido de admin/DISENO.md §4sexies.1 (25/09/2026, líneas 1344-1360) -->

### 4sexies.1 Qué es común y qué depende del flujo

| | Común a cualquier negocio | Reservas y citas (`agendamiento`) | Pedidos y cobro (`venta`) | Captación de clientes (`onboarding`) |
|---|---|---|---|---|
| **Documento** | `/config/negocio` | `/config/agendamiento` | `/config/venta` | `/config/onboarding` |
| **Contiene** | identidad, dirección, horarios, voz del asistente, **nombre del asistente** (`nombreAsistente`), mensajes fijos, política de cancelación, calendario del negocio (por historia) | duración por defecto, anticipación mínima y máxima, recordatorios, cancelación, **seña** (`senaImporte`, `senaMinutosRetencion`) y, si el negocio no vende, el QR propio (`cobroReal`, solo por `registrarQrDeCobro`) — §4duodecies | costo de envío, recargo de flota, pedido mínimo, radio, tiempos de cocina y despacho, `mediaIdQr` (solo NovuChat), QR propio (`cobroReal`, solo por `registrarQrDeCobro`) | rubros, planes, cargos únicos, aclaraciones de la oferta, archivo de planes, mensaje al cliente actual, enlace a la consola, respuesta del aviso y su plantilla (§4sexies.5) |
| **Colecciones propias** | catálogo, contactos, conversaciones, bitácora, miembros | funcionarios | — | — |
| **Catálogo nativo de WhatsApp** | — | **no**, y no es un pendiente | **sí** (pendiente) | no |
| **Pestañas en la consola** | Configuración, Servicios/Productos, Conversaciones, Usuarios, Contactos, Consumo, Cuenta, Reclamos, Bitácora, Mi cuenta | **Agenda**, **Cobros**, **Configuración de QR** (las dos últimas desde el 17/09, por la seña: §4duodecies) | **Pedidos**, **Cobros**, **Inventario**, **Configuración de QR** (§4nonies) | **Captación** |

«Cobros» y «Configuración de QR» las declaran dos flujos con la misma ruta;
la cabecera pinta cada ruta una sola vez, y la pantalla decide qué documento
lee por la lista de flujos (`venta` gana, §4duodecies.2).

El **catálogo con precios es común**: el Demo A lo usa para servicios con
duración y el Demo B para productos. Es el mismo concepto y ya estaba modelado.


<!-- movido de admin/DISENO.md §4sexies.2 (25/09/2026, líneas 1361-1382) -->

### 4sexies.2 Tres documentos, no uno con la unión de todos los campos

Podría haber sido un solo documento grande con todo opcional. No lo es, por tres
razones en orden de importancia:

1. **La validación queda por documento, con su propia lista blanca.** Un esquema
   único obligaría a escribir «si el vertical es X entonces el campo Y es
   válido» dentro de las reglas de Firestore — exactamente el tipo de condición
   que se rompe al agregar el tercer vertical.
2. **El comercio no puede escribir el documento que no le toca.** La regla ata el
   documento a la lista `flujos` de la ficha del tenant, que el comercio no
   escribe. Un salón de belleza **no puede** fijar el recargo de flota. Eso no se logra
   escondiendo el campo en la pantalla: esconder no protege de nada, porque la
   petición se construye igual desde la consola del navegador.
3. **La pantalla no necesita lógica de ramas.** Lee el documento común y el de su
   vertical. `ConfiguracionVertical` tiene una tabla de campos por rubro y no un
   solo `if` de negocio.

Las capacidades viven en una tabla —`tieneAgenda`, `tieneCobro`— y no en
condiciones dispersas: **agregar el vertical interno de NovuChat es tocar dos
líneas**, no cazar condicionales por el archivo.


<!-- movido de admin/DISENO.md §4sexies.4 (25/09/2026, líneas 1432-1440) -->

### 4sexies.4 Una consecuencia que conviene conocer

El documento de venta mezcla campos del comercio con campos de NovuChat, y la
validación usa `affectedKeys`. Por lo tanto **un `setDoc` con el objeto completo
se rechaza**: reemplazar el documento borraría `mediaIdQr`, y borrar también es
afectar. La pantalla usa `updateDoc`. Es deliberado — sin eso, el camino más
natural del programador desarmaría en silencio el control de la prohibición 3— y
hay una prueba dedicada a ese caso exacto.
