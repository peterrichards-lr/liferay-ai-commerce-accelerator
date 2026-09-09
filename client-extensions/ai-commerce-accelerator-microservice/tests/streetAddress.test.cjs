const {
  STREET_NAMES,
  STREET_TYPES,
  streetLine,
  syntheticStreetLine,
} = require('../utils/streetAddress.cjs');

const LINE = /^(\d{1,3}) ([A-Z][a-z]+) (Street|Avenue|Road|Lane)$/;

describe('streetLine', () => {
  // The model returns a street with the city and postcode it chose, and it was
  // overwritten with randomString(8) - "822 fiiqbmgf Road, London, W1D 3QJ",
  // on the live path as well as in demo mode (#826).
  it('keeps the street the model supplied', () => {
    expect(
      streetLine({
        streetAddressLine1: '399 Camden High Street',
        addressLocality: 'London',
      })
    ).toBe('399 Camden High Street');
  });

  // mockDataGenerator already builds plausible lines of its own, so demo mode
  // is fixed by not discarding them rather than by a second word list.
  it('keeps the street demo mode supplied', () => {
    expect(streetLine({ streetAddressLine1: '412 Logistics Ave' })).toBe(
      '412 Logistics Ave'
    );
  });

  // A blank first line reads worse on screen than an invented one.
  it('falls back when the model named no street', () => {
    [undefined, {}, { streetAddressLine1: '' }, { streetAddressLine1: '   ' }]
      .map((address) => streetLine(address))
      .forEach((line) => expect(line).toMatch(LINE));
  });

  it('ignores a street that is not a string', () => {
    expect(streetLine({ streetAddressLine1: 42 })).toMatch(LINE);
    expect(streetLine({ streetAddressLine1: null })).toMatch(LINE);
  });
});

describe('syntheticStreetLine', () => {
  // The defect was not the shape but the name: eight random lowercase letters
  // next to a real postcode. Every generated name has to be a word.
  it('reads as an address, not as a random string', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const line = syntheticStreetLine();
      const [, number, name, type] = line.match(LINE) || [];

      expect(line, `${line} is not a plausible street line`).toMatch(LINE);
      expect(Number(number)).toBeGreaterThan(0);
      expect(STREET_NAMES).toContain(name);
      expect(STREET_TYPES).toContain(type);
    }
  });

  it('offers enough names to vary across a run', () => {
    expect(STREET_NAMES.length).toBeGreaterThan(20);
    expect(new Set(STREET_NAMES).size).toBe(STREET_NAMES.length);
  });
});
