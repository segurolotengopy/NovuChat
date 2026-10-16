# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-10-16, sobre `origin/main` `dd3ab137`. La
versión anterior de este archivo era del 03/10 y estaba atrasada; el detalle de
esos días sigue en `bitacora/2026-10.md`. Asiento de hoy en la bitácora.

## En producción

- **Consola y Functions:** `v0.15.2` (`712bb490`, 12/10). Las tres etiquetas
  `v0.15.x` terminaron `desplegar-produccion` en verde en GitHub Actions.
  - `v0.15.0` (`fcd39fab`): visor de comprobantes (`verComprobante`) y H1 de
    Conversaciones: normalización, reglas e índices, pantalla nueva detrás de la
    bandera `consolaConversaciones`, y el carrito web que escribe los derivados.
  - `v0.15.1` (`9f351f28`): scripts de bandera y relleno de Conversaciones y el
    cierre por ganchos de la frontera (#439).
  - `v0.15.2` (`712bb490`): la ingesta escribe los campos derivados y se exporta
    la callable `buscarConversaciones`. Detalle: `docs/arquitectura/conversaciones.md`.
- **Flujos de n8n:** la tabla viva es `docs/versiones-por-cliente.md`. Q'Taco
  (cliente real, abrió al público el 08/10) corre «Venta mínima v0»; Bellido,
  «Agenda mínima v0»; la captación de NovuChat, el chat v2 (publicado el 10/10).
  Los cambios del chat v2 de #494 y #499 están en `main`; **si ya se publicaron
  en n8n no consta aquí**: correr `./scripts/estado-de-versiones.sh`.
- **No verificado desde el repositorio** (lo opera Cartera): si los tres índices de
  Conversaciones están `READY`, si se concedió el invocador de
  `buscarConversaciones`, y si la bandera `consolaConversaciones` o el relleno se
  aplicaron en algún comercio. Hasta que alguien lo confirme, la pantalla nueva
  se da por apagada en todos.
- **Rojos aceptados** (verificados el 03/10, sin revalidar): el ruleset de `main`
  sin revisor obligatorio, sin ruleset de etiquetas `v*` y sin GitHub Releases.

## En `main`, sin etiquetar

18 commits sobre `v0.15.2`, cuatro fusiones: #495 (Cobros: los contadores leen
métricas y `config/venta` por separado), #497 (Central: la tarifa de la cuenta,
`estandar | meta_incluido`, y el catálogo 200/500/1.000; PR-1 del bloque 1), #498
(Plataforma: el pase, el selector de plan y los encabezados leen las
conversaciones de la tarifa; PR-4a) y #499 (chat v2, pitch). Más los textos de
bolsas y BYOC en `docs/base-comercial.md` y `limites.md`. En producción el servidor
sigue cortando en 100/220/500 (bitácora del 11/10) hasta la etiqueta del bloque 1.

## Obra

- **H1 de Conversaciones: completa en `main`** (H1-1 a H1-6); este cierre es H1-7
  (documentación y suites puras). Falta solo operarla en Q'Taco (Cartera).
- **H2 «intervención de una persona» (texto): en construcción.** Contrato único
  del 16/10 (fuera del repositorio, en `~/CLAUDE_DESCARGAS/`); resumen en
  `docs/arquitectura/conversaciones.md` §12. Ola 1 en marcha: H2-1 (turno), H2-C
  (consola) y H1-7. No existe nada de H2 en `main`. Medios y plantilla fuera de
  ventana son H3 y esperan una decisión de Andres.
- **Bloque 1 de planes y bolsas:** hechos PR-1 y PR-4a. Faltan PR-2, PR-3, PR-4b,
  PR-5, PR-D y la etiqueta (según el informe de la coordinadora del 16/10).
- **Bloque 2 de Core:** seguimientos fuera de 48 h (`ultimoEntranteEn` ya existe)
  y recordatorios atados a una cita fuera del contador.

## Lo próximo, en orden

1. Terminar H2 de texto por olas (cada etiqueta que agregue Functions con su rama
   de reversión hacia adelante lista y probada **antes** de etiquetar).
2. Bloque 1 de planes y bolsas, bloqueante para vender la bolsa; después el bloque 2.
3. Operar Conversaciones en Q'Taco: índices `READY`, invocador, relleno y bandera,
   con la ventana 23:30–01:30 y el «sí» de Andres.
4. Traslado de Q'Taco a su WABA y cambio al relé de envíos (~07/11).

## Requiere a Andres (cada una con su «sí»; las corre Claude)

1. Decisiones del informe H2: medios guardados (bloquea H3), titularidad
   `novuchat` (BYOC o tope por conversación), topes de la persona, Q'Taco con H2
   antes o después del 07/11, marcar leído al tomar.
2. Cada etiqueta y cada operación en producción, en la ventana 23:30–01:30.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Invariantes del proyecto | `CLAUDE.md` |
| El dinero de cada decisión técnica | `docs/base-comercial.md`; límites: `docs/arquitectura/limites.md` |
| Arquitectura por zona y módulo, con el índice de `admin/DISENO.md` | `docs/arquitectura/indice.md` |
| Conversaciones (H1 en `main`, H2 en construcción) | `docs/arquitectura/conversaciones.md` |
| El plano de la rearquitectura y el tablero | `Analisis/41-arquitectura-por-capas.md`; `Prompts/COORDINACION.md` |
| Ciclo de vida del cliente | `docs/clientes/CICLO-DE-VIDA.md`; runbooks en `docs/alta-cliente/` y `docs/pase-a-produccion/` |
| Parámetros e identificadores | `CONFIGURACION.md` (y `CONFIGURACION.local.md`, ignorado) |
| Cada cliente | `CLIENTES/<T>/` (ignorado por git, en la copia base) |
| Riesgos vivos y decisiones heredadas | `bitacora/2026-10.md`, `bitacora/2026-09.md` y `bitacora/2026-08.md` |
| Versión publicada por cliente | `docs/versiones-por-cliente.md` |
