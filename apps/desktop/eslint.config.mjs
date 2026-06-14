import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { baseConfig } from '../../eslint.config.base.mjs';

export default defineConfig(
  { ignores: ['dist', 'build'] },
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'simple-import-sort/imports': 'error' },
  }
);
