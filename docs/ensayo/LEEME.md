# El ensayo: probar el cambio de un cliente antes de que llegue a su número

> Decisión de Andres, 21/09/2026: con Platinum en producción en su propio
> portafolio de Meta, **ningún cambio que pida un cliente se prueba en su
> número**. Se prueba primero en el número del Demo A, que por un rato responde
> *como* ese cliente, con su flujo y su configuración propuestos, pero con
> datos de prueba: la agenda del demo, el teléfono de quien prueba, y
> conversaciones que caen en un comercio aparte.
>
> Andres autoriza y Claude opera: cada `--aplicar` de este procedimiento lo
> corre Claude con el «sí» de Andres en el chat.

## 1 · Qué se mueve y qué no

| Pieza | Durante el ensayo | Cómo se hace | Cómo se vuelve |
|---|---|---|---|
| **El número** | El del **Demo A** (el número de prueba de Meta, solo responde a los destinatarios registrados) | — | — |
| **El flujo de n8n** del Demo A | El **JSON del cliente** de la rama con el cambio, con el nombre, el webhook y las **credenciales del Demo A** | `scripts/ensayo-flujo.sh` | `ensayo-flujo.sh --restaurar` republica `demo-a-agendamiento.json` de `main` |
| **La ruta** del número en la plataforma | Apunta al comercio **`ensayo`** (no a `demo-agendamiento`) | `admin/scripts/plataforma/ensayo.mjs --preparar` | `ensayo.mjs --restaurar` |
| **La configuración** que lee el flujo | La de `ensayo`: el `datos/negocio-<cliente>.json` **propuesto**, con recepción y agendas **de prueba** | `ensayo.mjs --preparar` (usa `cargar-negocio.mjs`) | No hace falta: el demo nunca se tocó |
| **Lo que se escribe** (conversaciones, conteos) | En `ensayo` | — | Se queda ahí; el próximo ensayo lo vacía |
| El número, la agenda, la recepción y la configuración **del cliente** | **Nada** | — | — |

**Por qué el Demo A y no el Demo B:** todos los clientes de hoy (Platinum,
Bellido) son de agendamiento, y el Demo A es el flujo del que salieron. El
Demo B sirve para un cliente de venta y cobro cuando lo haya. Cada script recibe
lo suyo: `ensayo.mjs` recibe `--proyecto` y `--numero` (el phone id del número
que se desvía), y `ensayo-flujo.sh` recibe `--env` (el entorno de n8n del
número de ensayo), `--cliente` y `--flujo`; **no** recibe `--numero`. Hoy
`ensayo-flujo.sh --restaurar` repone el JSON del Demo A. Para un flujo de venta
mínima no sirve `ensayo-flujo.sh` (ver §6).

**Mientras dura el ensayo, el Demo A no sirve para una demo comercial.** Se
anota en `ESTADO.md` y se restaura apenas termina.

## 2 · Los datos de prueba (una vez, ya hecho el 21/09)

`CONFIGURACION.local.md` tiene cuatro filas que **nunca** apuntan a un cliente,
cargadas con `marcador-local.sh --copiar-de` (el valor no pasa por la
pantalla):

| Marcador | Copia de | Qué es |
|---|---|---|
| `REEMPLAZAR_NUMERO_RECEPCION_ENSAYO` | la recepción del demo de Platinum | El teléfono de quien prueba (hoy, Andres): recibe los avisos y el botón «Escribir a recepción» |
| `REEMPLAZAR_CALENDARIO_ENSAYO_1` a `_3` | los tres calendarios del Demo A | Las agendas donde el ensayo crea y borra citas |

Los dos scripts traducen los marcadores del cliente a estos:

    REEMPLAZAR_PHONE_NUMBER_ID_<C>   -> REEMPLAZAR_PHONE_NUMBER_ID (el del Demo A)
    REEMPLAZAR_NUMERO_*_<C>          -> REEMPLAZAR_NUMERO_RECEPCION_ENSAYO
    REEMPLAZAR_CALENDARIO_<C>_<n>    -> REEMPLAZAR_CALENDARIO_ENSAYO_<n>
    REEMPLAZAR_HORARIO_*_<C>         -> se conserva: el horario es parte de lo que se prueba

