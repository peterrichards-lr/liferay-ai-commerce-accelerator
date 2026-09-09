import { defineConfig } from 'vitest/config';

/**
 * A worker that dies mid-run leaves its test files reported as neither passed
 * nor failed, and the summary line reads "74 passed (79)" — five files and
 * thirty-nine tests that never executed, with nothing in the exit status to
 * say so. The five were the delete path's only coverage, so a green CI run
 * there means nothing at all. See #793.
 *
 * This compares what vitest planned to run against what reached a terminal
 * state, so it needs no expected count to keep up to date and stays correct as
 * test files are added. Setting process.exitCode is enough: vitest's own
 * `exit()` calls process.exit() with no argument, and nothing in the shutdown
 * path clears a code already set.
 */
class CompleteRunReporter {
  planned = 0;

  onTestRunStart(specifications) {
    this.planned = specifications.length;
  }

  onTestRunEnd(testModules) {
    // A skipped file is a deliberate choice and reaches a terminal state; only
    // pending and queued mean the file was planned and never got there.
    const unfinished = testModules.filter((testModule) =>
      ['pending', 'queued'].includes(testModule.state())
    );

    const missing = Math.max(0, this.planned - testModules.length);

    if (!unfinished.length && !missing) {
      return;
    }

    console.error(
      `\n[CompleteRunReporter] ${unfinished.length + missing} of ${this.planned} test files did not run to completion. A worker most likely died; the run is not trustworthy.`
    );

    for (const testModule of unfinished) {
      console.error(`  ${testModule.moduleId} (${testModule.state()})`);
    }

    process.exitCode = 1;
  }
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{cjs,mjs}'],
    setupFiles: ['./tests/setup.mjs'],
    reporters: ['default', 'junit', new CompleteRunReporter()],
    outputFile: {
      junit: './vitest-report-microservice.xml',
    },
    pool: 'forks',
    server: {
      deps: {
        inline: true,
      },
    },
    coverage: {
      provider: 'v8',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/mocks/**',
        '**/scripts/**',
      ],
      thresholds: {
        statements: 45,
        lines: 45,
      },
    },
  },
  resolve: {
    mainFields: ['main', 'module'],
    conditions: ['node', 'require'],
  },
});
