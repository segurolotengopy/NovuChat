# comun-sin-agente — piezas comunes para flujos «sin agente»

Flujos en los que **el código calcula y el modelo conversa**: estado por teléfono, botones, mensajes armados por
código, y el modelo solo redacta lo que el código verifica. Sacado de `Flujos/experimental/agenda-minima/`, que
**no se toca** y sigue con sus propias copias. Es experimental: vive fuera de las zonas y de `fronteras.test.ts`.

| Pieza | Qué es |
|---|---|
| `construir.mjs` | Armador genérico: plantilla + código de los nodos → un JSON por variante (producción y prueba), con `--verificar`. Se configura con un `construir.config.json` en la carpeta del flujo. Reproduce, byte por byte, los JSON de Agenda mínima. |
| `src/mensajes.js` | Constructores de lo que sale por WhatsApp: texto, botones, lista, enlace, URL de wa.me y «pasar con una persona» (botón, o solo texto sin mención del botón si no hay a quién). Prefijo `cm`. |
| (`filtro-redaccion.js` ya no vive aquí: es `Flujos/src/core/texto/filtro-redaccion.js`, único origen; los constructores lo piden con `"filtro": ["../../src/core/texto/filtro-redaccion.js"]`, porque su raíz `../..` es `Flujos/`) | Lo que el modelo redacta se **verifica** antes de salir: monto (también en letra), promesas, afirmar un hecho que solo el código puede afirmar (cita, pedido, pago, ✅), negar ser una IA, huecos de plantilla, **enlaces: por defecto ninguno sale**, identidad. Y se **pule**; `cmRevisarRedaccion` pule y valida lo pulido. Las reglas de NovuChat no se apagan con opciones. Normaliza (NFKC, sin invisibles). |
| `src/envio.mjs` | La cadena de envío: nodos y conexiones (¿Enviar de verdad?, envío con lote de 1 y 1,5 s, respaldo en texto, reporte saliente), sin credenciales por id. El `phoneNumberId` y la versión de Graph se validan antes de entrar a la URL, y lo que ni el respaldo pudo enviar no se reporta como enviado. `injertar()` la cuelga de una plantilla. |

## Estado y límites (leer antes de adoptarlo)

- **Experimental y SIN adoptar.** Ningún flujo lo usa todavía. Seguridad lo revisó dos veces (02/10): aprobó con
  observaciones, ningún CRITICAL ni HIGH. Antes de que un flujo en producción adopte `filtro-redaccion.js`, pasa por una
  tercera revisión con su caso real.
- **El filtro es una red de listas, no una garantía.** Un filtro de frases no cubre todas las formas de decir «tu cita
  quedó agendada» o «soy una persona»: cada revisión encontró variantes nuevas y se cerraron una por una. Rechaza de más a
  propósito (el costo es caer en el texto fijo del código). **La barrera de verdad es el diseño:** la confirmación, el total y
  el cobro los arma el código, y el modelo no redacta nunca una confirmación. El filtro es la segunda línea.
- No se ha probado contra Meta ni contra n8n real; solo con el evaluador de pruebas del proyecto.

## Cómo se usa

1. En la carpeta del flujo, un `construir.config.json`:

   ```json
   {
     "plantilla": "flujo.plantilla.json",
     "raiz": "../..",
     "comun": ["src/nodos/comun.js"],
     "paquetes": {
       "mensajes": ["../comun-sin-agente/src/mensajes.js"],
       "filtro": ["../../src/core/texto/filtro-redaccion.js"]
     },
     "variantes": [
       { "archivo": "mi-flujo.v0.json", "quitar": "Entrada de prueba", "nombre": "Mi flujo (v0)" },
       { "archivo": "mi-flujo.prueba.json", "quitar": "WhatsApp Trigger", "nombre": "Mi flujo (v0, prueba)" }
     ]
   }
   ```

2. En la plantilla, cada nodo Code lleva una marca: `"jsCode": "@@comun+mensajes+filtro:nodos/armar.js"`.
   Modos: `todo` (librerías + comunes + paquetes + nodo; `@@nodos/x.js` es lo mismo), `comun` y `solo`.
