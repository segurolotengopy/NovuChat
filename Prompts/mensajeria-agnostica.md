# Capa agnóstica de mensajería — construcción con varios agentes

> **TENANT piloto:** el comercio con el que se valida la migración. Andres lo
> indica al lanzar la sesión; su ficha vive en `CLIENTES/<TENANT>/`. Es una
> instancia, no parte del diseño: nada de la capa se nombra por un cliente.

Eres la sesión coordinadora de un frente de trabajo: construir en NovuChat una
**capa de mensajería independiente del canal**, donde los chats llegan por
WhatsApp, Messenger, Instagram, un chat web o Telegram a través de
**conectores**, y el resto —agente, memoria, agenda, catálogo, cobro,
umbrales, consola— **no se entera de cuál fue el canal**. El modelo de
negocio está decidido en `Analisis/35-capa-agnostica-de-mensajeria.md`; este
prompt lo ejecuta. No se rediscute el precio ni la unidad de cobro.

Lee primero, en este orden: `CLAUDE.md` entero (prohibiciones, Base comercial,
§7 y Flujo de trabajo), `ESTADO.md`, `CONFIGURACION.md`, `admin/DISENO.md`
(§4sexies, política de capas), y después:

- `Analisis/35-capa-agnostica-de-mensajeria.md` — el negocio, la tabla de canales (§3), lo que se toca y lo que no (§4), el contrato del mensaje normalizado (§4.1), el orden (§5), los riesgos (§6).
- `Analisis/20-un-flujo-para-todos-los-clientes.md` — por qué hoy hay un flujo por cliente y por qué el envío tiene que salir de n8n.
- `Analisis/27-modelo-bloques.md` §8 — por qué la ingesta se abre una sola vez.
- `Analisis/13-requisitos-alta-clientes.md` y `docs/alta-cliente/RUNBOOK.md` — el alta que hoy existe, y que la capa generaliza.
- `Analisis/31` §1 — las reglas de ventana por canal que la oferta tiene que respetar.

Si `Analisis/35` está sin versionar en el worktree principal, tu primera
tarea es llevarlo a tu rama con un commit propio, sin tocar ningún otro
archivo modificado o sin versionar de esa carpeta: hay otras sesiones
trabajando ahí.

## Las decisiones que no se tocan

1. **Una sola unidad de cobro en todos los canales**: conversación de 24 h por
   contacto, bloque de 25 respuestas, umbrales 50/100. La ventana la escribe
   `ingesta.ts`, no el canal. **Contacto = persona en un canal**
   (`<canal>_<id>`); la misma persona por dos canales son dos conversaciones.
2. **Canales por plan**: Base = WhatsApp; Crecimiento = + Messenger e
   Instagram; Corporativo = + Telegram y chat web. Precios sin cambio. El
   límite de canales se hace cumplir **en el servidor**, leído del plan
   (`planes.ts`), con prueba negativa (`CLAUDE.md` §7).
3. **No se vende seguimiento de leads ni reactivación en Messenger ni
   Instagram**: después de 24 h solo pasan los recordatorios con etiqueta
   `CONFIRMED_EVENT_UPDATE`. El conector lo rechaza; la consola lo muestra.
4. **El único canal de WhatsApp es la Cloud API oficial de Meta.** Ningún
   conector no oficial, nunca (prohibición 1).
5. **Ningún token en n8n ni en el repositorio.** Las credenciales de envío de
   cada canal viven en Secret Manager y las usa solo la Function `enviar`.
6. **Nada de Meta ni de producción se escribe sin el «sí» de Andres en el
   chat.** Tú operas; él autoriza. Nunca le pasás comandos para que corra.

## Reutilizar antes de escribir

**Consulta primero `~/Claude-Proyectos/`**: una ficha por proyecto de Andres con
sus módulos reutilizables. Si algo de lo que vas a construir ya existe ahí,
dilo en el chat antes de escribirlo.

