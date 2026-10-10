# Chat NovuChat v2 (Kenji): diseño

Chat de captación de NovuChat rehecho desde cero (09/10/2026) tras la prueba de Silvana del 07/10: un «Y?» recibía «¡Te entiendo! 😊», el botón
«Hablar con el equipo» no salía, «Leads de Ventas» no se entendía. **El modelo es el cerebro; el código decide solo lo que se puede decidir**
(botones, costos, consumo, banco, integraciones, traspaso, hoja) y valida todo lo que el modelo escribe. Sin agente ni memoria de n8n: el historial
por teléfono lo guarda y lo pasa este mismo flujo, explícito, en cada llamada. Fuentes únicas: `fuentes/system-prompt-comercial-2026-10-09.md` y
`fuentes/opciones-de-conversaciones-novuchat.pdf`. **Experimental**: no se publica sin el «sí» de Andres.

| Archivo | Qué es |
|---|---|
| `flujo.plantilla.json` | El flujo sin código ni datos (`@@…` en cada Code, `@@cred:…`, `@@dato:…`). Es lo que se edita |
| `src/lib/chat.js` | Biblioteca pura (prefijo `ch`, ~1.650 líneas). Primera parte: copia adaptada de Captación mínima (detectores, extracción de nombre y empresa, filtros del modelo, aviso); el resto es nuevo |
| `src/nodos/*.js` | Un archivo por nodo Code. Qué es común y qué propio: `PROPIO.md` |
| `construir.mjs` | Arma los dos JSON con `../comun-sin-agente/construir.mjs`, valida los datos, inyecta `@@datos` y aplica las guardias. `--verificar` no escribe; un argumento desconocido sale con 2 sin escribir |
| `chat-novuchat.novuchat.json` / `.prueba.json` | Producción (con «WhatsApp Trigger») y prueba (con «Entrada de prueba»), 44 nodos cada uno |
| `admin/scripts/datos/chat-novuchat/{novuchat,ensayo}.json` | LA fuente de datos: instrucciones del documento, 7 rubros con puntos clave, cierres exactos, respaldos, textos, precios (frases) y `modelo` |
| `herramientas/bateria.mjs`, `bateria-casos.json` | Batería contra el modelo (`--seco` o `--vertex`/`--env`), 53 casos |

## El grafo (44 nodos)

```
WhatsApp Trigger | Entrada de prueba → Config base → Carga de entrada (filtra eventos) → Traer configuración → Config del negocio
  → Interpretar entrada → ¿Reportar? → Reportar mensaje (entrante) → Puerta del turno (suspendido / uso extendido / sigue)
  → ¿Bajar medio? → [Obtener URL → ¿Tamaño? → Descargar → ¿Audio? → Transcribir | ¿Documento? → Describir documento | Describir imagen]
  → Registrar evento → Esperar ráfaga (Wait 2,5 s) → Armar turno → ¿Llamar al modelo? → Llamar al modelo → Validar respuesta
  → ¿Reintentar? → Reintentar el modelo → Armar mensajes ─┬→ ¿Enviar de verdad? → Enviar a WhatsApp → ¿Falló el envío? → Enviar respaldo → ¿Reportar? (saliente) → ¿Meta aceptó? → Reportar mensaje (saliente)   [cadena COMÚN; «¿Meta aceptó?» es la puerta PROPIA]
                                                          ├→ Prospecto para la planilla → Buscar teléfono → Leer IDs → Decidir fila → ¿Agregar? → Agregar fila | ¿Actualizar? → Actualizar fila
                                                          ├→ Confirmar envío (propio: ficha)
                                                          └→ Resumen del turno
```

`PROPIO.md` declara qué se incluye de lo común (con su ruta) y qué es propio. Con `executionOrder: v1`, cada rama termina antes de la siguiente, de arriba abajo: el entrante se reporta ARRIBA de lo que responde; «Confirmar envío» va
debajo de los envíos y la hoja. No hay ciclos: ningún nodo lee por nombre algo que corra más de una vez.

## Contratos

- **Evento** `{k, t, c, rubro, boton}`: `t` es lo que lee el modelo (`[Eligió el rubro: Salud]`, `[Nota de voz] …`, `[Envió solo emojis o signos: 👽]`); `c`, lo que el cliente escribió o dijo
  (sobre `c` corren los detectores). Un texto del cliente nunca trae corchetes (no puede fingir un evento del sistema) ni los delimitadores `<<<` `>>>`.