Si queda cualquier otro marcador del cliente, **los dos se niegan**.

## 3 · El procedimiento

**0. El cambio, en una rama y un PR, con la suite en verde.** El cambio puede
ser del flujo (`Flujos/<cliente>-agendamiento.json`), de la configuración
(`admin/scripts/datos/negocio-<cliente>.json`) o de las dos. El PR **no se
fusiona** hasta que el ensayo sale bien.

**1. La plataforma** (desde `admin/`, con las credenciales de producción de
siempre: `CLOUDSDK_CONFIG=$HOME/.config/gcloud-novuchat-prod`):

    node scripts/plataforma/ensayo.mjs --proyecto <proyecto> --numero <phone id del Demo A> --preparar \
      --cliente platinum --archivo scripts/datos/negocio-platinum.json \
      --local ~/NovuChat/CONFIGURACION.local.md            # seco: se lee entero
    ... --aplicar

Crea `ensayo` si falta; si existe, **lo vacía** (configuración, catálogo,
funcionarios, contador) y carga el archivo del cliente con los datos de prueba;
recién con la carga bien hecha, desvía la ruta del número. Se niega si el
número no es de un comercio con plan `demostracion`.

**2. El flujo** (desde `~/NovuChat`, donde están los `.env`):

    ./scripts/ensayo-flujo.sh --cliente PLATINUM --flujo <worktree>/Flujos/platinum-agendamiento.json   # seco
    ... --aplicar

El diagnóstico en seco se lee entero. Lo que tiene que decir:
- `Credenciales: las del Demo A vivo en N nodos` y **ninguna línea
  «credencial corregida»**;
- ningún `phoneNumberId` distinto del del Demo A;
- los marcadores: solo los del ensayo y el horario del cliente.

**3. Las pruebas, con teléfonos registrados.** El número del Demo A es el de
prueba de Meta: solo responde a los **destinatarios registrados** en la app
del Demo A (hasta 5, `CLAUDE.md` prohibición 6). Si alguien de la clínica
quiere probar, se lo registra antes. Se prueba lo que cambió **y** la
aceptación corta del cliente (`CLIENTES/<C>/aceptacion.md`); se miran las
ejecuciones con `ver-ejecuciones.sh --env .env`.

**4. Si sale bien:** Andres fusiona el PR. Desde `main` actualizado, Claude
publica en el cliente (`publicar-flujo.sh --env .env.<cliente>`) y carga la
configuración (`cargar-negocio.mjs --tenant <cliente>`), cada uno con su seco
leído entero antes del `--aplicar`.

**5. Siempre, salga bien o mal: restaurar.**

    ./scripts/ensayo-flujo.sh --restaurar            # seco
    ./scripts/ensayo-flujo.sh --restaurar --aplicar
    node scripts/plataforma/ensayo.mjs --proyecto <proyecto> --numero <phone id del Demo A> --restaurar --aplicar

Y borrar de las agendas del demo las citas de la prueba.

## 4 · Lo que el ensayo NO cubre hoy (y por qué)

| Qué | Por qué | Qué hacer |
|---|---|---|
| **El cobro real de la seña** (QR del cliente, cotejo del comprobante) | El QR del cliente manda la plata a **su** cuenta, y el Demo A no puede cobrar en nombre del cliente (`CLAUDE.md`, prohibición 3) | Si el cambio toca la seña: cargar en `ensayo` un QR de NovuChat con `activar-cobro-real.mjs` y un importe simbólico. Nunca el QR del cliente |
| **Nodos propios de un cliente** (Bellido: interactivo, redes, aviso al doctor) | Usan credenciales que el Demo A no tiene en esos nodos; `ensayo-flujo.sh` se niega para no dejar que n8n las complete por tipo (la trampa del 15/09) | Crear en n8n las credenciales de ensayo de esos nodos y mapearlas en el script. Pendiente |
| **Plantillas** (seguimientos fuera de la ventana) | Son de la WABA del cliente | Se prueban en el cliente, con la plantilla aprobada |
| **Los flujos programados** (seguimientos, señas vencidas) | Corren por comercio y por reloj | Se prueban con sus suites; en vivo, en el cliente |
| **El candado con un cliente real** | La regla manda probarlo contra un teléfono real insistiendo sobre una hora ocupada (`CLAUDE.md`) | Se hace en el ensayo **y** se repite en el cliente |

