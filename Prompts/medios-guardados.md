# Imágenes: la biblioteca del comercio y el guardado por categoría — construcción

> **TENANT de ensayo:** el comercio con el que se prueba de punta a punta.
> Andres lo indica al lanzar la sesión; su ficha vive en `CLIENTES/<TENANT>/`.
> Es una instancia: nada de lo que construyas se nombra por un cliente, y todo
> vale para cualquier comercio.

Eres la sesión dedicada a dos frentes que comparten depósito:

- **A · Biblioteca del comercio.** El comercio sube imágenes y PDF una vez
  —indicaciones, promociones, cómo llegar— y **el asistente se las envía** al
  cliente final cuando corresponde.
- **B · Guardado por categoría de lo que envía el cliente final.** Hoy los
  medios entrantes se leen y se descartan. Andres decidió el 22/09 que se
  guarden. **No todos**: se guardan según la categoría que el clasificador ya
  asigna.

Las decisiones están en `Analisis/38-guardar-imagenes.md`; este prompt las
ejecuta. **No se rediscute** el guardado por categoría ni el orden de los
bloques.

Lee primero, en este orden: `CLAUDE.md` entero, `ESTADO.md`,
`admin/DISENO.md` §4septies (retención) y las secciones de medios, y después:

- `Analisis/38-guardar-imagenes.md`, entero.
- `Analisis/34-direccion-voz-imagenes-y-pdf.md` §4: por qué hoy no se guarda
  nada y cuánto cuesta cada mensaje con imagen.
- `docs/seguridad/reglas-storage.md` y `admin/storage.rules`: el patrón de
  reglas, sus cinco pasos para agregar un camino, y el principio de «nombres
  fijos» que el bloque A tiene que **argumentar para poder excluir**.
- `docs/contrato/anexo-tecnico-sla.md` §9 y §13: la cláusula que hoy promete
  que no se guarda, y la regla que exige acuerdo del cliente para reducir un
  compromiso.
- `admin/functions/src/imagenCatalogo.ts`, `captacion.ts`,
  `admin/web/src/lib/archivoPlanes.ts` y `foto.ts`: los controles que se
  reutilizan en vez de rehacerse.

## Las decisiones que no se tocan

1. **La purga va primero.** No se guarda un solo archivo —ni del comercio ni
   de un cliente final— hasta que la función programada de purga esté escrita,
   probada y **desplegada**, y los objetos de Storage estén en la tabla de
   retención. Hoy no existe ninguna función programada que borre nada.
2. **Se guarda por categoría, con el criterio en el servidor.** Comprobantes,
   sí. Publicidad y «otro», configurable por comercio y **apagado por
   defecto**. **Boca o dientes y documentos de salud, no**, salvo que el
   comercio lo active y el paciente lo consienta en el chat. **Audio, nunca.**
3. **El asistente no elige una imagen libremente.** Cada pieza tiene una clave;
   el servidor decide cuándo se manda. Si el modelo la pide, lo hace con una
   marca de una **lista cerrada** que el servidor valida. Ninguna URL escrita
   por el modelo llega a Meta.
4. **Los medios se sirven desde una Function propia, por ficha al azar de 128
   bits**, revocable, como ya hace `imagenDeCobro`. No se usa el enlace de
   descarga directo de Storage: es una capacidad que no pasa por las reglas.
5. **Nombres generados por el servidor**, extensión de una lista cerrada,
   `list` cerrado en Storage y el índice en Firestore. Tope por plan con
   contador, como el del catálogo.
6. **Tipos por firma mágica, no por extensión.** JPEG y PNG para enviar por
   WhatsApp, hasta 5 MB; PDF hasta 10 MB. SVG prohibido.
7. **Multi-tenant estricto**, probado negando: un comercio no ve, lista ni
   descarga nada de otro. El operador no ve comprobantes.
8. **Nada de B se enciende para un comercio hasta que ese comercio acepte por
   escrito la versión 2 del anexo.** Es una bandera por comercio en el
   servidor, no global.
9. **Andres autoriza; tú operas.** Ningún despliegue, publicación de flujo ni
   `--aplicar` sin su OK en el chat.

## Reutilizar antes de escribir

Consulta `~/Claude-Proyectos/proyectos/`. Dentro de NovuChat, esto ya existe y
**no se rehace**:

