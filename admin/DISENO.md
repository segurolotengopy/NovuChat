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

/rutasWhatsApp/{phoneNumberId}                   índice inverso número → comercio
/plataforma/notificaciones                       destinos de correo de NovuChat
/plataforma/cobroSimulado                        rótulos del simulacro (prohibición 3)

/tenants/{tenantId}                              ficha: nombre, estado, plan,
                                                 waPhoneNumberId, waWabaId, vertical
   /config/negocio                               COMÚN a cualquier comercio
   /config/agendamiento                          solo vertical de citas
   /config/venta                                 solo vertical de venta y cobro
   /catalogo/{itemId}                            servicios y precios
   /miembros/{uid}                               ESPEJO de los claims (no autoriza)
   /contactos/{contactoId}                       personas de referencia del comercio
   /funcionarios/{funcionarioId}                 quién atiende, con su calendario
      /privado/datos                             teléfono y correo del funcionario
   /agenda/{funcId}_{aaaammdd}_{ranura}          candado contra la doble reserva
   /bitacora/{eventoId}                          registro operativo, INMUTABLE
   /cuenta/estado                                plan y situación de pago (solo lectura)
   /reclamos/{reclamoId}                         reclamos hacia NovuChat, inmutables
   /invitaciones/{id}                            hash del token, nunca el token
   /conversaciones/{convId}                      hilo: teléfono, resumen, gestión,
                                                 periodoContado
      /mensajes/{msgId}                          INMUTABLE
      /privado/datos                             datos personales ampliados
   /metricas/{aaaa-mm}                           contadores agregados + únicos
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
| **Personas de referencia del comercio** | ⚠️ solo el marcado *contacto comercial* | ✅ | ❌ | ❌ |
| **Estado de cuenta** | ✅ lee y escribe (por Function) | ✅ solo lectura | ❌ | ❌ |
| **Reclamos** | ✅ lee todos; mueve estado por Function | ✅ crea y lee | ✅ crea y lee | ❌ |
| **Bitácora** | ✅ todos los comercios | ✅ el suyo | ❌ | escribe |
| **Funcionarios (operativo)** | ⚠️ con soporte | ✅ lee y edita | ✅ solo lee | lee |
| **Teléfono del funcionario** | ❌ | ✅ | ❌ | ❌ |
| **Agenda (candado)** | ❌ | ✅ lee | ✅ lee | toma y libera |
| **Proveedor de identidad exigido** | Google | contraseña | contraseña | token personalizado |
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

## 4bis. Control administrativo del comercio

Cuatro requisitos que Andres definió después del andamiaje inicial. Van juntos
porque los cuatro tocan la ficha del comercio.

### 4bis.1 Personas de referencia del comercio

No confundir con `/miembros`, que son **usuarios del panel**. Las personas de
referencia son los contactos del negocio —el dueño, quien atiende recepción,
quien factura— que en general **no tienen acceso al panel** y muchas veces ni
saben que están anotadas.

**Van en subcolección propia, `/tenants/{t}/contactos/{id}`**, por el mismo
motivo que los datos ampliados de las conversaciones: las reglas de Firestore
**no pueden ocultar campos sueltos en una lectura**. Si estos datos fueran campos
de la ficha del tenant, cualquiera que pueda leer la ficha —incluido el
operador— vería el teléfono del contador. Lo que un rol no debe ver va en otro
documento, no en otro campo.

Quién entra:

| | Ve | Edita |
|---|---|---|
| Admin del negocio | toda la agenda | sí |
| Operador | **nada** | no |
| NovuChat | **solo el marcado `esContactoComercial`** | no |
| NovuChat con acceso de soporte vigente | toda la agenda | no |
| Ingesta (n8n) | nada | no |

Tres decisiones que conviene justificar:

- **El operador queda afuera por completo.** Atender conversaciones no requiere
  el teléfono del contador del negocio. Es mínimo privilegio sin la excepción
  cómoda de "total, es de la misma empresa".
- **NovuChat ve un solo contacto.** Necesita a quién llamar por la factura, y
  nada más. El resto de la agenda exige un acceso de soporte, igual que las
  conversaciones. La casilla en la interfaz lo dice con todas las letras, para
  que el comercio sepa exactamente qué está compartiendo.
- **`rolNegocio` es una lista cerrada** (`dueno`, `recepcion`, `facturacion`,
  `tecnico`, `otro`) y las notas tienen un tope de 500 caracteres. Sin eso, este
  campo se convierte en el cajón de sastre donde termina cayendo información
  personal que nadie previó guardar y que después hay que responder si alguien
  la reclama.

**⚠️ Nota sobre `list`.** Para que NovuChat pueda *listar* los contactos
comerciales, su consulta tiene que traer `where('esContactoComercial','==',true)`.
Las reglas de Firestore no filtran resultados: si la consulta no trae esa
restricción, **falla entera**. Eso es deliberado — el modo de fallar es negar,
nunca devolver de más— y está cubierto por una prueba específica.

### 4bis.2 Contador de personas atendidas (únicos)

**El problema.** `FieldValue.increment(1)` cuenta mensajes, no personas. Una
persona que escribe treinta veces en el mes sumaría treinta. "Personas
atendidas" es un conteo de **únicos** y un contador incremental no puede
deduplicar.

**La opción que se descartó, y por qué.** La solución de manual es un conjunto de
hashes de teléfono por período (`/metricas/{p}/vistos/{hash}`). Se descartó por
dos motivos:

1. **Privacidad. Un hash de teléfono no es anonimización.** El espacio de números
   bolivianos es del orden de 10⁸: enumerarlo entero y comparar hashes es
   cuestión de segundos en una laptop. Sin sal secreta, ese conjunto es una
   segunda copia de los teléfonos, disfrazada de dato técnico. Y con sal secreta
   hay que custodiar y rotar la sal, o sea otro secreto más en la matriz.
2. **Costo y basura.** Crea un documento por persona y por mes que después hay
   que purgar.

**La opción elegida.** Se aprovecha que el documento de la conversación **ya
está indexado por teléfono** (`wa_<telefono>`) y **ya se escribe en cada
mensaje**. Se le agrega un campo `periodoContado`. Si el período que trae no es
el actual, esa persona todavía no fue contada este mes: se incrementa
`personasAtendidas` y se actualiza la marca. Todo dentro de una transacción, para
que dos mensajes simultáneos de la misma persona no la cuenten dos veces.

**No se crea ningún registro nuevo de teléfonos.** Es minimización de datos: se
reutiliza el identificador personal que ya existía en vez de sembrar una segunda
copia en la colección de métricas.

**Costo en Firestore, por mensaje entrante:**

| | Costo |
|---|---|
| Lecturas | **+1** (el documento de la conversación, dentro de la transacción) |
| Escrituras, caso común | **+0** — la conversación ya se escribía; solo se le agrega un campo |
| Escrituras, primera vez de esa persona en el mes | **+1** (el documento de métricas) |

Para un comercio con 500 mensajes al mes de 80 personas distintas: **500 lecturas
y 80 escrituras extra al mes**. A la tarifa de Firestore eso es del orden de una
milésima de dólar. El conteo exacto sale prácticamente gratis.

**Quién puede tocarlo.** `periodoContado` está en la lista blanca de campos que
escribe **solo la ingesta**, y no está entre los campos de gestión interna que
puede tocar una persona del negocio. Nadie puede borrar la marca para volver a
contar a la misma persona, ni al revés. **La métrica tiene que ser inmanipulable
por quien la paga y por quien la cobra**, y por eso `/metricas` también es de
solo lectura para el propietario de NovuChat.

**Recuento.** Si hay que recalcular un período —una corrección, una disputa de
factura— se recorre `/conversaciones` filtrando por `ultimoEn` dentro del mes. Es
caro pero puntual, y no exige haber guardado ninguna estructura extra.

### 4bis.2bis Atenciones e interacciones

Las otras dos cifras de la oferta comercial. Las definiciones son las de la
cabecera de `web/src/paginas/Cierres.tsx` y no se reinterpretan en ningún lado:

| Cifra | Definición | Cuándo suma |
|---|---|---|
| **Atención** | una conversación iniciada con un cliente, haya terminado bien o no | al primer mensaje del período en esa conversación |
| **Interacción** | una conversación en la que el cliente recibió **más de una** respuesta | al llegar a la **segunda** respuesta saliente del período |

**El problema es el mismo de §4bis.2 y la solución también.** `increment(1)`
cuenta mensajes, no conversaciones: sin deduplicar, una consulta de ocho idas y
vueltas se facturaría como ocho interacciones. Se usan marcas en el documento de
la conversación, que la transacción de la ingesta **ya lee y ya escribe**, así
que las dos cifras nuevas no cuestan ni una lectura ni una escritura extra:

| Campo | Para qué |
|---|---|
| `periodoContado` | ya existía; ahora decide también la atención |
| `respuestasDelPeriodo` | respuestas salientes acumuladas en el mes. Vuelve a cero al cambiar de período |
| `periodoInteraccion` | período en que esta conversación ya sumó su interacción |

**Por qué el contador se calcula y no se incrementa.** Dentro de la transacción
el valor leído es el que vale; calcularlo garantiza que el número guardado y la
decisión que se tomó con él no puedan discrepar. Y **todo ocurre en la misma
transacción que ya existía**: si se escribiera la marca y fallara el contador, la
conversación quedaría contada y la cifra que se factura no.

**Por qué `personasAtendidas` y `atenciones` comparten `periodoContado`.** Hoy
disparan con el mismo hecho, porque el identificador de la conversación **es** el
teléfono (`wa_<telefono>`): una persona y una conversación son la misma cosa. Dos
marcas con el mismo valor solo podrían desincronizarse. Si alguna vez una persona
pudiera tener más de una conversación abierta, las dos cifras dejarían de
coincidir y ahí sí harían falta dos marcas.

**La decisión de contar es una función pura**, `contadoresDelMensaje` en
`functions/src/ingesta.ts`. Sobre estas cifras se factura y lo único que puede
equivocarse es esa decisión: aislada de Firestore se prueba el mes entero mensaje
por mensaje, sin emulador ni red. Las pruebas que sostienen la factura son las de
**cobrar de más**: la segunda conversación del mismo cliente en el mes no suma
otra atención, y la tercera y la cuarta respuesta no suman otra interacción.

**Quién puede tocarlo.** Los dos campos nuevos están en la lista blanca de
`conversacionValida()` y **fuera** de los campos de gestión interna, igual que
`periodoContado`. Ni el comercio ni NovuChat pueden mover la marca.

### 4bis.3 Habilitar y deshabilitar un comercio

**Suspender no es dar de baja.** Son cosas distintas y mezclarlas sale caro:

| | `suspendido` | `dado_de_baja` |
|---|---|---|
| Motivo típico | falta de pago | fin de contrato |
| El asistente atiende a los clientes finales | **no** | no |
| El comercio ve sus conversaciones, config y métricas | **sí** | no |
| El comercio edita algo | no | no |
| n8n escribe conversaciones nuevas | no | no |
| Claims de los usuarios | **intactos** | revocados |
| Cómo se revierte | un clic, instantáneo | hay que volver a invitar a cada usuario |

