#!/usr/bin/env bash
# =============================================================================
#  NovuChat — Bootstrap del proyecto para Claude Code
# =============================================================================
#  Crea la estructura de trabajo y la documentación viva que Claude Code lee
#  al iniciar cada sesión: políticas, estado, parámetros y scripts de
#  verificación.
#
#  USO:
#      cd /ruta/a/NovuChat
#      chmod +x bootstrap-claude-code.sh
#      ./bootstrap-claude-code.sh            # no sobrescribe lo que ya exista
#      ./bootstrap-claude-code.sh --force    # regenera todo
#
#  DESPUÉS:
#      claude          # en esta carpeta; CLAUDE.md se carga automáticamente
#
#  NO ESCRIBE NINGÚN SECRETO. Los valores sensibles viven en .env (ignorado
#  por git) y en el gestor de contraseñas. Ver CONFIGURACION.md §4.
# =============================================================================
set -euo pipefail

DIR="${2:-$(pwd)}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

azul()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[0;90m%s\033[0m\n' "$*"; }

escribir() {
  local ruta="$DIR/$1"
  mkdir -p "$(dirname "$ruta")"
  if [[ -e "$ruta" && $FORCE -eq 0 ]]; then
    gris "  = $1 (ya existe, se conserva)"
    cat > /dev/null   # consume el heredoc
    return
  fi
  cat > "$ruta"
  verde "  + $1"
}

azul "NovuChat — bootstrap para Claude Code"
echo "Directorio: $DIR"
echo

# -----------------------------------------------------------------------------
escribir "CLAUDE.md" <<'EOF'
# NovuChat — instrucciones de proyecto

Asistentes conversacionales de WhatsApp para PyMEs bolivianas, construidos con
**n8n + IA**. Proyecto conjunto de **Andres** (arquitectura, infraestructura,
comercial) y **Silvana** (diseño funcional, guiones, material comercial).

**Objetivo inmediato:** dos demos comerciales el **9 y 10 de septiembre de
2026**. Congelamiento de cambios el **8 de septiembre**.

Antes de trabajar, leé `ESTADO.md` (dónde estamos) y `CONFIGURACION.md`
(parámetros e identificadores). Al terminar una sesión, actualizá `ESTADO.md`.

## Idioma y estilo

Español latinoamericano (Bolivia), sin voceo. Respuestas técnicas rigurosas y
detalladas; interactivas en los puntos críticos. Andres tiene 25 años de
experiencia en arquitectura y gestión de proyectos, y experiencia media
programando: explicá el *porqué* de las decisiones, no solo el *cómo*.

## Arquitectura

```
WhatsApp (Meta Cloud API)
   └── webhook ──► n8n autoalojado en OCI (2.36.5)
                     └── AI Agent (Gemini en demos, Claude en producción)
                           ├── memoria por número de teléfono
                           ├── Google Calendar (consultar / agendar)
                           └── envío de respuesta + alerta al negocio
```

## PROHIBICIONES DURAS

1. **NUNCA** reintroducir un canal NO oficial de WhatsApp — Evolution API,
   Baileys, WPPConnect, dispositivos vinculados o equivalentes. Se probó y se
   retiró el 2026-08-22 por rotura silenciosa y riesgo de baneo. El único
   canal es la **Cloud API oficial de Meta**. Referencia:
   `~/WhatsApp-Modular/docs/13-laboratorio-evolution.md`.
2. **NUNCA** escribir un token, App Secret, Client Secret o API key en un
   archivo del repositorio — incluidos los JSON de flujos exportados, los
   sticky notes de n8n y los ejemplos. Solo en `.env` (ignorado) y en el
   gestor de contraseñas.
3. **NUNCA** presentar un cobro simulado como real. El QR de demostración
   lleva el rótulo impreso en la imagen **y** en el caption, y la confirmación
   dice "simulado". Sin webhook de acreditación bancaria no hay cobro real.
4. **NUNCA** hacer que el agente niegue ser una IA. Se presenta como asistente
   virtual y, si le preguntan, lo dice con naturalidad.
5. **NUNCA** tocar la app de Meta `Demo SeguroLo Tengo` ni el `otp-service`:
   son de WhatsApp-Modular, un sistema financiero en producción. Comparten la
   VM y la WABA, pero son productos distintos.
6. **NUNCA** publicar el número de prueba a terceros: solo responde a los 5
   destinatarios registrados (ver ESTADO.md, riesgo de demo).

## Reglas de diseño de los flujos n8n

- **Memoria con clave de sesión explícita** = número de origen
  (`messages[0].from`). Sin esto, dos clientes comparten memoria. Es el
  defecto más grave que puede tener uno de estos flujos.
- **Filtro de eventos** antes del agente: solo pasan payloads con `messages`.
  Los acuses de estado se descartan.
- **Normalización de entrada** que cubra `text`, `interactive`, `order`,
  `image` y cualquier otro tipo con respuesta cortés. Nunca acceder a
  `.text.body` sin pasar por ahí.
- **Fecha, hora y zona inyectadas al prompt** (`America/La_Paz`, UTC-4 fijo).
  Sin esto, "mañana en la tarde" se calcula mal.
- **Modelo como sub-nodo intercambiable**: cambiar Gemini por Anthropic no
  debe requerir tocar nada más del flujo.
- **Todo lo configurable por negocio** vive en el nodo `Config del negocio`,
  no disperso por el lienzo. Es lo que sostiene la promesa de instalar un
  cliente nuevo en 48 horas.
- **Nodos Code en JavaScript**: la imagen de n8n desplegada no trae Python.

## Flujo de trabajo

- Los JSON de `Flujos/` son la fuente de verdad versionada. Tras editar en la
  interfaz de n8n, **exportar** (⋯ → Download) y reemplazar el archivo.
- En n8n cada cambio exige volver a pulsar **Publish** para que llegue a
  producción.
- n8n Community no comparte flujos entre usuarios: la cuenta de Andres es
  dueña de lo productivo; Silvana desarrolla e intercambia por export/import.
- Antes de dar algo por terminado, probarlo contra un teléfono real y
  reportar el resultado **real**, no el esperado.
EOF

# -----------------------------------------------------------------------------
escribir "ESTADO.md" <<'EOF'
# ESTADO — bitácora del proyecto NovuChat

> Se actualiza al final de cada sesión y antes de cualquier pausa. Al retomar,
> leer esto primero. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos.

**Última actualización:** 2026-08-28

---

## Dónde estamos

**Demo A (Agendamiento — Belleza y Salud): CONVERSANDO POR WHATSAPP REAL.**
El flujo recibe mensajes desde el número de prueba, el agente responde con
catálogo y horarios, consulta el Google Calendar real y puede crear la cita.

**Pendiente inmediato:** una ejecución de producción tardó más de 48 s (la
anterior exitosa, 11 s). Hay que identificar el nodo culpable por tiempos y
aplicar tres ajustes: `consultar_disponibilidad` sin *Return All* y con
*Limit* 20, *Max Iterations* del agente de 8 a 5, y *Timeout* de flujo en
60 s. **Objetivo: respuesta en menos de 10 segundos.**

**Demo B (Venta y cobro — Gastronomía y Retail): NO INICIADO**, y con un
bloqueo de diseño abierto (ver Decisiones pendientes).

---

## Logros (2026-08-28)

- Análisis completo de los documentos preliminares de Silvana, con 20
  criterios de implementación y plan de demos → `Analisis/`.
- Dos flujos n8n generados con las correcciones aplicadas → `Flujos/`.
- Recursos del demo: calendario de relleno, QR simulado, checklist de ensayo,
  guion del presentador y Simulador v2 offline → `Demo-Recursos/`.
- App de Meta `NovuChat-Demo-A` creada, publicada y con webhook operativo.
- Google Cloud `${GCP_PROJECT_ID}` con OAuth de Calendar y API de Gemini.
- Demo A funcionando de punta a punta contra WhatsApp real.

---

## Hallazgos que costaron tiempo (no volver a tropezar)

1. **El número de prueba es UNO POR PORTAFOLIO COMERCIAL, no por app.** Al
   crear `NovuChat-Demo-A` se colgó de la WABA que ya existía del proyecto
   WhatsApp-Modular. Por eso el hilo de WhatsApp mostraba mensajes viejos.
2. **`subscribed_apps` es obligatorio y NO existe en la interfaz de Meta.**
   Suscribir el campo `messages` no basta: la WABA debe estar suscrita a la
   app, y eso solo se hace por API. Era la causa de "no entra nada a n8n".
   Script: `scripts/verificar-meta.sh`.
3. **La app de Meta debe estar publicada (Live).** En modo Desarrollo, Meta
   solo entrega los webhooks de prueba disparados desde el panel. Publicar
   exige URL de política de privacidad y categoría; no requiere Business
   Verification.
4. **El token de verificación del webhook NO se configura en n8n.** El nodo
   responde el `hub.challenge` automáticamente: se inventa la cadena en Meta
   y no se pega en ningún lado.
5. **La credencial de Calendar debe ser del tipo `Google Calendar OAuth2 API`**,
   no la genérica `Google OAuth2 API` (esa exige el campo Scope y el nodo no
   la acepta). Crearla **desde el nodo** evita el error.
6. **Un Client ID y un Client Secret de clientes OAuth distintos** producen
   `Client authentication failed`. Descargar el JSON del cliente y copiar de
   ahí, nunca de la pantalla.
7. **La URL del webhook debe ser la de Production**, no la de Test
   (`/webhook-test/`), que solo vive mientras el editor está escuchando.
8. **Los datos fijados (pin) no afectan las ejecuciones de producción**, solo
   las manuales. No bloquean el webhook.
9. **Gemini devuelve 503 en picos de demanda.** Mitigación: elegir el modelo
   desde el desplegable (nunca escribirlo a mano), activar *Retry On Fail*, y
   evaluar habilitar facturación para tener capacidad prioritaria.
10. **El parámetro `Trigger On` del WhatsApp Trigger llega vacío** al importar
    el JSON generado: hay que seleccionar **Messages** a mano, y dejar
    *Receive Message Status Updates* **sin valores** para no generar
    ejecuciones basura.
11. **La imagen del QR no necesita hosting público**: se sube con
    `POST /{PHONE_NUMBER_ID}/media` y se envía por media ID (válido 30 días).

---

## Decisiones tomadas

| Decisión | Resolución | Fecha |
|---|---|---|
| Canal de WhatsApp | Meta Cloud API, número de prueba | 28/08 |
| LLM de los demos | Gemini (Google AI Studio) | 28/08 |
| LLM de producción | Claude API (Anthropic) | 28/08 |
| Evolution API | Prohibido, ni siquiera para demos | 22/08 |
| Cobro por QR | Simulacro rotulado; sin webhook bancario no hay cobro real | 28/08 |
| Transparencia del agente | No niega ser una IA | 28/08 |

## Decisiones pendientes

- **Cómo montar el Demo B.** El número de prueba es único por portafolio y,
  si se suscriben dos apps a la misma WABA, **ambos flujos se disparan con
  cada mensaje**. Salidas posibles: (a) crear un portafolio comercial nuevo
  para obtener un segundo número de prueba; (b) unificar ambos demos en un
  solo flujo que enrute por vertical según la opción del menú inicial.
  Recomendación inicial: (b), porque además simplifica la presentación.
- **Facturación de Gemini** para reducir los 503 durante los demos.
- **Memoria persistente** (Postgres Chat Memory en `n8n-db`) para producción;
  hoy es Window Buffer en memoria y se pierde al reiniciar n8n.

---

## Riesgos vivos para el 9–10 de septiembre

- **Latencia**: hoy por encima del objetivo. Es el pendiente número uno.
- **Solo 5 destinatarios**: si un asistente escribe desde su propio celular,
  el mensaje entra, consume tokens y la respuesta falla. Por eso el guion
  contempla prestar un celular propio al público.
- **503 de Gemini** en plena demostración: mitigado con reintentos, se cierra
  del todo con facturación habilitada.
- **Business Verification de AAB1** (enviada 27/08): no bloquea los demos,
  pero sin ella no hay plantillas y por tanto **no se prometen recordatorios
  "24 h antes" en vivo**.

## Próximos pasos

1. Cerrar la latencia del Demo A (tres ajustes de arriba).
2. Recorrer la suite A completa de `Demo-Recursos/checklist-ensayo.md`.
3. Decidir el diseño del Demo B y construirlo.
4. Ensayo general 6–7/09 con Silvana; video de respaldo; Simulador al día.
5. 8/09 congelamiento y exportación de flujos al repositorio.
EOF

# -----------------------------------------------------------------------------
escribir "CONFIGURACION.md" <<'EOF'
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
EOF

# -----------------------------------------------------------------------------
escribir ".env.example" <<'EOF'
# NovuChat — variables de entorno para los scripts de verificación.
# Copiar a .env y completar. .env está en .gitignore y NO se versiona.
#
#   cp .env.example .env && chmod 600 .env
#
# Hay DOS entornos, uno por demo, porque cada uno tiene su propia app de Meta
# (WA_APP_ID, WA_PHONE_ID y WABA_ID distintos):
#
#   .env          Demo A — Agendamiento
#   .env.demo-b   Demo B — Venta y cobro
#
# Los scripts apuntan a uno u otro con --env:
#   ./scripts/verificar-meta.sh --env .env.demo-b
#
# El patron .env.* esta en .gitignore, con .env.example como unica excepcion.
#
# ⚠️ Este archivo es PÚBLICO: no lleva ningún valor real, ni siquiera los
# identificadores no secretos. Los valores reales están en
# CONFIGURACION.local.md (ignorado por git) y en el gestor de contraseñas.
# Ver CONVENCIONES-REPO-PUBLICO.md.

# --- Meta / WhatsApp Cloud API ------------------------------------------
# Token permanente del usuario de sistema, app NovuChat-Demo-A.
# Permisos: whatsapp_business_messaging + whatsapp_business_management
WA_TOKEN=

# App Secret de la app de Meta (solo si algún script valida la firma X-Hub)
WA_APP_SECRET=

# Identificadores (ver CONFIGURACION.local.md §1)
WA_PHONE_ID=
WABA_ID=
WA_APP_ID=
WA_GRAPH_VERSION=v26.0

# Su número de WhatsApp registrado, solo dígitos, sin '+'
WA_TO=

# --- n8n -----------------------------------------------------------------
# Base de la instancia autoalojada, sin barra final. Ej.: https://n8n.ejemplo.tld
N8N_BASE_URL=

# Ruta del webhook de producción del flujo Demo A.
# Actúa como SECRETO COMPARTIDO: quien la tiene inyecta mensajes al flujo.
# Ej.: /webhook/00000000-0000-0000-0000-000000000000/webhook
N8N_WEBHOOK_PATH=

# URL completa. Si se deja vacía, los scripts la arman con las dos de arriba.
N8N_WEBHOOK_URL=

# --- Google Cloud / Calendar --------------------------------------------
GCP_PROJECT_ID=
GCP_PROJECT_NUMBER=
GOOGLE_ACCOUNT=
# ID del calendario del demo, termina en @group.calendar.google.com
CALENDAR_ID=

# --- Infraestructura -----------------------------------------------------
# IP o nombre de la VM de OCI y ruta a la llave privada de SSH.
VM_HOST=
VM_USER=ubuntu
VM_SSH_KEY=

# --- Sitio administrativo (Firebase, directorio admin/) ------------------
# Lo completa el agente que construye admin/. En CI estos valores no son
# secretos de larga duración: el despliegue usa OIDC / Workload Identity
# Federation, nunca una clave JSON de cuenta de servicio.
FIREBASE_PROJECT_ID=
EOF

# -----------------------------------------------------------------------------
escribir ".gitignore" <<'EOF'
# --- Valores reales y secretos (NUNCA versionar) -------------------------
# El repositorio es PÚBLICO. Ver CONVENCIONES-REPO-PUBLICO.md.
.env
.env.*
!.env.example
CONFIGURACION.local.md
*.local.md
secrets/
*.key
*.pem
*.p12
*.pfx
id_rsa
id_ed25519
**/credentials*.json
**/client_secret*.json
**/service-account*.json
**/*serviceAccountKey*.json
.gitleaks-report.json

# --- Material original de terceros, no saneado ---------------------------
Preliminares/

# --- Ruido ---------------------------------------------------------------
*.log
.DS_Store
__pycache__/
*.pyc
node_modules/
.venv/
venv/

# --- Firebase (directorio admin/) ----------------------------------------
.firebase/
admin/**/.env*
!admin/**/.env.example
EOF

# -----------------------------------------------------------------------------
escribir "scripts/verificar-meta.sh" <<'EOF'
#!/usr/bin/env bash
# Verifica de una pasada las cuatro condiciones que deben cumplirse para que
# los mensajes de WhatsApp lleguen a n8n. Solo lee; no modifica nada salvo que
# se pase --suscribir.
#
#   ./scripts/verificar-meta.sh                       # usa .env (Demo A)
#   ./scripts/verificar-meta.sh --env .env.demo-b     # otro entorno
#   ./scripts/verificar-meta.sh --suscribir           # corrige la suscripción
#   ./scripts/verificar-meta.sh --env .env.demo-b --suscribir
#
# Cada demo tiene su propia app de Meta, con su WA_APP_ID, WA_PHONE_ID y
# WABA_ID: por eso hace falta poder apuntar el script a un archivo distinto.
# Todos los archivos .env* están en .gitignore (repositorio público).
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

ARCHIVO_ENV=".env"
SUSCRIBIR=0
uso() {
  # Imprime el bloque de comentarios de la cabecera, hasta la primera linea
  # que no sea comentario. Asi la ayuda no se desincroniza al editar el script.
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
  exit "${1:-0}"
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 ]] || { echo "✗ --env requiere la ruta de un archivo"; exit 2; }
      ARCHIVO_ENV="$2"; shift 2 ;;
    --env=*)   ARCHIVO_ENV="${1#--env=}"; shift ;;
    --suscribir) SUSCRIBIR=1; shift ;;
    -h|--help)   uso 0 ;;
    *) echo "✗ Argumento no reconocido: $1"; uso 2 ;;
  esac
