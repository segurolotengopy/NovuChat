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

## 4. Aislamiento multi-tenant

Es el punto donde estos sistemas fallan. El modelo de amenazas completo está en
`SEGURIDAD.md`; acá van las decisiones.

### 4.1 Sin multi-tenancy nativa de Firebase Auth — y por qué no hace falta

Firebase Auth tiene multi-tenancy real (tenants de Auth con grupos de usuarios
separados), pero **exige Google Cloud Identity Platform, que es de pago y factura
por usuario activo**. Para una cartera de PyMEs donde cada negocio tiene dos o
tres usuarios, se estaría pagando una facturación por asiento a cambio de algo
que se logra igual de bien con claims y reglas.

**El diseño no la usa.** El aislamiento equivalente se consigue con tres piezas
que se refuerzan entre sí:

1. **El tenant está en la ruta del dato**, no en un campo. Todo cuelga de
   `/tenants/{tenantId}/…`.
2. **La pertenencia y el rol están en los custom claims** del ID token, firmados
   por Google y escritos únicamente por una Cloud Function con el SDK Admin.
3. **Las reglas de Firestore comparan la ruta contra el token** y niegan todo lo
   demás.

Lo que se pierde respecto de Identity Platform: no hay separación de *grupos de
usuarios* (una misma persona es un solo usuario, con roles en varios negocios —
que para este caso es una ventaja, no una pérdida) y no hay proveedores de
identidad distintos por tenant (nadie los pidió). Lo que se conserva: el
aislamiento de los datos, que es lo que importa.

### 4.2 Modelo de datos

```
/usuarios/{uid}                                  perfil propio. SIN roles.

/tenants/{tenantId}                              ficha: nombre, estado, plan
   /config/negocio                               lo que hoy es `Config del negocio`
   /catalogo/{itemId}                            servicios y precios
   /miembros/{uid}                               ESPEJO de los claims (no autoriza)
   /invitaciones/{id}                            hash del token, nunca el token
   /conversaciones/{convId}                      hilo: teléfono, resumen, gestión
      /mensajes/{msgId}                          INMUTABLE
      /privado/datos                             datos personales ampliados
   /metricas/{aaaa-mm}                           contadores agregados
   /auditoria/{eventoId}                         quién cambió qué
   /accesosSoporte/{uid}                         ventanas de acceso de NovuChat
```

Cuatro decisiones que conviene entender:

- **El tenant en la ruta y no en un campo.** Con un campo `tenantId` y una regla
  `resource.data.tenantId == miTenant`, las consultas se vuelven el punto débil:
  las reglas de Firestore **no filtran resultados**, solo aprueban o rechazan la
  consulta entera, así que hay que acertar la condición en cada `where` del
  código. Con el tenant en la ruta, la consulta mal escrita **no existe**: pide
  otra colección y se rechaza.

- **`/miembros` es un espejo, no una fuente de verdad.** Sirve para pintar la
  tabla de usuarios. Es de solo lectura para todos: si fuera escribible, el
  patrón invitaría a que alguna pantalla lo usara para autorizar.

- **Los mensajes son inmutables.** Un historial editable no sirve como evidencia
  ante un reclamo de un cliente final. Ni el admin ni la ruta de ingesta pueden
  modificar o borrar un mensaje ya escrito.

- **`/privado` existe porque las reglas no ocultan campos.** En Firestore, una
  lectura devuelve el documento completo o nada: no hay permisos por campo. Todo
  lo que un operador no debe ver tiene que estar en **otro documento**. Por eso
  los datos personales ampliados del contacto viven aparte y solo los ve el
  administrador del negocio.

### 4.3 Roles y matriz de permisos

Tres roles de persona y uno de servicio:

| | Propietario NovuChat | Admin del negocio | Operador | Ingesta (n8n) |
|---|---|---|---|---|
| Listar la cartera de negocios | ✅ | ❌ | ❌ | ❌ |
| Ver la ficha de su negocio | ✅ (todas) | ✅ | ✅ | ❌ |
| Alta / baja de negocios | ✅ (por Function) | ❌ | ❌ | ❌ |
| Leer la configuración | ✅ | ✅ | ✅ | ❌ |
| Editar la configuración y el catálogo | ❌ | ✅ | ❌ | ❌ |
| Gestionar usuarios del negocio | ❌ (por Function) | ✅ | ❌ | ❌ |
| **Leer conversaciones** | ⚠️ solo con acceso de soporte vigente | ✅ | ✅ | ❌ |
| Datos personales ampliados (`/privado`) | ❌ | ✅ | ❌ | escribe |
| Marcar gestión interna del hilo | ❌ | ✅ | ✅ | ❌ |
| Escribir conversaciones y mensajes | ❌ | ❌ | ❌ | ✅ (su tenant) |
| Leer métricas | ✅ | ✅ | ✅ | ❌ |
| Leer auditoría | ✅ | ✅ | ❌ | ❌ |

