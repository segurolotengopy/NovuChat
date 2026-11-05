# «Noches Sin Insomnio» de Rubén (tenant `rroca-ruben`): qué es común y qué es propio

Regla (Andres, 09/10/2026): **flujo propio = composición propia + núcleo común obligatorio**. Lo común se incluye desde su fuente, nunca se copia (salvo los «huecos» declarados abajo, con su prueba); lo propio vive aquí.
Zona: `Flujos/experimental/rroca-ruben/`. **PR-1** (04/11/2026): esqueleto, catálogo, cobro, avisos, medios y miniCRM. El PR-2 trae el prompt completo, los ángulos de anuncio, las objeciones y las respuestas de salud largas. **Hasta entonces, y hasta la guardia de publicación en verde, no se publica.**
Este flujo REEMPLAZA al de «Libro IA para Emprendedores» (63 nodos): el flujo vivo de Rubén sigue siendo el viejo hasta publicar, y esa diferencia está declarada en `docs/versiones-por-cliente.md`. Se construyó por funcionalidades (CLAUDE.md, «basado en otro flujo»), con la forma del de Antonio (producción **64** nodos, prueba **59**, tope 64), no retocando el viejo.

Pruebas: `admin/pruebas/tenants/rroca-ruben/` — `armado.test.ts` (armado, guardias, datos, zona), `huecos.test.ts` y `huecos-cobro.test.ts` (los huecos contra su origen, con hash fijado), `medios.test.ts`, `flujo.test.ts` (el esqueleto), `venta.test.ts` (catálogo, prellenados, botones, QR, comprobante, avisos, derivación, crisis y el paso del Libro al Pack), `negadas.test.ts` (las negadas sobre una batería amplia: pago, IA, promesas, cifras, salud, comprobante, extranjero), `crm.test.ts` (miniCRM), `publicacion.test.ts` (guardia de publicación), `rescate-contrato.test.ts` (contrato con el rescate de 22 h), `identidad.test.ts`, `si-no.test.ts`, `pr-d.test.ts`, `botones-y-cancelar.test.ts`, `vision-categorias.test.ts`, `palabras-de-pago.test.ts`, `guardar-comprobante.test.ts`, `bateria-herramienta.test.ts`, `campanas.test.ts`, `cargar-campanas.test.ts` (necesita el emulador de Firestore), `negocio.test.ts`, `librerias.ts`, `mundo.ts` y `vigilante-ux.ts`.
Armado: `node Flujos/experimental/rroca-ruben/construir.mjs` escribe `rroca-ruben.json` y `rroca-ruben.prueba.json`; con `--verificar` no escribe y sale 1 si difieren o violan una guardia.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Mensajes de WhatsApp (texto, botones, lista, `cta_url`, `cmContactoConBoton`) | `Flujos/experimental/comun-sin-agente/src/mensajes.js` |
| Cadena de envío (¿Enviar de verdad?, Enviar a WhatsApp, respaldo, reporte saliente) | `comun-sin-agente/src/envio.mjs`, `injertar()` |
| Armador (plantilla + código → JSON, `--verificar`) | `comun-sin-agente/construir.mjs` |
| Cobro (`cb*`), avisos (`av*`) y el motor de la conversación (`vd*`) | `Flujos/experimental/venta-digital/src/{cobro,avisos,conversacion}.js` |
| No repetir el texto (`ct*`) y la pregunta pendiente | `Flujos/src/core/texto/no-repetir.js` y `pregunta-pendiente.js` |
| Medios: preparar transcripción, preparar imagen (con el reconocimiento por titular de la Consola) y medio no aceptado | `Flujos/src/core/medios/*.js`, byte a byte |
| Guardado de medios (rama común) | `comun-sin-agente/src/guardado.mjs` |
| miniCRM (8 nodos) | `Flujos/src/modulos/crm/` y `comun-sin-agente/construir-crm.mjs` (`ramaCrm`) |
| Reglas del task runner de n8n sobre `$('…')` (`problemasDeReferencias`, `referenciasDeNodos`) | **viven en este `construir.mjs`** y los importan Antonio, las doctoras y Walisuma (no se mueven en este PR) |

## Común SIN fuente utilizable: copiado y declarado (HUECOS)

Son los mismos que declara `rroca-antonio/PROPIO.md` (puerta del turno, `_comun.js`, carga de entrada, `config-del-negocio.js`, `resumen-del-turno.js`, los 6 nodos de la entrada verificada del receptor, «Entrada de prueba», «Config base», «Traer configuración», «¿Meta aceptó?», «¿Reportar? (entrante)», «Reportar mensaje (entrante)» y los nodos de medios), con su origen en `chat-novuchat` o `venta-minima`, y las mismas diferencias permitidas (más: la clave de la ficha en los datos estáticos es `ruben`). `huecos.test.ts` y `huecos-cobro.test.ts` los comparan con su origen; si el origen cambia, la prueba obliga a decidir.
`config-del-negocio.js` conserva la lectura de `direccion` y `direccionMaps` que hereda de Antonio: **este flujo no la usa** (no hay ubicación ni dirección); es una deuda declarada, no un comportamiento.
Como Antonio, este flujo NO adopta el estado de la conversación en el servidor (`sesion`) de PR-4c2: su núcleo copiado del chat queda en el estado previo (origen congelado `admin/pruebas/lib/origen-chat-pre-4c2/`).

