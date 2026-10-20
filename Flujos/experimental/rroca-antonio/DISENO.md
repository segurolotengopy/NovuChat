# El Puente de Antonio (tenant `rroca-antonio`): diseño y avance

Plan completo: `ANTONIO_plan-y-guion-vs-flujo_2026-10-20.md` (§0 a §5 y §7), en `~/CLAUDE_DESCARGAS/`. Este archivo guarda lo que ya se verificó en el código y lo que cada PR agrega.
Zona: `Flujos/experimental/rroca-antonio/` (Flujo de cliente, fuera de `fronteras.test.ts` como `chat-novuchat`). Armador: `../comun-sin-agente/construir.mjs`, importado, nunca copiado.
Base: `origin/main` `d260cca8`. Sin teléfonos completos ni datos bancarios en este archivo.

## Estado por PR

| PR | Contenido | Estado |
|---|---|---|
| Paso 0 | Verificaciones de lectura (abajo) | Hecho |
| PR-A | Esqueleto: receptor (6 nodos), núcleo (8), medios comunes incluidos (12), decisión mínima, armado, cadena de envío común, resumen con verificación de entrega. Huecos declarados en `PROPIO.md`. Pruebas en `admin/pruebas/tenants/rroca-antonio/` | Este PR |
| PR-B | Conversación, catálogo, QR, comprobante, avisos, derivación y violencia | Pendiente |
| PR-C | Datos del negocio, guardia de publicación, contrato del rescate, documentación | Pendiente |

**PR-A no es publicable**: el JSON lleva `meta.noPublicable` y la guardia de `construir.mjs --verificar` EXIGE esa marca. No hay conversación todavía: un texto o un toque no recibe respuesta; solo la puerta cerrada (comercio suspendido, uso extendido, pausa) y lo que el canal no lee (sticker, ubicación, contacto, pedido) tienen respuesta. PR-B quita la marca y la guardia pasa a exigir lo contrario.

## Paso 0: lo verificado en el código (20/10/2026)

### (a) «Tomar» / salida de persona: solo texto, y un `phoneNumberId` por instancia

- **Solo envía TEXTO.** `enviarComoPersona` (`admin/functions/src/core/conversacion/enviarComoPersona.ts`) recibe `{tenantId, conversacionId, texto, claveIdempotencia}`, valida un texto de 1 a 1.000 caracteres y escribe el mensaje saliente con `tipo: 'text'`. El flujo común que lo envía arma el cuerpo con `type: 'text'` y `text: { body }` (`Flujos/src/core/salida-persona/planificar-lote.js`; rechaza texto vacío o de más de 1.000 con `NV-TEXTO`). No hay ningún camino para imagen, documento ni PDF. **Consecuencia para Antonio:** no puede adjuntar un PDF desde la consola; solo pegar enlaces como texto (pregunta P6 del plan). Dentro de la ventana de 24 h de Meta, con tope por conversación, minuto y día.
- **`Flujos/salida-de-persona.json` es por número, no multilínea.** `Config base` trae un solo `phoneNumberId` (`REEMPLAZAR_PHONE_NUMBER_ID`), y `Validar toque` falla visible si falta o descarta un timbre cuyo `X-NovuChat-Numero` sea de otro número. La documentación (`Flujos/LEEME-flujos.md` §9) lo dice: «se instala por número con la misma plantilla (cambian `phoneNumberId`, el relé, las credenciales y la ruta del timbre)». `enviarComoPersona` elige la ruta por el `phoneNumberId` que la conversación guardó, que debe estar activa en `rutasWhatsApp` y tener alias secreto; si no, rechaza con mensaje fijo y nunca cae a otra línea. **Conclusión:** sirve para la línea de Antonio, pero hace falta SU instancia (una más de la misma plantilla, con su alias, su ruta de timbre y sus credenciales) y la ruta de su número activa. Sin ellas, «Tomar» no puede enviar. La publicación por número es «un bloque aparte» (H2-F2) y no se hace aquí. Además, el flujo del propio Antonio **no necesita** esa instancia para responder: son dos flujos distintos por el mismo número.
- Pendiente de verificar en n8n real (declarado en `LEEME-flujos.md`): el emparejamiento a través del `Merge` de «Juntar salidas».

