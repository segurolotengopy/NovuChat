# NovuChat — Resumen integral del proyecto para análisis externo

> **Fecha de corte:** 13 de septiembre de 2026 · **Elaborado para:** revisores
> externos que van a analizar el proyecto por separado (técnico, seguridad,
> comercial, operación, legal).
> **Cómo leer este documento:** es una síntesis de toda la documentación
> interna del repositorio `github.com/segurolotengopy/NovuChat` (público) al
> día de la fecha. Cada afirmación remite al documento interno que la sostiene,
> con la ruta relativa a la raíz del repositorio y, cuando ayuda, la sección o
> la línea aproximada. **Todos los documentos citados vienen en el ZIP que
> acompaña a este resumen**, con la misma estructura de carpetas; el §11 es el
> índice completo.
> **Qué NO contiene:** ningún secreto ni identificador de infraestructura. El
> repositorio es público y se sanea antes de cada commit
> (`CONVENCIONES-REPO-PUBLICO.md`); los valores reales aparecen como
> marcadores `${...}` o `REEMPLAZAR_*`. El paquete fue verificado con
> `scripts/verificar-saneo.sh` en modo exacto antes de armarse.
> **Sobre las referencias a líneas de `ESTADO.md`:** el archivo crece por
> arriba (cada asiento nuevo va al principio), así que los números de línea
> citados corresponden a la versión del 13/09 por la tarde y se desplazan con
> cada asiento. Conviene buscar por el título de la sección, que va entre
> comillas junto al número.

---

## 1. Qué es NovuChat

NovuChat es un servicio de **asistentes conversacionales de WhatsApp para
PyMEs bolivianas**, construido sobre **n8n autoalojado + un modelo de IA**,
con una **consola administrativa** propia (Firebase) desde la que cada
comercio configura su asistente y NovuChat administra la cartera. El comercio
recibe un número de WhatsApp nuevo a su nombre; el asistente atiende a sus
clientes, agenda citas contra Google Calendar o toma pedidos y envía un QR de
cobro, y avisa al negocio por WhatsApp cuando corresponde.

