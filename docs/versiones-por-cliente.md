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
| Demo A (agendamiento) | `.env` | `Flujos/demo-a-agendamiento.json` | Atrasado en 1 nodo: `Procesar respuesta` (el #284, detector de «ya», `5aad7da`; código compartido). Por qué: el Demo A es el número de ensayo y no tiene pacientes; decidido por Andres el 30/09/2026 (según la sesión Principal) mientras Bellido sale a piloto, y Bellido ya lo tiene. Lo cierra: la próxima publicación de flujos, que llevará también el #286. **Además, F3a (02/10/2026):** `Procesar respuesta` lleva la corrección `NIEGA_IA` (#359) en `main` sin publicar. Por qué: Andres decidió el 02/10 preparar y fusionar F3a en `main` y publicar solo tras el veredicto H2 de la revisora, con ensayo previo. Lo cierra: la publicación de F3a en la ventana de 23:30 a 01:30 después de H2. **Además, visión de imágenes (22/10/2026):** `Preparar imagen` nuevo en `main` sin publicar; su conducta cambia SOLO si el clasificador devuelve variantes de la categoría (mayúsculas, espacios o guiones: «Comprobante » con seña vencida antes iba a `otro` y ahora fuerza la transferencia) y `foto` o `captura_de_pantalla` ya no llevan el `texto` leído. Se cierra al adoptar la visión en el prompt del clasificador. |
| Dr. Bellido (pediatría) | `.env.bellido` | `Flujos/bellido-agendamiento.json` | **Corre otro flujo, el piloto «Agenda mínima v0»** (publicado el 01/10/2026 a la 01:24 con autorización de Andres): `Flujos/experimental/agenda-minima/agenda-minima.v0.json`, **53 nodos** desde el 23/10/2026 (publicado a las 08:04 UTC con `flujo-de-prueba.mjs --sobre-bellido --desde-b`, desde `main` `9d3bc4c2` = PR #603, medios del core: audio, imagen y PDF; antes 45 nodos, de `e3d4af9`, PR #354; el piloto se publicó el 01/10 desde `f3f7411`, PR #293, fusionado en `c0ea17e`; el cambio de `e3d4af9` es solo el código de los 11 nodos Code que pegan `_comun.js`, la corrección de `cnAtencion`, y su prueba real con teléfono está pendiente), no el JSON versionado de esta fila (el de A, 96 nodos, descartado). Se publica con `herramientas/flujo-de-prueba.mjs --sobre-bellido`, **no** con `publicar-flujo.sh`. Por qué: es el piloto que Andres decidió el 30/09/2026 tras el concurso entre el flujo actual y este. **Plan ante una falla de B (Andres, 01/10/2026): se corrige B; no se vuelve al flujo anterior ni al candidato A, que se descartó.** El respaldo del flujo anterior de 96 nodos no es plan del piloto. Lo cierra: la decisión de Andres sobre el piloto (y cambiar esta columna al JSON de B cuando `estado-de-versiones.sh` sepa compararlo contra el vivo); hasta entonces `estado-de-versiones.sh` lo verá «atrasado, CON excepción declarada», que es lo esperado. **CÓDIGO CONGELADO (Andres, 23/10/2026: «está suficientemente bien para salir en producción»): el atraso siguiente es una EXCEPCIÓN DECLARADA, no un defecto, y no se publica.** Qué queda distinto entre el JSON versionado en `main` y el vivo (12 nodos, verificado comparando el JSON de `9d3bc4c2` con el de `main`): (1) #619, el nodo `Preparar imagen` con el módulo nuevo y el comparador de anuncios, inerte en Bellido mientras `cfgNeg.anuncios` no exista; (2) #627, los 11 nodos Code que pegan `_comun.js`, donde `cnNorm` quita caracteres invisibles al comparar. #625 (redacción segura, opciones apagadas) NO cambia el JSON de Bellido. El PR #629 (pregunta de salud) queda estacionado, sin publicar. Lo cierra: una decisión posterior de Andres de descongelar el código y publicar con ensayo; hasta entonces `estado-de-versiones.sh` lo verá «atrasado, CON excepción declarada». Historia: hasta el 30/09 corría el flujo publicado desde `main` con #284 (96 nodos, hotfix de protección del 27/09 más mejoras adelantadas, sobre la base `e02a756`); esa versión queda como respaldo |
| Q'Taco | `.env.qtaco` | `Flujos/experimental/venta-minima/venta-minima.qtaco.json` | Difiere solo en el dato `destinatariosAviso` de `Config base`: en producción lleva un único destinatario (recepción) y la preparación estándar repone dos desde `CONFIGURACION.local.md`. Por qué: Andres decidió en la apertura que el aviso de cocina no se manda; el código del flujo es el mismo. Lo cierra: quitar el segundo número de aviso de `CONFIGURACION.local.md` (la copia local, ignorada por git); o, mejor, dejar un solo destinatario en la plantilla versionada `admin/scripts/datos/venta-minima/qtaco.json`; entonces `estado-de-versiones.sh` lo verá al día. Se revisa en la próxima publicación de Q'Taco. |
| Rubén (venta digital, tenant `rroca-ruben`) | `.env.rroca-ruben` | `Flujos/experimental/rroca-ruben/rroca-ruben.json` | Al día: publicado el 23/10/2026 16:16 La Paz desde `main` `ed616dcd` (Entrega 2, #618), 45 nodos, abierto al público con `telefonosDePrueba` vacío, con el «Publicar ya» de Andres (fuera de la ventana, autorizado). Relectura: el vivo coincide con el origen. Respaldo del vivo previo (#600) guardado fuera del repo, modo 600. Sin excepción declarada. |
| Demo B (venta y cobro) | `.env.demo-b` | `Flujos/demo-b-venta-cobro.json` | **Visión de imágenes (22/10/2026, PR `core/medios-imagen-descripcion`):** atrasado frente al JSON en 1 nodo, `Preparar imagen` (categorías `foto`, `captura_de_pantalla`, `pago_con_problema` y la descripción de lo que se ve). Su conducta cambia SOLO con variantes de la categoría (mayúsculas, espacios, guiones) y porque `foto` o `captura_de_pantalla` ya no llevan el `texto` leído (el clasificador de este flujo sigue devolviendo «otro» y `Filtrar categoría` lo reduce). Por qué: el código común llega a todos, pero se adopta con el prompt nuevo del clasificador, que es de cada cliente. Lo cierra: la adopción de la visión en el prompt del clasificador. |
| Chat NovuChat v2 (captación) | `.env.novuchat` | `Flujos/experimental/chat-novuchat/chat-novuchat.novuchat.json` | **Versionado ADELANTADO al vivo por el PR-B del miniCRM (30/10/2026), sin publicar.** Los nodos «Prospecto para la planilla» y «Decidir fila de la planilla» ahora se incluyen del módulo `Flujos/src/modulos/crm/` (mapa de columnas como dato) y «Buscar teléfono» pasa de `returnFirstMatch: true` (fila más antigua) a `false` con selección de la fila más reciente. Por qué: regla de Andres (se actualiza la fila más reciente del teléfono) y un solo código para todos los clientes. Además: los encabezados A..J de la fila 3 se comparan ahora letra por letra y en orden (antes bastaba que existieran), y el módulo respeta `config/crm.activo === false`, que NO se puede activar hasta el PR-B3 (`configuracionFlujo` aún no devuelve `config/crm`). Lo cierra: el ensayo (confirmar con la hoja real que n8n entrega las claves en el orden de la hoja) y la publicación con el «sí» de Andres; hasta entonces `estado-de-versiones.sh` lo verá «atrasado, CON excepción declarada». |
| Demo A (recordatorios) | `.env.recordatorios` | `Flujos/demo-a-recordatorios.json` | — |
| Antonio («Método Puente», tenant `rroca-antonio`; vivo con #602, 48 nodos; el rehecho de Ventas digitales está en revisión, sin publicar) | `.env.rroca-antonio` | `Flujos/experimental/rroca-antonio/rroca-antonio.json` | EXCEPCIÓN FORMAL de la falla abierta de la pausa. Id rroca-pausa-falla-abierta; declarada el 19/10/2026, vence en 90 días (17/01/2027). Si vence sin cerrarse (tocar la puerta común o agregar un nodo que lea la pausa por otra vía) o sin renovarse con una decisión escrita de Cartera, es un defecto, no una excepción. Alcance: si la ingesta y la consola caen en el MISMO turno no hay estado de atención y la puerta devuelve «normal», así que una persona en pausa recibiría el saludo; puerta-del-turno.js es idéntica al origen común y no se toca. Ampliada a rroca-antonio por Principal el 20/10/2026; el cierre es el PR común de Core (a cargo de Rearquitectura). No reinicia el vencimiento. **Además, visión de imágenes (22/10/2026):** `Preparar imagen` nuevo (descripción de lo que se ve) en el JSON versionado; su conducta cambia SOLO si el clasificador devuelve variantes de la categoría (mayúsculas, espacios o guiones: «Comprobante » con seña vencida antes iba a `otro` y ahora fuerza la transferencia) y `foto` o `captura_de_pantalla` ya no llevan el `texto` leído; se publicará por Cartera 2 con ensayo, al adoptar el prompt nuevo. |

> **Atraso de Bellido: `Preparar imagen` nuevo (23/10/2026).** `Flujos/experimental/agenda-minima/agenda-minima.v0.json` y `agenda-minima.prueba.json` (regenerados con `construir.mjs`; cambia solo el código de «Preparar imagen») llevan el módulo nuevo: categorías foto, captura y pago_con_problema, descripción saneada y el comparador de anuncios (`anuncio-por-titular.js`), inerte mientras `cfgNeg.anuncios` no exista (Agenda mínima no lo recibe). El flujo VIVO de Bellido corre el módulo anterior: se alinea publicando con el «sí» de Andres y el ensayo de Cartera/Constructora. Este PR (#619) NO publica nada.

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