**Qué deja de funcionar exactamente al suspender:**

- La ingesta se cierra: la regla `tenantOperativo()` niega toda escritura de
  conversaciones, mensajes, datos privados y métricas.
- La edición se cierra: configuración, catálogo, contactos y gestión interna de
  los hilos.
- `configuracionFlujo` devuelve **409** con el estado y un `mensajeCortesia`.

**Qué sigue funcionando:** la lectura del panel. La regla `tenantLegible()`
admite `activo` y `suspendido`. El comercio sigue viendo sus conversaciones
históricas, su configuración y sus métricas. Son sus datos, y quitarle la vista
no ayuda a cobrarle: le quita la manera de verificar lo que se le factura.

**Qué hace n8n.** Al recibir el 409, envía el `mensajeCortesia` y corta el turno:

> Gracias por escribirnos. En este momento no podemos atenderle por este medio.
> Le pedimos comunicarse directamente con el negocio.

**PROHIBIDO revelarle al cliente final el motivo comercial.** Quien escribe por
WhatsApp es un tercero que no tiene nada que ver con la relación entre NovuChat y
el comercio. Un mensaje que diga o insinúe que el negocio debe dinero daña al
comercio, daña a NovuChat y no cobra la deuda. El motivo se guarda en
`motivoSuspension` y en `/auditoria`, y no sale de ahí.

**Por qué la suspensión no toca los claims.** Es lo que la hace inmediata **en
los dos sentidos**. Si suspender revocara los claims, reactivar exigiría
reemitirlos y que cada usuario renovara su token: el comercio que acaba de pagar
seguiría sin servicio un rato largo, que es justo el peor momento para hacerlo
esperar. Al depender solo del campo `estado`, que las reglas consultan en cada
operación, el corte y la reanudación son instantáneos en ambas direcciones.

**Auditoría.** `suspenderTenant` y `reactivarTenant` escriben en `/auditoria` con
quién, cuándo y con qué motivo, y `/auditoria` no es escribible desde ningún
navegador: nadie puede fabricar ni borrar el registro de una suspensión.

**Requisito para n8n: no cachear la configuración más de 60 segundos.** Una
palanca comercial con un caché de una hora no es una palanca.

### 4bis.4 Varios flujos y varios números

Habrá **al menos tres flujos** —Demo A (agendamiento), Demo B (venta y cobro) y
uno interno de NovuChat— y **cada comercio necesita su propio número**.

**El camino de resolución.** El webhook de Meta no trae el identificador del
comercio: trae `entry[0].changes[0].value.metadata.phone_number_id`.

```
Meta ──► n8n
          │  phone_number_id del payload
          ▼
        elige el secreto HMAC de ESE número, firma
          │
          ▼
   Cloud Function ──► /rutasWhatsApp/{phoneNumberId}
                        └─► { tenantId, flujo, wabaId, estado }
                              │
                              ▼
                        /tenants/{tenantId}/...
```

**Por qué una colección de índice inverso y no una consulta sobre `/tenants`.**
Un `where('waPhoneNumberId','==',id)` exigiría permiso de listado sobre la
cartera entera de clientes —justo lo que la amenaza T-12 prohíbe— y además un
índice compuesto. Acá el `phone_number_id` **es la clave del documento**: la
resolución es una lectura directa, sin índice y sin abrir ningún listado. Nadie
la lee desde el navegador salvo el propietario; n8n no la toca, la consulta la
Function con el SDK Admin **después** de validar la firma.

**El secreto HMAC pasó a indexarse por número, no por comercio.** Si se indexara
por comercio, n8n tendría que resolver número → comercio *antes* de poder firmar,
y para resolverlo necesitaría una credencial: un círculo. Indexando por número,
n8n toma el `phone_number_id` que ya viene en el payload, elige el secreto y
firma. **La propiedad que importa se conserva intacta: el comercio se deriva de
la clave que valida la firma, jamás del cuerpo de la petición.** Solo cambió el
paso intermedio.

**Unicidad.** `asignarNumero` corre en una transacción y rechaza asignar un
`phone_number_id` que ya apunta a otro comercio. Si un número pudiera apuntar a
dos, las conversaciones de uno se escribirían en el otro: una fuga de datos
provocada por un error de dedo, no por un atacante.

**Un comercio puede tener varios números**, uno por vertical: dos documentos en
`/rutasWhatsApp` con el mismo `tenantId` y distinto `flujo`. Y dos secretos HMAC
distintos, así que comprometer uno no alcanza al otro.

#### El techo de crecimiento del producto

Esto no es un detalle de implementación: es un límite comercial que conviene
tener escrito antes de prometerle plazos a un cliente.

| Límite | Valor | Consecuencia |
|---|---|---|
| Números por WABA, por defecto | **2** | alcanza para dos comercios, o para un comercio con dos verticales |
| Números por WABA, ampliado | **hasta 20** | requiere trámite y verificación de negocio ante Meta |
| Más de 20 | hacen falta **más WABA** | y cada WABA cuelga de un portafolio comercial |
| Portafolios por cuenta personal sin verificar | **2** | ya anotado como riesgo vivo en `ESTADO.md` |

Lecturas de producto:

- **Con una WABA verificada, el techo son 20 comercios** (un número cada uno). No
  es poco para empezar, pero se toca antes de lo que parece si algún comercio
  usa dos verticales.
- **El comercio número 21 no obliga a cambiar código: obliga a un trámite de
  Meta.** Los trámites de Meta se miden en días o semanas, no en horas, y no
  dependen de NovuChat. Hay que iniciar la verificación de negocio y la
  ampliación de números **mucho antes** de necesitarlas, no cuando ya hay un
  contrato firmado.
- Guardar `waWabaId` en la ficha del comercio permite contar cuántos cuelgan de
  cada WABA y ver venir el techo. Conviene una métrica de plataforma que lo
  muestre.
- Esto convive con la restricción ya conocida del número de prueba: hasta 5
  destinatarios registrados, que aplica a los demos y no a producción.

---

## 4ter. Modelo de acceso y funciones de relación con el comercio

### 4ter.1 Autenticación mixta por rol

| Quién | Proveedor | Y nada más |
|---|---|---|
| Superadministradores de NovuChat (Andres, Silvana) | **cuenta de Google** | sin contraseña |
| Administradores y operadores de comercio | **usuario y contraseña** | sin Google |
| Principal de ingesta (n8n) | **token personalizado** | sin acceso interactivo |

**El vínculo se impone en dos lugares, a propósito.**

*En las reglas*, dentro de los **predicados base** y no en cada `allow`:

```
function proveedor() {
  return request.auth.token.get('firebase', {}).get('sign_in_provider', '');
}
function esPropietario() { return ... && proveedor() == 'google.com'; }
function esAdmin(t)     { return ... && proveedor() == 'password' && correoVerificado(); }
function esIngesta(t)   { return ... && proveedor() == 'custom'; }
```

Meterlo en los predicados y no en cada regla es lo que lo vuelve **imposible de
eludir por olvido**: las 20 y pico de reglas del archivo pasan todas por
`esPropietario`, `esAdmin`, `esOperador` o `esIngesta`. Una regla nueva hereda el
vínculo sin que su autor tenga que acordarse. Y `esMiembro` se define
*componiendo* esos predicados —no volviendo a leer `rolEn`— justamente para no
abrir el agujero.

`sign_in_provider` viaja **dentro del ID token firmado por Google**: dice con qué
proveedor se abrió *esta* sesión y el cliente no lo puede alterar.

*En la Cloud Function* (`claims.ts`), antes de otorgar cualquier rol: se
comprueba `providerData` de la cuenta destino y se exige **una identidad, un
proveedor**. No basta con tener el proveedor correcto: se rechaza también la
cuenta vinculada con los dos. Las reglas ya neutralizarían ese caso, pero una
identidad ambigua es una fuente permanente de razonamientos equivocados sobre
quién puede qué. Un estado imposible no hay que explicarlo.

Quitar un rol nunca se bloquea por el proveedor: si hay que sacarle el acceso a
alguien, se le saca, y no importa cómo entró.

El ataque concreto que esto impide está en `SEGURIDAD.md`, T-19.

#### Qué queda cubierto y qué no, sin dar nada por hecho

| Control | ¿Cubierto? | Con qué |
|---|---|---|
| **Verificación de correo antes del primer acceso** | ✅ **sí, y de verdad** | `correoVerificado()` en las reglas: sin verificar, el servidor niega los datos. No es un aviso de la interfaz que se saltee recargando. Gratis. |
| **Recuperación de contraseña** | ✅ sí | `sendPasswordResetEmail`. Gratis. |
| **Protección contra enumeración de usuarios** | ✅ sí | opción de Firebase Auth, activada por defecto en proyectos nuevos, más mensajes de error genéricos en la pantalla de ingreso. Gratis. |
| **Longitud mínima de contraseña** | ⚠️ parcial | Firebase Auth impone **6 caracteres**. El formulario pide 12, pero **eso es del navegador y se saltea**. Una política real —longitud, tipos de carácter, contraseñas filtradas— es *password policy*, y eso **exige Identity Platform**. |
| **Límite de intentos / bloqueo de cuenta** | ⚠️ parcial | Firebase Auth tiene protección anti-abuso por IP, **no configurable y no documentada como garantía**. Un límite real por cuenta **exige Identity Platform**. Mitigación gratuita mientras tanto: **App Check con reCAPTCHA Enterprise** en el flujo de ingreso. |
| **Segundo factor para cuentas de contraseña** | ❌ **no** | MFA **exige Identity Platform**. Los superadministradores sí lo tienen, porque el segundo factor de su cuenta de Google lo administra Google. |

**Sobre el costo de Identity Platform, con honestidad:** GCIP tiene un nivel
gratuito de usuarios activos mensuales y por encima cobra por usuario activo; la
MFA por SMS se cobra aparte, por mensaje. **No verifiqué la tarifa vigente y no
la voy a inventar: hay que confirmarla en la consola antes de decidir.** Lo que
sí se puede afirmar con el volumen de NovuChat —decenas de administradores de
comercio, no decenas de miles— es que **el consumo caería con holgura dentro del
nivel gratuito**, así que la decisión debería tomarse por la MFA y la política de
contraseñas, no por el precio.

**Y un detalle que cambia el orden de los pasos: activar Identity Platform sobre
un proyecto es un cambio que conviene hacer al crear `novuchat-admin-prod`, no
después.** Es de las cosas que se vuelven incómodas con clientes ya adentro.

**Mientras no se active**, el riesgo residual concreto es: una contraseña de
administrador de comercio, sin segundo factor y con política de 6 caracteres,
protege las conversaciones de **un** comercio. El aislamiento multi-tenant es lo
que evita que ese riesgo escale, y el vínculo con el proveedor es lo que evita
que escale a la plataforma. No es lo ideal, pero está acotado y dicho.

### 4ter.2 Estado de cuenta visible para el comercio

