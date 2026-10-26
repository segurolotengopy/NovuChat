# Las doctoras: qué es común y qué es propio

Regla (Andres, 09/10/2026): flujo propio = composición propia + núcleo común obligatorio. Lo común se incluye desde su fuente; donde no hay fuente utilizable, copia declarada con prueba byte a byte (`huecos.test.ts`).

## Incluido desde su fuente
Mensajes (`comun-sin-agente/src/mensajes.js`), filtro de redacción, cadena de envío (`injertar`), armador, y los tres módulos de `Flujos/src/core/medios/` (prueba: `medios.test.ts`).

## Copia declarada de `rroca-antonio` (tercera vez que se pide: ticket del módulo común para Rearquitectura, es Core y no se crea aquí)
`carga-de-entrada.js` (idéntico), `puerta-del-turno.js` y `config-del-negocio.js` (los de Antonio + SOLO el modo prueba `etapaPrueba`: ruta `fuera_de_prueba` y recepción de «Config base» manda; fragmentos declarados en `huecos.test.ts`), `_comun.js` (cambia la clave de la ficha a `doctoras`), los nodos JSON del receptor y de configuración (iguales salvo `id`, `notes`, `position`), y en `dr.js` las expresiones NIEGA_IA, violencia o miedo y baja (misma fuente, comparadas en la prueba).

## Propio
`src/lib/dr.js`, `normalizar-entrada.js`, `decidir-turno.js`, `armar-mensajes.js`, `resumen-del-turno.js`, la plantilla y los datos de cada doctora.

## PR-B
Incluido desde su fuente además: `venta-minima/src/lib/avisos.js` (texto libre y plantilla del aviso; `librerias` del armador). Copia declarada: las funciones de párrafos (`drOraciones`, `drEsPregunta`, `drParrafos`) son las de `rroca-antonio/src/lib/ra.js` con otro prefijo (prueba de igualdad). Propio: intenciones, textos comunes, consentimiento, `armar-avisos.js`, `armar-mensajes.js`, `decidir-turno.js`. Pruebas: `conversacion.test.ts`, `negadas.test.ts` (batería de más de 60 mensajes con el vigilante de UX), `referencias-a-nodos.test.ts` (importa `problemasDeReferencias` de Rubén, sin copiarla; lista permitida exacta).

## Modo prueba (`etapaPrueba`): lo que hay que saber antes de usarlo
- (a) Con la etapa encendida un número AJENO no recibe NADA: ni respuesta, ni el texto de protección de riesgo (violencia, urgencia médica), y tampoco se reporta a la ingesta (no cuenta conversación ni se guarda su texto). Por eso la etapa solo se usa en un número todavía NO publicado a pacientes.
- (b) Producción completa: la tabla local necesita `REEMPLAZAR_ETAPA_PRUEBA = no` (la etapa completa rechaza `si`; cualquier valor distinto de `si` la deja apagada).
- (c) En la prueba, el marcador de recepción (`REEMPLAZAR_NUMERO_RECEPCION_RROCA_EVY`) se resuelve con un teléfono de prueba SOLO en una COPIA de la tabla, usada nada más para preparar el flujo; nunca para cargar los datos del negocio (`cargar-negocio`).
- Secuencia de publicación: copia de la tabla con `ETAPA_PRUEBA = si`, teléfonos de prueba y recepción de prueba -> preparar -> `publicar-flujo.sh --flujo <preparado> --etapa-prueba --aplicar` (actualiza el flujo inactivo) -> `--encender --etapa-prueba --aplicar`. Para producción: tabla real con `REEMPLAZAR_ETAPA_PRUEBA = no`, flujo regenerado y publicado con la guardia completa.
- No hecho, a propósito: la guardia no compara la recepción de «Config base» con la de la Consola, porque `negocio-<tenant>.json` solo trae el marcador y la recepción de la Consola es un dato vivo (no se lee en la guardia). La etapa la ignora en ejecución.
