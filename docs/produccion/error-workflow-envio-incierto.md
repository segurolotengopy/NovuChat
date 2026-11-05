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

## Decisión pendiente: `saveDataSuccessExecution` none o all

El errorWorkflow se dispara con **cualquier** error de un flujo con relé, no
solo con el «Detener». Con `all`, n8n guarda en la ejecución del errorWorkflow
la entrada completa del Error Trigger: `execution.error` (de un NodeApiError,
su descripción y el cuerpo HTTP de la respuesta), el stack, el nodo que falló
con sus parámetros y la URL de la ejecución. Con el «Detener» de #757 el mensaje
es fijo y no hay datos del paciente; el riesgo depende de los demás nodos que
puedan fallar (bajo, no cero).

- `all`: se ve la fila en Ejecuciones (flujo y hora), con ese riesgo.
- `none`: cero residuo, pero no queda nada visible en la lista.

Recomendación provisional: `all` solo si antes se audita qué nodos de los flujos
con relé pueden lanzar un error con datos; si no se audita, `none`. El JSON
versionado queda con `all` hasta que Andres decida.

## Cómo se crea y asigna (lo hace Claude, con el botón de Andres)

1. Importar `Flujos/error-envio-incierto.json` en n8n (`publicar-flujo.sh`,
   desde `origin/main`). Un flujo con solo Error Trigger normalmente **no se
   activa**: basta asignarlo en `settings.errorWorkflow` de los otros flujos.
   No verificado en n8n 2.36.5: si lo dispara estando inactivo, y que la
   ejecución del errorWorkflow se guarde con las opciones de arriba; se
   comprueba en el ensayo.
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
