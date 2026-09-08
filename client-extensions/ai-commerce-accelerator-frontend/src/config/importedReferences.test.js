import { describe, expect, it } from 'vitest';
import {
  NOTHING_REQUESTED,
  NOTHING_TO_MATCH,
  RESOLVED_BY_ID,
  RESOLVED_BY_NAME,
  UNRESOLVED,
  describeResolution,
  resolveImportedReference,
} from './importedReferences';

const CATALOGS = [
  { id: 101, name: 'Default Catalog' },
  { id: 102, name: 'Spare Parts' },
];

describe('resolveImportedReference', () => {
  it('uses the id when the id exists in the loaded list', () => {
    const { item, outcome } = resolveImportedReference({
      items: CATALOGS,
      id: 102,
      name: 'Default Catalog',
    });

    expect(outcome).toBe(RESOLVED_BY_ID);
    expect(item.id).toBe(102);
  });

  it('matches a string id against a numeric one', () => {
    const { item, outcome } = resolveImportedReference({
      items: CATALOGS,
      id: '101',
      name: 'Default Catalog',
    });

    expect(outcome).toBe(RESOLVED_BY_ID);
    expect(item.id).toBe(101);
  });

  it('falls back to the name when the id is dead', () => {
    const { item, outcome } = resolveImportedReference({
      items: CATALOGS,
      id: 34205,
      name: 'Spare Parts',
    });

    expect(outcome).toBe(RESOLVED_BY_NAME);
    expect(item.id).toBe(102);
  });

  it('ignores case and surrounding space when matching the name', () => {
    const { item, outcome } = resolveImportedReference({
      items: CATALOGS,
      id: 34205,
      name: '  spare PARTS ',
    });

    expect(outcome).toBe(RESOLVED_BY_NAME);
    expect(item.id).toBe(102);
  });

  it('resolves by name when only a name was exported', () => {
    const { item, outcome } = resolveImportedReference({
      items: CATALOGS,
      name: 'Default Catalog',
    });

    expect(outcome).toBe(RESOLVED_BY_NAME);
    expect(item.id).toBe(101);
  });

  it('reports an unresolved reference when neither the id nor the name match', () => {
    const { item, outcome } = resolveImportedReference({
      items: CATALOGS,
      id: 34205,
      name: 'Retired Catalog',
    });

    expect(outcome).toBe(UNRESOLVED);
    expect(item).toBeNull();
  });

  it('reports an unresolved reference when the id is dead and no name travelled with it', () => {
    const { outcome } = resolveImportedReference({
      items: CATALOGS,
      id: 34205,
    });

    expect(outcome).toBe(UNRESOLVED);
  });

  it('does not conclude anything when no list is loaded', () => {
    expect(
      resolveImportedReference({ items: [], id: 34205, name: 'Spare Parts' })
        .outcome
    ).toBe(NOTHING_TO_MATCH);

    expect(
      resolveImportedReference({ id: 34205, name: 'Spare Parts' }).outcome
    ).toBe(NOTHING_TO_MATCH);
  });

  it('asks nothing when the import carried neither an id nor a name', () => {
    expect(
      resolveImportedReference({ items: CATALOGS, id: null, name: '  ' })
        .outcome
    ).toBe(NOTHING_REQUESTED);
  });
});

describe('describeResolution', () => {
  it('stays quiet when the id resolved', () => {
    expect(
      describeResolution({
        label: 'Catalog',
        outcome: RESOLVED_BY_ID,
        item: CATALOGS[0],
        id: 101,
        name: 'Default Catalog',
      })
    ).toBeNull();
  });

  it('names both the dead id and the id it was remapped to', () => {
    const notice = describeResolution({
      label: 'Catalog',
      outcome: RESOLVED_BY_NAME,
      item: CATALOGS[1],
      id: 34205,
      name: 'Spare Parts',
    });

    expect(notice.type).toBe('warning');
    expect(notice.message).toContain('34205');
    expect(notice.message).toContain('Spare Parts');
    expect(notice.message).toContain('102');
  });

  it('says the selection was cleared when nothing resolved', () => {
    const notice = describeResolution({
      label: 'Channel',
      outcome: UNRESOLVED,
      item: null,
      id: 34907,
      name: 'Retired Channel',
    });

    expect(notice.type).toBe('warning');
    expect(notice.message).toContain('34907');
    expect(notice.message).toContain('cleared');
  });

  it('asks for a connection when there was no list to match against', () => {
    const notice = describeResolution({
      label: 'Channel',
      outcome: NOTHING_TO_MATCH,
      item: null,
      id: 34907,
      name: 'Retired Channel',
    });

    expect(notice.type).toBe('warning');
    expect(notice.message).toContain('Test the connection');
  });
});