`/tenants/{t}/cuenta/estado`: plan, situación de pago, monto, próximo
vencimiento y `motivoVisible`.

- **Solo lectura para el comercio.** Lo escribe NovuChat con
  `actualizarEstadoCuenta`, y queda auditado. Si el comercio pudiera escribirlo
  se pondría "al día" y el documento dejaría de significar nada.
- **Lo lee el admin, no el operador.** La situación financiera del negocio no es
  asunto de quien atiende el chat.
- **Se lee con `tenantLegible`, no con `tenantOperativo`**, así que **un comercio
  suspendido sigue viendo esta pantalla**. Es la coherencia que faltaba: si el
  comercio conserva la vista de sus datos, tiene que ver también *por qué* se le
  cortó el servicio. Un corte sin explicación visible es una llamada de reclamo
  garantizada.
- `suspenderTenant` y `reactivarTenant` escriben acá además de en la ficha, para
  que las dos pantallas no puedan contradecirse.

**Tres textos, tres públicos. No confundirlos:**

| Campo | Quién lo lee | Qué dice |
|---|---|---|
| `cuenta.motivoVisible` | el **comercio**, en el panel | su situación. Es su relación comercial y tiene derecho a conocerla |
| `tenant.motivoSuspension` | **NovuChat**, auditoría | el registro interno |
| `mensajeCortesia` | el **cliente final** por WhatsApp | neutro. **Jamás menciona pagos** (T-18) |

### 4ter.3 Contador de personas atendidas, visible para el comercio

La pantalla de Uso muestra `personasAtendidas` por mes, junto con mensajes y
citas. El conteo de únicos ya estaba diseñado (§4bis.2); lo nuevo es exponerlo.

**Un defecto real que apareció al probarlo:** la consulta original usaba
`orderBy('__name__', 'desc')` y **Firestore no lo admite** — *"does not support
descending key scans"*. Habría fallado en producción la primera vez que alguien
abriera la pantalla. Se reemplazó por la lista explícita de los últimos doce
períodos con `where(documentId(), 'in', [...])` —el tope de `in` es 30— y el
orden se hace en el cliente. Una sola ida y vuelta, sin índice compuesto.

Nadie escribe `/metricas` desde el navegador, **ni el comercio ni NovuChat**: la
métrica que se factura no la toca ninguna de las dos partes interesadas.

### 4ter.4 Reclamos que llegan por correo

`/tenants/{t}/reclamos/{id}`. El comercio crea y lee; **nadie edita ni borra**.
Un reclamo editable no sirve para dirimir nada.

**Se guarda primero y se avisa después.** Un disparador `onDocumentCreated`
manda el correo. Si el proveedor está caído, el reclamo no se pierde: queda en
Firestore y se ve en el panel de NovuChat igual. **El correo es una
notificación, no el registro.** La columna "Aviso" de la pantalla muestra si el
correo salió; sin ella, un canal de correo caído sería invisible durante semanas.

**Un comercio suspendido puede reclamar.** Sería absurdo cortarle el canal justo
cuando tiene el motivo más probable para usarlo.

#### El texto no puede llegar como marcado, y eso se garantiza en origen

Un correo HTML con el texto del reclamo interpolado es **inyección de HTML
directa**: enlaces de phishing que parecen de NovuChat, imágenes remotas que
confirman lectura, CSS que oculta contenido para que el destinatario lea una cosa
distinta de la que está escrita.

El argumento no cambió con el proveedor; **el lugar donde se aplica, sí**. Con
Resend bastaba mandar `text` y omitir `html`. Con FormSubmit el correo lo compone
el tercero, así que el texto sale ya **escapado desde acá** (ver «Lo que SÍ
cambia», más abajo).

Además: el **asunto se limpia de CR, LF y NUL** antes de usarse. Un salto de
línea en un asunto permite inyectar encabezados propios —un `Bcc:` hacia otra
casilla— y desviar una copia del correo. Es un ataque viejo que sigue
funcionando, y tiene prueba propia en `pruebas/saneo.test.ts`.

#### Proveedor de correo: FormSubmit por ahora, Resend después

**Decisión de Andres (2026-08-29): FormSubmit.**

El motivo es de calendario y de superficie. Faltan diez días para el
congelamiento del 8 de septiembre, los reclamos son **internos** —los leen solo
Andres y Silvana— y **FormSubmit no necesita credencial**. En un repositorio
público eso es una preocupación menos: no hay `RESEND_API_KEY` que guardar en
Secret Manager, ni que rotar, ni que se pueda filtrar en un commit.

| Opción | A favor | En contra |
|---|---|---|
| **FormSubmit** *(elegida ahora)* | **sin credencial**: nada que custodiar ni rotar. Alta inmediata, sin dominio propio ni DNS | el correo lo compone un tercero (ver abajo), sin contrato ni acuerdo de tratamiento de datos, y el destino es una dirección sin autenticación |
| **Resend** *(destino previsto)* | nosotros componemos el correo: `text` sin `html`, garantía absoluta. Dominio propio con SPF y DKIM | exige credencial en Secret Manager y verificación de dominio: días de trámite que hoy no hay |
| Postmark | mejor entregabilidad | de pago desde el primer correo |
| SendGrid | veterano, nivel gratuito | revisiones de cuentas nuevas que dejan el canal mudo sin aviso |
| Amazon SES | el más barato | salir del *sandbox* y meter una **segunda nube** en un proyecto que ya tiene tres |

**Cuándo pasar a Resend, y qué cambiar.** Cuando haya clientes reales y dominio
propio. El cambio está acotado a `functions/src/reclamos.ts`:

1. Declarar `RESEND_API_KEY` con `defineSecret` y agregarla a `secrets` de la
   función. Es el único secreto nuevo del proyecto.
2. Cambiar el punto final y el cuerpo: `{ from, to, subject, text }`, **con
   `text` y sin `html`**.
3. Verificar el dominio remitente (SPF y DKIM) antes del primer envío, o los
   correos van a spam. Es un paso de DNS, no de código.
4. **Se puede aflojar el escapado de entidades** de `neutralizar()`, porque con
   Resend la garantía de texto plano vuelve a ser nuestra. Conviene **no
   hacerlo**: no cuesta nada y protege de un cambio futuro de renderizado.
5. `neutralizarEncabezado`, la validación del destino, el destino fuera del
   reclamo y el guardado previo en Firestore **no cambian**. Las pruebas de
   `pruebas/saneo.test.ts` siguen valiendo tal cual.

#### Lo que NO cambia con el proveedor

Las tres propiedades del diseño no dependen de quién manda el correo:

1. **El texto se entrega sin posibilidad de interpretarse como marcado.**
2. **El destinatario sale de `/plataforma/notificaciones`**, jamás del reclamo.
3. **El reclamo se guarda en Firestore antes de enviarse**, con la columna de
   avisos no notificados en la pantalla.

#### Lo que SÍ cambia, y es lo importante

Con Resend, **NovuChat componía el correo**: se mandaba `text`, se omitía `html`,
y la garantía de "nada interpretable" era nuestra y absoluta.

**Con FormSubmit el correo lo compone el tercero, y lo compone en HTML.** Ya no
controlamos el renderizado. La consecuencia práctica es que **la neutralización
tiene que hacerse en origen**, antes de que el texto salga del sistema: por eso
`neutralizar()` escapa las entidades HTML (`&`, `<`, `>`, `"`, `'`) además de
limpiar los caracteres de control.

Si FormSubmit lo renderiza como HTML, se lee el texto literal. Si lo renderiza
como texto plano, se leen las entidades escritas: feo y raro —un reclamo casi
nunca trae un `<`— y muy preferible a que un enlace escrito por otra persona
llegue vivo a una bandeja de entrada.

**Campos especiales de FormSubmit.** `_cc`, `_replyto`, `_next`, `_subject`,
`_template` y `_captcha` cambian el comportamiento del servicio. Si los campos
del reclamo se volcaran al cuerpo de la petición con un *spread*, **un reclamo
con un campo `_cc` desviaría una copia del correo**: es la inyección de
encabezados con otro disfraz. Dos defensas, las dos probadas: la regla de
Firestore tiene lista blanca de claves y no los deja entrar, y la función arma el
cuerpo **campo por campo**, sin ningún *spread*.

**Menos texto sale hacia el tercero.** El aviso lleva como máximo **1000
caracteres** del reclamo; el texto completo queda en Firestore y el correo lo
dice. Es minimización de datos, no una limitación técnica, y es coherente con
que el correo sea una notificación y no el registro. Ver `SEGURIDAD.md`, T-22.

#### El destino del correo nunca sale del reclamo

Los destinatarios se leen de `/plataforma/notificaciones`, que **ninguna sesión
de navegador puede escribir**. Es el control central: si el texto de un reclamo
pudiera influir en a dónde va el correo, el sistema sería un **reenviador** —
alguien escribe lo que quiera y lo hace salir, firmado por NovuChat, hacia donde
quiera. La lista blanca de claves del reclamo existe justamente para que no haya
un campo `destinatario` por donde entre esa idea. Hay una prueba que lo verifica.

---

## 4quater. Bitácora y configuración como fuente de verdad

### 4quater.1 Bitácora: colección nueva, no extensión de `/auditoria`

`/tenants/{t}/bitacora/{eventoId}`. Las dos son inmutables y las dos son
evidencia, pero responden preguntas distintas y **crecen a ritmos distintos**:

| | `/auditoria` | `/bitacora` |
|---|---|---|
| Pregunta | quién cambió qué | qué hizo el sistema |
| Volumen | decenas por año | varios por cada mensaje |
| Retención | años | meses |
| Se lee | entera, de un vistazo | con filtros y paginación |

Mezclarlas tendría tres costos concretos: la pista de auditoría —la que se mira
cuando hay una disputa— quedaría ahogada en ruido de entregas; toda consulta
sobre `/auditoria` pasaría a costar lo que cuesta recorrer la bitácora; y los
índices compuestos que la bitácora necesita se aplicarían a una colección que no
los usa, pagándolos en cada escritura.

**No guarda el texto de los mensajes.** Solo tipo, resultado, código, latencia,
tamaño y el teléfono **enmascarado** (`5917****001`). El motivo es de coherencia:
ya está decidido que el propietario de NovuChat no lee conversaciones sin una
ventana de soporte otorgada por el comercio (T-5). Si la bitácora llevara el
texto sería exactamente esa puerta trasera, y peor: consultable entre todos los
comercios a la vez. Cuando hace falta el texto, la bitácora lleva
`conversacionId` y el camino sigue siendo el de siempre.

El enmascarado no es una convención: **la regla exige el patrón con asteriscos**,
así que un número completo se rechaza en el servidor.

**Quién la lee:** el administrador del comercio y el propietario. El operador
queda afuera — ya tiene la vista de conversaciones, que es la misma información
con más contexto. Se lee con `tenantLegible`, así que un comercio suspendido
conserva su evidencia; y **se escribe aunque esté suspendido**, porque la
evidencia no puede tener agujeros justo en el tramo del corte de servicio. Se
puede permitir precisamente porque no hay contenido personal acumulándose.

