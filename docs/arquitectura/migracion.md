# Tablero de la migración de flujos a `Flujos/clientes/` (etapa 0, 12/11/2026)

Una fila por cada flujo de producción del disco (`flujosDeProduccion()`: todo JSON de flujo de `Flujos/` sin las
copias `.prueba` ni `.ensayo-demo-a`). `admin/pruebas/core/migrado.test.ts` lee ESTA tabla: exige una fila por flujo
del disco y viceversa, y aplica la definición de «migrado» (`docs/arquitectura/migrado.md`, M1 a M7) a las filas en
estado `mudado`. Una mudanza **nunca publica**: mueve la carpeta con `git mv` y no cambia un byte del JSON.

| JSON | carpeta | clase | constructor | falta | dueño | estado | huella |
|---|---|---|---|---|---|---|---|
| agendamiento-seguimientos.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | c039d03f-88791851-87075e25-fc074372-5d27322f-3c23c47c-643a7f60-2d6abeb7 |
| agendamiento-senas-vencidas.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 1806d41f-c793a4d9-30686e10-c5517a52-1a6380b3-9fba0385-1bd22676-8f7989d2 |
| bellido-agendamiento.json | . | congelado | ninguno | M1 M2 M6 | por asignar (Principal) | pendiente | 8b69cc43-8ade28cf-0b540973-f814055e-15edf0d5-067b310c-2e2a78e9-7bdfcd3f |
| demo-a-agendamiento.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | 5b30bfe4-c403d659-dbd02a7c-1b1b0c32-7dafabdb-ef2cc3a9-b27cbf61-a886c851 |
| demo-a-recordatorios.json | . | demo | ensamblador | M1 | por asignar (Principal) | pendiente | 7d06ea44-1c362f84-bae2afe3-e7a2a521-b2c865cc-a3736245-ae83472d-22988404 |
| demo-b-venta-cobro.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | fc586a75-4f53640c-7f69b171-5fc30149-491a92f9-94417867-5b0a3753-6ff020db |
| error-envio-incierto.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 22400c1d-0c278bb7-22a0600e-8ff6a382-34c19434-c38b5952-64e66371-347b13be |
| novuchat-onboarding.json | . | congelado | ensamblador | M1 M6 M7 | por asignar (Principal) | pendiente | 01d3388b-eb92e2a3-e8beb89d-4e6a1155-14d01b1a-5e5d8c9b-a8aea1d5-62e941b9 |
| salida-de-persona.json | . | barrido | ensamblador | M1 M7 | por asignar (Principal) | pendiente | 53feb0c6-77f019bf-e4191679-3ebc9437-faef9394-a04fc217-7b60414c-cbf8a63a |
| latido-n8n.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 2f4160a4-4f1447ee-bf929d0f-1006e97d-8cc2e711-cb09925a-7ba38cb0-4e84282f |
| vigilancia-numero-demos.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 61960cd3-54681464-e3f0231d-d5500e9a-4958ae84-8038d63c-81b5ed09-6f51c6e4 |
| qtaco-redireccion.qtaco.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | fc15d011-187bf6ca-061f3cf1-bff34e5e-bc264f32-1386e9c9-a727f0d8-71cae22d |
| qtaco-redireccion.qtaco-ruta-nueva.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | f3765615-bf165adb-f4a40bf9-dd4a6f3b-e95d6594-45ddfb9d-7aad41ae-9699709a |
| agenda-minima.v0.json | experimental/agenda-minima | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 8c8a36ec-43b5c16c-0b031791-15bedfd2-ba049e95-4de5e7a3-9c9b5080-e30f8f9b |
| captacion-minima.novuchat.json | experimental/captacion-minima | congelado | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 9c8c2f24-e40f1335-d0902848-1efd2756-c904bbaa-54e425f6-9dd41de8-8dfc864b |
| casa-bermejo.json | clientes/casa-bermejo | sin publicar | construir.mjs | M4 M5 (excepción declarada) | por asignar (Principal) | mudado | 33da5ba1-5dc0e265-7be2fd1d-8836aeec-23395027-3885a8c6-120a645f-2a6b4e5f |
| chat-novuchat.novuchat.json | clientes/novuchat | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | e01a3cfb-588b4e78-2104fb2b-99118b46-e809e86b-ec499aaf-6e63aea8-3f864695 |
| doctoras.rroca-emma.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 138d13ed-c012a440-093e5fa0-f7855660-0c40fc58-d473cfbb-7834675f-0bfa07b7 |
| doctoras.rroca-evy.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 023d3d2b-4475e164-e6ebff57-8a00198f-54e97cdd-c269f3f3-83a0ff56-093b64d4 |
| recordatorio-bellido.v1.json | experimental/recordatorio-bellido | demo | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 64289535-4c20a3b1-19b0ab05-b8f97460-a209e62a-b87b132a-ae0d06ff-3c9bb15a |
| rescate-22h.rroca-ruben.json | experimental/rescate-22h | sin publicar | construir.mjs --todos | M1 | por asignar (Principal) | pendiente | 30961db8-930cda05-5d3d5992-9d1c66e1-a061bf32-8d1918ac-9edc5daa-62dda067 |
| rroca-antonio.json | clientes/rroca-antonio | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | dec72a62-ef395f31-5815031c-370ffa11-d8cb5aaf-6585ec90-2be984b6-ca414ec9 |
| rroca-emma.json | experimental/rroca-emma | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | eb7d4835-5a7cf6a9-79148af7-de8ba915-e557ca8a-1f607b09-d0850e5e-76f30300 |
| rroca-evy.json | experimental/rroca-evy | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 2d60ef08-ab993284-736efe2a-33845a41-88af7d95-a8821b38-82ffecbf-e6a671d4 |
| rroca-ruben.json | experimental/rroca-ruben | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | e13915e0-8d3d74f2-b4c20698-d740247a-16019b64-c76e5b09-e2f8b5ff-6f54ee1e |
| venta-minima.qtaco-3727.json | experimental/venta-minima | sin publicar | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 4ab7b075-1b70d3b1-4bf2aba2-862976ae-b70d8cb9-518ed6c6-6b6373e1-4077a1c9 |
| venta-minima.qtaco.json | experimental/venta-minima | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 0df08bd5-d4314655-a8b20855-f5f0129c-df1e0621-a72af7c3-784e9f78-343a54c0 |
| walisuma.json | clientes/walisuma | sin publicar | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | dcfc7d2f-07ea9627-51b162a8-df5aaa5f-b078800c-e7594466-84c5790b-cfbd3cb1 |

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
- **huella**: sha256 del JSON versionado en main (medida el 12/11/2026; el 14/11/2026 se actualizaron cuatro filas: agenda mínima, chat NovuChat y los dos de venta mínima), en hexadecimal y en 8 grupos de 8 caracteres separados por guion (la
  prueba compara quitando los guiones). Se calculó con `sha256sum` sobre cada archivo. Desde el 14/11/2026 la prueba la exige a TODAS
  las filas: quien cambia un JSON de flujo actualiza su huella en el mismo PR (la huella es la del JSON versionado en main).

