# Tablero de la migración de flujos a `Flujos/clientes/` (etapa 0, 12/11/2026)

Una fila por cada flujo de producción del disco (`flujosDeProduccion()`: todo JSON de flujo de `Flujos/` sin las
copias `.prueba` ni `.ensayo-demo-a`). `admin/pruebas/core/migrado.test.ts` lee ESTA tabla: exige una fila por flujo
del disco y viceversa, y aplica la definición de «migrado» (`docs/arquitectura/migrado.md`, M1 a M7) a las filas en
estado `mudado`. Una mudanza **nunca publica**: mueve la carpeta con `git mv` y no cambia un byte del JSON.

| JSON | carpeta | clase | constructor | falta | dueño | estado | huella |
|---|---|---|---|---|---|---|---|
| agendamiento-seguimientos.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | c039d03f-88791851-87075e25-fc074372-5d27322f-3c23c47c-643a7f60-2d6abeb7 |
| agendamiento-senas-vencidas.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 1806d41f-c793a4d9-30686e10-c5517a52-1a6380b3-9fba0385-1bd22676-8f7989d2 |
| bellido-agendamiento.json | . | congelado | ninguno | M1 M2 M6 | por asignar (Principal) | pendiente | 22947ca7-709a6933-1a0804cc-32f9b692-ca8af4ec-0d3e9b84-7e3ed1c8-834f5098 |
| demo-a-agendamiento.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | ca837dd1-0f87b06a-d2997705-7b42295e-7460989f-1a8e6584-2299e535-cd894b98 |
| demo-a-recordatorios.json | . | demo | ensamblador | M1 | por asignar (Principal) | pendiente | 7d06ea44-1c362f84-bae2afe3-e7a2a521-b2c865cc-a3736245-ae83472d-22988404 |
| demo-b-venta-cobro.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | 9faeb8b2-ce2dc43c-b96e33c7-6691ad25-d3991d3f-38df2fbb-16856c31-74dcb932 |
| error-envio-incierto.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 22400c1d-0c278bb7-22a0600e-8ff6a382-34c19434-c38b5952-64e66371-347b13be |
| novuchat-onboarding.json | . | congelado | ensamblador | M1 M6 M7 | por asignar (Principal) | pendiente | e030ed13-0acb4baa-491d32ef-04ac4dc5-2d5371f5-9f805179-f621bfb0-3b414273 |
| salida-de-persona.json | . | barrido | ensamblador | M1 M7 | por asignar (Principal) | pendiente | 53feb0c6-77f019bf-e4191679-3ebc9437-faef9394-a04fc217-7b60414c-cbf8a63a |
| latido-n8n.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | fbba6e2d-f2421816-8b8f8a21-681f4184-e009aca3-080c28c8-122072eb-93c79227 |
| vigilancia-numero-demos.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 61960cd3-54681464-e3f0231d-d5500e9a-4958ae84-8038d63c-81b5ed09-6f51c6e4 |
| qtaco-redireccion.qtaco.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | fc15d011-187bf6ca-061f3cf1-bff34e5e-bc264f32-1386e9c9-a727f0d8-71cae22d |
| qtaco-redireccion.qtaco-ruta-nueva.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | f3765615-bf165adb-f4a40bf9-dd4a6f3b-e95d6594-45ddfb9d-7aad41ae-9699709a |
| agenda-minima.v0.json | experimental/agenda-minima | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 6f9b6340-e4494c5b-2c5d5370-ac45eda8-5663e588-9149dcd4-844bfec8-be95b754 |
| captacion-minima.novuchat.json | experimental/captacion-minima | congelado | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | e32347c0-840ec86c-a9c416da-7216fcc2-b56fd089-36b142bf-e0d58f1e-fe3bc0a0 |
| casa-bermejo.json | clientes/casa-bermejo | sin publicar | construir.mjs | M4 M5 (excepción declarada) | por asignar (Principal) | mudado | 220aa440-a6b1c79c-c1cdf5ed-7519dc3b-8ddc4c48-06e20ee1-83958950-8d5b14e1 |
| chat-novuchat.novuchat.json | clientes/novuchat | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | 38a660e3-9a8f304e-1a52bccf-36b0e7c8-74115a37-e4e5fe16-b72124ab-5a48e0a3 |
| doctoras.rroca-emma.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 337d61b8-a3249cab-65a34c35-8b3ca91c-49800e11-5d1b4fc7-7b5046ff-7ed82674 |
| doctoras.rroca-evy.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 3db37cc4-ca855db7-c63e4c60-eee71530-10d8026b-50d6b185-b57aa8a4-691eefaf |
| recordatorio-bellido.v1.json | experimental/recordatorio-bellido | demo | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 64289535-4c20a3b1-19b0ab05-b8f97460-a209e62a-b87b132a-ae0d06ff-3c9bb15a |
| rescate-22h.rroca-ruben.json | experimental/rescate-22h | sin publicar | construir.mjs --todos | M1 | por asignar (Principal) | pendiente | 30961db8-930cda05-5d3d5992-9d1c66e1-a061bf32-8d1918ac-9edc5daa-62dda067 |
| rroca-antonio.json | clientes/rroca-antonio | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 1d78d290-73bfb85d-82ae29d1-4100ee2f-049bc483-bfdde12d-7c02e40c-e78395b0 |
| rroca-emma.json | experimental/rroca-emma | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 923e8eee-2b776bb8-0c34f815-c13d7f47-d8d63530-76c4036a-98add59d-2b717a00 |
| rroca-evy.json | experimental/rroca-evy | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | fcc0abe8-252f2e61-a4657d48-7d550749-1a5e8bb7-e07e8c83-f796b21e-d455db80 |
| rroca-ruben.json | experimental/rroca-ruben | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 278887c3-b512e847-d7847d02-f645a19b-cf82f5c2-fd5b6cd9-c4650b2a-64f88a8c |
| venta-minima.qtaco-3727.json | experimental/venta-minima | sin publicar | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 238f65fb-235275dd-d790321c-1cf2bbb8-51d4e4f8-7b55b6ad-4eab1cb7-f6c83419 |
| venta-minima.qtaco.json | experimental/venta-minima | vivo | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 670f34e2-63098c61-a5d0d0f7-76581ce9-81aefba0-72fa79c0-829e2ff7-a94ac1f5 |
| walisuma.json | clientes/walisuma | sin publicar | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | 850e2775-7abc49bc-cbb1c4b4-eabbf631-588bf976-f182e18f-d0ad3370-40d2eaf7 |

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
