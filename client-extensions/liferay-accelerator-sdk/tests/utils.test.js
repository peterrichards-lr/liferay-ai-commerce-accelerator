import { describe, it, expect } from 'vitest';
const misc = require('../src/utils/misc.cjs');
const liferayUtils = require('../src/utils/liferayUtils.cjs');
const liferayEnv = require('../src/utils/liferayEnv.cjs');

describe('utils/misc', () => {
  describe('toERCPart', () => {
    it('should clean and uppercase strings', () => {
      expect(misc.toERCPart('Test-String')).toBe('TESTSTRING');
      expect(misc.toERCPart('   spaces  ')).toBe('SPACES');
      expect(misc.toERCPart('Special@#%Chars')).toBe('SPECIALCHARS');
    });

    it('should truncate to max length', () => {
      expect(misc.toERCPart('VERYLONGSTRING', 5)).toBe('VERYL');
    });

    it('should return NA for empty inputs', () => {
      expect(misc.toERCPart('')).toBe('NA');
      expect(misc.toERCPart(null)).toBe('NA');
    });
  });

  describe('sanitizeForERC', () => {
    it('should remove non-alphanumeric characters', () => {
      expect(misc.sanitizeForERC('Hello World!')).toBe('HELLOWORLD');
    });

    it('should preserve underscores if requested', () => {
      expect(misc.sanitizeForERC('A_B-C', { preserveUnderscore: true })).toBe(
        'A_BC'
      );
    });
  });

  describe('buildKeyedERC', () => {
    it('should construct an ERC with prefix, category, and key', () => {
      const erc = misc.buildKeyedERC({
        prefix: 'AICA',
        category: 'PRD',
        key: 'ITEM123',
        includeRandom: false,
      });
      expect(erc).toBe('AICA-PRD-ITEM12');
    });

    it('should include a random suffix by default', () => {
      const erc = misc.buildKeyedERC({
        prefix: 'AICA',
        category: 'PRD',
        key: 'ITEM123',
      });
      const parts = erc.split('-');
      expect(parts).toHaveLength(4);
      expect(parts[3]).toHaveLength(3);
    });
  });

  describe('createERC', () => {
    it('should generate a string starting with the prefix', () => {
      const erc = misc.createERC('MY-PFX');
      expect(erc.startsWith('MY-PFX-')).toBe(true);
    });

    it('should be unique across calls', () => {
      const erc1 = misc.createERC('A');
      const erc2 = misc.createERC('A');
      expect(erc1).not.toBe(erc2);
    });
  });

  describe('toI18n / fromI18n', () => {
    it('should convert string to object', () => {
      expect(misc.toI18n('Hello')).toEqual({ en_US: 'Hello' });
    });

    it('should extract string from object', () => {
      expect(misc.fromI18n({ en_US: 'Hello', es_ES: 'Hola' })).toBe('Hello');
      expect(misc.fromI18n({ es_ES: 'Hola' }, 'es_ES')).toBe('Hola');
    });
  });

  describe('parseDataUrl', () => {
    it('should parse valid data URLs', () => {
      const input =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BfAAAACQBXRhMzCAAAAABJRU5ErkJggg==';
      const result = misc.parseDataUrl(input);
      expect(result.contentType).toBe('image/png');
      expect(result.base64).toBeDefined();
    });

    it('should parse plain base64 strings', () => {
      const input = 'SGVsbG8gV29ybGQ=';
      const result = misc.parseDataUrl(input);
      expect(result.contentType).toBe('application/octet-stream');
      expect(result.base64).toBe('SGVsbG8gV29ybGQ=');
    });
  });

  describe('normalizeNumber', () => {
    it('should clamp numbers within range', () => {
      expect(misc.normalizeNumber(10, { min: 20 })).toBe(20);
      expect(misc.normalizeNumber(50, { max: 40 })).toBe(40);
      expect(misc.normalizeNumber(30, { min: 20, max: 40 })).toBe(30);
    });

    it('should return default value for non-numbers', () => {
      expect(misc.normalizeNumber('abc', { defaultValue: 5 })).toBe(5);
    });
  });

  describe('liferayUtils', () => {
    describe('asItems', () => {
      it('should return array directly if input is an array', () => {
        const arr = [1, 2, 3];
        expect(liferayUtils.asItems(arr)).toBe(arr);
      });

      it('should return items property if it contains an array', () => {
        const data = { items: [4, 5] };
        expect(liferayUtils.asItems(data)).toEqual([4, 5]);
      });

      it('should return empty array for invalid inputs', () => {
        expect(liferayUtils.asItems(null)).toEqual([]);
        expect(liferayUtils.asItems({})).toEqual([]);
      });
    });

    describe('asCount', () => {
      it('should return totalCount if it is a number', () => {
        expect(liferayUtils.asCount({ totalCount: 15 })).toBe(15);
      });

      it('should return items.totalCount if it is a number', () => {
        expect(liferayUtils.asCount({ items: { totalCount: 22 } })).toBe(22);
      });

      it('should fallback to items array length', () => {
        expect(liferayUtils.asCount([1, 2, 3, 4])).toBe(4);
        expect(liferayUtils.asCount({ items: [1, 2] })).toBe(2);
      });
    });
  });

  describe('constants', () => {
    it('should fall back to default boolean when environment/config variable is missing or invalid', () => {
      process.env['logger.pretty'] = 'true';
      delete require.cache[require.resolve('../src/utils/constants.cjs')];
      const freshConstants = require('../src/utils/constants.cjs');
      expect(freshConstants.ENV.LOGGER_PRETTY).toBe(true);

      process.env['logger.pretty'] = 'invalid_bool';
      delete require.cache[require.resolve('../src/utils/constants.cjs')];
      const freshConstants2 = require('../src/utils/constants.cjs');
      expect(freshConstants2.ENV.LOGGER_PRETTY).toBe(false);

      delete process.env['logger.pretty'];
    });

    it('should parse comma-separated lists correctly', () => {
      process.env.EXCLUDE_ACCOUNTS = 'AccountA,AccountB,,AccountC';
      delete require.cache[require.resolve('../src/utils/constants.cjs')];
      const freshConstants = require('../src/utils/constants.cjs');
      expect(freshConstants.ENV.EXCLUDE_ACCOUNTS).toEqual([
        'AccountA',
        'AccountB',
        'AccountC',
      ]);
      delete process.env.EXCLUDE_ACCOUNTS;
    });
  });

  describe('liferayEnv', () => {
    describe('isValidAbsoluteUrl', () => {
      it('should validate absolute URLs correctly', () => {
        expect(liferayEnv.isValidAbsoluteUrl('http://localhost:8080')).toBe(
          true
        );
        expect(liferayEnv.isValidAbsoluteUrl('https://example.com/api')).toBe(
          true
        );
        expect(liferayEnv.isValidAbsoluteUrl('not-a-url')).toBe(false);
        expect(liferayEnv.isValidAbsoluteUrl('')).toBe(false);
        expect(liferayEnv.isValidAbsoluteUrl(null)).toBe(false);
      });
    });

    describe('tryBuildColocatedLiferayUrl', () => {
      it('should return null when parsing throws or fails', () => {
        const { lxcConfig } = require('@rotty3000/config-node');
        const originalDxpMainDomain = lxcConfig.dxpMainDomain;
        lxcConfig.dxpMainDomain = () => {
          throw new Error('fail');
        };
        expect(liferayEnv.tryBuildColocatedLiferayUrl()).toBeNull();
        lxcConfig.dxpMainDomain = originalDxpMainDomain;
      });
    });

    describe('resolveEffectiveLiferayConnection', () => {
      it('should throw error when URL is missing or invalid', () => {
        const { lxcConfig } = require('@rotty3000/config-node');
        const originalDxpMainDomain = lxcConfig.dxpMainDomain;
        lxcConfig.dxpMainDomain = () => {
          throw new Error('fail');
        };
        expect(() => {
          liferayEnv.resolveEffectiveLiferayConnection({}, {}, {});
        }).toThrow(/Liferay URL is not configured/);
        lxcConfig.dxpMainDomain = originalDxpMainDomain;
      });

      it('should throw error when authentication details are missing in standalone mode', () => {
        expect(() => {
          liferayEnv.resolveEffectiveLiferayConnection(
            { liferayUrl: 'http://localhost:8080' },
            { isLiferayRouteAvailable: () => false },
            {}
          );
        }).toThrow(/Liferay authentication is not configured/);
      });

      it('should resolve correctly when auth method is basic authentication via environment variables', () => {
        process.env.LIFERAY_API_USERNAME = 'test-user';
        process.env.LIFERAY_API_PASSWORD = 'test-password';

        // Bust require cache to pick up the username/password
        delete require.cache[require.resolve('../src/utils/constants.cjs')];
        delete require.cache[require.resolve('../src/utils/liferayEnv.cjs')];
        const freshLiferayEnv = require('../src/utils/liferayEnv.cjs');

        const connection = freshLiferayEnv.resolveEffectiveLiferayConnection(
          { liferayUrl: 'http://localhost:8080' },
          { isLiferayRouteAvailable: () => false },
          {}
        );

        expect(connection.liferayUrl).toBe('http://localhost:8080');
        expect(connection.isColocated).toBe(false);

        delete process.env.LIFERAY_API_USERNAME;
        delete process.env.LIFERAY_API_PASSWORD;
      });

      it('should resolve correctly in colocated mode using default values from oauthService', () => {
        const mockOauthService = {
          isLiferayRouteAvailable: () => true,
          getDefaultLiferayUrl: () => 'http://colocated:8080',
          getDefaultClientId: () => 'default-client',
          getDefaultClientSecret: () => 'default-secret',
        };

        const connection = liferayEnv.resolveEffectiveLiferayConnection(
          {},
          mockOauthService,
          {}
        );

        expect(connection.liferayUrl).toBe('http://colocated:8080');
        expect(connection.clientId).toBe('default-client');
        expect(connection.clientSecret).toBe('default-secret');
        expect(connection.isColocated).toBe(true);
      });

      it('should resolve correctly in colocated mode using colocated URL fallback when getDefaultLiferayUrl is missing', () => {
        const { lxcConfig, clearCache } = require('@rotty3000/config-node');
        const originalDxpMainDomain = lxcConfig.dxpMainDomain;
        lxcConfig.dxpMainDomain = () => 'colocated.domain';
        process.env.COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL = 'https';

        // Clear the config-node cache so it reads process.env fresh
        clearCache();

        const mockOauthService = {
          isLiferayRouteAvailable: () => true,
          getDefaultClientId: () => 'default-client',
          getDefaultClientSecret: () => 'default-secret',
        };

        const connection = liferayEnv.resolveEffectiveLiferayConnection(
          {},
          mockOauthService,
          {}
        );

        expect(connection.liferayUrl).toBe('https://colocated.domain');
        expect(connection.clientId).toBe('default-client');
        expect(connection.clientSecret).toBe('default-secret');
        expect(connection.isColocated).toBe(true);

        lxcConfig.dxpMainDomain = originalDxpMainDomain;
        delete process.env.COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL;
        clearCache();
      });
    });
  });
});
