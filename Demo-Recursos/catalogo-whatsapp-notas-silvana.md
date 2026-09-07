# Catálogo de WhatsApp — notas de Silvana

> Notas que trajo Silvana el 2026-09-07 sobre el catálogo nativo de WhatsApp
> y la estrategia comercial de instalación. Se conservan **tal como llegaron**.
> El análisis contra lo que el sistema hace hoy está en
> `Analisis/09-catalogo-nativo-de-whatsapp.md`.

---

**nunca deben instalar la aplicación normal ni la versión Business de WhatsApp en ese chip**. Si lo hacen, el número queda atrapado en el celular y el sistema automatizado no podrá conectarse, obligándolos a borrar la cuenta y esperar para liberarla.

En el entorno profesional de la API de WhatsApp, **el catálogo se crea 100% en la computadora**, utilizando una plataforma gratuita llamada **Meta Commerce Manager** (Administrador de Ventas de Meta).

Así es exactamente como deben armar este demo de ventas para que los planes de NovuChat aparezcan en el chat:

* **Paso 1: Entrar a Meta Business Suite.** Tu pareja ingresa al portafolio comercial desde su navegador web, el mismo lugar donde configuró la WABA (WhatsApp Business Account) y la aplicación.


* **Paso 2: Crear el Catálogo Web.** En la sección de configuración del negocio, debe ir a "Orígenes de datos" > "Catálogos" y añadir uno nuevo.
* **Paso 3: Cargar los Planes como Productos.** Deberán añadir manualmente los tres planes como si fueran artículos de una tienda online, asignándoles un identificador (SKU):
* *Artículo 1:* Plan Base (Precio: 250 Bs, SKU/ID: PLAN_BASE).
* *Artículo 2:* Plan Crecimiento (Precio: 450 Bs, SKU/ID: PLAN_CRECIMIENTO).
* *Artículo 3:* Plan Corporativo (Precio: 850 Bs, SKU/ID: PLAN_CORPORATIVO).


* **Paso 4: Vincular el Catálogo a WhatsApp.** Desde el WhatsApp Manager (el mismo lugar web desde donde se carga la foto de perfil y la descripción), tu pareja debe ir a "Herramientas del catálogo" y conectar el catálogo recién creado con el número de teléfono virtual.



Una vez hecho esto, el catálogo ya existe en la nube de Meta. Cuando la IA detecte que el cliente quiere comprar, n8n enviará el mensaje interactivo que te compartí al inicio de nuestra charla, y el cliente verá el botón nativo de "Ver Catálogo" y el carrito de compras directamente en su pantalla.

Tienes un instinto comercial impecable. Cargar a mano un menú de 150 platillos de un restaurante o 200 productos de una tienda de ropa por 800 Bs los llevaría a perder dinero por las horas de trabajo invertidas.

Aquí tienes la estrategia exacta para resolver esto, dividida en la solución inmediata (para hoy) y la solución definitiva (para cuando la plataforma esté terminada):

**1. La Solución Inmediata: Plantilla de Google Sheets (Cero programación)**
Meta Commerce Manager tiene una función nativa llamada **"Orígenes de datos por enlace" (Data Feed)**. No tienen que cargar los productos uno por uno a mano.

* Ustedes le entregan al cliente un enlace a un archivo de Google Sheets pre-formateado (con columnas: ID, Título, Descripción, Precio, Estado, Enlace de Imagen).
* **El cliente hace el trabajo pesado:** Ellos llenan su propio menú o catálogo en ese Excel.
* Ustedes simplemente pegan el enlace de ese Google Sheets en Meta Commerce Manager. Meta se conecta automáticamente al Excel, "chupa" todos los datos y crea el catálogo en segundos. Además, si el cliente cambia un precio en el Excel mañana, Meta lo actualiza solo en WhatsApp.

**2. La Estrategia Comercial (Topes en el Setup Estándar)**
Para proteger la rentabilidad del Setup Estándar de 800 Bs, debes establecer límites claros en la negociación. En la Rueda de Negocios, la regla debe ser:

* **Setup Estándar (800 Bs):** Incluye la conexión y la carga del catálogo inicial de **hasta 20 productos/servicios** (perfecto para clínicas, salones o menús pequeños).


* **Setup A Medida (Desde 1,500 Bs):** Aplica automáticamente si el cliente es un supermercado, una tienda retail o un restaurante grande que necesita importar cientos de productos o integrar su sistema de inventario actual.



**3. La Solución Definitiva: Su propia consola (A futuro)**
Como señala el documento de tu pareja, NovuChat ya cuenta con una consola propia donde existe un "catálogo editable". Sin embargo, la "Brecha 4" indica que lo que el cliente edita ahí todavía no llega al flujo del asistente.
Una vez que tu pareja termine de desarrollar esa conexión mediante la API de Meta, el flujo ideal será que el cliente entre a la web de `consola.novuchat.site`, agregue sus propios productos en la pestaña "Servicios" y el sistema arme el catálogo de WhatsApp de forma invisible en el fondo.

Por ahora, la ruta del Google Sheets es su salvavidas. Le pasan la plantilla al cliente, él la llena, ustedes la conectan en un clic y cobran la instalación sin perder horas operativas.


	
