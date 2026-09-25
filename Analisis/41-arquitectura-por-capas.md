# NovuChat por capas: core, central, plataforma, módulos y tenants

**25-sep-2026.** Replanteo de la arquitectura pedido por Andres, para revisar,
validar, planificar y aplicar con varios agentes en paralelo. Parte de la
propuesta de Andres (CORE, CAPA CENTRAL, MÓDULOS REUSABLES, TENANTS, y cada
porción de código en exactamente una de ellas o como conector o coordinador),
contrastada con el relevamiento del repositorio de esta fecha: los 8 flujos de
`Flujos/`, las 52 Functions de `admin/functions/src`, las 2.378 líneas de
`firestore.rules`, las 22 páginas de la consola, las 74 suites de pruebas y la
forma de trabajar con Claude Code (`.claude/`, `Prompts/`, `ESTADO.md`).

**Contexto que cambia el costo de todo:** ningún cliente está en producción.
Platinum y Bellido atienden en modalidad de prueba; Q'Taco, Dhermacore y
Walisuma no tienen flujo publicado. Eso permite renombrar campos y mover
colecciones con un script y sin compatibilidad hacia atrás, y es la razón para
hacer este cambio **antes** del primer cliente pagador y no después.

**Antecedentes que este documento integra, no reemplaza:** `admin/DISENO.md`
§4sexies (política de capas por vertical), `Analisis/20` (un flujo por cliente y
por qué), `Analisis/35` (capa agnóstica de mensajería y contrato del mensaje
normalizado), `Analisis/39` (BYOC), `Prompts/modularizacion-flujos.md` y
`Flujos/LEEME-flujos.md` §0 (el ensamblador y por qué no es el generador
retirado), `CLAUDE.md` §7 (todo límite se hace cumplir en el servidor).

---

## 0. Conclusión

| | |
|---|---|
| **El diagnóstico** | El sistema está ordenado por **vertical** (agendamiento, venta, onboarding): un paquete indivisible de flujo n8n + documento `config/{vertical}` + pestañas + ramas en Functions + prompt. La arquitectura pedida ordena por **quién es dueño de cada pieza y cuánto varía**. Son ejes distintos, y casi todo lo que hay que cambiar sale de esa diferencia |
| **Lo que ya cumple** | La mitad Firebase del core (claims, reglas, firma, autorización, ingesta), el modelo de datos con `config/negocio` común y `config/{flujo}` propio, cero código de cliente en Functions y consola, y el ensamblador de flujos |
| **Lo que no cumple** | El core conversacional está en n8n, bifurcado tres veces (una variante por vertical) y copiado por cliente. `ingesta.ts` importa a los módulos, al revés. La lista de flujos del tenant está reimplementada en 7 lugares. Los módulos se habilitan por vertical, no por módulo. Bellido tiene 19 nodos propios, y las pruebas de instancias son el 18 % de todas |
| **Las cinco zonas** | **Core** (lo que todo tenant corre igual), **Central** (lo que todo comercio ve igual), **Plataforma** (lo que ve NovuChat como operador), **Módulos** (lo que se enciende por tenant), **Tenants** (datos de un cliente, nunca código). Más dos piezas nombradas: el **coordinador de turno** y el **registro de módulos** |
| **La unidad de la arquitectura** | El **manifiesto de módulo** (§3): configuración, colecciones, límites, pestañas, fragmento de prompt, herramientas, ganchos y pruebas. De él se derivan las siete copias de hoy |
| **Los tres ejes de la cuenta** | **Plan** (módulos y límites contratados), **modalidad** (demostración, prueba, producción) y **titularidad del canal** (NovuChat o el comercio). Hoy `demostracion` es plan y modalidad a la vez, y BYOC es un plan cuando es titularidad más un plan (§4) |
| **Cómo se hace cumplir** | Carpeta = zona, una prueba de fronteras de importación en CI, y un gancho de Claude Code que limita a cada agente a su carpeta. La política escrita es un prompt, y el prompt no es una barrera |
| **El camino** | Una fase de cierre más seis (§7), unas 20 jornadas de trabajo que con agentes en paralelo caben en 6 a 7 días de calendario. **Primero:** F-1 (cierre de las nueve sesiones abiertas, hotfix) y E (estándar DevSecOps). **Antes del primer cliente pagador:** F1 (ejes de la cuenta y consola del propietario), F2 (carpetas, registro y frontera), F3 (core unificado), S (staging) y F6 (método). **Después, antes del quinto número:** F4 (conector de canal fuera de n8n) y F5 (tenants como datos) |
| **El proceso con los clientes** | Ocho etapas con compuerta (§12.2); todo pedido pasa por un análisis de solicitud con tres opciones «así se puede», esfuerzo real y decisión comercial antes de construirse (§12.3, §12.4); reclamos con circuito (§12.7); inventario de recursos compartidos (§12.9); ningún código a medida mientras F2 y F3 estén en obra (§12.10) |
| **Cómo se opera** | Tres sesiones (§8.5): una operadora de la rearquitectura, las de clientes, y una revisora que comprueba cada hito antes de que Andres autorice el siguiente |
| **Mensajes por conversación** | Cero agregados o quitados en todas las fases. F4 agrega un salto de red por mensaje, no un mensaje |

---

## 1. Las cinco zonas

### 1.1 Definiciones

| Zona | Definición | Quién la cambia | Ejemplos |
|---|---|---|---|
| **CORE** | Lo que **todo tenant corre igual**, sin excepción, en cualquier canal. Contratos, seguridad, conteo, canal, agente base | Solo NovuChat, y cada cambio llega a todos | Mensaje normalizado, conector de WhatsApp, firma HMAC, claims, reglas de aislamiento, ventana de 24 h y bloque de 25, umbrales, normalización de entrada, medios entrantes (audio, imagen, documento), prompt base |
| **CENTRAL** | Lo que **todo comercio ve igual** en su consola y en su cuenta, independiente de qué módulos tenga | NovuChat | Tablero, Configuración del asistente, Conversaciones, Usuarios, Contactos, Consumo, Cuenta, Pagar, Reclamos, Bitácora, Mi cuenta. Planes, modalidad, prepago, tipo de cambio, comportamiento verificado, saneo |
| **PLATAFORMA** | Lo que ve **NovuChat como operador**: la consola del propietario | NovuChat | Negocios (alta, baja, suspensión, número, plan, modalidad, titularidad), bitácora de plataforma, notificaciones, corte global del prepago, rótulos del cobro simulado, tipo de cambio manual |
| **MÓDULOS** | Lo que **se enciende por tenant**, con su manifiesto, y que cualquier tenant puede combinar | NovuChat, un módulo a la vez, con una versión | Productos, Agenda, Pedidos, Cobros, Inventario, Campañas, Catálogo web, Captación, Menú interactivo |
| **TENANTS** | **Datos** de un cliente: configuración, catálogo, variables del prompt, instrucciones extra verificadas, módulos encendidos. **Nunca código** | El comercio desde su consola; NovuChat desde Plataforma | `config/*`, `catalogo`, `funcionarios`, `Flujos/prompts/tenants/<t>.vars`, `CLIENTES/<T>/` |

Dos piezas más, con nombre propio, porque Andres las pidió como categorías
válidas:

- **El coordinador de turno.** Recibe un mensaje normalizado, le pide a Central
  el contexto de la cuenta, llama a los ganchos de los módulos encendidos, y
  devuelve el reporte de turno. Es el único código que conoce a todas las
  zonas. Hoy son `configuracionFlujo` e `ingesta` más los nodos comunes de
  n8n.
- **El registro de módulos.** Un solo archivo que lista los módulos con sus
  manifiestos. Lo leen las reglas (generadas o verificadas contra él), las
  Functions, la consola y el ensamblador de flujos.

### 1.2 Plataforma: por qué una zona propia y no parte de Central

La página Negocios, la bitácora de plataforma, las notificaciones y el corte
global son centrales en el sentido de que no dependen de ningún módulo, pero
su público es NovuChat, su proveedor de identidad es Google y no contraseña
(`firestore.rules` §roles), y su regla es «el propietario no lee conversaciones
salvo ventana de soporte». Mezclarlos con lo que ve el comercio es lo que hoy
hace que `Tenants.tsx` y `Bitacora.tsx` tengan dos caras. Separarlos evita que
una pestaña del comercio herede por accidente un permiso del operador.

### 1.3 La prueba de ubicación

Toda pieza nueva, y cada pieza del inventario del §5, responde estas preguntas
en orden. La primera que dice «sí» decide la zona:

1. ¿Lo corre **todo tenant igual**, aunque no lo vea nadie? → **Core.**
2. ¿Lo ve **todo comercio** en su consola o su cuenta, tenga los módulos que
   tenga? → **Central.**
3. ¿Lo ve **solo NovuChat** como operador? → **Plataforma.**
4. ¿Se **enciende o apaga por tenant**, o tiene un límite por plan? → **Módulo.**
5. ¿Es un **dato de un cliente**? → **Tenant.**
6. ¿No es ninguna, porque **conecta dos zonas** o **coordina** varias? →
   Coordinador o conector, y se nombra como tal.

Si una pieza responde «sí» a dos preguntas, está mal cortada y se parte. Los
tres casos de hoy: `Tablero.tsx` (central, pero cuenta agendas y catálogo),
`Configuracion.tsx` (central, pero tiene el calendario y el catálogo web) y
`Catalogo.tsx` (módulo Productos, pero tiene duración de cita, vista previa
del catálogo web y stock).

### 1.4 Dependencias permitidas

```
TENANTS  (datos)            no dependen de código
   ▲
MÓDULOS  ──► otros módulos solo si el manifiesto lo declara (grafo acíclico)
   │     ──► CENTRAL (servicios: planes, tipo de cambio, saneo, comportamiento)
   │     ──► CORE (contratos, canal, seguridad)
   ▲
CENTRAL  ──► CORE
PLATAFORMA ──► CENTRAL, CORE
   ▲
CORE     ──► nada de arriba

COORDINADOR DE TURNO ──► todo, pero solo a través del registro de módulos
```

**La regla que hoy se viola:** `ingesta.ts` (core) importa `retencion`,
`inventario`, `captacion`, `campanas` y `cobroVenta` (módulos). Se corrige con
ganchos registrados (§2.3), no con más importaciones.

