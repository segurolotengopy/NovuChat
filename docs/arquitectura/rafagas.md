# Ráfagas: agrupar los textos seguidos de un mismo teléfono (core)

Pieza común del **core** (25/11/2026). Quien escribe «hola», «quiero reservar» y «para mañana» en tres mensajes dispara tres
ejecuciones y hoy recibe tres respuestas. Con esta pieza responde **una sola** ejecución, con los textos unidos; las otras terminan
sin enviar nada.

## Costo comercial

- **Mensajes por conversación: nunca agrega; en una ráfaga de n textos quita n-1.** Cada mensaje enviado cuesta 0,0113 USD
  (`docs/base-comercial.md` §1). Un mensaje aislado sale con el mismo contenido que hoy, pero más tarde (ver «Latencia»).
- Lecturas en la nube: **11 en el caso normal y hasta 12 por consulta** (con reintento de Meta): ruta autenticada 1 + ficha 1 + mi documento 1 o 2 + hasta 5 anteriores + hasta 3 siguientes
  y 0 escrituras (ver «El servidor»). Una llamada HTTP más por texto, que no es un mensaje de WhatsApp.

## Latencia

La ráfaga **agrega espera**: cada texto aislado responde `esperaRafagaSeg` más tarde (2 s por defecto, acotada de 1 a 5). Si la consulta falla
responde solo, y eso tarda hasta ≈ +6,3 s más (3000 ms × 2 intentos + 300 ms entre ellos) sobre la espera. Es el precio de ahorrar n-1 mensajes en
una ráfaga; los medios, botones y los flujos con el interruptor apagado no esperan.

## Estado de la entrega

PR A (esta entrega): la pieza de flujos (`Flujos/src/core/rafaga/`), la clave `rafaga` del manifiesto del ensamblador y las pruebas.
**Ningún flujo ni manifiesto la declara todavía**: `ensamblar-flujo.mjs verificar` sigue reproduciendo los JSON byte a byte. Cada
flujo la adopta en su propio PR. La rama `rafaga` de `configuracionFlujo` (servidor) la construye `core-functions` en paralelo.

## La forma: cuatro nodos en línea

```
<ancla> -> ¿Esperar ráfaga? -sí-> Esperar ráfaga -> Consultar ráfaga -> Agrupar ráfaga -> <destino>
                            -no-----------------------------------------------------> <destino>
```

| Nodo | Tipo | Qué hace |
|---|---|---|
| `¿Esperar ráfaga?` | IF 2.2 | Interruptor encendido, entrante de tipo `text`, con `mensajeId` y teléfono, «Reportar mensaje (entrante)» ya corrido y la `puerta` del flujo. |
| `Esperar ráfaga` | Wait 1.1 | `esperaRafagaSeg` de «Config base» (defecto 2, acotado a 1-5 s). Menos de 65 s: n8n la mantiene en memoria. |
| `Consultar ráfaga` | HTTP 4.2 | `POST` a `configuracionFlujo` con `{telefono, rafaga:{v:1, idMeta}}`. URL y credencial son las de «Traer configuración». **Continue on Fail solo aquí**, 3000 ms y **un reintento** (2 intentos, 300 ms entre ellos; peor caso ~6,3 s, y el Wait de la ráfaga queda muy por debajo de los 65 s de n8n). |
| `Agrupar ráfaga` | Code 2 | Devuelve `[]` (silencio) o el item del turno con `rafaga:{accion, ids}` y, si agrupó, `textoDelTurno`. |

Agrega **4 nodos por flujo**. La salida «no» del IF y la de «Agrupar ráfaga» llegan al destino original: un item sin `rafaga` es un
turno que no esperó, igual que hoy.

### Dónde va cada flujo (ancla y destino)

