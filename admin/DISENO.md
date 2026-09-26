# DISEÑO — Sitio administrativo de NovuChat

> Panel multi-tenant y multi-usuario sobre Firebase. Pista **paralela** a los
> demos del 9 y 10 de septiembre: no los bloquea y prioriza solidez de diseño
> sobre velocidad.
>
> Este documento es **público** (el repositorio lo es). Todo identificador de
> infraestructura aparece como marcador `${...}` según
> `CONVENCIONES-REPO-PUBLICO.md`.

**Estado:** andamiaje funcional escrito y verificado localmente. **Ningún
recurso de nube fue creado.** Lo que Andres tiene que crear está en §11.

---

> **Desde el 25/09/2026 este documento está repartido por zona en
> `docs/arquitectura/`** (`Analisis/41-arquitectura-por-capas.md` §5.5). Las
> secciones §4 a §6 se movieron, sin cambiar una letra, a un archivo por zona
> (core, central, plataforma, coordinador, registro) y por módulo. **Cada
> sección vieja, por número, está mapeada en `docs/arquitectura/indice.md`**:
> léalo antes de citar «§4sexies» y compañía. Acá quedan las secciones que
> todavía no tienen destino: §1 a §3 (el sitio y el proyecto Firebase) y §7 a
> §12 (directorio, despliegue, verificación, límites, nube y riesgos).

## 1. Qué es y qué promete

El panel donde NovuChat administra a sus clientes PyME y donde cada cliente
administra su propio asistente. Sostiene la promesa comercial de **instalar un
cliente nuevo en 48 horas**: hoy esa promesa depende de que alguien edite a mano
el nodo `Config del negocio` dentro de un flujo de n8n, lo que no escala ni se
puede delegar al cliente.

Funcionalidad mínima:

| Función | Quién la usa |
|---|---|
| Alta y baja de negocios (tenants) | NovuChat |
| Usuarios por negocio, con roles | NovuChat y el negocio |
| Edición de la configuración del asistente | el negocio |
| Visor de conversaciones | el negocio |
| Métricas básicas de uso | ambos |

---

## 2. Arquitectura

```
                     ┌──────────────────────────────────────────┐
   Navegador ─────►  │  Firebase Hosting (SPA estática + CSP)   │
   (dueño PyME,      └──────────────────────────────────────────┘
    operador,                     │
    NovuChat)                     │  SDK web
                                  ▼
                     ┌──────────────────────────────────────────┐
                     │  Firebase Auth  ── custom claims ──┐     │
                     │  Cloud Firestore ◄── firestore.rules     │
                     │  Cloud Functions (alta/baja, roles,      │
                     │                   ingesta, config)       │
                     └──────────────────────────────────────────┘
                                  ▲
                                  │  HTTPS + HMAC por tenant
                                  │
                     ┌──────────────────────────────────────────┐
   WhatsApp ──────►  │  n8n autoalojado en OCI  (sin cambios)   │
   (Meta Cloud API)  └──────────────────────────────────────────┘
```

El backend conversacional **no se toca**: n8n en OCI sigue siendo quien habla con
la Cloud API de Meta. El panel es un sistema aparte que (a) le publica la
configuración y (b) recibe de él las conversaciones.

### Por qué una SPA estática y no renderizado en servidor

Con SSR (Next.js, SvelteKit con adaptador de servidor) habría que hospedar un
proceso en Cloud Run o Functions. Eso agrega un componente con credenciales que
mantener, parchear y auditar, y —lo importante— **crea un segundo lugar donde
puede fallar la autorización**. Con la SPA, la autorización vive en un solo lado:
`firestore.rules`. El navegador puede pedir lo que quiera; el servidor de datos
decide. Menos superficie, menos costo y una sola cosa que auditar.

El SEO no aplica: el panel está detrás de un inicio de sesión.

### Elección del framework: React 19 + Vite + TypeScript