done

if [[ ! -f "$ARCHIVO_ENV" ]]; then
  echo "✗ Falta ${ARCHIVO_ENV} (copiar de .env.example)"
  exit 1
fi
echo "Entorno: ${ARCHIVO_ENV}"
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
source "$ARCHIVO_ENV"
set +a
: "${WA_TOKEN:?Falta WA_TOKEN en ${ARCHIVO_ENV}}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

# La URL del webhook se arma con N8N_BASE_URL + N8N_WEBHOOK_PATH si no se
# definio la completa. Ningun valor real vive en este archivo (repo publico).
if [[ -z "${N8N_WEBHOOK_URL:-}" && -n "${N8N_BASE_URL:-}" && -n "${N8N_WEBHOOK_PATH:-}" ]]; then
  N8N_WEBHOOK_URL="${N8N_BASE_URL%/}${N8N_WEBHOOK_PATH}"
fi

ok=0; fail=0
p_ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; ok=$((ok+1)); }
p_fail() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; fail=$((fail+1)); }

echo "== 1. El token pertenece a la app correcta =="
APP=$(curl -s --max-time 20 "${G}/debug_token?input_token=${WA_TOKEN}&access_token=${WA_TOKEN}" || echo '{}')
APP_ID=$(echo "$APP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("app_id",""))' 2>/dev/null || echo "")
if [[ "$APP_ID" == "${WA_APP_ID}" ]]; then
  p_ok "token de la app ${WA_APP_ID}"
else
  p_fail "el token pertenece a la app '${APP_ID:-sin-respuesta}', se esperaba ${WA_APP_ID}"
  echo "     → generar un token nuevo desde el usuario de sistema eligiendo NovuChat-Demo-A"
fi

echo "== 2. La WABA está suscrita a la app =="
SUBS=$(curl -s --max-time 20 "${G}/${WABA_ID}/subscribed_apps" -H "Authorization: Bearer ${WA_TOKEN}" || echo '{}')
if echo "$SUBS" | grep -q "\"${WA_APP_ID}\""; then
  p_ok "la WABA ${WABA_ID} entrega a la app ${WA_APP_ID}"
else
  p_fail "la app NO está suscrita a la WABA — los mensajes no llegarán a n8n"
  echo "$SUBS" | python3 -m json.tool 2>/dev/null || true
  if [[ $SUSCRIBIR -eq 1 ]]; then
    echo "     → suscribiendo..."
    curl -s -X POST "${G}/${WABA_ID}/subscribed_apps" \
      -H "Authorization: Bearer ${WA_TOKEN}" | python3 -m json.tool
  else
    echo "     → corregir con: $0 --env ${ARCHIVO_ENV} --suscribir"
  fi
fi

echo "== 3. El número de prueba responde =="
NUM=$(curl -s --max-time 20 "${G}/${WA_PHONE_ID}" -H "Authorization: Bearer ${WA_TOKEN}" || echo '{}')
if echo "$NUM" | grep -q '"id"'; then
  p_ok "$(echo "$NUM" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("display_phone_number","?"),"·",d.get("verified_name","?"))' 2>/dev/null)"
else
  p_fail "no se pudo leer el número ${WA_PHONE_ID}"
fi

echo "== 4. El webhook de n8n responde el desafío =="
if [[ -n "${N8N_WEBHOOK_URL:-}" ]]; then
  R=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' \
      "${N8N_WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=12345" || true)
  R=${R:-000}
  if [[ "$R" == "200" ]]; then
    p_ok "el endpoint devuelve 200 (flujo publicado y proxy correcto)"
  else
    p_fail "el endpoint devuelve HTTP ${R} — ¿flujo sin publicar, o URL de Test?"
  fi
else
  echo "  - N8N_WEBHOOK_URL no definida, se omite"
fi

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[1;32mTodo en orden (%d comprobaciones).\033[0m\n' "$ok"
else
  printf '\033[1;31m%d comprobación(es) fallida(s).\033[0m Ver ESTADO.md §Hallazgos.\n' "$fail"
  exit 1
fi
EOF
chmod +x "$DIR/scripts/verificar-meta.sh" 2>/dev/null || true

# -----------------------------------------------------------------------------
escribir "scripts/enviar-prueba.sh" <<'EOF'
#!/usr/bin/env bash
# Envía un mensaje de texto de prueba al número registrado, sin pasar por n8n.
# Aísla si el problema está en el canal de Meta o en el flujo.
# Requiere que usted le haya escrito al número en las últimas 24 h.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; source .env; set +a
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
TEXTO="${1:-NovuChat: prueba de canal $(date +%H:%M).}"

curl -s -X POST "${G}/${WA_PHONE_ID}/messages" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"messaging_product\":\"whatsapp\",\"to\":\"${WA_TO}\",\"type\":\"text\",\"text\":{\"body\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$TEXTO")}}" \
  | python3 -m json.tool