| | |
|---|---|
| **Equipo** | **Andres Alberdi** (arquitectura, infraestructura, comercial; 25 años en arquitectura y gestión de proyectos) y **Silvana** (diseño funcional, guiones, material comercial). Ver `CLAUDE.md` cabecera. |
| **Mercado** | PyMEs de Bolivia en tres verticales iniciales: belleza y salud (agendamiento), gastronomía y comercio minorista (venta y cobro). Sitio público `novuchat.site` (repositorio aparte). |
| **Hito reciente** | Dos demos comerciales el 9 y 10 de septiembre de 2026 (congelamiento el 8). **El resultado de los demos no está registrado en la bitácora** (`ESTADO.md`; ver §7). |
| **Estado al 13/09** | Consola en producción por CI (`v0.1.4`); tres flujos de n8n activos en modo demo; **primer cliente real en negociación** (Q' Taco Mexican Grill, propuesta del 11/09; `Analisis/25`). Ningún cliente paga todavía. |
| **Modelo de ingresos** | Suscripción mensual por **conversaciones** (ventana de 24 h por teléfono): USD 25 / 50 / 90 por 100 / 220 / 500 conversaciones, bolsa de 30 por USD 10, instalación USD 65. Precios en dólares, cobro en bolivianos al tipo de cambio oficial del BCB. Vigente desde el 1 de octubre de 2026 (`CLAUDE.md` «Base comercial»; `Analisis/21`, `23`). |
| **Costo dominante** | Desde el 01/10/2026 Meta cobra cada mensaje del asistente (0,0113 USD en Bolivia, con 1.000 gratis por número y mes). **Meta es el 94 % del costo; el modelo de IA, el 6 %** (`Analisis/14`). |

### 1.1 Los documentos rectores, en orden de lectura

1. `CLAUDE.md` — políticas del proyecto: arquitectura, **seis prohibiciones
   duras**, reglas de diseño de los flujos, base comercial, flujo de trabajo.
   Es el documento normativo; todo lo demás se subordina a él.
2. `ESTADO.md` — bitácora viva (2.119 líneas), organizada por fecha en orden
   inverso. Es la fuente de «dónde estamos».
3. `CONFIGURACION.md` — plantilla pública de parámetros e identificadores
   (Meta, n8n, Google, matriz de secretos, infraestructura, estructura del
   directorio).
4. `Analisis/00` a `25` — la serie de análisis y decisiones, de agosto a
   septiembre de 2026 (§11 los lista uno por uno).
5. `admin/DISENO.md` y `admin/SEGURIDAD.md` — arquitectura y modelo de
   amenazas de la consola.
6. `Flujos/LEEME-flujos.md` y los tres JSON — los flujos de n8n, fuente de
   verdad versionada.

---

## 2. Cronología

Fuente principal: `ESTADO.md` (índice de secciones en su cabecera y en el
§7 de este documento) y `Analisis/00`.

| Fecha | Hito o decisión | Referencia |
|---|---|---|
| 2026-08-18 / 22 | Un canal **no oficial** de WhatsApp (Evolution API) se rompe en silencio por la migración `@lid` de Meta; se retira el 22/08 y queda **prohibido** incluso para demos. | `CLAUDE.md` prohibición 1; `Analisis/01` |
| 2026-08-26 | Presentación comercial original de Silvana (planes de 150/250/350 Bs). | `Preliminares/Presentación NovuChat.html` |
| 2026-08-27 | Se envía la Business Verification de la cuenta de Meta (AAB1). | `Analisis/00` |
| 2026-08-28 | **Bloque fundacional de decisiones:** Meta Cloud API con número de prueba; Gemini en demos y Claude en producción; memoria por teléfono; cobro simulado rotulado por código; el agente no niega ser IA; repositorio público con saneo; JSON de `Flujos/` como fuente de verdad (se retira el generador Python); estándar DevSecOps v2. Demo A funcionando contra WhatsApp real. | `Analisis/00`, `01`, `02`, `03`; `ESTADO.md` l.583–697 |
| 2026-08-29 | Demo A validado de punta a punta; latencia cerrada (p50 ≈ 3,8 s). Compuerta de verificación de reserva. Panel admin con 72/72 pruebas de aislamiento. Hallazgo: la WABA ya tenía plantillas aprobadas, así que los recordatorios no estaban bloqueados. | `ESTADO.md` l.401–565, 851–965; `Analisis/04` |
| 2026-08-30 / 31 | Demo B con canal propio (segundo portafolio, segunda WABA, segundo número); QR por media ID; Demo B validado con rótulos de simulacro. Recordatorios probados a mano. | `GUIA-META-NOVUCHAT.md`; `Analisis/05`; `ESTADO.md` l.979–1060 |
| 2026-09-01 | Oferta comercial con tres cifras (conversaciones, atenciones, interacciones). Se decide tuteo, nunca voseo. Planilla de costo por atención. | `ESTADO.md` l.1062–1090; `Analisis/06` |
| 2026-09-02 / 04 | Proyecto Firebase real único (us-east1); dominio `consola.novuchat.site`. | `ESTADO.md` l.1098–1114 |
| 2026-09-06 | Unidad de cobro = conversación (PR #28); modelo a `gemini-3.5-flash-lite`; funcionarios con agenda propia; política de capas; **cobro real** analizado contra muestras de tres bancos; anulación de citas; **candado por código contra la doble reserva**; cliente OAuth propio para n8n. | `ESTADO.md` l.1147–1560; `Analisis/07` |
| 2026-09-07 | La consola deja de ser maqueta: los tres flujos leen su configuración del panel (probado en vivo). Alta de comercio real posible. Retención de datos: 12 meses. Se descubre que **suspender un comercio no corta nada**. Evaluación de catálogos (nativo, externos, web propio). Se construye el catálogo web propio. | `ESTADO.md` l.305–399, 1562–1923; `Analisis/08`–`13` |
| 2026-09-08 | **Congelamiento.** Demo B pasa a solo texto (22 nodos). Consola con el sistema gráfico del sitio. Serie comercial `Analisis/13`–`24`: precios en USD, planes 25/50/90, tope único de 25 respuestas. Cierre: todo en `main`, 531 pruebas en verde. | `ESTADO.md` l.154–303; `Analisis/14`–`24` |
| 2026-09-09 / 10 | **Demos comerciales.** Sin asiento de resultado en la bitácora. Despliegues manuales de la consola desde ramas. | `ESTADO.md` l.88–89, 124 |
| 2026-09-11 | Propuesta comercial a Q' Taco Mexican Grill (USD 40 / 200 conversaciones). | `Analisis/25` |
| 2026-09-12 | Se descubre que **el pipeline nunca había desplegado nada** (faltaban la federación OIDC y las cuentas de despliegue). Se configura; las etiquetas `v0.1.0` a `v0.1.3` fallan una por una, destapando piezas faltantes. | `ESTADO.md` l.69–120; `.github/DESPLIEGUE-FIREBASE.md` «Estado real» |
| 2026-09-13 | **`v0.1.4` en producción por CI** (Hosting, reglas, índices, 30 Functions). La cuenta de despliegue pierde `secretmanager.admin` (rol a medida). Recomendaciones para Q' Taco. **Decisión de Andres: la conversación pasa a ser un bloque de 25 respuestas** (la respuesta 26 del mismo día factura otra conversación; el asistente ya no se corta), en la rama `cobro/bloques-de-25`, sin confirmar. Corrección de nueve inconsistencias documentales. | `ESTADO.md` asientos del 13/09; `Analisis/27`; PR #60 y #61 |

Historial completo: `ANEXO-historial-git.txt` y `ANEXO-pull-requests.txt` en
el ZIP (230 commits, 61 pull requests, etiquetas `v0.1.0` a `v0.1.4`).

---

## 3. Arquitectura técnica

```
WhatsApp (Meta Cloud API, Graph v26.0)
   └── webhook ──► n8n 2.36.5 autoalojado en OCI (VM ARM, 2 OCPU, compartida)
                     ├── Filtro de eventos (solo `messages`)
                     ├── Traer configuración ──► consola (Cloud Function `configuracionFlujo`)
                     ├── Normalizar entrada (text / interactive / order / image / audio / …)
                     ├── AI Agent (Gemini 3.5 Flash-Lite en demos; Claude Haiku en producción)
                     │     ├── memoria por número de teléfono (clave de sesión explícita)
                     │     └── herramientas: Google Calendar (consultar, agendar, buscar, cancelar)
                     ├── Procesar respuesta (compuertas por código: rótulos, transferencia, QR)
                     ├── Responder al cliente + avisar al negocio (WhatsApp)
                     └── Reportar mensaje / Registrar cierre ──► consola (`ingesta`, `registrarCierre`)

Consola administrativa (Firebase: Hosting + Auth + Firestore + 30 Cloud Functions)
   ├── consola.novuchat.site  (SPA React 19 + Vite + TypeScript)
   └── catálogo web público por ficha firmada (/c/<ficha>) con carrito servidor a servidor
```

### 3.1 Canal: WhatsApp Cloud API de Meta

- **Único canal permitido.** Prohibición 1 de `CLAUDE.md`. El porqué está en
  `Analisis/01` §canal y en la referencia externa
  `~/WhatsApp-Modular/docs/13-laboratorio-evolution.md` (fuera de este repo).
- **Hoy: dos apps de Meta, dos WABAs, dos números de prueba**, uno por demo,
  porque cada app tiene una sola URL de webhook y Meta da un número de prueba
  por portafolio comercial (`Analisis/05` §bloqueo; `GUIA-META-NOVUCHAT.md`).
  El número de prueba responde solo a **5 destinatarios registrados**
  (prohibición 6).
- **Guía de Meta de once bloques** (`GUIA-META-NOVUCHAT.md`, 2 h 30 sin
  costo): portafolio, app, número, modo Live, destinatarios, token permanente
  de usuario de sistema, `subscribed_apps` por API (no existe en la interfaz),
  credenciales en n8n, webhook, QR por media ID, prueba de humo. Cierra con
  «los once tropiezos que ya pagamos». Es también la guía para dar de alta un
  cliente real en su propio portafolio (`Analisis/13`).
- **Restricciones que gobiernan el diseño:** ventana de servicio de 24 h
  (fuera de ella solo se puede escribir con **plantilla aprobada**, error
  `131047`); la WABA del proyecto tiene 6 plantillas aprobadas, entre ellas
  `recordatorio_cita_manana` (`ESTADO.md` l.894–921); techo de 20 números por
  WABA verificada; la WABA de demos se comparte con otro producto en producción
  (`Demo SeguroLo Tengo`, sistema financiero de OTP) que **no se toca**
  (prohibición 5; `CONFIGURACION.md` §1).
- **Camino a escala:** hoy un flujo por cliente (lo obliga la credencial del
  disparador). El destino es **Tech Provider con Embedded Signup**: una app,
  un webhook, un disparador, enrutamiento por `phone_number_id`. Exige
  verificar NovuChat con NIT propio y App Review; se decidió **no** construir
  el nivel intermedio de «un flujo con varios disparadores» porque el token
  viajaría en los datos de ejecución (`Analisis/20`).

### 3.2 Orquestación: n8n en OCI

- n8n **2.36.5 (fijada)**, licencia Community registrada (no comparte flujos
  entre usuarios: la cuenta de Andres es dueña de lo productivo; Silvana
  desarrolla por export/import). Base `pgvector/pgvector:pg16`. Zona horaria
  `America/La_Paz`. Nodos Code **solo en JavaScript** (la imagen no trae
  Python). `CONFIGURACION.md` §2.
- VM de OCI ARM de 2 OCPU compartida con Odoo, Nginx Proxy Manager y el
  `otp-service` del otro producto. Respaldo diario a Object Storage
  (`CONFIGURACION.md` §5). Estimación de capacidad: ~360.000 ejecuciones/mes
  con 300 clientes, a medir antes del cliente cincuenta (`Analisis/20`).
- **Reglas de diseño obligatorias de los flujos** (`CLAUDE.md` «Reglas de
  diseño»): memoria con clave de sesión = `messages[0].from`; filtro de
  acuses de estado antes del agente; normalización de todos los tipos de
  mensaje; fecha, hora y zona inyectadas al prompt; modelo como sub-nodo
  intercambiable; **todo lo configurable vive en el nodo `Config del
  negocio`** (y hoy, en la consola); cada cambio declara cuántos mensajes
  agrega o quita; política de capas.
- **Ciclo de trabajo:** se edita en n8n, se exporta, se sanea (marcadores
  `REEMPLAZAR_*`) y se reemplaza el JSON. `scripts/preparar-import.sh` fija
  el `webhookId` y `scripts/publicar-flujo.sh` actualiza el flujo publicado
  en su lugar por la API pública. **Nunca se edita a mano el flujo de un
  cliente** (`CLAUDE.md` «Flujo de trabajo»; `Flujos/LEEME-flujos.md` §0).
- **Operación remota:** `scripts/ver-ejecuciones.sh` (diagnóstico sin abrir
  el navegador), `scripts/verificar-meta.sh` (cuatro condiciones para que
  lleguen mensajes), `scripts/verificar-credencial-cierres.sh`,
  `scripts/enviar-prueba.sh`, `scripts/enviar-plantilla.sh`,
  `scripts/listar-plantillas.sh`, `scripts/subir-qr.sh`. Cada script tiene
  su porqué en la cabecera.

### 3.3 Modelo de IA

- **Demos:** Google Gemini por el nodo nativo de n8n; el 06/09 se bajó de
  Flash a **`gemini-3.5-flash-lite`** porque Flash perdía 144 Bs/mes en el plan
  Pro (`ESTADO.md` l.1202–1215). Facturación prepaga con alerta en 20 USD.
- **Producción:** Claude por el sub-nodo Anthropic Chat Model, sin tocar el
  resto del flujo (criterio B-7). La tabla de márgenes muestra que «Claude en
  producción» significa **Haiku con caché de prefijo**: pasar a Haiku sube el
  costo total un 7 % (`Analisis/14` §caché). **La elección de modelo se toma
  por calidad**, porque el modelo pesa 6 % del costo.
- **Lecciones registradas:** un cambio de modelo rompió en silencio los
  detectores de texto de los prompts; por eso los candados críticos (doble
  reserva, rótulos del cobro simulado, no negar ser IA) están **en código, no
  en el prompt** (`ESTADO.md` l.798, 1443; `Analisis/05` §prohibición 3).
- El agente inventó una dirección en un chat de prueba (29/08); de ahí la
  regla de que los datos del negocio viajan rotulados y los derivados nunca
  se leen de la configuración (`ESTADO.md` l.934–965; `admin/DISENO.md` §5).

### 3.4 Consola administrativa (`admin/`)

Fuente: `admin/LEEME.md`, `admin/DISENO.md`, `admin/SEGURIDAD.md`,
`admin/firestore.rules` (comentado de punta a punta).

- **Propósito:** sostener la promesa de **instalar un cliente en 48 horas**
  sin editar n8n a mano: alta y baja de negocios, usuarios con roles,
  configuración del asistente, catálogo, visor de conversaciones, métricas,
  cobros, reclamos, bitácora (`DISENO.md` §1).
- **Stack:** Firebase Hosting con SPA estática (React 19, Vite, TypeScript
  strict; sin SSR: la autorización vive en un solo lugar, `firestore.rules`);
  Auth con Google y correo/contraseña; Firestore; **30 Cloud Functions v2**
  (Node 22); App Check con reCAPTCHA Enterprise; CSP con `default-src 'none'`
  y un bloque más cerrado para el catálogo público (`SEGURIDAD.md` §5bis).
  Un proyecto GCP real en `us-east1`, dominio `consola.novuchat.site`.
- **Roles, cada uno atado a un proveedor de identidad distinto**
  (`DISENO.md` §4.3 y §4ter.1): propietario NovuChat (solo Google; no lee
  conversaciones salvo ventana de soporte de 1 a 24 h que abre el comercio),
  admin del negocio (contraseña, correo verificado), operador (contraseña,
  sin datos privados) e **ingesta** (n8n, token personalizado, escribe pero
  no lee). El rol sale **siempre de custom claims**, nunca de un documento.
- **Modelo de datos** (`DISENO.md` §4.2): `/tenants/{t}` con subcolecciones
  `config/negocio` (común), `config/agendamiento`, `config/venta`,
  `config/marca`, `catalogo`, `fotosCatalogo`, `funcionarios` (+ `privado`),
  `agenda` (candado de 15 min), `conversaciones/{wa_tel}/mensajes`
  (inmutables), `metricas/{aaaa-mm}`, `cierres` (unidad facturable),
  `pedidos`, `cuenta/estado`, `reclamos`, `bitacora`, `auditoria`,
  `accesosSoporte`. Colecciones de plataforma: `/rutasWhatsApp/{phoneNumberId}`
  (índice inverso número → comercio, alias del secreto, webhook del carrito),
  `/plataforma/cobroSimulado`, `/plataforma/notificaciones`, `/fichasCatalogo`.
- **Política de capas** (`DISENO.md` §4sexies; `CLAUDE.md`): tres capas
  (flujos, consola, usuarios). Lo común (identidad, horarios, voz, catálogo,
  usuarios) no se repite por flujo; lo propio de un flujo (agendas, QR, costo
  de entrega) es excluyente y trae su documento `/config/{flujo}`, su línea en
  la tabla de capacidades y su pestaña en `admin/web/src/lib/flujos.ts`. Un
  negocio tiene uno o más flujos (`tenants/{id}.flujos`), cada uno en su
  propio número. Las pestañas son cosméticas: **la regla del servidor manda.**
- **Cloud Functions** (lista completa con disparador en
  `admin/functions/src/index.ts`): `altaTenant`, `bajaTenant`,
  `suspenderTenant`, `reactivarTenant`, `asignarNumero`, `liberarNumero`,
  `invitarUsuario`, `quitarUsuario`, `actualizarEstadoCuenta`,
  `otorgarAccesoSoporte`, `revocarAccesoSoporte`, `configuracionParaFlujo`,
  `moverReclamo`, `registrarCambioConfig`, `ingesta`, `configuracionFlujo`,
  `registrarCierre`, `registrarQrDeCobro`, `imagenDeCobro`, `enlaceCatalogo`,
  `catalogoPublico`, `checkoutCatalogo`, `fotoDeCatalogo`,
  `vistaPreviaCatalogo`, `fijarWebhookCarrito`, `notificarReclamo`,
  `comprobarImagenDelCatalogo`, `recomprobarImagen`, `ajustarStock`,
  `dejarDeControlarStock`.
- **Pruebas:** **536 en verde en `main` al 13/09** (229 de reglas contra el
  emulador y 307 puras; corrida real de `pnpm pruebas:reglas`; 551 con la
  rama de bloques). Casi todas las pruebas de reglas son negativas
  (`assertFails`), con un bloque de «control de la semilla» que evita el falso
  verde por documento inexistente (`admin/LEEME.md` «Cómo trabajar»;
  `admin/SEGURIDAD.md` «Resultado real de las pruebas»).
- **Entorno local:** emuladores de Auth y Firestore, datos sembrados,
  usuarios de prueba, rodeo documentado por el límite de inotify
  (`admin/LEEME.md`).

### 3.5 Integración flujo ↔ consola

`DISENO.md` §5 y §4bis.4; `admin/functions/src/firma.ts`.

- **Un secreto HMAC por número**, nombrado por alias (`INGESTA_DEMOA`,
  `INGESTA_DEMOB`, `INGESTA_CLIENTE01`…`20`) en Secret Manager; el alias vive
  en `/rutasWhatsApp`. Reserva de 20 para que el alta no exija despliegue.
  Ampliar la reserva es un paso a mano (`.github/DESPLIEGUE-FIREBASE.md`).
- **El tenant sale de la clave que validó la firma, nunca del cuerpo**
  (amenazas T-2 y T-11 de `SEGURIDAD.md`).
- Tres endpoints: `configuracionFlujo` (el flujo trae toda su configuración
  al empezar cada turno; devuelve **409 con mensaje de cortesía** si el
  comercio no está activo; n8n no cachea más de 60 s), `ingesta` (reporta
  cada mensaje entrante y saliente; cuenta conversaciones y respuestas del
  período) y `registrarCierre` (cita o venta, idempotente por referencia).
- **La consola manda; el flujo cae a un respaldo (`Config base`) solo si el
  panel no contesta.** La política ante silencio difiere: los flujos
  conversacionales siguen con el respaldo; los recordatorios cortan
  (`ESTADO.md` 2026-09-07). Brecha conocida: el respaldo del Demo B es el del
  demo y mandaría un QR simulado a un cliente real (`Analisis/25` §3.4).
- Fase 2 prevista y no hecha: token efímero con claim `ingesta` para que la
  ingesta pase por las reglas en vez del SDK Admin (`SEGURIDAD.md` pendientes;
  `ESTADO.md` l.2045).

### 3.6 Catálogo web propio

`admin/CATALOGO-WEB.md`; `Analisis/11`; `DISENO.md` §4octies.

- Página pública con la marca del comercio en `/c/<ficha>`, **ficha firmada
  por conversación** (HMAC, 72 h, hasta 5 checkouts), **carrito que vuelve
  servidor a servidor**: el precio se recalcula en la Function, el pedido se
  escribe en `/pedidos` y n8n recibe un webhook para continuar la
  conversación (o enviar la plantilla «tu carrito te espera» fuera de 24 h).
  Se eligió frente al catálogo nativo de WhatsApp y a las plataformas
  externas porque en estas el carrito llega como **texto editable por el
  cliente** (`Analisis/09`, `10`, `11` §comparación).
- Solo para el flujo `venta`. Importación CSV/TSV/XLSX con fotos; comprobación
  de fotos con protección SSRF y veredicto de modelo que no bloquea; logo
  incrustado; cinco paletas con contraste AA.
- **Regla de tamaño:** hasta 40 ítems, la lista completa con precios va al
  prompt; por encima, resumen y enlace. El corte no es económico (500 ítems
  cuestan menos de medio mensaje): lo fijan la legibilidad y la confiabilidad
  del modelo (`Analisis/19`). Lo que no se puede comprar por chat no se
  publica.
- **Estado:** en `main` desde el 08/09 (PR #43), 403 pruebas en esa rama;
  faltan los dos nodos de n8n, la plantilla de Meta, la prueba con teléfono,
  la reentrega si falla el webhook y la purga de fichas (`ESTADO.md` l.351–399).
  Efecto económico esperado: un pedido baja de ~13 a 4–5 mensajes (−68 %).

### 3.7 Cobro: simulado vs. real

Prohibición 3 de `CLAUDE.md`; `Analisis/05`, `07`, `08`; `DISENO.md`
§4sexies.3 y §4nonies; `admin/functions/src/cotejo.ts`.

- **Simulado (demos):** QR con estructura EMVCo real pero comercio ficticio
  (una app bancaria lo rechaza a propósito), rótulo impreso **en la imagen y
  en el caption**, confirmación que dice «simulado». Tres compuertas por
  código en `Procesar respuesta` corrigen la salida del modelo si le falta el
  rótulo. Los rótulos viven en `/plataforma/cobroSimulado` y **ningún comercio
  puede editarlos** (probado atacándolo, `ESTADO.md` l.1667–1675).
- **Real (clientes):** el comercio sube su QR; la consola extrae el texto, lo
  valida y **lo redibuja** (nunca guarda la imagen). Se reconocen dos familias
  de QR bolivianos: EMVCo y **cifrado** (el del BNB no es EMVCo). El OCR de un
  comprobante coteja importe, fecha y destinatario **y nunca acredita**: el
  asistente dice que el comprobante llegó y los datos coinciden; quien
  confirma es el banco y el negocio. El Banco de Crédito no muestra el nombre
  del receptor y enmascara la cuenta, lo que define las reglas de cotejo
  (`Analisis/07`).
- **Estado:** el cotejo, el reconocimiento y el dibujo del QR y la pantalla de
  cobros existen en la consola (58 pruebas); **el flujo de n8n del cobro real
  no existe** (faltan los nodos de descarga del media, OCR con Gemini y
  cotejo; `ESTADO.md` l.1377–1391; `Analisis/25` §1.2). La integración
  bancaria por API (Banco Económico, estándar Pagos Inmediatos QR del BCB) se
  hará después reutilizando el proyecto hermano `ManejoQRSimple`
  (`Analisis/08`).

### 3.8 Sitio web `novuchat.site`

Repositorio aparte (`~/Novuchat-site`, Astro), **no se edita desde este
repositorio**. Las instrucciones vigentes para alinearlo con la base
comercial están en `Analisis/22` (moneda USD, planes 25/50/90, tope de 25,
vocabulario «conversaciones», promesas a retirar). `Analisis/18` quedó
superado en cifras. **Ninguno de esos cambios estaba aplicado al 08/09**
(`ESTADO.md` l.1919–1923, 2003–2006): el sitio todavía dice «sin importar
cuántos sean» y promete una suspensión por falta de pago que hoy no ocurre.

### 3.9 Infraestructura, CI/CD y DevSecOps

`.devsecops.yml`; `.github/DESPLIEGUE-FIREBASE.md`;
`.github/workflows/ci-node-firebase.yml`; `admin/SEGURIDAD.md` §4;
`CONVENCIONES-REPO-PUBLICO.md`.

- **Estándar DevSecOps v2.2, modo A** (repositorio público, cuenta personal
  de GitHub). Jobs: preparar, calidad, seguridad estática (Gitleaks, Semgrep,
  Trivy, OSV, CodeQL, Scorecard), calidad de documentación, construir,
  desplegar (dev / staging / producción), DAST y humo (ZAP), post-despliegue
  con health check y rollback automático, compuerta de PR. Dependabot activo.
- **Despliegue solo por etiqueta `v*` sobre `main`**, con revisor humano en
  el Environment `production` y `firebase deploy --dry-run` previo en la misma
  aprobación. **Sin clave JSON de cuenta de servicio:** federación OIDC (WIF)
  con condición de atributos por identificadores inmutables de repositorio y
  Environment (la versión por nombres falló el 12/09 y está documentada). No
  hay proyecto de staging.
- **Historia relevante:** el pipeline **nunca desplegó nada hasta el 12/09**;
  llegar al primer despliegue verde (`v0.1.4`, 13/09) destapó seis piezas
  faltantes (lockfile de Functions con enlaces locales, dependencias de
  runtime, permisos de `ActAs`, rol de secretos, checkout del job
  post-despliegue). Cada una está en `.github/DESPLIEGUE-FIREBASE.md` «Estado
  real» y en `ESTADO.md` l.36–120.
- **Secretos:** matriz de dónde vive cada uno en `CONFIGURACION.md` §4.
  Regla: nunca en el repositorio, ni en JSON exportados, ni en sticky notes
  (prohibición 2). `scripts/verificar-saneo.sh` compara los archivos
  versionables contra los valores reales locales antes de cada commit y corre
  en CI en modo de patrones. Excepción vigente de Trivy: CVE-2026-41907 en
  `uuid` transitivo, no alcanzable, vence 2026-10-31 (`.devsecops.yml`).
- **Pendientes de seguridad declarados:** cuenta propia para las Functions
  sin rol Editor; ingesta por rol en vez de SDK Admin; MFA y política de
  contraseñas para comercios (Identity Platform); App Check en monitoreo;
  separar el catálogo público en otro origen antes del primer comercio con
  `catalogoWebActivo` (T-37); reclamos por FormSubmit sin contrato; rotar la
  ruta UUID del webhook; Silvana no es revisora en GitHub, así que la
  separación de funciones es un acuerdo de proceso (`SEGURIDAD.md`
  «Pendiente en la nube»; `ESTADO.md` l.2045–2060).
- **Agentes de trabajo:** el repositorio define cuatro agentes de Claude Code
  en la carpeta `.claude/agents/` (`deploy`, `devsecops`, `proyectos`,
  `seguridad`) y dos skills (aplicar el estándar, preparar un pase a
  producción).

---

## 4. Los flujos de n8n

Fuente: `Flujos/LEEME-flujos.md` y los JSON. Los tres parten de los
borradores de Silvana (`Preliminares/gemini-code-*.json`) con las
correcciones de `Analisis/01` y `02` aplicadas.

### 4.1 Demo A — Agendamiento (Belleza y Salud), «Sofía»

`Flujos/demo-a-agendamiento.json`, **30 nodos**. Trigger → ¿Es un mensaje? →
Config base → Traer configuración → ¿Comercio operativo? → Config del negocio
→ Normalizar entrada → **AI Agent** (Gemini; memoria por teléfono;
herramientas `consultar_disponibilidad`, `agendar_cita`, `buscar_mi_cita`,
`cancelar_cita`) → Procesar respuesta → Responder al cliente → ¿Transferir a
humano? → Avisar a recepción. Ramas de control: **¿Afirma que agendó? →
Verificar en el calendario → Comprobar reserva** (compuerta contra citas que
el modelo «dice» que agendó y no existen); **candado contra la doble
reserva** con «Deshacer cita solapada» y desempate por identificador;
«Calendarios a revisar» por funcionario; «Registrar cierre (cita)» y los dos
«Reportar mensaje» hacia la consola.

- Reglas por vertical: belleza con precios; salud sin cotizar y con manejo
  de objeción; **tercer rechazo → transferencia a recepción** con la marca
  `[TRANSFERIR]` que el cliente nunca ve.
- Latencia medida el 29/08: p50 ≈ 3,8 s, peor caso 5,34 s, contra el
  criterio p50 ≤ 6 s, p90 ≤ 10 s, peor ≤ 15 s (`Analisis/04`; `ESTADO.md`
  l.429–437). El candado hace **una llamada a Google Calendar por cada
  calendario configurado**: es lo que limita las agendas por plan a
  «hasta 10» (`Analisis/24`).
- Recursos: calendario de relleno con 55 eventos y huecos a propósito
  (`Demo-Recursos/calendario-demo-relleno.ics`), suite de aceptación A1–A9
  (`Demo-Recursos/suite-a-hoja-de-marcado.md`, con mensajes por caso).

### 4.2 Demo B — Venta y cobro (Gastronomía y Retail)

`Flujos/demo-b-venta-cobro.json`, **22 nodos** (solo texto: las listas
interactivas se quitaron el 08/09). Misma cabecera → AI Agent sin
herramientas (memoria por teléfono) → Procesar respuesta (compuertas de las
prohibiciones 3 y 4) → Responder → **¿Enviar QR? → Enviar QR (imagen DEMO)**
por media ID → **¿Pedido confirmado? → Avisar al dueño** → ¿Hay comprobante?
→ ¿Registrar venta? → Registrar cierre (venta).

- Pedido con notas, variantes (talla/color), envío por flota con **Nombre y
  CI obligatorios antes del QR**, recargo de terminal, costo de envío
  configurable. Precios de demo (hamburguesa doble 35 Bs, chaqueta 180 Bs…)
  replicados en el simulador de contingencia.
- Defectos corregidos con valor de lección: el emparejamiento por índice
  enviaba la respuesta de un cliente al teléfono de otro; la configuración
  viajaba en el ítem (`Analisis/05` §defectos).

### 4.3 Recordatorios de citas

`Flujos/demo-a-recordatorios.json`, **12 nodos**. Cron 17:00 La Paz → Traer
configuración → Calendarios del negocio → Citas de mañana → Preparar
recordatorios → ¿Plantilla aprobada? → Enviar plantilla (HTTP) / Enviar texto
→ ¿Se envió de verdad? → Marcar como recordado. Corta si la consola no
responde. Probado a mano el 31/08; al 07/09 «nunca se lo vio correr solo»
(`ESTADO.md` l.345–347, 1526–1560).

### 4.4 Lo que a los tres les falta para un cliente pagador

- **El conteo de 25 respuestas por conversación no está en los flujos
  vivos.** El tope con corte se implementó en la rama
  `integracion/prepago-sobre-flujos-vivos` con 35 pruebas y nunca se aplicó
  (`ESTADO.md` «Por qué NO se tocaron los flujos»); el 13/09 la definición
  cambió a **bloques de 25** (`Analisis/27`), y lo que el flujo debe hacer
  ahora es avisar a recepción al empezar el bloque 2 y aplicar un tope de
  seguridad de 100 respuestas por ventana.
- **Corte por suspensión: hecho.** Se corrigió el 07/09 en los tres flujos
  (commit `2e251f9`; los nodos «¿Comercio operativo?» y «Comercio no
  operativo» deciden por el código 409 del panel y cortan antes del agente;
  17 pruebas en `admin/pruebas/estado-comercio.test.ts`) y se republicó esa
  noche. Queda confirmar el segundo camino del 409 del prepago (`sin_pago`,
  `sin_conversaciones`) cuando esa rama se reaplique.
- Idempotencia ante reintentos de Meta; avisos al negocio por plantilla
  utility (fuera de 24 h el texto libre falla); espera por teléfono ante
  ráfagas (`Analisis/25` §3).

---

## 5. Modelo comercial y económico

Fuente normativa: `CLAUDE.md` «Base comercial». Análisis: `Analisis/14` a
`24`; modelo reproducible en `Analisis/14-modelo-costos.py` (quedó con los
planes previos a `21`).

### 5.1 Estructura de costos

Desde el **1 de octubre de 2026** Meta cobra cada mensaje del asistente
dentro de la ventana de 24 h (categoría servicio, «Rest of Latin America»).

| Concepto | Valor | Fuente |
|---|---|---|
| Mensaje de servicio / utilidad | 0,0113 USD (≈ 0,1356 Bs) | `Analisis/14` §1 |
| Mensaje de marketing | 0,074 USD | `Analisis/14` |
| Franquicia | 1.000 mensajes de servicio gratis por número y por mes, no acumula | `Analisis/14` |
| Conversación típica del flujo A (10 respuestas, fuera de franquicia) | 1,508 Bs: Meta 1,356 + recordatorio 0,054 + modelo 0,097 | `Analisis/14` §3 |
| Conversación típica del flujo B (hoy) | 1,86 Bs; con catálogo web, 0,589 Bs | `Analisis/19` |
| Peso de Meta / modelo | 94 % / 6 % | `Analisis/14` |
| Caché del prefijo | ahorra 0,07 Bs por conversación (no vale el esfuerzo) | `Analisis/14` |
| Infraestructura | OCI Always Free hasta decenas de flujos; Secret Manager ≈ 1 USD/mes por 20 secretos; Firebase en capa gratuita | `Analisis/14` §escala |

Consecuencia operativa: **acortar la conversación es la única palanca que
rinde.** Un mensaje largo y completo es más barato que dos cortos; la regla
vieja de «máximo 3 oraciones» juega en contra (`Analisis/17`;
`Demo-Recursos/suite-a-hoja-de-marcado.md`).

### 5.2 Unidad de cobro y tope

- **Conversación = ventana fija de 24 h por teléfono.** Se evaluaron el cobro
  por respuesta y la «conversación general» (por asunto) y se descartaron:
  la previsibilidad es el argumento de venta y la unidad ya está construida en
  prepago, consola y sitio (`Analisis/15`). Revisión a los tres meses del
  primer cliente pagando. «Atención» (persona distinta) **no se factura**.
- **25 respuestas del asistente por conversación, igual en los tres planes.**
  El escalonado por plan estaba al revés económicamente: el plan chico vive
  dentro de la franquicia y un plan caro con tope menor es invendible
  (`Analisis/16`). **La cola de conversaciones largas importa más que el tope
  y nadie la midió.**
- **Cómo se aplica la cifra cambió el 13/09** (`Analisis/27`, decisión de
  Andres, en la rama `cobro/bloques-de-25` y sin confirmar en producción):
  la versión del 08/09 cortaba al asistente a las 25 con una respuesta fija;
  la nueva la trata como **bloque**: la respuesta 26 del mismo día abre otro
  bloque y factura otra conversación, el asistente sigue atendiendo, recepción
  recibe un aviso al empezar el bloque 2 y el flujo lleva un tope de seguridad
  de 100 respuestas por ventana. En dinero es casi neutro (entre −0,4 y +8,6
  USD por comercio y mes); lo que gana es continuidad y lo que pierde es el
  techo de costo por ventana. `CLAUDE.md` «Base comercial» §2 se reescribió
  en esa rama con la regla nueva.

### 5.3 Planes vigentes (desde el 01/10/2026)

Propuesta de Silvana, analizada y adoptada en `Analisis/21`; bolsa ajustada
en `Analisis/23`; agendas en `Analisis/24`.

| Plan | Precio | Conversaciones | Agendas | Margen a 10 msj (post-impuestos 16 %) | Con mezcla realista |
|---|---|---|---|---|---|
| Impulso | USD 25 | 100 | 1 | 79 % | 79 % |
| Crecimiento | USD 50 | 220 | 5 | 51 % | 59 % |
| Pro | USD 90 | 500 | hasta 10 | 27 % | 37 % |

- Bolsa: **USD 10 por 30 conversaciones** (0,333), no vence. Mínimo para no
  perder nunca con tope 25: 0,3632 USD; en cartera nunca da negativo. **Si el
  tope sube, se recalcula la bolsa.**
- Instalación USD 65 (bonificada en la Rueda de negocios); a medida desde
  USD 125.
- **El plan de entrada cabe exacto en la franquicia** (100 × 10 = 1.000): no
  paga mensajería y es inmune a subidas de tarifa. El plan grande **se da
  vuelta a 14 mensajes por conversación** y no se estira más allá de 500
  conversaciones sin rehacer la cuenta.
- **Moneda:** lista en USD; cobro en Bs al **Tipo de Cambio Oficial del BCB**
  (Bolivia tiene régimen flexible desde el 29/06/2026; TCO 12,60 al 08/09).
  NovuChat no publica un tipo de cambio propio. Hay que **registrar el TCO
  aplicado a cada pago**. Sin decidir: si se toma el TCO del día de pago o el
  del primer día hábil del mes (`Analisis/22` y `25` difieren).
- **No cobrar distinto por flujo** (`Analisis/19`); un comercio con dos flujos
  estrena una segunda franquicia.
- Vigilar comercios por encima del 70 % del plan: es donde el margen se
  erosiona.

Precios anteriores que aún aparecen en documentos viejos y en el sitio:
150/250/350 Bs (pitch de agosto), 250/450/850 Bs (`Analisis/13`, notas de
Silvana del 07/09), USD 20/40/70 (`Analisis/14`, `17`, `18`). La vigente es
la tabla de arriba.

### 5.4 Límites comerciales y dónde se hacen cumplir

`CLAUDE.md` §7: **un límite que solo existe en la pantalla no existe.**

| Límite | Se hace cumplir en | Estado al 13/09 |
|---|---|---|
| Agendas por plan (1 / 5 / hasta 10) | `firestore.rules` | **No existe todavía** |
| Conversaciones incluidas (100 / 220 / 500) | `ingesta.ts`, transacción de conteo | Hecho en la rama de prepago, no en `main` |
| Conteo de 25 respuestas (bloque desde el 13/09) | la ingesta (`ingesta.ts`, rama `cobro/bloques-de-25`) y el flujo de n8n para el aviso y el tope de seguridad | **Ingesta en rama; nada aplicado a los flujos vivos** |
| Ítems del catálogo al prompt | `configuracionFlujo` | `limit(200)`, sin corte por plan |

### 5.5 Promesas del sitio y la presentación a corregir

`Analisis/17` §promesas y `Analisis/22`: audios, fidelización, difusión masiva
(0,89 Bs por mensaje), validación autónoma de comprobantes, mesas, colegios,
SQL/ERP, cifras sin fuente («80 % no vuelve», «391 %»), «sin importar cuántos
sean», «no se corta el servicio». Dos cláusulas contractuales pedidas:
conversión USD → Bs y revisión de precio si Meta cambia la tarifa.

---

## 6. Primer cliente real: Q' Taco Mexican Grill

`Analisis/25` (13/09/2026). Propuesta del 11/09: **USD 40 por 200
conversaciones** (0,20 por conversación, bonificado frente a 0,227 de lista),
instalación USD 125, «tres flujos» (venta del menú, campañas de Facebook,
reservas) en un solo número.

Decisiones definidas:

- **Un solo flujo** `qtaco-restaurante.json`, copia del flujo B, con tres
  intenciones; reservas de mesa versión 1 = el asistente registra y una
  persona confirma.
- **Cobro real** con el QR del restaurante; el asistente **nunca** dice «pago
  confirmado» (el borrador de prompt de Silvana lo dice y hay que corregirlo).
  Mínimo viable: reenviar el comprobante al celular del restaurante con el
  resumen del pedido.
- Menú de 69 precios en la consola (resumen al prompt, lista completa al
  catálogo web); campañas como ítem del catálogo, leyendo `referral` para
  **medir la ventana de punto de entrada gratuito**.
- Chip nuevo a nombre del dueño, nunca con WhatsApp instalado; portafolio,
  app y WABA del cliente; NovuChat como socio del portafolio; avisos al
  restaurante por **plantillas utility**.
- **Economía:** con 8 mensajes por pedido, ≈ USD 32 de margen; con 18, ≈ 9;
  al tope, negativo.

Falta: el flujo en sí, reaplicar el tope de 25 y cerrar el corte por
suspensión antes del 01/10 y del primer cobro, los nodos de cobro real y OCR,
guardar el comprobante y el pedido conversado, la consola con mensajes del
mes contra los 1.000 gratis, y corregir propuesta y contrato (definición de
conversación, USD/TCO, quién confirma pagos, retención 12 meses).

---

## 7. Estado actual: qué funciona, qué está en producción, qué falta

| Componente | Estado al 13/09/2026 | Evidencia |
|---|---|---|
| Flujo A agendamiento | Activo en n8n (demo), 30 nodos, validado con teléfono real, latencia dentro del criterio | `ESTADO.md` l.169–200 |
| Flujo B venta y cobro | Activo (demo), 22 nodos, cobro simulado con rótulos verificados; **cobro real no existe en el flujo** | `ESTADO.md` l.1377–1391 |
| Recordatorios | Activo, 12 nodos, plantilla aprobada; sin registro de corrida autónoma exitosa | `ESTADO.md` l.345, 2029 |
| Consola admin | **En producción por CI, `v0.1.4`**, 30 Functions, App Check, dominio propio; tres superadministradores | `ESTADO.md` l.36–67 |
| Catálogo web | En `main`, no confirmado en servicio; faltan nodos de n8n y plantilla | `ESTADO.md` l.179–181, 351–399 |
| Cobro real (consola) | Cotejo, QR y pantalla de cobros hechos; comprobante no se guarda | `DISENO.md` §4nonies.3 |
| Prepago / conteo de 25 | Prepago en rama `integracion/prepago-sobre-flujos-vivos` (35 pruebas; planes con números viejos); conteo por bloques en rama `cobro/bloques-de-25` (15 pruebas); nada en los flujos vivos | `ESTADO.md` «Dos defectos encontrados al validar» y asiento de `Analisis/27` |
| Corte por suspensión | **Hecho** desde el 07/09 en los tres flujos (17 pruebas) | `ESTADO.md` «Suspender un comercio NO le cortaba el asistente» |
| Sitio web | Sin los cambios de `Analisis/22` | `ESTADO.md` l.1919, 2003 |
| CI/CD | Despliega a producción por etiqueta con aprobación; sin staging; pendiente cuenta propia de Functions | `.github/DESPLIEGUE-FIREBASE.md` |
| Demos 9–10/09 | **Sin resultado registrado** | `ESTADO.md` (ausencia) |
| Cliente real | Q' Taco en negociación; nada instalado | `Analisis/25` |

**Riesgos abiertos** (lista consolidada; cada uno con su sección en
`ESTADO.md`):

1. Conteo de 25 (bloques) no aplicado a los flujos vivos antes del 01/10, y
   segundo camino del 409 del prepago sin confirmar («Por qué NO se tocaron
   los flujos»; asiento de `Analisis/27`).
2. Cobro real incompleto en n8n; borrador de prompt que dice «pago
   confirmado» (asiento de Q' Taco; «Cobro REAL con el QR del comercio»).
3. Avisos al negocio fuera de 24 h se rechazan; sin idempotencia ante
   webhooks reenviados (l.23–26).
4. Compuerta de reserva por recencia con límite de 50 eventos (l.486, 1700).
5. Ingesta con SDK Admin; migrar al rol `ingesta` antes del segundo cliente
   (l.2045).
6. Purga de retención de 12 meses sin código (l.719).
7. Comprobante y pedido conversacional no se guardan (l.122).
8. Agendas por plan sin límite en el servidor; 20 agendas chocan con la
   latencia (l.1946; `Analisis/24`).
9. Cambio de modelo rompe detectores de texto en silencio (l.798, 2036).
10. «Copy to editor» sobre una ejecución vieja revierte el flujo (l.516).
11. Origen compartido entre catálogo público y consola, T-37 (l.396, 2093).
12. Cuenta de Functions con rol Editor; ruta UUID del webhook sin rotar;
    Silvana sin rol de revisora (l.119, 2045–2060).
13. Un solo propietario de n8n y de los calendarios (cuenta personal de
    Google); media ID del QR vence a 30 días; OAuth en modo prueba caduca a
    7 días (`ESTADO.md` §métricas; `Flujos/LEEME-flujos.md`).

**Inconsistencias documentales detectadas al preparar este resumen, y
corregidas el mismo 13/09** (se dejan listadas porque muestran dónde la
documentación iba detrás del código; la corrección está en la rama
`docs/inconsistencias-13sep`):

- `admin/DISENO.md` §9 y §11 y `admin/SEGURIDAD.md` decían «nada desplegado»
  → cada sección lleva ahora una nota «Estado real (2026-09-13)» con lo que hay
  en producción y lo que sigue pendiente de verificar.
- `admin/LEEME.md`, `DISENO.md` §9 y `SEGURIDAD.md` citaban 164 o 179 + 31
  pruebas → actualizados a la corrida real del 13/09: 536 en `main`.
- `ESTADO.md` «Remoto de GitHub» decía «nunca se hizo push» → marcado como
  superado (61 PR, etiquetas `v*`).
- `ESTADO.md`, asiento del 29/08: un fragmento de tabla sin encabezado → se
  le repuso el encabezado y el contexto (primera tanda de mediciones).
- «Riesgos vivos» y «Próximos pasos» de `ESTADO.md` seguían fechados al
  07/09 → reescritos al 13/09 mirando al primer cliente pagador y al 01/10.
- `Analisis/14` §9 y la versión inglesa de `18` hablaban de un tipo de cambio
  «que NovuChat publica» → corregidos al TCO del BCB.
- `Demo-Recursos/checklist-ensayo.md` citaba «QR en URL pública» y «Bloque 6»
  → media ID y Bloque 9 / 10 de la guía.
- Tres juegos de precios convivían (§5.3) → cada documento que conserva
  precios viejos (`Analisis/13`, `14`, `14-modelo-costos.py`, `17`, guion de
  presentación, notas de Silvana) lleva una nota que remite a `Analisis/21`.
- Brecha «suspender no corta»: figuraba cerrada y abierta a la vez → está
  cerrada desde el 07/09 (commit `2e251f9`, 17 pruebas); se corrigieron el
  asiento del 13/09, la tabla de brechas, `Analisis/13` y `Analisis/25` §3.5.
  Lo único abierto es el segundo camino del 409 del prepago.

---

## 8. Prohibiciones duras y decisiones irreversibles

Son las seis de `CLAUDE.md`; cualquier análisis que proponga contradecirlas
tiene que argumentar contra el registro que las originó.

1. **Nunca un canal no oficial de WhatsApp** (Evolution API, Baileys,
   WPPConnect, dispositivos vinculados). Retirado el 22/08 por rotura
   silenciosa y riesgo de baneo.
2. **Nunca un secreto en el repositorio**, incluidos JSON exportados, sticky
   notes y ejemplos.
3. **Nunca presentar un cobro como lo que no es.** Simulado: rotulado en
   imagen y caption. Real: nunca «pago acreditado»; el OCR no es una
   acreditación bancaria. Los dos modos son excluyentes por negocio.
4. **Nunca que el agente niegue ser una IA.**
5. **Nunca tocar la app `Demo SeguroLo Tengo` ni el `otp-service`**
   (sistema financiero en producción que comparte VM y WABA).
6. **Nunca publicar el número de prueba** (solo 5 destinatarios).

Y de la base comercial: no cobrar distinto por flujo; no construir un flujo
con varios disparadores; no prometer la ventana gratuita por anuncios hasta
medirla; todo límite comercial se hace cumplir en el servidor.

---

## 9. Preguntas sugeridas para el análisis externo, por perfil

Se proponen para repartir el trabajo entre revisores; cada bloque cita dónde
mirar.

**Arquitectura y técnica**
- ¿La dependencia de n8n Community (sin compartir flujos, un flujo por
  cliente, una VM compartida) escala hasta 50 clientes sin rehacer?
  (`Analisis/20`; `CONFIGURACION.md` §2 y §5.)
- ¿La compuerta de verificación de reserva y el candado de doble reserva
  (una llamada a Calendar por calendario) son sostenibles con 10 agendas?
  (`Analisis/24`; `Flujos/demo-a-agendamiento.json`.)
- ¿Es correcta la política ante silencio del panel (respaldo con datos de
  demo)? (`DISENO.md` §5; `Analisis/25` §3.4.)
- ¿La memoria en ventana (k = 8–10) alcanza para producción, o hay que ir a
  Postgres Chat Memory ya? (`Analisis/02` B-1; `ESTADO.md` l.728.)

**Seguridad**
- Revisar el modelo de amenazas T-1 a T-37 y la lista de pendientes
  (`admin/SEGURIDAD.md`), la ingesta con SDK Admin y el rol Editor de la
  cuenta de Functions (`.github/DESPLIEGUE-FIREBASE.md`).
- Aislamiento multi-tenant: `admin/firestore.rules` y `admin/pruebas/`
  (patrón de pruebas negativas).
- Repositorio público: `CONVENCIONES-REPO-PUBLICO.md`,
  `scripts/verificar-saneo.sh`, condición de la federación OIDC.

**Comercial y financiero**
- Validar los supuestos del modelo (10 mensajes por conversación; mezcla
  60/30/10; impuestos 16 %; caché al 25 %) y la sensibilidad del plan Pro
  (`Analisis/14`, `16`, `21`; `Analisis/14-modelo-costos.py`).
- Bolsa a 0,333 y su relación con el tope (`Analisis/23`).
- Q' Taco a USD 0,20 por conversación: ¿es un precio de entrada defendible?
  (`Analisis/25` §1.5.)
- Cláusulas de TCO y revisión de tarifa (`Analisis/17`, `22`).

**Operación y cliente**
- Ficha de alta de 48 h y quién hace qué (`Analisis/13`; `GUIA-META-NOVUCHAT.md`).
- Chip y portafolio a nombre del cliente; PIN; recarga; qué pasa si el
  cliente se va (`Analisis/13` §chip; `Analisis/25` §2).
- Operación diaria: quién mira ejecuciones fallidas, comprobantes y
  reclamos (`Analisis/25` §3.7; `DISENO.md` §4ter).

**Legal y regulatorio**
- Cobro real sin acreditación (prohibición 3): redacción del contrato y de
  las respuestas del asistente (`Analisis/07`; `Analisis/25` §4).
- Retención de 12 meses y datos personales (teléfonos, CI para envíos)
  (`DISENO.md` §4septies; `admin/SEGURIDAD.md` §5).
- Precios en USD cobrados en Bs en Bolivia (`Analisis/14` §5ter; `22`).
- Política de representación de Meta: número a nombre del cliente
  (`Analisis/13`).

---

## 10. Glosario mínimo

| Término | Significado en este proyecto |
|---|---|
| **Conversación** | Ventana de 24 h por teléfono. Unidad de cobro. |
| **Atención** | Persona distinta atendida en el período. Métrica, no se factura. |
| **Cierre** | Cita agendada o venta registrada. Métrica de calidad desde el 06/09. |
| **Flujo** | Un JSON de n8n: `agendamiento`, `venta`, `recordatorios`. Un negocio puede tener varios. |
| **Tenant / comercio / negocio** | Un cliente de NovuChat en la consola (`/tenants/{id}`). |
| **Config del negocio** | Nodo de n8n (y hoy documento de la consola) con todo lo configurable por negocio. |
| **Franquicia** | 1.000 mensajes de servicio gratis por número y mes que da Meta. |
| **Tope** | 25 respuestas del asistente por conversación. |
| **Bolsa** | 30 conversaciones por USD 10, sin vencimiento. |
| **TCO** | Tipo de Cambio Oficial que publica el Banco Central de Bolivia. |
| **Cobro simulado / real** | Ver §3.7. Excluyentes por negocio. |
| **Ficha** | Enlace firmado y con caducidad que identifica una conversación en el catálogo web o en la imagen del QR. |
| **WABA** | WhatsApp Business Account de Meta. |
| **Tech Provider** | Modalidad de Meta en la que NovuChat operaría las WABAs de todos los clientes desde una sola app. |

---

## 11. Índice de documentos referenciados (contenido del ZIP)

El ZIP reproduce la estructura del repositorio. Los archivos marcados con
«(no versionado)» no están en Git: son material original o de trabajo local,
verificado contra los valores reales antes de incluirse.

### Raíz

| Archivo | Qué es |
|---|---|
| `CLAUDE.md` | Documento normativo: políticas, prohibiciones, reglas de diseño, base comercial, flujo de trabajo. |
| `ESTADO.md` | Bitácora viva del proyecto (2026-08-28 → 2026-09-13). |
| `CONFIGURACION.md` | Plantilla pública de parámetros e identificadores. |
| `CONVENCIONES-REPO-PUBLICO.md` | Tabla de marcadores y verificación de saneo. |
| `GUIA-META-NOVUCHAT.md` | Guía de Meta en once bloques (fuente única; `Flujos/GUIA-META-NOVUCHAT.md` es solo un puntero). |
| `.devsecops.yml` | Manifiesto del estándar DevSecOps (modo, componentes, excepciones). |
| `.env.example` | Variables de entorno sin valores. |
| `ANEXO-historial-git.txt`, `ANEXO-pull-requests.txt` | Generados para este paquete: commits y PR. |

### `Analisis/`

| Archivo | Fecha | Qué es |
|---|---|---|
| `00-resumen-ejecutivo.md` | 2026-08-28 | Resumen de las siete inconsistencias y las decisiones fundacionales. |
| `01-analisis-documentos-preliminares.md` | 2026-08-28 | Evaluación de cada insumo de Silvana y del material de referencia. |
| `02-criterios-implementacion.md` | 2026-08-28 | Los 20 criterios A-1 a D-20 (⛔ bloqueantes). |
| `03-plan-demos.md` | 2026-08-28 | Alcance, arquitectura, aceptación, cronograma y contingencias de los demos. |
| `04-latencia-demo-a.md` | 2026-08-28 | Análisis estático de latencia y protocolo de medición. |
| `05-demo-b.md` | 2026-08-28 | Diseño cerrado del Demo B y la prohibición 3 por código. |
| `06-costo-por-atencion.xlsx` (no versionado) | 2026-09-01 | Planilla del primer modelo de costo (hojas Resumen, Supuestos, Tokens, Costo IA, Costo nube). |
| `07-cobro-real-y-ocr.md` | 2026-09-06 | Cobro real con QR del comercio y cotejo de comprobantes contra muestras reales. |
| `08-qr-simple-lo-que-cambia.md` | 2026-09-07 | Lo aprendido de `ManejoQRSimple`: estándar BCB, API bancaria, decisión de reutilizar. |
| `09-catalogo-nativo-de-whatsapp.md` | 2026-09-07 | Catálogo nativo de Meta: solo para el flujo B. |
| `10-catalogo-plataformas-externas.md` | 2026-09-07 | GloriaFood, TakeApp, etc.: carrito falsificable, no conectar. |
| `11-catalogo-web-propio.md` | 2026-09-07/08 | El catálogo web propio: diseño, correcciones, economía. |
| `13-requisitos-alta-clientes.md` | 2026-09-07 | Ficha de alta de un cliente real: chip, Meta, Calendar, brechas. |
| `14-costo-por-conversacion-y-precios.md` | 2026-09-08 | Análisis completo de costos con las tarifas de Meta del 01/10. |
| `14-modelo-costos.py` | 2026-09-08 | Modelo reproducible en Python (planes previos a `21`). |
| `15-unidad-de-cobro.md` | 2026-09-08 | Conversación de 24 h vs respuesta vs asunto: se mantiene la conversación. |
| `16-sensibilidad-topes-y-bolsas.md` | 2026-09-08 | Tope único de 25; la bolsa vieja perdía dinero. |
| `17-resumen-ejecutivo-precios.md` | 2026-09-08 | Versión para Silvana, sin tecnicismos (cifras luego superadas). |
| `18-cambios-en-sitio-y-presentacion.md` | 2026-09-08 | Superado por `22`; inventario técnico del sitio. |
| `19-catalogo-web-y-precio-por-flujo.md` | 2026-09-08 | 40 ítems al prompt; no cobrar distinto por flujo. |
| `20-un-flujo-para-todos-los-clientes.md` | 2026-09-08 | Un flujo por cliente hoy; Tech Provider como destino. |
| `21-propuesta-de-silvana-comparada.md` | 2026-09-08 | Planes USD 25/50/90 adoptados, con márgenes corregidos. |
| `22-instrucciones-sitio-web.md` | 2026-09-08 | Instrucciones definitivas para `novuchat.site`. |
| `23-bolsa-a-033.md` | 2026-09-08 | Bolsa de 30 por USD 10 y el mínimo ligado al tope. |
| `24-agendas-por-plan.md` | 2026-09-08 | 1 / 5 / hasta 10 agendas; el candado limita. |
| `25-puesta-en-produccion-qtaco.md` (no versionado aún) | 2026-09-13 | Puesta en producción del primer cliente real. |
| `26-resumen-proyecto-para-analisis-externo.md` | 2026-09-13 | Este documento. |
| `27-modelo-bloques.md`, `27-modelo-bloques.py` (rama `cobro/bloques-de-25`) | 2026-09-13 | La conversación como bloque de 25 respuestas: qué cambia, costo por bloque, riesgo sin techo por ventana, qué tocar y qué medir. |

### `admin/`

| Archivo | Qué es |
|---|---|
| `LEEME.md` | Cómo probar y trabajar la consola; prohibiciones propias del directorio. |
| `DISENO.md` | Arquitectura, modelo de datos, roles, política de capas, catálogo web, cobros, integración con n8n, pasos de nube (§11). |
| `SEGURIDAD.md` | Regla de Dos, CI/CD, CSP, modelo de amenazas T-1 a T-37, pendientes. |
| `CATALOGO-WEB.md` | Especificación del catálogo web público. |
| `firestore.rules` | Reglas de Firestore, comentadas: el corazón del aislamiento. |
| `firebase.json`, `firestore.indexes.json` | Hosting, rewrites, CSP e índices. |
| `functions/src/index.ts` | Lista de las 30 Cloud Functions. |
| `functions/src/firma.ts` | Autenticación de la ingesta (HMAC / token, alias de secretos). |
| `functions/src/cotejo.ts` | Cotejo de comprobantes contra el QR. |
| `functions/src/ingesta.ts` | Ingesta de mensajes y conteo de conversaciones por período. |
| `web/src/lib/flujos.ts` | Pestañas y capacidades por flujo. |
| `pruebas/*.test.ts` | Las suites de pruebas de la consola (reglas, catálogo web, QR, saneo, candado, estado del comercio). |

### `Flujos/`

| Archivo | Qué es |
|---|---|
| `LEEME-flujos.md` | Importación, credenciales, `Config del negocio`, verificaciones. |
| `demo-a-agendamiento.json` | Flujo A, 30 nodos. |
| `demo-b-venta-cobro.json` | Flujo B, 22 nodos. |
| `demo-a-recordatorios.json` | Recordatorios, 12 nodos. |

### `Demo-Recursos/`

| Archivo | Qué es |
|---|---|
| `LEEME-recursos.md` | Qué es cada recurso y cómo usarlo. |
| `checklist-ensayo.md` | Suite de aceptación A, B y casos hostiles. |
| `suite-a-hoja-de-marcado.md` | Suite A con mensajes por caso y el caso A9. |
| `guion-presentacion-demos.md` | Guion del presentador. |
| `catalogo-whatsapp-notas-silvana.md`, `catalogo-plataformas-externas-notas.md` | Notas de Silvana del 07/09. |
| `calendario-demo-relleno.ics`, `qr-demo.png`, `build_recursos.py` | Artefactos del demo y su generador. |
| `Simulador-NovuChat-v2.html` | Plan B offline con los guiones reales. |
| `prueba-humo-meta.sh` | Prueba de humo del número de Meta. |

### `scripts/`

Los catorce scripts de operación, cada uno con su porqué en la cabecera
(`verificar-saneo.sh`, `publicar-flujo.sh`, `preparar-import.sh`,
`ver-ejecuciones.sh`, `verificar-meta.sh`, `fijar-calendario.sh`,
`configurar-demo-b.sh`, `completar-env.sh`, `enviar-prueba.sh`,
`enviar-plantilla.sh`, `listar-plantillas.sh`, `subir-qr.sh`,
`ver-portafolios.sh`, `verificar-credencial-cierres.sh`).

### `.github/` y `.claude/`

| Archivo | Qué es |
|---|---|
| `.github/DESPLIEGUE-FIREBASE.md` | Instructivo de CI/CD y el «estado real» del 12–13/09. |
| `.github/workflows/ci-node-firebase.yml`, `release.yml` | Pipeline y publicación. |
| `.claude/agents/` (cuatro archivos `.md`) | Los agentes de trabajo del repositorio. |

### `Preliminares/` (no versionado: material original de Silvana y referencias)

| Archivo | Qué es |
|---|---|
| `guia novuchat.docx` | Guía técnica original (arquitectura orientada a eventos, memoria, function calling). |
| `Ayuda Memoria Flujo restaurantes y retail.docx` | Guiones y casos de prueba del Demo B. |
| `Ayuda Memoria_ Pruebas de Demos de Agendamiento WhatsApp Completo.docx` | Guiones y casos de prueba del Demo A. |
| `Presentación NovuChat.html` | Pitch comercial original (26/08). |
| `Simulador.html` | Simulador original de Silvana. |
| `diseno-consola.html`, `prompt-diseno-panel.md`, `prompt-landing-precisiones.md` | Diseño de la consola y precisiones para el sitio. |
| `gemini-code-*.json` / `.md` | Borradores de flujo generados con Gemini. |
| `3081-whatsapp-ai-chatbot.json`, `3088-whatsapp_medical_appointments_bot.json` | Plantillas comunitarias de n8n usadas como referencia. |
| `Recomendaciones recordatorios.txt` | Notas sobre recordatorios. |

No se incluyen: `CONFIGURACION.local.md`, `.env*`, los `*.local.json` de
`Flujos/` (exportaciones con valores reales), los respaldos de flujos, los
logos, `node_modules`, `dist`, ni el sitio web (`~/Novuchat-site`), que es
otro repositorio.
