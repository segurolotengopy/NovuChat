# Coordinación: prepago estricto (A) y modularización (B), con el cobrador (C) encolado

> Tablero de la sesión coordinadora (`Prompts/prepago-y-modularizacion-en-paralelo.md`).
> Se actualiza en cada cambio de estado de cualquier frente. Sin secretos ni
> identificadores. Fechas en absoluto.

**Compuerta del demo (vigente desde el 20/09/2026):** hasta que Andres escriba en el
chat que el demo terminó, no se despliega, no se etiqueta, no se publica ningún
flujo, no se recarga configuración, no se corre ningún `--aplicar` y no se presenta
nada a Meta. Se puede escribir código, pruebas y documentos, commitear en ramas y,
con su «sí», subir ramas y abrir PR. Fusionar a `main` tampoco despliega.

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
| **A-0 · servidor** | `prepago/modulo-y-cortes` | módulo puro reaplicado sobre la ingesta de hoy, gracia 48 h, calendario D-5/D-1/D0/D+2/D+4, `perdidas`, modo observación, `cobranza.ts` | **en curso (20/09, noche)** | `admin/functions/src/prepago.ts`, `cobranza.ts` (nuevos), `ingesta.ts`, `index.ts`, `firestore.rules` (tipos de bitácora), `web/src/lib/`, `admin/pruebas/` | PR con las pruebas negativas |
| **A-1 · pagos** | `prepago/pagos-y-carga-manual` | colección `pagos` con TCO, `registrarPagoManual`, auditoría, fase 0 de `Analisis/29` | encolado detrás de A-0 | `index.ts`, `firestore.rules`, `admin/pruebas/` | — |
| **A-2 · cobrador** | `prepago/cliente-cobrador` | cliente del contrato real + `crearCobroPrepago`, `avisoCobrador`, `barridoCobros`, `imagenDePago`, contra el doble | **en curso (20/09, noche)**, contra un stub de A-1 | `admin/functions/src/cobrador.ts`, `cobroPrepago.ts` (nuevos), `firma.ts` (dos exports), `admin/pruebas/dobles/` | integra con A-1 en `main`; el aviso se ajusta cuando C cierre su bloque 2 |
| **A-3 · consola** | `prepago/consola-pagar` | «Pagar», historial, `perdidas`, propietario (fases 1–2 de `Analisis/29`) | encolado detrás de A-1 fusionado | `admin/web/src/paginas/EstadoCuenta.tsx`, `Consumo.tsx`, `Tenants.tsx` | — |
| **A-4 · WhatsApp interno** | `prepago/whatsapp-pago` | intención «pagar / estado» como módulo del esquema de B | **encolado detrás de B-1 fusionado** | `Flujos/src/` (módulo), nunca el JSON a mano | — |
| **A-5 · plantillas de Meta** | `prepago/plantillas-cobranza` (`be135da`, worktree `agent-a073cd5409c381cca`) | ocho plantillas de utilidad redactadas | **redacción cerrada (20/09)**; `docs/plantillas-cobranza.md`; saneo 0 | `docs/plantillas-cobranza.md` (nuevo) | **en espera de la compuerta del demo**: presentarlas a Meta (§7 del documento). `crear-plantilla.sh` no admite encabezado de imagen, pie ni botón de respuesta: hay que ampliarlo antes (bloque aparte, `scripts/`, tras el #129) |
| **B · Diagnóstico** | (solo lectura, agente `Explore`) | bloque 0 | **cerrado (20/09)**: ver «Diagnóstico B» abajo | ninguno | — |
| **B-1 · ensamblador** | `flujos/ensamblador` (4 commits, `c477aef`…`b9a6cac`, worktree `agent-ad32890c0b62ce13b`) | ensamblador + `extraer` + `verificar`, 18 módulos (5 `comun/`, 13 `reservas/`), 5 prompts, 2 manifiestos, ayudante `admin/pruebas/lib/flujo.ts`, LEEME §0 reescrito | **construido (20/09, noche)**: identidad byte a byte en los 8 JSON, suite 2242 → 2287 casos (+45, la suite nueva), saneo por patrones 0; **en revisión de `seguridad`**; después, pedir a Andres el OK para subir y abrir PR | `Flujos/src/`, `Flujos/prompts/`, `Flujos/manifiestos/`, `admin/scripts/ensamblar-flujo.mjs`, `admin/pruebas/lib/flujo.ts`, `admin/pruebas/ensamblador.test.ts`, `Flujos/LEEME-flujos.md`; `scripts/` y `.pre-commit-config.yaml` sin diff | correr el saneo en modo exacto desde una copia con `CONFIGURACION.local.md` antes de fusionar |
| **B-2 · resto de flujos** | por definir | todos los flujos, incluidos los de cliente con nodos propios | encolado detrás de B-1 **y de que los flujos fusionados sin publicar se publiquen** (tras el demo) | `Flujos/*.json` (regenerados idénticos), `admin/scripts/sincronizar-flujo-cliente.mjs` | — |
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

## En espera de la compuerta del demo

- **A-5:** presentar a Meta las ocho plantillas de `docs/plantillas-cobranza.md` §7
  (antes, ampliar `crear-plantilla.sh` con encabezado de imagen, pie y botón de
  respuesta rápida, y subir la imagen de muestra por la Resumable Upload API).
- **A-2:** crear los secretos `COBRADOR_TOKEN` y `COBRADOR_AVISO_SECRETO` en Secret
  Manager, `secretAccessor` a `sa-functions`, ampliar la condición de IAM de despliegue
  (`COBRADOR_`), habilitar Cloud Scheduler para `barridoCobros`.
- **Flujos fusionados sin publicar** (#119 a #127): publicar desde `main` con el
  diagnóstico en seco leído entero; hasta entonces B-2 espera.

## Lo que espera a Andres después del demo

(se completa al cerrar; en orden: qué fusionar, qué etiquetar, qué publicar, qué
presentar a Meta, y cuándo encender el corte)

## Bitácora

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