Andres tiene otros proyectos con piezas que sirven: una integración ya
probada con la Cloud API de Meta (verificación de firma del webhook, descarga
de medios, envío, plantillas) y el camino para ser proveedor tecnológico; un
proyecto de QR de cobro; el estándar DevSecOps que aplican los agentes
`devsecops`, `seguridad` y `deploy` de este mismo repositorio; y el sitio
`~/Novuchat-site`, donde va el chat web y que edita **su propia sesión**.

**No busques por el disco ni leas otros proyectos por tu cuenta.** Pídele a
Andres las rutas exactas que se pueden leer, y léelas **solo como referencia,
sin modificar nada**. La prohibición 5 de `CLAUDE.md` marca lo que no se toca
bajo ninguna circunstancia, aunque comparta máquina o cuenta de Meta con
NovuChat. Si Andres no indica una ruta, se construye desde cero acá.

## Cómo repartir el trabajo entre agentes

Usa subagentes en paralelo (herramienta `Agent`), **cada uno en su propio
worktree y rama** (`isolation: worktree`), y tú integras. Nunca cambiar de
rama en `~/NovuChat` ni `git add -A`. Un PR por rama contra `main`, con
revisión del agente `seguridad` antes de pedir el OK de fusión. Si Andres
autoriza un workflow de varios agentes, usalo; si no, `Agent` alcanza.

| Agente | Tipo | Qué hace | Cuándo |
|---|---|---|---|
| **Diseño** | `Plan` | El diseño técnico de la capa: colecciones (`/rutas/{canal}/{id}`, `contactoId`), el contrato del mensaje normalizado (`Analisis/35` §4.1), la Function `enviar`, la degradación de botones/listas por canal, y el plan de migración de WhatsApp sin cortar al tenant piloto ni a los demos. Entrega `admin/DISENO.md` §4decies y `docs/mensajeria/DISENO.md` | Primero, solo |
| **Plataforma** | `general-purpose` | Fase 1: rutas por canal, `contactoId` en ingesta y memoria, `canal` en mensajes y agregados (`conversaciones.porCanal`), Function `enviar` con Secret Manager, límite de canales por plan en reglas + Function, pruebas puras y negativas | Después del diseño |
| **Conector WhatsApp** | `flujos-n8n` | Fase 2: el conector de WhatsApp sobre la capa (webhook verificado fuera de n8n, normalización, medios), y los flujos de agendamiento, venta, recordatorios y captación con Webhook genérico y `enviar` en vez del nodo WhatsApp. Migra los demos y el tenant piloto con `publicar-flujo.sh` desde `main`, solo con OK | En paralelo con la fase 1 sobre el contrato acordado; integra después |
| **Conector Messenger + Instagram** | `general-purpose` | Fase 3: webhook de Página e Instagram, PSID/IGSID, respuestas rápidas, etiqueta de recordatorio, rechazo de lo no permitido después de 24 h, alta por inicio de sesión de Facebook para empresas. Prepara la solicitud de revisión de Meta (`pages_messaging`, `instagram_manage_messages`) con los videos; **la envía Andres** | Cuando la fase 1 esté en `main` |
| **Conector chat web** | `general-purpose` | Fase 4: fragmento embebible + Function de sesión anónima, umbrales por contacto y por IP, sin canal de retorno (el asistente pide el WhatsApp para confirmar), CSP y CORS revisados por `seguridad` | En paralelo con la fase 3 |
| **Conector Telegram** | `general-purpose` | Fase 5: bot por comercio (BotFather; token a Secret Manager), teclados en línea, sin ventana | Último; solo si las fases 3 y 4 cerraron |
| **Consola** | `general-purpose` | Fase 6: insignia de canal en conversaciones y tablero, consumo por canal, alta y baja de canales por comercio (página, cuenta, bot, fragmento web), límite por plan visible antes del error | Con la fase 3 |
| **Seguridad** | `seguridad` | Revisa cada PR: firmas de webhook, Secret Manager, reglas de Firestore para `/rutas` y `canal`, CSP del chat web, ningún token en JSON | Antes de cada OK de fusión |
| **DevSecOps y despliegue** | `devsecops`, `deploy` | Pipeline para las Functions nuevas; despliegue a staging; producción la aprueba Andres en el Environment | Al cerrar cada fase |
| **Meta** | `meta-whatsapp` | Guía a Andres en Meta para la app de Messenger/Instagram y la revisión; verifica con `verificar-meta.sh` extendido a páginas | Fase 3 |

