# Modularización de los flujos — el código y los prompts salen del JSON

> **TENANT de verificación:** el cliente cuyo flujo se usa para comprobar que
> lo ensamblado es idéntico a lo que hoy corre. Andres lo indica al lanzar la
> sesión; su ficha vive en `CLIENTES/<TENANT>/`. Es una instancia: nada de lo
> que se construye acá se nombra por un cliente.

Eres la sesión coordinadora de un frente de trabajo: **sacar el JavaScript y los
prompts de los nodos de los JSON de `Flujos/` y llevarlos a módulos
versionados, con un ensamblador que vuelve a producir los JSON**. Hoy cada
cliente nuevo congela una copia del código común, y la copia ya es literal: el
código de los nodos de `platinum-agendamiento.json` y de
`demo-a-agendamiento.json` tiene la misma huella. El diagnóstico está en las
memorias `modularizacion-sacar-codigo-de-los-json` y
`modularizacion-plan-por-etapas` del proyecto; este prompt lo ejecuta.

**Esto no cambia ningún comportamiento**, no despliega Functions y no republica
nada en n8n. Si al terminar un bloque algo del producto se comporta distinto, el
bloque está mal.

Lee primero, en este orden: `CLAUDE.md` entero (prohibiciones, Base comercial,
§7, Flujo de trabajo), `ESTADO.md`, `CONFIGURACION.md`, y después:

- `Flujos/LEEME-flujos.md` §0 — **por qué se retiró el generador de flujos en agosto de 2026**. Es la objeción más seria a este frente y hay que responderla antes de escribir código, no después.
- `Analisis/20-un-flujo-para-todos-los-clientes.md` §5 — la disciplina que sostiene un flujo por cliente: «un cambio se aplica a todos o a ninguno».
- `admin/scripts/sincronizar-flujo-cliente.mjs` y `admin/scripts/portar-prompt-cliente.py` — cómo se replica hoy un cambio del vertical a cada cliente.
- `docs/alta-cliente/RUNBOOK.md`, etapa 5, y `.claude/agents/flujos-n8n.md` — el procedimiento y el agente que quedan afectados.
- `admin/pruebas/candado-agenda.test.ts` (cabecera) — la deuda ya declarada: hoy las suites ejecutan el código sacado del JSON con `new Function` porque no hay un `.js` que importar.

## Bloque 0 — Verifica el diagnóstico antes de construir (media jornada)

Las memorias se escribieron el 19/09/2026 y este frente puede haber cambiado de
tamaño o de sentido. **Empieza midiendo, no construyendo**, y di en el chat qué
encontraste antes de abrir la primera rama:

1. Cuántos flujos hay en `Flujos/`, cuánto JavaScript vive dentro de cada uno y
   cuántos nodos Code tiene cada uno.
2. Si el código de los flujos de cliente sigue siendo idéntico al de su
   vertical, comparando la huella del código concatenado de los nodos Code.
3. Cuántas suites de `admin/pruebas/` ejecutan código extraído del JSON.
4. Si `Flujos/LEEME-flujos.md` §0 sigue diciendo lo mismo, y si alguien ya
   empezó algo parecido en otra rama.
5. Qué hay en vuelo: etiquetas esperando aprobación y flujos pendientes de
   publicar. **Si hay un despliegue acoplado a publicar flujos, este frente no
   empieza hasta que cierre** ([[publicar-solo-desde-main]] en la memoria).

Si los números bajaron o el problema se resolvió de otra forma, **dilo y
proponé cerrar el frente**. Si subieron, sigue con el bloque 1.

## Las decisiones que no se tocan

1. **El JSON sigue siendo lo que se importa a n8n y lo que se versiona.** No se
   cambia la topología, ni los nombres de nodo, ni las conexiones, ni el
   `webhookId`. `publicar-flujo.sh`, `preparar-import.sh`, `verificar-saneo.sh`
   y `sembrar-demos.mjs` buscan nodos por nombre y **no se tocan**.
2. **El ensamblador no es el generador que se retiró.** Aquel producía la
   topología desde Python y divergía del lienzo. Este solo inyecta el contenido
   de los nodos Code y de los prompts, y viene con su operación inversa: un
   `extraer` que trae a los módulos lo que alguien editó en n8n y exportó. La
   justificación se escribe en `Flujos/LEEME-flujos.md` §0, en el mismo PR.
3. **Criterio de aceptación, mecánico y por bloque:** ensamblar reproduce cada
   JSON **byte a byte**, las suites de `admin/pruebas/` pasan **sin tocarlas**, y
   `verificar-saneo.sh` no tiene hallazgos. Si el resultado no es idéntico, no se
   fusiona.
4. **Ningún secreto y ningún valor real en los módulos.** Lo que hoy es
   `REEMPLAZAR_*` sigue siéndolo; las formas que bloquean el repositorio público
   valen igual en un `.js` que en un JSON.
5. **Cero mensajes agregados o quitados por conversación**, en todos los
   bloques. Se declara en cada PR igual que siempre.
6. **Nada se publica en n8n en este frente.** El primer cliente que reciba un
   flujo ensamblado lo hace por el camino de siempre, desde `main` y con el «sí»
   de Andres.
7. **Andres autoriza; tú operas.** Nada en producción, n8n, Meta o GitHub sin
   su «sí» en el chat. Nunca le pases comandos para que los corra.

## Reutilizar antes de escribir