| Control | Dónde |
|---|---|
| Patrón de `storage.rules` y sus cinco pasos | `docs/seguridad/reglas-storage.md` |
| Identidad por claim, tenant en la ruta, `list: false`, negación final | `admin/storage.rules` |
| Validación por firma mágica y tope, en navegador y servidor | `archivoPlanes.ts`, `captacion.ts` |
| Compresión y reencuadre en el navegador | `admin/web/src/lib/foto.ts` |
| Moderación con el modelo que muestra pero no bloquea, con prompt anti-inyección | `imagenCatalogo.ts` |
| Servir binarios por ficha al azar, sin enumerar la cartera | `admin/functions/src/cobro.ts` |
| Contador con tope por plan | el del catálogo, `limiteCatalogo.ts` |
| Metadatos de integridad del objeto | `admin/functions/src/pagos.ts` |

## Cómo trabajar

- Worktree y rama propios dentro de `.claude/worktrees/`; un bloque, una rama,
  un PR contra `main`.
- **Cada bloque declara cuántos mensajes agrega o quita por conversación** y
  qué prueba lo cubre.
- **Los límites se prueban negando**, con el emulador, como
  `storage-reglas.test.ts`.
- Resultado **real** con teléfono en los bloques que tocan el flujo.
- `ESTADO.md` al cerrar cada bloque, y la ficha del proyecto en el registro.

## Qué construir, por bloques

### Bloque 0 — La purga, y las condiciones de la máquina (1,5 jornadas)
Rama `datos/purga-y-retencion`. La función programada que borra lo vencido por
lotes, con registro en la bitácora; los objetos de Storage agregados a la tabla
de retención de `admin/DISENO.md` §4septies con los plazos del `Analisis/38`
§3.2; y la verificación en la máquina del modo binario en disco, la poda de
ejecuciones y que la credencial del modelo sea de nivel pago. **Sin este
bloque desplegado, ningún otro se enciende.**

### Bloque 1 — Reglas y depósito de la biblioteca (1 jornada)
Rama `medios/reglas-y-deposito`. Camino nuevo en `storage.rules` con nombres
generados por el servidor y la **excepción al principio de nombres fijos
argumentada en el propio archivo**; índice en Firestore; contador y tope por
plan; Function que sirve por ficha. Pruebas negando.

### Bloque 2 — Pantalla de la biblioteca (1 jornada)
Rama `medios/consola`. Subir, ver, reemplazar y borrar; compresión en el
navegador; validación por firma; moderación con el modelo mostrada como aviso;
y **cuántos mensajes agrega cada pieza**, visible al lado de cada una.

### Bloque 3 — Envío desde el flujo (½ jornada)
Rama `flujos/enviar-medio`. Envío por clave desde los puntos que el flujo
define, con la marca validada contra la lista cerrada. **Declara: +1 mensaje
por cada envío.** Prueba con teléfono real.

### Bloque 4 — Guardado por categoría de lo entrante (1,5 jornadas)
Rama `medios/entrantes`. La ingesta guarda el `mediaId`; descarga **sincrónica**
con el mensaje, porque la URL de Meta dura unos 5 minutos; guardado según la
categoría del clasificador; permisos por rol; bandera por comercio, apagada por
defecto.

### Bloque 5 — Consentimiento para las categorías de salud (½ jornada)
Rama `medios/consentimiento`. Pedido en el chat, registro de la respuesta, y el
borrado a pedido. Sin consentimiento registrado, no se guarda.

### Bloque 6 — Amenazas, documentación y contrato (1 jornada)
Rama `docs/medios-guardados`. Las seis amenazas nuevas del `Analisis/38` §6 en
`admin/SEGURIDAD.md`; `admin/DISENO.md` con el diseño; **anexo versión 2** con
la cláusula nueva; y el texto del pedido de acuerdo para los clientes que ya
firmaron.

### Lo que NO se construye
- Guardar audio, en ninguna categoría.
- Guardar fotos de salud sin bandera del comercio y consentimiento del
  paciente.
- Que el modelo elija una imagen fuera de la lista cerrada, o escriba una URL.
- Enlaces de descarga directos de Storage hacia Meta.
- Fotos de producto por el chat: van por el enlace del catálogo, que es gratis.
- Encender el bloque 4 para un comercio que no aceptó la versión 2 del anexo.

## Entregables al cerrar
- Un PR por bloque, con mensajes declarados, pruebas negativas y resultado real.
- La purga desplegada **antes** que cualquier guardado.
- Anexo versión 2, y la lista de clientes a los que hay que pedirles el acuerdo.
- La medición del `Analisis/38` §8 lista para el primer mes.
