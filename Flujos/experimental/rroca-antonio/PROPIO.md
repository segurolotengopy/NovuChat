# El Puente de Antonio (tenant `rroca-antonio`): qué es común y qué es propio

Regla (Andres, 09/10/2026): **flujo propio = composición propia + núcleo común obligatorio**. Lo común se incluye desde su fuente, nunca se copia; lo propio vive aquí.
Zona: `Flujos/experimental/rroca-antonio/` (precedente `chat-novuchat`); se muda después a `Flujos/clientes/`. Este es el **PR-B** sobre el esqueleto del PR-A: conversación, catálogo, ángulos de anuncio, QR, comprobante, avisos, derivación, protección ante violencia o miedo y números no bolivianos. El PR-C (datos del negocio, guardia de publicación `--publicable` y su confirmación en `publicar-flujo.sh`) sigue; **hasta entonces no se publica**.
Pruebas: `admin/pruebas/tenants/rroca-antonio/` — `armado.test.ts` (armado, guardias, datos, zona, `ra.js`), `huecos.test.ts` y `huecos-cobro.test.ts` (los huecos contra su origen, con hash fijado), `medios.test.ts` (los medios comunes incluidos y su contrato), `flujo.test.ts` (el esqueleto), `venta.test.ts` (la conversación y el cobro), `negadas.test.ts` (las pruebas negadas del plan §5 sobre una batería amplia), `rescate-contrato.test.ts` (el contrato con el rescate de 22 h) y `vigilante-ux.ts` (los invariantes de UX aplicados a TODA la batería), todas punta a punta con el n8n de mentira.
Armado: `node Flujos/experimental/rroca-antonio/construir.mjs` escribe `rroca-antonio.json` y `rroca-antonio.prueba.json`; con `--verificar` no escribe y sale 1 si difieren o violan una guardia.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Mensajes de WhatsApp: texto, botones, lista, `cta_url`, `cmContactoConBoton` | `Flujos/experimental/comun-sin-agente/src/mensajes.js` (paquete `mensajes`, solo en «Armar mensajes») |
| Cadena de envío: ¿Enviar de verdad?, Enviar a WhatsApp (lote de 1, 1,5 s), respaldo en texto, reporte saliente | `comun-sin-agente/src/envio.mjs`, `injertar()` desde `construir.mjs` |
| Armador (plantilla + código → JSON, `--verificar`) | `comun-sin-agente/construir.mjs` (`leerProyecto`, `armarVariante`) |
| Preparar transcripción (audio → texto, tope de 5 minutos) | `Flujos/src/core/medios/preparar-transcripcion.js`, paquete `m-transcripcion`, **byte a byte** |
| Preparar imagen (imagen o PDF → categoría) | `Flujos/src/core/medios/preparar-imagen.js`, paquete `m-imagen`, **byte a byte** |
| Medio no aceptado (demasiado grande o ilegible) | `Flujos/src/core/medios/medio-no-aceptado.js`, paquete `m-no-aceptado`, **byte a byte** |

Los tres módulos leen por nombre `$('Normalizar entrada')`, `$('Obtener URL del medio (general)')` y `$('Config del negocio')`: ese contrato lo prueba `medios.test.ts`. No se agrega nada en `Flujos/src/core/` ni en `Flujos/src/modulos/`.

## Común SIN fuente utilizable: copiado y declarado (HUECOS, a resolver en el módulo común)

Origen: `chat-novuchat` o `venta-minima`, **no `rroca-ruben`**. Cada hueco tiene su prueba en `huecos.test.ts`. Si el origen cambia, la prueba falla y obliga a decidir (volver a copiar o resolver el módulo común). Decisión D1 del plan, opción (a): se declaran ahora y se reemplazan por inclusión cuando exista el módulo.

