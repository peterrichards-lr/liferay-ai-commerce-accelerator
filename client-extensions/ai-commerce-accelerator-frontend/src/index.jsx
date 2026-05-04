import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AdminApp from './AdminApp.jsx';
import './styles/app.scss';

const TAG_MAIN = 'liferay-ai-commerce-accelerator-frontend';
const TAG_ADMIN = 'liferay-ai-commerce-accelerator-admin';

const toCamel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const BOOLEAN_ATTRS = new Set(['liferay-hosted']);

const coerce = (v, k) => {
  if (BOOLEAN_ATTRS.has(k)) {
    return v === '' || v === 'true';
  }
  return v;
};

function parsePropsFrom(el) {
  const configFromAttrs = {};
  for (const { name, value } of Array.from(el.attributes)) {
    configFromAttrs[toCamel(name)] = coerce(value, name);
  }

  let cfg = {};
  let runtime = {};
  const script = el.querySelector('script[type="application/json"]');
  if (script?.textContent?.trim()) {
    try {
      const json = JSON.parse(script.textContent);
      cfg = json.config || {};
      runtime = json.runtime || {};
    } catch {
      /* ignore invalid JSON in script tag */
    }
  }

  if (el.hasAttribute('spritemap')) {
    configFromAttrs.spritemap = el.getAttribute('spritemap');
  }

  return { config: { ...cfg, ...configFromAttrs }, runtime };
}

function ensureContainer(host) {
  return (
    host.firstElementChild ?? host.appendChild(document.createElement('div'))
  );
}

function mount(el, props, type = 'main') {
  const root = createRoot(el);
  const Component = type === 'admin' ? AdminApp : App;
  root.render(<Component {...props} />);
  el.__root = root;
}

function unmount(el) {
  if (el?.__root) {
    el.__root.unmount();
    delete el.__root;
  }
}

class LiferayAiCommerceAcceleratorElement extends HTMLElement {
  constructor() {
    super();
    this.tagType = 'main';
  }

  static get observedAttributes() {
    return [
      'liferay-hosted',
      'liferay-url',
      'microservice-url',
      'locale-code',
      'title',
      'subtitle',
      'ws-logging-level',
      'polling-delay',
      'polling-retries',
      'spritemap',
    ];
  }

  connectedCallback() {
    if (this.__mounted) return;
    const container = ensureContainer(this);
    container.classList.add(`${this.tagName.toLowerCase()}-root`);
    const { config, runtime } = parsePropsFrom(this);
    mount(container, { config, runtime }, this.tagType);
    this.__mounted = true;
  }

  attributeChangedCallback() {
    if (!this.__mounted) return;
    const container = this.querySelector(`.${this.tagName.toLowerCase()}-root`);
    const { config, runtime } = parsePropsFrom(this);
    unmount(container);
    mount(container, { config, runtime }, this.tagType);
  }

  disconnectedCallback() {
    if (!this.__mounted) return;
    const container = this.querySelector(`.${this.tagName.toLowerCase()}-root`);
    unmount(container);
    this.__mounted = false;
  }
}

class LiferayAiCommerceAcceleratorAdminElement extends LiferayAiCommerceAcceleratorElement {
  constructor() {
    super();
    this.tagType = 'admin';
  }
}

if (!customElements.get(TAG_MAIN))
  customElements.define(TAG_MAIN, LiferayAiCommerceAcceleratorElement);

if (!customElements.get(TAG_ADMIN))
  customElements.define(TAG_ADMIN, LiferayAiCommerceAcceleratorAdminElement);

export default null;