Se evaluaron tres opciones:

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **React + Vite** | escapado por defecto; la única vía de inyectar HTML es `dangerouslySetInnerHTML`, que es una sola cadena greppable y el CI la prohíbe; ecosistema y documentación de Firebase de primera; el mayor grupo de programadores contratables en Bolivia | bundle más grande | **elegida** |
| SvelteKit | más liviano y rápido de escribir | su vía de escape es `{@html}`, igual de greppable, pero el adaptador estático es menos usado y la comunidad local es chica | descartada |
| Next.js | estándar de la industria | trae SSR que acá no se necesita y sí se paga en superficie de ataque y costo | descartada |

El criterio decisivo fue el segundo: en un panel que muestra texto escrito por
desconocidos, **importa que exista una única puerta de escape del escapado
automático y que sea trivial de vigilar en el CI**. React la tiene y el workflow
la verifica en cada push (paso "Prohibiciones de renderizado").

TypeScript en modo `strict` con `noUncheckedIndexedAccess`: los datos que vienen
de Firestore son `unknown` hasta que se validan, y el compilador obliga a
tratarlos como tales.

---

## 3. Decisión: ¿proyecto Firebase nuevo o reutilizar el de los demos?

### Recomendación: **proyecto nuevo y dedicado. Dos, en realidad.**

```
${GCP_PROJECT_ID}          los demos. Se deja EXACTAMENTE como está.
novuchat-admin-dev         desarrollo del panel, datos de mentira.
novuchat-admin-prod        panel con datos reales de clientes.
```

### Por qué, desde el radio de impacto

**El proyecto de Google Cloud es la unidad de aislamiento real.** IAM, cuotas,
facturación, registro de auditoría, el conjunto de usuarios de Auth y las claves
de API se definen por proyecto. Todo lo que comparte proyecto comparte destino.

Cinco razones concretas:

1. **Los perfiles de riesgo son opuestos.** El proyecto de demos se manipula
   rápido y bajo presión: se prueban claves, se habilitan APIs, se agregan
   redirect URIs, se comparten pantallas en vivo. El panel guarda conversaciones
   reales de clientes de PyMEs bolivianas. Un descuido aceptable en el primero
   es una fuga de datos personales en el segundo.

2. **La cuenta de servicio de las demos ya cruzó el perímetro.** El proyecto de
   demos emitió el cliente OAuth de Calendar y la API key de Gemini que hoy viven
   **dentro de las credenciales de n8n, en la VM de OCI** (`${VM_HOST}`), una
   máquina con co-inquilinos que NovuChat no controla del todo (Odoo, Nginx
   Proxy Manager, `otp-service`). Si esa VM se compromete, el atacante queda
   *adentro* del proyecto que emitió esas credenciales. Que ahí no haya nada más
   que un calendario de relleno es exactamente lo que se quiere. Poner las
   conversaciones de los clientes en ese mismo proyecto convierte un incidente de
   VM en un incidente de datos personales.

3. **Cuotas y facturación son compartidas.** Un pico de Gemini durante una demo,
   o una suspensión por abuso de la Generative Language API, afecta al proyecto
   entero. El panel de un cliente que paga no puede caerse porque un demo consumió
   la cuota.

4. **Auth es por proyecto.** Los usuarios del panel vivirían en el mismo grupo de
   identidades que cualquier cosa que se pruebe en el proyecto de demos. Mezclar
   identidades reales de clientes con identidades de prueba es una fuente
   permanente de errores de limpieza.

5. **Los demos son desechables; el panel no.** Después de septiembre habrá ganas
   de borrar apps, revocar credenciales y limpiar el proyecto de demos. Eso debe
   poder hacerse sin riesgo. Si ahí adentro vive el panel, cada limpieza pasa a
   ser una operación delicada.

### Por qué también un proyecto de desarrollo separado

Las reglas de Firestore se prueban con el emulador, pero el flujo entero
(claims, Functions, App Check, dominios autorizados) necesita un lugar real donde
equivocarse. Sin `dev`, la única forma de probar un cambio de reglas es
desplegarlo sobre los datos de los clientes. Un proyecto de Firebase no cuesta
nada por existir: se paga por uso, y `dev` prácticamente no tiene.

### El costo de la recomendación, dicho con todas las letras

- Hay que configurar **dos** veces: Auth, dominios autorizados, App Check,
  Workload Identity Federation.
- Google limita la cantidad de proyectos por cuenta (del orden de una decena en
  cuentas nuevas). Con `${GCP_PROJECT_ID}` + dos nuevos se queda holgado, pero
  conviene saberlo antes de crear proyectos a la ligera.
