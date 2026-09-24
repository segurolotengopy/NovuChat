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
| Demo A (agendamiento) | `.env` | `Flujos/demo-a-agendamiento.json` | — |
| Clínica Platinum (reservas) | `.env.platinum` | `Flujos/platinum-agendamiento.json` | — |
| Dr. Bellido (pediatría) | `.env.bellido` | `Flujos/bellido-agendamiento.json` | — |
| Demo B (venta y cobro) | `.env.demo-b` | `Flujos/demo-b-venta-cobro.json` | **Vivo en `1f2938c`; le falta el cobro por QR de `7988cdf` (PR #165).** Distinto: 7 nodos cambiados, 16 nuevos y `Enviar QR (imagen DEMO)` renombrado. **Por qué:** el flujo nuevo necesita las Functions de ese PR, que no están en ninguna etiqueta (la última es `v0.7.0`, 22/09); sin ellas el cierre de venta no se registra nunca. **Lo cierra:** la etiqueta que despliegue `ac17cad`, y después publicar desde `main` y probar con teléfono real en simulado. Ver «Estado» |
| NovuChat (captación) | `.env.novuchat` | `Flujos/novuchat-onboarding.json` | — |
| Demo A (recordatorios) | `.env.recordatorios` | `Flujos/demo-a-recordatorios.json` | — |
| Platinum (seguimientos) | `.env.platinum-seguimientos` | `Flujos/agendamiento-seguimientos.json` | — |
| Platinum (señas vencidas) | `.env.platinum-senas` | `Flujos/agendamiento-senas-vencidas.json` | — |

> El guion `—` significa **sin excepción**: ese flujo tiene que estar al día con
> su JSON versionado, y el script falla si no lo está.

## Estado al 24/09/2026

Los tres flujos de reservas —Demo A, Platinum y Bellido— se publicaron el 24/09
con el arreglo del día de la semana (PR #170) y las dos protecciones del PR
#171 (la ventana del calendario y el audio). Ninguno tiene excepción declarada:
los tres deben seguir el vertical.

**El Demo B tiene la única excepción, y no es un paquete: es un orden de
despliegue.** El flujo vivo coincide nodo por nodo con `1f2938c` (23/09, el
pedido del catálogo en la memoria); lo único que le falta de `main` es
`7988cdf`, el cobro por QR de Platinum portado a venta (PR #165, fusionado el
23/09 07:30). Los siete nodos que marca el script —`AI Agent NovuChat`,
`Config del negocio`, `¿Hay comprobante?`, `Normalizar entrada`, `Procesar
respuesta`, `¿Responder ahora?`, `Texto enviado`— salen todos de ese commit.

No se publica todavía porque ese flujo le pide al servidor algo que el servidor
desplegado no tiene. En `7988cdf` el cierre de venta pasó a nacer de un hecho:
`pagoDeclarado` exige que `configuracionFlujo` devuelva `cobro.pendiente`, y ese
campo solo lo arma `cobroVenta.ts`, que no está en `v0.7.0`. Publicado antes que
las Functions, el asistente seguiría poniendo los rótulos de simulado —el fallo
por omisión cae del lado del rótulo—, pero **ningún pago simulado volvería a
registrar su cierre**, sin un solo error a la vista. Además `Reportar QR
(saliente)` le mandaría `qr_enviado` a una ingesta que solo lo sabe tratar como
seña de reserva.

**La cierra, en este orden:** (1) una etiqueta que contenga `ac17cad` y el
despliegue de Functions (`configuracionFlujo`, `ingesta`, `cotejarComprobante`,
`imagenDeCobro`); (2) publicar el flujo desde un worktree en `origin/main`,
leyendo entero el diagnóstico en seco; (3) la prueba con teléfono real, en
simulado. Con eso la fila vuelve a `—`.

Ningún comercio está en modalidad `produccion` todavía, así que la
[ventana de mantenimiento de 02:00 a 03:00](contrato/anexo-tecnico-sla.md) no
condiciona cuándo se publica.
