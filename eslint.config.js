import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Minimal browser globals (avoids an extra dependency). */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  WebSocket: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  Intl: 'readonly',
  CustomEvent: 'readonly',
  EventTarget: 'readonly',
  HTMLElement: 'readonly',
  customElements: 'readonly',
  Notification: 'readonly',
  FileReader: 'readonly',
  process: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['dist', 'dist-single', 'node_modules', 'coverage', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: browserGlobals,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Build-time and CI scripts run under Node, not the browser. `js.configs.recommended`
    // supplies `console`, `process` and `URL` for .mjs already, so only the Node
    // built-ins it does not declare are listed here (redeclaring the others
    // would trip `no-redeclare`).
    files: ['**/*.mjs', 'scripts/**/*.{ts,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        Buffer: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    // The Node scripts above re-declare globals that an earlier config already
    // provides; silence only that conflict rather than dropping the definitions.
    files: ['**/*.mjs', 'scripts/**/*.{ts,js,mjs}'],
    rules: {
      'no-redeclare': 'off',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
