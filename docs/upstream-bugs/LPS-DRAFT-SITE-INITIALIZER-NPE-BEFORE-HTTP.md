# Liferay DXP Bug Report: Site Initializer NullPointerException (getCanonicalURL) before Welcome Site Initialization

**Status:** DRAFT (PENDING SUBMISSION)

[JIRA-KEY] - https://liferay.atlassian.net/browse/[JIRA-KEY]

## Component

- **Site Initializers**
- **OSGi Client Extension Deployer**

## Environment

- **Liferay Product Version**: Liferay DXP 2026.q1.7-lts
- **API/Class**: `SiteInitializerClientExtension`, `ServiceContextFactory.getInstance()`, `PortalImpl.getCanonicalURL()`

## Summary

When a headless Site Initializer Client Extension is deployed via the `osgi/client-extensions` directory _before_ Liferay boots, it is processed automatically by the OSGi `AutoDeployScanner` in a background thread once the Spring context initializes. However, because the default Welcome site is lazily scaffolded by the first incoming HTTP request, the default layout context does not yet exist. When the Site Initializer attempts to create the site (`putSiteByExternalReferenceCode`), `ServiceContextFactory` attempts to generate a canonical URL using the default company layout as a fallback, which is `null`, resulting in a fatal `NullPointerException` that crashes the extension deployment.

## Description & Technical Analysis

Liferay's OSGi framework correctly waits for the Spring Context to finish starting before it attempts to process client extensions in `osgi/client-extensions`.
However, it considers itself "ready" even though the `BundleSiteInitializer` for the default Liferay Welcome Site (Group 20127) has not executed. The Welcome site is lazily initialized on the _first incoming HTTP request_ (e.g. `[http-nio-8080-exec-2]`).

Because the Site Initializer Client Extension runs in a background thread (`SystemExecutorServiceUtil-1`), there is no `HttpServletRequest` available when the extension calls the headless `putSiteByExternalReferenceCode` API. The API internally constructs a `ServiceContext` via `ServiceContextFactory.getInstance()`. To populate the context, it calls `PortalUtil.getCanonicalURL()`. Since no request is present, it falls back to the default company layout. Since the Welcome site has not been scaffolded, the layout is `null`.

**Stack Trace snippet:**

```text
Caused by: java.lang.NullPointerException: Cannot invoke "com.liferay.portal.kernel.model.Layout.getGroupId()" because "layout" is null
    at com.liferay.portal.util.PortalImpl.getCanonicalURL(PortalImpl.java:1559)
    at com.liferay.portal.util.PortalImpl.getCanonicalURL(PortalImpl.java:1497)
    at com.liferay.portal.kernel.util.PortalUtil.getCanonicalURL(PortalUtil.java:408)
    at com.liferay.portal.kernel.service.ServiceContextFactory._getInstance(ServiceContextFactory.java:176)
    at com.liferay.portal.kernel.service.ServiceContextFactory.getInstance(ServiceContextFactory.java:55)
    at com.liferay.headless.site.internal.resource.v1_0.SiteResourceImpl._getServiceContext(SiteResourceImpl.java:501)
    at com.liferay.headless.site.internal.resource.v1_0.SiteResourceImpl._addGroup(SiteResourceImpl.java:359)
    at com.liferay.headless.site.internal.resource.v1_0.SiteResourceImpl.putSiteByExternalReferenceCode(SiteResourceImpl.java:227)
```

## Steps to Reproduce

1. Create a `siteInitializer` Client Extension and place its `.zip` file in `/opt/liferay/osgi/client-extensions` before Liferay boots up.
2. Start Liferay DXP (e.g. via a Docker container) without sending any HTTP requests to it.
3. Wait for the Spring context to initialize. The OSGi framework will automatically pick up and execute the `SiteInitializerClientExtension`.
4. Observe the `NullPointerException` in the Liferay logs as the Site Initializer fails.
5. Send an HTTP request to the Liferay instance. Observe that `BundleSiteInitializer` finally initializes the Welcome site.

## Expected Results

The headless API for site creation (`putSiteByExternalReferenceCode`) should either handle a `null` layout safely without crashing when invoked from a background thread, or Liferay should block the execution of `SiteInitializerClientExtension` until the default Welcome site and portal contexts are fully initialized.

## Workaround

In environments (like CI/CD or Liferay Docker Manager scripts), we must delay the copy/deployment of the Site Initializer Client Extension `.zip` file into `osgi/client-extensions` or `/opt/liferay/deploy` until **after** an HTTP request has been sent to Liferay (e.g. using `ldm wait` or `curl`) to force the Welcome site scaffolding to complete. Once the HTTP layer responds with 200 OK, the `.zip` file can be safely deployed and processed.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
