import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  KEY_PATTERNS,
  PROVIDER_ENV_VARS,
  PROVIDER_KEY_FAMILY,
} from './apiKeys';
import { PROVIDER_PATTERNS } from './modelCatalog';
import { IMAGE_CAPABLE_PROVIDERS, providerLabel } from './providerCapabilities';
import {
  FAMILY_LABELS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
} from './providerRegistry';

const require = createRequire(import.meta.url);

/**
 * The tables this package used to keep its own copy of, transcribed from the
 * files that held them before #635. Literals on purpose: deriving them would
 * make the test compare the refactor against itself.
 */
const BEFORE = {
  PROVIDER_KEY_FAMILY: {
    anthropic: 'anthropic',
    gemini: 'google',
    nanobanana: 'google',
    openai: 'openai',
  },
  PROVIDER_ENV_VARS: {
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    nanobanana: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
  },
  KEY_PATTERNS: [
    { family: 'anthropic', pattern: '/^sk-ant-/' },
    { family: 'google', pattern: '/^AIza/' },
    { family: 'openai', pattern: '/^sk-/' },
  ],
  FAMILY_LABELS: {
    anthropic: 'Anthropic',
    google: 'Google',
    openai: 'OpenAI',
  },
  IMAGE_CAPABLE_PROVIDERS: ['openai'],
  PROVIDER_LABELS: {
    anthropic: 'Anthropic Claude',
    gemini: 'Google Gemini',
    nanobanana: 'Nano Banana',
    openai: 'OpenAI',
  },
  PROVIDER_PATTERNS: [
    { provider: 'anthropic', pattern: '/^claude[-.]/i' },
    { provider: 'gemini', pattern: '/^(gemini|imagen)[-.]/i' },
    { provider: 'openai', pattern: '/^(gpt[-.]|o\\d)/i' },
  ],
};

const asSource = (patterns, key) =>
  patterns.map((entry) => ({
    [key]: entry[key],
    pattern: String(entry.pattern),
  }));

describe('provider registry in the configuration UI', () => {
  describe('every table matches what this package used to declare itself', () => {
    it('the credential family each provider authenticates with', () => {
      expect(PROVIDER_KEY_FAMILY).toEqual(BEFORE.PROVIDER_KEY_FAMILY);
      expect(Object.keys(PROVIDER_KEY_FAMILY)).toEqual(
        Object.keys(BEFORE.PROVIDER_KEY_FAMILY)
      );
    });

    it('the environment variable each provider prefers', () => {
      expect(PROVIDER_ENV_VARS).toEqual(BEFORE.PROVIDER_ENV_VARS);
    });

    it('the key prefixes, still with Anthropic ahead of OpenAI', () => {
      expect(asSource(KEY_PATTERNS, 'family')).toEqual(BEFORE.KEY_PATTERNS);
    });

    it('the credential family labels', () => {
      expect(FAMILY_LABELS).toEqual(BEFORE.FAMILY_LABELS);
    });

    it('the providers that can generate images', () => {
      expect(IMAGE_CAPABLE_PROVIDERS).toEqual(BEFORE.IMAGE_CAPABLE_PROVIDERS);
    });

    it('the provider display labels', () => {
      expect(PROVIDER_LABELS).toEqual(BEFORE.PROVIDER_LABELS);
      for (const [id, label] of Object.entries(BEFORE.PROVIDER_LABELS)) {
        expect(providerLabel(id)).toBe(label);
      }
    });

    it('the model-name patterns', () => {
      expect(asSource(PROVIDER_PATTERNS, 'provider')).toEqual(
        BEFORE.PROVIDER_PATTERNS
      );
    });
  });

  it('is the microservice declaration, not a copy of it', () => {
    // Not "agrees with": the same objects, reached by importing the one file.
    // The two packages have different module systems, so the identity has to be
    // asserted by value - but there is only one place either could have got it
    // from.
    const microservice = require('../../../ai-commerce-accelerator-microservice/utils/providerRegistry.cjs');

    expect(PROVIDER_IDS).toEqual(microservice.PROVIDER_IDS);
    expect(PROVIDER_LABELS).toEqual(microservice.PROVIDER_LABELS);
    expect(PROVIDER_ENV_VARS).toEqual(microservice.PROVIDER_ENV_VARS);
    expect(PROVIDER_KEY_FAMILY).toEqual(microservice.PROVIDER_KEY_FAMILY);
    expect(FAMILY_LABELS).toEqual(microservice.FAMILY_LABELS);
    expect(IMAGE_CAPABLE_PROVIDERS).toEqual(
      microservice.IMAGE_CAPABLE_PROVIDERS
    );
    expect(asSource(KEY_PATTERNS, 'family')).toEqual(
      asSource(microservice.KEY_PATTERNS, 'family')
    );
    expect(asSource(PROVIDER_PATTERNS, 'provider')).toEqual(
      asSource(microservice.PROVIDER_PATTERNS, 'provider')
    );
  });
});
