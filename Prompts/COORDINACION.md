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
| **A · Diseño** | (solo lectura, agente `Plan`) | ficha de diseño: `pagos`, contrato del cobrador, modo observación, plan de reaplicación | en curso (20/09) | ninguno; entrega texto para `admin/DISENO.md` §4undecies | fila de C con el contrato exacto |
| **A-0 · servidor** | `prepago/modulo-y-cortes` | módulo puro reaplicado sobre la ingesta de hoy, gracia 48 h, calendario D-5/D-1/D0/D+2/D+4, `perdidas`, modo observación | encolado detrás de Diseño A | `admin/functions/src/prepago.ts` (nuevo), `ingesta.ts`, `index.ts`, `planes.ts`, `admin/pruebas/` | — |
| **A-1 · pagos** | `prepago/pagos-y-carga-manual` | colección `pagos` con TCO, `registrarPagoManual`, auditoría, fase 0 de `Analisis/29` | encolado detrás de A-0 | `index.ts`, `firestore.rules`, `admin/pruebas/` | — |
| **A-2 · cobrador** | `prepago/cliente-cobrador` | cliente del cobrador contra el doble `admin/pruebas/dobles/cobrador.ts` | encolado detrás de Diseño A (contrato) | `admin/functions/src/cobrador.ts` (nuevo), `admin/pruebas/dobles/` | integra con C cuando exista |
| **A-3 · consola** | `prepago/consola-pagar` | «Pagar», historial, `perdidas`, propietario (fases 1–2 de `Analisis/29`) | encolado detrás de A-1 fusionado | `admin/web/src/paginas/EstadoCuenta.tsx`, `Consumo.tsx`, `Tenants.tsx` | — |
| **A-4 · WhatsApp interno** | `prepago/whatsapp-pago` | intención «pagar / estado» como módulo del esquema de B | **encolado detrás de B-1 fusionado** | `Flujos/src/` (módulo), nunca el JSON a mano | — |
| **A-5 · plantillas de Meta** | `prepago/plantillas-cobranza` | redacción de las cinco plantillas de utilidad | pendiente de lanzar (20/09) | documento de plantillas del repo | **la presentación a Meta espera la compuerta del demo** |
| **B · Diagnóstico** | (solo lectura, agente `Explore`) | bloque 0: medir flujos, duplicación, suites con `new Function`, LEEME §0, qué hay en vuelo | en curso (20/09) | ninguno | decide si B empieza |
| **B-1 · ensamblador** | por definir | ensamblador + `extraer` + un vertical, prueba de identidad byte a byte | encolado detrás de Diagnóstico B | `Flujos/src/`, `Flujos/prompts/`, `Flujos/LEEME-flujos.md` §0, `package.json` de pruebas | — |
| **B-2 · resto de flujos** | por definir | todos los flujos, incluidos los de cliente con nodos propios | encolado detrás de B-1 | `Flujos/*.json` (regenerados idénticos), `admin/scripts/sincronizar-flujo-cliente.mjs` | — |
| **B-3 · corpus del sitio** | por definir | el corpus fuera del nodo Code | encolado detrás de B-1 fusionado | flujo de captación, Function que lo sirve | — |
| **B-4 · procedimiento** | por definir | RUNBOOK etapa 5, agente `flujos-n8n`, gancho de pre-commit | encolado detrás de B-2 | `docs/alta-cliente/RUNBOOK.md`, `.claude/agents/flujos-n8n.md`, `.githooks/` | — |
| **C · contrato del cobrador** | otro proyecto (`$HOME/ManejoQRSimple/`), otra sesión | — | **encolado**: se abre con `Prompts/cobrador-contrato-para-consumidores.md` cuando Andres quiera | nada de NovuChat | la fila con el contrato exacto se completa al cerrar Diseño A |

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

(vacío al 20/09/2026; acá se anota cada bloque que llegue a una acción vedada)

## Lo que espera a Andres después del demo

(se completa al cerrar; en orden: qué fusionar, qué etiquetar, qué publicar, qué
presentar a Meta, y cuándo encender el corte)

## Bitácora

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