## 5 · Las piezas

- `admin/scripts/plataforma/ensayo.mjs` — plataforma. Pruebas: `admin/pruebas/ensayo.test.ts`
  (nunca desvía el número de un cliente que paga, nunca carga la agenda ni la
  recepción del cliente, restaura solo al comercio de origen).
- `scripts/ensayo-flujo.sh` — n8n. Sus dos cerrojos (credenciales del Demo A
  nodo por nodo y marcadores del ensayo) se probaron en seco el 21/09: con
  Platinum genera el flujo con las credenciales del Demo A en 29 nodos; con
  Bellido se niega por sus 6 nodos propios.
- `scripts/marcador-local.sh --copiar-de` — las filas del ensayo, sin mostrar
  valores.

## 6 · Ensayar un flujo de venta mínima en el Demo A

> **Un solo teléfono, el de Andres, hace de cliente, de dueño y de cocinero** (decisión de
> Andres, 02/10/2026). Escribe a la línea del Demo A y el flujo de «Venta mínima (v0)» —el de
> Q'Taco— le contesta desde el n8n del Demo A; el aviso al restaurante le llega **al mismo chat**
> en que está pidiendo, y el botón «Escribir al local» abre un chat con su propio teléfono. El
> `WhatsApp Trigger` del flujo es **el del Demo A, copiado tal cual** del flujo vivo: la
> credencial de la app NovuChat-Demo-A, nunca la de AAB1-WA-Prod (`CLAUDE.md` prohibición 7).
> Diseño de la variante: `Flujos/experimental/venta-minima/DISENO.md`, «La variante de ensayo en
> el Demo A».

**El interruptor de un solo teléfono (`avisarAlPropioNumero`).** En producción el flujo nunca
avisa al restaurante al número de quien escribe (un empleado que pide no se avisa a sí mismo:
`avUnificar` lo descarta). Con un solo teléfono eso haría que el aviso nunca saliera y el cliente
leyera «No pude pasarle…». Por eso `ensayo-demo-a.json` trae, en `configBase`,
`avisarAlPropioNumero: true`, que hace que el destinatario igual al `from` **no** se descarte (el
resto de los filtros sigue: prefijo, 8 a 15 dígitos, unicidad y rol). Es un interruptor **solo de
ensayo y a prueba de producción**:

- vale solo `true` (o el texto «true»); «false», «0», vacío, un objeto o cualquier otro valor es falso;
- lo lee solo `Config base`: el panel de la consola no lo puede encender;
- `construir.mjs` **falla** si la clave aparece en cualquier archivo de datos que no sea
  `ensayo-demo-a.json` (ni siquiera heredada de `qtaco.json`), y `--verificar` falla si
  `venta-minima.qtaco.json` o `venta-minima.prueba.json` la traen en «Config base». Solo
  `venta-minima.ensayo-demo-a.json` puede llevarla;
- «pasé tu pedido» sigue saliendo solo si Meta devolvió un `wamid` real para el aviso.

