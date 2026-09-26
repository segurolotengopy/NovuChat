# Índice: de las secciones viejas de `admin/DISENO.md` a los archivos por zona

> Los agentes y los documentos citan las secciones de `admin/DISENO.md` por
> número (§4sexies, §4undecies.4, …). El 25/09/2026 esas secciones se movieron a
> `docs/arquitectura/`, un archivo por zona y por módulo, **sin cambiar una
> letra**: cada bloque movido lleva un comentario HTML con la sección y las
> líneas de origen. Esta tabla es el mapa. Una cita a «`DISENO.md` §X» se lee
> como «el archivo de la columna derecha, bloque §X».

## Los archivos

| Archivo | Qué es |
|---|---|
| `core.md` | Lo que todo tenant corre igual: contratos, seguridad, conteo, canal, agente base |
| `central.md` | Lo que todo comercio ve igual: consola y cuenta, planes, modalidad, Pagar, servicios |
| `plataforma.md` | Lo que ve NovuChat como operador: Negocios, alta, baja, suspensión, ejes |
| `modulos.md` | La zona de módulos y el esquema del manifiesto |
| `modulos/<m>.md` | Un manifiesto en prosa por módulo: productos, agenda, pedidos, cobros, inventario, campanas, catalogo-web, captacion, menu-interactivo |
| `tenants.md` | Datos de un cliente, nunca código |
| `coordinador.md` | El coordinador de turno: las dos llamadas y los ganchos |
| `registro.md` | El registro de módulos y la política de capas que reemplaza |
| `limites.md` | La tabla de límites comerciales y dónde se hace cumplir cada uno (copia del §7 de la base comercial) |
| `../base-comercial.md` | La base comercial completa: el dinero de cada decisión técnica |

## Sección por sección

