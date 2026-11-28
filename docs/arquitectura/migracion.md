# Tablero de la migración de flujos a `Flujos/clientes/` (etapa 0, 12/11/2026)

Una fila por cada flujo de producción del disco (`flujosDeProduccion()`: todo JSON de flujo de `Flujos/` sin las
copias `.prueba` ni `.ensayo-demo-a`). `admin/pruebas/core/migrado.test.ts` lee ESTA tabla: exige una fila por flujo
del disco y viceversa, y aplica la definición de «migrado» (`docs/arquitectura/migrado.md`, M1 a M7) a las filas en
estado `mudado`. Una mudanza **nunca publica**: mueve la carpeta con `git mv` y no cambia un byte del JSON.

| JSON | carpeta | clase | constructor | falta | dueño | estado | huella |
|---|---|---|---|---|---|---|---|
| agendamiento-seguimientos.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | c039d03f-88791851-87075e25-fc074372-5d27322f-3c23c47c-643a7f60-2d6abeb7 |
| agendamiento-senas-vencidas.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 1806d41f-c793a4d9-30686e10-c5517a52-1a6380b3-9fba0385-1bd22676-8f7989d2 |
| bellido-agendamiento.json | . | congelado | ninguno | M1 M2 M6 | por asignar (Principal) | pendiente | e6d07c1a-c6d52035-d43d8b40-7e9c0afc-0811fa87-a4a6db8d-4d021409-3dd3de61 |
| demo-a-agendamiento.json | clientes/demo-a | demo | ensamblador | M6 (excepciones declaradas) | Rearquitectura | mudado | 557b3575-0e054927-5bc06c13-eba488fc-23f4ac45-3f7e9e46-d4eb5f64-61286aef |
| demo-a-recordatorios.json | . | demo | ensamblador | M1 | por asignar (Principal) | pendiente | 7d06ea44-1c362f84-bae2afe3-e7a2a521-b2c865cc-a3736245-ae83472d-22988404 |
| demo-b-venta-cobro.json | clientes/demo-b | demo | ensamblador | M6 (excepciones declaradas) | Rearquitectura | mudado | 47658870-3eaf2268-e87638cd-4439f123-3f70b8b1-2eac712c-03a75487-e60c705f |
| error-envio-incierto.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 2ff4b291-ed46e596-13a95489-8cccdf57-adc9df5b-079cd030-7eb163fa-0c73fe27 |
| novuchat-onboarding.json | . | congelado | ensamblador | M1 M6 M7 | por asignar (Principal) | pendiente | ce7b93b9-e0a79aaa-cca13b3e-20433796-60caa14b-341bf7f3-89bb14fd-73fc3451 |
| salida-de-persona.json | . | barrido | ensamblador | M1 M7 | por asignar (Principal) | pendiente | b4b45eef-f326ed2f-189066a8-bce521b9-4915b95c-6e460b9a-62418d24-0f7ecafc |
| latido-n8n.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 2f4160a4-4f1447ee-bf929d0f-1006e97d-8cc2e711-cb09925a-7ba38cb0-4e84282f |
| vigilancia-numero-demos.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 61960cd3-54681464-e3f0231d-d5500e9a-4958ae84-8038d63c-81b5ed09-6f51c6e4 |
| qtaco-redireccion.qtaco.json | clientes/qtaco-redireccion | vivo | construir.mjs | M4 (excepción declarada) | Rearquitectura | mudado | fc15d011-187bf6ca-061f3cf1-bff34e5e-bc264f32-1386e9c9-a727f0d8-71cae22d |
| qtaco-redireccion.qtaco-ruta-nueva.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 (excepción declarada) | Rearquitectura | mudado | f3765615-bf165adb-f4a40bf9-dd4a6f3b-e95d6594-45ddfb9d-7aad41ae-9699709a |
| agenda-minima.v0.json | clientes/agenda-minima | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | c0337ec0-1f2fa0d1-d27a5bc4-764858f6-f5fd11d9-3a0ec82f-088430bd-d15b3337 |
| captacion-minima.novuchat.json | experimental/captacion-minima | congelado | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 9c8c2f24-e40f1335-d0902848-1efd2756-c904bbaa-54e425f6-9dd41de8-8dfc864b |
| casa-bermejo.json | clientes/casa-bermejo | sin publicar | construir.mjs | M4 M5 (excepción declarada) | por asignar (Principal) | mudado | c7a57caf-8da57081-b08b3c9e-50e0fe36-d838bd91-9b105cb5-be6ef6e8-ca444dd8 |
| chat-novuchat.novuchat.json | clientes/novuchat | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | 39d526a7-d63a316c-1d9006c5-f337ab6f-78059e64-ba6d9a31-384ce0b2-cf8697fe |
| doctoras.rroca-emma.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 62c3037b-50dcfcad-548dd931-f4582a02-31ebdfaa-c49ece4a-788b6896-4c9c67b8 |
| doctoras.rroca-evy.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | df74b4d9-bc122538-9c6deafc-2a2ed8f2-ff285eb7-74356bb8-584ccbd3-2b956a16 |
| recordatorio-bellido.v1.json | experimental/recordatorio-bellido | demo | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 64289535-4c20a3b1-19b0ab05-b8f97460-a209e62a-b87b132a-ae0d06ff-3c9bb15a |
| rescate-22h.rroca-ruben.json | experimental/rescate-22h | sin publicar | construir.mjs --todos | M1 | por asignar (Principal) | pendiente | 30961db8-930cda05-5d3d5992-9d1c66e1-a061bf32-8d1918ac-9edc5daa-62dda067 |
| rroca-antonio.json | clientes/rroca-antonio | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 920df70b-cd302cef-1f0c0474-2849277f-6e12ff0a-ef480158-422a61a3-dd891100 |
| rroca-emma.json | clientes/rroca-emma | vivo | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | 42310705-5a15f119-243b44f4-e2d53ebd-530f4276-0f985f8f-2a59bd30-63431957 |
| rroca-evy.json | clientes/rroca-evy | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | cb884e7e-ab373aa8-f49129aa-8592cbd8-a5f43b93-e884abfb-1a4406fd-68cf0216 |
| rroca-ruben.json | clientes/rroca-ruben | vivo | construir.mjs | M1 M4 M5 M6 | Rearquitectura | mudado | c4d17749-e14267ff-1de9bb48-d0d59662-b390c313-b924b9f1-571716dc-0f18fe48 |
| venta-minima.qtaco-3727.json | clientes/venta-minima | sin publicar | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 67983ce8-915c16ab-be41246b-eddf25be-4fc0affa-c68050c4-0d7bbde8-dea2523f |
| venta-minima.qtaco.json | clientes/venta-minima | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | d7cce2dd-edc395b9-334b6ae0-544edff3-3ebfa013-1dc818cb-5254335a-55b3e870 |
| walisuma.json | clientes/walisuma | sin publicar | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | b84876d5-eb37978f-14cbfac3-c6127463-c5842de1-f3d8c407-a5df31df-6fa37bb7 |

