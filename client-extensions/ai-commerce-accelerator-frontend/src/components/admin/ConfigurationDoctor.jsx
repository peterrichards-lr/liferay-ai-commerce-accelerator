import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayCard from '@clayui/card';

function ConfigurationDoctor({ health, liferayUrl }) {
  if (!health) return null;

  const configUrl = `${liferayUrl}/group/guest/~/control_panel/manage?p_p_id=com_liferay_client_extension_web_internal_portlet_ClientExtensionEntryPortlet_30394841094851_LXC_liferay_ai_commerce_accelerator_configuration&p_p_lifecycle=0&p_p_state=maximized#ai-config`;

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
        </div>

        <div className="mt-4">
          <a
            href={configUrl}
            className="btn btn-primary btn-block"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ClayIcon symbol="cog" className="mr-2" />
            Adjust Configuration
          </a>
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
