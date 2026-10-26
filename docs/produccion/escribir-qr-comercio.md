# Escribir el QR de un comercio real (media ID)

`renovar-qr-demo.mjs` solo sirve a los demos de venta, por diseño. Para un
**comercio real** con flujo de venta se usa `admin/scripts/datos/escribir-qr-comercio.mjs`,
que escribe únicamente `tenants/{id}/config/venta.mediaIdQr`.

Dos hechos del media ID: **vence a los 30 días** (hay que re-subir la imagen
antes) y **queda ligado al número que lo sube**. El valor de Firestore manda
sobre el del flujo.

## Procedimiento

Lo ejecuta Claude con el «sí» de Andres; nadie pega valores a mano.

**Orden operativo: primero el cobro real activo, después el `mediaIdQr`.**

1. Subir la imagen con el número del comercio y obtener el ID: `scripts/subir-qr.sh`.
2. Guardarlo en la tabla local sin imprimirlo:
   `MARCADOR_VALOR=<id> scripts/marcador-local.sh --marcador REEMPLAZAR_MEDIA_ID_QR_<X> --reemplazar`,
   donde `<X>` es el id del tenant en mayúsculas con `_` por `-` (`rroca-ruben` ->
   `REEMPLAZAR_MEDIA_ID_QR_RROCA_RUBEN`).
3. Seco (lee, no escribe; dice AUSENTE, COINCIDE o DIFIERE por sha256):
   `node scripts/datos/escribir-qr-comercio.mjs --tenant <id> --proyecto <id> --marcador REEMPLAZAR_MEDIA_ID_QR_<X> --archivo <tabla local>`.
   El seco muestra el proyecto, el id del tenant y `nombreNegocio`: el operador
   confirma que es el comercio correcto antes de aplicar.
4. Escribir: el mismo comando con `--aplicar`. Repetir el seco: debe decir COINCIDE.

## Candados

- Exige `--archivo` o `CONFIG_LOCAL`; nunca lee `CONFIGURACION.local.md` por omisión.
- El marcador empieza por `REEMPLAZAR_MEDIA_ID_QR_` y no puede ser el de demo.
- Valor de 10 a 20 dígitos; fila repetida, vacía o «pendiente» aborta.
- `--tenant` debe cumplir `/^[a-z0-9][a-z0-9-]{2,59}$/` (se valida antes de armar rutas).
- El sufijo del marcador debe ser el id del tenant (ver paso 2); si no, NEGADO.
- El tenant debe existir y su ficha debe incluir el flujo `venta` según
  `flujosDeFicha` (no basta con que exista `config/venta`).
- El cobro real debe estar activo, con el criterio de `ingesta.ts`
  (`cobroReal.activo === true` con `ficha` y `cargaUtil` no vacías); si no,
  NEGADO también en seco. Ver «Mezcla de modos».
- Un tenant demo (`creadoPor: sembrar-demos`) es NEGADO: para eso está `renovar-qr-demo.mjs`.
- Escribe solo `mediaIdQr`, `actualizadoPor` y `actualizadoEn` (`mergeFields`);
  `cobroReal` queda intacto. Anota `tenants/{id}/auditoria` sin el valor.
- Nunca imprime el valor local ni el del servidor. Con `FIRESTORE_EMULATOR_HOST`
  solo acepta proyectos `demo-*`.

## Mezcla de modos (por qué el cobro real va primero)

`ingesta.ts` lee `config/venta.mediaIdQr` y, cuando el cobro real NO está activo,
lo copia a `cobroSimulado.mediaIdQr`: el QR de demostración, con rótulos de
simulado. Un QR real guardado ahí con el cobro real apagado saldría presentado
como simulado (y el cobro simulado y el real son excluyentes). Por eso la
herramienta se niega si el cobro real no está activo.

Seguimiento recomendado (NO implementado): un campo separado
(`mediaIdQrReal` o `cobroReal.mediaIdQr`) para que el QR real y el de
demostración nunca compartan campo.

## Qué no muestra el seco

El proyecto efectivo se imprime (no es secreto). La cuenta de las credenciales
NO se imprime: obtenerla exige red o leer archivos de credenciales, y la
herramienta no hace ninguna de las dos cosas.