## Cómo se lee

- **carpeta**: relativa a `Flujos/`; `.` es la raíz. La identidad de un flujo no depende de que viva en `experimental/` o en
  `clientes/` (una mudanza no cambia qué flujo es): la prueba compara por el nombre sin esa carpeta de nivel superior.
- **clase**: `vivo` (corre en n8n para un cliente), `sin publicar` (versionado, aún no corre), `demo`, `barrido` (recorre todos los
  comercios o es un flujo común) y `congelado` (decisión D3 de Andres, 12/11/2026, y captación mínima, 13/11/2026: «congelar y retirar al final»; no se muda, su retiro es un PR aparte al final).
- **constructor**: lo que arma el JSON y se verifica (M2). `ensamblador` es `admin/scripts/ensamblar-flujo.mjs verificar`.
  `ninguno` es un JSON editado a mano: no puede declararse `mudado` hasta tener constructor o ensamblador.
- **falta**: los puntos de la definición de «migrado» que HOY no se cumplen limpiamente. M4, M5 y M6 aparecen cuando el flujo tiene
  excepciones vigentes en `admin/pruebas/core/migracion/excepciones.ts` (lista cerrada con dueño y vencimiento). M3 no se evalúa
  hasta la mudanza: la huella de esta tabla es la que la mudanza no debe cambiar.