#### Filtros, índices y la trampa que el emulador no detecta

**El emulador de Firestore no exige índices compuestos: responde cualquier
consulta.** El servicio real rechaza con «The query requires an index». O sea que
una pantalla de filtros puede pasar todas las pruebas locales y romperse la
primera vez que alguien la usa en producción.

La defensa es estructural: las formas de consulta se declaran en
`web/src/lib/bitacora.ts`, y de ahí salen **dos cosas** — la consulta que arma la
pantalla y la prueba `pruebas/indices.test.ts`, que verifica que cada forma tenga
su índice. La pantalla no puede construir una consulta que la prueba no haya
visto, porque leen la misma lista.

| Filtros | Alcance | Índice |
|---|---|---|
| solo fechas | un comercio | automático (un solo campo) |
| tipo + fechas | un comercio | `(tipo ASC, ts DESC)` |
| resultado + fechas | un comercio | `(resultado ASC, ts DESC)` |
| tipo + resultado + fechas | un comercio | `(tipo, resultado, ts DESC)` |
| las cuatro anteriores | todos | idem, con alcance `COLLECTION_GROUP` |

El rango de fechas no agrega requisitos: es un rango sobre **el mismo campo** por
el que se ordena.

**Filtrar «por comercio» no es un `where`**: es consultar la subcolección de ese
comercio. Así el tenant sigue viviendo en la ruta y no en un campo (T-2). En la
vista de todos, a qué comercio pertenece cada fila sale del *path*.

**⚠️ Y una trampa que sí costó encontrar:** una consulta de grupo de colecciones
**no la autoriza la regla anidada**. Firestore la evalúa contra otro patrón y
hace falta una regla con comodín recursivo. No lo detectó ninguna de las 137
pruebas anteriores: apareció al abrir la pantalla. El comodín está acotado a
`esPropietario()` y **solo a la bitácora** — uno equivalente sobre
`conversaciones` sería la puerta trasera a T-5.

**Paginación por cursor** (`startAfter`, 50 por página), no por desplazamiento
numérico, que en Firestore obliga a leer y pagar todos los documentos salteados.

### 4quater.2 La configuración del comercio como fuente de verdad

El panel manda, n8n consulta. Eso convierte esta pantalla en **la superficie por
donde entra lo que el asistente va a afirmar como verdad ante un cliente final**,
y la validación deja de ser higiene para ser el único punto donde se puede frenar
un dato antes de que salga por WhatsApp.

**Tres clases de campo, y la diferencia importa:**

| Clase | Campos | Por qué |
|---|---|---|
| **Enumerados** | `tratamiento`, `estiloEmojis`, `zonaHoraria`, `moneda` | lista cerrada; el código los traduce a una frase fija |
| **Texto libre al prompt** | `nombreNegocio`, `descripcion`, `direccion`, `politicaCancelacion`, `datosQueNoTenemos`, `instruccionesExtra`, `mensajeCierre`, `mensajeErrorTemporal`, `mensajeReservaNoConfirmada`, `mensajeComercioSuspendido` | topeados y entregados en una sección rotulada |
| **Derivados, NO almacenados** | `horarioAtencion`, `estadoComercio`, `phoneNumberId` | los calcula `configuracionFlujo` |

**Los enumerados son la decisión más fuerte de este bloque.** `tratamiento` y
`estiloEmojis` determinan la voz del agente, o sea que van *dentro* de sus
instrucciones: es inyección de prompt por diseño. En vez de intentar limpiar
texto libre, se elimina el texto libre. El valor del cliente **no se interpola en
ninguna parte**: solo selecciona cuál de nuestras frases se usa. Es la diferencia
entre elegir de un menú y escribir en el prompt. De paso cierra el defecto de
estilo de `ESTADO.md`: el agente alternaba «usted» y «tú» con el mismo cliente.

**Los derivados no se guardan, y eso es una defensa:**

- `estadoComercio` sale de la ficha del tenant. Si el comercio pudiera fijarlo,
  n8n lo leería de la configuración y **seguiría atendiendo pese a la
  suspensión**. Es el vector más serio del bloque.
- `phoneNumberId` sale del número que validó la firma HMAC. Guardado en la
  configuración, un comercio podría poner el de otro y **enviar mensajes en
  nombre de ese otro**.
- `horarioAtencion` se calcula desde `horarios`. Guardarlo además invitaría a que
  los dos valores se separaran y a que el agente anunciara un horario que la
  pantalla no muestra.

Las reglas los rechazan por lista blanca **y** `configuracionFlujo` nunca los lee
de la configuración aunque aparecieran. Dos barreras, a propósito.

### 4quater.3 `direccion` y `datosQueNoTenemos`: el incidente del 28/08

Ante «¿dónde queda su clínica?» el agente **inventó una dirección** —zona y
avenida— que no figuraba en ninguna parte. Para una demo comercial es el peor
defecto posible: un cliente podría presentarse en un lugar que no existe.

**`direccion` es opcional a propósito.** Obligarla tentaría a rellenarla con
cualquier cosa para poder guardar, y un dato inventado por el comercio hace el
mismo daño que uno inventado por el modelo. **Vacía significa «no la tenemos»**,
que es una respuesta correcta y verificable.

**`datosQueNoTenemos` se calcula, no se declara.** `configuracionFlujo` la computa
desde los campos que están efectivamente vacíos —dirección, teléfono de
recepción, calendario, horarios, política de cancelación— y le suma los que el
comercio agregó a mano. **Los computados no se pueden quitar desde el panel.**

El porqué: si dependiera de que el comercio se acuerde de escribir «no tenemos
dirección cargada», el olvido más probable del mundo —no cargar la dirección y
tampoco declarar que falta— devuelve exactamente el incidente. **La ausencia de
un dato es un hecho verificable; pedir que alguien la declare es pedirle que se
acuerde de lo que no hizo.**

### 4quater.4 `mensajeComercioSuspendido` y una propiedad emergente

Lo escribe el comercio: es su voz ante sus clientes. Pero como **toda escritura
de configuración exige `tenantOperativo`**, nadie puede redactarlo *después* de
que lo suspendieron. O se prepara antes, o rige el texto neutro de la plataforma.
No fue diseñado así: es una consecuencia de que la suspensión cierre las
escrituras, y conviene que quede escrita porque es deseable.

---

## 4quinquies. Funcionarios y agenda por persona

### 4quinquies.1 El problema

El modelo asumía **un calendario por comercio**, y eso produce un error visible:
una cita de manicure a las 11:30 bloquea una de ortodoncia a las 11:30, cuando
las atienden personas distintas. Lo que hay que impedir es que **un mismo
funcionario** tenga dos citas simultáneas, no que el comercio tenga dos.

`/tenants/{t}/funcionarios/{id}`: nombre, especialidad, `calendarioId`,
`horarioTrabajo` —que puede diferir del horario del comercio, y ahí está la mitad
de la gracia: el salón abre de 9 a 19 pero el odontólogo va martes y jueves de 14
a 18—, `servicios` y `activo`.

**Datos personales de un tercero que no es el cliente final.** Teléfono y correo
van en `/funcionarios/{id}/privado/datos`, con el mismo criterio que los
contactos y los datos ampliados de conversaciones: las reglas no pueden ocultar
campos sueltos en una lectura, así que lo que un rol no debe ver va en otro
documento. **El operador ve quién atiende qué —lo necesita para contestar— pero
no el teléfono personal de la manicurista, que no necesita para nada.**

La baja es **lógica** (`activo: false`), nunca borrado: un funcionario borrado
dejaría citas pasadas apuntando a un identificador que ya no existe.

### 4quinquies.2 Servicio ↔ funcionario: denormalizado de un solo lado

Un servicio lo atienden varios funcionarios y un funcionario atiende varios
servicios. Se resuelve con una lista `servicios: [idDeCatalogo]` **en el
funcionario**, y nada del otro lado.

**Por qué no hay consultas.** n8n tiene que resolver «quién puede atender una
limpieza facial» y «cuál es su calendario» de forma barata. La respuesta no es un
índice mejor: es **no consultar**. `configuracionFlujo` ya devuelve el catálogo;
ahora devuelve también los funcionarios activos. Son colecciones chicas —200
servicios y 50 funcionarios como tope— y traerlas enteras en la misma llamada
cuesta menos que cualquier consulta con índice por servicio. n8n cruza las dos
listas **en memoria**.

**Referencias colgadas.** Las reglas solo pueden comprobar que `servicios` es una
lista de hasta 50 elementos, no que esos identificadores existan. Un servicio
borrado del catálogo deja la referencia atrás. `resolverFuncionarios()` las
descarta contra los ids del catálogo, para que el agente no ofrezca un servicio
inexistente. Hay una prueba de eso.

### 4quinquies.3 Un solo funcionario tiene que ser trivial

Muchas PyMEs bolivianas son una persona sola. **La colección puede estar vacía.**
Si no hay ningún funcionario activo, `configuracionFlujo` fabrica uno por defecto
con el calendario y los horarios del comercio, y el flujo ve siempre una lista
con al menos un elemento.

Resultado: **el flujo tiene un solo camino de código** y el comercio de una sola
persona no configura nada. La complejidad la paga quien la necesita. Un
funcionario que se cargó sin calendario propio hereda el del comercio, por el
mismo motivo: nadie puede quedar sin agenda ninguna.

### 4quinquies.4 El candado contra la doble reserva

**Google Calendar no impide eventos superpuestos**: si dos clientes reservan a la
vez, crea las dos citas sin chistar. Y entre «consultar disponibilidad» y «crear
la cita» pasan segundos, que es tiempo de sobra. La garantía no puede vivir ahí.

`/tenants/{t}/agenda/{funcionarioId}_{aaaammdd}_{ranura}`. El día se parte en
ranuras de 15 minutos; una cita de 60 ocupa cuatro. El identificador es
determinista y la reserva se hace con `create` **dentro de una transacción**:
`create` falla si el documento ya existe, y la transacción hace que las cuatro
ranuras se tomen todas o ninguna. Eso es exclusión mutua de verdad, no una
comprobación previa.

**La superposición parcial queda cubierta** porque el choque no se busca por hora
de inicio —el reflejo natural, que dejaría pasar justamente ese caso— sino por
ranura: 11:00–12:00 y 11:30–12:30 comparten dos.

La ranura **no lleva datos personales**: ni teléfono ni nombre del cliente. Es un
candado, no un registro. No se actualiza —mover una cita es liberar y volver a
tomar, para que siga siendo atómico— y sí se borra al cancelar, porque si no el
horario quedaría bloqueado para siempre.

#### Lo que este diseño NO garantiza

Dicho sin adornos, porque es la parte que importa:

1. **El candado solo conoce las citas que pasaron por el asistente.** Si alguien
   del comercio carga una cita a mano en Google Calendar, esta colección no se
   entera y el choque vuelve a ser posible. Por eso el flujo **sigue consultando
   Calendar** antes de ofrecer horarios: Calendar cubre lo manual, el candado
   cubre la concurrencia. Ninguno de los dos alcanza solo.
