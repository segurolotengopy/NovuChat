# Flujo de cliente: chat NovuChat (`Flujos/clientes/novuchat/`)

Condición 4 del cierre de la rearquitectura (17/10/2026) y regla de zonas de `CLAUDE.md`
(«Flujo de cliente»): **flujo propio = piezas propias + núcleo común obligatorio**. Lo propio se
declara aquí; el núcleo se **incluye** desde core y módulos y **nunca se copia**.

Este archivo es el **mapa de la mudanza**, no la mudanza. Hoy el flujo vivo se construye y se
publica desde `Flujos/experimental/chat-novuchat/` (`construir.mjs`, `flujo.plantilla.json`,
`src/`, los dos JSON). Su `PROPIO.md` detallado (nodo por nodo) sigue siendo la referencia mientras
no se mueva el código.

## Núcleo común obligatorio y de dónde sale

| Pieza del núcleo | Fuente | Estado hoy en el chat |
|---|---|---|
| Entrada verificada (filtro de eventos de Meta; sesión por `messages[0].from`) | `Flujos/src/core/` (`normalizar-entrada.js` y compañeros) | **Copia adaptada** en `src/nodos/carga-de-entrada.js` e `interpretar-entrada.js` (hueco declarado: el contrato del core es el del agente) |
| Normalización de entrada (`text`, `interactive`, `order`, `image`, audio, documento) | `core/normalizar-entrada.js`, `core/medios/*` | Copia adaptada (mismo hueco) |
| Comercio no operativo y uso extendido (puerta del turno) | `core/comercio-no-operativo.js`, `core/uso-extendido.js` | Copia adaptada en `src/nodos/puerta-del-turno.js` (hueco) |
| Config del negocio | `core/config-del-negocio.js` | Copia reducida en `src/nodos/config-del-negocio.js` (hueco) |
| Mensajes de WhatsApp, botón de contacto, filtro de promesas sin respaldo, cadena de envío y rótulos | `Flujos/experimental/comun-sin-agente/src/*` | **Incluido** desde su fuente (byte a byte, lo prueba `chat-novuchat-lib.test.ts`) |
| Miniatura de hoja de prospectos (miniCRM) | módulo `crm` (`Flujos/src/modulos/crm/`) y adaptador `Flujos/src/modulos/captacion/crm-captacion.js` | **Incluido** |
| `NIEGA_IA`, aviso con botón a recepción, candado de promesas | `Flujos/src/core/texto/filtro-redaccion.js`, `mensajes.js` | Incluido |
| Estado de la conversación y mensajes vistos en el servidor (`sesion`) | `docs/arquitectura/estado-de-conversacion.md` | **No adoptado** (ver «Camino de PR-4c») |

Los «huecos» son la deuda de la condición 2 (una sola variante de cada nodo común), que cierra la
lista cerrada declarada en `Flujos/src/core/VARIANTES.md`, no este archivo.

## Propio de NovuChat (no sube al core)

Es todo lo que `Flujos/experimental/chat-novuchat/PROPIO.md` llama «Propio de NovuChat»:

- el cerebro conversacional (historial y ficha por teléfono, coalescencia de clics: `Registrar evento`,
  `Esperar ráfaga`, `Armar turno`), el contexto y la validación del mensaje del modelo, las rutas
  deterministas (planes, equipo, consumo, tope, banco, integración, costos de Meta, descuento, lista)
  y los botones de cada turno;
- la puerta de la entrega `¿Meta aceptó?` y `Confirmar envío` (restaura la ficha si Meta rechaza);
- la calificación por hechos y el mapa de columnas de la hoja (dato del tenant, clave `crm`);
- el sitio web anexado en rutas específicas;
- la biblioteca `src/lib/chat.js` (prefijo `ch`) y sus datos: `admin/scripts/datos/chat-novuchat/novuchat.json`
  (instrucciones, rubros, cierres, respaldos, textos, precios y `modelo`). **Los datos del tenant nunca
  son código**: ningún texto de NovuChat entra en core.

## Camino de la mudanza (sin cambiar lo publicado)

1. **Ahora (este PR):** solo este archivo. Nada se mueve ni se borra en `Flujos/experimental/chat-novuchat/`;
   el JSON publicado no cambia, y `estado-de-versiones.sh` sigue comparando contra
   `chat-novuchat.novuchat.json`.
2. **Mudar** (PR propio, tras fusionar las variantes únicas de los nodos comunes): `git mv` de
   `construir.mjs`, `flujo.plantilla.json`, `src/`, `herramientas/` y los dos JSON a esta carpeta, con las rutas
   de `construir.mjs`, de `publicar-flujo.sh` y de `chat-novuchat-*.test.ts` actualizadas **en el mismo
   PR**. Prueba de aceptación: `construir.mjs --verificar` reproduce los dos JSON **byte a byte** (si un solo
   byte cambia, no es una mudanza). Después, el JSON se reaplica con `publicar-flujo.sh` solo si la huella
   de `parameters` cambió, que no debe ocurrir.
3. **Quitar las copias** de los huecos a medida que el core ofrezca una variante única utilizable por un flujo
   sin agente, siempre con la suite del chat sin quitar un caso y 0 mensajes por conversación agregados.
4. **`Flujos/experimental/chat-novuchat/`** desaparece al terminar el paso 2; hasta entonces es la única
   copia y es la que se publica.

## Camino de PR-4c (estado y vistos al servidor)

Construido (PR-4c1: servidor falso y ayudantes; PR-4c2: nodos y plantilla; sin publicar). La ficha entera es el bloque opaco `estadoJson` (espacio `chat-novuchat`), la cola (≤6) va dentro del estado
versionado, `comprometer` va ANTES de enviar y la compensación está en «Confirmar envío». Detalle y decisiones: `Flujos/experimental/chat-novuchat/DISENO.md`, sección «El estado de la conversación vive en el servidor».
Pendiente: ensayo en el Demo A, reseteo de fichas por `comprometer` y `chatNovuchatCrm`.

## Mensajes por conversación

0 agregados y 0 quitados por este archivo (documentación).
