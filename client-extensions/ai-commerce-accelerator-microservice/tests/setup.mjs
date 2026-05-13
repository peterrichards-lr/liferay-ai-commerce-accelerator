import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = setupServer(...handlers);

process.env.PERSISTENCE_DB_PATH = `./data/test-workflows-${process.pid}.db`;

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  try {
    const dbPath = path.resolve(
      __dirname,
      '..',
      process.env.PERSISTENCE_DB_PATH
    );
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
  } catch (_e) {
    // Ignore cleanup errors
  }
});

export { server };
