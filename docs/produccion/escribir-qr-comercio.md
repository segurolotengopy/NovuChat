# Escribir el QR de un comercio real (media ID)

`renovar-qr-demo.mjs` solo sirve a los demos de venta, por diseño. Para un
**comercio real** con flujo de venta se usa `admin/scripts/datos/escribir-qr-comercio.mjs`,
que escribe únicamente `tenants/{id}/config/venta.mediaIdQr`.

Dos hechos del media ID: **vence a los 30 días** (hay que re-subir la imagen
antes) y **queda ligado al número que lo sube**. El valor de Firestore manda
sobre el del flujo.

## Procedimiento

Lo ejecuta Claude con el «sí» de Andres; nadie pega valores a mano.

1. Subir la imagen con el número del comercio y obtener el ID: `scripts/subir-qr.sh`.
2. Guardarlo en la tabla local sin imprimirlo:
   `MARCADOR_VALOR=<id> scripts/marcador-local.sh --marcador REEMPLAZAR_MEDIA_ID_QR_<X> --reemplazar`.
3. Seco (lee, no escribe; dice AUSENTE, COINCIDE o DIFIERE por sha256):
   `node scripts/datos/escribir-qr-comercio.mjs --tenant <id> --proyecto <id> --marcador REEMPLAZAR_MEDIA_ID_QR_<X> --archivo <tabla local>`
4. Escribir: el mismo comando con `--aplicar`. Repetir el seco: debe decir COINCIDE.

## Candados

- Exige `--archivo` o `CONFIG_LOCAL`; nunca lee `CONFIGURACION.local.md` por omisión.
- El marcador empieza por `REEMPLAZAR_MEDIA_ID_QR_` y no puede ser el de demo.
- Valor de 10 a 20 dígitos; fila repetida, vacía o «pendiente» aborta.
- El tenant debe existir y tener la venta habilitada (`flujos` incluye `venta`
  según `flujosDeFicha`, o ya existe `config/venta`).
- Un tenant demo (`creadoPor: sembrar-demos`) es NEGADO: para eso está `renovar-qr-demo.mjs`.
- Escribe solo `mediaIdQr`, `actualizadoPor` y `actualizadoEn` (`mergeFields`);
  `cobroReal` queda intacto. Anota `tenants/{id}/auditoria` sin el valor.
- Nunca imprime el valor local ni el del servidor. Con `FIRESTORE_EMULATOR_HOST`
  solo acepta proyectos `demo-*`.
