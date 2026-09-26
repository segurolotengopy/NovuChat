# Tenants: datos de un cliente, nunca código

> Zona de la arquitectura por capas (`Analisis/41-arquitectura-por-capas.md`
> §1). Sin secretos ni identificadores.

## Definición

**Datos de un cliente:** configuración, catálogo, variables del prompt,
instrucciones extra verificadas, módulos encendidos. **Nunca código.** Los
cambia el comercio desde su consola y NovuChat desde Plataforma.

Ejemplos: `config/*`, `catalogo`, `funcionarios`,
`Flujos/prompts/tenants/<t>.vars`, `CLIENTES/<T>/`.

**Dependencias:** los tenants no dependen de código. Nada depende de un tenant.

**Decisión fijada el 25/09** (`Analisis/41` §6.1.5): un tenant nunca posee
código. Lo que un cliente necesita y no existe nace como módulo con bandera. El
JSON de un tenant (`Flujos/<tenant>.json`) es **salida de construcción**: sigue
versionado porque `publicar-flujo.sh` lo necesita, con cabecera «generado, no
editar» y gancho de pre-commit que exige `verificar`. Hoy Bellido es fuente
(19 nodos propios); deja de serlo en F5, cuando pasan al módulo Menú
interactivo.

## Inventario (`Analisis/41` §5)

| Pieza | Zona | Cambio |
|---|---|---|
| `config/negocio` | Tenant, documento de Central | Sale `calendarioId` hacia `config/agenda` (migración por script, seis tenants) |
| `config/agendamiento`, `config/venta` | Tenant, documentos de módulo | `config/agenda`, `config/pedidos`, `config/cobros` con lista blanca por manifiesto |
| `config/marca`, `config/onboarding`, `config/campanas` | Tenant, documentos de módulo | `marca` pasa a Catálogo web; los otros quedan |
| `Flujos/prompts/reservas/demo-a.md`, `platinum.md` (201 y 202 líneas, 23 distintas) | Core + Agenda + Tenant | El tenant solo aporta variables (nombres, ejemplos del rubro, duración) en `prompts/tenants/<t>.vars` |
| `Flujos/<tenant>.json` | Salida de construcción | Generado del registro más los módulos encendidos |
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
