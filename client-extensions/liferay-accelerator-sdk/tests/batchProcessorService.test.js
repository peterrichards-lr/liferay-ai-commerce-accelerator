import { describe, it, expect, vi, beforeEach } from 'vitest';
const BatchProcessorService = require('../src/services/batchProcessorService.cjs');

describe('BatchProcessorService', () => {
  let service;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
    };
    service = new BatchProcessorService(mockCtx);
  });

  describe('processBatch', () => {
    it('should process items in chunks', async () => {
      const items = [1, 2, 3, 4, 5];
      const processed = [];
      const fn = async (item) => {
        processed.push(item);
        return item * 2;
      };

      const result = await service.processBatch(items, fn, 2);

      expect(processed).toEqual([1, 2, 3, 4, 5]);
      expect(result.successful).toEqual([2, 4, 6, 8, 10]);
      expect(result.processed).toBe(5);
    });

    it('should handle failures and continue by default', async () => {
      const items = [1, 2, 3];
      const fn = async (item) => {
        if (item === 2) {
          const err = new Error('Fail');
          err.response = { status: 400 }; // Non-retryable
          throw err;
        }
        return item;
      };

      const result = await service.processBatch(items, fn, 1);

      expect(result.successful).toEqual([1, 3]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Fail');
    });
  });

  describe('processSequentially', () => {
    it('should process items one by one', async () => {
      const items = [1, 2, 3];
      const processed = [];
      const fn = async (item) => {
        processed.push(item);
        return item;
      };

      await service.processSequentially(items, fn);
      expect(processed).toEqual([1, 2, 3]);
    });
  });
});
