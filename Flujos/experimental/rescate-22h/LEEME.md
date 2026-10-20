# rescate-22h — módulo común del rescate de conversaciones de venta

A toda conversación de venta que lleva entre **22 h y 23 h 30 min** sin un mensaje del cliente le sale **un solo** mensaje de texto libre.
Retoma lo que el cliente contó o, si no hay de qué, es un texto fijo. Nunca sale a quien compró, pasó a una persona, está en pausa, pidió que no
le escriban o tiene la ventana de 24 h cerrada. Es experimental: vive fuera de las zonas y de `fronteras.test.ts`, con el mismo precedente que
`comun-sin-agente` y `rroca-ruben`; se muda con la futura mudanza a `Flujos/clientes/`.

## Cómo está repartido

| Quién | Qué hace |
|---|---|
| **Servidor** (`reclamarRescates`, módulo Pedidos; otro PR) | DECIDE quién toca rescate y lo MARCA, antes de contestar, en una transacción. La marca no se borra: un rescate por contacto, para siempre. Aplica la lista de prueba **antes** de marcar. |
| **Este flujo** (uno por tenant) | Disparador propio cada 10 minutos. Reclama, deja redactar el cuerpo al modelo, **verifica** lo redactado por código y envía con la cadena de envío común. |

Cada instancia usa solo la credencial, el número y los datos de su tenant: el aislamiento sale de la construcción (es la excepción declarada
«barrido común» a *flujo propio*, no a seguridad). Se enciende y se apaga activando o desactivando el flujo (`publicar-flujo.sh --encender` y `--apagar`).

```
Cada 10 minutos → Config base → Reclamar rescates → Preparar rescates → Redactar rescate → Armar rescate → [cadena de envío común, con `¿Meta aceptó?` antes de `¿Reportar? (saliente)`]
```

13 nodos (7 propios —los seis de arriba y la puerta `¿Meta aceptó?`— y 6 de la cadena común `¿Enviar de verdad?`, `Enviar a WhatsApp`, `¿Falló el envío?`, `Enviar respaldo`, `¿Reportar? (saliente)`,
`Reportar mensaje (saliente)`). Tope duro: 16.

## Piezas

| Pieza | Qué es |
|---|---|
| `construir.mjs` | `node construir.mjs --tenant <id> [--verificar]` y `--todos [--verificar]`: arma `rescate-22h.<id>.json` desde la plantilla y `admin/scripts/datos/<id>/rescate-22h.json`. `--verificar` no escribe y sale 1 si lo versionado difiere o viola una guardia. `--publicable (--tenant <id> \| --flujo <json>)` sale 1 mientras quede un `REEMPLAZAR_*`. |
| `flujo.plantilla.json` | Los 6 nodos propios, con marcas `@@` (código, credenciales por nombre, URL). La cadena de envío se injerta desde `../comun-sin-agente/src/envio.mjs`. |
| `src/rescate.js` | Librería (prefijo `rs`): corte, lista de teléfonos, prompt, revisión del cuerpo, texto fijo y saludo válidos, elección del texto. |
| `src/nodos/preparar-rescates.js`, `armar-rescate.js` | Los dos nodos Code. |
| `../comun-sin-agente/` | **Se incluye, no se copia ni se modifica**: `leerProyecto`, `armarVariante`, `injertar` y `filtro-redaccion.js`. Una copia declarada: `rsTextoDeGemini` (no hay fuente común de `cnTextoDeGemini`). |

## Datos por tenant (`admin/scripts/datos/<id>/rescate-22h.json`)

`tenant`, `nombreFlujo`, `credenciales` (`ingesta`, `graph`, `gemini`, **por nombre**, el flujo las lleva con `id` vacío) y `configBase`, de lista cerrada:
`phoneNumberId`, `waGraphVersion`, `modelo`, `listaDePrueba` (booleano; **verdadero por omisión**: solo el teléfono de prueba), `telefonosDePrueba`,
`telefonosExcluidos`, `quienPromete`, `rescateQuien`, `rescateContexto`, `rescateSaludo` y `rescateTextoFijo`. Los identificadores van como
marcadores `REEMPLAZAR_*` (el repositorio es público) y los sustituye el publicador. No hay `modoPrueba`: la prueba se hace con la lista.
Un tenant nuevo agrega su archivo y corre `--tenant`: **no se toca una línea del módulo**.

