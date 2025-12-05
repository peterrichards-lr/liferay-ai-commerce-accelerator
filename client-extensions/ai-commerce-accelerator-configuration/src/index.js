import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClayIconSpriteContext } from '@clayui/icon';
import LiferayAICommerceAcceleratorConfiguration from './LiferayAICommerceAcceleratorConfiguration';

const ELEMENT_ID = 'liferay-ai-commerce-accelerator-configuration';
const SPRITEMAP_FALLBACK = '/o/admin-theme/images/clay/icons.svg';

class BaseComponent extends HTMLElement {
  constructor() {
    super();
    this.root = null;
    this.mount = null;
  }

  connectedCallback() {
    if (!this.mount || !this.contains(this.mount)) {
      this.mount = document.createElement('div');
      this.mount.id = 'liferay-ai-commerce-accelerator-configuration__mount';
      this.appendChild(this.mount);
    }

    if (!this.root) {
      this.root = createRoot(this.mount);
    }

    this.renderComponent();
  }

  disconnectedCallback() {
    try { this.root?.unmount?.(); } catch {}
    this.root = null;
  }
}

class LiferayAICommerceAcceleratorConfigurationComponent extends BaseComponent {
  static get observedAttributes() {
    return ['spritemap'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'spritemap' && oldValue !== newValue) this.renderComponent();
  }

  renderComponent() {
    if (!this.root) return;
    const spritemap =
      this.getAttribute('spritemap') ||
      (globalThis?.Liferay?.Icons?.spritemap) ||
      SPRITEMAP_FALLBACK;

    this.root.render(
      <ClayIconSpriteContext.Provider value={spritemap}>
        <LiferayAICommerceAcceleratorConfiguration />
      </ClayIconSpriteContext.Provider>
    );
  }
}

if (!customElements.get(ELEMENT_ID)) {
  customElements.define(ELEMENT_ID, LiferayAICommerceAcceleratorConfigurationComponent);
}