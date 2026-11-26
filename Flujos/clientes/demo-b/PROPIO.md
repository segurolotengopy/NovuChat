# Flujo del Demo B (`Flujos/clientes/demo-b/`)

> **Mudado el 25/11/2026** (`docs/arquitectura/mudanza.md`; decisión D2 de Andres): el JSON salió de la raíz de `Flujos/` con `git mv`, sin cambiar un byte, y no se publicó nada. Esta carpeta solo contiene el JSON; el resto del Demo B vive donde ya estaba.

El Demo B es el número de ensayo de venta: el vertical de venta con cobro por QR (simulado o real, nunca los dos) y alerta al dueño.

## Qué hay aquí

| Archivo | Qué es | Cómo se arma |
|---|---|---|
| `demo-b-venta-cobro.json` | El vertical de venta con cobro por QR | Ensamblador: `admin/scripts/ensamblar-flujo.mjs verificar --exigir-manifiesto clientes/demo-b/demo-b-venta-cobro.json` |

## Dónde vive el resto (no se movió)

- **Manifiesto:** `Flujos/manifiestos/clientes/demo-b/demo-b-venta-cobro.json`. El ensamblador lo busca en `manifiestos/<ruta relativa a Flujos/>`; su campo `flujo` lleva esa ruta (`clientes/demo-b/…`).
- **Código de los nodos:** módulos comunes de `Flujos/src/` (`core/` y módulos). Aquí no hay `src/` propio: el Demo B es la base común de venta, no un cliente con piezas propias.
- **Publicación y ensayos:** `scripts/publicar-flujo.sh --flujo Flujos/clientes/demo-b/demo-b-venta-cobro.json` (entorno `.env.demo-b`), `scripts/ensayo-flujo.sh --demo b` y `docs/ensayo/LEEME.md`.
- **Fila de versiones:** `docs/versiones-por-cliente.md` («Demo B (venta y cobro)»).
- **Vigilancia del número de los demos, sin mudar (decisión D1):** `Flujos/vigilancia-numero-demos.json` es un barrido común y sigue en la raíz.
- **Excepciones declaradas:** `admin/pruebas/core/migracion/excepciones.ts`, por el nombre del JSON (la identidad no depende de la carpeta).

## Lo propio y lo común

No hay piezas propias de un cliente: el flujo es el núcleo común (`Flujos/src/core/` y módulos) inyectado por el ensamblador. Los datos del negocio (nombre, catálogo, cobro) son del tenant, no de esta carpeta.