Después de todo lo que descarta o pasa a una persona (Tomar, pausa, uso extendido, comercio no operativo) y antes de lo que
cuesta (el modelo): el destino es el primer nodo de la rama que responde. «Reportar mensaje (entrante)» tiene que correr
**antes**: el ensamblador se niega a armar si no es ascendiente del ancla ni va más arriba que el destino, y el IF lo exige otra vez
en ejecución (`$('Reportar mensaje (entrante)').isExecuted`). Un flujo que ya tenga un nodo con uno de los cuatro nombres no la
admite (el chat de NovuChat tiene «Esperar ráfaga» para la coalescencia de clics: su PR decide cómo convivir).

### Opciones del manifiesto (`rafaga`)

```json
"rafaga": { "ancla": { "nodo": "¿Atención normal?", "salida": 0, "destino": "…" }, "normalizador": "Normalizar entrada", "puerta": "n.esComprobante !== true" }
```

`fuente` (ver abajo), `posicion`, `normalizador` (por defecto «Interpretar entrada» o «Normalizar entrada»), `config`, `configBase`, `traerConfiguracion` y `puerta`
(una expresión JS de una línea sobre `n`, el entrante normalizado; por defecto `true`). `ensamblar` quita los cuatro nodos y los
vuelve a injertar canónicos (idempotente): `verificar` los compara byte a byte, y uno retocado a mano se detecta.

## La decisión (función pura, `agrupar-rafaga.js`)

Cada ejecución consulta en un momento distinto y ve una lista distinta (lo escrito hasta su propio instante más la espera). Por eso la
regla es **relativa a la posición del propio mensaje**, no al mensaje más nuevo, y solo usa datos que no cambian: lo que está antes de mí
y lo que llegó a menos de un salto después.

1. Se ordenan **todas** las entradas (textos, medios y marcas de saliente) por (`ms`, `idMeta`).
2. **Agrupable:** `tipo === 'text'`, con `idMeta`, con texto y sin `[nº]` (la copia guardada ocultó un número). Todo lo demás (audio,
   imagen, botón, marca de saliente) es **separador**.
3. Hay **arista** entre dos entradas adyacentes si las dos son agrupables y `ms_siguiente - ms_anterior <= espera - 500 ms`. Un separador
   entre dos textos los deja de ser adyacentes, así que los desconecta.
4. Si mi propio mensaje no está en la lista, la consulta falló o mi fragmento no es agrupable: **solo** (como hoy).
5. Si hay arista entre yo y mi vecino **siguiente**: **silencio** (otro cubrirá mi texto).
6. Si no, respondo con mi componente hacia atrás (vecinos anteriores mientras haya arista), cronológico, unido por salto de línea (los
   ajenos como los devuelve el servidor, el mío crudo). Componente de uno: **solo**.

**Propiedad** (`rafaga-propiedad.test.ts`). Cada ejecución recibe lo que el servidor entrega según el contrato relativo a su mensaje (hasta
5 predecesores, el propio y hasta 3 sucesores, con marcas de saliente y medios) y solo lo ya visible a su propio `ms + espera`.
- **Sin fallas**, cada texto que ejecuta el nodo aparece **exactamente una vez** entre los respondidos: todas las secuencias de 1 a 4
  mensajes con texto, `[nº]`, audio y saliente en cualquier posición; las de 5 con un separador en cualquier posición; esperas de 1, 2 y
  5 s; y secuencias sorteadas de 7 a 9 entradas con separadores. Lo mismo con un retraso de escritura de hasta 500 ms por entrada (el
  margen de 500 ms existe para eso).
- **Con consultas que fallan** (responden solo), la prueba predice en los dos sentidos qué se pierde y qué se duplica, y exige que sea
  exactamente eso (ver «Riesgos residuales»).
- Un álbum de 6 o más entradas posterior a mi mensaje no cambia mi decisión: la regla solo mira a mi vecino siguiente, y el tope de 3
  sucesores del servidor tampoco cambia ninguna decisión.
- Una mutación de la regla (silencio sin mirar al vecino, o un salto mayor que el margen) la hace fallar.
El defecto que motivó esta regla (revisión del PR): con la cadena armada desde el mensaje más nuevo, A en 0 s, B en 1 s y C en 2,8 s
dejaban a A sin respuesta, porque B consultaba tarde, veía a C y respondía solo.

