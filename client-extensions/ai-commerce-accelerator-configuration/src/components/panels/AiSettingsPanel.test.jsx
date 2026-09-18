import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AiSettingsPanel from './AiSettingsPanel';
import { IMAGE_CAPABLE_PROVIDERS } from '../../config/providerCapabilities';

/**
 * The two dropdowns exactly as this file used to write them out, before #635
 * derived them from the provider declaration. Literals on purpose: deriving
 * them from the same registry the component reads would compare the refactor
 * against itself and prove nothing.
 */
const BEFORE = {
  TEXT_PROVIDER_OPTIONS: [
    ['OpenAI (GPT)', 'openai'],
    ['Google Gemini', 'gemini'],
    ['Anthropic Claude', 'anthropic'],
  ],
  MEDIA_PROVIDER_OPTIONS: [
    ['Same as Core AI', 'inherit'],
    ['OpenAI', 'openai'],
  ],
};

const optionsOf = (element) =>
  [...element.querySelectorAll('option')].map((option) => [
    option.textContent,
    option.value,
  ]);

const renderPanel = (type) =>
  render(
    <AiSettingsPanel
      keyValue=""
      setKeyValue={() => {}}
      providerValue=""
      setProviderValue={() => {}}
      type={type}
      coreProviderValue="openai"
    />
  );

describe('AiSettingsPanel provider choices', () => {
  it('offers the same Core AI Providers, in the same order', () => {
    renderPanel('text');

    expect(optionsOf(screen.getByLabelText('Core AI Provider'))).toEqual(
      BEFORE.TEXT_PROVIDER_OPTIONS
    );
  });

  it('offers the same Media Providers, in the same order', () => {
    renderPanel('media');

    expect(optionsOf(screen.getByLabelText('Media Provider'))).toEqual(
      BEFORE.MEDIA_PROVIDER_OPTIONS
    );
  });

  it('defaults an unset Core AI Provider to the first one offered', () => {
    renderPanel('text');

    expect(screen.getByLabelText('Core AI Provider')).toHaveValue('openai');
  });

  it('defaults an unset Media Provider to inheriting', () => {
    renderPanel('media');

    expect(screen.getByLabelText('Media Provider')).toHaveValue('inherit');
  });

  it('never offers a media provider that cannot generate an image', () => {
    // Nano Banana returned a placeholder string and Gemini throws 'not
    // supported yet'; both were offered here and cost the operator a run
    // (#642). The list is derived from the capability now, so it cannot
    // outlive it.
    renderPanel('media');

    const offered = optionsOf(screen.getByLabelText('Media Provider'))
      .map(([, value]) => value)
      .filter((value) => value !== 'inherit');

    expect(offered).toEqual(IMAGE_CAPABLE_PROVIDERS);
  });
});
