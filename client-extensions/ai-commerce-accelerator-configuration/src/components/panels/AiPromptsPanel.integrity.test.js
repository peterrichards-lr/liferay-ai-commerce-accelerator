import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENTITY_CONFIGS } from './AiPromptsPanel';

// The batch seeds one ai-prompt-* object per file in the microservice's
// prompts/ directory (build.gradle's entitiesIn), and the microservice reads
// the same directory (listPromptNames). This panel is a browser bundle and
// cannot read a directory at runtime, so its list is hand-maintained - which
// is how prompts/image.md stayed unreachable after it was seeded (#650).
// This test is the enforcement point that keeps the three in agreement.
const PROMPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../ai-commerce-accelerator-microservice/prompts'
);

const seededPromptNames = () =>
  fs
    .readdirSync(PROMPTS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -'.md'.length))
    .sort();

describe('AiPromptsPanel is in step with the seeded prompts', () => {
  it('finds the microservice prompts directory', () => {
    expect(fs.existsSync(PROMPTS_DIR)).toBe(true);
    expect(seededPromptNames().length).toBeGreaterThan(0);
  });

  it('offers exactly one editor per seeded prompt, and no others', () => {
    const offered = ENTITY_CONFIGS.map((c) => c.configKey).sort();
    const seeded = seededPromptNames()
      .map((n) => `ai-prompt-${n}`)
      .sort();

    // Named so a failure says which side is short rather than just "not equal".
    const missingFromPanel = seeded.filter((k) => !offered.includes(k));
    const notSeeded = offered.filter((k) => !seeded.includes(k));

    expect({ missingFromPanel, notSeeded }).toEqual({
      missingFromPanel: [],
      notSeeded: [],
    });
    expect(offered).toEqual(seeded);
  });

  it('gives every prompt a distinct id and a title to render', () => {
    const ids = ENTITY_CONFIGS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = ENTITY_CONFIGS.map((c) => c.configKey);
    expect(new Set(keys).size).toBe(keys.length);

    for (const { id, title, configKey } of ENTITY_CONFIGS) {
      expect(title, `${id} needs a title`).toBeTruthy();
      expect(configKey).toBe(`ai-prompt-${id}`);
    }
  });
});