2. **Firestore y Calendar pueden divergir.** La cita se crea en dos sistemas y no
   hay transacción entre ellos. Si el `create` en Calendar falla después de tomar
   la ranura, queda una ranura ocupada sin cita. Mitigación: liberar la ranura
   ante un fallo de Calendar, y una tarea de reconciliación pendiente.
3. **La granularidad de 15 minutos redondea hacia arriba.** Una cita de 5 minutos
   ocupa una ranura entera. Es deliberado —los turnos reales no son de 5
   minutos— pero hay que saberlo antes de prometer agendas al minuto.

### 4quinquies.5 El ID de calendario, validado en los dos lados

Es **el dato que más caro salió en este proyecto**: uno pegado a mano con un
carácter de menos hizo que Google devolviera 404 al crear, que el agente
confirmara igual, y que la lectura de disponibilidad fallara **en silencio** — el
agente pasó a inventar los horarios y llegó a ofrecer las 15:00 pisando una cita
de las 15:30. El síntoma no apuntaba a la causa por ninguna parte.

Ahora que habrá uno por funcionario cargado desde el panel, la validación está en
**el panel y en las reglas**, con las dos trampas que ya se aprendieron
escribiendo `scripts/fijar-calendario.sh`:

1. **Exactamente 64 hexadecimales.** No «32 o más». La primera versión de aquel
   script aceptaba un ID truncado, que es justo el caso que existía para impedir.
   *Un validador que no rechaza el caso que motivó escribirlo no valida nada.*
2. **El orden importa.** Un ID de calendario **tiene forma de correo**: si se
   prueba primero la forma de correo, un ID de grupo malformado cae ahí y pasa.
   En las reglas esa precedencia se expresa negando la segunda rama — lo que
   termina en `@group.calendar.google.com` se juzga únicamente con la regla
   estricta, sin red de rescate.

Vacío es válido y significa «sin agenda propia». Lo que no puede pasar es un
valor con forma equivocada, porque eso falla en silencio.

---

## 4sexies. Flujos, consola y usuarios: la política de capas

Con los dos demos operativos, el modelo ya no puede asumir agendamiento. El
problema no es agregar campos: es **agregarlos sin que el panel se convierta en
un formulario con la unión de todo**.

### 4sexies.0 La política (registrada el 2026-09-06, a pedido de Andres)

El producto tiene **tres capas**:

| Capa | Qué es | Dónde vive |
|---|---|---|
| **FLUJOS** | Lo que corre en n8n: reservas (A), pedidos y cobro (B), y los que vengan | `Flujos/*.json` |
| **CONSOLA** | Donde el negocio carga lo que el asistente va a afirmar como verdad | `admin/web` + `firestore.rules` |
| **USUARIOS** | Los negocios clientes, con su gente y sus roles | `/tenants/{id}`, claims |

Y cuatro reglas que se aplican a **todo flujo nuevo**:

1. **Un negocio tiene uno o más flujos.** Se guardan como lista en
   `tenants/{id}.flujos`. `vertical` (valor único) queda como el flujo
   principal y como respaldo de las fichas anteriores a la lista; cuando las
   dos cosas están, **manda la lista**. Cada flujo del negocio corre en SU
   número de WhatsApp (`/rutasWhatsApp`, §4bis.4): dos flujos en un mismo
   número exigirían un enrutador que hoy no existe.
2. **Lo común no se repite por flujo.** Identidad, dirección, horarios, voz
   del asistente, mensajes fijos, catálogo, usuarios, contraseña, consumo,
   conversaciones, reclamos y bitácora son de cualquier negocio, tenga el flujo
   que tenga. Viven en `/config/negocio` y en las colecciones comunes, y sus
   pantallas se muestran siempre.
3. **Lo propio de un flujo es excluyente y trae su pestaña.** Reservas
   necesita agendas por persona; pedidos necesita costos de entrega y un QR.
   Un negocio de pedidos no ve —ni puede escribir— la agenda, y al revés. Cada
   flujo con parámetros propios tiene: su documento `/config/{flujo}` con lista
   blanca propia en las reglas, su línea en la tabla de capacidades
   (`tieneAgenda`, `tieneCobro`), su entrada en `web/src/lib/flujos.ts` con las
   pestañas que agrega, y su rama en `documentoDeVertical` (`prompt.ts`).
4. **La consola habilita pestañas por flujo, no por negocio.** El menú se
   arma con las pestañas comunes más las de cada flujo de la lista. Y es
   cosmético: quien cierra la puerta es la regla, que lee la misma lista.

**Cómo se revisa un flujo nuevo** (la lista de control, en orden):

1. Abrir su nodo `Config del negocio` y anotar cada parámetro.
2. Clasificar cada uno: ¿lo tendría cualquier negocio? → común, va a
   `/config/negocio` (si no está, se agrega a SU lista blanca). ¿Solo tiene
   sentido con este flujo? → propio.
3. Si hay parámetros propios: documento `/config/{flujo}`, función
   `config{Flujo}Valida()` en las reglas, línea en la tabla de capacidades,
   `altaTenant`/`asignarNumero` crean el documento, `documentoDeVertical` lo
   nombra, `flujos.ts` declara la pestaña, y una pantalla la dibuja.
4. Si hay colecciones propias (como `funcionarios`), su regla exige la
   capacidad del flujo, no el rol solo.
5. Pruebas: el negocio CON el flujo escribe; el negocio SIN el flujo no puede,
   ni con la petición armada a mano; un negocio con varios flujos escribe
   todos los suyos.
6. Semillas y `sembrar-demos.mjs` escriben `flujos`.
7. Si el flujo todavía no lee la consola (`configuracionFlujo`), lo que se
   muestre tiene que ser lo que el flujo usa de verdad, y el resto se anota
   como deuda en `ESTADO.md`. Prometer un campo que el asistente ignora es
   peor que no ofrecerlo.

### 4sexies.1 Qué es común y qué depende del flujo

| | Común a cualquier negocio | Reservas y citas (`agendamiento`) | Pedidos y cobro (`venta`) |
|---|---|---|---|
| **Documento** | `/config/negocio` | `/config/agendamiento` | `/config/venta` |
| **Contiene** | identidad, dirección, horarios, voz del asistente, mensajes fijos, política de cancelación, calendario del negocio (por historia) | duración por defecto, anticipación mínima y máxima, recordatorios, cancelación | costo de envío, recargo de flota, pedido mínimo, radio, tiempos de cocina y despacho, `mediaIdQr` (solo NovuChat) |
| **Colecciones propias** | catálogo, contactos, conversaciones, bitácora, miembros | funcionarios | — |
| **Pestañas en la consola** | Configuración, Servicios/Productos, Conversaciones, Usuarios, Contactos, Consumo, Cuenta, Reclamos, Bitácora, Mi cuenta | **Agenda** | **Pedidos y cobro** |

El **catálogo con precios es común**: el Demo A lo usa para servicios con
duración y el Demo B para productos. Es el mismo concepto y ya estaba modelado.

### 4sexies.2 Tres documentos, no uno con la unión de todos los campos

Podría haber sido un solo documento grande con todo opcional. No lo es, por tres
razones en orden de importancia:

1. **La validación queda por documento, con su propia lista blanca.** Un esquema
   único obligaría a escribir «si el vertical es X entonces el campo Y es
   válido» dentro de las reglas de Firestore — exactamente el tipo de condición
   que se rompe al agregar el tercer vertical.
2. **El comercio no puede escribir el documento que no le toca.** La regla ata el
   documento a la lista `flujos` de la ficha del tenant, que el comercio no
   escribe. Un salón de belleza **no puede** fijar el recargo de flota. Eso no se logra
   escondiendo el campo en la pantalla: esconder no protege de nada, porque la
   petición se construye igual desde la consola del navegador.
3. **La pantalla no necesita lógica de ramas.** Lee el documento común y el de su
   vertical. `ConfiguracionVertical` tiene una tabla de campos por rubro y no un
   solo `if` de negocio.

Las capacidades viven en una tabla —`tieneAgenda`, `tieneCobro`— y no en
condiciones dispersas: **agregar el vertical interno de NovuChat es tocar dos
líneas**, no cazar condicionales por el archivo.

### 4sexies.3 Los rótulos del cobro simulado NO los edita el comercio

**Coincido con el criterio de Andres, y iría más lejos.** No solo no debe
editarlos libremente: no debe poder editarlos en absoluto, y ni siquiera deben
existir por comercio.

Los rótulos —el texto impreso en el QR, el epígrafe y la confirmación— viven en
`/plataforma/cobroSimulado`, son de NovuChat y son **los mismos para todos**.
Ningún navegador los escribe, tampoco el del propietario. La razón: sostienen la
prohibición 3 de `CLAUDE.md`, que es una regla del proyecto y no una preferencia
del cliente. Un comercio podría querer sacar «SIMULACRO» porque «queda feo en la
demo», y ese es precisamente el caso que hay que impedir — no con una advertencia
en la pantalla, sino haciendo que el campo no exista.

**Y `mediaIdQr` tampoco lo escribe el comercio**, aunque parezca un identificador
técnico inocente. Apunta a la **imagen**, y la imagen lleva el rótulo impreso:
quien pueda cambiarlo sube un QR sin rotular y saltea la prohibición **sin editar
un solo texto**. Es el camino que no salta a la vista y es el que había que
cerrar. Lo registra NovuChat, lo cual además es coherente con el hallazgo 19 —un
media ID queda ligado al número que lo sube— y el número también lo asigna
NovuChat.

**El sistema falla hacia el rótulo.** Si el documento de plataforma faltara,
rigen los textos de respaldo del código; una cadena vacía tampoco sirve para
borrar un rótulo. Sin `mediaIdQr` no se envía QR, que es lo correcto: mejor no
mandar nada que mandar una imagen sin rotular.

Lo que el comercio **sí** decide es lo comercial: cuánto cobra de envío, cuánto
recarga por flota, cuánto tarda y desde qué monto entrega.

### 4sexies.4 Una consecuencia que conviene conocer

El documento de venta mezcla campos del comercio con campos de NovuChat, y la
validación usa `affectedKeys`. Por lo tanto **un `setDoc` con el objeto completo
se rechaza**: reemplazar el documento borraría `mediaIdQr`, y borrar también es
afectar. La pantalla usa `updateDoc`. Es deliberado — sin eso, el camino más
natural del programador desarmaría en silencio el control de la prohibición 3— y
hay una prueba dedicada a ese caso exacto.

---

## 4septies. El ayudante de configuración (NovuChat-Helper)

El panel está bien construido y sigue siendo difícil. La persona que mejor
conoce el negocio —la dueña de la peluquería, el del restaurante— no es la que
mejor se lleva con un formulario de veinte casillas, y es la única que sabe si
el envío cuesta 8 o 12 bolivianos. El ayudante existe para cerrar esa brecha:
**una conversación que pregunta lo que la persona sí sabe y traduce a lo que el
formulario necesita**.

Es una prestación de plan, no una parte del producto base: se llama
**NovuChat-Helper** y va con **Crecimiento** y **Pro**.

