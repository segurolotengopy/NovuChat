# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-10-01, noche. **F2 de la rearquitectura está
reactivada** (Andres levantó la pausa del 29/09 el 01/10) y casi completa en
`main`. **Bloqueo:** desde cerca de las 01:20 UTC del 02/10 el job SCA (Trivy)
falla en todos los PR y en `main` por un hallazgo nuevo en dependencias; lo
diagnostica un agente `devsecops` (PR por confirmar). Asiento de hoy en
`bitacora/2026-10.md`; lo anterior, en `bitacora/2026-09.md`.

## En producción (sin cambios)

- **Consola y Functions:** `v0.10.0` (26/09, `4f7e091`). Todo lo de abajo está
  en `main` y **sin desplegar**.
- **Flujos de n8n:** Bellido corre el piloto «Agenda mínima v0» (45 nodos,
  `f3f7411`, #293, 01/10; el respaldo de 96 nodos está fuera del repositorio y
  se vuelve con `--restaurar-respaldo`). Demo A y Platinum están atrasados en
  «Procesar respuesta» (#284), declarado en el #289. Los demás, al día.
- **Cuentas:** Bellido (bolsa 20) y Platinum (bolsa 100) en prueba; los demos
  y la captación, en demostración. Nadie está en producción.
- **Staging:** en verde; cada push a `main` que toca `admin/` despliega ahí.

## En `main`, sin desplegar: F2 casi completa

Fusionados el 01/10 (todos con seguridad aprobada; ninguno toca un JSON de
`Flujos/` ni cambia comportamiento):

- **Módulos:** #278 cobros, #305 catálogo web, #309 agenda, #312 inventario y
  pedidos, #314 captación, #315 campañas.
- **Cortes y herramientas:** #318, #319, #317, #320 (compuerta H), #324, #328,
  #335.
- **Web:** #327 (W1, t14), #330 (W2, t15), #338 (Z web, t16).
- **Otros:** #339 (C4: `catalogoWeb` depende de `inventario`; cruces 4 a 3),
  citas #341 y #342.

**Abiertos y aprobados por seguridad, esperando el CI:** #343 (S1, t17),
#340 (S2, t18), #344 (P1) y #347 (W0e). En preparación: Pz (#346, se regenera
tras S1, S2 y W0e), Citas-scripts y el Cierre. El orden completo está en
`docs/arquitectura/f2-orden-de-movimiento.md`; el tablero, en
`Prompts/COORDINACION.md`.

## Lo próximo, en orden

1. **SCA:** el PR de `devsecops` que arregla el hallazgo de Trivy (número por
   confirmar); sin él no vuelve el verde.
2. **S1** (#343) y **S2** (#340): por decisión de Andres, se fusionan el mismo
   01/10 por la noche, con aviso a la cartera.
3. **P1** (#344), **W0e** (#347), **Pz** (#346, suites de módulo a
   `pruebas/modulos/<m>/`), **Citas-scripts** y el **Cierre**.
4. **Etiqueta de F2:** primero a staging y después a producción, cada paso con
   el «sí» de Andres y dentro de la ventana de 02:00 a 03:00. Pide antes
   leer «Reglas para F2» en `Prompts/COORDINACION.md`.
5. **H2** de la revisora y después **F3a**.
6. Aparte: plantillas `prueba_termina` y `conversaciones_agotadas` con texto
   nuevo (Meta), antes del primer pase real.

## Coordinación

La orden general la escribe la sesión de cartera. Hoy trabajan cuatro: la de
**rearquitectura** (F2, esta), la **operadora**, la **revisora** (H2) y la
**cartera** (clientes). Se avisó a Cartera, Operadora y Principal del orden de
S1 y S2; las sesiones de seguridad de scripts (#265/#277, #272/#323/#329, #276 y
#279) ya fusionaron lo suyo. **B8** (receptor de AAB1): el bloque 0 está hecho;
los bloques A a C van después de H3a, coordinados con WhatsApp-Modular.

**Requiere a Andres** (cada una con su «sí»; las corre Claude):

1. Autorizar la etiqueta de F2 a staging y a producción (punto 4 de arriba).
2. **Gemini:** la credencial de producción es prepago (proyecto
   `NovuchatDemo`); Andres decidió activar la recarga automática con límite
   mensual. Se sigue con 3.5 Flash-Lite (`Analisis/44`).
3. Q'Taco: el alcance (opciones en `Analisis/47` §2); se lo pasó a la cartera.
4. Bellido: que la cartera pase el contrato (USD 25 al mes, sin instalación,
   Meta a cargo de Andres) al `anexo-particular.md` y lo firme el doctor; el
   doctor como administrador del portafolio de Meta (invitación pendiente);
   plantillas `prueba_termina` y `conversaciones_agotadas`; reiniciar memoria
   y estado por teléfono antes del piloto y una ronda de aceptación.
5. El correo de María René, para darle el rol `oper` en la consola.
6. Sin decidir: si `--alta-waba` puede usarse con una app propia de NovuChat
   sobre una WABA que el receptor ya entrega. Detalle y límites del gancho de
   `git push` en `bitacora/2026-10.md`.

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