3. `node Flujos/experimental/comun-sin-agente/construir.mjs --proyecto <carpeta>` escribe los JSON;
   con `--verificar` falla si lo versionado difiere de lo que se arma.
4. La cadena de envío: `injertar(plantilla, { credenciales: { graph, ingesta }, ingestaUrl, siguiente })`
   desde un `.mjs` propio del flujo, antes de armar.

## Lo que NO hace

- **Ninguna lectura fuera de `raiz`** (por la ruta real: un enlace simbólico que sale no se sigue), ni fuera de `Flujos/`; `raiz` es relativa; ninguna ruta con `..`, ningún `.env`, ninguna llamada a la red. Una variante nunca pisa el config ni la plantilla.
- **Ningún identificador**: las credenciales van por nombre y la URL de la ingesta es obligatoria.
- **Nada de agenda ni de un negocio**: ni horarios, ni calendario, ni «lo clínico», ni nombres de personas.
  Eso entra por `opciones` (`prohibidos`, `extra`, `quienPromete`).
- No reemplaza a `Flujos/src/core/` (`uso-extendido`, `comercio-no-operativo`, `config-del-negocio`,
  `normalizar-entrada`): esos son de los flujos con agente y los usa Core. **Quedan fuera** a propósito;
  fusionar las copias con Core es una decisión posterior.

## Pruebas

`admin/pruebas/comun-sin-agente-*.test.ts` (cuatro suites, registradas en `SUITES_PURAS`). Las de Agenda mínima
siguen verdes sin cambios: este módulo las usa solo para comparar, leyendo sus archivos.

## Canal «rele» (relé B9): límites conocidos y aceptados

- **Cupo de descargas del guardado** (`Flujos/src/core/medios/guardado-cupo.js`): 10 medios por teléfono y día, 30 por flujo (decisión de Andres, 03/11/2026).
  Cuenta solo lo que «Preparar guardado» dejaría pasar y anota lo omitido en `cupoDeMedios.omitidos` y `guardadoDeMedios.omitidoPorCupo`, sin mensajes.
  **Limitación de concurrencia:** el estado es el `staticData` del flujo y n8n no da un candado; una RÁFAGA (un álbum son N ejecuciones simultáneas) lo
  atraviesa porque todas leen el mismo conteo. El tope por remitente de verdad lo pone el relé (WAM). Riesgo residual **aceptado por Andres el 03/11/2026**.
- **Reintento de los GET de medios por el relé** (canal rele): los nodos «Pedir el medio a Meta (guardado)» y «Descargar medio (guardado)» llevan `retryOnFail`, `maxTries: 2`
  y `waitBetweenTries: 3000` (n8n no admite espera con azar ahí). 0 nodos nuevos, así que los topes de nodos no cambian. Son GET idempotentes. **Costo:** todo fallo reintentable
  de esos GET (un 5xx, un 502 WM-3040 de id vencido) gasta una descarga más de las 500 por día y por WABA; un 429 no gasta. El nodo no distingue el código: reintenta cualquiera.
  La descarga sigue sin seguir redirecciones.
- **Decisión I4 (Andres, 03/11/2026): incierto o agotado → la ejecución termina en ERROR** (canal rele). La Switch «¿Qué hacer con el envío?» tiene ahora 4 salidas
  (reintentar, respaldo, **detener**, listo) y «incierto» o «agotado» van al nodo Stop and Error «Detener por envío incierto» (**+1 nodo por flujo que use el relé**; contrato
  de nodos: `NODOS_DEL_ENVIO_RELE` lo lleva y «listo» pasó de la salida 2 a la 3). Sin reenvío (el mensaje pudo haber salido, p. ej. 504 WM-3041), sin respaldo, sin
  reporte y sin avisar de nuevo al cliente: 0 mensajes por conversación. El mensaje de error es fijo y solo trae la decisión y el código sanitizado: nunca el teléfono, el
  texto del cliente, la clave ni el cuerpo del relé. Por qué un nodo y no un `throw` en el Code: lanzar en «Leer respuesta del relé» cortaría todo el lote y se perderían
  los respaldos y reintentos de los otros mensajes del turno. En un lote mixto el error corta la ejecución al llegar al nodo, pero «Detener por envío incierto» va debajo de todo en el lienzo
  (`executionOrder: v1` corre de arriba hacia abajo), así que la fila de reporte de los mensajes «ok» del mismo lote SÍ corre antes de la parada (lo prueba la suite).
  Los reintentos y respaldos de la misma tanda tampoco se pierden.
