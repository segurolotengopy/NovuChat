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
   /contadores/catalogo                          cuántos productos hay: se mueve en el
                                                 mismo lote que el alta o la baja (límite
                                                 por plan, §4ter.2)
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
| **Longitud mínima de contraseña** | ⚠️ parcial | Firebase Auth impone **6 caracteres**. La consola pide **8** al cambiarla (`web/src/lib/contrasena.ts`), pero **eso es del navegador y se saltea**. Una política real —longitud, tipos de carácter, contraseñas filtradas— es *password policy*, y eso **exige Identity Platform**. |
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
administrador de comercio, sin segundo factor y con política de 6 caracteres
del lado del servidor,
protege las conversaciones de **un** comercio. El aislamiento multi-tenant es lo
que evita que ese riesgo escale, y el vínculo con el proveedor es lo que evita
que escale a la plataforma. No es lo ideal, pero está acotado y dicho.

##### El mínimo que pide la consola: 8, y solo al cambiar la contraseña

**Decidido el 16/09/2026, después de que costara un alta.** Al dar de alta al
administrador de un cliente nuevo, la persona puso once caracteres en la
**pantalla de restablecimiento que sirve Firebase** —que los aceptó, porque la
política de Firebase admite desde seis— y después **el formulario de ingreso de
la consola la rechazó**, porque pedía doce. Quedó con una contraseña válida en
el sistema de identidad y bloqueada por la pantalla, sin ningún mensaje que lo
explicara: el bloqueo lo hacía el navegador. Hubo que rotar la clave y emitir
otro enlace.

Las dos cosas que cambian, y el porqué:

1. **El mínimo pasa a 8 caracteres**, alineado con **NIST SP 800-63B**, que es
   lo vigente: mínimo ocho, se admiten contraseñas largas (al menos 64, por eso
   los campos de contraseña **no llevan `maxLength`**), **sin composición
   obligatoria** de mayúsculas, números ni símbolos —la consola no impone
   ninguna y no hay que agregarla, porque producen «Verano2026!» y nada más— y
   **sin expiración periódica**. Lo que sí hay que bloquear son las contraseñas
   comunes o comprometidas, y eso no lo puede hacer el navegador: es la
   *password policy* de Firebase Auth, o sea Identity Platform (paso 14d de §11).
2. **La longitud se exige donde se ELIGE la contraseña, no donde se USA.** «Mi
   cuenta» la revisa; el ingreso ya no, y solo informa el mínimo. En el ingreso
   la contraseña ya existe: un `minLength` no le agrega ninguna dificultad a
   quien intenta adivinarla, y sí deja afuera a quien la tiene bien.

**El número vive en un solo lugar**, `web/src/lib/contrasena.ts`
(`MINIMO_CONTRASENA`), y `pruebas/contrasena-minimo.test.ts` verifica que las
dos pantallas lo usen en vez de volver a escribirlo. Mientras Firebase siga con
su política de seis, **la pantalla de restablecimiento va a aceptar menos que
la consola**: eso es lo que cierra el paso 14d, y hasta entonces es un hueco
conocido, no una sorpresa.

### 4ter.2 Estado de cuenta visible para el comercio

`/tenants/{t}/cuenta/estado`: plan, situación de pago, monto, próximo
vencimiento y `motivoVisible`. Desde el 15/09, además, la **copia de los
límites** del plan (`limites`: conversaciones, productos, agendas) y la versión
del catálogo con que se asignó (`catalogoPlanes`), y el aviso de consumo del mes
(`avisoConsumo`).

- **El catálogo de planes vive en código** (`functions/src/planes.ts`: Impulso,
  Crecimiento, Pro y el interno `demostracion`); el plan de cada comercio vive
  acá, con su copia. **Quien hace cumplir un límite lee la copia**, no el
  catálogo de hoy: las reglas (productos del catálogo, con el contador
  `contadores/catalogo`), `importarCatalogo` y la ingesta (aviso al 80 %) usan
  la misma función, `limitesDeCuenta`. Sin copia rige el plan; con un plan que
  no es del catálogo (el viejo `'basico'`), el más chico. `tenants/{t}.plan` es
  solo un espejo para la cartera: ningún límite lo lee.
- El alta (`altaTenant`, `alta-comercio.mjs`) deja Impulso con su copia y el
  contador en 0; el plan se cambia con `actualizarEstadoCuenta` o
  `scripts/asignar-plan.mjs`, que escriben plan, copia, espejo y auditoría en
  una transacción.

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

**Cinco clases de campo, y la diferencia importa:**

| Clase | Campos | Por qué |
|---|---|---|
| **Enumerados** | `tratamiento`, `estiloEmojis`, `zonaHoraria`, `moneda` | lista cerrada; el código los traduce a una frase fija |
| **Texto libre al prompt** | `nombreNegocio`, `descripcion`, `direccion`, `politicaCancelacion`, `datosQueNoTenemos`, `instruccionesExtra`, `mensajeCierre`, `mensajeErrorTemporal`, `mensajeReservaNoConfirmada`, `mensajeComercioSuspendido` | topeados y entregados en una sección rotulada |
| **Texto validado, no libre** | `direccionMaps` | el enlace de Google Maps del local: vacío, o `https://` de un dominio de mapas de Google y nada más (`enlaceDeMapaValido`, la misma lista en las reglas, en `prompt.ts` y en el flujo). Es el único texto del comercio que el asistente **reenvía tal cual** a un cliente final, en la confirmación de cada cita; texto libre acá sería un enlace a cualquier sitio firmado con el nombre del negocio. Va en el mismo mensaje que la dirección: cero mensajes nuevos (`Analisis/34` §2) |
| **Estructurados** | `horarios`, `ubicacion` | mapas de forma fija: `horarios` con los siete días; `ubicacion` con exactamente `lat` y `lng` numéricos en rango. `ubicacion` nunca entra al texto del prompt: sale en `operacion` y el flujo la usa solo para el pin nativo de WhatsApp cuando el cliente lo pide (un mensaje más, solo en ese caso) |
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

**El enlace del mapa y el pin acompañan a la dirección; no la reemplazan**
(`Analisis/34` §2, 17/09/2026). `direccionMaps` vacío significa «sin enlace»: el
asistente da la dirección sola y no menciona ningún mapa. No entra en
`datosQueNoTenemos`: la falta del enlace no es un dato que el cliente pida, y
anunciarla lo invitaría a pedirlo. Y sin `ubicacion` la marca `[ENVIAR_UBICACION]`
se quita del texto y no se manda nada: la respuesta ya lleva la dirección y el
enlace, que es lo que el cliente necesita para llegar. Un pin sin dirección
cargada no existe por construcción: el flujo lo arma con `direccion` y la
regla 6c prohíbe la marca cuando la dirección no está definida.

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

### 4quater.5 El comportamiento general se verifica en el servidor ANTES de aplicarse (17/09/2026)

**Las reglas de Andres del 17/09**, que esto hace cumplir: (1) multi-tenant
estricto —una empresa no ve, modifica, crea ni borra nada de otra, ni de
NovuChat, ni ninguna otra configuración; solo los superadministradores—; (2) el
«comportamiento general» del asistente es un campo por empresa, un pseudo-prompt
para campañas y ofertas, y **se verifica por seguridad antes de aplicarse**: ese
texto no puede retirar, permitir, sobreescribir ni ejecutar nada sobre otros
tenants, sobre NovuChat ni sobre otra configuración; se enmarca en lo que tiene
esa empresa; (3) lo que NovuChat configura por script se ve en la consola.

**El problema que resuelve.** `instruccionesExtra` es el único campo de la
consola que, en la práctica, es un prompt escrito por el cliente. El flujo lo
inserta delimitado y subordinado (§4quater.2), y eso baja el riesgo, pero nadie
miraba el contenido: 1.500 caracteres alcanzan para fabricar un bloque
`[CONTEXTO DEL SISTEMA]` entero, para pedirle al asistente que niegue ser una IA
(prohibición 4) o para hablar en nombre de otro comercio.

**El contrato de datos**, tres campos de `config/negocio`:

| Campo | Qué es | Quién lo escribe |
|---|---|---|
| `instruccionesExtra` (string ≤ 1.500) | **lo propuesto** | el admin del comercio, desde la consola, como hoy |
| `instruccionesVigentes` (string ≤ 1.500) | **lo que el flujo lee** | solo el SDK Admin: la Function `verificarComportamiento` o los scripts de NovuChat (`cargar-negocio.mjs`, `migrar-instrucciones.mjs`). Las reglas lo niegan desde el navegador a **todo** rol, incluido el admin del comercio y el propietario |
| `instruccionesRevision` (mapa) | `{ estado: 'pendiente' \| 'aprobado' \| 'rechazado', motivo ≤ 300, revisadoEn, hash, capa, revisadoPor }` | solo el SDK Admin. `hash` = primeros 16 hexadecimales del SHA-256 del texto revisado, tal cual está escrito: la consola lo compara con `instruccionesExtra` y sabe si la revisión corresponde a lo que está en pantalla o a un texto anterior |

`configuracionFlujo` entrega `datosDelNegocio.instruccionesExtra` —la clave que
los flujos ya leen; **el flujo no cambia**— con el texto de
`instruccionesVigentes`. Sin vigente, vacío, aunque lo propuesto tenga texto.

**Por qué el flujo lee solo lo vigente.** Es la misma lógica de los campos
derivados (§4quater.2, T-27): dos barreras. La regla impide que el navegador
escriba lo vigente —se mira el *diff* y no las claves del documento, como con
`stock`, así que borrarlo también se rechaza y la consola guarda con
`updateDoc`— y `configuracionFlujo` nunca lee lo propuesto. Un texto rechazado
no llega al asistente y el anterior aprobado sigue rigiendo; un texto que no se
pudo verificar queda `pendiente` y **tampoco se aplica**: ante la duda, no. El
comercio ve en la consola qué escribió, qué está vigente y por qué difieren.

**La verificación, en dos capas y las dos del servidor**
(`functions/src/comportamiento.ts`, puro; `verificarComportamiento.ts`, el
disparador `onDocumentWritten` sobre `tenants/{t}/config/negocio`, que actúa solo
cuando cambió `instruccionesExtra` y la revisión guardada no es ya de ese texto):

1. **Patrones, determinista y primero.** Rechaza sin preguntarle a nadie:
   corchetes, llaves, ángulos y comillas angulares (imitan los bloques del
   sistema y los delimitadores del corpus); los rótulos literales del prompt
   («contexto del sistema», «mensaje del cliente», «información del negocio»);
   `TRANSFERIR` en mayúsculas; verbos de anulación con objeto de sistema («ignora
   las instrucciones anteriores», «olvidá tus reglas»); «instrucciones del
   sistema», «prompt del sistema»; cambios de rol en español e inglés («a partir
   de ahora eres», «you are now», «developer mode»); pedir negar que es una IA
   («di que eres una persona», «no digas que eres un bot», «decí que sos la
   recepcionista»); «prompt» y «system»; cualquier identificador con guion bajo
   (`agendar_cita`, `consultar_disponibilidad`: se rechaza la forma, no solo los
   nombres de hoy); nombres de la plataforma (`tenant`, `firestore`, `n8n`,
   `webhook`, `gemini`); NovuChat invocado como autoridad («NovuChat autoriza»,
   «por orden de NovuChat»); y **el identificador o el nombre de otro tenant**,
   leídos de `/tenants` con el SDK Admin y comparados como frase entera, con
   motivo genérico «menciona otro comercio»: los nombres ajenos no se le muestran
   al comercio. Las coincidencias **débiles** —«regla» (reglas de higiene),
   «herramienta» (una ferretería), «consola» (una tienda de videojuegos), un
   verbo de anulación sin objeto («ignora los mensajes en inglés»), «NovuChat»
   suelto, «token»— **no rechazan nunca solas**: dejan el caso dudoso, con la
   palabra señalada, para la capa 2. La lista está en el código con el porqué de
   cada entrada, y `pruebas/comportamiento.test.ts` exige que cada patrón tenga
   un texto que lo dispare.
2. **Modelo, segundo.** Una llamada a Gemini (`GEMINI_API_KEY`, el mismo secreto
   que la comprobación de fotos) con temperatura 0 y respuesta cerrada: APROBADO
   o RECHAZADO y una línea de motivo. El texto va como dato delimitado y con la
   orden de no obedecerlo; la capa 1 ya garantizó que no contiene `<` ni `>`.
   Si el modelo no responde, divaga o la clave no está, el estado queda
   `pendiente` con motivo «no se pudo verificar» y **no se aprueba por defecto**.

Resultado: se escribe `instruccionesRevision` siempre; `instruccionesVigentes`
solo si aprobó. Vacío aprueba sin llamar al modelo (vigente vacío). Todo queda
en `/auditoria` (`revisar_comportamiento`: estado, capa, hash, motivo, cantidad
de caracteres; nunca el texto). La escritura es una transacción condicionada a
que lo propuesto siga siendo el texto revisado: si el comercio guardó otra vez
mientras el modelo pensaba, el veredicto viejo no se escribe.

**Lo que carga NovuChat ya está revisado.** `cargar-negocio.mjs` escribe
propuesto, vigente y revisión aprobada (`revisadoPor: 'cargar-negocio'`) en la
misma transacción, y la Function no revisa dos veces porque ve el hash. Antes de
escribir pasa el texto por la misma capa de patrones y **niega** si no la pasa:
lo que NovuChat carga tiene que poder editarse después desde la consola sin que
la verificación lo rechace por un carácter que puso NovuChat (el JSON de Platinum
tenía «cuánto dura» con comillas angulares; ya no). `migrar-instrucciones.mjs`
(seco por defecto) copia lo propuesto a vigente, una vez, en los comercios
anteriores al contrato: sin eso, al desplegar, Platinum se quedaba sin sus
precios y objeciones en silencio.

**Lo que esto NO hace, dicho ahora.** No sanea: rechaza. Un texto rechazado
vuelve al comercio con el motivo, y la consola le muestra qué está vigente
mientras tanto. Tampoco reemplaza la delimitación del flujo ni la lista blanca de
claves: es una tercera barrera sobre el único campo que las otras dos no podían
cerrar del todo.

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

| | Común a cualquier negocio | Reservas y citas (`agendamiento`) | Pedidos y cobro (`venta`) | Captación de clientes (`onboarding`) |
|---|---|---|---|---|
| **Documento** | `/config/negocio` | `/config/agendamiento` | `/config/venta` | `/config/onboarding` |
| **Contiene** | identidad, dirección, horarios, voz del asistente, **nombre del asistente** (`nombreAsistente`), mensajes fijos, política de cancelación, calendario del negocio (por historia) | duración por defecto, anticipación mínima y máxima, recordatorios, cancelación, **seña** (`senaImporte`, `senaMinutosRetencion`) y, si el negocio no vende, el QR propio (`cobroReal`, solo por `registrarQrDeCobro`) — §4duodecies | costo de envío, recargo de flota, pedido mínimo, radio, tiempos de cocina y despacho, `mediaIdQr` (solo NovuChat), QR propio (`cobroReal`, solo por `registrarQrDeCobro`) | rubros, planes, cargos únicos, aclaraciones de la oferta, archivo de planes, mensaje al cliente actual, enlace a la consola, respuesta del aviso y su plantilla (§4sexies.5) |
| **Colecciones propias** | catálogo, contactos, conversaciones, bitácora, miembros | funcionarios | — | — |
| **Catálogo nativo de WhatsApp** | — | **no**, y no es un pendiente | **sí** (pendiente) | no |
| **Pestañas en la consola** | Configuración, Servicios/Productos, Conversaciones, Usuarios, Contactos, Consumo, Cuenta, Reclamos, Bitácora, Mi cuenta | **Agenda**, **Cobros**, **Configuración de QR** (las dos últimas desde el 17/09, por la seña: §4duodecies) | **Pedidos**, **Cobros**, **Inventario**, **Configuración de QR** (§4nonies) | **Captación** |

«Cobros» y «Configuración de QR» las declaran dos flujos con la misma ruta;
la cabecera pinta cada ruta una sola vez, y la pantalla decide qué documento
lee por la lista de flujos (`venta` gana, §4duodecies.2).

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

### 4sexies.3bis El catálogo nativo de WhatsApp es una capacidad de VENTA

**Decidido el 2026-09-07.** El catálogo de productos de Meta —con carrito nativo—
se publica **solo para el flujo de venta**. Para agendamiento no se hace, y no es
una deuda: es una decisión.

**Por qué.** En agendamiento el catálogo es **referencial**: la lista que el
asistente usa para saber de qué hablar y cuánto cuesta, no una tienda. Nadie pone
un corte de pelo en un carrito de compras. Y aunque se quisiera, **Meta exige
precio en cada producto**, así que los servicios que se cotizan después de
evaluar —los que la consola modela con el precio opcional, §catálogo— no se
pueden listar: la mitad del catálogo de una clínica quedaría afuera.

**Cómo encaja.** Es una capacidad por flujo, como la agenda o el cobro. Cuando se
implemente, va con su línea en la tabla de capacidades y su publicación desde la
consola —una sola fuente de verdad—, con el SKU de Meta igual al identificador
del ítem para que un carrito llegue al asistente con productos que sabe nombrar.
Análisis completo en `Analisis/09-catalogo-nativo-de-whatsapp.md`.

### 4sexies.4 Una consecuencia que conviene conocer

El documento de venta mezcla campos del comercio con campos de NovuChat, y la
validación usa `affectedKeys`. Por lo tanto **un `setDoc` con el objeto completo
se rechaza**: reemplazar el documento borraría `mediaIdQr`, y borrar también es
afectar. La pantalla usa `updateDoc`. Es deliberado — sin eso, el camino más
natural del programador desarmaría en silencio el control de la prohibición 3— y
hay una prueba dedicada a ese caso exacto.

### 4sexies.5 La captación es un flujo más, no «el flujo de NovuChat» (15/09/2026)

Hasta el 15/09, `onboarding` era el flujo **propio** de NovuChat: su documento
lo leía y lo escribía solo el propietario, y lo que el asistente ofrecía
(rubros, planes, precios) estaba escrito en el flujo de n8n. Pasa a ser un
**tercer flujo genérico, configurable por consola**: cualquier comercio que
vende un servicio puede captar prospectos con él. NovuChat es su primer usuario,
con el asistente «Kenji».

