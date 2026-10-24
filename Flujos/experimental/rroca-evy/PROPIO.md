# El flujo nuevo de la Dra. Evy (`rroca-evy`): qué es común y qué es propio

Regla (Andres, 09/10/2026): flujo propio = composición propia + núcleo común obligatorio. Lo común se incluye desde su fuente; donde no hay fuente utilizable, copia declarada con prueba de igualdad.
Este flujo se rehízo **desde cero** (23/10/2026) y no hereda nada del asistente de las doctoras (`Flujos/experimental/doctoras/`, que sigue siendo de Emma y no se toca).

## Incluido desde su fuente (nunca copiado)
- Mensajes (`comun-sin-agente/src/mensajes.js`), filtro de redacción (`comun-sin-agente/src/filtro-redaccion.js`: `cmMotivoDeRechazo`), cadena de envío (`injertar`) y armador: `comun-sin-agente/`.
- Avisos (`venta-minima/src/lib/avisos.js`): `avTexto`, `avPlantilla`, `avLimpio`, `avDestinatarios`.
- La transcripción de audio: `Flujos/src/core/medios/preparar-transcripcion.js`, byte a byte (la guardia de armado y la de publicación lo comprueban).

## Copia declarada (no existe un módulo común; ticket para Rearquitectura, es Core y no se crea aquí)
- `src/nodos/carga-de-entrada.js`: idéntico al de las doctoras (prueba de igualdad en `armado.test.ts`). `src/nodos/_comun.js`: el de las doctoras con otra clave de ficha (`evy`).
- `config-del-negocio.js` y `puerta-del-turno.js`: adaptados de las doctoras (modo prueba `etapaPrueba`, lectura de la Consola con `tenantId`), más dirección y horario de la Consola.
- En `ev.js`: `EV_NIEGA_IA` (= `RR_NIEGA_IA` de Rubén), `EV_RIESGO` (= `DR_RIESGO` de las doctoras, a su vez de Antonio) y `evOraciones`/`evParrafos` (= `rrOraciones`/`rrParrafos`), todas con prueba de igualdad.
- Reescrito mínimo y propio (no copiado): la baja silenciosa (`EV_BAJA_CLAUSULA`, por cláusula, con falsos positivos probados), la ficha por teléfono, la memoria de 15 entradas.

## Propio
`prompts/evy.md` (el prompt versionado), `src/lib/ev.js`, `normalizar-entrada.js`, `decidir-turno.js`, `armar-previos.js`, `armar-mensajes.js`, `resumen-del-turno.js`, la plantilla y los datos (`admin/scripts/datos/rroca-evy/`).

## Decisiones y consentimientos declarados
- **Consentimiento del antes y después: declarado por Andres el 23/10/2026** (Andres tiene el consentimiento ESCRITO de la paciente; relayado por Principal el mismo día). Sin nombre ni datos de la paciente en ningún archivo.
- **D6 (Andres, 23/10/2026), opción A: las marcas (Radiesse®, HArmonyCa™).** El texto con las marcas vive aislado en bloques `{{#MARCAS}}…{{/MARCAS}}` del prompt y el código los incluye o quita según la bandera `usarMarcas` de «Config base» (`si` o vacío). Con la bandera apagada el prompt habla de «bioestimuladores de colágeno» y «dos opciones» y la etiqueta del comparativo no se acepta ni se envía. Aunque esté encendida, el comparativo se envía SOLO si el mensaje del cliente pregunta por la diferencia o cuál conviene (detección por código en `evPideComparativo`), nunca en el saludo.
- **Riesgo aceptado por Andres el 23/10/2026:** el uso de las marcas en la cuenta de WhatsApp y el portafolio de Evy descansa en la lectura de WAM de la política de Meta, **sin confirmar con Meta**. **Cómo apagarlo:** dejar `usarMarcas` vacío en los datos (tabla local), rearmar (`node construir.mjs`), preparar y republicar con el «sí» de Andres. No hace falta tocar código.
- **Las imágenes ya están subidas a Meta.** Sus ids de medio están en un archivo local con permiso 0600 (fuera del repositorio; este flujo no lo lee) y en los datos versionados solo van marcadores `REEMPLAZAR_MEDIA_ID_*`. **Los medios de Meta vencen a los 30 días de la subida (alrededor del 23/11/2026): hay que resubirlas y actualizar la tabla local.** Los archivos, por nombre: comparativo = `WhatsApp Image 2026-10-23 at 19.51.25.jpeg`; antes y después = `WhatsApp Image 2026-10-23 at 19.51.26.jpeg`; autoridad = `WhatsApp Image 2026-10-23 at 19.51.25 (1).jpeg`.
- Documentos (PDF): no se bajan ni se mandan a Gemini (datos de salud); texto cortés fijo. Es lo mismo que hace Rubén. Declarados en `mediosHabilitados` junto con audio e imagen.
- La Consola manda (regla del 22/10/2026): nombre, número de recepción, dirección y horario se leen de «Traer configuración» en cada turno; en los datos versionados solo hay marcadores. La dirección de respaldo y la clínica son datos del flujo y solo se usan si la Consola no responde.

## Modo prueba (`etapaPrueba`): lo que hay que saber antes de usarlo
- (a) Con la etapa encendida un número AJENO no recibe NADA: ni respuesta, ni el texto de protección, y tampoco se reporta a la ingesta. Por eso solo se usa en un número todavía NO publicado a pacientes.
- (b) Producción completa: la tabla local necesita `REEMPLAZAR_ETAPA_PRUEBA` vacío (la etapa completa rechaza `si`).
- (c) En la prueba, el marcador de recepción se resuelve con un teléfono de prueba SOLO en una COPIA de la tabla, usada para preparar el flujo; el botón y el aviso van entonces al número de prueba, nunca a la recepción real.
- (d) Una nota: `scripts/publicar-flujo.sh` hoy reconoce `rroca-evy` por el nombre y aplica la guardia de las DOCTORAS (`doctoras/construir.mjs`), que no es la de este flujo. Hasta que se cablee esta guardia (`rroca-evy/construir.mjs --publicable`) en ese script, publicar este flujo por esa vía se niega. No se tocó el script en este PR.
