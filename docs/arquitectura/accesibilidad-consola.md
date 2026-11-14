# Accesibilidad de la consola: lint con línea de base

Alta: 13/11/2026 (brecha D de UX). La consola ya tenía violaciones de accesibilidad; no se arreglan de golpe, pero **el CI falla ante una violación nueva y el tope solo baja**.

Límite de la medida: se cuenta por archivo y regla. Si en un mismo cambio se arregla una violación y se agrega otra de la misma regla en el mismo archivo, la cuenta no cambia y el CI no lo nota; eso lo mira la revisión del PR, igual que una clave nueva en la línea de base (la base no gana claves).

## Qué mide y qué no

- **Mide:** lint estático del JSX de `admin/web/src/**/*.tsx` con las reglas recomendadas de `eslint-plugin-jsx-a11y` (config aparte: `admin/web/eslint.a11y.config.js`; `pnpm lint` general no las incluye y sigue en verde). Los comentarios `eslint-disable` no las apagan.
- **No mide:** contraste de color, orden y trampas de foco, ni nada que exija renderizar la página. Eso lo mide en parte la prueba con motor (sección final), que dibuja 8 pantallas y les pasa axe-core.

## Cómo correrlo

- La prueba del CI: `cd admin && FIRESTORE_EMULATOR_HOST=127.0.0.1:1 npx vitest run --project puras pruebas/central/accesibilidad`.
- La lista completa a mano: `cd admin/web && pnpm lint:a11y`. Sale con código 1 mientras haya violaciones; es lo esperado y el CI no lo corre.

## Si el CI falla

- **«violación NUEVA de accesibilidad»:** se arregla el código. La violación no se agrega a la línea de base.
- **«la línea de base sobra»:** se arregló una (bien). Se baja la clave en `admin/pruebas/central/accesibilidad/linea-de-base.ts` (se quita o se reduce su cuenta) y se bajan `TOPE`, `TOPE_POR_REGLA` y `TOPE_MAXIMO` (este último en `tope-fijado.ts`).

## Quién puede subir el tope

Nadie sin pasar por el agente `seguridad` y una decisión escrita de Andres. Subirlo obliga a tocar dos archivos (`linea-de-base.ts` y `tope-fijado.ts`); bajarlo es lo esperado.

## Línea de base al 13/11/2026 (16 violaciones en 7 archivos)

| Regla (`jsx-a11y/…`) | Hay |
|---|---|
| `no-noninteractive-element-interactions` | 4 |
| `click-events-have-key-events` | 4 |
| `label-has-associated-control` | 3 |
| `media-has-caption` | 2 |
| `no-static-element-interactions` | 2 |
| `no-noninteractive-tabindex` | 1 |

## Costo en CI

Corre dentro de `pruebas:reglas` del job `calidad`: sin paso nuevo ni navegador. Medido el 13/11/2026: la suite tarda entre 3 y 10 s según la caché (ESLint sobre `src` unos 3 s). Cero mensajes por conversación.

## Licencias de lo que se agregó

`eslint-plugin-jsx-a11y` 6.10.2 es MIT. Trae 87 paquetes de desarrollo: 82 MIT, 2 Apache-2.0, 1 BSD-2-Clause, 1 CC0-1.0 y **uno MPL-2.0: `axe-core`**, que el plugin usa para una de sus reglas. MPL-2.0 obliga solo a quien modifica y distribuye esos archivos; aquí se usa sin modificar, solo en desarrollo, y no entra en lo que se despliega. El repositorio no tiene hoy una política de licencias que el CI haga cumplir (ni lista permitida ni denegada), así que nada lo bloquea ni lo aprueba: queda declarado aquí y en el PR.

**Andres admitió el 13/11/2026 `axe-core` 4.14.0 (MPL-2.0) como dependencia directa, solo en `devDependencies`** y con versión exacta, para las pruebas con motor. `jsdom` 30.1.3 (MIT) dibuja las páginas en esas pruebas, también solo en desarrollo y con versión exacta. La política de licencias del repositorio no se tocó.

## Pruebas con motor (axe)

Alta: 13/11/2026. Archivos en `admin/pruebas/central/accesibilidad/`: `motor.test.ts` (la suite), `paginas.ts` (las pantallas y sus datos), `sustitutos.ts` y `dibujar.ts` (la capa de datos falsa y el dibujo), `linea-de-base-motor.ts` (la base) y `tope-fijado.ts` (el techo).

### Qué mide

