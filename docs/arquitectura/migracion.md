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
| demo-b-venta-cobro.json | clientes/demo-b | demo | ensamblador | M6 (excepciones declaradas) | Rearquitectura | mudado | b7fb82c1-c64fcbb4-282d6437-a77ef252-e928d965-8b21b642-600049c4-1b60a20d |
| error-envio-incierto.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 2ff4b291-ed46e596-13a95489-8cccdf57-adc9df5b-079cd030-7eb163fa-0c73fe27 |
| novuchat-onboarding.json | . | congelado | ensamblador | M1 M6 M7 | por asignar (Principal) | pendiente | ce7b93b9-e0a79aaa-cca13b3e-20433796-60caa14b-341bf7f3-89bb14fd-73fc3451 |
| salida-de-persona.json | . | barrido | ensamblador | M1 M7 | por asignar (Principal) | pendiente | b4b45eef-f326ed2f-189066a8-bce521b9-4915b95c-6e460b9a-62418d24-0f7ecafc |
| latido-n8n.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 2f4160a4-4f1447ee-bf929d0f-1006e97d-8cc2e711-cb09925a-7ba38cb0-4e84282f |
| vigilancia-numero-demos.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 61960cd3-54681464-e3f0231d-d5500e9a-4958ae84-8038d63c-81b5ed09-6f51c6e4 |
| qtaco-redireccion.qtaco.json | clientes/qtaco-redireccion | vivo | construir.mjs | M4 (excepción declarada) | Rearquitectura | mudado | fc15d011-187bf6ca-061f3cf1-bff34e5e-bc264f32-1386e9c9-a727f0d8-71cae22d |
| qtaco-redireccion.qtaco-ruta-nueva.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 (excepción declarada) | Rearquitectura | mudado | f3765615-bf165adb-f4a40bf9-dd4a6f3b-e95d6594-45ddfb9d-7aad41ae-9699709a |
| agenda-minima.v0.json | clientes/agenda-minima | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | dab9593a-8b3a5a90-3acbfe50-40dc6a6e-e42bc6d3-0f08db09-4ec829e7-4418fc8a |
| captacion-minima.novuchat.json | experimental/captacion-minima | congelado | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 1adcafe1-2b9e7a57-10630a48-394c1517-39d71591-b09f88dc-7ab59aec-18e3f98c |
| casa-bermejo.json | clientes/casa-bermejo | sin publicar | construir.mjs | M4 M5 (excepción declarada) | por asignar (Principal) | mudado | 92cc388e-cd9c6fc9-44184557-af3dfeba-2625eb49-241963b6-6e16b221-577242b6 |
| chat-novuchat.novuchat.json | clientes/novuchat | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | b86510a6-205fb3a6-30b88e3d-f423d067-e5141541-6e8a698e-b9df70b1-06a0e20b |
| doctoras.rroca-emma.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 047fd904-cafadc98-36d01b32-d38973b9-1163c4fb-a634659f-020160ec-e845ae5b |
| doctoras.rroca-evy.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | e06cf8b9-64319e19-e43e6814-218f0d0b-b05b2e6f-442ef7a5-6c0d6b1b-259fe59c |
| recordatorio-bellido.v1.json | experimental/recordatorio-bellido | demo | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 64289535-4c20a3b1-19b0ab05-b8f97460-a209e62a-b87b132a-ae0d06ff-3c9bb15a |
| rescate-22h.rroca-ruben.json | experimental/rescate-22h | sin publicar | construir.mjs --todos | M1 | por asignar (Principal) | pendiente | cc962e2f-0b2ab2e4-da77d2de-f1f7adbb-60a7b8a9-e0cf0995-64b8e1d1-e0d60e93 |
| rroca-antonio.json | clientes/rroca-antonio | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 7f2175e0-edf21ec7-ac3a13a4-7560e106-0e063447-7f12c8ce-60daaa91-9a4327ef |
| rroca-emma.json | clientes/rroca-emma | vivo | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | 0e6a2f0c-828c7ed4-4154a41c-31c796e8-7b48363b-cc7be377-2d793d13-6bbb923b |
| rroca-evy.json | clientes/rroca-evy | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | 7800e54d-cd7311f8-7a001492-9bf97980-c60a6a3e-c98343c3-84c900c3-89d1d537 |
| rroca-ruben.json | clientes/rroca-ruben | vivo | construir.mjs | M1 M4 M5 M6 | Rearquitectura | mudado | f38145c5-d2536b6a-7dfb9c63-b79d90ab-f031653e-cd2c64da-e6e056d0-2d7b7cda |
| venta-minima.qtaco-3727.json | clientes/venta-minima | sin publicar | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 42c4acb5-601c6938-ad19065e-46245d6d-827a6c44-8c396308-18651018-1bf75f10 |
| venta-minima.qtaco.json | clientes/venta-minima | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 919f74f6-9a54e40e-8a12a955-132fd782-e5e759b9-b461913a-6f86c526-b6222837 |
| walisuma.json | clientes/walisuma | sin publicar | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | 1fff8da6-44d9ed26-2f358432-9551b880-0e55665d-66aa9e2c-e46293a0-638aa602 |

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
- **huella**: sha256 del JSON versionado en main (medida el 12/11/2026; el 14/11/2026 se actualizaron cuatro filas: agenda mínima, chat NovuChat y los dos de venta mínima; el 21/11/2026, doce filas por el indicador de escritura: los dos demos y los diez flujos de cliente con modelo, ver `Flujos/src/core/indicador/`; el 24/11/2026, `error-envio-incierto.json`, reescrito una vez con el formato estándar del ensamblador para darle manifiesto: solo cambian los espacios, el contenido es idéntico; decisión de Andres), en hexadecimal y en 8 grupos de 8 caracteres separados por guion (la
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
