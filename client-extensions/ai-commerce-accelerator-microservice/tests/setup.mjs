import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = setupServer(...handlers);

process.env.PERSISTENCE_DB_PATH = `./data/test-workflows-${process.pid}.db`;

// The media archive defaults to ~/.aica/media, beside the workflow database
// (#899), and a test that opens one writes real directories into it. A file
// that sets its own MEDIA_ARCHIVE_PATH still wins - this is the floor, so that
// forgetting to set one costs a temporary directory rather than the operator's
// own media.
const MEDIA_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), `aica-test-media-${process.pid}-`)
);
process.env.MEDIA_ARCHIVE_PATH = MEDIA_ROOT;

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

  try {
    fs.rmSync(MEDIA_ROOT, { force: true, recursive: true });
  } catch (_e) {
    // Ignore cleanup errors
  }
});

export { server };
