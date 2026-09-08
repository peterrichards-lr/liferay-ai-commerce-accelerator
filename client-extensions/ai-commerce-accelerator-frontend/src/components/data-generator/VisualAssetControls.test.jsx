import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VisualAssetControls from './VisualAssetControls';

const renderControls = ({ values, ...props } = {}) =>
  render(
    <VisualAssetControls
      onChange={vi.fn()}
      aiMediaKeyAvailable
      {...props}
      values={{
        imageMode: 'placeholder',
        imageRatio: 100,
        imageStyle: 'photographic',
        pdfMode: 'placeholder',
        pdfRatio: 100,
        pdfContentType: 'datasheet',
        ...values,
      }}
    />
  );

const aiButtons = () => screen.getAllByRole('button', { name: 'AI Gen' });

describe('VisualAssetControls', () => {
  // Images and PDFs go to the media provider, so the text key has no bearing on
  // whether they can be generated. Gating on it left AI Gen selectable with no
  // media key at all, and the request was then silently downgraded (#753).
  it('offers AI Gen when a media key is configured', () => {
    renderControls();

    for (const button of aiButtons()) {
      expect(button).not.toBeDisabled();
    }
  });

  it('rules out AI Gen for images and PDFs when there is no media key', () => {
    renderControls({ aiMediaKeyAvailable: false });

    const buttons = aiButtons();

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'No media API key is configured');
    }
  });

  it('rules out AI Gen for demo data, which never reaches a provider', () => {
    renderControls({ demoMode: true });

    for (const button of aiButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        'title',
        'Not available for generated demo data'
      );
    }
  });

  // A disabled button with no explanation is indistinguishable from a broken
  // one, and the demo-mode reason is the one an operator is least likely to
  // guess, so it wins when both apply.
  it('explains itself, preferring the demo reason when both apply', () => {
    renderControls({ aiMediaKeyAvailable: false, demoMode: true });

    expect(aiButtons()[0]).toHaveAttribute(
      'title',
      'Not available for generated demo data'
    );
  });

  it('leaves None and Placeholder available either way', () => {
    renderControls({ aiMediaKeyAvailable: false, demoMode: true });

    for (const button of screen.getAllByRole('button', {
      name: /None|Placeholder/,
    })) {
      expect(button).not.toBeDisabled();
    }
  });

  it('carries no title when the option is available', () => {
    renderControls();

    expect(aiButtons()[0]).not.toHaveAttribute('title');
  });
});
