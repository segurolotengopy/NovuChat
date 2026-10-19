# Venta digital de Rubén (tenant `rroca-ruben`): qué es común y qué es propio

Regla (Andres, 09/10/2026): **flujo propio = composición propia + núcleo común obligatorio**. Lo común se incluye desde su fuente, nunca se copia; lo propio vive aquí.
Zona: `Flujos/experimental/rroca-ruben/` (precedente `chat-novuchat`); se muda después a `Flujos/clientes/`. Este es el **PR-1: el esqueleto**. Sin modelo, sin cobro, sin QR, sin comprobante, sin rescate (PR-2 a PR-4).
Pruebas: `admin/pruebas/tenants/rroca-ruben/armado.test.ts` (armado, huecos byte a byte, saneo) y `flujo.test.ts` (punta a punta con el n8n de mentira).
Armado: `node Flujos/experimental/rroca-ruben/construir.mjs` escribe `rroca-ruben.json` y `rroca-ruben.prueba.json`; con `--verificar` no escribe y sale 1 si difieren o violan una guardia.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Mensajes de WhatsApp: texto, botones, lista, `cta_url`, `cmContactoConBoton` | `Flujos/experimental/comun-sin-agente/src/mensajes.js` (paquete `mensajes`, solo en «Armar mensajes») |
| Cadena de envío: ¿Enviar de verdad?, Enviar a WhatsApp (lote de 1, 1,5 s), respaldo en texto, reporte saliente | `comun-sin-agente/src/envio.mjs`, `injertar()` desde `construir.mjs` |
| Armador (plantilla + código → JSON, `--verificar`) | `comun-sin-agente/construir.mjs` (`leerProyecto`, `armarVariante`) |
| Entrada verificada del receptor (6 nodos: Entrega, verificador interno, ¿Firma válida?, 200, 401, Descartar repetidos) | Los mismos nodos de `venta-minima/flujo.plantilla.json`, sin el carrito del catálogo; `wabaIdEsperado` FIJO (marcador `REEMPLAZAR_*`), sin «Continue on Fail», repetidos descartados entre ejecuciones. `construir.mjs` lo hace cumplir |

Pendiente en PR-2 (se incluirá, no se copiará): `comun-sin-agente/src/filtro-redaccion.js` (paquete `filtro`) para lo que redacte el modelo.

## Común SIN fuente utilizable: copiado de `chat-novuchat` y declarado (HUECOS, a resolver en el módulo común)

Cada hueco tiene su prueba en `armado.test.ts` («HUECOS»): la copia es el origen **más solo las sustituciones declaradas aquí**. Si el origen cambia, la prueba falla y obliga a decidir.

| Pieza en este flujo | Origen | Diferencia con el origen (la única permitida) |
|---|---|---|
| `src/nodos/puerta-del-turno.js` (comercio no operativo, uso extendido, **pausa por persona**: estado `bloqueado` = cero envío y cero modelo) | `chat-novuchat/src/nodos/puerta-del-turno.js` | **Ninguna: byte a byte.** `core/comercio-no-operativo.js` y `core/uso-extendido.js` son del contrato del agente y hay versiones divergentes |
| `src/nodos/resumen-del-turno.js` | `chat-novuchat/src/nodos/resumen-del-turno.js` | Se AGREGA, tras leer los ítems, la verificación de entrega (R3, regla I-ENTREGA): si ni el envío ni su respaldo devolvieron `messages[0].id`, la ejecución termina en ERROR («Entrega fallida»). Es el sumidero que exige `pruebas/core/entregas.test.ts` para `Enviar a WhatsApp` y `Enviar respaldo` |
| `src/nodos/_comun.js` (`cn*`: leer nodos por nombre, atención, ficha por teléfono) | `chat-novuchat/src/nodos/_comun.js` | La clave de la ficha en los datos estáticos (`chatNovuchat` → `rroca`), el título, y se quita el barrido de datos de otros flujos. No hay fuente común: cada flujo tiene la suya |
| `src/nodos/carga-de-entrada.js` (filtro de eventos de Meta) | `chat-novuchat/src/nodos/carga-de-entrada.js` | Se AGREGA la rama del receptor: si corrió «Entrega del receptor», el evento es su `body.value` (y `field` solo `messages`) y el veredicto del verificador nunca se lee como mensaje. `core/normalizar-entrada.js` es del contrato del agente |
| `src/nodos/interpretar-entrada.js` (normalización: text, interactive, button, audio/voz, image, document, location, sticker, contacts y cualquier otro) | `chat-novuchat/src/nodos/interpretar-entrada.js` | Se QUITA el contrato del chat (eventos, rubros) y se AGREGA `categoria` (`conversacion`, `medio`, `otro`); un toque de botón o lista deja su `id` como texto. Clave de conversación: `messages[0].from` |
| `src/nodos/config-del-negocio.js` (consola → configuración) | `chat-novuchat/src/nodos/config-del-negocio.js` | Se QUITAN la oferta (planes y cargos), la planilla y los datos propios del chat. **Idénticos al origen**: la lectura de la respuesta (200 / 409 / otra), el bloque de atención y el del modo prueba. `core/config-del-negocio.js` (403 líneas) es del agente |
| `src/nodos/config-del-negocio.js`, modo prueba: `telefonoPermitido` | el mismo bloque de `chat-novuchat` | **Niega por defecto**: `permitidos.length > 0 && …` (el origen permite todo si la lista está vacía). Sin `telefonosDePrueba`, o con el marcador `REEMPLAZAR_*` sin llenar, ningún teléfono está permitido en el JSON de prueba |
| `RR_NIEGA_IA` en `src/lib/rr.js` (NIEGA_IA, prohibición 4) | `CH_NIEGA_IA` de `chat-novuchat/src/lib/chat.js` | Ninguna en la expresión (idéntica); solo cambia el nombre. Aplicada al texto normalizado en `rrSeguro` |
| Los 6 nodos de la entrada verificada del receptor (Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200), Rechazar (401), Descartar repetidos) en `flujo.plantilla.json` | `venta-minima/flujo.plantilla.json` | **Ninguna** en `parameters`, tipo, credenciales y opciones; solo `notes`, `position` e `id` propios. Prueba en `armado.test.ts` («HUECOS: nodos JSON») |
| Nodos JSON de «Traer configuración», «Config base», «¿Reportar? (entrante)», «Reportar mensaje (entrante)», «¿Meta aceptó?» en `flujo.plantilla.json` | `chat-novuchat/flujo.plantilla.json` | **Ninguna** salvo `notes`, `position` e `id` propios; misma prueba |

