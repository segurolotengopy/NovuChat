# Coordinación: prepago estricto (A) y modularización (B), con el cobrador (C) encolado

> Tablero de la sesión coordinadora (`Prompts/prepago-y-modularizacion-en-paralelo.md`).
> Se actualiza en cada cambio de estado de cualquier frente. Sin secretos ni
> identificadores. Fechas en absoluto.

**Compuerta del demo: ABIERTA desde el 21/09/2026.** Andres escribió en el chat que el
demo terminó. Desde ahora se puede desplegar, publicar y presentar a Meta, pero **cada
acción que escribe en producción, en Meta, en n8n o en GitHub sigue necesitando su «sí»
en el chat, una por una**: abrir la compuerta no es autorizar nada en particular.

**Base de trabajo:** `origin/main` en `8e51238` (20/09/2026, noche): los análisis 35 y
36 y la carpeta `Prompts/` ya están en `main` (PR #130), así que la rama
`analisis/prepago-y-prompts` cumplió su función. Cada frente nace de `origin/main`
en un worktree dentro de `.claude/worktrees/`. La copia principal `~/NovuChat` está
en `742eaf7`, muy atrás de `origin/main`: **no se opera nada desde ahí**.

**Lo que hay en vuelo al 20/09 (noche), y le importa a la compuerta:**

- Última etiqueta: **`v0.6.4`** sobre `ceaceb9` (PR #125). `ESTADO.md` de `main` no
  registra nada después de `v0.6.0`: las etiquetas `v0.6.1` a `v0.6.4` y los PR
  #119 a #127 (todos del 20/09) **no tienen entrada en la bitácora**.
- Después de `v0.6.0` cambiaron los tres flujos de agendamiento (Demo A, Platinum,
  Bellido) y el de señas vencidas (#119, #122, #124, #125, #126, #127). **No hay
  registro de que se hayan publicado en n8n** después de esos PR. Es el caso
  «fusión sin publicar» de la memoria `publicar-solo-desde-main`, y es un riesgo
  para el demo del 21/09: se le pregunta a Andres, no se toca.
- PR **#129** abierto (`flujos/encender-flujo-existente`, worktree `release`, otra
  sesión): toca `scripts/publicar-flujo.sh`, que es zona de B. B-1 no modifica ese
  script (su prompt lo prohíbe), pero B-4 y cualquier gancho lo leen: **B espera a
  que #129 cierre antes de tocar `scripts/`**.
- Dieciséis PR de Dependabot abiertos (#2 a #52) y #63 (docs): no se mezclan con
  ningún bloque.

## Tablero

| Frente | Rama | Bloque en curso | Estado | Archivos que toca | Próximo paso |
|---|---|---|---|---|---|
| **Coordinación** | `claude/prepago-modularizacion-paralelo-e0d10c` (worktree `novuchat-modularization-0fc59d`) | tablero, integración | en curso | `Prompts/COORDINACION.md`, `ESTADO.md`, `admin/DISENO.md` (solo agrega) | integrar Diseño A y Diagnóstico B |
| **A · Diseño** | (solo lectura, agente `Plan`) | ficha de diseño | **cerrado (20/09)**: `admin/DISENO.md` §4undecies en la rama de coordinación (`bb07890`), con la §4undecies.5 reescrita contra el contrato real | `admin/DISENO.md` | — |
| **A-0 · servidor** | `prepago/modulo-y-cortes` | módulo puro, gracia 48 h, calendario D-5/D-1/D0/D+2/D+4, `perdidas`, modo observación, `cobranza.ts`, `migrar-prepago.mjs` | **FUSIONADO (#150, 21/09, `17984a4`)**. No despliega: entra con la etiqueta, y en **modo observación** (`plataforma/prepago.corteActivo` no existe) | — | — |
| **A-1 · pagos** | `prepago/pagos-y-carga-manual` | pagos con TCO, carga manual con evidencia, derivados gobernados, reglas de Firestore y Storage | **FUSIONADO (#151, 22/09, `e778b72`)** | — | — |
| **A-2 · cobrador** | `prepago/cliente-cobrador` | cliente del contrato real, sondeo cada 5 min, aviso firmado, barrido, imagen del QR, integrado con A-1 (`pagosConCobrador.ts`, sin stub) | **FUSIONADO (#152, 22/09, `2311c78`)** | — | — |
| **A-3 · consola** | `prepago/consola-pagar` | «Pagar», historial, `perdidas`, propietario (fases 1–2 de `Analisis/29`) | encolado detrás de A-1 fusionado | `admin/web/src/paginas/EstadoCuenta.tsx`, `Consumo.tsx`, `Tenants.tsx` | — |
| **A-4 · WhatsApp interno** | `prepago/whatsapp-pago` | intención «pagar / estado» como módulo del esquema de B | **desbloqueado por B-1 (21/09)**; espera además A-2 en `main` y la verificación del titular de cada teléfono de pago | `Flujos/src/` (módulo), nunca el JSON a mano | — |
| **A-5 · plantillas de Meta** | `prepago/plantillas-cobranza` | ocho plantillas de utilidad redactadas | **FUSIONADO (#154, 22/09)**; `docs/plantillas-cobranza.md`; saneo 0 | `docs/plantillas-cobranza.md` (nuevo) | **en espera de la compuerta del demo**: presentarlas a Meta (§7 del documento). `crear-plantilla.sh` no admite encabezado de imagen, pie ni botón de respuesta: hay que ampliarlo antes (bloque aparte, `scripts/`, tras el #129) |
| **B · Diagnóstico** | (solo lectura, agente `Explore`) | bloque 0 | **cerrado (20/09)**: ver «Diagnóstico B» abajo | ninguno | — |
| **B-1 · ensamblador** | `flujos/ensamblador` | ensamblador + `extraer` + `verificar`, módulos de reservas, ayudante de pruebas, LEEME §0 | **FUSIONADO (#153, 21/09, `1c5855f`)**; CodeQL corregido (`fba723d`, lectura única en vez de comprobar y leer). No despliega ni cambia ningún JSON | — | — |
| **B-2 · resto de flujos** | por definir | todos los flujos, incluidos los de cliente con nodos propios | **desbloqueado (21/09)**: B-1 en `main` y la publicación de los flujos verificada | `Flujos/*.json` (regenerados idénticos), `admin/scripts/sincronizar-flujo-cliente.mjs` | — |
| **B-3 · corpus del sitio** | por definir | el corpus fuera del nodo Code | encolado detrás de B-1 fusionado | flujo de captación, Function que lo sirve | — |
| **B-4 · procedimiento** | por definir | RUNBOOK etapa 5, agente `flujos-n8n`, gancho de pre-commit | encolado detrás de B-2 | `docs/alta-cliente/RUNBOOK.md`, `.claude/agents/flujos-n8n.md`, `.githooks/` | — |
| **C · contrato del cobrador** | otro proyecto (`$HOME/ManejoQRSimple/`), otra sesión ya activa | bloque 2 (aviso) en `feat/aviso-de-confirmacion`; doc en `docs/estado-pr-38` | **bloques 0 y 1 fusionados (PR #38, 20/09); 2 en curso; 3 y 4 pendientes** — verificado por la coordinadora a pedido de Andres | nada de NovuChat | ver «Lo que A-2 le pide a C» abajo |

## Diagnóstico B (bloque 0, cerrado el 20/09/2026)

- **El problema subió, no bajó:** 1 277 207 bytes de JavaScript dentro de los 8 JSON
  (+3,5 % en un día), 85 nodos Code, 10 suites con `new Function`, cada una con su
  propio extractor. Los 18 nodos Code comunes de Demo A, Platinum y Bellido son
  **idénticos byte a byte** (Demo A y Platinum tienen la misma huella MD5); el PR #127
  creció tres veces, +14 448 / +14 452 / +14 452 bytes, por copiar a mano.
- **Lo que difiere por tenant** son cuatro nodos (`Config base`, `AI Agent (Sofía)`,
  `agendar_cita`, `Avisar a recepción`; cinco en Bellido) y el `name` del flujo. Los
  19 nodos propios de Bellido existen tal cual (6 son Code).
- **Reproducir byte a byte es trivial:** los 8 archivos son exactamente
  `JSON.stringify(obj, null, 2) + "\n"`, sin `id`, `versionId`, `meta`, `pinData`
  ni `webhookId` (los inyecta `preparar-import.sh`). El orden de claves de primer
  nivel difiere en `demo-a-recordatorios.json`: se muta en sitio, no se reconstruye.
- **Los `REEMPLAZAR_*` viven en el nodo `set` `Config base`** (una excepción:
  `Config del negocio` en captación): el ensamblador no los toca y
  `verificar-saneo.sh` sigue igual.
- **Sticky notes: cero.** `LEEME-flujos.md:8` y `CLAUDE.md:40` están desactualizados.
- **`sembrar-demos.mjs` no lee `Flujos/`**: la memoria y el prompt de B lo listan
  por error entre los scripts que buscan nodos por nombre.
- **El corpus del sitio** (`Conocimiento del sitio`, 826 782 bytes, el 65 % del
  JavaScript del repositorio) tiene una alarma de huella en
  `onboarding-flujo.test.ts:1583` que es `it.skipIf(!existsSync(indice))`: **no
  corre en CI**. Se arregla antes de moverlo (B-3).
- **Nadie empezó nada parecido** en ninguna rama.
- **¿B empieza?** No hay ninguna etiqueta esperando aprobación. **Sí hay siete
  commits de flujos fusionados en `main` sin registro de publicación** (ver «en
  vuelo»). Decisión de la coordinadora: **B-1 arranca**, porque por contrato no
  modifica ningún JSON (identidad byte a byte) ni `scripts/`; **B-2 espera** a que
  esos flujos se publiquen después del demo, porque es el bloque que reescribe los
  JSON y conviene correrlo con disco y n8n alineados. Es un matiz respecto de la
  lectura literal de la memoria; queda para que Andres lo confirme o lo revierta.

## Lo que A-2 le pide a C (contrato real, verificado el 20/09/2026)

**Lo que ya está y A-2 consume tal cual** (`main` del proyecto de cobros, PR #38):
`Authorization: Bearer <CONSUMIDOR_TOKEN_NOVUCHAT>`; `POST /api/v1/cobros`
`{referenciaExterna, concepto, monto:"150.50", horasDeVigencia}` → 201/200 con
`cobro{id:"cons-<sha256>", referenciaExterna, estado, monto, moneda:"BOB", concepto,
creadoEn, qr{version, venceEn, imagenDisponible}, pago}` e `imagenQrBase64`; `GET
/api/v1/cobros/:id` y `/por-referencia/:ref`; `POST /api/v1/cobros/:id/anular` →
`200 ANULADO` | `409 PAGADO_NO_SE_ANULA` | `409 PAGO_TARDIO_EN_REVISION`; `GET
/api/v1/cobros?desde&hasta&limite`; `GET /api/v1/cobros/:id/qr`. Estados:
`BORRADOR`, `QR_ACTIVO`, `PAGO_DETECTADO`, `CONFIRMADO`, `EN_REVISION`, `VENCIDO`,
`ANULADO`, `RECHAZADO`; **solo `CONFIRMADO` es pagado**. Idempotencia por referencia;
`409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA`; una referencia no se recicla. Errores
`{error:{codigo, mensaje}}`. Cupo 60 QR/hora por consumidor.

**Lo que A-2 le pide al bloque 2 (aviso), para que el doble y el receptor coincidan:**
`POST` a una URL de NovuChat con el cuerpo `AvisoDeConfirmacion` tal como ya está
en la rama (`evento:"cobro.confirmado"`, `idEvento`, `consumidorId`, `cobroId`,
`referenciaExterna`, `montoCentavos`, `confirmadoEn`, `ocurridoEn`, `riel`), más
**firma HMAC-SHA256** del cuerpo canónico con un secreto por consumidor
(`CONSUMIDOR_AVISO_SECRETO_<ID>`), en cabeceras `X-Firma` y `X-Marca-Tiempo`
(ISO 8601, tolerancia de 5 minutos), y respuesta `200` idempotente por `idEvento`
del lado de NovuChat. **El aviso no es fuente de verdad:** NovuChat siempre
reconcilia por `estadoCobro` (barrido horario). Si C elige otro esquema de firma,
A-2 cambia una función; el resto no se toca.

**Lo que A-2 necesita de los bloques 3 y 4:** una cuenta de cobro `novuchat`
atribuida por consumidor (hoy todos los cobros van a la cuenta del proceso) y una
URL pública de la API (hoy corre como proceso local). Hasta entonces el ensayo de
punta a punta queda «listo pero sin ejecutar».

## Cola de fusión a `main`

```
Diseño A ─┐
          ├─► A-0 ─► A-1 ─► A-3 ─────────────────┐
A-2 (doble) ──────────────────────► integra con C ┤
Diagnóstico B ─► B-1 ─► B-2 ─► B-3 ─► B-4        ├─► etiqueta (Andres, tras el demo)
                 └──► A-4 (módulo) ──────────────┘
C (otra sesión, en su proyecto) ──► contrato ──► A-2 integra
```

## Lo que estaba en espera de la compuerta del demo (ahora espera el «sí» de cada acción)

- **A-5:** presentar a Meta las ocho plantillas de `docs/plantillas-cobranza.md` §7
  (antes, ampliar `crear-plantilla.sh` con encabezado de imagen, pie y botón de
  respuesta rápida, y subir la imagen de muestra por la Resumable Upload API).
- **A-2:** crear los secretos `COBRADOR_TOKEN` y `COBRADOR_AVISO_SECRETO` en Secret
  Manager, `secretAccessor` a `sa-functions`, ampliar la condición de IAM de despliegue
  (`COBRADOR_`), habilitar Cloud Scheduler para `barridoCobros`.
- **A-2 (despliegue):** además de los secretos, invocador `allUsers` para `avisoCobrador`
  e `imagenDePago`, `plataforma/prepago.cobrador.baseUrl`, registrar la URL del aviso en
  el cobrador, y un `scripts/rotar-cobrador.sh` a imagen de `rotar-ingesta.sh` antes del
  primer despliegue (zona `scripts/`, después del #129).
- **Antes de desplegar A-1:** correr `migrar-prepago.mjs` en cada comercio real (seco y
  después `--aplicar`, uno por uno, con su OK), y comprobar que `sa-functions` tiene
  `storage.objects.get` (A-1) y escritura (A-2, `qr.png`) sobre el bucket por defecto.
- **Antes de A-4:** verificación del titular de cada teléfono de `telefonosPago` y
  resolución de un número que figure en dos comercios.
- **Encender la bandera del corte** (decisión de Andres, tras el demo y un pago
  confirmado de punta a punta) exige antes: A-0 fusionado con su corrección (`066bd29`),
  y que **todos los flujos publicados manden `telefono` a `Traer configuración`**.
- **Flujos fusionados sin publicar** (#119 a #127): publicar desde `main` con el
  diagnóstico en seco leído entero; hasta entonces B-2 espera.

## Lo que espera a Andres, en orden (al 21/09/2026)

**Ya, sin esperar el demo (subir y abrir PR no despliega nada):**

1. ~~B-1~~: **fusionado el 21/09 (#153)**.
2. ~~A-0, A-1~~: fusionados (#150, #151). ~~Subir~~ **A-0**, **A-1**
   (`prepago/pagos-y-carga-manual`, sobre A-0) y **A-2** (`prepago/cliente-cobrador`).
3. ~~Fusionar B-1, A-0, A-1 y A-2~~: **hecho el 21 y 22/09 (#153, #150, #151, #152)**. Quedó así: A-2 al final
   (la coordinadora resuelve sus conflictos: una sola copia de las reglas de `/pagos`,
   la línea de A-0 en las listas de tipos de bitácora, `tipoCambioDe`, y se borra
   `pagos-stub.ts`). Fusionar tampoco despliega.
4. «Sí» para subir y abrir PR de **A-5** (`prepago/plantillas-cobranza`, solo documento)
   y de esta rama de coordinación (`admin/DISENO.md` §4undecies, el tablero, las notas
   de estado de `Analisis/36` y del prompt de C).

**Después de que Andres escriba que el demo terminó:**

5. **Flujos publicados: VERIFICADO el 21/09/2026** (con permiso de Andres para leer los
   otros worktrees y sesiones, sin conectarse a n8n):

   | Flujo | Publicado (hora de Bolivia) | Desde | ¿Igual a `main` hoy? |
   |---|---|---|---|
   | Demo A, Platinum, Bellido, Demo B, Captación | 21/09 11:51–11:52 | worktree `publicar`, commit `4aa6f3c` (#147, fusionado 11:19) | sí, sin diferencias en `Flujos/` |
   | Señas vencidas (Platinum) | 20/09 23:06 | worktree `release`, tras el #132 (fusionado 22:39) | sí, sin cambios desde `e22e79b` |
   | Recordatorios, Seguimientos | sin cambios en `main` desde el 07/09 y el 17/09 | — | — |

   Prueba: el respaldo del flujo vivo que `publicar-flujo.sh --aplicar` escribe antes de
   cada escritura, y la salida en la sesión «Platinum: flujo mixto, leads y medios»:
   «Flujo actualizado en su lugar (HTTP 200)». Lo que esto **no** descarta es una edición
   a mano en n8n después de las 11:52; eso solo lo ve el diagnóstico en seco.

6. **Migrar los comercios reales** con `migrar-prepago.mjs` (seco, y `--aplicar` uno por
   uno con su OK), **antes** de desplegar A-1.
7. **Nube para el prepago:** crear `COBRADOR_TOKEN` y `COBRADOR_AVISO_SECRETO` sin mostrar
   el valor (con un `scripts/rotar-cobrador.sh` a imagen de `rotar-ingesta.sh`, que hay
   que escribir), `secretAccessor` a `sa-functions`, condición de IAM `COBRADOR_`, permiso
   de Storage de `sa-functions` sobre el bucket, Cloud Scheduler, invocador `allUsers`
   para `avisoCobrador` e `imagenDePago`, y `plataforma/prepago.cobrador.baseUrl`. Dos
   trabajos de Cloud Scheduler (`barridoCobros` cada hora, `sondeoCobros` cada 5 min):
   los tres primeros por cuenta de facturación son gratis.
8. **Etiqueta** (la crea Andres) con A-0, A-1 y A-2 fusionados: despliega el prepago en
   **modo observación**. Aprobar el Environment `production`.
9. **Ampliar `crear-plantilla.sh`** (encabezado de imagen, pie, botón de respuesta) y
   **presentar las ocho plantillas a Meta** (`docs/plantillas-cobranza.md` §7). Tarda días.
10. **B-2** (resto de los flujos al ensamblador), con los flujos ya publicados.
11. **Ensayo de punta a punta** con el TENANT de ensayo y un cobro real de monto mínimo:
    exige que C cierre sus bloques 3 y 4 (cuenta `novuchat`, URL pública) y la bandera
    encendida **solo en ese tenant** (`fijarCortePrepago` con `tenantId`).
12. **Encender el corte global:** decisión de Andres, después de un pago confirmado de
    punta a punta y un ciclo completo de recordatorios observado, y con todos los flujos
    publicados mandando `telefono` a `Traer configuración`.

**Encolado, sin fecha:** A-3 (consola «Pagar», tras A-1 en `main`), A-4 (WhatsApp interno,
tras B-1 en `main` y con la verificación del titular de cada teléfono), B-3 (corpus del
sitio, arreglando antes su alarma de huella que no corre en CI), B-4 (runbook, agente
`flujos-n8n`, gancho de pre-commit, acotar `verificar-saneo.sh`).

## Bitácora

- **22/09/2026** — **#152 (A-2) fusionado**, CI en verde. **Los cinco PR de código y
  plantillas están en `main`** (#150 a #154); `pagos-stub.ts` no llegó a `main`. Queda
  #155 (esta rama). Lo que sigue ya no es fusionar: es la migración de los comercios,
  la nube del cobrador y la etiqueta, cada paso con el «sí» de Andres.

- **22/09/2026** — Andres: «procede conforme las recomendaciones». Fusionados **#151**
  (A-1) y **#154** (A-5). **#152** (A-2) integrado con A-1 en su rama: se borró el stub,
  los imports pasan a los módulos reales, y `pagosConCobrador.ts` conecta la carga
  manual, la anulación y la consulta de A-1 con el cobrador de A-2 (sin cobrador
  configurado se usa la anulación local, que nunca anula un pago que haya pasado
  por el cobrador). Seguridad revisó la integración: dos MEDIUM (un QR con id perdido
  anulado localmente; las Functions de pagos sin declarar `COBRADOR_TOKEN`) y un LOW,
  corregidos en `ae286cd`. Errores míos en el camino, corregidos: un comentario con
  punto y coma que rompía la prueba de tipos de bitácora, y una conexión que llamaba
  al cobrador aun sin configurar.

- **21/09/2026** — **#150 (A-0) fusionado** con el «sí» de Andres. La rama estaba 8
  commits atrás (todos del #153) sin archivos en común, así que la combinación no
  necesitaba otra corrida de CI. #151 reapuntado a `main` y puesto al día con una fusión
  (sin reescribir historia), porque GitHub borra los checks al cambiar la base.

- **21/09/2026** — **#153 (B-1) fusionado** con el «sí» de Andres, CI completa en verde.
  Desde ahora un cambio de código de reservas se hace en `Flujos/src/` y se ensambla;
  editar el JSON a mano hace fallar `verificar` en la suite. Desbloqueados B-2, B-3,
  B-4 y, del lado de B, A-4.

- **21/09/2026** — Con el «sí» de Andres, subidas las seis ramas y abiertos los PR:
  **#150** A-0 · **#151** A-1 (base A-0) · **#152** A-2 · **#153** B-1 · **#154** A-5 ·
  **#155** coordinación. Orden de fusión: #153 cuando se quiera; #150 → #151 → #152;
  #154 y #155 son documentos. Fusionar no despliega; cada fusión se pide aparte.

- **21/09/2026** — A-1 rebasado sobre A-0. **Los cuatro bloques de código están al día con `main` (`e571e76`) y listos para subir.**

- **21/09/2026** — B-1 reextraído sobre `main`. Para B-2: los nodos `googleGemini`
  (`Describir documento`, `Describir imagen`) llevan prompt y el manifiesto no los
  cubre; con `cancelar_cita`, `agendar_cita` y `Avisar a recepción` justifican el punto
  de inyección de «parámetro de texto de cualquier nodo». **Mientras B-1 no se fusione,
  cada cambio de reservas en `main` obliga a repetir rebase y `extraer`**: conviene
  fusionarlo pronto. Método: los agentes en paralelo escriben logs con prefijo propio
  (dos corridas se mezclaron en un mismo archivo del scratchpad).

- **21/09/2026** — **Publicación de los flujos verificada** por respaldos y salida de
  la sesión que publicó (ver el punto 5 de «Lo que espera a Andres»). B-2 desbloqueado.

- **21/09/2026** — **Andres: el demo terminó y los flujos quedaron publicados.** Compuerta
  abierta. La verificación de la publicación se intentó con el diagnóstico en seco y el
  clasificador de permisos la bloqueó; no se rodeó. Evidencia indirecta: las ocho
  etiquetas `v0.6.0` a `v0.6.7` desplegaron bien, y los PR fusionados después de
  `v0.6.7` (#145, #146, #147) solo tocan flujos. B-2 queda desbloqueado en cuanto la
  verificación confirme que n8n coincide con `main`.

- **21/09/2026** — Aviso de la sesión «Análisis comercial y clientes» (con OK de Andres):
  el PR #134 corrigió en `main` los prompts de A, B y C y `Analisis/36` §1.2 para decir
  que el contrato del cobrador existe. Ya estaba aplicado acá; mis notas se recortaron
  a lo que `main` no dice. **Un error del #134, avisado a esa sesión:** pone la
  referencia externa como `tenant/periodo/pagoId`, y el contrato real no admite `/`
  (y la decisión 3 exige que sea opaca); A-2 sigue con `pagoId` solo. Lo nuevo que el
  #134 sí pide y A-2 incorpora: **sondear `estadoCobro` cada pocos minutos** mientras
  haya un pendiente, además del barrido horario.
- **21/09/2026** — `origin/main` avanzó 45 commits (hasta `e571e76`, etiquetas
  `v0.6.5` a `v0.6.7`), con cambios en `ingesta.ts` y en los flujos de reservas (#140 a
  #147). **Las cuatro ramas de bloque quedan desactualizadas**: A-0, A-2 y B-1 se están
  rebasando; A-1 rebasa sobre A-0 cuando éste termine. B-1 vuelve a extraer, porque sus
  módulos ya no reproducen los JSON. `ESTADO.md` de `main` no registra nada después del
  19/09, así que no se sabe desde el repositorio **qué quedó publicado en n8n**: se le
  pregunta a Andres.

- **21/09/2026** — Cierre de la jornada. A-0, A-1, A-2 y B-1 construidos, revisados por
  `seguridad` y corregidos; A-5 redactado. Ninguna rama subida: todo espera el «sí».

- **21/09/2026** — A-1 revisado por seguridad: dos MEDIUM (idempotencia del manual en
  efectivo; evidencia reemplazable) y siete LOW, en corrección. Al fusionar A-1 y A-2:
  **una sola copia** de las reglas de `/pagos`, `/cobrosPendientes` y `/cobrosResueltos`
  (dos `match` iguales se combinan con OR y, si difieren, ensanchan en silencio); A-2
  usa `tipoCambioDe` en vez de `tipoCambioDelDia`; se conserva la guarda de importe
  menor de A-2; se borra `pagos-stub.ts`. A-3 debe saber que, con el corte en
  observación, el comercio que debe ve «Vencido».
- **21/09/2026** — A-1 construido sobre A-0. Lo que A-2 debe ajustar al reemplazar
  `pagos-stub.ts`: `tipoCambioDelDia` pasa a ser `async` y leer Firestore (la pura es
  `tipoCambioDe(datos, ahoraMs)`, afecta `cobroPrepago.ts:262`); `periodoBolivia` se
  llama `mesBolivia`; `estadoPago` dice `vencido` aunque el corte esté solo observado
  (criterio de A-0). Tres decisiones de A-1 para revisar: el `pagoId` del manual con
  evidencia lo elige la consola (la evidencia se sube antes bajo esa ruta; el servidor
  exige la forma y `tx.create` falla si existe); los derivados se recalculan en cada
  llamada; `exigirAdminDe` con proveedor alcanza también a invitar y quitar usuarios y
  al acceso de soporte.
- **21/09/2026 (madrugada)** — A-0 construido; en revisión de seguridad. A-1 lanzado sobre
  la rama de A-0. Puntos que A-0 resolvió distinto del diseño (aceptados): `servicio`
  viaja en la respuesta de la ingesta solo con modalidad (sin modalidad, byte a byte la
  de hoy); `camposDerivados(estado, cuenta)` (necesita `pagoPendienteId`); un corte que
  pasa de observado a aplicado empieza de cero; `recordatoriosPrepago` recorre `tenants`
  con `getAll` (sin índice de grupo); `migrar-prepago.mjs` importa el módulo compilado.
  **Conflictos de fusión esperados entre A-0 y A-2:** `ingesta.ts` (`TipoEvento`),
  `firestore.rules` y `bitacora.ts` (listas de tipos: A-0 agrega tres, A-2 uno de los
  tres), `index.ts` (exports), y la firma de `camposDerivados` (A-1 la adapta).
- **21/09/2026 (madrugada)** — A-2 construido. Firma que A-1 debe respetar:
  `aplicarPagoEnTransaccion(tx, refs, pago, confirmacion)` síncrona, una escritura por
  documento, lanza si el pago no está `pendiente`; `camposDerivados(cuenta, corteGuardado,
  ahoraMs)`. Agregó `/cobrosResueltos/{pagoId}` para que un aviso repetido tras cerrar
  el pago responda `aplicado: false` sin índice de grupo. Tres discrepancias del
  cobrador para elevar a C: `riel` con nombres distintos en el aviso (`watcher-baneco`)
  y en `estadoCobro` (`api-baneco`); `montoCentavos` en el aviso y `monto` decimal en
  la API; `pago.monto` puede ser `null`. NovuChat guarda siempre lo de `estadoCobro`.
- **20/09/2026 (noche)** — B-1 construido. Deja para B-2: prompt en capas (`base.md` +
  variables por tenant: 23 líneas de 191 difieren, todas nombres y ejemplos del rubro),
  un tercer tipo de punto de inyección (parámetro de texto de un nodo cualquiera:
  `agendar_cita.end`, `Avisar a recepción.textBody`), `sincronizar-flujo-cliente.mjs`
  se simplifica (solo topología y `--base`), `portar-prompt-cliente.py` se reemplaza
  por el prompt en capas, Bellido = manifiesto del Demo A + 6 Code propios. Para B-4:
  acotar el patrón de `verificar-saneo.sh` (hoy alcanza `Flujos/manifiestos/*.json`),
  migrar las otras siete suites al ayudante. `new Function` se queda en las pruebas
  (el cuerpo de un nodo Code no es un módulo ES importable; envolverlo rompería la
  identidad).
- **20/09/2026 (noche)** — Diseño A y A-5 cerrados. `admin/DISENO.md` §4undecies escrito
  en la rama de coordinación; la §4undecies.5 del agente describía un contrato inventado
  (centavos, `ENVIADO`, `403`) porque terminó antes de recibir el aviso, y se reescribió
  contra el real. Los nombres de plantillas se unificaron con `docs/plantillas-cobranza.md`.
  Lanzados A-0 y A-2 en paralelo.
- **20/09/2026 (noche)** — A pedido de Andres se verificó el prompt de C contra el
  proyecto de cobros: **el contrato ya existe** (bloques 0 y 1 fusionados, PR #38;
  bloque 2 en curso en otra sesión). Se corrigió la nota de estado del prompt de C,
  la nota del 20/09 de `Analisis/36` y la fila de C. A-2 se construye contra el
  contrato real, no contra uno inventado.
- **20/09/2026 (noche)** — Diagnóstico B cerrado; B-1 lanzado (`flujos-n8n`,
  rama `flujos/ensamblador`). Los worktrees de los agentes nacen de `main`, no de la
  rama de coordinación: cada agente hace `git fetch` y crea su rama desde
  `origin/main`, que ya trae `Prompts/`.
- **20/09/2026** — Arranque. `origin/main` había avanzado (PR #127) desde que se creó
  `analisis/prepago-y-prompts`; se fusionó localmente. Mientras se leía, se
  fusionaron #128 y #130 y la rama de análisis quedó dentro de `main`: la rama de
  coordinación se rebasó sobre `8e51238`. Lanzados en paralelo Diseño A
  (`Plan`), Diagnóstico B (`Explore`) y A-5 plantillas (`meta-whatsapp`, solo
  redacción). La lectura del proyecto de cobros quedó limitada a su ficha del
  registro: el clasificador de la sesión bloqueó leer sus `docs/` (datos
  personales); el documento `docs/10-contrato-consumidores.md` que la ficha cita
  **no existe** en `$HOME/ManejoQRSimple/`, así que A-2 se construye contra el
  contrato del prompt de C, que es el vigente.
