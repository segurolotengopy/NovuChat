# Flujos del Demo A (`Flujos/clientes/demo-a/`)

> **Mudado el 25/11/2026** (`docs/arquitectura/mudanza.md`; decisión D2 de Andres): los dos JSON salieron de la raíz de `Flujos/` con `git mv`, sin cambiar un byte, y no se publicó nada. Esta carpeta solo contiene los dos JSON; el resto del Demo A vive donde ya estaba.

El Demo A es el número de ensayo de reservas (sin pacientes): el vertical de agendamiento con Google Calendar y su aviso de recordatorios.

## Qué hay aquí

| Archivo | Qué es | Cómo se arma |
|---|---|---|
| `demo-a-agendamiento.json` | El vertical de reservas (agente «Sofía», agenda, seña y QR) | Ensamblador: `admin/scripts/ensamblar-flujo.mjs verificar --exigir-manifiesto clientes/demo-a/demo-a-agendamiento.json` |

## Dónde vive el resto (no se movió)

- **Manifiestos:** `Flujos/manifiestos/clientes/demo-a/<flujo>.json`. El ensamblador los busca en `manifiestos/<ruta relativa a Flujos/>`; su campo `flujo` lleva esa ruta (`clientes/demo-a/…`).
- **Código de los nodos y prompts:** módulos comunes de `Flujos/src/` (`core/`, `modulos/agenda/`, `modulos/cobros/`) y `Flujos/prompts/reservas/demo-a.md`. Aquí no hay `src/` propio: el Demo A es la base común, no un cliente con piezas propias.
- **Publicación y ensayos:** `scripts/publicar-flujo.sh` (el Demo A es su flujo por defecto), `scripts/ensayo-flujo.sh` y `docs/ensayo/LEEME.md`.
- **Fila de versiones:** `docs/versiones-por-cliente.md` («Demo A (agendamiento)»).
- **Recordatorios, sin mudar (25/11/2026):** `Flujos/demo-a-recordatorios.json` sigue en la raíz. `.env.recordatorios` no tiene el acceso a n8n que exige el modo seco de `estado-de-versiones.sh` (paso 6 de `docs/arquitectura/mudanza.md`), y sin ese seco no se muda un flujo que puede estar vivo. Se muda cuando ese entorno esté completo.
- **Excepciones declaradas:** `admin/pruebas/core/migracion/excepciones.ts`, por el nombre del JSON (la identidad no depende de la carpeta).

## Lo propio y lo común

No hay piezas propias de un cliente: ambos flujos son el núcleo común (`Flujos/src/core/` y módulos) inyectado por el ensamblador. Los datos del negocio (nombre, horarios, calendarios) son del tenant, no de esta carpeta.
