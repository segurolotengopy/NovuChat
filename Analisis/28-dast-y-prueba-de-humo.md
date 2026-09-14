# DAST y prueba de humo para la consola: qué falta y cómo cerrarlo

**14-sep-2026.** Pedido por Andres al preparar el pase de `v0.3.0`, donde el
control **PIP-09** del checklist quedó «no verificado» por cuarta vez seguida.
Escrito contra `.github/workflows/ci-node-firebase.yml`,
`.github/workflows/_reusable-dast.yml`, `.github/DESPLIEGUE-FIREBASE.md` y lo
que ya resolvió `novuchat.site`.

No contiene secretos ni identificadores.

---

## 0. Las decisiones, resumidas

| Opción | Qué cubre | Costo | Veredicto |
|---|---|---|---|
| **A · Humo funcional con Playwright contra emuladores, en cada PR** | Que la consola abra, que cada rol vea sus pestañas y no las ajenas, que la CSP no rompa el ingreso. **Antes** de fusionar | ~1 jornada, sin infraestructura | ✅ **Ahora** |
| **B · ZAP baseline y humo HTTP contra producción, después de cada despliegue** | Cabeceras, CSP y configuración del sitio real, con el informe de ZAP como evidencia | ~2 h, sin infraestructura | ✅ **Ahora**, como alarma |
| **C · Proyecto de staging** | Todo lo anterior antes de producción, más la prueba de rollback (OPS-06) | 1 a 2 jornadas y un proyecto Blaze más | 🔜 **Cuando haya motivo** (§4) |
| D · Canal de vista previa del PR en el proyecto de producción, como el sitio | ZAP sobre el frontend del PR | ~medio día, pero amplía la federación a `pull_request` | ⛔ No para la consola (§3) |

**A y B juntas dejan PIP-09 con evidencia real** en cada release, sin crear
ningún proyecto, y ninguna de las dos toca a los comercios. C es la solución
completa y se hace cuando algo la justifique.

---

## 1. Por qué hoy no corre nada

- `dast-y-humo` depende de `desplegar-staging`, que solo corre si
  `vars.GCP_PROJECT_ID_STAGING` tiene valor. **No hay proyecto de staging**
  (`DESPLIEGUE-FIREBASE.md`, «Estado real»), así que los dos se omiten en cada
  push y en cada etiqueta. Pasó igual en `v0.1.4`, `v0.1.5`, `v0.2.0` y `v0.3.0`.
- En producción solo corre el **health check** de `post-despliegue`: `GET /`
  con respuesta 200. Una CSP que rompe el ingreso con Google devuelve 200 igual.
  Ya pasó una vez (`admin/scripts/probar-csp.mjs` lo cuenta).
- La prueba de humo de verdad hoy es **manual**, y la hace Andres después de
  aprobar.

### El obstáculo que no está a la vista

`construir` arma el paquete de `staging` y el de `production` con **las mismas
variables** `VITE_FIREBASE_*` y `VITE_APPCHECK_SITE_KEY`, a nivel de
repositorio. El propio workflow lo advierte: para separar staging de verdad hay
que declarar `environment:` en ese job. **Un staging creado mañana, sin ese
cambio, serviría una consola que habla con el Auth, el Firestore y el App Check
de producción.** Cualquier camino con staging empieza por ahí.

---

## 2. Lo que se recomienda hacer ahora

### A · Humo funcional con Playwright contra emuladores

Es lo que ya hace `novuchat.site` (`pnpm humo`, `pruebas/humo/sitio.spec.ts`) y
la consola tiene casi todas las piezas:

- `admin/scripts/probar-csp.mjs` sirve `web/dist` **con las cabeceras reales de
  `firebase.json`**: una CSP rota falla en la prueba y no en producción.
- Los emuladores de Auth y Firestore ya corren en CI para `reglas.test.ts`, con
  Java instalado.
- `usuarios-prueba.mjs` y `sembrar.mjs` crean cuentas con cada rol y comercios
  de cada vertical.

**Qué habría que agregar:**

1. `@playwright/test` como dependencia de desarrollo de `admin`, con la versión
   fija y el mismo tratamiento de cadena de suministro que las demás.
2. `admin/playwright.config.ts`: `webServer` con `probar-csp.mjs` y los
   emuladores levantados antes; un proyecto de escritorio y uno móvil, porque
   Pedidos se mira desde el teléfono.
3. `admin/pruebas/humo/consola.spec.ts`, con los flujos que hoy se prueban a mano:
   - la pantalla de ingreso carga sin violaciones de CSP en la consola;
   - un administrador con contraseña entra, ve sus pestañas y **no** ve las de
     otro vertical ni «Negocios»;
   - un operador de un comercio de venta ve «Pedidos» y no «Configuración»;
   - el propietario, con el proveedor Google del emulador, ve «Negocios» y la
     pestaña «Captación» del tenant `novuchat`;
   - un comercio suspendido ve su aviso y no puede guardar.