## Propio de Rubén (nuevo)

- `src/lib/rr.js` (SOLO datos y textos; lo común está en la base y en el core):
  - **catálogo de 4 productos** (`RR_PRODUCTOS`: Pack, Libro con bono, Audiolibro, Meditaciones) **más el paso del Libro al Pack**, que NO es un producto del catálogo: su precio lo calcula `rrCatalogo` (Pack menos Libro, hoy 35) y solo existe como el botón «Pasar al Pack» que el código agrega al comprobante que cuadra de un Libro, **una sola vez** por ficha (`ficha.upgrade`: 0 nunca, 1 ofrecido, 2 cobrado), nunca por texto y solo Libro → Pack (el Audiolibro y las Meditaciones no suben al Pack: no hay fuente);
  - **los precios y los nombres de los botones viven en el catálogo de la Consola** (`negocio-rroca-ruben.json`: ids `pack-completo`, `libro-con-bono`, `audiolibro`, `meditaciones`); el código solo tiene el id y un título de respaldo. Botones: «Pack completo 70Bs», «Libro con bono 35Bs» y «Solo audios», que abre «Audiolibro», «Meditaciones» y «Mejor el Pack» (todos ≤ 20 caracteres);
  - los 4 prellenados de la landing («Hola, vengo de la página. Quiero …»), los textos fijos, `rrSeguro` y `RR_NIEGA_IA` (copia declarada de `CH_NIEGA_IA`, como las demás), la derivación de **lista cerrada** (garantía o devolución, reclamo, volumen o reventa, otro medio de pago, el material que no abre, una pregunta médica específica, hablar con Rubén y la queja de no entrega tras un comprobante), el **texto de crisis NUEVO** (cálido, ayuda profesional, botón «Hablar con Rubén» y aviso; NO es el texto de violencia de Antonio) y un **prompt MÍNIMO** (identidad y reglas duras). La salud vive en código: `rrSeguro` (barrera final: nunca «sin pastillas», «curar», «garantizado» ni «simulado»), el filtro de redacción del modelo y la derivación médica por código; el prompt solo lo repite.
- `src/nodos/*.js`: derivados de los de Antonio, con el catálogo y los textos de Rubén; sin ubicación, sin menú de bonos, sin protección por violencia.
- `flujo.plantilla.json`, `construir.mjs` (guardias, datos, guardia de publicación con `--anuncios`) y los datos `admin/scripts/datos/rroca-ruben/` (`rroca-ruben.json` con solo marcadores `REEMPLAZAR_*`, `negocio-rroca-ruben.json` y `campanas-rroca-ruben.json`).
- **Tope de nodos:** 64 (producción) y 59 (prueba); con el relé B9 de Clínicas (+2) llegará a 66. Mensajes por conversación al cliente: **0 agregados** (el paso del Libro al Pack y el aviso de crisis van DENTRO del mensaje que ya sale).

## Crisis emocional (decisión de Andres, 04/11/2026)

Detección por código (raíces sobre texto, voz, texto de una captura y pie de foto) Y por la marca `RIESGO` del modelo. Corta la venta: texto cálido con ayuda profesional, botón «Hablar con Rubén» y aviso a Rubén (sin copiar lo que escribió la persona); se reporta `no_contactar` (el rescate de 22 h no escribe a quien está en crisis). Una frase hecha («me muero de sueño») no es crisis. Queda activa 48 h en la ficha: cada mensaje posterior recibe el mismo texto con su botón (límite conocido; el PR-2 afina la continuación).

## Condiciones declaradas (no se resuelven en este PR)

- **Datos que faltan** (marcadores `REEMPLAZAR_*` en `rroca-ruben.json` y en `negocio-rroca-ruben.json`): las dos plantillas de aviso nuevas (el texto del libro anterior decía «pago validado»; hoy `PENDING`), `garantiaTexto`, los enlaces o archivos de entrega (no hay: Rubén entrega a mano desde la Consola), el QR nuevo (y su concepto) y la planilla del miniCRM.
- **Rescate de 22 h:** NO es del flujo; es el módulo del servidor. El flujo solo cumple su contrato `no_contactar` (`rescate-contrato.test.ts`). El rescate agrega +1 mensaje por conversación abandonada (declarado según `docs/base-comercial.md`).
- **La ficha vence a las 48 h**: la regla «una sola vez» del paso al Pack y la protección de crisis viven en esa ficha; pasadas 48 h sin escribir, se olvidan.
- **Modelo:** el único permitido es `gemini-3.5-flash-lite` (decisión de Andres, 04/11/2026).
- **`nombreNegocio` va vacío en `cmRevisarRedaccion`:** el filtro común pone en mayúscula toda palabra del nombre del negocio (≥ 4 letras) y volvería «Noches» e «Insomnio» las palabras comunes de la charla.
- **Falla abierta de la pausa**: heredada de `chat-novuchat` con la puerta idéntica (ver `DISENO.md`).

## Mensajes por conversación

**0 agregados al cliente.** Un mensaje por turno del cliente, o ninguno (la prueba lo niega recorriendo todos los tipos de entrada). Llamadas al modelo: 0 o 1 por turno de conversación libre; las de Gemini en los medios son 1 por audio, imagen o PDF.
