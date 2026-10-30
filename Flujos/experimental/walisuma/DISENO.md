# Walisuma: diseño del esqueleto (PR-2)

**Qué es.** Un flujo de venta por WhatsApp para un comercio con catálogo grande (132 ítems en `admin/scripts/datos/walisuma/catalogo.json`). El código calcula (carrito, montos, cobro); el modelo conversa. Este PR-2 construye todo lo que NO es la conversación, el carrito, el cobro ni los avisos.

**Lista de funcionalidades de esta etapa** (no se copió el flujo de otro cliente):
1. Entrar solo por la entrega firmada del receptor (verificada, repetidos descartados entre ejecuciones).
2. Filtrar eventos (solo `messages`, solo el número del negocio) y normalizar todos los tipos de entrada; la sesión es `messages[0].from`.
3. Traer la configuración de la consola (catálogo, cobro, campañas, atención) con el respaldo de «Config base».
4. Cortar el turno si el comercio no está operativo, si superó el uso extendido o si una persona tomó la conversación (cero envíos, cero modelo, cero descargas).
5. Leer audios (transcripción), imágenes y PDF (clasificación, campañas por titular, comprobante guardado) como cualquier otro flujo de venta digital.
6. Enviar con la cadena común (lote de 1, respaldo en texto, reporte saliente) y verificar la entrega.

**Por qué 47 y no más.** Tope heredado de la experiencia de Bellido (un flujo con más nodos que funcionalidades hay que rehacerlo). Con 36 en el esqueleto y 11 reservados para el PR-3, no hay margen: se suma lo que falta o se quita algo.

**Por qué los nodos comunes se subieron a `venta-digital/src/nodos/`.** Cinco nodos y `_comun.js` de Antonio contenían la clave de su ficha y el nombre de sus funciones. Walisuma los necesita y los otros clientes de venta digital los tendrán: se subieron neutros, con un parámetro (`CN_TENANT`) que cada tenant declara en su librería. La versión de Antonio no se tocó; migrará en su propio PR.

**Decisiones abiertas** (no se tomaron aquí): guía de voz y prompt; texto definitivo para números de otro país y si se atienden; modos de entrega y su costo; contacto designado del aviso; estado de la plantilla `pedido_registrado` en Meta.

**Precondiciones para publicar** (además de completar el PR-3): sustituir todos los `REEMPLAZAR_*`, plantilla aprobada, costo de entrega declarado, el candado de la doble reserva no aplica (no hay agenda), prueba contra un teléfono real y el «sí» de Andres por acción.
