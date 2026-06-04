# Gemini Task State

## Current Goal

Improve tracking and feedback loop of E2E tests, allowing the AI assistant to track and see issues first hand, and resolving the hardcoded Liferay URL in E2E tests (`aica-e2e.local` vs local running environment).

## Plan

1. **Prepare Persistent State**: Initialize `gemini.md`.
2. **Refactor/Parameterize E2E Tests**:
   - Extract/parameterize the `injectAndConnectApp` method or specifically the `liferay-url` custom element attribute inside `playwright/tests/e2e/dashboard.spec.js` and `playwright/tests/e2e/import.spec.js` using `process.env.BASE_URL` (passed via Playwright node process).
3. **Optimize Playwright Settings for Traceability**:
   - Set up Playwright to capture screenshots, videos, and trace files on failure (or always) to make test outcomes completely transparent and easy to debug.
4. **Execute Verification**: Run the E2E verification test suite against the running LDM stack `fragments-test-env`.
5. **Verify/Review Results**: Verify that the tests pass and trace logs/screenshots are generated correctly.

## Current Progress

- `fragments-test-env` is running at `http://localhost:8080`.
- Extracted `injectAndConnectApp` into `playwright/tests/e2e/test-helper.js` and parameterized the `liferay-url` attribute.
- Configured Playwright settings to capture traces/videos on failure.
- Identified strict-mode violation error: `button[type="submit"]` resolves to 3 buttons.
- Fixed strict-mode violation by using a `getByRole` locator for the Start Generation button.
- Identified new issue: `siteGroupId` is missing during dynamic custom element injection, preventing languages from being loaded and causing the button to be disabled.
- Verified that `window.themeDisplay.getScopeGroupId()` returns `20127` and `window.themeDisplay.getLanguageId()` returns `en_US` successfully in page evaluate.
- Removed diagnostic logging that crashed (`window.themeDisplay.getPathFriendlyURLPrivateGroup()`).
- Next step: Run tests again with the cleaned-up `test-helper.js`.
- Identified issue: The microservice's basic auth connection check failed with 401 because the root `.env` file specifies `LIFERAY_API_PASSWORD=L1feray$`, whereas the running local DXP container uses the default password `test`. Playwright succeeded because it defaulted to `test`.
- Next step: Re-run verification tests passing `LIFERAY_API_PASSWORD=test` and `LIFERAY_API_USERNAME=test@liferay.com` in the environment.
- Identified issue: Verification tests ran, but failed because the Channel dropdown auto-selection didn't fetch languages. Liferay Commerce returned `siteGroupId: 0` for the Web Store channel. The frontend hook `useCommerceData.js` used nullish coalescing `channel?.siteGroupId ?? siteGroupId ?? config.siteGroupId` which resolved to `0`, bypassing the correct site group ID `20127` in `config.siteGroupId`. Thus, fetching languages from `/o/headless-admin-user/v1.0/sites/0/languages` failed/was skipped.
- Next step: Edit `client-extensions/ai-commerce-accelerator-frontend/src/hooks/useCommerceData.js` to change `??` to `||` for `siteGroupId` fallback, allowing `0` to fall back to the active page site group ID.
- Identified issue: Verification tests failed because the SDK REST fallback for `getLanguages` used `/o/headless-admin-user/v1.0/sites/${siteGroupId}/languages` which returned 404. The correct endpoint is `/o/headless-delivery/v1.0/sites/${siteGroupId}/languages` (defined in `liferayPaths.cjs` as `PATH.SITE_LANGUAGES`).
- Next step: Update `_getBaseCallbackUrl` in `client-extensions/liferay-accelerator-sdk/src/liferay/rest.cjs` to support overriding via a new `LIFERAY_BATCH_CALLBACK_URL` environment variable, enabling us to set it to `http://host.docker.internal:3001/api/v1/batch/callback` for E2E tests.
- Completed unit tests and fixed code styling/linting across all client extensions and configurations. All tests and lint checks are now passing successfully.

## LDM Reference Documentation

- Main documentation entry point: [LDM README](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/README.md)
- Environment Architecture & Routing Visuals: [LDM Architecture](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/LDM_ARCHITECTURE.md)
- DNS & Client Extension routing rules: [LDM Networking & DNS Guide](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/guides/NETWORKING_DNS.md)
- Replicating Cloud envs locally: [LDM PAAS Local Dev Guide](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/guides/PAAS_LOCAL_DEV.md)
