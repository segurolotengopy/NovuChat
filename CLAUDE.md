# NovuChat — instrucciones de proyecto

Asistentes conversacionales de WhatsApp para PyMEs bolivianas, construidos con
**n8n + IA**. Proyecto conjunto de **Andres** (arquitectura, infraestructura,
comercial) y **Silvana** (diseño funcional, guiones, material comercial).

Antes de trabajar, leé `ESTADO.md` (dónde estamos, en una pantalla), la
bitácora del mes (`bitacora/<aaaa-mm>.md`) y `CONFIGURACION.md` (parámetros e
identificadores). Al terminar una sesión, reescribí `ESTADO.md` y agregá tu
asiento a la bitácora; lo derivable lo imprime `./scripts/estado-generado.sh`.
**Este archivo tiene solo invariantes**: lo que cambia con el tiempo vive en
`ESTADO.md`, la bitácora, `docs/base-comercial.md` y `docs/arquitectura/`.

## Idioma y estilo

Español latinoamericano (Bolivia), sin voceo. Respuestas técnicas rigurosas y
detalladas; interactivas en los puntos críticos. Andres tiene 25 años de
experiencia en arquitectura y gestión de proyectos, y experiencia media
programando: explicá el *porqué* de las decisiones, no solo el *cómo*.

## Arquitectura

```
WhatsApp (Meta Cloud API)
   └── webhook ──► n8n autoalojado en OCI (2.36.5)
                     └── AI Agent (Gemini en demos, Claude en producción)
                           ├── memoria por número de teléfono
                           ├── Google Calendar (consultar / agendar)
                           └── envío de respuesta + alerta al negocio
```

## PROHIBICIONES DURAS

1. **NUNCA** reintroducir un canal NO oficial de WhatsApp — Evolution API,
   Baileys, WPPConnect, dispositivos vinculados o equivalentes. Se probó y se
   retiró el 2026-08-22 por rotura silenciosa y riesgo de baneo. El único
   canal es la **Cloud API oficial de Meta**. Referencia:
   `~/WhatsApp-Modular/docs/13-laboratorio-evolution.md`.
2. **NUNCA** escribir un token, App Secret, Client Secret o API key en un
   archivo del repositorio — incluidos los JSON de flujos exportados, los
   sticky notes de n8n y los ejemplos. Solo en `.env` (ignorado) y en el
   gestor de contraseñas.
3. **NUNCA** presentar un cobro como algo que no es. Tiene dos mitades:
   - **Cobro simulado**: el QR de demostración lleva el rótulo impreso en la
     imagen **y** en el caption, y la confirmación dice "simulado".
   - **Cobro real** (QR del comercio, el dinero va a su cuenta): el asistente
     **NUNCA** dice "pago acreditado", "pago verificado" ni "recibimos tu
     pago". El OCR de un comprobante **no es una acreditación bancaria**: una
     imagen se edita. Se dice que el comprobante llegó y que los datos
     coinciden; quien confirma que entró la plata es el banco, y el negocio.
   Los dos modos son excluyentes: nunca los dos a la vez en un mismo negocio.
4. **NUNCA** hacer que el agente niegue ser una IA. Se presenta como asistente
   virtual y, si le preguntan, lo dice con naturalidad.
5. **NUNCA** tocar la app de Meta `Demo SeguroLo Tengo` ni el `otp-service`:
   son de WhatsApp-Modular, un sistema financiero en producción. Comparten la
   VM y la WABA, pero son productos distintos.
6. **NUNCA** publicar el número de prueba a terceros: solo responde a los 5
   destinatarios registrados (ver `CONFIGURACION.md`; el riesgo está en
   `bitacora/2026-09.md`, «Riesgos vivos»).

## Reglas de diseño de los flujos n8n

