# Traspaso del chat interno a otro portafolio y otro número — retoma

> **<TENANT>:** `novuchat`, el chat de captación de la propia NovuChat. Es la
> instancia sobre la que se valida; el módulo es «mover el canal de un comercio
> a otro portafolio y otro número sin tocar el flujo», y vale para cualquier
> cliente que traiga su portafolio. Su configuración vive en
> `~/NovuChat/CLIENTES/NOVUCHAT/` (no versionada) y en `.env.novuchat`.

Eres la sesión dedicada a terminar el traspaso del chat interno de NovuChat:
del portafolio `NovuChat Produccion` y el número 78567326 al portafolio
`NovuChat` de Silvana y el número 76988663, con app y usuario de sistema
propios en el portafolio de ella. Las decisiones están en
`CLIENTES/NOVUCHAT/traspaso-tech-provider.md` (cabecera, §1 y §8) y en
`ESTADO.md` (entrada del 24/09); este prompt las ejecuta.

**ANTES DE TODO: Andres detectó un error de arquitectura al cerrar la sesión
del 24/09 y no lo describió.** Tu primer mensaje le pide que lo explique, y
no se ejecuta nada en Meta, en n8n ni en la plataforma hasta que esté
resuelto o Andres diga que no afecta a este frente. Lo que decida se anota en
el procedimiento del cliente y en `ESTADO.md` antes de seguir.

Lee primero, en este orden: `CLAUDE.md` entero, `ESTADO.md` (24/09, «el chat
interno de NovuChat pasa al portafolio de Silvana»), y después:
- `~/NovuChat/CLIENTES/NOVUCHAT/traspaso-tech-provider.md` — el procedimiento
  entero: §0 lo que se mueve, §1 decisiones tomadas, §3 fase 1 (Meta, entorno,
  plantilla), §4 fase 2 (el corte, minutos), §5 pruebas reales, §6 rollback,
  §8 Tech Provider para después.
- `~/NovuChat/CLIENTES/NOVUCHAT/estado.md` — la tabla del traspaso, con lo
  hecho y lo pendiente.
- `~/NovuChat/CLIENTES/PLATINUM/pase-a-produccion-waba-propia.md` — el
  precedente (camino B, 21/09); acá es más simple porque el número cambia.
- `docs/pase-a-produccion/RUNBOOK.md` §2 — la fila del caso.
- Memorias `traspaso-chat-interno-a-tech-provider`,
  `meta-alta-de-numero-tropiezos`, `webhook-de-meta-no-se-da-de-alta-solo`,
  `publicar-solo-desde-main`, `ensayo-antes-de-produccion`.

La rama `claude/novuchat-silvana-transfer-c40177` tiene el trabajo del 24/09
(scripts nuevos, el filtro por número en el flujo con su prueba, runbook,
`ESTADO.md`, `CONFIGURACION.md`). Si no está en `main`, tu primera tarea
técnica es el push y el PR, con el «sí» de Andres, y fusionarlo antes de la
fase 2: **el flujo cambió, y un flujo se publica solo desde `main`**.

## Las decisiones que no se tocan
1. **La app y el usuario de sistema van en el portafolio de Silvana**, no en
   AAB1. AAB1 tiene una restricción de Meta que impide crear usuarios de
   sistema y compartir activos hacia socios (leído en modo lectura en el otro
   proyecto de AAB1, `docs/24` y su bitácora del 19 al 23/09). No se vuelve a
   intentar por AAB1 hasta que ese proyecto tenga un token que opere WABAs de
   clientes.
2. **La app `AAB1-WA-Prod` no se toca** (prohibición 5: es la app de producción
   del otro sistema). Si algún día se usa como Tech Provider, el webhook va **a
   nivel de WABA** (`webhook-meta.sh --alta-waba`), nunca el de la app.
3. **El flujo de captación `ayMDHHBXRREgT8gR` es el mismo.** Cambian los
   valores de sus dos credenciales, el `phoneNumberId` de `Config base` y el
   webhook. El filtro por `phone_number_id` (condición c3 de `¿Es un
   mensaje?`) se queda: por una app compartida pueden entrar eventos de otros
   números.
4. **El número de recepción sigue siendo el de Silvana** (…1250). 78567326 se
   queda registrado en su WABA y solo se desuscribe la app vieja
   (`verificar-meta.sh --desuscribir`, reversible con `--suscribir`).
5. **La plantilla `solicitud_contacto` se vuelve a pedir en la WABA de Silvana
   con el mismo texto** (§3.4 del procedimiento, con encabezado, 6 variables,
   pie y 12 h). El corte puede ir antes de la aprobación: el chat funciona;
   lo que falla hasta entonces es el aviso interno.
6. **Silvana carga su tarjeta en su WABA.** Meta le factura a quien tenga el
   método de pago en esa WABA; el número nuevo estrena su franquicia de 1.000.
7. **Costo en mensajes: 0.** Cambia el número que emite, no cuántos salen.

## Reutilizar antes de escribir
**Consulta primero `~/Claude-Proyectos/proyectos/`.** Todo lo que este frente
necesita ya existe: `configurar-cliente.sh`, `verificar-meta.sh`
(`--suscribir`, `--desuscribir`), `registrar-numero.sh`,
`listar-plantillas.sh --texto`, `crear-plantilla.sh --encabezado/--pie`,
`actualizar-credenciales-cliente.sh`, `preparar-import.sh`,
`publicar-flujo.sh`, `webhook-meta.sh` (`--ver-meta`, `--ver-waba`,
`--preparar`, `--alta-meta`, `--cerrar`), `marcador-local.sh`,
`admin/scripts/asignar-numero.mjs --reemplaza`, `credenciales-flujo.sh`,
`ver-ejecuciones.sh`. No se escribe ningún script nuevo sin decir en el chat
por qué ninguno de estos alcanza.

