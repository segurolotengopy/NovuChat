# Módulo miniCRM (`crm`)

> Módulo NUEVO del core (plan del 28/10/2026, `NOVUCHAT_plan-minicrm-todos-los-clientes`).
> Este documento es el contrato del PR-A; el flujo (PR-B), la cuenta de servicio
> (PR-C) y los recordatorios (PR-D) lo cumplen después. Sin secretos ni ids.

## Qué es

La ficha de cada contacto en una Hoja de Google NATIVA del cliente. **Opcional,
activo por defecto, apagable por tenant.** No es un módulo común y **no depende de la
lista `tenants.modulos`**: tiene UN SOLO
interruptor, `config/crm.activo`. `activo: false` lo apaga: el flujo no escribe y
Google ni se consulta. Documento ausente o sin `activo` = encendido. No está en
`MODULOS_COMUNES_HOY` y la regla de escritura solo exige admin del tenant
operativo.

## Manifiesto

| Campo | Valor |
|---|---|
| **Qué contiene** | `functions/src/modulos/crm/{crm,columnas}.ts` (PR-A) y, desde el 03/11/2026, `editores-crm.ts` + `editoresCrm.ts` (edición por Gmail) |
| **Depende de** | — |
| **Configuración** | `config/crm`. Comercio (lista blanca): `activo`, `moneda` (1 a 5 caracteres), `listas` (`etapas`, `origenes`, hasta 20 cada una). Solo servidor: `hoja`, `filaEncabezados`, `mapaColumnas`, `cuentaServicio` (nombre lógico `crm-<tenant>`, nunca una clave), `recordatorios` (`{activo}`, ausente = apagado) |
| **Colecciones / límite / pestañas** | `editoresCrm` (solo servidor) / `editoresCrm` (del plan, en el servidor) / ninguna por ahora |
| **Ganchos / Functions / herramientas** | Functions `registrarEditorCrm`, `quitarEditorCrm`, `consultarMiEdicionCrm`; el gancho de `quitarUsuario` lo arma `ganchos.ts` |
| **Mensajes por conversación** | **0**. Escribir en la hoja no envía WhatsApp; lo demuestra `registro.test.ts` (`mensajes: 0`) |
| **Pruebas** | `pruebas/modulos/crm/crm.test.ts` (puras) y `crm-reglas.test.ts` (emulador, negando) |

## Quién escribe qué

- **Hoja, columnas del bot**: ID, Fecha, Nombre, Empresa, Teléfono, Etapa inicial,
  Origen, Calificación, Resumen, y las 6 nuevas SOLO del bot (Última interacción,
  Etapa sugerida, ID de campaña, No contactar, Última actualización del bot,
  Estado del recordatorio).
- **Columnas del equipo, que el bot NUNCA pisa**: Valor, Responsable, Estado,
  Próxima acción y Diagnóstico del equipo (PR-E). `columnasEscribibles(mapa)` devuelve solo las del bot.
  Excepción declarada: la etapa inicial y el estado inicial se escriben SOLO al crear la fila.
- **config/crm**: el comercio (admin) escribe lo suyo; lo demás, solo el servidor.
- **enlaces/minicrm** (`enlaceHoja`, 03/11/2026): la URL de la hoja del comercio (`https://docs.google.com/spreadsheets/d/<id>`, validada por `functions/src/central/enlace-minicrm.ts`). La lee SOLO el admin de ese comercio (vive fuera de `config/` porque la lectura de `config/` es de todo miembro; un operador, otro comercio y el propietario desde la Consola no) y NADIE la escribe desde un cliente: la escribe NovuChat con `scripts/plataforma/crm-enlace.mjs` (seco por omisión; `--aplicar` con respaldo, un comercio por corrida, producción con `--confirmo-produccion`). Registrado en `DOCUMENTOS_DE_ENLACES_SOLO_SERVIDOR` (`registro.ts`) y probado en `registro.test.ts` y `crm-reglas.test.ts`.
- Un texto del cliente final que empiece con `= + - @` (tras quitar controles,
  caracteres de formato como U+200B y espacios, NBSP incluido) se neutraliza
  (`neutralizarTexto`) **anteponiendo un apóstrofo `'`**. Consecuencia para el
  PR-B: escribir con `valueInputOption: USER_ENTERED` (el apóstrofo queda como
  prefijo de texto y no se ve); con RAW el apóstrofo sería visible, y en
  teléfonos (que empiezan con `+`) habría que quitarlo o guardarlos como texto. **Sin datos de salud ni comprobantes en la hoja.**

## Reglas de negocio para el PR-B (contrato fijado por Andres)

1. **Contacto nuevo** = sin mensajes en las últimas 48 h (`HORAS_CONTACTO_NUEVO`).
2. Se actualiza la fila **más reciente** del teléfono.
3. **Un negocio por fila.**
4. No se tocan las columnas del equipo.
5. Una credencial y una hoja por cliente: el flujo de A nunca usa lo de B.

