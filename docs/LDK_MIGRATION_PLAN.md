# Architectural Blueprint: Agentic-Friendly Liferay Development Kit (LDK)

This document outlines the post-MVP plan to refactor the `@liferay/accelerator-sdk` into a decoupled, platform-generic, and **Agentic-Friendly Liferay Development Kit (LDK)**.

The LDK is designed to serve as the unified, reusable integration layer for all future Node-based Liferay Client Extensions (CX) and Automations, whether commerce-related or otherwise.

---

## 1. Vision & Core Principles

### Decoupled Core vs. Namespaced Features

Instead of maintaining domain-specific SDKs, the LDK combines shared networking plumbing (OAuth, rate-limiting, retries, and contract validations) with modular, namespaced domain services.

```text
                               ┌────────────────────────┐
                               │  LDK Client Instance   │
                               └───────────┬────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  ▼                        ▼                        ▼
       .commerce Namespace      .platform Namespace      .objects Namespace
       ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
       │ - Price Lists     │    │ - Users & Roles   │    │ - Generic CRUD    │
       │ - SKU Variants    │    │ - Sites & Pages   │    │   for any Custom  │
       │ - Orders          │    │ - Doc Library     │    │   Liferay Object  │
       └───────────────────┘    └───────────────────┘    └───────────────────┘
```

### Agentic-Friendly by Design

To enable AI agents (and human developers) to use the LDK intuitively, the library enforces strict API predictability:

1.  **Deterministic Signatures:** All write and read operations across all namespaces must strictly adhere to the same parameter ordering:
    `method(config, payload, options)`.
2.  **Strict Typing & Self-Discovery:** Every function is fully documented with complete JSDoc annotations to enable IDE auto-completion and let LLMs instantly discover parameter expectations.
3.  **Idempotency-by-Default:** Every write operation (e.g., creating a site, user, or price list) must perform an internal check (using `externalReferenceCode`) and auto-convert to an update (`PATCH`) if the entity already exists. This allows seeder pipelines to be executed repeatedly without duplication crashes.
4.  **Semantic Error Payloads:** Failed operations must return descriptive JSON error structures containing the exact failed key and expected schema, allowing LLM agents to self-correct payloads on subsequent turns.

---

## 2. Directory Layout & Architecture

```text
client-extensions/liferay-accelerator-sdk/
├── src/
│   ├── core/                      # Highly reusable shared plumbing
│   │   ├── oauth.cjs              # OAuth2 Client Credentials & caching
│   │   ├── rest.cjs               # Axios wrapper, retries, and soft statuses
│   │   ├── graphql.cjs            # GraphQL queries & pagination
│   │   └── contractValidator.cjs  # JSON Schema validation (Ajv)
│   │
│   ├── services/                  # Domain-specific namespaced services
│   │   ├── commerce.cjs           # Commerce entities (Price Lists, SKUs, Orders)
│   │   ├── platform.cjs           # Core Liferay platform (Users, Sites, Pages)
│   │   └── objects.cjs            # Dynamic Liferay Custom Objects CRUD
│   │
│   └── index.js                   # Unified entry point exposing Namespaces
```

---

## 3. Implementation Specification

### The Unified LDK Client Facade (`src/index.js`)

```javascript
const OAuthService = require('./core/oauth.cjs');
const LiferayRestService = require('./core/rest.cjs');
const LiferayGraphQLService = require('./core/graphql.cjs');

const CommerceService = require('./services/commerce.cjs');
const PlatformService = require('./services/platform.cjs');
const ObjectService = require('./services/objects.cjs');

class LiferayLDK {
  /**
   * Initialize a new Liferay LDK Client Instance.
   * @param {Object} options - Configuration parameters.
   * @param {string} [options.liferayUrl] - Target portal URL.
   * @param {string} [options.authMethod] - 'basic' or 'oauth'.
   * @param {Object} [options.logger] - Logger adapter.
   */
  constructor(options = {}) {
    this.logger = options.logger || console;

    // Core Plumbing
    this.oauth = new OAuthService(this, options);
    this.rest = new LiferayRestService(this, options);
    this.graphql = new LiferayGraphQLService(this, options);

    // Namespaced Domain Services
    this.commerce = new CommerceService(this);
    this.platform = new PlatformService(this);
    this.objects = new ObjectService(this);
  }
}

module.exports = { LiferayLDK };
```

### Example: Idempotency-by-Default Pattern (`src/services/platform.cjs`)

```javascript
class PlatformService {
  constructor(sdk) {
    this.sdk = sdk;
  }

  /**
   * Idempotently create or update a Liferay Site Page.
   * @param {Object} config - Active connection credentials.
   * @param {Object} payload - Page DTO.
   * @param {string} payload.externalReferenceCode - Page ERC.
   * @param {string} payload.title - Page Title.
   * @param {Object} [options] - Additional operational parameters.
   * @returns {Promise<Object>} The resolved page entity.
   */
  async createPage(config, payload, options = {}) {
    const erc = payload.externalReferenceCode;
    if (!erc)
      throw new Error(
        'externalReferenceCode is required for idempotent creation.'
      );

    try {
      // 1. Attempt to resolve existing Page by ERC
      const existing = await this.sdk.rest.getPageByERC(config, erc);
      if (existing) {
        this.sdk.logger.debug(
          `Page with ERC '${erc}' already exists. Updating...`
        );
        return await this.sdk.rest.patchPage(config, existing.id, payload);
      }
    } catch (err) {
      // Fall through to creation if 404
    }

    // 2. Perform native creation if missing
    return await this.sdk.rest.postPage(config, payload);
  }
}
```

---

## 4. Extraction & Publishing Roadmap

Once local modularization (Phases 1-2) is complete, the package will be extracted into its own repository:

### Step 1: Independent Repo Initialisation

Initialize a clean, dedicated git repository named `liferay-node-ldk` and move the decoupled SDK package into it.

### Step 2: Automatic CI Publishing

Configure GitHub Actions to automatically run unit tests, audit for secret leaks, and publish the package to the **NPM registry** upon merging to `main`:

```yaml
# .github/workflows/publish.yml
name: Publish LDK Release
on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Step 3: Consumer Migration

Refactor existing accelerators (including AICA) to uninstall local workspaces and consume the published node module natively:

```json
"dependencies": {
  "@liferay/ldk": "^1.0.0"
}
```
