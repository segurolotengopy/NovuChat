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
| **Prompt** | fragmento de captación del prompt; los rubros como referencia, no como menú |
| **Herramientas** | — |
| **Nodos (lo que queda en n8n)** | nodos Code del onboarding (12, con Core); F2 los extrae |
| **Ganchos** | `antesDelTurno` (rubros y planes) |
| **Mensajes por conversación** | 0 |
| **Pruebas** | `captacion.test.ts`, `cargar-captacion.test.ts`, `onboarding-flujo.test.ts` |

**Observación:** hoy es un vertical (`onboarding`); con módulo, **NovuChat es un tenant con Captación encendida**. El corpus de 807 KB sale del nodo a un recurso que sirve la Function (bloque B-3). `captacion.ts:371` pasa a `tieneModulo('captacion')`. El chat de captación existe para la ficha: contacto, empresa y rubro, capturados por código

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
versionado con `admin/scripts/cargar-captacion.mjs` (valida el mismo contrato,
exige el flujo en la ficha, muestra en seco qué cambia y deja auditoría). El
contenido de NovuChat, copiado del sitio, está en
`admin/scripts/datos/captacion-novuchat.json`.

**Mensajes que agrega:** ninguno. La configuración cambia lo que dice cada
respuesta, no cuántas salen.

---
