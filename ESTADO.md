# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-11-07, armada desde git, `docs/versiones-por-cliente.md`
y la bitácora; `./scripts/estado-generado.sh` **no se corrió** (necesita nube, n8n
y Firestore). Lo que no se pudo verificar dice «sin verificar». El detalle del día
está en `bitacora/2026-11.md`.

## En producción

- **Ensayo en curso (12/11/2026):** el Demo A corre el chat de NovuChat en ensayo
  (`docs/ensayo/LEEME.md` §11; sesión Rearquitectura). No sirve para demostraciones
  hasta la doble restauración; esta línea se retira al cerrarlo.

- **Consola y Functions:** `v0.20.0`, desplegada el 06/11/2026. Incluye el catálogo
  web de Q'Taco (#804, #797) y el despliegue tolerante a un CRM vacío (#821).
  Resultado del despliegue en Actions: sin verificar.
- **miniCRM:** no cambia nada para los 12 comercios existentes (ninguno tiene
  `config/crm` ni `enlaces/minicrm`). La edición por Gmail sigue apagada sin
  `GOOGLE_OAUTH_CLIENT_ID`; encenderla toca el `.env`, la compuerta `diff` y su
  prueba (`docs/arquitectura/modulos/crm.md`).
- **Flujos de n8n:** la tabla viva es `docs/versiones-por-cliente.md`. Q'Taco corre
  «Venta mínima v0»; PR-4a y PR-4b (#814, con el Auxiliar 3) están versionados y
  sin publicar. El Demo A sigue con el flujo de Q'Taco del ensayo hasta que el
  Auxiliar 1 lo restaure (sin verificar).
- **Clínica Platinum:** dada de baja el 11/11/2026 (reclamo 58). No es cliente ni
  demo; sus tres flujos de n8n quedaron apagados (lo informó la sesión Principal,
  sin verificar desde acá). Quitar su nombre del código va en un PR aparte.
- **Copia base `~/NovuChat`:** atrasada 2.694 commits; da falsos atrasos en
  `estado-de-versiones.sh`. Desde un worktree al día, el Demo A solo difiere
  en «Preparar imagen» y los settings del flujo, y así lo declara
  `docs/versiones-por-cliente.md` (comprobado el 06/11).

## Obra

- **Chat de captación:** #813 (guarda de construcción) fusionado; un PR en marcha la
  reemplaza por un parser (número y estado: sin verificar). La publicación del chat
  con la ficha espera confirmar que la credencial del Trigger no es la de
  AAB1-WA-Prod.
- **Q'Taco PR-4b (#814):** fusionado; falta publicar el flujo (ensayo en el Demo A
  y «sí» de Andres).
- **Planes y bolsas, H2/H3, bloque 2 de Core:** su último estado conocido es el del
  17/10 en `bitacora/2026-10.md`; no se revalidó en este cierre (sin verificar).

## Lo próximo

1. Restaurar el Demo A (Auxiliar 1) y publicar Q'Taco PR-4a/4b con ensayo previo.
2. 20/11/2026: una persona renueva la llave de la API de n8n «NovuChat» (vence el
   27/11; la «Principal» no vence).
3. `migrar-ejes` ya no es pendiente: se aplicó el 07/11/2026 con el «sí» de
   Andres (solo pone `modelo = gemini-3.5-flash-lite` en 6 fichas que decían
   «ninguno»; no toca plan, modalidad ni titularidad ni crea `cuenta/estado`).
   El segundo seco dio 0 cambios. Ver la bitácora del 07/11.

## Requiere a Andres (cada una con su «sí»; las corre Claude)

1. Cada etiqueta, publicación de flujo y operación en producción.
2. Confirmar la credencial del Trigger del chat antes de publicarlo.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Invariantes del proyecto | `CLAUDE.md` |
| El dinero de cada decisión técnica | `docs/base-comercial.md`; límites: `docs/arquitectura/limites.md` |
| Arquitectura por zona y módulo, con el índice de `admin/DISENO.md` | `docs/arquitectura/indice.md` |
| Estado derivable (etiqueta, Functions, flujos, tenants) | `./scripts/estado-generado.sh` |
| Decisiones y hallazgos | `bitacora/2026-11.md`, `bitacora/2026-10.md`, `bitacora/2026-09.md`, `bitacora/2026-08.md` |
| Versión publicada por cliente | `docs/versiones-por-cliente.md` |
| El plano de la rearquitectura y el tablero | `Analisis/41-arquitectura-por-capas.md`; `Prompts/COORDINACION.md` |
| Ciclo de vida del cliente | `docs/clientes/CICLO-DE-VIDA.md`; runbooks en `docs/alta-cliente/` y `docs/pase-a-produccion/` |
| Parámetros e identificadores | `CONFIGURACION.md` (y `CONFIGURACION.local.md`, ignorado) |
