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

> Andres escribe desde su teléfono a la línea del Demo A y el flujo de «Venta
> mínima (v0)» —el de Q'Taco— le contesta. El n8n es el del Demo A y su
> `WhatsApp Trigger` usa la credencial de la app NovuChat-Demo-A (nunca la de
> AAB1-WA-Prod, `CLAUDE.md` prohibición 7). Diseño de la variante:
> `Flujos/experimental/venta-minima/DISENO.md`, «La variante de ensayo en el Demo A».

**Por qué no sirve `ensayo-flujo.sh`.** Su cerrojo exige que cada nodo con
credencial exista, con el mismo nombre, en el Demo A de agendamiento, y que los
marcadores sean los de un cliente de agendamiento. Un flujo de venta tiene nodos
de envío propios. Por eso hay un archivo de datos aparte
(`admin/scripts/datos/venta-minima/ensayo-demo-a.json`) que da el JSON
`Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.json`, con el
**mismo nombre de flujo que el Demo A**: así `publicar-flujo.sh` sigue
protegiendo con su cerrojo de nombre (solo pisa al Demo A), y la vuelta es
`ensayo-flujo.sh --restaurar`.

Todo `--aplicar` lo corre Claude con el «sí» de Andres en el chat, después de
leer entero el seco del mismo paso. Los scripts de n8n se corren desde
`~/NovuChat` (donde están los `.env` y `CONFIGURACION.local.md`), con la ruta
absoluta al JSON del worktree (`<worktree>` abajo).

**1. Preparar el worktree.** Dentro de `.claude/worktrees/<nombre>/`, en una
rama nacida de `origin/main` con el PR del cambio; `pnpm install
--frozen-lockfile` en `admin/` (nunca `npm`) y, con la suite en verde,
`node Flujos/experimental/venta-minima/construir.mjs --verificar` en 0.

**2. Los marcadores de la tabla local.** El JSON trae dos:
`REEMPLAZAR_PHONE_NUMBER_ID` (el del Demo A, ya está en la tabla) y
`REEMPLAZAR_NUMERO_AVISO_ENSAYO` (el teléfono del restaurante en el ensayo).
Se comprueba con `./scripts/marcador-local.sh --verificar <marcador>` y, si
falta el segundo, se agrega sin mostrar su valor:

    ./scripts/marcador-local.sh --marcador REEMPLAZAR_NUMERO_AVISO_ENSAYO \
      --copiar-de REEMPLAZAR_NUMERO_RECEPCION_ENSAYO --nota "restaurante del ensayo de venta"

Quien hace de restaurante es el teléfono de `REEMPLAZAR_NUMERO_RECEPCION_ENSAYO`
(hoy, Andres). Si tiene que ser otro, el valor lo pone Andres por `MARCADOR_VALOR`.

**3. Preparar el import** (reemplaza los dos marcadores y fija el `webhookId` del
Trigger en la ruta que Meta ya tiene registrada para el Demo A):

    ./scripts/preparar-import.sh <worktree>/Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.json .env

Se lee entero: tiene que decir que los dos marcadores se resolvieron y que
ninguno quedó sin resolver. Deja `venta-minima.ensayo-demo-a.local.json` junto al
original (ignorado por git: lleva valores reales; se borra al terminar).

**4. La credencial «Graph WhatsApp Demo A (Bearer)»** no existe en el Demo A y
los cuatro nodos de envío de la venta la usan. Se crea con el token del Demo A,
sin mostrarlo, y se resuelven los ids del `.local.json`:

    ./scripts/credenciales-cliente.sh --cliente "Demo A" --env-cliente .env \
      --flujo <worktree>/Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.local.json          # seco
    ... --aplicar

El seco tiene que listar `+ Graph WhatsApp Demo A (Bearer)` (o `= … ya existe`) y
resolver todos los nodos con credencial; si dice «Sin credencial en la
instancia», se detiene el procedimiento (no se completa por tipo). Antes de
publicar se puede comparar con `./scripts/credenciales-flujo.sh --env .env`, que
muestra los nombres de las credenciales del Demo A vivo («WhatsApp OAuth
account», «Cierres NovuChat A (auto)», «WhatsApp account»), nunca valores.

