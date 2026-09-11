process.env.PERSISTENCE_DB_PATH = `./data/test-workflows-${process.pid}.db`;

const { server } = require('./mocks/server.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

// See tests/setup.mjs: the archive defaults to the operator's home directory,
// so the suite gets a temporary one unless a test names its own (#899).
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
