# «Venta mínima» de Q'Taco (tenant `qtaco`): qué es común y qué es propio

Zona: `Flujos/clientes/venta-minima/`. La carpeta conserva el nombre del flujo (identidad del flujo, no del tenant: la mudanza no renombra). Mudada desde `Flujos/experimental/venta-minima/` (mudanza, `docs/arquitectura/mudanza.md`): 0 bytes cambiados en los JSON, sin publicar. **No verificado en vivo, por decisión de Andres (modo seco: huella igual + CI, 16/11/2026).**

Salidas: `venta-minima.qtaco.json` (vivo, número …2120), `venta-minima.qtaco-3727.json` (número definitivo, sin publicar), `venta-minima.prueba.json` y `venta-minima.ensayo-demo-a.json` (variantes de prueba y ensayo). Armado: `node Flujos/clientes/venta-minima/construir.mjs` las escribe; con `--verificar` no escribe y sale 1 si difieren o violan una guardia. Diseño completo: `DISENO.md`. Datos del tenant: `admin/scripts/datos/venta-minima/` (no se tocan en una mudanza).

Pruebas: `admin/pruebas/venta-minima-*.test.ts` y `admin/pruebas/tenants/qtaco/`.

## Común, INCLUIDO desde su fuente (sin copia)

| Pieza | Fuente |
|---|---|
| Armador, guardado, expresiones, sesión, avisos (`av*`) y mensajes | `Flujos/src/core/sin-agente/` (`construir.mjs`, `guardado.mjs`, `expresiones.mjs`, `sesion.js`, `avisos.js`) |
| Entrada verificada del receptor (6 nodos) | `Flujos/src/core/receptor/entrada-del-receptor.plantilla.json` (PR-7); `flujo.plantilla.json` conserva la copia de la que se extrajo |
| Respuesta coherente, baja, identidad y párrafos | `Flujos/src/core/conversacion/` y `Flujos/src/core/texto/` |
| QR del pedido y anuncio por titular | `Flujos/src/modulos/pedidos/qr-del-pedido.js`, `Flujos/src/core/medios/anuncio-por-titular.js` |
| miniCRM | `Flujos/experimental/comun-sin-agente/construir-crm.mjs` (proveedor que se queda en `experimental/`) |

## Propio

Las librerías `src/lib/*` (pedido, reserva, cobro, promos, comun…) y los nodos `src/nodos/*` (decidir turno, plan del turno, armar mensajes…), la batería `herramientas/bateria.mjs` y sus casos. Las diferencias frente al núcleo común están declaradas como excepciones en `admin/pruebas/core/migracion/excepciones.ts` (M4 «Config del negocio», «Uso extendido», «Comercio no operativo» y «Carga de entrada»; M5 `NIEGA_IA`; error por nombre y rama de medios), con dueño y vencimiento.
