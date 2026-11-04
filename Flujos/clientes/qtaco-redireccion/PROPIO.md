# Redirección de Q'Taco (número anterior) — `Flujos/clientes/qtaco-redireccion/`

Flujo MÍNIMO para la línea anterior de Q'Taco mientras exista: ante cualquier mensaje de un cliente responde UNA vez por
ventana de 24 h con el aviso del número nuevo. Sin IA, sin medios, sin pedidos, sin relé (sigue con su token actual).

- **Construcción:** `node construir.mjs` (escribe) y `node construir.mjs --verificar` (sale 1 si algo difiere). Los JSON son salida; no se editan a mano.
- **Datos:** `admin/scripts/datos/qtaco-redireccion/`. `qtaco.json` es el plan A (mismo nombre de workflow, misma ruta y mismos marcadores que
  el flujo vivo de Q'Taco: `publicar-flujo.sh` lo actualiza en su lugar y conserva el `webhookId`). `qtaco-ruta-nueva.json` es el plan B (otro
  nombre y `REEMPLAZAR_RUTA_RECEPTOR_QTACO_REDIRECCION`, que exige su fila en la tabla local).
- **Config del negocio** (nodo Set): `textoAviso` (con `[NUMERO]` y `[ENLACE]`), `numeroNuevo`, `ventanaHoras`, `phoneNumberIdEsperado`, `waGraphVersion`.
- **Nodos (11):** Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200), Rechazar (401), Descartar repetidos,
  Config del negocio, Decidir aviso, ¿Avisar?, Enviar aviso, Marcar avisado.
- **Entrada verificada:** verificador interno con `wabaIdEsperado` fijo, sin «Continue on Fail», 200 antes de todo lo demás, repetidos por `deliveryId`.
- **Una vez por ventana:** `Marcar avisado` guarda el teléfono en los datos estáticos solo si Meta devolvió un id; si no, la ejecución termina en error y el próximo mensaje reintenta.
- **No responde a:** acuses de estado, campos que no son `messages`, otra línea de la misma WABA, el eco del propio número, mensajes de sistema ni reacciones.
- **Costo:** 1 mensaje (de servicio, dentro de 24 h) por conversación de un cliente que escribe al número anterior; 0 en todo lo demás.
- **Vuelta atrás:** republicar el JSON anterior de Q'Taco (`venta-minima.qtaco.json`).
- **Pruebas:** `admin/pruebas/qtaco-redireccion.test.ts`.