- `novuchat-admin-prod` necesita el plan **Blaze** (Cloud Functions y salida de
  red lo exigen). Con los volúmenes de una cartera inicial de PyMEs el gasto
  esperado es de pocos dólares al mes, pero **hay que poner un presupuesto con
  alerta**, porque Blaze no tiene tope duro.

### Lo que NO se debe hacer

Reutilizar `${GCP_PROJECT_ID}` "por ahora, y después migramos". Migrar un
proyecto de Firebase con usuarios de Auth ya creados obliga a recrear cada
identidad: los UID cambian, y los UID son la clave de los permisos y de la
propiedad de los datos. La migración se vuelve cara justo cuando ya hay clientes.
Esta decisión es barata hoy y cara en seis meses.

---

## 7. Estructura del directorio

```
admin/
├── DISENO.md                    este documento
├── SEGURIDAD.md                 mapeo de reglas de seguridad y modelo de amenazas
├── LEEME.md                     cómo trabajar en esto
├── CATALOGO-WEB.md              catálogo público: contrato, n8n y puesta en marcha
├── firestore.rules              ⭐ el corazón del aislamiento, comentado
├── firestore.indexes.json
├── firebase.json                Hosting con CSP, Functions, emuladores
├── .firebaserc.ejemplo          copiar a .firebaserc (ignorado por git)
├── package.json / pnpm-workspace.yaml
├── vitest.config.ts
├── pruebas/
│   ├── reglas.test.ts           155 pruebas de aislamiento y control
│   ├── indices.test.ts          4 pruebas de índices (sin emulador)
│   ├── saneo.test.ts            22 pruebas puras (escapado, ranuras, funcionarios)
│   ├── catalogo-web.test.ts     carrito no falsificable, URL de imagen, CSV, reglas
│   └── correr.sh                levanta el emulador y corre las pruebas
├── web/                         React 19 + Vite + TypeScript
│   └── src/
│       ├── main.tsx             ⭐ elige QUÉ aplicación cargar según la ruta
│       ├── consola.tsx          monta la consola (con el SDK de Firebase)
│       ├── publico/             ⭐ el catálogo que ve un cliente final:
│       │                        sin sesión, sin Firebase, marca del comercio
│       ├── lib/firebase.ts      init, App Check, emuladores
│       ├── lib/csv.ts           importar y exportar el catálogo en CSV
│       ├── lib/sesion.ts        lectura de claims
│       ├── lib/contexto.tsx     sesión de React
│       ├── componentes/
│       │   ├── TextoSeguro.tsx  ⭐ renderizado de texto no confiable
│       │   └── Proteger.tsx     guardia de rutas (cosmético)
│       └── paginas/             Ingresar, Tenants, Configuracion,
│                                Conversaciones, Usuarios, Contactos,
│                                Metricas, EstadoCuenta, Reclamos,
│                                Bitacora, Funcionarios,
│                                ConfiguracionVertical
└── functions/                   Cloud Functions v2, TypeScript
    └── src/
        ├── index.ts             alta/baja, suspensión, roles, soporte, números
        ├── claims.ts            ⭐ único emisor de permisos + vínculo proveedor
        ├── reclamos.ts          ⭐ aviso de reclamos por FormSubmit
        ├── saneo.ts             ⭐ neutralización del texto que sale (con pruebas)
        ├── prompt.ts            ⭐ campos derivados, voz del agente, ranuras,
        │                        umbral del catálogo al prompt
        ├── catalogoWeb.ts       ⭐ enlace, sitio y checkout: el carrito vuelve
        │                        de servidor a servidor y el precio lo pone
        │                        el servidor, nunca el navegador
        └── ingesta.ts           ⭐ puente n8n → Firestore con HMAC, ruteo por
                                 número y conteo de personas únicas
```

---

## 8. Despliegue

GitHub Actions con **OIDC / Workload Identity Federation**. Cero claves JSON de
cuenta de servicio en el repositorio, que además es público. El detalle está en
`.github/workflows/despliegue-admin.yml` y el análisis de seguridad en `SEGURIDAD.md` §4.

