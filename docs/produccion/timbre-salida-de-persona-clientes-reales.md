# Timbre de la salida de persona para clientes reales (`<ALIAS>`)

Procedimiento para cargar en n8n el flujo «NovuChat — Salida de persona» de un
**cliente real** con `scripts/cargar-timbre-n8n.sh`. El ensayo del Demo A
(`docs/ensayo/LEEME.md`, sección de H2-F) usa credenciales que el propio script
crea con nombres derivados del alias; un cliente real **ya tiene** sus credenciales
en n8n con otros nombres, y el script no las crea ni las toca. Este documento no
ejecuta nada: cada paso que escribe lo corre Claude con el «sí» de Andres.

## Qué cambió en el script

- **`--cred-ingesta <nombre>`, `--cred-envio <nombre>`, `--cred-rele <nombre>`**
  (las tres o ninguna) dicen el NOMBRE REAL de cada rol. El script las busca por
  nombre **y tipo** exactos (ingesta y relé: `httpHeaderAuth`; envío:
  `whatsAppApi`), exige exactamente una y asigna esa al nodo que corresponde
  (`Reclamar` y `Confirmar` con la de ingesta; `Enviar por Graph` con la de envío;
  `Enviar por el relé` con la del relé). Si falta, está repetida o es de otro tipo,
  aborta sin escribir. Los nombres pueden llevar apóstrofo o espacios; el **alias**
  no (`^[A-Za-z][A-Za-z0-9]{1,29}$`).
- Siguen en pie los cerrojos: los tres nombres distintos entre sí y distintos del
  timbre; ninguno de AAB1-WA-Prod ni de WhatsApp-Modular (se compara normalizado,
  con la misma lista y la misma función de normalización en el shell y en el cerrojo
  de roles: NFKC y minúsculas plegadas, sin los caracteres de formato Unicode
  —ancho cero U+200B, U+2060, guion blando—, y conservando solo `a-z0-9` (así los
  espacios, el NBSP, los guiones U+2011 y U+2013, los puntos y el punto medio no
  esconden un nombre), contra `segurolotengo`, `aab1wa`, `waprod`,
  `whatsappmodular`, `receptor` y `otp`). **Falla cerrado:** el chequeo del shell
  distingue «limpio» (0), «ajeno» (3) y cualquier otro código; este último (un fallo
  de Python) aborta con 2 con el mensaje «error al revisar los nombres», nunca pasa
  por limpio. **Límite conocido:** una letra de otro alfabeto que NFKC no vuelve
  ASCII (omicron griega, e cirílica) no coincide con la lista, y no se transliteran
  homoglifos: lo cubre la revisión humana del nombre y, de fondo, la atadura al
  número. El nodo
  que manda a Meta o al relé nunca lleva la de ingesta (por nombre ni por id). Además,
  un alias que **no** es de ensayo (`demoA`, `demoB`) no se carga ni se activa sin
  las tres opciones: sin ellas se buscarían credenciales por el alias, que nada ata a
  su número, y se aborta con 2 sin tocar n8n. `--quitar` no las necesita. Las
  variables `TIMBRE_CRED_*` heredadas del entorno se ignoran: solo valen las que el
  script fija a partir de las opciones.
- **`--rele-inerte --canal-graph` vale ahora para cualquier alias** (antes solo
  `demoA` y `demoB`): la URL del relé del flujo es `http://relay-inerte.invalid` y no
  se exige la fila del relé de la tabla. `--canal-graph` es la afirmación de quien
  opera de que `rutasWhatsApp/{numero}.canalSalida` no vale `rele` (sin valor =
  `graph`); el script no puede leerla.
- `--crear-credenciales` y `--quitar-credenciales` **siguen siendo solo para
  `demoA` y `demoB`** y no se combinan con las tres opciones nuevas.