4. Un job `humo` en el workflow, después de `construir`, que baje el artefacto
   `dist-production` y corra `pnpm humo`. Se agrega al check obligatorio del
   ruleset junto con `calidad`.

**Qué no cubre:** la configuración real de Hosting y del dominio. Para eso está B.

### B · ZAP baseline y humo HTTP contra producción, después del despliegue

`_reusable-dast.yml` ya hace las dos cosas: humo HTTP con cabeceras (HSTS y CSP)
y ZAP **baseline**, que es **pasivo**: navega y lee, no ataca.

**Qué habría que agregar:**

1. Un job `dast-produccion` después de `desplegar-produccion`, que llame a
   `_reusable-dast.yml` con `url_objetivo: vars.PROD_URL` y
   `escaneo_completo: false`. **Nunca** `full-scan` contra producción.
2. Que sea **alarma y no bloqueo**: el despliegue ya ocurrió, y el rollback
   automático de `post-despliegue` sigue dependiendo solo del health check. Si
   ZAP marca un FAIL, el job queda en rojo, el informe queda como artefacto y se
   decide a mano.
3. Revisar `zap-rules.tsv` con el primer informe real. Una SPA con Firebase
   dispara avisos de CSP y de scripts de Google que son esperables: se pasan a
   WARN **con nota y fecha**, nunca a IGNORE sin justificación.

**Costo:** minutos de Actions (el repositorio es público) y algunas evaluaciones
de reCAPTCHA de App Check cuando el rastreador carga la página, muy por debajo
del cupo gratuito.

**Lo que hay que dejar escrito:** PIP-09 pide DAST **contra staging**. Mientras
no exista, el acta registra la variante: humo funcional antes de fusionar (A) y
ZAP pasivo contra producción después de desplegar (B).

---

## 3. Por qué no el canal de vista previa, aunque el sitio lo use

`novuchat.site` corre DAST contra un canal de vista previa de su proyecto de
producción, con una cuenta propia para las vistas previas. Para la consola no
conviene:

1. **Un canal publica solo el frontend.** La consola sin reglas ni Functions no
   pasa de la pantalla de ingreso, así que ZAP analiza lo mismo que en B.
2. **Exige que la federación confíe en `pull_request`.** Hoy solo acepta
   `production` y `production-rollback`. En un repositorio público eso amplía la
   superficie donde menos conviene, y `DESPLIEGUE-FIREBASE.md` §3 ya lo descartó.
3. **Verificar primero cómo acotó el sitio esa cuenta.** Un rol de Hosting a
   nivel proyecto también puede publicar en `live`. Si el sitio lo resolvió con
   un rol a medida, sirve de referencia; si no, es un riesgo que la consola no
   necesita correr.

---

## 4. Staging: qué hace falta y cuándo vale la pena

**Cuándo:** con el segundo comercio real que use la consola todos los días, antes
de pedir Tech Provider a Meta, o cuando haya que hacer la prueba de rollback de
OPS-06, que el checklist exige cada 90 días y hoy no tiene dónde hacerse.

**Qué hace falta, en orden:**

1. **Proyecto Firebase de staging**, en plan Blaze si se despliegan Functions,
   con presupuesto y alerta. Sin Functions puede quedar en Spark:
   `FIREBASE_DEPLOY_ONLY_STAGING=hosting,firestore:rules,firestore:indexes`.
2. **Separar el paquete por ambiente:** declarar `environment:` en `construir` y
   mover las `VITE_*` a variables del Environment `staging` y del de
   `production`. Es el obstáculo del §1, y es un cambio del pipeline.
3. **Federación:** agregar el sujeto `environment:staging` a la condición del
   proveedor y crear una cuenta de despliegue propia de staging, con los mismos
   roles acotados que la de producción, en el proyecto nuevo.
4. **GitHub:** secreto `GCP_SA_DEPLOY_STAGING` y variables
   `GCP_PROJECT_ID_STAGING` y `STAGING_URL`. Con eso `desplegar-staging` y
   `dast-y-humo` dejan de omitirse solos.
5. **Auth y App Check del proyecto nuevo:** dominio autorizado, clave de App
   Check para ese dominio y la cuenta de Google del propietario.
6. **Datos:** `sembrar.mjs` y `usuarios-prueba.mjs` contra staging. **Nunca**
   datos de producción (DAT-07).
7. **Functions en staging:** secretos propios (`INGESTA_*`, `GEMINI_API_KEY`),
   nunca los de producción, y ningún número de WhatsApp real apuntando ahí.

**Costo recurrente:** cercano a cero con tráfico de prueba. El costo real es de
mantenimiento: un segundo proyecto con sus secretos, su federación y sus reglas.

---

## 5. Lo que queda para Andres

1. Aprobar A y B como el siguiente trabajo del pipeline, o elegir otro camino.
2. Decidir el disparador de C: qué hecho concreto hace que se cree staging.
3. Aceptar en cada acta, hasta entonces, la variante de PIP-09 descrita en el §2.
