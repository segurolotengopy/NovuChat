#!/usr/bin/env bash
# =============================================================================
# estado-generado.sh — imprime lo que del estado del proyecto SE PUEDE DERIVAR
# =============================================================================
#
# POR QUÉ EXISTE (Analisis/41 §5.5 y §9.4). `ESTADO.md` llegó a 4.960 líneas
# porque mezclaba dos cosas: lo que se decide y se descubre (que solo se puede
# escribir a mano, y va a `bitacora/<aaaa-mm>.md`) y lo que se puede leer de
# git, de GitHub, de la nube y de n8n (que se escribía a mano y quedaba viejo
# la misma tarde). Este script imprime lo segundo, y `ESTADO.md` queda de una
# pantalla.
#
# QUÉ IMPRIME, en cuatro bloques, cada uno diciendo de dónde lo sacó y, si no
# pudo, por qué y cómo se consigue:
#
#   1. Etiqueta viva: la última etiqueta `vX.Y.Z` alcanzable desde
#      `origin/main` (git) y la última release publicada (gh), con el sha.
#   2. Functions desplegadas: `gcloud functions list` del proyecto de la
#      consola, si hay credenciales y proyecto; si no, dice cómo.
#   3. Flujos publicados con su versión: `scripts/estado-de-versiones.sh`,
#      que compara cada flujo vivo en n8n con su JSON versionado (necesita los
#      `.env.<cliente>` con el acceso a n8n; si no están, lo dice).
#   4. Tenants con su modalidad: lee Firestore con las credenciales por
#      defecto de la aplicación (ADC) y el `--proyecto` de la consola, como
#      hacen los scripts de `admin/scripts/`; imprime id, estado, plan y
#      modalidad, nada más. Si no hay credenciales, dice cómo.
#
# NO ESCRIBE NADA en ningún lado. NO IMPRIME SECRETOS: solo nombres, estados y
# fechas. Sale con 0 aunque un bloque no se pueda derivar: el bloque lo dice.
#
#   ./scripts/estado-generado.sh                       # todo lo que pueda
#   ./scripts/estado-generado.sh --proyecto <id-gcp>   # con la nube
#   ./scripts/estado-generado.sh --sin-nube            # solo git, gh y n8n
#
# El id del proyecto de la consola NO es ${GCP_PROJECT_ID} de los demos
# (memoria `proyecto-gcp-de-la-consola-no-es-gcp-project-id`): se pasa con
# `--proyecto`, o se toma de la variable NOVUCHAT_PROYECTO_CONSOLA si está.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
PROYECTO="${NOVUCHAT_PROYECTO_CONSOLA:-}"
NUBE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --proyecto) PROYECTO="${2:?--proyecto necesita un id}"; shift 2 ;;
    --sin-nube) NUBE=0; shift ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

V=$'\033[1;32m'; A=$'\033[1;33m'; G=$'\033[0;90m'; N=$'\033[1m'; FIN=$'\033[0m'
titulo() { printf '\n%s== %s ==%s\n' "$N" "$1" "$FIN"; }
nota()   { printf '%s   %s%s\n' "$G" "$1" "$FIN"; }
falta()  { printf '%s   ✗ %s%s\n' "$A" "$1" "$FIN"; }

printf '%sEstado generado de NovuChat%s — %s\n' "$N" "$FIN" "$(date '+%Y-%m-%d %H:%M %Z')"
nota "Lo que no está acá se escribe a mano: decisiones y hallazgos en bitacora/<aaaa-mm>.md; el resumen en ESTADO.md."

# ---------------------------------------------------------------- 1. etiqueta
titulo "1. Etiqueta viva"
if git fetch --quiet origin 2>/dev/null; then nota "origin al día (git fetch)"; else falta "no se pudo hacer fetch: se lee lo que hay en local"; fi
PUNTA="$(git rev-parse --short origin/main 2>/dev/null || echo '?')"
ETIQUETA="$(git describe --tags --abbrev=0 --match 'v*' origin/main 2>/dev/null || true)"
if [[ -n "$ETIQUETA" ]]; then
  SHA_ETIQ="$(git rev-parse --short "${ETIQUETA}^{commit}" 2>/dev/null || echo '?')"
  ADELANTE="$(git rev-list --count "${ETIQUETA}..origin/main" 2>/dev/null || echo '?')"
  printf '   %s%s%s en %s; origin/main en %s, %s commit(s) después de la etiqueta\n' "$V" "$ETIQUETA" "$FIN" "$SHA_ETIQ" "$PUNTA" "$ADELANTE"
else
  falta "ninguna etiqueta v* alcanzable desde origin/main (¿faltan las etiquetas en local? git fetch --tags)"
fi
if command -v gh >/dev/null 2>&1; then
  REL="$(GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh-pro}" gh release list --limit 1 2>/dev/null | head -1 || true)"
  if [[ -n "$REL" ]]; then printf '   última release en GitHub: %s\n' "$REL"; else falta "gh no devolvió releases: o el repositorio no publica releases (solo etiquetas, que es lo de arriba), o no hay sesión de gh (GH_CONFIG_DIR)"; fi
else
  falta "gh no está instalado: la release se mira en GitHub → Releases"
fi

