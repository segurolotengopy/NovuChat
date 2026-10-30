# Walisuma: catálogo importable (28/10/2026)

| Archivo | Qué es |
|---|---|
| `catalogo.fuente.tsv` | Fuente editable: una línea por ítem (página del PDF, pie de foto, familia del SKU, nombre, descripción, precio, área) |
| `catalogo.json` | Lo que se carga: sección `catalogo` para `scripts/datos/cargar-negocio.mjs` (132 ítems, todo en Bs) |
| `skus.tsv` | SKU propuesto ↔ id del ítem ↔ nombre ↔ precio ↔ página del PDF |

- **Todo en bolivianos.** El PDF del cliente imprime Bs; no hay conversión ni tipo de cambio (decisión de Andres, 28/10/2026).
- **Sin precio (a consultar):** 3 tapices que el PDF no valora. Se piden al cliente; no se inventan.
- **Sin control de stock:** el PDF no trae existencias, así que el campo `stock` no se escribe.
- **SKU:** `WAL-<familia>-<nnn>` es una propuesta de NovuChat que el cliente valida. Va al final de la descripción como «Cód.»; el identificador del ítem sale del nombre (`idDe`).
- **Bebidas alcohólicas apagadas** (`activo: false`): licor de coca y Montecito, por la política de comercio de Meta. Quedan apagadas por decisión de Andres (28/10/2026); se encienden con un campo (`activo: true`) cuando se confirme la política de Meta.
- **Pastillas de coca** (4 ítems): apagadas (`activo: false`) por decisión de Andres del 30/10/2026; se encienden con un campo si cambia la decisión.
- **Respuestas del cliente (30/10/2026):** tapices sin precio = a consultar (piezas únicas); «vicuña» en estola y chal es un color, solo las bufandas son de vicuña; el posavasos de diseño cuadrado se llama «Rombo»; el material es «jipijapa»; «colores varios» = se consulta la disponibilidad del momento; los licores no se ofrecen (quedan apagados). Andres decidió (30/10/2026) que las pastillas de coca (4 ítems) tampoco se ofrecen: quedan apagadas como los licores.
- **Fotos:** no van en el repositorio (son de un tercero). Una por ítem, `<id>.webp`, recortadas del PDF; se suben con `cargar-fotos-catalogo.mjs` y el OK de Andres.
- **Cargar** (solo con el comercio dado de alta y el botón de Andres): `cargar-negocio.mjs --proyecto <id> --tenant walisuma --archivo scripts/datos/walisuma/catalogo.json` en seco y luego con `--aplicar`.
- **Prueba:** `pruebas/tenants/walisuma/catalogo.test.ts` pasa cada ítem por el normalizador del servidor y niega los casos malos.
