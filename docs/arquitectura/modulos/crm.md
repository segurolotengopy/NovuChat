# Módulo miniCRM (`crm`)

> Módulo NUEVO del core (plan del 28/10/2026, `NOVUCHAT_plan-minicrm-todos-los-clientes`).
> Este documento es el contrato del PR-A; el flujo (PR-B), la cuenta de servicio
> (PR-C) y los recordatorios (PR-D) lo cumplen después. Sin secretos ni ids.

## Qué es

La ficha de cada contacto en una Hoja de Google NATIVA del cliente. **Opcional,
activo por defecto, apagable por tenant.** Es un módulo común (como Productos y
Campañas): sin la lista `tenants.modulos` está encendido; con lista, solo si
`crm` está en ella. Además, `config/crm.activo: false` lo apaga: el flujo no
escribe y Google ni se consulta. Documento ausente o sin `activo` = encendido.

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
- Un texto del cliente final que empiece con `= + - @` se neutraliza
  (`neutralizarTexto`). **Sin datos de salud ni comprobantes en la hoja.**

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
