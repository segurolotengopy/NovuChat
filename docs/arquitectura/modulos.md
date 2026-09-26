# Módulos: lo que se enciende por tenant

> Zona de la arquitectura por capas (`Analisis/41-arquitectura-por-capas.md`
> §1 y §3). Este archivo define la zona y el **manifiesto de módulo**; cada
> módulo tiene su propio archivo en `modulos/`. Sin secretos ni identificadores.

## Definición

**Lo que se enciende por tenant, con su manifiesto, y que cualquier tenant
puede combinar.** Lo cambia NovuChat, un módulo a la vez, con una versión.

Los módulos: Productos, Agenda, Pedidos, Cobros, Inventario, Campañas,
Catálogo web, Captación, Menú interactivo.

**La prueba de ubicación** (`Analisis/41` §1.3): es módulo lo que «se enciende
o apaga por tenant, o tiene un límite por plan».

**Dependencias permitidas:** un módulo depende de otro solo si el manifiesto lo
declara (grafo acíclico), de Central (servicios) y de Core (contratos, canal,
seguridad).

**Vocabulario:** *módulo* reemplaza a *vertical*. El sistema de hoy está
ordenado por vertical (agendamiento, venta, onboarding): un paquete indivisible
de flujo n8n + documento `config/{vertical}` + pestañas + ramas en Functions +
prompt. La arquitectura ordena por quién es dueño de cada pieza y cuánto varía.

## El manifiesto de módulo (`Analisis/41` §3.1)

Es la unidad de la arquitectura. Cada módulo es una carpeta en cada runtime
(`admin/functions/src/modulos/<m>/`, `admin/web/src/modulos/<m>/`,
`Flujos/src/modulos/<m>/`, `admin/pruebas/modulos/<m>/`) y una entrada en el
registro (`registro.md`). El esquema:

```
modulo:        agenda
version:       1                      ← se declara en docs/versiones-por-cliente.md por tenant
dependeDe:     []                     ← acíclico; el coordinador lo ordena
configuracion:
  documento:   config/agenda          ← una lista blanca de campos por módulo
  campos:      [calendarioId, duracionMin, recordatorios, senaActiva, ...]
colecciones:   [funcionarios, funcionarios/privado, agenda]
limites:
  agendas:     { plan: 'agendas', hacerCumplir: 'reglas', contador: 'contadores/agendas' }
pestanas:      [{ ruta: 'agenda', titulo: 'Agenda', roles: ['admin'] }]
tablero:       [ranura 'citasDeHoy']  ← lo que aporta al Tablero central
prompt:        Flujos/prompts/modulos/agenda.md
herramientas:  [consultar_disponibilidad, agendar_cita, buscar_mi_cita, cancelar_cita]
nodos:         Flujos/src/modulos/agenda/*.js   ← lo que queda en n8n
ganchos:       { antesDelTurno, despuesDelTurno, alCierre, programado }
mensajes:      0                      ← los que agrega por conversación; se declara siempre
pruebas:       admin/pruebas/modulos/agenda/
```

Cada archivo de `modulos/` lleva este manifiesto en prosa, con lo que el módulo
es hoy.

## Los módulos, con lo que hoy son (`Analisis/41` §3.2)

| Módulo | Archivo | Depende de | Límite por plan |
|---|---|---|---|
| Productos | `modulos/productos.md` | — | productos (20 / 100 / 500) |
| Agenda | `modulos/agenda.md` | Cobros (solo para la seña) | agendas (1 / 5 / 10), hoy sin hacer cumplir |
| Pedidos | `modulos/pedidos.md` | Productos | — |
| Cobros | `modulos/cobros.md` | Pedidos o Agenda (quien cierra) | — |
| Inventario | `modulos/inventario.md` | Productos | — |
| Campañas | `modulos/campanas.md` | — | campañas (0 / 3 / 10) |
| Catálogo web | `modulos/catalogo-web.md` | Productos, Pedidos | — |
| Captación | `modulos/captacion.md` | — | — |
| Menú interactivo | `modulos/menu-interactivo.md` | — | — |

Lo que **no** es módulo aunque se parezca: medios entrantes (core); tipo de
cambio, saneo, firma, dibujo de QR, cotejo de texto (servicios: tipo de cambio y
saneo en Central, firma en Core, dibujo y cotejo dentro de Cobros); prepago,
pagos, cobrador, cobranza (Central, pestaña Pagar; nunca «Cobros»).

## Cómo nace un módulo nuevo (`Analisis/41` §9)

Un módulo nuevo es una carpeta y una línea en el registro. `registro.test.ts`
obliga a que traiga reglas con prueba negativa, manifiesto completo y
declaración de mensajes. Lo que un cliente necesita y no existe nace como
módulo con bandera, para todos; **un tenant nunca posee código**.

## Ganchos que un módulo puede registrar (`Analisis/41` §2.3)

| Gancho | Cuándo corre | Quién lo usa hoy, aunque no se llame así |
|---|---|---|
| `antesDelTurno(contexto)` | Al armar el contexto | Campañas (recorta al tope), Captación (rubros y planes), Catálogo (resumen al prompt) |
| `despuesDelTurno(reporte)` | Al recibir el reporte | Seña (retención), Inventario (descuento), Cobros (cotejo), Campañas |
| `alCierre(cierre)` | Con `registrarCierre` | Agenda (cita), Pedidos (venta) |
| `alCambiarConfig(doc)` | Disparador de Firestore | Comportamiento, Campañas (verificación) |
| `programado(cron)` | Tareas | Agenda (recordatorios, seguimientos, señas vencidas), Cobros del prepago |