**Por qué NO se usa `ensayo-flujo.sh` en este ensayo, ni para ir ni para volver.**
Su cerrojo exige los mismos nodos con credencial que el Demo A de agendamiento, y
su `--restaurar` republica el `demo-a-agendamiento.json` **de la copia desde donde
se corre** (que puede traer cambios sin autorizar, como F3a) y, como `publicar-flujo.sh`
completa las credenciales por tipo, deja al Demo A sin credencial en 12 nodos
(Google Calendar y Gemini en el agente, `consultar_disponibilidad`, `agendar_cita`,
`Responder al cliente`, `Avisar a recepción`; hallazgo de la revisión del PR #375).
Eso es un defecto aparte de `ensayo-flujo.sh`, que este procedimiento no toca. Acá
se usa `Flujos/experimental/agenda-minima/herramientas/flujo-de-prueba.mjs`
(`--sobre-demo-a`), que:

- copia el Trigger del Demo A vivo tal cual (id, `webhookId`, parámetros y credencial);
- asigna **todas** las credenciales por nombre y por id, y solo las que el Demo A
  vivo ya usa; se niega si un nodo queda sin credencial, si el nombre de una
  credencial nombra a un cliente o a un sistema ajeno, si un nodo que llama a
  `graph.facebook.com` conserva una credencial de cabecera (la trampa del 15/09: el token de
  la ingesta a Meta), o si el flujo del `.env` no es el Demo A (un nombre con «Bellido» tampoco
  pasa) o está inactivo;
- cambia los cuatro envíos por Graph a la credencial predefinida `whatsAppApi` («WhatsApp
  account»): **no se crea ninguna credencial con el token**. (`PREPARACION.md` de
  Agenda mínima decía «no crees» una credencial Graph Bearer en el Demo A: aquí queda
  cumplido. El nombre «Graph WhatsApp Demo A (Bearer)» del JSON es solo la etiqueta que
  la herramienta reconoce y cambia; esa credencial no existe ni se crea);
- guarda el flujo vivo **entero** en un respaldo (permisos 600, fuera del repositorio):
  la única vuelta atrás es `--restaurar-respaldo`, que repone ese respaldo exacto, comprueba
  que la versión activa sea la escrita y **relee el flujo vivo para compararlo con el respaldo**
  (si difiere, sale con error y lo dice).

Todo `--aplicar` lo corre Claude con el «sí» de Andres en el chat, después de leer
entero el seco del mismo paso. Cada seco de la herramienta guarda el respaldo del
vivo (no escribe en n8n).

### Antes de empezar (obligatorio)

**A. Autorizaciones de Andres, en el chat, para ESTE ensayo:**

1. **La credencial de Gemini de producción en el Demo A.** La tabla de la herramienta
   usa «Google Gemini(PaLM) Api account» (la de producción; hay otra, «Gemini —
   pruebas (no producción)», que no sirve: el Demo A vivo no la usa y la herramienta
   se niega). La autorización es **por ensayo**: la del 30/09/2026 era para esas pruebas y la
   del 02/10/2026 para este ensayo; cada ensayo nuevo la pide de nuevo. Costo: unos 0,0005 USD
   **por llamada**, y un turno puede sumar varias: `Extraer` (el pedido o la reserva),
   `Transcribir audio` y `Leer comprobante` (PDF o imagen) llaman a Gemini cada uno cuando
   corren. Un turno de texto suele llamar una vez; un audio o un comprobante, más. La herramienta elige la
   credencial **por nombre**, así que que haya dos de Gemini no la confunde (y si hay dos con el
   mismo nombre, se niega). Como cerrojo de código, `--sobre-demo-a --aplicar` **exige**
   `--autorizo-gemini-produccion`: la bandera no sustituye la autorización de Andres, la deja dicha.
   Sin esa autorización, no hay ensayo en el Demo A.
2. **Que el Demo A deje de servir para una demo comercial** mientras dure, y la
   ventana en que se hace.

**B. Anotar el ensayo** antes del primer `--aplicar`, en `ESTADO.md` y en
`docs/versiones-por-cliente.md` (una fila para el Demo A: «corre Venta mínima en ensayo»,
con su porqué y su cierre). Sin la fila, `estado-de-versiones.sh` ve al Demo A atrasado
sin declarar. Se retira al restaurar.

**C. Un árbol al día, no `~/NovuChat`.** Los scripts se corren desde un **worktree
nacido de `origin/main`** (`.claude/worktrees/<nombre>/`), con la suite en verde,
`pnpm install --frozen-lockfile` en `admin/` (nunca `npm`) y
`node Flujos/experimental/venta-minima/construir.mjs --verificar` en 0. La copia
principal puede estar cientos de commits atrás y sin `ensayo.mjs` ni los abortos de
`publicar-flujo.sh`. El worktree no trae los `.env`, así que se enlazan (están ignorados
por git; `publicar-flujo.sh` hace `. "./$ENV_FILE"` desde la raíz del repositorio):

    ln -s ~/NovuChat/.env <worktree>/.env

y la tabla de marcadores se pasa por variable: `CONFIG_LOCAL_MD=~/NovuChat/CONFIGURACION.local.md`
(para `preparar-import.sh`; `marcador-local.sh` ya la busca ahí). Todo desde la raíz del
worktree, con rutas absolutas (`<worktree>` abajo).

**D. Línea de base de la suscripción de Meta (solo lectura).** Antes del primer `--aplicar`:

    ./scripts/credenciales-flujo.sh --env .env
    ./scripts/webhook-meta.sh --ver-meta --env-cliente .env

- Anotar el nombre de la credencial del nodo `WhatsApp Trigger` vivo y que el flujo vivo esté
  **activo** (`credenciales-flujo.sh` imprime `activo: True`; el seco de la herramienta también lo
  muestra y `--aplicar` se niega si no lo está).
- **Cotejo del webhook, sin copiar la URL en ningún registro:** el `callback_url` que muestra
  `webhook-meta.sh --ver-meta` tiene que **terminar en `/webhook/<webhookId del Trigger vivo>/webhook`**.
  Se compara solo con los **últimos 4 caracteres** del `webhookId`: el seco de la herramienta imprime
  `Trigger vivo: webhookId …XXXX`, y se mira que coincidan con los 4 anteriores a `/webhook` del
  `callback_url`. (Comparar el id de la credencial antes y después no sirve: la herramienta copia el
  Trigger, así que siempre da igual.)
- Si no coincide, si el nombre de la credencial del Trigger es de AAB1-WA-Prod, o el flujo vivo ya trae
  nodos de un candidato (`Plan del turno`, `Candado`…) sin un respaldo del Demo A original a mano:
  **detenerse** (prohibición 7: activar un Trigger con otra credencial reescribe el webhook de toda esa app).

### El procedimiento

**1. El marcador de la tabla local.** El JSON trae dos: `REEMPLAZAR_PHONE_NUMBER_ID`
(el del Demo A, ya está en la tabla) y `REEMPLAZAR_NUMERO_AVISO_ENSAYO` (el teléfono de Andres, que
es a la vez el del cliente, el del destinatario `completo` del aviso y el de la recepción de respaldo). Se
comprueba con `./scripts/marcador-local.sh --verificar <marcador>`; si falta el segundo, se agrega sin
mostrar el valor, con el valor que Andres pone en `MARCADOR_VALOR` (**con prefijo 591**) o con `--copiar-de`
de la fila que ya lo tenga. **El número se escribe solo en la tabla local, nunca en un archivo del
repositorio.** Ese teléfono tiene que estar registrado en la app del Demo A.

**2. Preparar el import** (reemplaza los dos marcadores):

    CONFIG_LOCAL_MD=~/NovuChat/CONFIGURACION.local.md ./scripts/preparar-import.sh \
      <worktree>/Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.json .env

Se lee entero: los dos marcadores resueltos y ninguno sin resolver. Deja
`venta-minima.ensayo-demo-a.local.json` junto al original (ignorado por git, y
`construir.mjs` no lo toma por huérfano): lleva valores reales y se borra al terminar.

**3. La plataforma: `ensayo.mjs --preparar`** (desde `admin/`, con
`CLOUDSDK_CONFIG=$HOME/.config/gcloud-novuchat-prod`), con una **copia del borrador de
Q'Taco fuera del repositorio** (en el scratchpad de la sesión) que cambia **una sola
cosa**: `catalogoWebActivo` en `false` (con más de 40 ítems y el catálogo web encendido, la
ingesta manda `catalogo: []` y el flujo deriva todo pedido). El marcador de recepción
`REEMPLAZAR_NUMERO_RECEPCION_QTACO` **no se edita**: `ensayo.mjs` lo traduce solo a
`REEMPLAZAR_NUMERO_RECEPCION_ENSAYO`, la fila de la tabla local con el teléfono de quien prueba (hoy, el de
Andres): ahí va el botón «Escribir al local».

    node scripts/plataforma/ensayo.mjs --proyecto <proyecto> --numero <phone id del Demo A> --preparar \
      --cliente qtaco --archivo <copia del borrador, en el scratchpad> \
      --local ~/NovuChat/CONFIGURACION.local.md            # seco: se lee entero
    ... --aplicar

Vacía y recarga el comercio `ensayo` y desvía la ruta del número a `ensayo`. Como la ruta
del Demo A es `agendamiento`, no carga `config/venta`.

**4. El flujo: `flujo-de-prueba.mjs --sobre-demo-a`.** Con el respaldo y el estado en el
scratchpad (fuera del repositorio; la herramienta se niega si no):

    node Flujos/experimental/agenda-minima/herramientas/flujo-de-prueba.mjs --env <worktree>/.env \
      --estado <scratchpad>/estado-ensayo.json --sobre-demo-a --respaldo <scratchpad>/respaldo-demo-a.json \
      --flujo <worktree>/Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.local.json   # seco
    ... --aplicar --autorizo-gemini-produccion

El seco se lee entero. Tiene que decir: «Demo A vivo» con el nombre del Demo A y `activo=True`;
`Trigger vivo: webhookId …XXXX` (los 4 que se cotejan con Meta, paso D);
**`WhatsApp Trigger: el del Demo A, tal cual («…»)`** (si dice cualquier otra cosa, o aparece
«credencial corregida: WhatsApp Trigger», **detenerse**); los cuatro envíos con «PARÁMETROS
CAMBIADOS … → predefinedCredentialType/whatsAppApi»; cada nodo con su credencial por nombre
(Gemini: «Google Gemini(PaLM) Api account»); y ningún marcador que quede. Después de cada
`--aplicar` la herramienta lee el flujo de vuelta y exige que quede **activo**.

Repetir **después del primer `--aplicar`** (solo lectura): `credenciales-flujo.sh --env .env` y
`webhook-meta.sh --ver-meta --env-cliente .env`; el `callback_url` sigue terminando en el `webhookId` del
Trigger (mismos 4 caracteres). Si no, detenerse y restaurar de inmediato (paso 6).

**5. Las pruebas, con UN solo teléfono registrado** en la app del Demo A: el de Andres.

- Escribe como cliente. **La ventana de 24 h ya está abierta** porque escribe él: no hay que abrir la
  ventana de nadie con otro teléfono. No hay plantillas aquí, y el aviso al restaurante sale como
  **texto libre** al mismo chat.
- Pedido de recojo sin QR hasta «Confirmar pedido»: le llega el detalle como texto libre y el cliente
  lee «pasé tu pedido» (solo si Meta aceptó el aviso). Reserva, derivación («Escribir al local» abre un
  chat con su propio teléfono), y una bebida alcohólica o un helado (que no deben ofrecerse: el único
  control es el área, ver DISENO.md).
- **El camino «No pude pasarle…» no se puede provocar en el ensayo en vivo con un solo teléfono:**
  cada mensaje del cliente reabre su propia ventana de 24 h, así que nunca está cerrada cuando se
  confirma el pedido. Se prueba en la suite (`venta-minima-flujo.test.ts`: interruptor apagado, ventana
  cerrada con otro teléfono, o Meta rechazando el aviso).
- El flujo de venta no guarda ejecuciones (retención `none`, decisión del 02/10/2026): `ver-ejecuciones.sh`
  no mostrará nada de este ensayo. Vale lo que el teléfono recibió y los conteos del comercio `ensayo`.

**6. La restauración completa, siempre, salga bien o mal.** En este orden, con cada paso
en seco primero y su `--aplicar` con el «sí» de Andres:

1. **El flujo: solo el respaldo exacto.**

       node Flujos/experimental/agenda-minima/herramientas/flujo-de-prueba.mjs --env <worktree>/.env \
         --estado <scratchpad>/estado-ensayo.json --restaurar-respaldo --respaldo <scratchpad>/respaldo-demo-a.json   # seco
       ... --aplicar

   Antes del `--aplicar`: repetir `credenciales-flujo.sh --env .env` y `webhook-meta.sh --ver-meta
   --env-cliente .env` (solo lectura) y el cotejo de los 4 caracteres. Después del `--aplicar`: la herramienta
   ya relee el vivo y lo compara con el respaldo (tiene que decir «el flujo vivo leído de vuelta es igual al
   respaldo»); repetir las dos lecturas y comparar con la línea de base.
2. **El estado por teléfono.** `./scripts/publicar-flujo.sh --env .env --reiniciar-estado` (seco) y
   luego `--aplicar`. Deja vacío el estado global del flujo (incluido el de la venta, `ventaMinima`).
   **Hoy ese modo NO tiene cerrojo de nombre** (mejora aparte): en el seco hay que verificar que
   «Flujo vivo» es el del Demo A y que los teléfonos listados son los del ensayo; si el nombre no es el
   del Demo A, detenerse.
3. **La plataforma.**

       node scripts/plataforma/ensayo.mjs --proyecto <proyecto> --numero <phone id del Demo A> --restaurar   # seco
       ... --aplicar

4. **Limpieza OBLIGATORIA antes de cerrar la sesión, aunque el ensayo haya fallado o se haya
   cortado a medias.** Lo que queda lleva teléfonos, nombres y direcciones de quien probó, y
   ids. Se listan y se borran: `ls Flujos/respaldo-*.local.json Flujos/respaldo-estado-*.local.json`
   en el worktree y el `.local.json` del paso 2; y en el scratchpad el respaldo del Demo A, su
   `.aplicado.json`, el estado (`estado-ensayo.json`) y la copia del borrador. **Excepción
   a propósito:** si el ensayo falló y el Demo A **no** se pudo restaurar, el respaldo del Demo A es la única
   vuelta atrás exacta: se conserva hasta restaurar, y se borra apenas el Demo A vuelve. Retirar las filas de
   `ESTADO.md` y de `docs/versiones-por-cliente.md` (punto B) y borrar de las agendas del demo las citas de
   la prueba, si las hubo.

### Lo que este procedimiento NO prueba ni garantiza

| Qué | Por qué | Dónde se mira |
|---|---|---|
| **QR y comprobante** | La ruta del Demo A es `agendamiento`: el servidor no manda `config/venta` ni cobro | Con la línea de Q'Taco, con un QR de NovuChat e importe simbólico (prohibición 3) |
| **Plantillas** | Son de la WABA de Q'Taco; aquí van vacías a propósito | Con Q'Taco, con `pedido_registrado` aprobada |
| **Receptor y verificador** | La entrada es el Trigger del Demo A, no la entrega firmada | Con Q'Taco, en la ventana de mantenimiento |
| **Promociones** | Las campañas del comercio `ensayo` no son las de Q'Taco | Con Q'Taco |
| **Latencia con el número real** | Es el número de prueba de Meta y otra WABA | Con Q'Taco |
| **Que el aviso llegue a OTRA persona** | Con un solo teléfono el aviso llega al mismo chat del cliente (el interruptor lo permite solo en el ensayo) | Con Q'Taco: el destinatario del aviso es otra persona y el propio número se descarta |
| **«No pude pasarle…»** | Con un solo teléfono la ventana siempre está abierta | La suite |
| **Los nombres de credencial en la instancia, la credencial del Trigger vivo y la ruta de Meta** | No se pueden probar sin n8n ni Meta reales: la suite (`venta-minima-herramienta-demo-a.test.ts`) prueba la herramienta contra un n8n de mentira | El seco real y los pasos D y 4 de arriba |
