# Módulo Pedidos

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `pedidos`, checkout del carrito (dentro de `catalogoWeb.ts`), `Pedidos.tsx`, `Memoria del carrito` |
| **Depende de** | Productos |
| **Límite por plan** | — |
| **Configuración** | `config/pedidos` (hoy dentro de `config/venta`), con lista blanca por manifiesto |
| **Colecciones** | `pedidos` |
| **Pestañas** | Pedidos (`admin` y `oper`) |
| **Prompt** | fragmento de venta del prompt (`Flujos/prompts/modulos/pedidos.md`, hoy dentro del prompt del Demo B) |
| **Herramientas** | las del carrito del esqueleto de venta |
| **Nodos (lo que queda en n8n)** | nodos Code del Demo B sin extraer (15, con Core, Cobros y Catálogo web); F2 los extrae con `ensamblar-flujo.mjs extraer` |
| **Ganchos** | `alCierre` (venta) |
| **Mensajes por conversación** | 0 |
| **Pruebas** | `carrito-podado.test.ts`, `demo-b-catalogo.test.ts`, `entrantes-por-tipo.test.ts`; la suite del Demo B |

**Observación:** hoy es parte del vertical `venta`; el checkout escribe pedidos y descuenta stock. El checkout que escribe `pedidos` sale de `catalogoWeb.ts` (que se parte) y viene acá. La pantalla Pedidos es la única de la consola que se mira con las manos ocupadas (§4nonies.1, abajo)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene. La
subsección §4nonies.2 (Cobros, la pantalla de la plata) está en `cobros.md`.


<!-- movido de admin/DISENO.md §4sexies.3bis (25/09/2026, líneas 1413-1431) -->

### 4sexies.3bis El catálogo nativo de WhatsApp es una capacidad de VENTA

**Decidido el 2026-09-07.** El catálogo de productos de Meta —con carrito nativo—
se publica **solo para el flujo de venta**. Para agendamiento no se hace, y no es
una deuda: es una decisión.

**Por qué.** En agendamiento el catálogo es **referencial**: la lista que el
asistente usa para saber de qué hablar y cuánto cuesta, no una tienda. Nadie pone
un corte de pelo en un carrito de compras. Y aunque se quisiera, **Meta exige
precio en cada producto**, así que los servicios que se cotizan después de
evaluar —los que la consola modela con el precio opcional, §catálogo— no se
pueden listar: la mitad del catálogo de una clínica quedaría afuera.

**Cómo encaja.** Es una capacidad por flujo, como la agenda o el cobro. Cuando se
implemente, va con su línea en la tabla de capacidades y su publicación desde la
consola —una sola fuente de verdad—, con el SKU de Meta igual al identificador
del ítem para que un carrito llegue al asistente con productos que sabe nombrar.
Análisis completo en `Analisis/09-catalogo-nativo-de-whatsapp.md`.


<!-- movido de admin/DISENO.md §4nonies (25/09/2026, líneas 1810-1830) -->

## 4nonies. Pedidos y cobros: tres pantallas, no una

