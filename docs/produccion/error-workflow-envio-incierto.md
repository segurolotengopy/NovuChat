# errorWorkflow de «envío incierto» (decisión I4, 03/11/2026)

Los flujos con relé terminan la ejecución en error (nodo «Detener por envío
incierto») cuando un envío queda `incierto` o `agotado`. Esas ejecuciones no se
guardan (`saveDataErrorExecution: none`) y **no deben empezar a guardarse**: por
eso el error se hace visible con un workflow de errores de n8n.

## Qué es

`Flujos/error-envio-incierto.json`: `Error del flujo` (Error Trigger) →
`Registrar flujo y hora` (Code, salida `{ flujo, hora }` con el nombre saneado) →
`Armar alerta` (Code) → `Firmar alerta (HMAC)` (Crypto, credencial «NovuChat alertas
(HMAC)») → `Enviar alerta operativa` (HTTP Request). Todo lo demás de la entrada del
Error Trigger (ids, url, mensaje, datos) se descarta: «Armar alerta» usa textos
constantes y solo compara el nombre del último nodo ejecutado para el nivel:
«Detener por envío incierto» = `urgente` (`envio_incierto`); cualquier otro error =
`aviso` (`error_de_flujo`). El cuerpo sale en ASCII puro (`\uXXXX`) y se firma con
HMAC SHA256 sobre `marca.cuerpo`; el POST va a la Function `alertaOperativa` con las
cabeceras `X-NovuChat-Alerta-Timestamp` y `X-NovuChat-Alerta-Signature`. Si la Function
responde 401/422/5xx o hay timeout tras 2 intentos, la ejecución queda en ERROR
(sin `onError`). **0 mensajes de WhatsApp por conversación.** Ajustes: `saveDataSuccessExecution`
`none` y `saveDataErrorExecution` `all` (decisión de Andres).
Pruebas: `admin/pruebas/core/error-envio-incierto.test.ts` y
`admin/pruebas/plataforma/alerta-errorworkflow.test.ts`.

**Límite del `id_unico`:** es `<tipo>-<fecha hasta el segundo>-<6 letras del flujo>`. Dos
fallas del mismo flujo y tipo en el mismo segundo comparten id (la Function las trata como
una) y el tope de la Function es de 1 por hora por tipo.

## Cómo se carga (ya NO se importa con `publicar-flujo.sh`)

El JSON lleva un marcador de URL (dentro del código de «Armar alerta») y una credencial por
nombre, y `publicar-flujo.sh` aborta ante cualquier `REEMPLAZAR_`. Se carga con
`scripts/cargar-alerta-n8n.sh`, siempre seco primero y con `--aplicar --confirmo produccion`:
1. `--credencial`: crea o actualiza «NovuChat alertas (HMAC)» con `ALERTAS_HMAC` por tubería.
2. `--flujo` (con la Function ya desplegada): resuelve la URL con gcloud, la repone en memoria
   y crea el flujo INACTIVO con la credencial asignada por nombre y tipo.
Lo vivo difiere del JSON en esos dos valores (fila en `docs/versiones-por-cliente.md`).

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

1. Cargar el flujo con `scripts/cargar-alerta-n8n.sh` (ver arriba; no `publicar-flujo.sh`). Un flujo con solo Error Trigger normalmente **no se
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
