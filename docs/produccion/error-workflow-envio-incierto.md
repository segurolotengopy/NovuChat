# errorWorkflow de «envío incierto» (decisión I4, 03/11/2026)

Los flujos con relé terminan la ejecución en error (nodo «Detener por envío
incierto») cuando un envío queda `incierto` o `agotado`. Esas ejecuciones no se
guardan (`saveDataErrorExecution: none`) y **no deben empezar a guardarse**: por
eso el error se hace visible con un workflow de errores de n8n.

## Qué es

`Flujos/error-envio-incierto.json`: `Error del flujo` (Error Trigger) →
`Registrar flujo y hora` (Code). La salida es solo `{ flujo, hora }`, la hora en
`America/La_Paz` (UTC-4). Todo lo demás de la entrada (ids de ejecución, url,
mensaje, nodo, datos) se descarta en el Code. No envía mensajes ni llama a nada:
**0 mensajes por conversación**. Prueba negando:
`admin/pruebas/core/error-envio-incierto.test.ts`.

Se ve en la lista de Ejecuciones de ese flujo (`saveDataSuccessExecution: all`).
Residuo a saber: n8n guarda también la entrada del Error Trigger en esa
ejecución; lo único libre ahí es el mensaje fijo del nodo «Detener» (decisión y
código sanitizado, sin teléfono, texto ni clave) y un id de una ejecución que no
se guardó. Si se quiere cero residuo, poner `saveDataSuccessExecution: none` y
perder la visibilidad en la lista.

## Cómo se crea y asigna (lo hace Claude, con el botón de Andres)

1. Importar `Flujos/error-envio-incierto.json` en n8n y **activarlo** (un
   workflow de errores no necesita estar activo para recibir errores, pero se
   publica como cualquier flujo: `publicar-flujo.sh`, desde `origin/main`).
2. Anotar su id (lo asigna n8n; nunca se versiona).
3. Asignarlo a cada flujo con relé: `settings.errorWorkflow = <id>`.

## Mecanismo propuesto para el id (no implementado)

En el JSON de cada flujo con relé: `"settings": { "errorWorkflow": "REEMPLAZAR_ID_ERROR_WORKFLOW" }`.
`publicar-flujo.sh` / `preparar-import.sh` lo reemplazan al publicar, como ya
hacen con los demás marcadores `REEMPLAZAR_*`: buscan por nombre el flujo
«NovuChat — Error de envío incierto» en el n8n destino y escriben su id; si no
existe, **fallan** (nunca dejan el marcador). El resto de `settings` no cambia,
y `saveDataErrorExecution` de los flujos de cliente sigue en `none`. Falta
también enseñar al comparador de `settings` de `publicar-flujo.sh` (solo nombres de
clave, nunca valores) que `errorWorkflow` puede diferir en el valor. Se implementa
en el PR que active el relé en un cliente, no aquí.
