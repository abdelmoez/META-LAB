// 86.md P3.22 — the repo had NO lint config; correctness rested entirely on tests.
// This is a PRAGMATIC baseline: it catches genuine bugs (undeclared identifiers /
// missing imports, duplicate keys, unreachable code, self-compare, unsafe-negation,
// getter-return, function reassignment) across the plain-JS surface — the server,
// the pure research engines, scripts, and tests — WITHOUT drowning in style noise.
//
// SCOPE: *.js / *.mjs only. The JSX SPA is intentionally NOT linted here: espree
// (ESLint's default parser) does not robustly parse the full JSX in these files, so
// linting the frontend needs @babel/eslint-parser + eslint-plugin-react — a
// follow-up. Scoping to plain JS keeps this gate GREEN and high-signal today, and
// still covers the highest-value correctness surface (server + engines).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**', 'server/node_modules/**',
      'dist/**', 'build/**', 'public/**', // public/ holds vendored Tesseract WASM bundles
      'server/prisma/generated/**', 'server/prisma/postgres/**', 'server/prisma/waitlist/**',
      'graphify-out/**', 'server/graphify-out/**',
      'playwright-report/**', 'test-results/**', 'coverage/**',
      '.claude/**', 'ds-bundle/**', 'template/**', 'marketing/**', '.ds-sync/**',
      'meta-lab-3-patched.jsx',
      '**/*.jsx', 'e2e/**', // JSX + TypeScript e2e: separate parser needed (follow-up)
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2023,
        __APP_VERSION__: 'readonly', // injected by Vite define (86.md P3.34)
        vi: 'readonly',              // vitest global
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      // Custom hooks live in .js files too — rules-of-hooks catches genuine hook
      // misuse; exhaustive-deps is off (high-churn) but registered so the existing
      // // eslint-disable react-hooks/exhaustive-deps comments resolve.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      // ── off: style / high-churn / deliberate on this legacy codebase ─────
      'no-sparse-arrays': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      'no-fallthrough': 'off',
      'no-async-promise-executor': 'off',
      'no-misleading-character-class': 'off',
      'no-cond-assign': ['error', 'except-parens'],
      // Deliberate: high-precision math constants + special chars in parsing regexes.
      'no-loss-of-precision': 'off',
      'no-irregular-whitespace': 'off',
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
];