- **NUNCA una cita encima de otra con un cliente real. Es una regla
  mandatoria de Andres (17/09/2026), no una preferencia.** El candado contra
  la doble reserva se dispara **por lo que el modelo HIZO, no por lo que
  DIJO**: si `agendar_cita` se ejecutó en la vuelta, se verifica en el
  calendario y, si hay cruce, se deshace; el detector de texto («quedó
  agendada», «agendé»…) es solo una red secundaria. El 17/09 el modelo agendó
  dos veces dentro de un intervalo que acababa de recibir de
  `consultar_disponibilidad`, con la regla de intervalos ya publicada en el
  prompt, y la segunda vez el candado no corrió porque dijo «he reprogramado»
  y esa forma no estaba en la lista. **El prompt no es una barrera**: una
  instrucción se ignora bajo insistencia y cambia con cada modelo. Ningún
  flujo de reservas se publica sin este disparador, su suite reproduce el
  caso «verbo no previsto y la herramienta sí corrió», y todo cambio del
  candado se prueba contra un teléfono real insistiendo sobre una hora
  ocupada.
- **El asistente solo ofrece lo que el flujo cumple. Política general de
  NovuChat, para todo cliente (Andres, 21/09/2026).** Ante un error o una
  consulta que no sabe responder, lo único que ofrece es **pasar con
  recepción**, que es siempre el aviso a recepción **más** el botón para
  escribirle directo. Nunca «lo consulto», «te aviso luego», «te llamamos» o
  «te escribirán» sin un mecanismo detrás. Se hace cumplir en código, como el
  candado: toda promesa sin respaldo se cumple (se transfiere) o se quita del
  texto; todo lo que se transfiere y todo error del modelo sale con el botón
  (en los flujos de agenda lo decide `Mensaje a enviar`); y una respuesta que es
  solo una marca nunca se toma por vacía. El 21/09 el prompt decía «ofrece
  consultarlo con recepción», el paciente aceptó dos veces y recibió «tuve un
  problema técnico». Pruebas: `platinum-flujo.test.ts`, «solo se ofrece lo que
  se cumple».
- **Memoria con clave de sesión explícita** = número de origen
  (`messages[0].from`). Sin esto, dos clientes comparten memoria. Es el
  defecto más grave que puede tener uno de estos flujos.
- **Filtro de eventos** antes del agente: solo pasan payloads con `messages`.
  Los acuses de estado se descartan.
- **Normalización de entrada** que cubra `text`, `interactive`, `order`,
  `image` y cualquier otro tipo con respuesta cortés. Nunca acceder a
  `.text.body` sin pasar por ahí.
- **Fecha, hora y zona inyectadas al prompt** (`America/La_Paz`, UTC-4 fijo).
  Sin esto, "mañana en la tarde" se calcula mal.
- **Modelo como sub-nodo intercambiable**: cambiar Gemini por Anthropic no
  debe requerir tocar nada más del flujo.
- **Todo lo configurable por negocio** vive en el nodo `Config del negocio`,
  no disperso por el lienzo. Es lo que sostiene la promesa de instalar un
  cliente nuevo en 48 horas.
- **Nodos Code en JavaScript**: la imagen de n8n desplegada no trae Python.
- **El orden de las ramas es el del lienzo.** Los flujos corren con
  `executionOrder: v1`: n8n termina una rama entera antes de empezar la
  siguiente, de arriba hacia abajo (a igual altura, la de la izquierda). Mover
  un nodo cambia el comportamiento. En particular, **`Reportar mensaje
  (entrante)` va arriba de la rama del agente**: si la respuesta se reporta
  antes que el mensaje que la provocó, el aviso de uso extendido no sale nunca
  y la primera respuesta de cada ventana no se cuenta (revisión del PR #66,
  `pruebas/flujos-umbrales.test.ts` lo verifica por posición).
- **Cada mensaje que envía el flujo cuesta dinero** desde el 01/10/2026. Un
  cambio que agregue un mensaje por conversación cuesta 0,0113 USD por
  conversación en todos los clientes. Ver `docs/base-comercial.md` §1: todo
  cambio de flujo declara cuántos mensajes agrega o quita.
- **Cada flujo nuevo se revisa contra la política de capas** de
  `docs/arquitectura/registro.md` (antes `admin/DISENO.md` §4sexies; el índice
  de secciones viejas es `docs/arquitectura/indice.md`): lo común (identidad, horarios, voz, catálogo,
  usuarios) no se repite por flujo; lo propio de un flujo (agendas, QR, costos
  de entrega) es excluyente y trae su documento `/config/{flujo}`, su línea en
  la tabla de capacidades de las reglas y su pestaña en `web/src/lib/flujos.ts`.
  Un negocio tiene uno o más flujos (`tenants/{id}.flujos`), y la consola
  habilita pestañas por flujo. Nunca una consola que solo sirve a un flujo.