### 4septies.0 Es CONSOLA, no un flujo, y la distinción no es cosmética

La política de capas (§4sexies) obliga a clasificar todo lo nuevo. El ayudante
es **capa CONSOLA**: no corre en n8n, no atiende a ningún cliente final, no
tiene número de WhatsApp y no toca `tenants/{id}.flujos`. Por lo tanto **no**
lleva documento `/config/{flujo}`, **no** entra en `FLUJOS` de
`web/src/lib/flujos.ts` y **no** agrega una línea a la tabla de capacidades de
las reglas.

Vale la pena decirlo con todas las letras porque la tentación es exactamente la
contraria: «un asistente de IA, como los otros, hagámoslo un flujo». Si se
modelara como flujo, un negocio podría tener «ayudante» sin tener reservas ni
venta —un negocio sin asistente de WhatsApp y con ayudante de configuración, que
no significa nada— y la pestaña se habilitaría por lista de flujos en vez de por
plan, que es lo que de verdad la gobierna.

El ayudante es **transversal**: sirve a cualquier negocio, tenga el flujo que
tenga, y lo que cambia con el flujo es **qué campos ofrece**, no si existe.

### 4septies.1 La decisión central: el modelo propone, el navegador escribe

Tres arquitecturas posibles, y la elección determina todo lo demás.

| | Quién escribe en `/config` | Qué valida esa escritura |
|---|---|---|
| (a) La Function con el SDK Admin | la Function | lo que la Function recuerde comprobar |
| (b) El modelo, con herramientas de escritura | la Function, a pedido del modelo | ídem, y encima de forma no determinista |
| **(c) El navegador, con el token del admin** | **el navegador** | **`firestore.rules`, sin cambios** |

**Se elige (c).** El SDK Admin **se salta las reglas por diseño** (§4.3, y por eso
cada Function vuelve a comprobar el permiso a mano). Una Function que escriba
la configuración crea un **segundo camino de escritura** que esquiva la lista
blanca de campos, los topes, `tenantOperativo()` y la protección de `mediaIdQr`
—o sea, esquiva todo §4sexies.3— y a partir de ahí las reglas dejan de ser la
única puerta. Ese es el precio real de (a) y (b), y no se paga.

Con (c), la aplicación de un cambio es **el mismo `updateDoc` que hace hoy la
pantalla de configuración**, con el token del mismo administrador. De ahí sale
la propiedad que sostiene todo el resto del diseño:

> **El radio de daño del ayudante es exactamente el del formulario que ya
> existe, ni un byte más.** Lo peor que puede lograr un ayudante roto,
> engañado o alucinado es escribir en las casillas que ese administrador ya
> podía escribir a mano, con los mismos topes y las mismas listas blancas.

Consecuencia práctica: **la Function del ayudante no necesita permiso de
escritura sobre `/config`**. Lee (ficha, configuración, catálogo, funcionarios),
llama al modelo y devuelve texto y una propuesta. No escribe la configuración
nunca. Y por lo tanto tampoco hace falta auditar «qué más podría escribir»: no
puede escribir.

### 4septies.2 Dos aprobaciones, y la propuesta como documento

El pedido de Andres —«se escribe cuando aprueba el resumen, se aplica cuando
acepta la aplicación»— son dos actos distintos y conviene que el sistema los
trate como tales.

```
   conversación          RESUMEN            APLICACIÓN
   ────────────►   ┌──────────────┐   ┌──────────────────┐
   nada se guarda  │ el admin lo  │   │ el admin lo      │
   salvo la sesión │ aprueba      │   │ acepta           │
                   │      ↓       │   │        ↓         │
                   │ /propuestas/ │   │ updateDoc sobre  │
                   │ estado:      │──►│ /config/{doc}    │
                   │ 'aprobada'   │   │ estado:'aplicada'│
                   └──────────────┘   └──────────────────┘
```

**Por qué dos pasos y no uno.** Aprobar un resumen dentro de un chat es un acto
de *lectura*; aplicar es un acto de *operación*. Separarlos le da al
administrador un momento en el que el cambio ya existe, está escrito, se puede
releer con calma —y todavía **no cambió nada**. También separa la evidencia: la
propuesta dice qué se propuso y la configuración dice qué quedó. Si dentro de
seis meses un precio está mal, se puede saber si lo propuso el ayudante, si lo
propuso y el administrador lo editó, o si nunca pasó por acá.

**Modelo de datos.** Dos colecciones nuevas bajo el tenant:

```
/tenants/{tenantId}
   /ayudante/{sesionId}        la conversación. Vence a los 30 días.
   /propuestas/{propuestaId}   el resumen aprobado. INMUTABLE, no vence.
```

Forma de la propuesta —y la forma importa, porque de ella depende que las
reglas la puedan validar:

```jsonc
{
  "sesionId": "...", "estado": "aprobada",       // aprobada | aplicada | descartada
  "creadaEn": <ts>,  "creadaPor": "<uid>",
  "valores":  { "negocio": { "direccion": "...", "numeroRecepcion": "..." },
                "venta":   { "costoDelivery": 10 } },
  "previos":  { "negocio": { "direccion": "" } }, // solo para mostrar el antes
  "base":     { "negocio": <ts de actualizadoEn al armar la propuesta> },
  "resumen":  "texto del ayudante, topeado",
  "modelo":   "claude-opus-5", "catalogo": 3      // versión del catálogo de campos
}
```

**Un mapa por documento, y no una lista de cambios.** La forma natural sería
`cambios: [{documento, campo, antes, despues}]`, y es la que **no se puede
validar**: las reglas de Firestore no iteran arreglos. Con un mapa por documento
la validación es la que el archivo ya sabe escribir —
`d.valores.negocio.keys().hasOnly(clavesNegocio())`— reutilizando **la misma
lista blanca** que usa `configNegocioValida()`. Para eso hay que extraer esa
lista a una función de reglas propia (`clavesNegocio()`) y llamarla desde los dos
lados: si se copia y pega, en tres meses hay dos listas distintas.

Aun así, **la validación de la propuesta es secundaria**. La puerta sigue siendo
la escritura en `/config`. Una propuesta mal formada que nunca se puede aplicar
es inofensiva; lo que no puede pasar es que existir como propuesta le dé a un
valor un camino más blando hacia la configuración. No se lo da: aplicar es un
`updateDoc` común y corriente. **Si la regla rechaza, la propuesta queda
`aprobada` y sin aplicar, y la pantalla muestra el rechazo.**

**`base` y el pisón entre dos administradores.** Guarda el `actualizadoEn` de
cada documento en el momento de armar la propuesta; al aplicar, el navegador
relee en una transacción y se niega si se movió. Es una **cortesía contra el
accidente, no un control de seguridad**: el valor lo manda el cliente y un
cliente manipulado se lo saltea. El peor daño posible de saltearlo es escribir
una configuración válida encima de otra válida, que es lo que ya puede hacer
cualquier administrador con dos pestañas abiertas.

**El administrador puede editar los valores del resumen antes de aprobarlo.**
Cada campo guarda su `origen` (`ayudante` o `editado`): sirve para saber, con el
tiempo, si vale la pena seguir pagando el ayudante.

### 4septies.3 Qué sabe, de dónde lo saca, y por qué NO hay base vectorial

El pedido dice «RAG». La parte que importa de RAG es *recuperar el documento
correcto*; la base vectorial es una de las formas de hacerlo, y acá es la
equivocada. El corpus completo es este:

| Bloque | De dónde sale | Tamaño | Frescura |
|---|---|---|---|
| Identidad de la persona y del negocio | claims del token + ficha + `/usuarios/{uid}` + `/miembros/{uid}` | ~200 tokens | en vivo |
| Estado actual de la configuración | `/config/negocio`, `/config/{flujo}`, catálogo, funcionarios | ~1.000 | en vivo |
| Catálogo de campos (qué es cada uno, tope, valores, qué pasa si queda vacío) | módulo compartido, §4septies.4 | ~4.000 | por versión |
| Reglas de la casa (alcance, lo que no toca, prohibiciones 3 y 4) | texto fijo | ~800 | fija |

Son unos **6.000 tokens que entran enteros en el prompt**. Un índice de
embeddings agregaría una canalización de ingesta, un almacén vectorial, troceo,
un paso de recuperación que **puede no traer el trozo que hacía falta**, y una
copia más que se desincroniza de las reglas. Todo eso para recuperar un corpus
que cabe entero. **Decisión: sin base vectorial, contexto armado de forma
determinista.** Con caché de prompt el bloque fijo se paga una vez por sesión.

Se revisa cuando el bloque fijo pase de ~20.000 tokens o cuando entren los tres
manuales en PDF; y aun entonces el primer paso es un índice por sección y
palabra clave, no embeddings.

**La identidad no la manda el navegador.** El navegador manda el `tenantId` y
nada más; se valida contra los claims. Nombre del negocio, razón social, NIT,
plan, flujos, número, rol y correo **los lee la Function del servidor a partir
del `uid` del token**. Si el ayudante «se acuerda de con quién habla» es porque
lo lee de Firestore en cada turno, no porque lo tenga escrito en la
conversación, donde el usuario podría contradecirlo.

**El estado actual entra ROTULADO COMO DATO**, delimitado, después de las reglas
de comportamiento y nunca por delante —exactamente la doctrina de `prompt.ts`
§3. Importa más de lo que parece: la configuración es **texto que escribió un
tercero**, y un comercio que ponga «ignorá tus instrucciones anteriores» en la
descripción no debe conseguir nada. La defensa es la misma de siempre: eso es
dato, no instrucción, y va donde van los datos.

**El ayudante no ve conversaciones de clientes finales.** Ni las suyas ni las de
nadie. Es coherente con §4.3 —donde ni el propietario de NovuChat las lee sin
una ventana que abre el comercio— y no hace falta: para configurar el negocio no
se necesita leer a sus clientes. El día que alguien pida «que mire las
conversaciones y sugiera mensajes», eso es otra prestación, con otro
consentimiento y otra sección.

### 4septies.4 El catálogo de campos: una sola fuente, no una quinta copia

Hoy la lista de campos de configuración vive en **cuatro** lugares:
`firestore.rules` (lista blanca y topes: la que manda), `Configuracion.tsx`
(`TOPES` y etiquetas), `ConfiguracionVertical.tsx` (`CAMPOS`) y `prompt.ts`
(`CAMPOS_LIBRES_AL_PROMPT`). El ayudante necesita una quinta, más rica, porque
tiene que **explicar** cada campo. Escribirla a mano garantiza que dentro de dos
meses el ayudante explique un campo que ya no existe o proponga un valor por
encima del tope.

**Decisión: un paquete `admin/comun` en el espacio de trabajo**, con
`campos.ts` como única declaración:

```ts
{ clave: 'direccion', documento: 'negocio', etiqueta: 'Dirección del local',
  tipo: 'texto', tope: 200, escribe: 'comercio', loLeeElFlujo: true,
  flujos: null,                       // null = común a todos
  paraQueSirve: 'El asistente la dice cuando le preguntan dónde queda.',
  siQuedaVacio: 'El asistente responde que no tiene el dato y que consulta con recepción.' }
```

