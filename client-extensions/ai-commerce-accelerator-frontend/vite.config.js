import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import replace from '@rollup/plugin-replace';
import path from 'path';

const local = process.env.LOCAL_DEV === 'true';

export default defineConfig(({ command }) => {
  const isServe = command === 'serve';

  return {
    css: { postcss: './postcss.config.js' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        isServe ? 'development' : 'production'
      ),
      'process.env': {},
      process: { env: {} },
      global: 'window',
    },

    plugins: [
      react({ jsxRuntime: isServe ? 'automatic' : 'classic' }),

      replace({
        preventAssignment: true,
        values: {
          'process.env.NODE_ENV': JSON.stringify(
            isServe ? 'development' : 'production'
          ),
        },
      }),
    ],

    resolve: {
      dedupe: ['react', 'react-dom'],
      conditions: ['browser', 'module', 'import'],
    },

    build: {
      target: ['es2020'],
      outDir: path.resolve(__dirname, 'build/static'),
      emptyOutDir: true,
      lib: {
        entry: 'src/index.jsx',
        formats: ['es'],
        fileName: () =>
          'liferay-ai-commerce-accelerator-frontend.[hash].esm.js',
      },
      rollupOptions: {
        external: [],
      },
      sourcemap: true,
      minify: !isServe,
    },
  };
});