- **dueño**: de la mudanza. Lo asigna Principal; Walisuma es de Rearquitectura.
- **estado**: `pendiente` o `mudado`. Solo las filas `mudado` pasan por M1 a M7.
- **latido-n8n (24/11/2026):** su armador es `ninguno` a propósito: el JSON a mano es la fuente y no se le extrae manifiesto (decisión de las mudanzas del 24/11).
- **huella**: sha256 del JSON versionado en main (medida el 12/11/2026; el 14/11/2026 se actualizaron cuatro filas: agenda mínima, chat NovuChat y los dos de venta mínima; el 21/11/2026, doce filas por el indicador de escritura: los dos demos y los diez flujos de cliente con modelo, ver `Flujos/src/core/indicador/`; el 27/11/2026, cinco filas por el PR «moneda y cantidad en las piezas comunes de venta» (el Demo B, `venta-minima.qtaco.json`, `venta-minima.qtaco-3727.json`, `walisuma.json` y `casa-bermejo.json`); el 24/11/2026, `error-envio-incierto.json`, reescrito una vez con el formato estándar del ensamblador para darle manifiesto: solo cambian los espacios, el contenido es idéntico; decisión de Andres), en hexadecimal y en 8 grupos de 8 caracteres separados por guion (la
  prueba compara quitando los guiones). Se calculó con `sha256sum` sobre cada archivo. Desde el 14/11/2026 la prueba la exige a TODAS
  las filas: quien cambia un JSON de flujo actualiza su huella en el mismo PR (la huella es la del JSON versionado en main).

## Notas de la medición del 12/11/2026

- Base medida: `origin/main` 973e7c7d. La mudanza NUNCA publica: la diferencia entre el
  JSON versionado y el flujo vivo se declara en la fila del flujo de `docs/versiones-por-cliente.md` antes de mudarlo (decisión D1).
- Q'Taco 3727, Walisuma, Casa Bermejo, captación mínima y el rescate de las 22 h están sin publicar; Q'Taco (número anterior) y la
  redirección conviven hasta la baja del vivo.
- **Resuelto (21/11/2026): el JSON vivo de Bellido es `agenda-minima.v0.json`** (Agenda mínima, 71 nodos), no `bellido-agendamiento.json`. Evidencia: la fila 32 de `docs/versiones-por-cliente.md` (publicado con `flujo-de-prueba.mjs --sobre-bellido --desde-b` el 01/10, el 24/10 y el 08/11); `bitacora/2026-10.md` y `bitacora/2026-11.md` (hallazgo 4: «el vivo es `agenda-minima.v0.json` (71); el otro tiene 96»); y la fila 32 aclara que se publica con `flujo-de-prueba.mjs`, no con `publicar-flujo.sh` (que solo cita a Bellido en un comentario), por lo que no hubo rutas guardadas que reapuntar allí. `bellido-agendamiento.json` sigue «congelado (D3)». La columna «Flujo versionado» de esa fila conserva `bellido-agendamiento.json` hasta que `estado-de-versiones.sh` sepa comparar el JSON de B. Mudado a `Flujos/clientes/agenda-minima/` (la carpeta conserva el nombre del flujo, como `venta-minima`); no verificado en vivo, por decisión de Andres (modo seco: huella igual + CI, 16/11).
- Las dos redirecciones de `clientes/qtaco-redireccion/` ya viven en `clientes/` con su `PROPIO.md` (M1 cumplido) y siguen
  `pendiente` porque les falta su fila en `docs/versiones-por-cliente.md` (M7), que esta etapa no edita.
- `demo-a-recordatorios.json` (25/11/2026): sigue en la raíz, «pendiente». No se mudó con el agendamiento (#1114) porque `.env.recordatorios` no tiene el acceso a n8n (`N8N_BASE_URL`, `N8N_API_KEY`, `N8N_WORKFLOW_ID`) que necesita el modo seco de `estado-de-versiones.sh` (paso 6 de `mudanza.md`): salió «sin poder comprobar» (3) antes y después. Si el flujo corre hoy en n8n no está verificado. Lo destraba completar ese entorno y repetir el seco.
- Las filas de los barridos sin constructor (`agendamiento-*`) y de `recordatorio-bellido.v1.json` son JSON editados a mano.
