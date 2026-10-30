# El flujo de venta de Walisuma (tenant `walisuma`): qué es común y qué es propio

Regla (Andres, 09/10/2026): **flujo propio = composición propia + núcleo común obligatorio**. Lo común se incluye desde su fuente, nunca se copia; lo propio vive aquí. Regla «Basado en» (01/10/2026): se parte de la lista de funcionalidades, no del flujo de otro cliente.
Zona: `Flujos/experimental/walisuma/`. Este es el **PR-2, el esqueleto**: todo lo que no es la conversación, el carrito, el cobro ni los avisos. **No es publicable** (`construir.mjs --publicable` sale 1 y lo dice) hasta que el PR-3 lo complete.
Armado: `node Flujos/experimental/walisuma/construir.mjs` escribe `walisuma.json` (36 nodos) y `walisuma.prueba.json` (31); con `--verificar` no escribe y sale 1 si difieren o violan una guardia.
Pruebas: `admin/pruebas/tenants/walisuma/` — `armado.test.ts` (tope, receptor, prohibición 7, webhooks, inclusiones byte a byte, no publicable, datos), `receptor.test.ts` (firma inválida, repetidos, `field`), `sesion.test.ts` (clave `messages[0].from`, reversión de la ficha), `tomar.test.ts` (pausa por Tomar y comercio no operativo) y `neutros.test.ts` (los nodos comunes neutros y cada diferencia con su origen), con `mundo.ts` (el n8n de mentira con dobles); más `carrito.test.ts` y `catalogo.test.ts` del PR-1.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Entrada verificada del receptor (6 nodos: Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200), Rechazar (401), Descartar repetidos) | `Flujos/experimental/venta-minima/flujo.plantilla.json`, leídos POR NOMBRE por `construir.mjs`; `--verificar` falla si difieren (id, posición y notas incluidos) |
| Cobro (`cb*`), avisos (`av*`) y motor de la conversación (`vd*`) | `Flujos/experimental/venta-digital/src/{cobro,avisos,conversacion}.js`, librerías de todos los nodos `todo` |
| Mensajes de WhatsApp (`cm*`) | `Flujos/experimental/comun-sin-agente/src/mensajes.js`, paquete `mensajes`, solo en «Armar mensajes» |
| Cadena de envío (¿Enviar de verdad?, Enviar a WhatsApp, ¿Falló el envío?, Enviar respaldo, ¿Reportar? y Reportar mensaje (saliente)) | `comun-sin-agente/src/envio.mjs`, `injertar()` desde `construir.mjs`; «¿Meta aceptó?» solo reencamina una conexión |
| Armador (plantilla + código → JSON, `--verificar`) | `comun-sin-agente/construir.mjs` (`leerProyecto`, `armarVariante`) |
| Medios: transcripción, imagen (con las campañas por titular) y medio no aceptado | `Flujos/src/core/medios/{preparar-transcripcion,anuncio-por-titular+preparar-imagen,medio-no-aceptado}.js`, **byte a byte** |
| Nodos neutros: Carga de entrada, Config del negocio, Normalizar entrada, Puerta del turno, Resumen del turno, y `_comun.js` | `Flujos/experimental/venta-digital/src/nodos/` (ver abajo): subidos NEUTRALIZADOS desde la versión de «El Puente»; la de Antonio no se tocó ni se republicó |
| Reglas del task runner sobre las referencias `$('…')` | `rroca-ruben/construir.mjs`, **importada** (`problemasDeReferencias`) |

### Los nodos neutros y su diferencia con la versión de Antonio (cada una, declarada y probada en `neutros.test.ts`)

