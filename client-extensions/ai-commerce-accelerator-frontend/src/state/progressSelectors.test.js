import { describe, it, expect } from 'vitest';
import { getTotalProgress } from './progressSelectors';

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
      const progress = {
        products: { isDone: true },
        accounts: { isDone: true },
      };
      const result = getTotalProgress(progress);
      // 2 out of 8 milestones = 25%
      expect(result.percentage).toBe(25);
      expect(result.doneCount).toBe(2);
    });

    it('should combine priceLists and promotions into a single pricing milestone', () => {
      const progressOnlyLists = {
        priceLists: { isDone: true },
        promotions: { isDone: false },
      };
      expect(getTotalProgress(progressOnlyLists).doneCount).toBe(0);

      const progressBoth = {
        priceLists: { isDone: true },
        promotions: { isDone: true },
      };
      expect(getTotalProgress(progressBoth).doneCount).toBe(1);
      expect(getTotalProgress(progressBoth).percentage).toBe(12.5);
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
      const progress = {
        products: { isDone: true },
        accounts: { isDone: true },
        orders: { isDone: true },
        warehouses: { isDone: true },
        addresses: { isDone: true },
        images: { isDone: true },
        pdfs: { isDone: true },
        priceLists: { isDone: true },
        promotions: { isDone: true },
      };
      const result = getTotalProgress(progress);
      expect(result.doneCount).toBe(8);
      expect(result.percentage).toBe(100);
    });
  });
});