# --------------------------------------------------------------- 2. Functions
titulo "2. Functions desplegadas"
if [[ "$NUBE" -eq 0 ]]; then
  nota "omitido (--sin-nube)"
elif ! command -v gcloud >/dev/null 2>&1; then
  falta "gcloud no está instalado; se consigue en la consola de Google Cloud → Cloud Functions, o con: gcloud functions list --project <id>"
elif [[ -z "$PROYECTO" ]]; then
  falta "falta el id del proyecto de la consola: --proyecto <id> (o NOVUCHAT_PROYECTO_CONSOLA). No es el de los demos."
elif [[ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]]; then
  falta "gcloud sin cuenta activa (gcloud auth list). Con credenciales: gcloud functions list --project $PROYECTO"
else
  if ! gcloud functions list --project "$PROYECTO" --format='table(name.basename(),state,environment,updateTime.date())' 2>/tmp/estado-generado-gcloud.err | sed 's/^/   /'; then
    falta "gcloud functions list falló: $(head -1 /tmp/estado-generado-gcloud.err 2>/dev/null)"
  fi
  rm -f /tmp/estado-generado-gcloud.err
fi

# ------------------------------------------------------------ 3. flujos vivos
titulo "3. Flujos publicados con su versión (scripts/estado-de-versiones.sh)"
SALIDA_VERSIONES="$(./scripts/estado-de-versiones.sh 2>&1)"
CODIGO=$?
printf '%s\n' "$SALIDA_VERSIONES" | sed 's/^/   /'
SIN_COMPROBAR="$(printf '%s\n' "$SALIDA_VERSIONES" | grep -c 'no se puede comprobar' || true)"
if [[ "$SIN_COMPROBAR" -gt 0 ]]; then
  falta "$SIN_COMPROBAR flujo(s) sin poder comprobar: faltan los .env.<cliente> con el acceso a n8n (viven en la copia base, no en un worktree). Correr desde la copia base o con los .env a mano."
fi
case "$CODIGO" in
  0) [[ "$SIN_COMPROBAR" -gt 0 ]] || nota "los 8 flujos comparados: ningún atraso sin declarar" ;;
  1) falta "hay un flujo atrasado SIN declarar en docs/versiones-por-cliente.md" ;;
  *) falta "estado-de-versiones.sh no pudo correr (código $CODIGO)" ;;
esac
nota "la versión de módulo por tenant llega con F5 (Analisis/41 §5.5)"

# ------------------------------------------------------------------ 4. tenants
titulo "4. Tenants con su modalidad (Firestore)"
if [[ "$NUBE" -eq 0 ]]; then
  nota "omitido (--sin-nube)"
elif [[ -z "$PROYECTO" ]]; then
  falta "falta --proyecto <id> (o NOVUCHAT_PROYECTO_CONSOLA)"
elif [[ ! -d admin/node_modules/firebase-admin ]]; then
  falta "admin/ sin dependencias: cd admin && pnpm install"
else
  # Lee solo la ficha y cuenta/estado de cada tenant, con las credenciales
  # por defecto (ADC), igual que admin/scripts/asignar-plan.mjs. No escribe.
  node --input-type=module - "$PROYECTO" <<'JS' 2>&1 | sed 's/^/   /'
const proyecto = process.argv[2];
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: proyecto });
const db = getFirestore();
try {
  const fichas = await db.collection('tenants').get();
  if (fichas.empty) { console.log('(sin tenants)'); process.exit(0); }
  const filas = [];
  for (const f of fichas.docs) {
    const ficha = f.data() || {};
    const cuenta = (await db.doc(`tenants/${f.id}/cuenta/estado`).get()).data() || {};
    filas.push({
      tenant: f.id,
      estado: ficha.estado ?? '?',
      plan: cuenta.plan ?? ficha.plan ?? '?',
      modalidad: cuenta.modalidad ?? (cuenta.plan === 'demostracion' ? 'demostracion (por plan)' : '?'),
      flujos: Array.isArray(ficha.modulos) ? ficha.modulos.join(',') : Array.isArray(ficha.flujos) ? ficha.flujos.join(',') : '?',
    });
  }
  const ancho = (k) => Math.max(k.length, ...filas.map((r) => String(r[k]).length));
  const cols = ['tenant', 'estado', 'plan', 'modalidad', 'flujos'];
  console.log(cols.map((c) => c.padEnd(ancho(c))).join('  '));
  for (const r of filas) console.log(cols.map((c) => String(r[c]).padEnd(ancho(c))).join('  '));
  console.log(`${filas.length} tenant(s)`);
} catch (e) {
  const msg = String(e && e.message || e);
  if (/credential|ADC|default credentials|UNAUTHENTICATED|PERMISSION_DENIED/i.test(msg)) {
    console.log('✗ sin credenciales para Firestore. Con acceso: gcloud auth application-default login (con CLOUDSDK_CONFIG propio, nunca gcloud config set), y volver a correr con --proyecto ' + proyecto);
  } else {
    console.log('✗ no se pudo leer Firestore: ' + msg.split('\n')[0]);
  }
}
JS
fi

printf '\n%sFin.%s Este script no escribe nada.\n' "$G" "$FIN"
exit 0
