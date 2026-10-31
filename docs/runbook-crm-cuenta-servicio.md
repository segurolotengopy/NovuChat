# Runbook: cuenta de servicio del miniCRM por cliente

Diseño en `docs/arquitectura/modulos/crm.md`, sección «Cuenta de servicio por cliente (PR-C)».
Lo ejecuta Claude con el OK de Andres en el chat; la gente solo comparte la planilla.

Variables: `CRM_PROYECTO_GCP` (proyecto de la consola), `ENV_FILE` (el .env con las variables de n8n) y
el `CLOUDSDK_CONFIG` aislado de producción. Siempre ruta absoluta; `<tenant>` es el id del tenant.
Script: `node admin/scripts/plataforma/crm-cuenta-servicio.mjs <subcomando> --tenant <tenant>`.
Cada subcomando se corre primero en seco y luego con `--aplicar --confirmo produccion`.

**Alta**
1. `crear`: crea la cuenta `crm-<tenant>` sin roles.
2. `registrar-credencial-n8n`: crea la clave y la credencial. Sale 1 si la credencial ya existe o si la
   cuenta ya tiene claves (entonces se usa `rotar`). Sale 2 si el entorno no tiene `/dev/shm`.
   Si sale 3, no se sabe si la credencial llegó: comprobar en n8n antes de borrar la clave en IAM.
3. `mostrar-correo`: NovuChat comunica el correo por escrito a la subcuenta.
4. Una persona comparte la planilla de ESA subcuenta como Editor solo con ese correo.

**Rotación (cada 90 días como máximo):** `rotar`. Exige que exista la credencial y exactamente una clave
vigente; crea la nueva, la pone en la misma credencial (mismo id, los flujos no cambian), verifica y borra
la vieja. Si sale 3, la clave vieja NO se borró: revisar a mano.

**Baja del cliente:** `quitar` (borra la credencial y la cuenta). No se usa para rotar. Si n8n falla, sale 1
y la cuenta no se toca.

**Aislamiento:** la planilla de un cliente no debe figurar compartida con la cuenta de otro. Requisito
pendiente para PR-F: prueba de CI que recorra `Flujos/clientes/<tenant>/` y falle si un nodo `googleApi`
usa una credencial distinta de «Google Sheets miniCRM (crm-<tenant>)».
