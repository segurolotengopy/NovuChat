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
| **QR y comprobante** | Con la ruta en `agendamiento` el servidor no manda `config/venta` ni cobro | Con `--flujo venta` (§7) y un QR de NovuChat de importe simbólico (prohibición 3), o con la línea de Q'Taco |
| **Plantillas** | Son de la WABA de Q'Taco; aquí van vacías a propósito | Con Q'Taco, con `pedido_registrado` aprobada |
| **Receptor y verificador** | La entrada es el Trigger del Demo A, no la entrega firmada | Con Q'Taco, en la ventana de mantenimiento |
| **Promociones** | Las campañas del comercio `ensayo` no son las de Q'Taco | Con Q'Taco |
| **Latencia con el número real** | Es el número de prueba de Meta y otra WABA | Con Q'Taco |
| **Que el aviso llegue a OTRA persona** | Con un solo teléfono el aviso llega al mismo chat del cliente (el interruptor lo permite solo en el ensayo) | Con Q'Taco: el destinatario del aviso es otra persona y el propio número se descarta |
| **«No pude pasarle…»** | Con un solo teléfono la ventana siempre está abierta | La suite |
| **Los nombres de credencial en la instancia, la credencial del Trigger vivo y la ruta de Meta** | No se pueden probar sin n8n ni Meta reales: la suite (`venta-minima-herramienta-demo-a.test.ts`) prueba la herramienta contra un n8n de mentira | El seco real y los pasos D y 4 de arriba |

## 7 · Ensayo del flujo de VENTA (QR de cobro y comprobante): `ensayo.mjs --flujo venta`

El ensayo del §6 no prueba QR ni comprobante porque la ruta del Demo A dice `agendamiento` y la
ingesta decide `config/venta` y el cobro por **`ruta.flujo`**, no por la ficha. Con
`--flujo venta` el script cubre las dos cosas, y solo mientras dura el ensayo:

- la ficha de `tenants/ensayo` queda con `vertical: venta`, `flujos: ['venta']` y **sin** lista
  `modulos` propia (los módulos salen del registro: productos, cobros, pedidos, catálogo web…);
- la ruta del número lleva `flujo: venta` y recuerda el valor anterior en `ensayoFlujoDe`;
  `--restaurar` lo devuelve junto con `tenantId`;
- se vacían, **solo bajo `tenants/ensayo`**, además de lo de siempre: pedidos, cierres,
  conversaciones (con sus mensajes), contactos, movimientos de stock, comprobaciones de imagen,
  salida y métricas. La auditoría se conserva. El id `ensayo` es una constante del código.

Sin `--flujo` el flujo sale de la ruta, como en el §6, pero `--preparar` **siempre** fija en `ensayo`
`flujos: [el del ensayo]` y `vertical` (nunca acumula los de ensayos anteriores), borra su lista
`modulos` y, si la ficha traía venta, vacía también los restos de venta.

**Con la ruta ya en ensayo** solo se repite el mismo ensayo (mismo `--cliente` y mismo `--flujo`); para
otro cliente u otro flujo, primero `--restaurar` (así una carga fallida no deja el número con un
comercio vaciado de otro ensayo). Si la carga falla con la ruta ya en ensayo, el mensaje dice que la
ruta sigue en ensayo y el comercio quedó vacío: reintentar o `--restaurar`. Si la ruta no tenía campo
`flujo`, se guarda un marcador nulo y `--restaurar` borra el campo en vez de inventar uno. Valores válidos: `venta` o
`agendamiento`; cualquier otro sale con 2 sin leer nada de la nube.

Cerrojos que siguen igual (probados negando en `admin/pruebas/ensayo.test.ts`): solo se desvía
el número de un comercio con `modalidad: demostracion` escrita; el comercio que paga o el que no
tiene modalidad no se desvía; sin `--aplicar` no se escribe nada; no se imprimen ids completos.

### Orden (cada paso en seco primero; `--aplicar` con el «sí» de Andres)

1. Antes de empezar: lo del §6 (A a D). **No se pisa otro ensayo**: ver la regla de coordinación.
2. `ensayo.mjs --preparar --cliente qtaco --flujo venta --archivo <copia del borrador de Q'Taco o
   `negocio-*.json` de venta, en el scratchpad> --local <tabla local>` (seco, leído entero, y luego
   `--aplicar`). Con QR: cargar en `ensayo` un QR **de NovuChat** con importe simbólico
   (`activar-cobro-real.mjs`; prohibición 3 de `CLAUDE.md`), nunca el de Q'Taco.