- **«Esperar reintento» espera el MÁXIMO del lote** (`Math.max` de los `esperaS`): si en un mismo turno un mensaje pide 61 s y otro 2 s, el segundo también espera 61 s.
  Es un efecto conocido de usar un solo Wait por lote; el lote de 1 con 1,5 s lo acota en la práctica.
- **Un reintento sale DESPUÉS del mensaje siguiente:** el bucle reintenta tras terminar la vuelta de todos los mensajes, así que el mensaje 1 reintentado puede llegar
  después del 2. No se reordena a propósito (Meta ya entrega fuera de orden en reintentos).
- **Origen ambiguo:** si «¿Enviar de verdad?» corriera más de una vez en la ejecución, «Leer respuesta del relé» declara `incierto` (`ORIGEN-AMBIGUO`) en lugar de
  emparejar con el mensaje de otro origen (`hallazgosDelEnvioRele` lo exige).
- **Pendiente de decisión de Andres (I4):** que `incierto` y `agotado` terminen la ejecución en ERROR (hoy terminan en silencio, sin reporte). No se implementa.

## Estado de la conversación en el servidor (PR-4a0): el paquete `sesion`

Los ayudantes con que un nodo Code arma el pedido `sesion` (`leer`, `comprometer`) y lee la respuesta de `configuracionFlujo` (contrato: `docs/arquitectura/estado-de-conversacion.md`) son un módulo COMÚN, no del chat: `src/sesion.js` (prefijo **`ss`**, «sesión»: no se confunde con el `cn` de las utilidades de nodo de cada flujo ni con el prefijo propio de cada flujo) y su doble de pruebas `herramientas/servidor-de-sesion.mjs` (+ `.d.mts`), comparado con el núcleo real `core/turno/sesion.ts` por `admin/pruebas/comun-sin-agente-sesion.test.ts`.

**Cómo se incluye.** Como cualquier paquete de este armador: se declara en el `construir.config.json` del flujo (en el chat, `paquetes.sesion` en `CONFIG_BASE` de su `construir.mjs`) y cada nodo que lo usa lo pide en su marca (`@@todo+sesion:...`, `@@comun+sesion:...`). Se pega TAL CUAL; el chat tiene una guardia en `construir.mjs` (con su prueba negando) que rechaza una copia, una edición o un nodo que usa `ss*` sin el módulo. Depende de `cnNodo`/`cnPrimero` del código común del flujo.

**Parámetros.** El flujo declara UNA constante `SS_CONFIG` en su código común: `espacio` y `espacioPrueba` (la variante de prueba nunca toca los documentos de producción y solo atiende a `telefonosDePrueba`), `venceMin` (vida del estado), `maxBytes` (tope del estado en bytes UTF-8), `prefijo` (del `idCompromiso`) y `nodoCarga`/`nodoBase` (los nodos que dicen si es prueba y traen el número esperado). El chat pasa `chat-novuchat`/`chat-novuchat-prueba`, 2880 min, 15000 bytes y `chat`; Q'Taco (PR-4a) pasará `venta-minima`/`venta-minima-prueba`. El servidor de mentira acepta `espacios` para restringir los espacios de un flujo. Lo propio de cada flujo (en el chat, `cnRegistro` y los nombres de sus nodos, `src/nodos/_registro.js`) NO está aquí.

Costo: 0 mensajes por conversación (el chat regenera sus JSON con las mismas funciones renombradas; el módulo no manda nada).

## Costo

Cero mensajes por conversación agregados o quitados: no hay ningún flujo desplegado. Una cadena de envío con lote
de 1 y 1,5 s por mensaje añade 1,5 s de espera por mensaje adicional del mismo turno, igual que Agenda mínima.
