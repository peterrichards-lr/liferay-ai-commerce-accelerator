import { describe, it, expect } from 'vitest';
import { getTotalProgress, hasOutstandingSteps } from './progressSelectors';

const inPlay = (isDone) => ({ total: 10, completed: 0, isDone });

/** Every milestone in play, so each one is worth 12.5% of the aggregate. */
const allEightInPlay = (doneIds = []) => ({
  products: inPlay(doneIds.includes('products')),
  accounts: inPlay(doneIds.includes('accounts')),
  orders: inPlay(doneIds.includes('orders')),
  warehouses: inPlay(doneIds.includes('warehouses')),
  addresses: inPlay(doneIds.includes('addresses')),
  images: inPlay(doneIds.includes('images')),
  pdfs: inPlay(doneIds.includes('pdfs')),
  priceLists: inPlay(doneIds.includes('pricing')),
  promotions: inPlay(doneIds.includes('pricing')),
});

describe('progressSelectors', () => {
  describe('getTotalProgress', () => {
    it('should return 0% when no milestones are done', () => {
      const progress = {
        products: { total: 10, completed: 5, isDone: false },
        accounts: { total: 5, completed: 0, isDone: false },
      };
      const result = getTotalProgress(progress);
      expect(result.percentage).toBe(0);
      expect(result.doneCount).toBe(0);
    });

    it('should increment by exactly 12.5% for each done milestone', () => {
      const result = getTotalProgress(allEightInPlay(['products', 'accounts']));
      // 2 out of 8 milestones = 25%
      expect(result.percentage).toBe(25);
      expect(result.doneCount).toBe(2);
    });

    it('should combine priceLists and promotions into a single pricing milestone', () => {
      const progressOnlyLists = {
        ...allEightInPlay(),
        priceLists: inPlay(true),
      };
      expect(getTotalProgress(progressOnlyLists).doneCount).toBe(0);

      expect(getTotalProgress(allEightInPlay(['pricing'])).doneCount).toBe(1);
      expect(getTotalProgress(allEightInPlay(['pricing'])).percentage).toBe(
        12.5
      );
    });

    it('should return 100% if workflowStatus is completed regardless of markers', () => {
      const progress = {
        workflowStatus: 'completed',
        products: { isDone: false },
      };
      const result = getTotalProgress(progress);
      expect(result.percentage).toBe(100);
      expect(result.completed).toBe(100);
    });

    it('should correctly count all 8 milestones', () => {
      const result = getTotalProgress(
        allEightInPlay([
          'products',
          'accounts',
          'orders',
          'warehouses',
          'addresses',
          'images',
          'pdfs',
          'pricing',
        ])
      );
      expect(result.doneCount).toBe(8);
      expect(result.percentage).toBe(100);
    });
  });
});

// The 2026-09-09 delete run displayed "COMPLETED, 100% Total Removal" while it
// was two thirds through: six steps of fifteen, delete-products still PREPARED
// at 0 of 50, and eight entities showing "Done, 0 Deleted" for work the run had
// not reached. Three faults were reported against steps that had not run yet.
describe('a delete two thirds through does not read as finished (#786)', () => {
  // The export taken at the moment the UI said finished.
  const runAtSixOfFifteenSteps = () => ({
    workflowStatus: 'completed',
    activeFlowType: 'delete',
    totalSteps: 15,
    completedSteps: 6,
    products: { total: 50, completed: 0, isDone: false },
    accounts: { total: 2, completed: 0, isDone: false },
    orders: { total: 32, completed: 32, isDone: true },
    warehouses: { total: 5, completed: 5, isDone: true },
    priceLists: { total: 2, completed: 0, isDone: false },
    promotions: { total: 2, completed: 0, isDone: false },
    // Nothing of these was found to delete, and their steps still reported
    // a completion each.
    skus: { total: 0, completed: 0, isDone: true },
    addresses: { total: 0, completed: 0, isDone: true },
    images: { total: 0, completed: 0, isDone: true },
    pdfs: { total: 0, completed: 0, isDone: true },
  });

  it('does not report 100% while nine of fifteen steps are outstanding', () => {
    const result = getTotalProgress(runAtSixOfFifteenSteps());

    expect(result.percentage).toBeLessThan(100);
    expect(result.completed).toBeLessThan(100);
  });

  it('does not count an entity the delete never touched towards the aggregate', () => {
    const { entityCount, doneCount } = getTotalProgress(
      runAtSixOfFifteenSteps()
    );

    // products, accounts, orders, warehouses and pricing were in play;
    // addresses, images and PDFs were not.
    expect(entityCount).toBe(5);
    expect(doneCount).toBe(2);
  });

  it('reads as finished once every step has reported', () => {
    const result = getTotalProgress({
      ...runAtSixOfFifteenSteps(),
      completedSteps: 15,
    });

    expect(result.percentage).toBe(100);
  });

  it('will not let a milestone aggregate outrun the steps that remain', () => {
    // Both entity bars in play are done, but five steps have yet to report.
    const result = getTotalProgress({
      workflowStatus: 'running',
      totalSteps: 20,
      completedSteps: 15,
      products: { total: 50, completed: 50, isDone: true },
      accounts: { total: 2, completed: 2, isDone: true },
    });

    expect(result.percentage).toBe(75);
  });

  it('leaves the aggregate to the entity bars when no step total is known', () => {
    const result = getTotalProgress({
      workflowStatus: 'running',
      products: { total: 50, completed: 50, isDone: true },
      accounts: { total: 2, completed: 2, isDone: true },
    });

    expect(result.percentage).toBe(100);
  });

  it('reports nothing done before anything is in play', () => {
    const result = getTotalProgress({
      workflowStatus: 'running',
      totalSteps: 15,
      completedSteps: 0,
    });

    expect(result.percentage).toBe(0);
    expect(result.entityCount).toBe(0);
  });
});

describe('hasOutstandingSteps', () => {
  it('reports the steps a delete run had left at the moment it claimed to be done', () => {
    expect(hasOutstandingSteps({ totalSteps: 15, completedSteps: 6 })).toBe(
      true
    );
  });

  it('reports none once every step has completed', () => {
    expect(hasOutstandingSteps({ totalSteps: 15, completedSteps: 15 })).toBe(
      false
    );
  });

  // Nothing is known about a run whose step total never arrived, and an
  // unknown must not be read as evidence of work outstanding.
  it('claims nothing when the step total is unknown', () => {
    expect(hasOutstandingSteps({ completedSteps: 0 })).toBe(false);
    expect(hasOutstandingSteps(null)).toBe(false);
  });
});
