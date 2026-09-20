# Prepago estricto y modularización, en paralelo y sin chocarse — sesión coordinadora

> **TENANT de ensayo:** el comercio con el que se prueba el cobro de punta a
> punta (un cobro real de monto mínimo). Andres lo indica; su ficha vive en
> `CLIENTES/<TENANT>/`. Es una instancia: nada del prepago se nombra por un
> cliente, y todo lo que construyas vale para cualquier comercio en un plan.

Eres la sesión coordinadora de **dos frentes que corren a la vez** en NovuChat,
más **un tercero que espera en cola** en otro proyecto:

- **A · Prepago estricto** — el cobro de NovuChat a sus comercios: pago por
  consola, por el WhatsApp interno de NovuChat y por carga manual del
  superadministrador; uno a seis meses adelantados; cobranza y cortes.
  Prompt: `Prompts/prepago-estricto.md`. Análisis: `Analisis/36`.
- **B · Modularización de los flujos** — sacar el JavaScript y los prompts de
  los JSON de `Flujos/` a módulos versionados con un ensamblador.
  Prompt: `Prompts/modularizacion-flujos.md`.
- **C · Contrato del cobrador para consumidores** — en el proyecto de cobros
  por QR, `$HOME/ManejoQRSimple/`. **Su bloque 1 ya existe** (PR #38 de ese
  proyecto, fusionado el 20/09/2026; `docs/10-contrato-consumidores.md`):
  `/api/v1/cobros` con token por consumidor, `referenciaExterna` idempotente,
  `estadoCobro`, `anularCobro`, `listarCobros` y el QR. **Falta el aviso de
  confirmación (su bloque 2)**. No se trabaja desde esta sesión: lo sigue una
  sesión de ese proyecto. Acá se **consume** lo que existe y se **encola** lo
  que falta.

Tu trabajo es que A y B avancen sin pisarse, que C quede encolado con todo lo
que necesita, y que **nada toque producción hasta que Andres lo diga**, porque
mañana hay un demo con un cliente.

## Antes que nada: dónde estás parado

1. **La copia principal (`~/NovuChat`) está 154 commits atrás de `origin/main`.**
   No trabajes ahí, no cambies de rama ahí, y **no ejecutes nada contra
   producción desde ahí**: publicar un flujo o recargar una configuración
   desde esa copia revertiría en vivo `v0.6.0` (seña, medios, seguimientos,
   Maps y candado), que salió el 19/09. Eso sí rompería el demo.
2. Los análisis y los prompts de este frente están en la rama
   **`analisis/prepago-y-prompts`**, en el worktree
   `.claude/worktrees/prepago-prompts` (creado desde `origin/main` de hoy,
   `8d2c0de`). **Todas las rutas `Prompts/…` y `Analisis/35` y `36` de este
   prompt se resuelven en ese worktree, no en la copia principal.** Empieza
   por `git fetch` y comprueba que `origin/main` no se movió; si se movió,
   trae los cambios a esa rama antes de abrir nada.
3. Cada frente trabaja en **su propio worktree dentro de `.claude/worktrees/`**,
   creado desde esa rama. Nunca una carpeta hermana en `~/`.

Lee primero, en este orden: `CLAUDE.md` entero, el `ESTADO.md` de `main`
(no el de la copia principal), `CONFIGURACION.md`, `admin/DISENO.md` §4 y
§4ter.2, y después:

- `Analisis/36-prepago-estricto-y-dunning.md`, **empezando por la nota del
  20/09** que dice qué cambió desde que se escribió.
- `Prompts/prepago-estricto.md` y `Prompts/modularizacion-flujos.md`, enteros:
  son los prompts que les vas a dar a los agentes de A y de B.
- `Prompts/cobrador-contrato-para-consumidores.md`: es lo que C tiene que
  construir, y por lo tanto el contrato contra el que A-2 escribe su doble.
- Del proyecto de cobros, **solo como referencia y sin modificar nada**:
  `CLAUDE.md`, `docs/ESTADO.md`, `docs/01-arquitectura.md` y
  `docs/Integraciones/baneco/02-hallazgos-produccion.md`. Andres autorizó
  leerlo en esa ruta; no leas nada más de otros proyectos.
- Las memorias `multi-tenant-estricto-y-pseudo-prompt`,
  `publicar-solo-desde-main`, `modularizacion-plan-por-etapas` y
  `ramas-en-worktree-propio`.

## Las decisiones que no se tocan

