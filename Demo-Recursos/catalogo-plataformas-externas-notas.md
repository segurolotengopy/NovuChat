# Plan para el catálogo — opciones externas (notas)

> Documento traído el 2026-09-07 con alternativas gratuitas y de código
> abierto para el catálogo. Se conserva **tal como llegó**. El análisis
> contra lo que el sistema hace hoy está en
> `Analisis/10-catalogo-plataformas-externas.md`.

---

Tienes toda la razón y te agradezco la corrección. Puse a Shopify en la misma bolsa corporativa, pero definitivamente no es gratis (cuesta desde $30 USD al mes) y Kyte limita mucho su versión gratuita.

Si buscamos alternativas **realmente gratuitas** o **Open Source** (código abierto) que no se coman el margen de ganancia de ustedes ni el de sus clientes, tenemos que dividir las opciones en dos caminos: las plataformas que ya están listas y son gratis de por vida para WhatsApp, y el camino Open Source que tu pareja (como desarrollador) puede montar a costo cero.

### Camino 1: Plataformas 100% Gratuitas para pedidos por WhatsApp (SaaS)

Estas no son Open Source, pero su modelo de negocio permite usar el catálogo y el carrito hacia WhatsApp gratis para siempre (ganan dinero vendiendo otras cosas, como pasarelas de pago con tarjeta o integraciones con UberEats, que a ti no te interesan).

1. **GloriaFood (Para Gastronomía):** Es el rey absoluto y gratuito para restaurantes.
* **¿Por qué es gratis?** Oracle los compró y mantienen el sistema de toma de pedidos 100% gratis de por vida (sin comisiones). Solo cobran si el restaurante quiere recibir pagos con tarjeta de crédito en la web.
* **¿Cómo funciona para tu cliente?** Se descargan la app de GloriaFood, suben fotos de sus platos y el sistema les da un link.
* **Integración:** El cliente elige la comida en el link y el sistema envía el pedido estructurado al WhatsApp de NovuChat.


2. **TakeApp (Para Retail y Comercio):** Creada específicamente para vender por WhatsApp.
* **¿Por qué es gratis?** Tienen un plan gratuito muy generoso que permite productos ilimitados y carrito de compras directo a WhatsApp. Cobran si quieres un dominio propio (ej. *mitienda.com*) o integraciones avanzadas.
* **Integración:** El carrito se envía a WhatsApp con un formato de texto perfecto y ordenado que la IA de n8n puede leer fácilmente.



### Camino 2: El Camino Open Source / Developer (Ideal para tu pareja)

Si tu pareja es desarrollador de sistemas, esta es la ruta definitiva para que ustedes **sean dueños de la plataforma** sin pagar mensualidades a terceros y dándole al cliente una interfaz súper fácil.

1. **Google Sheets + Vercel/GitHub (Plantillas Open Source de Catálogos):**
* **El concepto:** En GitHub existen decenas de plantillas Open Source (código abierto) de "WhatsApp Shopping Carts" hechas en React o Next.js.
* **Cómo funciona:** Tu pareja clona una de estas plantillas y la sube a Vercel (un servicio de alojamiento de código que es 100% gratis para proyectos pequeños).
* **Lo que hace el cliente:** El "panel de control" del cliente será simplemente un archivo de Google Sheets. Si el cliente quiere subir el precio de la hamburguesa, abre su Excel en el celular, cambia el "25" por "30", y la página web del catálogo se actualiza en 3 segundos.
* **Costo:** $0. Es 100% controlable por ustedes y el link de WhatsApp llega a n8n exactamente con la estructura que ustedes programen.


2. **WooCommerce (Open Source puro):**
* **El concepto:** Es el sistema de e-commerce de código abierto más grande del mundo (funciona sobre WordPress).
* **Cómo funciona:** Es 100% gratis y no tiene límites. Solo necesitas instalar un plugin gratuito de "Order on WhatsApp" que reemplaza el botón de "Pagar" por "Enviar Carrito por WhatsApp".
* **La contra:** Aunque el software es gratis, requiere que ustedes o el cliente paguen un servidor de alojamiento web (hosting), lo cual cuesta unos $5 a $10 USD al mes. Si tienes muchos clientes, los pones a todos en un servidor barato y se amortiza.



**Mi recomendación sincera:**
Para la Rueda de Negocios de esta semana, apóyate en **TakeApp** (para tiendas) y **GloriaFood** (para restaurantes). Diles a los prospectos: *"Te conectamos gratis a estas plataformas para que manejes tus productos desde tu celular, y nuestra IA se encarga de recibir esos carritos en WhatsApp y cobrarles."*

Si les va excelente y consiguen muchos clientes, el próximo mes tu pareja puede clonar un carrito Open Source en GitHub conectado a Google Sheets para que NovuChat ofrezca su propio link de catálogo sin depender de nadie.
