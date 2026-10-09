# Prototipo de la pantalla de Conversaciones (estilo WhatsApp Web)

**PROTOTIPO, datos ficticios.** Es H1 completo de `NOVUCHAT_plan-pantalla-conversaciones-y-toma_2026-10-09.md`
para que Andres lo use antes de implementar el resto. Corre contra emuladores locales con un comercio de
mentira (31 conversaciones, un hilo de 430 mensajes, dos teléfonos de dígitos parecidos). **Tomar, Devolver y
escribir son una simulación**: no envían nada, no llaman a ninguna Function y no escriben en la base. No se
despliega ni usa un dato real. La rama es `central/prototipo-conversaciones`; no tiene PR.

## Cómo verlo

Todo con puertos propios (Firestore 8701, Auth 9701, consola 5731), que no chocan con los demás worktrees.

```bash
# 1. Levantar emuladores, sembrar y abrir la consola (deja todo andando en segundo plano)
bash "$HOME/NovuChat/.claude/worktrees/agent-a654750b207a1bc0a/admin/pruebas/central/prototipo-conversaciones/arrancar.sh"

# 2. Abrir en el navegador:  http://127.0.0.1:5731/ingresar
#    Correo:      admin.prototipo@ejemplo.com      (operador:  operador.prototipo@ejemplo.com)
#    Contraseña:  Prototipo-2026-ficticia
#    (el ingreso es el normal de la consola contra el emulador de Auth: no hay un modo especial)
#    La pantalla:  http://127.0.0.1:5731/negocio/comercio-prototipo/conversaciones

# Si pasó un rato largo y «ventana por vencer» ya no lo está (la hora corre de verdad): volver a sembrar
bash "$HOME/NovuChat/.claude/worktrees/agent-a654750b207a1bc0a/admin/pruebas/central/prototipo-conversaciones/resembrar.sh"

# 3. Apagar todo
bash "$HOME/NovuChat/.claude/worktrees/agent-a654750b207a1bc0a/admin/pruebas/central/prototipo-conversaciones/parar.sh"
```

Los registros quedan en `.estado/` (ignorado por git). Requiere `pnpm install` hecho en `admin/`, Java y
Node 24. «Reiniciar simulación» (arriba en la pantalla) borra lo tomado, leído y escrito en el navegador.

## Qué es de verdad y qué es simulado

| Real (como será) | Simulado en este prototipo |
|---|---|
| Lista y detalle con scroll propio; últimos mensajes con `limitToLast`; «cargar anteriores» | Tomar / Devolver (estado local del navegador) |
| Filtros, contadores, ventana de 24 h por vencer, orden por último mensaje | Marcar como leída al abrir (local) |
| Búsqueda por teléfono, nombre y palabra, con salto al mensaje (`?m=`) | Enviar: guarda el texto en el navegador y dice «Simulación: no se envió» |
| Anterior / siguiente, `/`, `Esc`, dos vistas en el celular | |
| «No contactar» (ya existía y las reglas ya lo permiten) | |

## Hoja de tareas (una página)

Anote el tiempo y las dudas **sin pedir ayuda**. Datos: todo es ficticio; los teléfonos son `591000000NN`.

| # | Tarea | Tiempo | Dudas / dónde se trabó |
|---|---|---|---|
| 1 | **Teléfono.** Halle la conversación del número que termina en **0047** sin escribir el prefijo 591. Luego pruebe `00000047` (sin prefijo) y `+591 000 00047` (pegado). Halle también la del **0074**: ¿se confunden las dos? | ______ | |
| 2 | **Palabra.** Halle el mensaje donde alguien pregunta por la **mazamorra** y llegue a él (queda resaltado). Está lejos del final de un hilo de 430 mensajes. Vuelva a lo último con «Ir a los últimos mensajes». Pruebe también «alfajor»: ¿halla «alfajores»? | ______ | |
| 3 | **No leídas con el teclado.** Con el filtro «No leídas» (hay 11), abra la primera y recorra todas con **Alt+↓** (Alt+↑ vuelve). Use **/** para ir al buscador y **Esc** para volver a la lista. | ______ | |
| 4 | **Celular.** Achique la ventana a menos de ~830 px, o en Chrome `F12` → `Ctrl+Shift+M` (390 px). Abra una conversación, vuelva con «← Conversaciones» y con el botón «atrás»; busque `0047`. ¿Se entiende que son dos vistas? | ______ | |
| 5 | **Tomar y devolver (simulación).** Abra «Rolando C.» (necesita humano): **Tomar la conversación**, escriba un mensaje, vea «Simulación: no se envió», y **Devolver al asistente**. ¿Está claro qué haría de verdad cada botón? | ______ | |

**Qué mirar además** (anótelo aunque no sea una tarea): ¿se ve a simple vista cuál conversación necesita
atención?, ¿la ventana de 24 h se entiende?, ¿falta algo que WhatsApp Web sí tiene?

## Fuera de la zona Central (decisiones para la coordinadora)

- `admin/web/src/App.tsx` solo declara `/negocio/:tenantId/conversaciones`. El prototipo lleva la conversación
  en `?c=<id>&m=<mensaje>`. La ruta del plan (`/conversaciones/:c?m=`) pide cambiar esa línea a
  `/negocio/:tenantId/conversaciones/:conversacionId?` y poner `CONVERSACION_EN_LA_RUTA = true` en
  `web/src/central/lib/conversaciones.ts`: la pantalla ya lee las dos formas.
- `admin/vitest.config.ts`: `pruebas/central/conversaciones-logica.test.ts` es pura; hay que agregarla a
  `SUITES_PURAS` (mientras tanto corre en el proyecto `emulador`, que también la pasa).
- `admin/pruebas-navegador/conversaciones.spec.ts` prueba la pantalla de antes (`ol.hilo li`, botones por
  teléfono) y habrá que reescribirla al implementar H1.
