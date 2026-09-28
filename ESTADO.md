# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-09-28, noche. F2 avanzó de T4 a FL2: las
tandas, los dos cortes y los flujos, todo fusionado. `main` está en `6d6d808`,
en verde en CI y en staging. Lo anterior está en `bitacora/2026-09.md`.

## En producción

- **Consola y Functions:** `v0.10.0` (26/09, `4f7e091`), 204 commits detrás
  de `main`. En `main` y **sin desplegar**: todo F1b, la regla de planes, el
  pago en revisión, y lo que F2 lleva movido hasta hoy (solo rutas, sin
  lógica). Todo eso entra con la **etiqueta de F2**, que aterriza primero en
  staging.
- **Flujos de n8n:** los 8 están al día con `main`. La cartera publicó el
  Demo B y la captación con los medios (#256) y la foto sin QR (#261). FL1 y
  FL2 no cambian ningún JSON: son 8 de 8 idénticos byte a byte.
- **Cuentas:** Bellido está en prueba (bolsa 20) y Platinum también (bolsa
  100, contrato de 4 cambios). Los demos y la captación están en
  demostración. Nadie está en producción.

## Staging

`novuchatstaging` está en verde con el run de `6d6d808`: construir,
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
  prohibiciones 5 y 7 (#260) y su gancho (#264). Los bloques A a C van
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
3. Barrera de app ajena en `webhook-meta.sh` (hallazgo MEDIUM de la revisión
   del #264), en su propia sesión.
4. Plantillas `prueba_termina` y `conversaciones_agotadas` con texto nuevo
   (Meta), antes del primer pase real.

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