| Pieza en este flujo | Origen | Diferencia con el origen (la única permitida) |
|---|---|---|
| `src/nodos/puerta-del-turno.js` (comercio no operativo, uso extendido, **pausa por persona**: estado `bloqueado` = cero envío y cero modelo) | `chat-novuchat/src/nodos/puerta-del-turno.js` | **Una sola**: el nodo de entrada se llama «Normalizar entrada» (`cnPrimero('Interpretar entrada')` → `cnPrimero('Normalizar entrada')`). `core/comercio-no-operativo.js` y `core/uso-extendido.js` son del contrato del agente y hay versiones divergentes (H-PUERTA) |
| `src/nodos/_comun.js` (`cn*`: leer nodos por nombre, atención, Gemini, ficha por teléfono) | `chat-novuchat/src/nodos/_comun.js` | El título, la referencia a la librería (`ra.js`), la clave de la ficha en los datos estáticos (`chatNovuchat` → `antonio`) y se quita el barrido de datos de otros flujos. No hay fuente común: cada flujo tiene la suya (H-FICHA) |
| `src/nodos/carga-de-entrada.js` (filtro de eventos de Meta) | `chat-novuchat/src/nodos/carga-de-entrada.js` | Se AGREGA la rama del receptor (si corrió «Entrega del receptor», el evento es su `body.value`, y `body.field`, si viene, tiene que ser `messages`; el veredicto del verificador nunca se lee como mensaje) y el `body` de la carga solo se lee si corrió «Entrada de prueba» (H-CARGA) |
| `src/nodos/config-del-negocio.js` (consola → configuración) | `chat-novuchat/src/nodos/config-del-negocio.js` | Se QUITAN la oferta (planes y cargos), la planilla y los datos propios del chat; se AGREGA el modelo (de «Config base»). **Idénticos al origen**: la lectura de la respuesta (200 / 409 / otra), el bloque de atención y el resto del modo prueba. Modo prueba: `telefonoPermitido` **niega por defecto** (`permitidos.length > 0 && …`; el origen permite todo con la lista vacía). El catálogo y el cobro no pasan por este nodo (H-CONFIG) |
| `src/nodos/resumen-del-turno.js` | `chat-novuchat/src/nodos/resumen-del-turno.js` | Se AGREGA la verificación de entrega (regla I-ENTREGA): si ni el envío ni su respaldo devolvieron `messages[0].id`, la ejecución termina en ERROR («Entrega fallida»). Es el sumidero que exige `pruebas/core/entregas.test.ts` |
| Los 6 nodos de la entrada verificada del receptor (Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200), Rechazar (401), Descartar repetidos) en `flujo.plantilla.json` | `venta-minima/flujo.plantilla.json` | **Ninguna** en `parameters`, tipo, credenciales y opciones; solo `notes`, `position` e `id` propios. `wabaIdEsperado` FIJO (marcador `REEMPLAZAR_*`), sin «Continue on Fail», repetidos descartados entre ejecuciones; `construir.mjs` lo hace cumplir |
| Nodos JSON de «Entrada de prueba», «Config base», «Traer configuración» y «¿Meta aceptó?» | `chat-novuchat/flujo.plantilla.json` | **Ninguna** salvo `notes`, `position` e `id` |
| Nodos JSON de «¿Reportar? (entrante)» y «Reportar mensaje (entrante)» | `chat-novuchat/flujo.plantilla.json` | Solo cambia el nombre del nodo de entrada que leen (`Interpretar entrada` → `Normalizar entrada`) |
| Nodos JSON de medios: «¿Bajar medio?», «Obtener URL del medio (general)», «¿Tamaño aceptable?», «Descargar medio», «¿Es audio?», «¿Es un documento?», «Transcribir audio», «Describir documento», «Describir imagen» | `chat-novuchat/flujo.plantilla.json` | Los nombres de campo del contrato común (`esAudio` → `esMedioAudio`, `esVisual` → `esMedioVisual`) y el nombre del nodo de entrada; la credencial de Gemini va por nombre (`@@cred:gemini`) y el prompt de «Describir …» es propio (solo `publicidad`, `comprobante`, `otro`) |

Pendientes de declarar en PR-B (aún sin código en PR-A): H-COBRO (declaraciones de `venta-minima/src/lib/cobro.js`, sin los textos de restaurante) y H-AVISOS (`avisos.js`), ambos de `venta-minima`, copiados byte a byte con hash fijado.


### Huecos del cobro y de los avisos (PR-B): copiados de `venta-minima` (rama #519) y declarados

