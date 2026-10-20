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
Cada 10 minutos → Config base → Reclamar rescates → Preparar rescates → ¿Hay historial? ─sí→ Redactar rescate ─┐
                                                                       └──────────no────────────────────────┴→ Armar rescate → [cadena de envío común, con `¿Meta aceptó?` antes de `¿Reportar? (saliente)`]
```

13 nodos (8 propios —los de arriba, con `¿Hay historial?` y la puerta `¿Meta aceptó?`— y 5 de la cadena común `¿Enviar de verdad?`, `Enviar a WhatsApp`, `¿Falló el envío?`,
`¿Reportar? (saliente)`, `Reportar mensaje (saliente)`). Tope duro: 16. **Sin historial suficiente no hay llamada a Gemini**: `Preparar rescates` no arma `cuerpoModelo` y `¿Hay historial?`
manda esos rescates directo a `Armar rescate`, que los resuelve con el texto fijo. `Armar rescate` corre hasta dos veces por ejecución (una por rama); cada corrida atiende un subconjunto distinto, y el
pareo con la respuesta del modelo es POR POSICIÓN entre los de historial suficiente (`RS-PAREO` si no coincide el largo). Emparejar por `pairedItem` (M-6) queda como mejora: el n8n de mentira no lo modela.

## Piezas

| Pieza | Qué es |
|---|---|
| `construir.mjs` | `node construir.mjs --tenant <id> [--verificar]` y `--todos [--verificar]`: arma `rescate-22h.<id>.json` desde la plantilla y `admin/scripts/datos/<id>/rescate-22h.json`. `--verificar` no escribe y sale 1 si lo versionado difiere o viola una guardia. `--publicable (--tenant <id> \| --flujo <json>)` sale 1 mientras quede un `REEMPLAZAR_*`. |
| `flujo.plantilla.json` | Los 7 nodos propios de la plantilla (más `¿Meta aceptó?`), con marcas `@@` (código, credenciales por nombre, URL). La cadena de envío se injerta desde `../comun-sin-agente/src/envio.mjs`. |
| `src/rescate.js` | Librería (prefijo `rs`): corte, lista de teléfonos, prompt, revisión del cuerpo, texto fijo y saludo válidos, elección del texto. |
| `src/nodos/preparar-rescates.js`, `armar-rescate.js` | Los dos nodos Code. |
| `../comun-sin-agente/` | **Se incluye, no se copia ni se modifica**: `leerProyecto`, `armarVariante`, `injertar` y `filtro-redaccion.js`. Una copia declarada: `rsTextoDeGemini` (no hay fuente común de `cnTextoDeGemini`). |

## Datos por tenant (`admin/scripts/datos/<id>/rescate-22h.json`)

`tenant`, `nombreFlujo`, `contratoConsumidor` (ver abajo), `credenciales` (`ingesta`, `graph`, `gemini`, **por nombre**, el flujo las lleva con `id` vacío) y `configBase`, de lista cerrada:
`phoneNumberId`, `waGraphVersion`, `modelo`, `listaDePrueba` (booleano; **verdadero por omisión**: solo el teléfono de prueba), `telefonosDePrueba`,
`telefonosExcluidos`, `quienPromete`, `rescateQuien`, `rescateContexto`, `rescateSaludo` y `rescateTextoFijo`. Los identificadores van como
marcadores `REEMPLAZAR_*` (el repositorio es público) y los sustituye el publicador. No hay `modoPrueba`: la prueba se hace con la lista.
**El nombre de la credencial de Gemini tiene que ser único en la instancia** (no dejar el nombre por omisión «Google Gemini(PaLM) Api account», que otro flujo puede compartir o que n8n resolvería a otra cuenta):
quien publique verifica en la instancia que el nombre apunta a la credencial prevista, porque el flujo las lleva por nombre y con `id` vacío. Esta verificación no la hace el módulo.
Un tenant nuevo agrega su archivo y corre `--tenant`: **no se toca una línea del módulo**.

## Lo que el flujo garantiza (cada cosa tiene su guardia en `--verificar` y su prueba negando)

- Un solo disparador (`*/10 * * * *`). **Sin webhook, sin WhatsApp Trigger** (prohibición 7), sin `$getWorkflowStaticData` (la marca única vive en el servidor), sin `errorWorkflow`.
- Nodos HTTP solo hacia Meta, Gemini y las dos Functions (`reclamarRescates` e `ingesta`). Credenciales sin id. `REEMPLAZAR_*` solo en «Config base».
- `saveDataErrorExecution` **exactamente `none`** (decisión del 20/10): las ejecuciones fallidas no guardan los textos del cliente. `saveDataSuccessExecution: none`.
  **Consecuencia que hay que saber:** con `none`, las fallas **no quedan registradas en n8n**. Las ejecuciones con `RS-FLUJO`, `RS-LINEA` y `RS-PAREO` (y `RS-RECLAMO-<código>`) cortan, pero no dejan huella en la lista de
  ejecuciones; lo único visible son los registros de la Function `reclamarRescates` (401, 409, 500) y el silencio de los rescates. Una falla repetida no tiene alerta propia; la vigilancia externa queda fuera de este bloque.
  **Decisión P3 pendiente de Andres:** `none` (hoy; sin retención de textos del cliente, sin rastro de fallas) contra `all` (rastro de fallas, con retención de lo que escribieron los clientes). No se cambia sin su respuesta;
  la guardia exige `none`.
- Un fallo del reclamo, de la preparación o del armado **corta** la ejecución (`RS-FLUJO`, `RS-LINEA`, `RS-RECLAMO-<código>`, `RS-PAREO`): nunca se traga (aunque, por lo anterior, no se guarda).
- **Sin respaldo de envío (M-4).** La cadena común reenviaría el mismo texto si el primer envío falla; con un timeout de Meta eso podría **duplicar** el rescate. Este flujo quita `Enviar respaldo` y deja sin destino la
  salida «con fallo» de `¿Falló el envío?`: un envío que falla no se reenvía ni se reporta. Como la marca del servidor ya se gastó, ese rescate se pierde (un rescate por contacto, para siempre): se prefiere perder uno a duplicarlo.
  La guardia lo exige.
- **El modelo redacta solo el cuerpo.** El código antepone el saludo fijo (que dice «asistente virtual», prohibición 4) y verifica el cuerpo: no es `FIJO`, de 20 a 240
  caracteres (también después del pulido), sin dígitos, **una** pregunta y a lo más dos oraciones, sin saludo propio ni presentación, sin temas de cobro (por **raíces con sufijo**: `pag\w*`, `cobr\w*`, `cancel\w*`, `abon\w*`…:
  «cancelar» es pagar en Bolivia), de precios, ofertas ni enlaces en palabras, sin palabras de tiempo ni plazos, sin promesas (también en singular), sin afirmar un hecho (el filtro común), sin decir quién escribe
  (`soy`, `te escribe`, `en persona`, el nombre del negocio: prohibición 4) y **solo con el alfabeto latino básico y los signos del español** (un homoglifo cirílico o una letra de ancho cero parten una palabra sin que se vea).
  Las listas se prueban también contra el texto «junto» (sin guiones ni puntos entre letras: «p-a-g-o»). Acepta falsos positivos a propósito («costura», «tener en cuenta»): caen en el texto fijo, que es barato.
  Ante cualquier falla, o con un historial insuficiente, sale el texto fijo. Todo es texto libre dentro de la ventana, nunca una plantilla.
- **El texto fijo y el saludo de cada tenant** pasan las mismas listas y el mismo alfabeto al armar (`--verificar`) y al ejecutar.
- Cuatro barreras contra el mensaje a quien no corresponde: la decisión del servidor, la relectura en su transacción, la lista de prueba (en el servidor y aquí) y el
  corte de 23 h 50 min en n8n. Solo se rescata desde la línea de este flujo.
- Hasta 20 por corrida; el envío es de a uno, con 1,5 s entre mensajes (cadena común).
- `Preparar rescates` también descarta (defensa en profundidad) los de `telefonosExcluidos` y los que tienen un último mensaje futuro o de menos de 22 h.
- **Lista blanca** de tipos de nodo (`scheduleTrigger`, `set`, `httpRequest`, `code`, `if`) y de tipos de credencial (`httpHeaderAuth`, `googlePalmApi`, `whatsAppApi`); el nombre del flujo es exactamente
  `NovuChat — Rescate 22 h (<tenant>)` y la versión de Graph (`waGraphVersion`) tiene la misma forma (`^v\d{1,2}\.\d$`) al validar los datos y al ejecutar.
- El modelo (`Redactar rescate`) lleva `maxOutputTokens: 300`. **Por comprobar en el ensayo:** si `gemini-3.5-flash-lite` admite `thinkingConfig` (y con qué campo: `thinkingBudget` o `thinkingLevel`); hasta
  comprobarlo en la API no se fija, para no romper la llamada. Si el modelo «piensa», esos tokens cuentan contra el tope y podría llegar un cuerpo cortado (se descartaría por la pregunta final: sale el texto fijo).

## Contrato del flujo consumidor (lo exige el PR de cada cliente)

Los datos de cada tenant declaran `contratoConsumidor`: `{ "prueba": "<ruta desde la raíz del repo>.test.ts", "caso": "<texto opcional que debe aparecer en ella>" }`, la prueba negativa de la batería de su
consumidor, y `construir.mjs` (también con `--verificar`) comprueba que **exista**. Un tenant que no declara nada **falla** con un mensaje claro. Mientras la batería no esté, se declara de forma explícita
`{ "estado": "pendiente-pr-b" }` (hoy, Rubén: la prueba S5 la añadirá el PR-B; no se inventa una ruta). Armar y verificar pasan con ese estado, pero `--publicable --tenant <id>` **sale 1** mientras esté pendiente.

1. Reporta **cada entrante** a la ingesta con `tipo` y el `texto` real.
2. Reporta las **derivaciones a una persona** con `evento: 'no_contactar'`, aunque salga el respaldo.
3. Conserva la expresión de «no me escribas» del reporte entrante.
4. El cobro va con `qr_enviado`/regla 2 y cotejo en el servidor, o el comprobante llega como imagen o documento.
5. La ruta del número tiene `flujo: 'venta'`.
6. **Antonio, además (regla extra, condición DURA):** todo camino de protección por violencia o miedo reporta `evento: 'no_contactar'` y desde ese momento no recibe rescate. No se publica el rescate de Antonio sin
   esa prueba negativa en su batería (declarada en su `contratoConsumidor`, sin `pendiente-pr-b`).

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
