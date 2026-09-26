# Staging de la consola: proyecto, pipeline y la lista de escrituras

**Versión 1 · 25-sep-2026.** Frente S de `Analisis/41` (§7 fila S; §6.2 «El
estándar DevSecOps, antes o después»): el staging se crea en paralelo con F1 y
F2 y **tiene que existir antes del ensayo de F3**. Lo que ya estaba dicho en
`Analisis/28-dast-y-prueba-de-humo.md` §4 se convierte acá en un diseño
cerrado y en una lista de pasos, cada uno con su comando en seco.

No contiene secretos ni identificadores: el proyecto de staging es
`${GCP_PROJECT_ID_STAGING}` (su valor real va a `CONFIGURACION.local.md`, una
fila más en la tabla de marcadores) y el de producción, `${GCP_PROJECT_ID}`.

**Costo, en las tres unidades de este repositorio:** mensajes de WhatsApp por
conversación, **0** (staging no se conecta a Meta ni a n8n); dinero, **≈ 2 USD
al mes** (25 secretos en Secret Manager a 0,06 USD; Artifact Registry y Cloud
Run con tráfico de prueba están dentro de la franquicia; Cloud Scheduler, 2 de
los 3 trabajos gratis); minutos de GitHub Actions, **≈ 10 más por push a
`main`** que toque `admin/` (construir-staging 1,5 + desplegar-staging 4 +
humo-staging 1 + DAST 3), gratis en un repositorio público.

---

## 0. Las decisiones

| Decisión | Adoptada | Por qué |
|---|---|---|
| Proyecto | **Uno nuevo, separado**, en la misma cuenta de Google que producción | `Analisis/28` §4.1. Compartir cuota, reglas y superficie de IAM con lo que está en vivo es exactamente lo que un staging existe para evitar |
| Nombre | El ID lo elige Andres; se sugiere la forma `<prefijo>-staging`. **No** puede empezar con `demo-`: ese prefijo es el que Firebase reserva para proyectos falsos de emulador y `sembrar.mjs` lo usa como salvaguarda | Que el nombre diga lo que es; que ningún script lo confunda con un emulador |
| Región | **`us-east1`**, la de producción | `admin/functions/src/region.ts`: los disparadores de Firestore no se despliegan en otra región que la base |
| Plan | **Blaze** desde el día uno, con presupuesto de 5 USD y alerta al 50 % | Sin Blaze no hay Functions, y el humo de `Analisis/28` es sobre las Functions |
| Hosting | **Un solo sitio**, el que nace con el proyecto (`<id>.web.app`) | Producción también tiene uno solo: `admin/firebase.json` no declara `site` ni `target` de Hosting, y el catálogo web `/c/**` vive en el mismo sitio |
| Federación | **Pool y proveedor propios en el proyecto de staging** (§4) | No se toca nada de producción para levantar staging |
| Variables `VITE_*` | **Por Environment `staging`**, con el mismo nombre que las del repositorio | §3. Un paquete de staging con las variables de producción es la falla que `Analisis/28` §1 describe |
| Secreto de ingesta | **Propio: los 25 secretos que el código declara, con valores aleatorios nuevos** | §5. Nunca los de producción |
| Datos | **Solo datos de prueba** creados por scripts del repositorio; **ningún cliente real, ningún número de WhatsApp real** | §6, DAT-07 |
| Primer despliegue de Functions | **Con la cuenta dueña del proyecto, desde la máquina de Andres, con `--dry-run` antes**; los siguientes, el pipeline | §8 paso 11. Es como nació producción, y evita darle a la cuenta de despliegue permisos de IAM que después no necesita |
| App Check | **Apagado en staging** (`VITE_APPCHECK_SITE_KEY` vacía en el Environment) | La clave de producción está atada a su dominio; una clave nueva es un paso más de consola que no aporta al humo |

---

## 1. Qué tiene el proyecto

