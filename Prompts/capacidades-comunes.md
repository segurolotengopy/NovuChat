# Capacidades comunes en todos los flujos — el error de arquitectura del 25/09/2026

> **TENANT de verificación:** el flujo conversacional sobre el que se prueba cada
> bloque con teléfono real. Andres lo indica al lanzar la sesión; su
> configuración vive en la consola y en `CLIENTES/<TENANT>/`. Es una instancia:
> nada de lo que se construye acá se nombra por un cliente ni por un vertical.

Eres la sesión coordinadora de un frente **urgente**: **una capacidad general
de NovuChat —audio, imagen, documento— existe solo en algunos flujos, y ningún
control lo detectó**. Andres lo calificó de error de arquitectura, no de un
cliente: **audio e imágenes son funcionalidades GENERALES de NovuChat, no de un
flujo ni de un vertical**. Tienes su OK para leer los demás directorios del
proyecto y hacer los ajustes. Publicar flujos, desplegar Functions y todo lo que
escribe en producción, n8n o GitHub sigue necesitando su «sí» en el chat.

Lee primero, en este orden: `CLAUDE.md` entero, `ESTADO.md` (la entrada del
25/09 y la del 24/09 sobre el registro de versiones), `CONFIGURACION.md`, y
después:

- `docs/versiones-por-cliente.md` y `scripts/estado-de-versiones.sh`: el
  registro que NO vio este problema, y por qué (ver «El hecho»).
- `Flujos/LEEME-flujos.md` §0, `Flujos/manifiestos/`, `Flujos/src/comun/`,
  `Flujos/src/reservas/` y `admin/scripts/ensamblar-flujo.mjs`: la
  modularización que ya existe y dónde quedó cada módulo.
- `Prompts/modularizacion-flujos.md` y las memorias `modularizacion-*`: el
  frente anterior, cuyas decisiones siguen vigentes.
- `Prompts/sena-seguimiento-medios.md` y `Analisis/34` §3.1 y §4.1: cómo se
  diseñaron los medios entrantes (bloque 3 de Platinum, 18/09).
- `admin/pruebas/platinum-flujo.test.ts` («Preparar transcripción», «Preparar
  imagen», cableado de la rama de medios) y `admin/pruebas/demo-b-*.test.ts`.

## El hecho (verificado el 25/09/2026, no rediscutir)

1. **Prueba de Andres en el Demo B (venta), ejecuciones de n8n:** `#5897`
   comprobante → cierre de venta registrado (el arreglo de `v0.9.0` funciona);
   `#5903` imagen → «No puedo abrir imágenes»; `#5907` nota de voz → «No puedo
   escuchar notas de voz».
2. **No es una regresión: el Demo B NUNCA tuvo esa capacidad.** Las 12
   versiones de `Flujos/demo-b-venta-cobro.json` (08/09 a 23/09) no tienen
   nodos de medios. Su `Normalizar entrada` ni siquiera extrae el `mediaId` de
   un audio (solo `image` y `document`), y no calcula `esMedioAudio` ni
   `esMedioVisual`.
3. **Quién la tiene:** Platinum, Bellido y Demo A (reservas) tienen la rama
   general: `¿Es un comprobante?`[falso] → `¿Trae un medio?` → `Obtener URL del
   medio (general)` → `Descargar medio` → `¿Es audio?` → `Transcribir audio` →
   `Preparar transcripción` → agente; o `¿Es un documento?` → `Describir
   documento` / `Describir imagen` → `Preparar imagen` → agente. **La captación
   de NovuChat (`novuchat-onboarding.json`) no tiene nada**: ni `mediaId`, ni
   `mimeType`, ni la rama.
4. **La causa de arquitectura:** `normalizar-entrada.js` está en
   `Flujos/src/comun/`, pero `preparar-transcripcion.js` y `preparar-imagen.js`
   quedaron en `Flujos/src/reservas/`, y el clasificador de imágenes tiene
   categorías de clínica (`boca_o_dientes`, `documento_salud`). Una capacidad
   general quedó escrita como si fuera de un vertical.
