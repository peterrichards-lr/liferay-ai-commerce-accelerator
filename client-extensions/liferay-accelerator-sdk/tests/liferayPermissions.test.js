import { describe, it, expect } from 'vitest';
const {
  computeRoleActions,
  buildPermissionsItems,
  mergeOverrides,
  ACTION_IDS,
  ROLE,
  ASSET_TYPE,
  VIEWABLE_BY,
} = require('../src/utils/liferayPermissions.cjs');

describe('liferayPermissions', () => {
  describe('computeRoleActions', () => {
    it('should grant full actions to Owner', () => {
      const actions = computeRoleActions(
        ASSET_TYPE.DOCUMENT,
        VIEWABLE_BY.OWNER,
        ROLE.OWNER
      );
      expect(actions.has(ACTION_IDS.VIEW)).toBe(true);
      expect(actions.has(ACTION_IDS.DELETE)).toBe(true);
      expect(actions.has(ACTION_IDS.PERMISSIONS)).toBe(true);
    });

    it('should grant VIEW and DOWNLOAD to Site Member when VIEWABLE_BY.SITE_MEMBERS', () => {
      const actions = computeRoleActions(
        ASSET_TYPE.DOCUMENT,
        VIEWABLE_BY.SITE_MEMBERS,
        ROLE.SITE_MEMBER
      );
      expect(actions.has(ACTION_IDS.VIEW)).toBe(true);
      expect(actions.has(ACTION_IDS.DOWNLOAD)).toBe(true);
    });

    it('should NOT grant VIEW to Guest when VIEWABLE_BY.SITE_MEMBERS', () => {
      const actions = computeRoleActions(
        ASSET_TYPE.DOCUMENT,
        VIEWABLE_BY.SITE_MEMBERS,
        ROLE.GUEST
      );
      expect(actions.has(ACTION_IDS.VIEW)).toBe(false);
    });

    it('should grant VIEW to Guest when VIEWABLE_BY.ANYONE', () => {
      const actions = computeRoleActions(
        ASSET_TYPE.DOCUMENT,
        VIEWABLE_BY.ANYONE,
        ROLE.GUEST
      );
      expect(actions.has(ACTION_IDS.VIEW)).toBe(true);
    });

    it('should handle document-folder specific actions', () => {
      const actions = computeRoleActions(
        ASSET_TYPE.DOCUMENT_FOLDER,
        VIEWABLE_BY.SITE_MEMBERS,
        ROLE.SITE_MEMBER
      );
      expect(actions.has(ACTION_IDS.ADD_DOCUMENT)).toBe(true);
      expect(actions.has(ACTION_IDS.ADD_SUBFOLDER)).toBe(true);
    });
  });

  describe('mergeOverrides', () => {
    it('should return a copy of the current set if no overrides are provided', () => {
      const current = new Set([ACTION_IDS.VIEW]);
      const result = mergeOverrides(current, null);
      expect(result).not.toBe(current);
      expect(Array.from(result)).toEqual([ACTION_IDS.VIEW]);
    });

    it('should add new actions and remove existing ones according to overrides', () => {
      const current = new Set([ACTION_IDS.VIEW, ACTION_IDS.UPDATE]);
      const result = mergeOverrides(current, {
        add: [ACTION_IDS.DELETE, ACTION_IDS.DOWNLOAD],
        remove: [ACTION_IDS.UPDATE],
      });
      expect(result.has(ACTION_IDS.VIEW)).toBe(true);
      expect(result.has(ACTION_IDS.DELETE)).toBe(true);
      expect(result.has(ACTION_IDS.DOWNLOAD)).toBe(true);
      expect(result.has(ACTION_IDS.UPDATE)).toBe(false);
    });
  });

  describe('buildPermissionsItems', () => {
    it('should throw error for unknown asset type', () => {
      expect(() => {
        buildPermissionsItems({
          assetType: 'unknown',
          viewableBy: VIEWABLE_BY.OWNER,
        });
      }).toThrow('Unknown assetType: unknown');
    });

    it('should throw error for unknown viewableBy value', () => {
      expect(() => {
        buildPermissionsItems({
          assetType: ASSET_TYPE.DOCUMENT,
          viewableBy: 'unknown',
        });
      }).toThrow('Unknown viewableBy: unknown');
    });

    it('should build permission items array for document with overrides', () => {
      const items = buildPermissionsItems({
        assetType: ASSET_TYPE.DOCUMENT,
        viewableBy: VIEWABLE_BY.SITE_MEMBERS,
        overrides: {
          [ROLE.SITE_MEMBER]: { add: [ACTION_IDS.UPDATE] },
        },
      });

      expect(items).toBeInstanceOf(Array);
      const siteMemberItem = items.find(
        (item) => item.roleName === ROLE.SITE_MEMBER
      );
      expect(siteMemberItem).toBeDefined();
      expect(siteMemberItem.actionIds).toContain(ACTION_IDS.VIEW);
      expect(siteMemberItem.actionIds).toContain(ACTION_IDS.DOWNLOAD);
      expect(siteMemberItem.actionIds).toContain(ACTION_IDS.UPDATE);
    });
  });
});