- **Falla ABIERTO:** consulta caída, respuesta que no es `{rafaga:{v:1, fragmentos:[…]}}`, un fragmento mal formado, mi `idMeta`
  ausente o sin `mensajeId`: responde solo, como hoy.
- Audio, imagen, botón y cualquier otro tipo **no esperan ni se callan**. Un `idMeta` repetido (reintento de Meta) cuenta una vez.
- Mismo instante: el orden por (`ms`, `idMeta`) es el mismo para todas las ejecuciones.

### Riesgos residuales (aceptados, declarados; la regla NO promete «ni se pierde ni se repite» fuera de la ausencia de fallas)

Duplicar cuesta un mensaje (0,0113 USD); perder deja a una persona sin respuesta. Todo lo que no se puede resolver sin estado compartido
se inclina hacia duplicar. Lo que queda:

- **Duplicado: la consulta de la ejecución ANTERIOR falla** (después del reintento). Esa ejecución responde sola y la siguiente, que sí
  consulta bien, la incluye en su grupo: el texto se contesta dos veces. Lado seguro.
- **Duplicado: el margen de 500 ms es una suposición.** `ts` del servidor es `Timestamp.now()` tomado ANTES del commit; una contención de
  transacciones podría hacer visible un mensaje más tarde que ese margen. El efecto de que un vecino llegue tarde a la vista es que el
  anterior no lo ve y responde solo mientras el vecino lo incluye: duplicar, no perder. (La prueba con retraso de hasta 500 ms demuestra que
  dentro del margen no pasa nada.)
- **Pérdida: la consulta de la ejecución que debía responder el grupo falla** (después del reintento). Responde sola y los textos que las
  otras callaron por ella no se contestan. Es el costo de fallar abierto.
- **Pérdida: 7 o más textos seguidos a menos de 1,5 s.** El responsable ve a lo sumo 5 predecesores; los más viejos del grupo ya callaron
  esperándolo y no se contestan. (Seis textos seguidos caben y se contestan juntos.)
- **Pérdida: un desvío del vecino siguiente** (ver «Requisitos de cada flujo»).
- Si la ejecución que debe responder muere después de que las anteriores callaron, el grupo queda sin respuesta (el mismo riesgo que ya
  tiene un mensaje aislado cuando el flujo cae).

### Requisitos de cada flujo (cada PR de flujo los cumple y lo prueba)

La arista supone que mi vecino siguiente llegará al **mismo ancla**: si se desvía antes (atención de un operador, bloqueado, palabra clave de
menú, `puerta` falsa) la ejecución anterior ya calló por él y nadie la contesta. No se puede resolver sin estado compartido. Por eso:

1. **El ancla va DESPUÉS de todos los desvíos que responden por otra rama.** Lo que entra a la ráfaga es solo lo que el asistente va a
   contestar con el modelo.
2. El PR de cada flujo **lista sus desvíos** y prueba que un mensaje desviado no deja huérfano al anterior; si un desvío no puede quedar
   antes del ancla, se declara la excepción en ese PR.
3. `injertarRafaga` no valida los desvíos: detectarlos exige conocer la semántica de cada flujo y daría falsos errores; queda como requisito
   documentado y como parte de la revisión del PR de cada flujo.

El nodo solo entrega `textoDelTurno`; que cada flujo lo use en lugar de `userInput` lo cablea el PR de cada flujo.

### `fuente`: cuando el ancla no trae los campos del mensaje

Si el ancla viene tras un nodo que emite otra cosa (una «Puerta del turno» que solo da `{ruta, texto, responder…}`, o una llamada HTTP como
«Reportar mensaje (entrante)»), el item del ancla no tiene `tipo`, `mensajeId`, `from` ni `phoneNumberId`, y el IF daría siempre «no»: la ráfaga
quedaría **apagada en silencio**. Para eso existe la opción `fuente` (nombre del nodo, p. ej. «Normalizar entrada»): el IF, la consulta y el Code
leen esos campos de `$('<fuente>').first().json` (los nombres de campo, de `campos`; Walisuma emite `texto`, no `userInput`). `Agrupar ráfaga`
sigue emitiendo el item **del ancla** más `rafaga` y `textoDelTurno`; el flujo lee `textoDelTurno` con `$('Agrupar ráfaga')`.