## Cómo trabajar
- Worktree y rama propios en `.claude/worktrees/`; un PR contra `main`; nunca
  cambiar de rama en la carpeta principal ni `git add -A`. `CLIENTES/` y los
  `.env` viven solo en la carpeta principal (`--dir ~/NovuChat`).
- Andres autoriza; tú operas. Cada escritura en Meta, n8n o la plataforma va
  después de su «sí» en el chat, y se reporta el resultado real. Lo único de
  Andres: las pantallas de Meta (§3.1) y escribir, ocultos, el token, el App
  Secret y el PIN en `configurar-cliente.sh` corrido en su terminal.
- Ningún secreto en el repositorio ni en el chat. Identificadores por últimos
  4. `CONFIGURACION.local.md` no se imprime.
- **Antes de cada `--aplicar`, el diagnóstico en seco leído entero.** El
  clasificador de permisos negó el 24/09 el seco de
  `preparar-import.sh` + `publicar-flujo.sh` y un `curl` suelto sobre un
  `.env`: se corren con el OK explícito de Andres, o desde su terminal.
- Resultado real con teléfono, anotado en `CLIENTES/NOVUCHAT/aceptacion.md` y
  en la tabla de `estado.md`; `ESTADO.md` al cerrar.

## Qué hacer, en orden
### Fase 0 — El error de arquitectura
Pedirlo, entenderlo, decidir con Andres si cambia algo de las decisiones 1 a
7, y anotarlo. Sin esto no se pasa a la fase 1.

### Fase 1 — Preparar, con el asistente actual funcionando (§3)
[Persona] app nueva, usuario de sistema con app y WABA, token sin vencimiento,
App Secret, Publicar, tarjeta. [Claude] respaldo del entorno
(`.env.novuchat.respaldo-<fecha>`), `configurar-cliente.sh` en la terminal de
Andres, `--ver-meta` (tiene que decir «ninguna»), `verificar-meta.sh` con
`--suscribir` si hace falta, `registrar-numero.sh --estado` (y `--registrar`
con el PIN si no está `CONNECTED`), plantilla en seco y `--aplicar`.
**Costo:** 0. **Prueba:** tres verdes y la plantilla en revisión.

### Fase 2 — El corte, de corrido, desde `main` (§4)
Fila `REEMPLAZAR_PHONE_NUMBER_ID_NOVUCHAT` con `marcador-local.sh`,
`preparar-import.sh` (comparar los últimos 4 del `phoneNumberId`),
`actualizar-credenciales-cliente.sh --aplicar`, `publicar-flujo.sh` en seco
leído entero y `--aplicar`, `--apagar` → `webhook-meta.sh --preparar` →
`META_VERIFY_TOKEN` generado al azar en el `.env` → `--alta-meta` → `--cerrar`,
`verificar-meta.sh --env .env.novuchat.respaldo-<fecha> --desuscribir`,
`asignar-numero.mjs --reemplaza` en seco y `--aplicar` (credenciales de
`~/.config/gcloud-novuchat-prod`; el proyecto es su `quota_project_id`),
`verificar-meta.sh` con cuatro verdes y `credenciales-flujo.sh`.
**Costo:** 0. **Prueba:** cuatro verdes; ninguna credencial de ingesta en un
nodo de envío.

### Fase 3 — Pruebas reales (§5)
«Hola» al 76988663 con nombre visible «NovuChat»; la captación hasta el cierre
con el aviso a recepción (cuando la plantilla esté `APPROVED`); «Hola» al
78567326 sin respuesta; la conversación en la consola del comercio
`novuchat`; `ver-ejecuciones.sh` sin errores. Resultado real en
`aceptacion.md`. Si falla la primera, rollback (§6) antes de seguir.

### Lo que NO se construye ahora (y por qué)
- **Tech Provider con `AAB1-WA-Prod`**: AAB1 no puede emitir un token que
  opere la WABA de Silvana (decisión 1). Queda escrito en §8 del
  procedimiento y los scripts ya lo contemplan (`--alta-waba`, `--ver-waba`).
- **Enrutador por `phone_number_id` en n8n** (`Analisis/20` nivel 3): recién
  cuando haya una app compartida entre clientes.
- **Cambios al sitio**: publica el contacto directo, no el número del
  asistente. Si Andres quiere que lleve al asistente, es de la sesión del
  sitio.
- **Baja del 78567326**: se queda; borrar no aporta y quita el rollback.

## Entregables al cerrar
- PR de la rama del 24/09 fusionado antes de la fase 2; un PR más solo si
  cambia código.
- `CLIENTES/NOVUCHAT/estado.md` y `aceptacion.md` con el resultado real de
  cada fase; `CONFIGURACION.md` §1.b y `CONFIGURACION.local.md` con el
  portafolio, la app, la WABA y el número nuevos.
- `ESTADO.md` con la jornada; la ficha en
  `~/Claude-Proyectos/proyectos/NovuChat.md` si cambió un módulo reutilizable
  (los scripts de plantillas y de webhook por WABA lo son).