- **Ficha** (`staticData.global.chatNovuchat[tel]`, ~30 campos, saneada campo por campo): `rubro`, `nombre`, `empresa`, `necesidad`, `temas`, `hechos`
  (`pidioEquipo`, `pidioPlanes`, `eligioOtro`, `interactuo`, `descarte`), `avisado`, `planesMostrados`, `soporte`, `anuncio`, `seq`, `hasta`, `cola` (eventos sin responder, ≤6),
  `historial` (últimas 8 entradas, ≤300 caracteres) y `ultimosIds` (5). Ventana de 24 h (vencen aviso, planes y soporte), olvido a las 48 h. Sin contadores de rotación.
  Escriben: «Registrar evento» (el evento), «Armar mensajes» (todo lo demás) y «Confirmar envío» (`avisado`; y restaura `fichaAntes`, con la cola, si Meta rechaza el envío).
- **Plan** (`chDecidir`): `ruta` = `lista` | `planes` | `equipo` | `fijo` | `modelo` (+ `suspendido`/`uso_extendido` de la puerta), más `contexto` del modelo (`rubro`, `multiple`, `otro`,
  `otroRespuesta`, `abierta`, `datos`, `identidad`, `cortesia`, `fuera`, `ambiguo`, `medio`, `general`), `hechos`, `temas`, `aMedida`.
- **Salida del modelo** (una llamada por turno, `responseSchema`): `mensaje`, `accion` (ninguna | mostrar_planes | derivar_equipo), `rubro` (enum de los 7 ids), `necesidad`, `nombre`, `empresa`,
  `descarte` (enum cerrado). El modelo es un parámetro de los datos (`modelo`, `gemini-3.5-flash-lite`): se cambia sin tocar código.

## Qué decide el código y qué el modelo

- **Código, sin modelo**: toque «Ver planes» (imagen de la consola + precios con las cifras de la consola + cierre de D2), toque «Hablar con el equipo» (enlace a recepción, pide nombre y negocio,
  plantilla de aviso UNA vez por ventana, fila en la hoja), pedido de una persona o de una llamada, soporte, costos de Meta, tope de un plan (imagen), consumo (sin dígitos), banco, integración con un
  sistema que no es WhatsApp/Meta/Google Calendar/Google Sheets/QR, descuento, y la lista de rubros al primer saludo. Desde recepción el botón responde «Ya estás en contacto con el equipo».
- **Modelo («Catch All»)**: todo lo demás: clics múltiples, emojis, «Y?», «?», «Quiero más información» (pitch del §8), fuera de contexto, rubro mezclado, «Otro», preguntas sueltas.
- **Validación** (`chValidarMensaje`, en «Validar respuesta» y «Armar mensajes»): contenido mínimo (25 palabras), cierre con pregunta o invitación, identidad, promesas y nombres de personas,
  ofertas, cifras (solo 24/7, 24 horas y, hablando de precios, 65/125/25 de la consola), sistemas ajenos, validar pagos con el banco, hechos que solo afirma el código, acciones que solo hacen los botones,
  pitch (4 viñetas) y puntos clave del rubro. UN reintento con la causa (lista cerrada); después, el respaldo del contexto (explicación del dato, pitch, fallback del §7): nunca una muletilla.
  Una `accion` del modelo solo se ejecuta si el código la confirma con las palabras del cliente. Un rubro estándar cierra con la pregunta EXACTA (el código la pone si falta).

## Ajustes del 09/10 tras la prueba real de Andres (R1 a R6)