## Qué NO hace (PR-A)

No hay nodo de flujo, ni cuenta de servicio, ni lectura o escritura en Google,
ni recordatorios, ni pestaña en la consola. Nada de eso se enciende por tener el
manifiesto.

## Orden

PR-A (este: manifiesto, `config/crm`, reglas, pruebas) → PR-B (módulo de flujo
en `Flujos/src/modulos/crm/`, común a `captacion-minima` y `chat-novuchat`, una
sola implementación incluida) → PR-C (cuenta de servicio `crm-<tenant>`) →
PR-D (recordatorios, apagados por defecto).

## El flujo (PR-B, 30/10/2026): mapa de columnas y limitaciones

**Código.** `Flujos/src/modulos/crm/{crm.js,nodo-prospecto.js,nodo-decidir-fila.js}` y el armador `Flujos/experimental/comun-sin-agente/construir-crm.mjs` (fuera de `Flujos/src`: el ensamblador solo admite js, md y json allí)
se INCLUYEN en los flujos por paquetes (`crm-prospecto`, `crm-decidir`), nunca se
copian. Cómo se califica y se resume lo pone el flujo como adaptador (hoy
`Flujos/src/modulos/captacion/crm-captacion.js`): el módulo no lo importa, su
ruta se la pasa el `construir.mjs` de cada flujo a `rutasPaquetesCrm(ruta)`.

**D1. Dónde vive el mapa.** Es DATO del tenant, en el archivo de datos del flujo
(`admin/scripts/datos/<flujo>/<tenant>.json`, clave `crm`), validado al construir
con el mismo `crmValidarMapa` que corre en n8n. `config/crm.{hoja,filaEncabezados,mapaColumnas}`
queda RESERVADO sin lector: ningún flujo lo lee todavía.

**D2. Formato.**
`crm: { filaEncabezados, prefijoId, primerId, columnas: {campo: {letra, titulo}}, equipo: {valor|responsable|estado|proximaAccion: {letra, titulo} | null}, extrasDelEquipo: {letra: titulo}, alCrear: {etapaInicial, origen, origenAnuncio[, estado]} }`.
Reglas: las 4 claves de `equipo` se declaran siempre (columna o `null`); las letras
(A a Z) y los títulos no se repiten; de A a la última letra del bot solo hay columnas
del bot, sin huecos (lo del equipo va después); `prefijoId` no empieza con `-`;
`alCrear.estado` (p. ej. «Activo») se escribe SOLO al crear la fila.

**Relleno histórico (03/11/2026).** `admin/scripts/plataforma/relleno-crm-historico.mjs` crea una fila por cada contacto anterior de UNA subcuenta
(Evy, Emma, Rubén o Antonio) en su hoja: seco por omisión (solo conteos), idempotente por teléfono, respaldo antes de escribir y `--revertir`.
Solo escribe campos que existen y vocabulario cerrado (calificación y clasificación VACÍAS = sin evaluar, resumen fijo); no lee el texto de ningún
mensaje ni la columna U. La hoja se lee y escribe por un flujo temporal de n8n con la credencial `crm-<tenant>` (la cuenta no tiene clave local).

**Empezar de nuevo un comercio (04/11/2026).** Tres herramientas de `admin/scripts/plataforma/`, todas en seco por omisión, con `--confirmo-produccion`, respaldo fuera del repositorio y lista cerrada: `vaciar-chats-tenant.mjs` (Firestore: `conversaciones` con `mensajes`/`privado`, y `contactos`; nunca `metricas`, `config`, pedidos ni pagos), `vaciar-memoria-flujo.mjs` (n8n: solo `staticData.global.rroca`, nunca `--reiniciar-estado`) y `vaciar-hoja-crm.mjs` (hoja `Leads_CRM`, solo A4:T de datos; nunca encabezados, fórmulas, Dashboard, Kanban ni la columna U). Prueba: `pruebas/plataforma/vaciar-comercio.test.ts`.

**Limitaciones conocidas.**
- En una fila NUEVA solo se comprueba el encabezado de la columna A: leer la fila de
  encabezados completa en el alta queda para un PR posterior, para no leer más hoja.
- `crm.activo = false` (PR-B3): `configuracionFlujo` lee `config/crm` en cada turno y, si existe con
  `activo` booleano, devuelve `crm: { activo }` (`crmParaElFlujo`, `modulos/crm/crm.ts`); nunca los campos
  reservados del servidor. Sin documento o sin booleano la respuesta es la de siempre y el módulo sigue
  encendido. `moneda` y `listas` de `config/crm` todavía NO llegan al flujo (solo `activo`). Costo: una lectura de documento por turno, 0 mensajes por conversación. Los flujos con la rama
  (`Prospecto para la planilla`) ya lo leen; ningún flujo vivo se republica con este cambio.