**Por qué genérico.** Con el contenido dentro del flujo, cambiar un precio era
editar el JSON y republicar (y la regla del proyecto dice que un cambio de flujo
se aplica a todos los clientes o a ninguno). Con el contenido en la consola, el
flujo es uno solo y cada comercio carga su oferta: es la misma separación que ya
tienen agendamiento y venta, y la que sostiene el alta en 48 horas.

**El documento `/config/onboarding`** (la lista blanca y los límites de verdad
están en `configOnboardingValida()` de `firestore.rules`):

| Campo | Qué es | Límite |
|---|---|---|
| `rubros` | Rubros que el asistente reconoce, cada uno con la solución que se le ofrece y el flujo que se le sugiere | hasta 8; `{ id /^[a-z0-9-]{1,30}$/, nombre ≤40, solucion ≤300, flujoSugerido: agendamiento · venta · recordatorios · a_medida }` |
| `planes` | Planes del comercio, **en dólares** (Base comercial §3) | hasta 20; `{ nombre ≤40, precioUsd ≥0, periodo: mes · anio · unico, incluye ≤200 }` |
| `archivoPlanes` | Un PDF o una imagen con todos los planes | `{ url https, tipo: pdf · imagen, nombreArchivo ≤80 }`; **obligatorio con más de 5 planes** |
| `cargosUnicos` | Instalación y otros cargos que se pagan una vez | hasta 5; `{ nombre ≤60, precioUsd ≥0, desde: bool, detalle ≤200 }` |
| `aclaraciones` | Conceptos de la oferta que el asistente usa **solo si le preguntan** | hasta 15; `{ tema ≤60, texto ≤600 }` |
| `mensajeClienteActual`, `enlaceConsola`, `topeAviso`, `plantillaAviso` | Los que ya existían (§4sexies, captación de NovuChat) | sin cambios |
| `actualizadoPor`, `actualizadoEn` | Sello | el de siempre |

**Quién lo edita.** El **administrador del comercio que tiene `onboarding` en
`flujos`**, igual que el de agendamiento edita su agenda, y el **propietario**
(NovuChat), que lo carga en el alta y da soporte. Ningún otro comercio, ni con la
petición armada a mano; la regla lee la misma lista `flujos` que el menú. Lo
lee la gente del comercio con el flujo, como cualquier otro documento de config.

**`nombreAsistente` es común, no de la captación.** Vive en `/config/negocio`
(≤40 caracteres) porque cualquier flujo se presenta con él: el asistente de
reservas de un salón también puede llamarse de una forma. Un nombre propio no
lo convierte en persona: el asistente sigue diciendo que es una IA si le
preguntan (prohibición 4).

**Cinco planes en texto, seis o más en archivo.** Hasta cinco, los planes caben
en una respuesta legible. Más, la lista ya no se lee en un chat, y partirla en
varios mensajes cuesta dinero (Base comercial §1: un mensaje largo y completo
es más barato que dos cortos). Por eso con más de cinco el archivo es
obligatorio, y el asistente lo manda en lugar de la lista.

**Las aclaraciones van solo si las piden.** Son la definición de «conversación»,
la bolsa, el prepago, la moneda: lo que un prospecto pregunta, pero que soltado
sin pedirlo alarga cada respuesta. El asistente las tiene y no las recita.

**Los precios son en dólares y el asistente no convierte.** El cobro en
bolivianos es al Tipo de Cambio Oficial del BCB del momento del pago (Base
comercial §3); un importe en bolivianos calculado por el modelo sería una cifra
inventada.

**Cómo se carga.** Desde la pestaña «Captación», o de una vez desde un JSON
versionado con `admin/scripts/cargar-captacion.mjs` (valida el mismo contrato,
exige el flujo en la ficha, muestra en seco qué cambia y deja auditoría). El
contenido de NovuChat, copiado del sitio, está en
`admin/scripts/datos/captacion-novuchat.json`.

**Mensajes que agrega:** ninguno. La configuración cambia lo que dice cada
respuesta, no cuántas salen.

---

## 4septies. Retención de conversaciones: 12 meses

**Decidido por Andres el 2026-09-07.** Era el riesgo abierto más incómodo: el
sistema guarda mensajes de WhatsApp de clientes finales que **nunca aceptaron
nada ante NovuChat**. Consintieron escribirle a una peluquería; nosotros somos
la infraestructura de esa peluquería, no su contraparte.

### La regla

**Las conversaciones y sus mensajes se borran a los 12 MESES de su último
mensaje.** No de su creación: una conversación que sigue viva no se corta por la
mitad.

### Qué se borra y qué no, que es donde está la decisión de verdad

| Dato | Qué pasa a los 12 meses | Por qué |
|---|---|---|
| `conversaciones/{id}` y sus mensajes | **se borra** | es el contenido personal: lo que la persona escribió |
| `cierres/{id}/privado/datos` | **se borra** | nombre y teléfono completo del cliente final |
| `cierres/{id}` (público) | **se conserva** | teléfono enmascarado, importe y tipo: es el respaldo de lo que se facturó |
| `metricas/{periodo}` | **se conserva** | son cuentas, no personas |
| `contactos` del comercio | **no caduca** | son del negocio, no de sus clientes; los borra el comercio |
| `bitacora` y `auditoria` | **se conserva 24 meses** | es el registro de quién cambió qué, y protege al comercio tanto como a NovuChat |

La asimetría es deliberada: **se borra el contenido, se conserva la cuenta.** Un
comercio que reclame una factura de hace ocho meses tiene con qué defenderse, y
la persona que escribió por un corte de pelo no queda en una base para siempre.

### Por qué doce y no seis ni veinticuatro

Doce meses cubre el ciclo comercial completo —una discusión de facturación, una
auditoría, un cliente que vuelve al año— y es el plazo que un comercio entiende
sin explicación. Seis obliga a explicarle a un negocio por qué perdió el
historial de la temporada pasada; veinticuatro acumula dos años de datos ajenos
sin que nadie los use.

### Cómo se implementa

Una función programada diaria que borra por lotes lo vencido, con su registro en
la bitácora de plataforma. **Pendiente de escribir**: la decisión es de hoy, el
código va después de las demos del 9 y 10. Hasta entonces no hay volumen que lo
justifique —dos comercios de demostración— pero **tiene que existir antes del
primer cliente real**, porque a partir de ahí los datos son de terceros de
verdad.

### Lo que hay que decir en los términos

Dos frases, y la segunda depende de la opción de calendario de §4:

> Guardamos las conversaciones de WhatsApp durante 12 meses desde el último
> mensaje, y después se borran automáticamente. Conservamos por más tiempo solo
> el registro de operaciones facturadas, sin el contenido de los mensajes ni el
> teléfono completo.

> Para agendar citas, el asistente accede a la agenda de Google que el negocio
> autoriza. Ese acceso lo concede el propio negocio desde su cuenta de Google y
> lo puede revocar cuando quiera, sin pasar por NovuChat.

---

## 4octies. Catálogo web propio

**Escrito el 2026-09-07, sobre el diseño de Andres de
`Analisis/11-catalogo-web-propio.md` y con las dos correcciones de su §3.**
Es trabajo POSTERIOR a los demos del 9 y 10: vive en la rama
`disenio/catalogo-web` y no toca ningún flujo de n8n en producción.

### 4octies.0 Qué es, en una frase

El comercio publica su catálogo como una página web con su propia marca; el
asistente le manda el enlace a un cliente por WhatsApp; el cliente navega, elige
y confirma; **y el carrito vuelve de servidor a servidor a la conversación**, sin
pasar por el teléfono del cliente.

```
   WhatsApp                    Consola (Firebase)                Navegador
   (n8n)                                                         del cliente

   «quiero pedir» ──► POST /api/catalogo/enlace
                        └─► ficha opaca, caduca a 72 h
   manda el enlace ◄────────┘
                                                    GET /api/catalogo/<ficha>
                                                       └─► catálogo + marca ──►
                                                                        navega
                                                    POST …/<ficha>/checkout ◄──
                                                       ├─ RECALCULA los precios
                                                       ├─ escribe /pedidos
                                                       ├─ mensaje `order` en el hilo
   despierta al flujo ◄────────────────────────────────┘
   responde (o plantilla)
```

### 4octies.0bis Solo para el flujo de VENTA

**Decidido por Andres el 08/09.** Un catálogo web con carrito y checkout es una
tienda. El flujo de agendamiento **no vende**: su catálogo es referencial —la
lista que el asistente usa para saber de qué hablar y cuánto cuesta— y sus ítems
son en buena parte «a consultar», que desde §4octies.5bis ni siquiera se
publican. Un salón que encendiera esto obtendría una vitrina medio vacía con un
botón de comprar que no compra nada.

**Es la misma decisión que se tomó para el catálogo nativo de Meta**
(§4sexies.3bis) y por las mismas razones. Que las dos caigan del mismo lado no
es casualidad: las dos son tiendas.

Se comprueba en tres lugares, y el que manda es el segundo:

| Dónde | Qué hace |
|---|---|
| `firestore.rules` | `catalogoWebActivo` solo se puede poner en `true` con `tieneCobro`. Escrito como implicación —o está apagado, o el negocio vende— para que un salón pueda seguir guardando el resto de su configuración |
| `catalogoWeb.ts` | `enlaceCatalogo` no emite ficha, y `fichaVigente` no abre ninguna, si el comercio no tiene `venta`. Una ficha emitida antes de esta regla deja de servir |
| `Configuracion.tsx` | la sección no se le ofrece a quien no vende. **Es cosmético**: esconder no protege, la petición se construye igual desde la consola del navegador |

**Consecuencia:** el punto de la tabla comparativa del análisis que decía «vale
para el Flujo A, si algún día hace falta» queda cerrado. No es una deuda: es una
decisión.

### 4octies.1 Las dos correcciones del análisis, aplicadas

**§3.1 — El CSV es un formato de IMPORTACIÓN, no una fuente de verdad.** El
diseño original tenía el catálogo viviendo en un Sheets. Con eso, la copia que va
al prompt saldría del Sheets y la del sitio también: dos catálogos que se
desincronizan el primer martes que alguien corrija un precio en el lugar
equivocado. Acá el archivo entra por `web/src/lib/csv.ts`, se valida, se escribe
en `/catalogo`, y desde ese momento **manda la consola**. Se puede volver a
exportar, pero lo exportado es una copia.

**§3.2 — El enlace identifica la CONVERSACIÓN, no solo el catálogo.** Las tres
consecuencias que el análisis pedía fijar antes de programar, y dónde quedaron:

| Requisito | Dónde |
|---|---|
| Una ficha por conversación, **no el teléfono en la URL** | `/fichasCatalogo/{ficha}`, 128 bits al azar, cerrada a todo navegador |
| El checkout va **firmado** | reutiliza `firma.ts`: el mismo secreto por número de la ingesta, en los dos sentidos |
| La ficha **caduca** | 72 horas, y cinco carritos como máximo. El porqué de los dos números está en `SEGURIDAD.md` T-36 |

### 4octies.2 Las dos decisiones que no eran técnicas

Las dos las señalaba el §7 del análisis como previas a escribir código.

**La marca es la del COMERCIO**, con NovuChat en el pie. El cliente final cree
—con razón— que está hablando con la panadería: si al tocar el enlace aparece una
marca que no le presentaron, duda, y una duda en el momento de pagar es una venta
perdida. El logo y el color viven en `/config/negocio` (`logoUrl`, `colorMarca`)
porque son IDENTIDAD, que por §4sexies es común a cualquier flujo.

El color es **exactamente `#rrggbb`** y nada más. No es tiquismiquis: termina
dentro de una propiedad personalizada de CSS, y un valor libre ahí es una
inyección de CSS que filtra cada visita a un tercero sin ejecutar JavaScript. Es
el mismo criterio con el que la voz del asistente es un enumerado.

**Fuera de la ventana de 24 horas se manda una plantilla.** Si el cliente navega,
se distrae y confirma al día siguiente, WhatsApp ya no permite un mensaje libre.
`checkoutCatalogo` calcula si la ventana sigue abierta —con `atencionDesde`, la
misma ancla que usa la ingesta— y se lo dice al flujo en el campo `accion`:
`responder` o `plantilla_carrito_espera`. **Lo calcula la función y no n8n** para
que no haya dos relojes dando dos respuestas sobre el mismo pedido. La plantilla
hay que darla de alta en Meta: está en `admin/CATALOGO-WEB.md` §4.

### 4octies.3 Por qué no se adoptó una pieza de código abierto

Se coincide con el §4 del análisis. La consola ya es una aplicación React sobre
Firebase Hosting con su API y su sistema de diseño; una ruta pública de catálogo
—lista, detalle, carrito, checkout— es lo que hay en `web/src/publico/`, unas
quinientas líneas. Integrar una plantilla ajena cuesta entenderla, alojarla,
mantenerla actualizada, hacerla parecerse a NovuChat, y deja una dependencia más
que auditar en un producto que ya tiene una CSP con `default-src 'none'`.

### 4octies.4 Dos aplicaciones en un sitio, y por qué se partió el punto de entrada

`main.tsx` mira la ruta y carga **un trozo distinto**: `/c/<ficha>` monta el
catálogo; todo lo demás monta la consola. No es una optimización cosmética.

Antes, `main.tsx` importaba `App`, y `App` arrastra —por la cadena de sesión— el
SDK de Firebase entero: Auth, Firestore, Functions y App Check. El catálogo lo
abre un cliente final desde WhatsApp, casi siempre con datos móviles: **no
necesita nada de eso** y, sobre todo, el código que gestiona sesiones de
administrador no tiene por qué existir en la página que ve un desconocido. Con la
partición, el catálogo pesa unos 205 kB de JavaScript contra los 813 kB de la
consola, y el segundo trozo ni se descarga.

La contracara está en `SEGURIDAD.md` T-37: las dos aplicaciones comparten origen.
Se aceptó por ahora, con la separación en un segundo sitio de Hosting anotada como
lo que hay que hacer antes de tener volumen real.

### 4octies.5 El umbral del catálogo al prompt (punto 7 del diseño)

`configuracionFlujo` mandaba el catálogo entero —hasta 200 ítems— en cada consulta
del flujo, y el flujo lo pega en el prompt.

Desde ahora: **por debajo de 40 ítems, el catálogo entero al prompt; por encima,
solo un resumen** —cuántos hay, qué áreas, entre qué precios— y el detalle llega
por el sitio y por el JSON del checkout. El umbral vive en `prompt.ts`, en un
solo lugar, porque lo usan `configuracionFlujo` y `catalogoWeb`.

**Corrección del 08/09: el motivo NO es el costo, y decirlo mal mandaba a
optimizar al revés.** Esta sección justificaba el umbral con «más dinero, más
latencia». `Analisis/19` §2 lo midió con las tarifas de octubre y la caché de
prefijo puesta: **500 ítems en el prompt cuestan 0,0585 Bs, o sea 0,43 mensajes
del asistente**. El catálogo entero de una ferretería cuesta menos de medio
mensaje; el token dejó de ser la restricción el día que Meta empezó a cobrar por
mensaje. Lo que hay que achicar es la cantidad de MENSAJES, no el prompt.

El umbral sobrevive por otras dos razones: **legibilidad** —40 ítems son ~1.200
caracteres en un globo de chat, y la lista interactiva de WhatsApp admite 10
filas por sección— y **confiabilidad del modelo**, que es la que no se puede
calcular: el Demo A maneja 8 servicios y nadie probó con 100. Cada precio mal
citado es un mensaje cobrado más un riesgo de la prohibición 3. Los 40 son una
recomendación, no una medición: el número real se saca con un catálogo real
contra las suites de aceptación.

**Solo se resume si el comercio tiene el catálogo web encendido.** Sin sitio
adonde derivar, resumir sería quitarle información al asistente a cambio de nada.
Un comercio sin catálogo web se comporta exactamente como antes de este cambio,
tenga los ítems que tenga.

### 4octies.5bis Sin precio no se publica

**Agregado el 08/09, contra `Analisis/19` §5.** Un ítem sin precio significa «a
consultar»: hay que evaluar, medir, ver el stock o hablar con alguien. En la
consola y en el prompt eso está bien —el asistente tiene que saber que el negocio
lo ofrece, para no decir que no existe—. **En una página con botón de comprar,
no.**

> «Publicar en el catálogo web algo que no se puede comprar es la forma más cara
> de generar una conversación: el cliente pregunta, el asistente no puede cerrar,
> y son mensajes pagados sin venta.»

Desde el 1 de octubre cada mensaje del asistente se paga, así que un ítem sin
precio en la vitrina no es una oportunidad: es una conversación garantizada que
no puede terminar en nada. La regla se aplica en los tres endpoints —no se
publica, no entra al checkout, y no se manda el enlace si el catálogo entero se
cotiza— y la consola se lo dice al comercio en las dos pantallas donde importa.

**Lo que esta regla NO cubre.** El análisis nombra tres clases que tampoco
deberían publicarse —sin stock, a medida, y lo que necesita instalación— y de las
tres el sistema solo sabe reconocer esta. Distinguir las otras exige una marca
por ítem en la consola, que no existe. Mientras tanto, el comercio las saca
dándolas de baja.

**Consecuencia que se aceptó:** el catálogo web deja de servir para el Flujo A
tal como está cargado hoy, porque los servicios de salud son justamente los que
se cotizan. Es lo correcto: un catálogo de servicios sin precio no es una tienda.

### 4octies.5ter El logo se sube, y los colores se eligen de cinco

**Pedido por Andres el 08/09.** Antes el logo era una URL que el comercio pegaba
y el color un `#rrggbb` libre. Las dos cosas cambiaron.

**El logo se sube desde la consola y se guarda incrustado** en
`/tenants/{t}/config/marca`, recortado a 320 px por el navegador antes de
guardar. No hay depósito de archivos: montar Storage —bucket, reglas, CORS— para
UN archivo por comercio es mucha superficie, y nos volvería custodios de archivos
ajenos. Va en documento propio y no en `/config/negocio` porque
`configuracionFlujo` lee ese documento en cada consulta del flujo, y el logo le
agregaría decenas de kilobytes a cada mensaje del asistente.

Los tipos son **PNG, JPEG y WebP**. SVG **no**, aunque sea una imagen: puede
llevar `<script>` adentro y esto termina en un `src`.

