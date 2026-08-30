// Configuración de ESLint del panel.
//
// El job `calidad` corre `eslint src --max-warnings 0` y salía con código 2,
// que en ESLint significa error FATAL de configuración y no violaciones de
// reglas -- con violaciones sale 1. La causa era que este archivo no existía.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // El panel muestra texto escrito por clientes finales de WhatsApp: un
      // `any` es justamente donde se pierde la garantía de que ese texto se
      // trate como dato y no como algo interpretable.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
