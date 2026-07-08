# Application Data & Fallbacks

This directory contains persistent application state and hardcoded fallback files for the microservice.

## Files

### `workflows.json`

The primary source of truth for the **PersistenceService**. It stores the state of all asynchronous sessions, batches, and workflow events. This file is managed by `lowdb` and is preserved across restarts.

### `mock-image.json`

A base64-encoded fallback image (WEBP). This is used by the **MediaGenerator** as an ultimate fallback if no default product image has been configured in Liferay.

### `mock-pdf.json`

A base64-encoded fallback PDF document. This is used by the **MediaGenerator** as an ultimate fallback if no default product attachment has been configured in Liferay.

## Maintenance

- **Do not manually edit `workflows.json`** while the service is running, as it may cause state corruption or be overwritten by the active process.
- The mock files are static resources and should only be updated if the default placeholder assets need to be changed.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
