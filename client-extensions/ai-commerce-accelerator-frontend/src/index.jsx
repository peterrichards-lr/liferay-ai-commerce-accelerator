import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

import './styles/app.scss';

const TAG = 'liferay-ai-commerce-accelerator-frontend';

function mount(el, props) {
  const root = createRoot(el);
  root.render(<App {...props} />);
  el.__root = root;
}

function unmount(el) {
  if (el?.__root) {
    el.__root.unmount();
    delete el.__root;
  }
}

function parsePropsFrom(el) {
  const script = el.querySelector('script[type="application/json"]');
  if (script?.textContent?.trim()) {
    try {
      return JSON.parse(script.textContent);
    } catch {
      /* ignore */
    }
  }
  const raw = el.getAttribute('props') || el.dataset.props || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function ensureContainer(host) {
  return (
    host.firstElementChild ?? host.appendChild(document.createElement('div'))
  );
}

class LiferayAiCommerceAcceleratorElement extends HTMLElement {
  connectedCallback() {
    if (this.__mounted) return;
    const container = ensureContainer(this);
    container.classList.add('liferay-ai-commerce-accelerator-frontend-root');

    const { config = {}, runtime = {} } = parsePropsFrom(this);
    mount(container, { config, runtime });
    this.__mounted = true;
  }
  disconnectedCallback() {
    if (!this.__mounted) return;
    const container = this.querySelector(
      '.liferay-ai-commerce-accelerator-frontend-root'
    );
    unmount(container);
    this.__mounted = false;
  }
  static get observedAttributes() {
    return ['props'];
  }
  attributeChangedCallback(name, _, next) {
    if (name === 'props' && this.__mounted) {
      const container = this.querySelector(
        '.liferay-ai-commerce-accelerator-frontend-root'
      );
      const { config = {}, runtime = {} } = (() => {
        try {
          return JSON.parse(next || '{}');
        } catch {
          return {};
        }
      })();
      unmount(container);
      mount(container, { config, runtime });
    }
  }
}

if (!customElements.get(TAG))
  customElements.define(TAG, LiferayAiCommerceAcceleratorElement);

export { mount, unmount };
export default null;
