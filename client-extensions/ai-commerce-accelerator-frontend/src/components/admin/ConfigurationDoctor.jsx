import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayCard from '@clayui/card';
import {
  clientExtensionPortletUrl,
  clientExtensionsUrl,
} from '../../utils/liferayLinks';

// Selects the AI Config panel once the configuration extension has loaded.
const AI_CONFIG_PANEL_HASH = '#ai-config';

const RESOLVED = 'RESOLVED';

/**
 * Decides where Adjust Configuration points.
 *
 * The portlet id embeds the company id Liferay assigns per database, so it
 * cannot be baked in - it used to be, and the button failed with
 * "This portlet could not be found" on every instance but the one that id was
 * written against. The microservice reads it from the `client-extension-entry`
 * module, and when that is unavailable the link degrades to the Client
 * Extensions listing, which always resolves, rather than to a dead portlet.
 * See #660.
 */
export function resolveConfigurationLink(configurationExtension, liferayUrl) {
  const portletId =
    configurationExtension?.status === RESOLVED
      ? configurationExtension.portletId
      : null;

  const directUrl = portletId
    ? clientExtensionPortletUrl(liferayUrl, portletId, AI_CONFIG_PANEL_HASH)
    : null;

  if (directUrl) {
    return {
      url: directUrl,
      label: 'Adjust Configuration',
      title: 'Open the AI Commerce Accelerator configuration screen',
    };
  }

  return {
    url: clientExtensionsUrl(liferayUrl),
    label: 'Open Client Extensions',
    title:
      configurationExtension?.message ||
      'The configuration screen could not be resolved for this instance. ' +
        'Open the Client Extensions list and pick the configuration entry.',
  };
}

function configurationExtensionStatus(configurationExtension) {
  if (!configurationExtension) return 'warning';
  return configurationExtension.status === RESOLVED ? 'success' : 'warning';
}

function ConfigurationDoctor({ health, liferayUrl }) {
  if (!health) return null;

  const { configurationExtension } = health;
  const link = resolveConfigurationLink(configurationExtension, liferayUrl);

  return (
    <ClayCard>
      <ClayCard.Body>
        <h4 className="mb-4">Configuration Doctor</h4>

        <div className="health-list">
          <HealthItem
            title="Liferay Connectivity"
            status={
              health.liferay.status === 'CONNECTED' ? 'success' : 'danger'
            }
            message={health.liferay.message || 'Ready for population'}
          />
          <HealthItem
            title="AI Text (Core)"
            status={
              health.aiText.status === 'CONFIGURED' ? 'success' : 'danger'
            }
            message={`${health.aiText.provider} provider active`}
          />
          <HealthItem
            title="AI Media"
            status={
              health.aiMedia.status === 'CONFIGURED' ? 'success' : 'danger'
            }
            message={
              health.aiMedia.provider === 'INHERIT'
                ? `Inheriting from Core AI (${health.aiText.provider})`
                : `${health.aiMedia.provider} provider active`
            }
          />
          <HealthItem
            title="AI Prompts"
            status={health.prompts.status === 'OK' ? 'success' : 'warning'}
            message={
              health.prompts.missing.length > 0
                ? `Missing: ${health.prompts.missing.join(', ')}`
                : 'All templates found'
            }
          />
          <HealthItem
            title="AI Schemas"
            status={health.schemas.status === 'OK' ? 'success' : 'warning'}
            message={
              health.schemas.missing.length > 0
                ? `Missing: ${health.schemas.missing.join(', ')}`
                : 'All contracts valid'
            }
          />
          <HealthItem
            title="Configuration Screen"
            status={configurationExtensionStatus(configurationExtension)}
            message={
              configurationExtension?.message ||
              'Portlet id not reported by the microservice'
            }
          />
        </div>

        <div className="mt-4">
          {link.url ? (
            <a
              href={link.url}
              className="btn btn-primary btn-block"
              target="_blank"
              rel="noopener noreferrer"
              title={link.title}
            >
              <ClayIcon symbol="cog" className="mr-2" />
              {link.label}
            </a>
          ) : (
            <div className="small text-secondary">
              Set the Liferay URL in Connection settings to link to the
              configuration screen.
            </div>
          )}
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

function HealthItem({ title, status, message }) {
  const icon =
    status === 'success'
      ? 'check-circle-full'
      : status === 'danger'
        ? 'exclamation-full'
        : 'warning-full';
  const color =
    status === 'success'
      ? 'text-success'
      : status === 'danger'
        ? 'text-danger'
        : 'text-warning';

  return (
    <div className="py-3 border-bottom d-flex align-items-start">
      <ClayIcon symbol={icon} className={`mr-3 mt-1 ${color}`} />
      <div>
        <div className="font-weight-bold" style={{ fontSize: '0.9rem' }}>
          {title}
        </div>
        <div
          className="small text-secondary text-truncate"
          style={{ maxWidth: '220px' }}
          title={message}
        >
          {message}
        </div>
      </div>
    </div>
  );
}

export default ConfigurationDoctor;