Firestore en `us-east1` con las mismas reglas e índices de `admin/`; las
mismas Cloud Functions (gen 2, `nodejs22`, con `sa-functions`); Hosting con la
consola y el catálogo web; Storage con `storage.rules`; Auth con Google y
correo/contraseña; App Check apagado. Es decir, **lo mismo que despliega el
job de producción**, con el mismo `FIREBASE_DEPLOY_ONLY`.

Lo que **no** tiene: dominio propio (se usa `<id>.web.app`), número de
WhatsApp, flujo de n8n apuntándole, cobrador del prepago (los dos secretos
`COBRADOR_*` existen con valor aleatorio para que el despliegue pase; nada los
usa), clave real de Gemini (ídem: las Functions que llaman al modelo fallan en
staging hasta que Andres cargue una clave propia, y eso está dicho en el
script).

---

## 2. Lo que cambia en el repositorio (este PR)

| Archivo | Cambio | Por qué |
|---|---|---|
| `admin/functions/src/opcionesGlobales.ts` | `serviceAccount: \`sa-functions@${GCLOUD_PROJECT}.iam.gserviceaccount.com\``, con fallo explícito si `GCLOUD_PROJECT` está vacía, en vez del correo con el proyecto de producción escrito | **Sin esto no hay staging:** las Functions pedían correr con una cuenta de OTRO proyecto. firebase-tools fija `GCLOUD_PROJECT` al proyecto destino cuando carga el código para descubrir las Functions (`lib/functions/env.js:278`, 15.29.0) y Cloud Run la fija en ejecución. **No** se usa la abreviatura `sa-functions@` aunque firebase-tools la acepte: el manifiesto la lleva literal y `ensure.secretsAccessDelta` la compara con el correo completo que devuelve GCF, así que el delta da los 25 secretos en cada despliegue y `setIamPolicy` se llama con un miembro inválido antes de crear ninguna Function; el desplegador no tiene ese permiso a propósito, y **el `--dry-run` no lo detecta** (solo corre `checkSecretAccess`). Lo prueba `admin/pruebas/manifiesto-secretos.test.ts` contra el `ensure.js` instalado; la forma del correo, `region-y-cuenta.test.ts` |
| `.github/workflows/ci-node-firebase.yml` | `construir` deja la matriz y construye solo producción; nuevo `construir-staging` con `environment: staging` y una compuerta que verifica cada `VITE_*` contra el proyecto de staging; `desplegar-staging` es el espejo del de producción (artefacto de Functions, `npm ci`, `functions/.env`, bucket como destino, simulación `--dry-run`, `--force` solo por variable) y verifica las variables del Environment antes de tocar nada; nuevo `humo-staging`; `desplegar-dev` y `previsualizar` apuntan al artefacto que corresponde | §3 |
| `scripts/humo-staging.sh` | El humo funcional de `Analisis/28`, sin credenciales | §7 |
| `scripts/preparar-staging.sh` | Las escrituras de §8, en seco por defecto, fase por fase | Andres autoriza; Claude opera |
| `admin/.firebaserc.ejemplo` | Alias `staging` y `prod`; **`default` es staging** | `admin/.firebaserc` está ignorado por git (lleva IDs). Que un `firebase deploy` sin `--project` caiga en staging y no en producción |
| `.devsecops.yml` | Ambiente `staging` con marcadores | El manifiesto describe los dos ambientes; el pipeline sigue leyendo las variables |
| `.github/DESPLIEGUE-FIREBASE.md` | La viñeta «No hay proyecto de staging» remite a este documento | |

`deploy.sh` y `_reusable-dast.yml` **no se tocan**: son del estándar.

---

## 3. Variables por Environment, y por qué producción se queda donde está

GitHub resuelve `vars.NOMBRE` con esta precedencia: Environment del job →
repositorio. Las variables del repositorio son hoy las de **producción**
(`VITE_FIREBASE_*`, `SITIO_PUBLICO`, `FIREBASE_DEPLOY_ONLY`,
`VITE_APPCHECK_SITE_KEY`). El Environment `staging` recibe **las mismas, con el
mismo nombre y valores de staging**, y los tres jobs que lo declaran
(`construir-staging`, `desplegar-staging`, `humo-staging`) las leen sin
sufijos ni ramas de matriz.

