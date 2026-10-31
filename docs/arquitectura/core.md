# Core: lo que todo tenant corre igual

> Zona de la arquitectura por capas (`Analisis/41-arquitectura-por-capas.md`
> §1). Este archivo es el manifiesto en prosa de la zona y el destino de las
> secciones de `admin/DISENO.md` que le pertenecen; el mapa de secciones viejas
> está en `indice.md`. Sin secretos ni identificadores.

## Definición

**Lo que todo tenant corre igual, sin excepción, en cualquier canal.**
Contratos, seguridad, conteo, canal, agente base. La cambia solo NovuChat, y
cada cambio llega a todos.

Ejemplos: mensaje normalizado, conector de WhatsApp, firma HMAC, claims, reglas
de aislamiento, ventana de 24 h y bloque de 25, umbrales, normalización de
entrada, medios entrantes (audio, imagen, documento), prompt base.

**La prueba de ubicación** (`Analisis/41` §1.3): es core lo que responde «sí» a
la primera pregunta, «¿lo corre todo tenant igual, aunque no lo vea nadie?».

**Dependencias permitidas:** el core no depende de nada de arriba. La regla que
hoy se viola: `ingesta.ts` (core) importa `retencion`, `inventario`,
`captacion`, `campanas` y `cobroVenta` (módulos); se corrige con ganchos
registrados (`coordinador.md`), no con más importaciones.

## Los contratos del core (`Analisis/41` §2)

El core se define por sus contratos, no por dónde corre. n8n es la
implementación actual del pipeline de turno. Los cuatro contratos:

1. **Mensaje normalizado** (entrada): `{ canal, tenantId, contactoId,
   nombrePerfil, tipo, texto, medios, referral, idMensaje, recibidoEn }`
   (`Analisis/35` §4.1). Hoy lo produce `Normalizar entrada` dentro de cada
   flujo, en tres variantes; pasa a producirlo el conector de canal (F4), y
   hasta entonces una sola variante en `Flujos/src/core/`.
2. **Contexto de turno**: la respuesta de `configuracionFlujo`, ordenada en
   `operativo`, `modulos`, `negocio` y `atencion`. El flujo no sabe de planes
   ni de modalidades.
3. **Reporte de turno y ganchos**: `ingesta`, partida por dentro en el
   coordinador más los ganchos de los módulos (ver `coordinador.md`).
4. **Cierre**: `registrarCierre` no cambia. No es la unidad que se factura
   (es la conversación, `docs/base-comercial.md` §2): es el registro
   verificable de lo que terminó bien.
5. **Envío** (salida): `{ tenantId, contactoId, tipo, contenido, opciones }`,
   implementado por una Function `enviar` con la credencial en Secret Manager
   (F4). Hoy vive en cada flujo.

## Inventario: qué es core hoy y adónde va (`Analisis/41` §5)