- La `fuente` tiene que ser **ascendiente del ancla** y correr una vez por mensaje (esto último no se puede verificar sin ejecutar: lo revisa el PR del
  flujo). La `puerta` puede leer otros nodos (`$('Puerta del turno').first().json.ruta === 'sigue'`); el injerto valida que existan y sean ascendientes.
- **No falla en silencio (lista blanca):** sin `fuente`, `injertarRafaga` (y la guardia sobre un flujo armado) **solo arma** si todo camino del ancla al normalizador
  pasa únicamente por nodos que dejan pasar el item (IF, Switch, Filter, Wait, NoOp). Cualquier otro nodo en ese camino (Code, Set, HTTP, Merge…) puede cambiar
  el item y no se sabe qué emite, aunque su código copie la entrada: se niega y pide `fuente`. En los JSON reales: Walisuma (tras «Puerta del turno») y Bellido
  (`agenda-minima.v0.json`) necesitan `fuente` (Walisuma: «Normalizar entrada»; Bellido: «Interpretar entrada», porque su «Normalizar entrada» no emite el mensaje) y `campos: {texto: 'texto'}`; los Demos A y B arman sin `fuente` (el item sale del normalizador por IF). Lo prueban
  `rafaga-injerto.test.ts` sobre esos cuatro JSON.
- **El productor tiene que EMITIR los campos (con o sin `fuente`), decidido con el ÁRBOL del código (acorn):** el nodo del que se leen (la `fuente`, o el normalizador) debe ser un
  Code, y en CADA objeto `{ json: … }` que produce, las claves de NIVEL SUPERIOR deben incluir `tipo`, `mensajeId`, `from`, `phoneNumberId` y el texto, con los nombres de
  `campos`. Una desestructuración que solo lee, un comentario, una cadena, un objeto anidado, o `otro.mensajeId = …` sobre un objeto que no es el que sale NO cuentan.
  Se siguen los identificadores del propio código, `Object.assign`, spreads de objetos resolubles y las asignaciones `x.clave = …` al objeto que sale. Si algo no se puede
  decidir (un spread de la entrada, un código que no se analiza), se niega y pide `fuente`.
  - `phoneNumberId` es el único campo que los demos arman con un spread de la entrada (`...config`, `Object.assign({}, cfg, …)`), que llega desde «Config base»: no se
    decide mirando el código. Esos normalizadores (Demo A y Bellido «agendamiento», Demo B) se aceptan por la HUELLA SHA-256 de su código (`NORMALIZADORES_VERIFICADOS`), y
    `rafaga-extremo.test.ts` los EJECUTA con una entrada real y comprueba que `phoneNumberId` sale. Si el normalizador cambia, la huella cambia: la ráfaga deja de armar
    hasta que se vuelva a verificar y se actualice la lista.
  - `campos` no tiene valor por defecto del texto: `campos.texto` es obligatorio (`userInput` en los demos; `texto` en Walisuma y Bellido). Una clave desconocida en
    `campos` («textoo») es ERROR. Los otros cuatro nombres son los canónicos y se verifican igual.