**El riesgo de este esquema, y cómo se cierra.** Una variable que falte en el
Environment cae **en silencio** al valor del repositorio, que es el de
producción. Tres compuertas, en orden:

1. `construir-staging`, antes de compilar y sin credenciales, mira la **forma**:
   `VITE_FIREBASE_PROJECT_ID == GCP_PROJECT_ID_STAGING`; `AUTH_DOMAIN` y
   `STORAGE_BUCKET` del proyecto de staging; `VITE_FIREBASE_APP_ID` con la forma
   `1:<GCP_PROJECT_NUMBER_STAGING>:web:…` (el número del proyecto va en el
   Environment, lo carga `preparar-staging.sh app`); `VITE_FIREBASE_API_KEY` no
   vacía. Una apiKey no dice de quién es, y por eso hay una segunda compuerta.
2. `desplegar-staging`, **ya autenticado en el proyecto de staging**, pide la
   configuración de la app web registrada (`firebase apps:sdkconfig WEB
   <appId> --json`, permiso `firebase.clients.get` de `roles/firebase.viewer`) y
   exige que su `apiKey` y su `appId` estén en el JavaScript del artefacto
   antes de `firebase deploy`. También verifica `SITIO_PUBLICO`, `STAGING_URL` y
   el bucket. Si algo falta, el job falla con el nombre de la variable y no se
   publica nada.
3. `humo-staging`, por fuera y **sin Environment** —así `vars.VITE_FIREBASE_APP_ID`
   es la del repositorio, la de producción—, lee el JavaScript publicado y exige
   el ID y el appId de staging (que recibe como salidas de `desplegar-staging`)
   y la **ausencia** del ID y del appId de producción.

Los identificadores no se imprimen en el registro de Actions (repositorio
público): los jobs los enmascaran con `::add-mask::` y los mensajes dicen «el
proyecto de staging».

**Por qué las de producción no se mueven al Environment `production`.** Ese
Environment tiene revisor obligatorio, y GitHub detiene **cualquier** job que
lo declare, no solo los de despliegue: `construir` correría en cada PR y
quedaría esperando aprobación humana en cada uno. Las alternativas (un
Environment `production-build` sin protección solo para construir, o construir
dentro del job de despliegue) cuestan más de lo que cierran, porque la
propiedad que importa —**staging nunca recibe valores de producción**— ya
queda garantizada por las compuertas de arriba. Queda anotado en el encabezado
del workflow.

**Dos variables tienen que ser del repositorio**, no del Environment:
`GCP_PROJECT_ID_STAGING` (el `if:` de los jobs se evalúa antes de que exista
un Environment) y `STAGING_URL` (el `with:` de un workflow reutilizable, como
`dast-y-humo`, se resuelve a nivel de repositorio). Ninguna de las dos
identifica producción.

**Secretos:** `GCP_WIF_PROVIDER` y `GCP_SA_DEPLOY_STAGING` van al Environment
`staging`. El primero existe también a nivel de repositorio (el de producción);
el del Environment tiene precedencia, así que `desplegar-staging` canjea contra
el pool de staging y ningún otro job puede usarlo.

**El Environment `staging` ya existe** en GitHub, con política de ramas «solo
`main`» y sin revisores. Por eso `construir-staging` corre solo en push a
`main`: un job de PR que declare ese Environment falla antes de arrancar. En un
PR alcanza con `construir` (producción), que valida la compilación.

---

## 4. Identidad federada: propia o reutilizada

| Opción | Qué es | Riesgo |
|---|---|---|
| **A · Pool y proveedor propios en el proyecto de staging** (adoptada) | `github`/`novuchat` en `${GCP_PROJECT_ID_STAGING}`, con la condición por identificadores (`repository_id`, `repository_owner_id`) y **un solo sujeto**: `…:environment:staging`. `sa-deploy-staging` confía en ese sujeto y en ninguno más | Ninguno sobre producción: no se edita su pool ni su condición. El costo es un pool más que mantener, que es exactamente un proveedor |
| B · Reutilizar el pool de producción con la condición ampliada | Agregar `…:environment:staging` a la condición del proveedor de producción y hacer que `sa-deploy-staging` (en el proyecto de staging) confíe en un `principal://` del pool de producción | La confianza de staging queda anclada a un recurso de producción: editar esa condición es una escritura de IAM en producción, y un error ahí (un `||` de más) abre producción. Además, el proveedor de producción pasa a ser un punto de fallo de dos ambientes |