1. **La compuerta del demo.** Hasta que Andres escriba en el chat que el demo
   terminó, **no se despliega, no se etiqueta, no se publica ningún flujo, no
   se recarga configuración, no se corre ningún `--aplicar`, y no se presenta
   nada a Meta**. Se puede: escribir código, pruebas y documentos; commitear
   en las ramas; y, con su «sí», subir ramas y abrir PR. **Fusionar a `main`
   tampoco despliega**: el despliegue lo hace la etiqueta, y la etiqueta la
   crea Andres. Cuando un bloque llegue a una acción de la lista, se detiene y
   deja escrito «en espera de la compuerta del demo» en `Prompts/COORDINACION.md`.
2. **La seña de un cliente NO tiene relación con el pago que la empresa le
   hace a NovuChat.** Son dos direcciones del dinero. La seña (`cobro.ts`,
   `sena.ts`, `cotejo.ts`) es **el comercio cobrándole a su cliente**, con la
   cuenta del comercio, sin que NovuChat toque la plata. El prepago es
   **NovuChat cobrándole al comercio**, con la cuenta de cobro de NovuChat en
   el proyecto de cobros. **Credenciales, colecciones, pantallas y textos
   separados.** Se comparten solo el dibujo del QR (`dibujoQr.ts`) y la firma
   (`firma.ts`). Ninguna pantalla, mensaje ni campo puede mezclar «tu cliente
   pagó la seña» con «pagaste tu mensualidad».
3. **Multi-tenant estricto, también en el dinero.** Una empresa no ve, paga,
   modifica ni consulta lo de otra; la única excepción es el
   superadministrador. En concreto: `/tenants/{t}/pagos` lo lee el
   administrador de ese tenant y el propietario, y **nadie lo escribe desde el
   navegador**; el teléfono que dice «pagar» por el WhatsApp interno tiene que
   ser administrador registrado de **un** tenant (si lo es de varios, se le
   pregunta cuál; nunca se infiere de un nombre); la referencia que viaja al
   cobrador es opaca y sin datos de personas; la vista cruzada de pagos existe
   solo con el claim de propietario. Todo se prueba **negando**.
4. **Lo que se configura por chat o por script se ve en la consola.** Un plan
   asignado, un pago cargado a mano o un mes adelantado tienen que aparecer
   en el «Estado de cuenta» del comercio en el momento. Configurar sin
   pantalla es un defecto.
5. **Solo dos cosas confirman un pago:** la consulta autenticada al banco, que
   hace el proyecto de cobros, o el propietario con evidencia y auditoría. El
   comprobante y el webhook disparan verificación; nunca confirman. NovuChat
   no habla con el banco ni guarda credenciales bancarias.
6. **Precios en dólares, cobro en bolivianos al TCO del BCB del día en que se
   emite el cobro**, guardado en el pago. Hasta seis meses adelantados, sin
   descuento de precio. PRUEBA no recibe cobranza; demostración no se corta.
7. **Los límites viven en el servidor** y se prueban negando; la consola solo
   muestra. **Andres autoriza; tú operas**: nunca le pases comandos.
8. **`Flujos/` es del frente B mientras B esté abierto.** Nadie edita un JSON de
   flujo a mano en paralelo. Lo que A necesite en un flujo (el «pagar» del
   WhatsApp interno) se escribe **como módulo del esquema de B**, después de
   que B-1 esté fusionado.
9. **Ningún secreto en el repositorio**; identificadores por últimos 4.

## Reutilizar antes de escribir

Consulta `~/Claude-Proyectos/proyectos/` (fichas `novuchat.md`,
`manejoqrsimple.md`, `seguridadgeneral.md`). Lo que ya existe y este frente
reutiliza, no rehace:

- `prepago.ts` de la rama `integracion/prepago-sobre-flujos-vivos` (08/09):
  el módulo puro con `aplicarPago` de N meses, cortes y recordatorios.
- `dibujoQr.ts` y `firma.ts` para el QR del prepago; `seguimientos.ts` como
  molde de los recordatorios de cobranza; `atencion.ts` como molde de módulo
  puro compartido con la consola.
- Del proyecto de cobros: QR de un solo uso con monto y vencimiento,
  confirmación contra el banco en ~45 s, varias cuentas de cobro, **sin
  comisión bancaria**. Hoy no tiene contrato para consumidores: eso es C.
- Del estándar DevSecOps: los agentes `seguridad`, `devsecops` y `deploy`.

## El mapa de archivos, y quién es dueño de qué

