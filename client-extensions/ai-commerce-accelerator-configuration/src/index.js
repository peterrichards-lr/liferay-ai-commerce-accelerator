import { createRoot } from 'react-dom/client';

import { ClayIconSpriteContext } from '@clayui/icon';

import LiferayAICommerceAcceleratorConfiguration from './LiferayAICommerceAcceleratorConfiguration';

import './index.css';

const ELEMENT_ID_LIFERAY_AI_COMMERCE_ACCELERATOR_CONFIGURATION =
  'liferay-ai-commerce-accelerator-configuration';
const LIFERAY_LIFERAY_AI_COMMERCE_ACCELERATOR_CONFIGURATION_WATCH_ATTRIBUTES = [];

class BaseComponent extends HTMLElement {
  constructor() {
    super();
    this.root = null;
  }

  connectedCallback() {
    if (!this.root) {
      this.root = createRoot(this);
    }
    this.renderComponent();
  }

  disconnectedCallback() {
    if (this.root) {
      this.root?.unmount();
      this.root = null;
    }
  }
}

class LiferayAICommerceAcceleratorConfigurationComponent extends BaseComponent {
  static get observedAttributes() {
    return LIFERAY_LIFERAY_AI_COMMERCE_ACCELERATOR_CONFIGURATION_WATCH_ATTRIBUTES;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (
      LIFERAY_LIFERAY_AI_COMMERCE_ACCELERATOR_CONFIGURATION_WATCH_ATTRIBUTES.includes(
        name
      ) &&
      oldValue !== newValue
    ) {
      this.renderComponent(newValue);
    }
  }

  renderComponent() {
    if (this.root) {
      this.root.render(
        <ClayIconSpriteContext.Provider value={Liferay.Icons.spritemap}>
          <LiferayAICommerceAcceleratorConfiguration />
        </ClayIconSpriteContext.Provider>
      );
    }
  }
}

if (
  !customElements.get(ELEMENT_ID_LIFERAY_AI_COMMERCE_ACCELERATOR_CONFIGURATION)
) {
  customElements.define(
    ELEMENT_ID_LIFERAY_AI_COMMERCE_ACCELERATOR_CONFIGURATION,
    LiferayAICommerceAcceleratorConfigurationComponent
  );
}