- **`consumidor` es obligatorio (la pieza sola PIERDE mensajes):** «Agrupar ráfaga» entrega los textos unidos en `textoDelTurno`, pero nada del flujo lo lee si el flujo no
  lo cablea: la ejecución que responde vería solo SU texto y los que las otras callaron nunca se contestarían. `injertarRafaga` y `hallazgosDeLaRafaga` exigen
  `consumidor: '<nodo>'` (o una lista): cada uno tiene que existir, ser el destino o descender de él, y su código o sus parámetros tienen que leer `textoDelTurno` de
  «Agrupar ráfaga». Sin `consumidor` es ERROR (sin valor por defecto ni opt-out silencioso); `consumidor: null` existe SOLO para las pruebas que llaman a `injertarRafaga`
  directo, y **el ensamblador lo rechaza** en un manifiesto (`ensamblarFlujo` y `verificarFlujo` lanzan; lo prueba `ensamblador.test.ts`). Sin declararlo, la
  guardia de un flujo armado busca los nodos descendientes que lo leen y, si no hay ninguno, lo dice. **Los PR de cada flujo ya traen su cableado** (Walisuma: «Decidir
  turno» lee `$('Agrupar ráfaga')` → `textoDelTurno`); en #1117, que no trae flujos, las pruebas lo parchean en memoria (`rafaga-cableado.ts`) con el mismo patrón.
- **La `puerta` no puede apagar la ráfaga:** al armar (y en la guardia de un flujo armado) se analiza con acorn. Una puerta que no es UNA expresión válida, o que se pliega a una
  constante falsa (`false`, `0`, `null`, `!1`, `1 === 2`, `x && false`…), es ERROR. El pliegue es parcial: `plegar` entiende literales, `undefined`/`NaN`/`Infinity`, plantillas
  sin interpolación, arreglos y objetos literales, los operadores unarios `!`, `-`, `+` y `void`, `&&`/`||`/`??` y las comparaciones (`===`, `!==`, `==`, `!=`, `<`, `>`, `<=`, `>=`).
  **No pliega** una secuencia (`(true, false)`), un ternario (`true ? false : false`), una llamada (`String(false) === "x"`, `[].length > 0`) ni un acceso a otro nodo: lo que no
  se pliega se trata como «depende de algo que se lee» y la puerta ARMA, aunque en la práctica sea siempre falsa (declarado como N1 en los límites conocidos); y cada `n.<campo>` que lee tiene que ser una clave de nivel superior que el productor emite
  (la misma verificación y la misma excepción por huella que los `campos`). `n.noExiste`, `n.a.b.c` sobre un campo inexistente, `n` usado entero o `n[clave calculada]` son ERROR.
  El apagado previsto es `rafagaActiva: false` o `rafagaApagada`, no la puerta.
- **Emisión de un retorno:** cada `return` del nivel superior del productor tiene que ser un arreglo de `{ json: … }` resoluble (literal, lista con `push`, `.map` con `{ json }`,
  `return []`). Un `return $input.all()`, `return items` o `return [{ campos }]` (n8n los envuelve) emite items que no se pueden decidir: cuenta como una emisión abierta y sin
  claves, y se niega. Las asignaciones de miembro (`o.k = …`, `Object.assign(o, …)`) no cuentan si el nombre tiene más de una declaración o reasignación, y `delete o[k]` /
  `o[k] = …` con una clave que no se pliega vacían las claves ya dadas.
