# Demo local de la pantalla de Conversaciones (estilo WhatsApp Web)

**Datos ficticios, solo en tu máquina.** Es la pantalla real de H1 (`ConversacionesNueva.tsx`) corriendo contra
emuladores locales con un comercio de mentira (31 conversaciones, un hilo de 430 mensajes, dos teléfonos de
dígitos parecidos, dos conversaciones «de antes de H1» sin los campos nuevos). La bandera
`tenants/{id}.consolaConversaciones = 'nueva'` ya viene puesta en la siembra. No se despliega nada ni se usa un dato real.

H1 **no tiene** «Tomar», «Devolver» ni campo para escribir: eso es de H2. Lo único que la pantalla escribe es
«No contactar» y la marca de leída (`noLeidos: 0`, `sinLeer: false`).

## Cómo verlo

Todo con puertos propios (Firestore 8701, Auth 9701, consola 5731), que no chocan con los demás worktrees. Los
comandos se corren desde la carpeta `admin/` del repositorio (o de tu worktree); requiere `pnpm install` hecho allí,
Java y Node 24.

```bash
# 1. Levantar emuladores, sembrar y abrir la consola (deja todo andando en segundo plano)
bash pruebas/central/prototipo-conversaciones/arrancar.sh

# 2. Abrir en el navegador:  http://127.0.0.1:5731/ingresar
#    Correo:      admin.prototipo@ejemplo.com      (operador:  operador.prototipo@ejemplo.com)
#    Contraseña:  Prototipo-2026-ficticia
#    (el ingreso es el normal de la consola contra el emulador de Auth: no hay un modo especial)
#    La pantalla:  http://127.0.0.1:5731/negocio/comercio-prototipo/conversaciones

# Si pasó un rato largo y «ventana por vencer» ya no lo está (la hora corre de verdad): volver a sembrar
bash pruebas/central/prototipo-conversaciones/resembrar.sh

# 3. Apagar todo
bash pruebas/central/prototipo-conversaciones/parar.sh
```

Los registros quedan en `.estado/` (ignorado por git).

## Qué hace de verdad y qué falta en el demo

| Funciona en el demo | No funciona en el demo |
|---|---|
| Lista (primera página de 50 en vivo, «Cargar más») y detalle con scroll propio; últimos mensajes con `limitToLast`; «cargar anteriores» | La búsqueda **por palabra** llama a la Function `buscarConversaciones`, que el demo no levanta (solo Firestore y Auth): muestra «La búsqueda por palabra todavía no está disponible». Funciona en el entorno desplegado. |
| Filtros (Todas, Necesita humano, No leídas, Ventana por vencer) con contadores del servidor | «Necesita humano» sale del estado de atención (`operador`, `bloqueado`) de las últimas 24 h; los pases del modelo llegan en H2 |
| Búsqueda por teléfono (últimos 4, sin prefijo, completo, `00` internacional) y por nombre | |
| Marcar leída al abrir (admin u operador, 1 s después, solo con la pestaña visible) | |
| Anterior / siguiente, `/`, `Esc`, dos vistas en el celular, «No contactar» | |

Las conversaciones `…0066` y `…0096` son «de antes de H1»: no traen ninguno de los campos nuevos. Se ven como leídas,
sin pastilla de ventana, y se hallan por los últimos 4 dígitos igual.

## Hoja de tareas (una página)

Anote el tiempo y las dudas **sin pedir ayuda**. Datos: todo es ficticio; los teléfonos son `591000000NN`.

| # | Tarea | Tiempo | Dudas / dónde se trabó |
|---|---|---|---|
| 1 | **Teléfono.** Halle la conversación del número que termina en **0047** sin escribir el prefijo 591. Luego pruebe `00000047` (sin prefijo) y `+591 000 00047` (pegado). Halle también la del **0074**: ¿se confunden las dos? | ______ | |
| 2 | **Palabra** (solo en el entorno desplegado). Halle el mensaje donde alguien pregunta por la **mazamorra** y llegue a él (queda resaltado). Está lejos del final de un hilo de 430 mensajes. Vuelva a lo último con «Ir a los últimos mensajes». Pruebe también «alfajor»: ¿halla «alfajores»? | ______ | |
| 3 | **No leídas con el teclado.** Con el filtro «No leídas», abra la primera y recorra todas con **Alt+↓** (Alt+↑ vuelve). Use **/** para ir al buscador y **Esc** para volver a la lista. | ______ | |
| 4 | **Celular.** Achique la ventana a menos de ~830 px, o en Chrome `F12` → `Ctrl+Shift+M` (390 px). Abra una conversación, vuelva con «← Conversaciones» y con el botón «atrás»; busque `0047`. ¿Se entiende que son dos vistas? | ______ | |

(La tarea de tomar, devolver y escribir es de H2: todavía no existe.)

**Qué mirar además** (anótelo aunque no sea una tarea): ¿se ve a simple vista cuál conversación necesita
atención?, ¿la ventana de 24 h se entiende?, ¿falta algo que WhatsApp Web sí tiene?