## La regla de zonas: carpeta = zona

**Decidido con Andres el 25/09/2026** (`Analisis/41-arquitectura-por-capas.md`
§1, §6.1 y §9; el detalle por zona y por módulo está en `docs/arquitectura/`,
con `indice.md` como entrada). Cada porción de código está en exactamente una
zona, y la zona es la carpeta:

| Zona | Qué es | Quién la cambia |
|---|---|---|
| **Core** | Lo que todo tenant corre igual: contratos, seguridad, conteo, canal, agente base, medios entrantes | Solo NovuChat, y cada cambio llega a todos |
| **Central** | Lo que todo comercio ve igual: consola y cuenta, planes, modalidad, Pagar, servicios | NovuChat |
| **Plataforma** | Lo que ve NovuChat como operador: Negocios, alta, baja, suspensión, los tres ejes de la cuenta | NovuChat |
| **Módulos** | Lo que se enciende por tenant, con su manifiesto: Productos, Agenda, Pedidos, Cobros, Inventario, Campañas, Catálogo web, Captación, Menú interactivo | NovuChat, un módulo a la vez, con una versión |
| **Tenants** | Datos de un cliente. **Nunca código** | El comercio desde su consola; NovuChat desde Plataforma |

Más dos piezas con nombre: el **coordinador de turno** (el único código que
conoce a todas las zonas, y solo a través del registro) y el **registro de
módulos** (un archivo con los manifiestos, del que se derivan reglas,
Functions, consola y ensamblador).

- **La prueba de ubicación** (`Analisis/41` §1.3) decide la zona de toda
  pieza nueva; una pieza que responde «sí» a dos preguntas está mal cortada y
  se parte.
- **Dependencias hacia abajo, nunca hacia arriba:** Core no depende de nada;
  Central de Core; Plataforma de Central y Core; un módulo de otro solo si su
  manifiesto lo declara. Se hace cumplir con **`fronteras.test.ts` en CI** (lee
  los `import` y falla si una zona importa hacia arriba) y con
  **`registro.test.ts`** (cada documento, colección, pestaña y límite del
  registro tiene su regla y su prueba negativa). Sin esas dos pruebas en verde
  nada se fusiona (§8.2).
- **Un tenant nunca posee código.** Lo que un cliente necesita y no existe
  nace como módulo con bandera, para todos. El JSON de un tenant es salida de
  construcción. Nunca un texto ni un nombre de cliente en código común.
- **Cada agente escribe solo en su zona**, y el gancho
  `.claude/hooks/zona-de-escritura.sh` (sobre `Edit` y `Write`, con la zona
  en `.claude/zona` del worktree o en `NOVUCHAT_ZONA`) lo rechaza si no. Las
  zonas por agente están en `docs/arquitectura/agentes.md`.
- **Vocabulario:** *módulo* reemplaza a *vertical*; *Cobros* es el comercio
  cobrando a su cliente y *Pagar* es NovuChat cobrando al comercio;
  *producción* reemplaza a *prepago* en la consola; *titularidad* nombra quién
  es dueño del canal; la unidad se llama *conversación*, nunca *atención*.
- **Cero mensajes por conversación agregados o quitados** en toda la
  rearquitectura, y se demuestra con la suite.

## Base comercial — el dinero de cada decisión técnica

Está entera en **`docs/base-comercial.md`** (vigente desde el 1 de octubre de
2026; análisis en `Analisis/14` a `20`, `21`, `23`, `24`, `27`, `39`), y la
tabla de límites con dónde se hace cumplir cada uno en
`docs/arquitectura/limites.md`. Lo invariante, que no cambia aunque cambien
los números: **cada respuesta del asistente cuesta dinero** y todo cambio de
flujo declara cuántos mensajes agrega o quita; **si una decisión técnica
contradice la base comercial, se discute antes de implementarla**; y **todo
límite comercial se hace cumplir en el servidor**: un límite que solo existe
en la pantalla no existe, la regla del servidor es la que se prueba, la
prueba se escribe negando, y el límite se lee del plan, no se escribe en el
código.

## Flujo de trabajo

