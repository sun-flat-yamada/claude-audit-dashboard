// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architecture boundaries (docs/ARCHITECTURE.md §3.1): each block lists what a layer may NOT
 * import. Later blocks replace earlier `no-restricted-imports` options for the same files,
 * so inner layers repeat the outer restrictions.
 */
const PURE = [
  'node:*',
  'fs',
  'path',
  'os',
  'nodemailer',
  '@claude-audit/collector',
  '@claude-audit/dashboard',
];
const restrict = (files, groups, message) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group: groups, message }] }] },
});

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'packages/dashboard/public/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['packages/dashboard/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Keep units small so additions do not accumulate complexity.
    files: ['packages/*/src/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**'],
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 5],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },
  restrict(
    ['packages/core/src/**/*.ts'],
    PURE,
    'core is pure: no I/O, Node APIs or outer packages.',
  ),
  restrict(
    ['packages/core/src/domain/**/*.ts'],
    [...PURE, '**/application/**', '**/contracts/**'],
    'domain must not depend on application or contracts.',
  ),
  restrict(
    ['packages/collector/src/adapters/**/*.ts', 'packages/collector/src/infrastructure/**/*.ts'],
    ['**/main/**'],
    'adapters and infrastructure must not depend on the composition root.',
  ),
  {
    files: ['packages/dashboard/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@claude-audit/core',
              message: 'The UI may only use @claude-audit/core/contracts.',
            },
          ],
          patterns: [
            {
              group: ['@claude-audit/collector', '@claude-audit/collector/*'],
              message: 'The UI may only use @claude-audit/core/contracts.',
            },
          ],
        },
      ],
    },
  },
);
