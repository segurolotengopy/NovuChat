# Accesibilidad de la consola: lint con línea de base

Alta: 13/11/2026 (brecha D de UX). La consola ya tenía violaciones de accesibilidad; no se arreglan de golpe, pero **no puede entrar ninguna nueva y el tope solo baja**.

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

## Pruebas con motor (axe)

Pendiente de decisión de licencia (axe-core es MPL-2.0).
