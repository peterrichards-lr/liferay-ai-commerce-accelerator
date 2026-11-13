const { countCompletedSteps } = require('../routes/workflow.cjs');

/**
 * The status route's step count, which the frontend's gauge will not let
 * reach 100% while any step is outstanding (#786).
 *
 * It used to report the steps in flight, which the SDK empties when a session
 * ends, so every finished session read 0 of its steps done. The E2E's delete
 * and generate runs completed in seconds and sat at "0% Total Removal" until
 * the spec timed out (#1390).
 */
describe('workflow status: completed steps (#1390)', () => {
  const batch = (step_key, status) => ({ step_key, status });

  it('reports every step done for a COMPLETED session, whose in-flight list is empty', () => {
    expect(
      countCompletedSteps({ status: 'COMPLETED', currentSteps: [] }, [], 15)
    ).toBe(15);
  });

  it('counts the steps whose batches are all terminal while a session runs', () => {
    const batches = [
      batch('discover', 'SYNCHRONOUS'),
      batch('delete-orders', 'BYPASSED'),
      batch('delete-products', 'COMPLETED'),
      batch('delete-products', 'PROCESSING'),
      batch('delete-accounts', 'STARTED'),
    ];

    expect(
      countCompletedSteps(
        { status: 'STARTED', currentSteps: ['delete-products'] },
        batches,
        15
      )
    ).toBe(2);
  });

  it('does not count a failed step as done', () => {
    expect(
      countCompletedSteps(
        { status: 'FAILED', currentSteps: [] },
        [batch('discover', 'SYNCHRONOUS'), batch('delete-orders', 'FAILED')],
        15
      )
    ).toBe(1);
  });

  it('never reports more steps done than the session has', () => {
    const batches = ['a', 'b', 'c', 'd'].map((key) => batch(key, 'COMPLETED'));

    expect(
      countCompletedSteps({ status: 'STARTED', currentSteps: [] }, batches, 3)
    ).toBe(3);
  });
});
