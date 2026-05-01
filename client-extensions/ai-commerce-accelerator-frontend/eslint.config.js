import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.vitest,
        ...globals.node,
        Liferay: 'readonly',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },
];