3. `flujo-de-prueba.mjs --sobre-demo-a` con el JSON de venta (pasos 4 y 5 del §6).
4. Pruebas con el teléfono de Andres: pedido, QR, comprobante, derivación.
5. **Doble restauración, en este orden**, y verificada con `--estado`:
   1. el flujo: `flujo-de-prueba.mjs --restaurar-respaldo` (§6, paso 6.1);
   2. el estado por teléfono: `publicar-flujo.sh --reiniciar-estado` (seco, luego `--aplicar`);
   3. la ruta: `ensayo.mjs --restaurar` (seco, luego `--aplicar`). Imprime
      `Flujo     : venta -> agendamiento`;
   4. `ensayo.mjs --estado` (la línea `Ensayo` conserva el último flujo preparado: no es un fallo; el
      siguiente ensayo siempre fija sus flujos). Debe mostrar el flujo de la ruta ya restaurado: tiene que decir `Desviada  : no` y la ruta con su flujo de siempre
      (`flujo agendamiento` en la primera línea). Si dice `sí`, no se terminó.
6. Limpieza y filas de `ESTADO.md` / `versiones-por-cliente.md`, como en el §6 (paso 6.4).

### Regla de coordinación: el Demo A es UN solo recurso, con turnos

Mientras un ensayo desvía su ruta o cambia su flujo, **ningún otro ensayo ni demo comercial lo
usa**. Turnos acordados: el **domingo 18/10, de 09:40 a 11:30**, el ensayo de H2-F; el ensayo de
venta va **después**, solo cuando el anterior terminó su doble restauración y `--estado` lo
confirma. Dos ensayos a la vez dejarían la ruta con el `ensayoDe` del primero.

## 8 · Ensayar el timbre de «Salida de persona» en el Demo A (H2-F2)

> Es el ensayo del flujo común `Flujos/salida-de-persona.json` (`Flujos/LEEME-flujos.md`
> §9), por número, **sin tocar el flujo conversacional del Demo A** ni su número: se crea un
> flujo **nuevo** en el n8n del Demo A, «NovuChat — Salida de persona (`<alias>`)», con su
> propia credencial de timbre. Alias del ensayo: **`demoA`**. Andres autoriza y Claude opera;
> **nadie lee el archivo de entrega** (contiene la URL de capacidad y la clave).

**Piezas.** `scripts/nube-salida-persona.sh` (nube: secreto `SALIDA_PERSONA_RUTAS`; genera la
ruta y la clave) y `scripts/cargar-timbre-n8n.sh` (n8n: las consume y las borra). Pruebas:
`admin/pruebas/core/nube-salida-persona.test.ts` y `cargar-timbre-n8n.test.ts` (contra un `gcloud`
y un `curl` falsos).

**Por qué no `publicar-flujo.sh`, `preparar-import.sh` ni `ensayo-flujo.sh`.** Llenan desde UNA
tabla sin sufijo por número, abortan con marcadores sin reponer, **completan las credenciales por
TIPO** (la trampa del 15/09: un nodo que manda a Meta con la credencial de ingesta) y
`ensayo-flujo.sh` republica el flujo del Demo A. `cargar-timbre-n8n.sh` asigna cada credencial **por
nombre exacto y tipo**, se niega si falta o está repetida, y revisa que `Enviar por el relé` /
`Enviar por Graph` nunca lleven la de ingesta, que no haya un WhatsApp Trigger ni una credencial de
AAB1-WA-Prod.

**La clave de la API de n8n** sale del `.env` indicado con `--env` (el mismo, ignorado y chmod 600,
de `publicar-flujo.sh`; solo se leen `N8N_BASE_URL` y `N8N_API_KEY`, sin ejecutarlo) y viaja a curl
por la entrada estándar (`-H @-`), nunca por argumentos ni por pantalla. Con `--aplicar` el script se
niega si el `.env` no es del usuario o tiene permisos de más.

### Antes de empezar

