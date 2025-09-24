import React, { useState } from 'react';
import { useApp, useApi } from '../context/AppContext';

import notifyUser from '../utils/notifications';

function ConfigurationPanel({
  disabled,
  onConnectionStatusChange,
  onOpenAiKeyStatusChange,
}) {
  const [availableCatalogs, setAvailableCatalogs] = useState([]);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [availableCurrencies, setAvailableCurrencies] = useState([]);
  const [availableLanguages, setAvailableLanguages] = useState([]);
  const [isLoadingCatalogs, setIsLoadingCatalogs] = useState(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState(false);
  const [isLoadingLanguages, setIsLoadingLanguages] = useState(false);
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  const { config, setConfig } = useApp();
  const api = useApi();

  const handleConfigChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));

    if (field === 'channelId' && value) {
      fetchLanguages(value);

      const selectedChannel = availableChannels.find(
        (channel) => channel.id === parseInt(value)
      );
      if (selectedChannel?.currencyCode) {
        setConfig((prev) => ({
          ...prev,
          currencyCode: selectedChannel.currencyCode,
        }));
      }
      if (selectedChannel?.siteGroupId) {
        setConfig((prev) => ({
          ...prev,
          siteGroupId: selectedChannel.siteGroupId,
        }));
      }
    }
  };

  const fetchLanguagesWithChannelData = async (channelId, siteGroupId) => {
    if (!channelId || !siteGroupId) {
      setAvailableLanguages([]);
      return;
    }

    setIsLoadingLanguages(true);
    try {
      const connectionConfig = {
        liferayUrl: config.liferayUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        localeCode: config.localeCode,
        languageId: config.languageId,
        siteGroupId: siteGroupId,
      };

      const languageResponse = await api.post(
        '/api/get-languages',
        connectionConfig
      );

      if (languageResponse.success) {
        setAvailableLanguages(languageResponse.languages);

        const defaultLanguages = languageResponse.languages
          .filter((language) => language.markedAsDefault)
          .map((language) => language.id);

        if (defaultLanguages.length > 0) {
          setConfig((prev) => ({
            ...prev,
            selectedLanguages: defaultLanguages,
          }));
        }
      }
    } catch (error) {
      console.error('Failed to fetch languages:', error);
      setAvailableLanguages([]);
    } finally {
      setIsLoadingLanguages(false);
    }
  };

  const fetchLanguages = async (channelId) => {
    if (!channelId) {
      setAvailableLanguages([]);
      return;
    }

    const selectedChannel = availableChannels.find(
      (channel) => channel.id === parseInt(channelId)
    );
    if (!selectedChannel?.siteGroupId) {
      console.warn('No siteGroupId found for selected channel');
      setAvailableLanguages([]);
      return;
    }

    await fetchLanguagesWithChannelData(channelId, selectedChannel.siteGroupId);
  };

  const fetchEnvironmentData = async () => {
    if (
      !config.liferayUrl ||
      !config.clientId ||
      !config.clientSecret ||
      !config.localeCode
    ) {
      return;
    }

    const connectionConfig = {
      liferayUrl: config.liferayUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      localeCode: config.localeCode,
      languageId: config.languageId,
    };

    setIsLoadingCatalogs(true);
    try {
      const catalogResponse = await api.post(
        '/api/get-catalogs',
        connectionConfig
      );
      if (catalogResponse.success) {
        setAvailableCatalogs(catalogResponse.catalogs);
        if (!config.catalogId && catalogResponse.catalogs.length > 0) {
          handleConfigChange('catalogId', catalogResponse.catalogs[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch catalogs:', error);
      setAvailableCatalogs([]);
    } finally {
      setIsLoadingCatalogs(false);
    }

    setIsLoadingChannels(true);
    try {
      const channelResponse = await api.post(
        '/api/get-channels',
        connectionConfig
      );
      if (channelResponse.success) {
        setAvailableChannels(channelResponse.channels);
        if (!config.channelId && channelResponse.channels.length > 0) {
          const firstChannel = channelResponse.channels[0];
          const firstChannelId = firstChannel.id;
          setConfig((prev) => ({
            ...prev,
            channelId: firstChannelId,
            currencyCode: firstChannel.currencyCode || prev.currencyCode,
          }));
          await fetchLanguagesWithChannelData(
            firstChannelId,
            firstChannel.siteGroupId
          );
        }
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error);
      setAvailableChannels([]);
    } finally {
      setIsLoadingChannels(false);
    }

    setIsLoadingCurrencies(true);
    try {
      const currencyResponse = await api.post(
        '/api/get-currencies',
        connectionConfig
      );
      if (currencyResponse.success) {
        setAvailableCurrencies(currencyResponse.currencies);
      }
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
      setAvailableCurrencies([
        { code: 'USD', name: 'US Dollar' },
        { code: 'EUR', name: 'Euro' },
        { code: 'GBP', name: 'British Pound' },
      ]);
    } finally {
      setIsLoadingCurrencies(false);
    }
  };

  const testConnection = async () => {
    setValidationErrors({});

    const newValidationErrors = {};

    if (!config.clientId || config.clientId.trim() === '') {
      newValidationErrors.clientId = 'OAuth Client ID is required';
    }

    if (!config.clientSecret || config.clientSecret.trim() === '') {
      newValidationErrors.clientSecret = 'OAuth Client Secret is required';
    }

    if (!config.liferayUrl || config.liferayUrl.trim() === '') {
      newValidationErrors.liferayUrl = 'Liferay URL is required';
    }

    if (Object.keys(newValidationErrors).length > 0) {
      setValidationErrors(newValidationErrors);
      notifyUser('Please fill in all required fields', 'danger');
      return;
    }

    try {
      const response = await api.post('/api/test-connection', config);
      if (response.success) {
        setConnectionEstablished(true);

        if (onConnectionStatusChange) {
          onConnectionStatusChange(true);
        }
        if (onOpenAiKeyStatusChange) {
          onOpenAiKeyStatusChange(response.openAiKeyAvailable);
        }

        if (!response.openAiKeyAvailable) {
          setConfig((prev) => ({ ...prev, demoMode: true }));
          notifyUser(
            'Connection successful! OpenAI key not found - Demo mode enabled.',
            'warning'
          );
        } else {
          notifyUser('Connection successful! Loading environment data...');
        }

        await fetchEnvironmentData();
      } else {
        setConnectionEstablished(false);

        if (onConnectionStatusChange) {
          onConnectionStatusChange(false);
        }
        if (onOpenAiKeyStatusChange) {
          onOpenAiKeyStatusChange(false);
        }
        notifyUser('Connection failed', 'danger', response.error);
      }
    } catch (error) {
      setConnectionEstablished(false);
      if (onConnectionStatusChange) {
        onConnectionStatusChange(false);
      }
      if (onOpenAiKeyStatusChange) {
        onOpenAiKeyStatusChange(false);
      }

      const errorData = error.response?.data;
      const newValidationErrors = {};

      if (errorData?.errorType && errorData?.field) {
        newValidationErrors[errorData.field] = errorData.error;
        setValidationErrors(newValidationErrors);

        if (errorData.errorReference) {
          console.error(
            `🚨 CONNECTION ERROR - Error Reference: ${errorData.errorReference}`
          );
          console.error(
            `📞 Contact support with this reference for detailed troubleshooting: ${errorData.errorReference}`
          );
        }
      } else if (error.response?.status === 400 && errorData?.error) {
        const errorMessage = errorData.error;
        if (errorMessage.includes('clientId is required')) {
          newValidationErrors.clientId = 'OAuth Client ID is required';
        }
        if (errorMessage.includes('clientSecret is required')) {
          newValidationErrors.clientSecret = 'OAuth Client Secret is required';
        }
        if (Object.keys(newValidationErrors).length > 0) {
          setValidationErrors(newValidationErrors);
        }
      } else {
        const errorMessage = error.response?.data?.error || error.message;

        if (error.response?.status === 401 || error.response?.status === 403) {
          newValidationErrors.clientSecret =
            'Authentication failed. Please verify your OAuth Client ID and Client Secret are correct.';

          // Log error reference for support
          if (errorData?.errorReference) {
            console.error(
              `🚨 AUTHENTICATION ERROR - Error Reference: ${errorData.errorReference}`
            );
            console.error(
              `📞 Contact support with this reference for detailed troubleshooting: ${errorData.errorReference}`
            );
          }
        } else if (
          error.code === 'ECONNREFUSED' ||
          error.response?.status === 404 ||
          error.message.includes('Network Error')
        ) {
          newValidationErrors.microserviceUrl =
            'Unable to connect to the microservice. Please check the URL and ensure microservice is running.';

          // Log error reference for support
          if (errorData?.errorReference) {
            console.error(
              `🚨 CONNECTION ERROR - Error Reference: ${errorData.errorReference}`
            );
            console.error(
              `📞 Contact support with this reference for detailed troubleshooting: ${errorData.errorReference}`
            );
          }
        }

        if (Object.keys(newValidationErrors).length > 0) {
          setValidationErrors(newValidationErrors);
        }
      }

      if (Object.keys(newValidationErrors).length === 0) {
        notifyUser(
          'Connection test failed. Please check your configuration.',
          'danger'
        );
      }

      console.error(
        'Connection test failed',
        error.response?.data?.error || error.message
      );
    }
  };

  return (
    <div className="d-flex flex-column h-100">
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">
            <i className="fas fa-cog me-2"></i>
            Liferay Configuration
          </h5>
        </div>
        <div className="card-body">
          <form name="liferayConfiguration">
            <div className="mb-3">
              <label
                htmlFor="liferayConfiguration_liferayUrl"
                className="form-label"
              >
                Liferay URL
              </label>
              <input
                id="liferayConfiguration_liferayUrl"
                type="url"
                className={`form-control ${
                  validationErrors.liferayUrl ? 'is-invalid' : ''
                }`}
                value={config.liferayUrl}
                onChange={(e) => {
                  handleConfigChange('liferayUrl', e.target.value);
                  if (validationErrors.liferayUrl) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      liferayUrl: null,
                    }));
                  }
                }}
                disabled={disabled}
                placeholder="http://localhost:8080"
              />
              {validationErrors.liferayUrl && (
                <div className="invalid-feedback text-warning">
                  {validationErrors.liferayUrl}
                </div>
              )}
            </div>

            <div className="mb-3">
              <label
                htmlFor="liferayConfiguration_oAuthClientId"
                className="form-label"
              >
                <i className="fas fa-key me-2"></i>
                OAuth Client ID
              </label>
              <input
                id="liferayConfiguration_oAuthClientId"
                type="text"
                className={`form-control ${
                  validationErrors.clientId ? 'is-invalid' : ''
                }`}
                value={config.clientId}
                onChange={(e) => {
                  handleConfigChange('clientId', e.target.value);
                  if (validationErrors.clientId) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      clientId: null,
                    }));
                  }
                }}
                disabled={disabled}
                placeholder="your-oauth-client-id"
              />
              <div className="form-text">
                OAuth 2.0 Client ID from your Liferay Client Extension
              </div>
              {validationErrors.clientId && (
                <div className="invalid-feedback text-warning">
                  {validationErrors.clientId}
                </div>
              )}
            </div>

            <div className="mb-3">
              <label
                htmlFor="liferayConfiguration_oAuthClientSecret"
                className="form-label"
              >
                <i className="fas fa-lock me-2"></i>
                OAuth Client Secret
              </label>
              <input
                id="liferayConfiguration_oAuthClientSecret"
                type="password"
                className={`form-control ${
                  validationErrors.clientSecret ? 'is-invalid' : ''
                }`}
                value={config.clientSecret}
                onChange={(e) => {
                  handleConfigChange('clientSecret', e.target.value);
                  if (validationErrors.clientSecret) {
                    setValidationErrors((prev) => ({
                      ...prev,
                      clientSecret: null,
                    }));
                  }
                }}
                disabled={disabled}
                placeholder="your-oauth-client-secret"
              />
              <div className="form-text">
                OAuth 2.0 Client Secret from your Liferay Client Extension
              </div>
              {validationErrors.clientSecret && (
                <div className="invalid-feedback text-warning">
                  {validationErrors.clientSecret}
                </div>
              )}
            </div>

            <div className="mb-3">
              <label
                className="form-label"
                htmlFor="liferayConfiguration_catalog"
              >
                Catalog
                {isLoadingCatalogs && (
                  <span
                    className="spinner-border spinner-border-sm ms-2"
                    role="status"
                  ></span>
                )}
              </label>
              <select
                id="liferayConfiguration_catalog"
                className="form-control"
                value={config.catalogId}
                onChange={(e) =>
                  handleConfigChange(
                    'catalogId',
                    parseInt(e.target.value) || null
                  )
                }
                disabled={disabled || isLoadingCatalogs}
              >
                <option value="">Select a catalog...</option>
                {availableCatalogs.map((catalog) => (
                  <option key={catalog.id} value={catalog.id}>
                    {catalog.name?.en_US ||
                      catalog.name ||
                      `Catalog ${catalog.id}`}
                  </option>
                ))}
              </select>
              {!connectionEstablished && (
                <small className="form-text text-muted">
                  Test connection first to load available catalogs
                </small>
              )}
              {connectionEstablished &&
                availableCatalogs.length === 0 &&
                !isLoadingCatalogs && (
                  <small className="form-text text-warning">
                    No catalogs found. You may need to create a catalog in
                    Liferay first.
                  </small>
                )}
            </div>

            <div className="mb-3">
              <label
                className="form-label"
                htmlFor="liferayConfiguration_channel"
              >
                Channel
                {isLoadingChannels && (
                  <span
                    className="spinner-border spinner-border-sm ms-2"
                    role="status"
                  ></span>
                )}
              </label>
              <select
                id="liferayConfiguration_channel"
                className="form-control"
                value={config.channelId}
                onChange={(e) =>
                  handleConfigChange('channelId', e.target.value)
                }
                disabled={disabled || isLoadingChannels}
              >
                <option value="">Select a channel...</option>
                {availableChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name?.en_US ||
                      channel.name ||
                      `Channel ${channel.id}`}
                  </option>
                ))}
              </select>
              {!connectionEstablished && (
                <small className="form-text text-muted">
                  Test connection first to load available channels
                </small>
              )}
              {connectionEstablished &&
                availableChannels.length === 0 &&
                !isLoadingChannels && (
                  <small className="form-text text-warning">
                    No channels found. You may need to create a channel in
                    Liferay first.
                  </small>
                )}
            </div>

            <div className="mb-3">
              <span className="text-truncate-inline">
                <span className="text-truncate" title="Input Group">
                  Languages
                  {isLoadingLanguages && (
                    <span
                      className="spinner-border spinner-border-sm ms-2"
                      role="status"
                    ></span>
                  )}
                </span>
              </span>
              <div
                className="border rounded p-2"
                style={{ maxHeight: '200px', overflowY: 'auto' }}
              >
                {availableLanguages.length > 0 ? (
                  availableLanguages.map((language) => (
                    <div key={language.id} className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`language-${language.id}`}
                        checked={
                          config.selectedLanguages?.includes(language.id) ||
                          false
                        }
                        onChange={(e) => {
                          const currentLanguages =
                            config.selectedLanguages || [];
                          const newLanguages = e.target.checked
                            ? [...currentLanguages, language.id]
                            : currentLanguages.filter(
                                (id) => id !== language.id
                              );
                          handleConfigChange('selectedLanguages', newLanguages);
                        }}
                        disabled={disabled || isLoadingLanguages}
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`language-${language.id}`}
                      >
                        {language.name || language.id}
                      </label>
                    </div>
                  ))
                ) : (
                  <small className="text-muted">
                    {!config.channelId
                      ? 'Select a channel first to load available languages'
                      : isLoadingLanguages
                      ? 'Loading languages...'
                      : 'No languages found'}
                  </small>
                )}
              </div>
              {config.selectedLanguages &&
                config.selectedLanguages.length > 0 && (
                  <small className="form-text text-muted">
                    {config.selectedLanguages.length} language(s) selected
                  </small>
                )}
            </div>

            <div className="mb-3">
              <label
                className="form-label"
                htmlFor="liferayConfiguration_currency"
              >
                Currency
                {isLoadingCurrencies && (
                  <span
                    className="spinner-border spinner-border-sm ms-2"
                    role="status"
                  ></span>
                )}
              </label>
              <select
                id="liferayConfiguration_currency"
                className="form-control"
                value={config.currencyCode}
                onChange={(e) =>
                  handleConfigChange('currencyCode', e.target.value)
                }
                disabled={disabled || isLoadingCurrencies}
              >
                <option value="">Select a currency...</option>
                {availableCurrencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className={`btn w-100 ${
                connectionEstablished ? 'btn-success' : 'btn-outline-primary'
              }`}
              onClick={testConnection}
              disabled={disabled}
            >
              <i
                className={`fas ${
                  connectionEstablished ? 'fa-check' : 'fa-plug'
                } me-2`}
              ></i>
              {connectionEstablished
                ? 'Connected & Loaded'
                : 'Test Connection & Load Data'}
            </button>
            {validationErrors.microserviceUrl && (
              <div className="error-message">
                {validationErrors.microserviceUrl}
              </div>
            )}
          </form>
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">
            <i className="fas fa-cog me-2"></i>
            Generator Configuration
          </h5>
        </div>
        <div className="card-body">
          <form name="generatorConfiguration">
            <div className="mb-3">
              <label
                htmlFor="generatorConfiguration_microserviceUrl"
                className="form-label"
              >
                Microservice URL
              </label>
              <input
                id="generatorConfiguration_microserviceUrl"
                type="url"
                className="form-control"
                value={config.microserviceUrl}
                onChange={(e) =>
                  handleConfigChange('microserviceUrl', e.target.value)
                }
                disabled={disabled}
                placeholder="http://localhost:3001"
              />
            </div>

            <div className="mb-3">
              <label
                htmlFor="generatorConfiguration_batchSize"
                className="form-label"
              >
                Batch Size
              </label>
              <select
                id="generatorConfiguration_batchSize"
                className="form-control"
                value={config.batchSize}
                onChange={(e) =>
                  handleConfigChange('batchSize', parseInt(e.target.value))
                }
                disabled={disabled}
              >
                <option value={1}>1 (Slowest, Most Reliable)</option>
                <option value={3}>3</option>
                <option value={5}>5 (Recommended)</option>
                <option value={10}>10</option>
                <option value={20}>20 (Fastest, May Cause Errors)</option>
              </select>
            </div>

            <div className="mb-3">
              <label
                htmlFor="generatorConfiguration_pollingDelay"
                className="form-label"
              >
                Batch Polling Delay (seconds)
              </label>
              <input
                id="generatorConfiguration_pollingDelay"
                type="number"
                className="form-control"
                value={config.pollingDelay}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 10;
                  const clampedValue = Math.max(5, Math.min(600, value));
                  handleConfigChange('pollingDelay', clampedValue);
                }}
                disabled={disabled}
                min="5"
                max="600"
                placeholder="10"
              />
              <small className="form-text text-muted">
                How often to check batch status (5-600 seconds, default: 10)
              </small>
            </div>

            <div className="mb-3">
              <label
                className="form-label"
                htmlFor="generatorConfiguration_AiModel"
              >
                AI Model
              </label>
              <select
                id="generatorConfiguration_AiModel"
                className="form-control"
                value={config.aiModel}
                onChange={(e) => handleConfigChange('aiModel', e.target.value)}
                disabled={disabled}
              >
                <option value="gpt-4o">GPT-4o (Latest & Most Capable)</option>
                <option value="gpt-4o-mini">
                  GPT-4o Mini (Faster & Cost-Effective)
                </option>
                <option value="gpt-4-turbo">
                  GPT-4 Turbo (Previous Generation)
                </option>
                <option value="gpt-3.5-turbo">
                  GPT-3.5 Turbo (Fastest & Cheapest)
                </option>
              </select>
              <small className="form-text text-muted">
                Choose based on your quality vs cost preference
              </small>
            </div>

            <hr className="my-4" />

            <div className="mb-3">
              <label className="form-label">
                <i className="fas fa-terminal me-2"></i>
                Console Logging Controls
              </label>
              <small className="form-text text-muted d-block mb-3">
                Control the verbosity of browser console logging for debugging
              </small>

              <div className="row">
                <div className="col-md-6">
                  <label
                    htmlFor="generatorConfiguration_reactLogging"
                    className="form-label"
                  >
                    React Lifecycle Logging
                  </label>
                  <select
                    id="generatorConfiguration_reactLogging"
                    className="form-control"
                    value={config.reactLoggingLevel || 'off'}
                    onChange={(e) =>
                      handleConfigChange('reactLoggingLevel', e.target.value)
                    }
                    disabled={disabled}
                  >
                    <option value="off">Off</option>
                    <option value="info">Info (Basic lifecycle events)</option>
                    <option value="verbose">
                      Verbose (Detailed state changes)
                    </option>
                  </select>
                </div>

                <div className="col-md-6">
                  <label
                    htmlFor="generatorConfiguration_wsLogging"
                    className="form-label"
                  >
                    WebSocket Logging
                  </label>
                  <select
                    id="generatorConfiguration_wsLogging"
                    className="form-control"
                    value={config.wsLoggingLevel || 'off'}
                    onChange={(e) =>
                      handleConfigChange('wsLoggingLevel', e.target.value)
                    }
                    disabled={disabled}
                  >
                    <option value="off">Off</option>
                    <option value="info">Info (Connection events)</option>
                    <option value="verbose">Verbose (All messages)</option>
                  </select>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ConfigurationPanel;