| Pieza | Va a | Nota |
|---|---|---|
| `firma.ts`, `claims.ts`, `autorizacion.ts` | `functions/src/core/seguridad/` | `claims.ts` es el único emisor de claims |
| `atencion.ts` | `core/conteo/` | Ventana, bloque, umbrales |
| `cierres.ts` | `core/turno/` | Contrato de cierre; desde F3b-1b es `crearRegistrarCierre(ganchos)` y no importa nada de arriba: los ganchos de Cobros y Agenda los inyecta `ganchos.ts` (`coordinador.md`) |
| `ingesta.ts` | `core/turno/`, **se parte** | Coordinador + ganchos que vuelven a sus módulos |
| `prompt.ts` | `core/prompt/`, **se parte** | La base es core; el resumen del catálogo va a Productos; `documentoDeVertical` desaparece |
| `region.ts`, `opcionesGlobales.ts` | `core/` | |
| `cierres`, `conversaciones`, `mensajes`, `metricas` (Firestore) | Core, escribe la ingesta | `contactoId` con prefijo de canal (`Analisis/35`), sin cambiar el conteo |
| `/rutasWhatsApp/{n}` | Core, conector de canal | Se agrega `titularidad`; en F4 pasa a `/rutas/{canal}/{id}` |
| `Flujos/src/comun/` (5 módulos, variante de reservas), movidos en FL1 | `Flujos/src/core/` | Una sola variante para reservas, venta y captación (F3) |
| Nodos de medios (transcribir, describir, leer comprobante) | `Flujos/src/core/medios/` | Con el esqueleto único |
| `Flujos/prompts/…` (parte base) | `prompts/core/base.md` | El prompt se arma por capas |
| `web/src/lib/sesion.ts`, `contexto.tsx` y demás reexportaciones | `core/lib/` | Son reexportaciones de Functions; siguen |
| `pruebas/frontera/fronteras.test.ts` y `frontera.ts` (F2, PR 2) | Coordinadora (fuera de la zona de todo agente) | Lee los `import` de cada archivo y falla si una zona importa hacia arriba o un módulo importa a otro sin `dependeDe`; la deuda de hoy, en una lista que solo se achica (`registro.md`) |
| `pruebas/core/registro.test.ts` (F2, PR 1) | Core | Cada documento, colección, pestaña y límite del registro tiene su regla y su prueba negativa |

Lo que **no** es módulo aunque se parezca y es core: los **medios entrantes**
(transcribir audio, describir imagen y documento, leer comprobante), por la
regla del 25/09 «capacidades generales, no por vertical»; la **firma**; el
**modelo de IA por tenant** (`tenants/{t}.modelo`, lo escribe solo Plataforma).

## El hijo de una suite

**Una suite que lanza un script hereda el emulador, nunca las ADC.** Lo mostró
la revisión de la tanda 1 y lo corrigió el #245 en `asignar-rol.test.ts`.

- **La regla:** toda suite que lance un script con `spawnSync` le pasa en su
  `env` `FIRESTORE_EMULATOR_HOST` y `FIREBASE_AUTH_EMULATOR_HOST` hacia un
  puerto muerto, `GOOGLE_APPLICATION_CREDENTIALS` hacia una ruta inexistente y
  `METADATA_SERVER_DETECTION=none`. Lo hace aunque `pruebas/correr.sh` ya
  exporte el emulador, porque la suite también se corre sin él.
- **Cómo se cumple:** toda suite que lanza Node o bash (`spawnSync`, `spawn`,
  `execFileSync`, `execFile`, `fork`, `execSync`, también como `cp.…` y con los
  argumentos en una variable) pasa `entornoDelEmulador(…)` de
  `pruebas/core/entorno-del-hijo.ts`; sus variables propias no pueden pisar las
  que cierran la salida a la nube. `pruebas/core/hijos-hermeticos.test.ts`
  (pura) lee todas las suites con el parser y falla ante cualquiera de esas
  formas sin el entorno, salvo un `-e` de Node.
- **Qué exige a las mudanzas:** una tanda que mueva suites conserva ese `env` y
  la última línea de `correr.sh`.
- **Cómo se comprueba:** con `pnpm pruebas:reglas` dentro de `unshare -rn`, sin
  red y con un puerto propio.

## Pendiente F3b (flujos)

- **Carpetas transitorias de Flujos:** `Flujos/src/core/venta/`,
  `Flujos/src/core/captacion/` y `Flujos/src/modulos/cobros/venta/` son Core o
  el módulo para `fronteras.test.ts`; no entra ningún archivo nuevo (sección 9
  de `ensamblador.test.ts`, la lista solo se achica); F3b las vacía al unificar
  en `core/`.
- **Comentarios con la carpeta vieja:** quedan citando `Flujos/src/comun/`, a
  propósito, comentarios dentro del código de los nodos Code de los JSON de
  `Flujos/` (cambiarlos cambia el flujo publicado). Se corrigen en F3b, con una
  publicación.

## Límites que el core hace cumplir