**El color pasó a ser una de cinco paletas** (`web/src/lib/paletas.ts`). La razón
de diseño pesa más que la de seguridad: la página necesita **tres** tonos que
combinen y un comercio elige uno solo; pedirle los tres termina en texto que no
se lee. Las cinco están calculadas juntas y sus quince relaciones de contraste
cumplen WCAG AA —medido en una prueba que recalcula, no en una tabla copiada—.
De paso, el enumerado elimina la inyección de CSS en vez de validarla: el
servidor manda el NOMBRE y el navegador lo traduce contra su tabla.

### 4octies.6 Qué se agregó a las reglas

| Ruta | Cambio |
|---|---|
| `/catalogo/{item}` | `imagenUrl`, validada como `https://…` por `urlImagenValida()` |
| `/config/negocio` | `catalogoWebActivo` (booleano, nace apagado) y `paleta` (una de cinco) |
| `/config/marca` | **nueva.** El logo incrustado. Es el único documento de `/config` que el comercio puede CREAR: nace cuando sube su primer logo, que puede ser meses después del alta |
| `/pedidos/{id}` | **nueva.** La leen los mismos que las conversaciones; no la escribe ningún navegador |
| `/fichasCatalogo/{f}` | **nueva.** Negada para todos, explícitamente y no por descarte |
| `/bitacora` | dos tipos más: `catalogo_enlace` y `carrito_recibido` |

`catalogoWebActivo` nace **apagado** y encenderlo es un acto deliberado del
comercio: publicar los precios de alguien en una dirección pública no puede ser el
valor por defecto de nada.

### 4octies.7 Lo que este diseño NO resuelve, dicho ahora

- **No hay purga de fichas caducadas.** Una ficha vencida no sirve para nada —la
  función la rechaza— pero el documento queda, con un teléfono adentro. Entra en
  la purga de retención de §4septies, que todavía no existe para ninguna
  colección.
- **NovuChat no manda ningún mensaje de WhatsApp.** Quien habla con Meta sigue
  siendo n8n y nadie más. Si el webhook del flujo falla, el pedido **ya está
  guardado** y la consola lo muestra: el comercio no pierde la venta, pero el
  cliente no recibe respuesta automática. Queda anotado como `error_flujo` en la
  bitácora y `entregadoAlFlujo: false` en el pedido. **Falta la reentrega**: hoy
  hay que mirar la consola.
- **Las fotos son de la empresa.** Si borra una de su Drive, deja de verse. Es la
  contrapartida buscada de no montar un depósito de archivos, y la consola la
  muestra rota a propósito para que el comercio lo note.
- **Nada de esto se probó contra un teléfono real**, porque no hay proyecto de
  nube creado. Ver §9.

---

## 4nonies. Pedidos y cobros: tres pantallas, no una

