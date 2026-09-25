# Prompts de sesiones dedicadas

Convención global, plantilla y ejemplo: `~/Claude-Proyectos/prompts/`. Esta
carpeta guarda los de NovuChat.

Un archivo por frente de trabajo. Se pega entero en una sesión nueva de
`~/NovuChat`; cada prompt dice qué leer primero, en qué rama trabajar, qué
construir en qué orden, qué no construir y qué entregar. El tenant siempre es un parámetro
(`<TENANT>`): un cliente es una instancia, no un prompt. Cada prompt manda
consultar `~/Claude-Proyectos/` antes de construir. Nada acá contiene
secretos ni identificadores de Meta: los prompts apuntan a los análisis y a
las fichas, no los copian.

| Archivo | Frente | Análisis que lo respaldan |
|---|---|---|
| `sena-seguimiento-medios.md` | Flujo de agendamiento con seña por QR, seguimiento de leads, medios entrantes, Maps, candado con varias agendas | `Analisis/30` a `34` (caso de estudio) |
| `mensajeria-agnostica.md` | Capa de mensajería independiente del canal: conectores WhatsApp, Messenger, Instagram, chat web, Telegram | `Analisis/35`, `Analisis/20` |
| `prepago-estricto.md` | Prepago estricto: pago por consola, por el WhatsApp interno y por carga manual; uno a seis meses; cobranza y cortes | `Analisis/36`, `29`, y la rama del prepago |
| `cobrador-contrato-para-consumidores.md` | **Para la sesión del proyecto de cobros por QR**: contrato para proyectos consumidores (crear, consultar, anular, aviso firmado) | `Analisis/36` §1.2 |
| `modularizacion-flujos.md` | Sacar el código y los prompts de los nodos de `Flujos/*.json` a módulos versionados con un ensamblador | memorias `modularizacion-*`, `Analisis/20` §5, `Flujos/LEEME-flujos.md` §0 |
| `prepago-y-modularizacion-en-paralelo.md` | **Coordinadora**: prepago estricto (A) y modularización (B) a la vez, el contrato del cobrador (C) encolado en su proyecto, mapa de archivos, cola de fusión y la compuerta del demo | `Analisis/36`, los prompts de A, B y C |
| `medios-guardados.md` | Biblioteca de imágenes del comercio para responder con imágenes, y guardado por categoría de los medios que envían los clientes finales | `Analisis/38`, `34` §4 |
| `retomar-demo-b-venta.md` | **Traspaso al cerrar la sesión del 23–25/09**: catálogo web, carrito, memoria del pedido y cobro por QR en el Demo B; estado verificado, dos defectos abiertos y las decisiones ya tomadas | `admin/CATALOGO-WEB.md`, `DISENO.md` §4duodecies |
| `capacidades-comunes.md` | **Urgente (25/09)**: audio, imagen y documento son capacidades GENERALES; hoy solo las tienen los flujos de reservas. Definición de lo que todo flujo conversacional tiene que tener, con suite que falla, y ports al Demo B y a captación | ESTADO 25/09, `Analisis/34`, `Prompts/modularizacion-flujos.md` |
