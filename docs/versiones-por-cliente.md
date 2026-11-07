# Qué versión tiene publicada cada cliente

> **Por qué existe.** Hasta el 24/09/2026 la regla era «un cambio se aplica a
> todos o a ninguno». Se cambió por **«preferentemente a todos, registrando las
> excepciones»** porque NovuChat empieza a sacar **productos empaquetados**: un
> cliente puede quedarse a propósito en una versión, y una regla absoluta
> obligaba a mentir o a incumplirla en silencio.
>
> **El riesgo que cubría la regla vieja no desapareció:** un cliente con el
> prompt viejo es un defecto que nadie nota hasta que reclama. Lo que cambia es
> que ahora la diferencia se **declara acá** en vez de prohibirse. **Un flujo
> atrasado sin fila en esta tabla es un defecto, no una excepción.**
>
> **Se comprueba solo:** `./scripts/estado-de-versiones.sh` compara cada flujo
> vivo con su JSON versionado y **falla si hay un atraso sin declarar**. No hay
> que mantener a mano la columna «al día»: la calcula el script.

## Cómo se llena una excepción

Una excepción necesita las tres cosas, o no es una excepción:

1. **Qué queda distinto** — no «está atrasado», sino qué nodo o qué texto.
2. **Por qué** — el paquete que compró, la prueba en curso, el pase pendiente.
3. **Hasta cuándo, o qué la cierra** — una fecha o un hecho. Una excepción sin
   final es un olvido con papeles.

## Los flujos publicados

