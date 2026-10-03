# Módulo Captación

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `captacion.ts`, `config/onboarding`, `Captacion.tsx`, corpus del sitio (807 KB dentro de un nodo Code) |
| **Depende de** | — |
| **Límite por plan** | — |
| **Configuración** | `config/onboarding`: rubros, planes, asesor |
| **Colecciones** | Storage `captacion/` |
| **Pestañas** | Captación (`admin`) |
| **Prompt** | `Flujos/prompts/modulos/captacion.md`: genérico (sin nombre de un negocio ni de personas, sin trato fijo: sale de `tratamiento` y `estiloEmojis`), parte estática < 6.000 caracteres. Desde el 03/10/2026 el primer mensaje lleva los rubros en una **lista interactiva**, no como referencia en el texto |
| **Herramientas** | — |
| **Nodos (lo que queda en n8n)** | nodos Code del onboarding (12, con Core); en `Flujos/src/modulos/captacion/`: `Estado de la conversación` (registra el rubro por el toque y guarda los hechos), `Decidir fila de la planilla` (la calificación por hechos), `Prospecto para la planilla`, `Confirmar envío`, `Filtrar categoría` y `Conocimiento del sitio`. Ningún nodo nuevo en el Bloque 1 |
| **Ganchos** | `antesDelTurno` (rubros y planes) |
| **Mensajes por conversación** | Rearquitectura: 0. **Bloque 1 (03/10/2026): 0 a +2**, aceptado por Andres: cada vuelta del ping-pong (pregunta de dolor, oferta) responde a un mensaje del cliente, y la lista y los botones viajan dentro del mismo mensaje. Lo demuestran la cuenta de «mensajes por conversación» de `onboarding-flujo.test.ts` (directo al asesor 4 + 1 plantilla; con planes 5 + 1; solo saluda 1; ya es cliente 1) |
| **Pruebas** | `captacion.test.ts`, `cargar-captacion.test.ts`, `onboarding-flujo.test.ts` (los casos C1 a C22), `core/captacion-interactivos.test.ts` (la parte de Core), y la batería contra el modelo `admin/scripts/modulos/captacion/bateria.mjs` (se corre con la autorización de Andres) |

**Observación:** hoy es un vertical (`onboarding`); con módulo, **NovuChat es un tenant con Captación encendida**. El corpus de 807 KB sale del nodo a un recurso que sirve la Function (bloque B-3). `captacion.ts:371` pasa a `tieneModulo('captacion')`. El chat de captación existe para la ficha: contacto, empresa y rubro, capturados por código

## Bloque 1 (03/10/2026): ping-pong, lista de rubros y calificación por hechos

**Lo que cambia, y lo que revierte.** Andres decidió el 03/10/2026 que el primer
mensaje se presenta como IA y pregunta el rubro en un **mensaje interactivo tipo
lista** con los rubros de `config/onboarding`; el toque registra el rubro por
código y «Otro / a medida» abre la pregunta libre. Eso **revierte** «los rubros
como referencia, no un menú» (22/09/2026) y «sin botones al inicio»
(27/09/2026). El orden es rubro, pregunta de dolor, empatía con la oferta, y
planes o una persona del equipo; un mensaje corto por turno, cada uno termina en
una pregunta. Nombre y empresa **no** se piden al inicio: el contacto es el
nombre de perfil de WhatsApp y la empresa se pide dentro del mensaje del
traspaso. Se retiran la deducción del rubro y su confirmación, y la marca
`[CIERRE]`: quien pide una persona por escrito va al traspaso (aviso más botón).

**Calificación (columna I de la planilla), por lo que el prospecto hizo:**
Alta si pidió una persona (botón, fila o escrito) o los planes (toque en «Ver
planes», o un texto que los pide con rubro registrado); Media si eligió su rubro
(o «Otro») y contestó la pregunta de dolor; Descalificado si el modelo lo
propone con `[DESCARTE]motivo[/DESCARTE]` y el código lo acepta (motivo de la
lista cerrada, sin un hecho de Alta, no es soporte, no la escribió el cliente);
Baja el resto. La celda solo sube: Baja < Media < Descalificado < Alta, y un
valor desconocido se sobrescribe. Motivos: `numero_equivocado`,
`vende_o_busca_trabajo`, `sin_negocio`, `spam_o_prueba`.

### Contrato entre nodos