- Con `returnFirstMatch: false` las ejecuciones de n8n guardan todas las filas A a J
  del mismo teléfono (datos de esa sola persona). En la plantilla de las subcuentas el rango A..T incluye las columnas del equipo J..M (valor, responsable, estado, próxima acción): quedan en el historial de ejecuciones, no se escriben ni deciden nada. PR-F debe partir la lectura en dos rangos (A..I y N..T) o limitar la retención de ejecuciones de esos flujos.
- `Leer IDs de la planilla` corre una vez por coincidencia.

## La planilla de las subcuentas (PR-E, 31/10/2026)

Plantilla `NOVUCHAT_miniCRM_IA` (hoja `Leads_CRM`, encabezados en la fila 3), una copia por subcuenta.
Columnas: A ID, B Fecha, C Nombre, D Empresa, E Teléfono, F Etapa, G Origen, H Calificación IA, I Resumen
(del bot, F solo al crear); J Valor, K Responsable, L Estado (solo al crear), M Próxima acción (del equipo);
**N Clasificación, O Qué pidió, P Día preferido, Q Horario preferido, R Derivación a recepción,
S Última interacción, T Se cierra la ventana de 24 h** (del bot); **U Diagnóstico del equipo** (del equipo).

**Contrato de columnas (`COLUMNAS_V1`).** Campos nuevos del bot: `clasificacion`, `quePidio`, `diaPreferido`,
`horarioPreferido`, `derivacion`, `ventana24h` (más `ultimaInteraccion`, que ya existía); del equipo:
`diagnostico`. Todos opcionales en el mapa: `interes` también pasa a opcional (la plantilla no trae «Rubro»);
sin los campos nuevos la salida de `crmDecidirFila` es idéntica a la de antes (el oráculo `decidir-fila-antes.js` lo prueba).

**Reglas en código, no en el modelo** (`crm.js`):
- `crmClasificar({aceptoAgendar, pidioUbicacion, pidioLlamada, inicioCompra, llegoPorAnuncio, preguntoPrecioYCerro, noEsPaciente})`
  (`inicioCompra`, 02/11/2026, decisión de Andres: señal neutra para quien vende en vez de agendar; el flujo emitió un cobro o recibió un comprobante; los flujos que no la traen no cambian):
  `No es lead` (no es paciente, gana a todo) > `Caliente` (aceptó agendar, pidió ubicación, pidió que lo llamen o inició la compra) >
  `Frío` (preguntó el precio y cerró) > `Tibio` (llegó por anuncio o escribió y no avanzó). Solo `=== true` cuenta.
- `crmPrioridad(clasificacion)`: Alta, Media, Baja o N/A (función pura; la planilla no tiene columna de prioridad).
- `crmVentana24h(ultimaInteraccionMs)`: última interacción + 24 h; se escribe en hora de La Paz («AAAA-MM-DD HH:MM»).
- El prospecto trae, todos opcionales: `senales`, `quePidio`, `diaPreferido`, `horarioPreferido`, `derivacion`
  (`true` = «Sí», `false` = «No», un texto = ese texto acotado a 80, otro tipo = nada), `ultimaInteraccionMs`, `nombreDePerfil`.
  Si `nombreDePerfil` es `true` y la celda ya tiene nombre, no se pisa.
- **Clasificación al actualizar:** «No es lead» se escribe SIEMPRE (está fuera de la escala); las demás suben y no bajan;
  si `senales` no trae ninguna señal verdadera no se toca la de una fila ya clasificada (el Tibio por defecto no pisa
  Frío ni Caliente). Una fila ya «No es lead» solo vuelve a lead por una señal Caliente (aceptó agendar, pidió ubicación o pidió que lo llamen). En una fila nueva sin señales queda Tibio.
- **Textos libres** (`quePidio`, `diaPreferido`, `horarioPreferido`): solo un `string`; `false`, números, objetos y
  listas dan vacío y no se escriben (jamás «false» ni «[object Object]»). Se acotan (200, 60 y 60) y se neutralizan
  (apóstrofo, `USER_ENTERED`).
- **Fechas** (`ultimaInteraccion`, `ventana24h`): el prospecto trae milisegundos entre 2020 y 2100 (segundos, NaN o
  fuera de rango = no se escribe). Al **crear** se escriben como texto con apóstrofo (`USER_ENTERED`, el apóstrofo no se ve);
  al **actualizar** van **sin apóstrofo** (el nodo `Actualizar fila` escribe RAW y el apóstrofo quedaría visible: ningún
  valor de una actualización lo lleva). Formato `AAAA-MM-DD HH:MM` **hora de La Paz** (UTC-4 fijo; 02:30 UTC del 01/11 es `2026-10-31 22:30`).
- **Costo de escritura:** `ultimaInteraccion` cambia en cada turno, así que cada mensaje del cliente cuesta UNA
  escritura a Google (actualizar la fila). Mensajes de WhatsApp agregados: 0.