---

## 2. Los contratos del core

El core se define por sus contratos, no por dónde corre. n8n es la
implementación actual del pipeline de turno; puede seguir siéndolo, y una
Function podría implementar el mismo contrato para un tenant de mucho volumen
sin que nada más cambie. Los cuatro contratos ya existen a medias.

### 2.1 Mensaje normalizado (entrada)

Es el de `Analisis/35` §4.1, y se adopta tal cual:

```
{ canal, tenantId, contactoId, nombrePerfil,
  tipo: texto | boton | lista | imagen | documento | audio | ubicacion | otro,
  texto, medios: [{ tipo, ruta temporal }], referral, idMensaje, recibidoEn }
```

Hoy lo produce `Normalizar entrada` dentro de cada flujo, en tres variantes
(184, 150 y 118 líneas). Pasa a producirlo el **conector de canal** (F4), y
hasta entonces una sola variante en `Flujos/src/core/`.

### 2.2 Contexto de turno (lo que el core pide a Central antes de responder)

Hoy es la respuesta de `configuracionFlujo`. Se conserva la llamada y se
ordena su contenido en tres bloques, que son los tres ejes del §4:

```
{ operativo: true | { motivo, mensajeCortesia },           ← modalidad
  modulos: { agenda: { limites, config }, cobros: {...} }, ← plan + config del tenant
  negocio: { identidad, horarios, voz, instruccionesVigentes, fecha y hora },
  atencion: { estado, mensajesVentana } }                    ← core, conteo
```

El flujo no sabe de planes ni de modalidades: recibe `operativo` y `modulos`.

### 2.3 Reporte de turno y ganchos (lo que el core hace después de responder)

Hoy es `ingesta`. Se conserva la llamada y se parte por dentro en el
coordinador más los ganchos. Un módulo puede registrar:

| Gancho | Cuándo corre | Quién lo usa hoy, aunque no se llame así |
|---|---|---|
| `antesDelTurno(contexto)` | Al armar el contexto | Campañas (recorta al tope), Captación (rubros y planes), Catálogo (resumen al prompt) |
| `despuesDelTurno(reporte)` | Al recibir el reporte | Seña (retención), Inventario (descuento), Cobros (cotejo), Campañas |
| `alCierre(cierre)` | Con `registrarCierre` | Agenda (cita), Pedidos (venta) |
| `alCambiarConfig(doc)` | Disparador de Firestore | Comportamiento, Campañas (verificación) |
| `programado(cron)` | Tareas | Agenda (recordatorios, seguimientos, señas vencidas), Cobros del prepago |

El coordinador recorre los módulos **encendidos para ese tenant** en el orden
del registro. El core no nombra a ningún módulo.

### 2.4 Cierre

`registrarCierre` no cambia: es la unidad que se factura y es del core.

### 2.5 Envío (salida)

Hoy el envío vive en cada flujo: nodo WhatsApp con el token del cliente, y
llamadas directas a Graph con credencial Bearer por cliente para QR,
ubicación, contacto, interactivos y plantillas. Es código core en el lugar
equivocado. El contrato de salida es el de `Analisis/35` §4.1:

```
{ tenantId, contactoId, tipo: texto | opciones | imagen | documento | ubicacion | recordatorio,
  contenido, opciones: [{ id, titulo }] }
```

y lo implementa una Function `enviar` con la credencial en Secret Manager
(F4). El flujo nunca sabe si salió como botón, lista o texto numerado.

---

## 3. El manifiesto de módulo

Es la unidad de la arquitectura. Cada módulo es una carpeta en cada runtime
(`admin/functions/src/modulos/<m>/`, `admin/web/src/modulos/<m>/`,
`Flujos/src/modulos/<m>/`, `admin/pruebas/modulos/<m>/`) y una entrada en el
registro. El registro es un archivo TypeScript puro que la consola, las
Functions, las pruebas y el ensamblador importan; las reglas de Firestore lo
verifican con una prueba, porque las reglas no importan nada.

### 3.1 Esquema

```
modulo:        agenda
version:       1                      ← se declara en docs/versiones-por-cliente.md por tenant
dependeDe:     []                     ← acíclico; el coordinador lo ordena
configuracion:
  documento:   config/agenda          ← una lista blanca de campos por módulo
  campos:      [calendarioId, duracionMin, recordatorios, senaActiva, ...]
colecciones:   [funcionarios, funcionarios/privado, agenda]
limites:
  agendas:     { plan: 'agendas', hacerCumplir: 'reglas', contador: 'contadores/agendas' }
pestanas:      [{ ruta: 'agenda', titulo: 'Agenda', roles: ['admin'] }]
tablero:       [ranura 'citasDeHoy']  ← lo que aporta al Tablero central
prompt:        Flujos/prompts/modulos/agenda.md
herramientas:  [consultar_disponibilidad, agendar_cita, buscar_mi_cita, cancelar_cita]
nodos:         Flujos/src/modulos/agenda/*.js   ← lo que queda en n8n
ganchos:       { antesDelTurno, despuesDelTurno, alCierre, programado }
mensajes:      0                      ← los que agrega por conversación; se declara siempre
pruebas:       admin/pruebas/modulos/agenda/
```

### 3.2 Los módulos, con lo que hoy son

| Módulo | Qué contiene hoy | Depende de | Límite por plan | Observación |
|---|---|---|---|---|
| **Productos** | `catalogo`, `fotosCatalogo`, `contadores/catalogo`, `limiteCatalogo.ts`, `imagenCatalogo.ts`, importación, resumen al prompt; `Catalogo.tsx` | — | productos (20 / 100 / 500) | Todo plan lo incluye; ser módulo le da manifiesto y límite, no lo vuelve opcional. La etiqueta Servicios / Productos la decide el registro, no `flujos.ts` |
| **Agenda** | `funcionarios`, `agenda` (candado), `sena.ts`, `retencion.ts`, `seguimientos.ts`, recordatorios, señas vencidas; `Funcionarios.tsx`; 13 módulos de `Flujos/src/reservas/`; herramientas de Calendar | Cobros (solo para la seña) | agendas (1 / 5 / 10), **hoy sin hacer cumplir** | Es el módulo más grande. Hoy se llama vertical `agendamiento` |
| **Pedidos** | `pedidos`, checkout del carrito (dentro de `catalogoWeb.ts`), `Pedidos.tsx`, `Memoria del carrito` | Productos | — | Hoy es parte del vertical `venta`; el checkout escribe pedidos y descuenta stock |
| **Cobros** (el comercio cobra a su cliente) | `cobro.ts`, `qrSimple.ts`, `dibujoQr.ts`, `cotejo.ts`, `cobroVenta.ts`, `mediaIdQr`, `cobroReal`; `Cobros.tsx`, `Cobro.tsx` (QR) | Pedidos o Agenda (quien cierra) | — | Declarado por dos verticales «y gana venta»; con módulo, es uno solo. Los rótulos del cobro simulado son de Plataforma |
| **Inventario** | `inventario.ts`, `movimientosStock`, `stock`; `Inventario.tsx` | Productos | — | Hoy sin chequeo de flujo en `ajustarStock` |
| **Campañas** | `campanas.ts`, `verificarCampanas.ts`, `config/campanas`; `Campanas.tsx` | — | campañas (0 / 3 / 10) | Límite 0 = módulo apagado. Las reglas hoy lo tratan como común |
| **Catálogo web** | `catalogoWeb.ts` (sitio público, fichas, `fijarWebhookCarrito`), `publico/` | Productos, Pedidos | — | Exige el segundo sitio de Hosting antes del primer comercio que lo encienda (`admin/SEGURIDAD.md`) |
| **Captación** | `captacion.ts`, `config/onboarding`, `Captacion.tsx`, corpus del sitio (807 KB dentro de un nodo Code) | — | — | Hoy es un vertical; con módulo, NovuChat es un tenant con Captación encendida |
| **Menú interactivo** | Los 19 nodos propios de Bellido: menú inicial, contacto directo, emergencia, aviso al doctor, redes | — | — | Hoy es código de un tenant; la ficha del registro general ya lo lista como reutilizable |

Lo que **no** es módulo aunque se parezca:

- **Medios entrantes** (transcribir audio, describir imagen y documento, leer
  comprobante): core, por la regla del 25/09 «capacidades generales, no por
  vertical».
- **Tipo de cambio, saneo, firma, dibujo de QR, cotejo de texto**: servicios;
  tipo de cambio y saneo en Central, firma en Core, dibujo y cotejo dentro de
  Cobros.
- **Prepago, pagos, cobrador, cobranza** (NovuChat cobra al comercio):
  Central, pestaña Pagar. **Nunca se llama «Cobros».**

### 3.3 Qué se deriva del registro (las siete copias de hoy)

| Copia de hoy | Con el registro |
|---|---|
| `firestore.rules`: `flujosTenant`, `tieneAgenda`, `tieneCobro`, `tieneOnboarding` | `tieneModulo(m)` lee `tenants/{t}.modulos`; una prueba verifica que cada documento y colección de cada manifiesto exige su módulo |
| `index.ts`: `VERTICALES` | Desaparece |
| `prompt.ts`: `VERTICALES_CONOCIDOS`, `documentoDeVertical` | El prompt se arma con `registro.modulos.filter(encendidos).map(m => m.prompt)` |
| `cobro.ts`: elige `venta` o `agendamiento` | Cobros tiene su propio `config/cobros` |
| `catalogoWeb.ts`: `tieneVenta()` | `tieneModulo('catalogo-web')` |
| `captacion.ts:371` | `tieneModulo('captacion')` |
| `web/src/lib/flujos.ts` | `registro.modulos.flatMap(m => m.pestanas)` |

---

## 4. Los tres ejes de la cuenta: plan, modalidad, titularidad

Son independientes, los tres son datos, y viven en Central (los dos primeros)
y en el conector de canal (el tercero).