| Archivo | Diferencia |
|---|---|
| `carga-de-entrada.js`, `config-del-negocio.js`, `puerta-del-turno.js` | **Ninguna**: idénticos byte a byte (huella fijada de los dos lados) |
| `_comun.js` | El título y UNA función: la clave de la ficha en los datos estáticos ya no es `antonio` sino `CN_TENANT.claveFicha` (parámetro del tenant). Una clave ausente, con otra forma o que toca el prototipo no se usa: el nodo no lee ni escribe fichas (antes, la clave fija no podía fallar así). Se agrega `cnClaveDeFichas()` |
| `normalizar-entrada.js` | Las siete llamadas a la librería del tenant (`raFichaVigente`, `raYaVisto`, `raLineaCliente` ×3, `raEsRiesgo(raNorm(…))`, `RA_VENTANA_FUERA_DE_PAIS_MS`) pasan por `CN_TENANT` (`fichaVigente`, `yaVisto`, `lineaCliente`, `esRiesgo`/`norm`, `ventanaFueraDePaisMs`); dos comentarios dejan de nombrar al cliente |
| `resumen-del-turno.js` | Se QUITAN los tres bloques de reversión propios de ese negocio (`qrPrevio`, `qrLiberado`, `hashPrevio` con `ct*`) y se AGREGA la reversión genérica: `revertirSiFalloElPrincipal` (si el envío principal no devolvió `messages[0].id`, aunque saliera el respaldo) y `revertirFicha` (si no salió nada). Solo copia campos de nombre simple a la ficha de `from`. La verificación de entrega (regla I-ENTREGA) queda idéntica. Las variables locales `ra*` se renombran |

El «lector del panel» (`raPanelDe` de Antonio) NO lo usa ninguno de estos cinco nodos: «Config del negocio» lee el cuerpo de la consola directamente, igual que el de Antonio. El lector de `catalogo`, `cobro` y `campañas` de `configuracionFlujo` lo necesita el PR-3 en `wl.js`.

## HUECOS declarados (copia sin fuente común utilizable; a resolver en el módulo común)

| Pieza en este flujo | Origen | Diferencia |
|---|---|---|
| `WL_NIEGA_IA` en `src/lib/wl.js` | `rroca-antonio/src/lib/ra.js` (`RA_NIEGA_IA`) | La expresión, idéntica salvo el nombre. Prohibición 4 de CLAUDE.md |
| Nodos JSON de «Config base», «Traer configuración», «Carga de entrada», «Config del negocio», «Normalizar entrada», «¿Reportar? (entrante)», «Reportar mensaje (entrante)», «Puerta del turno», «¿Bajar medio?», «Obtener URL del medio (general)», «¿Tamaño aceptable?», «Descargar medio», «¿Es audio?», «¿Es un documento?», «Transcribir audio», «Describir documento», «Describir imagen», «¿Meta aceptó?», «Entrada de prueba» | `rroca-antonio/flujo.plantilla.json` | Ninguna, salvo: las notas de «Config base» (ruta de los datos), «Armar mensajes», «Resumen del turno», «Preparar imagen» y «Entrada de prueba»; el código de los nodos neutros (marca `@@vd:`); y el prompt de «Describir documento» y «Describir imagen», que dice «un negocio que vende productos por WhatsApp» donde Antonio dice «quien vende materiales digitales para parejas» |
| «Guardar comprobante» | `rroca-antonio/flujo.plantilla.json`, commit `7188637c` | **Ninguna** (huella fijada del nodo entero). Terminal y arriba de «¿Es un documento?» |
| «Reportar mensaje (entrante)» | el de Antonio | Ninguna: el evento `no_contactar` sale de la petición escrita de no ser contactado; `riesgoEscrito` queda siempre en falso (Walisuma no detecta violencia: `wlEsRiesgo`) |

## Propio de Walisuma