| Sección vieja | Título | Ahora en |
|---|---|---|
| §1 | 1. Qué es y qué promete | *(queda en `admin/DISENO.md`)* |
| §2 | 2. Arquitectura | *(queda en `admin/DISENO.md`)* |
| §3 | 3. Decisión: ¿proyecto Firebase nuevo o reutilizar el de los demos? | *(queda en `admin/DISENO.md`)* |
| §4 | 4. Aislamiento multi-tenant | `core.md` |
| §4.1 | 4.1 Sin multi-tenancy nativa de Firebase Auth — y por qué no hace falta | `core.md` |
| §4.2 | 4.2 Modelo de datos | `core.md` |
| §4.3 | 4.3 Roles y matriz de permisos | `core.md` |
| §4.4 | 4.4 Los custom claims y su tope de 1000 bytes | `core.md` |
| §4.5 | 4.5 Revocación: la ventana de una hora | `core.md` |
| §4bis | 4bis. Control administrativo del comercio | `central.md` |
| §4bis.1 | 4bis.1 Personas de referencia del comercio | `central.md` |
| §4bis.2 | 4bis.2 Contador de personas atendidas (únicos) | `central.md` |
| §4bis.2bis | 4bis.2bis Atenciones e interacciones | `central.md` |
| §4bis.3 | 4bis.3 Habilitar y deshabilitar un comercio | `plataforma.md` |
| §4bis.4 | 4bis.4 Varios flujos y varios números | `coordinador.md` |
| §4ter | 4ter. Modelo de acceso y funciones de relación con el comercio | `core.md` |
| §4ter.1 | 4ter.1 Autenticación mixta por rol | `core.md` |
| §4ter.2 | 4ter.2 Estado de cuenta visible para el comercio | `central.md` |
| §4ter.3 | 4ter.3 Contador de personas atendidas, visible para el comercio | `central.md` |
| §4ter.4 | 4ter.4 Reclamos que llegan por correo | `central.md` |
| §4quater | 4quater. Bitácora y configuración como fuente de verdad | `central.md` |
| §4quater.1 | 4quater.1 Bitácora: colección nueva, no extensión de `/auditoria` | `central.md` |
| §4quater.2 | 4quater.2 La configuración del comercio como fuente de verdad | `central.md` |
| §4quater.3 | 4quater.3 `direccion` y `datosQueNoTenemos`: el incidente del 28/08 | `central.md` |
| §4quater.4 | 4quater.4 `mensajeComercioSuspendido` y una propiedad emergente | `central.md` |
| §4quater.5 | 4quater.5 El comportamiento general se verifica en el servidor ANTES de aplicarse (17/09/2026) | `central.md` |
| §4quinquies | 4quinquies. Funcionarios y agenda por persona | `modulos/agenda.md` |
| §4quinquies.1 | 4quinquies.1 El problema | `modulos/agenda.md` |
| §4quinquies.2 | 4quinquies.2 Servicio ↔ funcionario: denormalizado de un solo lado | `modulos/agenda.md` |
| §4quinquies.3 | 4quinquies.3 Un solo funcionario tiene que ser trivial | `modulos/agenda.md` |
| §4quinquies.4 | 4quinquies.4 El candado contra la doble reserva | `modulos/agenda.md` |
| §4quinquies.5 | 4quinquies.5 El ID de calendario, validado en los dos lados | `modulos/agenda.md` |
| §4sexies | 4sexies. Flujos, consola y usuarios: la política de capas | `registro.md` |
| §4sexies.0 | 4sexies.0 La política (registrada el 2026-09-06, a pedido de Andres) | `registro.md` |
| §4sexies.1 | 4sexies.1 Qué es común y qué depende del flujo | `registro.md` |
| §4sexies.2 | 4sexies.2 Tres documentos, no uno con la unión de todos los campos | `registro.md` |
| §4sexies.3 | 4sexies.3 Los rótulos del cobro simulado NO los edita el comercio | `modulos/cobros.md` |
| §4sexies.3bis | 4sexies.3bis El catálogo nativo de WhatsApp es una capacidad de VENTA | `modulos/pedidos.md` |
| §4sexies.4 | 4sexies.4 Una consecuencia que conviene conocer | `registro.md` |
| §4sexies.5 | 4sexies.5 La captación es un flujo más, no «el flujo de NovuChat» (15/09/2026) | `modulos/captacion.md` |
| §4septies | 4septies. Retención de conversaciones: 12 meses | `central.md` |
| §4octies | 4octies. Catálogo web propio | `modulos/catalogo-web.md` |
| §4octies.0 | 4octies.0 Qué es, en una frase | `modulos/catalogo-web.md` |
| §4octies.0bis | 4octies.0bis Solo para el flujo de VENTA | `modulos/catalogo-web.md` |
| §4octies.1 | 4octies.1 Las dos correcciones del análisis, aplicadas | `modulos/catalogo-web.md` |
| §4octies.2 | 4octies.2 Las dos decisiones que no eran técnicas | `modulos/catalogo-web.md` |
| §4octies.3 | 4octies.3 Por qué no se adoptó una pieza de código abierto | `modulos/catalogo-web.md` |
| §4octies.4 | 4octies.4 Dos aplicaciones en un sitio, y por qué se partió el punto de entrada | `modulos/catalogo-web.md` |
| §4octies.5 | 4octies.5 El umbral del catálogo al prompt (punto 7 del diseño) | `modulos/catalogo-web.md` |
| §4octies.5bis | 4octies.5bis Sin precio no se publica | `modulos/catalogo-web.md` |
| §4octies.5ter | 4octies.5ter El logo se sube, y los colores se eligen de cinco | `modulos/catalogo-web.md` |
| §4octies.6 | 4octies.6 Qué se agregó a las reglas | `modulos/catalogo-web.md` |
| §4octies.7 | 4octies.7 Lo que este diseño NO resuelve, dicho ahora | `modulos/catalogo-web.md` |
| §4nonies | 4nonies. Pedidos y cobros: tres pantallas, no una | `modulos/pedidos.md` |
| §4nonies.1 | 4nonies.1 Pedidos — la pantalla del cocinero y del repartidor | `modulos/pedidos.md` |
| §4nonies.2 | 4nonies.2 Cobros — la pantalla de la plata | `modulos/cobros.md` |
| §4nonies.3 | 4nonies.3 Lo que falta para poder construirlas | `modulos/pedidos.md` |
| §4nonies.4 | 4nonies.4 Lo que cambia en el registro de flujos — hecho | `modulos/pedidos.md` |
| §4undecies | 4undecies. Prepago estricto: pagos, cortes, cobranza y el cobrador (20/09/2026) | `central.md` |
| §4undecies.1 | 4undecies.1 La colección `/tenants/{t}/pagos/{pagoId}` | `central.md` |
| §4undecies.2 | 4undecies.2 `cuenta/estado` se deriva de los pagos | `central.md` |
| §4undecies.3 | 4undecies.3 Reaplicación de `prepago.ts` sobre la ingesta de hoy | `central.md` |
| §4undecies.4 | 4undecies.4 La bandera de modo observación | `central.md` |
| §4undecies.5 | 4undecies.5 El contrato con el cobrador: el real, verificado el 20/09/2026 | `central.md` |
| §4undecies.6 | 4undecies.6 Costo en mensajes, por bloque | `central.md` |
| §4undecies.7 | 4undecies.7 Reparto por archivos y pruebas | `central.md` |
| §4undecies.8 | 4undecies.8 Contradicciones entre `Analisis/36` y el código de hoy, y su resolución | `central.md` |
| §4duodecies | 4duodecies. Seña por QR en reservas | `modulos/cobros.md` |
| §4duodecies.1 | 4duodecies.1 Las decisiones, en orden | `modulos/cobros.md` |
| §4duodecies.2 | 4duodecies.2 Los campos | `modulos/cobros.md` |
| §4duodecies.3 | 4duodecies.3 Lo que muestra cada pantalla, y lo que no | `modulos/cobros.md` |
| §4duodecies.4 | 4duodecies.4 Lo que este bloque NO hace | `modulos/cobros.md` |
| §4duodecies.5 | 4duodecies.5 El mismo cobro, en una VENTA (23/09/2026) | `modulos/cobros.md` |
| §4terdecies | 4terdecies. Medios entrantes: clasificar, no mirar | `core.md` |
| §4quaterdecies | 4quaterdecies. Recordatorio de solicitud pendiente | `modulos/agenda.md` |
| §4terdecies.1 | 4terdecies.1 Quién entra, y quién no | `modulos/agenda.md` |
| §4terdecies.2 | 4terdecies.2 La marca va ANTES del envío | `modulos/agenda.md` |
| §4terdecies.3 | 4terdecies.3 De dónde salen los dos hechos | `modulos/agenda.md` |
| §4terdecies.4 | 4terdecies.4 Qué cuesta y qué se mide | `modulos/agenda.md` |
| §4terdecies.5 | 4terdecies.5 Lo que este bloque NO hace | `modulos/agenda.md` |
| §4quindecies | 4quindecies. La consola nunca da un mensaje genérico: resalta el campo | `central.md` |
| §4sexdecies | 4sexdecies. Campañas de Meta: texto exacto, vigencia y tope por plan | `modulos/campanas.md` |
| §4sexdecies.1 | 4sexdecies.1 Dónde vive, y por qué un documento | `modulos/campanas.md` |
| §4sexdecies.2 | 4sexdecies.2 El tope por plan, en el servidor | `modulos/campanas.md` |
| §4sexdecies.3 | 4sexdecies.3 La verificación antes de aplicar | `modulos/campanas.md` |
| §4sexdecies.4 | 4sexdecies.4 El flujo | `modulos/campanas.md` |
| §5 | 5. Integración con n8n | `coordinador.md` |
| §5.1 | 5.1 Lo que va en cada sentido | `coordinador.md` |
| §5.2 | 5.2 Cómo escribe n8n sin una credencial compartida entre todos | `coordinador.md` |
| §5.3 | 5.3 Alternativas descartadas para la ingesta | `coordinador.md` |
| §5.4 | 5.4 Cómo consume n8n la configuración | `coordinador.md` |
| §6 | 6. Alta de un cliente en 48 horas | `plataforma.md` |
| §6.1 | 6.1 El procedimiento real, paso por paso | `plataforma.md` |
| §6.2 | 6.2 Lo que sigue siendo manual, por diseño | `plataforma.md` |
| §7 | 7. Estructura del directorio | *(queda en `admin/DISENO.md`)* |
| §8 | 8. Despliegue | *(queda en `admin/DISENO.md`)* |
| §9 | 9. Estado real de la verificación | *(queda en `admin/DISENO.md`)* |
| §10 | 10. Lo que este diseño **no** resuelve | *(queda en `admin/DISENO.md`)* |
| §11 | 11. Lo que Andres tiene que crear en la nube | *(queda en `admin/DISENO.md`)* |
| §12 | 12. Riesgos abiertos | *(queda en `admin/DISENO.md`)* |

Las secciones de nivel 4 (`####`) viajan con su `###`; las subsecciones sin
número (por ejemplo «Por qué una SPA estática…» de §2) viajan con su `##`.

## Cómo citar desde ahora

Documentos nuevos citan el archivo y el bloque: «`docs/arquitectura/central.md`
§4undecies.4». Los documentos viejos no se corrigen en masa: con esta tabla la
cita sigue resolviéndose.
