import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The fixture is .cjs because the test files that share it are, and a
// `require` of it here avoids depending on interop for a module that must load
// before anything else in the worker.
const require = createRequire(import.meta.url);
const { clearAmbientLxcEnv } = require('./fixtures/ambientLxcEnv.cjs');

const server = setupServer(...handlers);

// Every COM_LIFERAY_LXC_* variable is a config source config-node will read,
// and `scripts/run-e2e-ldm.sh` exports them before the orchestrator reaches
// `yarn test` - so inside an E2E run the suite inherits a live Liferay target
// that no test set. Nothing here asserts on the ambient values, so reading
// them has no upside and one large downside: #1199 stopped a nightly at
// `yarn test`, and #1158 and #1175 were each found only after passing on a
// workstation and failing in CI.
//
// The floor goes here rather than in the files that care, so that a new file
// inherits it instead of having to remember the prefix. Recorded rather than
// merely done, because a guard asserting the environment looks clean is green
// on a clean workstation whether or not this ran - see
// tests/ambientLxcEnvIsCleared.test.cjs.
process.env.AICA_TEST_AMBIENT_LXC_SWEPT = JSON.stringify(
  Object.keys(clearAmbientLxcEnv())
);

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

// utils/logger.cjs writes logsDir/app.log unconditionally, and that file is
// the record an operator reads to diagnose a live run. Left pointed at the
// checkout's own logs/, a suite run interleaves fixture warnings - and
// literal fixture strings like "not_a_valid_url" - into that same file,
// indistinguishable from the run's own diagnostics (#794). Same isolation as
// MEDIA_ARCHIVE_PATH above, for the same reason: nothing in the suite asserts
// on the real app.log, so writing it has no upside and only a downside.
const LOGS_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), `aica-test-logs-${process.pid}-`)
);
process.env.LOGS_DIR = LOGS_ROOT;

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

  try {
    fs.rmSync(LOGS_ROOT, { force: true, recursive: true });
  } catch (_e) {
    // Ignore cleanup errors
  }
});

export { server };
