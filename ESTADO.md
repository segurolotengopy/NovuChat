# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-10-01, tarde. **La pausa de la rearquitectura (F2)
terminó el 01/10:** Andres lo confirmó en el chat y la sesión de rearquitectura ya
fusiona tandas (#330). Las secciones de abajo que todavía dicen «en pausa» las
reescribe esa sesión en su cierre. Hoy **Bellido corre el candidato B**,
«Agenda mínima v0» (publicado a la 01:24, #293 fusionado), el estándar DevSecOps 2.6 está en
`main` (#295) y los #280 (modelo por rol) y #281 (la pausa en el plano) están fusionados.
**Cerrado en `main` el hilo del gancho de acciones sensibles y del candado de apps ajenas**
(#264, #265, #272, #277, #323 y #329; asiento de hoy en `bitacora/2026-10.md`).
Lo anterior está en `bitacora/2026-09.md`.

## En producción

- **Consola y Functions:** `v0.10.0` (26/09, `4f7e091`), 204 commits detrás
  de `main`. En `main` y **sin desplegar**: todo F1b, la regla de planes, el
  pago en revisión, y lo que F2 lleva movido hasta hoy (solo rutas, sin
  lógica). Todo eso entra con la **etiqueta de F2**, que aterriza primero en
  staging.
- **Flujos de n8n:** los otros cinco están al día con `main`; **hoy Bellido corre otro flujo, el piloto «Agenda mínima v0»**
  (45 nodos, `f3f7411`, #293, 01/10 a la 01:24; el respaldo de 96 nodos está fuera del repositorio y se vuelve con
  `--restaurar-respaldo`), y Demo A y Platinum están atrasados en «Procesar respuesta» (#284), declarado en el #289.
  El 28/09 la cartera publicó el
  Demo B y la captación con los medios (#256) y la foto sin QR (#261). FL1 y
  FL2 no cambian ningún JSON: son 8 de 8 idénticos byte a byte.
- **Cuentas:** Bellido está en prueba (bolsa 20) y Platinum también (bolsa
  100, contrato de 4 cambios). Los demos y la captación están en
  demostración. Nadie está en producción.

## Staging

El proyecto de staging está en verde con el run de `6d6d808`: construir,
desplegar, humo y ZAP. Cada push a `main` que toca `admin/` despliega ahí,
así que cada tanda de F2 ya aterrizó en staging.

## En obra: F2 de la rearquitectura (`Analisis/41`)

- **Hecho**: T0 a T5, C1 y C2 (Functions), y FL1 y FL2 (flujos: `comun/` y
  `reservas/` pasaron a `core/` y `modulos/`, y se extrajeron los 35 Code del
  Demo B y de la captación). Son 7 cruces (eran 19) y 47 archivos sin zona.
  El segundo seco de `migrar-ejes` da 0 en los seis tenants.
- **Ahora**: la tanda de **módulos** (productos, cobros, agenda, inventario y
  pedidos, catálogo web, campañas, captación). Después vienen W1, W2, S1, S2,
  Pz, P1, Z y el cierre. El orden está en
  `docs/arquitectura/f2-orden-de-movimiento.md`.
- **B8** (receptor de clientes de AAB1): el bloque 0 está hecho, con las
  prohibiciones 5 y 7 (#260), su gancho (#264, #272, #323 y #329) y el candado de
  apps ajenas en los scripts de Meta (#265 y #277). Los bloques A a C van
  después de H3a, coordinados con WhatsApp-Modular.
- El tablero y la coordinación con la cartera están en
  **`Prompts/COORDINACION.md`**.

## Lo próximo, en orden

1. **01/10:** extender a octubre las pruebas de Bellido y Platinum
   (`asignar-plan.mjs --periodo-prueba 2026-10 --bolsa-prueba 20|100`, primero
   en seco, confirmando que no tengan `periodoPagado`). **Ese día no se
   fusiona entre las 08:00 y las 12:00 ninguna tanda que cambie rutas de
   scripts.**
2. F2: la tanda de módulos, fusionando de a uno y regenerando.
3. ~~Barrera de app ajena en `webhook-meta.sh` (hallazgo MEDIUM de la revisión
   del #264)~~ **Hecha:** #265 y #277, en `main`. Lo que queda de ese hilo está en
   «Requiere a Andres», punto 11.
4. Plantillas `prueba_termina` y `conversaciones_agotadas` con texto nuevo
   (Meta), antes del primer pase real.

## Coordinación 2026-09-29

Formato de la orden general (§6); la escribe la sesión de cartera para las tres de NovuChat. **La rearquitectura está en pausa** por decisión de Andres (costo de tokens sin ingresos todavía); las prioridades son Bellido en piloto, el Q'Taco reducido y los modelos por rol.

- **Fase 0:** cartera, hecha: nada sin subir (#267 y #275 fusionados, #280 fusionado el 01/10; los 17 archivos de `.claude/agents/` que `aplicar.sh` dejó sin confirmar el 28/09 quedaron en el #280). Revisora, hecha (sin worktrees propios de trabajo; subió sin forzar la rama del #277). Operadora (verificado el 01/10 contra origin): su trabajo de F2 está en origin y lo único abierto es el #278 (`f2/m2-cobros`), sin fusionar a propósito; sus worktrees no tienen commits sin subir y tres tienen cambios sin commit que no son de F2 (`candado-apps-ajenas`, `umask` y el de análisis financiero).
- **Fase 1** (modelos por rol v1+v2): PR #280 con los 18 agentes y `CLAUDE.md` (sección «Delegación entre agentes y costo»); SeguridadGeneral lo aprobó el 30/09 sin ajustes y **se fusionó el 01/10** (junto con el #281, la pausa en el plano). Ningún agente pasa a haiku.
- **Fase 2:**
  - Cartera, Bellido: extensión a octubre en seco, hecha (bellido bolsa 20, platinum bolsa 100, sin `periodoPagado`); informe de calidad de respuestas, hecho y **sin aplicar**; `cumplimiento.md`, `anexo-particular.md`, `condiciones-piloto.md`, aceptación (13 de 46 filas) y ficha, hechos. Q'Taco: **detenida** hasta que Andres elija el alcance.
  - Revisora: sin informe H1b nuevo (H1b ya revisado el 26/09); el plano asienta la pausa en el PR #281.
  - Operadora: pausa de F2 hecha; **el punto de pausa sigue sin escribirse en `Prompts/COORDINACION.md`** (en main dice «en obra… sigue la tanda de módulos»): lo asienta el plano (#281) y este archivo. Falta que ese documento remita a ellos. Además hizo el flujo B de Bellido, lo publicó el 01/10 y abrió el PR del estándar 2.6 (#295, fusionado); el #277 (candado de apps ajenas) se fusionó el 01/10 (13:35 UTC), ya sin los conflictos ni las alertas de CodeQL que lo tenían estancado. Revisora: coordinó y midió el concurso de Bellido con un arnés propio; el resultado está en `Analisis/46` §7.
  - Análisis financiero (sesión del 28/09, cerrada el 01/10): `Analisis/43` a `45` y `47` en `main` (#274, #311, #316 y #321). Midió «Agenda mínima» con el `usageMetadata` de Google: Gemini es el 2,5 % del costo variable, contra el 18 a 42 % del agente con herramientas, y la cifra que más importa del piloto es cuántas respuestas lleva cada conversación. La medición de costos se apoya en FinOps-Ecosistema.
- **Requiere a Andres** (cada una con su «sí»; las corre Claude):
  0. **Gemini, 30/09:** el 29/09 por la noche la credencial de producción respondió 402 «prepayment credits are depleted» y Bellido no podía contestar; volvió a responder el 30/09 después de que Andres comprara créditos. Producción usa el proyecto `NovuchatDemo` (cuenta `ssaalberdi`) con «Google Gemini(PaLM) Api account»; las baterías y pruebas usan «Gemini — pruebas (no producción)» (proyecto `novuchat-pruebas`): ninguna batería más con la credencial de producción. **Decisión de Andres:** activar la recarga automática con límite mensual antes del 01/10, porque el saldo es prepago. El informe de los brazos D y E está en `CLIENTES/BELLIDO/solicitudes/prompt-2026-09-29-brazos-D-E.md`; recomienda quedarse con Flash-Lite y el código del #283. **01/10: Andres descarta por ahora subir a Gemini 3.8 Flash;** se sigue con 3.5 Flash-Lite (`Analisis/44`).
  1. ~~Publicar #267 y #275~~ **Hecho el 29/09 con el «sí» de Andres:** Bellido a las 13:39 (96 nodos), Platinum y Demo A a las 13:40 (77 nodos cada uno), desde `main` `572b793`; el seco posterior da 0 diferencias en los tres. Falta que Andres pruebe Bellido con un teléfono.
  2. **01/10:** `node admin/scripts/asignar-plan.mjs --proyecto novuchat-demo --operador (correo de Andres) --tenant bellido --periodo-prueba 2026-10 --bolsa-prueba 20 --aplicar`, y el mismo con `--tenant platinum --bolsa-prueba 100`. Cambia la modalidad de la cuenta, por eso necesita el «sí» ese día.
  3. ~~Fusionar el PR #280~~ **Hecho el 01/10** (y el #281).
  4. Q'Taco, alcance: (a) el de la orden general, con reservas de mesa, sin cobro real y avisos por plantilla, que exige una excepción de código firmada · (b) pedidos por chat con cobro real, sin mesas · (c) alta y aceptación con lo que el Demo B ya hace hoy, sin mesas (recomendado por la revisora). **01/10: Andres se lo pasa a la cartera;** las tres opciones en dólares están en `Analisis/47` §2.
  5. ~~Contrato de Bellido: precio, cambios incluidos, quién paga Meta y recordatorio de 24 h~~ **Decidido por Andres el 01/10:** USD 25 al mes sin instalación. Andres paga Meta con su propia tarjeta, cargada en la WABA de Bellido, y también los cambios y los recordatorios (`Analisis/47`, #311, #316 y #321). Falta que la cartera lo pase al `anexo-particular.md` y lo firme el doctor.
  6. Persona en Meta (Bellido): nombre visible sin acento (aprobado por Meta y en cola de propagación, 30/09), el doctor como administrador del portafolio (invitación enviada, pendiente de su aceptación), app y WABA huérfanas. **La alerta de gasto de la WABA no aplica:** Meta no la ofrece para Cloud API (Andres, 30/09, verificado en pantalla con Antigravity).
  7. Plantillas `prueba_termina` y `conversaciones_agotadas`: la WABA de Bellido solo tiene `solicitud_cita`, `alerta_emergencia` y `hello_world`.
  8. Antes del piloto: reiniciar la memoria y el estado por teléfono de Bellido, y una ronda de aceptación con teléfono real (33 filas).
  9. ~~Autorizar la batería de calidad y las correcciones de código de Bellido~~ **Superado el 30/09 por el concurso:** Andres decidió el candidato B («Agenda mínima v0»), publicado el 01/10 a la 01:24 (45 nodos, `f3f7411`, #293 fusionado); el flujo A (#286) se descartó y quedó cerrado. La consulta pediátrica quedó en 250 BOB en la consola (30/09). Detalle: `docs/versiones-por-cliente.md` y `CLIENTES/BELLIDO/`.
  10. El correo de María René, para darle el rol `oper` en la consola.
  11. **Sin decidir (hilo del candado de apps ajenas):** si `--alta-waba` puede usarse con una app propia de NovuChat sobre una WABA que el receptor ya entrega a NovuChat. No desvía al receptor, pero NovuChat recibiría esos mensajes sin su verificación. Dos límites conocidos, sin urgencia: el destino real de un `git push` lo decide la configuración de git y el gancho solo ve el texto, y `git -C <carpeta> push` propio no pide confirmación **ni se niega con `--force`** (hueco en una prohibición dura, anterior a este hilo; su corrección está propuesta como tarea aparte; detalle en `bitacora/2026-10.md`).
- **Costo:**
  - Cartera trabajó en Opus 5.5 del 27/09 (02:29 UTC) al 29/09 (13:33 UTC) y en Sonnet 5.5 desde el 29/09 a las 17:07 UTC. Lanzó 35 subagentes (25 de seguridad, 4 analista de solicitudes, 4 `flujos-n8n`, 1 `Explore` y 1 general). La mayor parte del gasto fueron la lectura de ejecuciones y las revisiones de seguridad de los PR.
  - Operadora trabaja en Opus 5.5 desde antes del 30/09 (no registró la fecha de inicio) y usó subagentes: revisiones de `seguridad` (la última, de unos 44 mil tokens), `devsecops` para el estándar 2.6 y agentes de implementación de F2.
  - Revisora trabaja en Sonnet 5.5 desde el 30/09 a las 11:30. Subagentes: el que construyó el arnés de pruebas, unas siete revisiones de `seguridad` (en Opus por definición del agente) y dos o tres de dependencias y DevSecOps.
  - Barrera de app ajena (esta sesión, 28/09 al 01/10): Opus 5.5 hasta el 01/10 y Sonnet 5.5 en el último tramo. Subagentes: 11 revisiones de `seguridad` (en Opus por definición del agente: 2 del #265, 6 del #272, 1 del #323 y 2 del #329) y ninguno más. Lo más caro fueron las rondas repetidas sobre el gancho (cinco rondas del #272, con seis agentes); dos se cortaron por un clasificador de seguridad. Sin medición en dinero.
  - Análisis financiero: Opus 5.5 del 28 al 29/09, Sonnet 5.5 el 29/09 y Opus 5.5 el 01/10. Subagentes: 5 revisiones de `seguridad` (en Opus) y ninguno más. Lo más caro fue leer ejecuciones de n8n (solo los conteos de tokens) y escribir los análisis. No gastó Gemini.
  - El concurso de Bellido del 30/09 gastó Gemini con la credencial de producción (saldo prepago de `NovuchatDemo`), por una indicación de Andres y una vez agotada la cuota gratuita de las pruebas. No hay medición en dinero de ninguna de las tres sesiones.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Invariantes del proyecto | `CLAUDE.md` |
| El dinero de cada decisión técnica | `docs/base-comercial.md`; límites y dónde se hacen cumplir: `docs/arquitectura/limites.md` |
| Arquitectura por zona y módulo, con el índice de las secciones viejas de `admin/DISENO.md` | `docs/arquitectura/indice.md` |
| El plano de la rearquitectura | `Analisis/41-arquitectura-por-capas.md` y su anexo A |
| Ciclo de vida del cliente (ocho etapas) | `docs/clientes/CICLO-DE-VIDA.md`; runbooks en `docs/alta-cliente/` y `docs/pase-a-produccion/` |
| Parámetros e identificadores | `CONFIGURACION.md` (y `CONFIGURACION.local.md`, ignorado) |
| Cada cliente | `CLIENTES/<T>/` (ignorado por git, en la copia base) |
| Riesgos vivos y decisiones pendientes heredadas | `bitacora/2026-09.md` («Riesgos vivos», «Riesgos del repositorio público», «Próximos pasos») y `bitacora/2026-08.md` («Decisiones pendientes») |
| El número de prueba y sus destinatarios registrados (prohibición 6) | `CONFIGURACION.md`; el riesgo, en `bitacora/2026-09.md` «Riesgos vivos» |
