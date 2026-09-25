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
| Demo B (venta y cobro) | `.env.demo-b` | `Flujos/demo-b-venta-cobro.json` | — |
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
