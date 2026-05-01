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
        inline: [
          /msw/,
          /rettime/,
          /std-env/,
          /@ai-sdk\/provider-utils/,
          /node-fetch/,
          /@ai-sdk\/anthropic/
        ],
      },
    },
  },
  resolve: {
    mainFields: ['module', 'main', 'jsnext:main', 'browser'],
    conditions: ['node', 'import', 'default'],
  },
});