| Cliente | `--env` | Flujo versionado | Excepción declarada |
|---|---|---|---|
| Demo A (agendamiento) | `.env` | `Flujos/demo-a-agendamiento.json` | **Atrasado en 2 puntos (comprobado el 06/11/2026 contra `origin/main`):** el nodo `Preparar imagen` y los «settings del flujo». `Procesar respuesta` YA NO difiere: el vivo lo tiene (el #284, detector de «ya», `5aad7da`, y la corrección `NIEGA_IA` #359 quedaron al día). **`Preparar imagen` (visión de imágenes, 22/10/2026):** nuevo en `main` sin publicar; su conducta cambia SOLO si el clasificador devuelve variantes de la categoría (mayúsculas, espacios o guiones: «Comprobante » con seña vencida antes iba a `otro` y ahora fuerza la transferencia) y `foto` o `captura_de_pantalla` ya no llevan el `texto` leído. Por qué: el Demo A es el número de ensayo y no tiene pacientes; Andres decidió no publicar hasta el ensayo y su botón. Lo cierra: la publicación de flujos con ensayo previo, al adoptar la visión en el prompt del clasificador. **Settings del flujo:** diferencia señalada por `estado-de-versiones.sh` el 06/11/2026; su causa NO está investigada (se anota para que no quede como atraso sin declarar). Lo cierra: comparar los settings del vivo con el versionado en la próxima publicación y alinearlos. Tras el ensayo de Q'Taco del 06/11/2026 el Demo A se restauró con el respaldo exacto del vivo (77 nodos), así que esta fila describe el vivo anterior al ensayo. |
| Dr. Bellido (pediatría) | `.env.bellido` | `Flujos/bellido-agendamiento.json` | **Corre otro flujo, el piloto «Agenda mínima v0»** (publicado el 01/10/2026 a la 01:24 con autorización de Andres): `Flujos/experimental/agenda-minima/agenda-minima.v0.json`, **53 nodos** desde el 24/10/2026 (madrugada UTC; la hora local fue la noche del 23/10), publicado con `flujo-de-prueba.mjs --sobre-bellido --desde-b` desde `main` `b82f22bf` (PR #640, head `ea3d1d6e`), que lleva #603 (medios del core), #619, #627 y los dos defectos corregidos de #640: la oferta de horarios lleva siempre encabezado, servicio y día por código, y toda respuesta del modelo que remita a recepción sin botón se convierte en la transferencia estándar (+1 aviso a recepción solo cuando esa red actúa; 0 nodos agregados). Antes: 45 nodos, de `e3d4af9`, PR #354; el piloto se publicó el 01/10 desde `f3f7411`, PR #293, fusionado en `c0ea17e`. **Vuelta atrás:** respaldo exacto del vivo anterior fuera del repositorio, con `flujo-de-prueba.mjs --sobre-bellido --restaurar-respaldo` (con «sí» de Andres) o republicando `9d3bc4c2`. No es el JSON versionado de esta fila (el de A, 96 nodos, descartado). Se publica con `herramientas/flujo-de-prueba.mjs --sobre-bellido`, **no** con `publicar-flujo.sh`. Por qué: es el piloto que Andres decidió el 30/09/2026 tras el concurso entre el flujo actual y este. **Plan ante una falla de B (Andres, 01/10/2026): se corrige B; no se vuelve al flujo anterior ni al candidato A, que se descartó.** El respaldo del flujo anterior de 96 nodos no es plan del piloto. Lo cierra: la decisión de Andres sobre el piloto (y cambiar esta columna al JSON de B cuando `estado-de-versiones.sh` sepa compararlo contra el vivo); hasta entonces `estado-de-versiones.sh` lo verá «atrasado, CON excepción declarada», que es lo esperado. **CÓDIGO CONGELADO (Andres, 23/10/2026: «está suficientemente bien para salir en producción») salvo orden suya.** Atraso entre el JSON de Agenda mínima versionado y el vivo: **ninguno desde el 24/10/2026**; la excepción declarada de #619/#627 queda **cerrada** (publicados con #640). El PR #629 (pregunta de salud) sigue abierto y estacionado, sin publicar. Lo único declarado es que la fila apunta al JSON de A, no al que corre; hasta que `estado-de-versiones.sh` sepa compararlo contra el vivo lo verá «atrasado, CON excepción declarada», que es lo esperado. Historia: hasta el 30/09 corría el flujo publicado desde `main` con #284 (96 nodos, hotfix de protección del 27/09 más mejoras adelantadas, sobre la base `e02a756`); esa versión queda como respaldo |
| Q'Taco | `.env.qtaco` | `Flujos/experimental/venta-minima/venta-minima.qtaco.json` | Difiere solo en el dato `destinatariosAviso` de `Config base`: en producción lleva un único destinatario (recepción) y la preparación estándar repone dos desde `CONFIGURACION.local.md`. Por qué: Andres decidió en la apertura que el aviso de cocina no se manda; el código del flujo es el mismo. Lo cierra: quitar el segundo número de aviso de `CONFIGURACION.local.md` (la copia local, ignorada por git); o, mejor, dejar un solo destinatario en la plantilla versionada `admin/scripts/datos/venta-minima/qtaco.json`; entonces `estado-de-versiones.sh` lo verá al día. Se revisa en la próxima publicación de Q'Taco. **miniCRM (06/11/2026, sin publicar): +8 nodos (79), ver «Estado al 06/11/2026».** **PR-4a (04/11/2026), VERSIONADO ADELANTADO, sin publicar:** el estado de la conversación, los pedidos del teléfono y los mensajes vistos pasan de la memoria de n8n al servidor (`sesion` de `configuracionFlujo`, espacio `venta-minima`); +9 nodos (69; tope 60 → 69, aprobado por Andres el 04/11/2026). Mientras no se publique, `estado-de-versiones.sh` lo verá atrasado y es correcto. Condiciones de Clínicas (dueña de venta-minima/Q'Taco): no publicar hasta el «sí» de Andres, suites verdes, 0 mensajes por conversación. Orden de publicación: la Function `configuracionFlujo` con la rama `sesion` en producción, ensayo en el Demo A, y recién entonces el flujo. Ver «Estado al 04/11/2026 (PR-4a)» más abajo. **PR-4b (05/11/2026), VERSIONADO ADELANTADO, sin publicar:** los cupos de aviso (`av.dia`, `transferencias`, `avisosPedido`) pasan al servidor y `reservasDelDia` al bloque del teléfono; +2 nodos (71; **tope 69 → 71 aprobado por Andres (06/11/2026, en conversación)**). Ver «Estado al 05/11/2026 (PR-4b)». **miniCRM (06/11/2026, sin publicar): solo cambia el código de «Armar mensajes» y de «Config del negocio»; 0 nodos nuevos y sin planilla (no lleva el dato `crm`).** |
| Q'Taco 3727 (workflow nuevo, envío directo) | `.env.qtaco3727` (lo escribe `publicar-flujo.sh --crear --env-nuevo` con el id del flujo nuevo; hasta entonces no existe y `estado-de-versiones.sh` no puede compararlo) | `Flujos/experimental/venta-minima/venta-minima.qtaco-3727.json` | **Workflow aparte, aún sin publicar (preparado el 03/11/2026 para la noche del 04/11).** Difiere del vivo de Q'Taco en: número, WABA y rutas de entrada y de carrito propias (marcadores `*_3727`), credenciales propias (`Graph WhatsApp QTaco 3727 (Bearer)`, `WhatsApp QTaco 3727 (envio)`, ingesta del alias `cliente11`), envío directo por Graph (no relé) y `plantillasPedidoLineas` ACTIVAS desde el 06/11/2026 (l2/l4/l6 aprobadas en su WABA, es, UTILITY; 0 mensajes por conversación agregados o quitados); un solo destinatario de aviso (`completo:`, el aviso de cocina NO se manda, decisión de Andres: en esto ya no difiere del vivo) (el aviso de pedido sale por la plantilla de líneas del menor tamaño; `pedido_registrado` queda de respaldo y para reserva y derivación). Por qué: el número definitivo es el 3727 y el vivo (…2120) se reemplaza por una redirección. Lo cierra: la baja del vivo y la unificación del origen en un solo flujo de Q'Taco. Runbook: `NOVUCHAT_qtaco-3727-runbook-publicacion_2026-11-04.md`. 0 mensajes por conversación agregados o quitados. **PR-4a (04/11/2026), VERSIONADO ADELANTADO, sin publicar:** el estado de la conversación, los pedidos del teléfono y los mensajes vistos pasan de la memoria de n8n al servidor (`sesion` de `configuracionFlujo`, espacio `venta-minima`); +9 nodos (69; tope 60 → 69, aprobado por Andres el 04/11/2026). Mientras no se publique, `estado-de-versiones.sh` lo verá atrasado y es correcto. Condiciones de Clínicas (dueña de venta-minima/Q'Taco): no publicar hasta el «sí» de Andres, suites verdes, 0 mensajes por conversación. Orden de publicación: la Function `configuracionFlujo` con la rama `sesion` en producción, ensayo en el Demo A, y recién entonces el flujo. Ver «Estado al 04/11/2026 (PR-4a)» más abajo. **PR-4b (05/11/2026), VERSIONADO ADELANTADO, sin publicar:** los cupos de aviso (`av.dia`, `transferencias`, `avisosPedido`) pasan al servidor y `reservasDelDia` al bloque del teléfono; +2 nodos (71; **tope 69 → 71 aprobado por Andres (06/11/2026, en conversación)**). Ver «Estado al 05/11/2026 (PR-4b)». **miniCRM (06/11/2026, sin publicar): +8 nodos (71 → 79), dato `crm`, credencial `Google Sheets miniCRM (crm-qtaco)`.** |
| Rubén (venta digital, tenant `rroca-ruben`) | `.env.rroca-ruben` | `Flujos/experimental/rroca-ruben/rroca-ruben.json` | Al día: publicado el 23/10/2026 16:16 La Paz desde `main` `ed616dcd` (Entrega 2, #618), 45 nodos, abierto al público con `telefonosDePrueba` vacío, con el «Publicar ya» de Andres (fuera de la ventana, autorizado). Relectura: el vivo coincide con el origen. Respaldo del vivo previo (#600) guardado fuera del repo, modo 600. **Excepción (02/11/2026):** al fusionar el PR de «ubicación con enlace de Maps» el vivo queda atrás de `main` (lógica de ubicación en `rr.js`, `Config del negocio`, `Armar avisos` y `Armar mensajes`, sin nodos nuevos) hasta el ensayo y la publicación que autorice Andres por botón. **EXCEPCIÓN FORMAL (04/11/2026, PR-1 de «Noches Sin Insomnio»):** el flujo versionado `rroca-ruben.json` se REEMPLAZÓ por uno nuevo (producto «Noches Sin Insomnio»: catálogo de 4 productos y el paso del Libro al Pack, crisis, sin ubicación; 64 nodos en producción y 59 en prueba, tope 64, forma del flujo de Antonio), así que el flujo VIVO (el del libro «IA para Emprendedores», 63 nodos) difiere del versionado en casi todo: nodos, textos, prompt, catálogo y prellenados. **Por qué:** Rubén cambió de producto; el vivo sigue atendiendo hasta que se publique el nuevo, que no se publica con marcadores `REEMPLAZAR_*` ni con las plantillas de aviso sin aprobar (guardia `construir.mjs --publicable --anuncios <N>`). Mensajes por conversación: 0 agregados al cliente. **Lo cierra:** la publicación del flujo nuevo, después del PR-2, el seco contra el vivo, el ensayo en el Demo A y el botón de Andres; mientras tanto `estado-de-versiones.sh` lo mostrará atrasado y es correcto. Vence el 31/01/2027. |
| Rubén, rescate de las 22 h (tenant `rroca-ruben`, flujo aparte) | Sin entorno todavía: no está publicado | `Flujos/experimental/rescate-22h/rescate-22h.rroca-ruben.json` | **Sin publicar** (13 nodos, `REEMPLAZAR_*` en `Config base`; `construir.mjs --publicable` sale 1 hasta sustituirlos). Por qué: depende de `reclamarRescates` (PR #566, sin desplegar) y de ensayo real con la lista de prueba; no es un atraso sino un flujo que aún no existe en vivo. Costo al publicar: +1 mensaje por conversación sin compra a las 22 h; 0 en el flujo de atención. |
| Demo B (venta y cobro) | `.env.demo-b` | `Flujos/demo-b-venta-cobro.json` | **Visión de imágenes (22/10/2026, PR `core/medios-imagen-descripcion`):** atrasado frente al JSON en 1 nodo, `Preparar imagen` (categorías `foto`, `captura_de_pantalla`, `pago_con_problema` y la descripción de lo que se ve). Su conducta cambia SOLO con variantes de la categoría (mayúsculas, espacios, guiones) y porque `foto` o `captura_de_pantalla` ya no llevan el `texto` leído (el clasificador de este flujo sigue devolviendo «otro» y `Filtrar categoría` lo reduce). Por qué: el código común llega a todos, pero se adopta con el prompt nuevo del clasificador, que es de cada cliente. Lo cierra: la adopción de la visión en el prompt del clasificador. |
| Chat NovuChat v2 (captación) | `.env.novuchat` | `Flujos/experimental/chat-novuchat/chat-novuchat.novuchat.json` | **Versionado ADELANTADO al vivo por el PR-B del miniCRM (30/10/2026), sin publicar.** Los nodos «Prospecto para la planilla» y «Decidir fila de la planilla» ahora se incluyen del módulo `Flujos/src/modulos/crm/` (mapa de columnas como dato) y «Buscar teléfono» pasa de `returnFirstMatch: true` (fila más antigua) a `false` con selección de la fila más reciente. Por qué: regla de Andres (se actualiza la fila más reciente del teléfono) y un solo código para todos los clientes. Además: los encabezados A..J de la fila 3 se comparan ahora letra por letra y en orden (antes bastaba que existieran), y el módulo respeta `config/crm.activo === false`, que NO se puede activar hasta el PR-B3 (`configuracionFlujo` aún no devuelve `config/crm`). Lo cierra: el ensayo (confirmar con la hoja real que n8n entrega las claves en el orden de la hoja) y la publicación con el «sí» de Andres; hasta entonces `estado-de-versiones.sh` lo verá «atrasado, CON excepción declarada». **Aviso en el genérico de falla (05/11/2026, `core/chat-aviso-generico`), sin publicar:** el genérico con botón por falla del compromiso o sin estado lleva ahora el aviso a recepción como un ítem más (política del 21/09/2026), a lo más uno por hora y por teléfono, no en la variante de prueba. 0 mensajes por conversación al cliente; costo declarado: +1 plantilla a recepción por teléfono y por hora cuando hay falla. El tope «a lo más uno por hora» es BLANDO: el `staticData` de n8n se carga al empezar y se guarda al terminar (gana la última escritura), así que en una ráfaga con el servidor caído varias ejecuciones pueden avisar; no hay tope global entre teléfonos (máx. 500 teléfonos con marca). |
| Captación mínima (`NovuChat`, sin publicar) | — | `Flujos/experimental/captacion-minima/captacion-minima.novuchat.json` | **Versionado ADELANTADO, sin publicar** (PR-B2 del miniCRM, 31/10/2026): no hay flujo vivo que comparar (la fila no lleva `--env` a propósito, `estado-de-versiones.sh` la omite). «Prospecto para la planilla» y «Decidir fila de la planilla» se incluyen del módulo `Flujos/src/modulos/crm/` (mapa de columnas como dato del tenant) en vez de dos copias; «Buscar teléfono» pasa a `returnFirstMatch: false` y se actualiza la fila más reciente; `seguro` estricto (L2); encabezados A..J comparados letra por letra; `config/crm.activo === false` aún no se puede activar (PR-B3). Por qué: un solo código del miniCRM para todos los clientes y la regla de Andres de la fila más reciente. Lo cierra: ensayo con la hoja real y la publicación con el «sí» de Andres. 0 mensajes por conversación agregados o quitados. |
| Demo A (recordatorios) | `.env.recordatorios` | `Flujos/demo-a-recordatorios.json` | — |
| Antonio («Método Puente», tenant `rroca-antonio`; vivo con #602, 48 nodos; el rehecho de Ventas digitales está en revisión, sin publicar) | `.env.rroca-antonio` | `Flujos/experimental/rroca-antonio/rroca-antonio.json` | EXCEPCIÓN FORMAL de la falla abierta de la pausa. Id rroca-pausa-falla-abierta; declarada el 19/10/2026, vence en 90 días (17/01/2027). Si vence sin cerrarse (tocar la puerta común o agregar un nodo que lea la pausa por otra vía) o sin renovarse con una decisión escrita de Cartera, es un defecto, no una excepción. Alcance: si la ingesta y la consola caen en el MISMO turno no hay estado de atención y la puerta devuelve «normal», así que una persona en pausa recibiría el saludo; puerta-del-turno.js es idéntica al origen común y no se toca. Ampliada a rroca-antonio por Principal el 20/10/2026; el cierre es el PR común de Core (a cargo de Rearquitectura). No reinicia el vencimiento. **Además, visión de imágenes (22/10/2026):** `Preparar imagen` nuevo (descripción de lo que se ve) en el JSON versionado; su conducta cambia SOLO si el clasificador devuelve variantes de la categoría (mayúsculas, espacios o guiones: «Comprobante » con seña vencida antes iba a `otro` y ahora fuerza la transferencia) y `foto` o `captura_de_pantalla` ya no llevan el `texto` leído; se publicará por Cartera 2 con ensayo, al adoptar el prompt nuevo. |

> **Excepción a «pasar con recepción = aviso + botón» (Andres, 06/11/2026, PR de Bellido «aviso de salud cada 24 h»).** En Agenda mínima, la consulta de salud avisa a recepción como máximo una vez por teléfono cada 24 h; los mensajes siguientes reciben solo el botón. La hora del último aviso vive en `avisosSalud` del estado global y se guarda al armar el aviso, no al confirmar Meta el envío: si ese envío falla, ese teléfono queda 24 h sin aviso (conserva el botón). No se guarda en modo prueba. Se publica con el resto de los ajustes, no antes de comprobar la versión viva.
> **Atraso de Bellido: `Preparar imagen` nuevo (23/10/2026).** `Flujos/experimental/agenda-minima/agenda-minima.v0.json` y `agenda-minima.prueba.json` (regenerados con `construir.mjs`; cambia solo el código de «Preparar imagen») llevan el módulo nuevo: categorías foto, captura y pago_con_problema, descripción saneada y el comparador de anuncios (`anuncio-por-titular.js`), inerte mientras `cfgNeg.anuncios` no exista (Agenda mínima no lo recibe). El flujo VIVO de Bellido corre el módulo anterior: se alinea publicando con el «sí» de Andres y el ensayo de Cartera/Constructora. Este PR (#619) NO publica nada. **Cerrado el 24/10/2026:** el vivo de Bellido ya lleva este módulo (publicado con #640).

> **Visión de imágenes (22/10/2026).** `Flujos/bellido-agendamiento.json` conserva el `Preparar imagen` anterior (sin descripción de lo que se ve): Andres ordenó no tocarlo ni publicarlo; figura en `EXCEPCIONES` de `capacidades-comunes.test.ts`. `Flujos/novuchat-onboarding.json` se regeneró con el módulo nuevo. Atrasados frente al módulo común hasta que se adopte la visión en cada cliente; su conducta cambia SOLO si el clasificador devuelve variantes de la categoría (mayúsculas, espacios o guiones: «Comprobante » con seña vencida antes iba a `otro` y ahora fuerza la transferencia) y `foto` o `captura_de_pantalla` ya no llevan el `texto` leído.

> El guion `—` significa **sin excepción**: ese flujo tiene que estar al día con
> su JSON versionado, y el script falla si no lo está.

> **Estado al 10/10/2026 (dos filas actualizadas).**
> - **Q'Taco** corre «Venta mínima v0» (flujo propio, 50 nodos), origen `main`
>   `e44da19d` (con #473, el enlace de Maps cuando piden la dirección del
>   local), publicado el 09/10/2026 a las 23:50 (La Paz) con `publicar-flujo.sh`;
>   abrió al público el 08/10. Antes la fila decía «en construcción»; la
>   única diferencia con la preparación estándar es de datos (ver su fila).
> - **Chat NovuChat v2** reemplaza a la fila «NovuChat (captación)»: el chat
>   interno de NovuChat ya no corre `novuchat-onboarding.json`
>   sino un flujo propio de 44 nodos, `Flujos/experimental/chat-novuchat/`
>   (#476, `main` `310deb10`), publicado el 10/10/2026 por la sesión «Novuchat
>   chat» con relectura OK (activo, retención none/all, Meta 4/4). Es un tipo
>   propio, sin base común unificada todavía (los huecos están declarados en su
>   `PROPIO.md`). La excepción de F3a de la fila vieja deja de aplicar a este
>   flujo; `novuchat-onboarding.json` queda como histórico sin fila.

## Estado al 28/09/2026 (medios entrantes en el Demo B y la captación)

Primer paso general de «audio e imagen son capacidades de todos los flujos»
(Andres, 25/09 y 28/09; `Flujos/LEEME-flujos.md` §0.d). Las filas **Demo B
(venta y cobro)** y **NovuChat (captación)** reciben la rama de medios de
reservas, con los mismos módulos `Preparar transcripción` y `Preparar imagen`.
**Siguen sin excepción (`—`):** la nota va acá y no en la columna, porque
`estado-de-versiones.sh` toma cualquier texto de esa columna por una excepción
declarada. Consecuencia: desde que el PR se fusione y hasta que los dos se
publiquen (con el OK de Andres, diagnóstico en seco y prueba con teléfono:
audio, foto de producto, PDF y foto sin contexto), el script los va a marcar
**atrasados sin declarar**, y es correcto que lo haga. `capacidades-comunes.test.ts`
exige desde ahora la rama en todo flujo conversacional. Cero mensajes por
conversación.

## Estado al 01/10/2026 (Bellido corre el piloto «Agenda mínima v0»)

El 30/09 Andres hizo un concurso entre dos candidatos para Bellido: el flujo
actual con todos los ajustes del doctor (A) y la «Agenda mínima» de la
constructora (B). Decidió B. Se publicó el 01/10 a la 01:24 sobre el flujo de
Bellido con `herramientas/flujo-de-prueba.mjs --sobre-bellido` (45 nodos, `f3f7411`,
PR #293, fusionado después). Después, el PR #354 (`e3d4af9`, fusionado en main) corrigió un
defecto de `cnAtencion` y se publicó en el flujo vivo: Bellido corre ahora
`agenda-minima.v0.json` de `e3d4af9` (45 nodos, activo). Ese cambio es solo código de
nodos (se actualizaron los 11 nodos Code que pegan `_comun.js`); la prueba real con
teléfono está pendiente. **El flujo A se descartó el 01/10 por decisión de Andres,
y el plan ante una falla de B es corregir B, no volver a A ni al flujo anterior (el
respaldo de los 96 nodos no es plan del piloto):** el #286 está cerrado sin fusionar y la rama
`cartera/bellido-doctor-29-09` se borró de origin (queda solo un commit local de la
cartera). Sus defectos conocidos (reagendar, que cancelaba la cita vieja antes de confirmar
la nueva, y un «sí» de más tras el nombre) **quedaron superados por B**, con la evidencia del
arnés de la sesión Principal; ver `CLIENTES/BELLIDO/aceptacion.md` (sección 7). El Demo A volvió a su flujo original de 77 nodos, así que el ensayo
apunta otra vez al flujo de siempre. El Demo A sigue atrasado en
«Procesar respuesta» (el #284), declarado en el PR #289 (fusionado). Cero mensajes por
conversación en este registro: es documentación.

## Estado al 29/09/2026 (Bellido: dos arreglos de protección, publicados)

`main` (`572b793`) trae dos arreglos de reservas para los tres flujos, motivados
por la prueba real de Bellido del 28/09: #267 (la hora que pide es la de su
propia cita, se le dice) y #275 (reagendar no borra la cita en silencio:
`servicio` y `funcionario` opcionales, aviso a recepción si el modelo falla tras
confirmar una cancelación, pendiente de cancelar de un solo uso). Se publicaron
el 29/09 con el «sí» de Andres: Bellido a las 13:39 y Platinum y el Demo A a
las 13:40, desde `main`; el seco mostró solo esos 7 nodos de diferencia, ningún
cambio de prompt, y después de aplicar dio 0 en los tres. Cero mensajes por conversación.

A las 20:30 del mismo día se publicó el #283 (`main` `3790e4d`) en los tres flujos: seco de
3 nodos de código, 0 diferencias después de aplicar y `estado-de-versiones.sh` sin atrasos
sin declarar. Cero mensajes por conversación.

## Estado al 27/09/2026 (hotfix de protección de reservas)

Los tres flujos de reservas reciben el mismo cambio —módulos compartidos más el
reintento con `returnIntermediateSteps`—: H1, H2 y M1 de la fila de Bellido.
En Bellido entra como **hotfix de protección** (la excepción lo permite y lo
exige anotado) y además con las mejoras que Andres adelantó el 27/09; la
excepción no se borra. Queda pendiente su publicación con diagnóstico en seco,
ensayo en el Demo A y prueba con teléfono real insistiendo sobre una hora
ocupada (regla del candado). M2 (reagendar sin cancelar primero) NO entra acá:
va en un bloque aparte.

## Estado al 26/09/2026 (reorientación después de H1)

Primera excepción desde la del Demo B: **Bellido**, declarada antes de que su
flujo se atrase, para que el atraso que traiga la obra (F2 a F3b) nunca sea un
defecto sin fila. Mientras su JSON versionado no cambie,
`estado-de-versiones.sh` lo verá al día e informará «excepción declarada pero
el flujo está al día»: es lo esperado, no se borra la fila hasta la
re-aceptación tras F3b. Los otros siete siguen sin excepción.

## Estado al 26/09/2026 (madrugada)

Los tres flujos de reservas se volvieron a publicar desde `e02a756` con #196
(duplicadas por título y hora) y #197 (se cancela la cita que se mostró), los
dos verificados en el Demo A antes de entrar. Ninguna excepción: 8 de 8 al día.

## Estado al 25/09/2026 (noche)

Publicados desde `origin/main` (`0655cd3`) con el diagnóstico en seco leído
entero: **Demo A** (hotfix #186 y origen del anuncio #188: cinco nodos), **Demo B**
(#188 y el comprobante en simulado #192: dos nodos) y **captación** (#187 y #188:
tres nodos). Todas las credenciales heredadas del flujo vivo, ninguna corregida.
**Platinum y Bellido** se publicaron después, el 26/09 a la madrugada, fuera de
la ventana por decisión de Andres: ningún comercio está en modalidad
producción, así que la ventana no condiciona. Antes, Andres verificó el hotfix
en el Demo A con teléfono real (ejecuciones #6041 a #6098, ver `ESTADO.md`).
Los ocho flujos quedan al día con su JSON versionado.

## Estado al 24/09/2026

Los tres flujos de reservas —Demo A, Platinum y Bellido— se publicaron el 24/09
con el arreglo del día de la semana (PR #170) y las dos protecciones del PR
#171 (la ventana del calendario y el audio). Ninguno tiene excepción declarada:
los tres deben seguir el vertical.

**La excepción del Demo B quedó cerrada el 25/09.** Era un orden de
despliegue, no un paquete: el flujo con el cobro por QR (`7988cdf`, #165)
necesitaba Functions que no estaban en ninguna etiqueta. Se desplegó `v0.8.0`
(`70eff23`, verificada: Functions nuevas, públicas, corte apagado, sin errores)
y después se publicó el flujo desde `origin/main`, con el diagnóstico en seco
leído entero y las siete credenciales por tipo revisadas. `estado-de-versiones.sh`:
8 de 8 al día.

Ningún comercio está en modalidad `produccion` todavía, así que la
[ventana de mantenimiento de 23:30 a 01:30](contrato/anexo-tecnico-sla.md) no
condiciona cuándo se publica.

## Estado al 29/10/2026 (guardado de medios, PR #699): excepción declarada al tope de nodos

La rama común del **guardado de medios** (`Flujos/experimental/comun-sin-agente/src/guardado.mjs`, contrato M1↔M2 del 29/10/2026) agrega **11 nodos** a cada flujo con medios. **Andres la aprobó el 29/10/2026 como excepción declarada a la regla del tope de nodos del 03/10/2026** («máximo 50» de Q'Taco, «48 es el tope duro» de Rubén). La nota va acá y no en la columna de la tabla: esa columna es para los atrasos, y un texto ahí haría que `estado-de-versiones.sh` tomara por declarado un atraso real.

- **Q'Taco** (`venta-minima.qtaco.json`): 50 → **61** nodos y tope 50 → 61. **Por qué:** guardado de medios, +11 nodos. **Aprobado por:** Andres, el 29/10/2026.
- **Rubén** (`rroca-ruben.json`): 46 → **57** nodos y tope «duro» 48 → 59. **Por qué:** guardado de medios, +11 nodos. **Aprobado por:** Andres, el 29/10/2026.
- **Bellido** (`agenda-minima.v0.json`, sin tope en su constructor): 53 → **64** nodos. **Por qué:** guardado de medios, +11 nodos. **Aprobado por:** Andres, el 29/10/2026. Se publica el último.
- **Mismo motivo y misma fecha, +11 cada uno:**
  - Evy y Emma: 36 → 47, tope 36 → 47.
  - doctoras: 43 → 54, tope 48 → 59.
  - Antonio: 47 → 58, tope 47 → 58.
  - Chat NovuChat: 44 → 55.
  - captacion-minima: 43 → 54.

**Lo cierra:** nada; la excepción es permanente mientras la rama tenga 11 nodos. Una alternativa de 7 a 8 nodos quedó propuesta en el PR para que Andres la decida. Cada flujo se publica aparte, con su botón; hasta que se publiquen, `estado-de-versiones.sh` los mostrará atrasados, y es correcto que lo haga.

## Estado al 04/11/2026 (PR-4a): Q'Taco adopta el estado de la conversación y los vistos en el servidor

**Qué cambia.** El código de `venta-minima` es común a todas sus salidas, así que se regeneran **todas** con `construir.mjs` (ninguna se publica con este PR):

| Salida | Nodos antes → después | Quién la usa |
|---|---|---|
| `venta-minima.qtaco-3727.json` | 60 → **69** | Q'Taco, número definitivo (flujo nuevo, sin publicar) |
| `venta-minima.qtaco.json` | 60 → **69** | Q'Taco vivo (…2120), hoy redirección |
| `venta-minima.prueba.json` | 56 → **65** | variante de prueba (espacio `venta-minima-prueba`, solo `telefonosDePrueba`) |
| `venta-minima.ensayo-demo-a.json` | 54 → **63** | ensayo en el Demo A |

- **Nodos nuevos (9):** `¿Hay estado?`, `Sin estado`, `¿Comprometer turno?`, `Comprometer turno`, `¿Replanificar compromiso?`, `Comprometer turno (2.º intento)`, `Soltar mensajes`, `Confirmar envío`, `Comprometer compensación`. Tope 69 agotado (0 de margen).
- **Tope de nodos de Q'Taco: 60 → 69** (`TOPE_DE_NODOS` de `construir.mjs`; queda 0 de margen). **Aprobado por Andres el 04/11/2026.**
- **Lo que se mueve al servidor:** `estados[tel]` (bloque opaco con `venceEnMin` 60, 1440 en `esperando_comprobante`, 4320 si el bloque trae pedidos), `vistos[idMensaje]` (los marca el mismo `leer`) y los `pedidos` DEL teléfono (dentro del bloque, 72 h, recorte por bytes al tope de 15.000).
- **Lo que SIGUE en `staticData` (residuo declarado; lo mueve PR-4b, ver la sección siguiente):** `av.dia`, `transferencias`, `avisosPedido`, `reservasDelDia` y `av.ventana` (estado del comercio, contrato §10.4). El tope de reservas por día y los topes de avisos por hora/día no cambian.
- **Mensajes por conversación: 0 agregados o quitados.** Un mensaje por turno; las fallas (compromiso con 5xx, bloque que no cabe, sin estado) REEMPLAZAN la respuesta por el genérico con el botón a recepción. Una ráfaga: sin hecho externo la ejecución que pierde el compromiso cede (no envía); con un aviso ya enviado se replanifica y responde. La suite lo prueba con la misma conversación, antes y después.
- **Lectura de respaldo TEMPORAL de la memoria vieja:** al publicar, un teléfono sin nada en el servidor (versión 0) y con estado vigente en la memoria de n8n retoma de ahí y se migra al comprometer (luego se borra de la memoria vieja). **Retiro: 30/11/2026 00:00 La Paz** (`VM_RESPALDO_HASTA_MS` en `comun.js`): pasada la fecha el código ni la mira y la primera ejecución borra los tres mapas viejos; después se quita el código. Probada negando en `venta-minima-sesion.test.ts`.
- **Costo de «pasar con recepción» (I2, ronda 3):** con el panel caído o sin estado, +1 aviso de transferencia por destinatario, por teléfono y por hora (`topeTransferenciasHora`); y el mismo aviso acompaña al genérico de una falla del compromiso SIN hecho externo. Los mensajes al cliente no cambian (uno por turno).
- **Condiciones de Clínicas** (aceptadas): no publicar nada con este PR; suites de `venta-minima` y de la redirección `Flujos/clientes/qtaco-redireccion` en verde; 0 mensajes por conversación.
- **Diferencia de comportamiento con el panel caído (declarada):** el `leer` de la sesión viaja en la MISMA llamada que el panel, así que con el panel caído tampoco hay estado y sale «pasar con recepción» (aviso estándar de transferencia dentro de `topeTransferenciasHora` MÁS el botón; política del 21/09/2026). Antes, con la carta de respaldo, el flujo seguía y derivaba solo lo que pedía delivery o confirmaba un pedido.
- **Avisos al local antes del compromiso (declarado):** el contrato §6 pide comprometer antes de `¿Hay avisos?`; aquí se compromete DESPUÉS de los avisos y ANTES de enviar al cliente, porque el estado depende de si el QR se arma (`Armar mensajes`). Un compromiso que falla deja un aviso ya enviado y el genérico al cliente; el turno siguiente no repite ese aviso (marca por `tipo:pedidoId`). Se decide con Andres en PR-4b.

## Estado al 06/11/2026: imagen del anuncio de las campañas de Q'Taco (tope de nodos 71 a 73)

**Tope de nodos de 71 a 73: aprobado por Andres (06/11/2026).** Dos nodos nuevos, sin mensajes: `¿Es comprobante?` (IF) y `Clasificar imagen` (Gemini, ~0,0001 USD por imagen sin comprobante pendiente). 0 mensajes por conversación agregados (la respuesta de campaña reemplaza al saludo). Excepción declarada: el cambio llega a las cuatro salidas generadas de venta mínima (el nodo es común) y no cambia a doctoras, Emma ni Evy.

| Salida | Nodos antes → después |
|---|---|
| `venta-minima.qtaco-3727.json` | 71 → **73** |
| `venta-minima.qtaco.json` | 71 → **73** |
| `venta-minima.prueba.json` | 67 → **69** |
| `venta-minima.ensayo-demo-a.json` | 65 → **67** |

**Avisos extra declarados (C-09):** un texto o pie de foto con una pregunta ajena a la promo envía ≈1 aviso de transferencia al local por mensaje de campaña (sujeto al límite por hora del cupo `transferencias`). Fuera del jueves, la pregunta del pie de foto en la campaña B se pierde (solo se dice que la promo es los jueves).

Ver `Flujos/experimental/venta-minima/DISENO.md`, «Adenda de campañas de Q'Taco» (C-01, C-04, C-07, C-08, C-09, C-12, C-13, C-17). Queda sin publicar (la publica la sesión que corresponda con el «sí» de Andres); los `titulares` de las campañas A y B ("Tortas Mexicanas", "Mañanas Tortas Mexicanas"; "Jueves de +2") deben estar cargados y aprobados en `config/campanas` para el reconocimiento por titular (la letra `campana` del clasificador funciona sin ellos).

## Estado al 05/11/2026 (PR-4b): los cupos de aviso de Q'Taco pasan al servidor

**Tope de nodos de 69 a 71: aprobado por Andres (06/11/2026, en conversación).** Condición de Andres: los dos nodos nuevos (`Consumir cupos`, HTTP; `¿Cupo concedido?`, IF; cuelgan de la rama de avisos al local) NO agregan ni alteran mensajes, botones ni textos al cliente; lo demuestra `admin/pruebas/venta-minima-cupos.test.ts`, «tope de 71 nodos» (misma secuencia con y sin el servidor de cupos, y el borde de cupo agotado: el cliente lee «No pude pasarle…» y no «pasé tu pedido»). **Limitación conocida, no defecto nuevo:** una ráfaga de 3 mensajes seguidos del cliente da 2 respuestas (reproducida 2 veces en el ensayo); es del comportamiento por turno que ya existía, no de estos nodos. Se regeneran **todas** las salidas de `venta-minima` con `construir.mjs`; ninguna se publica con este PR:

| Salida | Nodos antes → después | Quién la usa |
|---|---|---|
| `venta-minima.qtaco-3727.json` | 69 → **71** | Q'Taco, número definitivo (flujo nuevo, sin publicar) |
| `venta-minima.qtaco.json` | 69 → **71** | Q'Taco vivo (…2120), hoy redirección |
| `venta-minima.prueba.json` | 65 → **67** | variante de prueba (cupos en `vmcp-<ejecución>`, solo `telefonosDePrueba`) |
| `venta-minima.ensayo-demo-a.json` | 63 → **65** | ensayo en el Demo A |

- **Nodos nuevos (2):** `Consumir cupos` (HTTP a `configuracionFlujo`, `executeOnce`, `retryOnFail` con `maxTries` 2, sin `neverError`) y `¿Cupo concedido?` (IF), ambos colgando de la salida verdadera de `¿Hay avisos?`, con `Consumir cupos` más arriba en el lienzo (corre primero con `executionOrder: v1`). El `asentar` NO lleva nodo: es un segundo ítem de `Confirmar envío` hacia `Comprometer compensación`.
- **Qué se mueve al servidor:** `av.dia` (contador diario de avisos, cupo `avisos` del comercio por día), `transferencias` (cupo por teléfono y hora) y `avisosPedido` (cupo `pedidos` por teléfono y hora). El tope viaja en el cuerpo con techo de servidor de 1000 (**ningún cupo es límite comercial**, D-7 opción A, Andres 29/10/2026; un límite comercial futuro se lee de `cuenta/estado.limites`, nunca del cuerpo). `reservasDelDia` pasa al bloque del teléfono (`reservas: {dia, n}`, Andres 04/11/2026), no como cupo.
- **Lo que SIGUE en `staticData`:** `av.ventana` (estado del comercio, contrato §10.4) y `avisosHuerfanos` (ahora por `teléfono|clave`); `av.dia`, `transferencias` y `avisosPedido` solo como **tope local de caída** (cuando `Consumir cupos` falla) y para el aviso del genérico.
- **Mensajes por conversación: 0 agregados o quitados** (la suite lo mide: [1, 1, 1, 1, 1]). Con el cupo agotado el cliente recibe exactamente 1 mensaje (la frase honesta con «Escribir al local»).
- **Cambios de comportamiento declarados:** (a) **fail-open:** si `Consumir cupos` responde 5xx o no contesta, el aviso sale igual y se aplica el tope LOCAL de caída; solo `cupo_negado` impide los avisos (política del 21/09/2026: nunca silencio). (b) **Todo o nada:** en el borde del día un aviso de varios mensajes se niega completo (antes salía parcial). (c) Las horas del cupo son horas de calendario de La Paz (no una ventana móvil de 60 minutos). (d) `asentar` devuelve el cupo solo si ningún mensaje fue aceptado por Meta; si aceptó alguno, queda consumido; un 5xx del `asentar` lo deja consumido. (e) Si `Soltar mensajes` cede por conflicto sin hecho externo, `Confirmar envío` no corre: con el consumo ok y los avisos fallidos el cupo queda consumido (conservador). (f) El aviso del genérico por falla del compromiso sin hecho externo conserva su marca local de hora. (g) Al publicar, el contador local del día y las marcas por hora de la memoria vieja no pasan al servidor: ese día puede avisarse hasta el doble del tope, una sola vez.
- **Condiciones:** no publicar nada con este PR; la Function `configuracionFlujo` ya acepta cupos y `asentar` (PR-2b); orden de publicación igual que PR-4a (Function, ensayo en el Demo A, flujo).

## Estado al 06/11/2026: el miniCRM de Q'Taco 3727 (módulo `crm`), sin publicar

**Tope de nodos de 71 a 81: aprobado por Andres (D2, 06/11/2026).** 81 = 69 + 2 (cupos, PR-4b) + 2 (la imagen de las campañas, otra rama) + **8 (miniCRM)**. Con la integración (PR de reemplazo de #828-#831) el 3727 queda en **81** nodos = `TOPE_DE_NODOS`, **sin margen**; el resto de las salidas queda en 73 (qtaco), 69 (prueba) y 67 (ensayo). Antes: quien fusione último reconcilia el número con los 2 nodos de la imagen. **Decisión D1 = opción (b):** SIN ampliar el contrato de columnas del core (usa Clasificación N, Qué pidió O, Resumen I, Derivación, Última interacción y «Se cierra la ventana de 24 h»).

| Salida | Nodos antes → después | Qué cambia |
|---|---|---|
| `venta-minima.qtaco-3727.json` | 73 → **81** (tope, sin margen) | los 8 nodos de `ramaCrm()` (Prospecto para la planilla, Buscar teléfono, Leer IDs, Leer encabezados, Decidir fila, ¿Acción?, Agregar fila, Actualizar fila), el dato `crm`, la credencial `Google Sheets miniCRM (crm-qtaco)` y los marcadores `planillaProspectosId/Hoja` |
| `venta-minima.qtaco.json`, `.prueba.json`, `.ensayo-demo-a.json` | sin cambio | **solo cambia el código de «Armar mensajes»** (la librería `src/lib/crm.js` se pega ahí; y «Config del negocio» deja `planillaProspectosId/Hoja` vacíos). **Sin el dato `crm` no hay un solo nodo de planilla ni se calcula nada**: el vivo y la redirección #788 no llevan miniCRM. |

- **Mensajes por conversación: 0 agregados o quitados.** Ningún nodo nuevo envía a Meta (`construir.mjs --verificar` lo vigila); la suite `venta-minima-crm.test.ts` demuestra que la secuencia de mensajes y avisos es idéntica con la planilla, sin la rama, con Google caído y con `vmProspectoCrm` lanzando.
- **Posición (`executionOrder: v1`):** la rama cuelga de «Armar mensajes», debajo del envío y del cierre (primer nodo en y=700) y encima de «Resumen del turno», que sigue siendo lo más bajo de lo que cuelga de «Armar mensajes». El cliente recibe su mensaje antes de que se toque Google.
- **El id de la hoja** vive solo en la tabla local (`REEMPLAZAR_PLANILLA_PROSPECTOS_ID_QTACO_3727` en el repositorio); con el marcador, «Config del negocio» lo vacía y el flujo ni calcula ni consulta nada. **Los correos que ven la hoja** (D3) los dará Andres después.
- **Condiciones:** no publicar con este PR; falta crear la hoja, la cuenta de servicio `crm-qtaco` y la credencial en n8n (diseño `NOVUCHAT_qtaco-minicrm-diseno_2026-11-04.md` §4), ensayo en el Demo A con hoja de prueba y después `publicar-flujo.sh`.

## Estado al 30/10/2026 (guardado de medios v2, «guardar y descargar TODO»): la rama baja a 9 nodos y nadie guarda ejecuciones

El contrato v2 (30/10/2026) quita «¿Anotar medio?» y «Anotar medio»: todo medio (imagen, audio, video, documento de cualquier tipo, sticker) se guarda por el camino normal. La rama queda en **9 nodos** y la excepción del 29/10 (**Andres, 29/10/2026**) se mantiene con 2 nodos menos en cada flujo:

- **Q'Taco** (`venta-minima.qtaco.json`): 61 → **59** nodos y tope 61 → 59.
- **Q'Taco** (`venta-minima.qtaco.json`): 59 → **60** nodos y tope 59 → 60. Por qué: «Guardar comprobante» (guardar el comprobante antes de leerlo, PR #688), +1 nodo. Aprobado por: **Andres, 03/11/2026**.
- **Q'Taco** (`venta-minima.qtaco.json`): mismos 60 nodos. Dato `plantillasPedidoLineas` **vacío** en este flujo vivo (…2120, hoy redirección). **Activas desde el 06/11/2026 en Q'Taco 3727** (`venta-minima.qtaco-3727.json`, `pedido_registrado_l2/_l4/_l6` APROBADAS en su WABA, es, UTILITY, confirmado por WAM). 0 mensajes por conversación agregados o quitados.
- **Rubén** (`rroca-ruben.json`): 57 → **55** nodos y tope 59 → 57.
- **Bellido** (`agenda-minima.v0.json`, sin tope en su constructor): 64 → **62** nodos. Se publica el último.
- Evy y Emma: 47 → **45**, tope 47 → 45. doctoras: 54 → **52**, tope 59 → 57. Antonio: 58 → **56**, tope 58 → 56. Chat NovuChat: 55 → **53**. captacion-minima: 54 → **52**.

**Retención de ejecuciones (decisión de Andres del 30/10/2026, contrato v2 §8.1):** con la rama, el binario del medio quedaría en los datos de la ejecución de n8n; TODO flujo con la rama lleva `saveDataSuccessExecution` y `saveDataErrorExecution` «none» y `saveExecutionProgress` false (lo pone `injertarGuardado` y lo exige `hallazgosDelGuardado`). **Dejan de guardar ejecuciones** los que guardaban: Rubén, Antonio, Chat NovuChat y captacion-minima (guardaban las fallidas), Q'Taco (guardaba todo, decisión del 04/10 que esta reemplaza) y Bellido (no lo fijaba: valía el de la instancia). Se pierde diagnóstico, por privacidad.

**Publicación:** Evy, Emma, Rubén y Antonio se republican UNA vez, después de la etiqueta del servidor v2 (M1b); Q'Taco, chat, captación y Bellido salen ya con esta versión. Hasta entonces `estado-de-versiones.sh` los mostrará atrasados, y es correcto. Walisuma (sin publicar; entró a main con la rama de 11 nodos y 58 nodos): pasa a **56** nodos, tope 58 → 56, y deja de guardar ejecuciones fallidas (`none`), como todos.

## Estado al 31/10/2026 (miniCRM, F1): excepción declarada al tope de nodos de Evy

La rama del miniCRM (`ramaCrm`, módulo `crm`) agrega **8 nodos** a cada flujo que la use. **Evy** (`rroca-evy.json`): 45 -> **53** nodos y tope 45 -> 53; variante de prueba: 40 -> **48**. **Por qué:** miniCRM de las subcuentas, F1; el módulo genera la rama (no se copia). **Aprobado por:** Andres, el 31/10/2026 (DP1). **Lo cierra:** nada; es permanente mientras la rama tenga 8 nodos. **Publicación:** aparte, con su botón; hasta entonces `estado-de-versiones.sh` lo mostrará atrasado, y es correcto. Mensajes por conversación: 0.

**Antonio (miniCRM, F4, 02/11/2026).** `rroca-antonio.json` 56 -> **64** nodos y tope 56 -> **64**; variante de prueba 51 -> **59**. **Por qué:** miniCRM de las subcuentas, F4; el módulo genera la rama (no se copia). **Aprobado por:** Andres (DP1, 31/10/2026; topes del 02/11/2026: Antonio 66 con el relé B9, que sube el PR del relé). **Lo cierra:** nada; es permanente mientras la rama tenga 8 nodos. **Publicación:** aparte, con su botón; hasta entonces `estado-de-versiones.sh` lo mostrará atrasado, y es correcto. Mensajes por conversación: 0.

**Rubén (miniCRM, F3, 02/11/2026).** `rroca-ruben.json` 55 -> **63** nodos y tope 57 -> **63**; variante de prueba 50 -> **58**. **Por qué:** miniCRM de las subcuentas, F3; el módulo genera la rama (no se copia). **Aprobado por:** Andres, el 02/11/2026 (botón: opción B, señal neutra `inicioCompra`, tope de Rubén 55 -> 63). El relé de envíos B9 (Clínicas, +2) ya tiene su aprobación (D1, 02/11/2026): con él el tope de Rubén llega a **65** (lo sube el PR del relé); topes aprobados por Andres para las subcuentas: Rubén 65, Antonio 66, Evy y Emma 55. **Lo cierra:** nada; es permanente mientras la rama tenga 8 nodos. **Publicación:** aparte, con su botón; hasta entonces `estado-de-versiones.sh` lo mostrará atrasado, y es correcto. Mensajes por conversación: 0. Los JSON de Evy, Emma, chat-novuchat y captación mínima cambian solo por el texto embebido de `crm.js` (la señal `inicioCompra`, que ninguno emite): sin cambio de comportamiento y sin publicar.

**Emma (miniCRM, F2, 02/11/2026).** Mismo texto de excepción que Evy: `rroca-emma.json` 45 -> **53** nodos y tope 45 -> 53; variante de prueba 40 -> **48**. **Por qué:** miniCRM de las subcuentas, F2; el módulo genera la rama (no se copia). **Aprobado por:** Andres, el 31/10/2026 (DP1). **Lo cierra:** nada; es permanente mientras la rama tenga 8 nodos. **Publicación:** aparte, con su botón; hasta entonces `estado-de-versiones.sh` lo mostrará atrasado, y es correcto. Mensajes por conversación: 0.

**Corrección de la comprobación de encabezados (02/11/2026, 0 mensajes por conversación).** En **Evy** (`rroca-evy.json` y variante de prueba, 53 y 48 nodos, sin cambio de tope) el nodo «Leer encabezados de la planilla» pasa de lectura de Sheets a consulta de la fila 3 por la API de Sheets (mismo número de nodos, misma credencial). En **chat-novuchat** y **captación mínima** solo cambia el texto de `crm.js` incluido en sus nodos Code (la rutina nueva de comprobación no la ejecutan: no tienen ese nodo), sin cambio de comportamiento; siguen versionados adelantados y sin publicar con el resto de su pendiente. Ningún flujo vivo se republica con este PR.

**Bellido (miniCRM, 04/11/2026).** `agenda-minima.v0.json` y `agenda-minima.prueba.json`: 62 -> **70** nodos (Bellido no tiene tope en su constructor). **Por qué:** miniCRM, módulo `crm`; el módulo genera la rama de 8 nodos (`ramaCrm`) colgada de «Armar mensajes», con la credencial `Google Sheets miniCRM (crm-bellido)` y el id de planilla como marcador `REEMPLAZAR_PLANILLA_PROSPECTOS_ID_BELLIDO` en `Config base` (vacío en la variante de prueba; el valor real lo repone la publicación). **Mensajes por conversación: 0** (agregados 0, quitados 0). **Aprobado por:** orden expresa de Andres del 04/11/2026 («Bellido tiene que escribir en su miniCRM lo antes posible»): el código de Bellido, congelado desde el 23/10/2026, **se descongela solo para el miniCRM**; no se tocan la plantilla de recordatorios, el prompt ni el candado. Cambios del flujo: `Armar mensajes` (prospecto con vocabulario cerrado, `agmProspectoCrm`), `Config del negocio` (id y hoja de la planilla) y `settings.saveManualExecutions: false`. Se publica con `flujo-de-prueba.mjs --sobre-bellido` y su respaldo y vuelta atrás son los ya descritos en la fila de Bellido (`--restaurar-respaldo`). Hasta que se publique, `estado-de-versiones.sh` lo verá atrasado, y es correcto que lo haga.

> **Excepción de rearquitectura: flujos vivos de `Flujos/experimental/` (Andres, 31/10/2026).**
> Qué queda distinto: los flujos de `experimental/` (Rubén, Antonio, Evy, Emma,
> Walisuma, Bellido, Q'Taco, chat NovuChat) conservan su propia variante de los
> cinco nodos comunes (Normalizar entrada, Config del negocio, Procesar respuesta,
> Uso extendido, Comercio no operativo) y no incluyen aún el núcleo desde
> `Flujos/src/core/`. Por qué: las variantes difieren en comportamiento, no en
> parámetros (`Flujos/src/core/VARIANTES.md`); unificarlas cambia lo que corre y
> se hace por rebanadas con ensayo, y Q'Taco no se toca la semana de su traslado
> (~07/11). Lo cierra: la unificación nodo por nodo con la prueba byte a byte de
> `pruebas/core/nucleo-comun.test.ts`, o una nueva decisión escrita de Andres.
> Vence el 31/01/2027; si vence sin cerrarse ni renovarse, es un defecto.

> **Definición de `cmNumerar` en `mensajes.js` (PR del relé B9, 03/11/2026, 0 mensajes por conversación).** Qué queda distinto: el módulo común
> `Flujos/experimental/comun-sin-agente/src/mensajes.js` suma la FUNCIÓN `cmNumerar` (numera los mensajes de «Armar mensajes» para la Idempotency-Key del canal
> `rele`) y ninguno de estos flujos la llama: solo cambia el texto del nodo «Armar mensajes», sin cambio de comportamiento. Cambian por eso, y solo por eso, los
> **18 JSON**: `captacion-minima.novuchat.json` y `captacion-minima.prueba.json`; `chat-novuchat.novuchat.json` y `chat-novuchat.prueba.json`;
> `doctoras.rroca-emma.json`, `doctoras.rroca-emma.prueba.json`, `doctoras.rroca-evy.json` y `doctoras.rroca-evy.prueba.json`; `rroca-antonio.json` y
> `rroca-antonio.prueba.json`; `rroca-emma.json` y `rroca-emma.prueba.json`; `rroca-evy.json` y `rroca-evy.prueba.json`; `rroca-ruben.json` y
> `rroca-ruben.prueba.json`; `walisuma.json` y `walisuma.prueba.json`. Por qué: el módulo es común y los constructores lo incluyen tal cual; no se publica nada
> solo por esto. Lo cierra: la próxima publicación de cada flujo (que ya lleva la definición); hasta entonces `estado-de-versiones.sh` puede mostrar atrasado a
> cualquiera de los vivos que figuran arriba (Rubén, Antonio, Evy, Emma, Walisuma, chat NovuChat) y es una diferencia declarada, sin riesgo. Vence el 31/01/2027.

> **Redirección de Q'Taco (04/11/2026), sin publicar.** `Flujos/clientes/qtaco-redireccion/qtaco-redireccion.qtaco.json` (11 nodos) está pensado para reemplazar EN SU LUGAR, con el mismo nombre de workflow («NovuChat — Venta mínima (v0) — Q'Taco») y la misma ruta, al flujo vivo de la línea anterior de Q'Taco (`venta-minima.qtaco.json`). El flujo del número nuevo se llama «NovuChat — Venta mínima (v0) — QTaco 3727» (distinto). Mientras no se publique no cambia nada; al publicarlo, `estado-de-versiones.sh` verá a Q'Taco distinto de `venta-minima.qtaco.json` y esta fila se actualiza en ese PR. **Excepción al núcleo común: sin conteo de salientes ni comercio no operativo; aprobación de Andres PENDIENTE.** Al reemplazar el flujo vivo desaparece la ruta «Carrito del catálogo» (404 en el catálogo web del número viejo): confirmar que el catálogo ya apunta al flujo nuevo antes de publicar. Costo: ≥ 1 mensaje de servicio por conversación (puede ser 2 con mensajes simultáneos). Retención: `saveDataErrorExecution: all`. **Vuelta atrás:** el respaldo que `publicar-flujo.sh --aplicar` escribe antes de pisar (`Flujos/respaldo-<id>-<fecha>.local.json`, con ids reales, fuera del control de versiones) republicado con `publicar-flujo.sh --flujo <ese archivo> --aplicar`; NO `venta-minima.qtaco.json`, que deja sin credencial los 3 nodos `googlePalmApi`.

> **Evy (`rroca-evy`, cliente08) y Emma (`rroca-emma`, cliente07): envío y medios por el relé B9 (PR 2, 03/11/2026, 0 mensajes por conversación).** Qué queda distinto:
> `rroca-evy.json` y `rroca-emma.json` pasan de 53 a **56 nodos** y el tope sube de 53 a **56**; las variantes de prueba pasan de 48 a **51**. Por qué: el canal `rele` suma
> «Leer respuesta del relé», «¿Qué hacer con el envío?» y «Esperar reintento», y el nodo «Detener por envío incierto» (decisión I4: incierto o agotado termina la ejecución
> en ERROR, sin reenvío ni mensaje extra). Todo lo que hablaba con Graph (envío, respaldo, aviso, descarga de medios y guardado) sale por el relé con la credencial
> «AAB1 envío · cliente08» / «AAB1 envío · cliente07» y la URL interna como marcador `REEMPLAZAR_URL_INTERNA_DEL_RELE`; `executionTimeout` pasa de 120 a 300 s.
> **Aprobado por:** Andres, el 03/11/2026 (56 producción / 51 prueba por flujo). **Riesgo de cupo aceptado:** las descargas para transcribir o ver una imagen (audio e imagen a Gemini) gastan
> de las 500 descargas diarias por WABA y no pasan por el cupo del guardado (10 por teléfono y día, 30 por flujo); una ráfaga atraviesa el cupo (limitación de
> concurrencia ya declarada en #757). **Publicación:** viernes 06/11/2026, con el botón de Andres; hasta entonces `estado-de-versiones.sh` los mostrará atrasados y es
> correcto. **Lo cierra:** la publicación; el tope es permanente mientras el canal tenga estos nodos. Vence el 31/01/2027 (igual que la nota de #757).
>
> **Variante de prueba por el relé (03/11/2026, pendiente de confirmar por Andres).** `rroca-evy.prueba.json` y `rroca-emma.prueba.json` ya no usan la credencial `graphPrueba`: llevan la credencial real del relé de su WABA («AAB1 envío · cliente08» / «· cliente07»), porque la llave del relé es por WABA y no existe una de prueba. Qué implica: la prueba envía y descarga desde el número de la clienta y gasta de su cupo de 500 descargas diarias. Barreras que lo acotan: `modoPrueba`/`etapaPrueba` con `telefonosDePrueba` (solo atiende a esos teléfonos y la recepción debe estar dentro), `enviarDeVerdad` apagado salta el envío, y la entrada de prueba exige cabecera propia. **El guardado de medios NO corre en la prueba** (verificado por traza del grafo: «Preparar guardado» solo cuelga de «¿Reportar? (entrante)», que exige `modoPrueba !== true`). Sí corren «Obtener URL del medio (general)» y «Descargar medio» con la llave real: cada imagen o audio de la prueba gasta unos 2 GET del cupo de 500 descargas por día del WABA, fuera de `GM_CUPO`. Pendiente: que Andres confirme este uso.

**Rubén («Noches Sin Insomnio», 04/11/2026, PR-1).** `rroca-ruben.json`: 63 -> **64** nodos y tope 63 -> **64**; variante de prueba 58 -> **59**. **Por qué:** flujo nuevo con la forma del de Antonio (incluye el guardado de medios y el miniCRM); tope igual al de Antonio y por la misma excepción ya declarada arriba (guardado de medios y miniCRM). **Aprobado por:** Andres, plan único del 04/11/2026 (confirmado por la sesión Principal). Con el relé B9 de Clínicas (+2) llegará a 66.

**Q'Taco (06/11/2026) — de nuevo sin alcohol.** Samuel pidió quitar todo lo que tiene alcohol: se vuelve a excluir `cocteleria` y `cervezas` (áreas) y la lista de palabras de alcohol; los postres sin alcohol se ofrecen. **Condición operativa:** la barrera por palabra no detiene un ítem activo con la palabra en su nombre, así que «Helado de Tequila» y «Helado de Rompope» deben permanecer INACTIVOS en el catálogo (`habilitar-productos --solo`). La excepción anterior de «sin exclusión de alcohol» (PR #811) queda **sin efecto**.

## Q'Taco: ráfaga y «escribir al local» escrito (06/11/2026)

Cambio en `Decidir turno`, `Armar mensajes` y `Soltar mensajes` de «Venta mínima v0» (los cuatro JSON regenerados; sin nodos nuevos por sí sola; con la integración el 3727 queda en 81). Aplica a todos los flujos de venta mínima por igual (Q'Taco, Q'Taco 3727, prueba, ensayo del Demo A). Sin excepciones nuevas: el vivo queda atrasado hasta que se publique, y no se publica en este PR. Detalle: `Flujos/experimental/venta-minima/DISENO.md`.


## Estado al 06/11/2026 (Q'Taco: reserva de mañana, C-05 resuelto)

**Decisión de Andres (06/11/2026):** el horario de PEDIDOS (delivery o recojo) pasa a 10:00–22:00 todos los días y el restaurante atiende de 12:00 a 22:00; «en caso que alguien reserve en la mañana, Samuel se contactará para cambiar la reserva».

- **Qué cambia:** dos claves nuevas de «Config base» (`reservaDesde`, `reservaMananaTexto`; solo `qtaco.json`, que hereda `qtaco-3727` y el ensayo). Una reserva con hora anterior a `reservaDesde` se ACEPTA (el horario válido sigue siendo `horario`, el de pedidos: no hay horario propio de reservas); la confirmación agrega el texto del negocio y el aviso al local lleva la nota «Reserva de mañana (antes de las 12:00): contactar para confirmar o cambiar la hora» dentro del mismo aviso (variable de notas existente; ninguna variable de plantilla cambia). Horas fuera de 10:00–21:30 se rechazan como hoy. `reservaDesde` vacío = comportamiento anterior.
- **Mensajes por conversación: 0 agregados o quitados.** Sin nodos nuevos. Código común a todas las salidas de `venta-minima` (regeneradas); solo Q'Taco trae `reservaDesde`, así que el resto no cambia de comportamiento.
- **No se publica con este PR.**