| Quién | Qué emite o guarda |
|---|---|
| `Normalizar entrada` (Core) | `idElegido`: id del botón o de la fila tocada (`rubro:<id>`, `asesor`, `planes`), solo `[a-z0-9:_-]`, hasta 200; `''` si no hay o no cumple. `porCampana`: la campaña con `destino` válido cuenta como el toque de esa opción |
| `Estado de la conversación` (módulo) | `rubroElegido` (el nombre registrado este turno, por toque o por texto), `eligioOtroEsteTurno`, `respondioDolorEsteTurno`, `tocoPlanesEsteTurno`, `opcionVencida`, `hechos`, `hechosCambiaron`. Guarda en la conversación `c.hechos` (no vence con la ventana), `c.pidioDolor` (sí vence) y `c.rubroId`; borra `confirmaRubro` y `rubroDeducido` |
| `hechos` | `{ pidioAsesor, pidioPlanes, eligioOtro, respondioDolor, descarte }`: cuatro booleanos estrictos y `descarte` (un motivo de la lista o `''`). `pidioAsesor` (no cuando quien lo pide ya es cliente), `eligioOtro` y `respondioDolor` los marca el Estado; `pidioPlanes` y `descarte` los decide `Procesar respuesta` |
| `Procesar respuesta` (Core) | La lista de rubros (`lista_de_rubros`), la oferta con los botones «Ver planes» y el del asesor, `c.pidioDolor`, `c.hechos.pidioPlanes` y `c.hechos.descarte`; reenvía `hechos` |
| `Salida` (Core) | `prospectoPlanilla.hechos`, los cinco campos saneados |
| `Decidir fila de la planilla` (módulo) | `CALIFICACION` por hechos, `PRIORIDAD` de la celda y `MOTIVOS_DESCARTE` (sus claves coinciden con las de Procesar y de Salida: una prueba lo compara) |

**Planes pendientes (corrección de la revisión).** Quien pide planes o precios sin
rubro recibe «Para mostrarte los planes que te sirven, ¿de qué rubro es tu
negocio?», que es una promesa. `Procesar respuesta` escribe `c.planesPendientes =
true` al retener los planes por falta de rubro y lo borra cuando salen; `Estado de
la conversación`, si se registra un rubro (toque, nombre escrito, rubro libre o
campaña) o elige «Otro» con la marca puesta, emite `tocoPlanesEsteTurno`, borra la
marca y agrega el hecho «Había pedido los planes.» (los planes salen y es Alta). La
marca vence con la ventana. **Vocabulario:** quien recibe al prospecto se llama
siempre «asesor» (textos fijos y prompt).

El contexto del turno que arma el Estado dice **hechos** («Eligió su rubro: «X»
(registrado).», «Eligió «Otro».», «Contestó tu pregunta sobre su negocio.»,
«Tocó «Ver planes».», «Había pedido los planes.», «Dice que ya es cliente.») y
nunca pide nombre ni empresa ni da una orden; **qué hacer** con cada hecho lo dice
el prompt (procedimiento P1 a P8), una sola vez.

**Campañas con destino.** Una campaña puede traer un `destino` con el mismo
vocabulario de ids (`rubro:<id>`, `planes`, `asesor`) y se trata como si el
cliente hubiera tocado esa opción. `asesor` no dispara el traspaso (una campaña
no gasta la plantilla de aviso con cada clic): llega como contexto y el mensaje
sale con el botón. El campo en el servidor y la consola es del Bloque 2.

**El corpus.** El nodo `Conocimiento del sitio` se copia sin `vector` y no deja entrar
al texto los fragmentos que la consola ya cubre (`CUBIERTOS_POR_LA_CONSOLA`: planes,
precios, instalación, moneda, prepago, cambio de plan, cómo se cuenta una conversación):
los precios tienen una sola fuente. **Datos a cargar en la consola en el Bloque 2:** la
frase «para quién es cada plan», el plan recomendado y el detalle de cada rubro, por qué
no se cobra por mensaje y que la consola muestra el número que se factura.

**Fuera del Bloque 1 (Bloque 2, exige Functions):** pregunta propia por rubro,
imagen por rubro, nombre de la asesora, frase con cifra.

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4sexies.5 (25/09/2026, líneas 1441-1506) -->

### 4sexies.5 La captación es un flujo más, no «el flujo de NovuChat» (15/09/2026)