1. **Tres credenciales previas, por nombre y tipo exactos** (la carga del timbre se niega si falta
   una o está repetida): `NovuChat ingesta (demoA)` y `AAB1 envío · demoA` (Header Auth) y
   `WhatsApp demoA (envío)` (`whatsAppApi`). Las crea el paso 0 del procedimiento,
   `cargar-timbre-n8n.sh --crear-credenciales`, con estas reglas (decisión de Andres, 17/10):
   - **ingesta**: `Authorization: Bearer <secreto INGESTA_DEMOA, versión latest>`, leído de Secret
     Manager por tubería hasta el cuerpo del pedido a n8n (nunca a pantalla, argumentos ni archivo).
     Requiere gcloud con las credenciales aisladas de producción (`CLOUDSDK_CONFIG`; `--proyecto` o
     `PROYECTO`, por omisión `novuchat-demo`). Para cambiar después su valor: `rotar-ingesta.sh n8n`.
   - **AAB1 envío**: valor **inerte** (`Bearer INERTE-NO-ENVIAR`). D2: la rama del relé no se prueba en
     el Demo A y su canal es `graph`; nunca el token ni la URL reales del relé.
   - **WhatsApp**: `accessToken` = `WA_TOKEN` y `businessAccountId` = `WABA_ID`, leídas del `--env`
     (sin ejecutarlo). El `.env` indicado debe traer las del Demo A.
   Si ya existe una con ese nombre y tipo, **no se sobrescribe**: se REUTILIZA y no se marca como creada
   por el script; si hay duplicados o el nombre existe con otro tipo, se aborta sin escribir.
   **Salvaguardas** (revisión de seguridad del PR #532): (a) solo para alias de ensayo, `demoA` y `demoB`
   (un alias de cliente real, p. ej. Bellido, tiene credenciales vivas y estos modos
   se niegan con 2 sin tocar n8n; un cliente real usa `--cred-ingesta/--cred-envio/--cred-rele` con los nombres
   de sus credenciales existentes, atadas al número del alias antes de escribir (la ingesta y el envío deben citarlos un flujo vivo con ese `phoneNumberId` y ninguno con otro): `docs/produccion/timbre-salida-de-persona-clientes-reales.md`); (b) `--quitar-credenciales` borra únicamente las que **creó este script**
   (sus ids quedan en `$XDG_RUNTIME_DIR/novuchat-credenciales-creadas-<alias>.json`, modo 600; si no hay
   registro, no borra nada y lo dice) y se niega si cualquier flujo vivo de n8n las cita por id o nombre;
   (c) antes de crear la de WhatsApp, el `WA_APP_ID` y el `WABA_ID` del `--env` se cotejan sin red contra las
   huellas de apps/WABAs ajenas (`scripts/lib/apps-ajenas.sh`) y, con `--aplicar`, Graph debe confirmar que el
   token es de una app propia; si no se puede comprobar, aborta (el `.env` necesita `WA_APP_ID`); (d) con
   `--aplicar` el proyecto se indica con `--proyecto <id>` (no se hereda de la variable `PROYECTO`);
   (e) el secreto se lee como `latest` salvo `--version <N>`: `latest` puede no ser la versión desplegada, así
   que **antes de cargar el timbre** se corre `rotar-ingesta.sh probar --secreto INGESTA_DEMOA --version <N>`.
2. **La tabla local** (`CONFIGURACION.local.md`, o `CONFIG_LOCAL_MD`) con
   `REEMPLAZAR_PHONE_NUMBER_ID_DEMOA` y `REEMPLAZAR_URL_INTERNA_DEL_RELE_DEMOA` (o, para el Demo A,
   las filas sin sufijo con `--tabla-demo-a`). Se agregan sin mostrar el valor (`marcador-local.sh`).
   **Si el alias sale por `graph` y no usa el relé (el Demo A, D2)**, la fila del relé no hace falta:
   la carga lleva `--rele-inerte --canal-graph`, que repone `REEMPLAZAR_URL_INTERNA_DEL_RELE` con
   `http://relay-inerte.invalid` (dominio reservado `.invalid`, no resuelve nunca; aunque la tabla traiga
   la URL real, no viaja al flujo). El script no puede leer la ruta del alias (vive en Firestore,
   `rutasWhatsApp/{numero}.canalSalida`): `--canal-graph` es la **afirmación de quien opera** de que no
   vale `rele` (sin valor = `graph`), y se comprueba antes. Si valiera `rele`, el nodo del relé fallaría
   a propósito.
3. Pasos 1 a 3 de `nube-salida-persona.sh` ya hechos (`.github/DESPLIEGUE-FIREBASE.md`), la ventana de
   mantenimiento y el «sí» de Andres. Todo desde un worktree al día, con `.env` enlazado.

### El procedimiento (cada paso: seco, leerlo entero, luego `--aplicar` con el «sí»)

    # 1. El alias en la nube: genera ruta y clave y deja la entrega (modo 600, $XDG_RUNTIME_DIR)
    export N8N_BASE_URL="$(grep -E '^N8N_BASE_URL=' .env | tail -n 1 | cut -d= -f2- | tr -d "\"'")"
    GCP_PROJECT_ID_PROD=<id de producción> ./scripts/nube-salida-persona.sh --agregar-alias demoA
    ... --agregar-alias demoA --aplicar --confirmo produccion
    # 2a. Las tres credenciales previas (si faltan; idempotente)
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --crear-credenciales               # seco
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --crear-credenciales --proyecto <id> --aplicar --confirmo produccion
    # 2b. En n8n, EN LA MISMA SESIÓN (la entrega no se deja pendiente); el Demo A sale por graph
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --rele-inerte --canal-graph        # seco
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --rele-inerte --canal-graph --aplicar --confirmo produccion
    # 3. Redesplegar la Function que declara SALIDA_PERSONA_RUTAS: enviarComoPersona (las otras dos,
    #    reclamarSalidaPersona y confirmarSalidaPersona, no leen ese secreto). firebase-tools fija el
    #    número de versión del secreto al desplegar, así que la versión nueva no se ve hasta entonces:
    #    se despliega con la próxima etiqueta v* (la crea Andres: scripts/etiquetar-version.sh vX.Y.Z
    #    --commit <sha>; el CI despliega) o, en staging, con el push a main.
    # 4. Activar (paso aparte: empieza el barrido de cada minuto)
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --activar                          # seco
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --activar --aplicar --confirmo produccion