**Mapa relajado.** Las columnas del bot ya no son contiguas. La validación exige letras y títulos sin repetir
(así un campo del bot nunca cae sobre una letra del equipo), y que todas las letras de A a la última del mapa
estén declaradas (bot, equipo o extras), sin huecos. El bot solo escribe las letras de sus campos. La
comparación de encabezados es letra por letra de A hasta la última del bot (las del equipo en medio incluidas); lo
que se lea después (p. ej. U) debe ser lo declarado, en orden, y cualquier otra cosa es «columnas de más».
`equipo.diagnostico` es opcional; las otras cuatro claves del equipo se declaran siempre (columna o `null`).

**Pruebas.** `pruebas/modulos/crm/crm-planilla.ts` (importado por `crm.test.ts`): los 6 leads del plan como tabla,
mapa no contiguo, encabezados del equipo movidos, y negaciones sobre F, J, K, L, M y U. **Mensajes por conversación: 0.**

**Lo que queda para PR-F:** el injerto (`construir-crm.mjs`) fija hoy el rango de lectura en A a la última del
bot (A..T en la plantilla; la U no se lee, que es lo que tolera la comparación); NO ampliarlo a la U ni a ninguna columna del equipo posterior (Diagnóstico puede llevar datos de salud y quedaría en el historial de n8n; una prueba debe fallar si el rango incluye la letra de `equipo.diagnostico`); comprobar la fila de encabezados completa antes de AGREGAR una fila nueva (hoy solo se comprueba la A), y que
`chProspecto` devuelva `senales`, día, horario, qué pidió y derivación.

**PR-F0 (31/10/2026), hecho en el módulo.** `crmVerificarEncabezados` (con la lectura `Leer encabezados de la planilla`, rango
`A{fila}:{ultima del bot}{fila+1}`) exige la fila de encabezados completa antes de AGREGAR; lectura vacía = no agrega (la hoja necesita una fila de datos).

**Corrección del ensayo del 02/11/2026: la comprobación lee SOLO la fila de encabezados.** Con la lectura de Sheets de dos filas, si la primera fila de datos
tenía celdas finales vacías, n8n omitía esas claves y la comprobación fallaba cerrada: **no escribía nunca** (el ensayo con la hoja de prueba lo mostró). Ahora
«Leer encabezados de la planilla» es una consulta a la API de Sheets (`values.get`, `A{fila}:{ultima del bot}{fila}`, con la misma credencial del tenant) y
`crmVerificarEncabezados` compara los títulos de esa fila, en orden y sin sobrantes. No depende de la fila 4. Fila vacía, ilegible, con un título de menos, renombrado
o de más, o una lectura fallida = no agrega. La forma anterior (claves de la primera fila de datos) sigue aceptada por compatibilidad, pero solo la usan flujos sin ese nodo.
`hallazgosCrm` exige el nodo `httpRequest` con la URL exacta y el rango sin llegar a la letra del diagnóstico. Sin cambio en captación/chat (no tienen ese nodo). 0 mensajes.
`adaptador-senales.js` define el contrato `CRM_ADAPTADOR = {calificar, resumir, prioridad}` (validado por `crmAdaptadorValido`; inválido = `adaptador_invalido`):
Caliente = Alta, Tibio = Media, Frío = Baja, No es lead = Descalificado; el resumen usa solo marcas fijas («Marcado como no lead.», «Derivado a recepción.», «Escribió por WhatsApp.»): el texto libre del cliente (qué pidió, día, horario) va a sus propias columnas y no se copia al resumen. `hallazgosCrm` lo exige el CI sobre cada JSON versionado con miniCRM (`pruebas/modulos/crm/crm-hallazgos-flujos.test.ts`: hay que agregar ahí cada flujo nuevo); `ramaCrm` solo acepta la credencial `@@cred:crm`; la retención exige también `saveManualExecutions: false`. Con ese paquete la lectura de encabezados es
obligatoria; captación y chat siguen con su adaptador y sin esa lectura (misma salida: oráculo en verde). En `construir-crm.mjs`: `ramaCrm` (8 nodos generados,
la credencial llega como token `@@cred:`), `hallazgosCrm` (rango que llega a la letra de `equipo.diagnostico` o pasa de la última del bot, retención distinta de
`none`) y `rutasPaqueteCrmSenales`. Aún sin conectar a ningún flujo de cliente (F1 a F4). Verificar contra `node-definitions` de n8n 2.36.5 el nodo Switch 3.2 de
`ramaCrm` en F1. Mensajes por conversación: 0. Pruebas: `admin/pruebas/modulos/crm/crm-f0.test.ts`.