- **Atadura al alias (antes de escribir).** Un nombre bien formado no prueba que la
  credencial sea de ese número: con la ingesta de otro comercio el flujo reclamaría
  sus mensajes y los enviaría desde el número equivocado. El script lee los flujos de
  n8n ya descargados (sin otra llamada) y, de cada uno que cita la credencial (por id,
  o por nombre **y tipo**), extrae su número: el valor de un nodo Set (`Config base`:
  `assignments.assignments[*]` o, en versiones viejas, `values.string[*]`) cuyo nombre
  empieza por `phoneNumberId` o es `phone_number_id` (sin distinguir mayúsculas en el
  nombre del campo; solo esos nombres), y cuyo valor es texto de dígitos (se quitan
  espacios y un `=` inicial) o un número entero de un Set de tipo `number`; más una
  clave `phoneNumberId` literal o una URL de Graph. La credencial de ingesta y
  la de envío quedan **vinculadas** solo si (1) al menos un flujo **activo**, distinto
  del propio del alias, la cita y tiene el número de la fila
  `REEMPLAZAR_PHONE_NUMBER_ID_<ALIAS>`, y (2) **ningún** flujo que la cite, activo o
  no, tiene un número distinto del alias, aunque también tenga el del alias. Si no
  se cumple, aborta sin escribir con un mensaje fijo, sin nombres ni valores. El seco
  imprime un renglón por rol: `credencial de ingesta vinculada al alias: sí/no` (y de
  envío). El rol relé no se ata (no tiene flujo propio que lo cite). No se combina con
  `--tabla-demo-a`.
  **Un número ilegible bloquea (indeterminado).** Un flujo —activo o no— que cita la
  credencial y en el que no se encuentra NINGÚN número (por ejemplo, una agenda
  mínima cuyo número sale de un Code o de una llamada HTTP, sin nodo Set) no se
  cuenta ni como propio ni como ajeno: el script no adivina de quién es, aborta sin
  escribir y dice, con mensaje fijo y sin nombres, «una credencial la cita un flujo
  cuyo número no se puede leer». Para seguir hay que dejarle a ese flujo un nodo Set
  `phoneNumberId` legible o dejar de citar la credencial.
  **Alcance de la garantía:** prueba que ningún flujo existente en n8n use esa
  credencial con otro número literal ni con un número que no se pueda leer; no
  prueba nada sobre flujos que aún no existen. Por eso el cliente tiene que tener ya
  un flujo activo con su número escrito en el nodo Set; si no, el script se niega.
  **Límites que persisten:** (a) credenciales compartidas fuera de n8n (otra
  instancia, otro sistema que use el mismo token) no se ven; (b) el rol relé no tiene
  atadura; (c) el script no trata aparte los flujos archivados: si n8n no los
  devuelve en la lista de flujos, no se ven.
- **La atadura también se revisa al activar.** Entre cargar y activar el estado
  vivo pudo cambiar (por ejemplo, aparecer un flujo ajeno que cite la credencial):
  `--activar` con el mapa vuelve a correr la misma atadura con los flujos y las
  credenciales que acaba de descargar y la fila del teléfono de la tabla (la URL del
  relé no hace falta), y si algún rol da «no», o un flujo es indeterminado, no
  activa (sale con 2, sin escribir).
- El mapa de nombres hay que repetirlo en `--activar`: el script verifica el flujo
  vivo contra los nombres que se le dan, y si no coinciden se niega. `--quitar` no
  necesita el mapa: borra solo el flujo y la credencial del timbre del alias.

## Lo que hay que tener antes (todo en seco, sin escribir)

1. **Credenciales existentes** del cliente en n8n, con su nombre exacto (lo lee
   Cartera en el panel, o por la API con la llave de n8n; nunca su valor):
   - ingesta (`httpHeaderAuth`): la que ya usa el flujo de venta del cliente para
     llamar a la ingesta;
   - envío por Graph (`whatsAppApi`): la que ya usa el flujo del cliente para enviar;
   - **relé (`httpHeaderAuth`)**: tiene que ser una credencial con valor **INERTE**
     (p. ej. `Bearer INERTE-NO-ENVIAR`), distinta de las otras dos. **No** se nombra
     aquí una credencial que guarde un token real de Meta (por ejemplo un «Bearer»
     de Graph): el relé es otro destino y esa clave no debe viajar a él. Si el
     cliente no tiene una credencial inerte del relé, hay que crearla antes (ver
     «Decisión pendiente»). La clave real la emite la sesión de WhatsApp-Modular
     con «sí» de Andres, en el traslado.
