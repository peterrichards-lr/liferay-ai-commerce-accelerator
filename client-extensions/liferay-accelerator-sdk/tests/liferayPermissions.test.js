import { describe, it, expect } from 'vitest';
const {
  computeRoleActions,
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
});
