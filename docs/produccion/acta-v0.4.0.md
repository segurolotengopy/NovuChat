# Acta de pase a producción — NovuChat (consola) — v0.4.0 — 2026-09-15

Commit: **`54ce90f`** (`origin/main`, merge del PR #78) | Run CI en `main`: [«CI/CD Node → Firebase» 35022019282](https://github.com/segurolotengopy/NovuChat/actions/runs/35022019282), en verde | Modo: **A**
Preparado por: Claude Code (skill `pase-a-produccion`) | Aprueba: Andres Alberdi, revisor de `production` (**pendiente**)

## Versión propuesta y por qué

Producción corre hoy `v0.3.0` (`198ac59`, 2026-09-14). Desde entonces entran funcionalidades
nuevas y compatibles —la captación como tercer flujo genérico, el nombre del asistente, el
horario de atención en la consola, la comprobación del archivo de planes— y ningún cambio
incompatible para los flujos que ya corren: **minor**, `v0.3.0` → **`v0.4.0`**.

**Compatibilidad con lo que ya corre en n8n:** `configuracionFlujo` suma `voz.nombreAsistente` y
`voz.nivelEmojis` (los flujos vivos los ignoran) y la clave `onboarding` pasa a salir **saneada**
con las mismas claves que el flujo vivo de captación ya lee (`mensajeClienteActual`,
`enlaceConsola`, `topeAviso`, `plantillaAviso`). El flujo de captación con el guion de Silvana se
publica **después** del despliegue.

## Cambios incluidos (desde v0.3.0, 22 commits)

- **Captación, tercer flujo genérico (#78):** `config/onboarding` con rubros, planes, cargos únicos,
  aclaraciones y `archivoPlanes` (con más de 5 planes el archivo es obligatorio, en la regla); lo
  edita el administrador del comercio con el flujo; `configuracionFlujo` manda la oferta saneada;
  `config/negocio.nombreAsistente` común a todos los flujos; Function `comprobarArchivoPlanes`
  (con la corrección de SSRF por IPv6 que lleva una IPv4); consola: editores de Captación, nombre
  del asistente, horario opcional y «Sin horario fijo».
- **Horario de atención en la consola (#74):** los siete días, con la regla que fija su formato.
- **Flujos (no los despliega el CI):** guion de Silvana (#78), `Confirmar envío` (#75), nombre del
  asistente en A y B, corrección de todas las negaciones de ser una IA.
- **Scripts y documentación:** `asignar-numero.mjs`, `cargar-captacion.mjs`, procedimiento de
  rotación del secreto de ingesta (#76), `Analisis/29` (#77), runbook y agentes del alta (#72).

**Lo que despliega el CI** (`FIREBASE_DEPLOY_ONLY=hosting,firestore:rules,firestore:indexes,functions`):
hosting, reglas e índices de Firestore y Functions. **Storage NO entra en este pase** (va con el #79).

## Checklist

| # | Control | Estado | Evidencia |
|---|---|---|---|
| 1 | `main` limpia; candidato = `origin/main` | Verde | `origin/main` = `54ce90f` |
| REP-02/03 | Ruleset de `main` con check obligatorio | Verde | ruleset `main-protegida` activo |
| REP-05 | Sin secretos en el historial | Verde | `Secretos (Gitleaks)` en verde en el run de `main`; secret scanning: 0 alertas abiertas |
| REP-08 | Tag semántico; firma | Verde (a crear) | `TAG_FIRMADO_REQUERIDO=false`; hay `user.signingkey`, se recomienda `-s` |
| PIP-01 | Run completo en verde para el tag | Pendiente | Se verifica en el run que dispare el tag |
| PIP-05 | `seguridad-estatica` sin CRITICAL/HIGH | Verde | SAST (Semgrep), SCA (Trivy) y Gitleaks en verde en el run 35022019282 |
| PIP-06 | Calidad | Verde | job `calidad` en verde; suite completa 903/903 en la rama del #78 |
| PIP-07/08 | Imagen escaneada y firmada | N/A | Firebase Hosting + Functions: sin imagen de contenedor |
| PIP-09 | DAST y humo contra staging | **No verificado** | `desplegar-staging` y `dast-y-humo` se omiten: **no hay proyecto de staging**. Igual en los pases anteriores. Camino: `Analisis/28` |
| PIP-11 | CodeQL activo | Verde | CodeQL en verde en `main` |
| PIP-14 | Rollback automático | Verde | `post-despliegue`: health check + clonar `previa` sobre `live` |
| SEC-02/03 | Secretos de prod en el Environment | Verde | repo: `GCP_WIF_PROVIDER`; `production`: `GCP_SA_DEPLOY_PROD` |
| SEC-10 | Rotaciones vencidas | Pendiente | `INGESTA_CLIENTE01` se expuso a Meta el 15/09 (tres pedidos rechazados): rotarlo en este despliegue, ver «Pendientes» |
| DAT-01 | Reglas probadas con emulador | Verde | `reglas.test.ts` con los bloques de captación genérica y horario, escritos negando |
| DAT-02 | Reglas en el mismo job que hosting | Verde | `FIREBASE_DEPLOY_ONLY` incluye `firestore:rules` |
| Reglas | Cambio revisado por el agente `seguridad` | Verde (con observaciones) | #78: **0 CRITICAL, 0 HIGH**; MEDIUM-1 (SSRF IPv6) y MEDIUM-2 (prohibición 4) corregidos antes de fusionar; LOW-3 (cuota de `comprobarArchivoPlanes`) pendiente, no bloquea. #74, #75, #76 y #77 (revisión aparte, 2026-09-15): **apto para el pase**, 0 CRITICAL/HIGH/MEDIUM, 1 LOW: un envío rechazado queda en error pero nadie recibe aviso (falta un flujo de errores que avise por correo; tarea posterior). La regla de horarios no se puede saltear y no bloquea a comercios con datos viejos (la pantalla reemplaza el campo entero al guardar); el error de `Confirmar envío` no lleva texto, teléfono ni token |
| Local | `security-local.sh` ≤ 24 h | Verde | 2026-09-15 17:05, v2.4, umbral HIGH: **APROBADO**. CRITICAL 0, HIGH 0, MEDIUM 17. Informe local `.security-reports/20260915-170536/resumen.md` (no versionado) |
| Alertas | Dependabot / Code Scanning altas | Verde (con nota) | Dependabot alto/crítico: 0. Code Scanning «high»: 3, todas de Scorecard y sin archivo asociado (Maintained, Vulnerabilities, BranchProtection), las mismas del pase anterior |
| Prod | Producción responde | Pendiente | Lo verifica el health check de `post-despliegue` (`PROD_URL=https://consola.novuchat.site`) |
| Humo | Humo manual de flujos críticos | Pendiente | A cargo de Andres, después del despliegue y de publicar el flujo |

## Riesgos aceptados (excepciones vigentes en `.devsecops.yml`)

| id | herramienta | vence | justificación resumida |
|---|---|---|---|
| CVE-2026-41907 | trivy | 2026-10-31 | `uuid` 9.0.1 transitiva de firebase-admin; solo se llama `uuid.v4()`, no alcanzable |

Ninguna vencida; ninguna vence en los próximos 30 días.

## Plan de rollback

- **Identificador actual de producción:** `v0.3.0` (`198ac59`). Revisiones activas de Cloud Run:
  `ingesta-00013-ram`, `configuracionflujo-00015-deb` (us-east1).
- **Hosting (automático):** si el health check falla, `post-despliegue` clona el canal `previa`
  sobre `live`. A mano: `firebase hosting:clone "<SITIO>:previa" "<SITIO>:live" --project "${GCP_PROJECT_ID}"`.
- **Functions:** `gcloud run services update-traffic ingesta --region us-east1 --to-revisions ingesta-00013-ram=100`
  (y lo mismo con `configuracionflujo-00015-deb` y las demás que cambien), o `git revert` y `v0.4.1`.
- **Reglas de Firestore:** no las revierte el clon de hosting. Se revierten con `git revert` de las
  fusiones y una etiqueta nueva. Endurecen (horario con formato) y amplían (captación para el
  administrador): revertirlas vuelve a la captación solo del propietario.
- **Flujo de captación en n8n:** `publicar-flujo.sh` guarda un respaldo del flujo vivo antes de
  escribir (`Flujos/respaldo-<id>-<fecha>.local.json`).

## Pendientes antes de aprobar

1. Aceptar de forma explícita PIP-09 sin staging, como en los pases anteriores.
2. **Rotación de `INGESTA_CLIENTE01`** (recomendada en este mismo despliegue,
   `docs/produccion/rotar-secreto-ingesta.md` §6): una persona crea la versión nueva **antes** de
   la etiqueta; el despliegue la fija en las Functions; apenas terminen `ingesta` y
   `configuracionFlujo`, la persona pega el valor en la credencial de n8n. Corte de unos minutos
   sin conteo; el cliente final sigue recibiendo respuesta.
3. **Después del despliegue, en este orden:** `cargar-captacion.mjs` para `novuchat` (en seco y
   con `--aplicar`), `publicar-flujo.sh` del flujo de captación (diagnóstico y `--aplicar`), y
   prueba desde un teléfono: Kenji, planes, botón «Hablar con un asesor», aviso a recepción.