- **Límites conocidos del análisis (declarados, sin corregir; el PR de cada flujo los cubre con su revisión y `rafaga-extremo.test.ts`):**
  - **I1, consumidor por nombre sin alcance:** `leeElTextoDe` junta las declaraciones por NOMBRE, sin alcance léxico: una variable homónima en otra función que apunta a «Agrupar ráfaga»
    hace que cuente como lector un nodo que lee el texto de otra fuente. Menores relacionados: `$` redefinido localmente, una lectura en código muerto (`if (false) { … }`) y una
    lectura asignada a una variable que nunca se usa también bastan. Un consumidor así pierde los mensajes que las otras ejecuciones callaron: lo revisa el PR del flujo.
  - **N1, puertas siempre falsas que arman:** la puerta se verifica con el pliegue parcial descrito arriba y con la lectura de `n.<campo>`. Arman, aunque nunca den «sí»:
    `(true, false)`, `true ? false : false`, `String(false) === "x"`, `[].length > 0`, `$("Config base").first().json.noExiste === true` (el campo de otro nodo no se verifica),
    `n.texto.foo.bar` (el campo se emite, pero el acceso profundo lanza y el `catch` del IF da `false`), `typeof n.texto === "number"` y `n.texto === 1 && n.texto === 2`.
    La puerta es una opción del PR de cada flujo y no sustituye al apagado previsto: lo revisa ese PR. La corrección futura es una lista blanca de la forma de la puerta.
  - **N2, lista devuelta mutada por miembro:** `resoluble` solo mira la declaración de la lista y `push`/`unshift`. Una lista devuelta que se muta con una asignación de
    miembro (`out[0] = $input.first()`), con `splice` o con `Object.assign(out, …)` arma la pieza sin deber: las claves emitidas se calculan sobre la declaración, no sobre la
    mutación. Sin corregir; lo revisa el PR del flujo. La corrección futura es volver no resoluble la lista con cualquier asignación de miembro, método distinto de
    `push`/`unshift` u `Object.assign` sobre ella.
  - **M1, residuales de la emisión:** `delete` por alias (`const p = o; delete p.k;`); un valor nulo por variable (`const u = undefined; … k: u`); un spread de objeto en literal con clave
    calculada `{ [k]: v }` no vacía las claves; un `.map` cuyo callback delega en otra función o un retorno por `.filter`/`.flatMap` se tratan como no resolubles (se niegan, el lado seguro);
    una variable `n` redeclarada dentro de la puerta (parámetro de flecha) no se distingue de la `n` del item; `x && algo` con `algo` falsa solo se pliega si `x` no se lee.
- **Defensa en el nodo:** si el texto propio llega vacío, «Agrupar ráfaga» usa el que el servidor guardó; nunca arma un grupo con el último mensaje en blanco.
- **`quitarRafaga` solo quita la pieza:** requiere «¿Esperar ráfaga?» → «Esperar ráfaga» → «Consultar ráfaga» → «Agrupar ráfaga»; un flujo con un «Esperar ráfaga» PROPIO
  (el chat de NovuChat) no se toca, y el injerto se niega por choque de nombre.
- Las pruebas: `rafaga-reales.test.ts` (cada conexión de cada JSON real como ancla, con y sin `fuente`/`campos`: en lo que arma, los campos llegan al IF y al Code),
  `rafaga-extremo.test.ts` (Walisuma y Bellido, dos textos de punta a punta con la pieza injertada en memoria) y `rafaga-injerto.test.ts`.
- Las guardias infieren la `fuente` del propio IF; los demás nombres no predeterminados se pasan por opciones.

### Posiciones en el lienzo y convivencia con el indicador

`ensamblar` quita la ráfaga **antes** de tocar el indicador y la injerta al final: el indicador calcula su posición desde el nodo que sigue al ancla,
y con la ráfaga puesta ese nodo sería «¿Esperar ráfaga?». Así un manifiesto con `indicador` y `rafaga` es idempotente (lo prueba `ensamblador.test.ts`).
La ráfaga se dibuja en la altura del destino y el indicador entre el reporte y el destino: no se pisan en los flujos de la lista; si un flujo los
amontona, `injertarRafaga` acepta `posicion: [x, y]` (solo cambia el dibujo; el orden de ejecución lo da la altura relativa al reporte y al indicador,
así que la ráfaga nunca debe subir por encima del indicador).

### De dónde lee cada nodo

El IF (`$json`), la consulta y el Code leen el id del mensaje, el teléfono, el número y el texto del **mismo item: el del ancla** (o el de la `fuente`, ver arriba), con
los nombres de campo de `campos` (por defecto `tipo`, `mensajeId`, `from`, `phoneNumberId`, `userInput`, los del normalizador común).
El normalizador, «Config del negocio» y «Config base» tienen que ser **ascendientes del ancla** (el ensamblador se niega a armar y la
guardia lo exige en un flujo armado); además, toda lectura fallida da `false` en el IF y espera de 2 s en el Wait y el Code, de modo que
nunca rompe el turno. La cabecera `X-NovuChat-Numero` de la consulta sale del mismo número que la de «Traer configuración»: si esa no
manda la cabecera, o no sale de `phoneNumberId` (o usa `modoPrueba` sin `phoneNumberIdEsperado`), no se arma. Los nombres que no son los
predeterminados («Config base», «Config del negocio», «Traer configuración», `campos`) se pasan por opciones, también a
`hallazgosDeLaRafaga`.

