const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

/**
 * What the CLI sends is what the operator asked for.
 *
 * `aica generate --accounts 0` generated two accounts, `--products 0` two
 * products and `--orders 0` five, because each count was defaulted with
 * `opts.accountCount || 2` and zero is falsy. The flag parsed correctly and
 * was then discarded, silently, with nothing to say the value had been
 * overridden - so a run that was asked for no accounts created two, and the
 * bug report written from that run described a guard misbehaving rather than
 * the CLI rewriting the request (#926, #927).
 *
 * The CLI is a single script that runs on load rather than a module with
 * exported handlers, so this drives the real binary against a stub of the
 * microservice and reads the payload off the wire. That also makes it a test
 * of the whole path - parse, default, post - rather than of a helper that the
 * argument loop might one day stop calling.
 */
const CLI = path.join(__dirname, '..', '..', '..', 'scripts', 'aica-cli.cjs');

/**
 * Ids the CLI would otherwise resolve interactively or from the environment.
 * Supplied on every run so the payload is reached without a prompt, and so a
 * developer's own `.env` cannot decide what these tests exercise.
 */
const CONTEXT = [
  '--channel-id',
  '1',
  '--site-group-id',
  '2',
  '--catalog-id',
  '3',
  '--non-interactive',
];

/**
 * Runs `aica generate` against a stub that captures the request body.
 *
 * The stub answers without a sessionId, which stops the CLI before it starts
 * polling for progress: the payload - the only thing under test here - has
 * already been sent by then.
 */
async function runGenerate(args) {
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ url: req.url, payload: JSON.parse(body || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'stub: payload read' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, 'generate', ...args], {
        env: {
          ...process.env,
          AICA_MICROSERVICE_URL: `http://127.0.0.1:${port}`,
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

describe('aica generate carries the counts it was given', () => {
  it.each([
    ['--products', 'productCount'],
    ['--accounts', 'accountCount'],
    ['--orders', 'orderCount'],
    ['--warehouse-count', 'warehouseCount'],
  ])('sends %s 0 as a zero rather than its default', async (flag, field) => {
    const { requests } = await runGenerate([...CONTEXT, flag, '0']);

    expect(requests).toHaveLength(1);
    expect(requests[0].payload[field]).toBe(0);
  });

  it('still defaults every count when none is given', async () => {
    const { requests } = await runGenerate(CONTEXT);

    expect(requests[0].payload).toMatchObject({
      accountCount: 2,
      orderCount: 5,
      productCount: 2,
      warehouseCount: 1,
    });
  });

  it('sends a supplied count unchanged', async () => {
    const { requests } = await runGenerate([
      ...CONTEXT,
      '--products',
      '7',
      '--accounts',
      '3',
      '--orders',
      '11',
    ]);

    expect(requests[0].payload).toMatchObject({
      accountCount: 3,
      orderCount: 11,
      productCount: 7,
    });
  });

  // `parseInt('abc', 10)` is NaN. `||` used to hide that behind the default,
  // which is the same defect wearing the opposite coat: the operator's value
  // is not what runs, and nothing says so. `??` would carry the NaN to the
  // API instead, so it is refused here, naming the flag that carried it.
  it.each(['--products', '--accounts', '--orders', '--warehouse-count'])(
    'refuses %s abc rather than defaulting it or sending NaN',
    async (flag) => {
      const { exitCode, requests, stderr } = await runGenerate([
        ...CONTEXT,
        flag,
        'abc',
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(flag);
      expect(requests).toHaveLength(0);
    }
  );

  it('refuses a negative count', async () => {
    const { exitCode, requests, stderr } = await runGenerate([
      ...CONTEXT,
      '--products',
      '-1',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--products');
    expect(requests).toHaveLength(0);
  });

  it('refuses an id flag that does not parse rather than falling back to the picker', async () => {
    const { exitCode, requests, stderr } = await runGenerate([
      '--channel-id',
      'abc',
      '--non-interactive',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--channel-id');
    expect(requests).toHaveLength(0);
  });
});
