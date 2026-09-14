# Acta de pase a producción — NovuChat (consola) — v0.3.0 — 2026-09-14

Commit: **el de la fusión del PR del acta** en `main` (incluye `796543d`, merge del PR #69, y los arreglos de la revisión) | Run CI en `main`: último «CI/CD Node → Firebase» sobre `796543d`, en verde (Actions, rama `main`) | Modo: **A**
Preparado por: Claude Code (skill `pase-a-produccion`) | Aprueba: Andres Alberdi, revisor de `production` (**pendiente**)

## Versión propuesta y por qué

Producción corre hoy `v0.2.0` (`3a63680`, desplegada el 2026-09-14 14:42 UTC, estado `success`).
Desde entonces entra una funcionalidad nueva y compatible —el vertical `onboarding`, su
documento de configuración, su regla y su pantalla— y ningún cambio incompatible: **minor**,
`v0.2.0` → **`v0.3.0`**.

## Cambios incluidos (desde v0.2.0)

- flujos (feat): captación de clientes de NovuChat (onboarding): vertical `onboarding` en lugar
  del reservado `interno`; `/config/onboarding` solo del propietario; pestaña «Captación» (#69).
- flujos: la captación obedece los umbrales del servidor, como A y B (#69).
- fix(captacion): a nadie se le avisa de su propio mensaje (#69).
- fix(demo-b): a nadie se le avisa de su propio mensaje (#68).
- perf(flujos): el prefijo del prompt deja de cambiar en cada turno (#68).
- test / docs: suite del flujo de captación, bitácora.

**Lo que despliega el CI** (`FIREBASE_DEPLOY_ONLY`): hosting, reglas e índices de Firestore y
Functions. **Los flujos de n8n no los despliega el CI**: se importan y publican aparte.

## Checklist (release ordinario: controles marcados (R), más los de las áreas que cambiaron)

| # | Control | Estado | Evidencia |
|---|---|---|---|
| 1 | `main` limpia; candidato = `origin/main` | Verde | `origin/main` = `796543d`; worktree en `e421c04`, mismo contenido |
| REP-02/03 | Ruleset de `main` con check obligatorio | Verde | ruleset `main-protegida` (activo), checks obligatorios `compuerta-pr`, `calidad` |
| REP-05 | Sin secretos en el historial | Verde | job `Secretos (Gitleaks)` en verde en el run de `main` |
| REP-08 | Tag semántico; firma | Verde (a crear) | `TAG_FIRMADO_REQUERIDO=false`; hay clave SSH configurada, se recomienda `-s` |
| PIP-01 | Run completo en verde para el tag | Pendiente | Se verifica en el run que dispare el tag |
| PIP-05 | `seguridad-estatica` sin CRITICAL/HIGH | Verde | SAST, SCA y Gitleaks en verde en el run de `main` |
| PIP-06 | Cobertura / calidad | Verde | job `calidad` en verde; 728 pruebas locales (`pruebas/correr.sh`) |
| PIP-07/08 | Imagen escaneada y firmada | N/A | Firebase Hosting + Functions: no hay imagen de contenedor |
| PIP-09 | DAST y humo contra staging | **No verificado** | `desplegar-staging` y `dast-y-humo` se omiten: **no hay proyecto de staging** (ESTADO, 12/09). Igual en `v0.1.4`, `v0.1.5` y `v0.2.0`. Camino para cerrarlo: `Analisis/28-dast-y-prueba-de-humo.md` |
| PIP-11 | CodeQL activo | Verde | CodeQL en verde en `main`; el PR #69 cerró su alerta nueva (`e421c04`) |
| PIP-14 | Rollback automático en `post-despliegue` | Verde | health check + clonar el canal `previa` sobre `live` (`ci-node-firebase.yml`) |
| SEC-02/03 | Sin secretos prohibidos; los de prod en el Environment | Verde | repo: `GCP_WIF_PROVIDER`; `production`: `GCP_SA_DEPLOY_PROD`. Sin `FIREBASE_TOKEN` ni claves de SA |
| SEC-10 | Rotaciones vencidas | No verificado | No existe `docs/seguridad/inventario-secretos.md` |
| DAT-01 | Reglas probadas con emulador | Verde | `reglas.test.ts`: 241 pruebas, 11 nuevas de captación escritas negando |
| DAT-02 | Reglas desplegadas en el mismo job que hosting | Verde | `FIREBASE_DEPLOY_ONLY=hosting,firestore:rules,firestore:indexes,functions` |
| Reglas | Cambio de reglas revisado por el agente `seguridad` | Verde (con observaciones) | 2026-09-14, rango `v0.2.0..796543d`: **apto con observaciones**. CRITICAL 0, HIGH 0, MEDIUM 0, LOW 2. Solo el propietario con Google lee y escribe `onboarding`; la lectura de los demás documentos de config no cambia. Gitleaks sobre los 7 commits: sin fugas |
| Local | `security-local.sh` ≤ 24 h | Verde | 2026-09-14 11:40, v2.4, umbral HIGH: **APROBADO**. CRITICAL 0, HIGH 0, MEDIUM 17; gitleaks, semgrep, osv-scanner, trivy y npm-audit ejecutados. Informe local `.security-reports/20260914-114006/resumen.md` (no versionado) |
| Alertas | Dependabot / Code Scanning altas | Verde (con nota) | Dependabot: 7 medium, 0 high/critical. Code Scanning en `main`: 4 de Scorecard, sin archivo asociado |
| Prod | Producción responde, con cabeceras | Verde | `https://consola.novuchat.site` → 200; HSTS con preload, CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, Permissions-Policy |
| Humo | Humo manual de flujos críticos | Pendiente | A cargo de Andres, sobre producción después del despliegue |

## Riesgos aceptados (excepciones vigentes en `.devsecops.yml`)

| id | herramienta | vence | justificación resumida |
|---|---|---|---|
| CVE-2026-41907 | trivy | 2026-10-31 | `uuid` 9.0.1 transitiva de firebase-admin; solo se llama `uuid.v4()`, no alcanzable |
| `ce0b484…:admin/scripts/emuladores.sh:generic-api-key:111` | gitleaks | 2026-10-31 | Falso positivo verificado |

Ninguna vencida; ninguna vence en los próximos 30 días (vencen en 47).

## Plan de rollback

- **Identificador actual de producción:** `v0.2.0` (`3a63680`).
- **La etiqueta va DESPUÉS de fusionar el PR del acta**, sobre el `origin/main` de ese momento: así
  el pase lleva la regla corregida.
- **Hosting (automático):** si el health check falla, `post-despliegue` clona el canal `previa`
  —copia de `v0.2.0` hecha justo antes del despliegue— sobre `live`. A mano, en el mismo sentido:
  `firebase hosting:clone "<SITIO>:previa" "<SITIO>:live" --project "${GCP_PROJECT_ID}"`.
  Sin canal: consola Firebase → Hosting → Historial de versiones → Revertir.
- **Reglas de Firestore y Functions:** **no** las revierte el clon de hosting. Se revierten con
  `git revert` de las fusiones de esta versión en una rama, PR y etiqueta nueva (`v0.3.1`). Los cambios de regla
  de esta versión solo **agregan** el documento `onboarding`: revertirlos no afecta a ningún
  comercio existente.

## Observaciones de la revisión de seguridad (no bloqueantes)

1. **LOW, resuelto en el PR del acta:** la escritura de `onboarding` no exigía
   `tenantOperativo(tenantId)`, a diferencia de las demás escrituras de config. Ahora lo exige.
2. **LOW, resuelto en el PR del acta:** faltaban casos negativos en el bloque «Captación» de
   `reglas.test.ts`. Se agregaron seis: operador e ingesta del tenant, `list` de la colección
   `config`, borrado, administrador ajeno, mensaje de más de 600 caracteres y comercio suspendido.
   Reglas: 247/247.
3. Observación: la regla de `list` sobre `config` depende ahora del documento, así que un listado
   sin filtro de toda la colección se rechaza para los miembros. Ninguna pantalla lista esa
   colección.
4. Observación: se retiró el vertical `interno`. Nunca se usó en el código. **No se verificó
   contra los datos de producción** que ningún tenant ni ruta tenga `flujo: 'interno'`.

## Pendientes antes de aprobar

1. Aceptar de forma explícita PIP-09 sin staging, como en los tres pases anteriores.
2. Opcional: confirmar en la consola de Firebase que ningún `tenants/*.flujos` ni
   `rutasWhatsApp/*.flujo` vale `interno`.
