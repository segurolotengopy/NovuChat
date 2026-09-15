# La pantalla del propietario: qué cambia NovuChat en un comercio, y dónde vive el plan

**15-sep-2026.** Pedido por Andres: hoy la consola no tiene ninguna pantalla con
la que el propietario de NovuChat (claim `nc.p`, `esPropietario()` en
`admin/firestore.rules`) cambie algo de un comercio. Escrito contra `main`
(después del #73) y contra la rama sin fusionar
`integracion/prepago-sobre-flujos-vivos`, que ya resolvió buena parte de esto y
quedó bloqueada el 08/09.

**Solo análisis.** No cambia código, reglas ni scripts. No contiene secretos ni
identificadores.

---

## 0. Las decisiones, resumidas

| # | Tema | Recomendación | Esfuerzo |
|---|---|---|---|
| Fase 0 | **Arreglar lo que la pantalla usaría antes de dibujarla**: `actualizarEstadoCuenta` pisa campos, `exigirPropietario` no mira el proveedor y ninguna callable tiene pruebas | ✅ **Primero**, aunque nunca se haga la pantalla | ~1 jornada |
| Fase 1 | **Cuenta del negocio para el propietario**: catálogo de planes cerrado, plan con una sola fuente de verdad, suspender y reactivar, umbrales, historial de auditoría | ✅ **Ahora** | ~2 jornadas |
| Fase 2 | **Pagos con su TCO**, y el estado de pago derivado de los pagos | ✅ **Antes del primer cobro real** | ~2 jornadas |
| Fase 3 | **Agendas por plan** en el servidor (la fila del §7 que falta) | ✅ Antes de vender el plan Crecimiento | ~1,5 jornadas |
| Fase 4 | Alta y baja desde la consola | 🔜 Cuando el alta pase de dos por mes | ~1,5 jornadas |
| — | Número de WhatsApp y alias, superadministradores | ⛔ **Siguen siendo script** (§1.3) | — |

**La recomendación principal.** El plan vive en **`cuenta/estado`**, con un
identificador cerrado (`base` / `crecimiento` / `corporativo`) y una **copia de
sus límites** tomada al asignarlo. El **catálogo de planes va en código
versionado**, en un módulo puro compartido con la consola, igual que
`atencion.ts`. `tenants/{id}.plan` queda como espejo para pintar la lista, y lo
escribe solo la misma Function y en la misma transacción. Y todo se escribe con
**los nombres de campo de la rama del prepago**, para que reaplicarla después
no obligue a migrar dos veces.

**Costo por conversación: ninguno.** La pantalla no envía mensajes por
WhatsApp y no agrega lecturas en la ruta de un mensaje (§6).

---

## 1. Lo que el propietario tiene que hacer hoy sin pantalla

### 1.1 Primero, lo que el código dice de verdad

Verificado en `admin/functions/src/index.ts` y en `admin/web/src/`:

| Function | Quién la puede llamar | ¿La llama alguna pantalla? | Camino real hoy |
|---|---|---|---|
| `altaTenant` | propietario | no | `scripts/alta-comercio.mjs` (la Function no crea la cuenta del administrador, DISENO §6) |
| `bajaTenant` | propietario | no | **ninguno** |
| `suspenderTenant` / `reactivarTenant` | propietario | no | **ninguno** |
| `asignarNumero` / `liberarNumero` | propietario | no | `scripts/asignar-numero.mjs` (la Function no escribe `aliasSecreto`) |
| `actualizarEstadoCuenta` | propietario | no | **ninguno**; ESTADO.md pide usarla para probar los umbrales |
| `moverReclamo` | propietario | no | **ninguno**: los reclamos no cambian de estado |
| `invitarUsuario` | admin del comercio | **sí** (`Usuarios.tsx`) | consola |
| `quitarUsuario` | admin del comercio | **no** | ninguno |
| `otorgarAccesoSoporte` / `revocarAccesoSoporte` | **admin del comercio**, no el propietario | no | ninguno |

Hay dos correcciones a la premisa del pedido:

- **Acceso de soporte no es una acción del propietario.** Lo abre el
  administrador del comercio, a propósito: si el propietario pudiera
  concedérselo, T-5 no valdría nada. Que ninguna pantalla lo llame significa
  que **hoy nadie de NovuChat puede leer una conversación de un cliente, ni
  siquiera con permiso**. Eso se arregla en la consola del comercio. La
  pantalla del propietario solo muestra si hay una ventana abierta y hasta
  cuándo.
- **`quitarUsuario` tampoco tiene pantalla.** Un comercio puede invitar gente y
  no puede sacarla. Está fuera del alcance de este análisis, pero es el mismo
  tipo de hueco y conviene cerrarlo junto con la Fase 1.

### 1.2 Ordenado por frecuencia y por riesgo

Frecuencia esperada con 5 a 20 comercios, desde el 1 de octubre:

| Acción | Frecuencia | Riesgo si sale mal | Hoy | Recomendación |
|---|---|---|---|---|
| **Registrar un pago** (mensualidad, bolsa, instalación) con su TCO | **mensual, por comercio** | medio: factura que no se puede reconstruir | no existe en `main` | **pantalla** (Fase 2) |
| **Reactivar** a un comercio que pagó | ocasional, y **urgente** | alto: el comercio que pagó sigue sin servicio | sin camino | **pantalla** (Fase 1) |
| **Suspender** por falta de pago | ocasional | alto si se equivoca de comercio | sin camino | **pantalla** con confirmación (Fase 1) |
| Cargar el **TCO del mes** | mensual, uno para todos | alto: un cero de más multiplica la factura por diez | no existe en `main` | pantalla o script (Fase 2); cota 5–40 en el servidor |
| **Cambiar de plan** | trimestral, por comercio | medio | Function con texto libre | **pantalla** con catálogo cerrado (Fase 1) |
| Ver el **uso contra el plan** (conversaciones, 70 %, mensajes contra los 1.000) | semanal | bajo, pero es donde se erosiona el margen (§3 de la base comercial) | a mano, comercio por comercio, en «Consumo» | **columna en la lista** (Fase 1) |
| Ajustar **umbrales** de operador y bloqueo | rara, por excepción | medio | Function peligrosa (§2.4) | pantalla, dentro de la cuenta (Fase 1) |
| **Mover un reclamo** | semanal | bajo | sin camino | pantalla (Fase 1, es un botón) |
| **Alta de comercio** | uno o dos por mes | alto: claims, identificador quemado | script, por etapas y con agentes | **script por ahora**; pantalla en Fase 4 |
| **Asignar número y alias** | por número nuevo | **muy alto**: un número mal asignado escribe las conversaciones de un comercio en otro | script | **script** (§1.3) |
| **Baja** | rara | **muy alto** y casi irreversible | sin camino | script con `--aplicar`, o pantalla con confirmación escrita en Fase 4 |
| Superadministradores | casi nunca | el máximo del sistema | `superadmin.mjs` | **script, siempre** |

### 1.3 Qué conviene que siga siendo script, y por qué

El criterio no es la frecuencia: es **qué credencial hace falta**.

- **Número y alias.** Asignar un número incluye leer un secreto de Secret
  Manager (`gcloud secrets versions access`) y cargarlo en una credencial de
  n8n. **Una consola nunca puede mostrar un secreto**, así que la mitad del
  paso seguiría fuera de la pantalla igual. Partirlo en dos, una mitad en la
  consola y otra en la terminal, es peor que dejarlo entero en un script que ya
  simula primero, verifica por relectura y tiene prueba
  (`pruebas/asignar-numero.test.ts`).
- **Superadministradores.** `superadmin.mjs` lo dice: quien puede otorgar el
  rol puede otorgárselo a sí mismo, y una sesión de propietario robada se
  convertiría en una toma permanente.
- **Baja.** Revoca los claims de todos los usuarios y quema el identificador.
  Pasa pocas veces por año, y la fricción de un script con `--aplicar` es una
  virtud.

**Y lo contrario, que es el argumento más fuerte a favor de la pantalla.** Un
script corre con las credenciales de Firebase Admin de la máquina. **Se salta
todas las reglas, en todos los comercios, sin filtro de tenant.** Una callable
de propietario es angosta: valida la entrada, toca un comercio y deja
auditoría con el uid de una persona (los scripts auditan como `alta-comercio`
o `asignar-numero`, y con dos propietarios no se sabe quién fue). **Pasar lo
rutinario de script a callable no agranda la superficie: la achica.** Y deja
que Silvana registre un pago con su sesión de Google, sin credenciales del
proyecto en su máquina.

---

## 2. El plan: una sola fuente de verdad

### 2.1 Cómo está hoy

| Lugar | Quién lo escribe | Valores | Quién lo lee |
|---|---|---|---|
| `tenants/{id}.plan` | el alta (`altaTenant`, `alta-comercio.mjs`, `sembrar*.mjs`) | `'basico'`, `'demostracion'` | `Tenants.tsx`, `Tablero.tsx` |
| `tenants/{id}/cuenta/estado.plan` | `actualizarEstadoCuenta` | **texto libre de hasta 40 caracteres**, por defecto `'basico'` | `EstadoCuenta.tsx` |

Ninguno de los dos valores es un plan vigente. **No hay catálogo de planes en
`main`**: los números 25/50/90 por 100/220/500 solo existen en `CLAUDE.md`, en
el sitio y en `prepago.ts` de la rama bloqueada. Y nada mantiene de acuerdo los
dos campos: `actualizarEstadoCuenta` escribe uno y el alta el otro.

### 2.2 Cuál manda: `cuenta/estado`

Tres razones, en orden de peso:

1. **Es el documento que el servidor ya lee en la ruta de cada mensaje.** La
   ingesta lo lee dentro de la transacción que cuenta (los umbrales,
   `ingesta.ts`), y `configuracionFlujo` también. Cualquier límite futuro que
   dependa del plan (conversaciones incluidas, agendas) lo encuentra ahí **sin
   una lectura más**. Poner el plan en la ficha obligaría a sumar una.
2. **Ya tiene las reglas correctas.** Escritura cerrada para todos, lectura
   solo para el administrador y el propietario, operador afuera. La ficha, en
   cambio, la lee todo miembro, operadores e ingesta incluidos (`allow get: if
   esMiembro(t)`). El plan no es un secreto, pero el importe que se le cobra a
   un comercio no es asunto de quien atiende el chat.
3. **Junta en un documento lo que cambia junto.** Plan, modalidad, estado de
   pago, vencimiento y umbrales se escriben en la misma transacción y se
   auditan juntos.

**`tenants/{id}.plan` queda como espejo**, igual que `/miembros` es espejo de
los claims: lo escribe **solo** la Function que cambia el plan y en la misma
transacción, sirve para pintar la lista sin leer N documentos, y **ninguna
regla ni ningún límite lo lee nunca**. La rama del prepago ya hacía exactamente
esto (`tx.update(refFicha, { plan })` en `cuentas.ts`). Hay que dejarlo escrito
en el comentario del campo, porque un espejo que alguien empieza a usar para
decidir es el comienzo de dos verdades.

### 2.3 El catálogo: en código versionado, con una copia de los límites en la cuenta

La tensión es real. «El límite se lee del plan, no se escribe en el código»
(§7.4) parece pedir el catálogo en Firestore. Pero la regla dice otra cosa: que
**quien aplica el límite no tenga el número escrito**, no que el catálogo no
pueda estar versionado.

| | Catálogo en código (`planes.ts` puro) | Catálogo en Firestore (`/plataforma/planes`) |
|---|---|---|
| Cómo se cambia un precio | PR, prueba, revisión, etiqueta | un clic, en producción, sin prueba |
| Quién ve el cambio antes | Andres y Silvana, en el PR, junto con `CLAUDE.md` y el sitio | nadie |
| La consola y el servidor coinciden | sí, importan el mismo módulo, igual que con `atencion.ts` | sí, leen el mismo documento |
| Las reglas de Firestore lo pueden leer | **no** (las reglas no importan TypeScript) | sí, con un `get()` más por petición |
| Frecuencia real de cambio | varias veces en septiembre, **todas con análisis previo** (`Analisis/16`, `21`, `23`) | — |

**Recomendado: en código, con una instantánea en la cuenta.** Cuando la
Function asigna un plan escribe en `cuenta/estado` el identificador **y** los
límites de ese plan en ese momento:

```text
cuenta/estado
  plan:        'crecimiento'              ← identificador cerrado
  limites:     { conversaciones: 220, agendas: 5, precioUsd: 50 }
  catalogo:    '2026-09-08'               ← versión del catálogo que se aplicó
  modalidad:   'prepago' | 'prueba' | 'demostracion'
```

Eso resuelve tres cosas de una vez:

- **Las reglas leen el límite de un dato, no de una constante.** Si una regla
  necesita el tope de agendas, lee `cuenta/estado.limites.agendas`. El número
  no está en `firestore.rules`, que es lo que pide el §7.4.
- **Un cambio de precios no toca a quien ya contrató** hasta su renovación, que
  es lo que dice un contrato. Sin la instantánea, subir el plan Crecimiento a
  USD 55 le cambiaría la factura al día siguiente a todos los que firmaron por
  50. Es una decisión para Andres (D3), pero la instantánea la deja abierta; el
  catálogo en Firestore sin copia la cierra en la peor dirección.
- **Una factura se puede reconstruir** con lo que dice la cuenta, sin saber qué
  versión del código estaba desplegada ese día.

El módulo se escribe **puro**, sin Firebase, y lo importan las Functions y la
consola, igual que `atencion.ts`. La rama del prepago ya lo tiene
(`PLANES`, `BOLSA`, `PRUEBA`, `importeBs` en `prepago.ts`) con los números
vigentes. Hay que **extraerlo a mano**, no fusionarlo: esa rama arrastra el
modelo del tope con corte (`planes.ts`, `TOPE_MENSAJES_24H`), que el modelo de
bloques de `Analisis/27` reemplazó.

Falta agregarle **las agendas por plan (1 / 5 / 10)**, que no están en
`prepago.ts`, y **la instalación (USD 65)**, que tampoco.

### 2.4 `actualizarEstadoCuenta`, tal como está, no se puede poner detrás de un botón

Tiene defectos que hoy no se ven porque nadie la llama. Verificados en
`index.ts`:

1. **Pisa lo que no recibe.** Escribe `plan: texto(plan) || 'basico'`,
   `montoMensual: … : 0`, `moneda: … : 'BOB'` y `motivoVisible: texto(…)` en
   **cada** llamada, aunque no vengan en la petición. Una llamada para cambiar
   solo los umbrales devuelve el plan a `'basico'`, deja la mensualidad en 0 y
   borra el motivo visible.
2. **Exige `estadoPago` siempre**, así que para tocar un umbral hay que volver
   a afirmar la situación de pago.
3. **Plan de texto libre.** Acepta cualquier cadena de 40 caracteres.
4. **Moneda por defecto BOB**, contra el §3 de la base comercial: la lista se
   denomina en dólares.
5. **Audita a medias.** El registro lleva `estadoPago` y los umbrales, pero
   **no el plan ni el monto**: un cambio de plan no deja rastro de a qué plan
   pasó.
6. **`estadoPago` se escribe a mano**, sin ningún pago que lo respalde. «Al
   día» es una afirmación, no una consecuencia.
7. **No actualiza `tenants/{id}.plan`**, así que las dos verdades se separan en
   la primera llamada.

**Riesgo inmediato:** el paso 3 de la sección del 13/09 de ESTADO.md dice que
se prueben los umbrales «con `actualizarEstadoCuenta` (por ejemplo 3 y 5)» y
que después se devuelvan con `null`. Hecho tal como está escrito, sobre un
comercio real, le deja `plan: 'basico'`, `montoMensual: 0` y el motivo en
blanco. **Hasta la Fase 0, esa prueba se hace mandando todos los campos o se
hace sobre un comercio de demostración.**

**Lo que se propone** (Fase 0): partirla en funciones con una sola
responsabilidad cada una, como hizo la rama del prepago con `configurarCuenta`,
`registrarPago`, `confirmarPago` y `rechazarPago`:

- `cambiarPlan(tenantId, plan)`: identificador del catálogo, instantánea de
  límites, espejo en la ficha, auditoría con el antes y el después.
- `fijarUmbrales(tenantId, operador, bloqueo)`: la validación de pareja que ya
  existe, y nada más.
- `registrarPago(…)` (Fase 2): la **única** puerta que cambia `estadoPago` y
  `proximoVencimiento`, que pasan a ser **derivados**.
- `actualizarEstadoCuenta` se conserva unos días con escritura **parcial**
  (solo lo que viene) para no romper a nadie, y después se retira.

### 2.5 El pago y su tipo de cambio

El diseño de la rama del prepago es correcto y conviene adoptarlo tal cual,
con dos agregados.

**Lo que se adopta:**

- `/tenants/{t}/pagos/{pagoId}`, **escritura cerrada para todos**, lectura para
  el administrador (con `tenantLegible`, para que un comercio suspendido vea
  sus pagos) y el propietario. Un pago confirmado **no se corrige**: se
  compensa con otro asiento, igual que un cierre.
- Cada pago guarda `montoUsd` (el de la lista), `monto` en bolivianos,
  `moneda: 'BOB'`, `monedaLista: 'USD'`, **`tcoAplicado`, `tcoFuente` y
  `tcoPeriodo`**. Sin el TCO la factura no se reconstruye, que es lo que exige
  el §3 de la base comercial.
- `/plataforma/tipoCambio` con `{ tco, periodo, fuente }`, cota de cordura
  5–40, y **sin valor por defecto**: si falta, el cobro falla. Cobrar con un
  tipo de cambio supuesto es peor que no poder cobrar.
- Redondeo al boliviano entero, porque el importe termina en un QR y en un
  comprobante.

**Los dos agregados:**

1. **Tipo `instalacion`**, además de `mensualidad` y `bolsa`. Hoy la
   instalación (USD 65) no tiene dónde registrarse.
2. **`montoRecibidoBs`**, lo que el banco muestra que entró, al lado del
   importe calculado. Un pago real llega con centavos de diferencia, o
   incompleto, o con la comisión descontada. Si la pantalla solo guarda el
   importe calculado, la diferencia se esconde; con los dos, queda escrita.

**Lo que decide Andres (D4):** con qué TCO. `Analisis/14` §5ter y el código de
la rama recomiendan **un TCO por mes calendario, el del primer día hábil, fijo
para todo el mes**. ESTADO.md (decisiones del 08/09) dice que falta decidir si
es ese o el del día de pago. La pantalla funciona con cualquiera de los dos; el
campo `tcoPeriodo` es el que cambia de significado.

### 2.6 Migración de lo que existe

Pocos documentos, pero cada uno es un caso:

| Hoy | Pasa a |
|---|---|
| Comercios de demostración (`plan: 'demostracion'`, `estadoPago: 'sin_cargo'`) | `modalidad: 'demostracion'`, sin plan, sin corte. `pagoAlDia` ya trata `sin_cargo` como al día |
| Tenant `novuchat` (`plan: 'basico'` del alta) | `modalidad: 'demostracion'` (NovuChat no se cobra a sí mismo); decisión D10 |
| Cualquier `'basico'` en un comercio que paga | el plan que figure en su contrato, **a mano**, uno por uno. No hay equivalente automático |
| `montoMensual`, `moneda` escritos a mano | se reemplazan por los derivados del plan (`limites.precioUsd`) |

**Un script `migrar-planes.mjs`**, con el patrón de los demás: simula por
defecto, imprime qué cambiaría en cada comercio, `--aplicar` para escribir,
auditoría con `accion: 'migrar_plan'` y verificación por relectura. Hoy son
menos de diez documentos, y **el mejor momento para migrar es antes de que
exista el primer pago**.

---

## 3. Reglas, Functions y pruebas que cambian

### 3.1 Functions

| Function | Cambio | Fase |
|---|---|---|
| `exigirPropietario` | exigir también `auth.token.firebase.sign_in_provider === 'google.com'` (§4.1) | 0 |
| `exigirAdminDe` | exigir `password` y `email_verified`, igual que las reglas | 0 |
| `actualizarEstadoCuenta` | escritura parcial ya; retiro cuando existan las de abajo | 0 |
| `cambiarPlan`, `fijarUmbrales` | nuevas; plan cerrado, instantánea, espejo, auditoría con antes y después | 1 |
| `suspenderTenant` | deja de escribir `estadoPago: 'vencido'`: suspender es cortar el **servicio**, y el motivo puede no ser el pago. El estado de pago lo derivan los pagos | 1 |
| `reactivarTenant` | ídem: no afirma `al_dia` si no hay un pago que lo respalde | 1 |
| `registrarPago`, `rechazarPago`, `fijarTipoCambio` | nuevas, tomadas de la rama del prepago con los agregados del §2.5 | 2 |
| `activarFuncionario` | nueva: cuenta las agendas activas **en una transacción** y rechaza la que pase del límite del plan | 3 |
| `configuracionFlujo` | entrega al flujo como máximo `limites.agendas` funcionarios: segunda línea de defensa (§3.3) | 3 |

**Todas las callables nuevas de propietario llevan `enforceAppCheck: true`**
(§4.3) y la comprobación de sesión reciente en las acciones que la necesitan
(§4.2).

### 3.2 Reglas

- `/tenants/{t}/pagos/{p}`: nueva, lectura para el administrador y el
  propietario, escritura cerrada. Es la de la rama del prepago.
- `/tenants/{t}/cuenta/{doc}`: **no cambia**. Ya está bien.
- `/tenants/{t}/funcionarios/{f}`: el navegador **solo puede crear con
  `activo: false`** y **no puede pasar `activo` de falso a verdadero**. Activar
  pasa por `activarFuncionario`. Lo demás (nombre, horario, calendario) sigue
  escribiéndose directo, como hoy.
- Si se adopta D8, una colección `/tenants/{t}/interno/{doc}` de solo
  propietario para las notas internas.

### 3.3 Las agendas por plan: la tabla del §7 pide algo que las reglas no pueden hacer

La tabla del §7 de `CLAUDE.md` dice que el tope de agendas se hace cumplir en
`firestore.rules`, «al crear un funcionario: contar los activos». **Las reglas
de Firestore no cuentan documentos.** No hay agregación en el lenguaje de
reglas. Hay dos maneras de cumplir el §7 igual:

| | Contador en las reglas | Activación por Function |
|---|---|---|
| Cómo | un documento contador que el navegador actualiza en el mismo lote que el funcionario; la regla compara con `getAfter()` y lo valida contra el límite | las reglas prohíben activar desde el navegador; `activarFuncionario` cuenta en una transacción |
| Lo que hay que validar | alta, baja, reactivación y que el contador corresponda al funcionario que cambió, todo en reglas | una consulta en una transacción |
| Presupuesto de reglas | uno o dos `get()` más en una regla que ya lee la ficha | ninguno: la regla solo mira un campo del propio documento |
| Fragilidad | alta: un contador desfasado bloquea al comercio o lo deja pasar | baja |
| Prueba negando | reglas | reglas (el navegador no puede activar) **y** Function (el plan chico no puede activar la segunda) |

**Recomendada la activación por Function**, más una segunda línea en
`configuracionFlujo`: **el flujo nunca recibe más agendas que las del plan**.
Esa segunda línea es la que protege lo que el límite existe para proteger:
según `Analisis/24` §2.4, el candado hace una llamada a Google Calendar **por
cada calendario configurado**. Aunque por un defecto quedaran once agendas
activas en un plan de diez, el turno que agenda consultaría diez. Hay que
corregir la redacción de la tabla del §7 cuando se implemente (no lo hace este
documento).

### 3.4 Pruebas

**El hueco más grande: ninguna callable tiene pruebas.** `pruebas/` ejercita
las reglas con el emulador de Firestore y funciones puras; el emulador de
Functions está configurado en `firebase.json` y nada lo usa. La autorización de
`suspenderTenant` o `actualizarEstadoCuenta` hoy **no la verifica nada**. Una
pantalla que las llama las vuelve camino crítico sin haberlas probado nunca.

La Fase 0 agrega un arnés que llama a cada callable con el emulador de
Firestore y un contexto de autenticación fabricado (las callables v2 se pueden
invocar directamente con `.run()`), y **las pruebas se escriben negando**:

- el administrador de un comercio **no puede** llamar a `cambiarPlan`,
  `suspenderTenant` ni `registrarPago`, ni sobre su propio comercio;
- una sesión de contraseña con `p: true` **no pasa** `exigirPropietario`;
- `cambiarPlan` **rechaza** un plan que no está en el catálogo, y **no toca**
  la mensualidad, el motivo ni los umbrales;
- `registrarPago` **no registra** sin un TCO válido, y un pago confirmado **no
  se rechaza**;
- `activarFuncionario` **no activa** la segunda agenda en el plan Base, ni la
  sexta en Crecimiento; y en las reglas, el administrador **no puede** crear un
  funcionario con `activo: true` ni activarlo con un `updateDoc` hecho a mano;
- `configuracionFlujo` **no entrega** más agendas que `limites.agendas`.

### 3.5 Cómo queda la tabla del §7

| Límite | Hoy en `main` | Con este plan |
|---|---|---|
| Agendas por plan (1 / 5 / 10) | **No existe**. Se cargan sin tope | **Cubierto** en la Fase 3: Function + reglas + `configuracionFlujo` |
| Conversaciones incluidas (100 / 220 / 500) | **No existe en `main`**. La tabla dice «hecho en la rama de prepago», y esa rama está sin fusionar | **Sigue pendiente**. La pantalla deja el plan y los pagos listos para que el prepago los lea, pero no corta. Mientras tanto, la lista del propietario **avisa** al 70 % y al 100 % (D11) |
| Bloque de 25 por conversación | Hecho | Sin cambios |
| Umbrales 50 / 100 por empresa | Servidor hecho | Ganan pantalla. Los flujos siguen pendientes de publicar |
| Ítems del catálogo al prompt | `limit(200)`, sin corte por plan | Sin cambios. Si algún día depende del plan, se lee de `limites` |

---

## 4. Seguridad

### 4.1 La superficie nueva es menor de lo que parece, y hay un hueco que ya existe

**Las Functions ya están desplegadas.** Cualquiera con un token de propietario
puede llamarlas hoy desde la consola del navegador. La pantalla no abre ninguna
puerta en el servidor: pone un botón delante de una puerta que ya está. Lo que
crece es otra cosa: la probabilidad de un clic en el comercio equivocado, y el
valor de un XSS en la consola, porque la sesión del propietario pasaría a tener
botones que cortan servicio. Contra lo segundo ya están la CSP estricta
(SEGURIDAD §5bis) y `TextoSeguro`. Importa porque la pantalla del propietario
muestra texto que no es de fiar: reclamos, nombres de comercio, motivos.

**El hueco que ya existe.** T-19 dice que un `p: true` sobre una cuenta de
contraseña queda **inerte** porque `esPropietario()` exige
`sign_in_provider == 'google.com'`. Eso vale **en las reglas**. En las
Functions, `exigirPropietario` mira solo el claim: una sesión de contraseña con
`p: true` **pasa**. Hoy no se explota porque `claims.ts` y `superadmin.mjs` se
niegan a poner `p` sobre una cuenta que tenga contraseña. Es una sola barrera
donde el diseño dice que hay dos. Se cierra con una línea en `exigirPropietario`
(el proveedor viaja en el token que la callable ya verificó), y lo mismo, al
revés, en `exigirAdminDe`.

### 4.2 Confirmaciones y sesión reciente

| Acción | Confirmación | Sesión reciente |
|---|---|---|
| Cambiar plan | muestra antes y después: plan, conversaciones, agendas, precio en USD y en Bs al TCO del mes | no |
| Fijar umbrales | muestra la pareja resultante y el techo de costo por ventana | no |
| Registrar pago | muestra el importe calculado, el TCO, su fuente y el período que queda cubierto | **sí** |
| Suspender | motivo obligatorio; vista previa del `motivoVisible` que va a leer el comercio; aviso de que el cliente final recibe el mensaje neutro | **sí** |
| Reactivar | sin fricción: es la acción que no puede esperar | no |
| Baja (Fase 4) | escribir el identificador del comercio para confirmar | **sí** |

**Sesión reciente** significa que la callable rechaza el pedido si
`auth.token.auth_time` tiene más de 15 minutos, y la pantalla pide
`reauthenticateWithPopup` con Google. Hoy nada en el sistema usa `auth_time`.
Dicho sin exagerar: si la sesión de Google del navegador sigue viva, la
reautenticación puede pasar sin pedir contraseña. **Protege contra un token de
Firebase robado y usado desde otro lado**, no contra alguien sentado en la
computadora de Andres con todo abierto. Cuesta unas dos horas.

### 4.3 App Check

La consola inicializa App Check, pero **ninguna callable lo exige**
(`enforceAppCheck` no aparece en las Functions). DISENO §12 recomienda
monitorear primero y exigir después, por miedo a dejar afuera a usuarios
legítimos. Para las callables de propietario ese miedo es chico: son dos
personas, y si App Check falla, los scripts siguen funcionando. **Recomendado:
exigirlo en las callables de propietario nuevas desde el primer día**, después
de una semana mirando las métricas de App Check de la consola.

### 4.4 Auditoría, y dos textos «internos» que no lo son

La auditoría ya existe (`/tenants/{t}/auditoria`, escritura cerrada, la
escribe el SDK Admin). Hay que **completarla** (el antes y el después de cada
cambio de plan y de umbrales) y **mostrarla**: hoy ninguna pantalla lee
`/auditoria`. La Fase 1 agrega un historial por comercio.

Pero al revisarla aparecen **dos filtraciones que ya existen hoy**:

1. **`motivoSuspension` vive en la ficha del tenant**, y la ficha la lee todo
   miembro: administrador, **operadores** e ingesta (`allow get: if
   esMiembro(t)`). DISENO §4ter.2 dice que es interno. El principio 6 del
   propio `firestore.rules` explica por qué no puede serlo: las reglas no
   ocultan campos sueltos.
2. **`suspenderTenant` escribe el motivo en `/auditoria`**, y la auditoría la
   lee el administrador del comercio (`esAdmin(t) || esPropietario()`).

Hoy casi no pesa, porque suspender no tiene camino. Con una pantalla, escribir
un motivo pasa a ser rutina, y la persona que lo escribe va a creer que es
privado («moroso de siempre, no atiende el teléfono»). **Decisión D8.**

---

## 5. Fases, riesgos y decisiones

### 5.1 Fases

| Fase | Contenido | Esfuerzo | Depende de |
|---|---|---|---|
| **0** | `exigirPropietario` / `exigirAdminDe` con proveedor; `actualizarEstadoCuenta` parcial y auditada; arnés de pruebas de callables con las pruebas negando de las Functions que ya existen | **~1 jornada** | nada |
| **1** | `planes.ts` puro compartido (tomado de `prepago.ts` más agendas e instalación); `cambiarPlan`, `fijarUmbrales`; migración; pantalla «Cuenta del negocio» (plan, umbrales, suspender, reactivar, historial, ventana de soporte abierta); `moverReclamo` en «Reclamos»; en «Negocios», columnas de estado, plan, % del plan usado y mensajes del mes contra los 1.000 | **~2 jornadas** | 0 |
| **2** | `/pagos` y su regla; `registrarPago` (mensualidad, bolsa, instalación), `rechazarPago`, `fijarTipoCambio`; `estadoPago` y vencimiento derivados; «Estado de cuenta» del comercio con USD y Bs | **~2 jornadas** | 1, y D4 |
| **3** | `activarFuncionario`, regla de `funcionarios`, corte en `configuracionFlujo`; la pestaña «Agenda» explica el límite y ofrece subir de plan | **~1,5 jornadas** | 1 |
| **4** | Alta desde la consola (`AltaNegocio.tsx` de la rama, adaptada) y baja con confirmación escrita | ~1,5 jornadas | cuando haga falta |

**Fases 0 a 3: unas 6,5 jornadas**, con pruebas. La Fase 2 conviene tenerla
antes del primer cobro real; la Fase 3, antes de vender un plan con más de una
agenda.

### 5.2 Riesgos

- **Reaplicar el prepago después.** Si esta pantalla inventa nombres de campo
  propios, el prepago va a tener que migrar otra vez. Se mitiga usando los de
  la rama (`modalidad`, `periodoPagado`, `bolsa`, `pagos` y su esquema), como
  hizo la ingesta con `mensajesVentana`.
- **El catálogo en tres lugares**: el código, `CLAUDE.md` y el sitio (otro
  repositorio). Ya pasó una vez: la rama del prepago quedó una semana con los
  números viejos. Se mitiga con una prueba que compare `planes.ts` con la tabla
  de la base comercial de `CLAUDE.md`, y con la costumbre de que un PR de
  precios toque los tres.
- **El comercio equivocado.** Con 5 comercios no pasa; con 30, alguien va a
  suspender «Salón Rosa» queriendo suspender «Salón Rosado». La confirmación
  muestra nombre e identificador.
- **Suspender se vuelve fácil.** Es el objetivo, pero conviene que la pantalla
  muestre la deuda y el vencimiento al lado del botón, para que la decisión se
  tome con el dato a la vista.
- **Registrar un pago sin TCO cargado falla.** Es deliberado, pero el día 1 de
  cada mes alguien tiene que cargarlo. La lista del propietario avisa si el TCO
  guardado es de otro mes.

### 5.3 Las decisiones que son de Andres

1. **Fuente de verdad del plan.** Recomendado: `cuenta/estado.plan`, con la
   ficha como espejo que solo escribe la misma Function (§2.2).
2. **Dónde vive el catálogo.** Recomendado: código versionado, módulo puro
   compartido, con instantánea de límites en la cuenta. Alternativa:
   `/plataforma/planes` en Firestore, más ágil y sin revisión (§2.3).
3. **Qué pasa con quien ya contrató cuando cambian los precios.** Recomendado:
   conserva lo contratado hasta la renovación; es lo que permite la
   instantánea. Alternativa: el cambio rige para todos desde el mes siguiente.
4. **Qué TCO.** Recomendado: el del primer día hábil del mes, fijo todo el mes
   (`Analisis/14` §5ter), guardando además lo que el banco muestra que entró
   (§2.5).
5. **`estadoPago`: derivado o a mano.** Recomendado: derivado de los pagos;
   `pendiente` o `vencido` salen del vencimiento, no de un clic. Suspender deja
   de afirmar `vencido` y reactivar deja de afirmar `al_dia`.
6. **Cómo se cumple el tope de agendas.** Recomendado: activación por Function
   más corte en `configuracionFlujo`, y corregir la redacción del §7, que pide
   contar en las reglas (§3.3).
7. **Qué queda en script.** Recomendado: número y alias, superadministradores
   y baja, siempre o por ahora; el alta queda en script hasta la Fase 4.
8. **El motivo interno de suspensión.** Hoy lo leen el administrador (por la
   auditoría) y los operadores (por la ficha). Recomendado: una sola nota
   interna en una colección de solo propietario, y en la ficha y la auditoría
   solo lo que el comercio puede leer. Alternativa: declararlo visible y
   decirlo en la pantalla («lo que escriba acá lo lee el comercio»).
9. **Sesión reciente y App Check en las acciones de propietario.**
   Recomendado: las dos (§4.2 y §4.3).
10. **Modalidad del tenant `novuchat` y de los demos.** Recomendado:
    `demostracion`, sin plan y sin corte. NovuChat no se factura a sí mismo, y
    un demo no se puede cortar el día de una presentación.
11. **Conversaciones incluidas mientras no vuelva el prepago.** Recomendado:
    no cortar automáticamente; avisar en la lista al 70 % y al 100 % y tener la
    conversación comercial, que es lo que pide el §3 de la base comercial.
    Cortar por saldo es el proyecto de reaplicar el prepago sobre el modelo de
    bloques, y es otro análisis.
12. **Identificadores y nombres de los planes.** Recomendado: `base`,
    `crecimiento` y `corporativo` («Plan Base», «Plan Crecimiento», «Plan
    Corporativo»), como en `Analisis/21` y `27` y en la rama del prepago.
    `Analisis/24` todavía los llama Impulso / Crecimiento / Pro.

---

## 6. Impacto en el costo por conversación

**Ninguno, y se puede decir con precisión:**

- **Mensajes de WhatsApp: cero agregados, cero quitados.** La pantalla no
  envía nada por Meta. Suspender ya manda el mensaje de cortesía por cada
  mensaje entrante, igual que hoy.
- **Lecturas en la ruta de un mensaje: cero agregadas.** El plan y sus límites
  van en `cuenta/estado`, que la ingesta y `configuracionFlujo` ya leen en cada
  turno. El corte de agendas usa los funcionarios que `configuracionFlujo` ya
  lee.
- **Lecturas de la pantalla:** unas pocas por visita del propietario, más una
  por comercio para las métricas del mes en la lista. Con 20 comercios, ni un
  centavo al mes.

**Lo que sí mueve dinero, aunque no el costo por conversación:**

- **Reactivar al instante** es ingreso: un comercio que pagó y sigue cortado
  hasta que alguien abre una terminal es un mes que empieza con reclamo.
- **El tope de agendas** cuida la latencia del turno que agenda, no el costo.
- **Los pagos con TCO** son lo que permite medir el margen real en dólares, que
  es la cifra que el §3 de la base comercial manda vigilar.
- **La columna de mensajes del mes contra los 1.000** es la que predice la
  factura de Meta (§4 de la base comercial) y hoy no está en ninguna pantalla.
  Sale gratis de `metricas/{periodo}.salientes`.