## El servidor (contrato; lo construye `core-functions`)

Rama `rafaga` dentro de `configuracionFlujo`, sin endpoint nuevo: pedido `{telefono, rafaga:{v:1, idMeta}}`, autenticado por la firma
del número de siempre; `rafaga` junto con `sesion` es 400. Lee del hilo de ese teléfono, **relativo al mensaje pedido**, hasta 5 predecesores, el propio y hasta 3 sucesores, y responde
`{rafaga:{v:1, fragmentos:[{idMeta, tipo, texto (máx 1500), ms}]}}` en orden cronológico. Los fragmentos incluyen **también marcas de
saliente** `{idMeta:'', tipo:'saliente', texto:'', ms}` (ya no se corta en el primer saliente: el nodo las usa como separador); solo los
entrantes con `idMeta` repetido se deduplican; se descartan los **vecinos de más de 30 s** respecto de mi mensaje, y mi propio mensaje se busca en una
**ventana de 60 s**; y si ninguna entrada leída tiene el `idMeta`
pedido, devuelve `fragmentos: []` (el nodo responde solo). La respuesta de `configuracionFlujo` agrega `rafagaApagada: true` **solo** si el
comercio la apagó (campo de `tenants/{id}`, solo Admin SDK).

### Tope de llamadas

20 consultas por minuto por comercio + teléfono, con un contador **en memoria de la instancia** (no lee ni escribe Firestore). Con `maxInstances: 10` el tope
real llega a 10 × 20 entre instancias: acota el abuso, no es exacto, y un reinicio de instancia lo reinicia. Pasado el tope responde `429 {error:'rafaga_tope'}`
y cuesta solo 1 lectura (la ruta autenticada, de donde sale el `tenantId`); una firma inválida da 401 y no gasta cupo. Para el nodo, un 429 es una consulta
fallida: responde solo.

## Interruptores