**PR-F1 (31/10/2026), Evy (`rroca-evy`).** Primer flujo de cliente con la rama de señales: `ramaCrm` (8 nodos, 45 -> 53 en producción y 40 -> 48 en la prueba; tope subido por DP1, `docs/versiones-por-cliente.md`), mapa `crm` en los datos de Evy (A..I y N..T del bot, J..M y U del equipo; la U no se lee), `evProspectoCrm` en `ev.js` (vocabulario cerrado, sin «no es paciente», DP4) y `guardarPlanilla` en `armar-mensajes.js` (nunca con riesgo, baja, nada, suspendido, uso extendido, etapa de prueba ni id vacío; la variante de prueba lleva el id vacío). El Switch 3.2 de `ramaCrm` se verificó contra los `node-definitions` de n8n 2.36.5 (`rules.values[]` con `conditions` de la forma del IF v2, `outputKey`, `renameOutput`): coincide, sin cambios. El arnés `n8n-de-mentira.ts` ganó el caso `switch` (modo `rules`). Evy suma a `crm-hallazgos-flujos.test.ts`. Mensajes por conversación: 0. Pruebas: `admin/pruebas/tenants/rroca-evy/crm.test.ts`. Pendiente del ensayo: títulos de la fila 3 y formato de ID contra la copia viva de la planilla.

**PR-F4 (02/11/2026), Antonio (`rroca-antonio`).** La misma rama de 8 nodos y las mismas reglas que Rubén (64 y 59 nodos), con `raProspectoCrm` en su `ra.js`: `inicioCompra` (QR REAL emitido o comprobante recibido, en este turno o en la ficha vigente; lo simulado no cuenta) = Caliente; `pidioLlamada` = pidió hablar con Antonio (`hablar_con_antonio`); sin «Frío» ni «No es lead». `guardarPlanilla` nunca en modo prueba, con la puerta cerrada, con un número de otro país, en riesgo (violencia o miedo, tampoco con la protección ya activa en la ficha), en baja ni sin mensaje; la prueba lleva el id vacío. Mensajes por conversación: 0. Pruebas: `admin/pruebas/tenants/rroca-antonio/crm.test.ts`.

**PR-F3 (02/11/2026), Rubén (`rroca-ruben`).** La misma rama de 8 nodos (63 y 58 nodos) para un flujo que VENDE en vez de agendar. Señal nueva y neutra del módulo, `inicioCompra` (decisión de Andres, opción B): el flujo emitió un QR de cobro o recibió un comprobante, en este turno o en uno anterior (`pedidos`, `comprobanteMs` de la ficha); cuenta como Caliente. `pidioLlamada` = pidió hablar con Rubén; `llegoPorAnuncio` = trae la referencia de un anuncio. Sin «Frío» (no hay detector de rechazo y no se inventa uno) ni «No es lead» (lo marca el equipo). `rrProspectoCrm` en `rr.js`; `guardarPlanilla` nunca en modo prueba, con la puerta cerrada (suspendido, uso extendido, pausa por persona), con un número de otro país ni sin mensaje; la prueba lleva el id vacío. Mensajes por conversación: 0. Pruebas: `admin/pruebas/tenants/rroca-ruben/crm.test.ts`.

**PR-F2 (02/11/2026), Emma (`rroca-emma`).** Misma rama de 8 nodos y mismas reglas que Evy (53 y 48 nodos, DP1; mapa `crm` A..I y N..T del bot, J..M y U del equipo; `evProspectoCrm` en su `ev.js`; `guardarPlanilla` nunca con riesgo, baja, nada, suspendido, uso extendido, etapa de prueba ni id vacío; la prueba lleva el id vacío). Mensajes por conversación: 0. Pruebas: `admin/pruebas/tenants/rroca-emma/crm.test.ts` y Emma en `crm-hallazgos-flujos.test.ts`.

## Cuenta de servicio por cliente (PR-C)

**Qué resuelve.** Cada subcuenta tiene su planilla del miniCRM. Compartirlas todas con una sola cuenta
de servicio permitiría que el flujo de un cliente lea o escriba la hoja de otro. Por eso hay UNA cuenta
de servicio por tenant, `crm-<tenant>`, sin ningún rol (solo toca la planilla que se le comparte a mano
como editor), y una credencial de n8n por tenant cuyo nombre lleva el tenant
(`Google Sheets miniCRM (crm-<tenant>)`). La planilla de un cliente se comparte solo con su cuenta y con
personas del equipo, nunca «cualquiera con el enlace».

**Script.** `admin/scripts/plataforma/crm-cuenta-servicio.mjs` con los subcomandos `crear`,
`mostrar-correo`, `registrar-credencial-n8n`, `rotar` (clave nueva en la misma credencial, mismo id, y borra la vieja) y `quitar` (solo la baja del cliente). Seco por omisión (sin red ni credenciales);
escribe solo con `--aplicar --confirmo produccion`. El tenant se valida con regex (3 a 26 caracteres, sin
`--`, para que `crm-<tenant>` quepa en los 30 de una cuenta de servicio). El proyecto de GCP se lee de
`--proyecto` o de `CRM_PROYECTO_GCP`; nunca está escrito en el archivo. La clave privada se crea en un
directorio 700 de `/dev/shm` (si no existe, aborta con salida 2: nunca disco), se sube a n8n y se borra siempre (también ante SIGINT, SIGTERM y SIGHUP, salida 130); no pasa por stdout ni por el repositorio, y si no
llega a n8n se borra también de IAM. El correo de la cuenta no es secreto: `mostrar-correo` lo imprime
para comunicarlo a la subcuenta.

