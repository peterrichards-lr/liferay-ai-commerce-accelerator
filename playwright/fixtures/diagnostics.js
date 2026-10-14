import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

/**
 * Browser diagnostics, attached to every test rather than to the three that
 * remembered to ask (#1286).
 *
 * Run 38410417089 produced 371 lines of browser diagnostics and put none of
 * them in the uploaded artifact. Seventy of those lines were the only trace
 * anywhere of the failure that cost nine days:
 *
 *     [Browser Console] WARNING: [AICA OAuth2] Could not acquire OAuth2 access
 *       token: No redirectURI in http://localhost/o/oauth2/redirect matching
 *       origin https://aica-e2e.demo
 *
 * That line is `oauth2Service.js`'s catch block. It is not in Liferay's log,
 * because Liferay was never asked; not in the microservice's, because the
 * microservice sees a request with no header and nothing else; and not in the
 * DXP tree capture, because that records the value rather than what was
 * refused because of it. Searching the artifact harder would never have found
 * it, and I reported the cause as exonerated on the strength of its absence.
 *
 * Two properties this file exists to hold:
 *
 *   - `auto: true`, so coverage does not depend on a spec opting in. The
 *     listeners used to live in `injectAndConnectApp`, which three of five
 *     suites call; the other two produced no console output at all, and an
 *     absent diagnostic reads exactly like a clean one. LDM shipped the same
 *     construction in their #2135 - five assertions resolved against an
 *     impossible path, reported SKIPPED, and were read as passes across three
 *     verification runs on three platforms.
 *
 *   - a header per test whether or not anything is logged, so "quiet" and
 *     "did not run" stop being the same bytes.
 */
const LOG_PATH = path.join(process.cwd(), 'logs', 'e2e-browser-console.log');

/**
 * Truncated on the first write of each process, not on import.
 *
 * A stale file from a previous local run is worse than no file: it reads as
 * this run's evidence. Doing it on first write rather than at import keeps a
 * process that runs no tests from destroying the last run's capture.
 */
let started = false;

function append(line) {
  // A diagnostic must never be a second way for the run to die (#1238). An
  // unwritable logs/ is a reason to lose the capture, not the suite.
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, `${line}\n`, { flag: started ? 'a' : 'w' });
    started = true;
  } catch {
    // Deliberately silent: reporting it would need the channel that failed.
  }
}

export const test = base.extend({
  browserDiagnostics: [
    async ({ page }, use, testInfo) => {
      append(`=== ${testInfo.titlePath.join(' › ')} ===`);

      let recorded = 0;

      // Both destinations, on purpose. The file is what the artifact carries;
      // stdout interleaved with the test output is what makes a single
      // failure readable while it is happening.
      const record = (line) => {
        recorded += 1;
        console.log(line);
        append(line);
      };

      // No level filter. WARNING is what carried the OAuth failure, and a
      // filter tuned to a known failure is how the next one gets dropped.
      page.on('console', (msg) =>
        record(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`)
      );
      page.on('pageerror', (exception) =>
        record(`[Browser Exception] ${exception}`)
      );
      page.on('requestfailed', (request) =>
        record(
          `[Network Error] ${request.url()} - ${request.failure()?.errorText}`
        )
      );
      page.on('response', (response) => {
        if (response.status() >= 400) {
          record(`[Network 4xx/5xx] ${response.status()} - ${response.url()}`);
        }
      });

      await use();

      if (recorded === 0) {
        append('(ran, logged nothing)');
      }
    },
    { auto: true },
  ],
});

export { expect };