**La condición compara el `sub` exacto** (`…:environment:staging`), no un
prefijo ni un `attribute.environment` mapeado: es la forma más estrecha que
GitHub permite y la misma que usa producción; si algún día hace falta otro
Environment contra este proyecto, se agrega un segundo sujeto a la lista,
nunca se afloja a `startsWith`.

Con A, la cuenta de despliegue de staging tiene los mismos roles acotados que
la de producción (`.github/DESPLIEGUE-FIREBASE.md`, «Estado real»): Hosting,
reglas, índices, `firebasestorage.viewer`, Functions gen 2 (Run, Build,
Artifact Registry, Eventarc), **Cloud Scheduler** (dos `onSchedule`),
`iam.serviceAccountUser` solo sobre `sa-functions`, App Engine y cómputo, y el
rol a medida `desplegadorSecretos` con condición por prefijo (`INGESTA_`,
`GEMINI_API_KEY`, `COBRADOR_`). `sa-functions` tiene lo de la fase A de
producción y `secretAccessor` secreto por secreto. La cuenta de cómputo queda
como en la fase C: solo `cloudbuild.builds.builder`.

---

## 5. Secretos de las Functions

El código declara con `defineSecret` **25 secretos** (`INGESTA_DEMOA`,
`INGESTA_DEMOB`, `INGESTA_CLIENTE01`…`20`, `GEMINI_API_KEY`, `COBRADOR_TOKEN`,
`COBRADOR_AVISO_SECRETO`; la lista la lee el script del código, nunca de una
búsqueda a mano). `firebase deploy --non-interactive` falla si falta uno, así
que existen todos, **con valores aleatorios de 64 caracteres hex generados en
el momento y jamás mostrados** (`openssl rand -hex 32 | gcloud secrets create
… --data-file=-`). Ninguno es el de producción; ninguno viaja por chat.

- Las claves de ingesta de staging no las conoce ningún flujo de n8n, y eso es
  correcto: staging no recibe mensajes. Si algún día un flujo de ensayo apunta
  a staging, se carga su credencial con `scripts/rotar-ingesta.sh n8n
  --proyecto ${GCP_PROJECT_ID_STAGING}`, que ya sabe hacerlo sin mostrar el valor.
- `GEMINI_API_KEY`: valor aleatorio hasta que Andres cargue una clave propia
  de staging (es un valor que solo él tiene: `gcloud secrets versions add`).

---

## 6. Datos: qué se siembra y qué no

| Se siembra | Con | Por qué |
|---|---|---|
| `/plataforma/cobroSimulado` | `admin/scripts/cargar-plataforma.mjs --proyecto <staging> --aplicar` | Los rótulos del cobro simulado (prohibición 3); sin ellos la vertical de venta no arranca |
| Dos comercios de prueba, uno por vertical | `admin/scripts/alta-comercio.mjs --proyecto <staging> --tenant prueba-agenda --flujos agendamiento …` y otro con `venta`, con administradores `@ejemplo.com` | Es el alta real, por el camino real |
| Usuarios de cada rol | `admin/scripts/usuarios-prueba.mjs --proyecto <staging> --aplicar` | Solo acepta correos `@ejemplo.com`/`@example.com`; crea admin y operador por vertical |
| Plan y límites | `admin/scripts/asignar-plan.mjs --proyecto <staging> --tenant … --plan … --aplicar` | Las reglas leen la copia de límites |