Los del bloque de 25 respuestas por conversación y los umbrales de operador y
bloqueo (`ingesta.ts`, `atencion.ts`). La tabla completa de límites, con su
estado, está en `limites.md` y en `docs/base-comercial.md` §7.

También los **topes diarios de medios** (aprobados por Andres el 30/10/2026,
contrato de medios v2 §7.4): por comercio 3.000 medios guardados o anotados y
3 GiB de bytes; por teléfono 100 medios y 500 MiB. Viven en un solo bloque de
`core/medios/guardarMedio.ts`, se cuentan en el contador `cuposDeMedios/{día}`
(TTL de 2 días; los del teléfono en el mapa `telefonos.{clave}`, con la clave
como hash del número) dentro de la misma transacción de la reserva. Y los topes
por tipo (imagen 5 MB, audio 16 MB, video 16 MB, documento 16 MB).

## Medios entrantes guardados (H3, PR-1; Andres 20, 22 y 23/10/2026)

> **Contrato v2, «guardar y descargar TODO» (Andres, 30/10/2026).** Desde M1b
> se guardan imagen (jpeg, png, webp; el sticker llega como imagen webp), audio,
> **video** (mp4, 3gp; `X-NovuChat-Tipo: video`) y **documentos de cualquier
> tipo** hasta 16 MB. Imagen, audio y video se verifican por la firma (415 si los
> bytes contradicen la categoría: una «imagen» HTML/SVG/exe, un «video» que es un
> m4a, un mp4 declarado audio); las marcas `ftyp` de video son una lista
> **disjunta** de las de audio y exigen una caja de tamaño ≥ 8. Un documento
> **nunca** da 415: `documentoPorFirma(bytes, mimeDeclarado)` (pura, en
> `tipos.ts`, la misma que usa `verMedio`) decide la extensión y el mime
> guardados de una lista cerrada (`pdf|docx|xlsx|pptx|zip|doc|xls|ppt|txt|csv|bin`):
> un PDF-ZIP políglota, un Office con macros (`vbaProject.bin` o mime
> `macroEnabled`), un texto con NUL o UTF-8 inválido y todo lo desconocido son
> `bin`/`application/octet-stream`. Nunca se descomprime nada. El objeto de
> Storage de un documento se escribe **siempre** `application/octet-stream`, y
> todo objeto con `contentDisposition: attachment`. `mediosRecibidos` agrega
> `categoria` (`image|audio|video|document`) y `ext` real. Topes por teléfono
> (100 medios y 500 MiB al día, `429 cupo_telefono_lleno`) y por comercio
> (3.000 y 3 GiB). Un rechazo nunca gasta cupo; si Storage falla, vuelve
> también el cupo del teléfono. El modo Anotar sigue por compatibilidad hasta
> republicar los flujos. **Ingesta:** hoy registra `video` y `sticker` como
> `otro` (lista cerrada `TIPOS` de `ingesta.ts`), así que un video o un sticker
> da 409 `sin_mensaje` hasta que la ingesta los agregue; `guardarMedio` ya acepta
> un mensaje `sticker` para `image` y nunca acepta `otro` (la ingesta registra
> `video` y `sticker` con su tipo desde el 30/10/2026).
>
> **Revisión de seguridad de #709 (30/10/2026).** (1) La clave del mapa
> `cuposDeMedios/{día}.telefonos` es `t` + sha256 truncado del número: un
> **seudónimo reversible por fuerza bruta**, no un secreto; alcanza porque el
> documento está cerrado a todo cliente, y si alguna vez se abre su lectura pasa
> a ser un HMAC con secreto. El mapa está exento de índice
> (`firestore.indexes.json`). (2) Un pendiente retomado con **más** bytes que los
> reservados cobra la diferencia (comercio y teléfono) en el contador del día de
> la reserva, con los mismos topes (429 si no cabe). (3) **El framework parsea el
> cuerpo antes del handler** (functions-framework: `body-parser` json, text,
> urlencoded y raw, límite 1024 MB): con `application/json` y bytes no JSON
> responde 400; con `application/x-www-form-urlencoded` de más de 1000
> parámetros, 413; con un `charset` desconocido en `text/*`, 415; `multipart/*` y
> `application/octet-stream` llegan intactos. Por eso el mime declarado es
> `X-NovuChat-Mime` si viene con forma de mime (sin CR/LF), y si no el
> Content-Type; el flujo debe mandar `application/octet-stream` como Content-Type
> de transporte y el mime de Meta en `X-NovuChat-Mime`. Riesgo abierto, fuera del
> handler: el mismo parser descomprime `Content-Encoding: gzip` antes de
> autenticar.
>
> Lo que sigue de esta sección vale salvo donde estas notas lo cambian.

