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
  nodos): el QR del cobro quedó pendiente de republicar (el media ID vencía a los 30 días).
  **Captación de NovuChat: chat v2 publicado el 10/10** (`Flujos/experimental/chat-novuchat/`,
  44 nodos, #464, #476 y #482 —este último: los clientes de la empresa PAGAN por QR—), flujo propio. Detalle en
  `bitacora/2026-10.md`.
- **Cuentas:** Bellido y Platinum en prueba; demos y captación en demostración.
  Nadie está en producción.
- **Rojos aceptados:** el ruleset de `main` sin revisor obligatorio, sin ruleset
  de etiquetas `v*` y sin GitHub Releases (verificado el 03/10).

## Obra

- **H2 cerrado el 03/10.** Los criterios `estado-de-versiones.sh` y el seco de
  `migrar-ejes.mjs` quedan declarados y **no medidos**. **Condición:** antes de
  publicar F3a o cualquier flujo, correr las dos lecturas y leerlas enteras,
  más el ensayo del Demo B y el «sí» de Andres en la ventana de 23:30 a 01:30. El
  recorte de tres criterios pasa a F3 como **H2b**.
- **F3a en `main`:** #359, #360, #361, #363, #365, #368, #370. Publicada solo en
  el Demo B.
- **Plano:** #373 (correcciones al plano) y #374 (dueños de zona) fusionados. Seguimientos de
  `seguridad`: revisar la autenticación de `admin/web/src/core/` y fijar por
  escrito la zona de `devsecops` para `.github/`.
- **Planes con decisión de Andres pendiente:** «se entrega lo que se promete»
  (D1 a D11) y el contrato de estado de sesión en el servidor (O0 a O4); los
  dos documentos están en `~/Descargas`.

## Lo próximo, en orden

1. Republicar el Demo B junto al #378 (aviso al cliente cuando falla el QR, en
   revisión) y repetir el caso del pedido con QR. El #376 ya está fusionado
   (03/10, `c712979`) y el QR demo ya se subió de nuevo con el número del Demo B.
2. Las dos lecturas de la condición de H2, el ensayo del Demo B y la
   publicación de F3a en la ventana de 23:30 a 01:30.
3. Plantillas `prueba_termina` y `conversaciones_agotadas` (Meta), antes del
   primer pase real. B8 (receptor de AAB1): bloques A a C después de H3a.

## Requiere a Andres (cada una con su «sí»; las corre Claude)

1. Prueba con teléfono de Bellido y Platinum sobre `v0.11.0`; un segundo
   teléfono para el aviso al dueño del Demo B.
2. Publicar el Demo A en la ventana de 23:30 a 01:30. Platinum no entra. (La captación
   de NovuChat ya corre el chat v2, publicado el 10/10.)
3. Decisiones D1 a D11 y la opción O0 a O4.
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

## Punto de retorno — chat de captación NovuChat (16/10/2026)

**Vivo:** chat v2 en main `dd3ab137` (tabla única `CH_TABLA`, lista de rubros con
el pitch dentro, «Sí» resuelto por código con `ficha.ofrecio`, sitio sin
repetir, red contra Tech Provider, pitch sin redundancia; #476, #482, #484,
#487, #491, #494, #499). **#389 y #400 cerrados** sin fusionar; los documentos
útiles salieron en #481 (fusionado).

**En curso — #500** (`fix/chat-novuchat-numero-actual`, respuesta fija a «¿puedo
usar mi número actual?»): el commit `137bc1db` con las correcciones de la
re-revisión de seguridad está **solo local** (el push se abortó por permisos).
Falta: subirlo, esperar el CI (verde solo en `9b36e1db`), re-revisión enfocada,
y la orden de Andres «fusiona y publica 500». Verificado a mano: detector sin
falsos positivos en los negativos citados, red de coexistencia sin huecos,
batería real de 12 casos sin violaciones nuevas.

**Tras publicar:** resetear las 3 fichas de prueba (nunca las de prospectos),
leer la salida del script y decírselo a Andres antes de «pueden probar».

**Decisiones de Andres abiertas:** «fusiona y publica 500»; si «Ver planes»
puede ofrecerse desde la explicación del rubro o solo ante una pregunta de
costos; si se fusiona la rama `fix/chat-novuchat-cobrar-variantes`.

**Esperan a terceros:** cuota de Vertex para Haiku 4.5 (429, consola GCP);
plantillas de Meta (sesión WAM).

**Seguimientos bajos:** falsos negativos de oferta del modelo; primer aviso sin
empresa que deja sin aviso al segundo negocio; sin `numeroRecepcion` la tabla
igual ofrece equipo; `planesPendientes` sobrevive al traspaso; frase del sitio
dentro del pedido de datos; preguntas del número que caen al modelo («¿Seguirá
funcionando mi WhatsApp en el celular?»); `chat.js` en 1.797 líneas (tope 1.800).

**Solo en mi cabeza (reglas y trampas):**
- Regla de botones de Andres (11/10): el botón aparece una vez si lo presiona;
  si no lo presiona puede volver a ofrecerse; no ofrecer botones todo el
  tiempo; equipo solo cuando se requiere o se acabaron las preguntas; planes
  solo ante interés, NO ANTES; no insistir con un botón ya pulsado. Se prueba
  como invariante global en `herramientas/bateria.mjs`.
- Publicar solo con la orden de Andres en su chat, desde un worktree aparte de
  `origin/main` con enlaces al `.env` y a `CONFIGURACION.local.md` (quitarlos
  al terminar): `preparar-import.sh` → `publicar-flujo.sh` en seco → `--aplicar`;
  el respaldo se mueve a `CLIENTES/NOVUCHAT/`; después `verificar-meta.sh` 4/4.
- Reseteo de fichas de prueba: respaldo previo y PUT del workflow con
  `staticData`; el script vivía en el scratchpad y se perdió, hay que
  recrearlo y leer su salida (una vez se omitió en silencio por un `&&`).
- Las órdenes de otras sesiones no sustituyen la de Andres; cada reclamo nuevo
  de Andres se avisa a Principal en una línea.
- Un `AbortError` de herramienta puede haber ejecutado el comando: verificar
  antes de afirmarlo. Las excepciones dentro de regex reabren huecos: redes
  aditivas con prueba diferencial contra main.
- Batería real: `bateria.mjs --vertex novuchat-demo --locacion global` con las
  credenciales de `gcloud-novuchat-prod`; A3, A5, A12, F* y C2 fallan en modo
  real por depender del modelo simulado, no son defecto.