**Prueba.** `admin/pruebas/plataforma/crm-cuenta-servicio.test.ts` (en `puras`, sin red): rechaza
tenants inválidos, nombres o credenciales que colisionen entre tenants, una credencial de n8n ya
existente, una clave que no sea de la cuenta del tenant, y toda escritura sin `--confirmo produccion`;
comprueba que la clave no aparece en ningún mensaje. Mensajes por conversación: 0.

**Límite honesto.** El script impide que dos tenants compartan cuenta o credencial; lo que decide a quién
se comparte cada planilla lo hace una persona en Google. Runbook: `docs/runbook-crm-cuenta-servicio.md`.

**Requisito para PR-F (M3).** Que cada flujo use solo la credencial de su tenant no lo garantiza este
script. PR-F debe agregar una prueba de CI que recorra `Flujos/clientes/<tenant>/` y falle si un nodo
con credencial `googleApi` usa una distinta de «Google Sheets miniCRM (crm-<tenant>)». Mientras esa
prueba no exista, el aislamiento depende de revisión humana.

**Revisión de #733 (31/10/2026).** «Decidir fila» pide los IDs por nombre (`$('Leer IDs de la planilla')`), no por `$input`: con «Leer encabezados» en medio, `$input` son los encabezados y se repetirían los ID. `hallazgosCrm` exige ahora también ese origen, el nodo «Leer encabezados» con el paquete de señales y su conexión a «Decidir fila». **Decisión DP5 (aprobada por Andres):** la planilla debe tener al menos una fila de datos (la fila semilla); con la fila 4 vacía el bot no agrega filas nuevas y cierra en falla, a propósito. Los rangos que fija `ramaCrm` (`A3:J`, `A3:J4`) son provisorios: `injertarCrm` los reemplaza con el mapa del tenant y la prueba del injerto los exige.

**Botón «Abrir miniCRM» (03/11/2026).** El Tablero (`BotonMiniCrm`, zona Central) abre la hoja del comercio en otra pestaña. Aparece solo si quien mira es admin, `config/crm.activo` no es `false` y `enlaces/minicrm.enlaceHoja` es un enlace válido; si falta cualquiera, no se pinta nada. Mensajes por conversación: 0. Pruebas: `pruebas/modulos/crm/crm-enlace.test.ts` (enlace, condiciones del botón, script) y `crm-reglas.test.ts` (lectura/escritura de `enlaces/minicrm`, negando).

**Edición del miniCRM con la cuenta de Google: la interfaz (03/11/2026).** `EdicionMiniCrm` (Tablero, admin y operador) consulta `consultarMiEdicionCrm`; con estado `ninguno`/`revocado` ofrece «Habilitar mi edición»: carga Google Identity Services (`accounts.google.com/gsi/client`), muestra el botón de Google (su propio selector de cuenta), y el ID token viaja una sola vez a `registrarEditorCrm`; con `activo` muestra «Edición habilitada con <correo abreviado>» y «Abrir hoja» (el operador obtiene su enlace aquí; el admin conserva «Abrir miniCRM»); con `revocado_pendiente`, un aviso corto y «Quitar mi edición» (`quitarEditorCrm`). En Usuarios (solo admin) cada miembro muestra su estado (lee `editoresCrm`, que las reglas dejan al admin) con «Habilitar edición» (pide el token de ESA cuenta) y «Quitar edición». La cuenta de Google NO se vincula al usuario de Firebase ni inicia sesión: nada de `linkWith*`/`signInWith*`; el token no se guarda ni se imprime. Sin `VITE_GOOGLE_OAUTH_CLIENT_ID` (público) la función no se pinta, sin avisos. Los errores del servidor se mapean por código a textos propios (nunca crudos); el tope de editores lo informa el servidor. CSP de `admin/firebase.json` (solo el sitio de la consola): se agregaron `accounts.google.com/gsi/client` a `script-src`, `/gsi/style` a `style-src`, y `/gsi/` a `connect-src` y `frame-src`. Mensajes por conversación: 0. Pruebas: `pruebas/central/edicion-crm-pantalla.test.ts`.

## Edición de la hoja con el Gmail de la persona (03/11/2026, backend)

Plan: `NOVUCHAT_plan-edicion-minicrm-por-gmail_2026-11-03`. Esta sección es el servidor; la pantalla de la Consola está en el párrafo anterior.

**Hallazgo: no se vincula Google al usuario.** `core/seguridad/claims.ts` impone «una identidad, un proveedor»: admin y operador de comercio son solo contraseña, y las reglas y `esAdminDe`/`esOperDe` exigen `sign_in_provider == 'password'`. Vincular Google (`linkWithPopup`) rompería ese invariante. En su lugar el navegador obtiene un ID token de Google con una instancia de Auth aparte que no inicia sesión en la app, y el SERVIDOR lo verifica (`google-auth-library`, `OAuth2Client.verifyIdToken`): audiencia = `GOOGLE_OAUTH_CLIENT_ID` (variable de entorno leída con `process.env`, no parámetro de firebase-tools: un parámetro sin valor en el `.env` bloquea el despliegue no interactivo; ausente o vacía = falla cerrada), `email_verified === true` y el correo se toma DEL TOKEN, nunca del cuerpo.

