# Runbook: cuenta de servicio del miniCRM por cliente

Diseño en `docs/arquitectura/modulos/crm.md`, sección «Cuenta de servicio por cliente (PR-C)».
Lo ejecuta Claude con el OK de Andres en el chat; la gente solo comparte la planilla.

Variables: `CRM_PROYECTO_GCP` (proyecto de la consola), `ENV_FILE` (el .env con las variables de n8n) y
el `CLOUDSDK_CONFIG` aislado de producción. Siempre ruta absoluta; `<tenant>` es el id del tenant.

1. Seco (sin red): `node admin/scripts/plataforma/crm-cuenta-servicio.mjs crear --tenant <tenant>`.
2. Crear la cuenta: el mismo comando con `--aplicar --confirmo produccion`.
3. Registrar la clave en n8n: `registrar-credencial-n8n` (seco primero, luego con `--aplicar --confirmo produccion`).
   Si sale 3, no se sabe si la credencial llegó: comprobar en n8n antes de borrar la clave en IAM.
4. Obtener el correo: `mostrar-correo --tenant <tenant>`; NovuChat lo comunica por escrito a la subcuenta.
5. Una persona comparte la planilla de ESA subcuenta como Editor solo con ese correo.
6. Rotar: `quitar` y volver a 2 y 3 (cada 90 días como máximo). Baja del cliente: `quitar`.

Verificar el aislamiento: la planilla de un cliente no debe figurar compartida con la cuenta de otro.
