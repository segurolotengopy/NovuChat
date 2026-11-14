# Accesibilidad de la consola: lint con línea de base

Alta: 13/11/2026 (brecha D de UX). La consola ya tenía violaciones de accesibilidad; no se arreglan de golpe, pero **el CI falla ante una violación nueva y el tope solo baja**.

Límite de la medida: se cuenta por archivo y regla. Si en un mismo cambio se arregla una violación y se agrega otra de la misma regla en el mismo archivo, la cuenta no cambia y el CI no lo nota; eso lo mira la revisión del PR, igual que una clave nueva en la línea de base (la base no gana claves).

## Qué mide y qué no

- **Mide:** lint estático del JSX de `admin/web/src/**/*.tsx` con las reglas recomendadas de `eslint-plugin-jsx-a11y` (config aparte: `admin/web/eslint.a11y.config.js`; `pnpm lint` general no las incluye y sigue en verde). Los comentarios `eslint-disable` no las apagan.
- **No mide:** contraste de color, orden y trampas de foco, ni nada que exija renderizar la página. Eso lo hará la prueba con motor (sección final), pendiente.

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

## Pruebas con motor (axe)

No construidas. Necesitan `axe-core` como dependencia directa y `jsdom` (MIT) para dibujar las páginas en las pruebas. Quedan a la espera de que Andres decida si MPL-2.0 se admite como dependencia directa de desarrollo; la política de licencias no se tocó.