- **Por comercio, sin republicar:** `rafagaApagada === true` en `tenants/{id}` (solo Admin SDK). `configuracionFlujo` lo entrega en su respuesta y el IF lo
  lee de «Config del negocio» (`$('Config del negocio').first().json.rafagaApagada`, la respuesta del servidor ya mezclada por el flujo). Es el único
  interruptor que se mueve sin tocar el JSON; cada PR de flujo prueba que su «Config del negocio» lo conserva. **Quién lo emite (estado con #1135):** los tres nodos comunes de core copian la clave de la
  respuesta del servidor, solo con `true` exacto y respuesta 200: `core/config-del-negocio.js` (Demo A, `novuchat-onboarding` y la variante de `bellido-agendamiento`),
  `core/captacion/config-del-negocio.js` y `core/sin-agente/venta-digital/config-del-negocio.js` (Walisuma y Casa Bermejo, con su copia en `experimental/venta-digital`). Demo B
  (#1125, `core/venta/config-del-negocio.js`) y Bellido Agenda mínima (#1127, `agenda-minima/src/nodos/config-del-negocio.js`) lo propagan en sus ramas.
  **PENDIENTE, fuera de #1135:** Q'Taco (`Flujos/clientes/venta-minima/src/nodos/config-del-negocio.js`) y el chat de NovuChat (`Flujos/clientes/novuchat/src/nodos/config-del-negocio.js`)
  tienen su PROPIO «Config del negocio», que no emite `rafagaApagada`: en esos dos comercios el interruptor por comercio no llegaría al IF de la pieza. Se cierra en un
  PR por definir, aparte de #1135; hasta entonces no son «todos». El chat de NovuChat tiene además un «Esperar ráfaga» propio (no es la pieza común); si debe obedecer
  `rafagaApagada` queda por verificar en ese PR. El servidor lo entrega solo con `true` exacto, y la pieza NO verifica al armar que «Config del negocio» emita
  `rafagaApagada` (límite conocido).
- **Por flujo, exige republicar:** `rafagaActiva` (verdadero si falta; `false` apaga) y `esperaRafagaSeg` (defecto 2, de 1 a 5) viven en «Config base»,
  un nodo del JSON del flujo. Cambiarlos es cambiar el flujo y publicarlo (`publicar-flujo.sh`). Es a propósito: la espera es una propiedad del flujo
  (cuánto tolera su conversación), no del comercio, y un valor en el JSON se revisa y se prueba con el flujo.

## Apagar la ráfaga de un comercio

Script de Plataforma `admin/scripts/plataforma/apagar-rafaga.mjs`: un comercio por corrida, simulacro por omisión («pondría…»).
`--apagar` escribe `rafagaApagada: true`; `--encender` **borra** el campo (nunca lo pone en `false`). Es idempotente, no toca otros
campos y deja auditoría `cambiar_rafaga` en `tenants/{id}/auditoria`. Usa la lista blanca de proyectos de sus hermanos
(emulador `demo-*`, `GCP_PROJECT_ID_STAGING`, `GCP_PROJECT_ID_PROD`; un proyecto real con variables de emulador sobrantes se
rechaza). Contra staging o producción, `--aplicar` exige `--confirmo-produccion <tenant>` igual a `--tenant`; contra el emulador
esa opción se rechaza. Solo toca comercios `activo` o `suspendido`; si no existe o es otro estado, sale 1 sin escribir. Efecto: la siguiente respuesta de
`configuracionFlujo` trae `rafagaApagada: true` y el nodo responde cada texto solo, sin republicar el flujo.

```
node scripts/plataforma/apagar-rafaga.mjs --proyecto <id> --tenant <id> --apagar [--aplicar] [--confirmo-produccion <tenant>]
node scripts/plataforma/apagar-rafaga.mjs --proyecto <id> --tenant <id> --encender [--aplicar] [--confirmo-produccion <tenant>]
```

Prueba: `admin/pruebas/plataforma/apagar-rafaga.test.ts` (emulador).

## Pruebas

`admin/pruebas/core/rafaga-decision.test.ts` (el nodo, ejecutado como el Code de n8n, negando cada regla),
`rafaga-propiedad.test.ts` (ninguna pérdida ni repetición con la vista propia de cada ejecución),
`rafaga-injerto.test.ts` (el injerto sobre un flujo sintético, la condición evaluada y las guardias) y el caso 9 de
`ensamblador.test.ts` (la clave del manifiesto). Los flujos reales las suman cuando la adopten.

## Flujos que la adoptaron

### Demo B (venta y cobro) — 25/11/2026, `rafaga-demo-b.test.ts`

Ancla `¿Atención normal?` salida 0, destino `¿Es un comprobante?`, sin `fuente` (el item del ancla es el del normalizador y trae todos los campos). El flujo pasa de 93 a 97 nodos (+4 autorizado por Andres). El agente lee `{{ $json.textoDelTurno || $json.userInput }}`; `Config del negocio` propaga `rafagaApagada`.
Desvíos y qué pasa con el texto anterior (cada uno lo fija una prueba):
- Comercio no operativo, uso extendido en operador y uso extendido bloqueado cuelgan ANTES del ancla. Si el estado cambia justo entre dos textos de una ráfaga, el primero (que calló esperando al segundo) no se contesta: el segundo recibe el aviso fijo (un mensaje) o nada (bloqueado). Es la excepción declarada de «Requisitos de cada flujo», solo en el instante en que cambia el estado.
- Imagen, documento, audio, botón y pedido no son `text`: no esperan, no consultan y separan la ráfaga. El texto anterior responde solo.
- Un texto nunca es comprobante (solo lo es una imagen o un documento) y no hay palabras clave ni menú: ningún otro desvío entre el ancla y el agente.
- El carrito del catálogo es otro disparador y no pasa por el ancla.
Limitación: `Procesar respuesta` (común) mira solo el último texto para los detectores de ubicación, contacto y despedida.
