# El registro de módulos

> Pieza con nombre propio de la arquitectura por capas
> (`Analisis/41-arquitectura-por-capas.md` §1.1, §3 y §3.3). Destino de la
> política de capas de `admin/DISENO.md` §4sexies, que el registro reemplaza.
> Sin secretos ni identificadores.

## Definición

**Un solo archivo que lista los módulos con sus manifiestos.** Lo leen las
reglas (generadas o verificadas contra él), las Functions, la consola y el
ensamblador de flujos. Es un archivo TypeScript puro (`registro.ts`) que la
consola, las Functions, las pruebas y el ensamblador importan; las reglas de
Firestore lo verifican con una prueba, porque las reglas no importan nada.

Lo escribe la **coordinadora** (`Analisis/41` §8.1): cada agente de módulo
escribe solo en su carpeta y en su línea del registro.

## Qué se deriva del registro: las siete copias de hoy (`Analisis/41` §3.3)

| Copia de hoy | Con el registro |
|---|---|
| `firestore.rules`: `flujosTenant`, `tieneAgenda`, `tieneCobro`, `tieneOnboarding` | `tieneModulo(m)` lee `tenants/{t}.modulos`; una prueba verifica que cada documento y colección de cada manifiesto exige su módulo |
| `index.ts`: `VERTICALES` | Desaparece |
| `prompt.ts`: `VERTICALES_CONOCIDOS`, `documentoDeVertical` | El prompt se arma con `registro.modulos.filter(encendidos).map(m => m.prompt)` |
| `cobro.ts`: elige `venta` o `agendamiento` | Cobros tiene su propio `config/cobros` |
| `catalogoWeb.ts`: `tieneVenta()` | `tieneModulo('catalogo-web')` |
| `captacion.ts:371` | `tieneModulo('captacion')` |
| `web/src/lib/flujos.ts` | `registro.modulos.flatMap(m => m.pestanas)` |

`tenants/{t}.modulos` **reemplaza** a `flujos` (decisión del 25/09): nadie está
en producción; mantener dos listas es la séptima copia otra vez.
`Flujos/manifiestos/*.json` se generan del registro más los módulos encendidos
del tenant.

## Cómo se sostiene (`Analisis/41` §9)

`registro.test.ts` obliga a que cada módulo traiga reglas con prueba negativa,
manifiesto completo y declaración de mensajes; `fronteras.test.ts` lee los
`import` de cada archivo y falla si una zona importa hacia arriba o un módulo
importa a otro sin `dependeDe`. Sin esas dos pruebas en verde nada se fusiona
(`Analisis/41` §8.2).

## registro.ts (F2, PR 1)

**Dónde vive:** `admin/functions/src/registro.ts`, un solo archivo con
`IDS_MODULOS` (en orden topológico), los nueve manifiestos (`REGISTRO`),
`carpetasDe(m)`, `manifiestoDe(m)` y dos puentes transitorios:
`PUENTE_DE_FLUJOS` (cada flujo de hoy expresado como módulos, que se borra con
la migración `tenants.flujos` → `tenants.modulos`) y `MODULOS_COMUNES_HOY`
(Productos y Campañas, que hoy tiene todo comercio). En el PR 1 **no lo
importa nadie**: existe, se verifica y mide.

**Por qué no importa nada:** lo van a importar cuatro mundos que no comparten
resolución de módulos. Las Functions compilan con `rootDir: src` e importan
`./registro.js`; la consola lo toma con `../../../functions/src/registro`
(como ya hace con `planes.ts`); las pruebas, con la extensión `.ts`; y los
scripts `.mjs`, que Node carga quitando tipos. Node quita tipos pero no
traduce `./x.js` a `./x.ts`, así que un solo `import` relativo rompería la
carga desde los scripts. Por la misma razón la sintaxis es solo la que Node
sabe borrar (sin `enum`, `namespace` ni propiedades de parámetro). Y el
registro **no lleva rutas de archivos que F2 mueve**: las carpetas de un
módulo se derivan del id, y el inventario origen → destino está aparte, en
`admin/pruebas/core/destinos-f2.ts`, que se borra al cerrar F2.

**Cómo se verifica:** `admin/pruebas/core/registro.test.ts` (pura, sin
emulador) comprueba el registro contra el código de hoy en ocho grupos:
estructura y cero `import`; pestañas contra `web/src/lib/flujos.ts` y
`App.tsx`; listas blancas de `firestore.rules`; colecciones y Storage;
límites contra `planes.ts` y las reglas; herramientas contra los nodos de
`Flujos/*.json`; Functions contra `index.ts`; y las copias de la lista de
flujos (`prompt.ts`, `flujos.ts`, `index.ts`, reglas y los dos scripts de
alta). Lo que hoy es una incoherencia conocida del código está en una lista
con nombre que solo puede achicarse.

