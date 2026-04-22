const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.cjs'],
    setupFiles: ['./tests/setup.cjs'],
  },
});
