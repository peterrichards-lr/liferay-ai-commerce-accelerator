const { topUpBudget } = require('../services/aiService.cjs');

describe('topUpBudget', () => {
  // A top-up asks for at most one chunk, so two attempts add at most two
  // chunks. A live run delivered 16 of 50 across 5 chunks: two top-ups could
  // have reached 36 at best and never 50, however many items each returned.
  // The budget has to scale with the run (#759).
  it('gives a large run enough attempts to close its gap', () => {
    expect(topUpBudget(5)).toBe(5);
  });

  it('never drops below the original two for a small run', () => {
    expect(topUpBudget(1)).toBe(2);
    expect(topUpBudget(2)).toBe(2);
  });

  // A model returning one item per round must not be able to bill for a
  // hundred of them. The real brake is the loop breaking as soon as a round
  // adds nothing; this is the backstop for a model that keeps trickling.
  it('caps a very large run rather than scaling without limit', () => {
    expect(topUpBudget(50)).toBe(10);
    expect(topUpBudget(1000)).toBe(10);
  });

  it('survives a nonsensical chunk count', () => {
    expect(topUpBudget(0)).toBe(2);
  });
});
