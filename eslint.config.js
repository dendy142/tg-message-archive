import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TGCLOUD = path.join(ROOT, 'tgcloud');

/** Правило платформы: в tgcloud/ импорт — только `sdk`/`sdk/*` или относительный путь с `.js`. */
const platformImports = {
  meta: { type: 'problem', schema: [], messages: {
    pkg: 'В tgcloud/ доступен только `sdk` и `sdk/*` — npm-пакетов на платформе нет ({{src}}).',
    ext: 'Относительный импорт в tgcloud/ должен оканчиваться на `.js` ({{src}}).',
    outside: 'Импорт вне tgcloud/ на платформе недоступен ({{src}}).',
  } },
  create(context) {
    const check = (node) => {
      const src = node.source?.value;
      if (typeof src !== 'string') return;
      if (!src.startsWith('.')) {
        if (src !== 'sdk' && !src.startsWith('sdk/')) context.report({ node: node.source, messageId: 'pkg', data: { src } });
        return;
      }
      if (!src.endsWith('.js')) context.report({ node: node.source, messageId: 'ext', data: { src } });
      const abs = path.resolve(path.dirname(context.filename), src);
      if (!abs.startsWith(TGCLOUD + path.sep)) context.report({ node: node.source, messageId: 'outside', data: { src } });
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check };
  },
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.tgcloud/**', 'coverage/**', 'playwright-report/**', 'test-results/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['tgcloud/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { console: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', Intl: 'readonly', crypto: 'readonly' } },
    plugins: { local: { rules: { 'platform-imports': platformImports } } },
    rules: {
      'local/platform-imports': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['sdk-shim/**/*.js', 'scripts/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['web/**/*.{ts,tsx}', 'tests/**/*.ts', '*.config.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
