# Venta digital: base común

Módulos que comparten los flujos de venta digital de productos por WhatsApp. Aquí no hay textos, nombres, productos ni montos de ningún negocio: todo eso entra por parámetro. Origen: `rr.js`, `cobro.js` y `avisos.js` de la primera venta digital, en el commit `fb3b8994` (Entrega 2: la conversación antes de las opciones). Esa primera venta digital migra a esta base en un PR propio, después de #618.

Los archivos se pegan delante del código de un nodo Code de n8n (`librerias` del armador): sin `import`/`export`, `require`, `URL`, `Buffer` ni `crypto`. Los nombres globales llevan prefijo (`cb`, `av`, `vd`). Orden: `cobro.js`, `avisos.js`, `conversacion.js`; `carrito.js` no depende de ninguno y va donde haga falta.

## `src/cobro.js` y `src/avisos.js`
Cabecera neutra + el cuerpo de las copias actuales, idéntico byte a byte desde la primera línea en blanco. `admin/pruebas/venta-digital-base.test.ts` exige que cada copia sea «su cabecera + este cuerpo». Si el cuerpo cambia aquí, las copias migran.

## `src/conversacion.js` (prefijo `vd`)
Depende de `cbLinea` y `cbMonto` (`cobro.js`). Todas son puras.

| Función | Contrato |
|---|---|
| `vdFichaCharla(f, ahoraMs?)` | `{ charlaN (0..1000), pidioOpciones, opcionesVistas }`, booleanos estrictos. Con `ahoraMs`, una charla sin mensajes hace más de 48 h (`f.ultimoMs`) se reinicia. |
| `vdHabilitado(ctx)` | La compuerta: `true` con `charlaN >= 2`, o `qrAbierto`, `producto`, `pedidos > 0`, `comprobanteMs > 0` o `enRevision`. Un campo ausente o de otro tipo no abre. |
| `vdCuentaComoCharla(tipo, saludadoAntes)` | `true` para los tipos de conversación (`modelo`, `audio_modelo`, `imagen_modelo`, `puente`, `puente_fijo`, `charla_fija`, `opciones`, `opciones_fijo`); `saludo` solo si el teléfono no estaba saludado. |
| `vdLineaModo(modo)` | `'[MODO_TURNO: X]\n'` para `charla`, `antes`, `puente`, `opciones`; `''` para cualquier otro. |
| `vdSinPreguntaFinal(texto)` | Quita toda oración interrogativa; `''` si no queda nada. |
| `vdQuitarPromesaDeOpciones(texto, debiles?)` | Quita las oraciones que prometen precios u opciones (`vdPrometeOpciones`). `debiles`: nombres de producto que solo prometen junto a un verbo de mostrar. |
| `vdEtiquetaConPrecio(nombre, monto)` | `«<nombre> <precio>Bs»`, a lo más 20 caracteres, conserva el «Bs». |
| `vdAhorro(cat, pack, componentes)` | Suma de los componentes menos el paquete, redondeada a centavos; `null` si falta un precio o no ahorra. |
| `vdTextoPuente({ variantes, cierre }, hashUltimo)` | Primera variante cuyo texto, solo o con el cierre, no sea idéntico a lo último enviado (`vdHashTexto`). |
| `vdPrecioPedido(norm, sinonimos)` | `{ producto: id }` si pregunta el precio y nombra un solo producto; `{ producto: '' }` si pregunta en general; `null` si no pregunta. «precio» suelto no cuenta. |

Aparte de la lista del plan, se exponen los ayudantes `vdNorm`, `vdHashTexto`, `vdOraciones`, `vdEsPregunta` y `vdPrometeOpciones`.

## `src/carrito.js` (prefijo `vc`)
El carrito que propone el modelo y valida el código. Sin dependencias (ni de `cobro.js`). Todas son puras y nunca lanzan con entradas raras. Prueba: `admin/pruebas/tenants/walisuma/carrito.test.ts`.

| Función | Contrato |
|---|---|
| `vcVendibles(catalogo, { max = 200 })` | `{ id, nombre, precioCentavos, area, descripcion }` solo de ítems con `activo === true`, `precio` finito > 0 (≥ 1 centavo), `moneda` `'BOB'` o ausente e `id` de un solo segmento (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/`) que no se repite en el catálogo (un id repetido no se vende en ninguna aparición), con nombre no vacío tras limpiarlo. Precio en centavos enteros. |
| `vcIndice(vendibles)` | Una línea por ítem, `id\|nombre\|precio` (dos decimales solo si hacen falta), para el prompt. |
| `vcSeleccion(vendibles, texto, ficha, { max = 15, palabras = {} })` | Ids cuyas descripciones van al prompt, sin repetir y en este orden: carrito de la ficha, `ficha.mostrados`, área nombrada en `texto` (también por segmento: «Familia · Subfamilia» cuenta por «Familia» o por «Subfamilia»), palabra de material de `palabras` (`{ palabra: [fragmentos] }`, dato del negocio). |
| `vcLineas(crudas, vendibles, { maxLineas = 30, maxCantidad = 50, maxDetalle = 120 })` | `{ lineas, descartadas }`. Del modelo solo se lee `id`, `cantidad` y `detalle`; precio, total, subtotal y descuento se ignoran. `cantidad` es un entero > 0 o un texto de solo dígitos. Se procesan a lo más 100 elementos. Descartes `{ id, motivo }` (el id se limpia): `desconocido`, `cantidad`, `exceso`, `monto` (subtotal que no es entero seguro). El motivo `tope` avisa que la cantidad se recortó (al pedirla o al sumar) y la línea se conserva. Mismo id y mismo detalle (sin tildes ni mayúsculas) se suman; otro detalle, otra línea. El detalle pierde invisibles, saltos y enlaces (con esquema, `www.` o forma de dominio). |
| `vcTotalCentavos(lineas)` | Suma de `subtotalCentavos`. Nunca suma envío ni descuentos. |
| `vcMonto(centavos)` | `«Bs 1.234,50»` / `«Bs 450»`. **Recibe CENTAVOS** (`cbMonto` de `cobro.js` recibe bolivianos). Si no es un entero seguro devuelve `''`. |
| `vcResumen(lineas)` | `cantidad × nombre (detalle) — subtotal` por línea (el paréntesis solo si hay detalle) y `Total: …` al final. Sin emojis. |
| `vcLineaAviso(lineas, { max = 4 })` | `cantidad × nombre, …` y `y N más`; sin saltos ni espacios repetidos (variable de plantilla), a lo más 200 caracteres; sin líneas, `sin ítems` (la variable no puede ir vacía). |
| `vcMismoCarrito(a, b)` | `true` si coinciden en id, cantidad, precio y detalle, sin importar el orden. Lo que no es arreglo, o trae elementos sin forma, nunca es igual. |

## Qué de `rr.js` no se portó
`rrQuitarEcoDeMarcador`, `rrQuitarDelimitadores`, `rrMenu`, `rrMenuDeComplemento`, `rrTextoOpciones`, `rrSaludo`, `rrTexto*`, `RR_PRODUCTOS`, `RR_PROMPT`, `rrCatalogo` y la ficha completa: llevan textos, productos o nombres de un negocio, o salen del alcance de la base. Cada flujo los define con sus datos.
