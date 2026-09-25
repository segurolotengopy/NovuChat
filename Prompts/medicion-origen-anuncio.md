# Medición del origen de la conversación — retomar y cerrar

> **Sesión anterior:** 23/09/2026, cerrada el 25/09 sin PR. El trabajo está
> hecho y verificado, pero sobre una base que `main` ya dejó atrás. Esta sesión
> lo pone al día y lo lleva a `main`; no rediseña nada.

Eres la sesión dedicada a cerrar la medición del **origen de la conversación**:
saber qué fracción del tráfico de cada comercio nace de un anuncio de clic a
WhatsApp. Las decisiones están en `Analisis/38` §2 y `Analisis/39`; este prompt
las ejecuta.

Lee primero, en este orden: `CLAUDE.md` entero (§ «Base comercial», el punto de
BYOC), `ESTADO.md`, y después:

- `Analisis/38-dhermacore-oferta-dual.md` §2 — por qué hay que medirlo y por
  qué «va antes de firmar».
- `Analisis/39-byoc-modalidad.md` §4 y §7 — por qué en BYOC importa más: la
  varianza del tráfico la absorbe el comercio, no NovuChat.

## Por qué existe este frente

Una conversación que nace de un anuncio abre la **ventana de punto de entrada
gratuito**: Meta no cobra ningún mensaje de la empresa durante 72 h y esos
mensajes no gastan franquicia. Con qué fracción entra así se decide el margen
—a 14 mensajes por conversación, con 30 % no se pierde y con 0 % se pierden
38 USD al mes—, y hoy **ese número no se puede saber**.

`CLAUDE.md` §6 prohíbe prometer la ventana gratuita hasta medirla. Esto es lo
que la mide.

## Dónde quedó (estado real al 25/09/2026)