Dos elecciones deliberadas:

- **El propietario de NovuChat NO lee conversaciones por defecto.** Es la
  aplicación literal del mínimo privilegio a quien tiene todo el poder. Cuando
  soporte necesita ver un hilo, **el administrador del negocio** abre una ventana
  con vencimiento (1 a 24 horas) llamando a `otorgarAccesoSoporte`, y queda
  registrado en `/auditoria`. El propietario no puede abrírsela solo: la
  colección `/accesosSoporte` es de solo lectura desde el navegador y la Function
  exige rol de admin del negocio. Es además un buen argumento comercial: "no
  leemos sus conversaciones salvo que usted nos lo habilite, y usted ve cuándo".

- **La ingesta es ciega.** El principal de servicio de n8n escribe y no puede
  leer. Si su credencial se filtra, el atacante puede ensuciar el historial de
  **un** negocio, no exfiltrar el de ninguno.

### 4.4 Los custom claims y su tope de 1000 bytes

Forma del claim:

```json
{ "nc": { "p": true, "t": { "salon-demo": "admin" }, "v": 3 } }
```

Las claves son de una letra a propósito. Firebase impone un **tope duro de 1000
bytes** al conjunto de custom claims, y `setCustomUserClaims` falla al pasarlo —
en producción, con el usuario ya creado. Con este formato entran del orden de 15
a 20 negocios por usuario; con claves como `roles`/`tenantId`/`propietario` se
llegaría a la mitad. `functions/src/claims.ts` verifica el tamaño antes de
escribir y falla con un mensaje explícito en vez de romper en silencio.

**Si algún día hiciera falta un usuario con más negocios que eso**, la salida no
es agrandar el claim sino cambiar el criterio de pertenencia en las reglas a una
lectura de documento:

```
exists(/databases/$(db)/documents/tenants/$(t)/miembros/$(request.auth.uid))
```

No tiene tope y la revocación es instantánea, pero **cuesta una lectura
facturada por evaluación de regla**, o sea por cada consulta del panel. La
compensación es explícita: hoy se paga latencia cero y tope de 20 negocios; el
día que estorbe, se paga una lectura por consulta y no hay tope.

### 4.5 Revocación: la ventana de una hora

Un ID token de Firebase vive hasta **una hora**. Cambiar los claims no invalida
el token que el usuario ya tiene. Sin cuidado, un empleado retirado sigue
leyendo conversaciones durante una hora. Tres medidas:

1. `revokeRefreshTokens(uid)` en toda quita de rol y en toda baja de negocio.
2. La regla `tenantActivo()` consulta el estado del negocio **en cada lectura de
   conversaciones**: dar de baja un negocio corta el acceso al instante, sin
   esperar a que caduque ningún token. Cuesta una lectura por consulta y se paga
   con gusto.
3. El campo `v` (versión de claims) permite que el panel detecte un token viejo y
   pida uno nuevo con `getIdToken(true)`.

---

## 5. Integración con n8n

### 5.1 Lo que va en cada sentido

```
n8n ──► panel :  cada mensaje entrante y saliente, más los contadores.
panel ──► n8n :  la configuración del negocio (horarios, catálogo, mensajes).
```

### 5.2 Cómo escribe n8n sin una credencial compartida entre todos

**Lo que está prohibido:** una clave JSON de cuenta de servicio guardada en n8n.
Es de larga duración, no caduca sola y tiene alcance de **proyecto entero**, o
sea de todos los negocios a la vez. Si la VM de OCI se compromete, se van todos
los clientes juntos. Es exactamente la credencial que el encargo pide evitar.

**Lo que se hace:**

1. **Un secreto HMAC por negocio**, en Secret Manager (`ingesta-<tenantId>`) y en
   las credenciales de n8n. Uno por negocio, no uno para todos.
2. n8n firma cada petición: `HMAC-SHA256(secreto, timestamp + "." + cuerpo)`.
   **El secreto no viaja**; viaja una firma. Un `Authorization: Bearer` queda
   escrito en los logs de cualquier proxy intermedio; una firma no sirve de nada
   una vez usada.