| Eje | Decide | Vive en | Hoy | Cambio |
|---|---|---|---|---|
| **Plan** | Qué contrató el comercio: precio en USD, módulos encendidos y el límite de cada uno | `cuenta/estado.plan` + la copia `cuenta/estado.limites` (lo que se hace cumplir) | `planes.ts`: Impulso, Crecimiento, Pro, BYOC, demostración | El plan pasa a ser **módulos con límites**. La copia de la cuenta ya es el mecanismo de los planes a medida: falta quién escribe la copia y su precio, no el cumplimiento |
| **Modalidad** | La relación con el pago: demostración (nunca se corta, sin costo), prueba (período gratis), producción (prepago con corte) | `cuenta/estado.modalidad`, `estadoDeServicio` en `prepago.ts` | `MODALIDADES = demostracion, prueba, prepago`; pero `plan: 'demostracion'` manda sobre la modalidad | **Demostración deja de ser plan.** Los demos son tenants con modalidad demostración y cualquier plan. `prepago` se renombra `produccion` en la consola (el código puede conservar el nombre) |
| **Titularidad del canal** | De quién es la WABA, quién paga Meta, de quién es la franquicia de 1.000 mensajes por número | `rutasWhatsApp/{n}.titularidad: 'novuchat' \| 'comercio'` | Atributo `pagaMeta` del plan `byoc` | **BYOC deja de ser un plan**: es titularidad `comercio` más un plan (2.000 conversaciones por USD 50, `Analisis/39`). Es **por número**, porque un comercio puede tener uno propio y otro provisto, y la franquicia es por número |

Tres consecuencias:

1. **El modelo de IA es una decisión de NovuChat por tenant, del core.**
   `Analisis/39` muestra que con Haiku el equilibrio BYOC cae a 1.542
   conversaciones y con Sonnet a 771: cambiar el modelo sin recalcular el plan
   pone al comercio a perder plata. Va en `tenants/{t}.modelo`, lo escribe
   solo Plataforma, y el plan a medida lo cita.
2. **El flujo no sabe de ejes.** Recibe `operativo` y `modulos` en el contexto
   de turno. La titularidad la consume solo el conector de canal, para elegir
   credencial y contar franquicia.
3. **Consola:** Cuenta y Pagar muestran los tres ejes por separado con la
   doble moneda que ya existe; Negocios (Plataforma) es el único lugar donde se
   asignan; el sitio publica tres planes y titularidad NovuChat; BYOC y a
   medida son de mostrador y no tocan código.