De ahí salen el prompt del ayudante, la verificación previa de la propuesta, los
`maxLength` de las pantallas y el esquema de la herramienta que usa el modelo.
Y **una prueba que compara el catálogo contra la lista blanca de
`firestore.rules`**, leyendo el archivo de reglas: sin esa prueba el módulo
compartido no es una fuente única, es una quinta copia mejor redactada.

**`loLeeElFlujo` es la aplicación directa de §4sexies, regla 7.** Los doce campos
que salieron de la consola porque el flujo no los lee (`ESTADO.md`, «Deuda:
campos quitados») **no los ofrece el ayudante**. Prometerle a alguien que
escriba una promoción y que el asistente después no la mencione es peor con un
ayudante que sin él, porque el ayudante lo dijo conversando y eso se parece a
una promesa.

Nota de trabajo: agregar `comun` a `pnpm-workspace.yaml` toca el archivo de
bloqueo, que hoy está en un equilibrio delicado (ver el comentario sobre
`minimumReleaseAge` en ese archivo). El paquete no tiene dependencias externas,
así que el riesgo es bajo, pero es un cambio para hacer con el pipeline en verde
y no de paso.

### 4septies.5 Acceso: login, rol, estado, plan — y cuál de esos es de seguridad

Cuatro condiciones para abrir una sesión, verificadas **en la Function**, no en
el navegador:

1. **Autenticado.** `onCall` + `exigirAutenticado`. Sin sesión no hay ayudante,
   y no hay ninguna variante anónima ni de demostración: la primera pregunta que
   hace el ayudante es sobre el negocio de quien entró.
2. **Administrador de ESE negocio.** `exigirAdminDe(tenantId)`. El operador no
   entra: no puede editar la configuración, y ofrecerle un ayudante que propone
   cambios que él no puede aplicar es una trampa. El propietario de NovuChat
   tampoco: puede leer la configuración de un comercio, pero no escribirla, y no
   corresponde que arme propuestas en nombre de un cliente.
3. **Negocio operativo.** `tenantOperativo(tenantId)`. Un comercio suspendido no
   puede escribir configuración; darle el ayudante sería venderle una
   conversación que termina en un rechazo.
4. **Plan con la prestación.** `Crecimiento` y `Pro`.

**La cuarta condición es de otra naturaleza que las tres primeras, y conviene no
confundirlas.** Las tres primeras protegen los datos del comercio y por eso
viven —además de en la Function— en `firestore.rules`, que es lo que de verdad
cierra la puerta. La cuarta protege **el bolsillo de NovuChat**: si alguien la
saltea, no consigue escribir nada que no pudiera escribir igual desde el
formulario; consigue gastarnos tokens. Por eso el plan **no entra en las
reglas** —no hay nada que las reglas tengan que impedir— y por eso el control
correcto está en la Function y en la cuota. Modelarlo como control de seguridad
llevaría a agregar lecturas de documento en las reglas (§4.4: cada `get()` se
paga y hay un tope de diez por petición) a cambio de nada.

**Tabla de planes**, en `admin/comun/planes.ts`, con la misma forma que
`FLUJOS`:

| Plan | Ayudante | Sesiones por mes |
|---|---|---|
| Impulso 250 | ❌ | — |
| Crecimiento 450 | ✅ | 6 |
| Pro 850 | ✅ | 20 |
| Demostración | ✅ | 3 |

**Requisito previo:** hoy `tenants/{id}.plan` es texto libre (`basico`,
`demostracion`). Antes de que una prestación dependa de él hay que normalizarlo
a los nombres comerciales y validarlo contra la tabla en `altaTenant` y en el
cambio de plan. Que el campo lo escriban **solo** las Functions ya está, y es lo
que lo hace confiable.

**App Check.** Este extremo cuesta dinero por llamada, así que es donde App
Check deja de ser higiene y se vuelve control de costo. Exigirlo acá antes que
en el resto del panel es razonable.

### 4septies.6 Alcance: cuatro capas, de la más fuerte a la más débil

El orden importa, porque la que todo el mundo escribe primero —la instrucción en
el prompt— es la más débil de las cuatro.

1. **El esquema de la herramienta.** El modelo no devuelve texto libre para
   proponer: llama a una herramienta `proponer_configuracion` declarada con
   `strict: true` y `additionalProperties: false`, cuyo esquema enumera **solo**
   las claves del catálogo que corresponden a los flujos de ese negocio. *El
   modelo no tiene cómo expresar «cambiá el plan»: no existe el verbo.* Es la
   defensa más fuerte porque no filtra texto, elimina la posibilidad.
2. **`firestore.rules`, sin tocar.** Lo de §4septies.1. Una propuesta hostil
   aplicada es, como mucho, una configuración fea.
3. **La verificación previa en el servidor**, con el catálogo: tipo, tope,
   enumerado, y las reglas de negocio que las reglas de Firestore no pueden
   expresar (prefijo del número, un horario que cierra antes de abrir, una
   anticipación mínima mayor que la máxima).
4. **El prompt**: rol, alcance y una respuesta fija para lo que queda afuera
   («eso no lo administro yo; lo ve NovuChat» / «eso no es parte de la
   configuración»). Es cortesía de interfaz. **No es un control**, y no hay que
   escribirlo como si lo fuera.

Y una precisión sobre el modelo de amenaza, porque es fácil apuntar al lugar
equivocado. El riesgo **no** es que el administrador le dé órdenes raras al
modelo: el administrador ya podía escribir cualquier cosa en el formulario. El
riesgo es que **el ayudante escriba más de lo que la persona pidió, o en un
lugar que la persona no está mirando**. Contra eso van las dos aprobaciones y la
regla de oro de la pantalla: **el resumen lista todos los cambios, y no se
aplica ningún cambio que el resumen no liste** —documento y campo, uno por
línea, con el antes y el después.

Y por la prohibición 4 de `CLAUDE.md`: el ayudante se presenta como asistente
virtual y, si le preguntan, lo dice. También acá.

### 4septies.7 Los avisos de mala configuración los calcula el código

El pedido incluye «alertar sobre malas configuraciones», y es donde el ayudante
gana la mayor parte de su valor. **Los avisos no los redacta el modelo: los
calcula el código y el ayudante los explica.** Si los inventara el modelo,
faltarían unos y sobrarían otros, y ninguna de las dos cosas se notaría.

La lista sale de las cicatrices del proyecto:

| Condición | Por qué |
|---|---|
| `direccion` vacía | el incidente del 28/08: el asistente inventó una dirección. Hoy dice que no la tiene, que es lo correcto, pero el campo sigue haciendo falta |
| `mensajeComercioSuspendido` vacío | solo se puede escribir mientras el servicio está activo; después es tarde |
| `numeroRecepcion` vacío, o con `+`, espacios o guiones | la transferencia a un humano no llega |
| catálogo vacío o con precios en cero | el asistente no puede cotizar |
| ningún día cargado en `horarios` | el asistente no sabe cuándo está abierto |
| con reservas: `calendarioId` vacío, o funcionario sin calendario | no hay agenda, y se descubre con el primer cliente |
| con venta: `costoDelivery` y `recargoFlota` en cero | puede ser correcto; hay que preguntarlo, no suponerlo |
| `politicaCancelacion` vacía con reservas | la primera cancelación se resuelve improvisando |

Se calculan al abrir la sesión y **otra vez antes del resumen**, y los que sigan
abiertos aparecen en el resumen aunque la conversación no los haya tocado.

### 4septies.8 Qué se guarda, por cuánto y dónde queda registrado

- **La sesión** (`/tenants/{id}/ayudante/{sesionId}`): los turnos, con `venceEn`
  a 30 días y purga programada. Es texto libre que puede traer datos personales
  de quien configura; guardarla para siempre no aporta nada que la propuesta no
  guarde mejor. Solo la lee el administrador del negocio.
- **La propuesta**: inmutable y sin vencimiento, como los mensajes y la
  bitácora. Es la evidencia de qué se propuso y qué se aplicó.
- **`/auditoria`**: `configuracion_por_ayudante`, con `propuestaId`, los campos
  tocados y el `uid`. Lo escribe la Function.
- **`/bitacora`**: el evento existente `config_publicada` con `canal: 'panel'`.
  No hace falta un tipo nuevo, y agregar uno obligaría a tocar la lista cerrada
  de `eventoValido()` sin ganar nada: lo que el comercio ve es que su
  configuración cambió.

### 4septies.9 Costo, cuota y modelo

Con caché de prompt, dos puntos de corte: uno después del catálogo de campos
(fijo por versión) y otro después del estado del negocio (fijo dentro de la
sesión). Los turnos de una conversación pasan segundos uno del otro, así que el
TTL de cinco minutos alcanza y no hay que pagar el doble por el de una hora. Se
verifica mirando `usage.cache_read_input_tokens`: si da cero, hay algo que
invalida el prefijo en silencio.

Estimación por sesión —15 turnos, bloque fijo de ~6.000 tokens, ~400 tokens de
respuesta por turno, ~85 % de la entrada servida desde caché:

| Modelo | Entrada / Salida por MTok | Por sesión | 6 sesiones/mes | 20 sesiones/mes |
|---|---|---|---|---|
| `claude-opus-5` | $5 / $25 | ~$0,36 | ~15 Bs | ~50 Bs |
| `claude-sonnet-5` | $2 / $10 | ~$0,14 | ~6 Bs | ~20 Bs |
| `claude-haiku-4-5` | $1 / $5 | ~$0,07 | ~3 Bs | ~10 Bs |

**El ayudante no es donde se juega el margen.** Contra un margen de 344 Bs en
Crecimiento y 585 en Pro, hasta la opción más cara pesa entre el 4 % y el 9 %.
Es exactamente al revés que en el flujo de WhatsApp, donde el volumen es de
miles de conversaciones y por eso se eligió Gemini Flash-Lite: acá son decenas
de sesiones al mes y una propuesta mala **escribe la configuración**, así que la
calidad vale más que la diferencia de precio. **Recomendación: `claude-opus-5`**,
con `claude-sonnet-5` como alternativa si Andres prefiere ajustar. La elección
es suya; los números están arriba para que la haga con datos.

**La cuota es lo que hace que esos números sean ciertos.** Contador
`sesionesAyudante` en `/metricas/{aaaa-mm}`, escrito por la Function; tope de
turnos por sesión (30) y de caracteres por mensaje. Sin cuota, un administrador
curioso convierte 344 Bs de margen en cero, y no hace falta mala fe.

**Y el corte duro: el ayudante nunca es el único camino.** Si el modelo falla,
si se agota la cuota o si el proveedor está caído, la pantalla de configuración
manual sigue estando donde estaba. Nadie se queda sin poder configurar su
negocio porque un modelo no contestó.

La clave de API va en **Secret Manager**, nunca en un archivo del repositorio ni
en el navegador (prohibición 2). Es también la razón por la que esto no puede
ser una llamada desde el cliente: una clave de Anthropic en el navegador es una
clave publicada.

