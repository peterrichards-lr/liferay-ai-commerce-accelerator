# Liferay DXP Bug Report: Site Initializer Client Extension NPE when Deployed Before HTTP Initialization

[JIRA-KEY] - https://liferay.atlassian.net/browse/[JIRA-KEY]

## Component

- **Client Extensions**
- **Site Initializer Client Extension / Portal Initialization**

## Environment

- **Liferay Product Version**: Liferay DXP 2026.q1
- **Deployment Strategy**: File System Auto Deploy (`/opt/liferay/osgi/client-extensions` or `/opt/liferay/deploy`)
- **Docker Environment**: Liferay Docker container or LDM Sidecar Environment

## Summary

When a Site Initializer Client Extension `.zip` file is placed in the Liferay OSGi deployment directory (`osgi/client-extensions/` or `deploy/`) _before_ Liferay starts up, the auto-deploy scanner processes it during the early boot sequence. Because Liferay's portal contexts, default layouts, and theme display environments are not yet fully initialized prior to HTTP availability, the Site Initializer attempts to execute and subsequently crashes with a `NullPointerException` (NPE). This causes the Liferay boot process to hang or fail, preventing the portal from successfully starting.

## Description & Technical Analysis

Liferay's auto-deploy engine begins processing deployable artifacts early in the startup sequence. Client Extensions are typically resilient to this because they are usually just configuration or routing data. However, Site Initializer Client Extensions contain site templates, fragments, pages, and portlet preferences that must be applied to an actual site context.

If the Site Initializer `client-extension.yaml` is detected and processed before the HTTP transport layer and portal company context are fully initialized, the initializer attempts to access services (such as layout configurations or theme context) that return `null`, resulting in an NPE in the console logs.

This creates a race condition for developers using CI/CD pipelines, Docker environments, or Liferay Developer Machine (LDM), where "seeding" a clean container with a Site Initializer client extension at startup will fatally crash the container.

## Steps to Reproduce

1. Create a standard Site Initializer Client Extension (`site-initializer-client-extension.zip`).
2. Provision a fresh Liferay DXP container or local Liferay bundle.
3. Before starting Liferay, copy `site-initializer-client-extension.zip` into the `[LIFERAY_HOME]/osgi/client-extensions/` directory (or map it via Docker volume).
4. Start Liferay.
5. Observe the startup logs. During the `Auto deploy scanner started` phase, Liferay processes the zip.
6. The startup logs throw a `NullPointerException` associated with the Site Initializer portlet preferences/layout generation, and Liferay fails to complete initialization.

## Expected Results

Site Initializer Client Extensions deployed at boot should either be placed in a queue and deferred until the portal context/HTTP is fully initialized, or they should safely execute without throwing a `NullPointerException` by resolving dependencies dynamically. Liferay should successfully boot even if a Site Initializer zip is present in the deploy directory at startup.

## Workaround

In our environment, we implemented a custom startup synchronization script (`scripts/run-e2e-ldm.sh`) that dynamically splits the deployment of Client Extensions:

1. All non-Site-Initializer Client Extensions (e.g., microservice, OAuth, batch, config) are copied to `osgi/client-extensions/` _before_ Liferay starts.
2. We actively poll Liferay until the initial HTTP layout endpoint (`/c/portal/layout`) returns a valid 200/302 response, proving Liferay is fully booted.
3. _Only then_ do we invoke `ldm deploy` or copy the `site-initializer-client-extension.zip` into the `deploy` folder.

This guarantees the Site Initializer only runs after Liferay is fully initialized, successfully bypassing the NPE crash.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-06_ | _Last Reviewed: 2026-07-06_