Dos trabajos con separación estricta:

- **`verificar`** corre también en pull requests de cualquiera, incluidos forks.
  Por eso **no recibe ningún secreto ni token de nube**: sin `id-token`, sin
  `environment`, solo `contents: read`. Es la aplicación directa de la Regla de
  Dos.
- **`desplegar`** corre solo sobre `main`, con el entorno protegido `produccion`
  y revisor humano obligatorio.

---

## 9. Estado real de la verificación

| Qué | Resultado **real** |
|---|---|
| Compilación del frontend | ✅ `pnpm --filter @novuchat/admin-web build` — 72 módulos, sin errores |
| Compilación de las Functions | ✅ `tsc -b` sin errores |
| Pruebas de reglas con el emulador | ✅ **179 de 179, ejecutadas de verdad** contra `cloud-firestore-emulator-v1.22.0` |
| Pruebas puras (saneo, ranuras, índices, rótulos) | ✅ **31 de 31**, sin emulador ni red |
| Política de seguridad de contenido | ✅ **probada de verdad** con `pnpm csp`: el iframe de Auth se crea y no queda ninguna violación |
| Comprobaciones del CI (grep) | ✅ corridas localmente, ambas pasan |
| Despliegue a Firebase | ⛔ **no ejecutado.** No se creó ni modificó ningún recurso de nube |

Dos hallazgos del entorno, documentados para que no cuesten tiempo después:

1. **`firebase emulators:exec` falla en esta máquina.** Reporta "port taken" en
   cualquier puerto, incluso uno libre, deja el proceso Java huérfano ocupando el
   puerto y hay que matarlo a mano. Se sospecha de la interacción entre el
   detector de arranque del CLI y el aislamiento de red del entorno. Solución:
   `pruebas/correr.sh` invoca el jar del emulador directamente, lo que además es
   determinista y no necesita ninguna sesión de Firebase iniciada. El script del
   CI sí usa el CI de GitHub, donde el CLI funciona normalmente.

2. **Dos defectos reales que destaparon las pruebas nuevas.** Los dos estaban en
   verde antes y no lo estaban de verdad:

   - **`rolEn()` devolvía `null`.** Comparar `null == 'admin'` no da falso en el
     lenguaje de reglas: lanza *Null value error*, que deniega por error de
     evaluación en vez de por la condición. El efecto real era que el propietario
     de NovuChat **no podía leer `/auditoria`, `/invitaciones` ni
     `/accesosSoporte`** —las tres reglas de la forma `esAdmin(t) ||
     esPropietario()`, donde `esAdmin` se evalúa primero y reventaba antes de
     llegar a la segunda rama—. Corregido usando cadena vacía como valor por
     defecto, y con una prueba de regresión.
   - **Ocho pruebas de contactos pasaban en vacío.** Una edición de la semilla no
     coincidió y falló en silencio, así que los `assertFails` pasaban porque los
     documentos **no existían**, no porque las reglas los negaran. Se agregó el
     bloque *Control de la semilla*, que lee la semilla sin reglas y verifica que
     cada documento que las demás pruebas dan por sentado esté realmente ahí. Se
     comprobó que el control funciona rompiendo la semilla a propósito: detecta
     los cuatro documentos faltantes.

   La lección vale para cualquiera que toque esta suite: **en un archivo de
   pruebas dominado por `assertFails`, el verde no prueba nada por sí solo.** Un
   documento inexistente y una regla que deniega producen el mismo
   `permission-denied`.

3. **`orderBy('__name__', 'desc')` no existe en Firestore.** La pantalla de Uso
   lo usaba y habría fallado en producción la primera vez que alguien la
   abriera: *"Firestore does not support descending key scans"*. No lo detectó
   ninguna prueba de reglas porque no es un problema de permisos — apareció al
   escribir la prueba que reproduce la consulta real de la pantalla. Corregido
   con `where(documentId(), 'in', [...])` y orden en el cliente. **Moraleja: las
   pruebas de reglas deben usar la MISMA consulta que la interfaz, no una
   parecida.**

