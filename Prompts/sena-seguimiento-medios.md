# Flujo de agendamiento con seña, seguimiento de leads y medios entrantes — construcción

> **TENANT:** el comercio para el que se activa. Andres lo indica al lanzar la
> sesión; su ficha, estado y aceptación viven en `CLIENTES/<TENANT>/`. Los
> análisis `30` a `34` se escribieron sobre un caso (una clínica con siete
> agendas y seña de 50 Bs): son el **caso de estudio**, no la especificación.
> Los parámetros (importe de la seña, agendas, horario de retención, umbrales)
> se leen de la ficha del tenant y de su `config/`, nunca se escriben en el
> código.

Eres una sesión dedicada a construir lo que quedó decidido en los análisis
`Analisis/30` a `Analisis/34` del 16 y 17/09/2026, como módulos del flujo de
agendamiento que cualquier comercio puede activar. Lee primero, en este orden: `CLAUDE.md` entero
(prohibiciones, Base comercial §1, §2 y §7, Flujo de trabajo), `ESTADO.md`,
`CONFIGURACION.md`, y después los cinco análisis:

- `Analisis/30-platinum-flujo-mixto-y-precio.md` — la seña por QR: qué falta y cómo (§4).
- `Analisis/31-seguimiento-de-leads.md` — seguimiento de solicitudes pendientes (§4 y §5).
- `Analisis/32-platinum-oferta-120-por-500.md` — la oferta cerrada y lo que va en el contrato (§3, §4).
- `Analisis/33-platinum-a-escala-real.md` — el orden de construcción cuando el volumen es chico (§3).
- `Analisis/34-direccion-voz-imagenes-y-pdf.md` — medios: Maps, audio, imágenes y PDF (§5).

Esos cinco archivos y `Analisis/30-platinum-modelo.py` pueden estar **sin
versionar en el worktree principal (`main`)**. Tu primera tarea es llevarlos
a tu rama con un commit propio (`docs(analisis): 30–34, seña, seguimiento y medios`), sin tocar
ningún otro archivo modificado o sin versionar de esa carpeta: hay otras
sesiones trabajando ahí.

## Cómo trabajar

- **Consulta primero `~/Claude-Proyectos/`**: una ficha por proyecto de Andres
  con sus módulos reutilizables (QR Simple, RAG, onboarding, integración con
  Meta). Si algo de lo que vas a construir ya existe, dilo antes de
  escribirlo. No busques por el disco: pídele a Andres las rutas.
- **Worktree propio y rama propia** (`git worktree add`), nunca cambiar de
  rama en `~/NovuChat` ni `git add -A`. Una rama por bloque de trabajo (abajo),
  un PR por rama, contra `main`.
- **Andres autoriza; tú operas.** Todo lo que escriba en producción, en Meta,
  en n8n o en GitHub se ejecuta después de su «sí» en el chat. Nunca le pases
  comandos para que corra. Los flujos se publican solo desde `main` con
  `scripts/publicar-flujo.sh`, leyendo el diagnóstico entero antes de
  `--aplicar`.
- **Ningún secreto en el repositorio**, ni en JSON de flujos, ni en sticky
  notes, ni en ejemplos. Los identificadores de Meta, solo por sus últimos 4.
- **Todo cambio de flujo declara cuántos mensajes agrega o quita** por
  conversación, en el PR y en el commit. Los bloques 1 a 5 de abajo tienen que
  agregar **cero** mensajes salvo donde se indica.
- **Todo límite se hace cumplir en el servidor** y se prueba negando
  (`CLAUDE.md` §7). La pantalla acompaña.
- **Prohibición 3, en cada línea del bloque 2:** el asistente nunca dice
  «pago acreditado», «pago verificado» ni «recibimos tu pago». El comprobante
  llegó y los datos coinciden; quien confirma el dinero es el comercio.
- Antes de dar algo por terminado: prueba contra un teléfono real, resultado
  **real** anotado en `CLIENTES/<TENANT>/aceptacion.md`, y `ESTADO.md`
  actualizado al cerrar cada bloque.
- Lo que se decide con el cliente y no está confirmado se marca «(supuesto)»
  en `CLIENTES/<TENANT>/ficha.md`.

## Qué construir, en este orden

Cada bloque es una rama y un PR. No empezar el siguiente sin cerrar el
anterior o dejarlo claramente bloqueado en `ESTADO.md`.

### Bloque 0 — Umbrales publicados en el flujo del tenant (antes del 01/10)
Rama `flujos/umbrales-publicados-<tenant>`. El servidor ya decide (`atencion.ts`) y
el JSON de los flujos ya obedece (`flujos/umbrales-atencion`), pero hay que
verificar que el flujo del tenant lo incluya y publicarlo. Prueba:
aceptación 24a–24c con umbrales bajos y restaurados. Motivo: hoy ninguna
ventana tiene techo; desde el 01/10 un bucle cuesta plata
(`Analisis/27` §5.4.3).

### Bloque 1 — Dirección con enlace a Maps (½ hora)
Rama `flujos/direccion-maps`. Campo `direccionMaps` en `config/negocio`
(pantalla de la consola incluida), y el prompt lo incluye en la confirmación
de la cita y en «¿dónde quedan?». **Cero mensajes nuevos.** El mensaje
`location` nativo solo si el cliente final pide la ubicación. `Analisis/34` §2.

### Bloque 2 — Seña por QR con cotejo del comprobante (3–4 jornadas)
Rama `flujos/sena-por-qr`. `Analisis/30` §4 y `Analisis/07` §4:
1. El flujo de agendamiento lee `cobroReal` (hoy ningún flujo lo lee) y manda
   el QR del comercio **con el resumen de la cita en el mismo mensaje**.
