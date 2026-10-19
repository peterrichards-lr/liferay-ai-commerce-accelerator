import { onTestFinished, vi } from 'vitest';

/**
 * Captures `console.error` for one test, so a deliberately-exercised failure
 * path does not print a failure-shaped line into a passing run.
 *
 * It cost real time. A `git push` failed with `husky - pre-push script failed
 * (code 1)` and succeeded, unchanged, on the retry. Reading the surrounding
 * output, the failure was attributed to lines that a *passing* test had
 * printed - and the actual failing step was never identified, because it was
 * interleaved with forty lines of expected-but-alarming output. See #1328.
 *
 * Captured rather than suppressed, deliberately. Reporting to the browser
 * console is correct behaviour in production: a user whose import fails should
 * be able to find out why. Silencing it in the component would fix the
 * terminal by removing something real, so the spy returns and the caller
 * asserts the report was made. A `.mockImplementation(() => {})` with nothing
 * asserted is the same defect wearing the other mask - output nobody reads,
 * which is where this started.
 *
 * Restored through `onTestFinished`, so a failing assertion cannot leak the
 * spy into the next test in the file.
 */
export function captureConsoleErrors() {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  onTestFinished(() => spy.mockRestore());
  return spy;
}
