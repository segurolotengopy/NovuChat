# Las doctoras: qué es común y qué es propio

Regla (Andres, 09/10/2026): flujo propio = composición propia + núcleo común obligatorio. Lo común se incluye desde su fuente; donde no hay fuente utilizable, copia declarada con prueba byte a byte (`huecos.test.ts`).

## Incluido desde su fuente
Mensajes (`comun-sin-agente/src/mensajes.js`), filtro de redacción, cadena de envío (`injertar`), armador, y los tres módulos de `Flujos/src/core/medios/` (prueba: `medios.test.ts`).

## Copia declarada de `rroca-antonio` (tercera vez que se pide: ticket del módulo común para Rearquitectura, es Core y no se crea aquí)
`puerta-del-turno.js`, `carga-de-entrada.js`, `config-del-negocio.js` (idénticos), `_comun.js` (cambia la clave de la ficha a `doctoras`), los nodos JSON del receptor y de configuración (iguales salvo `id`, `notes`, `position`), y en `dr.js` las expresiones NIEGA_IA, violencia o miedo y baja (misma fuente, comparadas en la prueba).

## Propio
`src/lib/dr.js`, `normalizar-entrada.js`, `decidir-turno.js`, `armar-mensajes.js`, `resumen-del-turno.js`, la plantilla y los datos de cada doctora.

## PR-B
Incluido desde su fuente además: `venta-minima/src/lib/avisos.js` (texto libre y plantilla del aviso; `librerias` del armador). Copia declarada: las funciones de párrafos (`drOraciones`, `drEsPregunta`, `drParrafos`) son las de `rroca-antonio/src/lib/ra.js` con otro prefijo (prueba de igualdad). Propio: intenciones, textos comunes, consentimiento, `armar-avisos.js`, `armar-mensajes.js`, `decidir-turno.js`. Pruebas: `conversacion.test.ts`, `negadas.test.ts` (batería de más de 60 mensajes con el vigilante de UX), `referencias-a-nodos.test.ts` (importa `problemasDeReferencias` de Rubén, sin copiarla; lista permitida exacta).
