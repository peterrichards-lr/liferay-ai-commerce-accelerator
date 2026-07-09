import js from '@eslint/js';
import globals from 'globals';
import pluginPromise from 'eslint-plugin-promise';
import pluginSecurity from 'eslint-plugin-security';

export default [
  js.configs.recommended,
  // Promise best-practices (catches unhandled rejections, floating promises, etc.)
  pluginPromise.configs['flat/recommended'],
  // Security checks (catches unsafe regex, shell injection risks, etc.)
  pluginSecurity.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        // Manually define Vitest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-undef': 'error',
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      // Downgrade promise rules that are too strict for existing code during initial rollout
      'promise/always-return': 'warn',
      'promise/catch-or-return': ['warn', { allowFinally: true }],
      // Downgrade security rules to warn for initial rollout (avoids CI gate breakage)
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },
];
