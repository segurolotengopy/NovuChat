# Los cinco nodos comunes: inventario de variantes (31/10/2026)

Condición 2 del cierre: un solo archivo por nodo común. Hoy hay tres variantes
(reservas en `core/`, `venta/`, `captacion/`). El inventario muestra que **no
son diferencias de parámetros sino de comportamiento**: cada esqueleto tiene
aguas abajo nodos distintos que leen los campos que el nodo emite. Unificarlas
cambia lo que hoy corre y rompe `ensamblar-flujo.mjs verificar` (8 JSON byte a
byte), así que **no se fuerza**: queda para consulta.

**Decisión de Andres (31/10/2026):** la condición 2 se cierra por **lista cerrada
declarada**: las variantes quedan listadas y `pruebas/core/nucleo-comun.test.ts`
falla si la lista crece sin declararse. **No se unifica ahora**; unificar por
rebanadas queda para después del traslado de Q'Taco (~07/11).

| Nodo | Líneas (reservas / venta / captación) | Diferencia de comportamiento |
|---|---|---|
| Comercio no operativo | 17 / 24 / 14 | Distinto contrato de salida: reservas emite `transferir:false`; venta agrega `phoneNumberId`; captación hace `...it.json` y `pairedItem`. Es el más cercano a unificarse (la salida sería la unión), pero cada rama aguas abajo lee campos distintos. |
| Uso extendido | 51 / 58 / 33 | Reservas: `transferir`+`motivoTransferencia` (reutiliza `Avisar a recepción`). Venta: `avisar`+`textoAviso`+`numeroDueno` (reutiliza `Avisar al dueño`). Captación: `avisar`+`estadoAviso`+`estadoLead`+`guardarLead`, **tuteo** y texto fijo propio. Tres contratos de aviso. |
| Normalizar entrada | 205 / 240 / 186 | Captación calcula `eleccion`, `pideSoporte` y lo propio del guion; venta y reservas arrastran la config y manejan `order`/carrito de otro modo. |
| Config del negocio | 403 / 469 / 294 | Cada una arma sus rótulos de cobro, agendas o planes propios; el conjunto de claves que emite es distinto. Lo que es parámetro por negocio ya vive en `Config base`; lo que queda es lógica. |
| Procesar respuesta | 2049 / 447 / 921 | Marcas distintas (`[TRANSFERIR]`; `[ENVIAR_QR]`/`[PEDIDO_CONFIRMADO]`/`[ENVIAR_CATALOGO]`; planes, áreas y ficha de captación) y candados distintos (cita, cobro, NIEGA_IA). Sin base común extraída. |

## Camino propuesto (rebanadas siguientes, cada una con `verificar` en verde y la suite de su flujo)

1. Extraer lo literalmente común (`hasta()`, `FIJO`, texto neutro de suspensión) a un módulo incluido, sin cambiar la salida.
2. Comercio no operativo y Uso extendido: unir contratos con la unión de campos, adaptando los nodos aguas abajo en el mismo PR (toca manifiestos y JSON de los 3 flujos: requiere regenerar y ensayo).
3. Normalizar entrada y Config del negocio: núcleo + extensiones por módulo.
4. Procesar respuesta: partir en núcleo (NIEGA_IA, promesas sin respaldo) y marcas por módulo.

`admin/pruebas/core/nucleo-comun.test.ts` fija hoy la lista cerrada de variantes
(no puede crecer sin declararse) y compara byte a byte cualquier copia incluida
en `Flujos/clientes/<tenant>/` contra core (condición 3).
