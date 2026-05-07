const AccountGenerator = require('../generators/accountGenerator.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const OrderGenerator = require('../generators/orderGenerator.cjs');
const WarehouseGenerator = require('../generators/warehouseGenerator.cjs');
const DeleteCoordinatorService = require('../services/deleteCoordinatorService.cjs');

describe('Generator Interface Parity', () => {
  const mockCtx = {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    },
    persistence: {
      getSession: vi.fn(),
      createSession: vi.fn(),
      updateSessionContext: vi.fn(),
    },
    liferay: {},
    progress: {
      sessionStarted: vi.fn(),
      sessionCompleted: vi.fn(),
      stepStarted: vi.fn(),
      stepCompleted: vi.fn(),
    },
    batchCallback: { _checkSessionCompletion: vi.fn() },
    generation: {},
  };

  const generators = [
    { name: 'AccountGenerator', instance: new AccountGenerator(mockCtx) },
    { name: 'ProductGenerator', instance: new ProductGenerator(mockCtx) },
    { name: 'OrderGenerator', instance: new OrderGenerator(mockCtx) },
    { name: 'WarehouseGenerator', instance: new WarehouseGenerator(mockCtx) },
    {
      name: 'DeleteCoordinator',
      instance: new DeleteCoordinatorService(mockCtx),
    },
  ];

  it('should ensure all generators implement runWorkflow', () => {
    generators.forEach(({ name, instance }) => {
      expect(typeof instance.runWorkflow, `${name} missing runWorkflow`).toBe(
        'function'
      );
    });
  });

  it('should ensure all registered workflow steps have valid handlers', () => {
    generators.forEach(({ name, instance }) => {
      // This calls the internal verifySteps check we added previously
      expect(
        () => instance.verifySteps(),
        `${name} has broken step mappings`
      ).not.toThrow();
    });
  });

  it('should ensure all generators implement handleBatchCallback', () => {
    generators.forEach(({ name, instance }) => {
      expect(
        typeof instance.handleBatchCallback,
        `${name} missing handleBatchCallback`
      ).toBe('function');
    });
  });

  describe('Liferay Method Availability', () => {
    const fs = require('fs');
    const path = require('path');
    const { LiferayService } = require('../services/liferay/index.cjs');
    const liferayService = new LiferayService(mockCtx);

    const generatorFiles = [
      'accountGenerator.cjs',
      'productGenerator.cjs',
      'orderGenerator.cjs',
      'warehouseGenerator.cjs',
      'baseGenerator.cjs',
    ];

    it('should ensure all this.liferay calls in source code exist in LiferayService', () => {
      generatorFiles.forEach((file) => {
        const filePath = path.join(__dirname, '../generators', file);
        const content = fs.readFileSync(filePath, 'utf8');

        // Find all "this.liferay.methodName(" patterns
        const regex = /this\.liferay\.([a-zA-Z0-9_]+)\(/g;
        let match;
        const methods = new Set();

        while ((match = regex.exec(content)) !== null) {
          methods.add(match[1]);
        }

        methods.forEach((method) => {
          expect(
            typeof liferayService[method],
            `${file} calls missing liferay method: ${method}`
          ).toBe('function');
        });
      });
    });
  });
});
