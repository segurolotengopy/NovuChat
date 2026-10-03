# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-10-03. **H2 cerrado «pasa con observaciones»** y
F3a habilitada para ensayo. Asiento de hoy en `bitacora/2026-10.md`.

## En producción

- **Consola y Functions:** `v0.11.0` (`e23bf34`, 02/10). Después se fusionaron
  #353 y #352, solo documentación y comentarios.
- **Flujos de n8n:** Bellido corre «Agenda mínima v0» (45 nodos). Demo A y
  Platinum, atrasados en `Procesar respuesta`, declarado en
  `docs/versiones-por-cliente.md`. **Demo B con F3a publicada el 03/10** (74
  nodos): su QR de cobro no sale por un media ID vencido (30 días).
- **Cuentas:** Bellido y Platinum en prueba; demos y captación en demostración.
  Nadie está en producción.

## Obra

- **H2 cerrado el 03/10.** Los criterios `estado-de-versiones.sh` y el seco de
  `migrar-ejes.mjs` quedan declarados y **no medidos**. **Condición:** antes de
  publicar F3a o cualquier flujo, correr las dos lecturas y leerlas enteras,
  más el ensayo del Demo B y el «sí» de Andres en la ventana de 02 a 03. El
  recorte de tres criterios pasa a F3 como **H2b**.
- **F3a en `main`:** #359, #360, #361, #363, #365, #368, #370. Publicada solo en
  el Demo B.
- **Plano:** #373 y #374 (dueños de zona) fusionados. Seguimientos de
  `seguridad`: revisar la autenticación de `admin/web/src/core/` y fijar por
  escrito la zona de `devsecops` para `.github/`.
- **Planes con decisión de Andres pendiente:** «se entrega lo que se promete»
  (D1 a D11) y el contrato de estado de sesión en el servidor (O0 a O4); los
  dos documentos están en `~/Descargas`.

## Lo próximo, en orden

1. Fusionar el #376 (`marcador-local.sh --reemplazar`), subir otra vez el QR
   demo y republicar el Demo B; PR aparte con el mensaje con botón si falla el QR.
2. Las dos lecturas de la condición de H2, el ensayo del Demo B y la
   publicación de F3a en la ventana de 02 a 03.
3. Plantillas `prueba_termina` y `conversaciones_agotadas` (Meta), antes del
   primer pase real. B8 (receptor de AAB1): bloques A a C después de H3a.

## Requiere a Andres (cada una con su «sí»; las corre Claude)

1. Prueba con teléfono de Bellido y Platinum sobre `v0.11.0`; un segundo
   teléfono para el aviso al dueño del Demo B.
2. Publicar el Demo A y la captación en la ventana de 02 a 03 (captación fuera
   del traspaso a Silvana). Platinum no entra.
3. OK para fusionar el #376; decisiones D1 a D11 y la opción O0 a O4.
4. Pendientes de cartera: Gemini prepago, alcance de Q'Taco, contrato y
   plantillas de Bellido, correo de María René (rol `oper`).

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Invariantes del proyecto | `CLAUDE.md` |
| El dinero de cada decisión técnica | `docs/base-comercial.md`; límites: `docs/arquitectura/limites.md` |
| Arquitectura por zona y módulo, con el índice de `admin/DISENO.md` | `docs/arquitectura/indice.md` |
| El plano de la rearquitectura y el tablero | `Analisis/41-arquitectura-por-capas.md`; `Prompts/COORDINACION.md` |
| Ciclo de vida del cliente | `docs/clientes/CICLO-DE-VIDA.md`; runbooks en `docs/alta-cliente/` y `docs/pase-a-produccion/` |
| Parámetros e identificadores | `CONFIGURACION.md` (y `CONFIGURACION.local.md`, ignorado) |
| Cada cliente | `CLIENTES/<T>/` (ignorado por git, en la copia base) |
| Riesgos vivos y decisiones heredadas | `bitacora/2026-09.md` y `bitacora/2026-08.md` |
| Versión publicada por cliente | `docs/versiones-por-cliente.md` |
