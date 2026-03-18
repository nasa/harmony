import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginN from 'eslint-plugin-n';
import * as pluginImportX from 'eslint-plugin-import-x';
import pluginJsdoc from 'eslint-plugin-jsdoc';
import pluginTsdoc from 'eslint-plugin-tsdoc';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  // Warn on unused eslint-disable directives so they don't accumulate again
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // 1. Global ignores (replaces .eslintignore)
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/built/**', '**/coverage/**', 'db/**'],
  },

  // 2. Base TypeScript config (replaces root .eslintrc.yml)
  {
    files: ['**/*.ts'],
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
        typescript: true,
      },
    },
    rules: {
      // --- eslint-plugin-n (replaces plugin:node/recommended) ---
      'n/hashbang': 'error',
      'n/no-deprecated-api': 'error',
      'n/no-exports-assign': 'error',
      'n/no-extraneous-import': 'error',
      'n/no-extraneous-require': 'error',
      'n/no-missing-import': 'off', // TypeScript handles import resolution
      'n/no-missing-require': 'error',
      'n/no-process-exit': 'error',
      'n/no-unpublished-bin': 'error',
      'n/no-unpublished-import': 'off',
      'n/no-unpublished-require': 'error',
      'n/no-unsupported-features/es-builtins': 'error',
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-unsupported-features/node-builtins': 'error',
      'n/process-exit-as-throw': 'error',

      // --- @stylistic (replaces airbnb formatting rules) ---
      '@stylistic/indent': ['error', 2, { ignoredNodes: ['PropertyDefinition'], SwitchCase: 1 }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/comma-spacing': ['error', { before: false, after: true }],
      '@stylistic/comma-style': ['error', 'last'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/arrow-spacing': ['error', { before: true, after: true }],
      '@stylistic/func-call-spacing': ['error', 'never'],
      '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: false, exceptAfterOverload: true }],
      '@stylistic/no-extra-semi': 'error',
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

      // --- typescript-eslint v8 ---
      // ban-types was 'off' in old config; these are its v8 replacements, kept off
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      // no-empty-interface was not active on main; its v8 replacement kept off
      '@typescript-eslint/no-empty-object-type': 'off',

      // --- typescript-eslint rules from airbnb-typescript/base (verified via --print-config) ---
      '@typescript-eslint/default-param-last': 'error',
      '@typescript-eslint/dot-notation': ['error', { allowKeywords: true }],
      '@typescript-eslint/no-dupe-class-members': 'error',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions', 'functions', 'methods'] }],
      '@typescript-eslint/no-loop-func': 'error',
      '@typescript-eslint/no-redeclare': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-use-before-define': ['error', { functions: true, classes: true, variables: true }],
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // --- Airbnb best-practice rules ---
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // --- Import rules (replaces plugin:import/errors + warnings + typescript) ---
      'import-x/default': 'error',
      'import-x/export': 'error',
      'import-x/extensions': ['error', 'ignorePackages', { js: 'never', mjs: 'never', ts: 'never' }],
      'import-x/named': 'off',
      'import-x/namespace': 'error',
      'import-x/no-duplicates': 'warn',
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: false }],
      'import-x/no-named-as-default': 'warn',
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-unresolved': 'off',

      // -- hoisted -- from below
      'prefer-arrow-callback': 'off',
      'func-names': 'off',
    },
  },

  // 3. All services override (mocha patterns + dev deps)
  //    NOTE: Harmony's old .eslintrc.yml was missing the indent and no-unused-expressions
  //    overrides that all other services had — possibly a copy-paste oversight in the
  //    original config. Kept separate here to match the old behavior exactly.
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
      'n/no-unpublished-import': 'off',
      '@stylistic/indent': ['error', 2, { ignoredNodes: ['PropertyDefinition'] }],
      '@typescript-eslint/no-unused-expressions': 'error',
    },
  },

  // 4. Harmony service override
  {
    files: ['services/harmony/**/*.ts'],
    rules: {
      'n/no-unpublished-import': 'off',
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
      '@typescript-eslint/no-loop-func': 'off',
    },
  },

  // 7. Harmony public/ browser JS
  //    NOTE: These files were never linted on main — the old lint command used
  //    `eslint --ext .ts .` which only targeted TypeScript files. The full
  //    airbnb-base ruleset was configured but never ran against these JS files.
  //    Only rules referenced by existing eslint-disable comments are included here.
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
      // Rules referenced by disable comments in public JS files
      'no-param-reassign': 'error',
      'no-alert': 'error',
      'no-restricted-globals': 'error',
      'no-continue': 'error',
      'no-new': 'error',
    },
  },
);
