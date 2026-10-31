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
| **Qué contiene** | `functions/src/modulos/crm/{crm,columnas}.ts` (PR-A) |
| **Depende de** | — |
| **Configuración** | `config/crm`. Comercio (lista blanca): `activo`, `moneda` (1 a 5 caracteres), `listas` (`etapas`, `origenes`, hasta 20 cada una). Solo servidor: `hoja`, `filaEncabezados`, `mapaColumnas`, `cuentaServicio` (nombre lógico `crm-<tenant>`, nunca una clave), `recordatorios` (`{activo}`, ausente = apagado) |
| **Colecciones / límite / pestañas** | ninguna / ninguno / ninguna por ahora |
| **Ganchos / Functions / herramientas** | ninguno (PR-A) |
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

**Quién lo incluye (PR-B2, 31/10/2026).** `chat-novuchat` (PR-B) y `captacion-minima` (PR-B2): ninguno lleva copias del código. Captación mínima trae el mismo mapa que NovuChat como dato de su tenant (`admin/scripts/datos/captacion-minima/novuchat.json`, clave `crm`; el ensayo lo hereda). Delta de Captación mínima, declarado y negado en `admin/pruebas/modulos/crm/crm-captacion-minima.test.ts` contra su decidir-fila anterior congelado como oráculo: `seguro` estricto (quita todos los bloques de signos de fórmula del comienzo) y, con dos filas del mismo teléfono, se actualiza la MÁS RECIENTE. Tercer cambio, de control: los encabezados se comparan en orden y letra por letra antes de escribir (columnas de más o movidas dan `encabezados_distintos`). «Leer IDs» corre una sola vez (`executeOnce`) aunque la búsqueda devuelva varias filas. Mensajes por conversación: 0. Sin publicar.

**Limitaciones conocidas.**
- En una fila NUEVA solo se comprueba el encabezado de la columna A: leer la fila de
  encabezados completa en el alta queda para un PR posterior, para no leer más hoja.
- `crm.activo = false` no se puede activar todavía: `configuracionFlujo` no devuelve
  `config/crm` hasta el PR-B3. Hasta entonces el módulo siempre está encendido.
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
- `crmClasificar({aceptoAgendar, pidioUbicacion, pidioLlamada, llegoPorAnuncio, preguntoPrecioYCerro, noEsPaciente})`:
  `No es lead` (no es paciente, gana a todo) > `Caliente` (aceptó agendar, pidió ubicación o que lo llamen) >
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