Esto **corrige** la nota de «Lo que este bloque NO hace» de §4terdecies («guardar
el medio para que una persona lo mire»): desde el 20/10 se guardan los medios
**entrantes** (audio, foto, PDF) 90 días, y la bandera por comercio
`guardarMedios` (ficha del tenant) está **apagada por defecto**. Se enciende solo
con el anexo aceptado y el «sí» de Andres, por el script de plataforma (PR-3), no
por el comercio: la ficha no la escribe ningún navegador.

- **`guardarMedio`** (HTTP, solo el token por número; una firma se rechaza):
  409 con la bandera apagada; 400 por teléfono o `idMeta` inválidos; 413 por el
  tope del tipo; 415 por la firma de los bytes en imagen, audio y video (los
  documentos ya no dan 415: contrato v2, arriba; los alias `image/jpg`, `application/ogg`, `audio/aac` en m4a y
  `audio/3gpp` en amr se aceptan porque los bytes siguen decidiendo); 409 `sin_mensaje` si no hay un mensaje **entrante** del mismo tipo con
  ese `idMeta` de hace 30 minutos o menos (ata el medio a una conversación, pero
  **no frena un token robado**: con el mismo token la ingesta acepta un `idMeta`
  cualquiera; **lo que limita es el tope diario**); 429 `cupo_diario_lleno` con el tope del día lleno. Un repetido
  responde 200 sin reescribir ni gastar cupo.
- **Tope superado, constancia acotada:** el 429 deja constancia en el propio
  contador (`rechazados`, `ultimoRechazo`) a lo sumo 50 veces por comercio y día;
  pasadas esas, el 429 sale sin escribir nada, para que un token robado no se
  convierta en escrituras sin freno.
- **Modo ANOTAR (docx y xlsx, 29/10/2026):** el flujo no descarga los bytes;
  manda cuerpo vacío con `X-NovuChat-Anotar: 1`, `X-NovuChat-Tipo: document` y
  `X-NovuChat-Mime`. Con un mime de Word o Excel modernos, la misma transacción
  gasta un cupo, crea `mediosRecibidos/{hash}` con `estado: 'anotado'` (sin ruta,
  tamaño ni sha256) y marca el mensaje; responde `200 {anotado:true}`. Otro mime
  o tipo, 415; Anotar **con** cuerpo, 400 `anotar_con_cuerpo` (anotar no es una
  puerta para guardar sin pasar por la firma). Desde el contrato v2, un docx con
  bytes y sin Anotar se guarda (docx si su estructura coincide; si no, `bin`).
  Un Anotar sobre un `idMeta` ya **guardado** responde la forma del guardado,
  `{ruta, repetido:true}`, no la anotada (M2 lo tolera); sobre un `pendiente` de
  bytes, reciente o viejo, responde 409 `en_curso` y no lo pisa.
- **Riesgo del token robado y alerta recomendada:** el token por número es la
  única credencial; quien lo tenga puede registrar mensajes y medios hasta el
  tope (3.000 medios y 3 GiB por comercio y día; 100 y 500 MiB por teléfono). Se recomienda una alerta de
  monitoreo sobre `cuposDeMedios/{día}.bytes` mayor que 2 GiB (o `rechazados`
  mayor que 0), que un comercio real no alcanza: es la señal de abuso.