| NO se siembra | Por qué |
|---|---|
| `sembrar-demos.mjs` | Lee `.env` y `.env.demo-b`: los identificadores **reales** de los números de WhatsApp de los demos. Staging no tiene que saber de ningún número real (`Analisis/28` §4.7) |
| `sembrar.mjs` | Se niega fuera de emuladores y de proyectos `demo-*`, y está bien que así sea |
| Cualquier exportación de Firestore de producción | DAT-07. Un staging con datos de clientes es un segundo lugar donde perderlos |
| Conversaciones, métricas, pagos | No hay fuente cierta; se dejan vacíos, como en producción el 9/09 |

Los scripts corren con las credenciales aisladas (`CLOUDSDK_CONFIG` de
`gcloud-novuchat-prod`; la misma cuenta es dueña de ambos proyectos) y
**siempre primero en seco**.

---

## 7. El humo: qué prueba y qué no

`scripts/humo-staging.sh` corre en el job `humo-staging` después de
`desplegar-staging`, y también a mano (lee las variables con `gh variable
get`). Sin credenciales: todo lo que mira lo ve cualquiera.

| # | Qué | Cómo | Por qué ese resultado |
|---|---|---|---|
| 1 | La consola responde y con sus cabeceras | `GET /` → 200 con HSTS, CSP, `nosniff`, `X-Frame-Options`; `/index.html` con `no-cache` | Lo declara `firebase.json`; es lo que el reusable ya mira, repetido acá para que el informe sea uno |
| 2 | Las Functions están detrás de Hosting y son las de este código | `GET /api/ingesta` → 405 y `POST` sin firma → 401; ídem `/api/configuracion`; `/api/qr/<x>` → 404; `/api/catalogo/enlace` → 401; `/api/catalogo/<x>` → 404 | Son los códigos que `ingesta.ts`, `cobro.ts` y `catalogoWeb.ts` devuelven a un anónimo. Si una Function no estuviera desplegada, Hosting daría 404 a todo: por eso el 405 vale como «está viva» |
| 3 | Las reglas desplegadas niegan por defecto | API REST de Firestore sin credenciales en `/tenants`, `/plataforma`, `/rutasWhatsApp` → 403; un objeto del bucket → 403 | 404 sería «no existe la base»; 200, reglas abiertas |
| 4 | El paquete publicado es el de staging | El JavaScript de la consola contiene el ID de staging y no el de producción | Cierra por fuera la compuerta de §3 |

Lo que **no** prueba, y dónde vive: la CSP contra el ingreso real con Google y
las pestañas por rol (`Analisis/28` §2.A, Playwright contra emuladores, fuera
de este frente); la ingesta con firma válida (`scripts/rotar-ingesta.sh
probar`, que necesita un secreto que este humo no debe conocer); el rollback
(OPS-06: `firebase hosting:clone <id>:previa <id>:live --project <id>`, que
ahora tiene dónde ensayarse).

`dast-y-humo` (ZAP baseline) corre con `.github/zap-rules.tsv` tal como está:
el primer informe real dirá qué avisos de una SPA con Firebase pasan a WARN
con nota y fecha.

---

## 8. Las escrituras en la nube y en GitHub, en orden

Cada fila es una escritura que **espera el «sí» de Andres** en el chat. La
columna «Quién» dice si la hace Andres a mano (lo que el sistema exige a una
persona) o Claude con el script. Todo lo del script se corre **primero sin
`--aplicar`**, que imprime los comandos y no toca nada.

`S` = `./scripts/preparar-staging.sh <fase> --proyecto ${GCP_PROJECT_ID_STAGING}`

