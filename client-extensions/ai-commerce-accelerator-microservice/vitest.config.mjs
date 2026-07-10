import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{cjs,mjs}'],
    setupFiles: ['./tests/setup.mjs'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './vitest-report-microservice.xml',
    },
    pool: 'forks',
    server: {
      deps: {
        inline: true,
      },
    },
    coverage: {
      provider: 'v8',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/mocks/**',
        '**/scripts/**',
      ],
      thresholds: {
        statements: 45,
        lines: 45,
      },
    },
  },
  resolve: {
    mainFields: ['main', 'module'],
    conditions: ['node', 'require'],
  },
});