- **Fallas de Firestore:** la consulta del mensaje, la reserva y la transacción
  del anotado van en try/catch: 502 `no_se_registro` (409 `en_curso` si fue
  contención, ABORTED), sin escribir nada, y el log lleva solo el código del
  error, nunca la ruta con el teléfono.
- **Cupo gastado y objeto huérfano (decisión de diseño):** si el objeto se guardó
  pero el cierre falla (`no_se_registro`), el cupo queda gastado y el objeto
  huérfano hasta que un reintento pasados 5 minutos lo retome o hasta la purga
  de 90 días; el flujo lo avisa con el aviso de falla. Con `no_se_guardo` el cupo
  vuelve una vez, al contador **del día en que se reservó** (la carpeta de la
  ruta del marcador), aunque la medianoche de La Paz haya pasado.
- **Pendiente retomado con otro formato:** se guarda en la carpeta del día de su
  reserva con la extensión de los bytes que llegaron, y el cierre reescribe
  `ruta`, `ext`, `mime` y `tamano` (rechazarlo dejaría el medio sin guardar hasta
  que caduque el marcador). El cupo no se ajusta por la diferencia de tamaño.
- **Concurrencia:** `concurrency: 4` fuera de staging (en gen2 con 1 vCPU el
  valor por defecto es 80, y el cuerpo se lee entero antes de autenticar: 80
  cuerpos de 16 MB agotan 1 GiB). En staging (CPU fraccionaria) no se declara.