2. **Tabla local** (`CONFIGURACION.local.md` o `CONFIG_LOCAL_MD`): la fila
   `REEMPLAZAR_PHONE_NUMBER_ID_<ALIAS>` con el valor real (en mayúsculas:
   `..._CLIENTE04`, `..._CLIENTE05`). Con `--rele-inerte` la fila del relé no se
   exige. «pendiente» o vacío abortan. Se agrega sin mostrar el valor
   (`marcador-local.sh`); el archivo no se lee ni por script.
3. **Alias real del cliente** (`cliente04`, `cliente05`): es el alias de
   `rutasWhatsApp/{numero}.aliasSecreto`; lo lee Rearquitectura en seco. Los alias ya
   están en `main` (`firma.ts`); lo que no va en archivos versionados es la
   asociación alias-comercio, que queda en `CLIENTES/`.
4. `.env` con `N8N_BASE_URL` y `N8N_API_KEY` (modo 600, del usuario) y
   `$XDG_RUNTIME_DIR` válido (modo 700). Worktree al día con `main`.
5. Fuera de 18:00 a 22:00, no la noche de una etiqueta, ventana de mantenimiento
   si el cliente está en producción (regla del 24/09).

## Procedimiento (por cliente; `<ALIAS>` = `cliente04` o `cliente05`)

`<NOMBRE_INGESTA>`, `<NOMBRE_ENVIO>` y `<NOMBRE_RELE>` son los nombres reales que
Cartera lee en el paso P0. Ejemplos de forma, sin valor real: `NovuChat ingesta
(<COMERCIO>)` y `WhatsApp <COMERCIO> (envío)`.

| # | Paso | Quién | Escribe en producción | «Sí» de Andres |
|---|---|---|---|---|
| 0 | Leer nombres de credenciales en n8n, fila del teléfono en la tabla, ruta del cliente (`aliasSecreto`, `canalSalida`) | Cartera (n8n, tabla); Rearquitectura (ruta) | No | No (lectura ya autorizada) |
| 1 | Seco de la carga (abajo): comprueba las tres credenciales por nombre y tipo, la tabla y la entrega | Cartera | No | No |
| 2 | `nube-salida-persona.sh --agregar-alias <ALIAS>` en seco, luego `--aplicar --confirmo produccion`: crea ruta y clave en `SALIDA_PERSONA_RUTAS` y deja la **entrega** en `$XDG_RUNTIME_DIR` | Rearquitectura | **Sí** (Secret Manager) | Una por acción |
| 3 | `cargar-timbre-n8n.sh ... --aplicar --confirmo produccion`: crea la credencial del timbre y el flujo **inactivo** y borra la entrega | Cartera | **Sí** (n8n) | Una por acción |
| 4 | Redespliegue de `enviarComoPersona` (el secreto queda fijo por versión) | Rearquitectura | **Sí** (despliegue) | Una por acción |
| 5 | `cargar-timbre-n8n.sh ... --activar --aplicar --confirmo produccion`: empieza el barrido de cada minuto | Cartera | **Sí** (n8n) | Una por acción |
| 6 | Bandera `consolaConversaciones` y roles (paquete de encendido de «Tomar») | Cartera | **Sí** (Firestore, Auth) | Una por acción |
| R | Reversión: `--quitar --aplicar`; `nube-salida-persona.sh --quitar-alias <ALIAS> --aplicar` y redespliegue; bandera a `clasica` | Cartera / Rearquitectura | **Sí** | Una por acción |

**Los pasos 2 y 3 van en la MISMA sesión** y con el mismo `$XDG_RUNTIME_DIR`: la
entrega (ruta y clave del timbre) no se deja pendiente ni la lee nadie; el paso 3 la
consume y la destruye. Si el paso 3 falla, la entrega se conserva y el propio script
dice cómo seguir (reintentar, que es idempotente, o `--quitar`). El orden de las
filas 2 a 4 respeta que `--agregar-alias --aplicar` exige el consumidor revisado
en el repositorio (este script).

### Comandos (los ejecuta Claude; desde la raíz del repositorio, ruta absoluta del worktree)

