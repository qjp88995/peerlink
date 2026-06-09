import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Shared base config used by every package's eslint.config.{mjs,js}.
 * Each package extends this and adds its own globals / framework plugins.
 */
export const baseConfig = defineConfig({
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  plugins: {
    'simple-import-sort': simpleImportSort,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'simple-import-sort/exports': 'error',
  },
});
