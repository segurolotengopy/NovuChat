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
| **F-1** Cierre de las nueve sesiones | Hotfix (memoria y candado), cinco ramas de documentación, traspaso, origen del anuncio, ayudante, worktrees, matriz, este tablero, los primeros commits | **en curso (25/09)**: todo preparado en local; espera los «sí» de la cola de fusión | H0 (con E) |
| **E** Estándar DevSecOps 2.4 | Reusable 2.4, cabeceras del 22/09, fusión de tres vías de dos copias con lo propio | **bloque 1 en PR #191** (25/09): siete copias al nivel de `702f2da`; pruebas del estándar, actionlint, ShellCheck, validador y `security-local.sh` iguales antes y después. Se fusiona después de F-1 |
| **F1** Ejes de la cuenta y consola del propietario | `modalidad`, `titularidad`, `modelo`, `cambiosIncluidos`, renombres, `asignar-plan`, migración de seis tenants, Negocios (A-3b) | espera H0 | H1 |
| **F6** Método | `docs/arquitectura/`, bitácora por mes, estado generado, `CLAUDE.md` con invariantes, gancho por carpeta, agentes por zona, `analista-de-solicitudes`, `CICLO-DE-VIDA.md` | espera H0; en paralelo con F1 | H6 |
| **S** Staging | Proyecto de staging, `desplegar-staging` y `dast-y-humo` en verde | espera H0; en paralelo con F1 y F2; antes del ensayo de F3 | H3 |
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
| pendiente de OK | Hotfix de memoria y candado | `platinum-agendamiento.json` de `cierre/hotfix-memoria-y-candado` sobre el Demo A (mismos nodos comunes que los tres) | por hacer: una reserva exitosa (comprobar `agendarSinEvento: false` con el id en la ejecución), un cruce con reintento (comprobar que la memoria conserva la conversación), «¿eres un robot?» |

## Informes de hito

### H0 — F-1 y E (en preparación)

Se completa al cerrar: PR y sha fusionados; pruebas con números reales e
identificadores de ejecución del ensayo; costo en las tres unidades; lo que
quedó fuera y por qué; lo que se encontró mal en `Analisis/41`.

**Lo que ya se encontró mal o incompleto en `Analisis/41`, para la revisora:**

- §7.1 lista, entre lo que F-1 absorbe, «`pedidos.md` de Bellido y Platinum»,
  «lista de cláusulas sobre las propuestas de Q'Taco y Dhermacore», «limpieza
  del calendario de Bellido» y «arranque en Meta de Platinum y del traspaso».
  El prompt de la operadora (§8.5: «esta sesión no atiende pedidos de
  clientes») los excluye y los asigna a las sesiones de clientes
  (`Prompts/operacion-de-clientes.md`, anexo). Se sigue el prompt: no son de
  esta sesión. Conviene que §7.1 lo diga.
- §7.1 dice que la rama del origen del anuncio tenía «conflicto conocido en
  `normalizar-entrada.js`». Al fusionar, el módulo fusionó solo (git separó
  el objeto `anuncio` de `origen`); los conflictos reales estaban en los tres
  JSON de reservas, que es donde el mismo código vive copiado. La corrección
  de derivar `origen` del objeto `anuncio` se hizo igual, por diseño.
- §7.1 asigna «comprobante en simulado → con el hotfix». El hotfix se acotó a
  los tres flujos de reservas (el prompt lo dice así); el Demo B se decide
  con Andres (arriba).

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
