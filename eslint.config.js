import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'screenshots/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { window: 'readonly', document: 'readonly', navigator: 'readonly', self: 'readonly', localStorage: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', console: 'readonly', btoa: 'readonly', atob: 'readonly', MessageEvent: 'readonly', Worker: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly', HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', HTMLButtonElement: 'readonly', HTMLInputElement: 'readonly', HTMLImageElement: 'readonly', CanvasRenderingContext2D: 'readonly', HTMLElementTagNameMap: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
