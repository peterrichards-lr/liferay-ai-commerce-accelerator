# Track Implementation Plan: Project Foundations & Tooling

## Phase 1: Test Infrastructure (Microservice)

- [x] Install Vitest and MSW in `ai-commerce-accelerator-microservice`.
- [x] Configure `vitest.config.cjs`.
- [x] Create a `tests` directory.
- [x] Implement a basic health check test for `healthService.cjs`.

## Phase 2: Mocking Foundation

- [x] Setup MSW server and handlers in `microservice/mocks`.
- [x] Create a sample mock for a common Liferay API (e.g., `getProducts`).
- [x] Verify mocking works in a unit test.

## Phase 3: Frontend Foundations

- [x] Install Vitest and React Testing Library in `ai-commerce-accelerator-frontend`.
- [x] Configure Vitest for React.
- [x] Create a basic test for `App.jsx`.

## Phase 4: Consistency & Cleanup

- [x] Audit `.prettierrc` across components.
- [x] Add `lint` and `test` scripts to all `package.json` files.
- [x] Add Vitest to `ai-commerce-accelerator-configuration`.
