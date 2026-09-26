# Coordinación: la rearquitectura por capas (F-1 a F6, E y S)

> Tablero de la sesión **operadora** (`Prompts/rearquitectura-por-capas.md`),
> reescrito desde cero el 25/09/2026 para este frente. El tablero anterior
> (prepago y modularización, del 20 al 25/09) vive en la historia de git de
> este archivo; lo que seguía pendiente de él está en «Heredado» al final.
> Se actualiza en cada cambio de estado. Sin secretos ni identificadores.
> Fechas en absoluto. El plano es `Analisis/41-arquitectura-por-capas.md`.

**Base de trabajo:** `origin/main` en `061e20b` (25/09/2026, `v0.9.0` en
producción). Cada bloque nace de `origin/main` en un worktree dentro de
`.claude/worktrees/`. La copia principal `~/NovuChat` está en `main` y **no
se opera nada desde ahí**.

**Las tres sesiones** (`Analisis/41` §8.5): esta (operadora), las de clientes
(`Prompts/operacion-de-clientes.md`, una por comercio, bajo el congelamiento
del §12.10) y la revisora (`Prompts/revision-de-hitos.md`). Los informes de
hito de abajo son lo que Andres le pega a la revisora.

## Tablero de fases

| Fase | Qué | Estado | Cierra |
|---|---|---|---|
| **F-1** Cierre de las nueve sesiones | Hotfix (memoria y candado), cinco ramas de documentación, traspaso, origen del anuncio, ayudante, worktrees, matriz, este tablero, los primeros commits; más los dos hallazgos del ensayo (#196, #197) | **cerrada el 26/09** | H0 (con E) |
| **E** Estándar DevSecOps 2.4 | Reusable 2.4, cabeceras del 22/09, fusión de tres vías de dos copias con lo propio | **bloque 1 en PR #191** (25/09): siete copias al nivel de `702f2da`; pruebas del estándar, actionlint, ShellCheck, validador y `security-local.sh` iguales antes y después. Se fusiona después de F-1 |
| **F1** Ejes de la cuenta y consola del propietario | `modalidad`, `titularidad`, `modelo`, `cambiosIncluidos`, renombres, `asignar-plan`, migración de los tenants reales, Negocios (A-3b) | **en obra desde el 26/09**: H0 pasó; agentes `central` (`central/ejes-de-la-cuenta`) y `plataforma-consola` (`plataforma/negocios-tres-ejes`) | H1 |
| **F6** Método | `docs/arquitectura/`, bitácora por mes, estado generado, `CLAUDE.md` con invariantes, gancho por carpeta, agentes por zona, `analista-de-solicitudes`, `CICLO-DE-VIDA.md` | **en obra desde el 26/09**: agente `metodo` (`metodo/…`, varios PR; `ESTADO.md` y `CLAUDE.md` en el último) | H6 |
| **S** Staging | Proyecto de staging, `desplegar-staging` y `dast-y-humo` en verde | **en obra desde el 26/09**: agente `deploy` (`staging/proyecto-y-pipeline`) prepara todo sin escribir en la nube; cada escritura se pide a Andres una por una. **Cierra antes de la etiqueta de F1** | H3 |
| **F2** Carpetas, registro y frontera | Diseño del registro primero; mover sin lógica; `fronteras` y `registro` en CI; `tenants.modulos`; límite de agendas | espera H1 | H2 |
| **F3** Core unificado | Ganchos; una variante de los nodos comunes; medios en el core; prompt por capas; suites sin `new Function` | espera H2 | H3 |
| **H4** Aceptación y pase de Platinum | Lo cierra la sesión de clientes | espera H3 | H4 |
| **F4** Conector de canal ∥ **F5** Tenants como datos | Receptor y `enviar` fuera de n8n; Bellido como módulo | esperan H4 | H5 |

## Cola de fusión (F-1), en orden

Cada paso escribe en GitHub y necesita el «sí» de Andres. Lo que está
«listo» ya tiene commit local, suites en verde y revisión de seguridad.

| # | Bloque | Rama | Estado (25/09) | Costo |
|---|---|---|---|---|
| 1 | Hotfix: `deleteMode` y hueco del candado, tres flujos de reservas | `cierre/hotfix-memoria-y-candado`, **PR #186, fusionado el 25/09** | 1076 pruebas de flujos + suite completa 3266 en verde; seguridad aprobado con 2 observaciones atendidas. Falta: **ensayo en el Demo A** y **publicación de los 3 flujos en la ventana de 02:00 a 03:00** (atraso declarado en `docs/versiones-por-cliente.md`) | 0 mensajes; 1 PR; 3 publicaciones |
| 2 | Cinco ramas de documentación, en este orden: `estado/v0.9.0` (#182, más el commit local con `Prompts/capacidades-comunes.md`, que hay que subir) → `prepago/tablero-al-dia` (#183) → `cierre/traspaso-25-09` (#185) → `claude/topes-campanas-confirmados` (**#189**) → `docs/planes-a-medida` (#184) | las cinco | **fusionadas el 25/09 en ese orden** (#182, #183, #185, #189, #184). A #185 y #184 se les trajo `main` a la rama resolviendo `ESTADO.md` y `Prompts/LEEME.md` con la receta que conserva los dos lados | 0 mensajes; 5 fusiones, 1 push, 1 PR nuevo, hasta 3 pushes de resolución |
| 3 | Traspaso del chat interno | `claude/novuchat-silvana-transfer-c40177`, **PR #187, fusionado el 25/09** | 138 pruebas de captación, saneo 0, identidad ok. Los pasos de Meta: sesión de clientes de NovuChat | 0 mensajes; 1 push, 1 PR |
| 4 | Origen del anuncio | `medicion/origen-del-anuncio`, **PR #188, fusionado el 25/09** | `main` fusionado dos veces sin reescribir la rama (la segunda, ya con el hotfix adentro: 1409 pruebas de flujos en verde), `origen` derivado del objeto `anuncio`, suite completa 3285 en verde, saneo 0. Las Functions entran con la siguiente etiqueta | 0 mensajes; 1 push, 1 PR |
| 5 | Ayudante de configuración | `claude/ai-config-helper-e3b434` | **diseño guardado** como `Analisis/42` (en `cierre/25-09`). Falta: borrar la rama remota, con OK | 0 |
| 6 | Worktrees colgados | `novuchat-byoc-pricing-4e0c69` (origen), `novuchat-modularization-0fc59d` (tablero), `optimistic-fermi-a6a02d` (traspaso), `planes` | se quitan después de fusionar sus ramas; los de esta sesión (`cierre-25-09`, `hotfix`, `origen-anuncio`, `traspaso`, `cola-docs`) se quitan al cerrar F-1 | 0 |
| 7 | Matriz de capacidades (anexo A de `Analisis/41`) | `cierre/25-09` (`b768b0c`) | **hecho**: `Analisis/41-anexo-A-matriz-de-capacidades.md`; ninguna brecha es regresión, todas van a F3 | 0 |
| 8 | Este tablero | `cierre/25-09` | **hecho** | 0 |
| 9 | `Analisis/41` y los tres prompts | `cierre/25-09`, **PR #190** | **en PR**, con `Analisis/42`, el anexo A y este tablero; `main` traído a la rama (este tablero reemplaza al anterior, que #183 había actualizado; `LEEME.md` conserva las dos filas) | 0 mensajes; 1 push, 1 PR |

**Autorización general de Andres (25/09):** push y apertura de PR sin pedir OK
por cada uno; fusionar, ensayar, publicar, desplegar y Meta siguen con «sí»
por acción.

**Decidido por Andres (25/09, tarde):** fusionar en el orden de la cola con CI en verde; el comprobante en simulado del Demo B va en PR propio; la excepción de `uuid` se corrige. Queda por decidir `ruta` (recomendación abajo). Antes se preguntaba si el comprobante en simulado del Demo B (`Analisis/41` §7.1 lo
manda «con el hotfix», el prompt acota el hotfix a los tres flujos de
reservas) entra en este PR con una cuarta publicación o va en un PR propio.

## Cola de ensayo (número del Demo A)

Un ensayo a la vez (`Analisis/41` §12.9). Se anota antes de correr
`ensayo.mjs --preparar`, y se cierra con `--restaurar` de los dos scripts.

| Cuándo | Qué se ensaya | Con qué JSON | Estado |
|---|---|---|---|
| 26/09 00:37–00:43 | Hotfix de memoria y candado | El propio Demo A, publicado desde `main` (`0655cd3`): es uno de los tres flujos | **hecho por Andres**: reserva buena #6054/#6059 (`agendarSinEvento: false`, id anclado, verificada); cruce #6063 (candado, `Olvidar turno fallido` `{success: true}`, reintento con alternativas); memoria conservada #6067/#6082. «¿Eres un robot?» no se hizo. Dos hallazgos previos: falso «duplicadas» por título (#6072) y **cancelación de la cita equivocada** (#6086/#6091), ver `ESTADO.md` |

## Informes de hito

### H0 — F-1 y E (cerrado el 26/09/2026, madrugada; para la revisora)

**PR y sha fusionados en `main`, en orden:** #186 (hotfix `deleteMode` y
candado), #182, #183, #185, #189, #184 (cinco de documentación), #187
(traspaso), #188 (origen del anuncio), #190 (plano, prompts, anexo A,
`Analisis/42`, tablero), #191 (E, estándar 2.4), #192 (Demo B comprobante en
simulado), #193 (`uuid`), #194 (registro de versiones), #195 (asiento de F-1),
#196 (duplicadas por título y hora), #197 (hotfix de cancelación). `main` en
`e02a756`. Las nueve sesiones del 25/09 cerradas; la del ayudante sin fusionar,
con su diseño en `Analisis/42`; once más dos ramas remotas borradas; worktrees
colgados quitados.