**Cómo se corre la medición:**

```
node admin/scripts/medir-zonas.mjs          # informe legible
node admin/scripts/medir-zonas.mjs --json   # el mismo, en JSON
```

Solo lectura. Clasifica cada archivo de `admin/functions/src`,
`admin/web/src`, `Flujos/src`, `admin/scripts` y `admin/pruebas` por
`destinos-f2.ts` (las pruebas, por lo que importan o leen), y lista los que
quedan sin zona, los que se parten y las importaciones hacia arriba o entre
módulos sin `dependeDe`. Es una medición: sale siempre con 0. La prueba que
falla por una importación hacia arriba es `fronteras.test.ts` (PR 2).

## La política de capas del 06/09, que el registro reemplaza

Lo que sigue es `admin/DISENO.md` §4sexies tal como estaba. Es el antecedente
directo del registro: la separación entre lo común (`config/negocio`) y lo
propio de cada flujo (`config/{flujo}`) se conserva; lo que cambia es que el
eje pasa de *vertical* a *módulo* y que la lista de flujos deja de estar
reimplementada en siete lugares.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4sexies (25/09/2026, líneas 1283-1288) -->

## 4sexies. Flujos, consola y usuarios: la política de capas

Con los dos demos operativos, el modelo ya no puede asumir agendamiento. El
problema no es agregar campos: es **agregarlos sin que el panel se convierta en
un formulario con la unión de todo**.


<!-- movido de admin/DISENO.md §4sexies.0 (25/09/2026, líneas 1289-1343) -->

### 4sexies.0 La política (registrada el 2026-09-06, a pedido de Andres)

El producto tiene **tres capas**:

| Capa | Qué es | Dónde vive |
|---|---|---|
| **FLUJOS** | Lo que corre en n8n: reservas (A), pedidos y cobro (B), y los que vengan | `Flujos/*.json` |
| **CONSOLA** | Donde el negocio carga lo que el asistente va a afirmar como verdad | `admin/web` + `firestore.rules` |
| **USUARIOS** | Los negocios clientes, con su gente y sus roles | `/tenants/{id}`, claims |

Y cuatro reglas que se aplican a **todo flujo nuevo**:

1. **Un negocio tiene uno o más flujos.** Se guardan como lista en
   `tenants/{id}.flujos`. `vertical` (valor único) queda como el flujo
   principal y como respaldo de las fichas anteriores a la lista; cuando las
   dos cosas están, **manda la lista**. Cada flujo del negocio corre en SU
   número de WhatsApp (`/rutasWhatsApp`, §4bis.4): dos flujos en un mismo
   número exigirían un enrutador que hoy no existe.
2. **Lo común no se repite por flujo.** Identidad, dirección, horarios, voz
   del asistente, mensajes fijos, catálogo, usuarios, contraseña, consumo,
   conversaciones, reclamos y bitácora son de cualquier negocio, tenga el flujo
   que tenga. Viven en `/config/negocio` y en las colecciones comunes, y sus
   pantallas se muestran siempre.
3. **Lo propio de un flujo es excluyente y trae su pestaña.** Reservas
   necesita agendas por persona; pedidos necesita costos de entrega y un QR.
   Un negocio de pedidos no ve —ni puede escribir— la agenda, y al revés. Cada
   flujo con parámetros propios tiene: su documento `/config/{flujo}` con lista
   blanca propia en las reglas, su línea en la tabla de capacidades
   (`tieneAgenda`, `tieneCobro`), su entrada en `web/src/lib/flujos.ts` con las
   pestañas que agrega, y su rama en `documentoDeVertical` (`prompt.ts`).
4. **La consola habilita pestañas por flujo, no por negocio.** El menú se
   arma con las pestañas comunes más las de cada flujo de la lista. Y es
   cosmético: quien cierra la puerta es la regla, que lee la misma lista.

**Cómo se revisa un flujo nuevo** (la lista de control, en orden):

1. Abrir su nodo `Config del negocio` y anotar cada parámetro.
2. Clasificar cada uno: ¿lo tendría cualquier negocio? → común, va a
   `/config/negocio` (si no está, se agrega a SU lista blanca). ¿Solo tiene
   sentido con este flujo? → propio.
3. Si hay parámetros propios: documento `/config/{flujo}`, función
   `config{Flujo}Valida()` en las reglas, línea en la tabla de capacidades,
   `altaTenant`/`asignarNumero` crean el documento, `documentoDeVertical` lo
   nombra, `flujos.ts` declara la pestaña, y una pantalla la dibuja.
4. Si hay colecciones propias (como `funcionarios`), su regla exige la
   capacidad del flujo, no el rol solo.
5. Pruebas: el negocio CON el flujo escribe; el negocio SIN el flujo no puede,
   ni con la petición armada a mano; un negocio con varios flujos escribe
   todos los suyos.
