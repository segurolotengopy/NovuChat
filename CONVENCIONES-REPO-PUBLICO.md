# Convención de repositorio público

`github.com/segurolotengopy/NovuChat` es **público** (decisión de Andres,
2026-08-28). Por lo tanto **ningún archivo versionado puede contener valores
que identifiquen o den acceso a la infraestructura**, aunque no sean secretos
criptográficos.

## Regla

Todo valor de la tabla se reemplaza en los archivos versionados por su
marcador. Los valores reales viven en `CONFIGURACION.local.md` y en `.env`,
ambos ignorados por git, y en el gestor de contraseñas.

| Marcador | Qué reemplaza | Por qué no puede ser público |
|---|---|---|
| `${N8N_BASE_URL}` | URL del n8n autoalojado | superficie de ataque directa |
| `${N8N_WEBHOOK_PATH}` | ruta UUID del webhook | actúa como secreto compartido: quien la tiene inyecta mensajes al flujo |
| `${VM_HOST}` | IP pública de la VM de OCI | expone el objetivo de SSH y los co-inquilinos en producción |
| `${WA_APP_ID}` | App ID de Meta | facilita enumeración e ingeniería social |
| `${WA_PHONE_ID}` | Phone Number ID | idem |
| `${WABA_ID}` | WhatsApp Business Account ID | idem |
| `${WA_TEST_NUMBER}` | número de prueba de Meta | ver prohibición 6 de CLAUDE.md |
| `${WA_TO}` | teléfono de destinatario | **dato personal**, no se publica |
| `${GCP_PROJECT_ID}` / `${GCP_PROJECT_NUMBER}` | proyecto de Google Cloud | facilita enumeración |
| `${GOOGLE_ACCOUNT}` | correo de la cuenta Google | dato personal |
| `${CALENDAR_ID}` | ID del calendario del demo | acceso al recurso |
| `${OTRA_APP_ID}` | App ID de `Demo SeguroLo Tengo` | proyecto ajeno en producción |
| `${WA_PORTFOLIO_B}` | portafolio comercial del Demo B | facilita enumeración del negocio |
| `${WA_APP_ID_B}` | App ID de la app del Demo B | idem |
| `${WA_PHONE_ID_B}` | Phone Number ID del Demo B | idem |
| `${WABA_ID_B}` | WABA del Demo B | idem |
| `${WA_TEST_NUMBER_B}` | segundo número de prueba | ver prohibición 6 de CLAUDE.md |

## Dos formas de marcador, según el archivo

En **documentación y scripts** se usa `${NOMBRE}`, como en la tabla de arriba.

En los **JSON exportados de n8n** se usa `REEMPLAZAR_NOMBRE` en mayúsculas,
que es el idioma que ya traía el nodo `Config del negocio`. La razón no es
estética: n8n interpreta `${...}` como expresión y fallaría al importar de
una manera confusa. `REEMPLAZAR_*` es texto inerte y además se ve a simple
vista en la interfaz, que es donde Andres lo va a reponer.

Marcadores vigentes en los flujos, con su equivalencia en
`CONFIGURACION.local.md`:

| En el JSON | Qué repone |
|---|---|
| `REEMPLAZAR_PHONE_NUMBER_ID` | Phone Number ID del número correspondiente al demo |
| `REEMPLAZAR_NUMERO_RECEPCION_SIN_+` | teléfono de recepción del negocio, solo dígitos |
| `REEMPLAZAR_ID_CALENDARIO@group.calendar.google.com` | ID del calendario del demo |
| `REEMPLAZAR_NUMERO_DUENO_SIN_+` | celular del dueño en el Demo B, solo dígitos |
| `REEMPLAZAR_MEDIA_ID_QR_DEMO` | media ID del QR subido con el número del Demo B |

## Cómo aplicarla

- Los archivos versionados usan el marcador y, si hace falta, una nota que
  remite a `CONFIGURACION.local.md`.
- `CONFIGURACION.md` queda como **plantilla pública**: misma estructura, celdas
  con marcadores.
- `CONFIGURACION.local.md` contiene los valores reales y está en `.gitignore`.
- Los JSON exportados de n8n se revisan antes de commitear: el nodo
  `Config del negocio` y las URLs suelen traer valores reales.
- Antes de cada commit corre el escaneo de secretos del estándar DevSecOps.

## Verificación

El escaneo NO puede llevar los valores reales incrustados: este archivo se
versiona en un repositorio público. El script `scripts/verificar-saneo.sh` lee
los valores desde `CONFIGURACION.local.md` y `.env` —ambos ignorados por git—
y verifica que ninguno de ellos aparezca en un archivo versionado.

```bash
./scripts/verificar-saneo.sh    # salida 1 si encuentra un valor real
```

Corralo antes de cada commit y en el CI. Si alguna vez tiene que buscar a
mano, tome los patrones de `CONFIGURACION.local.md`, nunca los escriba en un
archivo del repositorio.
