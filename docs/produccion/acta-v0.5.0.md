# Acta de pase a producción — NovuChat (consola) — v0.5.0 — 2026-09-17

Commit: **`742eaf7`** (`origin/main`, merge del PR #90) | Run CI en `main`: «CI/CD Node → Firebase» sobre `742eaf7`, en verde; CodeQL y OpenSSF Scorecard también en verde sobre el mismo commit | Modo: **A**
Preparado por: Claude Code (skill `pase-a-produccion`) | Aprueba: Andres Alberdi, revisor de `production` (**pendiente**)

No se creó ninguna etiqueta, no se desplegó ni se aprobó nada: este documento es de lectura y consulta (`git`, `gh api`, `gcloud ... describe/list`).

## Qué motiva este pase

Producción corre `v0.4.0` (`54ce90f`, 2026-09-15 16:49 -04:00). Un diagnóstico contra la nube del 16/09 encontró que quedaron **868 líneas** de `admin/functions/src/` sin desplegar, incluidos dos archivos nuevos completos: `limiteCatalogo.ts` (371 líneas, incluida la Function `importarCatalogo`, que **nunca se desplegó**) y `planes.ts` (270 líneas). Lo más urgente: el commit `b76bcc8` fija `minInstances: 1` en `ingesta` y `configuracionFlujo` — hoy en `0` — porque el 15/09 una petición real falló con «no available instance» y la primera respuesta tras un rato sin tráfico tardaba ~8 s en vez de ~2,3 s (verificado abajo, §Rollback).

## Versión propuesta y por qué

Los 48 commits desde `v0.4.0` agregan capacidades compatibles (límite de catálogo por plan, `planes.ts` como fuente única de límites, subida de archivo de planes a Storage, alta de la Clínica Platinum como nuevo cliente) y corrigen defectos (latencia/disponibilidad de `ingesta`/`configuracionFlujo`, dos rechazos que se lanzaban dentro de una transacción de Firestore en vez de devolverse, un enlace de contraseña que salía por consola en vez de a un archivo `600`). **No se encontró ningún `BREAKING CHANGE` ni marcador `!`** en los 48 mensajes (`git log v0.4.0..origin/main --format='%B' | grep -i "BREAKING CHANGE"`, sin resultados). Por Conventional Commits: predominan `feat` y `fix`, ninguno mayor → **minor**: `v0.4.0` → **`v0.5.0`** es la versión correcta.

## Cambios incluidos (desde v0.4.0, 48 commits, PRs #79 a #90)

- **feat — Catálogo con límite por plan y Storage para Captación (PR #79, `consolidado/planes-catalogo-storage`):** `planes.ts` (fuente única de límites/precios y copia en `cuenta/estado`), `limiteCatalogo.ts` (Function callable `importarCatalogo`, contador `contadores/catalogo`), 143 líneas nuevas en `admin/firestore.rules` y 257 en `admin/storage.rules` (primer archivo de esta última, sube el PDF/imagen de planes del comercio), consola con catálogo de hasta 500 ítems (búsqueda/filtro/orden) y aviso al 80 %, guía `docs/seguridad/reglas-storage.md` con el orden de despliegue obligatorio.
- **fix — Latencia y disponibilidad de `ingesta`/`configuracionFlujo` (`b76bcc8`, dentro del PR #79):** `minInstances: 1`, motivado por la falla real del 15/09. Es el cambio más urgente de este pase.
- **fix — Robustez de transacciones y seguridad (`f29dc3f`, `53c96f2`, `7d73645`, dentro de PR #79):** un rechazo se devuelve en vez de lanzarse dentro de una transacción de Firestore (`cargar-captacion.mjs`, `asignar-numero.mjs`); el enlace de contraseña del alta va a un archivo `600`, no a la salida de la consola.
- **fix — Revisión de seguridad (`dc3d06b`):** `exigirPropietario` ahora exige también la sesión de Google (cerraba un `MEDIUM` preexistente: una cuenta de contraseña con `nc.p` puesto por error quedaba inerte en Firestore pero activa en las callables); `deploy.sh` despliega Storage solo con `DESPLEGAR_STORAGE=1` y falla con mensaje si falta `python3` en vez de saltear en silencio.
- **feat — Alta de Clínica Platinum, nuevo cliente (PR #82, consolidado con #83/#84/#85/#90):** flujo de reservas, carga de la consola desde JSON, corpus del sitio, botón «Hablar con un asesor» que sobrevive al límite de 1024 caracteres, aviso a recepción condicionado a que Meta acepte el envío, ajuste de tono (tuteo, sin lectura de ficha, `843a510`).
- **chore/docs — Herramientas y estado (PR #80, #81):** marcadores con rotación sin intervención humana, corrección del acta de `v0.4.0`, cierre de la documentación del cobro por bloques.

**Lo que despliega el CI hoy** (`vars.FIREBASE_DEPLOY_ONLY = hosting,firestore:rules,firestore:indexes,functions`, verificado con `gh variable list`): hosting, reglas e índices de Firestore, y **todas** las Functions exportadas en `index.ts` (incluida `importarCatalogo`, que se crearía por primera vez). **`storage` NO está en el valor de la variable**: `admin/storage.rules` (257 líneas nuevas) **no se desplegaría** con este pase, aun cuando cambió. Ver el punto delicado abajo.

## Checklist

| # | Control | Estado | Evidencia |
|---|---|---|---|
| 1 | `main` limpia; candidato = `origin/main` | Cumple | `git rev-parse HEAD` = `git rev-parse origin/main` = `742eaf7` (HEAD desacoplado, sin cambios locales) |
| 2 | Run de CI completo en verde para el commit candidato | Cumple | La corrida de «CI/CD Node → Firebase» sobre `742eaf7`: `preparar`, `calidad-documentacion`, `calidad`, `construir (staging/production)`, `seguridad-estatica/*` (Gitleaks, Semgrep, Trivy fs), `compuerta-pr` — todos `success`. `IaC (Checkov)` y `Snyk` en `skipped` (opcionales, sin secreto/config, no bloquean) |
| 3 | CodeQL y Scorecard activos | Cumple | Las corridas de CodeQL y de OpenSSF Scorecard sobre `742eaf7`, ambas `success` |
| 4 | `desplegar-staging` y `dast-y-humo` | **No aplica** (con motivo) | Ambos jobs quedaron `skipped` en el run del commit candidato. El propio workflow lo documenta: «Sin proyecto de staging configurado, el job se OMITE en vez de fallar (2026-09-12). No existe un proyecto de staging para la consola» (`ci-node-firebase.yml`, comentario sobre `desplegar-staging`; confirmado con `gh variable list`, no existe `GCP_PROJECT_ID_STAGING`). Documentado también en `ESTADO.md:448` y en la memoria de proyecto «Consola sin staging». **No se marca «cumple»**: es una limitación estructural aceptada, no una verificación de DAST/humo real |
| 5 | No hay PRs bloqueantes ni issues `incidente` abiertos | Cumple | `gh pr list --state open`: 15 abiertos, todos de Dependabot o de otras ramas de trabajo (`platinum/*`, `consola/*`), ninguno etiquetado como bloqueante; sin etiqueta `bloqueante` ni `incidente` en el repositorio (`gh label list`) |
| 6 | `security-local.sh` reciente (≤ 24 h) | Cumple (17/09) | Ejecutado el 17/09 en este worktree: **APROBADO**, `CRITICAL=0 HIGH=0 MEDIUM=17 LOW=0`, sin excepciones consumidas. Informe en `.security-reports/` (ignorado por git). Equivalente automatizado: el job `seguridad-estatica` (Semgrep, Trivy fs, Gitleaks) de esa misma corrida, en verde |
| 7 | Excepciones vigentes de `.devsecops.yml` | Cumple, con vencimiento a vigilar | Ver tabla de riesgos abajo. Dos excepciones, ambas vencen 2026-10-31 (< 45 días, fuera de la ventana de 15 días de aviso inmediato pero a vigilar en el próximo pase) |
| 8 | Alertas de severidad alta/crítica (Dependabot) | Cumple | `gh api .../dependabot/alerts?state=open&severity=high` → 0; `...&severity=critical` → 0. `severity` sin filtro: **7 abiertas, las 7 `medium`** (vitest ×2, morgan, @vitest/mocker, csv-parse, stream-json, uuid) — confirma lo advertido por los avisos de `git push` |
| 9 | Reglas de Firestore/Storage: revisión | Cumple, parcial | `git diff v0.4.0..origin/main -- admin/firestore.rules admin/storage.rules`: 397 líneas nuevas (143 + 257). Revisión registrada en el commit `dc3d06b` (`seguridad: observaciones de la revisión de planes, catálogo y Storage`), con un `MEDIUM` preexistente cerrado y prueba nueva (`estado-cuenta.test.ts`). **No hay un informe formal del agente `seguridad` como archivo** en este worktree; la evidencia es el propio commit. `admin/firestore.rules` y `admin/storage.rules` exigen revisión de `@segurolotengopy` por CODEOWNERS |
| 10 | **Orden de despliegue Functions → contadores → consola/reglas** | **No cumple tal como está configurado hoy** | Ver «Punto delicado» abajo. `vars.FIREBASE_DEPLOY_ONLY` actual despliega `firestore:rules` y `functions` **en la misma corrida** (`hosting,firestore:rules,firestore:indexes,functions`), sin separar el paso manual de `admin/scripts/contar-catalogo.mjs --aplicar` que exige `docs/seguridad/reglas-storage.md` §3.5 |
| 11 | Repositorio público (modo A) | Cumple | `gh repo view --json visibility,isPrivate` → `PUBLIC`, `isPrivate: false` |
| 12 | Secret scanning y Dependabot security updates activos | Cumple | `gh api repos/.../{repo} --jq .security_and_analysis`: `secret_scanning: enabled`, `secret_scanning_push_protection: enabled`, `dependabot_security_updates: enabled` |
| 13 | Ruleset de `main` con check(s) obligatorio(s) | Cumple, con observación | Ruleset `main-protegida` (activo, `target: branch`, rama por defecto): exige `required_status_checks` = **`compuerta-pr` y `calidad`** (dos checks, no uno solo como describe el modelo estándar de «único check `compuerta-pr`»); además `pull_request` obligatorio, sin borrado ni non-fast-forward. No bloquea el pase — es más estricto, no más laxo — pero se anota como desvío del modelo de un único check |
| 14 | Ruleset de tags `v*` | **No cumple** | `gh api repos/.../rulesets` solo devuelve `main-protegida` (`target: branch`). No existe un ruleset con `target: tag` para `v*`. Lo que sí existe es la política de rama de despliegue del *Environment* `production` (`deployment-branch-policies`: patrón `v*`, tipo `tag`), que decide qué tag puede *disparar* el despliegue, pero no impide borrar o mover un tag `v*` ya creado |
| 15 | Environment `production` con revisor humano | Cumple | `gh api .../environments/production --jq .protection_rules`: `required_reviewers` = `segurolotengopy` (tipo `User`), `prevent_self_review: false` |
| 16 | Secretos de despliegue por nombre | Cumple | Repo: `GCP_WIF_PROVIDER`. Environment `production`: `GCP_SA_DEPLOY_PROD` (`gh api .../environments/production/secrets`, no accesible a nivel de repo — es secreto de Environment, no falta) |
| 17 | Variables de despliegue | Cumple, con una variable ausente | `gh variable list`: `MODO=A`, `PROD_URL=https://consola.novuchat.site`, `SITIO_PUBLICO` idéntico, `GCP_PROJECT_ID_PROD=novuchat-demo`, `FIREBASE_DEPLOY_ONLY` (ver §10), `TAG_FIRMADO_REQUERIDO=false`, `APROBADORES_PROD=segurolotengopy`, `HEALTH_PATH=/`, `CODEQL_LENGUAJES`, y las `VITE_*` de Firebase Web (API key pública, no secreta). **Falta `VITE_FIREBASE_STORAGE_BUCKET`**: no está en la lista |
| 18 | Firma del tag | Declarado, no verificable por el agente | `TAG_FIRMADO_REQUERIDO=false` (no obligatoria), pero `git config --get user.signingkey` devuelve una clave SSH configurada (`gpg.format=ssh`) en esta máquina: la persona puede firmar con `-s` si lo prefiere |

## Punto delicado: reglas de Firestore/Storage y el orden de despliegue

`docs/seguridad/reglas-storage.md` §3.5 fija un orden obligatorio para esta misma tanda de cambios (límite de productos por plan):

1. Functions (`FIREBASE_DEPLOY_ONLY=functions`) — trae `importarCatalogo` y el resto de lo nuevo.
2. **A mano, con credenciales aisladas:** `admin/scripts/contar-catalogo.mjs` (en seco y con `--aplicar`) para crear o corregir el contador de cada comercio; después `asignar-plan.mjs` por tenant.
3. Recién entonces, consola (`hosting`) y reglas (`firestore:rules,storage`) **en la misma pasada**.

**Qué pasa si se despliega todo junto**, verificado en `docs/seguridad/reglas-storage.md` (que cita `deploy/index.js:30-42` de firebase-tools: el orden interno de un mismo `firebase deploy` es `storage → firestore → functions → hosting`): las reglas nuevas de Firestore **niegan crear o borrar un producto si el comercio no tiene el contador `contadores/catalogo`**. Si `firestore:rules` se publica en la misma corrida que `functions` —que es exactamente lo que hace hoy `vars.FIREBASE_DEPLOY_ONLY = hosting,firestore:rules,firestore:indexes,functions`— las reglas quedan activas de inmediato, pero el contador de cada comercio existente **no se crea solo**: lo crea el script manual del paso 2, que no forma parte del pipeline ni se dispara con el push del tag. Entre el momento en que se publican las reglas y el momento en que una persona corre `contar-catalogo.mjs --aplicar`, **cualquier comercio sin contador queda sin poder dar de alta ni borrar un producto de su catálogo** (la regla lo deniega, no falla con error genérico, pero el efecto para el comercio es el mismo: la consola rechaza la operación).

`storage` no está en la variable actual, así que `admin/storage.rules` no se desplegaría con este pase con la configuración de hoy — evita un segundo riesgo (el rol IAM `roles/firebaserules.firestoreServiceAgent` y el bucket por defecto, §3.1–3.2 de la guía, no están confirmados en este diagnóstico) pero dejaría la función de Captación (subida del PDF/imagen de planes) sin su regla en producción hasta un pase posterior.

**Separación posible con `FIREBASE_DEPLOY_ONLY`:** el job de producción ya lee `${{ vars.FIREBASE_DEPLOY_ONLY || '...' }}`, así que cambiar el *valor de la variable* alcanza para separar los pasos sin tocar el workflow: desplegar primero con la variable en `functions`, correr los scripts, y recién después devolverla a `hosting,firestore:rules,firestore:indexes,functions` (o sumar `storage` cuando 3.1/3.2 estén confirmados). Esto es una decisión y una secuencia de operación, no algo que este acta ejecute.

## Riesgos y excepciones vigentes (`.devsecops.yml`)

| id | herramienta | vence | justificación resumida |
|---|---|---|---|
| `CVE-2026-41907` | trivy | 2026-10-31 | `uuid` 9.0.1 llega solo como transitiva de `firebase-admin`; la única llamada en todo el árbol es `uuid.v4()` en `teeny-request`, no alcanzable por el CVE (v3/v5/v6 con búfer externo) |
| `ce0b484c...:admin/scripts/emuladores.sh:generic-api-key:111` | gitleaks | 2026-10-31 | Falso positivo: `VITE_APPCHECK_SITE_KEY` vacío hace que la regla `generic-api-key` cruce el salto de línea y capture `VITE_USAR_EMULADORES=true` como si fuera el secreto |

Ninguna vencida. Ninguna vence en los próximos 15 días; ambas vencen en 44 días (2026-10-31) — a poner en agenda para el próximo pase, no bloqueante para este.

| Riesgo | Severidad | Vence / plazo | Propuesta |
|---|---|---|---|
| `FIREBASE_DEPLOY_ONLY` despliega `firestore:rules` y `functions` juntos; contador de catálogo se crea a mano y después | Alto (bloqueo funcional para comercios existentes, no de seguridad ni de datos) | Antes de crear la etiqueta | Separar la variable en dos pasadas (ver arriba) o aceptar una ventana corta de bloqueo si son pocos comercios y se corre el script de inmediato |
| Sin ruleset de protección para tags `v*` | Medio (integridad del historial de versiones, no bloquea el despliegue) | Sin vencimiento — falta crearlo | Crear un ruleset `target: tag`, patrón `v*`, con `deletion` y `non_fast_forward` como mínimo |
| Ruleset de `main` exige `compuerta-pr` y `calidad` (dos checks, no uno) | Bajo (más estricto, no más laxo) | Sin vencimiento | Ninguna acción obligatoria; documentar el desvío del modelo de «único check» si se quiere alinear estrictamente al estándar |
| 7 alertas Dependabot `medium` abiertas (vitest, morgan, @vitest/mocker, csv-parse, stream-json, uuid) | Bajo–medio, sin evaluar alcanzabilidad una por una en este acta | Sin vencimiento propio | Revisar cada una en el próximo ciclo de dependencias; ninguna es `high`/`critical` |
| Sin informe `security-local.sh` con fecha de hoy en este worktree | Medio (trazabilidad, no evidencia de vulnerabilidad) | — | Ejecutar `./security-local.sh` antes de crear la etiqueta y adjuntar la ruta del informe a este acta |
| `admin/storage.rules` (257 líneas nuevas) no se desplegaría con `FIREBASE_DEPLOY_ONLY` actual | Bajo (la función de Captación queda incompleta, no hay riesgo de exposición) | — | Confirmar bucket (§3.1) y rol IAM (§3.2) de `docs/seguridad/reglas-storage.md` antes de sumar `storage` a la variable |
| Falta `VITE_FIREBASE_STORAGE_BUCKET` | Bajo (la consola compila igual; «Subir» queda deshabilitado con su explicación) | — | Crearla cuando se confirme el nombre del bucket en la consola de Firebase (§3.1) |

## Requisitos del modo A — resumen

| Requisito (modo A) | Estado | Evidencia |
|---|---|---|
| Repositorio público | Cumple | `gh repo view` |
| CodeQL y secret scanning activos | Cumple | Run CodeQL verde; `security_and_analysis.secret_scanning: enabled` |
| Environment `production` con revisor humano | Cumple | `protection_rules.required_reviewers` |
| Ruleset de `main` con el check `compuerta-pr` | Cumple, con el check adicional `calidad` (ver riesgos) | `gh api .../rulesets/21842246` |

**Conclusión del modo:** el repositorio cumple los cuatro requisitos técnicos del modo A. La deuda de gobernanza (ruleset de tags ausente) no es un requisito listado explícitamente para el modo A en la verificación técnica de la skill, pero sí es una práctica de higiene de releases que falta.

## Plan de rollback

- **Identificador actual de producción:** `v0.4.0` (`54ce90f`). Revisiones activas de Cloud Run verificadas hoy contra el proyecto `novuchat-demo`, región `us-east1`:
  - `ingesta`: revisión activa **`ingesta-00014-yuj`**; anterior lista, en orden: `ingesta-00013-ram`.
  - `configuracionflujo`: revisión activa **`configuracionflujo-00016-tuj`**; anterior: `configuracionflujo-00015-deb`.
  (`gcloud run services describe <svc> --project novuchat-demo --region us-east1 --format='value(status.latestReadyRevisionName)'`, y `gcloud run revisions list` para la lista completa — coincide con lo declarado.)
- **Comando de vuelta atrás para Cloud Run (preparado, no ejecutado):**
  ```
  gcloud run services update-traffic ingesta --project novuchat-demo --region us-east1 --to-revisions ingesta-00013-ram=100
  gcloud run services update-traffic configuracionflujo --project novuchat-demo --region us-east1 --to-revisions configuracionflujo-00015-deb=100
  ```
  Nota: esto vuelve el *tráfico* a la revisión anterior; no revierte `minInstances` a `0` si la revisión anterior ya lo tenía en `1` (no es el caso aquí: la anterior es previa a `b76bcc8`, así que sí vuelve `minInstances` a `0` como efecto colateral, y **eso reintroduce el problema de latencia/disponibilidad que motiva este pase**).
- **Hosting:** el pipeline clona `live` al canal `previa` antes de cada despliegue (paso «Conservar copia de la versión actual», visto en `desplegar-staging` y homólogo en `desplegar-produccion`). Rollback: `firebase hosting:clone "<SITIO>:previa" "<SITIO>:live" --project novuchat-demo` (no existe un subcomando de rollback nativo en firebase-tools).
- **Reglas de Firestore/Storage:** no las revierte el clon de hosting. `docs/seguridad/reglas-storage.md` §3 indica volverlas atrás publicando el ruleset anterior desde la consola de Firebase (Reglas → historial); con las reglas nuevas revertidas, los contadores de catálogo quedan como datos inertes, sin efecto.
- **Automático:** el job `post-despliegue` corre un health check con reintentos contra `PROD_URL`/`HEALTH_PATH` y, si falla, dispara el mismo mecanismo de clonado de `previa` sobre `live` (Environment `production-rollback`, sin revisor, a propósito — un rollback no puede esperar aprobación humana).

## Pendientes antes de aprobar (en orden de ejecución)

1. **Decidir la secuencia de despliegue de Functions y reglas** (el punto delicado de arriba): o bien (a) desplegar primero con `FIREBASE_DEPLOY_ONLY=functions`, correr `contar-catalogo.mjs` (seco y `--aplicar`) y `asignar-plan.mjs` por tenant, y recién después devolver la variable a `hosting,firestore:rules,firestore:indexes,functions`; o bien (b) aceptar explícitamente una ventana corta de bloqueo de catálogo para los comercios existentes. Es una decisión del propietario, no algo que este agente resuelva.
2. **Ejecutar `./security-local.sh`** y adjuntar la ruta y el resultado a este acta antes de crear la etiqueta (no hay uno con fecha de hoy en este worktree).
3. **Confirmar si se quiere sumar `storage` a `FIREBASE_DEPLOY_ONLY`** en este pase o dejarlo para el siguiente: requiere antes el bucket por defecto (§3.1) y el rol IAM `roles/firebaserules.firestoreServiceAgent` (§3.2) de `docs/seguridad/reglas-storage.md`, ninguno de los dos confirmado en este diagnóstico.
4. **Crear la variable `VITE_FIREBASE_STORAGE_BUCKET`** cuando se confirme el nombre del bucket (si se decide avanzar con Storage en este pase o el siguiente).
5. **Crear un ruleset de protección para tags `v*`** (`target: tag`, al menos `deletion` y `non_fast_forward`) — no bloquea este pase, pero es una brecha de gobernanza a cerrar.
6. **Revisar las 7 alertas Dependabot `medium`** en el próximo ciclo (no bloquean este pase; ninguna es alta ni crítica).
7. **Crear la etiqueta y desplegar** (comando abajo), aprobar el Environment `production` cuando GitHub lo pida, y verificar el health check de `post-despliegue`.
8. **Después del despliegue, y solo si no se optó por la secuencia separada del punto 1:** correr `contar-catalogo.mjs` sin más demora, para cerrar la ventana de comercios sin contador.
9. **Probar contra un teléfono real** el flujo de la Clínica Platinum y el tiempo de primera respuesta tras un rato sin tráfico (debería bajar de ~8 s a ~4-5 s, según lo medido en `b76bcc8`).

## El comando de la etiqueta (preparado, sin ejecutar)

`git tag` está **denegado para este agente por la configuración de permisos del repositorio**, y la skill `pase-a-produccion` reserva explícitamente este paso a una persona (§6 del skill: «Claude Code no ejecuta ninguno de estos comandos: los entrega»). El comando exacto, para ejecutar una vez resueltos los pendientes 1 a 6:

```
git checkout main && git pull --ff-only
git tag -s v0.5.0 -m "Release v0.5.0 — NovuChat"
git push origin v0.5.0
```

El push del tag dispara `desplegar-produccion` de `ci-node-firebase.yml` (modo A): quedará pendiente aprobar el Environment `production` en ese run (revisor configurado: `segurolotengopy`). `TAG_FIRMADO_REQUERIDO=false`, pero hay una clave SSH de firma configurada en esta máquina (`gpg.format=ssh`), por lo que `-s` puede usarse sin pasos adicionales.

---

## Adenda — 2026-09-17: el primer intento falló, y por qué

**La etiqueta `v0.5.0` se creó y el despliegue se aprobó, pero `desplegar-produccion` falló. No se publicó nada: producción sigue en `v0.4.0`, con las revisiones `ingesta-00014-yuj` y `configuracionflujo-00016-tuj` intactas.**

El error:

```
Error: Pass the --force option to deploy functions that increase the minimum bill
```

`firebase-tools` se niega a desplegar Functions que suben el piso de la factura, que es exactamente lo que hace `minInstances: 1` en `ingesta` y `configuracionFlujo`. La protección cortó antes de publicar, así que no hubo estado intermedio ni hace falta rollback.

### Por qué no se resolvió poniendo `--force` fijo

`--force` acepta el costo **y además** borra sin preguntar las Functions desplegadas que ya no estén en el código. Dejarlo puesto haría que cualquier despliegue futuro pudiera borrar producción en silencio.

Se comprobó antes de decidir, comparando las Functions vivas contra las que el código exporta:

| Comprobación | Resultado |
|---|---|
| Funciones desplegadas | 31 |
| Funciones que el código define o reexporta | 32 |
| Desplegadas que **no** están en el código, y que `--force` borraría | **ninguna** |
| Nuevas, que se crearían | `importarCatalogo` |

Con eso, en este despliegue `--force` solo confirma el aumento del piso de la factura.

### El arreglo

`ci-node-firebase.yml` pasa `--force` solo cuando la variable `FIREBASE_DEPLOY_FORCE` está definida, y deja constancia con un aviso en la corrida. Vacía por defecto: la protección queda puesta salvo que se la levante a propósito, y se apaga después del despliegue.

### Consecuencia para la etiqueta

El workflow se lee del ref de la etiqueta, así que `v0.5.0` seguiría usando el archivo viejo. Hay que fusionar el arreglo y **crear `v0.5.1`**; `v0.5.0` queda como etiqueta sin despliegue, con este motivo registrado.

### Orden actualizado

1. Fusionar el arreglo del workflow.
2. Encender `FIREBASE_DEPLOY_FORCE`.
3. Crear y empujar `v0.5.1` (persona) y aprobar el entorno (persona).
4. Verificar `minInstances: 1` y volver a medir la primera respuesta.
5. **Apagar `FIREBASE_DEPLOY_FORCE`.**
6. Contadores del catálogo, y recién entonces restaurar `FIREBASE_DEPLOY_ONLY` a `hosting,firestore:rules,firestore:indexes,functions` para desplegar consola y reglas.

### Segundo intento (`v0.5.1`): falló por un descuido en el arreglo

La corrida volvió a cortar con el mismo mensaje, pero **en la simulación, no en la publicación**. El arreglo anterior había puesto `--force` solo en el comando que publica, y el paso previo `--dry-run` corre el `prepare` completo: choca con la misma protección y corta antes de llegar a publicar.

Dicho de otro modo: si la simulación no acepta lo que el despliegue va a aceptar, no está simulando el despliegue. La decisión de `--force` pasó a tomarse antes de simular, y el parámetro va en los dos comandos.

Producción siguió sin tocarse, igual que en el primer intento. `v0.5.1` queda también como etiqueta sin despliegue; el siguiente intento es `v0.5.2`.