- **Deduplicación y cupo, atómicos** (revisión de seguridad del #617): la misma
  transacción que reserva el cupo crea el marcador `mediosRecibidos/{hash}` con
  `estado: 'pendiente'` (vence en 1 día por TTL); se pasa a `guardado` al
  terminar. Peticiones simultáneas con el mismo `idMeta` gastan un solo cupo; si
  Storage falla, el cupo vuelve una sola vez y el marcador se borra; un pendiente
  de más de 5 minutos (instancia muerta) se retoma sin otro cupo, y uno reciente
  da 409 `en_curso`. El visor (PR-2) debe ignorar los `pendiente`.
- **Tipos:** solo `ftyp` M4A y M4B cuentan como audio; `isom`, `iso2`,
  `iso4`–`iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `MSNV`, `dash` son video mp4 y
  `3gp4`–`3gp6`, `3gg6`, `3g2a` video 3gp. Un `%PDF-` con `PK\x03\x04` en el
  primer KB o con el fin de directorio ZIP al final (políglota) no es PDF: como
  documento se guarda `bin`.
  No es un comprobante: no toca `solicitud`, `cierres`, `comprobantesRecibidos`,
  `metricas` ni `conteo`.
- **Datos:** Storage `tenants/{t}/medios/{aaaa-mm-dd La Paz}/{sha256(idMeta)}.{ext}`
  (sin teléfono en la ruta ni en los metadatos; las reglas niegan todo acceso) y
  Firestore `tenants/{t}/mediosRecibidos/{sha256(idMeta)}` con TTL sobre `vence`.
- **`purgarMedios`** (03:45 La Paz): borra las carpetas de más de 90 días y, con
  la baja del comercio, el prefijo entero y sus colecciones.
- **Condiciones para el visor (PR-2):** servir con el `Content-Type` fijado por
  el servidor (el guardado en `mediosRecibidos.mime`, nunca el que pida el
  cliente), `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`,
  y nunca dentro de un iframe del mismo origen de la consola.
- **Cuenta y alerta de la purga:** `purgarMedios` corre con `sa-functions`, la
  cuenta compartida de todas las Functions, con `storage.objectUser` sobre el
  bucket; al entrar el visor conviene una cuenta dedicada con solo lo necesario.
  Si algún comercio falla, la purga escribe un `console.error` con el texto fijo
  `PURGA_MEDIOS_CON_ERRORES`: la alerta recomendada es una métrica basada en
  registros sobre `textPayload:"PURGA_MEDIOS_CON_ERRORES"` (severidad ERROR) que
  avise a Andres por un canal fuera de la Function. No está creada: es un paso de
  nube con su «sí».
- **Despliegue:** `guardarMedio` es HTTP nueva (1 GiB, sin concurrencia): tras
  desplegar, el invocador sale con `scripts/nube-visor.sh --servicio guardarmedio`
  (`allUsers` es correcto: la barrera es el token por número).
- **Quién lo ve (M3a, 30/10/2026; reemplaza a «nadie todavía»):** la callable
  `verMedio` (`core/medios/verMedio.ts`; contrato M3 y contrato v2 «guardar y
  descargar TODO» con su adenda de seguridad §7.7 y §8.3). Entrada exacta
  `{tenantId, conversacionId, idMeta, accion}` con `accion` `'ver'` o
  `'descargar'` (otra clave: `invalid-argument`). El servidor lee
  `mediosRecibidos/{sha256(idMeta)}`, exige la misma conversación, `estado:
  'guardado'` y `vence` futuro, valida la ruta (este comercio, este medio, lista
  cerrada de extensiones, sin `..`), RECALCULA la extensión desde los bytes y exige
  que sea la de la ruta, y comprueba el `sha256` guardado. Salida `{tipo,
  categoria, mime, extension, tamano, base64}` con mime SEGURO: imagen y audio, el
  de su firma; video y documento, siempre `application/octet-stream`; nunca el
  declarado. Roles: admin y operador del comercio y soporte con ventana vigente,
  todos ven y descargan (decisión de Andres del 30/10, §8.3: **reemplaza a la D4**
  de abajo). Anotado y pendiente: `failed-precondition` con `details`
  `'anotado'`/`'pendiente'`; baja o inexistente: `not-found`. Auditoría fail-closed
  `medio_visto` o `medio_descargado` con `objeto` (el hash), sin teléfono ni
  `idMeta`; tope 60/h y 300/día en `topesDeMedios/{uid}` (cifras del integrador, ajustables). 1 GiB, 120 s, 3
  instancias, concurrencia 4 fuera de staging, App Check en producción. El mayor
  archivo (16 MiB) son ~21,3 MiB en base64: cabe en los 32 MiB de respuesta de gen2
  (no en los 10 MB de gen1). La extensión se recalcula con `tipoPorFirma` (video) y
  `documentoPorFirma` (documentos, con el mime guardado) de `tipos.ts`: las mismas
  funciones que usa `guardarMedio`.
  Tras desplegar: `scripts/nube-visor.sh --servicio vermedio`.
- `almacen.ts` es copia declarada del de `modulos/cobros/comprobantes.ts` (Core no
  importa módulos); que Cobros importe de Core es un PR aparte del agente `modulo`.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4 (25/09/2026, líneas 174-178) -->

## 4. Aislamiento multi-tenant

Es el punto donde estos sistemas fallan. El modelo de amenazas completo está en
`SEGURIDAD.md`; acá van las decisiones.


<!-- movido de admin/DISENO.md §4.1 (25/09/2026, líneas 179-202) -->

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


<!-- movido de admin/DISENO.md §4.2 (25/09/2026, líneas 203-261) -->

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


<!-- movido de admin/DISENO.md §4.3 (25/09/2026, líneas 262-303) -->

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
  Desde el 09/10/2026 esa misma ventana también permite ver comprobantes de pago
  con la callable `verComprobante` (auditado con rol «soporte» y con el mismo
  tope por usuario). Hoy no existe una pantalla en la consola que otorgue la
  ventana, y el texto del consentimiento que ve el administrador llegará con esa
  pantalla; hasta entonces el acceso de soporte a comprobantes no tiene camino
  en la consola.

- **La ingesta es ciega.** El principal de servicio de n8n escribe y no puede
  leer. Si su credencial se filtra, el atacante puede ensuciar el historial de
  **un** negocio, no exfiltrar el de ninguno.


<!-- movido de admin/DISENO.md §4.4 (25/09/2026, líneas 304-331) -->

### 4.4 Los custom claims y su tope de 1000 bytes

Forma del claim:

```json
{ "nc": { "p": true, "t": { "salon-demo": "admin" }, "v": 3 } }
```

Las claves son de una letra a propósito. Firebase impone un **tope duro de 1000
bytes** al conjunto de custom claims, y `setCustomUserClaims` falla al pasarlo —
en producción, con el usuario ya creado. Con este formato entran del orden de 15
a 20 negocios por usuario; con claves como `roles`/`tenantId`/`propietario` se
llegaría a la mitad. `functions/src/core/seguridad/claims.ts` verifica el tamaño antes de
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


<!-- movido de admin/DISENO.md §4.5 (25/09/2026, líneas 332-347) -->

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


<!-- movido de admin/DISENO.md §4ter (25/09/2026, líneas 626-627) -->

## 4ter. Modelo de acceso y funciones de relación con el comercio


<!-- movido de admin/DISENO.md §4ter.1 (25/09/2026, líneas 628-734) -->

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
| **Longitud mínima de contraseña** | ⚠️ parcial | Firebase Auth impone **6 caracteres**. La consola pide **8** al cambiarla (`web/src/core/lib/contrasena.ts`), pero **eso es del navegador y se saltea**. Una política real —longitud, tipos de carácter, contraseñas filtradas— es *password policy*, y eso **exige Identity Platform**. |
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

**El número vive en un solo lugar**, `web/src/core/lib/contrasena.ts`
(`MINIMO_CONTRASENA`), y `pruebas/contrasena-minimo.test.ts` verifica que las
dos pantallas lo usen en vez de volver a escribirlo. Mientras Firebase siga con
su política de seis, **la pantalla de restablecimiento va a aceptar menos que
la consola**: eso es lo que cierra el paso 14d, y hasta entonces es un hueco
conocido, no una sorpresa.


<!-- movido de admin/DISENO.md §4terdecies (25/09/2026, líneas 2751-2822) -->

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

   > **Enmendada el 23/10/2026 por decisión de Andres (H3, «Medios guardados»):
   > lo que cambia es el «Nada se guarda».** Con la bandera `guardarMedios` del
   > comercio encendida y el anexo aceptado por el cliente, los medios
   > **entrantes** (audio, foto, PDF) se guardan 90 días en el almacén de
   > medios. **Sin la bandera, nada se guarda**, y la regla de arriba sigue
   > rigiendo tal cual. Lo que NO cambia: el asistente nunca ve el medio (regla
   > 1) y el comprobante sigue las reglas de §4nonies.3. El texto de la regla 2
   > queda arriba como histórico; el diseño está al final de este archivo, en
   > «Medios guardados (H3)». **Reemplazado el 23/10/2026 por decisión de
   > Andres**; no construido todavía.

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


## Medios guardados (H3)

> **Estado: DECIDIDO por Andres (20/10 y 22/10/2026, asentado el 23/10);
> NO construido; el aspecto legal está PENDIENTE de revisión legal y del «sí»
> de Andres.** Enmienda la regla 2 («Nada se guarda») de §4terdecies. Meta
> (documentación oficial consultada el 23/10/2026): la URL de un medio entrante
> expira a los 5 minutos; el id del medio en el webhook, a los 7 días; imagen
> jpeg/png hasta 5 MB, audio aac/amr/mpeg/mp4/ogg-opus hasta 16 MB, documento
> hasta 100 MB. Los topes de 5 / 16 / 10 MB que siguen son de NovuChat.

### Decidido

- **Qué:** guardar los medios **entrantes** del cliente final (audio, foto, PDF)
  durante **90 días**, con TTL.
- **Quién ve:** solo el admin y el operador del tenant, por una Function
  auditada que devuelve **bytes**, nunca una URL pública. Soporte de NovuChat
  **no ve los medios** (a diferencia de `verComprobante`).
- **Baja del comercio:** los medios se borran al darlo de baja.
- **Topes por medio:** imagen 5 MB, audio 16 MB, PDF 10 MB. El tipo se decide
  por la **firma de los bytes**, no por lo que declare el remitente.
- **Etapas:** 1 = guardar y ver u oír en la consola; 2 = enviar como persona
  («Tomar») con medios.
- **D1:** se guarda también con la conversación tomada (hoy «pausa = cero
  descargas»).
- **D2:** se bajan audios desde 720 kB hasta 16 MB **solo para guardarlos**, sin
  transcribirlos.
- **D3 (legal):** la bandera `guardarMedios` del comercio se enciende **solo
  con el anexo aceptado por el cliente y el «sí» explícito de Andres**. El
  consentimiento que antes se pensaba pedir al paciente en el chat
  (`Analisis/38`) pasa a ser el anexo aceptado por el comercio.
- **D4:** soporte no ve los medios. **Reemplazada el 30/10/2026** (Andres, contrato
  v2 §8.3): el soporte con ventana vigente ve y descarga igual que admin y operador,
  con la misma auditoría (`verMedio`).
- **D5:** cupo de guardado por comercio y día: 1.000 medios o 2 GB.
  **Reemplazada el 29/10/2026:** tope de 3.000 medios por comercio y día (más
  15 GiB de bytes como freno de costo).
- **D6:** docx, xlsx y otros documentos **no** se guardan. Desde el 29/10/2026,
  docx y xlsx se **anotan** (metadato sin bytes).
- **Rutas:** Storage `tenants/{t}/medios/{fecha La Paz}/{objeto}.{ext}`;
  Firestore `tenants/{t}/mediosRecibidos` con el campo `vence` y política TTL.
- **Functions:** `guardarMedio` (la sube el flujo, porque la ingesta no tiene el
  token de Meta; el receptor de AAB1 es de WhatsApp-Modular y no se toca),
  `verMedio` y `purgarMedios`.
- **Riesgo que se asume por escrito:** muchas fotos y PDF son datos de salud de
  terceros; guardarlos es un dato personal más que custodiar (privacidad y
  retención). Por eso la bandera nace apagada y la purga va antes que todo.

### Pendiente (legal)

- **PENDIENTE de revisión legal y de Andres:** la redacción del §9 del anexo
  técnico y de SLA. Hay un borrador aparte,
  `docs/contrato/anexo-tecnico-sla-v2-BORRADOR.md`; el anexo vigente no se toca.
  El §13 del anexo exige acuerdo escrito del cliente cuando una versión reduce
  un compromiso, y «Qué no se guarda» es uno.

### Los 6 PR del plan (ninguno construido salvo PR-0)

| PR | Contenido |
|---|---|
| PR-0 | Documentación: estas decisiones, la enmienda y el borrador del anexo |
| PR-1 | `guardarMedio`, `purgarMedios` y las reglas de Firestore y Storage |
| PR-2 | `verMedio` |
| PR-3 | Script de la bandera `guardarMedios` por comercio |
| PR-4 | Rama «Guardar medio» en el flujo de Cartera |
| PR-5 | Consola: visor, y CSP con `media-src blob:` |

### Antes de encender la bandera

Verificar en la VM de n8n que `N8N_DEFAULT_BINARY_MODE=filesystem` y que la
poda de ejecuciones (`EXECUTIONS_DATA_PRUNE`, `EXECUTIONS_DATA_MAX_AGE`) están
activas: la regla 2 de §4terdecies dice que **no estaba hecho**, y sin eso los
bytes quedan en la base de n8n fuera del plazo y del borrado de arriba. Ninguna
bandera se enciende antes de que la purga esté desplegada y probada.

**Costo en mensajes por conversación: 0** (guardar no envía nada).
