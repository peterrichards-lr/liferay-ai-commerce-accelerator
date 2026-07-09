# Liferay JSON Web Services (JSONWS) Guide

This document provides an overview of the Liferay JSON Web Services available at `/api/jsonws`.

> **Mandate:** These endpoints are considered **Lower Priority**. Always prefer modern **REST APIs** (`/o/headless-...`) or **GraphQL** (`/o/graphql`) where available. Use JSONWS only when a feature is not exposed via Headless APIs.

---

## 1. Overview

Liferay automatically exposes its internal Java services (Remote Services) as JSON-compatible web services. Every Liferay instance includes a built-in API explorer.

- **URL:** `http://localhost:8080/api/jsonws`
- **Features:**
  - Lists all available services and methods.
  - Provides interactive forms to test calls.
  - Generates code snippets for `curl`, `JavaScript`, and `URL` invocations.

---

## 2. Common Service Categories

While thousands of methods are available, the following categories are most relevant to the AI Commerce Accelerator:

### User & Permissions

- **`/user/get-current-user`**: Retrieve details for the authenticated user.
- **`/role/get-user-roles`**: Check roles assigned to a user.
- **`/group/get-user-sites`**: List sites the user has access to.

### Portal & Environment

- **`/portal/get-version`**: Get the exact Liferay version and build number.
- **`/country/get-countries`**: Retrieve a list of active countries (useful for address generators).
- **`/region/get-regions`**: Retrieve regions/states for a specific country.

### Commerce (Legacy/Internal)

If modern Headless Commerce APIs are missing a specific field or action, check these namespaces in the explorer:

- `commerce.commerceaddress`
- `commerce.commerceorder`
- `commerce.commerceproduct`
- `commerce.cpdefinition` (Catalog Product Definitions)

### Fragments & Pages

- **`/fragment.fragmententry/get-fragment-entries`**: List available fragments.
- **`/layout/get-layout`**: Get layout (page) details.

---

## 3. Validating Fragments on Page

To validate that fragments are correctly deployed and appearing on a Content Page, use the following approaches:

### A. Modern REST (Preferred)

The `SitePage` Headless API provides the "Page Definition" which contains the fragment structure.

- **Endpoint:** `GET /o/headless-delivery/v1.0/site-pages/{pageId}`
- **Validation:** Inspect the `pageDefinition` property. It contains a tree of `pageElements`.
  - Look for elements with `"type": "fragment"`.
  - Verify the `"fragmentEntryKey"` matches your expected fragment.

### B. Playwright (E2E Validation)

As specified in our workflow, Playwright is the primary tool for verifying fragments appear on the page.

- **Action:** Navigate to the page URL.
- **Validation:** Use locators to find specific fragment IDs or class names (e.g., `.fragment-entry-link`).

### C. JSONWS (Fallback)

If REST doesn't provide enough detail, you can probe internal layout data:

- **Service:** `Layout`
- **Method:** `/layout/get-layout`
- **Note:** This returns the `typeSettings` which may contain fragment mapping references, though it is harder to parse than the REST Page Definition.

---

## 4. Invocation Conventions

Liferay determines the HTTP method based on the Java method signature:

| Method Name Starts With...                      | HTTP Verb |
| :---------------------------------------------- | :-------- |
| `get`, `is`, `has`                              | **GET**   |
| Anything else (e.g., `add`, `update`, `delete`) | **POST**  |

### Authentication

JSONWS endpoints respect the same authentication mechanisms as the rest of the portal:

- **Basic Auth**: `Authorization: Basic [base64(user:pass)]`
- **OAuth2**: `Authorization: Bearer [token]` (Use `Liferay.authToken` in the browser context).

---

## 5. Usage in this Project

Currently, the AI Commerce Accelerator does **not** rely on JSONWS. All data generation and deletion flows are built on:

1. **Liferay Headless Admin APIs** (REST)
2. **Liferay Headless Commerce APIs** (REST)
3. **Liferay Batch Engine** (REST)
4. **Liferay GraphQL** (for complex discovery)

If you find a gap where a JSONWS call is needed:

1. Document the requirement in `docs/todo.md`.
2. Wrap the JSONWS call in a new method within `LiferayRestService` in the SDK.
3. Add a comment explaining why a standard Headless API could not be used.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