| # | Qué | Quién | Comando (seco) | Comprobar después | ¿Reversible? |
|---|---|---|---|---|---|
| 1 | Crear el proyecto de Firebase (con Google Analytics apagado) y vincular la cuenta de facturación (Blaze) | **Andres**, consola de Firebase → «Agregar proyecto» → ID elegido; luego Configuración → Uso y facturación → Blaze | — | `gcloud projects describe <id>` con `CLOUDSDK_CONFIG=~/.config/gcloud-novuchat-prod` | Sí: eliminar el proyecto (30 días de gracia) |
| 2 | Presupuesto de 5 USD con alerta al 50 y 100 % | **Andres**, consola de Google Cloud → Facturación → Presupuestos | — | Aparece en la lista de presupuestos | Sí |
| 3 | Habilitar las 20 APIs | Claude | `S apis` | `S verificar` cuenta las habilitadas | Sí (`services disable`) |
| 4 | Base de Firestore `(default)` en `us-east1`, modo nativo | Claude | `S firestore` | `gcloud firestore databases describe` | **No** (una base no se cambia de región: si la región está mal, el proyecto se descarta) |
| 5 | Auth: habilitar Google y correo/contraseña; el dominio `<id>.web.app` ya viene autorizado | **Andres**, consola de Firebase → Authentication → Métodos de acceso | — | La pantalla de ingreso de staging acepta una cuenta `@ejemplo.com` (paso 15) | Sí |
| 6 | Storage: «Comenzar» en modo producción, ubicación `us-east1`; anotar el nombre del bucket | **Andres**, consola de Firebase → Storage | — | `gsutil ls -p <id>` muestra el bucket | Sí |
| 7 | App web «Consola (staging)» y sus `VITE_*` al Environment `staging` (+ `VITE_APPCHECK_SITE_KEY` vacía y `GCP_PROJECT_NUMBER_STAGING`) | Claude | `S app` | `gh variable list --env staging` muestra las siete | Sí (`gh variable delete`) |
| 8 | Pool `github` y proveedor `novuchat` propios, condición por identificadores y sujeto `environment:staging` | Claude | `S wif` | `gcloud iam workload-identity-pools providers describe` muestra la condición | Sí |
| 9 | `sa-deploy-staging` y `sa-functions` con sus roles; rol `desplegadorSecretos`; binding de la federación; cómputo sin Editor | Claude | `S cuentas` | `S verificar` (Policy Troubleshooter de los siete permisos que más fallaron en producción) | Sí, rol por rol |
| 10 | 25 secretos con valor aleatorio y `secretAccessor` para `sa-functions` | Claude | `S secretos` | `S verificar`: 25 secretos = 25 declarados | Sí (`secrets delete`) |
| 11 | Rol del agente de Storage (`firestoreServiceAgent`) — **después del paso 6** | Claude | `S storage` | `gcloud projects get-iam-policy` lo muestra | Sí |
| 12 | **Primer despliegue, con la cuenta dueña**: reglas, índices, Functions y Storage, simulado antes | Claude, con OK, desde `admin/` con `.firebaserc` local con el alias `staging` | `npx firebase-tools@15.28.1 deploy --only firestore:rules,firestore:indexes,functions,storage --project <id> --dry-run` y después sin `--dry-run` (hosting queda fuera del `--dry-run`, como en CI; `functions/.env` con `SITIO_PUBLICO=https://<id>.web.app`) | `gcloud run services list --region us-east1` muestra las Functions con `sa-functions@<id>`; `humo-staging.sh` con `STAGING_URL` y el proyecto en el entorno | Reglas: historial en la consola; Functions: redesplegar el commit anterior |
| 13 | Secretos y variables de GitHub: `GCP_WIF_PROVIDER` y `GCP_SA_DEPLOY_STAGING` (Environment), `SITIO_PUBLICO` y `FIREBASE_DEPLOY_ONLY` (Environment), `STAGING_URL` y, **última**, `GCP_PROJECT_ID_STAGING` (repositorio) | Claude | `S github` (con `--sin-storage` si el paso 6 se posterga) | `gh variable list`, `gh secret list --env staging` | Sí; borrar `GCP_PROJECT_ID_STAGING` vuelve a omitir los jobs |
| 14 | Primer despliegue por el pipeline: el push a `main` de este PR (o el siguiente que toque `admin/`) ejecuta `construir-staging` → `desplegar-staging` → `humo-staging` + `dast-y-humo` | GitHub Actions, sin aprobación (el Environment `staging` no tiene revisor) | `GH_CONFIG_DIR=~/.config/gh-pro gh run watch` | Los cuatro jobs en verde; el informe de ZAP como artefacto | `firebase hosting:clone <id>:previa <id>:live --project <id>` |
| 15 | Datos de prueba (§6): plataforma, dos comercios, usuarios, planes | Claude, cada script primero en seco | `node admin/scripts/cargar-plataforma.mjs --proyecto <id>` … (§6) | Entrar a `https://<id>.web.app` con `admin.salon@ejemplo.com` y ver las pestañas de su vertical | Sí (`usuarios-prueba.mjs --borrar`, `bajaTenant`) |
| 16 | `CONFIGURACION.local.md`: fila `${GCP_PROJECT_ID_STAGING}` con el valor real, para que `verificar-saneo.sh --exacto` lo vigile | Claude (archivo local, ignorado por git) | edición del archivo local | `./scripts/verificar-saneo.sh --exacto` en verde | Sí |

