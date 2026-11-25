# Ráfagas: agrupar los textos seguidos de un mismo teléfono (core)

Pieza común del **core** (25/11/2026). Quien escribe «hola», «quiero reservar» y «para mañana» en tres mensajes dispara tres
ejecuciones y hoy recibe tres respuestas. Con esta pieza responde **una sola** ejecución, con los textos unidos; las otras terminan
sin enviar nada.

## Costo comercial

- **Mensajes por conversación: nunca agrega; en una ráfaga de n textos quita n-1.** Cada mensaje enviado cuesta 0,0113 USD
  (`docs/base-comercial.md` §1). Un mensaje aislado sale igual que hoy.
- Lecturas en la nube: hasta 6 documentos por consulta y 0 escrituras (ver «El servidor»). Una llamada HTTP más por texto, que no
  es un mensaje de WhatsApp.

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
| `Consultar ráfaga` | HTTP 4.2 | `POST` a `configuracionFlujo` con `{telefono, rafaga:{v:1, idMeta}}`. URL y credencial son las de «Traer configuración». **Continue on Fail solo aquí**, 3000 ms, sin reintentos. |
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

`normalizador` (por defecto «Interpretar entrada» o «Normalizar entrada»), `config`, `configBase`, `traerConfiguracion` y `puerta`
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

**Propiedad** (`rafaga-propiedad.test.ts`): para toda secuencia de mensajes, con cada ejecución viendo solo lo escrito hasta su propio
`ms + espera`, cada texto que ejecuta el nodo aparece **exactamente una vez** entre los textos respondidos (ni se pierde ni se repite).
La prueba recorre todas las secuencias de 1 a 4 mensajes con texto, `[nº]`, audio y saliente en cualquier posición, las de 5 con un
separador en cualquier posición, y esperas de 1, 2 y 5 s. Una mutación de la regla la hace fallar. El defecto que motivó esta regla
(revisión del PR): con la cadena armada desde el mensaje más nuevo, A en 0 s, B en 1 s y C en 2,8 s dejaban a A sin respuesta, porque
B consultaba tarde, veía a C y respondía solo.

- **Falla ABIERTO:** consulta caída, respuesta que no es `{rafaga:{v:1, fragmentos:[…]}}`, un fragmento mal formado, mi `idMeta`
  ausente o sin `mensajeId`: responde solo, como hoy.
- Audio, imagen, botón y cualquier otro tipo **no esperan ni se callan**. Un `idMeta` repetido (reintento de Meta) cuenta una vez.
- Mismo instante: el orden por (`ms`, `idMeta`) es el mismo para todas las ejecuciones.

### Riesgos residuales (aceptados, declarados)

- **Seis o más textos seguidos a menos de 1,5 s:** el servidor entrega hasta 6 entradas, así que el extremo más viejo de la lista es un
  borde; el grupo respondido puede quedar partido en dos respuestas (nunca se pierde un texto agrupable en las secuencias de la prueba,
  que caben en la lista).
- **Si la consulta de la ejecución que debe responder falla**, esa ejecución responde sola y **los textos que las otras callaron no se
  contestan**. Es el costo de fallar abierto: se prefiere responder el último mensaje a quedarse en silencio.
- Si la ejecución que debe responder muere después de que las anteriores callaron, el grupo queda sin respuesta (el mismo riesgo que ya
  tiene un mensaje aislado cuando el flujo cae).

El nodo solo entrega `textoDelTurno`; que cada flujo lo use en lugar de `userInput` lo cablea el PR de cada flujo.

### De dónde lee cada nodo

El IF (`$json`), la consulta y el Code leen el id del mensaje, el teléfono, el número y el texto del **mismo item: el del ancla**, con
los nombres de campo de `campos` (por defecto `tipo`, `mensajeId`, `from`, `phoneNumberId`, `userInput`, los del normalizador común).
El normalizador, «Config del negocio» y «Config base» tienen que ser **ascendientes del ancla** (el ensamblador se niega a armar y la
guardia lo exige en un flujo armado); además, toda lectura fallida da `false` en el IF y espera de 2 s en el Wait y el Code, de modo que
nunca rompe el turno. La cabecera `X-NovuChat-Numero` de la consulta sale del mismo número que la de «Traer configuración»: si esa no
manda la cabecera, o no sale de `phoneNumberId` (o usa `modoPrueba` sin `phoneNumberIdEsperado`), no se arma. Los nombres que no son los
predeterminados («Config base», «Config del negocio», «Traer configuración», `campos`) se pasan por opciones, también a
`hallazgosDeLaRafaga`.

## El servidor (contrato; lo construye `core-functions`)

Rama `rafaga` dentro de `configuracionFlujo`, sin endpoint nuevo: pedido `{telefono, rafaga:{v:1, idMeta}}`, autenticado por la firma
del número de siempre; `rafaga` junto con `sesion` es 400. Lee hasta 6 entradas del hilo de ese teléfono y responde
`{rafaga:{v:1, fragmentos:[{idMeta, tipo, texto (máx 1500), ms}]}}` en orden cronológico. Los fragmentos incluyen **también marcas de
saliente** `{idMeta:'', tipo:'saliente', texto:'', ms}` (ya no se corta en el primer saliente: el nodo las usa como separador); solo los
entrantes con `idMeta` repetido se deduplican; se descartan los de más de 30 s de antigüedad; y si ninguna entrada leída tiene el `idMeta`
pedido, devuelve `fragmentos: []` (el nodo responde solo). La respuesta de `configuracionFlujo` agrega `rafagaApagada: true` **solo** si el
comercio la apagó (campo de `tenants/{id}`, solo Admin SDK).

## Interruptores

- Por negocio (servidor): `rafagaApagada === true` en `tenants/{id}`; el IF lo lee de «Config del negocio».
- Por flujo: `rafagaActiva` en «Config base» (verdadero si falta; `false` apaga). `esperaRafagaSeg` fija la espera.

## Pruebas

`admin/pruebas/core/rafaga-decision.test.ts` (el nodo, ejecutado como el Code de n8n, negando cada regla),
`rafaga-propiedad.test.ts` (ninguna pérdida ni repetición con la vista propia de cada ejecución),
`rafaga-injerto.test.ts` (el injerto sobre un flujo sintético, la condición evaluada y las guardias) y el caso 9 de
`ensamblador.test.ts` (la clave del manifiesto). Los flujos reales las suman cuando la adopten.