> **Estado (2026-09-12): las tres pantallas están construidas y en producción**
> (commit `45d130d`, PR #51). Se hicieron **antes** que los dos datos de
> §4nonies.3, por decisión de Andres del 09/09. Por eso cada una dice en
> pantalla lo que todavía no puede mostrar, en vez de aparecer vacía. **Los dos
> datos siguen pendientes**, y son lo próximo de esta sección.

**Pedido de Andres, 2026-09-09.** Hoy «Pedidos y cobro» es UNA pantalla que en
realidad configura el QR: no lista un solo pedido ni un solo cobro. El nombre
promete dos cosas que no están.

Se parte en tres, y la división no es de menú: **cada una la mira una persona
distinta, en un momento distinto, para decidir algo distinto.**

| Pantalla | Quién | Para qué |
|---|---|---|
| **Pedidos** | admin y **operador** | Preparar y entregar lo que se pidió |
| **Cobros** | admin | Ver la plata y confirmar contra el banco |
| **Configuración de QR** | admin | Lo que hoy existe, con su nombre real |


<!-- movido de admin/DISENO.md §4nonies.1 (25/09/2026, líneas 1831-1851) -->

### 4nonies.1 Pedidos — la pantalla del cocinero y del repartidor

**Es la única pantalla de la consola que se mira con las manos ocupadas.** Quien
la abre no está analizando el negocio: está por cocinar o por salir a repartir.
Eso manda sobre todo lo demás — poco texto, lo importante grande, y nada que
obligue a abrir un modal para saber qué hacer.

Listado de pedidos con **fecha y hora**, y por cada uno:

- **Todos los ítems** y sus cantidades.
- **El detalle de cada ítem tal como lo pidió el cliente** —«sin cebolla», «L»—.
  Es lo que más se equivoca y lo que más caro sale equivocar.
- **La modalidad de entrega**: si va a envío o se retira en el local, con la
  dirección cuando corresponde.
- **El monto**.
- **El comprobante de pago que subió el cliente.**

**El operador ve esta pantalla y NO ve Cobros.** No es jerarquía: el cocinero no
necesita saber cuánto facturó el negocio, y cada dato de más en una pantalla
operativa es un dato que hay que saltear para llegar al que importa.


<!-- movido de admin/DISENO.md §4nonies.3 (25/09/2026, líneas 1873-1911) -->

### 4nonies.3 Lo que falta para poder construirlas

No se puede empezar por la pantalla: **dos datos que las dos necesitan no
existen todavía**, y sin ellos saldría una pantalla que miente.

1. **EL COMPROBANTE NO SE GUARDA.** Del mensaje se guardan `tipo`, `texto` y el
   identificador de Meta, pero **no el `media id`**, así que no hay de dónde
   traer la imagen. Hacen falta tres cosas, en orden: guardarlo en la ingesta,
   una función que baje el archivo con el token y lo sirva desde nuestro propio
   origen —nunca un enlace a Meta, que caduca—, y el permiso de lectura. Es el
   mismo hueco que hoy hace que en «Conversaciones» solo se marque el adjunto.

2. **LOS PEDIDOS POR WHATSAPP NO SE GUARDAN COMO PEDIDOS.** La colección
   `pedidos` ya tiene ítems, total, entrega, dirección y nota —está completa—
   pero **solo la escribe el carrito web**. Un pedido tomado conversando registra
   un `cierre`, que es un número para facturar y no lleva ítems. Mientras siga
   así, la pantalla de Pedidos estaría vacía justo para el flujo que la
   necesita. Lo tiene que escribir el flujo al confirmar, con la misma forma que
   ya usa el carrito: una sola forma de pedido, no dos.

**El orden recomendado era ese**: primero los dos datos, después las pantallas,
porque al revés se construye contra datos que no llegan. Se invirtió el 09/09
para tener las pantallas a la vista, con esta condición: **mientras falten los
dos datos, cada pantalla lo dice.** Pedidos avisa que los pedidos de WhatsApp
todavía no se listan, y dónde verlos; Cobros avisa que el comprobante está en
la conversación. Esos avisos se quitan cuando llegue el dato, no antes.

> **Revisión del 17/09 (§4duodecies): el `media id` del comprobante YA NO HACE
> FALTA guardarlo.** La seña por QR resolvió el punto 1 por otro camino: el
> comprobante **no se guarda, se coteja**. El flujo lo baja de Meta con el
> token, un modelo lo lee, y al servidor llega solo el JSON leído (monto,
> cuenta, fecha, hora, banco); la imagen y el PDF no van a Storage ni a
> Firestore, y en el cierre queda `cotejo` con lo leído y el resultado. Cobros
> muestra eso, y sigue diciendo que la imagen está en la conversación: no
> como deuda, sino como decisión. Un comprobante guardado es un dato personal
> más que custodiar, y lo que la persona necesita para mirar su banco —monto,
> banco, hora— ya está en el cotejo. El punto 2 (los pedidos por WhatsApp
> como pedidos) sigue pendiente.


<!-- movido de admin/DISENO.md §4nonies.4 (25/09/2026, líneas 1912-1918) -->

### 4nonies.4 Lo que cambia en el registro de flujos — hecho

`web/src/lib/flujos.ts` declara para `venta` las pestañas Pedidos, Cobros,
Inventario y Configuración de QR. «Pedidos» es la primera con `oper` entre sus
roles, y la compuerta de la cabecera (`App.tsx`) ya filtra por `roles` en vez de
suponer que una pestaña de flujo implica administrador.