4. **El `evaluation error` en el log de reglas es benigno.** Toda escritura con
   una transformación de servidor (`serverTimestamp()`, `increment()`) se evalúa
   dos veces: una antes de materializar la transformación, que produce ese
   mensaje, y otra con los valores resueltos, que es la que decide. Se comprobó
   reemplazando `serverTimestamp()` por un `Timestamp.now()` del cliente en un
   caso: el mensaje desaparece y el resultado final no cambia. Está anotado en la
   cabecera de `pruebas/reglas.test.ts` para que nadie salga a cazar un fantasma.

---

## 10. Lo que este diseño **no** resuelve

- **Envío de mensajes desde el panel.** El visor es de solo lectura. Escribir a un
  cliente desde acá exigiría que el panel llame a la Cloud API de Meta, con las
  reglas de ventana de 24 horas y plantillas aprobadas. Es un proyecto propio.
- **Retención y borrado de conversaciones.** No hay política definida. Hay que
  decidirla antes de tener clientes reales (ver §12).
- **Exportación de datos del cliente.** Un negocio que se va debería poder
  llevarse sus conversaciones.
- **Cambio de dueño de un negocio.** Hoy se hace con dos llamadas
  (`invitarUsuario` + `quitarUsuario`); merece una operación atómica.

---

## 11. Lo que Andres tiene que crear en la nube

Nada de esto se hizo: el agente no crea recursos de nube y no usó ninguna sesión
activa de `gcloud` ni de `firebase`.

**Google Cloud / Firebase** (cuenta `${GOOGLE_ACCOUNT}`)

1. Crear `novuchat-admin-dev` y `novuchat-admin-prod`.
2. Habilitar en ambos: Authentication (proveedor Google), Firestore en modo
   nativo (región `southamerica-east1`, São Paulo — la más cercana a Bolivia),
   Hosting y Cloud Functions.
3. **Plan Blaze en `-prod`**, con presupuesto y alerta de gasto configurados.
4. Restringir los dominios autorizados de Auth al dominio del panel.
5. Registrar la app web en App Check con reCAPTCHA Enterprise y **dejarlo en modo
   monitoreo** hasta comprobar que no bloquea nada. Recién después, exigirlo.
6. Crear la primera identidad de propietario: iniciar sesión una vez y ejecutar
   `asignarPropietario(uid, true)` desde una consola administrativa.

**Workload Identity Federation** (una vez por proyecto)

7. Crear el pool y el proveedor OIDC de GitHub.
8. **La condición de atributos debe atar el `subject` al repositorio y a la rama
   o al entorno.** El repositorio es público: una condición laxa por
   `repository_owner` permitiría que cualquiera que forkee obtenga el token.
   Ver `SEGURIDAD.md` §4 para la expresión concreta.
9. Crear la cuenta de servicio de despliegue con los roles mínimos
   (`firebasehosting.admin`, `firebaserules.admin`, `cloudfunctions.developer`,
   `iam.serviceAccountUser`) y permitir que la federación la suplante.
10. **No generar ninguna clave JSON.** Si alguna herramienta la pide, es señal de
    que el paso 7 quedó mal.

**GitHub** (repositorio `segurolotengopy/NovuChat`)

11. Mover el workflow:
    `git mv .github/workflows/despliegue-admin.yml .github/workflows/despliegue-admin.yml`
12. Crear el entorno `produccion` **con revisor obligatorio**.
13. Cargar las *variables* (no secretos): `WIF_PROVIDER`,
    `WIF_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID_PROD`, `VITE_FIREBASE_*`,
    `VITE_APPCHECK_SITE_KEY`.
14. Proteger `main`: sin push directo, PR con revisión humana. Ningún agente
    aprueba ni fusiona (regla §4).

**Autenticación**

14b. Habilitar **dos** proveedores en Auth: *Google* y *Correo/contraseña*.
14c. Comprobar que la **protección contra enumeración de correos** esté activa.
14c-bis. Configurar la **política de contraseñas** de Firebase Auth (*password
     policy*): longitud mínima **8** —la misma que pide la consola en
     `web/src/lib/contrasena.ts`— y **bloqueo de contraseñas comunes o
     comprometidas**, sin reglas de composición. Es lo único que hace cumplir el
     mínimo **también en la pantalla de restablecimiento que sirve Firebase**,
     que hoy acepta desde 6 y ya dejó a un administrador con una contraseña que
     la consola no le aceptaba (§4ter.1). Va junto con el paso 14d: la política
     forma parte de Identity Platform.
