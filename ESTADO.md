# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-09-26, 00:50 de La Paz (F1 cerrada: ejes
migrados en producción y `v0.10.0` desplegada; F6 y S fusionados). Lo anterior,
en `bitacora/2026-09.md`.

## En producción

- **Consola y Functions:** `v0.10.0` (26/09, `4f7e091`): los tres ejes de la
  cuenta (plan, modalidad, titularidad), el modelo por tenant, el contador de
  cambios operados, Negocios con los tres ejes y «Producción» en la consola;
  además el origen del anuncio y `uuid` 11, que llegaban de F-1. Tres
  callables nuevas: `asignarEjes`, `ejesDeCuenta`, `registrarCambioOperado`.
- **Ejes migrados** (26/09, antes del despliegue, auditoría `migrar_ejes`):
  los tres demos (Demo A, Demo B, captación) son **Pro en modalidad
  demostración**; Bellido (Impulso) y Platinum (Pro) sin modalidad explícita,
  que el código trata como demostración: nadie tiene corte. Los cinco con
  `gemini-3.5-flash-lite` y titularidad «número de NovuChat». Son **5 tenants
  reales**, no los 6 del plano.
- **Flujos de n8n:** los 8 publicados desde `origin/main` (`e02a756`, 26/09),
  `estado-de-versiones.sh` 8 de 8 al día. F1 no tocó flujos.
- **Tenants que atienden personas:** Platinum (desde el 16/09), Bellido (desde
  el 18/09) y NovuChat (captación). **Ningún cliente está en modalidad
  producción**; su modalidad la fija la sesión de clientes con
  `asignar-plan.mjs --modalidad`. Su pase espera H3/H4.
- **Prepago:** en modo observación (el corte se calcula y no corta hasta
  `corteActivo`). Umbrales 50 / 100 en el servidor y en los flujos.

## En obra: la rearquitectura por capas (`Analisis/41`)

- **H0 cerrado** (F-1, E). **F1 cerrada el 26/09** (#207 ejes, #203 consola,
  migración, `v0.10.0`): informe **H1** en `Prompts/COORDINACION.md`, para la
  revisora. **F6 fusionada** (#200 a #206, #208). **S fusionada** (#205) pero
  **sin estrenar**: el proyecto `novuchatstaging` existe y no tiene
  facturación (cuota de cuentas de facturación agotada), así que
  `desplegar-staging` sigue omitido y `v0.10.0` fue con el `--dry-run` del
  pipeline y verificación HTTP después.
- **Decisiones abiertas de Andres:** facturación de staging (pedir aumento de
  cuota o desvincular un proyecto inactivo); modelo por defecto (seguir con
  `gemini-3.5-flash-lite`, recomendado, o pasar a `gemini-3.7-flash`;
  «3.7-flash-lite» no existe).
- **Sesiones de clientes:** con H1, ya pueden escribir modalidad y titularidad
  de Platinum y Bellido. Código a medida congelado (§12.10).

## Lo próximo, en orden

Veredicto de la revisora sobre H1 → **F2** carpetas, registro y frontera
(`registro.ts` primero; borra los puentes deprecados de `planes.ts`) → F3 core
unificado → H3 → **H4: aceptación y pase de Platinum** → F4 conector de canal
∥ F5 tenants como datos. S se estrena cuando haya facturación.

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