EOF
chmod +x "$DIR/scripts/enviar-prueba.sh" 2>/dev/null || true

# -----------------------------------------------------------------------------
escribir "scripts/subir-qr.sh" <<'EOF'
#!/usr/bin/env bash
# Sube el QR de demostración a la Cloud API y devuelve un media ID (30 días).
# Evita tener que publicar la imagen en una URL pública (Demo B).
# El media ID queda ligado al número que lo sube.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; source .env; set +a
IMG="${1:-Demo-Recursos/qr-demo.png}"
[[ -f "$IMG" ]] || { echo "✗ No existe $IMG"; exit 1; }

curl -s -X POST "https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}/${WA_PHONE_ID}/media" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -F "messaging_product=whatsapp" \
  -F "file=@${IMG};type=image/png" | python3 -m json.tool

echo
echo "Pegue el id en el nodo 'Enviar QR (imagen DEMO)' cambiando el origen de Link a ID."
EOF
chmod +x "$DIR/scripts/subir-qr.sh" 2>/dev/null || true

echo
azul "Listo."
cat <<TXT

Siguientes pasos:

  1. cp .env.example .env && chmod 600 .env
     (completar WA_TOKEN con el token permanente; nunca versionarlo)

  2. ./scripts/verificar-meta.sh
     Comprueba las cuatro condiciones del canal en una sola pasada.

  3. claude
     Claude Code cargará CLAUDE.md automáticamente. Arranque con:
     "Leé ESTADO.md y CONFIGURACION.md y decime cuál es el próximo paso."

TXT