**Decisiones de Andres (03/11/2026).** (1) El Gmail de edición es el del login; otro solo lo registra un admin, probado con el ID token de esa cuenta. (2) El operador puede pedir su propia edición, solo con su correo; el admin da de alta a terceros. (3) Tope único de 5 editores activos por comercio, **leído del plan** (`PLANES[plan].editoresCrm`, copia `cuenta.limites.editoresCrm` si es válida; `limiteDeEditoresCrm`): ningún callable lleva el número. (4) Sin vínculo de Google (arriba). (5) Nada contra producción en este PR.

**Dato.** `tenants/{t}/editoresCrm/{uid}`: `correoGoogle` (minúsculas), `estado` (`activo` | `revocado` | `revocado_pendiente`), `permisoId` y `archivoId` (para revocar del archivo donde se concedió, aunque el enlace cambie), `registradoPor`, `desde`, `verificadoPor` (`token-google` | `admin`). Reglas: `get` para el admin del comercio o el propio uid (persona del negocio); `list` solo admin; create/update/delete cerrados. Prueba negativa: `crm-editores-reglas.test.ts`.

**Callables** (onCall v2, autorización de siempre: contraseña + correo verificado):
- `registrarEditorCrm({ tenantId, idTokenGoogle, uidDestino? })` → `{ ok: true, estado: 'activo' }`. El operador solo sobre sí mismo (se decide antes de verificar el token); el destino debe ser miembro `activo`; el `fileId` sale SOLO de `tenants/{t}/enlaces/minicrm` del tenant autenticado (`esEnlaceDeHoja`); el miniCRM no puede estar apagado; un mismo Gmail no queda activo para dos personas; el tope se vuelve a contar dentro de una transacción.
- `quitarEditorCrm({ tenantId, uidDestino? })` → `{ ok, estado }`. Admin sobre cualquiera, operador sobre sí mismo. `ok: true` solo si Drive confirmó; con Drive caído queda `revocado_pendiente` (`ok: false`) y repetir la llamada reintenta. Nunca se informa «revocado» sin confirmación.
- `consultarMiEdicionCrm({ tenantId })` → `{ estado: 'ninguno' | 'activo' | 'revocado' | 'revocado_pendiente', enlaceHoja }`; el enlace solo con estado `activo` y el miniCRM encendido (es la vía del operador, que no lee `enlaces/minicrm`).
- Auditoría con `auditar`: `editor_crm_alta` y `editor_crm_baja` (uid, quién, correo abreviado `a***@dominio`, resultado).

**Drive.** Con la cuenta `crm-<tenant>` (proyecto de `CRM_PROYECTO_GCP`, o el de la Function): IAM Credentials `generateAccessToken` (alcance `drive`) suplantándola; `permissions.list` (reutiliza el permiso si ya existe), `permissions.create` con `role=writer`, `type=user`, `sendNotificationEmail=false` (jamás `anyone`/`domain`) y `permissions.delete` en la baja (404 = ya no existe). Costo por alta: 1 `generateAccessToken` + 1 `list` + 0 o 1 `create`; por baja: 1 `generateAccessToken` + 1 `delete`. Escrituras Firestore: 1 documento y 1 de auditoría por operación. **Mensajes por conversación: 0.**

**Revocación al quitar un usuario.** `central/usuarios.ts` exporta `crearQuitarUsuario(gancho?)` (y `quitarUsuario` sin gancho, para las pruebas de siempre); `ganchos.ts` arma la versión con `revocarEditorAlQuitarUsuario` y `index.ts` exporta esa. El gancho nunca lanza.