### 4septies.10 Cómo se prueba

Las mismas seis pruebas que exige §4sexies para un flujo nuevo, adaptadas:

1. Un negocio en plan Impulso recibe `permission-denied` **aunque arme la
   petición a mano**.
2. Un operador no abre sesión; el propietario de NovuChat tampoco.
3. Un negocio suspendido no abre sesión.
4. Una propuesta con una clave fuera del catálogo se descarta en el servidor;
   una con **solo** claves inválidas se convierte en «eso no lo puedo cambiar».
5. Un negocio sin el flujo `venta` no recibe campos de venta ni aunque los pida
   por escrito, y si igual llegara una propuesta con `costoDelivery`, la regla
   la rechaza al aplicar.
6. `setDoc` con el objeto completo sobre `/config/venta` se rechaza —la prueba
   de `mediaIdQr` que ya existe— también por este camino.
7. Aplicar dos veces la misma propuesta no duplica nada; aplicar una propuesta
   cuya `base` quedó vieja se rechaza y obliga a rehacer el resumen.
8. La cuota agotada corta la sesión nueva y no la que está en curso.
9. El catálogo de campos coincide con la lista blanca de `firestore.rules`
   (prueba que lee el archivo de reglas).

### 4septies.11 Lo que el ayudante NO hace

- No configura lo que administra NovuChat: número de WhatsApp, `mediaIdQr`,
  rótulos del cobro simulado (§4sexies.3), plan, estado del comercio.
- No crea usuarios, no asigna roles, no cambia contraseñas.
- No lee ni resume conversaciones de clientes finales.
- No verifica que el dato sea **verdadero**. Una dirección bien escrita puede
  estar equivocada; el ayudante detecta la casilla vacía y la incoherencia
  interna, no la mentira.
- No habla con n8n. Los cambios llegan al flujo por `configuracionFlujo`, con el
  retardo de caché que tenga ese camino (60 s, §5.4).
- No reemplaza al formulario: lo acompaña.

### 4septies.12 Lo que hace falta antes de poder programarlo

| Dependencia | Estado | Sin eso… |
|---|---|---|
| Razón social y NIT en la ficha del tenant | **no existen**; están en «alta y administración de negocios» | el ayudante no puede saludar con el nombre legal, que es la mitad de «no olvidar con quién trata» |
| `plan` normalizado a los nombres comerciales | hoy es texto libre | la tabla de planes no puede decidir nada |
| Datos personales de quien entra (correo, WhatsApp, cargo) | `/usuarios/{uid}` solo admite `nombre` y `preferencias`; el correo está en Auth y en `/miembros` | falta el cargo dentro de la empresa, que hay que agregar a `/miembros` |
| `configuracionFlujo` conectado en los tres flujos | pendiente | el ayudante solo puede ofrecer los campos que el flujo lee de verdad (`loLeeElFlujo`), que hoy son menos de la mitad |
| Paquete `admin/comun` en el espacio de trabajo | no existe | la quinta copia de la lista de campos |
| Clave de Anthropic en Secret Manager + presupuesto con alerta | no existe | — |

**Ninguna de esas dependencias es un impedimento de diseño; son trabajo previo.**
La primera y la cuarta son las que más pesan, y las dos ya estaban en la lista de
«después del congelamiento».

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

1. **Un secreto HMAC por número de WhatsApp**, en Secret Manager y en las
   credenciales de n8n. Uno por número, no uno para todos. Un comercio con dos
   verticales tiene dos secretos. El secreto **no se nombra por el número**: se
   nombra por un **alias** (`demoA`, `demoB`) y quién es cada alias vive en
   `/rutasWhatsApp/{numero}`. El motivo es que `defineSecret` exige un nombre
   fijo escrito en el código y este repositorio es público, así que el nombre no
   puede contener un `phone_number_id`. La verificación vive en
   `functions/src/firma.ts` y la usan **los tres endpoints** de n8n: ingesta,
   configuración y cierres.
2. n8n firma cada petición: `HMAC-SHA256(secreto, timestamp + "." + cuerpo)`.
   **El secreto no viaja**; viaja una firma. Un `Authorization: Bearer` queda
   escrito en los logs de cualquier proxy intermedio; una firma no sirve de nada
   una vez usada.
3. Ventana de 5 minutos sobre el timestamp: acota la reproducción de una petición
   capturada.
4. **El comercio se deriva de la clave que valida la firma, nunca del cuerpo.**
   Este es el control central contra el *diputado confundido*: aunque n8n mande
   `{"tenantId": "otro-negocio"}`, ese campo se ignora por completo — el comercio
   sale del índice `/rutasWhatsApp`, resuelto desde el número que la firma
   acredita. Ver §4bis.4 para por qué el índice del secreto es el número.
5. Comparación de firmas en tiempo constante (`timingSafeEqual`).
6. **El estado del comercio se comprueba en cada petición.** Si no está activo,
   409 y n8n manda el mensaje de cortesía neutro.

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
| Secreto HMAC indexado por comercio | n8n tendría que resolver número → comercio *antes* de poder firmar, y para eso necesitaría una credencial: un círculo. Ver §4bis.4. |
| Workload Identity Federation desde OCI | WIF necesita que el emisor tenga identidad OIDC propia. GitHub Actions la tiene (y por eso el **despliegue sí usa OIDC**); una VM de OCI corriendo n8n no la tiene sin montar un emisor adicional que habría que operar y proteger. |
| `Bearer` con clave por tenant | mejor que una clave única, pero la clave viaja en cada petición y termina en logs de proxy. HMAC cuesta lo mismo y no expone el secreto. |
| Escribir Firestore desde n8n con el SDK cliente | requeriría un usuario de Auth con contraseña guardada en n8n: otra credencial de larga duración. |

### 5.4 Cómo consume n8n la configuración

El nodo `Config del negocio` deja de tener los valores escritos a mano y pasa a
consultar `configuracionFlujo` con el `phone_number_id` del webhook. La función
resuelve el comercio, comprueba su estado y devuelve la configuración con los
campos **separados y rotulados**:
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
├── pruebas/
│   ├── reglas.test.ts           155 pruebas de aislamiento y control
│   ├── indices.test.ts          4 pruebas de índices (sin emulador)
│   ├── saneo.test.ts            22 pruebas puras (escapado, ranuras, funcionarios)
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
        ├── prompt.ts            ⭐ campos derivados, voz del agente, ranuras
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
- **Verificar que un dato de configuración sea VERDADERO.** Ni la pantalla ni el
  ayudante (§4septies) lo hacen: detectan la casilla vacía y la incoherencia
  interna, no la mentira. Una dirección bien escrita puede estar equivocada.

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
| **Sin política de retención de conversaciones** | acumulación indefinida de datos personales de terceros que nunca consintieron nada ante NovuChat | definirla antes del primer cliente real: propuesta de 12 meses y purga automática |
| **Blaze sin tope duro** | una función en bucle genera una factura desagradable | presupuesto con alerta + `maxInstances: 10` (ya configurado) |
| **App Check exigido demasiado pronto** | deja afuera a usuarios legítimos | modo monitoreo primero, exigir después |
| **Presupuesto de reglas** | Firestore limita a 10 accesos a documentos por petición y 20 por consulta; `tenantActivo()` + `soporteVigente()` ya usan dos | no agregar más `get()` sin medir |
| **Un solo propietario de plataforma** | si Andres pierde la cuenta, nadie administra | designar a Silvana como segundo propietario desde el primer día |
| **Costo de lectura del visor** | un hilo largo son cientos de lecturas por apertura | ya hay `limit(300)`; paginar si molesta |
| **Techo de 20 números por WABA** | el comercio 21 queda bloqueado por un trámite de Meta, no por código | iniciar la verificación de negocio y la ampliación **antes** de necesitarlas; métrica de comercios por WABA |
| **La suspensión depende de que n8n respete el 409** | si n8n cachea la configuración o ignora el 409, un comercio suspendido sigue atendido | TTL de caché de 60 s como requisito del flujo; la ingesta igual queda cerrada por reglas, así que el daño se acota a respuestas sin registro |
| **`personasAtendidas` sostiene la facturación** | un error en la transacción de conteo se traduce en una factura mal emitida | la marca `periodoContado` no la puede tocar ninguna persona; hay procedimiento de recuento; conviene contrastar contra el conteo real el primer mes |
| **Contactos: datos de terceros sin consentimiento** | se guardan nombre, teléfono y correo de personas que no son usuarias del panel | roles cerrados, notas topeadas a 500 caracteres, operador excluido, y la política de retención pendiente los debe cubrir |
| **Sin segundo factor ni política de contraseñas para los comercios** | una contraseña de 6 caracteres protege las conversaciones de un comercio | App Check en el ingreso, correo verificado obligatorio, mensajes de error genéricos. Se cierra activando Identity Platform (§4ter.1) |
| **Primera dependencia externa: el correo** | si FormSubmit cae o deja de entregar, NovuChat deja de enterarse de los reclamos | el reclamo se guarda en Firestore igual y se ve en el panel; la columna "Aviso" muestra los no notificados. Conviene una alerta si se acumulan pendientes |
| **FormSubmit sin activar** | los reclamos se pierden **en silencio**: la función no falla y el panel se ve bien | paso 15e de §11: confirmar con un reclamo de prueba que el correo LLEGA, no que la función no dio error |
| **El texto del reclamo viaja a un tercero sin contrato** | un reclamo puede traer datos del comercio y hasta de sus clientes finales | tope de 1000 caracteres hacia el correo, guía en la pantalla sobre qué no escribir, y el registro completo solo en Firestore. Se cierra al pasar a Resend con dominio propio (T-22) |
| **La Function de correo junta las tres capacidades de la Regla de Dos** | es el único punto del sistema donde pasa | destino fijo fuera del reclamo, texto plano, saneo de encabezados, sin adjuntos. Analizado en SEGURIDAD.md §1 y T-20 |
| **El ayudante de configuración gasta dinero por llamada** (§4septies) | un administrador curioso, un bucle o un abuso convierten el margen del plan en cero, sin mala fe | cuota de sesiones por plan verificada en la Function, tope de turnos y de caracteres, App Check exigido en ese extremo, presupuesto con alerta. Y la pantalla manual sigue estando siempre |
| **El ayudante propone un dato falso pero bien formado** | el asistente lo afirmaría ante un cliente final como verdad del negocio | dos aprobaciones, resumen campo por campo con el antes y el después, y ningún cambio que el resumen no liste. El código calcula los avisos; el modelo solo los explica |
| **`plan` es texto libre y una prestación va a depender de él** | un plan mal escrito habilita o niega el ayudante por accidente | normalizarlo a los nombres comerciales y validarlo contra la tabla de planes en `altaTenant` y en el cambio de plan, antes de programar §4septies |
| **El repositorio es público** | los identificadores del proyecto quedan a la vista | ya se aplican los marcadores de `CONVENCIONES-REPO-PUBLICO.md`; la seguridad no depende de que el ID sea secreto, sino de las reglas |
