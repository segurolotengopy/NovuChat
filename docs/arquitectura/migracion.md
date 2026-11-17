# Tablero de la migración de flujos a `Flujos/clientes/` (etapa 0, 12/11/2026)

Una fila por cada flujo de producción del disco (`flujosDeProduccion()`: todo JSON de flujo de `Flujos/` sin las
copias `.prueba` ni `.ensayo-demo-a`). `admin/pruebas/core/migrado.test.ts` lee ESTA tabla: exige una fila por flujo
del disco y viceversa, y aplica la definición de «migrado» (`docs/arquitectura/migrado.md`, M1 a M7) a las filas en
estado `mudado`. Una mudanza **nunca publica**: mueve la carpeta con `git mv` y no cambia un byte del JSON.

| JSON | carpeta | clase | constructor | falta | dueño | estado | huella |
|---|---|---|---|---|---|---|---|
| agendamiento-seguimientos.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | c039d03f-88791851-87075e25-fc074372-5d27322f-3c23c47c-643a7f60-2d6abeb7 |
| agendamiento-senas-vencidas.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 1806d41f-c793a4d9-30686e10-c5517a52-1a6380b3-9fba0385-1bd22676-8f7989d2 |
| bellido-agendamiento.json | . | congelado | ninguno | M1 M2 M6 | por asignar (Principal) | pendiente | 7ce44559-4c72fa61-9a939d46-eb30028f-5e86ba4d-23a7b6c0-19a3c98b-8e474891 |
| demo-a-agendamiento.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | 5b30bfe4-c403d659-dbd02a7c-1b1b0c32-7dafabdb-ef2cc3a9-b27cbf61-a886c851 |
| demo-a-recordatorios.json | . | demo | ensamblador | M1 | por asignar (Principal) | pendiente | 7d06ea44-1c362f84-bae2afe3-e7a2a521-b2c865cc-a3736245-ae83472d-22988404 |
| demo-b-venta-cobro.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | 0959cae2-817d0d4a-f05be355-2d451ac6-7e46981c-1143560f-f1a9dca5-7016308f |
| error-envio-incierto.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 22400c1d-0c278bb7-22a0600e-8ff6a382-34c19434-c38b5952-64e66371-347b13be |
| novuchat-onboarding.json | . | congelado | ensamblador | M1 M6 M7 | por asignar (Principal) | pendiente | 0a2eb704-63312a02-3db268b1-2b692c92-7fb82431-081f748a-236095e3-d47e4f17 |
| salida-de-persona.json | . | barrido | ensamblador | M1 M7 | por asignar (Principal) | pendiente | 53feb0c6-77f019bf-e4191679-3ebc9437-faef9394-a04fc217-7b60414c-cbf8a63a |
| latido-n8n.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | fbba6e2d-f2421816-8b8f8a21-681f4184-e009aca3-080c28c8-122072eb-93c79227 |
| vigilancia-numero-demos.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 61960cd3-54681464-e3f0231d-d5500e9a-4958ae84-8038d63c-81b5ed09-6f51c6e4 |
| qtaco-redireccion.qtaco.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | fc15d011-187bf6ca-061f3cf1-bff34e5e-bc264f32-1386e9c9-a727f0d8-71cae22d |
| qtaco-redireccion.qtaco-ruta-nueva.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | f3765615-bf165adb-f4a40bf9-dd4a6f3b-e95d6594-45ddfb9d-7aad41ae-9699709a |
| agenda-minima.v0.json | experimental/agenda-minima | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | d9d1c043-bd8a44af-36df6245-07d101a5-31841234-9f901630-2693bbef-1bc7b1d9 |
| captacion-minima.novuchat.json | experimental/captacion-minima | congelado | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 32783f26-f10786c5-7fbea369-8e3aa8ed-d7db27c7-c45d6cf6-df15ccce-aef62ff1 |
| casa-bermejo.json | clientes/casa-bermejo | sin publicar | construir.mjs | M4 M5 (excepción declarada) | por asignar (Principal) | mudado | 33da5ba1-5dc0e265-7be2fd1d-8836aeec-23395027-3885a8c6-120a645f-2a6b4e5f |
| chat-novuchat.novuchat.json | clientes/novuchat | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | 8740b4c2-43e5d7dc-10be3cba-53cfef51-b2ffefa4-12c264b7-2bc410dc-a3e183e0 |
| doctoras.rroca-emma.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 2aed59ad-9662f1cc-4e2e84f3-dafa8bd6-e717fc26-6836b212-5e4f99c4-e4079c8f |
| doctoras.rroca-evy.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | c9e56d79-fb4af632-6103561f-97a30894-ef94d249-8ea5f8aa-30b5f3a0-b1f875ac |
| recordatorio-bellido.v1.json | experimental/recordatorio-bellido | demo | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 64289535-4c20a3b1-19b0ab05-b8f97460-a209e62a-b87b132a-ae0d06ff-3c9bb15a |
| rescate-22h.rroca-ruben.json | experimental/rescate-22h | sin publicar | construir.mjs --todos | M1 | por asignar (Principal) | pendiente | 30961db8-930cda05-5d3d5992-9d1c66e1-a061bf32-8d1918ac-9edc5daa-62dda067 |
| rroca-antonio.json | clientes/rroca-antonio | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | cb7dda65-138010bc-561abfa6-c2f71608-e86399ad-41f80e66-ac79df30-092287d0 |
| rroca-emma.json | experimental/rroca-emma | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 3a389062-16eda23b-43cb1c54-9a81490d-1e295e12-6b6c8d1d-88790bbf-0c32765f |
| rroca-evy.json | experimental/rroca-evy | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | fd1267b6-92a67c1f-af055e3d-010ed0fb-fb700d47-e466c5ba-82d79891-f9b3f019 |
| rroca-ruben.json | experimental/rroca-ruben | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | b69034df-a2dea4c1-e2365bd8-028bc069-e45f2266-0802a752-5f4114ff-7edafeb8 |
| venta-minima.qtaco-3727.json | experimental/venta-minima | sin publicar | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 3e467856-aaa7842a-0be1b4aa-dcc767aa-9865c3e4-7e295122-f35eb6ab-99c77a10 |
| venta-minima.qtaco.json | experimental/venta-minima | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 1f01d842-8d3c4b86-c19bae51-9c775983-9e266331-5d222c5d-613b6fd7-1b33d780 |
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