Paso 1, seco de la carga (no escribe; sale 1 si hay pasos pendientes):

    ./scripts/cargar-timbre-n8n.sh --alias <ALIAS> --env .env \
      --cred-ingesta "<NOMBRE_INGESTA>" --cred-envio "<NOMBRE_ENVIO>" --cred-rele "<NOMBRE_RELE>" \
      --rele-inerte --canal-graph

Paso 3, carga (escribe en n8n; solo con el «sí» y después del seco):

    ./scripts/cargar-timbre-n8n.sh --alias <ALIAS> --env .env \
      --cred-ingesta "<NOMBRE_INGESTA>" --cred-envio "<NOMBRE_ENVIO>" --cred-rele "<NOMBRE_RELE>" \
      --rele-inerte --canal-graph --aplicar --confirmo produccion

Paso 5, activar (el mismo mapa):

    ./scripts/cargar-timbre-n8n.sh --alias <ALIAS> --env .env \
      --cred-ingesta "<NOMBRE_INGESTA>" --cred-envio "<NOMBRE_ENVIO>" --cred-rele "<NOMBRE_RELE>" \
      --activar --aplicar --confirmo produccion

Reversión del flujo (no necesita el mapa; no toca credenciales existentes):

    ./scripts/cargar-timbre-n8n.sh --alias <ALIAS> --env .env --quitar --aplicar --confirmo produccion

Se corre primero cada uno **sin** `--aplicar` y se lee entero.

## Qué no hace y qué no se debe hacer

- No crea ni modifica credenciales con valores; la única credencial nueva es
  `Salida de persona (timbre <ALIAS>)`, cuyo valor sale de la entrega y no se imprime.
- No imprime la clave del timbre, la ruta, el `phoneNumberId` ni la URL del relé.
- No activa el flujo al cargarlo (`--activar` es un paso aparte) y no activa ningún
  WhatsApp Trigger.
- Un `SALIDA_PERSONA_RUTAS` sin el alias del cliente deja los envíos de persona en
  `pendiente` y caducan; el asistente sigue normal.

## Después del traslado (~07/11, primer cliente real)

El relé deja de ser inerte cuando la sesión de WhatsApp-Modular emite la clave real
(con «sí» de Andres) y `rutasWhatsApp/{numero}.canalSalida` pasa a `rele`. Ese día
se actualiza **el valor** de la credencial del relé (no su nombre) y se recarga el
flujo **sin** `--rele-inerte`, con la fila del relé en la tabla. Ningún script
escribe hoy `canalSalida`: lo prepara Cartera aparte, y antes del corte se devuelven
las conversaciones tomadas.

## Decisión pendiente

**¿Quién crea la credencial inerte del relé de cada cliente real, si no existe?**
Este cambio no crea credenciales (decisión de Principal). Si `cliente04` o
`cliente05` no tienen una `httpHeaderAuth` con valor inerte para el relé, hace falta
una de estas dos salidas, que decide Principal: (a) crearla a mano en el panel de
n8n con un valor inerte, o (b) agregar al script un modo acotado que cree solo esa
con un valor inerte fijo (sin ningún secreto) y la registre como creada por él. Sin
una de las dos, el paso 1 aborta nombrando el rol que falta.

**Sospecha abierta: token real en el rol relé.** Hoy, con `--rele-inerte` la URL del
relé del flujo es inerte y la credencial del relé no viaja a ningún lado útil. Pero si
alguien pasa en `--cred-rele` una credencial que guarda un token real (por ejemplo un
«Bearer» de Graph) y luego recarga **sin** `--rele-inerte`, ese token viajaría a la URL
real del relé, que es otro destino. El script no puede leer el valor de la credencial,
y exigir `--rele-inerte` para el rol relé de un cliente real choca con el diseño
documentado arriba («Después del traslado»: se recarga sin `--rele-inerte` con la
credencial del relé ya con su clave real), así que no se cambió. Mitigación vigente:
la regla de la sección «Lo que hay que tener antes» (la credencial del relé es distinta
de las demás y su valor lo carga la sesión de WhatsApp-Modular) y el seco previo de
cada recarga. Queda a decisión de Principal si conviene un indicador explícito
(`--rele-real`) que distinga la recarga posterior al traslado.
