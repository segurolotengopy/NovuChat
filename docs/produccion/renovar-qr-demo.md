# Renovar el QR de demostración (media ID)

El QR rotulado del demo de venta (Demo B) viaja por WhatsApp como un **media
ID** que Meta emite al subir la imagen. Tiene tres propiedades que explican
todo el procedimiento:

- **Vence a los 30 días.** Pasado ese plazo Meta responde «image.id is not a
  valid whatsapp business account media attachment ID» y el cobro simulado
  falla.
- **Está ligado al número que lo sube.** Un ID subido con otro número no sirve.
- **Vive en DOS sitios**, y renovar uno solo deja el sistema roto en silencio
  (ejecución #19676 del Demo B, 03/10/2026): el flujo manda un ID, pero el
  valor de Firestore (`tenants/{id}/config/venta.mediaIdQr`) manda sobre el del
  flujo.

## Procedimiento

Lo ejecuta Claude con el «sí» de Andres; nadie pega valores a mano.

1. **Subir la imagen** y obtener el ID nuevo: `scripts/subir-qr.sh`.
2. **Destino 1: tabla local y flujo.**
   `MARCADOR_VALOR=<id> scripts/marcador-local.sh --marcador REEMPLAZAR_MEDIA_ID_QR_DEMO --reemplazar`
   (hace respaldo y no imprime el valor), y republicar el flujo con
   `publicar-flujo.sh`.
3. **Destino 2: configuración del servidor**, con
   `admin/scripts/datos/renovar-qr-demo.mjs`:
   - seco (lee, no escribe): `node scripts/datos/renovar-qr-demo.mjs --tenant <demo> --proyecto <id>`
     dice si `mediaIdQr` está y si COINCIDE o DIFIERE de la fila local
     (comparación por sha256, sin imprimir ningún valor);
   - `--aplicar` escribe **solo** `mediaIdQr` y el sello en `config/venta`
     (`mergeFields`), deja `cobroReal` y el resto intactos, y anota la
     auditoría sin el valor.
4. **Verificar**: repetir el seco; debe decir COINCIDE.

## Candados

Solo los demos de venta que declara `sembrar-demos.mjs`; cualquier otro tenant
es NEGADO. Una fila local vacía, «pendiente» o que no sea de 10 a 20 dígitos
aborta sin escribir, y una fila repetida también. El tenant debe haber sido creado por
`sembrar-demos` (`creadoPor`). Con `FIRESTORE_EMULATOR_HOST` heredado se niega salvo
proyecto `demo-*`, y el veredicto dice EMULADOR. La fila local se lee con
`--archivo`, `CONFIG_LOCAL` o `CONFIGURACION.local.md` (`sembrar-demos.mjs`,
en cambio, lee siempre la raíz). Sin `--proyecto` no hay conexión. No reemplaza a
`sembrar-demos.mjs`, que sigue siendo quien carga el demo completo.