14d. Decidir sobre **Identity Platform** (§4ter.1). Si se activa, hacerlo **al
     crear `novuchat-admin-prod`**, no después: es lo que habilita política de
     contraseñas, límite de intentos y segundo factor para los administradores de
     comercio. Confirmar la tarifa vigente en la consola; con el volumen de
     NovuChat debería caer en el nivel gratuito, pero **no lo dé por hecho**.
14d-bis. ⚠️ **Si aparece un proyecto nuevo o un dominio propio, agregar su
     `authDomain` a `frame-src` en `admin/firebase.json`.** Hoy están enumerados
     los de `-dev` y `-prod`. Si falta el del proyecto que se sirve, **el inicio
     de sesión con Google se rompe en silencio**: el clic no hace nada. Se
     comprueba en un minuto con `pnpm csp`.
14e. Crear la primera cuenta de cada tipo y comprobar el vínculo en vivo: que un
     administrador de comercio que entra con Google **no vea nada**.

**Secret Manager**

15. Un secreto `ingesta-<phone_number_id>` **por número de WhatsApp**, y
    declararlo en `functions/src/ingesta.ts` (`SECRETOS_POR_NUMERO`).
15c. ~~El secreto `RESEND_API_KEY`.~~ **Ya no hace falta:** FormSubmit no usa
     credencial. Es la ventaja que motivó la decisión.

**Correo saliente (FormSubmit)**

15d. **Usar una dirección DEDICADA, no la personal de Andres.** Algo como
     `reclamos@…`. Con FormSubmit el destino es una dirección de correo, no una
     API con autenticación: cualquiera que descubra el identificador del
     formulario puede mandarle correo. Para un buzón interno no es grave, pero
     esa casilla va a recibir basura y no debe ser la de trabajo diario de nadie.
     Ver `SEGURIDAD.md`, T-23.

15e. ⚠️ **CONFIRMAR LA DIRECCIÓN EN FORMSUBMIT — PASO MANUAL Y OBLIGATORIO.**
     La primera vez que se usa una dirección, FormSubmit manda un correo de
     activación y **no entrega nada hasta que alguien hace clic en el enlace**.
     Si este paso se saltea, **los reclamos se pierden en silencio**: la función
     recibe una respuesta que parece correcta, el panel muestra el reclamo, y a
     la bandeja no llega nada.

     Cómo comprobarlo de verdad: crear un reclamo de prueba desde el panel y
     verificar que **llegue el correo**, no que la función no haya dado error.
     Es exactamente la clase de fallo silencioso que ya costó tiempo con
     `subscribed_apps` de Meta (hallazgo 2 de `ESTADO.md`).

15f. Crear `/plataforma/notificaciones` con `formsubmitDestino` (la dirección
     dedicada o el alias opaco de FormSubmit) y `correosReclamos` (las copias).
     Ninguna sesión de navegador puede escribirlo: se carga desde una consola
     administrativa con el SDK Admin.

15g. Poner en la pantalla de reclamos, y decirle a los comercios, **qué no
     escribir ahí**: nada de datos de sus clientes finales, ni contraseñas, ni
     números de documento. El texto viaja a un tercero sin contrato. Ver T-22.

**Meta / WhatsApp — con anticipación, no cuando haga falta**

15b. Iniciar la **verificación de negocio** y la ampliación de números de la
     WABA. Por defecto son 2 números; ampliar a 20 es un trámite que se mide en
     días o semanas y no depende de NovuChat. Ver §4bis.4: el comercio número 21
     no obliga a cambiar código, obliga a un trámite. Y el límite de portafolios
     por cuenta personal sin verificar es 2, que ya figura como riesgo vivo en
     `ESTADO.md`.

**Local**

16. `cp admin/.firebaserc.ejemplo admin/.firebaserc` con los IDs reales
    (`.firebaserc` está en `.gitignore`).

---

## 12. Riesgos abiertos

