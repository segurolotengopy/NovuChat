# Presupuesto de tamaño por flujo

> Regla de Andres (23/10/2026, reafirmada): los ajustes **no deben saturar los
> flujos de n8n**. Tamaño pequeño para evitar confusiones; cada módulo común que
> se incluye suma `jsCode` y se declara cuánto agrega por flujo; no se incluyen
> módulos que el flujo no usa; los prompts no crecen por lo que resuelve el
> código. Zona: core. La prueba es `admin/pruebas/core/presupuesto-flujos.test.ts`
> (medición en `presupuesto-flujos.lib.ts`, presupuestos en `presupuesto-flujos.json`).

## Qué se mide (y cómo)

La prueba descubre del disco todo JSON con `nodes` bajo `Flujos/*.json` y
`Flujos/experimental/**` (se ignoran `herramientas/`, `fuentes/`, `manifiestos/`,
`src/`, `prompts/`), y mide cada uno con la misma función que la línea base:

| Medida | Definición |
|---|---|
| nodos | `nodes.length` |
| jsCode KB | suma de la longitud en caracteres de todos los `parameters.jsCode`, dividida por 1024, redondeada hacia arriba a 1 decimal |
| prompt KB | suma de la longitud de toda cadena bajo las claves `text`, `message`, `systemMessage`, `prompt` o `content` dentro de los `parameters` de los nodos de IA (tipo que contiene `langchain`: agente, Gemini, memoria…), mismo redondeo. Incluye `options.systemMessage` del agente y el `text` de los nodos de lectura de comprobante, imagen, documento y audio |

El prompt armado por código (un Code que arma el texto) cuenta como jsCode, no como prompt.

## Cuándo falla

1. Un flujo supera su presupuesto de **nodos** o de **prompt** (margen 0), o de **jsCode** por más de +2 %.
2. Aparece un flujo sin entrada en el JSON (ni exención declarada en `exentos`).
3. Un prompt supera el **tope duro de 6 KB** sin `exencionPrompt` vigente (con porqué y vencimiento a 90 días o menos de `desde`).
4. Una entrada apunta a un archivo que ya no existe.
5. `ultimoAumento` falta, no es AAAA-MM-DD o es posterior a hoy.

Al fallar imprime los 5 nodos de jsCode más grandes del flujo y el aporte de cada
módulo común (`Flujos/src/core/**`, `Flujos/src/modulos/**`,
`Flujos/experimental/comun-sin-agente/src`) detectado por coincidencia literal del
archivo fuente dentro del jsCode (informativo).

**Exentos** (13, con porqué en el JSON): los programados sin IA (seguimientos,
señas vencidas, recordatorios de Demo A y de Bellido, salida de persona) y las
cinco `flujo.plantilla.json` (su jsCode se inyecta al construir; se vigila el flujo construido).

## Cómo se sube un presupuesto

El PR que haga crecer un flujo: declara «+N KB de jsCode, +M nodos por flujo»,
cambia la entrada del JSON y su `porque`, pone `ultimoAumento` en la fecha del
cambio y **pasa por el agente `seguridad`** (queda anotado en el PR). La prueba
toma el presupuesto del JSON del propio PR: cada PR que regenera un flujo
actualiza su entrada; si no lo hace, la prueba falla. Bajar un presupuesto no
requiere nada más que el cambio.

## Línea base (23/10/2026, main)

| Flujo | Nodos | jsCode KB | Prompt KB |
|---|---:|---:|---:|
| Antonio (`rroca-antonio`) | 48 | 771,6 | 4,8 |
| Rubén (`rroca-ruben`) | 45 | 965,1 | 4,4 |
| Doctoras Emma / Evy | 43 | 531,3 | 2,0 |
| chat-novuchat | 44 | 1.099,1 | 2,0 |
| Q'Taco (`venta-minima.qtaco`) | 50 | 1.979,7 | 2,0 |
| Bellido agenda-minima | 53 | 380,6 | 2,8 |
| Captación mínima | 43 | 514,8 | 2,0 |
| Demo A | 77 | 318,4 | 31,3 |
| Platinum | 77 | 318,4 | 31,8 |
| Bellido 96 nodos (heredado) | 96 | 319,0 | 28,9 |
| Demo B | 76 | 174,4 | 19,1 |
| Onboarding | 51 | 974,9 | 10,2 |

(Las variantes `.prueba.json`, `.ensayo-demo-a.json`, `.v0.json` y las de Evy están
todas en el JSON con su medida.) Los prompts de Demo A, Platinum, Bellido, Demo B y
onboarding superan el tope porque llevan el prompt largo del agente con herramientas
en `options.systemMessage`; se declararon con **exención que vence el 21/01/2027**
en lugar de ocultarlos. Antes de ese día se recortan o el flujo se retira.
Rubén hoy está en 4,4 KB; su Entrega 2 (#618) trae ~9 KB y deberá recortarse a 6 KB o menos.

## Hallazgo 23/10/2026: código muerto incluido (informativo, no falla)

Definiciones con prefijo de módulo común (`ct*`, `cb*`, `dn*`, `cm*`, `av*`,
`anuncio*`) que un nodo incluye pero que **no se referencian en ese mismo nodo**
(cada Code de n8n es una isla: no comparte funciones con otro nodo). Es
conservador: una recursión o una referencia desde otra pieza también muerta
cuenta como uso. No se borró nada.

| Flujo | Definiciones muertas | Tamaño aprox. |
|---|---:|---:|
| venta-minima (qtaco, prueba, ensayo-demo-a) | 43 c/u | ~1,7 KB |
| rroca-antonio (y prueba) | 29 | ~1,1 KB |
| rroca-ruben (y prueba) | 20 | ~0,8 KB |
| doctoras (Emma, Evy y pruebas) | 4 | ~0,2 KB |
| chat-novuchat | 3 | ~0,2 KB |
| captacion-minima | 1 | ~0,1 KB |
| agenda-minima, Demo A, Demo B, onboarding, Bellido, Platinum | 0 | 0 |

Las 10 mayores (por flujo y nombre, sumando nodos): `cbMensajeQr` (7 nodos, ~0,4 KB),
`avDentroDelTopeDiario` (6 nodos, ~0,3 KB) y `cbTextoAlCliente` (6 nodos, ~0,3 KB) en
venta-minima; `avDestinatarios` (4 nodos, ~0,3 KB), `avTexto`, `avPrimerNombre`,
`cbEstadoParaAviso` en Antonio y Rubén; `cbResultado`, `cbHayQr`, `cbLectura` en venta-minima.

**Lectura:** el código muerto es marginal (menos de 2 KB por flujo). El peso real
del jsCode está en los módulos que se incluyen enteros y se repiten en varios
nodos Code. Los módulos candidatos a dejar de incluirse en los flujos donde sobran
son los de avisos (`av*`: destinatarios, primer nombre, texto, tope diario) en
Antonio y Rubén, los de cobro en la nube de venta (`cb*`) donde el comercio no
cobra por QR, y `cm*` en chat-novuchat y captación. Es una propuesta a decidir con
el dueño de cada módulo, no un cambio de este PR.