2. Nodo compartido «Descargar medio de Meta» (`GET /{media-id}` → URL temporal
   → descarga con el token), y los tres nodos del comprobante: descargar, leer
   con Gemini (imagen o PDF en línea; el PDF del BCP es imagen), cotejar con
   las funciones ya probadas. Importe fijo, leído de `config/agendamiento.sena` (nunca en el código).
3. **Retener el horario**: al enviar el QR se crea el evento «PENDIENTE DE
   SEÑA»; al llegar el comprobante cotejado pasa a confirmado; un flujo
   programado (molde: `demo-a-recordatorios`) borra los pendientes vencidos a
   los minutos de retención configurados **sin mandar mensaje al cliente**.
4. Respuestas de `Analisis/07` §4.5 (cuadra / no cuadra / ilegible). Aviso a
   recepción con el comprobante: declarar que es **un mensaje de NovuChat por
   cita pagada**.
5. Pantalla «Cobros» de la consola listando los comprobantes cotejados del
   comercio.
**Mensajes:** +1 (el QR) por conversación que llega a reservar; la
confirmación del comprobante **y** de la cita van en un solo mensaje. Pruebas
puras para el cotejo y la retención; prueba real con comprobantes de dos
bancos. Los comprobantes no se guardan como imagen.

### Bloque 3 — Lectura de imágenes, PDF y audio entrantes (1½ jornadas)
Rama `flujos/medios-entrantes`. `Analisis/34` §3.1 y §4.1. Sobre el nodo de
descarga del bloque 2:
- Imagen y PDF que no son comprobante: descripción con prompt acotado (foto
  de referencia → se agradece y queda para la valoración, **sin opinar sobre
  el resultado ni diagnosticar**; captura de promoción → responde a su
  texto; orden médica → deriva sin interpretar). **Nada de esto se guarda.**
- Audio: transcripción con Gemini, tope de 60 s (más largo: pedir que lo
  escriba), el texto entra al agente marcado «(audio transcripto)», y el
  asistente repite lo que entendió antes de agendar.
- Contador de **mensajes entrantes por tipo** por comercio en el agregado
  del mes (`ingesta.ts`), mostrado en «Consumo».
**Cero mensajes nuevos**: reemplazan respuestas que hoy se pagan vacías.
Medir la latencia del turno con audio e imagen contra p50 ≤ 6 s, p90 ≤ 10 s
(`Analisis/04`). **No construir respuestas en voz.**

### Bloque 4 — Recordatorio de solicitud pendiente (2 jornadas)
Rama `flujos/seguimiento-pendiente`. `Analisis/31` §4 y §5:
- Estado de la solicitud en la conversación
  (`solicitud: { etapa: horarios | elegido | qr_enviado | agendada, desde, seguimientos }`),
  escrito por la ingesta desde los eventos existentes más uno nuevo,
  `horario_ofrecido`.
- Flujo programado «Seguimientos», cada hora: solicitud pendiente, sin cita,
  sin seguimiento previo; entre 2 y 4 h del último mensaje → texto en ventana;
  entre 24 y 48 h → plantilla de **utilidad** «solicitud de cita sin
  confirmar», redactada como estado de una solicitud existente (sin
  «interés», sin precio, sin botones a WhatsApp; ver la memoria
  `meta-plantillas-restricciones`). Marca `seguimientos` antes de enviar.
- `noContactar: true` cuando el cliente final lo pide o pasó a una persona; el
  flujo lo respeta.
- Contadores del mes: `seguimientos`, `reactivadas`.
**Mensajes:** +1 en las conversaciones que quedaron a medio camino; los
seguimientos fuera de ventana **no se facturan como conversación** (una
respuesta nuestra sobre ventana vencida no abre nada: `ingesta.ts`); la
respuesta del cliente final sí. Una sola vez por solicitud.

### Bloque 5 — Candado con varias agendas (½ jornada)
Rama `flujos/candado-un-calendario`. `Analisis/24` §4: la verificación contra
la doble reserva revisa **solo el calendario que recibió la cita**, no todos
los configurados. Medir el turno que agenda antes y después. Respetar la regla
mandatoria de Andres del 17/09: el candado se dispara por el hecho
(`agendar_cita` ejecutada), no por lo que el modelo dijo.

### Lo que NO se construye ahora (y por qué)
- **Aviso de horario liberado**: mientras la agenda del tenant no esté llena
  nadie espera un horario (`Analisis/33` §3). Se ofrece «cuando la agenda se
  llene».
- **Paquete de reactivación (marketing)**: cuando el comercio compre el
  primero (`Analisis/33` §3).
- **Respuestas en voz** (`Analisis/34` §3.2).
- **Ningún flujo con varios disparadores**, ningún canal no oficial.

## Entregables al cerrar
- Un PR por bloque, con: mensajes agregados/quitados, pruebas que lo cubren,
  resultado real de la prueba con teléfono.
- `CLIENTES/<TENANT>/aceptacion.md` con las filas nuevas (seña, comprobante
  que cuadra / no cuadra / ilegible, horario vencido, audio, imagen, PDF,
  seguimiento a las 2 h y a las 24 h).
- `ESTADO.md` actualizado al final de cada bloque.
- Una nota en `Analisis/32` §4 si algo de lo construido cambia una cláusula
  del contrato.
- Los umbrales **publicados y probados antes del 1 de octubre**.
