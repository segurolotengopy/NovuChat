# Tenants: datos de un cliente, nunca código (y su flujo, que sí es propio)

> Zona de la arquitectura por capas (`Analisis/41-arquitectura-por-capas.md`
> §1). Sin secretos ni identificadores.

## Definición

**Datos de un cliente:** configuración, catálogo, variables del prompt,
instrucciones extra verificadas, módulos encendidos. **Nunca código.** Los
cambia el comercio desde su consola y NovuChat desde Plataforma.

Ejemplos: `config/*`, `catalogo`, `funcionarios`,
`Flujos/prompts/tenants/<t>.vars`, `CLIENTES/<T>/`.

**Dependencias:** los tenants no dependen de código. Nada depende de un tenant.

**Decisión del 25/09 (`Analisis/41` §6.1.5), reconciliada el 09/10/2026:** los
**datos** de un tenant nunca son código, y nada del código común lleva un texto
o un nombre de cliente. Lo que cambia es el flujo: ya no se obliga a que toda
necesidad de un cliente nazca como módulo con bandera desde la primera vez.
**Cada cliente tiene su flujo propio**, en `Flujos/clientes/<tenant>/`, y es
una zona aparte de la de los datos (fila «Flujo de cliente» de `CLAUDE.md`).

## El flujo de un cliente (Andres, 09/10/2026)

- **Composición propia + núcleo común obligatorio.** El flujo se compone de las
  piezas propias del cliente, declaradas en `Flujos/clientes/<tenant>/` (cada
  una con su `PROPIO.md`, que declara también los mensajes por conversación que
  agrega o quita), más el **núcleo común obligatorio**: sesión por
  `messages[0].from`, filtro de eventos, conteo, candado por hecho, rótulos de
  cobro, `NIEGA_IA`, aviso con botón, uso extendido y comercio no operativo.
- **El núcleo se INCLUYE desde core y módulos y nunca se copia.** Una prueba de
  CI comparará byte a byte lo incluido contra su fuente. **Esa prueba no
  existe todavía:** se construye en un PR posterior y, hasta que esté en verde,
  es una compuerta futura, no una garantía.
- **La segunda vez que otro cliente pide una pieza propia, esa pieza pasa a
  módulo** (con bandera, para todos).
- **Seguridad y protección valen para todos sin excepción.**
- **Barridos comunes:** un barrido por tipo de flujo que recorre los tenants (no
  uno por cliente) es la excepción declarada a «flujo propio»; son más de la
  mitad de las ejecuciones de n8n.
- **Rubén Roca** es un solo tenant con 4 flujos (dos tipos: citas y ventas),
  no cuatro tenants ni un tenant colgado de otro. Antes de portar su entrada se
  consulta a WhatsApp-Modular si el receptor puede enrutar por número (hoy
  enruta por WABA).
- **El JSON publicado** de un flujo de cliente (`Flujos/<tenant>.json`) sigue
  siendo salida de construcción: se ensambla de las piezas propias más el
  núcleo, con cabecera «generado, no editar» y gancho de pre-commit que exige
  `verificar`. Hoy Bellido es fuente (19 nodos propios); deja de serlo en F5,
  cuando pasan al módulo Menú interactivo (texto de la decisión del 25/09, que
  este documento no toca). `Flujos/clientes/` aún no existe: la mudanza
  (incluida la de `Flujos/experimental/`) es de un PR posterior.
- **DECISIÓN PENDIENTE:** qué agente es dueño de `Flujos/clientes/<tenant>/` y,
  por tanto, qué zona de escritura recibe (`agentes.md`).

## Inventario (`Analisis/41` §5)

| Pieza | Zona | Cambio |
|---|---|---|
| `config/negocio` | Tenant, documento de Central | Sale `calendarioId` hacia `config/agenda` (migración por script, seis tenants) |
| `config/agendamiento`, `config/venta` | Tenant, documentos de módulo | `config/agenda`, `config/pedidos`, `config/cobros` con lista blanca por manifiesto |
| `config/marca`, `config/onboarding`, `config/campanas` | Tenant, documentos de módulo | `marca` pasa a Catálogo web; los otros quedan |
| `Flujos/prompts/reservas/demo-a.md`, `platinum.md` (201 y 202 líneas, 23 distintas) | Core + Agenda + Tenant | El tenant solo aporta variables (nombres, ejemplos del rubro, duración) en `prompts/tenants/<t>.vars` |
| `Flujos/<tenant>.json` | Salida de construcción | Generado del registro, los módulos encendidos, las piezas propias de `Flujos/clientes/<tenant>/` y el núcleo común incluido |
| `cargar-negocio`, `cargar-captacion`, `cargar-fotos-catalogo`, `citas-a-calendario`, `catalogo-demo` | Scripts que cargan datos | `admin/scripts/datos/` bajo `tenants/` |
| `pruebas/tenants/<t>/` | Pruebas de instancia | «Este tenant tiene estos módulos con esta configuración»; `platinum-flujo` y `bellido-flujo` se reparten entre módulos (F5) |

## Los tres ejes de la cuenta son datos del tenant

Plan, modalidad y titularidad (`Analisis/41` §4) se asignan solo desde
Plataforma y se leen desde Central y el conector de canal. El modelo de IA
(`tenants/{t}.modelo`) es una decisión de NovuChat por tenant.

## La carpeta `CLIENTES/<T>/`

Está ignorada por git y vive en la copia base, no en un worktree. Su estructura
obligatoria (cumplimiento, ficha, pedidos y solicitudes, estado, aceptación,
pase, anexo particular, guía de Meta) está en `docs/clientes/CICLO-DE-VIDA.md`
(`Analisis/41` §12.8).

## Versiones por tenant

`docs/versiones-por-cliente.md` declara, por flujo publicado, la excepción y su
porqué; `scripts/estado-de-versiones.sh` falla si hay un atraso sin declarar.
Con F5 pasa a informar versión de módulo por tenant.
