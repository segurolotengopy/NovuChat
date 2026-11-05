# Módulo Productos

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `catalogo`, `fotosCatalogo`, `contadores/catalogo`, `limiteCatalogo.ts`, `imagenCatalogo.ts`, importación, resumen al prompt; `Catalogo.tsx` (1.854 líneas) |
| **Depende de** | — |
| **Límite por plan** | productos (20 / 100 / 500). Hecho el 15/09 en `firestore.rules` al crear o borrar un producto, en el mismo lote que el contador `contadores/catalogo`; la importación en lote por la callable `importarCatalogo` (`limiteCatalogo.ts`). Ver `limites.md` |
| **Configuración** | campos del catálogo dentro de `config/negocio` hoy; lista blanca por manifiesto en F2 |
| **Colecciones** | `catalogo`, `fotosCatalogo`, `contadores/catalogo`, `comprobacionesImagen`; escrituras exigen `tieneModulo('productos')` |
| **Pestañas** | Catálogo (Servicios o Productos según el registro) |
| **Prompt** | resumen del catálogo al prompt: hasta 40 ítems la lista completa con precios; por encima, un resumen con categorías y rango, y el enlace al catálogo web (`docs/base-comercial.md` §5) |
| **Herramientas** | — (el modelo lee el catálogo en el prompt) |
| **Nodos (lo que queda en n8n)** | ninguno propio hoy |
| **Ganchos** | `antesDelTurno` (resumen al prompt) |
| **Mensajes por conversación** | 0 |
| **Pruebas** | `limite-catalogo.test.ts`, `imagen-catalogo.test.ts`, `reglas.test.ts` («Límite de productos por plan»), `xlsx.test.ts`, `demo-b-catalogo.test.ts` |

**Observación:** todo plan lo incluye; ser módulo le da manifiesto y límite, no lo vuelve opcional. La etiqueta Servicios / Productos la decide el registro, no `flujos.ts`. `Catalogo.tsx` **se parte**: la duración de cita es una ranura de Agenda; la vista previa, de Catálogo web; el stock, de Inventario. El resumen del catálogo al prompt sale de `prompt.ts` (core) y viene acá

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Piezas de la consola que van con este módulo

`modulos/productos/xlsx.ts` y `modulos/productos/foto.ts` (`Analisis/41` §5.3); `csv.ts` pasó a `central/lib/` porque también la usa Captación (F2, módulos). Storage:
`fotosCatalogo` con `docs/seguridad/reglas-storage.md`.

## Nombres de producto y el modelo (24/10/2026, seguridad)

El nombre de un producto llega al prompt de todos los flujos y al contexto de las campañas. `modulos/productos/nombreSeguro.ts` decide qué nombres llegan: uno que dispara la capa 1 de `comportamiento.ts` (nivel «rechazado») o una frase de instrucción (`frasesDeInstruccion.ts`, sin dependencias, también la usa la consola) **se omite** del prompt y del contexto; el producto sigue en el catálogo y en la Consola, no se borra y no se manda ningún mensaje (0 por conversación). Las marcas de bloque (`[]{}<>«»`) se cambian por un espacio. «prompt» en singular omite; «prompts» pasa solo como producto contado («Pack 100 prompts»). `importarCatalogo` rechaza la fila con `nombre_no_permitido`; la consola avisa al guardar y marca el ítem omitido. Las reglas de Firestore no pueden correr la lista: lo que manda es la omisión al leer. Campañas depende de Productos por esto (`dependeDe`). Prueba: `pruebas/modulos/productos/nombres-catalogo.test.ts`.

Segunda ronda (seguridad): `descripcion` y `area` pasan por `textoLibreParaElModelo` (se quita el CAMPO, no el producto), el identificador del documento se lee como frase y los invisibles/bidi se quitan del texto que sale. Seguimiento declarado: aviso persistente de la omisión (exige clave nueva en `itemValido`) y `configuracionParaFlujo.ts` (central).