| Zona | Dueño | Quién más la toca | Cómo se evita el choque |
|---|---|---|---|
| `admin/functions/src/prepago.ts` (nuevo), `ingesta.ts`, `index.ts`, `planes.ts`, `firestore.rules`, `admin/web/src/paginas/EstadoCuenta.tsx`, `Consumo.tsx`, `Tenants.tsx`, `admin/pruebas/` | **A** | nadie | B no toca Functions ni consola (su prompt lo dice) |
| `Flujos/*.json`, `Flujos/src/`, `Flujos/prompts/`, `Flujos/LEEME-flujos.md`, `scripts/publicar-flujo.sh`, `preparar-import.sh`, `verificar-saneo.sh`, `.claude/agents/flujos-n8n.md`, `docs/alta-cliente/RUNBOOK.md` | **B** | A-4 necesita el flujo del WhatsApp interno | **A-4 se encola detrás de B-1** y se escribe como módulo |
| `ESTADO.md`, `admin/DISENO.md`, `CLAUDE.md` §7, `Prompts/LEEME.md` | compartidos | A y B | **Solo se agrega, nunca se reescribe** lo del otro; una sección o entrada por frente, con fecha; los conflictos los resuelve la coordinadora conservando ambos lados |
| `Prompts/COORDINACION.md` (nuevo) | coordinadora | cada frente su fila | El tablero: frente · rama · bloque en curso · estado (en curso / encolado detrás de … / en espera de la compuerta del demo / listo para fusionar) · archivos que toca · próximo paso |
| El proyecto de cobros | **C** (otra sesión) | A-2 lo consume | A-2 se construye contra el contrato **real** de `docs/10-contrato-consumidores.md` (bloque 1, ya fusionado); el doble de prueba cubre solo lo que falta, el aviso de confirmación, y mientras tanto A-2 **sondea** `estadoCobro` |

## Cómo repartir el trabajo entre agentes

Subagentes en paralelo (`Agent`), cada uno en su worktree
(`isolation: worktree`) creado desde `analisis/prepago-y-prompts`; tú integras.
Revisión de `seguridad` antes de pedir el OK de fusión de cada PR.

| Agente | Tipo | Qué hace | Cuándo |
|---|---|---|---|
| **Diseño A** | `Plan` | Lo que pide `Prompts/prepago-estricto.md` para el agente de diseño, **más** la lectura de la ingesta de hoy (ya reabierta por la seña y los seguimientos), el mapa de qué se reutiliza de `dibujoQr`/`firma`/`seguimientos`, y la bandera de modo observación | Primero |
| **Diagnóstico B** | `Explore` | El bloque 0 del prompt de B: cuántos flujos, cuánto JavaScript duplicado, y si `Flujos/LEEME-flujos.md` §0 sigue diciendo lo mismo. **Si hay un despliegue acoplado a publicar flujos, B no empieza** | Primero, en paralelo con Diseño A |
| **A · servidor** | `general-purpose` | Bloques A-0 y A-1: el módulo puro reaplicado sobre la ingesta de hoy, gracia de 48 h, calendario D-5/D-1/D0/D+2/D+4, `perdidas`; colección de pagos con TCO, `registrarPagoManual`, auditoría, fase 0 de `Analisis/29` | Tras Diseño A |
| **A · cobrador** | `general-purpose` | Bloque A-2 contra el contrato **real** de C (`/api/v1/cobros`, token `CONSUMIDOR_TOKEN_NOVUCHAT` en Secret Manager, `referenciaExterna`, `estadoCobro`, `anularCobro`); el aviso firmado, contra un doble hasta que C lo tenga; sondeo de `estadoCobro` mientras haya un cobro pendiente | En paralelo con A-servidor |
| **A · consola** | `general-purpose` | Bloque A-3: «Pagar», historial, `perdidas`, propietario (fases 1–2 de `Analisis/29`) | Con A-1 fusionado |
| **B · ensamblador** | `flujos-n8n` | Bloques B-1 y B-2 del prompt de B, con la prueba de identidad JSON a JSON | Tras Diagnóstico B, si no hay despliegue acoplado |
| **A · WhatsApp interno** | `flujos-n8n` | Bloque A-4 **como módulo del esquema de B** | **Encolado detrás de B-1 fusionado** |
| **Plantillas de Meta** | `meta-whatsapp` | Bloque A-5: redactadas y listas para presentar. **La presentación espera la compuerta del demo** | Redacción desde el día 1 |
| **Seguridad** | `seguridad` | Cada PR de A y de B; en A, además: reglas de `pagos`, firma del aviso, separación seña/prepago, aislamiento por tenant | Antes de cada OK de fusión |
| **DevSecOps y despliegue** | `devsecops`, `deploy` | Pipeline y staging | **Después de la compuerta del demo** |

**La cola, explícita.** El orden en que las cosas pueden entrar a `main`:

