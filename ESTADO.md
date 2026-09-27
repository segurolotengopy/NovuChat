# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-09-26, noche (H1b cerrado: F1b en `main`;
Bellido y Platinum en prueba; staging en verde de punta a punta por CI). Lo
anterior, en `bitacora/2026-09.md`.

## En producción

- **Consola y Functions:** `v0.10.0` (26/09, `4f7e091`). En `main` y **sin
  desplegar**: la regla de planes (el comercio renueva, no cambia plan ni
  modalidad; el pago no cambia la modalidad), el pago en revisión en Negocios,
  F1b (conversaciones, precio, periodo y bolsa de prueba por contrato), la
  instancia mínima por parámetro, `registro.ts` y el caché de la consola
  (#227). Entran con la **etiqueta de F2**, que aterriza primero en staging.
- **Flujos de n8n:** los 8 al día (`e02a756`); nada publicado hoy.
- **Cuentas:** **Bellido** en prueba (septiembre, bolsa 20). **Platinum** en
  prueba (septiembre, bolsa 100) con contrato: 4 cambios y USD 120 al mes. Los
  demos y captación, en demostración. Nadie en producción; corte en
  observación.

## Staging

`novuchatstaging`, en verde desde el 26/09 (el run de la fusión del #227): 55 Functions,
47 invocables como en producción, CPU fraccionaria e instancia mínima 0 (cuota
de 20 vCPU; aumento rechazado por falta de historial), humo 26/26 y ZAP. Cada
push a `main` que toque `admin/` despliega ahí.

## En obra: la rearquitectura por capas (`Analisis/41`, reorientado el 26/09)

- Hechos: F-1, E, F1, F6, S, **F1b (H1b, informe en el tablero)**. F2 con su
  primer PR (`registro.ts`, #214).
- **Siguiente:** F2 (mover sin lógica, `fronteras.test.ts`, `tenants.modulos`
  con migración en ventana, etiqueta con staging primero) → F3a (esqueleto de
  venta; habilita a Rubén Roca) → F3b (core de reservas).
- Tablero, informes y coordinación con la sesión de cartera:
  **`Prompts/COORDINACION.md`**.

## Lo próximo, en orden

1. **01/10:** extender a octubre las pruebas de Bellido y Platinum
   (`asignar-plan.mjs --periodo-prueba 2026-10 --bolsa-prueba 20|100`, seco
   antes; confirmar que no tengan `periodoPagado`).
2. Andres pega el informe **H1b** en la sesión revisora.
3. F2, empezando por `fronteras.test.ts` y el arreglo del CI para PR que solo
   tocan `Flujos/`.
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
