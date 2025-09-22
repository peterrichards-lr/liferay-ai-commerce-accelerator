import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.scss';

const TAG = 'liferay-ai-commerce-accelerator-frontend';

const toCamel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const coerce = (v) => (v === '' ? true : v); // bare attribute => true

function parsePropsFrom(el) {
  // Attributes → config
  const configFromAttrs = {};
  for (const { name, value } of Array.from(el.attributes)) {
    configFromAttrs[toCamel(name)] = coerce(value);
  }

  // Optional <script type="application/json"> payload
  let cfg = {};
  let runtime = {};
  const script = el.querySelector('script[type="application/json"]');
  if (script?.textContent?.trim()) {
    try {
      const json = JSON.parse(script.textContent);
      cfg = json.config || {};
      runtime = json.runtime || {};
    } catch {}
  }

  // Final
  return { config: { ...cfg, ...configFromAttrs }, runtime };
}

function ensureContainer(host) {
  return (
    host.firstElementChild ?? host.appendChild(document.createElement('div'))
  );
}

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

class LiferayAiCommerceAcceleratorElement extends HTMLElement {
  static get observedAttributes() {
    return [
      'liferay-hosted',
      'liferay-url',
      'microservice-url',
      'locale-code',
      'title',
      'subtitle',
      'ws-logging-level',
+     'polling-delay',
    ];
  }

  connectedCallback() {
    if (this.__mounted) return;
    const container = ensureContainer(this);
    container.classList.add(`${TAG}-root`);
    const { config, runtime } = parsePropsFrom(this);
    mount(container, { config, runtime });
    this.__mounted = true;
  }

  attributeChangedCallback() {
    if (!this.__mounted) return;
    const container = this.querySelector(`.${TAG}-root`);
    const { config, runtime } = parsePropsFrom(this);
    unmount(container);
    mount(container, { config, runtime });
  }

  disconnectedCallback() {
    if (!this.__mounted) return;
    const container = this.querySelector(`.${TAG}-root`);
    unmount(container);
    this.__mounted = false;
  }
}

if (!customElements.get(TAG))
  customElements.define(TAG, LiferayAiCommerceAcceleratorElement);
export default null;