5. **Por qué ningún control lo vio:** `estado-de-versiones.sh` compara cada
   flujo vivo con SU PROPIO JSON. Un flujo al día con un JSON al que le falta
   una capacidad común sale en verde. No existe una definición de «lo que todo
   flujo conversacional tiene que tener», ni una prueba que la exija.
6. **Hallazgo parcial de la revisión que se cortó** (sin verificar, hay que
   confirmarlo): en los flujos de reservas, la prohibición 4 (nunca negar ser
   una IA) depende solo del prompt, sin respaldo en código. Revisarlo dentro de
   la matriz del bloque 0.

## Las decisiones que no se tocan

1. **Audio, imagen y documento son capacidades generales.** Todo flujo
   conversacional las tiene, salvo excepción declarada en
   `docs/versiones-por-cliente.md` con qué, por qué y qué la cierra.
2. **El agente nunca ve el medio** (`Analisis/34`): el binario muere en el nodo
   que lo lee y al agente le llega texto. Lo leído en una imagen es dato no
   confiable: entre comillas, rotulado, sin corchetes.
3. **Lo que cambia por vertical son las categorías y los avisos**, no la rama.
   La clínica no diagnostica; la tienda compara con su catálogo; la captación
   registra la ficha. Eso va en configuración o en un módulo por vertical que
   la rama común llama, nunca en una copia de la rama.
4. **Cobro:** la rama de medios no toca el comprobante. En venta, un archivo
   con QR pendiente sigue yendo a `¿Es un comprobante?`, como hoy.
5. **La unidad de costo son los mensajes por conversación.** Convertir un medio
   en texto **no agrega mensajes**: el cliente ya recibía una respuesta, ahora
   útil. Gemini de transcripción y clasificación es el 6 % del costo; no se
   optimiza a costa de la capacidad.
6. **Todo lo demás de `CLAUDE.md`** —candado por hecho, solo se ofrece lo que
   se cumple, orden de ramas del lienzo, memoria por teléfono— sigue igual.

## Reutilizar antes de escribir

**Consulta primero `~/Claude-Proyectos/proyectos/`** y di en el chat si algún
proyecto ya resolvió «capacidades mínimas por tipo de flujo» o un contrato de
nodos comunes. La rama de medios ya existe en reservas: se mueve a `comun`, no
se reescribe. Las rutas de otros proyectos las da Andres y se leen solo como
referencia.

## Cómo trabajar

- Worktree y rama propios dentro de `.claude/worktrees/`, **creados desde
  `origin/main`**; un PR por bloque; nunca cambiar de rama en `~/NovuChat` ni
  `git add -A`. `admin/` se instala con **pnpm**.
- Andres autoriza; tú operas. Nunca le pases comandos. La etiqueta de
  despliegue la crea él, con `scripts/etiquetar-version.sh vX.Y.Z --commit
  <sha>` (buscar en `scripts/` antes de dar cualquier comando).
- **Publicar solo desde `origin/main`**, con el diagnóstico en seco de
  `publicar-flujo.sh` leído entero; **ensayar primero en el número del Demo A**
  (memoria `ensayo-antes-de-produccion`). Ningún comercio está en modalidad
  producción, así que la ventana de 02:00 a 03:00 no condiciona, pero verifícalo.
- Cada cambio declara mensajes por conversación y qué prueba lo cubre.
- Resultado REAL con teléfono: audio, foto de producto, PDF y foto sin contexto,
  en cada flujo tocado. El 25/09 un «funciona» sin prueba real fue lo que dejó
  esto afuera.

## Reparto entre agentes

| Agente | Tipo | Qué hace | Cuándo |
|---|---|---|---|
| Matriz | `general-purpose` | La matriz del bloque 0, solo lectura | Primero, en paralelo con Salud |
| Salud | `general-purpose` | Errores de n8n y Functions desde los despliegues de `v0.8.0` y `v0.9.0`; medios de reservas funcionando después de `v0.8.0` | Primero |
| Flujos | `flujos-n8n` | Portar la rama y ensamblar | Bloques 2 y 3 |
| Seguridad | `seguridad` | Revisa cada PR (texto leído en imagen = entrada no confiable) | Antes de cada OK de fusión |

