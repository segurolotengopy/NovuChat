# Módulo Inventario

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `inventario.ts`, `movimientosStock`, `stock`; `Inventario.tsx` |
| **Depende de** | Productos. **De él depende Catálogo web** (declarado el 01/10/2026: el catálogo lee su stock y lo descuenta) |
| **Límite por plan** | — |
| **Configuración** | campos de stock dentro del ítem del catálogo; lista blanca por manifiesto |
| **Colecciones** | `movimientosStock`, `stock`; escrituras exigen el módulo |
| **Pestañas** | Inventario (`admin`) |
| **Prompt** | fragmento «agotado» del prompt de venta |
| **Herramientas** | — |
| **Nodos (lo que queda en n8n)** | ninguno propio |
| **Ganchos** | `despuesDelTurno` (descuento), `alCierre` con Pedidos |
| **Mensajes por conversación** | 0 |
| **Pruebas** | `inventario.test.ts` |

**Observación:** `ajustarStock` y `dejarDeControlarStock` exigen el módulo en el servidor desde el 05/10/2026: tras autenticar y comprobar que quien llama es administrador del negocio, leen `tenants/{t}` (una lectura de documento, fuera de la transacción) y responden `permission-denied` si `tieneModulo(ficha, 'inventario')` es falso (ficha inexistente, `flujos` que no es lista, reservas o captación sin lista, o una lista sin `inventario`). Con lista manda la lista; sin ella, el respaldo por `flujos`/`vertical` da `inventario` al flujo de venta, así que un comercio de venta sin lista no cambia. La ruta de la consola redirige al inicio sin el módulo (`capacidadesDeConsola(...).conInventario`). Pruebas: `inventario-exige-modulo.test.ts`. **Seguimientos:** la lectura de `movimientosStock` en `firestore.rules` sigue sin ligarse al módulo (la toca otro PR); y la importación de CSV de `Catalogo.tsx` (Productos) intenta fijar la cantidad de un ítem aunque el negocio no tenga el módulo y recibe `permission-denied` (queda como «la cantidad no se pudo fijar»): Productos puede ocultar la columna. El stock que hoy se edita desde `Catalogo.tsx` es una ranura de este módulo. El gancho que descuenta stock al cerrar una venta respeta `agotado` (F3)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.