- **Andres autoriza; Claude opera** (pedido una y otra vez; 15/09/2026). Todo
  paso de un procedimiento —despliegues, etiquetas, scripts con `--aplicar`,
  IAM, rotación de secretos, n8n, variables de GitHub— lo ejecuta Claude después
  del OK de Andres en el chat. Nunca se le pasan comandos para que los corra, ni
  con marcadores para reemplazar. Si una salvaguarda impide un paso (no leer el
  valor de un secreto), se automatiza en un script revisado del repositorio que
  lo hace sin mostrar el valor (`scripts/rotar-ingesta.sh`), y lo corre Claude
  con confirmación. Lo único de Andres es lo que el sistema exige a una persona:
  aprobar el Environment `production`, Meta, un teléfono.
- **Alta de un cliente:** seguir `docs/alta-cliente/RUNBOOK.md`. El flujo
  guardado `/alta-cliente` lo recorre por etapas con los agentes `alta-cliente`,
  `meta-whatsapp`, `plataforma` y `flujos-n8n`. Los agentes ejecutan lo que
  escribe en producción, en Meta o en GitHub **solo con confirmación humana**
  (`.claude/hooks/acciones-sensibles.sh`), y nunca leen el valor de un secreto.
- Los JSON de `Flujos/` son la fuente de verdad versionada. Tras editar en la
  interfaz de n8n, **exportar** (⋯ → Download) y reemplazar el archivo.
- En n8n cada cambio exige volver a pulsar **Publish** para que llegue a
  producción.
- n8n Community no comparte flujos entre usuarios: la cuenta de Andres es
  dueña de lo productivo; Silvana desarrolla e intercambia por export/import.
- Antes de dar algo por terminado, probarlo contra un teléfono real y
  reportar el resultado **real**, no el esperado.
- **Nunca editar a mano el flujo de un cliente.** Se edita el JSON versionado y
  se reaplica con `publicar-flujo.sh`. Hoy hay un flujo por cliente —lo obliga
  la credencial del disparador, porque cada app de Meta tiene un solo webhook—.
  Ver `Analisis/20`.
- **Un cambio se aplica PREFERENTEMENTE A TODOS, y toda excepción se registra**
  (Andres, 24/09/2026; antes decía «a todos o a ninguno»). El motivo del cambio
  es que empezamos a sacar **productos empaquetados**: un cliente puede quedarse
  a propósito en una versión —porque compró un paquete, porque está en una
  prueba, porque su pase a producción viene después—, y una regla absoluta
  obligaba a mentir o a incumplirla en silencio, que es peor.
  - **El riesgo que la regla vieja cubría sigue existiendo:** un cliente con el
    prompt viejo es un defecto que nadie nota hasta que reclama. Lo que cambia
    no es la vigilancia, es que ahora la diferencia se **declara** en vez de
    prohibirse.
  - **Dónde se registra:** `docs/versiones-por-cliente.md`, una fila por flujo
    publicado, con la excepción y su porqué. Sin fila, un cliente atrasado es un
    defecto, no una excepción.
  - **Cómo se comprueba:** `./scripts/estado-de-versiones.sh` compara cada flujo
    vivo con el versionado y falla si hay un atraso **sin declarar**. Se corre
    antes de dar por cerrada una jornada que haya publicado algo.
- **Worktrees dentro del proyecto, ramas desde `origin/main`.** Cada bloque
  trabaja en `.claude/worktrees/<nombre>/`, en una rama nacida de
  `origin/main` (los worktrees de agentes no parten de la rama de la sesión),
  con un PR por bloque contra `main`. Nunca se cambia de rama en la carpeta
  principal, nunca `git add -A`, nunca un empujón forzado sobre una rama
  publicada. Cada PR declara su costo en tres unidades (mensajes por
  conversación, escrituras en GitHub y corridas de CI, escrituras en la nube)
  y pasa por el agente `seguridad` antes del OK de fusión.
- **El estado se genera; lo que se decide se anota.** `ESTADO.md` es de una
  pantalla y se reescribe; la bitácora del mes (`bitacora/<aaaa-mm>.md`) es
  solo para agregar; `./scripts/estado-generado.sh` imprime la etiqueta viva,
  las Functions desplegadas, los flujos publicados con su versión y los
  tenants con su modalidad.