El script de n8n respalda el estado vivo del alias (lista de flujos «Salida de persona» con su estado
activo, el flujo del alias completo y las credenciales sin valores) en un directorio de modo 700
antes de escribir, e imprime su ruta; el respaldo **no** lleva la ruta ni la clave del timbre (el `path` va
como `<capacidad>` con su sha256), pero sí ids, nombres, phoneNumberId y URL del relé. Con `--aplicar`
exige `$XDG_RUNTIME_DIR` válido (nunca cae a `/tmp`) y no admite `--flujo`. Crea el flujo **inactivo**;
si ya existía y estaba activo, conserva ese estado y **publica la última versión** (n8n 2.x separa
borrador y publicada: se compara `versionId` con `activeVersionId` y se falla si siguen distintos).
El Timbre lleva un `webhookId` estable por alias, para no depender de guardar desde el editor.
Si algo falla, la entrega **se conserva** y el mensaje dice cómo seguir (es idempotente: se puede
repetir). Solo cuando todo se relee bien destruye la entrega.

**La prueba (a verificar en el ensayo):** un lote mixto —un mensaje válido por el relé, uno con texto
vacío, otro por Graph si se puede— más un segundo reclamo no vacío (`Flujos/LEEME-flujos.md` §9,
«Pendiente de verificar en n8n real»), y que el timbre (`enviarComoPersona`) abra el webhook con el
`Bearer` y rechace sin él.

### Lo que queda «a verificar en el ensayo» (no se puede saber sin n8n real)

- Que n8n 2.36.5 acepte `PATCH /credentials/{id}` (lo usa `rotar-ingesta.sh`), `DELETE /credentials/{id}`,
  `DELETE /workflows/{id}` y el cuerpo `{name,nodes,connections,settings}` del flujo.
- Que el `Webhook` con `path` explícito se registre en `/webhook/<path>` al activar (el `webhookId` del
  nodo no se fija).
- Que el valor del `Bearer` autentique de verdad: la API no devuelve el valor guardado, así que se
  comprueba con el timbre real.
- Que `POST /credentials` acepte los tres cuerpos de `--crear-credenciales` (`httpHeaderAuth` con
  `{name,value}` y `whatsAppApi` con `{accessToken,businessAccountId}`, el esquema que ya usan
  `importar-flujo-cliente.sh` y `credenciales-cliente.sh`), y que la de ingesta sea aceptada por el
  servidor (`rotar-ingesta.sh probar`). Que el `.env` de `--env` traiga `WA_TOKEN` y `WABA_ID` del Demo A.

### La restauración (en este orden; seco primero, `--aplicar` con el «sí»)

    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --quitar                           # seco
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --quitar --aplicar --confirmo produccion
    GCP_PROJECT_ID_PROD=<id de producción> ./scripts/nube-salida-persona.sh --quitar-alias demoA --aplicar --confirmo produccion
    # y redesplegar enviarComoPersona (misma vía que el paso 3); destruir las versiones anteriores
    # del secreto a mano (gcloud secrets versions destroy)
    # por último, las tres credenciales previas (solo después de --quitar: se niega con el flujo cargado)
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --quitar-credenciales              # seco
    ./scripts/cargar-timbre-n8n.sh --alias demoA --env .env --quitar-credenciales --aplicar --confirmo produccion

`--quitar` desactiva y borra el flujo del alias y **solo** la credencial del timbre (nunca las de
ingesta, AAB1 ni WhatsApp), relee que no quede nada y deja el respaldo previo.
`--quitar-credenciales` borra **solo** esas tres, por nombre y tipo exactos (un homónimo de otro tipo
o de otro alias no se toca), aborta si hay duplicados y relee que no quede ninguna. Al terminar se borra
el respaldo (`rm -rf` de su directorio).
