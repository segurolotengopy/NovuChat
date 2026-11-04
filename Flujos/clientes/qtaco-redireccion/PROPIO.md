# Redirección de Q'Taco (número anterior) — `Flujos/clientes/qtaco-redireccion/`

Flujo MÍNIMO para la línea anterior de Q'Taco mientras exista: ante cualquier mensaje de un cliente responde una vez por
ventana de 24 h con el aviso del número nuevo. Sin IA, sin medios, sin pedidos, sin relé (sigue con su token actual).

- **Construcción:** `node construir.mjs` (escribe) y `node construir.mjs --verificar` (sale 1 si algo difiere). Los JSON son salida; no se editan a mano.
- **Datos:** `admin/scripts/datos/qtaco-redireccion/`. `qtaco.json` es el plan A: mismo nombre de workflow, misma ruta y mismos marcadores que
  el flujo vivo de Q'Taco; `publicar-flujo.sh` lo actualiza en su lugar y conserva el `webhookId` y las credenciales por nombre de nodo.
  `qtaco-ruta-nueva.json` es el plan B: otro nombre y `REEMPLAZAR_RUTA_RECEPTOR_QTACO_REDIRECCION`, que exige su fila en la tabla local.
- **Config del negocio** (nodo Set): `textoAviso` (con `[NUMERO]` y `[ENLACE]`), `numeroNuevo`, `ventanaHoras`, `phoneNumberIdEsperado`, `waGraphVersion`.
- **Nodos (11):** Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200), Rechazar (401), Descartar repetidos,
  Config del negocio, Decidir aviso, ¿Avisar?, Enviar aviso, Marcar avisado.
- **Entrada verificada:** verificador interno con `wabaIdEsperado` fijo, sin «Continue on Fail» (un 503 del verificador no da 200 ni 401: la ejecución
  falla y el receptor reintenta), 200 antes de todo lo demás, repetidos por `deliveryId`.
- **Una vez por ventana:** `Marcar avisado` guarda el teléfono en los datos estáticos solo si Meta devolvió un id; si no, ese cliente no queda
  marcado, los demás sí, y la ejecución termina en error.
- **No responde a:** acuses de estado, campos que no son `messages`, otra línea de la misma WABA, el eco del propio número, mensajes de sistema ni reacciones.

## Costo en mensajes

**≥ 1 mensaje de servicio (dentro de 24 h) por conversación de un cliente que escribe al número anterior; puede ser 2 con mensajes simultáneos.**
Por qué no se evita: se probó marcar «en curso» en `Decidir aviso` y confirmar o deshacer en `Marcar avisado`, pero n8n guarda los datos
estáticos al terminar cada ejecución, así que dos ejecuciones simultáneas del mismo cliente no se ven entre sí y la marca no las separa. Cerrarlo
exigiría un almacén compartido (otro nodo y otro servicio), fuera del tope de 12 nodos. 0 mensajes en todo lo demás.

## Retención de ejecuciones

`saveDataErrorExecution: all` (las fallas se guardan para diagnosticar un aviso que no salió) y `saveDataSuccessExecution: none`. El cuerpo guardado es
el del evento de WhatsApp (teléfono y texto del cliente) y la cabecera de firma del receptor; no hay tokens: la credencial de Graph se resuelve por nombre
y no viaja en los datos de la ejecución. Una ejecución con error conserva por eso datos de clientes: se vacían con la retención normal de n8n.

## Excepciones al núcleo común (aprobación de Andres PENDIENTE)

Por ser un flujo mínimo que no atiende conversaciones, omite piezas del núcleo común: el **conteo de salientes** (no hay `Reportar mensaje (saliente)`:
el aviso no suma a la cuenta de conversaciones) y **comercio no operativo / uso extendido**. Meter el reporte saliente costaría ≥ 2 nodos
(`¿Reportar?` y el HTTP a la ingesta), con lo que el flujo pasaría de 11 a 13 y del tope de 12; no se hizo. **Esta excepción no está aprobada por Andres:
queda pendiente su decisión antes de publicar.**

## Publicar y volver atrás

- **El nombre del flujo del número nuevo es otro:** «NovuChat — Venta mínima (v0) — Q'Taco 3727». El plan A reemplaza SOLO al flujo vivo de la línea
  anterior (nombre «NovuChat — Venta mínima (v0) — Q'Taco»); no confundirlos al publicar.
- **Se pierde la ruta «Carrito del catálogo»:** este flujo no tiene ese webhook. Al reemplazar el flujo vivo, el catálogo web de la línea anterior
  devuelve 404. Antes de publicar hay que confirmar que el catálogo ya apunta al flujo del número nuevo.
- **Marcadores:** el plan A usa los mismos marcadores que el flujo vivo para no crear filas nuevas en la tabla local. Se evaluó renombrarlos con
  sufijo `_ANTERIOR` y NO se hizo: `preparar-import.sh` toma cada valor de una fila de la tabla local con ese nombre exacto, y `publicar-flujo.sh` aborta
  con cualquier `REEMPLAZAR_*` sin resolver, así que cada marcador renombrado exigiría una fila nueva. RIESGO anotado: si alguien actualiza esas filas del
  flujo vivo al número nuevo, esta redirección quedaría muda (el `phone_number_id` no coincidiría y no se avisaría a nadie).
- **Vuelta atrás:** NO es republicar `venta-minima.qtaco.json` (queda con 3 nodos `googlePalmApi` sin nombre de credencial). La reversa es el **respaldo que
  `publicar-flujo.sh --aplicar` escribe antes de pisar el flujo**, `Flujos/respaldo-<id>-<fecha>.local.json` (con los ids de credencial reales; ignorado por git,
  nunca se versiona), republicado con `publicar-flujo.sh --flujo Flujos/respaldo-<id>-<fecha>.local.json --aplicar`. Hay que conservar ese archivo mientras
  la redirección esté publicada.
- **Pruebas:** `admin/pruebas/qtaco-redireccion.test.ts`.