- **Monta la `App` real** de la consola (`admin/web/src/App.tsx`, con su cabecera, su menú, su ruta y su guarda de permisos) dentro de jsdom, con `react-dom/client`, en **8 pantallas**: `ingresar`, `tablero`, `conversaciones`, `cobros`, `consumo`, `pagar`, `configuracion` y `negocios`. Solo se sustituye la capa de datos (`firebase/firestore`, `firebase/functions`, `firebase/auth` y los módulos `core/lib/firebase` y `core/lib/contexto`); ninguna página ni componente se reemplaza.
- **Corre axe-core** 4.14.0 con las etiquetas WCAG 2.0, 2.1 y 2.2, niveles A y AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`): 59 reglas evaluadas, sin las experimentales ni las obsoletas.
- **La clave es `<página>#<regla>`** y su valor es el número de nodos. Lo que axe no logra decidir (`incomplete`) se anota como `<página>#<regla>:incompleta` y **cuenta igual** que una violación: «no se pudo comprobar» no es «está bien».
- **Una página que no se dibuja con datos pone la suite en rojo.** Cada página debe mostrar un dato suyo (un «centinela»), sin «Cargando…» ni «Sin permiso». Y la suite exige que sea hermética: ninguna página escribe, sale a la red ni llama a algo sin sustituto.

### Qué NO mide

- **Seis reglas de axe desactivadas**, porque jsdom no puede evaluarlas y darían «pasa» falso o fallarían siempre: `color-contrast` (jsdom no tiene canvas ni colores calculados), `link-in-text-block` (necesita colores calculados), `target-size` (sin layout daría «pasa» falso), `scrollable-region-focusable` (`scrollHeight` siempre es 0), `label-content-name-mismatch` (usa canvas y es experimental) y `css-orientation-lock` (vitest descarta el CSS). La lista está cerrada en `dibujar.ts` (`DESACTIVADAS`) y la suite la exige igual.
- **Foco y orden de tabulación**, y todo lo que exige manejar el teclado o el lector de pantalla.
- **La conversación abierta**: se dibuja la lista, no el detalle de una conversación con sus mensajes.
- **Lo que el CSS oculta o muestra**: el CSS no se carga.
- **Pantallas que no están entre las 8** (usuarios, contactos, catálogo, campañas, agenda, captación, etc.) ni los estados de error o vacío de las que sí están.

### Cómo correrlo

`cd admin && FIRESTORE_EMULATOR_HOST=127.0.0.1:1 npx vitest run --project puras pruebas/central/accesibilidad`. Corre con el resto de `pruebas:puras`, sin navegador ni emulador.

### Si el CI falla

- **«violación NUEVA de accesibilidad»:** se arregla la pantalla. No se sube la base.
- **«la línea de base sobra … bájala en linea-de-base-motor.ts»:** se arregló algo (bien). Se quita o se reduce la clave en `linea-de-base-motor.ts` y se bajan `TOPE_MOTOR`, `TOPE_MOTOR_POR_REGLA` y `TOPE_MOTOR_MAXIMO` (este último en `tope-fijado.ts`).
- **Cambiar los datos de prueba (`paginas.ts`) cambia las cuentas:** agregar una fila a una colección o un dato que haga aparecer otro bloque puede crear o quitar nodos sin que la consola haya cambiado. Los datos son MÍNIMOS a propósito (una fila por colección); quien los toque reconcilia la base en el mismo cambio y lo dice en el PR.
- Subir el tope exige lo mismo que en el lint: agente `seguridad` y decisión escrita de Andres.

### Línea de base del motor al 13/11/2026 (7 nodos, todos «incompletos»)

| Regla de axe | Dónde | Hay | Qué dice axe |
|---|---|---|---|
| `aria-prohibited-attr:incompleta` | `tablero`, `conversaciones`, `cobros`, `consumo`, `pagar`, `configuracion` | 6 (uno por página) | Los elementos solo deben usar atributos ARIA permitidos. Es la franja del comercio (`.franja-comercio`, un `div` con `aria-label="Comercio"` y sin rol): un `aria-label` en un `div` sin rol no lo leen todos los lectores de pantalla. |
| `bypass:incompleta` | `conversaciones` | 1 | La página debe tener forma de saltar los bloques repetidos (el menú). Axe no pudo decidir en esa pantalla. |

Sin violaciones firmes (`violations`) en las 8 pantallas al darla de alta: lo que hay es lo que axe no pudo decidir. `ingresar` y `negocios` salen limpias.

### Costo en CI

Corre dentro de `pruebas:puras` y `pruebas:reglas` del job `calidad`: sin paso nuevo ni navegador. Medido el 13/11/2026 en una máquina de desarrollo: `motor.test.ts` tarda unos 4,4 s de pared (1,4 s de pruebas más el arranque de jsdom y la carga de la `App`). Cero mensajes por conversación.
