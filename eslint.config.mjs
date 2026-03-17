import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginN from 'eslint-plugin-n';
import * as pluginImportX from 'eslint-plugin-import-x';
import pluginJsdoc from 'eslint-plugin-jsdoc';
import pluginTsdoc from 'eslint-plugin-tsdoc';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  // 1. Global ignores (replaces .eslintignore)
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/built/**', '**/coverage/**', 'db/**'],
  },

  // 2. Base TypeScript config (replaces root .eslintrc.yml)
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
      parser: tseslint.parser,
      parserOptions: { project: true },
    },
    plugins: {
      n: pluginN,
      'import-x': pluginImportX,
      jsdoc: pluginJsdoc,
      tsdoc: pluginTsdoc,
      '@stylistic': stylistic,
    },
    settings: {
      'import-x/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      // --- eslint-plugin-n (replaces node/) ---
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-missing-import': 'off', // TypeScript handles import resolution

      // --- @stylistic (replaces @typescript-eslint/indent and airbnb formatting) ---
      '@stylistic/indent': ['error', 2, { ignoredNodes: ['PropertyDefinition'], SwitchCase: 1 }],
      '@stylistic/object-curly-newline': 'off',

      // --- Custom rules carried forward from root .eslintrc.yml ---
      'no-restricted-syntax': ['error', 'LabeledStatement', 'WithStatement'],
      'class-methods-use-this': 'off',
      'no-underscore-dangle': 'off',
      '@typescript-eslint/no-floating-promises': ['error'],
      'jsdoc/require-jsdoc': 'warn',
      'tsdoc/syntax': ['error'],
      'no-await-in-loop': 'off',
      'no-plusplus': 'off',
      'prefer-destructuring': ['error', { array: false, object: true }, { enforceForRenamedProperties: false }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
          format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],
          selector: 'default',
        },
        { selector: 'objectLiteralProperty', format: [] },
      ],

      // --- New typescript-eslint v8 rules - disabled for migration parity ---
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',

      // --- Airbnb best-practice rules (manually carried) ---
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // --- Import rules ---
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: false }],
    },
  },

  // 3. All services override (mocha patterns + dev deps)
  {
    files: [
      'services/service-runner/**/*.ts',
      'services/work-scheduler/**/*.ts',
      'services/cron-service/**/*.ts',
      'services/work-failer/**/*.ts',
      'services/query-cmr/**/*.ts',
      'services/work-updater/**/*.ts',
    ],
    rules: {
      'prefer-arrow-callback': 'off',
      'func-names': 'off',
      'no-unused-expressions': 'off',
      'n/no-unpublished-import': 'off',
      '@stylistic/indent': ['error', 2, { ignoredNodes: ['PropertyDefinition'] }],
      '@typescript-eslint/no-unused-expressions': 'off',
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },

  // 4. Harmony service override
  {
    files: ['services/harmony/**/*.ts'],
    rules: {
      'prefer-arrow-callback': 'off',
      'func-names': 'off',
      'no-unused-expressions': 'off',
      'n/no-unpublished-import': 'off',
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },

  // 5. Test file overrides
  {
    files: ['services/**/test/**/*.ts', 'packages/**/test/**/*.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
      'n/no-unpublished-require': 'off',
      'n/no-unpublished-import': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-arrow-callback': 'off',
      'func-names': 'off',
    },
  },

  // 6. Harmony test-specific (extra relaxations)
  {
    files: ['services/harmony/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-loop-func': 'off',
    },
  },

  // 7. Harmony public/ browser JS
  {
    files: ['services/harmony/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        Tagify: 'readonly',
        bootstrap: 'readonly',
      },
    },
    plugins: {
      jsdoc: pluginJsdoc,
      '@stylistic': stylistic,
      'import-x': pluginImportX,
    },
    rules: {
      'import-x/extensions': [2, { js: 'always' }],
      '@stylistic/indent': 'off',
      'no-restricted-syntax': ['error', 'LabeledStatement', 'WithStatement'],
      'class-methods-use-this': 'off',
      'no-underscore-dangle': 'off',
      'jsdoc/require-jsdoc': 'warn',
      'no-await-in-loop': 'off',
      '@stylistic/object-curly-newline': 'off',
      'no-plusplus': 'off',
      'prefer-destructuring': ['error', { array: false, object: true }, { enforceForRenamedProperties: false }],
    },
  },
);
