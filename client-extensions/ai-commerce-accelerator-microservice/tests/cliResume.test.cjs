const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const { parseControlOptions } = require('../../../scripts/aica-cli.cjs');

const CLI = path.join(__dirname, '..', '..', '..', 'scripts', 'aica-cli.cjs');

/**
 * `aica import --resume <sessionId>` reaches the resume endpoint.
 *
 * The CLI is a script that runs on load rather than a module of exported
 * handlers, so - as `cliCounts.test.cjs` does, and for the same reason - this
 * drives the real binary against a stub of the microservice and reads what
 * arrived. A test of the parser alone would pass with the flag parsed and then
 * dropped, which is the shape of #927.
 */
async function runImport(args) {
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // No `success`, so the CLI stops before polling for progress. The
      // request - the only thing under test - has already been made.
      res.end(JSON.stringify({ success: false, error: 'stub: request read' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, 'import', ...args], {
        env: {
          ...process.env,
          AICA_MICROSERVICE_URL: `http://127.0.0.1:${port}`,
          // Stated rather than defaulted. The CLI used to fall back to the
          // end-to-end suite's hostname when no target was configured; it now
          // refuses, so a test that drives the real binary has to say which
          // Liferay it means (#1053). Incidental to what is asserted here - the
          // request that reaches the stub - but required to get that far.
          LIFERAY_URL: 'http://liferay.test:8080',
        },
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (exitCode) => resolve({ exitCode, stderr, stdout }));
    });

    return { ...result, requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('aica import --resume', () => {
  it('posts to the resume endpoint for the named session', async () => {
    const { requests } = await runImport(['--resume', 'AICA-SESSION-12345']);

    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/api/v1/workflows/sessions/AICA-SESSION-12345/resume',
      },
    ]);
  }, 20000);

  it('sends no dataset, because the session already holds one', async () => {
    // Re-uploading would build a second session that knew none of the ids the
    // first one resolved, and would redo every step that had succeeded - which
    // is the whole of #895.
    const { requests } = await runImport(['--resume', 'AICA-SESSION-12345']);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).not.toContain('import-commerce-data');
  }, 20000);

  it('does not ask for a file it no longer needs', async () => {
    const { stderr } = await runImport(['--resume', 'AICA-SESSION-12345']);

    expect(stderr).not.toContain('Please specify a dataset');
  }, 20000);

  it('still requires a dataset when no session is named', async () => {
    const { exitCode, stderr } = await runImport([]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Please specify a dataset');
  }, 20000);

  describe('the flag itself', () => {
    it('reads the session id from the following argument', () => {
      expect(parseControlOptions(['--resume', 'S-1'])).toMatchObject({
        resume: 'S-1',
      });
    });

    it('reads it from an inline value too', () => {
      expect(parseControlOptions(['--resume=S-1'])).toMatchObject({
        resume: 'S-1',
      });
    });

    it('is absent when it was not given', () => {
      expect(parseControlOptions(['--non-interactive']).resume).toBeUndefined();
    });
  });
});