## Notas de la medición del 12/11/2026

- Base medida: `origin/main` 973e7c7d. La mudanza NUNCA publica: la diferencia entre el
  JSON versionado y el flujo vivo se declara en la fila del flujo de `docs/versiones-por-cliente.md` antes de mudarlo (decisión D1).
- Q'Taco 3727, Walisuma, Casa Bermejo, captación mínima y el rescate de las 22 h están sin publicar; Q'Taco (número anterior) y la
  redirección conviven hasta la baja del vivo.
- **A aclarar por la sesión dueña:** cuál es el JSON vivo de Bellido; la fila 32 de `docs/versiones-por-cliente.md` nombra uno
  (`bellido-agendamiento.json`) y describe la publicación del otro (`agenda-minima.v0.json`, «--desde-b»). En este tablero
  `bellido-agendamiento.json` queda «congelado (D3)» y `agenda-minima.v0.json` «vivo (según fila 32, publicado desde B)»; no se afirma más.
- Las dos redirecciones de `clientes/qtaco-redireccion/` ya viven en `clientes/` con su `PROPIO.md` (M1 cumplido) y siguen
  `pendiente` porque les falta su fila en `docs/versiones-por-cliente.md` (M7), que esta etapa no edita.
- Las filas de los barridos sin constructor (`agendamiento-*`) y de `recordatorio-bellido.v1.json` son JSON editados a mano.