**Regla de integración:** el bloque 1 (la definición y su prueba) va a `main`
antes que cualquier port, y **falla** en `main` mientras falten los ports. Nada
se publica en n8n sin el bloque 1 en verde para ese flujo.

## Qué construir, por bloques

### Bloque 0 — La matriz y la salud (media jornada, solo lectura)
Matriz de capacidades de los 5 flujos conversacionales (Demo A, Platinum,
Bellido, Demo B, captación): medios; normalización de todos los tipos de
entrada; memoria por teléfono; filtro de eventos; fecha, hora y día en código;
solo se ofrece lo que se cumple (botón a recepción); candado; umbrales antes del
agente y orden de «Reportar mensaje (entrante)»; cobro; campañas; suspensión y
prepago; prohibición 4. Por celda: presente / ausente / parcial, con nodo y
línea. Por brecha: regresión (`git log -p` desde el 15/09) o nunca existió.
**Entregar en el chat antes de abrir la primera rama.**

### Bloque 1 — Lo que todo flujo conversacional tiene que tener (1 jornada)
Rama `flujos/capacidades-comunes`. Una definición versionada de las
capacidades comunes (nodos y cableado obligatorios por flujo conversacional) y
una suite que **falla** si un flujo del registro no las tiene y no hay
excepción declarada. `estado-de-versiones.sh` la corre además de comparar vivo
contra versionado. **Costo:** 0 mensajes.

### Bloque 2 — Los medios pasan a `comun` (1 jornada)
Rama `flujos/medios-comunes`. `preparar-transcripcion.js` y la rama pasan a
`Flujos/src/comun/`; las categorías y avisos del clasificador salen a un módulo
por vertical (reservas: los de hoy, sin cambio de texto; venta: producto,
promoción, comprobante sin cobro pendiente, otro; captación: lo que sirva a la
ficha). El `Normalizar entrada` del Demo B y el de captación reconocen `audio`
y `voice`. Reservas queda byte a byte igual (ensamblar y comparar huellas).
**Costo:** 0 mensajes.

### Bloque 3 — Demo B y captación con medios, publicados (1 jornada)
Ports ensamblados, suites, ensayo en el Demo A, diagnóstico en seco, OK de
Andres, publicación desde `main` y prueba real en cada uno. Filas de
`docs/versiones-por-cliente.md` al día. **Costo:** 0 mensajes.

### Bloque 4 — Las demás brechas de la matriz
Por orden de impacto para un cliente real, un PR por brecha.

## Lo que NO se construye ahora (y por qué)
- **Un flujo único para todos los clientes:** `Analisis/20`; lo cierra Tech
  Provider, no este frente.
- **Que el agente vea el medio directamente:** decisión de `Analisis/34`.
- **Cambiar los textos de reservas:** Platinum y Bellido están probados con
  ellos; moverlos de carpeta no es cambiarlos.

## Pendiente heredado de la sesión del 24-25/09 (no perderlo)
- **PR #182** (`estado/v0.9.0`): entrada de `ESTADO.md` de `v0.9.0` y este
  prompt. Fusionar con el OK de Andres.
- **En producción desde el 25/09:** `v0.9.0` (`061e20b`): `tipoCambioBcb`
  (07/13/19 h La Paz; corrida forzada «igual»), `registrarCierre` cierra el QR
  de una venta simulada (probado por Andres: `#5903` ya no cuenta como pago),
  rechazos de campañas genéricos. TCO 12,22 del 25/09 cargado a mano.
- **Tope de campañas 0 / 3 / 10 (BYOC 10):** ya lo exigen las reglas;
  Andres no lo confirmó expresamente.
- **Demo B y los 7 flujos restantes:** al día con su JSON según
  `estado-de-versiones.sh` (25/09).

## Entregables al cerrar
- La matriz del bloque 0 en el chat y en `Analisis/` si Andres lo pide.
- Un PR por bloque, con costo declarado, pruebas y resultado real con teléfono.
- `docs/versiones-por-cliente.md` al día; `ESTADO.md`; la ficha de NovuChat en
  `~/Claude-Proyectos/proyectos/` (cambia un módulo reutilizable).
