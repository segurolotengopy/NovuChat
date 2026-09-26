# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-09-26 (F6, método: la bitácora partida y este
archivo de una pantalla). Los asientos anteriores de este archivo, desde el
28/08, están **sin cambiar una letra** en `bitacora/2026-08.md` (14 asientos)
y `bitacora/2026-09.md` (65 asientos).

## En producción

- **Consola y Functions:** `v0.9.0` (25/09; el tipo de cambio del BCB cada
  día). Las Functions del origen del anuncio y de `uuid` 11 están en `main`
  y entran con la próxima etiqueta; S (staging) tiene que existir antes de
  ese despliegue.
- **Flujos de n8n:** los 8 publicados desde `origin/main` (`e02a756`, 26/09),
  `estado-de-versiones.sh` 8 de 8 al día. Registro de excepciones en
  `docs/versiones-por-cliente.md`.
- **Tenants que atienden personas:** Platinum (desde el 16/09), Bellido (desde
  el 18/09) y NovuChat (captación). **Ningún cliente está en modalidad
  producción**: atienden en demostración o prueba, con aceptación formal de 0
  filas llenas; su pase espera el hito H3. Q'Taco en pausa, Dhermacore con
  propuesta, Walisuma prospecto (`Prompts/operacion-de-clientes.md`, anexo).
- **Prepago:** en modo observación (el corte se calcula y no corta hasta
  `corteActivo`). Umbrales 50 / 100 en el servidor y en los flujos.
- El objetivo inmediato original —dos demos comerciales el 9 y 10 de
  septiembre de 2026, con congelamiento de cambios el 8— se cumplió; desde
  entonces el proyecto está en alta de clientes y en la rearquitectura.

## En obra: la rearquitectura por capas (`Analisis/41`)

- **H0 cerrado el 26/09** (F-1 cierre de las nueve sesiones, E estándar
  DevSecOps 2.4). Veredicto de la revisora: pasa; arrancan F1, S y F6.
- **En paralelo ahora:** **F1** ejes de la cuenta y consola del propietario
  (agentes `central` y `plataforma-consola`); **S** staging (agente `deploy`);
  **F6** método (agente `metodo`): PR #200 (`docs/arquitectura/` e índice),
  #201 (`CICLO-DE-VIDA.md`), #202 (gancho por carpeta), #204 (agentes por
  zona), #206 (pruebas puras) y el de este archivo.
- **Sesiones de clientes** bajo el congelamiento del §12.10: configuración,
  comercial, Meta y análisis de solicitudes sí; código a medida no.
- Tablero, cola de fusión, cola de ensayo e informes de hito:
  **`Prompts/COORDINACION.md`**.

## Lo próximo, en orden

H1 (F1) → F2 carpetas, registro y frontera (`registro.ts` primero, después
los módulos en cualquier orden) → etiqueta, despliegue y publicación de los 8
flujos → F3 core unificado → H3 → **H4: aceptación y pase de Platinum**, el
primer cliente pagador → F4 conector de canal ∥ F5 tenants como datos.

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
