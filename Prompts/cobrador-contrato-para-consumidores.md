# Cobros por QR: un contrato para proyectos consumidores — construcción

> **Estado real al 20/09/2026 (noche), verificado contra el proyecto de cobros
> a pedido de Andres.** Este prompt se escribió suponiendo que el contrato no
> existía. **Sí existe, y va adelantado:**
>
> - **Bloque 0 y bloque 1: hechos y fusionados** (PR #38, 20/09). En `main` del
>   proyecto de cobros están `packages/functions/src/api/consumidores.ts`,
>   `cupo-consumidor.ts`, los esquemas y el enrutador con las rutas `/api/v1/…`,
>   y el verificador de consumidores en `auth.ts` (`CONSUMIDOR_TOKEN_<ID>`, mínimo
>   32 caracteres, cupo de 60 QR por hora). Cuatro operaciones, idempotencia por
>   `referenciaExterna`, sin teléfono, 404 para lo ajeno. El documento del
>   contrato, `docs/10-contrato-consumidores.md`, está en la rama `docs/estado-pr-38`,
>   todavía sin fusionar. Lo único pendiente del bloque 1 es su ensayo con un
>   cobro real de monto mínimo.
> - **Bloque 2 (aviso de confirmación): en curso** en la rama
>   `feat/aviso-de-confirmacion`, con un worktree activo de otra sesión. Ya define
>   el evento `cobro.confirmado` (`idEvento` = id del cobro, `consumidorId`,
>   `cobroId`, `referenciaExterna`, `montoCentavos`, `confirmadoEn`, `ocurridoEn`,
>   `riel`), la cola con reintentos sin tope (30 s → 1 día) y el puerto
>   `NotificadorConsumidor`. **La firma y el transporte HTTP del aviso no están
>   decididos todavía**: es lo que NovuChat (A-2) le pide en
>   `Prompts/COORDINACION.md`, fila C.
> - **Bloques 3 y 4: pendientes**, como dice este prompt.
> - **C9 ya está anotada** como respondida (decisión 17 de su `ESTADO.md`).
>
> Lo que este prompt le pide a la sesión de cobros, entonces, es cerrar 2, 3 y 4
> y fusionar el documento; los bloques 0 y 1 no se repiten. Cuatro diferencias
> del contrato real que `Analisis/36` §4 no conocía: la referencia externa admite
> solo letras, números y `: _ . -` (hasta 120), **sin `/`**; el monto viaja como
> texto decimal con punto (`"150.50"`), no en centavos; el QR llega como **imagen
> PNG en base64**, no como texto EMV; y el `concepto` lo ve el pagador en su app
> bancaria, así que no lleva datos del comercio. Y una más de despliegue: la API
> corre hoy como proceso local (`servidor.ts`), no como Cloud Function, así que
> el ensayo de punta a punta depende del bloque 4 o de una URL alcanzable.


> **Este prompt se pega en una sesión del proyecto de cobros por QR Simple**,
> no en NovuChat. Vive acá porque lo escribió la sesión de NovuChat, que es su
> primer consumidor; **cópialo a `Prompts/` de ese proyecto** como primera
> tarea, y de ahí en adelante mantenlo allá.

Eres una sesión dedicada a completar el contrato del sistema de cobros por QR
para **proyectos consumidores**. **El bloque 1 ya está hecho** (PR #38,
fusionado el 20/09/2026; `docs/10-contrato-consumidores.md`, ADR-008): la
superficie `/api/v1/cobros` con token por consumidor, `referenciaExterna`
idempotente y atómica, `estadoCobro` por id o referencia, `anularCobro` con
sus tres desenlaces, `listarCobros` y la imagen del QR. **Lo que sigue es el
bloque 2 —el aviso de confirmación— y el pase a producción.** No se reescribe
lo que hay.

Lee primero, en este orden: el `CLAUDE.md` del proyecto (las reglas de negocio
inviolables, en especial que solo la consulta autenticada confirma un pago),
`docs/ESTADO.md`, `docs/01-arquitectura.md` (los puertos y los ADR),
`docs/Integraciones/baneco/02-hallazgos-produccion.md` (lo que la prueba con
plata real dejó demostrado) y `docs/06-seguridad.md`.

Del lado del consumidor, el análisis que define lo que se necesita es
`Analisis/36-prepago-estricto-y-dunning.md` de NovuChat, §1.2 y §4. Pídele a
Andres la ruta si la quieres leer; lo esencial está en este prompt.

## Las decisiones que no se tocan

1. **Solo la consulta saliente autenticada al banco confirma un pago.** El
   webhook del banco y el comprobante del pagador son disparadores de
   verificación. El contrato nuevo **no** puede darle a un consumidor ninguna
   forma de marcar un cobro como pagado: la API es asimétrica a propósito.
2. **Ninguna credencial bancaria sale del proyecto**, ni en la respuesta de la
   API, ni en un log, ni en un aviso.
3. **Montos en centavos enteros**; todo QR tiene vencimiento y su renovación es
   versionada; un QR es de un solo uso. Ya está probado en producción.
4. **El consumidor no manda datos personales.** La referencia externa es
   **opaca** (un identificador del consumidor), sin nombre, teléfono ni NIT de
   su cliente: el sistema de cobros no necesita saber de quién es el cobro.
5. **El envío del QR al pagador es del consumidor**, por su propio canal. Este
   proyecto entrega la imagen o el texto del QR y no manda nada por WhatsApp.
6. **El cobro por QR Simple no tiene comisión bancaria** (Andres, 17/09/2026):
   la pregunta C9 queda respondida y hay que anotarlo en
   `02-hallazgos-produccion.md` §5.
7. **Andres autoriza; tú operas.** Nada contra el banco, la nube o GitHub sin
   su «sí» en el chat.

## Reutilizar antes de escribir

Consulta `~/Claude-Proyectos/proyectos/` y actualiza la ficha de este proyecto
al cerrar: hoy está marcada como parcial y es la que otros agentes leen para
saber que este cobro existe y qué exige.

## Cómo trabajar

Worktree y rama propios; un bloque, una rama, un PR. Antes de cada commit,
`typecheck`, `lint` y la suite completa, como exige el proyecto. Las pruebas
contra el banco, solo en el modo de prueba controlada y con montos mínimos.

## Qué construir, por bloques

### Bloque 0 — Inventario de lo que ya hay · **HECHO** (`docs/10-contrato-consumidores.md`)
Antes de escribir: leer `packages/functions/src/api/enrutador.ts`,
`esquemas.ts` y `handlers.ts`, y `auth.ts`. Dejar escrito en `docs/` qué
operaciones existen, qué cuerpo aceptan y quién puede llamarlas. Es la mitad
del contrato, y ya está.

### Bloque 1 — El contrato · **HECHO el 20/09/2026** (PR #38)
Sobre las operaciones que ya existen, cuatro agregados, sin tocar `qr-core`:

- **Identidad del consumidor**: un verificador más al lado de los dos de
  `auth.ts` (token fijo del dueño, ID token de Firebase), que reconoce a un
  consumidor y lo **acota a su cuenta de cobro** en cada petición; hoy la
  cuenta se elige por proceso (`CUENTA`), no por petición.
- **`referenciaExterna`** opaca en `POST /api/cobros`, única por consumidor,
  con **idempotencia**: dos `POST` con la misma referencia devuelven el mismo
  cobro, no dos QR. Y consulta por referencia.
- **`telefonoCliente` opcional** para consumidores: el cobro del prepago no
  tiene un pagador con teléfono que el cobrador necesite, y mandarlo sería
  un dato personal de más.
- La respuesta de `anular` distingue «anulado» de «no se puede porque ya está
  pagado» (el banco devuelve el mismo código para los dos; hay que consultar).

Las operaciones, ya existentes o completadas así:

| Operación | Entrada | Salida |
|---|---|---|
| `crearCobro` | cuenta de cobro, importe en centavos, vigencia, **referencia externa opaca** (única por consumidor), concepto corto | id del cobro, QR (texto e imagen), vencimiento |
| `estadoCobro` | id o referencia externa | estado de la máquina, y si está pagado, cuándo y por qué riel |
| `anularCobro` | id | resultado, distinguiendo «anulado» de «no se puede anular porque ya está pagado» (el banco devuelve el mismo código para los dos casos: hay que consultar el estado para desambiguar) |
| `listarCobros` | cuenta, rango de fechas | para conciliar |

**Idempotencia por referencia externa:** dos `crearCobro` con la misma
referencia devuelven el mismo cobro, no dos QR. Es lo que impide que un
consumidor con un reintento le cobre dos veces a su cliente.

### Bloque 2 — El aviso de confirmación (1 jornada) · **es el que sigue**
Hoy no hay salida hacia nadie: la confirmación queda en el estado del cobro
y se lee por `GET`. Cuando un cobro pasa a confirmado, avisar al consumidor: **firmado**, con
marca de tiempo, con reintentos y sin datos sensibles. El aviso es un
**acelerador**: el consumidor tiene que poder preguntar por `estadoCobro` y
llegar al mismo resultado, y el contrato tiene que decirlo, porque de eso
depende que nadie construya su lógica sobre un aviso que puede perderse.

### Bloque 3 — Cuentas de cobro por consumidor (½ jornada)
Ya hay soporte para varias cuentas, cada una con su alias y sus credenciales.
Falta que **un consumidor solo vea y use la suya**, y que los cobros queden
atribuidos por cuenta para el cierre diario.

### Bloque 4 — El pase a producción (1 jornada + espera del banco)
Lo que falta según el estado del proyecto: la cuenta de pruebas del banco, y
el checklist de pase a producción del estándar DevSecOps. Anotar C9 como
respondida. El pase lo aprueba Andres.

### Lo que NO se construye
- **Ninguna vía para que un consumidor confirme un pago.**
- **Ningún envío de mensajes** al pagador desde este proyecto.
- **Nada del riel diferido** (el scraping de la consola de la otra billetera)
  ni selectores inventados.
- **Ninguna lógica de negocio del consumidor**: planes, meses adelantados,
  cortes y recordatorios son de quien cobra, no de quien emite el QR.

## Entregables al cerrar
- El inventario del bloque 0 en `docs/`, como primera página del contrato.
- Un PR por bloque, con pruebas y, para los bloques 1 y 2, un ensayo con un
  cobro real de monto mínimo pagado desde otro banco.
- El contrato documentado en `docs/` con ejemplos, incluida la frase de que
  el aviso no es la fuente de verdad.
- C9 anotada como respondida; `docs/ESTADO.md` al cerrar cada bloque; la ficha
  del proyecto en `~/Claude-Proyectos/proyectos/` completada.
