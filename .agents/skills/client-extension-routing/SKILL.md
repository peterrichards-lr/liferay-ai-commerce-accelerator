---
name: client-extension-routing
description: Activate this skill when editing client-extension.yaml configuration files or scaffolding new client extensions.
---

# Client Extension Routing & Configuration Rules

When modifying client extensions, the following routing configuration constraints must be followed:

## 1. Service Address & Scheme Overrides

When modifying `client-extension.yaml` files, **NEVER change or remove `.serviceAddress: localhost:3001` or `.serviceScheme`** manually to fix Docker or LDM routing issues.

Liferay automatically updates the shared routes context with the correct internal endpoint when the generated `.zip` file is copied to the Liferay `osgi/client-extensions` deploy folder. Modifying these properties manually will override the auto-registration and break the deployment.

## 2. OAuth2 & Context

- All client extension configurations must rely exclusively on `Liferay.authToken` and standard OAuth2 patterns.
- No hardcoded credentials.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-19_ | _Last Reviewed: 2026-07-19_
