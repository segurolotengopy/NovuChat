# CONFIGURACION — parámetros e identificadores (plantilla pública)

> **Este archivo es una plantilla.** El repositorio
> `github.com/segurolotengopy/NovuChat` es **público**, así que todo valor que
> identifique o dé acceso a la infraestructura aparece acá como marcador
> `${...}`.
>
> **Los valores reales están en `CONFIGURACION.local.md`**, que está en
> `.gitignore` y nunca se sube. La correspondencia marcador → valor y el
> motivo de cada uno están en `CONVENCIONES-REPO-PUBLICO.md`.
>
> **Solo valores NO secretos.** Los secretos criptográficos se listan en §4
> con su ubicación, nunca con su valor: viven en `.env`, en las credenciales
> de n8n y en el gestor de contraseñas.

## 1. Meta / WhatsApp Cloud API

| Parámetro | Valor |
|---|---|
| App | `NovuChat-Demo-A` |
| App ID | `${WA_APP_ID}` |
| Número de prueba | `${WA_TEST_NUMBER}` |
| `PHONE_NUMBER_ID` | `${WA_PHONE_ID}` |
| `WABA_ID` | `${WABA_ID}` |
| Versión de Graph API | `v26.0` |
| Modo de la app | Publicada (Live) |
| Campo de webhook suscrito | `messages` |
| Apps suscritas a la WABA | `NovuChat-Demo-A`, `Demo SeguroLo Tengo` (proyecto ajeno), app 1P de Meta |
| Destinatarios permitidos | hasta 5; incluye `${WA_TO}` |

> La WABA es **compartida** con el proyecto WhatsApp-Modular (app
> `Demo SeguroLo Tengo`, ID `${OTRA_APP_ID}`). Los mensajes de prueba llegan
> también a su webhook. No modificar esa app.

## 2. n8n

| Parámetro | Valor |
|---|---|
| URL | `${N8N_BASE_URL}` |
| Versión | 2.36.5 (fijada) |
| Licencia | Community registrada (no comparte flujos entre usuarios) |
| Flujo Demo A | `NovuChat Demo A — Agendamiento (Belleza y Salud)` |
| Zona horaria | `America/La_Paz` |
| Nodos Code | solo JavaScript (la imagen no trae Python) |
| Base de datos | `pgvector/pgvector:pg16` (contenedor `n8n-db`) |

**Ruta del webhook (secreto compartido, no publicar):**
`${N8N_WEBHOOK_PATH}` — valor real en `CONFIGURACION.local.md` §2.

## 3. Google Cloud / Calendar / Gemini

| Parámetro | Valor |
|---|---|
| Proyecto | ID `${GCP_PROJECT_ID}` · número `${GCP_PROJECT_NUMBER}` |
| Cuenta | `${GOOGLE_ACCOUNT}` |
| APIs habilitadas | Google Calendar API · Generative Language API |
| Cliente OAuth | tipo *Aplicación web* |
| Redirect URI | `${N8N_BASE_URL}/rest/oauth2-credential/callback` |
| Calendario del demo | `NovuChat Demo A` (zona La Paz) — ID `${CALENDAR_ID}` en el nodo `Config del negocio` |

## 4. Matriz de secretos — dónde vive cada uno

| Secreto | Ubicación única | Nunca en |
|---|---|---|
| App Secret de Meta | credencial *WhatsApp Trigger* en n8n + gestor | repo, chat, sticky notes |
| Token permanente de usuario de sistema | credencial *WhatsApp* en n8n + gestor | repo, chat |
| Client Secret de Google OAuth | credencial *Google Calendar OAuth2* en n8n + gestor | repo, chat |
| API key de Gemini | credencial *Google Gemini* en n8n + gestor | repo, chat |
| Token de verificación del webhook | solo en el panel de Meta + gestor | n8n (no se configura ahí) |
| `N8N_ENCRYPTION_KEY` | `.env` del contenedor en la VM + respaldo diario | repo |
| Llave SSH de la VM | llave privada local del operador (fuera del repo) | repo |

## 5. Infraestructura

| Parámetro | Valor |
|---|---|
| VM | OCI · `${VM_HOST}` · usuario `ubuntu` · ARM 2 OCPU |
| Acceso | `ssh -i <llave-privada> ubuntu@${VM_HOST}` |
| Co-inquilinos | Odoo, Nginx Proxy Manager, `otp-service` (no tocar) |
| Respaldo | `respaldo-vm.sh` diario 03:00 UTC → OCI Object Storage |
| Repositorio | `github.com/segurolotengopy/NovuChat.git` (**público**) |

## 6. Estructura del directorio

```
NovuChat/
├── CLAUDE.md                    políticas y contexto (lo lee Claude Code)
├── ESTADO.md                    bitácora viva
├── CONFIGURACION.md             este archivo (plantilla pública)
├── CONFIGURACION.local.md       valores reales — IGNORADO POR GIT
├── CONVENCIONES-REPO-PUBLICO.md tabla de marcadores y verificación
├── .env.example                 variables sin valores
├── .devsecops.yml               manifiesto del estándar DevSecOps
├── .github/workflows/           CI: lint, escaneo de secretos, despliegue
├── admin/                       sitio administrativo (Firebase) — otro agente
├── Analisis/                    criterios, plan de demos, análisis preliminar
├── Flujos/                      JSON de n8n (fuente de verdad) + guía de Meta
├── Demo-Recursos/               calendario, QR, checklist, guion, simulador
├── Preliminares/                material original (NO versionado)
└── scripts/                     verificación de entorno y de saneo
```
