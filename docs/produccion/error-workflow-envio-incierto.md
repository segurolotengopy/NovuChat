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

## Decisión (Andres, 10/11/2026): `saveDataSuccessExecution: none`, cero residuo

El errorWorkflow se dispara con **cualquier** error de un flujo con relé, no solo
con el «Detener». Con `all`, n8n guardaría en la ejecución del errorWorkflow la
entrada completa del Error Trigger: `execution.error` (de un NodeApiError, su
descripción y el cuerpo HTTP de la respuesta), el stack, el nodo que falló con sus
parámetros y la URL de la ejecución. Con el «Detener» de #757 el mensaje es fijo y
no hay datos del paciente, pero el riesgo depende de los demás nodos que puedan
fallar (bajo, no cero) y nadie auditó esos nodos.

**Decidido: `none`.** La ejecución exitosa del flujo de alertas no se guarda: cero
residuo de datos del paciente. El costo es que no queda una fila en Ejecuciones con
flujo y hora; la evidencia de que la alerta salió es la propia alerta (la Function
`alertaOperativa` y el aviso que recibe Andres). `Flujos/error-envio-incierto.json`
ya lleva `saveDataSuccessExecution: none` (verificado el 10/11/2026; la nota anterior
que lo daba por `all` estaba desactualizada). `saveDataErrorExecution` sigue en `all`
a propósito: si la alerta misma falla (401/422/5xx), esa ejecución tiene que ser
visible. Fila en `docs/versiones-por-cliente.md`: el flujo no cambia de versión, solo
se aclara que el ajuste vivo debe ser `none`.

## Cómo se crea y asigna (lo hace Claude, con el botón de Andres)

1. Cargar el flujo con `scripts/cargar-alerta-n8n.sh` (ver arriba; no `publicar-flujo.sh`). Un flujo con solo Error Trigger normalmente **no se
   activa**: basta asignarlo en `settings.errorWorkflow` de los otros flujos.
   No verificado en n8n 2.36.5: si lo dispara estando inactivo, y que la
   ejecución del errorWorkflow se guarde con las opciones de arriba; se
   comprueba en el ensayo.
2. El id lo asigna n8n y nunca se versiona; no hay que anotarlo ni asignarlo a mano: el publicador lo resuelve por nombre (sección siguiente).

## Prueba de error forzado (`scripts/probar-alerta-n8n.sh`)

Comprueba de punta a punta que la alerta real llega a Andres sin tocar ningún flujo de cliente: crea un flujo
temporal INACTIVO «NovuChat — PRUEBA alerta (temporal)» (Webhook de ruta aleatoria → nodo «Detener por envío
incierto», el nombre exacto que «Armar alerta» exige para marcar `urgente`), con `settings.errorWorkflow` = la
alerta; lo activa, lo dispara una vez, informa las ejecuciones nuevas de la alerta y SIEMPRE lo desactiva y lo
borra. Seco por omisión; `--aplicar --confirmo produccion` para correrlo. Costo: 1 aviso de prueba a Andres
(tope de 5 al día). Con `saveDataSuccessExecution: none` un éxito no deja ejecución: la prueba de que salió es el
aviso recibido. Sigue sin verificarse en n8n 2.36.5 que el Error Trigger dispare con el flujo de alertas inactivo;
esta prueba lo resuelve (si no llega aviso, ese es el motivo probable).

## Cómo llega el id a cada flujo con relé (implementado)

En el JSON de cada flujo con relé: `"settings": { "errorWorkflow": "REEMPLAZAR_ID_ERROR_WORKFLOW" }`.
Hoy lo llevan `rroca-emma` (producción y prueba) y `rroca-evy` cuando su canal de envío es
`rele` (con `graph` no lleva nada: no hay relé ni «Detener»). Los armadores
(`construir.mjs`) lo escriben y su guardia exige el marcador o un id ya resuelto.

`scripts/preparar-import.sh` y `scripts/publicar-flujo.sh` lo resuelven por NOMBRE con
`scripts/lib/resolver-error-workflow.py`: buscan «NovuChat — Error de envío incierto» en
el n8n destino (solo `GET /workflows`) y escriben su id. **Fallan** (código 1, sin escribir
la salida ni publicar) si el flujo no existe, si hay más de uno con ese nombre, si la lista
llegó partida o no llegó, o si el marcador aparece fuera de `settings.errorWorkflow`. El
id no se imprime ni se versiona. El resto de `settings` no cambia, y
`saveDataErrorExecution` de los flujos de cliente sigue en `none`.

El comparador de `settings` de `publicar-flujo.sh` (solo nombres de clave, nunca valores)
sabe que `errorWorkflow` puede diferir en el valor entre el origen y el vivo: si los dos lo
tienen, no cuenta; si solo lo tiene uno, sí.

Costo: 0 mensajes por conversación, 0 nodos. Falta, fuera de este cambio: cargar el flujo
de alertas en cada n8n destino antes de publicar un flujo con relé, o el publicador falla
(es lo buscado).