Lo del cobro (`cbCobroReal`, `cbResultadoVenta`, `cbRutaGuardada`, `CB_PROHIBIDAS` de `venta-minima/src/lib/cobro.js` y `avPlantilla`, `avTexto`, `avLimpio`, `avDestinatarios` de `avisos.js`) entra en PR-2 y PR-3 como hueco declarado con su prueba byte a byte.

## Propio de Rubén

- `src/lib/rr.js`: el saludo fijo del asistente virtual de Rubén (PR-1), el mínimo ante NIEGA_IA, la ficha por teléfono (ids de Meta, turnos) y su barrido. En PR-2 crecen aquí el catálogo de 4 productos (el precio vive solo en el catálogo de la consola), el total, los estados y los textos fijos.
- `src/nodos/armar-mensajes.js`: un ítem por mensaje, o ninguno; escribe la ficha con la clave `messages[0].from`.
- `flujo.plantilla.json`, `construir.mjs`, y los datos `admin/scripts/datos/rroca-ruben/rroca-ruben.json` (solo marcadores `REEMPLAZAR_*`).

## Condiciones declaradas de PR-1 (no se resuelven aquí)

- **NO se publica ni se activa en un número real hasta el PR-3** («solo se ofrece lo que se cumple»). En estado «operador» el texto de uso extendido promete atención humana sin aviso a recepción, y el saludo fijo no ofrece pasar con recepción. Lo hace cumplir el armador: el JSON de producción lleva `meta.noPublicable` y la guardia de `--verificar` lo exige mientras `AVISO_A_RECEPCION_EXISTE` sea `false` en `construir.mjs`. PR-3 agrega el aviso con botón y cambia esa constante.
- **FALLA ABIERTA DE LA PAUSA, declarada** (decisión de Cartera). `puerta-del-turno.js` es idéntica al origen y no se toca. Si la ingesta y la consola caen en el MISMO turno, no hay estado de atención y la puerta devuelve «normal»: una persona en pausa recibiría el saludo. La prueba «falla abierta, declarada» fija ese comportamiento; PR-3 evaluará volverlo cerrado.
- **Cruce «suspendido antes que bloqueado»**: la puerta evalúa primero el comercio no operativo; una persona en pausa con el comercio suspendido recibiría el texto neutro de comercio suspendido (un mensaje), no el silencio de la pausa.
- **Modo prueba**: niega por defecto (ver la tabla de huecos).

## Mensajes por conversación

**0 agregados** en PR-1: un saludo por turno del cliente, o ninguno (pausa `bloqueado`). El aviso a Rubén (+1 por comprobante o derivación) es PR-3; el rescate de las 22 h (+1 por conversación a medias, 0,0113 USD) es PR-4. Las llamadas al modelo son 0 (no hay modelo).
