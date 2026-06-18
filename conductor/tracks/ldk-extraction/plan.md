# LDK Extraction Implementation Plan

## Phase 1: Directory Restructuring & Core Plumbing

1. **Create Core Directories:** Restructure `client-extensions/liferay-accelerator-sdk/src/` by creating `core/` and `services/` folders.
2. **Move Core Services:** Move `oauth.cjs`, `rest.cjs`, `graphql.cjs`, `constants.cjs`, `misc.cjs`, and `contractValidator.cjs` (currently in `src/liferay/` and `src/services/`) into `src/core/`.
3. **Update Core Imports:** Refactor all internal `require` statements within the `core/` files to match their new relative paths.

## Phase 2: Domain Services & Agentic JSDocs

1. **Create Namespaced Services:** Inside `src/services/`, create `commerce.cjs` (for Price Lists, SKUs, Orders) and `platform.cjs` (for Users, Channels).
2. **Migrate Logic:** Extract the domain-specific methods (like `createProductsBatch`, `getLanguages`) from the bloated `LiferayRestService` and `LiferayService` into these targeted namespaced services.
3. **Enforce Agentic Signatures:** Ensure all methods follow the `method(config, payload, options)` signature and add strict JSDoc annotations to every exported function.

## Phase 3: The Unified Facade & Dependency Injection

1. **Create Index Facade:** Rewrite `src/liferay/index.cjs` into `src/index.js` as the `LiferayLDK` class, instantiating the core services and exposing the namespaces (`this.commerce`, `this.platform`).
2. **Implement Dependency Injection:** Modify the constructor to accept a generic `logger` adapter, removing hardcoded dependencies on AICA's custom logging structures.

## Phase 4: Consumer Migration & Testing

1. **Update Microservice Usage:** Refactor the AICA microservice (`ai-commerce-accelerator-microservice`) to consume the newly namespaced SDK (e.g., `liferayService.commerce.createProduct(...)` instead of `liferayService.createProduct(...)`).
2. **Update Unit Tests:** Refactor all SDK and microservice Vitest tests to accommodate the new directory structure and JSDoc signatures.
3. **Validate:** Run the entire test suite (`./gradlew testAllCX`) to ensure 100% parity and safety.