3. Ventana de 5 minutos sobre el timestamp: acota la reproducción de una petición
   capturada.
4. **El tenant se deriva de la clave que valida la firma, nunca del cuerpo.**
   Este es el control central contra el *diputado confundido*: aunque n8n mande
   `{"tenantId": "otro-negocio"}`, la función escribe donde dice la firma.
5. Comparación de firmas en tiempo constante (`timingSafeEqual`).

**Fase 2, ya prevista en el código.** La función emite además un token de Firebase
Auth efímero (1 h) para el principal `svc_<tenantId>`, con el claim
`{ nc: { t: { "<tenantId>": "ingesta" } } }`. Cuando la escritura pase a hacerse
con ese token contra la API REST de Firestore en vez de con el SDK Admin, la
ingesta quedará sujeta a `firestore.rules` igual que el navegador: un error de
programación en la función dejará de poder cruzar negocios, porque el token no
alcanzaría. Las reglas y las pruebas de aislamiento del rol `ingesta` **ya están
escritas y pasan**; falta solo cambiar el cliente de escritura.

### 5.3 Alternativas descartadas para la ingesta

| Alternativa | Por qué no |
|---|---|
| Clave JSON de cuenta de servicio en n8n | larga duración, alcance de proyecto, compartida entre todos los negocios. Prohibida. |
| Workload Identity Federation desde OCI | WIF necesita que el emisor tenga identidad OIDC propia. GitHub Actions la tiene (y por eso el **despliegue sí usa OIDC**); una VM de OCI corriendo n8n no la tiene sin montar un emisor adicional que habría que operar y proteger. |
| `Bearer` con clave por tenant | mejor que una clave única, pero la clave viaja en cada petición y termina en logs de proxy. HMAC cuesta lo mismo y no expone el secreto. |
| Escribir Firestore desde n8n con el SDK cliente | requeriría un usuario de Auth con contraseña guardada en n8n: otra credencial de larga duración. |

### 5.4 Cómo consume n8n la configuración

El nodo `Config del negocio` deja de tener los valores escritos a mano y pasa a
consultarlos. La respuesta llega con los campos **separados y rotulados**:
`instruccionesExtra` viene en su propia clave para que el flujo la inserte en una
sección delimitada del prompt, marcada como *dato del negocio*, **nunca
concatenada por delante de las reglas de comportamiento del agente**. Esto es lo
que impide que el texto que un cliente escribe en el panel se convierta en una
instrucción para el modelo (ver `SEGURIDAD.md`, inyección de segundo orden).

Se mantienen intactas las reglas de diseño de flujos de `CLAUDE.md`: clave de
sesión por número de origen, filtro de eventos, normalización de entrada, fecha y
zona inyectadas, modelo como sub-nodo intercambiable.

---

## 6. Alta de un cliente en 48 horas

La función `altaTenant` hace en una operación lo que hoy es una tarde de trabajo
manual:

1. Crea `/tenants/{id}` con `estado: 'activo'`.
2. Crea `/tenants/{id}/config/negocio` con los valores por defecto de Bolivia
   (`America/La_Paz`, `BOB`).
3. Crea el primer administrador y **le emite el custom claim**.
4. Escribe el evento en `/auditoria`.

Queda manual, por diseño: crear el secreto HMAC del negocio en Secret Manager y
conectar el número de WhatsApp del cliente en Meta. Ambos son pasos que exigen
una persona.

**Los identificadores de negocio no se reutilizan jamás**, ni siquiera los dados
de baja. Si se reutilizara `salon-x`, un claim viejo que todavía dijera
`{"salon-x": "admin"}` le daría al antiguo dueño acceso de administrador al
negocio nuevo que heredó el identificador. La baja es lógica y el identificador
queda quemado; `altaTenant` rechaza un identificador ya usado.

---

## 7. Estructura del directorio

