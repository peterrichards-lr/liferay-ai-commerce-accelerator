const {
  assignWarehouseERCs,
  isAssignedWarehouseERC,
  warehouseERC,
} = require('../utils/warehouseErc.cjs');

const hamburg = { city: 'Hamburg', country: 'DE' };
const munich = { city: 'Munich', country: 'DE' };
const sanJose = { city: 'San Jose', country: 'US' };

const codes = (warehouses) =>
  warehouses.map((warehouse) => warehouse.externalReferenceCode);

describe('warehouseERC', () => {
  it('uses the prefix the code already declared', () => {
    // ERC_PREFIX.WAREHOUSE was 'AICA-WH' while the prompt asked the model for
    // 'AICA-WAREHOUSE-'. Even the prefix disagreed.
    expect(warehouseERC()).toMatch(/^AICA-WH-/);
  });

  // Deliberately not derived from the warehouse's location. A code hashed from
  // country and city would give a newly generated warehouse in an existing
  // warehouse's city the same code, so the create would become an upsert and a
  // run asked for five would end with four - silently.
  it('is a new code every time, so a new warehouse is never an existing one', () => {
    expect(warehouseERC()).not.toBe(warehouseERC());
  });

  it('is unique across runs, not merely within one', () => {
    // An index-based code would make a second run's first warehouse upsert
    // onto the first run's - the same hazard inverted.
    const codes = new Set(Array.from({ length: 200 }, () => warehouseERC()));

    expect(codes.size).toBe(200);
  });
});

describe('isAssignedWarehouseERC', () => {
  it('recognises a code we assigned', () => {
    expect(isAssignedWarehouseERC(warehouseERC())).toBe(true);
  });

  it('rejects the shape the prompt used to ask the model for', () => {
    expect(isAssignedWarehouseERC('AICA-WAREHOUSE-HAMBURG')).toBe(false);
  });

  it('rejects anything that is not a usable string', () => {
    expect(isAssignedWarehouseERC(undefined)).toBe(false);
    expect(isAssignedWarehouseERC('')).toBe(false);
    expect(isAssignedWarehouseERC(42)).toBe(false);
  });
});

describe('assignWarehouseERCs', () => {
  it('assigns a code to every warehouse', () => {
    const assigned = assignWarehouseERCs([hamburg, munich, sanJose]);

    expect(codes(assigned)).toHaveLength(3);
    codes(assigned).forEach((erc) => expect(erc).toMatch(/^AICA-WH-/));
  });

  it('never reuses a code between runs, so a top-up cannot silently upsert', () => {
    // Whether a warehouse already exists is answered by counting what is in
    // the instance, not by recognising a place - so two runs over the same
    // catalogue must produce different codes (#730).
    const first = codes(assignWarehouseERCs([hamburg, munich]));
    const second = codes(assignWarehouseERCs([hamburg, munich]));

    expect(first.some((erc) => second.includes(erc))).toBe(false);
  });

  it('replaces a code the model supplied', () => {
    // The model copying the prompt's example onto every item is a documented
    // failure mode; Liferay rejects the whole batch naming the constraint
    // rather than the duplicate. See utils/orderErc.cjs.
    const assigned = assignWarehouseERCs([
      { ...hamburg, externalReferenceCode: 'AICA-WAREHOUSE-HAMBURG' },
      { ...munich, externalReferenceCode: 'AICA-WAREHOUSE-HAMBURG' },
    ]);

    expect(codes(assigned)[0]).not.toBe(codes(assigned)[1]);
    codes(assigned).forEach((erc) => expect(erc).toMatch(/^AICA-WH-/));
  });

  it('keeps a code we assigned before, so a re-import preserves identity', () => {
    const original = warehouseERC();
    const assigned = assignWarehouseERCs([
      { ...hamburg, externalReferenceCode: original },
    ]);

    expect(codes(assigned)).toEqual([original]);
  });

  it('de-duplicates two warehouses in the same city', () => {
    const assigned = assignWarehouseERCs([hamburg, { ...hamburg }]);

    expect(codes(assigned)[0]).not.toBe(codes(assigned)[1]);
    expect(new Set(codes(assigned)).size).toBe(2);
  });

  it('de-duplicates a repeated code that was previously ours', () => {
    const original = warehouseERC();
    const assigned = assignWarehouseERCs([
      { ...hamburg, externalReferenceCode: original },
      { ...hamburg, externalReferenceCode: original },
    ]);

    expect(new Set(codes(assigned)).size).toBe(2);
  });

  it('leaves the rest of the warehouse untouched', () => {
    const [assigned] = assignWarehouseERCs([
      { ...hamburg, active: true, name: { en_US: 'Hamburg Hub' } },
    ]);

    expect(assigned.name).toEqual({ en_US: 'Hamburg Hub' });
    expect(assigned.active).toBe(true);
    expect(assigned.city).toBe('Hamburg');
  });

  it('survives an empty or missing list', () => {
    expect(assignWarehouseERCs([])).toEqual([]);
    expect(assignWarehouseERCs(undefined)).toEqual([]);
  });
});
