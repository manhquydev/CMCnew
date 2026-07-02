// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // ─── Global ignores ──────────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      // Prisma generated client
      '**/prisma/generated/**',
      'packages/db/src/generated/**',
      // Migrations are plain SQL-ish TS files, not worth linting
      '**/prisma/migrations/**',
      // Skill scripts and local tooling
      '.claude/**',
      'scripts/**',
    ],
  },

  // ─── Base JS recommended ─────────────────────────────────────────────────────
  js.configs.recommended,

  // ─── TypeScript: all TS/TSX files ────────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ─── Backend / Node packages (no React) ──────────────────────────────────────
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '*.ts', '*.mts', '*.cts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // TS overrides — pragmatic for a greenfield codebase still being built out
      '@typescript-eslint/no-explicit-any': 'warn', // warn, not error; tighten later
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // These fire on legitimate patterns used throughout (e.g. TRPC procedure chains)
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Empty catch blocks are common in fire-and-forget patterns
      '@typescript-eslint/no-empty-function': 'warn',
      // Namespace imports are used in some prisma patterns
      '@typescript-eslint/no-namespace': 'warn',
    },
  },

  // ─── React / Frontend apps ───────────────────────────────────────────────────
  {
    files: [
      'apps/lms/src/**/*.{ts,tsx}',
      'apps/admin/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
    ],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // React rules
      'react/react-in-jsx-scope': 'off', // React 17+ JSX transform
      'react/prop-types': 'off', // We use TypeScript for prop types
      'react/display-name': 'warn',
      // Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // TS overrides (same as backend)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ─── RLS-bypass guard (app source only — packages/db construction + apps/api/test harness
  // are the intended raw-client sites and are excluded by not matching these globs) ────────────
  {
    files: ['apps/api/src/**/*.ts', 'apps/{admin,lms}/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Use withRls from @cmc/db — raw prisma bypasses RLS.',
            },
            {
              name: '@cmc/db',
              importNames: ['prisma'],
              message: 'Import withRls, not the raw prisma singleton — it bypasses RLS.',
            },
          ],
        },
      ],
    },
  },
);
