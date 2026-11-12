# Qué significa «migrado» (etapa 0 de la migración de flujos, 12/11/2026)

Un flujo está **migrado** cuando vive en `Flujos/clientes/<t>/` y cumple los siete puntos de abajo. El tablero con una fila por
flujo es `docs/arquitectura/migracion.md`; lo ejecuta `admin/pruebas/core/migrado.test.ts` (módulo
`admin/pruebas/core/migracion/migrado.ts`). Decisiones de Andres del 12/11/2026: se migra ya y se unifica después («camino
corto»); la comparación «byte a byte» es contra el JSON versionado en `main`, con la diferencia frente al flujo vivo declarada en
la fila del flujo; **la mudanza nunca publica**; los flujos sin agente de n8n entran como excepción con vencimiento (máximo 90
días); doctoras, `bellido-agendamiento.json` y `novuchat-onboarding.json` quedan **congelados**, sin mudarse.

**La etapa 0 no arregla ningún flujo.** Lo que hoy no cumple un punto entra como excepción declarada, con dueño y fecha, en la lista
cerrada `admin/pruebas/core/migracion/excepciones.ts`, que solo puede bajar (tope medido, vencimiento a no más de 90 días).

| Punto | Qué exige | Quién lo comprueba |
|---|---|---|
| **M1** | Existe `Flujos/clientes/<t>/` con `PROPIO.md`, y el JSON vive ahí. | `migrado.test.ts` (`problemasDeMigrado`) |
| **M2** | El constructor sale 0 con `construir.mjs --verificar` (o el ensamblador, `admin/scripts/ensamblar-flujo.mjs verificar`, dice «idéntico»). Sin constructor no hay mudanza. | `migrado.test.ts`; los constructores y `ensamblador.test.ts` |
| **M3** | El sha256 del JSON es igual a la `huella` de su fila en el tablero: una mudanza no cambia un byte ni publica cambios pendientes. | `migrado.test.ts` |
| **M4** | Cada nodo común del flujo —los cinco (Normalizar entrada, Config del negocio, Procesar respuesta, Uso extendido, Comercio no operativo) y los dos de la capa común experimental (Carga de entrada, Puerta del turno)— INCLUYE una variante declarada de `Flujos/src/core` (la lista cerrada de `VARIANTES.md`: igual a ella, o terminado en ella), o tiene excepción. «Carga de entrada» y «Puerta del turno» aún no tienen variante en core: todo flujo que las lleve es excepción hasta que suban a core. | `core/nucleo-comun.test.ts` sobre todos los flujos de producción; `migrado.test.ts` sobre los mudados |
| **M5** | La red `NIEGA_IA` viene de una fuente declarada (la expresión de `core/procesar-respuesta.js`, idéntica en sus tres variantes), o tiene excepción. | `core/niega-ia.test.ts` (estático); `migrado.test.ts` |
| **M6** | Las siete pruebas comunes de invariantes lo recorren, descubriéndolo del disco con la lista única (`admin/pruebas/lib/flujos-de-cliente.ts`): `entregas`, `ux-derivacion`, `capacidades-comunes`, `flujos-origen`, `niega-ia`, `error-workflow-por-nombre` y `guardado-obligatorio`. | Cada una de las siete; `migrado.test.ts` verifica que usan la lista única |
| **M7** | Tiene fila en `docs/versiones-por-cliente.md`. | `migrado.test.ts` |

## La lista única

`flujosVersionados()` descubre del disco todo `*.json` de `Flujos/` con `nodes` y `connections` (no plantillas ni copias locales), esté
en la raíz, en `experimental/` o en `clientes/`. `flujosDeProduccion()` le quita las copias `.prueba` y `.ensayo-demo-a`. Un flujo
nuevo, o uno que se muda de `experimental/` a `clientes/`, entra solo a las siete pruebas; nadie edita una lista a mano.

## Las excepciones

Clave `<json>#<regla>#<nodo>`, con `dueno`, `vence` (AAAA-MM-DD, a no más de 90 días de `ALTA`, 2026-11-12), `motivo` y `desde`. Reglas:
`nucleo-comun` (M4), `niega-ia` (M5), `error-workflow-por-nombre`, `ux-derivacion`, `capacidades-comunes`, `flujos-origen` y `entregas`.
Cada prueba común exige tres cosas: que toda violación de hoy tenga su excepción, que ninguna excepción **sobre** (si el flujo ya cumple,
hay que borrarla) y que la clave nombre un flujo que existe. `TOPE` y `TOPE_POR_REGLA` fijan cuántas hay; cambiarlos, o un `vence`,
exige pasar por el agente `seguridad`. La identidad de un flujo no depende de su carpeta: una excepción o una fila del tablero
sobrevive a `git mv` de `experimental/<x>/` a `clientes/<x>/`.

## Cómo se muda un flujo

El procedimiento (`docs/arquitectura/mudanza.md`) llega con la primera mudanza. Lo que fija esta etapa: la fila del tablero pasa a `mudado`
con la huella del JSON versionado; el JSON no cambia un byte; **no se corre `publicar-flujo.sh` ni `flujo-de-prueba.mjs`** en un PR
de mudanza; y las excepciones de M4 y M5 del flujo se conservan hasta que se cierren en la etapa 1.
