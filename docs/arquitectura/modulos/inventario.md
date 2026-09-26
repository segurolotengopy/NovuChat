# Módulo Inventario

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `inventario.ts`, `movimientosStock`, `stock`; `Inventario.tsx` |
| **Depende de** | Productos |
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

**Observación:** hoy sin chequeo de flujo en `ajustarStock`: F2 agrega `tieneModulo('inventario')`. El stock que hoy se edita desde `Catalogo.tsx` es una ranura de este módulo. El gancho que descuenta stock al cerrar una venta respeta `agotado` (F3)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.
