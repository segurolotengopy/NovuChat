# Análisis 42 — El ayudante de configuración con IA: diseño guardado, sin código

> **Estado (25/09/2026): diseño archivado, pendiente de rehacerse.** Este
> documento conserva, tal cual se escribió el 08/09/2026, el diseño que vivía
> en la rama `claude/ai-config-helper-e3b434` como `admin/DISENO.md`
> §4septies. La rama se cerró **sin fusionar** en la fase F-1 de la
> rearquitectura por capas (`Analisis/41` §7.1): quedó 589 commits atrás de
> `main`, el número §4septies ya lo ocupa la retención de la seña, y su
> clasificación («capa CONSOLA, transversal, prestación de plan») choca con
> la política de capas del §4quater.5 que se escribió después.
>
> **Se rehace después de F6**, sobre la zona **Central** (`central/asistente`,
> junto al comportamiento verificado), con estas decisiones ya tomadas por
> `Analisis/41`: el ayudante es de Central y no un módulo; lo que ofrece por
> pantalla lo decide el registro de módulos encendidos del tenant; y la regla
> «el modelo propone, el navegador escribe» sigue vigente porque es la que
> hace que toda escritura pase por `firestore.rules` sin una línea nueva.
>
> Lo que sigue es el texto original, sin retocar. Las referencias a
> `web/src/lib/flujos.ts`, `FLUJOS`, `/config/{flujo}` y a los planes con sus
> nombres son de la arquitectura por vertical que la rearquitectura reemplaza.

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

- **Verificar que un dato de configuración sea VERDADERO.** Ni la pantalla ni el
  ayudante (§4septies) lo hacen: detectan la casilla vacía y la incoherencia
  interna, no la mentira. Una dirección bien escrita puede estar equivocada.
| **El ayudante de configuración gasta dinero por llamada** (§4septies) | un administrador curioso, un bucle o un abuso convierten el margen del plan en cero, sin mala fe | cuota de sesiones por plan verificada en la Function, tope de turnos y de caracteres, App Check exigido en ese extremo, presupuesto con alerta. Y la pantalla manual sigue estando siempre |
| **El ayudante propone un dato falso pero bien formado** | el asistente lo afirmaría ante un cliente final como verdad del negocio | dos aprobaciones, resumen campo por campo con el antes y el después, y ningún cambio que el resumen no liste. El código calcula los avisos; el modelo solo los explica |
| **`plan` es texto libre y una prestación va a depender de él** | un plan mal escrito habilita o niega el ayudante por accidente | normalizarlo a los nombres comerciales y validarlo contra la tabla de planes en `altaTenant` y en el cambio de plan, antes de programar §4septies |
