import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.vitest } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
];
