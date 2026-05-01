import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.cjs'],
    setupFiles: ['./tests/setup.cjs'],
    pool: 'forks',
    server: {
      deps: {
        inline: true,
      },
    },
  },
  resolve: {
    mainFields: ['module', 'main'],
    conditions: ['node', 'import', 'default'],
  },
});