6. Semillas y `sembrar-demos.mjs` escriben `flujos`.
7. Si el flujo todavía no lee la consola (`configuracionFlujo`), lo que se
   muestre tiene que ser lo que el flujo usa de verdad, y el resto se anota
   como deuda en `ESTADO.md`. Prometer un campo que el asistente ignora es
   peor que no ofrecerlo.


<!-- movido de admin/DISENO.md §4sexies.1 (25/09/2026, líneas 1344-1360) -->

### 4sexies.1 Qué es común y qué depende del flujo

| | Común a cualquier negocio | Reservas y citas (`agendamiento`) | Pedidos y cobro (`venta`) | Captación de clientes (`onboarding`) |
|---|---|---|---|---|
| **Documento** | `/config/negocio` | `/config/agendamiento` | `/config/venta` | `/config/onboarding` |
| **Contiene** | identidad, dirección, horarios, voz del asistente, **nombre del asistente** (`nombreAsistente`), mensajes fijos, política de cancelación, calendario del negocio (por historia) | duración por defecto, anticipación mínima y máxima, recordatorios, cancelación, **seña** (`senaImporte`, `senaMinutosRetencion`) y, si el negocio no vende, el QR propio (`cobroReal`, solo por `registrarQrDeCobro`) — §4duodecies | costo de envío, recargo de flota, pedido mínimo, radio, tiempos de cocina y despacho, `mediaIdQr` (solo NovuChat), QR propio (`cobroReal`, solo por `registrarQrDeCobro`) | rubros, planes, cargos únicos, aclaraciones de la oferta, archivo de planes, mensaje al cliente actual, enlace a la consola, respuesta del aviso y su plantilla (§4sexies.5) |
| **Colecciones propias** | catálogo, contactos, conversaciones, bitácora, miembros | funcionarios | — | — |
| **Catálogo nativo de WhatsApp** | — | **no**, y no es un pendiente | **sí** (pendiente) | no |
| **Pestañas en la consola** | Configuración, Servicios/Productos, Conversaciones, Usuarios, Contactos, Consumo, Cuenta, Reclamos, Bitácora, Mi cuenta | **Agenda**, **Cobros**, **Configuración de QR** (las dos últimas desde el 17/09, por la seña: §4duodecies) | **Pedidos**, **Cobros**, **Inventario**, **Configuración de QR** (§4nonies) | **Captación** |

«Cobros» y «Configuración de QR» las declaran dos flujos con la misma ruta;
la cabecera pinta cada ruta una sola vez, y la pantalla decide qué documento
lee por la lista de flujos (`venta` gana, §4duodecies.2).

El **catálogo con precios es común**: el Demo A lo usa para servicios con
duración y el Demo B para productos. Es el mismo concepto y ya estaba modelado.


<!-- movido de admin/DISENO.md §4sexies.2 (25/09/2026, líneas 1361-1382) -->

### 4sexies.2 Tres documentos, no uno con la unión de todos los campos

Podría haber sido un solo documento grande con todo opcional. No lo es, por tres
razones en orden de importancia:

1. **La validación queda por documento, con su propia lista blanca.** Un esquema
   único obligaría a escribir «si el vertical es X entonces el campo Y es
   válido» dentro de las reglas de Firestore — exactamente el tipo de condición
   que se rompe al agregar el tercer vertical.
2. **El comercio no puede escribir el documento que no le toca.** La regla ata el
   documento a la lista `flujos` de la ficha del tenant, que el comercio no
   escribe. Un salón de belleza **no puede** fijar el recargo de flota. Eso no se logra
   escondiendo el campo en la pantalla: esconder no protege de nada, porque la
   petición se construye igual desde la consola del navegador.
3. **La pantalla no necesita lógica de ramas.** Lee el documento común y el de su
   vertical. `ConfiguracionVertical` tiene una tabla de campos por rubro y no un
   solo `if` de negocio.

Las capacidades viven en una tabla —`tieneAgenda`, `tieneCobro`— y no en
condiciones dispersas: **agregar el vertical interno de NovuChat es tocar dos
líneas**, no cazar condicionales por el archivo.


<!-- movido de admin/DISENO.md §4sexies.4 (25/09/2026, líneas 1432-1440) -->

### 4sexies.4 Una consecuencia que conviene conocer

El documento de venta mezcla campos del comercio con campos de NovuChat, y la
validación usa `affectedKeys`. Por lo tanto **un `setDoc` con el objeto completo
se rechaza**: reemplazar el documento borraría `mediaIdQr`, y borrar también es
afectar. La pantalla usa `updateDoc`. Es deliberado — sin eso, el camino más
natural del programador desarmaría en silencio el control de la prohibición 3— y
hay una prueba dedicada a ese caso exacto.