**Cierre de huecos (PR de seguimiento, 03/11/2026).** (a) *Cambio de correo*: `cambiar-correo.mjs` no habla con Drive; en el mismo lote que cambia las membresías deja a los editores vigentes de la cuenta en `revocado_pendiente` con `motivoPendiente: 'correo_cambiado'`, y la reconciliación borra el permiso. La persona vuelve a registrarse con su correo nuevo. (Si el script se reanuda con las membresías ya al día, no marca editores.) (b) *`config/crm.activo = false`*: el disparador `revocarEditoresAlApagarCrm` (`onDocumentWritten` sobre `config/crm`; solo actúa al pasar de encendido o ausente a apagado) revoca a todos; reencender no restituye accesos. Se eligió el disparador porque el cliente escribe ese documento por reglas y no hay callable por el que pase. (c) *Baja y suspensión*: `tenants.ts` exporta `crearBajaTenant(gancho?)` y `crearSuspenderTenant(gancho?)` (más las versiones sin gancho para las pruebas de siempre); `ganchos.ts` los arma con `revocarEditoresAlCerrarTenant` y `index.ts` exporta esas. Plataforma no importa módulos. El gancho nunca lanza y el cierre del negocio no depende de Drive. (d) *Reconciliación*: `reconciliarEditoresCrm` (`onSchedule`, minuto 17 de cada hora, La Paz, `maxInstances: 1`) recorre los negocios uno por uno y reintenta solo los `revocado_pendiente` de ese negocio con `revocarEditor` (idempotente); cuenta `reintentos` y, al llegar a `MAX_REINTENTOS_REVOCACION` (24, un día), deja de intentar y audita `editor_crm_reconciliacion_agotada` una vez (queda para `quitarEditorCrm` a mano). No usa estado fuera de Firestore. **Costo.** 0 mensajes por conversación; llamadas a Drive: una `permissions.delete` (más el token de IAM Credentials) por editor revocado y por cada reintento, hasta 24 por editor; una lectura de `tenants` por corrida horaria. **Huecos que quedan.** (e) Infraestructura sin tocar: Drive API habilitada, `GOOGLE_OAUTH_CLIENT_ID`, y `roles/iam.serviceAccountTokenCreator` de la cuenta de ejecución sobre cada `crm-<tenant>`.

**Correcciones de revisión (04/11/2026).** `registrarEditorCrm` exige dentro de la transacción que el negocio esté `activo` y el miniCRM encendido (si no, deshace el permiso y rechaza con `failed-precondition`). `revocarTodosLosEditores` marca `revocado_pendiente` (con `motivoPendiente` y `reintentos: 0`) ANTES de llamar a Drive, y el disparador de `config/crm` atrapa el error; la reconciliación horaria además revoca los `activo` de negocios suspendidos o dados de baja o con `crm.activo = false`, y su `try/catch` es por editor. `revocadoPor` y `revocadoEn` no se pisan si ya constan. **Decisión pendiente de Andres:** revocar al suspender obliga a re-registrar a cada editor al reactivar el negocio; se deja así hasta que él decida si se restituye.

**Pruebas.** `editores-crm.test.ts` (puras: verificador con certificados locales, cliente de Drive con `fetch` falso), `editores-crm-callables.test.ts` (emulador, Drive y token falsos, negando), `crm-editores-reglas.test.ts`, `editores-crm-seguimiento.test.ts` (emulador: baja, suspensión, apagado de `config/crm`, reconciliación y el texto del script de cambio de correo).

**Al encender la edición por Gmail: qué hay que cambiar en el despliegue (06/11/2026).** Hoy `GOOGLE_OAUTH_CLIENT_ID` y `CRM_PROYECTO_GCP` se leen con `process.env` (`admin/functions/src/modulos/crm/editoresCrm.ts`, funciones `audienciaGoogle` y `proyectoCrm`) y, si faltan, la edición queda apagada: el verificador rechaza con `sin_audiencia` (falla cerrada; #821, que hizo tolerante el despliegue a un CRM vacío). El despliegue de producción (`.github/workflows/ci-node-firebase.yml`, job `desplegar-produccion`) exige un `functions/.env` de exactamente dos nombres, `SITIO_PUBLICO` e `INSTANCIAS_MINIMAS=1`. Para encender la edición habrá que cambiar tres cosas juntas, en un mismo PR que lo declare: (1) el `printf` que escribe el `.env` de producción (`printf 'SITIO_PUBLICO=%s\nINSTANCIAS_MINIMAS=1\n' ...`), para agregar los dos nombres con valores del Environment; (2) la compuerta `diff` que sigue a ese paso (compara el `.env` completo contra el esperado y falla si difiere), para que espere el contenido nuevo; (3) la prueba `admin/pruebas/parametros-del-despliegue.test.ts`: «el .env de producción sigue siendo de exactamente dos nombres» y, probablemente, «NIEGA: los dos opcionales del miniCRM no vuelven a ser parámetros». Mientras no se haga, el `.env` de dos líneas y la edición apagada son lo correcto. El job de staging escribe su propio `.env` (con `CPU_FRACCIONARIA`) y no pasa por esa compuerta.

**Manuales de uso (10/11/2026).** Dos enlaces por comercio en `enlaces/`: `manual-operador` (lo lee toda persona del comercio) y `manual-admin` (SOLO el admin; las reglas lo niegan al operador, probado en `crm-reglas.test.ts`). Forma validada por `esEnlaceDeManual` (Docs, Slides, Sheets o archivo de Drive, https, dominios cerrados). Los escribe NovuChat con `scripts/plataforma/manual-enlace.mjs --rol operador|admin` (seco por omisión, respaldo, una escritura). La auditoría de solo lectura es `scripts/plataforma/auditar-enlaces.mjs`. El Tablero pinta `BotonesManual`. Mensajes por conversación: 0. El contenido de los manuales no lo define este módulo.