### (b) `entregas.test.ts` y las pruebas que recorren `experimental/*`

- **`pruebas/core/entregas.test.ts` SÍ recorre `Flujos/experimental/<carpeta>/*.json`** (descubre los JSON, sin los `.local`, `.plantilla` ni `.prueba`; los `*.prueba.json` se comparan aparte con su familia). Exige sumidero de entrega en `Enviar a WhatsApp` y en `Enviar respaldo`: un Code alcanzable que lance error si ni el envío ni el respaldo devolvieron `messages[0].id`. Este flujo lo cumple con `Resumen del turno` (lee `Enviar a WhatsApp` y `Enviar respaldo` y lanza «Entrega fallida»). Además, `¿Meta aceptó?` (regla I-ENTREGA 3) lee el id antes de `Reportar mensaje (saliente)`.
- Otras suites que recorren `experimental/`: `pruebas/core/higiene-flujos.test.ts` (ningún JSON con el id de la app ajena, webhooks y entradas), `pruebas/core/credenciales-venta.test.ts` (solo el JSON de Q'Taco, por nombre), `pruebas/core/conversacion-normalizacion.test.ts` (no lee flujos; usa el flag de Node), más las propias de cada flujo experimental. `capacidades-comunes.test.ts` **no** ve este flujo (busca `whatsAppTrigger` + agente en `Flujos/*.json`): lo cubre `medios.test.ts`. `fronteras.test.ts` no mira `experimental/` pero sí `Flujos/src/`, `admin/scripts/datos/` y `admin/pruebas/`.
- Corridas de este PR: ver el reporte de la sesión (`entregas`, `flujos-umbrales`, `fronteras`, `higiene-flujos` y `credenciales-venta` en verde con el flujo agregado).

### (c) Cotejo del comprobante de la venta: QR de monto abierto y PDF

(`admin/functions/src/modulos/cobros/cotejoVenta.ts`, `cobroVenta.ts`, `comprobantes.ts`)

- **QR de monto abierto.** El servidor coteja contra el monto que el FLUJO le reportó al enviar el QR: el evento `qr_enviado` con `reglaCobro: 2` y `monto` (el del catálogo) abre `solicitud` con ese total y la guarda de 15 minutos. `cotejarComprobanteVenta` toma `esperado = solicitud.monto` (o el total del pedido `cat_…`) y jamás coteja contra cero (`sin_total`, 409). Compara contra ese monto lo que el cliente digitó (lo que leyó el comprobante), el nombre de la cuenta y las cuentas de `cobroReal`, y que el comprobante sea posterior al envío del QR. Para un QR sin monto, el monto que cuenta es el catálogo; **si el cliente digita menos, o bastante más, el servidor responde `reintentar` (`monto_menor` / `monto_mayor`); si digita un poco más, dentro del margen que Andres aceptó, responde `aproximado` (`monto_distinto`); el flujo traduce el estado y el motivo a una frase fija**, sin repetir el monto leído salvo cuando es distinto del pedido. Lo que el flujo debe reportar bien es el `monto` del `qr_enviado`.
- **PDF.** El servidor NO distingue imagen de PDF en el cotejo: recibe `legible` y `leido` ya extraídos por el flujo. La lectura del PDF es del flujo (nodo Gemini `document`, como `Leer comprobante (PDF)` de otros flujos). Para guardar el archivo, `comprobantes.ts` acepta jpg, png, webp **y pdf** (por los bytes `%PDF-`, tope 10 MB; la imagen, 5 MB). **Hallazgo:** el filtro de tamaño de los módulos comunes de medios del flujo (`¿Tamaño aceptable?`) corta en 5 MB, así que un PDF de comprobante entre 5 y 10 MB se rechaza en el flujo aunque el servidor lo aceptaría. Es lo que dicen los módulos comunes (sin tocar Core); un comprobante bancario pesa muy por debajo de eso.
- Un comprobante inválido NO crea cierre; el tercero pasa a `en_revision`; uno tardío (hasta 24 h) no cierra la venta. Mensajes al cliente: nunca «acreditado», «verificado» ni «recibimos tu pago»; el flujo dice que el comprobante llegó y que Antonio revisa.

## Decisiones de diseño de PR-A

- **Qué se incluye (no se copia):** `construir.mjs` y `injertar()` (cadena de envío) de `comun-sin-agente`; `mensajes.js` (paquete `mensajes`, solo en «Armar mensajes»); los tres módulos de `Flujos/src/core/medios/` (paquetes `m-transcripcion`, `m-imagen`, `m-no-aceptado`, leídos por el armador genérico dentro de la raíz `Flujos/`; el JSON los lleva idénticos byte a byte, `medios.test.ts`). `filtro-redaccion.js` queda declarado en el config pero **aún no se incluye en ningún nodo**: PR-B lo agrega a «Armar mensajes» junto con el modelo.
- **Qué se declara como hueco** (sin módulo común utilizable; copia de `chat-novuchat` o `venta-minima`, no de `rroca-ruben`): ver `PROPIO.md`. Opción (a) de la decisión D1 del plan.
- **Nombres de nodo del contrato con los medios comunes:** `Normalizar entrada`, `Obtener URL del medio (general)`, `Config del negocio`. `Normalizar entrada` emite `esMedioAudio`, `esMedioVisual`, `esDocumento`, `mediaId` y `mimeType`.
- **Medios: 12 nodos, no 9.** El plan contó 9; con la rama del PDF (`¿Es un documento?`, `Describir documento`) y `Medio no aceptado` salen 12. Producción tiene hoy 36 nodos; quedan 12 para PR-B (comprobante ~7, avisos 3 y lo que falte) bajo el tope de 48. Si no alcanza: fusionar `¿Es comprobante?` con `¿Bajar medio?` (el plan), no subir el tope.
- **`Describir imagen` y `Describir documento`** llevan un prompt propio con la lista cerrada `publicidad | comprobante | otro`. Hueco H-IMG: los textos de `publicidad` y de `comprobante` sin cobro del módulo común dicen «ofrécele agendar» / «ofrécele pasarlo al negocio»; **«Decidir turno» no los usa** (PR-B decide por `categoriaMedio`), y la solución de fondo (parametrizar por tipo de negocio) toca Core y regenera todos los flujos: ticket aparte.
- **Modo prueba que niega por defecto:** sin `telefonosDePrueba` (o con el marcador) ningún teléfono está permitido.
- **Retención de ejecuciones:** `saveDataErrorExecution: all` guarda los textos y datos del turno fallido hasta ~14 días. Se acepta para Antonio igual que para Rubén; **hay que registrar esa aceptación** al publicar (PR-C).
- **Mensajes por conversación: 0 agregados.** Un mensaje por turno, o ninguno. El rescate (+1 por conversación sin compra) y el aviso a Antonio (otro destinatario) llegan con PR-B y PR-C.

## Límites de PR-A (declarados, no resueltos aquí)

- Solo se lee `messages[0]` de cada entrega (límite heredado).
- «Uso extendido» en estado `operador` pide avisar a recepción (`transferir`): sin avisos (PR-B) no sale ese aviso; el cliente sí recibe el texto fijo.
- Sin NIEGA_IA sobre la salida: todo lo que sale en PR-A es texto fijo; la barrera sobre texto del modelo (y el filtro común) entra con PR-B.
- La falla abierta de la pausa (si la ingesta y la consola caen en el mismo turno, la puerta devuelve «normal») es la de `chat-novuchat`, idéntica en la puerta copiada: a decidir con Cartera antes de publicar.