```
Diseño A ─┐
          ├─► A-0 ─► A-1 ─► A-3 ─────────────────┐
A-2 (doble) ──────────────────────► integra con C ┤
Diagnóstico B ─► B-1 ─► B-2 ─► B-3 ─► B-4        ├─► etiqueta (Andres, tras el demo)
                 └──► A-4 (módulo) ──────────────┘
C-1 (hecho, PR #38 del cobrador) ──► A-2 consume ya · C-2 (aviso) ──► A-2 deja de sondear
```

Regla de integración, y es dura:

1. **Nada de A se fusiona sin la prueba negativa** de que demostración y
   prueba no se cortan, de que un tenant no ve ni paga lo de otro, y de que
   ninguna pantalla mezcla seña con prepago.
2. **A-0 entra a `main` en modo observación** (calcula y registra el corte,
   no corta) y **así se queda** hasta que Andres, después del demo y con un
   pago confirmado de punta a punta, decida encenderlo.
3. **Nada de B se fusiona sin la prueba de identidad**: el JSON ensamblado es
   byte a byte el que hoy corre, salvo lo que el PR declara.
4. **A-4 no existe hasta que B-1 esté en `main`.** Si B se demora, A-4 espera
   en la cola; no se «adelanta» editando el JSON a mano.
5. **Si algo rompe la atención de un comercio operativo, se detiene todo** y se
   revierte el bloque.

## Qué construir, por bloques

Los bloques de A son los de `Prompts/prepago-estricto.md` (0 a 5), con estas
tres precisiones que el prompt no tenía:

- **A-0** se hace sobre la ingesta de hoy: primero leerla entera, después
  reaplicar. Es integración, no trasplante.
- **A-2** consume `docs/10-contrato-consumidores.md` del proyecto de cobros
  **literalmente**: `referenciaExterna` = `tenant/periodo/pagoId` (opaca para
  el cobrador; sin nombres ni teléfonos), `concepto` sin datos del comercio
  (lo ve quien paga en su banco), monto como texto decimal, `estadoCobro` por
  referencia, y **solo `CONFIRMADO` es pagado** (`PAGO_DETECTADO` no lo es).
  El doble de prueba en `admin/pruebas/dobles/cobrador.ts` imita ese
  contrato y agrega el aviso firmado que todavía no existe; se descarta
  cuando C-2 exista.
- **A-4** es un módulo en `Flujos/src/`, no una edición del JSON.

Los bloques de B son los de `Prompts/modularizacion-flujos.md` (0 a 4), sin
cambio.

**C se encola así:** al terminar Diseño A, escribe en `Prompts/COORDINACION.md`
la fila de C con **lo que A-2 ya consume** (bloque 1, existente) y **lo que
espera** (bloque 2: la forma exacta del aviso firmado que el doble imita), y
avisa a Andres que la sesión del proyecto de cobros puede seguir con ese
bloque cuando él quiera. Lo que falta del lado de NovuChat para conectar de
verdad: el token `CONSUMIDOR_TOKEN_NOVUCHAT` en Secret Manager (lo emite el
dueño del cobrador; nunca pasa por el chat) y la cuenta de cobro de NovuChat
en ese proyecto.

### Lo que NO se construye
- Nada bancario en NovuChat; nada que confirme un pago sin el banco o el
  propietario.
- Nada que mezcle la seña con el prepago: ni pantalla, ni colección, ni texto.
- Tarjeta, débito automático, factura fiscal (es otro proyecto), descuento por
  meses, doce meses, cobrar por canal o por flujo.
- Partir las Functions en paquetes, migrar la ingesta a reglas, mover Hosting:
  son frentes propios con su compuerta (memoria `modularizacion-plan-por-etapas`).
- **Nada en producción antes de la compuerta del demo.**

## Entregables al cerrar
- `Prompts/COORDINACION.md` al día en cada cambio de estado de cualquier frente,
  incluida la fila de C y lo que está «en espera de la compuerta del demo».
- Un PR por bloque, con costo declarado en mensajes, pruebas negativas y el
  resultado **real** del ensayo que le toque; el ensayo de A de extremo a
  extremo con un cobro real de monto mínimo queda **listo pero sin ejecutar**
  hasta después del demo.
- `admin/DISENO.md` y `ESTADO.md` con una sección por frente; la ficha
  `~/Claude-Proyectos/proyectos/novuchat.md` con el prepago y el ensamblador
  como módulos.
- La lista exacta de lo que espera a Andres después del demo, en orden: qué
  fusionar, qué etiquetar, qué publicar, qué presentar a Meta, y cuándo
  encender el corte.