**5. La plataforma: `ensayo.mjs --preparar`** (desde `admin/`, con
`CLOUDSDK_CONFIG=$HOME/.config/gcloud-novuchat-prod`). Con una **copia del
borrador de Q'Taco fuera del repositorio** (en el scratchpad de la sesión) que
cambia dos cosas: `catalogoWebActivo` en `false` (con más de 40 ítems y el
catálogo web encendido, la ingesta manda `catalogo: []` y el flujo deriva todo
pedido) y el marcador de recepción `REEMPLAZAR_NUMERO_RECEPCION_QTACO` por
`REEMPLAZAR_NUMERO_AVISO_ENSAYO` (el botón «Escribir al local» va al mismo
teléfono que recibe los avisos):

    node scripts/plataforma/ensayo.mjs --proyecto <proyecto> --numero <phone id del Demo A> --preparar \
      --cliente qtaco --archivo <copia del borrador, en el scratchpad> \
      --local ~/NovuChat/CONFIGURACION.local.md            # seco: se lee entero
    ... --aplicar

Vacía y recarga el comercio `ensayo` y desvía la ruta del número a `ensayo`.
Como la ruta del Demo A es `agendamiento`, no carga `config/venta`.

**6. El flujo: `publicar-flujo.sh` del JSON del ensayo**, sobre el Demo A:

    ./scripts/publicar-flujo.sh --env .env --flujo <worktree>/Flujos/experimental/venta-minima/venta-minima.ensayo-demo-a.json   # seco
    ... --aplicar

El seco se lee entero. Tiene que decir que usa el archivo preparado, que el
nombre del archivo y el del flujo vivo coinciden (si no, el cerrojo se niega) y
que no queda ningún marcador. `--aplicar` guarda antes un respaldo del flujo vivo.

**7. Las pruebas, con dos teléfonos registrados** en la app del Demo A (hasta 5,
prohibición 6):

- **El restaurante escribe primero** (cualquier «hola»): eso abre su ventana de
  24 h. El flujo no tiene plantillas aquí: con la ventana cerrada el aviso no
  sale.
- **El cliente es otro teléfono.** No puede ser también el destinatario
  `completo`: su aviso se descarta (`avUnificar`) y leería «No pude pasarle tu
  pedido al restaurante…».
- Pedido de recojo sin QR hasta «Confirmar pedido»: el restaurante recibe el
  detalle en **texto libre** y el cliente lee «pasé tu pedido». Reserva,
  derivación («Escribir al local») y una bebida alcohólica o un helado (que no
  deben ofrecerse).
- El flujo de venta no guarda ejecuciones (retención `none`, decisión del
  02/10/2026): `ver-ejecuciones.sh` no mostrará nada de este ensayo. Lo que vale
  es lo que cada teléfono recibió, y los conteos que quedan en el comercio
  `ensayo`.

**8. La restauración completa, siempre, salga bien o mal.** En este orden y con
cada paso en seco primero:

    ./scripts/ensayo-flujo.sh --restaurar            # seco: republica demo-a-agendamiento.json
    ./scripts/ensayo-flujo.sh --restaurar --aplicar
    ./scripts/publicar-flujo.sh --env .env --reiniciar-estado            # seco: lista los teléfonos con estado
    ./scripts/publicar-flujo.sh --env .env --reiniciar-estado --aplicar  # deja el estado global del flujo vacío (incluido el de la venta)
    node scripts/plataforma/ensayo.mjs --proyecto <proyecto> --numero <phone id del Demo A> --restaurar            # seco
    ... --aplicar

Después se borran los `.local.json` generados y las citas de prueba de las
agendas del demo. La credencial «Graph WhatsApp Demo A (Bearer)» puede quedar en
n8n (el próximo ensayo la reutiliza); retirarla es decisión de Andres.

**Lo que este ensayo NO prueba** (y dónde se prueba):

| Qué | Por qué | Dónde se prueba |
|---|---|---|
| **QR y comprobante** | La ruta del Demo A es `agendamiento`: el servidor no manda `config/venta` ni cobro, así que no hay QR que enviar ni cotejo | Con la línea de Q'Taco, con un QR de NovuChat e importe simbólico (prohibición 3) |
| **Plantillas** | Son de la WABA de Q'Taco y aquí van vacías a propósito | Con Q'Taco, con `pedido_registrado` aprobada |
| **Receptor y verificador** | La entrada es el Trigger del Demo A, no la entrega firmada del receptor | Con Q'Taco, en la ventana de mantenimiento |
| **Promociones** | Las campañas del comercio `ensayo` no son las de Q'Taco | Con Q'Taco |
| **Latencia con el número real** | Es el número de prueba de Meta y otra WABA | Con Q'Taco |