- **R1 no inventar funciones**: en un rubro que no es gastronomía, retail ni «otro» (ni en el pitch ni en la empresa), lo que escribe el modelo no puede traer adelanto, anticipo, seña, pago total, cobro ni QR (causa `funcion_inventada`): un reintento con la causa y, si insiste, el respaldo «eso lo evalúa alguien de nuestro equipo».
- **R2 contexto `empresa`**: «Dame más info sobre la empresa», «¿quiénes son?», «¿qué hacen?», «¿qué es NovuChat?» se contestan con los hechos verificados del dato `empresa` (`hechos`, `puntosClave`); una evasión no pasa (`puntos`).
- **R3 nombre del perfil** (`chNombreDelPerfil`): acepta iniciales, puntos, guiones, apóstrofos y tildes; rechaza fórmulas, enlaces, teléfonos, dígitos, `@`, controles, invisibles y órdenes. Los emojis se quitan.
- **R4 pedir el nombre y el negocio, una vez** (`explicado`, `nombrePedido`, `planesPendientes`, `preguntaDatos`): en la primera respuesta del cliente a la explicación, en el MISMO mensaje; si esa respuesta es «Ver planes», se pide ANTES de mostrarlos y el siguiente mensaje los muestra (+1 mensaje en ese camino).
- **R5 botones según lo hecho**: lista → [Ver planes][Hablar con el equipo] → [Hablar con el equipo] (planes vistos) → enlace → la LISTA de rubros con «Si tienes otro negocio…» (nunca un callejón). Un rubro elegido tras el traspaso abre otro ciclo: la hoja conserva C, D y F del primer negocio (`primero`) y agrega «Otro negocio: <empresa> (<rubro>)» al resumen J; una empresa distinta manda otro aviso (`empresaAvisada`), la misma solo el botón.
- **R6 no calcar**: planes ya mostrados → `complementoPlanes` (hechos de la imagen y del documento, sin imagen ni cifras de consumo; después, «ya te compartí…»); un mensaje del modelo con similitud de palabras >= 0,75 con el anterior se rechaza (`repite`) y sale un respaldo distinto. El prompt pide «aporta algo nuevo y verificado», no «no repitas».

## Costo por conversación (base comercial §1)

**Un mensaje por turno del cliente** (más la plantilla a recepción, una vez por ventana de 24 h, cuando pide al equipo; **+1 plantilla** si en un segundo traspaso la empresa es distinta; **+1 mensaje** solo en el camino «Ver planes» como primera respuesta, que pide el nombre antes de los planes). Respecto de Captación mínima: 0 mensajes agregados; la ráfaga de clics
baja de N respuestas a UNA. **Llamadas al modelo: 0 o 1 por turno** (2 si una guardia rechaza el mensaje): en el caso medio, lista (0) + rubro (1) + «Y?» (1) + planes (0) + equipo (0) + datos (1).

## Riesgos y lo que no se hizo

- **Coalescencia y concurrencia: RIESGO CONOCIDO, aceptado por Andres; a verificar con un teléfono real (tres toques en menos de 2 s en el Demo A).** Lo más probable es que n8n dé a cada ejecución una COPIA de
  los datos estáticos y grabe el mapa ENTERO al terminar: gana el último que graba y pisa a TODOS los teléfonos, no solo al suyo. Alcance real: (1) tres toques seguidos reciben tres respuestas (la espera de 2,5 s
  no une nada; se deja porque no daña y sí une si los datos se comparten, a costa de 2,5 s de latencia); (2) se pierden el historial y los `ultimosIds` de OTRO teléfono que escribió a la vez, así que una reentrega
  de Meta puede responderse dos veces; (3) un `avisado` perdido puede duplicar la plantilla a recepción (cuesta dinero); (4) dos toques rápidos en «Hablar con el equipo» pueden enviar dos plantillas.
  El diseño NO empeora con la copia desfasada (prueba «copia desfasada»): cada ejecución arma el turno con SU evento, responde una vez y con contenido (nunca vacío ni repetido), y sobre el mapa final pisado el turno
  siguiente responde bien. Se resuelve más adelante con un almacén compartido (Data Table de n8n o una función de la consola): solo cambian «Registrar evento» y «Armar turno». Además, las esperas de 2,5 s ocupan
  una ejecución cada una: hay que confirmar el límite de concurrencia de n8n (L4 de la revisión de seguridad) antes de tener muchos chats a la vez.
- **Peso de los datos estáticos**: n8n graba TODAS las fichas en cada ejecución. Topes: 300 fichas, historial 8 × 300 caracteres, cola 6 eventos de ≤600: la peor ficha pesa ~7 KB y el peor caso ~2 MB serializados (no ~25 MB); el barrido de 48 h lo acota más.
- **Trato**: se lee `voz.tratamiento` de la consola («usted» cambia lo que se le pide al modelo), pero los textos fijos del dato están en tú.
- No hay campañas, rubro libre, CRM real, imágenes salientes (salvo la de planes), trato de usted en textos fijos ni miniCRM/Kanban (D4: «panel de control»).
- Pasarlo a producción: `scripts/preparar-import.sh Flujos/experimental/chat-novuchat/chat-novuchat.novuchat.json .env.<cliente>` y `publicar-flujo.sh` (el nombre del flujo es el del vivo).
