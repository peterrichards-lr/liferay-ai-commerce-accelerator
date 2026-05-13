import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './tests/setup.mjs')],
    pool: 'forks',
    server: {
      deps: {
        inline: true,
      },
    },
  },
  resolve: {
    mainFields: ['main', 'module'],
    conditions: ['node', 'require'],
  },
});