- `src/lib/wl.js` (SOLO datos y textos; lo común está en la base): la ficha por teléfono (olvido a las 48 h, últimos 40 ids de mensaje, tope de 1.000 fichas, campos de la charla `vd*`), `CN_TENANT` (el parámetro que leen los nodos neutros), los textos fijos (cortés y de otro país, ambos con **texto provisional que decide el comercio**) y `wlSeguro` (NIEGA_IA y palabras prohibidas del cobro en código, no en el prompt: prohibiciones 3 y 4).
- `src/nodos/armar-mensajes.js` (esqueleto): arma lo que ya se decide sin conversación (comercio suspendido, uso extendido, pausa por Tomar, otro país, tipo no leído) y escribe la ficha con la clave `messages[0].from`.
- `flujo.plantilla.json`, `construir.mjs` (guardias, datos, inclusión del receptor) y los datos `admin/scripts/datos/walisuma/walisuma.json` (solo marcadores `REEMPLAZAR_*`; costo de entrega VACÍO a propósito: el comercio todavía no lo declaró).

## Presupuesto de nodos: tope 47 (PR-2 + PR-3 juntos)

PR-2 (hoy): **36** en producción (6 del receptor + 7 de entrada y configuración + 1 puerta + 13 de medios + 9 de salida) y **31** en prueba («Entrada de prueba» en lugar de los 6 del receptor). PR-3 agrega **11**: Decidir turno, Interpretar lectura, ¿Cotejar?, Cotejar en el servidor, ¿Conversar con el modelo?, Conversar con el modelo, ¿Avisar al servidor?, Avisar al servidor, Armar avisos, ¿Hay avisos?, Enviar aviso. 36 + 11 = **47**, sin margen: cualquier nodo extra del PR-3 exige quitar otro.

## Empalmes que deja el PR-2 para el PR-3 (`EMPALMES_DEL_PR3` en `construir.mjs`)

| De | A | Hoy |
|---|---|---|
| ¿Bajar medio? (salida «no es un medio») | Decidir turno | va a «Armar mensajes» (empalme provisional del esqueleto) |
| Preparar transcripción | Decidir turno | termina |
| Medio no aceptado | Decidir turno | termina |
| Preparar imagen | Interpretar lectura | termina |
| Decidir turno | Armar mensajes | por el modelo, el aviso al servidor y los avisos |
| Puerta del turno (transferir) | Armar avisos | con la atención en operador, el uso extendido ofrece una persona: PR-3 debe avisar a recepción y poner el botón para escribirle directo (solo se ofrece lo que se cumple). Hoy no sale ningún aviso; la prueba pendiente está en `tomar.test.ts` |

Las posiciones del lienzo ya reservan los lugares de esos nodos (las de la versión de Antonio). En «Armar mensajes» el PR-3 agrega la lectura del plan de «Decidir turno» y el estado de los avisos; la forma del ítem de salida ya es la definitiva. «Resumen del turno» recibe `revertirFicha` / `revertirSiFalloElPrincipal` de ese ítem para devolver a la ficha lo que no salió.

## Condiciones declaradas

- **No publicable.** `node construir.mjs --publicable` sale 1: faltan los 11 nodos del PR-3, hay marcadores `REEMPLAZAR_*` (credenciales por nombre, receptor, `wabaIdEsperado`, teléfonos de prueba, contacto del aviso…), la plantilla `pedido_registrado` no consta como APPROVED y el costo de entrega está vacío. Los mensajes nombran claves y marcadores, nunca valores.
- **Guía de voz y prompt**: no están en el repositorio; los pone el PR-3 con quien diseña la conversación. No se inventaron.
- **Prefijos permitidos**: el dato trae `591` por omisión; si Walisuma vende a turistas, hay que decidirlo antes de publicar (el texto de otro país es provisional).
- **Falla abierta de la pausa y orden «suspendido antes que bloqueado»**: heredados de la puerta común, como en los demás flujos.
- **Modo prueba**: niega por defecto (`telefonosDePrueba` sin llenar = ningún teléfono permitido).

## Mensajes por conversación

**Esqueleto: 0 agregados.** Un mensaje por turno del cliente, o ninguno (la suite lo niega con todos los tipos de entrada que el esqueleto atiende). El flujo completo (PR-3): a lo más **1 al cliente por turno** y **1 al comercio por pedido** (el aviso de pedido). Llamadas al modelo en el esqueleto: 0 por turno de conversación; las de Gemini en los medios son 1 por audio, imagen o PDF.