**El orden importa en tres lugares:** 6 antes de 11 (el agente de Storage nace
con el bucket); 12 antes de 14 (el primer despliegue de Functions crea los
servicios y los agentes con la cuenta dueña; la de despliegue no puede
cambiar IAM del proyecto, a propósito); y `GCP_PROJECT_ID_STAGING` al final de
13, porque es el interruptor: en cuanto existe, el siguiente push a `main`
despliega.

---

## 9. Riesgos y límites, dichos

- **El cambio de `opcionesGlobales.ts` toca el manifiesto de producción.** El
  correo se deriva de `GCLOUD_PROJECT` y resuelve al mismo de hoy, así que
  `firebase deploy` no ve diferencia en producción. Lo que lo prueba **no es el
  `--dry-run`** —que solo corre `checkSecretAccess` y no ve un miembro
  malformado en el delta de secretos—, sino la suite: `region-y-cuenta.test.ts`
  exige el correo completo con la forma `sa-functions@<proyecto>.iam.…` en las
  53 Functions, y `manifiesto-secretos.test.ts` reproduce el delta de
  `ensure.secretsAccessDelta` con el firebase-tools instalado (vacío con el
  correo derivado; los 25 secretos con la abreviatura). La prueba definitiva es
  el despliegue real a staging (paso 12), que ejercita el mismo código antes
  que producción. Si `GCLOUD_PROJECT` faltara al descubrir, el módulo falla con
  un mensaje que lo dice, en vez de publicar un manifiesto a medias.
- **Cloud Scheduler y Eventarc en el primer despliegue.** Producción los
  estrenó con la cuenta dueña; por eso el paso 12 también. Si el pipeline
  fallara después por un permiso de la cuenta de despliegue que producción
  tiene sin documentar, se agrega con `gcloud … add-iam-policy-binding` y se
  documenta acá.
- **Un push a `main` que toque `admin/` ahora despliega staging.** Es lo que
  se quiere; el costo es el de la tabla de arriba. Nada cambia en producción:
  sigue exigiendo etiqueta y aprobación.
- **`desplegar-dev` pasa a usar el paquete de staging.** No tiene proyecto ni
  Environment desde 2026-09-12; si alguien lo dispara sin proyecto de staging,
  `construir-staging` se omite y `desplegar-dev` también.
- **`previsualizar` (apagado) usaría el paquete de producción.** Es lo que
  hacía hasta hoy, cuando ambos paquetes llevaban las variables de producción;
  antes de encenderlo, `DESPLIEGUE-FIREBASE.md` §3 ya pide otra federación.

---

## 10. Lo que no se hace en este frente, y por qué

- Humo funcional con Playwright contra emuladores (`Analisis/28` §2.A): es un
  frente de pruebas de la consola, no de infraestructura.
- ZAP contra producción después de cada despliegue (`Analisis/28` §2.B): con
  staging, PIP-09 se cumple donde el checklist lo pide.
- Mover las `VITE_*` de producción al Environment `production` (§3).
- Dominio propio para staging: `<id>.web.app` alcanza, y un dominio más es
  DNS, certificado y otra clave de App Check.
- Modo B del estándar: se decide en el pase del primer cliente (`Analisis/41`
  §6.2), nunca en medio de un frente.
