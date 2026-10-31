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
  Próxima acción. `columnasEscribibles(mapa)` devuelve solo las del bot.
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

**Quién lo incluye (PR-B2, 31/10/2026).** `chat-novuchat` (PR-B) y `captacion-minima` (PR-B2): ninguno lleva copias del código. Captación mínima trae el mismo mapa que NovuChat como dato de su tenant (`admin/scripts/datos/captacion-minima/novuchat.json`, clave `crm`; el ensayo lo hereda). Delta de Captación mínima, declarado y negado en `admin/pruebas/modulos/crm/crm-captacion-minima.test.ts` contra su decidir-fila anterior congelado como oráculo: `seguro` estricto (quita todos los bloques de signos de fórmula del comienzo) y, con dos filas del mismo teléfono, se actualiza la MÁS RECIENTE. Mensajes por conversación: 0. Sin publicar.

**Limitaciones conocidas.**
- En una fila NUEVA solo se comprueba el encabezado de la columna A: leer la fila de
  encabezados completa en el alta queda para un PR posterior, para no leer más hoja.
- `crm.activo = false` no se puede activar todavía: `configuracionFlujo` no devuelve
  `config/crm` hasta el PR-B3. Hasta entonces el módulo siempre está encendido.
- Con `returnFirstMatch: false` las ejecuciones de n8n guardan todas las filas A a J
  del mismo teléfono (datos de esa sola persona, sin columnas del equipo).
- `Leer IDs de la planilla` corre una vez por coincidencia.
