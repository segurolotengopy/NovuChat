// Lint de ACCESIBILIDAD de la consola (brecha D de UX, 12/11/2026), aparte del lint general.
//
// Por qué va aparte: `pnpm lint` (eslint.config.js) corre con `--max-warnings 0` y hoy está en verde; las reglas de accesibilidad
// encuentran violaciones que YA existen y que se arreglan después. Este archivo solo lleva las reglas de `eslint-plugin-jsx-a11y`
// (conjunto recomendado, todas como error) y lo lee la prueba `admin/pruebas/central/accesibilidad/lint.test.ts`, que compara lo
// encontrado con una línea de base cerrada: el CI falla solo ante una violación NUEVA. Cómo correrlo y bajar el tope:
// docs/arquitectura/accesibilidad-consola.md.
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-catalogo/**', 'node_modules/**', '*.config.js', '*.config.ts'] },
  {
    files: ['src/**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'jsx-a11y': jsxA11y },
    // No se hereda ninguna otra regla: aquí solo se mide accesibilidad. Los comentarios `eslint-disable` no apagan estas reglas.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    rules: Object.fromEntries(Object.keys(jsxA11y.flatConfigs.recommended.rules).map((r) => [r, jsxA11y.flatConfigs.recommended.rules[r]])),
  },
);
