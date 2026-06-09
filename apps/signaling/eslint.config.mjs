import globals from 'globals';
import { defineConfig } from 'eslint/config';

import { baseConfig } from '../../eslint.config.base.mjs';

export default defineConfig(
  { ignores: ['dist'] },
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
    rules: { 'simple-import-sort/imports': 'error' },
  }
);