> **Estado (2026-09-12): las tres pantallas están construidas y en producción**
> (commit `45d130d`, PR #51). Se hicieron **antes** que los dos datos de
> §4nonies.3, por decisión de Andres del 09/09. Por eso cada una dice en
> pantalla lo que todavía no puede mostrar, en vez de aparecer vacía. **Los dos
> datos siguen pendientes**, y son lo próximo de esta sección.

**Pedido de Andres, 2026-09-09.** Hoy «Pedidos y cobro» es UNA pantalla que en
realidad configura el QR: no lista un solo pedido ni un solo cobro. El nombre
promete dos cosas que no están.

Se parte en tres, y la división no es de menú: **cada una la mira una persona
distinta, en un momento distinto, para decidir algo distinto.**

| Pantalla | Quién | Para qué |
|---|---|---|
| **Pedidos** | admin y **operador** | Preparar y entregar lo que se pidió |
| **Cobros** | admin | Ver la plata y confirmar contra el banco |
| **Configuración de QR** | admin | Lo que hoy existe, con su nombre real |

### 4nonies.1 Pedidos — la pantalla del cocinero y del repartidor

**Es la única pantalla de la consola que se mira con las manos ocupadas.** Quien
la abre no está analizando el negocio: está por cocinar o por salir a repartir.
Eso manda sobre todo lo demás — poco texto, lo importante grande, y nada que
obligue a abrir un modal para saber qué hacer.

Listado de pedidos con **fecha y hora**, y por cada uno:

- **Todos los ítems** y sus cantidades.
- **El detalle de cada ítem tal como lo pidió el cliente** —«sin cebolla», «L»—.
  Es lo que más se equivoca y lo que más caro sale equivocar.
- **La modalidad de entrega**: si va a envío o se retira en el local, con la
  dirección cuando corresponde.
- **El monto**.
- **El comprobante de pago que subió el cliente.**

**El operador ve esta pantalla y NO ve Cobros.** No es jerarquía: el cocinero no
necesita saber cuánto facturó el negocio, y cada dato de más en una pantalla
operativa es un dato que hay que saltear para llegar al que importa.

### 4nonies.2 Cobros — la pantalla de la plata

Arriba, un tablero corto: **pagos, montos y verificaciones**, por día, semana,
mes **o entre dos fechas**. Abajo, el listado de los cobros hechos con QR, con
fecha, hora y monto de cada uno.

De cada cobro se puede abrir un modal con **los ítems, el detalle de la compra y
el comprobante**. Modal y no columna: acá lo que se recorre son montos, y el
detalle es la excepción que se consulta, no la regla.

**Y un botón para marcar el pago como comprobado**, después de que la persona lo
verificó con su banco.

**ESE BOTÓN ES DE UNA PERSONA Y NUNCA DEL SISTEMA, y ahí está la PROHIBICIÓN 3.**
El OCR coteja un comprobante; no acredita nada. Quien afirma que la plata entró
es el comercio mirando su cuenta. Por eso el registro tiene que guardar **quién**
marcó y **cuándo**, igual que cualquier otro sello de la consola, y por eso la
etiqueta dice «comprobado por el negocio» y no «pago acreditado». Si algún día
el asistente usa ese estado para contestarle a un cliente, tiene que decir que
lo confirmó el negocio, no NovuChat.

### 4nonies.3 Lo que falta para poder construirlas

No se puede empezar por la pantalla: **dos datos que las dos necesitan no
existen todavía**, y sin ellos saldría una pantalla que miente.

1. **EL COMPROBANTE NO SE GUARDA.** Del mensaje se guardan `tipo`, `texto` y el
   identificador de Meta, pero **no el `media id`**, así que no hay de dónde
   traer la imagen. Hacen falta tres cosas, en orden: guardarlo en la ingesta,
   una función que baje el archivo con el token y lo sirva desde nuestro propio
   origen —nunca un enlace a Meta, que caduca—, y el permiso de lectura. Es el
   mismo hueco que hoy hace que en «Conversaciones» solo se marque el adjunto.

2. **LOS PEDIDOS POR WHATSAPP NO SE GUARDAN COMO PEDIDOS.** La colección
   `pedidos` ya tiene ítems, total, entrega, dirección y nota —está completa—
   pero **solo la escribe el carrito web**. Un pedido tomado conversando registra
   un `cierre`, que es un número para facturar y no lleva ítems. Mientras siga
   así, la pantalla de Pedidos estaría vacía justo para el flujo que la
   necesita. Lo tiene que escribir el flujo al confirmar, con la misma forma que
   ya usa el carrito: una sola forma de pedido, no dos.

**El orden recomendado era ese**: primero los dos datos, después las pantallas,
porque al revés se construye contra datos que no llegan. Se invirtió el 09/09
para tener las pantallas a la vista, con esta condición: **mientras falten los
dos datos, cada pantalla lo dice.** Pedidos avisa que los pedidos de WhatsApp
todavía no se listan, y dónde verlos; Cobros avisa que el comprobante está en
la conversación. Esos avisos se quitan cuando llegue el dato, no antes.

> **Revisión del 17/09 (§4duodecies): el `media id` del comprobante YA NO HACE
> FALTA guardarlo.** La seña por QR resolvió el punto 1 por otro camino: el
> comprobante **no se guarda, se coteja**. El flujo lo baja de Meta con el
> token, un modelo lo lee, y al servidor llega solo el JSON leído (monto,
> cuenta, fecha, hora, banco); la imagen y el PDF no van a Storage ni a
> Firestore, y en el cierre queda `cotejo` con lo leído y el resultado. Cobros
> muestra eso, y sigue diciendo que la imagen está en la conversación: no
> como deuda, sino como decisión. Un comprobante guardado es un dato personal
> más que custodiar, y lo que la persona necesita para mirar su banco —monto,
> banco, hora— ya está en el cotejo. El punto 2 (los pedidos por WhatsApp
> como pedidos) sigue pendiente.

### 4nonies.4 Lo que cambia en el registro de flujos — hecho

`web/src/lib/flujos.ts` declara para `venta` las pestañas Pedidos, Cobros,
Inventario y Configuración de QR. «Pedidos» es la primera con `oper` entre sus
roles, y la compuerta de la cabecera (`App.tsx`) ya filtra por `roles` en vez de
suponer que una pestaña de flujo implica administrador.

## 4undecies. Prepago estricto: pagos, cortes, cobranza y el cobrador (20/09/2026)

> Ficha de diseño del frente A (`Prompts/prepago-estricto.md`, coordinado por
> `Prompts/prepago-y-modularizacion-en-paralelo.md`). La escribió el agente de
> diseño sobre `main` al 20/09 y la integró la coordinadora, que reemplazó la
> §4undecies.5 por el contrato **real** del proyecto de cobros (verificado ese
> día a pedido de Andres) y alineó los nombres de plantillas con
> `docs/plantillas-cobranza.md` (bloque A-5).

**Estado de la base sobre la que se diseña.** `main` al 20/09 (después de `v0.6.0`).
La rama `integracion/prepago-sobre-flujos-vivos` (08/09, `87714d1`) aporta el
módulo puro `prepago.ts`; todo lo demás de esa rama (`cuentas.ts`,
`cobroPrepago.ts`, `cobroTextos.ts`, `cache.ts`, `costos.ts`, su `planes.ts` con el
tope de 25 con corte, `AltaNegocio.tsx`, `CuentaNegocio.tsx`) **no se reaplica**: o lo
reemplazó `main` (bloques de 25, `atencion.ts`, `planes.ts` con catálogo), o
contradice las decisiones de este frente (el comprobante por WhatsApp que NovuChat
«daba por bueno»). Es integración, no cherry-pick.

**Lo que se descubrió leyendo y que condiciona el diseño:**

1. **El flujo reporta el entrante aunque el panel conteste 409.** En
   `Flujos/demo-a-agendamiento.json`, `Normalizar entrada` conecta con `¿Comercio
   operativo?` **y** con `Reportar mensaje (entrante)`, y este último está arriba
   (y=120 contra y=280), así que con `executionOrder: v1` corre primero. Si
   `configuracionFlujo` corta con 409, la ingesta **igual recibe el mensaje del
   cliente**: ahí se cuentan las `perdidas`, sin tocar ningún flujo (que son de B).
2. **Los tres flujos ya saben cortar con un 409.** `Config del negocio` trata el 409
   de `Traer configuración` como «no operativo» y `Comercio no operativo` manda
   `mensajeCortesia` sin llamar al modelo. El corte del prepago **reutiliza ese
   409**: cero cambios en `Flujos/`, cero mensajes nuevos.
3. **La ingesta ya lee `cuenta/estado` dentro de su transacción**
   (`ingesta.ts:1027-1029`) y ya lee `metricas/{periodo}` condicionalmente para el
   aviso del 80 % (`1053-1054`). El prepago se cuelga de esas dos lecturas; no abre
   otra transacción.
4. **`actualizarEstadoCuenta` ya es parcial** (`index.ts:509-516`, `viene()` en
   `533`, probado en `pruebas/estado-cuenta.test.ts`). De la fase 0 de `Analisis/29`
   falta solo que deje de aceptar los campos que pasan a ser derivados (§4undecies.2).
5. **El cobrador entrega el QR como PNG en base64, no como texto.** `dibujoQr.ts`
   **no sirve** para el prepago: no hay cadena que redibujar. Se comparte
   `firma.ts` (el esquema HMAC) y nada más.
6. **La condición de IAM de la cuenta de despliegue solo ve secretos `INGESTA_*` y
   `GEMINI_API_KEY`** (`.github/DESPLIEGUE-FIREBASE.md:73-75`). Los dos secretos del
   cobrador exigen ampliar esa condición y dar `secretAccessor` a `sa-functions`,
   secreto por secreto (`firma.ts:69-85`). Son pasos de nube: **en espera de la
   compuerta del demo**.

### 4undecies.1 La colección `/tenants/{t}/pagos/{pagoId}`

**Un documento por pago, en cualquier estado.** El identificador es opaco y lo
genera el servidor: `randomBytes(16).toString('base64url')` (22 caracteres, 128
bits). Es también la **referencia externa** que viaja al cobrador (§4undecies.5):
un solo valor, generado una vez, sin tenant ni período adentro, y dentro del juego
de caracteres que el cobrador admite (`[A-Za-z0-9:_.-]`, hasta 120).

| Campo | Tipo | Quién lo escribe | Por qué |
|---|---|---|---|
| `tipo` | `'mensualidad' \| 'bolsa' \| 'instalacion'` | Functions | `instalacion` es el agregado de `Analisis/29` §2.5: hoy los USD 65 no tienen dónde registrarse. No suma meses ni bolsas |
| `plan` | `IdPlanVendible` (`planes.ts:42`) | Functions | Solo en `mensualidad`. Del catálogo, nunca texto libre |
| `meses` | entero 1..6 | Functions | Solo en `mensualidad`. El tope 6 se hace cumplir acá (`MESES_MAXIMO = 6` en `prepago.ts`), no en la pantalla |
| `cantidad` | entero 1..12 | Functions | Solo en `bolsa` |
| `montoUsd` | número | Functions | El de la lista (`PLANES[plan].precioUsd × meses`, `BOLSA.precioUsd × cantidad`, `INSTALACION_USD`) |
| `monto` | entero | Functions | Bolivianos, redondeados con `importeBs`. Es lo que va al QR |
| `moneda` / `monedaLista` | `'BOB'` / `'USD'` | Functions | Constantes, para que el documento se explique solo |
| `tcoAplicado` | número 5..40 | Functions | El TCO del BCB del **día de emisión**. Sin él, `importeBs` lanza y el pago no se crea |
| `tcoFuente` | string | Functions | `'BCB'` en los automáticos; lo que declare el propietario en los manuales |
| `tcoFecha` | `aaaa-mm-dd` | Functions | Reemplaza al `tcoPeriodo` (`aaaa-mm`) de la rama: el TCO ya no es mensual |
| `montoRecibidoBs` | entero o `null` | Functions | Lo que entró de verdad (el cobrador lo informa; el propietario lo declara) |
| `motivoDiferencia` | string ≤ 300 | Functions | Obligatorio si `montoRecibidoBs !== monto` en un manual: un descuento tiene nombre y firma |
| `estado` | `'pendiente' \| 'confirmado' \| 'vencido' \| 'anulado'` | Functions | Desaparecen `esperando_comprobante`, `comprobante_recibido`, `rechazado` de la rama: ya no hay comprobante que alguien «dé por bueno» |
| `medio` | `'qr' \| 'efectivo' \| 'transferencia'` | Functions | `qr` solo lo escribe el cliente del cobrador; los otros dos, solo `registrarPagoManual` |
| `canal` | `'consola' \| 'whatsapp' \| 'manual'` | Functions | Por dónde pidió el pago el comercio. Primera medida del §8 de `Analisis/36` |
| `referencia` | string ≤ 120 | Functions | En `qr`: **igual a `pagoId`** (la referencia externa). En `transferencia`: número de operación. En `efectivo`: «recibido por <nombre>» |
| `cobro` | `{ id, estado, venceEn, creadoEn, fichaQr, qrRuta }` o ausente | Functions (A-2) | `id` es el `cons-…` del cobrador; `estado` es el último estado del cobrador visto. `fichaQr` es un valor al azar de 32 hex (como `cobroReal.ficha`, `cobro.ts:152`) con el que `imagenDePago` sirve el PNG. `qrRuta` es la ruta en Storage |
| `confirmadoPor` | `{ origen: 'banco', cobroId, riel, confirmadoPorCobrador, avisoId? } \| { origen: 'propietario', uid }` | Functions | Las dos únicas fuentes que confirman (decisión 5). No existe `origen: 'comprobante'` ni `'webhook'` |
| `evidencia` | ruta de Storage o ausente | Functions | `tenants/{t}/pagos/{pagoId}/evidencia.(jpg\|png\|pdf)`. Obligatoria si `medio === 'transferencia'` |
| `descripcion` | string | Functions | `descripcionDe(pago)` de `prepago.ts`: «Crecimiento · 3 meses» |
| `cubiertoHasta` | `aaaa-mm` | Functions | Lo que la cuenta quedó cubriendo tras aplicar. Es lo que muestra el historial |
| `creadoEn`, `creadoPor` | Timestamp, uid o `'whatsapp:<últimos 4>'` | Functions | |
| `confirmadoEn`, `venceEn`, `anuladoEn`, `anuladoPor`, `motivoAnulacion` | | Functions | `venceEn` = vencimiento del cobro (72 h) solo en `qr` |

**Transiciones válidas** (todo lo demás se rechaza con `failed-precondition`):

```
(crear qr)      → pendiente
(crear manual)  → confirmado           ← nace confirmado; nunca pasa por pendiente
pendiente → confirmado   por avisoCobrador o barridoCobros, SOLO si estadoCobro(id) === 'CONFIRMADO'
pendiente → vencido      por barridoCobros, cuando el cobrador dice VENCIDO
pendiente → anulado      por anularPagoPendiente (admin del tenant o propietario), por
                         registrarPagoManual (que anula el QR vivo antes de cargar), o cuando el
                         cobrador dice ANULADO o RECHAZADO
confirmado, vencido, anulado → (terminales). Un confirmado NO se corrige: se compensa con otro asiento.
```

`PAGO_DETECTADO`, `EN_REVISION` y `BORRADOR` del cobrador **no mueven** el pago de
NovuChat: sigue `pendiente` (con `cobro.estado` actualizado, para que la consola
pueda decir «el banco detectó un pago y lo está conciliando»). `BORRADOR` se resuelve
reintentando `crearCobro` con la misma referencia, que retoma el mismo cobro.

**Idempotencia por referencia.** La clave es que `pagoId === referenciaExterna === id del documento`:

- Crear: `tx.create(refPago)` falla si el documento ya existe, y el cobrador devuelve
  el mismo cobro ante la misma referencia (200 en vez de 201). Un reintento de red
  no produce dos QR ni dos documentos.
- Confirmar: la transacción relee `pagos/{pagoId}`; si ya está `confirmado`,
  responde `{ aplicado: false, ya: true }` y no suma meses otra vez.
- Resolver `referenciaExterna → tenant`: colección raíz `/cobrosPendientes/{pagoId}`
  con `{ tenantId, pagoId, cobroId, fichaQr, venceEn, creadoEn }`, escrita en la misma
  transacción que crea el pago y borrada al cerrarlo. Es además la lista de trabajo
  del barrido horario: no hace falta ninguna consulta de grupo entre tenants.

**Un solo pendiente por cuenta.** `cuenta/estado.pagoPendienteId` se escribe en la
misma transacción que crea el pago. Antes de crear, la transacción lee la cuenta y,
si `pagoPendienteId` apunta a un pago que sigue `pendiente` y cuyo `venceEn` no
pasó, rechaza con `failed-precondition` y **devuelve ese pago** (id, importe,
`fichaQr`, `venceEn`) para que la consola muestre el QR vivo y el botón «cancelar y
emitir otro». Si el pendiente ya venció según el reloj, el barrido lo cierra; la
consola ofrece «emitir otro», que primero llama a `anularPagoPendiente`.

**Quién escribe: solo Functions con el SDK Admin.** Ninguna regla admite escritura
desde el navegador, ni para el propietario: si pudiera, no habría auditoría de quién
confirmó qué. Las puertas son `crearCobroPrepago` (admin del tenant o propietario,
A-2), `pagoPorWhatsapp` (A-4, vía la misma función interna), `registrarPagoManual`
(propietario, A-1), `anularPagoPendiente` (admin o propietario, A-1), `avisoCobrador`
y `barridoCobros` (A-2).

**Quién lee:** el administrador del tenant con `tenantLegible` (un comercio cortado
tiene que ver sus pagos) y el propietario. El operador no (misma regla que
`/cuenta`, `firestore.rules:1521-1525`).

**La regla**, calcada de `/cuenta` (a continuación de `match /cuenta/{documento}`):

```
      // /pagos/{pagoId} — LOS PAGOS DEL PREPAGO: mensualidades, bolsas e
      // instalación, con su TCO. Solo los escribe el SDK Admin; nadie desde el
      // navegador, ni el propietario (quedaría sin auditoría). Los lee el
      // administrador del comercio, también cortado (tenantLegible), y NovuChat.
      match /pagos/{pagoId} {
        allow get, list: if (esAdmin(tenantId) && tenantLegible(tenantId))
                         || esPropietario();
        allow create, update, delete: if false;
      }
```

Y en la raíz, junto a `/plataforma`: `match /cobrosPendientes/{pagoId} { allow read, write: if false; }`.

**Pruebas de reglas (`pruebas/reglas.test.ts`, sección «Pagos del prepago»), escritas negando:**

| Caso | Esperado |
|---|---|
| el admin de A lee `tenants/A/pagos/p1` | pasa (control positivo) |
| el admin de A lista `tenants/A/pagos` ordenado por `creadoEn` | pasa |
| el admin de **B** lee o lista `tenants/A/pagos` | falla |
| el **operador** de A lee `tenants/A/pagos/p1` | falla |
| el admin de A hace `setDoc`/`updateDoc` con `estado: 'confirmado'` | falla |
| el admin de A crea un pago a mano | falla |
| el **propietario** (Google) escribe un pago | falla |
| el propietario con sesión de contraseña lee | falla (T-19) |
| el admin de A **suspendido** lee sus pagos | pasa (`tenantLegible`) |
| el admin de A **dado de baja** lee | falla |
| cualquiera lee o escribe `/cobrosPendientes/x` | falla |
| el admin de A escribe `cuenta/estado.pagoPendienteId` | falla |

### 4undecies.2 `cuenta/estado` se deriva de los pagos

**El principio:** los campos de situación de pago **no se escriben a mano**. Se
escriben junto con cada cambio de la cuenta, calculados por `estadoDeServicio`
(`prepago.ts`), desde una sola función `camposDerivados(estado, corteGuardado)`
(tomada de `cuentas.ts` de la rama, con un ajuste: el corte no se borra si está en
modo observación, §4undecies.4).

| Campo de `cuenta/estado` | Origen | Quién lo escribe |
|---|---|---|
| `modalidad` | `'demostracion' \| 'prueba' \| 'prepago'`; ausente = demostración | `actualizarEstadoCuenta({ modalidad })` (propietario, auditado) para `prueba` o `demostracion`; `aplicarPago` la pone en `prepago` al confirmar la primera mensualidad |
| `plan`, `limites`, `catalogoPlanes` | como hoy | `actualizarEstadoCuenta({ plan })` **y** `aplicarPago` de una mensualidad de otro plan («cambiar de plan es pagar el plan nuevo») |
| `periodoPagado` | `aaaa-mm`, último mes cubierto | solo `aplicarPago` |
| `periodoPrueba`, `bolsaPrueba` | mes de prueba y sus 20 conversaciones | `actualizarEstadoCuenta({ modalidad: 'prueba' })` los inicializa |
| `bolsa` | conversaciones compradas sin usar | `aplicarPago` suma; la ingesta descuenta (`consumoDeConversacion`) |
| `pagoPendienteId` | id del pago `pendiente` | la transacción que crea el pago; se borra al confirmar, vencer o anular |
| `corte` | `{ motivo, desde, perdidas, mensajesPerdidos, aplicado }` | la ingesta (§4undecies.3) y `aplicarPago` (lo borra al reactivar) |
| `estadoPago` | **derivado**: `al_dia`, `pendiente` (en gracia o con `pagoPendienteId`), `vencido` (cortado por `sin_pago`), `sin_cargo` (demostración) | `camposDerivados` |
| `proximoVencimiento` | **derivado**: `finDelPeriodoMs(periodoPagado)`; ausente en demostración | `camposDerivados` |
| `montoMensual`, `moneda` | **derivados**: `PLANES[plan].precioUsd`, `'USD'` | `camposDerivados` |
| `telefonosPago` | lista ≤ 5 de teléfonos que pueden pagar por WhatsApp | callable `fijarTelefonosPago` (admin del tenant, auditada). Va acá y no en la ficha porque la ficha la lee el operador y la ingesta |
| `corteActivo` | `true` para encender el corte en **este** tenant antes que en toda la plataforma | `fijarCortePrepago` (propietario) |

**Lo que hoy pisa esos campos, línea por línea, y qué se hace (bloque A-1):**

| Archivo:línea | Qué escribe | Resolución |
|---|---|---|
| `index.ts:314` (`suspenderTenant`) | `estadoPago: 'vencido'` | se quita: suspender corta el **servicio**, no afirma nada sobre el pago |
| `index.ts:353` (`reactivarTenant`) | `estadoPago: 'al_dia'` | se quita: no se afirma «al día» sin un pago que lo respalde |
| `index.ts:536-563` | acepta `estadoPago`, `montoMensual`, `moneda`, `proximoVencimiento` | se **rechazan** con `invalid-argument` «se deriva de los pagos» |
| `index.ts:115-121` (`exigirAdminDe`) | no mira proveedor ni correo verificado | exige `sign_in_provider === 'password'` y `email_verified`, igual que `esAdmin()` de las reglas, porque A-2 y A-3 agregan callables de admin |
| `pruebas/estado-cuenta.test.ts:146-158` | prueban que esos campos se aceptan | se reescriben negando |
| `web/src/paginas/EstadoCuenta.tsx:54-55, 86-99`, `Tablero.tsx:352, 490-491` | pintan `estadoPago`, `montoMensual`, `proximoVencimiento` | siguen leyendo los mismos nombres: ahora son derivados |
| `scripts/asignar-plan.mjs` | escribe plan sin tocar el resto | no cambia |

`actualizarEstadoCuenta` gana `modalidad` (cerrada, `esModalidad`), `periodoPrueba`
(`aaaa-mm`, opcional; por defecto el mes en curso al pasar a `prueba`) y
`corteActivo` (booleano), y recalcula `camposDerivados` en la misma transacción
(`index.ts:607-663`), leyendo `metricas/{periodo}` para `consumidas`.

**Migración (`Analisis/29` §2.6), antes del primer pago:** los comercios con `plan:
'demostracion'` quedan como están (sin `modalidad`; además `estadoDeServicio` trata
`plan === 'demostracion'` como demostración, doble salvaguarda). El tenant
`novuchat` igual. Los comercios reales reciben `modalidad` y `periodoPagado` **a
mano, uno por uno**, con `actualizarEstadoCuenta` o un `migrar-prepago.mjs` seco por
defecto. Ningún comercio recibe `modalidad: 'prepago'` sin un pago o una decisión
explícita de Andres.

### 4undecies.3 Reaplicación de `prepago.ts` sobre la ingesta de hoy

#### Qué se conserva tal cual del módulo del 08/09

`MODALIDADES`, `esModalidad`, `TipoCambio`/`esTipoCambio`/`TCO_MINIMO`/`TCO_MAXIMO`,
`importeBs` (lanza sin TCO válido), `MONEDA_LISTA`/`MONEDA_COBRO`, `esPeriodo`,
`sumarMeses`, `periodoSiguiente`, `periodoAnterior`, `diasDelPeriodo`, `diaDelMes`,
`finDelPeriodoMs`, `inicioDelPeriodoMs`, `fechaFinDelPeriodo`, `fechaCorta` (en hora
de Bolivia, UTC−4), `CuentaCruda`, `Corte`, `MotivoCorte`, `corteDe`, `consumidasDe`,
`consumoDeConversacion`, `Pago`, `montoUsdDe`, `descripcionDe`, `CuentaTrasPago`,
`aplicarPago`, `resumenDeCuenta`, `VOSEO`, y la mitad de `estadoDeServicio`.

#### Qué se corrige

| Qué | Cómo | Por qué |
|---|---|---|
| **`PLANES`, `BOLSA`, `PLAN_POR_DEFECTO`, `esPlan`** de la rama | se **borran**; `prepago.ts` importa `PLANES`, `BOLSA`, `esIdPlan`, `limitesDeCuenta` de `planes.ts` | la rama dice `base/crecimiento/corporativo`; `main` dice `impulso/crecimiento/pro` (`planes.ts:76-80`). Las incluidas se leen de la **copia** `cuenta.limites.conversaciones` vía `limitesDeCuenta`, como el aviso del 80 % y el límite de productos |
| **`periodoDe`** de la rama (Bolivia) | se borra; se usa `periodoDe` de `planes.ts:218` (UTC) para todo lo que sea **id de agregado o de aviso** | dos funciones con el mismo nombre y distinta zona son el defecto que `planes.ts` ya documenta. La **cobertura** se decide por instantes: `cubierto = ahoraMs <= finDelPeriodoMs(periodoPagado)`. Lo único que usa el mes UTC es `consumidas`, y en las 4 horas de desfase falla hacia el lado seguro |
| **`estadoDeServicio(cuenta, consumidas, periodo)`** | pasa a `estadoDeServicio(cuenta, consumidas, ahoraMs)` y devuelve además `fase: 'cubierto' \| 'gracia' \| 'cortado'` y `graciaHasta: number \| null` | la gracia es tiempo, no mes |
| **Gracia de 48 h** | `GRACIA_MS = 48 h`. Con `periodoPagado === periodoAnterior(mesActualBolivia)` y `ahoraMs < inicioDelPeriodoMs(mesActual) + GRACIA_MS` → `fase: 'gracia'`, `operativo: true`. Pasado eso → `cortado`, `sin_pago` | **D0 = día 1 del mes sin cobertura, 00:00 Bolivia; el corte rige desde las 00:00 del día 3.** Es el único reparto en el que «vence hoy» (D0), «48 horas» y «corte a las 00:00» son verdad a la vez |
| **`prueba`** | igual que `prepago` para la cobertura (`enPrueba = periodoPrueba === mesActual`), con gracia; **sin cobranza**: `recordatoriosDebidos` solo emite `conversion` | decisión 5 |
| **Calendario** | `DIAS_AVISO_RENOVACION = [7, 2]` → `[5, 1]`; se agregan `vencida` (D0), `cortePago` (D+2) y `cortePago2` (D+4, con `perdidas`) | `Analisis/36` §3.1 |
| **`PLANTILLAS`** | se reescriben con los **nombres y cuerpos de `docs/plantillas-cobranza.md`** (A-5): `mensualidad_vence_pronto` (D-5), `mensualidad_vence_manana` (D-1), `mensualidad_vencida_gracia` (D0), `asistente_sin_atender` (D+2), `asistente_sin_atender_perdidas` (D+4), `conversaciones_agotadas`, `prueba_termina`, `pago_confirmado` | los cuerpos de la rama tienen voseo residual y lenguaje de venta; la prueba de `VOSEO` los vigila |
| **`corte`** | gana `mensajesPerdidos` y `aplicado: boolean`; `perdidas` pasa a contar **teléfonos distintos** que consultaron durante el corte (marca `corteVisto` en la conversación, cero lecturas extra) | «[N] clientes te escribieron» tiene que ser clientes, no mensajes |
| **`MENSAJE_CORTESIA`** | pasa a ser función: `mensajeCortesia(numeroRecepcion)` → el texto de hoy + « Puede comunicarse al {número}.» si hay número válido | corrección 2 de `Analisis/36` §3.2. Nunca «mantenimiento», nunca «pago» |
| **`aplicarPago` con 6 meses** | suma `BOLSA.conversaciones` de regalo cuando `meses === 6` | «a partir de 6» con tope 6 es «al pagar 6» |
| **`meses`** | tope 6 (`MESES_MAXIMO`), no 12 | decisión 4 |

#### Dónde se decide en la ingesta, y cómo se cuentan las `perdidas`

Todo dentro de la transacción que ya existe (`ingesta.ts:1026-1200`). No se abre otra.

1. **Lecturas (1027-1029).** El `Promise.all` pasa a `[conversacion, cuentaDoc,
   plataformaDoc]` sumando `tx.get(db.doc('plataforma/prepago'))`. Es +1 lectura por
   mensaje y evita un caché cuya invalidación habría que probar.
2. **Métricas (1053-1054).** `const necesitaMetricas = conteo.conversacion &&
   (avisoConsumoPendiente(cuenta, periodo) || modalidadDe(cuenta) !== 'demostracion')`.
   Solo un mensaje que **abriría** una conversación puede chocar con `sin_conversaciones`.
3. **Decisión (nuevo bloque entre 1058 y 1060):**
   ```ts
   const servicio = estadoDeServicio(cuenta, consumidasDe(metricasDoc?.data()), ahoraMs);
   const aplica = corteAplicable(cuenta, plataformaDoc.data());  // §4undecies.4
   const corteGuardado = corteDe(cuenta);
   const rechazo = rechazoPorPrepago(servicio.motivo, conteo.atencion);   // de la rama
   ```
   `sin_pago` rechaza todo; `sin_conversaciones` rechaza solo lo que **abriría** una
   conversación (una ventana ya abierta se atiende hasta el final: ya se pagó).
4. **Si hay `rechazo`**: se escribe `cuenta.corte` con `merge` (`motivo`, `desde`,
   `aplicado: aplica`, `perdidas += (entrante consulta && conversacion.corteVisto !== desde ? 1 : 0)`,
   `mensajesPerdidos += (entrante ? 1 : 0)`) y `camposDerivados`; se marca
   `corteVisto: desde` en la conversación.
   - **Con `aplica === true` (cortado):** se escribe el mensaje en `mensajes` y
     `ultimoMensaje`/`ultimoEn` (el comercio tiene que ver **quién** le escribió), pero
     **ningún contador de facturación se mueve**. La respuesta HTTP es **200** con
     `servicio: { estado: 'cortado', motivo }` (no 409: el 409 de la ingesta significa
     «ficha no activa»).
   - **Con `aplica === false` (observación):** todo sigue como hoy. El corte queda con
     `aplicado: false`; la bitácora **no** recibe `corte_servicio`, la auditoría recibe
     `corte_observado` (una vez por corte).
5. **Sin rechazo y con corte guardado:** `corte: FieldValue.delete()` +
   `camposDerivados`; bitácora `reanudacion_servicio` solo si el corte tenía `aplicado: true`.
6. **Bolsa (dentro del `if (conteo.atencion)`):** `consumoDeConversacion(servicio)`
   descuenta `bolsa` o `bolsaPrueba`; si `cortaDespues`, anota `corte: { motivo:
   'sin_conversaciones', desde, perdidas: 0, aplicado: aplica }`; **este mensaje se atiende**.
7. **Escrituras (1072-1184):** se envuelven en `escribirMensaje(tx, conteo)` para que el
   caso «cortado» escriba solo el mensaje. `avisoConsumo` (1190-1197) no cambia.
8. **Retorno (1199) y respuesta (1264-1271):** se agrega `servicio: { estado, motivo, fase, graciaHasta }`.

**Bitácora y auditoría.** `TipoEvento` (`ingesta.ts:511-544`) suma `'corte_servicio'
| 'reanudacion_servicio' | 'pago_registrado'`. Las tres listas (`ingesta.ts`,
`firestore.rules:2035-2060`, `web/src/lib/bitacora.ts:52-70`) se tocan juntas o
`pruebas/bitacora-tipos.test.ts` rompe. El entrante durante el corte se registra como
`mensaje_entrante` con `resultado: 'rechazado'` y `codigo: 'cortado'`.

#### `configuracionFlujo` (línea 1304 en adelante)

1. `config/negocio` se lee **antes** del `if (comercio.estado !== 'activo')` (1354),
   porque la cortesía ahora lleva `numeroRecepcion`.
2. **Leer siempre `cuenta/estado`, `metricas/{periodo}` y `plataforma/prepago`**, no
   solo con teléfono (1389-1394).
3. `if (!servicio.operativo && corteAplicable(...) && !(servicio.motivo ===
   'sin_conversaciones' && telefono && !ventanaVencida(marcas, ahora)))` → `409 {
   estado: servicio.motivo, mensajeCortesia }`. **Los flujos ya obedecen ese 409.** No
   se toca `atencion.estado`: el corte entra por `¿Comercio operativo?`, que está antes.
4. **En gracia o en observación:** 200 normal, más `prepago: { modalidad, fase,
   motivo, graciaHasta, disponibles, corteAplicado }`. Ningún flujo decide con eso.

**Reactivación en ≤ 60 s:** `configuracionFlujo` no cachea nada hoy, así que el
siguiente turno ya lee la cuenta con `periodoPagado` nuevo.

#### Qué se reutiliza como molde

- **`seguimientos.ts`** para la cobranza: `recordatoriosPrepago` (POST, devuelve lo
  debido hoy para **todos** los tenants con modalidad, autenticado con
  `rutaAutenticada` y `ruta.flujo === 'onboarding'`) y `recordatorioPrepagoEnviado`
  (POST `{ tenantId, clave }`, **marca antes de enviar** en `cuenta.recordatorios[clave]`
  en una transacción que responde `repetido` si ya estaba). Se adopta el criterio de
  `seguimientos.ts:35-39` («un seguimiento perdido es mejor que dos») y **se descarta**
  el de la rama (`marcarRecordatorioPrepago` exigía `idMensaje`, o sea marcaba después).
- **`firma.ts`**: el esquema HMAC de `rutaAutenticada` (`firma.ts:195-200`:
  `sha256(secreto, "${marca}." + cuerpoCrudo)`, ventana de 5 min, `timingSafeEqual`) es
  lo que NovuChat le propone al cobrador para el aviso (§4undecies.5). Se exportan
  `firmaValida` y `VENTANA_MS` (hoy privados, líneas 108 y 112).
- **`dibujoQr.ts`**: **no se usa** (el cobrador entrega PNG). Si el banco algún día
  devuelve la cadena EMV, `imagenDePago` puede redibujar con `dibujarQr`.
- **`atencion.ts`** como molde de módulo puro compartido con la consola
  (`web/src/lib/prepago.ts` reexporta, como `web/src/lib/planes.ts:23-35`).
- **`cobro.ts:200-243` (`imagenDeCobro`)** como molde de `imagenDePago`: pública, por
  ficha al azar de 128 bits, 404 si el pago no está `pendiente`.

#### Qué NO se comparte con `cobro.ts` / `sena.ts` / `cotejo.ts`

Son el comercio cobrándole a su cliente (decisión 2). `prepago.ts`, `pagos.ts`,
`cobrador.ts` y `cobroPrepago.ts` **no importan** `cobro.ts`, `sena.ts`, `cotejo.ts` ni
`qrSimple.ts`; `Pagar.tsx`/`EstadoCuenta.tsx` no importan nada de
`Cobros.tsx`/`Cobro.tsx`. Una prueba de fuente (`pruebas/prepago-separacion.test.ts`,
al estilo de `comportamiento-pantalla.test.ts`) lo exige y busca que ningún texto del
prepago contenga «seña» y ninguno de la seña contenga «mensualidad». Los datos
tampoco se cruzan: `config/{flujo}.cobroReal` y `tenants/{t}/pagos` no se tocan en
una misma Function. El prepago **sí** puede decir «pago confirmado por el banco» (es
el único lugar); la seña **nunca** (prohibición 3).

#### Choques del módulo del 08/09 con `main`

| Función de la rama | Choca con | Resolución |
|---|---|---|
| `PLANES`/`esPlan`/`PLAN_POR_DEFECTO` | `planes.ts:42-108` | se borran; importar |
| `periodoDe` (Bolivia) | `planes.ts:218` (UTC) | se borra; cobertura por instantes |
| `estadoDeServicio` leyendo `PLANES[plan].conversaciones` | `limitesDeCuenta` | se usa la copia |
| `recordatoriosDebidos` con `PLANES[estado.plan].nombre` | `PLANES_ASIGNABLES[plan].nombre` | importar |
| `rechazoPorPrepago` / `ventanaAbierta` | `atencion.ts` ya tiene `ventanaVencida` (`108-111`) | `ventanaAbierta` no se reaplica |
| `topeMensajes24h`, `estadoDelTope`, `limites` | bloques de 25 + umbrales | no se reaplican |
| `salientes`, `distribucion`, `ventanaCerrada` (costos) | otro frente (`Analisis/27` §8) | no se reaplican |
| `estadoPago: 'pendiente'` escrito por `marcarRecordatorioPrepago` | derivados | solo `camposDerivados` lo escribe |
| Aviso del 80 % (`planes.ts:244-270`) | no choca | conviven en la misma transacción |

### 4undecies.4 La bandera de modo observación

**Dónde vive: `plataforma/prepago`** (documento nuevo; `match /plataforma/{documento}`
de `firestore.rules:2117-2120` ya lo cubre: lo lee el propietario, nadie lo escribe
desde el navegador), **más `cuenta/estado.corteActivo` por tenant.**

```
plataforma/prepago
  corteActivo:   false        ← global. Ausente = false. Es el interruptor que la decisión 2 deja apagado
  actualizadoEn, actualizadoPor, motivo
  cobrador: { baseUrl, consumidor: 'novuchat', vigenciaHoras: 72 }   ← §4undecies.5 (no es secreto)
plataforma/prepago/historial/{id}     ← cada cambio de la bandera: { corteActivo, uid, en, motivo, tenantId? }
```

**Por qué las dos.** La global es la compuerta que el prompt exige («A-0 entra a
`main` en modo observación y así se queda hasta que Andres decida»). La de tenant
existe para el ensayo de extremo a extremo con el TENANT de ensayo: se enciende en
uno solo, se observa un ciclo completo, y recién después la global.
`corteAplicable(cuenta, plataforma) = modalidad !== 'demostracion' &&
(plataforma.corteActivo === true || cuenta.corteActivo === true)`. Un `corteActivo:
false` por tenant **no exime**: la exención es `modalidad: 'demostracion'` (o sin
modalidad, o `plan: 'demostracion'`). La lista de excepciones sigue siendo una sola.

**Qué hace apagada.** La ingesta calcula `estadoDeServicio`, escribe `cuenta.corte` con
`aplicado: false`, cuenta `perdidas` y `mensajesPerdidos` («lo que se habría perdido»),
deja auditoría `corte_observado`, y **atiende igual**: `configuracionFlujo` responde
200 y los contadores se mueven como hoy. Encendida: 409 en `configuracionFlujo`, cero
contadores en la ingesta, bitácora `corte_servicio`. Lo único que cambia es `aplica`;
el cálculo es el mismo, que es lo que permite mirar un ciclo entero antes de encender.

**Quién la enciende.** Callable `fijarCortePrepago({ corteActivo, motivo, tenantId? })`,
`exigirPropietario`, escribe el documento y una entrada en `historial` en una
transacción. Sin `tenantId` toca la global; con él, `cuenta/estado.corteActivo` y la
auditoría del tenant (`accion: 'corte_prepago'`). Ningún script con `--aplicar`: es
una decisión, y se quiere que quede quién y cuándo. Encender la global la decide
Andres «después del demo y con un pago confirmado de punta a punta»; Claude la
ejecuta con su OK.

**Cómo se ve en la consola.** Propietario, en `Tenants.tsx`: franja «Prepago en **modo
observación**: los cortes se calculan y no se aplican» (o «Corte **activo** desde el
dd/mm») con el botón que llama a `fijarCortePrepago`; en cada fila `modalidad`, `fase`
y, si hay `corte`, «cortaría por sin_pago desde el dd/mm · N clientes» en gris si
`aplicado: false` y en rojo si `true`. Comercio (`EstadoCuenta.tsx`): `corte` **solo si
`aplicado === true`**; un corte observado no existe para él. La consola importa
`estadoDeServicio` y `corteDe` vía `web/src/lib/prepago.ts` y no calcula nada.

**Pruebas negativas (`pruebas/prepago-ingesta.test.ts`, ingesta real contra el emulador, alias `cliente16`):**

| Caso | Esperado |
|---|---|
| tenant **sin modalidad**, `periodoPagado` vacío, bandera global **encendida** | 200, contadores se mueven, sin `corte` |
| tenant `modalidad: 'demostracion'`, bandera encendida, `consumidas` = 99.999 | igual: nunca se corta |
| tenant `plan: 'demostracion'` sin modalidad | igual |
| tenant `prepago` con `periodoPagado` de hace dos meses, bandera **apagada** | 200, contadores se mueven, `corte.aplicado === false`, `perdidas` sube, auditoría `corte_observado`, bitácora **sin** `corte_servicio` |
| mismo tenant, bandera apagada, `cuenta.corteActivo: false` | ídem (no exime nada, tampoco corta) |
| mismo tenant, `cuenta.corteActivo: true` | 200 con `servicio.estado: 'cortado'`, mensaje escrito, **ningún** contador se mueve, `perdidas` cuenta **una** vez por teléfono, bitácora `corte_servicio` una vez |
| `periodoPagado` = mes anterior, ahora = día 2 a las 23:00 Bolivia, corte activo | `fase: 'gracia'`, se atiende |
| ídem, ahora = día 3 a las 00:01 Bolivia | cortado |
| `configuracionFlujo` con tenant cortado y corte activo | 409 con `mensajeCortesia` que contiene `numeroRecepcion` y **no** contiene «pago», «deuda», «mantenimiento» |
| `configuracionFlujo` con `sin_conversaciones`, corte activo y teléfono con ventana abierta | 200 |
| `fijarCortePrepago` llamada por el admin del tenant | `permission-denied`, documento intacto |
| `fijarCortePrepago` por propietario con sesión de contraseña | `permission-denied` |

### 4undecies.5 El contrato con el cobrador: el real, verificado el 20/09/2026

**El contrato existe y está fusionado** en el proyecto de cobros (PR #38, bloque 1;
documento `docs/10-contrato-consumidores.md`, todavía en la rama `docs/estado-pr-38`
de ese repositorio). A-2 lo consume **tal cual**; el doble
`admin/pruebas/dobles/cobrador.ts` lo reproduce **exactamente**, no una versión
imaginada. Lo que sigue es lo verificado en su código (`packages/functions/src/api/`).

**Identidad.** Consumidor `novuchat`. `Authorization: Bearer <token>`; el token lo
configura el cobrador como `CONSUMIDOR_TOKEN_NOVUCHAT` (mínimo 32 caracteres) y
NovuChat lo guarda en Secret Manager como `COBRADOR_TOKEN` (`defineSecret`, `.value()`
solo en ejecución). Un token de consumidor **no abre** ninguna ruta del dueño, y lo
ajeno responde **404, nunca 403**. Cupo: **60 QR por hora** por consumidor
(`429 CUPO_POR_HORA_AGOTADO`). Base: `plataforma/prepago.cobrador.baseUrl` (no es
secreto), sin barra final; las rutas van bajo `/api/v1/`.

**Montos: texto decimal con punto** (`"150.50"`), nunca número ni centavos.
`monto` en NovuChat es entero en Bs, así que viaja como `String(monto) + ".00"`.
**Fechas** ISO 8601 con zona. **Errores** siempre `{ error: { codigo, mensaje } }`;
se mira `codigo`, que es estable. Sin `telefonoCliente`: no existe en este contrato.
El `concepto` **lo ve el pagador en su app bancaria**: va «NovuChat · <plan> · N
meses», sin nombre del comercio ni datos de persona.

| Operación | Petición | Respuesta |
|---|---|---|
| **`crearCobro`** | `POST /api/v1/cobros` `{ referenciaExterna, concepto (≤100), monto: "150.00", horasDeVigencia: 72 }`. `referenciaExterna` = `pagoId` (letras, números y `: _ . -`, ≤120) | **201** nuevo o **200** ya existía (**mismo cobro, mismo QR**): `{ cobro: { id: "cons-<64 hex>", referenciaExterna, estado, monto, moneda: "BOB", concepto, creadoEn, qr: { version, venceEn, imagenDisponible } \| null, pago: null }, imagenQrBase64 }`. `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA` si se repite la referencia con otro importe; `400 CUERPO_INVALIDO` / `MONTO_INVALIDO`; `429`; `502 PROVEEDOR_RECHAZO` / `QR_SUELTO_EN_EL_PROVEEDOR` (no reintentar con la misma referencia hasta revisar); `503 SERVICIO_NO_DISPONIBLE` (reintentable) |
| **`estadoCobro`** | `GET /api/v1/cobros/:id` o `GET /api/v1/cobros/por-referencia/:referencia` | `{ cobro }` con la misma forma; `pago` **solo** con `CONFIRMADO`: `{ confirmadoEn, ocurridoEn, monto, riel: "api-baneco" \| "scraping-yape" \| null, confirmadoPor: "automatico" \| "revision-manual" }`. No toca el banco: lee el estado que mantiene el satélite |
| **`anularCobro`** | `POST /api/v1/cobros/:id/anular` `{ motivo? }` | `200 { resultado: "ANULADO" }` (repetirlo sobre uno anulado devuelve lo mismo); `409 PAGADO_NO_SE_ANULA` (hay plata: consultar el estado); `409 PAGO_TARDIO_EN_REVISION` (pago sobre QR vencido; lo decide una persona) |
| **`listarCobros`** | `GET /api/v1/cobros?desde&hasta&limite` (ISO con zona; `hasta` exclusivo; rango ≤ 92 días; `limite` 1..100) | `{ desde, hasta, limite, truncado, cobros: [...] }`. Solo para conciliar (mensual, propietario) |
| **imagen del QR** | `GET /api/v1/cobros/:id/qr` | `{ imagenQrBase64, venceEn }`; `404 SIN_IMAGEN`. Viene también en `crearCobro`; sirve para pedirla de nuevo |

**Estados del cobrador y qué hace NovuChat con cada uno:**

| Estado | Significado | Pago de NovuChat |
|---|---|---|
| `BORRADOR` | reservado, el QR no se emitió (falló el banco); `qr: null` | sigue `pendiente`; se reintenta `crearCobro` con la **misma** referencia, que lo retoma |
| `QR_ACTIVO` | se puede pagar | `pendiente` |
| `PAGO_DETECTADO` | el banco reportó un abono; **todavía no conciliado** | `pendiente` (la consola puede decir «el banco detectó un pago y lo está conciliando»); **no se acredita nada** |
| `CONFIRMADO` | plata conciliada; terminal | `confirmado` (la única transición que suma meses) |
| `EN_REVISION` | monto distinto, fuera de vigencia, duplicado; lo mira una persona | `pendiente`; se avisa a NovuChat por auditoría |
| `VENCIDO` | venció sin pago y quedó anulado en el banco | `vencido`; se limpia `pagoPendienteId` |
| `ANULADO` / `RECHAZADO` | terminales | `anulado` |

**Una referencia externa no se recicla:** para volver a cobrar lo mismo se emite un
pago nuevo con otro `pagoId`. **`ENVIADO` y `COMPROBANTE_RECIBIDO` no existen** para un
consumidor. El banco vence los QR **por día**: un cobro vencido en nuestro reloj sigue
pagable hasta la medianoche si no se anula; por eso el barrido anula, no «olvida».

#### El aviso de confirmación (bloque 2 de C, en curso: rama `feat/aviso-de-confirmacion`)

Lo que ese bloque **ya decidió** en su dominio, y NovuChat toma como dado: un aviso por
cobro (clave `cobroId`), reconstruido al enviarlo desde el cobro y su evidencia (no una
copia guardada), reintentos **sin tope** con espera 30 s → 1 min → 5 min → 15 min →
1 h → 6 h → 1 día, y el cuerpo `AvisoDeConfirmacion`:

```
{ evento: "cobro.confirmado", idEvento: <cobroId, estable entre reentregas>,
  consumidorId: "novuchat", cobroId, referenciaExterna, montoCentavos,
  confirmadoEn: ISO, ocurridoEn: ISO | null, riel: "watcher-baneco" | "scraper-yape" | null }
```

Lo que ese bloque **no decidió todavía**, y NovuChat le pide (fila C de
`Prompts/COORDINACION.md`): transporte `POST` a una URL registrada por consumidor
(`https://<región>-<proyecto>.cloudfunctions.net/avisoCobrador`, configurada allá, no
viaja en ninguna petición); cabeceras `X-Firma: sha256=<hex>` y `X-Marca-Tiempo`
(milisegundos desde la época), con `hex = HMAC-SHA256(secreto, "<marca>." + cuerpo
crudo)`, que es byte a byte `firma.ts:198-199`; secreto por consumidor
(`CONSUMIDOR_AVISO_SECRETO_NOVUCHAT` allá, `COBRADOR_AVISO_SECRETO` en Secret Manager
acá; distinto del token de salida: comprometer uno no permite fabricar lo otro);
tolerancia ±5 min (`VENTANA_MS`); respuesta 2xx = entregado. Si C elige otro esquema,
A-2 cambia `verificarAviso` y nada más.

**Del lado de NovuChat (`avisoCobrador`, `onRequest`, `cors: false`):**

- Verifica la firma con `firmaValida` (tiempo constante). Fuera de ventana, firma
  inválida o cuerpo > 64 KiB: `401` sin explicar.
- **El aviso no es fuente de verdad** (lo dice el contrato, §1): después de la firma,
  `avisoCobrador` **llama a `estadoCobro(cobroId)`** con el token de salida y solo si la
  respuesta autenticada dice `CONFIRMADO` aplica el pago. Es la decisión 5 literal:
  aunque el secreto del aviso se filtrara, nadie acredita un mes sin que el cobrador,
  autenticado, lo afirme. El barrido llega al mismo resultado sin aviso.
- Respuesta idempotente: `200 { recibido: true, aplicado: boolean, estado }`. Un aviso
  repetido devuelve `aplicado: false, estado: 'confirmado'` y no suma nada. Un
  `referenciaExterna` desconocido: `200 { recibido: true, aplicado: false, estado:
  'desconocido' }` (para que el cobrador cierre el aviso) y un renglón en el log con
  el `cobroId` (no tiene datos de personas).
- **Qué aplica:** una transacción sobre `pagos/{pagoId}` + `cuenta/estado` +
  `tenants/{t}` (espejo del plan) + `cobrosPendientes/{pagoId}` (se borra):
  `aplicarPago` puro, `camposDerivados`, `corte: delete`, `pagoPendienteId: delete`,
  `estado: 'confirmado'`, `confirmadoPor: { origen: 'banco', cobroId, riel,
  confirmadoPorCobrador, avisoId }`, `montoRecibidoBs` desde `pago.monto`. Después,
  bitácora `pago_registrado` y, si había corte aplicado, `reanudacion_servicio`;
  auditoría `pago_aplicado`; y se encola la confirmación por WhatsApp
  (`cuenta.confirmacionesPendientes[pagoId]`, que `recordatoriosPrepago` devuelve como
  tipo `confirmacion` con la plantilla `pago_confirmado`).

#### El barrido horario

`barridoCobros`: `onSchedule('every 60 minutes')` (`firebase-functions/v2/scheduler`;
exige Cloud Scheduler habilitado, paso de nube tras la compuerta; la lógica vive en
`barrerCobrosPendientes(ahoraMs)` exportada para probarla sin scheduler). Recorre
`/cobrosPendientes` (≤ 500 por corrida), llama `estadoCobro` por cada uno y aplica la
tabla de estados de arriba. Un `QR_ACTIVO` con `venceEn` pasado hace más de 24 h →
`anularCobro` y cierra; si responde `PAGADO_NO_SE_ANULA`, vuelve a consultar y aplica.
Además, `EstadoCuenta.tsx` al abrirse con un `pagoPendienteId` llama a
`consultarPagoPendiente` (callable admin), que hace un `estadoCobro` puntual: es la
«consulta al abrir la pantalla» de `Analisis/36` §6.

#### Anulación al cargar un pago manual

`registrarPagoManual` lee `cuenta.pagoPendienteId`; si hay un pendiente, llama
`anularCobro` **antes** de la transacción: `ANULADO` → sigue y marca el pendiente
`anulado` (`motivoAnulacion: 'pago_manual'`); `409 PAGADO_NO_SE_ANULA` → aborta con
`failed-precondition` «ese QR ya se pagó: se aplica el cobro del banco, no el manual»
y aplica el confirmado por el camino normal; `409 PAGO_TARDIO_EN_REVISION` → aborta y
deja el pendiente para que lo resuelva el cobrador. Si el cobrador no responde:
aborta, no carga nada. Nunca dos pagos vivos por el mismo mes.

#### El QR como imagen PNG

`crearCobro` devuelve `imagenQrBase64`. `crearCobroPrepago` lo decodifica, comprueba
que sea PNG (8 bytes de firma, ≤ 512 KiB) y lo guarda con el SDK Admin en Storage:
`tenants/{t}/pagos/{pagoId}/qr.png`. Dos lectores:

- **La consola** lo lee con el SDK de Storage bajo la regla de §4undecies.7. Muestra
  importe en Bs, USD, TCO y fuente, vencimiento, y «lo puede pagar desde cualquier banco».
- **WhatsApp (A-4)**: Meta descarga desde `…/imagenDePago?f=<fichaQr>`, Function pública
  que busca `cobrosPendientes` por ficha y sirve el PNG con `Cache-Control: public,
  max-age=300` y `nosniff`, **404 si el pago ya no está `pendiente`**. No se pasa al
  vuelo desde el cobrador: cada descarga de Meta sería una llamada autenticada más.

#### Lo que todavía depende de C (bloques 2 a 4)

Sin bloque 2, NovuChat confirma solo por barrido (≤ 1 h) y por la consulta al abrir la
pantalla: **funciona igual, más lento**. Sin bloque 3, todos los cobros van a la cuenta
del proceso del cobrador: para el ensayo hace falta que ese proceso corra con la
cuenta `novuchat`. Sin bloque 4, la API es un proceso local sin URL pública: el ensayo
de punta a punta queda **listo pero sin ejecutar**.

### 4undecies.6 Costo en mensajes, por bloque

| Bloque | Mensajes que agrega | Quién los paga |
|---|---|---|
| **A-0** | **0.** El corte reutiliza el 409 que ya manda la cortesía. Durante un corte aplicado, cada consulta de un cliente final recibe **1** cortesía desde el número del comercio, como hoy con la suspensión; en observación, 0 | comercio (dentro de su franquicia), solo si está cortado |
| **A-1**, **A-2**, **A-3** | 0 | — |
| **A-4** | por pago: **2** (QR con importe y vencimiento; confirmación). Por ciclo de cobranza: **3** plantillas sin corte (D-5 con QR, D-1, D0); **5** con corte (+ D+2, D+4); **1** por `sin_conversaciones`; **1** de conversión en prueba | **NovuChat**, desde su número y su franquicia de 1.000: a 100 clientes, unos 500 mensajes al mes, dentro de la franquicia. Coherente con `Analisis/36` §5.1 (≈ 0,045 USD por cliente y mes sin corte, ≈ 0,07 con corte, 0 de comisión) |
| **A-5** | 0 (son las plantillas de A-4, presentadas a Meta) | — |

Optimización pendiente y no incluida: durante un corte aplicado, mandar la cortesía
**una vez por teléfono y por 24 h** en vez de una por mensaje. Se decide después de
ver `mensajesPerdidos` reales.

### 4undecies.7 Reparto por archivos y pruebas

Alias de secreto libres para las suites nuevas (usados: `cliente17` a `cliente20`):
**A-0 usa `cliente16`, A-2 `cliente15`, A-4 `cliente14`**.

#### A-0 — `prepago/modulo-y-cortes`

| | |
|---|---|
| **Crea** | `admin/functions/src/prepago.ts` (puro, reaplicado con §4undecies.3); `admin/functions/src/cobranza.ts` (`recordatoriosPrepago`, `recordatorioPrepagoEnviado`, molde `seguimientos.ts`); `admin/web/src/lib/prepago.ts` (reexporta); `admin/scripts/migrar-prepago.mjs` (seco por defecto) |
| **Modifica** | `ingesta.ts`: `Promise.all` (1027), condición de `metricasDoc` (1053), bloque de decisión tras 1058, `escribirMensaje`, retorno (1199) y respuesta (1264); `configuracionFlujo`: orden de lectura de `config/negocio` (1354/1374), lecturas de cuenta/métricas/plataforma (1389-1394), 409 del corte, campo `prepago`; `TipoEvento` (511-544). `index.ts`: exports; `actualizarEstadoCuenta` acepta `modalidad`, `periodoPrueba`, `corteActivo` y recalcula `camposDerivados` (607-663); nueva `fijarCortePrepago`. `firestore.rules`: tipos de bitácora (2035-2060). `web/src/lib/bitacora.ts:52-70`. `ESTADO.md`, `CLAUDE.md` §7 fila «Conversaciones incluidas» |
| **Pruebas nuevas** | `pruebas/prepago.test.ts` (pura: períodos, gracia hora por hora en los bordes, `estadoDeServicio` por modalidad, `aplicarPago` mes por mes incluidos 6 meses con bolsa de regalo y tope 6, `recordatoriosDebidos` día por día D-5..D+4 e idempotencia por clave, `mensajeCortesia` con y sin número y sin «pago»/«mantenimiento», `PLANTILLAS` sin voseo); `pruebas/prepago-ingesta.test.ts` (tabla de §4undecies.4, más: contadores idénticos a hoy con modalidad ausente; `sin_conversaciones` descuenta `bolsa` y no corta la ventana abierta); `pruebas/prepago-configuracion.test.ts` (409 con teléfono de recepción; 200 en gracia; 200 con demostración); `pruebas/cobranza.test.ts` (lista solo tenants con modalidad; nunca demostración; prueba solo `conversion`; marcar antes: segunda llamada `repetido`; tenant sin `telefonosPago` va en `sinTelefono`) |
| **Modifica pruebas** | `estado-cuenta.test.ts` (+ modalidad cerrada; `corteActivo` solo booleano) |
| **Necesita** | nada. Entra a `main` en observación |

#### A-1 — `prepago/pagos-y-carga-manual` (sobre A-0)

| | |
|---|---|
| **Crea** | `admin/functions/src/pagos.ts`: `aplicarPagoEnTransaccion(tx, refs, pago, confirmacion)` (**la única puerta que suma meses o bolsas**; A-2 la llama dentro de su transacción), `camposDerivados`, `registrarPagoManual` (propietario; exige `medio`, `referencia`, `tcoAplicado`/`tcoFuente`/`tcoFecha`, `montoRecibidoBs`, `evidencia` si transferencia, comprobando que el objeto exista en Storage; `motivoDiferencia` si difiere; anula el QR vivo vía `cobrador.anularCobro` si existe), `anularPagoPendiente` (admin del tenant o propietario), `fijarTelefonosPago` (admin), `consultarPagoPendiente` (admin). `admin/functions/src/tipoCambio.ts`: `tipoCambioDelDia()` lee `plataforma/tipoCambio { tco, fecha, fuente }`, lanza `SinTipoDeCambio` si falta o `fecha` tiene más de 4 días (fines de semana del BCB). `admin/scripts/fijar-tipo-cambio.mjs` (de la rama, con `fecha` diaria). Reglas `/pagos` y `/cobrosPendientes`. Storage: `match /tenants/{tenantId}/pagos/{pagoId}/{archivo}` con `archivo in ['qr.png','evidencia.jpg','evidencia.png','evidencia.pdf']`, `get` para admin legible o propietario, `create/update` de `evidencia.*` solo `esPropietario()` con tipo y tamaño (≤ 5 MB imagen, ≤ 10 MB PDF), `list`/`delete` `false`, `qr.png` solo lo escribe el Admin SDK |
| **Modifica** | `index.ts:314, 353` (quitar `estadoPago`); `536-563` (rechazar los derivados); `115-121` (`exigirAdminDe` con proveedor); exports. `firestore.rules`, `storage.rules`, `web/src/lib/cuenta.ts` (`pendiente` = «En gracia / cobro pendiente»). `ESTADO.md` |
| **Pruebas nuevas** | `pruebas/pagos.test.ts` (callables reales con `.run()`): el admin **no** puede `registrarPagoManual` ni en su comercio; propietario con contraseña no; sin TCO válido no registra; transferencia sin evidencia no; evidencia declarada que no existe en Storage no; importe distinto sin motivo no; confirmado no se anula; segundo pendiente con uno vivo → `failed-precondition` y devuelve el vivo; `anularPagoPendiente` del admin de B sobre A → `permission-denied`; `suspenderTenant` ya no toca `estadoPago`; `fijarTelefonosPago` rechaza > 5 y formatos malos. `pruebas/reglas.test.ts` sección «Pagos del prepago» (tabla de §4undecies.1). `pruebas/storage-reglas.test.ts` sección «Evidencia de pagos». `pruebas/tipo-cambio.test.ts` |
| **Modifica pruebas** | `estado-cuenta.test.ts:146-158` (ahora rechazan) |
| **Necesita** | A-0. `registrarPagoManual` llama a `anularCobro` solo si `cobrador.ts` existe: A-1 lo define como inyección (`anular: (cobroId) => Promise<Resultado>`) y A-2 la enchufa |

#### A-2 — `prepago/cliente-cobrador` (en paralelo con A-1, contra el doble)

| | |
|---|---|
| **Crea** | `admin/functions/src/cobrador.ts`: cliente HTTP del contrato real (`fetch` nativo de Node 22; `crearCobro`, `estadoCobro`, `estadoPorReferencia`, `anularCobro`, `listarCobros`, `imagenQr`; timeout 10 s; `defineSecret('COBRADOR_TOKEN')`, `defineSecret('COBRADOR_AVISO_SECRETO')`; `verificarAviso(peticion)` con `firmaValida`/`VENTANA_MS` de `firma.ts`; tipos de estado y códigos de error del contrato, y nada más). `admin/functions/src/cobroPrepago.ts`: `crearCobroPrepago` (callable, admin del tenant o propietario; TCO del día; pendiente único; `concepto` sin datos del comercio; guarda `qr.png`; escribe `cobrosPendientes`; reintenta con la misma referencia si el cobrador devolvió `BORRADOR`), `avisoCobrador` (`onRequest`, `cors: false`), `barridoCobros` (`onSchedule` + `barrerCobrosPendientes` exportada), `imagenDePago` (`onRequest` pública por ficha). `admin/pruebas/dobles/cobrador.ts`: doble en memoria que implementa **exactamente** §4undecies.5 (rutas `/api/v1/…`, 201/200 por referencia, `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA`, `429`, `PAGADO_NO_SE_ANULA`, `PAGO_TARDIO_EN_REVISION`, `SIN_IMAGEN`, 404 para lo ajeno, montos como texto, `firmarAviso(secreto, cuerpo, marcaMs)`), inyectable por `process.env['COBRADOR_DOBLE']` o por parámetro; se descarta cuando C exista |
| **Modifica** | `firma.ts` (exportar `firmaValida` y `VENTANA_MS`; nada más); `index.ts` (exports); `firestore.rules` (`/cobrosPendientes` deny si A-1 no lo puso); `.github/DESPLIEGUE-FIREBASE.md` (los dos secretos y la condición `COBRADOR_`) |
| **Pruebas nuevas** | `pruebas/cobrador-doble.test.ts` (el doble cumple el contrato: mismo `id` ante la misma referencia; otro importe → 409; anular pagado → `PAGADO_NO_SE_ANULA`; lo ajeno → 404). `pruebas/cobro-prepago.test.ts` (emulador + doble, alias `cliente15`): crear deja `pendiente`, `pagoPendienteId`, `cobrosPendientes`, `qr.png`; segundo crear → `failed-precondition` con el vivo; el admin de B **no** crea cobro en A; aviso bien firmado y doble en `CONFIRMADO` → `confirmado`, `periodoPagado` +N, `corte` borrado, `pagoPendienteId` borrado, bitácora `pago_registrado`; **aviso bien firmado pero doble en `QR_ACTIVO` o `PAGO_DETECTADO` → no aplica** (el aviso no confirma); firma inválida → 401 y nada cambia; marca fuera de ±5 min → 401; aviso repetido → `aplicado: false` y meses no se duplican; sin aviso, `barrerCobrosPendientes` confirma; `VENCIDO` → `vencido` y limpia; `registrarPagoManual` con QR vivo → lo anula primero; con `PAGADO_NO_SE_ANULA` → aplica el del banco y rechaza el manual; `imagenDePago` con ficha de pago confirmado → 404 |
| **Necesita** | la firma de `aplicarPagoEnTransaccion` y `camposDerivados` de A-1 (acordadas por este documento; A-2 desarrolla contra un stub y se integra cuando A-1 esté en `main`). Y la compuerta del demo para los secretos y el Scheduler |

#### A-3 — `prepago/consola-pagar` (con A-1 en `main`)

> **Estado al 23/09/2026: A-3 se parte en dos ramas.** La primera,
> `prepago/consola-pagar`, es **la mitad del comercio** y está hecha: «Pagar»
> con plan, meses, bolsas e instalación; importe en USD y en Bs con el TCO del
> día y su fuente; el QR por ficha; «ya pagué» y «cancelar»; historial de
> pagos; la cobertura, la gracia y `perdidas` en «Cuenta»; y la columna de
> corte en la cartera (en gris si es observado). La segunda, la **mitad del
> propietario** (`CuentaNegocio.tsx`: modalidad, plan, umbrales, suspender y
> reactivar, carga manual con evidencia, botón de `fijarCortePrepago`), es
> íntegramente las fases 1-2 de `Analisis/29` y va en su propia rama: son dos
> jornadas y ninguna de las dos mitades necesita a la otra para entrar.
>
> Dos desviaciones del plano de abajo, y por qué:
> - **No hay callable `cotizarPago`.** La pantalla lee `plataforma/tipoCambio`
>   con una regla nueva y acotada (`allow get: if request.auth != null` sobre
>   ESE documento) y arma el importe con `importeBs`, la misma función del
>   servidor. Una callable más para leer un dato público es una Function más
>   que desplegar, y el TCO del BCB no es de nadie.
> - **El QR no sale de Storage**, sale de `imagenDePago` por la ficha opaca que
>   ya devuelve `consultarPagoPendiente` (A-2). Es la única forma de ponerlo en
>   un `<img src>`, y la Function devuelve 404 en cuanto el cobro se cierra.

| | |
|---|---|
| **Crea** | `admin/web/src/paginas/Pagar.tsx` (plan, meses 1-6, bolsas; importe USD y Bs con TCO y fuente **leídos del servidor** vía `cotizarPago` callable o de `plataforma/tipoCambio`; el QR desde Storage; «cancelar y emitir otro»); `admin/web/src/paginas/CuentaNegocio.tsx` (propietario, fases 1-2 de `Analisis/29`: modalidad, plan, umbrales, suspender/reactivar, **cargar pago manual** con subida de evidencia, historial de `/auditoria` y de `/pagos`, bandera por tenant); `admin/web/src/componentes/HistorialPagos.tsx` |
| **Modifica** | `EstadoCuenta.tsx` (botón Pagar, `fase`/gracia, `corte.perdidas` solo si `aplicado`, historial, `telefonosPago` editable por el admin vía callable); `Tenants.tsx` (franja de modo observación, columnas modalidad/fase/corte, botón `fijarCortePrepago`); `Tablero.tsx:352,490` (derivados; sin cambio de nombre); `App.tsx` (rutas `/negocio/:tenantId/cuenta/pagar`, `/negocio/:tenantId/cuenta-novuchat`); `web/src/lib/prepago.ts` |
| **Pruebas nuevas** | `pruebas/prepago-pantalla.test.ts` (lectura de fuentes): `Pagar.tsx` y `EstadoCuenta.tsx` **no importan** `cobro`, `sena`, `Cobros`, `Cobro`; ningún texto contiene «seña»; el importe en Bs **no se calcula en la pantalla**; `perdidas` se pinta condicionado a `aplicado`; `Tenants.tsx` llama a `fijarCortePrepago` y no escribe `plataforma/`. `pruebas/indices.test.ts` si `pagos` necesita orden compuesto (no debería) |
| **Necesita** | A-1 (callables y regla), A-2 para el QR real (hasta entonces «cobro no disponible») |

#### A-4 — módulo de `Flujos/src/` (encolado detrás de B-1): la interfaz que necesitará

El número de NovuChat (ruta con `flujo: 'onboarding'`, tenant `novuchat`) autentica
como hoy con `X-NovuChat-Numero` + token. Functions que el módulo llama, todas
autenticadas con `rutaAutenticada` y `ruta.flujo === 'onboarding'`:

| Function | Cuerpo | Devuelve |
|---|---|---|
| `pagoPorWhatsapp` (POST) | `{ telefono, accion: 'menu' \| 'estado' \| 'pagar', tenantId?, plan?, meses? (1\|3\|6), bolsas? }` | `{ conocido: false }` si el teléfono no está en ningún `cuenta/estado.telefonosPago`; `{ elegir: [{ tenantId, nombre }] }` si está en varios y no vino `tenantId` (nunca se infiere de un nombre); `{ tenantId, resumen, estado: { fase, cubiertoHasta, disponibles, corte }, pago?: { pagoId, descripcion, monto, venceEn, qrUrl } }`. `qrUrl` = `imagenDePago?f=<ficha>`; el flujo la pone en `image.link` y el `caption` con importe y vencimiento. Un solo mensaje |
| `recordatoriosPrepago` (POST) | `{}` | `{ recordatorios: [{ tenantId, telefono, clave, tipo, plantilla, parametros[], qrUrl? }], confirmaciones: [{ tenantId, telefono, pagoId, plantilla, parametros[] }] }` |
| `recordatorioPrepagoEnviado` (POST) | `{ tenantId, clave }` **antes** de enviar | `{ marcado, repetido }` |
| `configuracionFlujo` | como hoy | sin cambios |

El módulo reporta cada saliente a la ingesta del número de NovuChat como hoy. El
disparador programado corre cada hora (las plantillas salen entre 09:00 y 19:00
Bolivia; la lista lo filtra en el servidor).

### 4undecies.8 Contradicciones entre `Analisis/36` y el código de hoy, y su resolución

| # | Dónde | Qué dice | Qué hay | Resolución |
|---|---|---|---|---|
| 1 | `Analisis/36` §1.1, `Analisis/29` §2.4 | `actualizarEstadoCuenta` pisa campos; fase 0 pendiente | ya es parcial (`index.ts:509-516, 533`) | fase 0 = rechazar los derivados (`536-563`), `suspender`/`reactivar` sin `estadoPago` (`314`, `353`), `exigirAdminDe` con proveedor (`115-121`) |
| 2 | `Analisis/36` §1.1, `Analisis/29` §2.5 | TCO **mensual** en `plataforma/tipoCambio.periodo` | decisión 6: TCO del **día de emisión** | `tcoFecha` (`aaaa-mm-dd`) en el pago y en `plataforma/tipoCambio`; no se emite con un TCO de más de 4 días |
| 3 | `Analisis/36` §1.2 y prompt de C; prompt coordinador («se comparte `dibujoQr.ts`») | el QR viene como «texto e imagen» | el banco devuelve **solo PNG** | el contrato entrega `imagenQrBase64`; `dibujoQr.ts` no se usa; pregunta abierta al banco anotada en el proyecto de cobros |
| 4 | `Analisis/36` §4.2 | «el teléfono tiene que estar en `usuarios` del comercio con rol admin» | `/miembros` no tiene teléfono; `/contactos` es «personas de referencia» | `cuenta/estado.telefonosPago` (≤ 5), fijado por el admin por callable auditada |
| 5 | `Analisis/36` §3.1 | D0 «venció hoy», corte «D+2 00:00», gracia 48 h | ambiguo | **D0 = día 1, 00:00 Bolivia; corte 00:00 del día 3** |
| 6 | `Analisis/36` §4.1 y §1.2 | referencia `tenant/periodo/pagoId` | decisión 3 (opaca) y el contrato real (sin `/`) | `pagoId` solo (128 bits al azar); resolución por `/cobrosPendientes` |
| 7 | `Analisis/36` §4.1, §1.2 y `Prompts/prepago-estricto.md` bloque 2 | «importe en centavos» | el contrato real pide **texto decimal** `"150.00"` | `cobrador.ts` convierte; NovuChat guarda entero en Bs |
| 8 | `Analisis/36` §7 fila 1 | «esta es la vez que se abre la transacción» | la seña y los seguimientos ya la abrieron (`ingesta.ts:1060-1070`) | el prepago se cuelga de las lecturas que ya existen; no abre otra |
| 9 | `CLAUDE.md` §7 tabla | «Conversaciones incluidas: Hecho en la rama de prepago» | no está en `main` | A-0 lo pone en modo observación; la fila se corrige |
| 10 | rama `prepago.ts` | `PLANES` `base/crecimiento/corporativo`; `periodoDe` Bolivia | `planes.ts:76-80`; `periodoDe` UTC (`218`) | §4undecies.3 |
| 11 | rama `cuentas.ts`/`cobroPrepago.ts` | `confirmarPago` por el propietario mirando un comprobante por WhatsApp | decisión 5 | no se reaplican |
| 12 | rama `cobroPrepago.ts` | marcar el recordatorio **después** de enviar | `seguimientos.ts:35-39` marca **antes** | se adopta «antes» |
| 13 | `Analisis/36` §3.3 | «el aviso del 80 % es el D-5 de `sin_conversaciones`» | el aviso del 80 % **no manda WhatsApp** (`planes.ts:122-127`) | se mantiene solo en consola; si se quiere por WhatsApp es +1 plantilla y se decide con el costo a la vista |
| 14 | `Analisis/36` §2.2 | «a partir de 6 meses, una bolsa de regalo» con tope 6 | — | «al pagar 6 meses» |
| 15 | `Analisis/36` §2.3 | subir de plan a mitad de mes, prorrateado | no está en ningún bloque | pendiente; hoy «cambiar de plan» es pagar el nuevo desde el mes que cubre |
| 16 | `Analisis/36` §4.1 paso 4 | «la pantalla cambia sola» | `EstadoCuenta.tsx` ya usa `onSnapshot` (línea 46) | se cumple sin nada nuevo |
| 17 | `Analisis/36` §4.2 | «al confirmar el banco, el mismo número escribe» | ninguna Function manda WhatsApp (`Analisis/35` pendiente) | se encola en `confirmacionesPendientes` y lo manda el flujo programado de A-4 en ≤ 1 h; la reactivación del servicio sigue siendo ≤ 60 s |
| 18 | `Analisis/36` §1.2 y prompt de C | «lo que falta para que otro producto la consuma» | bloques 0 y 1 de C **fusionados** el 20/09 | A-2 consume el contrato real; el doble lo reproduce |

**Reglas que no se discuten, verificadas contra este diseño:** nada bancario en
NovuChat (solo `fetch` a un contrato); confirman el banco (vía `estadoCobro`
autenticado) o el propietario con evidencia en Storage y auditoría; seña y prepago
separados en credenciales, colecciones, pantallas y textos, con prueba de fuente;
multi-tenant probado negando en reglas, Storage y callables; límites en el servidor
(meses ≤ 6, pendiente único, TCO obligatorio, `telefonosPago` ≤ 5); precios USD, cobro
Bs al TCO del BCB del día de emisión guardado en el pago; PRUEBA sin cobranza;
demostración no se corta; el mensaje al cliente final nunca dice «pago» ni
«mantenimiento»; identificadores por últimos 4 en logs; ningún secreto en el repositorio.

## 4duodecies. Seña por QR en reservas

> **Decidido el 17/09/2026** (`Analisis/30` §4, `Analisis/07` §4; rama
> `flujos/sena-por-qr`). El flujo de reservas cobra una **seña** por QR para
> retener el horario. Es la primera vez que el flujo de agendamiento cobra, y
> por eso esta sección toca las tres capas: el documento del flujo, dos
> pantallas que hasta ahora eran solo de venta, y una Function nueva que
> coteja. **Prohibición 3 de `CLAUDE.md` en cada texto**: nadie —ni el
> asistente, ni la consola, ni el servidor— dice «pago acreditado», «pago
> verificado» ni «recibimos tu pago». Se dice que el comprobante llegó y que
> los datos coinciden; quien confirma que entró la plata es el negocio en su
> banco.

### 4duodecies.1 Las decisiones, en orden

1. **La seña es un parámetro del flujo de agendamiento** (§4sexies): vive en
   `/config/agendamiento` como `senaImporte` (entero en la moneda del negocio;
   `0` = sin seña) y `senaMinutosRetencion` (entero, 5..180, respaldo 30). Un
   restaurante no retiene horarios: no va a `/config/negocio`.
2. **El QR del comercio (`cobroReal`) vive en el documento del flujo que
   cobra.** `/config/venta` si el negocio vende; `/config/agendamiento` si solo
   reserva. `registrarQrDeCobro` elige leyendo `tenants/{t}.flujos` (venta
   gana; sin ninguno de los dos, rechaza) y devuelve `documento`. Un negocio
   con los dos flujos tiene UN QR, en venta, y los dos flujos mandan el mismo.
   `cobroReal` lo escribe solo la callable, como hasta ahora: no entra en la
   lista blanca del navegador en ninguno de los dos documentos.
3. **Quien coteja es el servidor** (§7 de `CLAUDE.md`): la Function
   `cotejarComprobante` recibe lo que un modelo leyó del comprobante y
   devuelve `cuadra | no_cuadra | ilegible`. El flujo no compara nada, y el
   modelo tampoco decide: solo transcribe.
4. **La cita se retiene por hecho, no por dicho.** `agendar_cita` la crea con
   el título `PENDIENTE DE SEÑA · …` cuando la seña está activa (lo pone la
   expresión del nodo, no el modelo). Al cotejo `cuadra` el flujo quita el
   prefijo. Un flujo programado borra las pendientes con más de
   `senaMinutosRetencion` minutos, sin escribirle al cliente, y lo reporta.
5. **El cierre con seña lo crea el servidor al cotejar**, con `monto` y
   `cotejo`. Con seña activa el flujo no registra cierre al agendar: una cita
   pendiente que vence no es un cierre. Sin seña, todo sigue como hoy.
6. **Los comprobantes no se guardan.** Ni la imagen ni el PDF van a Storage ni
   a Firestore: solo el JSON leído y el resultado. Ver la revisión al cierre de
   §4nonies.3.
7. **Mensajes por conversación**: +1 (el QR, imagen con caption) en las que
   llegan a reservar. La confirmación del comprobante es un mensaje fijo, sin
   modelo. El aviso a recepción por cita pagada, con diferencia o ilegible lo
   paga NovuChat y no se cuenta al comercio.

### 4duodecies.2 Los campos

| Dónde | Campo | Tipo | Quién escribe | Qué pantalla lo muestra |
|---|---|---|---|---|
| `config/agendamiento` | `senaImporte` | int 0..10000 (0 = sin seña) | admin del negocio, con `tieneAgenda` (`configAgendamientoValida()`) | **Configuración de QR**, bloque «Seña para reservar» (`ConfiguracionVertical`, `CAMPOS.agendamiento`) |
| `config/agendamiento` | `senaMinutosRetencion` | int 5..180 (respaldo 30) | ídem | ídem |
| `config/venta` o `config/agendamiento` | `cobroReal` | map (`activo`, `cargaUtil`, `cuentas`, `nombreCuenta`, `banco`, `ficha`, …) | solo `registrarQrDeCobro` (Admin SDK) | **Configuración de QR**: lee el documento que le toca por `flujos` |
| `conversaciones/wa_{tel}` | `solicitud` (`etapa`, `desde`, `qrEnviadoEn`, `evento`, `cotejos`, `seguimientos`) | map | la ingesta y `cotejarComprobante` | ninguna todavía |
| `cierres/cita_<eventoId>` | `monto`, `moneda`, `cotejo` (`resultado`, `diferencias`, `montoLeido`, `banco`, `idMeta`, `intentos`, `en`) | number, string, map | `cotejarComprobante` | **Cobros**: columna «Comprobante» y el detalle (diferencias, monto leído, banco, intentos, fecha) |
| `metricas/{aaaa-mm}` | `senasEnviadas`, `senasCotejadas`, `senasVencidas` | int | la ingesta, `cotejarComprobante`, `senaVencida` | **Consumo**: «Señas: N enviadas · M cotejadas · K vencidas», solo si el mes trae alguna |

### 4duodecies.3 Lo que muestra cada pantalla, y lo que no

- **Configuración de QR** (`Cobro.tsx`) es una sola pantalla para los dos
  flujos que cobran. Decide el documento por la lista de flujos, igual que el
  servidor; explica por flujo qué hace el asistente con el QR; y monta al pie
  los parámetros propios de cada flujo en SU documento (§4sexies.2): costos de
  entrega a `venta`, seña a `agendamiento`. El QR de demostración solo se
  muestra a un negocio con venta: en reservas la seña va siempre por el camino
  real, y los dos modos no conviven (prohibición 3).
- **Cobros** (`Cobros.tsx`) gana la columna **«Comprobante»** —«Datos
  coinciden», «Hay una diferencia», «Ilegible», o nada— al lado de «Estado».
  Parecen la misma y no lo son: la primera es lo que leyó el servidor; la
  segunda, lo que afirmó una persona contra su banco. **Un cotejo que cuadra
  no comprueba nada**, y por eso el botón «Comprobar» sigue al lado de un
  cotejo que cuadra, y la ayuda lo dice: NovuChat coteja datos, no confirma
  dinero.
- **Consumo** (`Consumo.tsx`) agrega una línea con las tres cifras de señas,
  solo cuando el mes trae alguna: no se facturan, pero explican por qué un mes
  tiene más mensajes que conversaciones y cuántas reservas se caen.
- **Lo que ninguna pantalla muestra**: la imagen del comprobante (no se
  guarda) y la `solicitud` de la conversación (es estado del flujo, no un dato
  del negocio; si algún día hace falta, va en «Conversaciones»).

### 4duodecies.4 Lo que este bloque NO hace

Imágenes y PDF que no son comprobante, audio, seguimientos de la solicitud, y
el candado con un solo calendario: son los bloques 3, 4 y 5 de `Analisis/30`.
Los dos primeros están hechos: §4terdecies (medios) y §4quaterdecies (seguimiento).

### 4duodecies.5 El mismo cobro, en una VENTA (23/09/2026)

> **`Analisis/07` §4, que estaba escrito para el Demo B desde el 06/09 y no se
> había construido.** Toda la maquinaria de §4duodecies se porta al flujo de
> venta con **una sola diferencia**, y de ella sale todo lo demás:
>
> **En una reserva el importe esperado se LEE de la configuración; en una venta
> se FIJA cuando sale el QR.** La seña es un número fijo (`senaImporte`); el
> total de un pedido cambia con cada conversación.

**Las decisiones, en orden:**

1. **El total viaja con el QR, no con el comprobante.** El flujo lo reporta en
   el mismo mensaje que reporta el QR (`evento: 'qr_enviado'`, campo `monto`) y
   la ingesta lo guarda en `solicitud.monto` **dentro de la transacción que ya
   cuenta ese mensaje**. El cotejo lo lee de ahí. Es «por hecho, no por dicho»
   aplicado al dinero: el número quedó escrito cuando salió el QR y nada de lo
   que el modelo escriba después lo mueve.
2. **Si el pedido vino del carrito web, gana el total del SERVIDOR.**
   `pedidos/{id}.total` lo calculó `catalogoWeb.ts` con el costo de envío
   incluido y sin pasar por el navegador. Cuando la referencia de la solicitud
   es un `cat_…`, `cotejarComprobante` lee ese documento y descarta lo que
   mandó el flujo.
3. **Sin total no se coteja contra cero.** `409 sin_total`, y el comprobante lo
   mira una persona. Con cero, el cliente leería «el comprobante dice 350 y el
   pedido es de 0», que es un motivo falso.
4. **El QR pendiente caduca a las 24 h** (`MINUTOS_QR_VENTA`), que es la
   ventana de la conversación. No hay horario que liberar —eso es de la
   agenda—, pero un pendiente que no caduca convierte cualquier imagen en un
   pago. No hace falta un flujo programado: lo resuelve el reloj en el cotejo.
5. **El estado del cobro sale en los DOS modos** (`configuracionFlujo.cobro`,
   `cobroVenta.ts`), real y simulado. La compuerta del comprobante tiene que
   funcionar también en la demostración, o el camino que se prueba delante de
   un prospecto no es el que corre en producción.
6. **El cierre es `cierres/venta_<referencia>`**, con la misma cuenta que
   `idDesdeReferencia` de `cierres.ts`, para que no se cuente dos veces.
   Métricas propias: `cobrosCotejados` y `cobrosVencidos`.
7. **Lo que NO se porta, y por qué:** la retención del horario (no hay horario)
   y el adelanto a favor (lo contrario de una cita cancelada con seña es una
   devolución de dinero, y eso no lo decide un asistente).

**Campos nuevos**

| Dónde | Campo | Tipo | Quién escribe |
|---|---|---|---|
| `conversaciones/wa_{tel}` | `solicitud.monto` | number \| null | la ingesta, con `qr_enviado` |
| `metricas/{aaaa-mm}` | `cobrosCotejados`, `cobrosVencidos` | int | `cotejarComprobante` |

**Mensajes por conversación: −1** en las que llegan a pagar (el texto del
asistente viaja en el **pie** del QR y deja de salir aparte), **0** en el resto.
El mensaje fijo del cotejo reemplaza a la confirmación que hoy escribe el
modelo. Los avisos al negocio los paga NovuChat.

**Dos defectos que aparecieron al construirlo, y quedaron cerrados:**

- **La carga útil del QR viajaba al flujo.** `configuracionFlujo` volcaba el
  documento del vertical ENTERO, y adentro va `cobroReal.cargaUtil`: el código
  del QR llegaba a n8n en cada consulta y quedaba en los datos de ejecución.
  Contradecía lo que §4duodecies.1 dice con todas las letras («la imagen NO
  viaja acá: viaja su ficha»). Afectaba a los dos verticales que cobran y
  estaba en producción desde que existe el cobro real.
- **Un QR vencido se seguía sirviendo.** `imagenDeCobro` miraba `activo` y
  revalidaba el código, pero no `venceEl`. `registrarQrDeCobro` rechaza
  registrar uno vencido y `activar-cobro-real.mjs` se niega a encenderlo, pero
  ninguno de los dos mira lo que pasa DESPUÉS: un QR encendido en junio con
  vencimiento en septiembre se servía en octubre, el cliente escaneaba, el
  banco rechazaba y el negocio se enteraba por un reclamo.

`admin/functions/src/cobroVenta.ts`; pruebas en `pruebas/cobro-venta.test.ts`
(el servidor) y `pruebas/demo-b-cobro.test.ts` (el flujo, escrita negando).

## 4terdecies. Medios entrantes: clasificar, no mirar

> **Decidido el 17/09/2026** (`Analisis/34` §3.1 y §4.1;
> `CLIENTES/PLATINUM/analisis-audio-e-imagen.md`; rama
> `flujos/medios-entrantes`). Un audio, una foto o un PDF que **no** es
> comprobante entran al asistente convertidos en **texto**. Es el bloque 3 de
> `Analisis/30`, y la continuación natural de §4duodecies: los nodos que bajan
> y leen un medio ya existían para el comprobante; acá se usan para todo lo
> demás.

**El problema, con fecha.** El 17/09 un paciente mandó un audio y una imagen en
el mismo minuto. Al audio el asistente contestó que atiende por texto —un
mensaje que **se paga** desde el 01/10 y que no avanza nada, y una parte de esa
gente no vuelve a escribir— y de la imagen **inventó** que era un comprobante:
«Ya tenemos todo listo». Nadie vio la imagen. Eso roza la prohibición 3.

**Las dos reglas que sostienen todo lo demás:**

1. **El asistente NUNCA ve el medio.** No es una instrucción del prompt —«te
   mando la foto pero no diagnostiques»—, es el **cableado**: ningún nodo que
   tenga el binario en la mano tiene salida al agente. Del audio sale una
   transcripción marcada; de la imagen o del PDF, **una categoría de una lista
   cerrada** (`publicidad | boca_o_dientes | comprobante | documento_salud |
   otro`) que el flujo traduce a uno de cinco textos fijos. Así la prohibición
   de la clínica —no diagnosticar, no prometer resultados— se cumple **por
   construcción**. La clínica ya vio al asistente repetir afirmaciones de su
   propio material: pedirle que se contenga no alcanza.
2. **Nada se guarda.** Ni la imagen, ni el PDF, ni el audio: entran como
   binario, se leen y de ahí sale texto. No van a Storage ni a Firestore, y el
   enlace de Meta caduca en cinco minutos. Es la misma decisión que §4nonies.3
   tomó para el comprobante, por el mismo motivo: **un medio guardado es un
   dato personal más que custodiar**, y acá muchos son datos de salud. Lo que
   queda en el historial de 12 meses es una marca —«(audio) el cliente envió
   una nota de voz»— y no el contenido. Lo que el paciente dijo se lee igual en
   la conversación, porque el asistente **repite en una línea lo que entendió**
   antes de ofrecer horarios (`Analisis/34` §3.1: es la red contra una
   transcripción errada de una hora o de un monto).

   Esa promesa vale para el **flujo**. En la **instancia** hay que apagar dos
   cosas en la VM y todavía no está hecho: `N8N_DEFAULT_BINARY_MODE=filesystem`
   (con el modo por defecto los bytes quedan en la base de n8n) y la poda de
   ejecuciones (`EXECUTIONS_DATA_PRUNE`, `EXECUTIONS_DATA_MAX_AGE`). Y la
   credencial de Gemini tiene que ser de **nivel pago**: en el gratuito el
   contenido puede usarse para entrenar.

**Lo que cuesta: nada en mensajes.** Cero agregados. Los dos nodos nuevos
contra Meta son de lectura (`media/mediaUrlGet` y la descarga del archivo) y
estos caminos **reemplazan** a la respuesta vacía que ya se pagaba. El modelo
cuesta centavos: ~0,001 USD por audio de 30 s, ~0,0001 por imagen. Lo que sí
cuesta es **latencia** (+2 a 4 s en audio, +1 a 2 en imagen sobre un p90 de
10 s), y por eso `Normalizar entrada` anota `recibidoEn` y `Mensaje a enviar`
deja `latenciaMs` en los datos de la ejecución: se mide con
`ver-ejecuciones.sh`, no se supone.

**El dato que faltaba, en la consola.** `metricas/{aaaa-mm}` gana
`entrantesPorTipo` —un mapa `{ text, interactive, image, audio, document,
location, order, otro }` que escribe la ingesta con `FieldValue.increment`
sobre la clave anidada, en la misma transacción que `entrantes`— y **Consumo**
muestra «Mensajes recibidos: N texto · M audio · K imagen …», solo si el
período lo trae. Es un mapa y no un campo por tipo porque los tipos los fija
Meta; la clave es el tipo **ya normalizado**, así que uno desconocido cae en
`otro` y las reglas lo vuelven a exigir (§7 de `CLAUDE.md`: el límite se hace
cumplir en el servidor). No se factura —Meta cobra lo que sale— pero es lo que
dice si vale la pena que el asistente entienda audios y fotos en este negocio.

**Lo que este bloque NO hace:** responder en voz (`Analisis/34` §3.2: no hay
evidencia de que convierta, un audio no se copia ni se escanea, y tienta a
mandar texto **y** audio, que duplica la parte cara), guardar el medio para que
una persona lo mire (eso sería un depósito de medios en la consola, que no
existe), ni reenviarlo al celular de recepción (§4.1 del mismo análisis: se
pierde con la ventana cerrada y deja datos de salud en un teléfono sin
retención).
## 4quaterdecies. Recordatorio de solicitud pendiente

**17/09/2026, `Analisis/31` §4.** De cada diez personas que le escriben a la
clínica, cuatro no terminan de reservar. **Un** recordatorio recupera a una
parte. Dos, o uno a quien pidió que lo dejen en paz, cuestan el número de
WhatsApp del comercio, que es su canal entero. Por eso todo lo de acá está
escrito en forma de negación.

### 4terdecies.1 Quién entra, y quién no

La decisión es una función pura del servidor —`esPendienteDeSeguimiento`, en
`functions/src/seguimientos.ts`— y se prueba caso por caso en
`pruebas/seguimientos.test.ts`. Entra la conversación que cumple **todas**:

| Condición | Por qué |
|---|---|
| `solicitud.etapa` es `horarios` o `qr_enviado` | Son las dos etapas a medio camino. `agendada` y `vencida` están cerradas: **nunca a quien ya agendó** |
| `solicitud.seguimientos === 0` | **Nunca dos veces a la misma solicitud.** El cero tiene que estar escrito: un campo ausente o con otro tipo no entra |
| `noContactar !== true` | **Nunca a quien pidió que no le escriban**, ni a quien pasó a una persona |
| `atencionEstado` no es `operador` ni `bloqueado` | Esa conversación ya la atiende alguien, o el asistente dejó de responder por uso extendido. Un recordatorio automático encima sería el peor mensaje posible |
| `ultimoEn` entre 2 y 4 h → **texto**; entre 24 y 48 h → **plantilla** | Entre las 4 y las 24 no se manda nada: la ventana está por vencer o recién venció, el texto ya no entra y la plantilla llegaría de madrugada. Después de las 48 un recordatorio ya no es una actualización, es publicidad |

Tope de 50 por corrida. La consulta va por `ultimoEn` entre 2 y 48 horas atrás
—acotada por construcción— y el resto se filtra en memoria: consultar por
`solicitud.etapa` devolvería un conjunto que crece sin techo, porque una
solicitud en `horarios` que nadie retoma se queda ahí para siempre. **No hace
falta ningún índice compuesto**: es un campo con dos extremos de rango y el
orden sobre ese mismo campo.

### 4terdecies.2 La marca va ANTES del envío

El flujo llama primero a `seguimientoEnviado` y recién después manda. Si el
envío falla, la solicitud queda marcada y nadie reintenta: **un seguimiento
perdido es mejor que dos**, porque el segundo es el que hace que la persona
bloquee el número. `seguimientoEnviado` es idempotente dentro de una
transacción, así que dos corridas simultáneas no pueden mandar dos. El nodo
`¿Se marcó?` del flujo no deja pasar nada que el servidor no haya marcado en
esa corrida.

Es la misma forma que §4duodecies usa para las retenciones vencidas: **primero
se lo digo al servidor, después actúo**.

### 4terdecies.3 De dónde salen los dos hechos

Los escribe el flujo conversacional dentro de reportes que ya existían —**cero
mensajes agregados**—, y siempre por lo que PASÓ, no por lo que el modelo
escribió:

- **`horarios_ofrecidos`** (reporte del saliente): `consultar_disponibilidad`
  corrió en el turno y `agendar_cita` no. Son los mismos campos que sostienen
  el candado contra la doble reserva.
- **`no_contactar`**: el turno terminó transferido a una persona
  (`transferir === true`, en el saliente), **o** el texto del cliente coincide
  con una expresión regular fija, en el reporte del entrante. Lo que esa
  expresión no cubre —«borrame» sin tilde, «stop»— lo resuelve el interruptor
  **No contactar** de la pantalla de conversaciones, que una persona del
  negocio enciende cuando el cliente se lo pide. La regla de Firestore deja
  escribir ese campo, y solo ese, con un valor booleano.

### 4terdecies.4 Qué cuesta y qué se mide

El de modo `texto` cae dentro de la ventana: **+1 mensaje, solo en las
conversaciones que quedaron a medio camino**. El de modo `plantilla` cae fuera,
y la ingesta no cuenta un saliente sobre ventana vencida como conversación: al
comercio no se le factura nada. **La respuesta del paciente sí** abre una
conversación nueva, y es exactamente lo que se busca.

Dos contadores del mes, y los dos hacen falta juntos: `seguimientos` (los que
salieron) y `reactivadas` (en cuántos el paciente volvió a escribir dentro de
las 24 h). Los enviados solos no dicen nada. La consola los muestra en
«Consumo» solo cuando el período los trae.

### 4terdecies.5 Lo que este bloque NO hace

No manda plantillas de **marketing** ni reactivación de base: eso es un paquete
aparte, nunca incluido en el plan (`Analisis/31` §4). No le escribe a nadie que
no haya escrito primero. Y no mide de dónde vino el lead —la ventana gratuita
de 72 h de los anuncios sigue pendiente desde `Analisis/25` §1.4.

## 4quindecies. La consola nunca da un mensaje genérico: resalta el campo

**Política, decidida el 19/09/2026 por Andres**, después de que un
administrador con todo lo demás bien no pudiera guardar su QR: la pantalla le
escribía una lista suelta debajo del botón —«Tienes que confirmar que…»— y él
tenía que adivinar cuál de los ocho controles era. Dos de esos controles eran
casillas que ni siquiera se veían sin bajar.

**La regla, para toda la consola:**

1. **Todo problema sabe a qué campo pertenece.** El servidor no devuelve
   cadenas sueltas: devuelve `{ campo, texto }`. Si un problema no corresponde
   a ningún control —se cayó la red, falta permiso— no se mezcla con los
   demás: va aparte, al pie, porque no hay nada que el usuario pueda tocar.
2. **El campo se resalta**, con `aria-invalid` y el mensaje debajo del control
   (`.campo-error`, `aria-describedby`), no solo en un resumen lejano.
3. **El foco va al primer campo que falta**, y se desplaza hasta él: en un
   formulario largo, un aviso fuera de la pantalla no existe.
4. **El resumen de arriba nombra el campo**, con el mismo rótulo que se ve en
   la pantalla: «Se puede usar muchas veces: tienes que confirmar…».

Cubierto por `pruebas/qr.test.ts` («Cada problema dice a qué campo pertenece»),
que exige que TODO problema de cualquier QR traiga un campo conocido: un
mensaje nuevo sin campo rompe la suite, que es como se sostiene una política.

Lo mismo vale al revés: **no se le pide al comercio un dato que se puede
deducir**. Las coordenadas del pin se pedían en dos campos, con la instrucción
de hacer clic derecho en Google Maps; nadie iba a hacerlo. Se sacan del enlace
que el comercio ya pega (`functions/src/mapa.ts`), y la pantalla solo informa
si quedaron detectadas.


## 4sexdecies. Campañas de Meta: texto exacto, vigencia y tope por plan

**Decidido por Andres el 24/09/2026.** Un anuncio de clic a WhatsApp deja
escrito en el chat un texto que el comercio eligió al crear el anuncio. El
comercio carga ese **texto exacto** en la pestaña «Campañas», con fecha de
inicio y de fin, y puede tener **varias a la vez** hasta el tope de su plan.
Cuando llega ese texto, el flujo **salta el menú**: si el texto es igual a
una opción del menú, entra directo a esa rama; si no, va al asistente con la
campaña en el contexto. Una campaña nunca dispara la emergencia por su título.

### 4sexdecies.1 Dónde vive, y por qué un documento

Capa **común** (§4sexies): un anuncio lleva al número del comercio, no a un
flujo. Un solo documento, `tenants/{t}/config/campanas`:

| Campo | Quién lo escribe | Qué es |
|---|---|---|
| `lista` | la consola (admin del comercio) | lo **propuesto**: `{id, texto, inicio, fin}`, fechas `AAAA-MM-DD` de Bolivia, fin inclusivo |
| `revision` | solo `verificarCampanas` | el veredicto por campaña (`aprobada`, `rechazada`, `pendiente`, `fuera_del_plan`), con motivo, campo y el hash de la lista |
| `vigentes` | solo `verificarCampanas` | las aprobadas: lo único que lee `configuracionFlujo` |

Un documento y no una colección porque así la regla hace cumplir el tope con
`lista.size()`, sin contador aparte (el tope máximo es 10).

### 4sexdecies.2 El tope por plan, en el servidor

`planes.ts`: `campanas` por plan (Impulso 0, Crecimiento 3, Pro 10, BYOC 10,
demostración 10; **confirmado por Andres el 24/09/2026**) y `limiteDeCampanas`,
que lee la copia `cuenta/estado.limites.campanas` si es un entero de 0 a 10.
Va **fuera** de `Limites` porque ahí todo vale de 1 en adelante y la copia se
juzga completa con los tres de siempre.

La regla de `config/campanas` exige admin, comercio operativo, sello, que no se
toquen `revision` ni `vigentes` (por el diff), y `lista.size() <=
limiteCampanas()`, con la tabla escrita a mano y comparada con `planes.ts` por
la suite. **Una excepción deliberada:** si el plan bajó con campañas cargadas,
pasa una escritura que ACHICA la lista, para que el comercio pueda borrar.
`configuracionFlujo` recorta además al tope de hoy.

**La regla valida solo la forma mínima** de cada campaña (mapa de cuatro
claves, texto de hasta 300): una petición tiene un tope de 1.000 expresiones
evaluadas y validar campo por campo diez campañas lo agotaba desde la quinta
(medido en el emulador). El formato, las fechas y el contenido los decide el
servidor; una campaña mal escrita queda cargada y **nunca** se aplica.

### 4sexdecies.3 La verificación antes de aplicar

`verificarCampanas` es un disparador sobre el documento, como
`verificarComportamiento` (§4quater.5), y solo actúa si cambió `lista`.
`campanas.ts` (puro) decide, en este orden: tope del plan, forma, fechas (fin
pasado, inicio pasado para una campaña nueva o con el inicio cambiado, inicio a
más de seis meses, más de un año de duración), duplicados por palabras,
palabras de emergencia, la capa 1 de patrones del comportamiento, y el modelo:
¿es algo que un cliente de ESTE negocio escribiría, sin contradecir su
configuración ni prometer precios o promociones que la información del negocio
no respalda? Con el mismo texto ya aprobado no se le vuelve a preguntar. Un
modelo caído deja la campaña `pendiente`, y una pendiente no se aplica.

### 4sexdecies.4 El flujo

`configuracionFlujo` manda `campanas: [{id, texto, inicio, fin}]` con instantes
ISO: solo las `vigentes`, en curso hoy y dentro del tope. `Config del negocio`
vuelve a mirar la vigencia contra el reloj y deja `campanasActivas`.
`Normalizar entrada` compara las **palabras** del mensaje (sin mayúsculas,
tildes, signos ni emojis) con las de cada campaña, y lee además el `referral`
del anuncio de Meta. El estado de la conversación de Bellido salta el menú.
La consola compara con la misma cuenta; `campanas-consola.test.ts` lo fija.

**Mensajes:** −1 por cada conversación que entra por una campaña reconocida en
un flujo con menú (el menú no sale); 0 en el resto.

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

**Pero `altaTenant` no alcanzaba para un cliente real**, y eso se descubrió el
2026-09-07 revisando el alta de punta a punta: la función exige que el
administrador **ya haya ingresado una vez** (`getUserByEmail`, y si no está,
`failed-precondition`). Un administrador de comercio entra con correo y
contraseña, y la consola **no tiene pantalla de registro**: nadie podía crearse
la cuenta. O sea que el alta era imposible, y el único script que creaba
usuarios —`usuarios-prueba.mjs`— usaba contraseñas escritas en el propio
archivo.

### 6.1 El procedimiento real, paso por paso

```bash
# 1. El negocio y su administrador, con enlace para que ponga su contraseña.
node admin/scripts/alta-comercio.mjs --proyecto <id> \
  --tenant salon-rosa --nombre "Salón Rosa" --flujos agendamiento \
  --admin ana@ejemplo.com --nombre-admin "Ana Quispe" --aplicar

# 2. El secreto del alias libre que sigue (cliente01, cliente02, …).
gcloud secrets versions access latest --secret=INGESTA_CLIENTE01 --project <id>
#    → se carga como credencial de cabecera en n8n, y NUNCA se escribe en el repo.

# 3. El número de WhatsApp y su alias. NO hay camino desde la consola: ninguna
#    pantalla llama a `asignarNumero`, las reglas prohíben escribir
#    /rutasWhatsApp desde un navegador, y la Function no escribe `aliasSecreto`
#    (descubierto el 2026-09-14, alta de NovuChat). Se hace con el SDK Admin:
node admin/scripts/asignar-numero.mjs --proyecto <id> --listar     # alias libres
node admin/scripts/asignar-numero.mjs --proyecto <id> --tenant salon-rosa \
  --numero <phone_number_id> --waba <waba_id> --flujo agendamiento \
  --alias cliente01 --aplicar
```

**Ni una línea de código, ni un despliegue.** Antes, cada cliente obligaba a
editar `SECRETOS_POR_ALIAS` y desplegar Functions: un procedimiento de
ingeniería en medio de una gestión comercial. La reserva de veinte alias
—declarada el 2026-09-07— lo eliminó. Ver el comentario de `firma.ts` para por
qué son veinte secretos separados y no un mapa, y por qué nacen con un valor
real en vez de un marcador.

**Cuando se acaben los veinte**, se amplía la reserva y se despliega UNA vez, no
una por cliente. Conviene hacerlo con holgura, no con el cliente veinte ya
firmado.

### 6.2 Lo que sigue siendo manual, por diseño

Conectar el número de WhatsApp del cliente en Meta: son trámites ante un tercero
que se miden en días y no dependen de NovuChat. Ver §4bis.4 para el techo de
crecimiento que imponen.

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