4. **Hay límites que no son de ningún módulo y son de Central.** El análisis
   de planes a medida (PR #184, `Analisis/40`) encontró uno ya vendido: los
   **cambios de configuración incluidos al mes** que NovuChat hace por el
   comercio, y que hoy nadie cuenta. Es una clave de límite de Central
   (`cambiosIncluidos`) con su contador, igual que `conversaciones` es del core.
   El plan lo trae como cualquier otra clave; el registro de módulos no lo
   conoce porque no es de un módulo.

---

## 5. Inventario: cada pieza, su zona hoy y su destino

Un archivo por fila; la columna «Va a» es la carpeta destino de la fase 2.
«Se parte» significa que el archivo tiene piezas de dos zonas.

### 5.1 Functions (`admin/functions/src`)

| Archivo | Líneas | Zona | Va a | Nota |
|---|---|---|---|---|
| `firma.ts` | 232 | Core | `core/seguridad/` | |
| `claims.ts` | 168 | Core | `core/seguridad/` | Único emisor de claims |
| `autorizacion.ts` | 111 | Core | `core/seguridad/` | |
| `atencion.ts` | 232 | Core | `core/conteo/` | Ventana, bloque, umbrales |
| `cierres.ts` | 172 | Core | `core/turno/` | Contrato de cierre |
| `ingesta.ts` | 2.130 | Coordinador | `core/turno/` **se parte** | Coordinador + ganchos de seña, inventario, captación, campañas, cobro de venta, que vuelven a sus módulos |
| `prompt.ts` | 533 | Core | `core/prompt/` **se parte** | Base del prompt es core; el resumen del catálogo va a Productos; `documentoDeVertical` desaparece |
| `saneo.ts` | 155 | Central | `central/servicios/` | |
| `region.ts`, `opcionesGlobales.ts` | 51 | Core | `core/` | |
| `planes.ts` | 379 | Central | `central/cuenta/` | Los límites pasan a claves declaradas por cada módulo |
| `prepago.ts` | 1.028 | Central | `central/cuenta/` | |
| `pagos.ts`, `pagosConCobrador.ts`, `cobroPrepago.ts`, `cobrador.ts`, `cobranza.ts` | 2.803 | Central | `central/pagar/` | NovuChat cobra al comercio. Nunca «cobros» |
| `tipoCambio.ts`, `tipoCambioBcb.ts` | 258 | Central | `central/servicios/` | |
| `comportamiento.ts`, `verificarComportamiento.ts` | 631 | Central | `central/asistente/` | Pseudo-prompt verificado |
| `mapa.ts` | 114 | Central | `central/negocio/` | |
| `reclamos.ts` | 174 | Central | `central/reclamos/` | |
| `index.ts` | 913 | Plataforma + Central | `plataforma/tenants.ts`, `central/usuarios.ts` **se parte** | Alta, baja, suspensión, número, plan, corte, soporte → Plataforma. Invitar y quitar usuario → Central. Seis callables sin llamador (`liberarNumero`, `quitarUsuario`, `otorgarAccesoSoporte`, `revocarAccesoSoporte`, `configuracionParaFlujo`, `moverReclamo`): se conservan si un script o la consola los va a usar, si no se retiran |
| `limiteCatalogo.ts`, `imagenCatalogo.ts` | 786 | Módulo | `modulos/productos/` | |
| `catalogoWeb.ts` | 1.107 | Módulo | `modulos/catalogo-web/` **se parte** | El checkout que escribe `pedidos` va a `modulos/pedidos/` |
| `inventario.ts` | 225 | Módulo | `modulos/inventario/` | Agregar `tieneModulo` |
| `cobro.ts`, `qrSimple.ts`, `dibujoQr.ts`, `cotejo.ts`, `cobroVenta.ts` | 1.455 | Módulo | `modulos/cobros/` | |
| `sena.ts`, `retencion.ts`, `seguimientos.ts` | 968 | Módulo | `modulos/agenda/` | |
| `campanas.ts`, `verificarCampanas.ts` | 480 | Módulo | `modulos/campanas/` | |
| `captacion.ts` | 380 | Módulo | `modulos/captacion/` | |
| *(nuevo)* `registro.ts` | — | Registro | `registro.ts` | Importa los manifiestos |

### 5.2 Datos y reglas (`firestore.rules`, `storage.rules`)

| Colección o documento | Zona | Cambio |
|---|---|---|
| `/tenants/{t}` (ficha: `estado`, `flujos`, `plan`, `waPhoneNumberId`) | Plataforma escribe, Core lee | `flujos` → `modulos` (lista de módulos encendidos); `vertical` se retira; se agrega `modelo` |
| `config/negocio` | Tenant, documento de Central | Sale `calendarioId` hacia `config/agenda` (migración por script, seis tenants) |
| `config/agendamiento`, `config/venta` | Tenant, documentos de módulo | `config/agenda`, `config/pedidos`, `config/cobros` con lista blanca por manifiesto |
| `config/marca`, `config/onboarding`, `config/campanas` | Tenant, documentos de módulo | `marca` pasa a Catálogo web; los otros quedan |
| `catalogo`, `fotosCatalogo`, `contadores/catalogo`, `comprobacionesImagen` | Productos | Escrituras exigen `tieneModulo('productos')` |
| `funcionarios`, `funcionarios/privado`, `agenda` | Agenda | Se agrega `contadores/agendas` y el límite por plan en la regla (hoy no existe) |
| `pedidos` | Pedidos | |
| `movimientosStock` | Inventario | Exigir módulo |
| `cierres`, `conversaciones`, `mensajes`, `metricas` | Core (escribe la ingesta) | `contactoId` con prefijo de canal (`Analisis/35`), sin cambiar el conteo |
| `contactos`, `reclamos`, `bitacora`, `auditoria`, `miembros`, `invitaciones`, `usuarios` | Central | |
| `cuenta/estado`, `pagos` | Central | Los tres ejes del §4; `plan: 'demostracion'` se migra a `modalidad: 'demostracion'` |
| `accesosSoporte` | Plataforma | |
| `/rutasWhatsApp/{n}` | Core, conector de canal | Se agrega `titularidad`; en F4 pasa a `/rutas/{canal}/{id}` |
| `/plataforma/*`, `/cobrosPendientes`, `/cobrosResueltos` | Plataforma y Central | |
| `/fichasCatalogo` | Catálogo web | |
| Storage `captacion/`, `pagos/` | Captación, Central | |

### 5.3 Consola (`admin/web/src`)

| Página | Zona | Va a | Cambio |
|---|---|---|---|
| `Ingresar`, `MiCuenta`, `Usuarios`, `Contactos`, `Conversaciones`, `Consumo`, `EstadoCuenta`, `Pagar`, `Reclamos`, `Bitacora` (del negocio) | Central | `central/paginas/` | `EstadoCuenta` y `Pagar` muestran plan, modalidad y titularidad por separado |
| `Tablero` | Central | `central/paginas/` | Deja de contar agendas y catálogo: cada módulo aporta su **ranura** (`tablero` del manifiesto). Ahí entran las notificaciones al comercio que pide Andres |
| `Configuracion` | Central | `central/paginas/` | Sale el calendario (a Agenda) y el catálogo web y el logo (a Catálogo web). Se queda identidad, horarios, voz, comportamiento, ubicación |
| `Tenants`, `Bitacora` (de plataforma) | Plataforma | `plataforma/paginas/` | Negocios asigna los tres ejes y el modelo |
| `Catalogo` (1.854 líneas) | Productos | `modulos/productos/` **se parte** | La duración de cita es una ranura de Agenda; la vista previa, de Catálogo web; el stock, de Inventario |
| `Funcionarios` | Agenda | `modulos/agenda/` | |
| `Pedidos` | Pedidos | `modulos/pedidos/` | |
| `Cobros`, `Cobro` (QR) | Cobros | `modulos/cobros/` | |
| `Inventario` | Inventario | `modulos/inventario/` | |
| `Campanas` | Campañas | `modulos/campanas/` | |
| `Captacion` | Captación | `modulos/captacion/` | |
| `ConfiguracionVertical` | Conector | `central/componentes/ConfiguracionModulo` | Ya trabaja con una tabla de campos: pasa a leerla del manifiesto |
| `lib/flujos.ts` | Registro | Desaparece; lo reemplaza `registro.ts` compartido con Functions | |
| `lib/planes.ts`, `prepago.ts`, `atencion.ts`, `pagar.ts`, `cuenta.ts`, `contexto.tsx`, `sesion.ts`, `bitacora.ts` | Central y Core | `central/lib/`, `core/lib/` | Son reexportaciones de Functions; siguen |
| `lib/campanas.ts`, `archivoPlanes.ts`, `xlsx.ts`, `csv.ts`, `foto.ts` | Módulos | Con su módulo | |
| `publico/` | Catálogo web | `modulos/catalogo-web/publico/` | Sigue sin cargar Firebase |

### 5.4 Flujos (`Flujos/`)

| Pieza | Zona | Va a | Cambio |
|---|---|---|---|
| `Flujos/src/comun/` (5 módulos, variante de reservas) | Core | `Flujos/src/core/` | **Una sola variante** para reservas, venta y captación (F3). Hoy hay tres |
| `Flujos/src/reservas/` (13) | Agenda y Cobros | `Flujos/src/modulos/agenda/`, `modulos/cobros/` | `preparar-sena`, `respuesta-de-la-sena`, `mensaje-de-la-sena`, `interpretar-lectura` → Cobros con dependencia de Agenda |
| Nodos Code de Demo B sin extraer (15) | Core, Pedidos, Cobros, Catálogo web | `Flujos/src/…` | F2 los extrae con `ensamblar-flujo.mjs extraer` |
| Nodos Code del onboarding (12) | Core y Captación | `Flujos/src/…` | El corpus de 807 KB sale del nodo a un recurso que sirve la Function (bloque B-3 ya previsto) |
| Nodos de medios (transcribir, describir, leer comprobante) | Core | `Flujos/src/core/medios/` | Con el esqueleto único |
| Los 19 nodos de Bellido | Módulo Menú interactivo | `Flujos/src/modulos/menu-interactivo/` | Dejan de ser de un tenant (F5) |
| `Flujos/prompts/reservas/demo-a.md`, `platinum.md` (201 y 202 líneas, 23 distintas) | Core + Agenda + Tenant | `prompts/core/base.md` + `prompts/modulos/agenda.md` + `prompts/tenants/<t>.vars` | El prompt se arma por capas; el tenant solo aporta variables (nombres, ejemplos del rubro, duración) |
| `Flujos/manifiestos/*.json` | Registro de construcción | Se generan del registro de módulos más los módulos encendidos del tenant | |
| `Flujos/<tenant>.json` | **Salida de construcción** | Siguen versionados porque `publicar-flujo.sh` los necesita, con cabecera «generado, no editar» y gancho de pre-commit que exige `verificar` | Hoy Bellido es fuente; deja de serlo |
| `agendamiento-seguimientos`, `agendamiento-senas-vencidas`, `demo-a-recordatorios` | Agenda (programados) | Quedan como flujos programados del módulo | |
| `novuchat-onboarding.json` | Tenant NovuChat con Captación | Salida de construcción | |

### 5.5 Scripts, pruebas y documentos

| Pieza | Zona | Cambio |
|---|---|---|
| `admin/scripts/alta-comercio`, `asignar-numero`, `asignar-plan`, `asignar-rol`, `fijar-umbrales`, `superadmin`, `cargar-plataforma`, `fijar-tipo-cambio`, `migrar-*` | Plataforma | Carpeta `admin/scripts/plataforma/`; `asignar-plan` escribe los tres ejes; nuevo `asignar-modulos` |
| `cargar-negocio`, `cargar-captacion`, `cargar-fotos-catalogo`, `citas-a-calendario`, `catalogo-demo` | Tenant (cargan datos) | Con `admin/scripts/datos/` bajo `tenants/` |
| `ensamblar-flujo.mjs`, `sincronizar-flujo-cliente.mjs`, `portar-prompt-cliente.py` | Construcción de flujos | El ensamblador gana el tercer tipo de inyección (parámetros de texto: `agendar_cita.end`, `toolDescription`, `textBody`, prompts de Gemini); el sincronizador maneja solo topología; el portador de prompts se retira con los prompts por capas |
| `scripts/publicar-flujo.sh`, `preparar-import.sh`, `estado-de-versiones.sh`, `verificar-saneo.sh` | Operación | No se tocan (buscan nodos por nombre). `estado-de-versiones` pasa a informar versión de módulo por tenant |
| `admin/pruebas/*.test.ts` (74, 33.151 líneas) | Por zona | `pruebas/core/`, `central/`, `plataforma/`, `modulos/<m>/`, `tenants/<t>/`. `platinum-flujo` (4.557) y `bellido-flujo` (1.493) se reparten entre módulos y quedan pruebas de instancia cortas: «este tenant tiene estos módulos con esta configuración». Las suites dejan de ejecutar código del JSON con `new Function` y importan `Flujos/src/` |
| *(nueva)* `pruebas/core/fronteras.test.ts` | Core | Lee los `import` de cada archivo y falla si una zona importa hacia arriba o un módulo importa a otro sin `dependeDe` |
| *(nueva)* `pruebas/core/registro.test.ts` | Core | Cada documento, colección, pestaña y límite del registro tiene su regla en `firestore.rules` y su prueba negativa «sin módulo no puede» |
| `admin/DISENO.md` (3.443 líneas, §4bis a §4sexdecies) | Documentación | `docs/arquitectura/`: un archivo por zona y uno por módulo con su manifiesto en prosa; un índice que mapea cada §viejo a su archivo, porque los agentes citan secciones por número |
| `ESTADO.md` (4.609 líneas) | Documentación | `bitacora/<aaaa-mm>.md` solo para agregar, y un `ESTADO.md` de una pantalla que se reescribe; lo generable (etiqueta viva, Functions desplegadas, flujos publicados, versión de módulo por tenant) lo imprime un script |
| `CLAUDE.md` | Invariantes | Se queda con prohibiciones, regla de zonas, flujo de trabajo. Las cifras y la tabla de estado del §7 van a `docs/arquitectura/` y a la base comercial |

---

## 6. Decisiones que este documento fija, y las que quedan para Andres

### 6.1 Fijadas (de acuerdo con Andres el 25/09)

1. **Cinco zonas más coordinador y registro** (§1). Carpeta = zona.
2. **El core es un contrato, n8n es su implementación actual** (§2).
3. **Flujo delgado, gradual:** lo determinista de un módulo vive en el
   servidor bajo los ganchos; en n8n queda lo que necesita credenciales de n8n
   (disparador, agente, memoria, Calendar, envío hasta F4). No se agregan
   llamadas: las dos por turno ya existen.
4. **El conector de canal sale de n8n** (entrada y salida), con webhook
   genérico firmado hacia n8n, **antes de Tech Provider**. Da un flujo por
   esqueleto en vez de por cliente sin esperar a Meta, y es la puerta de
   Messenger y Telegram.
5. **Un tenant nunca posee código.** Lo que un cliente necesita y no existe
   nace como módulo con bandera. El JSON de un tenant es salida de
   construcción.
6. **Vocabulario:** *módulo* reemplaza a *vertical*; *Cobros* es el comercio
   cobrando a su cliente y *Pagar* es NovuChat cobrando al comercio;
   *producción* reemplaza a *prepago* en la consola; *titularidad* nombra
   quién es dueño del canal.
7. **Los tres ejes de la cuenta son independientes** (§4): demostración deja
   de ser plan; BYOC deja de ser plan.
8. **Tipo de cambio y saneo son servicios de Central**, no módulos.
9. **Medios entrantes son core.**
10. **Cero mensajes agregados o quitados** en todas las fases.

### 6.2 Decididas el 25/09 sobre la recomendación, y vigentes salvo que Andres diga otra cosa

| Decisión | Opciones | Adoptada |
|---|---|---|
| **F4 antes o después del primer cliente pagador** | Antes: nadie migra en vivo, pero corre la fecha. Después: exige una ventana de mantenimiento por número | **Después del primero y antes del quinto número.** F1 a F3 ya dejan el core limpio; F4 es el paso de escala y de canales, y una ventana por número con cuatro clientes es una tarde |
| **`tenants/{t}.modulos` reemplaza a `flujos` o conviven** | Reemplazar (una migración de seis tenants) o mantener `flujos` como respaldo | **Reemplazar.** Nadie está en producción; mantener dos listas es la séptima copia otra vez |
| **Campañas: módulo apagado con límite 0, o común** | Como está (común, límite 0) o módulo | **Módulo.** El plan de entrada no lo trae; eso es «se enciende por tenant» |
| **Ramas abiertas al empezar la F2** | Fusionar, cerrar o dejar | **Se cierran todas en la fase F-1** (§7.1). Mover archivos con ramas abiertas es un conflicto por cada una |
| **El estándar DevSecOps, antes o después** | Actualizar las copias antes, después o en medio | **Antes, primera en la cola de fusión**, en una sesión sola y sin agentes, como manda su prompt. Es una jornada y no toca lo que la rearquitectura mueve. El **staging** se crea en paralelo con F1 y F2 y tiene que existir antes del ensayo de F3. La transición a **modo B** se decide en el pase del primer cliente, nunca en medio de F2 |
| **Cómo se opera** | Una sesión que hace todo, o dos | **Dos sesiones** (§8.5): una **operadora**, con sus worktrees y sus agentes, que construye y fusiona; y una **revisora**, la que escribió este documento, que no escribe código y revisa cada hito antes de que Andres autorice el siguiente |

---

## 7. El camino, por fases

Cada fase declara qué toca, qué prueba la cubre, si despliega, cuántos
mensajes agrega (siempre cero) y cuántas jornadas. Una jornada es de una
persona con Claude Code; con agentes en paralelo el calendario se comprime
(§8).

| Fase | Qué | Prueba | Despliega | Jornadas | Cuándo |
|---|---|---|---|---|---|
| **F-1 Cierre de las sesiones abiertas** (§7.1) | Hotfix del `deleteMode` inválido en los tres flujos de reservas y del hueco del candado cuando `agendar_cita` falla; fusión de las cinco ramas de solo documentación (#182 más el commit local del prompt de capacidades, tablero del prepago, cierre del Demo B, topes de campañas, #184); traer `main` a la rama del origen del anuncio y fusionarla; subir, PR y fusionar el traspaso del chat interno; cerrar sin fusionar la rama del ayudante de configuración guardando su diseño como análisis; borrar los worktrees colgados; matriz de capacidades de los 5 flujos (bloque 0 del prompt de capacidades comunes) como anexo; `pedidos.md` de Bellido y Platinum con lo ya sabido (§12.8); lista de cláusulas sobre las propuestas de Q'Taco y Dhermacore (§12.3); limpieza del calendario de Bellido; arranque en Meta de Platinum y del traspaso | Suites de los 3 flujos de reservas y `candado-agenda`; ensayo en el Demo A; publicación en ventana; `estado-de-versiones.sh` 8/8 | Publicación de 3 flujos | 1,5 | **Primero.** Cuatro de las ramas agregan al principio de `ESTADO.md` y se fusionan en orden conservando todo |
| **E Actualización al estándar DevSecOps** (§6.2) | Reusable de seguridad 2.4, cabeceras del 22/09, fusión de tres vías de `gitleaks.toml`, `security-local.sh`, `deploy.sh` y `.pre-commit-config.yaml` conservando lo propio; según `~/SeguridadGeneral/Prompts/actualizar-repo-al-estandar.md` | Suites de los workflows del estándar contra el reusable copiado; actionlint; validador del manifiesto; `security-local.sh` | Con el siguiente pase | 1 | **Segundo en la cola de fusión**, en una sesión sola y sin agentes. No toca lo que F2 mueve |
| **F0 Papel** | Este documento validado; decisiones del §6.2 tomadas | Lectura de Andres | No | 0,5 | Hecho el 25/09 |
| **F1 Ejes de la cuenta, vocabulario y consola del propietario** | `modalidad` independiente del plan; `titularidad` por número; `modelo` por tenant; clave de límite `cambiosIncluidos` con contador; renombres en consola (Producción, Cobros, Pagar); `asignar-plan` escribe los tres ejes; migración de `plan: 'demostracion'` y `pagaMeta` por script; **absorbe A-3b del prepago**: la página Negocios de Plataforma carga un pago a mano con comprobante, suspende y reactiva, cambia plan, modalidad, titularidad y umbrales, y enciende el corte; **absorbe las decisiones del §8 de `Analisis/40`** (planes a medida: la copia de la cuenta con contrato por comercio) | `prepago.test.ts`, `planes.test.ts`, `estado-cuenta`, `consola-pagar`, `encabezado-comercio`, `pagos`, más las negativas nuevas: un admin no escribe los ejes, un propietario sí; el contador de cambios se hace cumplir en el servidor | **Sí** (Functions, reglas, consola) | 2,5 | Antes del primer cliente pagador. Platinum la espera para su pase |
| **S Staging** | Proyecto Firebase de staging con sus variables `VITE_*` por Environment, secreto de ingesta propio, `desplegar-staging` y `dast-y-humo` dejan de omitirse; `Analisis/28` para el humo | Job `desplegar-staging` en verde; ZAP baseline sin FAIL | Sí, en staging | 1 | En paralelo con F1 y F2, a cargo del agente `deploy`. **Tiene que existir antes del ensayo de F3** |
| **F2 Carpetas, registro y frontera** | Mover archivos a `core/`, `central/`, `plataforma/`, `modulos/<m>/` en Functions, consola, `Flujos/src` y pruebas, sin cambiar lógica; `registro.ts` con los manifiestos; `fronteras.test.ts` y `registro.test.ts`; extraer los Code de Demo B y onboarding; `tenants.modulos` reemplaza a `flujos`; `tieneModulo` en reglas; límite de agendas por plan; chequeos que faltan en inventario y catálogo | Identidad byte a byte de los 8 JSON (`ensamblar-flujo.mjs verificar`), las 74 suites sin tocar su contenido, `fronteras` y `registro` en verde | Con el siguiente pase | 2,5 | Antes del primer cliente pagador |
| **F3 Core unificado** | Ganchos registrados en lugar de importaciones en `ingesta.ts`; una sola variante de `Normalizar entrada`, `Config del negocio`, `Procesar respuesta`, `Uso extendido`, `Comercio no operativo` para los tres esqueletos; prompt por capas (base + módulos + variables); las suites importan `Flujos/src/` en vez de `new Function`; el corpus de captación sale del nodo | Suites de flujos de A, B, onboarding, Platinum y Bellido; `candado-agenda`; ensayo con teléfono real en el número del Demo A y en el Demo B; el caso «verbo no previsto y la herramienta sí corrió» | **Sí**, y publicación de los 8 flujos desde `main` | 4 | Antes del primer cliente pagador |
| **F4 Conector de canal** | Function receptora del webhook de Meta (firma con el App Secret por `phone_number_id`, deduplicación, descarga de medios, normalización) que llama a n8n por webhook genérico firmado; Function `enviar` con Secret Manager y traducción de opciones; `/rutas/{canal}/{id}`; `contactoId` con prefijo; el flujo cambia el disparador y quita los nodos de envío y descarga | Suites del conector (firma, deduplicación, degradación de opciones); ensayo real; latencia p50 medida antes y después (hoy 3,8 s) | **Sí**, con ventana de mantenimiento de 2 a 3 por número | 5 | Después del primer cliente, antes del quinto número |
| **F5 Tenants como datos** | Los 19 nodos de Bellido pasan a `modulos/menu-interactivo/`; `platinum-flujo` y `bellido-flujo` se reparten en módulos y quedan pruebas de instancia; `docs/versiones-por-cliente.md` informa versión de módulo por tenant | Las mismas suites, repartidas, sin perder un caso | Publicación de Bellido y Platinum | 2 | Junto con F4 |
| **F6 Método** | `docs/arquitectura/` por zona y módulo con índice de secciones viejas; `bitacora/` por mes y `ESTADO.md` corto; script de estado generado; `CLAUDE.md` solo invariantes; gancho de Claude Code para Edit y Write por carpeta; agentes por zona; separar pruebas puras de las del emulador | Revisión de Andres; el gancho probado con un intento fuera de carpeta | No | 1,5 | En paralelo con F1 a F3 |

**Total: unas 20 jornadas.** Antes del primer cliente pagador: F-1, E, F1 a
F3, S y F6, unas 14 jornadas de trabajo, que en paralelo son 6 a 7 días de
calendario.

### 7.1 Las nueve sesiones del 25/09, absorbidas

Al cerrar la sesión del 25/09 había nueve sesiones con trabajo en curso. Se
verificaron contra git el mismo día. Ninguna se relanza: su estado queda aquí y
en las fases.

| Sesión | Lo que quedó (verificado) | Dónde va |
|---|---|---|
| Capacidades comunes | Prompt en un commit local sin subir; PR #182 abierto. Es el error de arquitectura que motivó este documento: audio, imagen y documento escritos como si fueran de reservas | Bloque 0 (matriz) → F-1; bloque 1 (lo que todo flujo tiene, con suite que falla) → `registro.test.ts` en F2; bloques 2 y 3 → F3 |
| Bellido y campañas | #175 y #176 desplegados con v0.8.0; rama de topes solo documentación; calendario con eventos fantasma; barrera de horas rechazadas y hueco del candado sin construir | Hueco del candado → hotfix en F-1; barrera → `modulos/agenda` en F3; calendario → F-1; topes → fusión en F-1 |
| Traspaso del chat interno | Rama local, 5 commits sin subir, 0 atrás, toca el JSON de captación | PR y fusión en F-1, antes de que F2 extraiga ese JSON. Meta en paralelo. Primer tenant con titularidad `comercio` |
| Ayudante de configuración | Solo diseño, 589 commits atrás, choca con §4quater.5 | Se cierra sin fusionar; el diseño se guarda como análisis; se rehace después de F6 sobre `central/asistente` |
| Platinum a WABA propia | Todo en `main`; el número sigue en el portafolio de NovuChat; §11 con decisiones abiertas | Es el primer cliente pagador. Meta ya; ejes en F1; una sola republicación después de F3; aceptación de una hora antes del pase |
| Prepago A-3b | Nada construido; rama del tablero solo documentación | Absorbido en F1 |
| Planes a medida | PR #184 solo documentación, 0 atrás; usa el número `Analisis/40` | Se fusiona como está; sus §6 y §8 los resuelve el §4 de este documento; el límite «cambios incluidos» entra en F1 |
| Origen del anuncio | 3 commits verificados, 40 atrás, conflicto conocido en `normalizar-entrada.js` | Traer `main` y fusionar en F-1, antes de F2 |
| Demo B | Todo fusionado; rama de cierre solo documentación; `deleteMode` inválido borra la memoria entera en tres flujos; comprobante en simulado exige pendiente | `deleteMode` → hotfix en F-1; comprobante en simulado → con el hotfix; embudo único de salida y `agotado` → F3 |

**Lo que permite que nadie esté en producción, y que hay que aprovechar
ahora:** migrar `cuenta/estado`, `rutasWhatsApp` y `config/*` con un script
sobre seis tenants y sin compatibilidad; renombrar sin alias; republicar los
ocho flujos en una sola tarde. Con el primer cliente pagador cada uno de esos
pasos pasa a exigir ventana de mantenimiento, aviso y vuelta atrás probada.

---

## 8. Ejecución con agentes

### 8.1 Zonas de escritura

Cada agente escribe **solo en su carpeta** y en su línea del registro. Los
documentos compartidos (`ESTADO.md` o la bitácora, `docs/arquitectura/indice`,
`CLAUDE.md`) se tocan solo agregando, una entrada por agente, y los concilia
la coordinadora. Cada agente trabaja en su worktree dentro de
`.claude/worktrees/`, nacido de `origin/main` (los worktrees de agentes no
parten de la rama de la sesión), una rama por bloque y un PR por bloque.

| Agente | Zona de escritura | Fase | Entrega |
|---|---|---|---|
| **Coordinadora** (la sesión de Andres) | `registro.ts`, `docs/arquitectura/`, tablero de coordinación, cola de fusión | Todas | Orden de fusión, conflictos en documentos compartidos, ESTADO |
| **central** | `functions/src/central/`, `web/src/central/`, `pruebas/central/`, reglas de `cuenta` y `pagos` | F1, F2 | Los tres ejes; renombres; `asignar-plan` |
| **core-functions** | `functions/src/core/`, `pruebas/core/` | F2, F3 | Coordinador de turno con ganchos; `fronteras.test.ts`; `registro.test.ts` |
| **core-flujos** (`flujos-n8n`) | `Flujos/src/core/`, `Flujos/prompts/core/`, `ensamblar-flujo.mjs` | F2, F3 | Una variante de los nodos comunes; tercer tipo de inyección; prompt por capas; extracción de B y onboarding |
| **modulo:productos**, **modulo:agenda**, **modulo:cobros**, **modulo:pedidos-inventario**, **modulo:campanas**, **modulo:captacion**, **modulo:catalogo-web** | `functions/src/modulos/<m>/`, `web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`, `pruebas/modulos/<m>/`, y las reglas de sus colecciones | F2 (mover), F3 (ganchos) | Manifiesto; movimiento sin cambio de lógica; `tieneModulo` y límite en su regla; su gancho registrado |
| **consola** | `web/src/central/paginas/Tablero`, `Configuracion`, `ConfiguracionModulo`, `plataforma/` | F2 | Ranuras del Tablero; Configuración sin piezas de módulo; Negocios con los tres ejes |
| **conector-canal** | `functions/src/core/canal/`, `Flujos/src/core/` (disparador y envío) | F4 | Receptor y `enviar`; rutas por canal |
| **tenants** | `Flujos/src/modulos/menu-interactivo/`, `Flujos/prompts/tenants/`, `pruebas/tenants/` | F5 | Bellido como módulo; pruebas de instancia |
| **metodo** | `docs/`, `bitacora/`, `.claude/hooks/`, `.claude/agents/`, `CLAUDE.md` | F6 | Documentación por zona; gancho por carpeta; agentes por zona; estado generado |
| **seguridad** (existente) | Solo lectura | Cada PR | Revisión antes de cada OK de fusión: ningún valor real en módulos, reglas con prueba negativa, secretos solo en Secret Manager |

### 8.2 Regla de integración dura

**Nada se fusiona si falla una sola de estas cinco:**

1. `fronteras.test.ts` y `registro.test.ts` en verde.
2. Para todo PR que toque `Flujos/`: `ensamblar-flujo.mjs verificar` reproduce
   los 8 JSON byte a byte (F2), o las suites de los 5 flujos conversacionales
   en verde sin quitar un caso (F3 en adelante).
3. Las 74 suites en verde. En F2, sin tocar su contenido, solo su ruta.
4. El PR declara **cero mensajes** agregados o quitados y qué prueba lo cubre.
5. Revisión de `seguridad`.

Y dos más a partir de F3: ensayo con teléfono real en el número del Demo A
(`ensayo.mjs` + `ensayo-flujo.sh`) antes de publicar en un cliente, y
`estado-de-versiones.sh` en verde al cerrar cada jornada que publique.

### 8.3 Orden de fusión

```
F1 central ─┐
            ├─► F2 core-functions (registro, fronteras) ─► F2 módulos (en paralelo, uno por PR)
F6 metodo ──┘                                            ─► F2 consola
                                                         ─► F2 core-flujos (extracción)
                                    └─► etiqueta + despliegue + publicación de los 8 flujos
                                                         ─► F3 core-functions (ganchos) ∥ F3 core-flujos (variante única)
                                                         ─► F3 módulos (ganchos)
                                    └─► etiqueta + despliegue + publicación + ensayo real
                                                         ─► primer cliente pagador
                                                         ─► F4 conector-canal ∥ F5 tenants
```

Los módulos de F2 son independientes entre sí y pueden fusionarse en
cualquier orden después de `registro.ts`. Los de F3 dependen del coordinador
con ganchos.

### 8.4 Compuertas humanas

Las de siempre: cada PR, fusión, etiqueta, despliegue, `--aplicar` y
publicación con el «sí» de Andres por acción; la etiqueta la crea Andres con
`scripts/etiquetar-version.sh`; Environment `production` lo aprueba Andres.
Fusionar no despliega.

### 8.5 Tres sesiones y un protocolo de hitos

Decisión de Andres del 25/09: la sesión que escribió este documento **no
opera**; revisa. Y la operación de clientes no se mezcla con la obra.

| Sesión | Qué hace | Qué no hace |
|---|---|---|
| **Operadora de la rearquitectura** | Corre F-1 a F6 con sus worktrees y sus agentes; fusiona con el OK de Andres; escribe el informe de cada hito | No atiende pedidos de clientes; no publica en un cliente fuera de la ventana; no reescribe este documento (anota en el informe lo que encontró mal) |
| **Sesiones de clientes** (una por cliente o por alta, con los agentes de alta que ya existen) | Configuración, comercial, Meta, aceptación, pedidos y reclamos según §12; bajo el congelamiento del §12.10 mientras F2 y F3 estén en obra | No tocan `Flujos/src/`, Functions ni consola: todo pedido que exija código se anota en `pedidos.md` y espera |
| **Revisora** (esta) | Revisa cada hito de las otras dos contra este documento y contra las cinco condiciones del §8.2; recomienda antes de que Andres autorice el siguiente | No escribe código ni documentación del repositorio salvo este análisis |

**Los hitos, en orden, y lo que la revisora comprueba en cada uno:**

| Hito | Cierra | La revisora comprueba |
|---|---|---|
| **H0** | F-1 y E | `estado-de-versiones.sh` 8/8; ninguna rama de las nueve sigue abierta; hotfix probado con teléfono real; el reusable 2.4 evaluando `main`; matriz de capacidades entregada |
| **H1** | F1 (y S en marcha) | Los tres ejes en `cuenta/estado` y `rutasWhatsApp`; ninguna pantalla ni script escribe `plan: 'demostracion'` ni `pagaMeta`; Negocios hace lo que A-3b prometía; migración de los seis tenants aplicada y releída; prueba negativa del contador de cambios |
| **H2** | F2 | `fronteras.test.ts` y `registro.test.ts` en CI; 8 JSON idénticos byte a byte; cero cambios de lógica en el diff (solo rutas e importaciones); ninguna de las siete copias de la lista de flujos sobrevive |
| **H3** | F3 y S | Una sola variante de los cinco nodos comunes; `ingesta.ts` sin importar módulos; ensayo real en Demo A y Demo B con audio, foto, PDF y foto sin contexto; los 8 flujos publicados desde `main`; staging con `desplegar-staging` en verde |
| **H4** | Aceptación y pase de Platinum | 45 filas con identificador de ejecución; ejes escritos; acta del checklist con los pendientes en la nube cerrados con evidencia; decisión de modo A o B tomada |
| **H5** | F4 y F5 | Tokens fuera de n8n; latencia p50 medida; Bellido sin nodos propios en su JSON; pruebas de instancia cortas |
| **H6** | F6 | `CLAUDE.md` solo invariantes; `docs/arquitectura/` con índice de secciones viejas; gancho por carpeta probado con un intento fuera de carpeta |

**El informe de hito** lo escribe la sesión operadora en `Prompts/COORDINACION.md`
(tablero nuevo de este frente) y lo pega Andres en la sesión revisora: PR y sha
fusionados, pruebas con sus números reales, costo declarado en las tres
unidades (mensajes por conversación, escrituras en GitHub y corridas de CI,
escrituras en la nube), lo que quedó fuera y por qué, y lo que el operador
encontró mal en este documento.

---

## 9. Cómo se sostiene después

1. **Frontera mecánica, no escrita.** `fronteras.test.ts` en CI y en el gancho
   de pre-commit; el gancho de Claude Code sobre Edit y Write rechaza una
   escritura fuera de la zona del agente. Es el candado por hecho aplicado a
   la arquitectura.
2. **Un módulo nuevo es una carpeta y una línea en el registro.** `registro.test.ts`
   obliga a que traiga reglas con prueba negativa, manifiesto completo y
   declaración de mensajes. Sin eso no compila la prueba.
3. **Un cliente nuevo es datos.** Alta en Plataforma con plan, modalidad,
   titularidad y módulos; variables del prompt; el flujo se ensambla y se
   publica. Si el alta necesita tocar código, se detiene: es un módulo que
   falta.
4. **El estado se genera.** Etiqueta viva, Functions desplegadas, flujos
   publicados con su versión de módulos, tenants con su modalidad: un script
   lo imprime. Lo que se escribe a mano es lo que no se puede derivar:
   decisiones y hallazgos, en la bitácora del mes.
5. **`CLAUDE.md` con invariantes.** Cada sesión y cada agente lo leen entero al
   arrancar: cuanto menos estado tenga, menos contradicciones y menos
   contexto gastado.

---

## 10. Riesgos

| Riesgo | Cómo se cierra |
|---|---|
| **Mover carpetas rompe importaciones y despliegue de Functions** (el despliegue costó cuatro etiquetas fallidas en septiembre) | F2 no cambia `index.ts` exportado: reexporta desde las carpetas nuevas. `firebase deploy --dry-run` en la misma aprobación, como siempre. Un solo paquete de despliegue: partirlo no es parte de este cambio |
| **Unificar tres variantes de los nodos comunes cambia comportamiento en silencio** | Las suites de los 5 flujos conversacionales son la red; ensayo real en A y B; publicación solo desde `main`; los respaldos `.local.json` que `publicar-flujo.sh` guarda permiten volver |
| **El receptor del webhook (F4) agrega latencia y un punto de fallo** | Instancias mínimas en la Function receptora; acuse inmediato a Meta y entrega asíncrona a n8n; medición de p50 antes y después; vuelta atrás = reactivar el disparador de n8n del flujo anterior |
| **Ramas abiertas y worktrees viejos chocan con el movimiento de archivos** | §6.2: fusionar o cerrar antes de F2; los cinco worktrees en `.claude/worktrees/` se revisan y los sin rama se quitan |
| **Los documentos citan §4sexies y compañía por número** | Índice de secciones viejas a archivos nuevos en `docs/arquitectura/indice.md`; los agentes lo leen antes que DISENO |
| **La arquitectura queda escrita y no aplicada, como la política de capas del 06/09** | La prueba de fronteras entra en CI en F2, antes de que exista el primer módulo movido. Sin prueba, no hay fase 2 |

---

## 11. Lo que NO se hace en este cambio

- **Partir las Functions en varios paquetes de despliegue.** Espera a medir el
  arranque en frío y a que Firebase confirme que mueve una función viva sin
  borrarla (memoria `modularizacion-plan-por-etapas`).
- **Unificar todos los clientes en un solo flujo de n8n con varios
  disparadores.** Descartado en `Analisis/20`; F4 lo vuelve innecesario.
- **Messenger, Instagram, Telegram, chat web.** Son módulos del conector de
  canal que F4 habilita; se construyen con su oferta (`Analisis/35` §5).
- **Tech Provider.** Es un trámite de Meta, en paralelo, y no bloquea nada de
  esto.
- **Actualizaciones mayores de dependencias** mezcladas con cualquier fase.
- **Cambiar precios, planes publicados, unidad de cobro ni umbrales.** La base
  comercial de `CLAUDE.md` no se toca; solo cambia dónde vive cada número.

---

## 12. El ciclo de vida del cliente: altas, solicitudes, reclamos y colisiones

**Agregado el 25/09 a pedido de Andres**, después de relevar la experiencia real:
seis carpetas en `CLIENTES/`, los dos runbooks, las memorias del proyecto y
`ESTADO.md`. La arquitectura del §1 al §11 dice dónde vive cada pieza; esta
sección dice **cómo entra un cliente y cómo se atiende lo que pide** sin que
eso vuelva a romper la arquitectura.

### 12.1 Lo que pasó en 26 días, medido

| Cifra | Valor |
|---|---|
| Clientes con número real atendiendo | 3 (Bellido, Platinum, NovuChat) |
| Filas de aceptación llenas en los dos clientes con pacientes reales | **0 de 91** |
| Incidentes en que un cliente afectó a otro, quedó atrás del vertical o se confundió con otro | **23** (tabla completa en el relevamiento del 25/09) |
| Reclamos reales que pasaron por la pantalla «Reclamos» | 0; la callable que mueve estados no tiene ningún llamador |
| Propuestas comerciales con cláusulas que el servidor no puede cumplir | 2 de 2 (Q'Taco: «pago confirmado» y tope con corte; Dhermacore: «cada imagen consume 2 mensajes» y cambios sin contador) |
| Etapas del ciclo de vida que el runbook cubre | 3 de 8 |

Los 23 incidentes, por causa: **6** por copiar el demo al cliente y heredar lo
que nadie borró (marcadores, credenciales, alias, `webhookId`); **4** por una
lección que no cruzó de un flujo a otro o un cliente que quedó atrás del
vertical; **5** por un recurso compartido entre clientes (credencial de
Calendar, portafolio al tope, texto de un cliente en código común, un arreglo
pedido por uno que rompió a los tres); **3** por dos superficies o dos fuentes
de configuración sin regla de cuál manda; **5** defectos del producto que el
cliente encontró porque la aceptación no se corre. La raíz es una sola: **el
tenant es una copia editada a mano**, y el proceso no decide qué hacer con cada
pedido antes de construirlo.

### 12.2 Las ocho etapas, con su compuerta

Cada etapa termina con un archivo lleno en `CLIENTES/<T>/`, y la siguiente no
arranca sin él. Documento de entrada: `docs/clientes/CICLO-DE-VIDA.md`, que
remite al runbook de alta en la etapa 3 y al de pase en la 6.

| # | Etapa | Compuerta (lo que tiene que existir para pasar) | Hoy |
|---|---|---|---|
| 0 | **Propuesta comercial con factibilidad** | `cumplimiento.md`: cada cláusula de la propuesta mapeada a una capacidad de un módulo o a un límite que el servidor hace cumplir; ninguna cláusula de la lista prohibida (§12.3). **Se corre sobre el borrador, antes de enviarlo** | No existe; el análisis llega después de enviada |
| 1 | **Ficha y cumplimiento** | `ficha.md` con particularidades, supuestos declarados, quién paga Meta, plan, modalidad prevista, datos de terceros que **no** se cargan | La ficha tiene datos técnicos; lo demás va a mano |
| 2 | **Análisis de solicitudes** (§12.4) | `pedidos.md` con cada pedido clasificado, sus opciones «así se puede», esfuerzo real y decisión comercial | No existe |
| 3 | **Alta técnica** | El runbook de alta; `verificar-meta.sh` en verde; entorno del cliente completo (`N8N_WORKFLOW_ID` incluido) | Existe y funciona |
| 4 | **Adecuación** | Solo por módulos con bandera (§12.5); ensayo obligatorio; costo en mensajes declarado; ninguna línea de un cliente en código común | Se hizo sin etapa: 19 nodos en un JSON, bloques en el vertical |
| 5 | **Aceptación** | `aceptacion.md` sin celdas vacías, con identificador de ejecución por fila; la suite es la unión de las filas que trae cada módulo encendido más las particularidades del cliente | Archivo vacío en los dos clientes que atienden |
| 6 | **Pase a producción** | El runbook de pase: ejes escritos (plan, modalidad, titularidad), contrato con quién paga Meta y los cambios incluidos, acta con evidencia | Runbook del 22/09, nunca ejecutado |
| 7 | **Operación** (§12.6, §12.7) | Reclamos con circuito; pedidos registrados y contados; correcciones por severidad; versión de módulo por tenant al día | Por chat, audio y Excel; sin registro de quién pidió qué |
| 8 | **Baja o suspensión** | Functions existentes con pantalla en Plataforma; datos retenidos 12 meses | Sin pantalla; nunca ejercitada |

### 12.3 La regla de atención: «así se puede»

**Regla de Andres (25/09/2026), para todo cliente.** A un pedido no se le
contesta «sí» ni «no»: se le contesta con una alternativa viable, preferentemente
sobre algo que ya existe. El cliente es flexible si lo que se le propone está en
el rango de lo que puede aceptar, y muchas veces lo existente o lo fácil es lo
que hubiera preferido de haberlo conocido.

Es la cara comercial de una regla que el sistema ya tiene para el asistente,
«solo se ofrece lo que se cumple» (21/09): el asistente nunca promete lo que el
flujo no hace, y NovuChat nunca dice «no» sin poner sobre la mesa lo que sí
hace. Las dos juntas cierran el círculo: lo que NovuChat ofrece al cliente es
exactamente lo que el flujo va a cumplirle a sus clientes.

**Cómo se aplica en el análisis de cada pedido:** se escriben siempre **tres
opciones**, y se recomienda una:

- **A. Lo pedido, literal.** Con su esfuerzo real y su costo.
- **B. Sobre lo existente.** Qué módulo o configuración de hoy cubre la
  necesidad de fondo, aunque no la forma pedida.
- **C. La variante que conviene más.** Lo que el cliente no imaginó porque no
  sabe qué hay: a veces es mejor para él y más barata para NovuChat.

La necesidad de fondo se escribe antes que las opciones: el doctor que pide «el
menú de 3 botones en una lista de 4 filas» necesita que el paciente elija sin
escribir; el que pide «citas de octubre desde un .ics» necesita no recargar 40
citas a mano. Las opciones se juzgan contra la necesidad, no contra la frase.

**Lista de cláusulas prohibidas en propuestas y guiones** (cada una ya se pagó):

| Cláusula | Por qué no | Qué se ofrece en su lugar |
|---|---|---|
| «Pago confirmado», «acreditado», «verificado» | Prohibición 3 de `CLAUDE.md`: el OCR no acredita | «Recibimos tu comprobante y los datos coinciden; el comercio confirma contra su banco» |
| «Cada imagen consume N mensajes» | El servidor cuenta un mensaje por saliente; no existe | Contar lo que se cuenta: respuestas del asistente |
| Cambios «ilimitados» o sin número | No hay contador; el SLA promete dos días hábiles por cambio | «N cambios incluidos al mes», con el contador de F1 |
| «Suspensión automática por falta de pago» | El corte del prepago está en observación | Se promete cuando `corteActivo` esté encendido |
| «Recordatorio 24 h antes» sin plantilla aprobada | Fuera de 24 h solo llega una plantilla de utilidad aprobada | Se promete cuando la plantilla esté aprobada en la WABA del cliente |
| «Tres flujos simultáneos» | Es un flujo con tres intenciones | Decirlo así en el contrato; el lenguaje comercial puede quedar |
| Cualquier afirmación clínica, médica o financiera del asistente | El asistente informa; no diagnostica ni garantiza | Lista de afirmaciones prohibidas por cliente, como Platinum |
| «Seguimiento de solicitudes pendientes» en Messenger o Instagram | Sin etiqueta para eso fuera de 24 h (`Analisis/35`) | Solo en WhatsApp y Telegram |

### 12.4 El análisis de solicitud: reutilizar, crear, dónde reside, cuánto cuesta

Todo pedido se anota en `CLIENTES/<T>/pedidos.md`, venga por audio, Excel,
WhatsApp, reunión o chat, con fecha, quién lo pidió y por qué medio. Un pedido
trivial ocupa una fila; uno que no lo es, un archivo `solicitudes/<n>.md` con
esta estructura. **El análisis es un entregable en sí mismo, con techo de una
hora, y no implica construir**: muchas veces termina en una cotización, y el
cliente decide.

```
Solicitud literal      lo que dijo, con fecha, quién y medio
Necesidad de fondo     qué quiere lograr (no la forma en que lo pidió)
Ubicación              prueba de ubicación del §1.3: configuración | módulo existente
                       | módulo nuevo | core | dato del tenant | no
Reutilización          qué existe ya que la cubre, en el registro de módulos y en
                       ~/Claude-Proyectos/proyectos/ ; qué porcentaje de la necesidad cubre
Lo que se crea         dónde reside (zona y carpeta), a quién más le sirve, si nace
                       con bandera, mensajes por conversación que agrega o quita
Esfuerzo real          jornadas, con las señales de dificultad oculta marcadas (abajo)
Opciones               A literal · B sobre lo existente · C la variante mejor,
                       cada una con esfuerzo, plazo y precio; la recomendada
Decisión comercial     incluido (cuenta contra cambiosIncluidos) | cotizado (precio,
                       nada se construye hasta el OK) | mapa de producto (módulo, fecha)
                       | repriorizado (cliente especial: criterio y qué desplaza)
Estado                 analizado → propuesto al cliente → aceptado → construido →
                       verificado con el cliente (fila en aceptacion.md)
```

**Las solicitudes engañan en los dos sentidos.** Lo que parece simple toca Meta,
código común o el dinero; lo que parece difícil ya existe. Casos reales:

| Pedido | Parecía | Es | Por qué |
|---|---|---|---|
| «Andres sin acento» en el nombre visible | Trivial | Difícil | El nombre visible de Meta tiene cupo mensual de cambios y la pantalla no dice la verdad; se pide una vez, por API |
| Menú de 3 botones a lista de 4 filas | Trivial | Medio | Cambia la topología de nodos propios del cliente; títulos de 20 caracteres; el botón no guardaba su elección desde el 18/09 |
| Emergencia sin el 168 ni «si no respira» | Trivial | Trivial, pero **decisión clínica del doctor**: queda escrita con su nombre | Texto de configuración; el riesgo es de responsabilidad, no de código |
| Siete agendas en Platinum | Configuración | Difícil | El candado hace una llamada a Calendar por agenda: con siete se rompe la latencia (`Analisis/24`) |
| Recordatorio 24 h antes | Trivial, «ya está en el demo» | Medio | Exige plantilla de utilidad aprobada en la WABA del cliente y el flujo programado; se decidió no prometerlo a Bellido |
| Citas de octubre desde un `.ics` | Difícil | Trivial | Existe `citas-a-calendario.mjs` |
| Fotos de antes y después (Dhermacore) | Difícil | Medio | El módulo de medios guardados ya está diseñado (`Analisis/38`) |
| Rescate a las 48 h (Dhermacore) | Nuevo | Existe | Es el módulo de seguimientos |
| «Vacunas y cremas van al doctor» | Trivial | Trivial | Configuración: palabras que transfieren |
| Un corrector del día de la semana «para Bellido» | Un cliente | Los tres | Vive en código común: fue a los tres flujos y se rompió en los tres |

**Señales de dificultad oculta**, para marcar en «Esfuerzo real»: toca código
común (va a todos); toca la topología de n8n (no es ensamblable hasta F3);
toca Meta (plantilla, revisión, cupo, portafolio); toca el candado, el cobro o
el conteo (dinero y regla mandatoria); exige desplegar Functions (etiqueta y
aprobación); toca datos de terceros; exige prueba con teléfono real; entra por
ventana de mantenimiento. **Señales de facilidad oculta:** es un campo de
configuración que ya existe; es un módulo que se enciende; existe en otro
vertical o en otro proyecto de `~/Claude-Proyectos/`; es un script que ya está
en `admin/scripts/`.

### 12.5 Cotizar, incluir y repriorizar

- **Cotizar no es construir.** El análisis del §12.4 se entrega al cliente con
  sus tres opciones y precios; lo que se construye es lo que el cliente acepta,
  y recién entonces entra a la cola. Un análisis que termina en «no acepta» es
  un análisis bien hecho.
- **Qué se incluye y qué se cobra**, para que la decisión no se invente en cada
  mesa (los números los fija Andres; la estructura es esta): configuración que
  el cliente hace solo en su consola, sin cupo; configuración que opera
  NovuChat, contra `cambiosIncluidos` y después por unidad; encender un módulo
  existente, con su instalación; módulo nuevo, cotizado por jornada, y como
  nace reutilizable NovuChat puede cofinanciarlo si lo va a vender a otros.
- **Clientes especiales y repriorización.** Un cliente puede adelantar un
  módulo en el mapa de producto (estratégico, primero en su rubro, volumen,
  referencia). Tres reglas: el criterio y lo que desplaza quedan escritos en su
  `pedidos.md`; **la prioridad adelanta un módulo para todos, nunca mete código
  en el tenant** (es la misma pieza, antes); y nunca pasa por encima de un
  hotfix de seguridad o de protección ni de una fase en obra de la
  rearquitectura.

### 12.6 Colisiones entre tenants: tres tipos, tres salidas

| Tipo | Ejemplos del 25/09 | Salida |
|---|---|---|
| **Tenant contra vertical (deriva)** | Platinum atrás de #170 y #171; Demo A sin el bloque de Platinum; Demo B atrás de #165 | Versión de módulo por tenant y excepción declarada (`docs/versiones-por-cliente.md`). Falta la comparación del JSON del cliente contra el módulo del que salió: `estado-de-versiones.sh` hoy solo compara el flujo vivo con su propio JSON. Con el JSON generado (F2, F5) la deriva desaparece por construcción |
| **Pedido de un tenant sobre código común** | Corrector de día de semana; constante de audio; nombre de la clínica en un comentario del vertical | Prueba de ubicación: nace como módulo con bandera, encendido en quien lo pidió y apagado en los demás. Nunca texto ni nombre de un cliente en código común. Las correcciones de seguridad y de protección van a todos, sin excepción (SLA §8) |
| **Tenants compitiendo por un recurso** | Credencial de Calendar `invalid_client` en tres a la vez; portafolio al tope; umbrales bajados para probar que degradaron a otros teléfonos; un solo número de ensayo | Inventario de recursos compartidos (§12.9) con una decisión por recurso: por tenant, por número, o compartido con cola |

### 12.7 Reclamos y correcciones con circuito

- **Un canal de entrada que registra**, aunque el reclamo llegue por el
  WhatsApp de recepción, por audio o por reunión: la persona de NovuChat lo
  carga en «Reclamos» del comercio, con categoría y fecha. La regla del 17/09
  manda: lo que se instruye por chat tiene que verse en la consola del
  comercio.
- **Una pantalla en Plataforma que mueve el estado** (la callable existe y
  nadie la llama), con auditoría de quién y cuándo.
- **Cinco pasos fijos** para cualquier reclamo de falla: ejecuciones de n8n
  leídas; causa y severidad según el SLA §5; corrección como hotfix (severidad
  1) o en la ventana de 02:00 a 03:00; publicación **a todos** con excepciones
  declaradas; **verificación con el cliente anotada en su `aceptacion.md`**.
- **Errores de redacción del modelo** están excluidos por el SLA §11, pero un
  patrón que se repite es un pedido de barrera por hecho, y entra al §12.4.

### 12.8 Estructura obligatoria de `CLIENTES/<T>/`

La carpeta está ignorada por git y vive en la copia base, no en un worktree.

| Archivo | Etapa | Contenido |
|---|---|---|
| `cumplimiento.md` | 0 | Cláusulas de la propuesta contra capacidades y límites; veredicto por cláusula |
| `ficha.md` | 1 | Datos del negocio, canal, plataforma, particularidades, supuestos, quién paga Meta, plan y modalidad previstos, datos de terceros que no se cargan |
| `pedidos.md` y `solicitudes/<n>.md` | 2 y 7 | Cada pedido con su análisis, decisión y estado; el contador de cambios del mes |
| `estado.md` | 3 a 8 | Bitácora del cliente, lo más nuevo arriba |
| `aceptacion.md` | 5 y 7 | Filas generadas de los módulos encendidos más las particularidades; identificador de ejecución por fila; se vuelve a llenar en cada verificación con el cliente |
| `pase-a-produccion.md` | 6 | El runbook de pase aplicado; acta |
| `anexo-particular.md` | 6 | Lo del contrato que es de este cliente: cambios incluidos, titularidad, excepciones de versión, afirmaciones prohibidas |
| `guia-meta.md`, material del cliente | 3 | Lo que ya existe |

### 12.9 Inventario de recursos compartidos

| Recurso | Compartido entre | Decisión |
|---|---|---|
| Credencial OAuth de Google Calendar | Demo A, Platinum, Bellido | Por tenant; o calendarios compartidos a una cuenta de NovuChat con credencial propia por tenant. Un `invalid_client` no puede tumbar a tres |
| Portafolios de Meta creados por Andres | Tope de 2 por persona; 2 números por portafolio sin verificar | Verificar «NovuChat Produccion» es lo que destraba (20 números, apps fuera del tope de 15). Hasta entonces, cliente nuevo = portafolio del cliente |
| Número de ensayo (Demo A) | Todos los clientes de reservas | Un ensayo a la vez, con cola escrita en `COORDINACION.md`; segundo número de ensayo antes del quinto cliente; para clientes con nodos propios el ensayo no sirve hasta F5 |
| Umbrales de atención | Todos los teléfonos del comercio | Nunca bajarlos en un comercio que atiende; umbral por teléfono de prueba como arreglo de fondo |
| Clave de Gemini, VM de OCI, instancia de n8n Community | Todos, incluido el otro producto que vive en la VM | Compartidos y aceptados; capacidad medida antes del cliente cincuenta (`Analisis/20` §6) |
| Tarjeta de NovuChat en Meta | Todas las cuentas del portafolio donde esté | Nunca en el portafolio de un cliente; tarjeta dedicada con tope y alerta por WABA |
| Proyecto Firebase y Secret Manager | Todos | Aislamiento por reglas y claims (probado); un alias de secreto por número |
| Memoria del agente en n8n | Teléfonos del mismo flujo | Clave = teléfono; quien escribe a dos números del mismo tenant comparte ventana, bloque y umbrales (`Analisis/38`), y hay que decirlo en la mesa |

### 12.10 Congelamiento durante la obra, y qué sigue abierto

Mientras F2 y F3 estén en curso, **ningún cliente recibe código a medida**. Lo
que sí sigue: configuración (es dato y se aplica en cualquier momento),
comercial, Meta, aceptación, y hotfix de seguridad o de protección. Todo pedido
que exija código se analiza igual (§12.4), se cotiza si corresponde, y queda en
`pedidos.md` con fecha comprometida «después de F3». Se les dice a los clientes
en prueba, y es la razón para no firmar el pase de nadie antes de F3: el SLA
promete cambios operados por NovuChat en dos días hábiles, y con el core en
obra esa promesa no se puede cumplir.

De los pedidos abiertos al 25/09: los siete del audio de Bellido son
configuración o decisión del doctor salvo la lista de cuatro filas (topología,
espera F3); las decisiones de Platinum son comerciales y de Meta; Q'Taco y
Dhermacore pasan por el §12.3 antes de retomarse.
