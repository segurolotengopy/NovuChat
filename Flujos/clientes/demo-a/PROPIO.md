# Flujos del Demo A (`Flujos/clientes/demo-a/`)

> **Mudado el 25/11/2026** (`docs/arquitectura/mudanza.md`; decisión D2 de Andres): los dos JSON salieron de la raíz de `Flujos/` con `git mv`, sin cambiar un byte, y no se publicó nada. Esta carpeta solo contiene los dos JSON; el resto del Demo A vive donde ya estaba.

El Demo A es el número de ensayo de reservas (sin pacientes): el vertical de agendamiento con Google Calendar y su aviso de recordatorios.

## Qué hay aquí

| Archivo | Qué es | Cómo se arma |
|---|---|---|
| `demo-a-agendamiento.json` | El vertical de reservas (agente «Sofía», agenda, seña y QR) | Ensamblador: `admin/scripts/ensamblar-flujo.mjs verificar --exigir-manifiesto clientes/demo-a/demo-a-agendamiento.json` |

## Dónde vive el resto (no se movió)

- **Manifiestos:** `Flujos/manifiestos/clientes/demo-a/<flujo>.json`. El ensamblador los busca en `manifiestos/<ruta relativa a Flujos/>`; su campo `flujo` lleva esa ruta (`clientes/demo-a/…`).
- **Código de los nodos y prompts:** módulos comunes de `Flujos/src/` (`core/`, `modulos/agenda/`, `modulos/cobros/`) y `Flujos/prompts/reservas/demo-a.md`. Aquí no hay `src/` propio: el Demo A es la base común, no un cliente con piezas propias.
- **Publicación y ensayos:** `scripts/publicar-flujo.sh` (el Demo A es su flujo por defecto), `scripts/ensayo-flujo.sh` y `docs/ensayo/LEEME.md`.
- **Fila de versiones:** `docs/versiones-por-cliente.md` («Demo A (agendamiento)»).
- **Recordatorios, sin mudar (25/11/2026):** `Flujos/demo-a-recordatorios.json` sigue en la raíz. `.env.recordatorios` no tiene el acceso a n8n que exige el modo seco de `estado-de-versiones.sh` (paso 6 de `docs/arquitectura/mudanza.md`), y sin ese seco no se muda un flujo que puede estar vivo. Se muda cuando ese entorno esté completo.
- **Excepciones declaradas:** `admin/pruebas/core/migracion/excepciones.ts`, por el nombre del JSON (la identidad no depende de la carpeta).

## Ráfagas de textos (25/11/2026)

El agendamiento lleva la pieza común de ráfagas (`Flujos/src/core/rafaga/`, clave `rafaga` del manifiesto; diseño en `docs/arquitectura/rafagas.md`): ante 2 o más textos seguidos del mismo teléfono responde UNA ejecución con los textos unidos y las otras terminan sin enviar. **+4 nodos (82 → 86), tope autorizado por Andres el 25/11/2026 («Sí, +4 nodos por flujo»); 0 mensajes por conversación agregados, quita n-1 por ráfaga de n.** Espera de 2 s por defecto (`esperaRafagaSeg` de «Config base», 1 a 5); apagado por flujo con `rafagaActiva: false`; la bandera por comercio `rafagaApagada` la entrega el servidor y el `Config del negocio` común la propaga (#1135).

- **El ancla** es `¿Atención normal?` (salida normal) y el destino `¿Es un comprobante?`; va DESPUÉS de «Reportar mensaje (entrante)» (rama hermana más arriba que `¿Comercio operativo?`) y de todo desvío que responde por otra rama. `Normalizar entrada` es la fuente del id, el teléfono y el texto. Lo que se reporta y guarda sigue siendo el texto crudo de cada mensaje.
- **Desvíos** y qué pasa con cada uno (los fija `admin/pruebas/rafaga-demo-a.test.ts`): acuses de estado (`¿Es un mensaje?`: no entran, no dejan huérfano a nadie); comercio no operativo, y operador o bloqueado (uso extendido): antes del ancla, así que mientras el estado sea estable cada texto se contesta como hoy, sin espera. **Huérfano declarado:** si el estado CAMBIA entre dos textos de la misma ráfaga (el comercio se suspende, el teléfono pasa el umbral), el primero ya calló por el segundo y solo sale el aviso del desvío. Medios (`¿Es un comprobante?`, `¿Trae un medio?`): solo desvían imágenes, audios y documentos; la pieza no espera ni calla un medio y un medio entre dos textos los separa.
- **`Retomar respuesta`** vuelve a entrar con `textoDelTurno` si la pieza agrupó (sin eso el reintento tras un cruce de horario vería solo el último mensaje). Lo usa también el JSON congelado de Bellido, que no lo recibe hasta que su sesión lo adopte: `bellido-flujo.test.ts` quita la pieza del Demo A antes de compararlos.
- **Limitación: `Procesar respuesta` (core) mira solo el último texto** (`Normalizar entrada`) para los detectores de ubicación, contacto y despedida: en una ráfaga el modelo ve todos los textos, pero esos detectores solo el último.
- **`rafagaApagada` se propaga (#1135).** `Config del negocio` (core) copia `rafagaApagada` de la respuesta de `configuracionFlujo` (solo con `true` exacto y respuesta 200), así que la bandera por comercio apaga la pieza; la prueba de este flujo lo fija. Además se apaga por flujo (`rafagaActiva`).
- **Riesgos residuales** (declarados en `docs/arquitectura/rafagas.md` y fijados en la suite): 7 o más textos seguidos a menos de 1,5 s dejan sin respuesta a los más viejos; una consulta caída de la ejecución anterior duplica un texto (lado seguro); una consulta caída de quien debía responder pierde los textos que otros callaron.

## Lo propio y lo común

No hay piezas propias de un cliente: ambos flujos son el núcleo común (`Flujos/src/core/` y módulos) inyectado por el ensamblador. Los datos del negocio (nombre, horarios, calendarios) son del tenant, no de esta carpeta.