Hasta el 15/09, `onboarding` era el flujo **propio** de NovuChat: su documento
lo leía y lo escribía solo el propietario, y lo que el asistente ofrecía
(rubros, planes, precios) estaba escrito en el flujo de n8n. Pasa a ser un
**tercer flujo genérico, configurable por consola**: cualquier comercio que
vende un servicio puede captar prospectos con él. NovuChat es su primer usuario,
con el asistente «Kenji».

**Por qué genérico.** Con el contenido dentro del flujo, cambiar un precio era
editar el JSON y republicar (y la regla del proyecto dice que un cambio de flujo
se aplica a todos los clientes o a ninguno). Con el contenido en la consola, el
flujo es uno solo y cada comercio carga su oferta: es la misma separación que ya
tienen agendamiento y venta, y la que sostiene el alta en 48 horas.

**El documento `/config/onboarding`** (la lista blanca y los límites de verdad
están en `configOnboardingValida()` de `firestore.rules`):

| Campo | Qué es | Límite |
|---|---|---|
| `rubros` | Rubros que el asistente reconoce, cada uno con la solución que se le ofrece y el flujo que se le sugiere | hasta 8; `{ id /^[a-z0-9-]{1,30}$/, nombre ≤40, solucion ≤300, flujoSugerido: agendamiento · venta · recordatorios · a_medida }` |
| `planes` | Planes del comercio, **en dólares** (Base comercial §3) | hasta 20; `{ nombre ≤40, precioUsd ≥0, periodo: mes · anio · unico, incluye ≤200 }` |
| `archivoPlanes` | Un PDF o una imagen con todos los planes | `{ url https, tipo: pdf · imagen, nombreArchivo ≤80 }`; **obligatorio con más de 5 planes** |
| `cargosUnicos` | Instalación y otros cargos que se pagan una vez | hasta 5; `{ nombre ≤60, precioUsd ≥0, desde: bool, detalle ≤200 }` |
| `aclaraciones` | Conceptos de la oferta que el asistente usa **solo si le preguntan** | hasta 15; `{ tema ≤60, texto ≤600 }` |
| `mensajeClienteActual`, `enlaceConsola`, `topeAviso`, `plantillaAviso` | Los que ya existían (§4sexies, captación de NovuChat) | sin cambios |
| `actualizadoPor`, `actualizadoEn` | Sello | el de siempre |

**Quién lo edita.** El **administrador del comercio que tiene `onboarding` en
`flujos`**, igual que el de agendamiento edita su agenda, y el **propietario**
(NovuChat), que lo carga en el alta y da soporte. Ningún otro comercio, ni con la
petición armada a mano; la regla lee la misma lista `flujos` que el menú. Lo
lee la gente del comercio con el flujo, como cualquier otro documento de config.

**`nombreAsistente` es común, no de la captación.** Vive en `/config/negocio`
(≤40 caracteres) porque cualquier flujo se presenta con él: el asistente de
reservas de un salón también puede llamarse de una forma. Un nombre propio no
lo convierte en persona: el asistente sigue diciendo que es una IA si le
preguntan (prohibición 4).

**Cinco planes en texto, seis o más en archivo.** Hasta cinco, los planes caben
en una respuesta legible. Más, la lista ya no se lee en un chat, y partirla en
varios mensajes cuesta dinero (Base comercial §1: un mensaje largo y completo
es más barato que dos cortos). Por eso con más de cinco el archivo es
obligatorio, y el asistente lo manda en lugar de la lista.

**Las aclaraciones van solo si las piden.** Son la definición de «conversación»,
la bolsa, el prepago, la moneda: lo que un prospecto pregunta, pero que soltado
sin pedirlo alarga cada respuesta. El asistente las tiene y no las recita.

**Los precios son en dólares y el asistente no convierte.** El cobro en
bolivianos es al Tipo de Cambio Oficial del BCB del momento del pago (Base
comercial §3); un importe en bolivianos calculado por el modelo sería una cifra
inventada.

**Cómo se carga.** Desde la pestaña «Captación», o de una vez desde un JSON
versionado con `admin/scripts/datos/cargar-captacion.mjs` (valida el mismo contrato,
exige el flujo en la ficha, muestra en seco qué cambia y deja auditoría). El
contenido de NovuChat, copiado del sitio, está en
`admin/scripts/datos/captacion-novuchat.json`.

**Mensajes que agrega:** ninguno. La configuración cambia lo que dice cada
respuesta, no cuántas salen.

---
