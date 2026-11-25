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

- **Agrupable:** `tipo === 'text'`, con texto y sin `[nº]` (la copia guardada ocultó un número).
- **Cadena:** del fragmento **más nuevo** hacia atrás, mientras cada uno sea agrupable y el salto entre dos consecutivos sea
  `<= espera - 500 ms`. Máximo 5.
- Estoy en la cadena y no soy el último: **silencio** (`[]`). Soy el último y hay más de uno: **agrupado**, con los textos unidos por
  salto de línea (los ajenos como los devuelve el servidor, el mío crudo). Cualquier otro caso: **solo**.
- Audio, imagen, botón y cualquier otro tipo **no esperan ni se callan**, y cortan la cadena. Un saliente también corta (el servidor
  deja de leer en el primero).
- Mismo instante: se ordena por (`ms`, `idMeta`), así todas las ejecuciones ven el mismo último y hay exactamente un ganador. Un
  `idMeta` repetido (reintento de Meta) cuenta una vez.
- **Falla ABIERTO:** consulta caída, respuesta que no es `{rafaga:{v:1, fragmentos:[…]}}`, un fragmento mal formado, mi `idMeta`
  ausente o sin `mensajeId`: responde solo, como hoy. A lo sumo se duplica una respuesta; no se pierde un mensaje.
- Riesgo declarado: si la ejecución que debe responder muere después de que las anteriores callaron, el grupo no recibe respuesta.
  Es el mismo riesgo que ya tiene un mensaje aislado (el flujo cae), no uno nuevo.

Salidas con `textoDelTurno`: en esta entrega el nodo solo lo entrega; que el flujo lo use en lugar de `userInput` lo cablea el PR de
cada flujo.

## El servidor (contrato; lo construye `core-functions`)

Rama `rafaga` dentro de `configuracionFlujo`, sin endpoint nuevo: pedido `{telefono, rafaga:{v:1, idMeta}}`, autenticado por la firma
del número de siempre; `rafaga` junto con `sesion` es 400. Lee `mensajes.orderBy('ts','desc').limit(6)` del hilo de ese teléfono,
corta en el primer saliente y responde `{rafaga:{v:1, fragmentos:[{idMeta, tipo, texto (máx 1500), ms}]}}` en orden cronológico, máx 5.
La respuesta de `configuracionFlujo` agrega `rafagaApagada: true` **solo** si el comercio la apagó (campo de `tenants/{id}`, solo Admin SDK).

## Interruptores

- Por negocio (servidor): `rafagaApagada === true` en `tenants/{id}`; el IF lo lee de «Config del negocio».
- Por flujo: `rafagaActiva` en «Config base» (verdadero si falta; `false` apaga). `esperaRafagaSeg` fija la espera.

## Pruebas

`admin/pruebas/core/rafaga-decision.test.ts` (el nodo, ejecutado como el Code de n8n, negando cada regla),
`rafaga-injerto.test.ts` (el injerto sobre un flujo sintético, la condición evaluada y las guardias) y el caso 9 de
`ensamblador.test.ts` (la clave del manifiesto). Los flujos reales las suman cuando la adopten.
