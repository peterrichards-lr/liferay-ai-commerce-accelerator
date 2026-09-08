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
    expect(warehouseERC(hamburg)).toMatch(/^AICA-WH-/);
  });

  it('gives the same place the same code every time', () => {
    expect(warehouseERC(hamburg)).toBe(warehouseERC(hamburg));
  });

  it('gives different places different codes', () => {
    expect(warehouseERC(hamburg)).not.toBe(warehouseERC(munich));
    expect(warehouseERC(hamburg)).not.toBe(warehouseERC(sanJose));
  });

  it('does not depend on the name, which is prose the model may rephrase', () => {
    expect(warehouseERC({ ...hamburg, name: { en_US: 'Hamburg Hub' } })).toBe(
      warehouseERC({ ...hamburg, name: { en_US: 'Northern Distribution' } })
    );
  });

  it('separates a second warehouse in the same city', () => {
    expect(warehouseERC(hamburg, 2)).not.toBe(warehouseERC(hamburg));
  });

  it('survives a warehouse with no location at all', () => {
    expect(warehouseERC({})).toMatch(/^AICA-WH-/);
  });
});

describe('isAssignedWarehouseERC', () => {
  it('recognises a code we assigned', () => {
    expect(isAssignedWarehouseERC(warehouseERC(hamburg))).toBe(true);
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

  it('produces the same codes for the same catalogue on a second run', () => {
    // The whole point: a repeat run has to land on the warehouses the first
    // run created rather than making a second set beside them (#730).
    expect(codes(assignWarehouseERCs([hamburg, munich]))).toEqual(
      codes(assignWarehouseERCs([hamburg, munich]))
    );
  });

  it('does not depend on the order the warehouses arrive in', () => {
    expect(codes(assignWarehouseERCs([hamburg, munich])).sort()).toEqual(
      codes(assignWarehouseERCs([munich, hamburg])).sort()
    );
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
    const original = warehouseERC(hamburg);
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
    const original = warehouseERC(hamburg);
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
