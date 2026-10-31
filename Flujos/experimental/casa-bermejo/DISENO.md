# Casa Bermejo: diseño del flujo de venta (31/10/2026)

Parte de la lista cerrada de 12 funcionalidades (encargo de la sesión de Casa Bermejo, autorizado por Principal el 31/10/2026), no del JSON de otro flujo (regla «basado en»). El flujo nace APAGADO, sin URL provisional y sin publicar: publicar y registrar cliente10 en el receptor son botones de Andres, uno por acción.

## Qué se incluye de lo común (sin copiar)
Entrada verificada del receptor, cadena de envío, medios entrantes, guardado de medios, nodos neutros y motor de venta (`Flujos/experimental/venta-digital/src/`), el armador de `comun-sin-agente`, igual que Walisuma. Zona de este flujo: solo lo propio.

## Lo propio (y su costo en nodos)
1. País por prefijo del remitente (+591, +54; otro = Bolivia y aviso a la tienda): código en «Decidir turno», 0 nodos.
2. Catálogo en vivo desde Wegic: 1 nodo HTTP (credencial de n8n, nunca en el archivo) + 1 Code que lo normaliza al formato del carrito (`id`, `nombre`, `precioCentavos`, `moneda`, `stock`, `foto`). El resto del flujo ve solo el formato normalizado: si Wegic cambia, cambia solo ese adaptador. Wegic caído = pase con vendedor (aviso + botón).
3. Precio tal como lo publica el sitio, sin recalcular. Si resulta calculado en el navegador, el adaptador replica la fórmula y se prueba contra 10 productos (pendiente de la respuesta de Wegic).
4. Entrega por país (datos, sin calcular ni cobrar envío): AR nombre, DNI, dirección, código postal, provincia; BO nombre, CI, ciudad, flota o terminal. Es dato de «Config del negocio».
5. Cobro BO: QR del comercio sin monto (imagen de la Consola) + cotejo del comprobante. Cobro AR: 1 nodo HTTP «Pedir alias» al contrato del servidor (código fijo de error → frase fija → pase con vendedor); el alias se dice en texto, sin imagen. Mientras el servidor no exista, el nodo apunta a una interfaz simulada solo en la variante de prueba.
6. Comprobante: «Cotejar en el servidor» con `moneda`. Texto: solo «llegó y los datos coinciden».
7. Pedido a la Consola (PR-4) y aviso a la tienda; tomar; pase con vendedor; guardado de medios.
Estimado: ~58 nodos de Walisuma + 3 (Wegic ×2, alias) = 61. Walisuma ya tiene excepción declarada de 58; este flujo necesita su propia excepción (decisión de Andres) o se recorta un nodo del propio.

## Orden de construcción (cada paso, PR chico)
A. Esqueleto: construir.mjs, plantilla, datos con marcadores, pruebas de armado (apagado, sin clave, sin URL).
B. Adaptador de Wegic con fuente simulada + país por prefijo.
C. Cobro BO (QR sin monto) y cobro AR (alias del servidor, contrato simulado).
D. Entrega por país, avisos, pase con vendedor y las pruebas negando del encargo (§4).
Todo se declara «no publicable» (`--publicable` sale 1) hasta tener: respuesta de Wegic, alias y QR, teléfono de la tienda, servidor ARS y PR-4, método de pago en la WABA …3055.

## Mensajes por conversación
Los de la base de venta común: 1 por turno, 2 en el turno del QR de Bolivia, 1 a la tienda por pedido, +1 por pase. Argentina no suma imagen de QR. Este diseño agrega 0.
