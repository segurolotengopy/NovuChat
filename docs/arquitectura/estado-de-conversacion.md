# Estado de la conversación en el servidor (F3b, opción O2): el contrato

Zona **Core** (la Function `configuracionFlujo` y los documentos de turno), con
adopción por flujo (`Flujos/`). Este documento es el **contrato en papel** (PR-0 de
F3b): fija los nombres y las reglas **antes** de repartir el trabajo. No describe
código en `main`: nada de lo que sigue existe todavía. Fuente: el plan por PR de
F3b del 18/10/2026 (planificador, sobre `origin/main` `7b591a60`); la opción O2 la
ratificó Andres el 17/10/2026. Lo que el plan no fija se anota como «a decidir».

Costo de todo F3b: **0 mensajes por conversación** agregados o quitados.

## 1. Por qué

Los flujos guardan hoy el estado del turno (qué se le ofreció al cliente, mensajes
ya vistos, pedidos, marcas de aviso) en `$getWorkflowStaticData` de n8n. Ese
almacén vive en la memoria de la ejecución y se escribe al final: con dos
ejecuciones que se pisan, o con una que se cae, **se pierde la última escritura**,
y el cliente vuelve a recibir una oferta que ya había aceptado o un aviso
duplicado. Un almacén del servidor, con versión y transacción, lo evita.

- En Q'Taco lo guardado no es solo un estado por teléfono: `estados`, `vistos`,
  `pedidos` (por pedidoId, 72 h, máximo 500), `transferencias`, `avisosPedido`
  (marcas por hora), `av.dia` (contador diario) y `av.ventana` (estado **del
  comercio**, no de un contacto: no entra en un bloque por contacto).
- **El candado por hecho no depende de este estado.** «Nunca una cita encima de
  otra» se dispara por lo que el modelo hizo, verificado en el calendario
  (`CLAUDE.md`, reglas de diseño); ni este contrato ni su caída lo debilitan.

## 2. La petición

Mismo POST a `configuracionFlujo`. `telefono` y `catalogoCompleto` no cambian; se
agrega `sesion`:

```
{ v: 1,
  accion: 'leer' | 'comprometer' | 'asentar'      (ausente = leer),
  espacio: /^[a-z][a-z0-9-]{0,31}$/,
  canal?: 'wa',
  ejecucion: /^[A-Za-z0-9_-]{1,64}$/,
  idMensaje?: hasta 256 caracteres               (solo en leer),
  versionLeida: entero >= 0,
  idCompromiso: /^[A-Za-z0-9_.:-]{8,128}$/       (comprometer y asentar),
  estado: objeto | null                           (hasta 16 KiB, profundidad 20),
  venceEnMin: 1..4320,
  cupos?: [{ clave, alcance: 'comercio'|'contacto', periodo: 'dia'|'hora',
             cantidad: 1..20, tope: 0..1000 }]    (máximo 5) }
```

- El contacto es el `telefono` ya validado (`/^[0-9]{8,15}$/`); una `sesion` sin
  teléfono válido responde 400.
- La clave de seguridad es `tenantId` + `phoneNumberId` de `rutaAutenticada`; nada
  del cuerpo cuenta (un `tenantId` en el cuerpo se ignora).
- `espacio` es una **partición lógica, no una frontera**: todo flujo con la
  credencial de un número lee y escribe cualquier espacio de ese número.
- `v` desconocido responde 400.

## 3. La respuesta de `leer`

La de hoy; **solo si vino `sesion`** se agregan
`conversacion: { version, estado, desde, vence, vencido }` y
`visto: 'nuevo' | 'repetido' | null`.

- Sesión corrupta: igual que ausente más `corrupta: true` (el campo falta, o es falso, si no), para que el flujo no planifique sobre una versión 0 falsa; el siguiente `comprometer` con `versionLeida` 0 la autorrepara (§4).
- Documento ausente: `{ version: 0, estado: null, desde: null, vence: null, vencido: false }`.
- `vence` pasado: `estado: null, vencido: true`, conservando la versión.
- Sin `sesion`, la respuesta es **idéntica a la de hoy, byte a byte**.

## 4. `comprometer` y `asentar`

Despacho corto (unas 40 líneas en `ingesta.ts`) **después** de autenticar y del 409
por comercio no activo, y **antes** del `Promise.all` del catálogo. Devuelve
`{ resultado, conversacion, motivo?, clave? }`. Es una transacción, todo o nada:

| Caso | Resultado |
|---|---|
| `idCompromiso` ya aplicado (se guardan los últimos 5) | `repetido` |
| `versionLeida` distinta de la actual | `conflicto_version`, con el estado ganador |
| cupo con tope 0 o ausente | `cupo_negado` / `sin_tope` |
| cupo agotado | `cupo_negado` / `agotado` (la versión no se mueve) |
| documento del cupo con `usados` que no es entero >= 0, o datos corruptos | `cupo_negado` / `datos_invalidos` (no se concede; la versión no se mueve) |
| documento de sesión corrupto (`version`, `vence`, `estadoJson` o `compromisos` ilegibles) | `datos_invalidos`, **sin escritura**; salvo autorreparación con `versionLeida` 0 (abajo) |
| todo pasa | `version + 1`, cupos incrementados (`por[idCompromiso]` = `{cantidad, en}`, §11), `comprometido` |

**Autorreparación.** Si la sesión está corrupta y `versionLeida` es 0 (lo que `leer` le mostró al flujo), `comprometer` la trata como ausente y la reescribe desde la versión 1 con la marca `reparadoEn`; los compromisos anteriores se pierden (solo puede volver a cobrar un cupo, nunca concederlo de más). Con otra `versionLeida` responde `datos_invalidos` y no escribe. Si el presupuesto de tiempo (3,5 s) se agota, cualquier acción responde **503** con mensaje fijo y sin escritura.

`asentar` **devuelve (libera)** los cupos que consumió ese compromiso y devuelve
`asentado` o `nada_que_asentar`; es idempotente (§11). Los resultados
de negocio salen como 200; los errores, como 400, 401, 404, 405, 409 (sin
escritura), 413 y 500. La versión es optimista, sin candado por teléfono (el
documento es por contacto).

## 5. Los documentos

Solo por Admin SDK; **nada bajo `conversaciones`**.

| Colección | Clave | Campos |
|---|---|---|
| `tenants/{t}/sesionesDeTurno` | `{pnid}~{espacio}~wa_{tel}` | `version`, `estadoJson` (cadena opaca), `vence`, `actualizadoEn`, `flujo`, `phoneNumberId`, `espacio`, `compromisos[5]` |
| `tenants/{t}/vistosDeTurno` | `sha256(pnid\|idMensaje)` | `ejecucion`, `phoneNumberId`, `vence` (24 h) |
| `tenants/{t}/cuposDeTurno` | `{pnid}~{clave}~{wa_tel\|_}~{periodo}` | `usados`, `tope`, `por`, `vence` (fin del período + 24 h; períodos en `America/La_Paz`) |

El vencimiento lo limpia un TTL sobre `vence` en los tres grupos (PR-3), con
`estadoJson` exento de índice. Ningún rol de la consola lee ni escribe estas
colecciones.

## 6. Política de falla

Criterio vigente: «solo se ofrece lo que se cumple» (`CLAUDE.md`).

- `leer` falla o falta `conversacion`: respuesta genérica **con botón**, sin avisos
  ni compromiso. (Hoy `Traer configuración` tiene timeout de 4 s y `neverError`; si
  falla, `Config del negocio` usa el respaldo y deriva.)
- `comprometer` con 5xx, timeout o segundo conflicto: genérico con botón, sin
  avisos ni cierre. **Reemplaza** la respuesta: 0 mensajes agregados.
- Primer `conflicto_version`: **una** replanificación en código sobre el estado
  ganador (sin modelo) y un segundo `comprometer` (+1 llamada solo en ese caso).
- Entrega fallida **sin** hecho externo: compromiso compensatorio con la versión
  recién comprometida y el estado previo (ancla B0). **Con** hecho externo (aviso
  enviado o cierre): paso `menu`, como hoy.
- `asentar` falla: el cupo no se libera y queda consumido (conservador).
- Los avisos al local de Q'Taco salen antes de `Armar mensajes`: comprometer antes
  de enviar obliga a comprometer antes de `¿Hay avisos?`.

## 7. Reversión

El contrato solo agrega. Un flujo vuelve atrás republicando su JSON anterior; la
Function se revierte con la etiqueta anterior, pero **solo después** de republicar
el JSON viejo de Q'Taco (si no, Q'Taco deriva todo). Los datos de las tres
colecciones vencen solos.

