const {
  uniqueOrderERC,
  withUniqueOrderERCs,
} = require('../utils/orderErc.cjs');

describe('order external reference codes', () => {
  it('keeps a code the model supplied when it is unique', () => {
    const seen = new Set();

    expect(uniqueOrderERC('ORD-001', seen)).toBe('ORD-001');
    expect(uniqueOrderERC('ORD-002', seen)).toBe('ORD-002');
  });

  it('replaces a repeat rather than sending it twice', () => {
    // The model copies the prompt's example onto every order. Liferay rejects
    // the batch with ConstraintViolationException, which names the constraint
    // and not the duplicate.
    const seen = new Set();

    const first = uniqueOrderERC('ORD-001', seen);
    const second = uniqueOrderERC('ORD-001', seen);

    expect(first).toBe('ORD-001');
    expect(second).not.toBe('ORD-001');
    expect(second).toMatch(/^AICA-ORD/);
  });

  it('generates one when the model supplied nothing usable', () => {
    const seen = new Set();

    for (const value of [undefined, null, '', '   ']) {
      expect(uniqueOrderERC(value, seen)).toMatch(/^AICA-ORD/);
    }

    // Four generated codes, all distinct.
    expect(seen.size).toBe(4);
  });

  it('gives fifty orders sharing one code fifty distinct codes', () => {
    const orders = Array.from({ length: 50 }, () => ({
      externalReferenceCode: 'ORD-001',
      orderStatus: 10,
    }));

    const result = withUniqueOrderERCs(orders);
    const codes = result.map((o) => o.externalReferenceCode);

    expect(new Set(codes).size).toBe(50);
    // The first is kept: a readable code is worth preserving where it can be.
    expect(codes[0]).toBe('ORD-001');
  });

  it('leaves the rest of the order untouched', () => {
    const [order] = withUniqueOrderERCs([
      { externalReferenceCode: 'ORD-001', orderStatus: 10, accountId: 42 },
    ]);

    expect(order.orderStatus).toBe(10);
    expect(order.accountId).toBe(42);
  });

  it('handles an empty or missing list', () => {
    expect(withUniqueOrderERCs([])).toEqual([]);
    expect(withUniqueOrderERCs(null)).toEqual([]);
  });
});
