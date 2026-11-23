# Tablero de la migración de flujos a `Flujos/clientes/` (etapa 0, 12/11/2026)

Una fila por cada flujo de producción del disco (`flujosDeProduccion()`: todo JSON de flujo de `Flujos/` sin las
copias `.prueba` ni `.ensayo-demo-a`). `admin/pruebas/core/migrado.test.ts` lee ESTA tabla: exige una fila por flujo
del disco y viceversa, y aplica la definición de «migrado» (`docs/arquitectura/migrado.md`, M1 a M7) a las filas en
estado `mudado`. Una mudanza **nunca publica**: mueve la carpeta con `git mv` y no cambia un byte del JSON.

| JSON | carpeta | clase | constructor | falta | dueño | estado | huella |
|---|---|---|---|---|---|---|---|
| agendamiento-seguimientos.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | c039d03f-88791851-87075e25-fc074372-5d27322f-3c23c47c-643a7f60-2d6abeb7 |
| agendamiento-senas-vencidas.json | . | barrido | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 1806d41f-c793a4d9-30686e10-c5517a52-1a6380b3-9fba0385-1bd22676-8f7989d2 |
| bellido-agendamiento.json | . | congelado | ninguno | M1 M2 M6 | por asignar (Principal) | pendiente | 0fc6574f-6e6378e1-1100446e-67de0fe5-aeb46070-88179be6-f2dcaa21-14d2c8d4 |
| demo-a-agendamiento.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | 6feb51cb-72895440-f4ff787c-57159818-fcb97b53-e14eb5c3-b9356e56-de355a19 |
| demo-a-recordatorios.json | . | demo | ensamblador | M1 | por asignar (Principal) | pendiente | 7d06ea44-1c362f84-bae2afe3-e7a2a521-b2c865cc-a3736245-ae83472d-22988404 |
| demo-b-venta-cobro.json | . | demo | ensamblador | M1 M6 | por asignar (Principal) | pendiente | c0f879b9-1b79090e-adea89fd-284d7ac7-bd5ec3d5-4d9ac08e-9685db0a-8666d0ac |
| error-envio-incierto.json | . | barrido | ensamblador | M1 | por asignar (Principal) | pendiente | 22400c1d-0c278bb7-22a0600e-8ff6a382-34c19434-c38b5952-64e66371-347b13be |
| novuchat-onboarding.json | . | congelado | ensamblador | M1 M6 M7 | por asignar (Principal) | pendiente | 01d3388b-eb92e2a3-e8beb89d-4e6a1155-14d01b1a-5e5d8c9b-a8aea1d5-62e941b9 |
| salida-de-persona.json | . | barrido | ensamblador | M1 M7 | por asignar (Principal) | pendiente | df529a8a-b5f09840-fd0f0d7b-015aaba3-53c203b6-c62ff10a-095291fd-af8e27bd |
| latido-n8n.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 2f4160a4-4f1447ee-bf929d0f-1006e97d-8cc2e711-cb09925a-7ba38cb0-4e84282f |
| vigilancia-numero-demos.json | . | barrido | ninguno | M1 | por asignar (Principal) | pendiente | 61960cd3-54681464-e3f0231d-d5500e9a-4958ae84-8038d63c-81b5ed09-6f51c6e4 |
| qtaco-redireccion.qtaco.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | fc15d011-187bf6ca-061f3cf1-bff34e5e-bc264f32-1386e9c9-a727f0d8-71cae22d |
| qtaco-redireccion.qtaco-ruta-nueva.json | clientes/qtaco-redireccion | sin publicar | construir.mjs | M4 M7 | por asignar (Principal) | pendiente | f3765615-bf165adb-f4a40bf9-dd4a6f3b-e95d6594-45ddfb9d-7aad41ae-9699709a |
| agenda-minima.v0.json | clientes/agenda-minima | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 40bed26c-261321d3-933b36bd-f714eb0a-c71aa739-acabbb05-106b042b-cb6a5a88 |
| captacion-minima.novuchat.json | experimental/captacion-minima | congelado | construir.mjs | M1 M4 M5 M6 | por asignar (Principal) | pendiente | 9c8c2f24-e40f1335-d0902848-1efd2756-c904bbaa-54e425f6-9dd41de8-8dfc864b |
| casa-bermejo.json | clientes/casa-bermejo | sin publicar | construir.mjs | M4 M5 (excepción declarada) | por asignar (Principal) | mudado | d3ab98f6-145cfee7-16718385-937ca6a5-c9e00f44-3dc77fb9-29c7cf5d-0f228b10 |
| chat-novuchat.novuchat.json | clientes/novuchat | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | 9d9ed97e-f4a7e733-d87d9d7b-2b29e6ed-cee9e960-b2d98900-18c55b4f-6c9159de |
| doctoras.rroca-emma.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | 62c3037b-50dcfcad-548dd931-f4582a02-31ebdfaa-c49ece4a-788b6896-4c9c67b8 |
| doctoras.rroca-evy.json | experimental/doctoras | congelado | construir.mjs | M1 M4 M5 M6 M7 | por asignar (Principal) | pendiente | df74b4d9-bc122538-9c6deafc-2a2ed8f2-ff285eb7-74356bb8-584ccbd3-2b956a16 |
| recordatorio-bellido.v1.json | experimental/recordatorio-bellido | demo | ninguno | M1 M2 M7 | por asignar (Principal) | pendiente | 64289535-4c20a3b1-19b0ab05-b8f97460-a209e62a-b87b132a-ae0d06ff-3c9bb15a |
| rescate-22h.rroca-ruben.json | experimental/rescate-22h | sin publicar | construir.mjs --todos | M1 | por asignar (Principal) | pendiente | 30961db8-930cda05-5d3d5992-9d1c66e1-a061bf32-8d1918ac-9edc5daa-62dda067 |
| rroca-antonio.json | clientes/rroca-antonio | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 920df70b-cd302cef-1f0c0474-2849277f-6e12ff0a-ef480158-422a61a3-dd891100 |
| rroca-emma.json | clientes/rroca-emma | vivo | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | 42310705-5a15f119-243b44f4-e2d53ebd-530f4276-0f985f8f-2a59bd30-63431957 |
| rroca-evy.json | clientes/rroca-evy | vivo | construir.mjs | M4 M6 (excepción declarada) | Rearquitectura | mudado | cb884e7e-ab373aa8-f49129aa-8592cbd8-a5f43b93-e884abfb-1a4406fd-68cf0216 |
| rroca-ruben.json | clientes/rroca-ruben | vivo | construir.mjs | M1 M4 M5 M6 | Rearquitectura | mudado | c4d17749-e14267ff-1de9bb48-d0d59662-b390c313-b924b9f1-571716dc-0f18fe48 |
| venta-minima.qtaco-3727.json | clientes/venta-minima | sin publicar | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 161c073f-cc7878a6-2825f407-4607b5f8-3a234e87-48a20549-1f7ccd89-b7602bc3 |
| venta-minima.qtaco.json | clientes/venta-minima | vivo | construir.mjs | M4 M5 M6 (excepciones declaradas) | Rearquitectura | mudado | 19a773cf-e9f35fc5-9f8a4539-84e5fcee-011706d6-4efb59aa-7de019f2-9f8806e6 |
| walisuma.json | clientes/walisuma | sin publicar | construir.mjs | M4 M5 (excepción declarada) | Rearquitectura | mudado | f31e7d0b-93ee739a-cf1d99e8-ea258bc2-b261c5af-bdf2e29a-6e72af66-99973b3e |

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
- **huella**: sha256 del JSON versionado en main (medida el 12/11/2026; el 14/11/2026 se actualizaron cuatro filas: agenda mínima, chat NovuChat y los dos de venta mínima; el 21/11/2026, doce filas por el indicador de escritura: los dos demos y los diez flujos de cliente con modelo, ver `Flujos/src/core/indicador/`), en hexadecimal y en 8 grupos de 8 caracteres separados por guion (la
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
- Las filas de los barridos sin constructor (`agendamiento-*`) y de `recordatorio-bellido.v1.json` son JSON editados a mano.