## 8. Las tres enmiendas a `Analisis/41`

Aprobadas por Andres el 17/10/2026. **La edición de `Analisis/41` es de la
revisora, en otro PR**: este documento no la hace. Hasta que se aplique, el plano
y este contrato difieren en estos tres puntos y manda este contrato.

| Sección | Dice hoy | Enmienda aprobada | Aplicada en el plano |
|---|---|---|---|
| §6.1.3 | «no se agregan llamadas» | se permite la llamada de estado (`sesion`) y, solo en conflicto, una segunda | No (pendiente, revisora) |
| §2.3 | guarda el estado «después» de enviar | `comprometer` **antes** de enviar; `asentar` después | No (pendiente, revisora) |
| §2.2 | estado `{pendiente, candidatos, desde}` | el estado es un **bloque opaco** del flujo (`estadoJson`) | No (pendiente, revisora) |

## 9. Lista de PR

Orden: escritor A en serie (PR-0, PR-1, PR-2a, PR-2b con PR-3 en una etiqueta,
PR-4a, PR-4b, PR-6b); escritor B en paralelo (H2b, PR-6a).

| PR | Qué | Dueño | Estado |
|---|---|---|---|
| PR-0 | Este contrato en papel y la línea en `indice.md`; las 3 enmiendas al plano las hace la revisora | metodo / revisora | en curso (este PR) |
| PR-1 | Núcleo puro `core/turno/sesion.ts` y su suite en `SUITES_PURAS` | `core-functions` | pendiente (depende de PR-0) |
| PR-2a | Transacciones `core/turno/sesionFirestore.ts` y su suite de emulador | `core-functions` | pendiente |
| PR-2b | Rama `sesion` en `configuracionFlujo` (despacho); renombrar la variable local `conversacion` a `docConversacion` | coordinadora | pendiente; producción con «sí» de Andres |
| PR-3 | TTL e índices en `firestore.indexes.json` (políticas primero en staging) | coordinadora | pendiente; puede ir en la etiqueta de PR-2b |
| PR-4a | Q'Taco adopta estado y vistos | `flujos-n8n` con Cartera | pendiente; espera PR-2b en producción y #519 |
| PR-4b | Q'Taco: cupos (`av.dia`, `transferencias`, `avisosPedido`) | `flujos-n8n` | pendiente; depende de PR-4a y D-7 |
| PR-4c | El chat NovuChat adopta | a decidir | solo si Andres lo incluye (§10, 3) |
| PR-5 | Bellido adopta | n/a | **en espera**: Bellido no se toca |
| PR-6a | Suites sin `new Function` (las que no son de Q'Taco, Bellido ni Platinum) | `core-flujos` | pendiente |
| PR-6b | Ídem para las `venta-minima-*` | `core-flujos` | pendiente; tras PR-4b |

Cada PR declara 0 mensajes por conversación y pasa por `revisor-codigo` y
`seguridad` (con mirada de facturación). El camino `sesion` no escribe en
`conversaciones/*` ni en `metricas/*`, para proteger el conteo facturado; lo
prueba PR-2a. Costo en la nube estimado, sin verificar: unas 2 a 3 escrituras por
turno, cerca de 0,00007 USD por conversación.

## 10. Preguntas abiertas y recomendación del plan

1. **D-7, tope de los cupos.** Recomendación: que viaje en el cuerpo con techo de
   servidor de 1000 por clave, y que el contrato diga «ningún cupo es límite
   comercial». Un límite comercial futuro se leerá de `cuenta/estado.limites`,
   nunca del cuerpo.
2. **Plazo de Q'Taco.** Decidir con la latencia medida en el ensayo; si el p95 de
   `leer` supera unos 1,5 s, subir `Traer configuración` a 6 s; subir
   `executionTimeout` a 90 s antes que recortar los avisos a 10 s.
3. **Chat NovuChat.** Recomendación: incluir PR-4c después de Q'Taco (un PR más).
4. **`av.ventana`** (estado del comercio). Recomendación: aceptarlo como residuo
   declarado en PR-4a (si se pierde una escritura sale la plantilla de respaldo) y
   luego derivarlo de `ultimoEntranteEn` de `conversaciones/wa_{destinatario}`.
5. **H2b en Bellido y Platinum.** Recomendación: «sí» a escribir `modulos` en sus
   fichas (dato, sin cambio de capacidad); si no, la condición 6 no cierra.
6. **Qué cuenta como agenda** (límite de agendas de H2b). Recomendación: los
   `calendarioId` distintos entre funcionarios activos; un comercio sin
   funcionarios cuenta como 1.

D-7 (pregunta 1) y la pregunta 5 son las que piden respuesta de Andres antes de
PR-4b y de cerrar H2b; las demás tienen recomendación y se resuelven en su PR.

## 11. Decisiones tomadas al construir PR-1

Las tomó el autor de PR-1 donde el plan no precisaba; quedan **decididas** y, donde
el §2 a §5 dicen otra cosa, mandan estas.

**Petición**
- El campo `venceEnMin` de la petición sigue en **minutos** (1..4320). Los
  milisegundos son solo el interior del núcleo (`desde`, `vence`, `actualizadoEn`,
  `ahoraMs` y los cálculos de período, como números epoch ms); el servidor calcula
  `vence` con `venceEnMin * 60_000`.
- `ejecucion` es obligatoria en todas las acciones.
- `leer` rechaza `idCompromiso`, `estado`, `venceEnMin` y `cupos`;
  `comprometer` y `asentar` rechazan `idMensaje`.
- Una clave extraña dentro de `sesion` (por ejemplo `tenantId`) responde 400.
- `idMensaje`: ASCII imprimible, `^[\x21-\x7e]{1,256}$`.
- `phoneNumberId`: `/^[A-Za-z0-9_-]{1,64}$/`.

**Cupos**
- Clave de cupo: `/^[a-z][a-z0-9_-]{0,31}$/` (admite guion bajo; no choca con el
  centinela `_` porque empieza con letra y `~` separa los componentes).
- Dos cupos con la misma terna clave/alcance/período responden 400.
- `tope` es opcional; ausente equivale a 0 y da `sin_tope`.
- Los períodos se guardan como `aaaa-mm-dd` (día) y `aaaa-mm-ddThh` (hora), en
  `America/La_Paz`.
- Un cupo vencido que el TTL aún no borró cuenta como vacío.
- `idCupo` e `idVisto` **no** incluyen `espacio`, a propósito: valen por número y
  contacto.
- `por` de cada cupo guarda `{cantidad, en}` por `idCompromiso` y conserva las 50
  entradas más recientes según `en`.

**Orden y vencimiento**
- Orden de decisión: `repetido`, luego `conflicto_version`, luego cupos (un
  reintento llega con `versionLeida` vieja).
- Los cupos se evalúan todos antes de conceder alguno (todo o nada).
- Un `vence` igual a `ahora` cuenta como vencido (`<=`).
- Un `estadoJson` corrupto se lee como `null` sin marcar `vencido`.

**`asentar`**
- Devuelve (libera) los cupos que consumió ese compromiso: `usados -= cantidad` y
  borra su entrada en `por`. Resultado `asentado` o `nada_que_asentar`;
  idempotente.
- Ids de compromiso: primer carácter alfanumérico, y se rechazan los nombres de
  `Object.prototype` (`constructor`, `toString`, …). Toda lectura de mapas usa
  `Object.hasOwn` y los mapas se crean sin prototipo. Datos corruptos dan
  `datos_invalidos` o `nada_que_asentar`; nunca se concede por NaN.
- Exige `idCompromiso`; rechaza `estado`, `venceEnMin` y `cupos`; `versionLeida` es
  opcional y se ignora.

## 12. Decisiones al construir PR-2a

- `por[idCompromiso]` de un cupo guarda también `tel` (el contacto que comprometió). Un cupo del comercio (`_`) lo comparten todos los contactos, y `asentar` solo lo devuelve si `tel` coincide; una entrada vieja sin `tel` no coincide con nadie (queda consumida, lado conservador).
- El documento de sesión reparado lleva `reparadoEn`; el de cupo y el de visto llevan `phoneNumberId`.
- `asentar` encuentra los cupos con una consulta por `por.{idCompromiso}.cantidad`: necesita el índice automático de subcampo de mapa (PR-3 no debe exentar `por`, solo `estadoJson`).
- Presupuesto de tiempo de 3,5 s medido con reloj real: se comprueba al empezar cada intento de la transacción y antes de escribir; al agotarse, 503 `sesion: ocupada, reintente`. En el emulador una colisión tarda ~3 s en resolverse, así que bajo mucha contención el 503 es esperable; en Firestore real no está medido.
