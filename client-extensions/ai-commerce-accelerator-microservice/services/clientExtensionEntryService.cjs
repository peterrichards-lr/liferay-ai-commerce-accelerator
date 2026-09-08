/**
 * Resolves the portlet id Liferay composes for a client extension, from the
 * `client-extension-entry` OSGi module.
 *
 * Nothing outside the portal JVM publishes it. GraphQL's `ClientExtension` type
 * carries only `clientExtensionConfig` and `externalReferenceCode`, there is no
 * top-level query for entries, and no headless API covers them - so the
 * Dashboard's Adjust Configuration link had the id baked in and broke on every
 * instance but the one it was written against. See #660.
 *
 * The number in the portlet id is the **company id**, not the entry id: the
 * module composes it as `CETDeployerImpl#_getPortletId` does,
 * `prefix + companyId + "_" + normalizedExternalReferenceCode`. That is the
 * module's finding, and the reason a hardcoded id breaks on any fresh database
 * rather than only on a redeploy.
 *
 * Every failure is reported rather than thrown. The module is an optional
 * deployment, so an instance without it - or without the OAuth scope granted -
 * must still render the panel; the caller degrades to the Client Extensions
 * listing, which always resolves.
 */
const APPLICATION_BASE = '/o/client-extension-entry';

// The id AICA declares in the configuration client extension's
// client-extension.yaml. A workspace-deployed extension is held by Liferay
// under "LXC:" plus this, which the module resolves either way.
const CONFIGURATION_EXTERNAL_REFERENCE_CODE =
  'liferay-ai-commerce-accelerator-configuration';

// A single attempt. Every outcome that is not a 200 degrades to a fallback
// link, so retrying a missing module only delays the panel it cannot fix.
const REQUEST_OPTIONS = { maxRetries: 1 };

const STATUS = {
  EXTENSION_NOT_FOUND: 'EXTENSION_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  MODULE_UNAVAILABLE: 'MODULE_UNAVAILABLE',
  NO_PORTLET: 'NO_PORTLET',
  RESOLVED: 'RESOLVED',
  UNAVAILABLE: 'UNAVAILABLE',
};

const MODULE_ABSENT_MESSAGE =
  'The client-extension-entry module is not deployed, or the client extension ' +
  'is not installed. Linking to the Client Extensions list instead.';

function hasBody(data) {
  if (data === undefined || data === null) return false;
  if (typeof data === 'string') return data.trim().length > 0;
  if (typeof data === 'object') return Object.keys(data).length > 0;
  return true;
}

/**
 * Turns a failed lookup into something a reader can act on, because the two
 * ways this call is refused need opposite remedies and look alike:
 * Liferay rejects a missing OAuth scope with an empty-bodied 403 before the
 * request reaches the module, while the module's own refusal carries a JSON
 * body. The same note is on the scope grant in client-extension.yaml.
 */
function describeFailure(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;

  if (status === 403) {
    return hasBody(data)
      ? {
          status: STATUS.FORBIDDEN,
          message:
            'Liferay refused the client extension entry lookup. The service ' +
            'account needs omniadmin, company admin, or access to Client ' +
            'Extension administration.',
        }
      : {
          status: STATUS.FORBIDDEN,
          message:
            'The Custom.Client.Extension.Entry.everything.read OAuth scope is ' +
            'not granted to the microservice application.',
        };
  }

  if (status === 404) {
    // The module answers an unknown external reference code with its own
    // {error: "NotFound"} body; a 404 without it means the route is not
    // mounted, which is what an undeployed module looks like from outside.
    return data?.error === 'NotFound'
      ? {
          status: STATUS.EXTENSION_NOT_FOUND,
          message:
            `No client extension is deployed under ` +
            `${CONFIGURATION_EXTERNAL_REFERENCE_CODE}.`,
        }
      : { status: STATUS.MODULE_UNAVAILABLE, message: MODULE_ABSENT_MESSAGE };
  }

  return {
    status: STATUS.UNAVAILABLE,
    message: `Could not read the client extension entry${
      status ? ` (HTTP ${status})` : ''
    }. Linking to the Client Extensions list instead.`,
  };
}

class ClientExtensionEntryService {
  constructor({ liferayService, logger }) {
    this.liferayService = liferayService;
    this.logger = logger;
  }

  /**
   * Returns the module's report for an external reference code, or throws
   * whatever the request threw. Callers that must not fail use
   * `describeConfigurationExtension` instead.
   */
  async getEntry(config, externalReferenceCode) {
    const rest = this.liferayService?.rest || this.liferayService;

    if (typeof rest?._get !== 'function') {
      return null;
    }

    return rest._get(
      config,
      `${APPLICATION_BASE}/entries/${encodeURIComponent(
        externalReferenceCode
      )}`,
      'get-client-extension-entry',
      'Failed to read client extension entry',
      REQUEST_OPTIONS
    );
  }

  /**
   * Reports the AICA configuration extension for the Configuration Doctor:
   * always an object, never a throw, so the panel can say why the direct link
   * is unavailable rather than sending the reader to a portlet-not-found page.
   */
  async describeConfigurationExtension(config) {
    const externalReferenceCode = CONFIGURATION_EXTERNAL_REFERENCE_CODE;

    let entry;
    try {
      entry = await this.getEntry(config, externalReferenceCode);
    } catch (error) {
      const failure = describeFailure(error);

      this.logger?.debug?.('Client extension entry lookup failed', {
        externalReferenceCode,
        status: error?.response?.status,
        error: error?.message,
      });

      return { ...failure, externalReferenceCode, portletId: null };
    }

    if (!entry) {
      return {
        status: STATUS.MODULE_UNAVAILABLE,
        message: MODULE_ABSENT_MESSAGE,
        externalReferenceCode,
        portletId: null,
      };
    }

    if (!entry.portletId) {
      return {
        status: STATUS.NO_PORTLET,
        message:
          'The client extension is deployed but registers no portlet, so ' +
          'there is no screen to link to.',
        externalReferenceCode:
          entry.externalReferenceCode || externalReferenceCode,
        portletId: null,
      };
    }

    return {
      status: STATUS.RESOLVED,
      message: 'Configuration screen resolved for this instance.',
      externalReferenceCode: entry.externalReferenceCode,
      portletId: entry.portletId,
    };
  }
}

module.exports = {
  APPLICATION_BASE,
  CONFIGURATION_EXTERNAL_REFERENCE_CODE,
  ClientExtensionEntryService,
  STATUS,
};
