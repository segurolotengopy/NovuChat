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
| Demo A (agendamiento) | `.env` | `Flujos/demo-a-agendamiento.json` | Atrasado en 1 nodo: `Procesar respuesta` (el #284, detector de «ya», `5aad7da`; código compartido). Por qué: el Demo A es el número de ensayo y no tiene pacientes; decidido por Andres el 30/09/2026 (según la sesión Principal) mientras Bellido sale a piloto, y Bellido ya lo tiene. Lo cierra: la próxima publicación de flujos, que llevará también el #286. **Además, F3a (02/10/2026):** `Procesar respuesta` lleva la corrección `NIEGA_IA` (#359) en `main` sin publicar. Por qué: Andres decidió el 02/10 preparar y fusionar F3a en `main` y publicar solo tras el veredicto H2 de la revisora, con ensayo previo. Lo cierra: la publicación de F3a en la ventana de 02:00 a 03:00 después de H2. |
| Clínica Platinum (reservas) | `.env.platinum` | `Flujos/platinum-agendamiento.json` | Atrasado en 1 nodo: `Procesar respuesta` (el #284, detector de «ya», `5aad7da`; código compartido). Por qué: Platinum es un demo, sin pacientes; decidido por Andres el 30/09/2026 (según la sesión Principal) mientras Bellido sale a piloto, y Bellido ya lo tiene. Lo cierra: la próxima publicación de flujos, que llevará también el #286. **Además, F3a (02/10/2026):** `Procesar respuesta` lleva `NIEGA_IA` (#359) en `main` y **Platinum no se publica con F3a** (decisión de Andres del 02/10, D7): su JSON versionado no está alineado con lo que corre en producción y publicarlo lo haría retroceder. Lo cierra: F3b (núcleo unificado de reservas), que lo publica alineado. |
| Dr. Bellido (pediatría) | `.env.bellido` | `Flujos/bellido-agendamiento.json` | **Corre otro flujo, el piloto «Agenda mínima v0»** (publicado el 01/10/2026 a la 01:24 con autorización de Andres): `Flujos/experimental/agenda-minima/agenda-minima.v0.json`, 45 nodos, de `e3d4af9` (PR #354; el piloto se publicó el 01/10 desde `f3f7411`, PR #293, fusionado en `c0ea17e`; el cambio de `e3d4af9` es solo el código de los 11 nodos Code que pegan `_comun.js`, la corrección de `cnAtencion`, y su prueba real con teléfono está pendiente), no el JSON versionado de esta fila (el de A, 96 nodos, descartado). Se publica con `herramientas/flujo-de-prueba.mjs --sobre-bellido`, **no** con `publicar-flujo.sh`. Por qué: es el piloto que Andres decidió el 30/09/2026 tras el concurso entre el flujo actual y este. **Plan ante una falla de B (Andres, 01/10/2026): se corrige B; no se vuelve al flujo anterior ni al candidato A, que se descartó.** El respaldo del flujo anterior de 96 nodos no es plan del piloto. Lo cierra: la decisión de Andres sobre el piloto (y cambiar esta columna al JSON de B cuando `estado-de-versiones.sh` sepa compararlo contra el vivo); hasta entonces `estado-de-versiones.sh` lo verá «atrasado, CON excepción declarada», que es lo esperado. Historia: hasta el 30/09 corría el flujo publicado desde `main` con #284 (96 nodos, hotfix de protección del 27/09 más mejoras adelantadas, sobre la base `e02a756`); esa versión queda como respaldo |
| Q'Taco (piloto) | `.env.qtaco` | `Flujos/experimental/venta-minima/venta-minima.qtaco.json` | En construcción: se publicará con `publicar-flujo.sh --crear`, excepción experimental como Bellido. |
| Demo B (venta y cobro) | `.env.demo-b` | `Flujos/demo-b-venta-cobro.json` | **F3a publicada en el Demo B el 03/10/2026**, con el «sí» de Andres, por el camino «publicar en el demo»; es un demo sin clientes. Pendiente: el QR del cobro no sale (media ID del QR demo vencido); el QR ya se subió de nuevo y falta **republicar** el Demo B, junto al #378 (aviso al cliente cuando falla el QR, en revisión). Lo cierra: esa republicación y repetir el caso del pedido con QR. |
| NovuChat (captación) | `.env.novuchat` | `Flujos/novuchat-onboarding.json` | **F3a en `main` sin publicar (02/10/2026):** fallo del modelo con botón (#360) y campaña por texto, según se fusionen. Por qué: Andres decidió el 02/10 publicar F3a solo tras el veredicto H2; además la publicación de captación no puede caer durante el traspaso del chat interno al portafolio de Silvana (D10). Lo cierra: la publicación de F3a después de H2 y fuera del traspaso. |
| Demo A (recordatorios) | `.env.recordatorios` | `Flujos/demo-a-recordatorios.json` | — |
| Platinum (seguimientos) | `.env.platinum-seguimientos` | `Flujos/agendamiento-seguimientos.json` | — |
| Platinum (señas vencidas) | `.env.platinum-senas` | `Flujos/agendamiento-senas-vencidas.json` | — |

> El guion `—` significa **sin excepción**: ese flujo tiene que estar al día con
> su JSON versionado, y el script falla si no lo está.

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
apunta otra vez al flujo de siempre. Demo A y Platinum siguen atrasados en
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
[ventana de mantenimiento de 02:00 a 03:00](contrato/anexo-tecnico-sla.md) no
condiciona cuándo se publica.