```
admin/
├── DISENO.md                    este documento
├── SEGURIDAD.md                 mapeo de reglas de seguridad y modelo de amenazas
├── LEEME.md                     cómo trabajar en esto
├── firestore.rules              ⭐ el corazón del aislamiento, comentado
├── firestore.indexes.json
├── firebase.json                Hosting con CSP, Functions, emuladores
├── .firebaserc.ejemplo          copiar a .firebaserc (ignorado por git)
├── package.json / pnpm-workspace.yaml
├── vitest.config.ts
├── ci/
│   └── despliegue-admin.yml     ⚠️ mover a .github/workflows/ (ver §11)
├── pruebas/
│   ├── reglas.test.ts           42 pruebas de aislamiento
│   └── correr.sh                levanta el emulador y corre las pruebas
├── web/                         React 19 + Vite + TypeScript
│   └── src/
│       ├── lib/firebase.ts      init, App Check, emuladores
│       ├── lib/sesion.ts        lectura de claims
│       ├── lib/contexto.tsx     sesión de React
│       ├── componentes/
│       │   ├── TextoSeguro.tsx  ⭐ renderizado de texto no confiable
│       │   └── Proteger.tsx     guardia de rutas (cosmético)
│       └── paginas/             Ingresar, Tenants, Configuracion,
│                                Conversaciones, Usuarios, Metricas
└── functions/                   Cloud Functions v2, TypeScript
    └── src/
        ├── index.ts             alta/baja, roles, soporte, config para n8n
        ├── claims.ts            ⭐ único emisor de permisos del sistema
        └── ingesta.ts           ⭐ puente n8n → Firestore con HMAC
```

---

## 8. Despliegue

GitHub Actions con **OIDC / Workload Identity Federation**. Cero claves JSON de
cuenta de servicio en el repositorio, que además es público. El detalle está en
`ci/despliegue-admin.yml` y el análisis de seguridad en `SEGURIDAD.md` §4.

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
| Pruebas de reglas con el emulador | ✅ **42 de 42, ejecutadas de verdad** contra `cloud-firestore-emulator-v1.22.0` |
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

2. **El `evaluation error` en el log de reglas es benigno.** Toda escritura con
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
    `git mv admin/ci/despliegue-admin.yml .github/workflows/despliegue-admin.yml`
12. Crear el entorno `produccion` **con revisor obligatorio**.
13. Cargar las *variables* (no secretos): `WIF_PROVIDER`,
    `WIF_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID_PROD`, `VITE_FIREBASE_*`,
    `VITE_APPCHECK_SITE_KEY`.
14. Proteger `main`: sin push directo, PR con revisión humana. Ningún agente
    aprueba ni fusiona (regla §4).

**Secret Manager**

15. Un secreto `ingesta-<tenantId>` por negocio, y declararlo en
    `functions/src/ingesta.ts` (`SECRETOS_POR_TENANT`).

**Local**

16. `cp admin/.firebaserc.ejemplo admin/.firebaserc` con los IDs reales
    (`.firebaserc` está en `.gitignore`).

---

## 12. Riesgos abiertos

| Riesgo | Impacto | Mitigación propuesta |
|---|---|---|
| **La ingesta escribe con el SDK Admin (Fase 1)**, saltándose las reglas | un error de programación en `ingesta.ts` podría escribir en otro negocio; el aislamiento depende de una línea de código en vez de una regla | pasar a Fase 2 (token efímero + REST) antes de tener el segundo cliente. Las reglas ya están y pasan las pruebas |
| **Ventana de hasta 1 hora del ID token** | un usuario retirado conserva permisos hasta que caduque | `revokeRefreshTokens` en cada quita, y `tenantActivo()` en las lecturas sensibles. Queda un hueco en lecturas no sensibles |
| **Sin política de retención de conversaciones** | acumulación indefinida de datos personales de terceros que nunca consintieron nada ante NovuChat | definirla antes del primer cliente real: propuesta de 12 meses y purga automática |
| **Blaze sin tope duro** | una función en bucle genera una factura desagradable | presupuesto con alerta + `maxInstances: 10` (ya configurado) |
| **App Check exigido demasiado pronto** | deja afuera a usuarios legítimos | modo monitoreo primero, exigir después |
| **Presupuesto de reglas** | Firestore limita a 10 accesos a documentos por petición y 20 por consulta; `tenantActivo()` + `soporteVigente()` ya usan dos | no agregar más `get()` sin medir |
| **Un solo propietario de plataforma** | si Andres pierde la cuenta, nadie administra | designar a Silvana como segundo propietario desde el primer día |
| **Costo de lectura del visor** | un hilo largo son cientos de lecturas por apertura | ya hay `limit(300)`; paginar si molesta |
| **El repositorio es público** | los identificadores del proyecto quedan a la vista | ya se aplican los marcadores de `CONVENCIONES-REPO-PUBLICO.md`; la seguridad no depende de que el ID sea secreto, sino de las reglas |