**Consulta primero `~/Claude-Proyectos/proyectos/`**, la ficha de cada proyecto
de Andres con sus módulos reutilizables; la de este proyecto es `novuchat.md`.
Si algo de lo que vas a construir ya existe ahí, dilo en el chat antes de
escribirlo. **No busques por el disco ni leas otros proyectos por tu cuenta:**
pídele a Andres las rutas exactas y léelas solo como referencia. La prohibición
5 de `CLAUDE.md` marca lo que no se toca nunca.

## Cómo trabajar

- Worktree y rama propios; un PR por bloque contra `main`. Nunca cambiar de rama
  en `~/NovuChat` ni `git add -A`: hay otras sesiones trabajando ahí.
- Cada PR declara los mensajes que agrega o quita y qué prueba lo cubre.
- Revisión del agente `seguridad` antes de pedir el OK de fusión.
- `ESTADO.md` al cerrar cada bloque, con el resultado **real**.
- Si un bloque destapa una falla del procedimiento, se corrige el runbook, no
  solo la memoria.

## Cómo repartir el trabajo entre agentes

| Agente | Tipo | Qué hace | Cuándo |
|---|---|---|---|
| **Diseño** | `Plan` | Decide la forma de los módulos y del ensamblador: qué es común, qué es del vertical, qué es del cliente, cómo se marcan los puntos de inyección, y cómo convive con los nodos propios de un cliente y con `--base` del sincronizador | Primero, solo |
| **Extracción** | `flujos-n8n` | Los bloques 1 y 2: ensamblador, `extraer`, y la extracción vertical por vertical con la prueba de identidad | Después del diseño |
| **Pruebas** | `general-purpose` | Las suites dejan de usar `new Function` y pasan a importar los módulos, sin perder un solo caso; la prueba de identidad entra en la CI y en el gancho de pre-commit | En paralelo con la extracción, sobre el contrato acordado |
| **Corpus** | `general-purpose` | El bloque 3: el corpus del sitio deja de ser un literal dentro de un nodo | Cuando el bloque 1 esté en `main` |
| **Seguridad** | `seguridad` | Revisa cada PR: ningún valor real en los módulos, el saneo sigue detectando un export sin sanear, el `new Function` de las pruebas desaparece o queda justificado | Antes de cada OK de fusión |

**Regla de integración:** nada se fusiona mientras la prueba de identidad no
pase para **todos** los flujos, incluidos los de cliente. Un solo JSON que no se
reproduzca byte a byte detiene el frente: significa que el ensamblador perdió
algo que hoy corre en producción.

## Qué construir, por bloques

### Bloque 1 — El ensamblador y un vertical (2 jornadas)
Rama propia. Módulos en `Flujos/src/`, prompts en `Flujos/prompts/`, y los dos
comandos: ensamblar y extraer. Se aplica **a un solo vertical** de punta a
punta, con la prueba de identidad y la justificación en `Flujos/LEEME-flujos.md`
§0. **Costo:** cero mensajes.

### Bloque 2 — El resto de los flujos, verticales y clientes (2 jornadas)
Los demás flujos, incluidos los de cliente con sus nodos propios. El resultado
que importa: sincronizar un cambio del vertical a un cliente deja de ser portar
texto entre archivos. Decidí con el bloque 0 en la mano si
`sincronizar-flujo-cliente.mjs` y `portar-prompt-cliente.py` se simplifican, se
reemplazan o se quedan igual, y escribilo en el PR. **Costo:** cero mensajes.

### Bloque 3 — El corpus del sitio, fuera del nodo Code (1 jornada)
Es dato, no código, y hoy viaja como literal dentro de un nodo del flujo de
captación. Sacarlo a un recurso versionado o a la Function que lo sirve, con la
alarma de huella que ya existe. **Costo:** cero mensajes, salvo que se decida
traerlo en línea, y entonces se declara.

### Bloque 4 — Procedimiento y agentes (media jornada)
`docs/alta-cliente/RUNBOOK.md` etapa 5 y `.claude/agents/flujos-n8n.md` pasan a
hablar de módulos y del ensamblador. El gancho de pre-commit rechaza un JSON que
no coincida con sus módulos, en las dos direcciones. Sin esto, el agente sigue
editando un archivo que ahora se genera, y el frente se deshace solo.

### Lo que NO se construye ahora
- **Partir las Functions en varios paquetes de despliegue.** Exige desplegar y
  espera a después del 01/10/2026, con el arranque en frío medido.
- **Cambiar la topología de los flujos, unificar clientes en un flujo único o
  tocar el disparador.** Eso es el camino de proveedor tecnológico y de la capa
  de mensajería, no este frente.
- **Republicar flujos, migrar la ingesta o mover el sitio de Hosting.** Son
  frentes propios, con su compuerta.
- **Mezclar actualizaciones mayores de dependencias** con cualquier bloque.

## Entregables al cerrar
- Un PR por bloque, con la prueba de identidad, las suites en verde, el costo
  declarado y la revisión de `seguridad`.
- `Flujos/LEEME-flujos.md` §0 reescrito: por qué este ensamblador no es el
  generador retirado.
- `docs/alta-cliente/RUNBOOK.md` y `.claude/agents/flujos-n8n.md` actualizados.
- `ESTADO.md` al cerrar cada bloque.
- La ficha `~/Claude-Proyectos/proyectos/novuchat.md`, con los flujos como
  módulo reutilizable y no como archivos que se copian.
- La memoria del proyecto al día: si el diagnóstico del bloque 0 cambió algo,
  se corrige `modularizacion-sacar-codigo-de-los-json`.
