# El flujo nuevo de la Dra. Emma (`rroca-emma`, cliente07): qué es común y qué es propio

Regla (Andres, 09/10/2026): flujo propio = composición propia + núcleo común obligatorio. Lo común se incluye desde su fuente; donde no hay fuente utilizable, copia declarada con prueba de igualdad.
Este flujo se construyó el 24/10/2026 **adaptando el flujo nuevo de la Dra. Evy** (`Flujos/experimental/rroca-evy/`, ya probado y fusionado), no el asistente anterior de las doctoras (`Flujos/experimental/doctoras/`, que sigue siendo de Emma y no se toca). Su diseño, topología (36 nodos en producción, 31 en la prueba) y barreras son los de Evy; ver `DISENO.md` y el de Evy.

## Incluido desde su fuente (nunca copiado)
- Mensajes (`comun-sin-agente/src/mensajes.js`), filtro de redacción (`comun-sin-agente/src/filtro-redaccion.js`: `cmMotivoDeRechazo`), cadena de envío (`injertar`) y armador: `comun-sin-agente/`.
- Avisos (`venta-minima/src/lib/avisos.js`) y la transcripción de audio (`Flujos/src/core/medios/preparar-transcripcion.js`, byte a byte).

## Copia declarada de Evy (sin tocar la lógica de las barreras)
`src/lib/ev.js` (prefijo `ev` conservado a propósito para que la copia se pueda comparar con la de Evy), `src/nodos/*.js`, `construir.mjs`, `herramientas/bateria.mjs` y la plantilla del flujo. Cada diferencia con Evy es una de las siguientes y está probada en `admin/pruebas/tenants/rroca-emma/emma.test.ts`:
1. **Nombres y textos fijos:** «la Dra. Emma», `Emma Spa Medic`; el cierre dice «100% gratuita y sin compromiso (sin pago de reserva)», sin «bonificada».
2. **SIN ancla de monto.** Evy puede decir «250 Bs» como valor habitual de una valoración bonificada; **Emma nunca menciona una cifra de dinero** (decisión de Andres, 24/10/2026; el MD de Emma tampoco la trae). Las tres funciones del ancla (`evProtegerValor`, `evMarcarValor`, `evRestituirValor`) quedan como identidad: cualquier monto lo rechaza el filtro común y el texto cae al fallo con botón.
3. **Lista cerrada de visión de Emma:** `bata`, `antes_despues`, `espejo`, `otra` (no la de Evy). El nodo «Ver imagen» y los rótulos canónicos son los de Emma.
4. **Dos imágenes de apoyo activas** (`[ENVIAR_ARTE_AUTORIDAD]` = la bata «Activa tu colágeno natural», y `[ENVIAR_ARTE_ANTES_DESPUES]` = «Resultados reales, sigues siendo tú»). La imagen del espejo solo se RECONOCE cuando el cliente la manda; el flujo no la envía. **La comparativa «¿Sculptra® o Radiesse®?» NO existe como archivo:** el código la deja PREPARADA (la etiqueta `[ENVIAR_ARTE_COMPARATIVO]` se reconoce y se quita del texto; se enviaría solo con `usarMarcas`, un id resuelto y si el cliente pregunta la diferencia) pero INACTIVA: el prompt no la nombra, su id queda como marcador `REEMPLAZAR_MEDIA_ID_ARTE_COMPARATIVO` y la guardia de publicación lo tolera. Para activarla: agregar el archivo, subirlo a Meta, cargar su id en la tabla local y agregar la regla al prompt.
5. **Ordinales de dirección:** la dirección de Emma dice «entre 2do y 3er anillo» y la regla de precios (`entre … <cifra>`) la tomaba por un rango (preguntar «¿dónde están?» caía al fallo). `evOrdinalesDeDireccion` escribe los ordinales con palabras ANTES de las barreras («entre segundo y tercer anillo»). Es la única adición a la lógica de las barreras; no afloja nada (los rangos de precio siguen rechazándose).
6. **Horario de la Consola, sin `horarios` obligatorios:** el horario es de turno partido y lo lee de la Consola en cada turno; ni el prompt ni el código lo repiten. La guardia de publicación no exige `negocio.horarios`.
7. **Identidad:** el flujo es de Emma y solo de Emma: su «Config base» dice `rroca-emma` y nada del flujo nombra a otro cliente (la guardia y las pruebas lo comprueban); ningún dato de Evy (nombre, clínica, dirección, productos, horario) aparece en el prompt, el código ni los JSON.

## Propio
`prompts/emma.md` (adaptado del MD de la doctora del 24/10/2026 con las correcciones acordadas: «efecto lifting» sin «desde la primera sesión», valoración gratuita sin pago de reserva, Caso B con sus tres anuncios), la plantilla y los datos (`admin/scripts/datos/rroca-emma/`), y el archivo de casos de la batería (`herramientas/bateria-casos.json`).

## Decisiones y consentimientos declarados
- **Consentimiento del antes y después: declarado por Andres el 24/10/2026** (sin datos de pacientes en ningún archivo).
- **Nombre:** «la Dra. Emma» (decisión de Andres). El MD de la doctora escribe «Enma» en su nombre completo; no se usa.
- **`usarMarcas = si`** (como Evy): el texto con Sculptra® y Radiesse® vive en bloques `{{#MARCAS}}…{{/MARCAS}}` del prompt; vacío, el prompt habla de «bioestimuladores de colágeno» y «dos opciones». Apagarlo: vaciar `usarMarcas` en la tabla local, rearmar y republicar con el «sí» de Andres.
- **Emma NO agenda:** el cierre es el botón a la recepción más el aviso (texto libre en la ventana de la recepción, plantilla UTILITY fuera de ella); ninguna oración puede afirmar una cita, un cupo o un registro.
- Las imágenes ya están en poder de WAM; los ids de medio viajan por la tabla local (en git solo `REEMPLAZAR_MEDIA_ID_ARTE_AUTORIDAD` y `REEMPLAZAR_MEDIA_ID_ARTE_ANTES_DESPUES`). Los medios de Meta vencen a los 30 días de la subida: hay que resubirlas y actualizar la tabla local.
- La Consola manda (regla del 22/10/2026): nombre, número de recepción, dirección y horario se leen de «Traer configuración» en cada turno; en los datos versionados solo hay marcadores y el respaldo (dirección y clínica) si la Consola no responde. El número de recepción real NUNCA va en git (marcador `REEMPLAZAR_NUMERO_RECEPCION_RROCA_EMMA`).

## Modo prueba (`etapaPrueba`) y publicación
- Igual que Evy: con la etapa encendida un número AJENO no recibe NADA; el botón y el aviso van al número de recepción de «Config base», nunca a la recepción real de la Consola; producción completa exige `REEMPLAZAR_ETAPA_PRUEBA` vacío.
- **`scripts/publicar-flujo.sh` tiene la guardia de este flujo, ADITIVA:** lo reconoce por su CONTENIDO (nodo «Armar previos» y «Config base» con `tenantId` = `rroca-emma`), ejecuta `rroca-emma/construir.mjs --publicable --etapa <e>` y pide `PUBLICAR EMMA` (o `--confirmo-emma`). **Solo puede reemplazar al flujo vivo de Emma** (el nuevo, o el viejo de las doctoras reconocido por nombre `rroca-emma` + nodo «Armar avisos» + «Config base» con `rroca-emma`); sobre el de Evy o el de cualquier otro cliente se NIEGA, también con `--forzar`. Y el flujo de Evy no puede pisar el de Emma aunque lo renombren. Las pruebas están en `publicador.test.ts` (incluida la aditividad contra `origin/main`).
