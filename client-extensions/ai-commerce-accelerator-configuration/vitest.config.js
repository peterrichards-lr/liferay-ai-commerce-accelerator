import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    include: ['src/**/*.test.{js,jsx}'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './vitest-report-configuration.xml',
    },
  },
  esbuild: {
    jsxInject: `import React from 'react'`,
  },
});