Origen = `venta-minima`, **no `rroca-ruben`**. Cada declaración se compara BYTE A BYTE con su origen en `huecos-cobro.test.ts` (hash fijado, el árbol de trabajo si ya trae #519 y la rama `origin/cartera/qtaco-visor-comprobantes`); si el origen cambia, la prueba falla y obliga a decidir (volver a copiar o resolver el módulo común). Ninguna declaración de más.

| Pieza | Origen | Qué se copia |
|---|---|---|
| `src/lib/cobro.js` | `venta-minima/src/lib/cobro.js` | `CB_PROHIBIDAS`, `cbCanon` (+ confusables), `cbLinea`, `cbEsObjeto`, `cbTotalValido`, `cbMonto`, `cbMoneda`, `cbCodigo`, `cbUrlSegura`, `cbCobroReal`, la lectura del comprobante (`cbTextoDeGemini`, `cbObjetoUnico`, `cbCampoLeido`, `cbLectura`), `cbCuerpoDe`, `cbRutaGuardada`, `cbResultadoVenta` (+ sus listas cerradas), `cbEstadoParaAviso`, `cbImporteDelServidor`, `cbDiferencia`, `CB_ROTULO_SIMULADO`. **No** se copian los textos de un restaurante (`cbTextoAlCliente`) ni el QR por dirección (`cbMensajeQr`): aquí el QR sale por `id` de medio. `CB_ROTULO_SIMULADO` y `cbRutaGuardada` no se usan (no hay cobro simulado ni se guarda la imagen) pero se copian para que la declaración siga siendo la del origen |
| `src/lib/avisos.js` | `venta-minima/src/lib/avisos.js` | `avLimpio` (con `avSinProhibidas`, `avCanon`, `avNorm`…), `avTexto`, `avPlantilla`, `avDestinatarios` (+ `avUnificar`, `avPrefijos`, `avDigitos`), `avPrimerNombre`, `avParametro` |
| `RA_NIEGA_IA` en `src/lib/ra.js` | `chat-novuchat/src/lib/chat.js` (`CH_NIEGA_IA`) | La expresión, idéntica salvo el nombre (la prueba la compara) |

Los 8 nodos nuevos de `flujo.plantilla.json` (`Interpretar lectura`, `¿Cotejar?`, `Cotejar en el servidor`, `¿Conversar con el modelo?`, `Conversar con el modelo`, `Armar avisos`, `¿Hay avisos?`, `Enviar aviso`) son propios de este flujo.

## Propio de Antonio

- `src/lib/ra.js`: la ficha por teléfono (olvido a las 48 h, últimos 40 ids de mensaje, memoria de 15 mensajes, tope de 1.000 fichas), el catálogo de 6 productos (el precio vive solo en la consola), los 5 prellenados, los 7 ángulos de anuncio, los menús, los textos fijos, el prompt del modelo y sus reglas de redacción, la derivación, el detector de violencia o miedo, y la barrera `raSeguro` (NIEGA_IA, palabras prohibidas del cobro y párrafos).
- `src/nodos/normalizar-entrada.js` (H-NORM): la normalización de la entrada. No hay fuente común utilizable (`core/normalizar-entrada.js` es del contrato del agente). Cubre text, interactive, button, audio/voice, image, document y cualquier otro tipo; emite `categoria` (`conversacion`, `medio`, `otro`) y los campos del contrato con los medios comunes.
- `src/nodos/decidir-turno.js`: el código decide el turno. En PR-A solo cierra la puerta o responde el texto cortés; el resto queda `pendiente` (sin respuesta).
- `src/nodos/armar-mensajes.js`: un ítem por mensaje, o ninguno; arma el QR, los menús, la lista, la protección y los textos fijos; revisa lo que redacta el modelo; escribe la ficha con la clave `messages[0].from`.
- `flujo.plantilla.json`, `construir.mjs` (guardias, datos, «¿Meta aceptó?») y los datos `admin/scripts/datos/rroca-antonio/rroca-antonio.json` (solo marcadores `REEMPLAZAR_*`).

## Condiciones declaradas (no se resuelven en el PR-B)

- **No se publica hasta el PR-C.** El PR-B quitó `meta.noPublicable` (la conversación está completa) y la guardia lo prohíbe, pero hoy NADA frena una publicación salvo los marcadores `REEMPLAZAR_*`. La guardia `--publicable` y la confirmación en `publicar-flujo.sh` para `rroca-antonio` son del PR-C.
- **Datos que siguen pendientes** (marcadores o valores recomendados en `admin/scripts/datos/rroca-antonio/rroca-antonio.json`): `lineaProteccion` (la verifica Silvana, P9; la línea FELCV sigue pendiente y sin dato no se cita ninguna), las dos plantillas de aviso YA existen en Meta (de Antonio) y están `PENDING`: nombres `aviso_comprobante_recibido` (4 variables) y `aviso_consulta_para_antonio` (3) como dato, hay que pasar el estado a `APPROVED` cuando Meta las apruebe, `garantiaTexto` (confirmar con Antonio, P3) y `plazoEntregaHoras` = 6 (interno: solo la hora límite del aviso a Antonio; el cliente no lee plazos). El catálogo de la consola lo carga el PR-C con los 6 productos DISPONIBLES (la bandera `agotado` sigue respetándose si se marca).
- **`noContactar` del servidor (límite declarado):** «Traer configuración» (`configuracionFlujo`) NO devuelve hoy el `noContactar` del teléfono, así que el flujo no puede respetarlo: la protección ante violencia o miedo vive en la ficha volátil de 48 h (`riesgo`). Pasadas 48 h sin escribir, la ficha se olvida y la oferta vuelve a ser posible para ese teléfono; el servidor sí conserva `noContactar` (lo marca el evento `no_contactar`) para el rescate. Si algún día `configuracionFlujo` lo devuelve, hay que leerlo en «Decidir turno». No se tocó ninguna Function.
- **Falla abierta de la pausa**: heredada de `chat-novuchat` con la puerta idéntica; ver `DISENO.md`.
- **Cruce «suspendido antes que bloqueado»**: la puerta evalúa primero el comercio no operativo.
- **Modo prueba**: niega por defecto.

## Mensajes por conversación

**0 agregados al cliente.** Un mensaje por turno del cliente, o ninguno; la prueba lo niega recorriendo todos los tipos de entrada (y una batería de más de 60 turnos). Excepción decidida por Andres: un número no boliviano ahora recibe 1 mensaje (texto fijo + botón de Antonio) a lo más cada 24 h; antes se descartaba. Llamadas al modelo: 0 o 1 por turno de conversación libre (la violencia, los botones, los precios, la derivación y los medios fallidos no llaman al modelo); las de Gemini en los medios son 1 por audio, imagen o PDF (la lectura del comprobante va en esa misma llamada).