Rama **`medicion/origen-del-anuncio`**, en el worktree
`.claude/worktrees/novuchat-byoc-pricing-4e0c69`, **dos commits sobre `55ce861`
(PR #168)**, árbol limpio:

| Commit | Qué |
|---|---|
| `6088378` | **Servidor.** `ingesta.ts` acepta `origen` (lista cerrada `ORIGENES`), lo guarda en la conversación **al abrir la ventana** y cuenta `conversacionesPorAnuncio` en el agregado del mes, dentro de la transacción que ya contaba. Más `firestore.rules`. Prueba nueva: `pruebas/origen-del-anuncio.test.ts` (8 casos, ingesta real contra el emulador) |
| `0da7701` | **Flujos.** Los cinco leen el `referral` y lo reportan. Prueba nueva: `pruebas/flujos-origen.test.ts` (26 casos), verificada por mutación |

Verificado en su momento: **3.065 pruebas en verde**, builds de `functions` y
consola compilando, `ensamblar-flujo.mjs verificar` conforme, saneo sin
hallazgos. **Nada publicado, nada desplegado, sin PR, sin push.**

## Lo primero, y es lo que cambió

`main` avanzó de `#168` a `#181`. **El 24/09 otra sesión tocó el mismo archivo**
(`Flujos/src/comun/normalizar-entrada.js`, frente de campañas, PR #176): ahora
ese módulo **ya lee el `referral`** y arma un objeto `anuncio` con
`{ titular, fuente, idAnuncio }`, recortado y sin saltos de línea.

Comprobado el 25/09 contra `origin/main`:

- `ORIGENES` y `conversacionesPorAnuncio` **no existen** en `ingesta.ts`.
- El nodo `Reportar mensaje (entrante)` **no manda** nada del anuncio.
- `ingesta.ts` **no conoce** la palabra `anuncio`.

**O sea: el hueco sigue abierto, el trabajo no está duplicado, y lo único que
cambia es cómo se empalma.**

### La resolución del conflicto, decidida

Habrá conflicto en `Flujos/src/comun/normalizar-entrada.js`. **No se resuelve
quedándose con la versión de la rama.** El `origen` se **deriva del `anuncio`
que `main` ya calcula**, sin volver a mirar `msg.referral`:

```js
const origen = anuncio ? 'anuncio' : 'directo';
```

Es exactamente el patrón que la rama ya usa en `novuchat-onboarding.json`, donde
ese flujo también calculaba `anuncio` antes. Dos lecturas del mismo `referral`
en el mismo nodo es la clase de duplicación que se desincroniza sola.

## Las decisiones que no se tocan

1. **El origen es de la VENTANA, no del mensaje.** Meta manda `referral` solo en
   el primer mensaje; refrescarlo con cada uno convertiría en `directo` a toda
   conversación de más de un mensaje. Se escribe al abrir y no se vuelve a
   tocar, igual que `atencionDesde`. Hay prueba.
2. **Ante la duda, `directo`.** Un valor desconocido, ausente o que no es cadena
   nunca se toma por `anuncio`. Sobreestimar la fracción por campaña infla el
   margen esperado, que es el error caro.
3. **Un bloque adicional hereda el origen de la ventana que lo trajo.**
4. **Solo viaja SI vino de un anuncio, no cuál.** El titular y la URL son datos
   de la campaña del comercio y no van al servidor. Hay prueba que lo fija.
   *(Si el frente de campañas necesita el `idAnuncio` en el servidor, es una
   decisión nueva y se consulta: cambia qué se guarda y qué ve la consola.)*
5. **Cero mensajes agregados por conversación.** El dato viaja en el reporte que
   ya se hacía.

## Qué hacer, en orden

### Bloque 0 — Preguntar antes de tocar nada (primero, y no es trámite)

**Andres anunció errores de arquitectura el 24/09 y cerró la sesión por eso.**
Antes de rebasar, preguntarle si este frente sigue en pie tal como está. Si los
errores tocan la ingesta, el conteo o los flujos, esto se replantea, no se
empalma.

### Bloque 1 — Poner la rama al día (½ jornada)

`git fetch`, rebasar sobre `origin/main`, resolver el conflicto del módulo común
como dice arriba, reensamblar (`node scripts/ensamblar-flujo.mjs ensamblar`) y
verificar. Revisar también si el frente de campañas cambió el nodo
`Reportar mensaje (entrante)` de algún flujo.

**Comprobación obligatoria antes de seguir:**

```bash
cd admin && node scripts/ensamblar-flujo.mjs verificar
cd admin && npx firebase emulators:exec --only firestore --project demo-novuchat-pruebas "npx vitest run"
./scripts/verificar-saneo.sh
```

Y validar cada nodo Code con `new Function`, como manda la memoria del proyecto.

### Bloque 2 — PR y fusión (¼ jornada)

Un solo PR con los dos commits. Declarar: **cero mensajes agregados**, las
pruebas que lo cubren, y que no se publica ni se despliega nada.

### Bloque 3 — Publicación y prueba real (½ jornada, con autorización)

1. Desplegar Functions (etiqueta `vX.Y.Z`, que **crea Andres** con
   `scripts/etiquetar-version.sh`).
2. Publicar los cinco flujos con `publicar-flujo.sh`, **a todos o a ninguno**, y
   dentro de la **ventana de mantenimiento de 2 a 3** (regla del 24/09).
3. **Probar contra un teléfono real**, idealmente uno que entre desde un anuncio
   de clic a WhatsApp, y reportar el resultado **real**.

El orden importa poco pero conviene: el servidor primero, porque un campo que
no conoce lo ignora; un flujo que no lo manda cuenta `directo`, que es lo
conservador. Ninguno de los dos rompe al otro.

### Lo que NO se construye ahora

- **La pantalla en la consola.** La cifra queda en `metricas/{periodo}` y nadie
  la muestra todavía. Es un bloque aparte, y primero hay que ver un mes de datos
  reales: `CLAUDE.md` §4 ya pide otras tres cifras que tampoco están.
- **Cruzar la cifra con la factura de Meta.** Es la validación que de verdad
  confirma que la ventana gratuita se aplica, y necesita un mes cerrado.
- **Prometer la ventana gratuita en una oferta.** Sigue prohibido hasta medirla
  (`CLAUDE.md` §6). Medirla es esto; prometerla es otra decisión.

## Entregables al cerrar

- Un PR fusionado, con costo declarado y pruebas.
- El resultado **real** de la prueba con teléfono, anotado.
- `ESTADO.md` actualizado.
- Si se publica, la fila correspondiente en el registro de versiones de flujos.