**Regla de integración:** ningún conector se fusiona antes de que la fase 1
esté en `main` y la migración de WhatsApp (fase 2) haya pasado la aceptación
con teléfono real del tenant piloto **sin una sola regresión**. Si la fase 2
rompe algo de ese tenant, se detiene todo lo demás.

## Qué construir, por fase

### Fase 1 — La capa (4 jornadas)
- `/rutas/{canal}/{identificadorExterno}` → `{ tenantId, flujo, estado }`,
  reemplazando `/rutasWhatsApp`; `asignarNumero` pasa a `asignarCanal`, con
  compatibilidad para el alta actual.
- `contactoId = <canal>_<id>` en conversaciones, memoria del agente y
  candado; migración de los `wa_<teléfono>` existentes **sin renombrar
  documentos** (alias), para no perder historial ni ventanas abiertas.
- `canal` en cada mensaje y en el agregado del mes (`conversaciones.porCanal`,
  `mensajesPorCanal`). La regla de conteo **no cambia**.
- Function `enviar(tenantId, contactoId, salida)`: resuelve canal y
  credencial en Secret Manager, traduce `opciones` a lo que el canal soporta
  y degrada a texto numerado si no soporta nada; `tipo: recordatorio` elige
  plantilla o etiqueta. Idempotente por `idMensaje`.
- **Límite de canales por plan** en `planes.ts`, reglas y Function, con
  prueba negativa: el comercio con Base **no puede** activar Messenger.
- Declarar en el PR: **cero mensajes agregados por conversación**.

### Fase 2 — WhatsApp adentro (3 jornadas)
Conector fuera de n8n; flujos con Webhook genérico y `enviar`; los tokens
salen de n8n. Migrar demo A, demo B, recordatorios, captación y el tenant piloto, en
ese orden, con las suites de `admin/pruebas/` y la aceptación de
`CLIENTES/<TENANT>/aceptacion.md`. Publicar solo desde `main`, con OK.

### Fase 3 — Messenger e Instagram (3 jornadas + revisión de Meta)
Lo de la tabla. Alta de prueba con una página de NovuChat propia antes de
tocar la de un cliente. El alta de un comercio por Messenger **no necesita
chip, número ni WABA**: documentarlo en el runbook como camino de prueba.

### Fase 4 — Chat web (3 jornadas)
Lo de la tabla. Coordinar con la sesión del sitio para el fragmento en
`novuchat.site` y en el catálogo web propio.

### Fase 5 — Telegram (2 jornadas). Fase 6 — Consola y sitio (2 jornadas)
Glosario: «contacto» por canal; «el asistente de tu negocio, en WhatsApp y
donde te escriban». El texto del sitio lo cambia la sesión del sitio.

### Lo que NO se construye
- Ningún canal no oficial de WhatsApp. Ningún «puente» a wa.me en botones.
- Cruce automático de identidades entre canales.
- Seguimiento de leads o reactivación en Messenger/Instagram.
- Nada que ponga un token en n8n, aunque sea «por ahora».

## Entregables al cerrar
- Un PR por fase y por conector, cada uno con: mensajes agregados/quitados,
  pruebas (puras, negativas, de reglas), resultado **real** con teléfono o
  cuenta de prueba, y la revisión de `seguridad`.
- `docs/mensajeria/DISENO.md` con el contrato del mensaje normalizado y la
  tabla de capacidades por canal; `admin/DISENO.md` con la sección nueva.
- `docs/alta-cliente/RUNBOOK.md` con el alta de cada canal.
- `ESTADO.md` al cerrar cada fase; `CONFIGURACION.md` con los identificadores
  nuevos (solo últimos 4 en los archivos versionados).
- Medición inicial: conversaciones y costo por canal en la consola, que es lo
  que demuestra el 95 % de margen de `Analisis/35` §1 o lo desmiente.
