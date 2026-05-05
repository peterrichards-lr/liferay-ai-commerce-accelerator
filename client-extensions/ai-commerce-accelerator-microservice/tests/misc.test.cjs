const { createERC } = require('../utils/misc.cjs');

describe('Misc Utilities', () => {
  describe('createERC', () => {
    it('should generate unique ERCs even when called rapidly', () => {
      const erc1 = createERC('TEST');
      const erc2 = createERC('TEST');

      expect(erc1).not.toBe(erc2);
    });

    it('should include the provided prefix', () => {
      const prefix = 'MY-PREFIX';
      const erc = createERC(prefix);

      expect(erc.startsWith(prefix)).toBe(true);
    });

    it('should generate many unique ERCs', () => {
      const ercs = new Set();
      const count = 5000;

      for (let i = 0; i < count; i++) {
        ercs.add(createERC('TEST'));
      }

      expect(ercs.size).toBe(count);
    });
  });
});