| Riesgo | Impacto | Mitigación propuesta |
|---|---|---|
| **La ingesta escribe con el SDK Admin (Fase 1)**, saltándose las reglas | un error de programación en `ingesta.ts` podría escribir en otro negocio; el aislamiento depende de una línea de código en vez de una regla | pasar a Fase 2 (token efímero + REST) antes de tener el segundo cliente. Las reglas ya están y pasan las pruebas |
| **Ventana de hasta 1 hora del ID token** | un usuario retirado conserva permisos hasta que caduque | `revokeRefreshTokens` en cada quita, y `tenantActivo()` en las lecturas sensibles. Queda un hueco en lecturas no sensibles |
| ~~**Sin política de retención de conversaciones**~~ | RESUELTO el 2026-09-07: **12 meses y purga automática**, decidido por Andres. Ver §4septies | — |
| **Blaze sin tope duro** | una función en bucle genera una factura desagradable | presupuesto con alerta + `maxInstances: 10` (ya configurado) |
| **App Check exigido demasiado pronto** | deja afuera a usuarios legítimos | modo monitoreo primero, exigir después |
| **Presupuesto de reglas** | Firestore limita a 10 accesos a documentos por petición y 20 por consulta; `tenantActivo()` + `soporteVigente()` ya usan dos | no agregar más `get()` sin medir |
| **Un solo propietario de plataforma** | si Andres pierde la cuenta, nadie administra | designar a Silvana como segundo propietario desde el primer día |
| **Costo de lectura del visor** | un hilo largo son cientos de lecturas por apertura | ya hay `limit(300)`; paginar si molesta |
| **Techo de 20 números por WABA** | el comercio 21 queda bloqueado por un trámite de Meta, no por código | iniciar la verificación de negocio y la ampliación **antes** de necesitarlas; métrica de comercios por WABA |
| **La suspensión depende de que n8n respete el 409** | si n8n cachea la configuración o ignora el 409, un comercio suspendido sigue atendido | TTL de caché de 60 s como requisito del flujo; la ingesta igual queda cerrada por reglas, así que el daño se acota a respuestas sin registro |
| **`personasAtendidas` sostiene la facturación** | un error en la transacción de conteo se traduce en una factura mal emitida | la marca `periodoContado` no la puede tocar ninguna persona; hay procedimiento de recuento; conviene contrastar contra el conteo real el primer mes |
| **Contactos: datos de terceros sin consentimiento** | se guardan nombre, teléfono y correo de personas que no son usuarias del panel | roles cerrados, notas topeadas a 500 caracteres, operador excluido, y la política de retención pendiente los debe cubrir |
| **Sin segundo factor ni política de contraseñas para los comercios** | el servidor acepta una contraseña de 6 caracteres —la consola pide 8, pero eso es del navegador— y esa contraseña protege las conversaciones de un comercio | App Check en el ingreso, correo verificado obligatorio, mensajes de error genéricos. Se cierra activando Identity Platform (§4ter.1) |
| **Primera dependencia externa: el correo** | si FormSubmit cae o deja de entregar, NovuChat deja de enterarse de los reclamos | el reclamo se guarda en Firestore igual y se ve en el panel; la columna "Aviso" muestra los no notificados. Conviene una alerta si se acumulan pendientes |
| **FormSubmit sin activar** | los reclamos se pierden **en silencio**: la función no falla y el panel se ve bien | paso 15e de §11: confirmar con un reclamo de prueba que el correo LLEGA, no que la función no dio error |
| **El texto del reclamo viaja a un tercero sin contrato** | un reclamo puede traer datos del comercio y hasta de sus clientes finales | tope de 1000 caracteres hacia el correo, guía en la pantalla sobre qué no escribir, y el registro completo solo en Firestore. Se cierra al pasar a Resend con dominio propio (T-22) |
| **La Function de correo junta las tres capacidades de la Regla de Dos** | es el único punto del sistema donde pasa | destino fijo fuera del reclamo, texto plano, saneo de encabezados, sin adjuntos. Analizado en SEGURIDAD.md §1 y T-20 |
| **El repositorio es público** | los identificadores del proyecto quedan a la vista | ya se aplican los marcadores de `CONVENCIONES-REPO-PUBLICO.md`; la seguridad no depende de que el ID sea secreto, sino de las reglas |