**Publicado desde `origin/main`**, cada uno con el seco leído entero,
credenciales heredadas y ninguna corregida, respaldo en `Flujos/respaldo-*`:
Demo A, Demo B y captación (desde `0655cd3`, 25/09 20:10); Platinum y Bellido
(`0655cd3`, 26/09 00:55, fuera de la ventana por decisión de Andres: nadie está
en modalidad producción); los tres de reservas de nuevo desde `e02a756`
(26/09 01:3x) con #196 y #197. **`estado-de-versiones.sh`: 8 de 8 al día.**

**Pruebas, con números reales:** hotfix 1076 de flujos + suite completa 3266;
origen 3285; `uuid` 3301; cancelación 1119 de flujos + suite completa 3342
(5 de `pagos.test.ts` por tiempo del cobrador; sola, 60/60); duplicadas 965;
estándar: suites del reusable iguales antes y después, `security-local` 2.5
aprobado, primer run de `main` verde. **Ensayo real de Andres en el Demo A**:
#6041 a #6098 (tabla en `ESTADO.md` del 26/09): reserva buena con
`agendarSinEvento: false` y el id anclado (#6054, #6059); cruce, borrado,
`Olvidar turno fallido` `{success: true}` y reintento con alternativas (#6063);
memoria conservada (#6067, #6082). «¿Eres un robot?» queda para la aceptación.

**Costo en las tres unidades:** 0 mensajes por conversación (y −1 aviso falso
a recepción en el caso de duplicadas); 16 fusiones, 12 PR propios y unas 25
corridas de CI; 8 publicaciones en n8n; 0 despliegues (las Functions del
origen del anuncio y de `uuid` entran con la próxima etiqueta).

**Lo que quedó fuera y por qué:** `pedidos.md`, cláusulas de Q'Taco y
Dhermacore, limpieza del calendario de Bellido y Meta de Platinum son de las
sesiones de clientes (§8.5); el ensayo por `ensayo-flujo.sh` no hizo falta
porque el Demo A es uno de los tres flujos; las citas de prueba del 26/09 en el
calendario del demo (corte 10:00 y 14:00) quedan hasta que se borren a mano.

**Lo que se encontró mal o incompleto en `Analisis/41`:** (1) §7.1 mezcla en
F-1 tareas de las sesiones de clientes; (2) §7.1 ubica el conflicto del origen
en `normalizar-entrada.js` y estaba en los tres JSON (el módulo fusionó solo);
(3) §7.1 pone «comprobante en simulado con el hotfix» y fue PR propio; (4) el
plano no prevé **estado por teléfono en n8n** como barrera por hecho
(`$getWorkflowStaticData`): #197 lo necesitó, y en F3 conviene decidir si ese
estado vive en el servidor (`configuracionFlujo` ya recibe `telefono`).

**Hallazgos para F3 (anexo A y ensayo):** medios y transferencia en Demo B y
captación; prohibición 4 solo en el prompt en reservas; ids de credencial en
Demo A y Demo B; concurrencia de datos estáticos y `.first()` (riesgos
aceptados en `ESTADO.md`).

**Decisiones de Andres en este hito:** push y PR sin pedir OK (25/09); fusión
en orden con CI en verde; Demo B en PR propio; corregir `uuid`; publicar sin
ventana mientras nadie esté en producción; `ruta: '.'` se mantiene
(recomendación aceptada por omisión: se revisa en F6).

**Lo que le toca a Andres:** pegar este informe en la sesión revisora y, con su
veredicto, autorizar F1 (con S y F6 en paralelo).

## Heredado del tablero anterior (prepago y modularización), y adónde va

| Pendiente al 25/09 | Adónde va en este frente |
|---|---|
| **A-3b** consola del propietario (pago manual con evidencia, suspender, umbrales, corte) | **F1** (`Analisis/41` §7): la página Negocios de Plataforma |
| **A-4** intención «pagar / estado» por el WhatsApp interno | Fuera de este frente; se retoma como módulo después de F3, con la verificación del titular de cada teléfono de pago |
| **A-5** presentar a Meta las ocho plantillas de cobranza (`docs/plantillas-cobranza.md` §7), ampliando antes `crear-plantilla.sh` | Fuera de este frente; trámite de Meta, en paralelo, con OK por acción. El traspaso (paso 3) amplía `crear-plantilla.sh` con encabezado y botón |
| **B-2** el resto de los flujos al ensamblador (Demo B, captación, Bellido) | **F2**: `ensamblar-flujo.mjs extraer` de Demo B y captación; Bellido en **F5** |
| **B-3** el corpus del sitio fuera del nodo Code | **F3** (y su alarma de huella que no corre en CI, antes de moverlo) |
| **B-4** runbook etapa 5, agente `flujos-n8n`, gancho de pre-commit | **F2** (gancho que exige `verificar`) y **F6** (agentes por zona, runbook) |
| **C** contrato del cobrador (otro proyecto): cuenta `novuchat`, URL pública, `rotar-cobrador.sh` | Fuera de este frente; su proyecto |
| Encender el corte del prepago (`fijarCortePrepago`) | Decisión de Andres después de un pago de punta a punta; **F1** deja el botón en Negocios |

## Reglas para F1 (recomendaciones de la revisora sobre H0, 26/09)

- **S cierra antes de la etiqueta de F1.** Ese despliegue es el primero desde
  `v0.9.0` y carga las Functions del origen del anuncio y `uuid` 11 en el
  runtime, que nunca corrió en la nube: aterriza primero en staging. Si S no
  llega, `firebase deploy --dry-run` en la aprobación y verificación de las
  Functions HTTP después (memoria de despliegues).
- **Migración de los ejes:** contar primero los tenants reales en Firestore,
  seco leído entero, aplicar, releer. Los seis del plano son una estimación.
- La sesión de **Platinum** se abre en paralelo con `Prompts/operacion-de-clientes.md`:
  H1 es lo que espera para escribir plan, modalidad y titularidad; Meta es de
  calendario.
- Copia principal al día (`988c223`), ramas locales fusionadas borradas (156),
  citas de prueba del 26/09 borradas por Andres.

## Decisiones abiertas para Andres (E, del relevamiento)

- `ruta: '.'` con el `package.json` en `admin/`: la auditoría nativa de pnpm se
  salta y solo Trivy cubre `admin/`; pasar a `./admin` la activa pero crea
  categorías nuevas de Code Scanning. No lo cambia el bloque 1.
- La excepción de Trivy por `uuid` (CVE-2026-41907, hoy MEDIUM, inerte con
  `bloquear_en: CRITICAL,HIGH`) vence el 31/10. El PR #11 de Dependabot
  (`firebase-admin` 14) **no la cierra**: `uuid@9` sigue por `firebase-tools`.
  Lo que la cerraría es un `firebase-tools` con `gaxios ≥ 7` o un
  `pnpm.overrides`. Además #11 tiene `construir` en rojo y está desactualizado.
- Para SeguridadGeneral (no se arregla desde acá): `security-local.sh` del
  estándar sigue con `cd "$RUTA"` sin `|| exit 1`; el de NovuChat lo tiene.

## Bitácora del frente

- **25/09/2026** — Arranca la sesión operadora. Leído el plano y los prompts.
  Hotfix construido y probado (memoria: `lastN` verificado contra el paquete
  de n8n; candado cerrado por hecho cuando `agendar_cita` corre sin devolver
  cita); fusión de `main` en el origen del anuncio resuelta; diseño del
  ayudante guardado; cola de documentación simulada; traspaso verificado.
  Todo en local, a la espera del primer punto de control con Andres.
- **25/09/2026 (tarde)** — Andres autoriza push y PR en general. Subidas las
  cinco ramas y abiertos **#186** (hotfix), **#187** (traspaso), **#188**
  (origen), **#189** (topes), **#190** (documentación); #182 recibió el commit
  del prompt de capacidades. Anexo A entregado. Relevamiento de E cerrado;
  bloque 1 de E en construcción con el agente `devsecops`.
- **25/09/2026 (noche)** — Andres autoriza fusionar en orden con CI en verde.
  Fusionados **#186, #182, #183, #185, #189, #184, #187, #188**, en ese orden;
  cuatro de ellos recibieron `main` con la receta de conservar los dos lados.
  #190 y #191 abiertos. Decisiones de Andres: Demo B en PR propio; corregir
  `uuid`; `ruta` pendiente de recomendación.
- **26/09/2026 (madrugada)** — #191, #192 y #193 fusionados; ramas remotas
  borradas. Publicados Demo A, Demo B y captación desde `0655cd3`. Andres
  verificó el hotfix en el Demo A (#6041–#6098): memoria conservada, candado y
  reintento en orden. Dos hallazgos previos al hotfix, anotados en `ESTADO.md`.
  Falta la ventana de 02:00 a 03:00 para Platinum y Bellido.
- **26/09/2026 (madrugada, 2)** — Andres autoriza fusionar #196 y #197 y
  publicar los tres flujos de reservas: hecho desde `e02a756`, 8 de 8 al día.
  #191 y #193 fusionados antes. **H0 cerrado**: informe arriba, para la
  revisora.
- **26/09/2026 (mañana)** — La revisora da por pasado H0 con cinco
  recomendaciones (arriba). Arrancan **F1** (dos agentes), **S** y **F6**,
  cuatro worktrees desde `origin/main` (`988c223`).