## Lo que el flujo garantiza (cada cosa tiene su guardia en `--verificar` y su prueba negando)

- Un solo disparador (`*/10 * * * *`). **Sin webhook, sin WhatsApp Trigger** (prohibición 7), sin `$getWorkflowStaticData` (la marca única vive en el servidor), sin `errorWorkflow`.
- Nodos HTTP solo hacia Meta, Gemini y las dos Functions (`reclamarRescates` e `ingesta`). Credenciales sin id. `REEMPLAZAR_*` solo en «Config base».
- `saveDataErrorExecution` **exactamente `none`** (decisión del 20/10): las ejecuciones fallidas no guardan los textos del cliente. `saveDataSuccessExecution: none`.
  Una falla repetida no tiene alerta propia: se ve en las ejecuciones con error; la vigilancia externa queda fuera de este bloque.
- Un fallo del reclamo, de la preparación o del armado **corta** la ejecución (`RS-FLUJO`, `RS-LINEA`, `RS-RECLAMO-<código>`, `RS-PAREO`): nunca se traga.
- **El modelo redacta solo el cuerpo.** El código antepone el saludo fijo (que dice «asistente virtual», prohibición 4) y verifica el cuerpo: no es `FIJO`, de 20 a 240
  caracteres, sin dígitos, **una** pregunta, sin saludo propio, sin temas de cobro ni palabras de tiempo, sin enlaces, sin promesas, sin afirmar un hecho
  (el filtro común). Ante cualquier falla, o con un historial insuficiente, sale el texto fijo. Todo es texto libre dentro de la ventana, nunca una plantilla.
- Cuatro barreras contra el mensaje a quien no corresponde: la decisión del servidor, la relectura en su transacción, la lista de prueba (en el servidor y aquí) y el
  corte de 23 h 50 min en n8n. Solo se rescata desde la línea de este flujo.
- Hasta 20 por corrida; el envío es de a uno, con 1,5 s entre mensajes (cadena común).

## Contrato del flujo consumidor (lo exige el PR de cada cliente)

1. Reporta **cada entrante** a la ingesta con `tipo` y el `texto` real.
2. Reporta las **derivaciones a una persona** con `evento: 'no_contactar'`, aunque salga el respaldo.
3. Conserva la expresión de «no me escribas» del reporte entrante.
4. El cobro va con `qr_enviado`/regla 2 y cotejo en el servidor, o el comprobante llega como imagen o documento.
5. La ruta del número tiene `flujo: 'venta'`.
6. **Antonio, además:** el camino de protección por violencia o miedo reporta `evento: 'no_contactar'`. Es condición dura de su PR, con una prueba negativa en su batería.

Riesgo residual declarado: si el mensaje de derivación no salió ni en respaldo, no se reporta y esa persona podría recibir un rescate.

## Costo

- **Mensajes:** +1 por cada conversación sin compra que llega a 22 h de silencio y no fue excluida, a 0,0113 USD (`docs/base-comercial.md` §1), dentro de la franquicia de 1.000 por número y por mes mientras haya cupo. 0 en toda otra conversación. **0 nodos** en el flujo conversacional.
- **IA:** una llamada a Gemini Flash-Lite por rescate (unos 0,0005 USD).
- **Nube:** 144 invocaciones por día y por tenant, más lo que cuesta cada rescate en el servidor (una escritura transaccional y un renglón de bitácora).

## Estado y límites

- **Sin publicar.** No se ha probado contra Meta, Gemini ni n8n reales: solo con el n8n de mentira (`admin/pruebas/rescate-22h-flujo.test.ts`). El ensayo real de 22 h (con un teléfono de la lista) es posterior.
- El JSON versionado lleva marcadores (`--publicable` sale 1): lo sustituye el publicador al crear el flujo, con `listaDePrueba: true`.
- Sin Meta verificada con fecha: falta comprobar en la documentación oficial que este texto libre dentro de la ventana no cuenta para el límite de conversaciones iniciadas por la empresa de la WABA sin verificar.
- El texto de Antonio y su archivo de datos **no existen** todavía (los aprueban Andres o Silvana en su PR de datos).

## Pruebas

`admin/pruebas/rescate-22h-lib.test.ts`, `rescate-22h-construir.test.ts` y `rescate-22h-flujo.test.ts` (registradas en `SUITES_PURAS`).
