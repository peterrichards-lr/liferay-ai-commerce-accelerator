import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import ClayTable from '@clayui/table';
import SchemaEditor from './SchemaEditor';
import { useForm, useObjectStorage } from '../../hooks';
import MillisecondsInput from '../common/MillisecondsInput';
import AiSettingsPanel from './AiSettingsPanel';

const AI_CREDENTIALS_KEY = 'ai-credentials';
const AI_MEDIA_CREDENTIALS_KEY = 'ai-media-credentials';
const AI_CONFIG_KEY = 'ai-config';

const DEFAULTS = {
  [AI_CONFIG_KEY]: {
    provider: 'openai',
    mediaProvider: 'inherit',
    defaultModel: 'gpt-4o',
    temperature: 0.7,
    responseFormat: 'json_object',
    requestTimeoutMs: 60000,
    retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 8000 },
    parallelLimit: 4,
    models: {
      pdf: 'gpt-4o',
      product: 'gpt-4o',
      account: 'gpt-4o',
      order: 'gpt-4o',
      pricing: 'gpt-4o-mini',
    },
    maxTokens: {
      default: 4000,
      pdf: 4000,
      product: 4000,
      account: 4000,
      order: 4000,
      pricing: 2000,
    },
    systemPrompts: {},
    strictJson: true,
  },
  [AI_CREDENTIALS_KEY]: '',
  [AI_MEDIA_CREDENTIALS_KEY]: '',
};

const AI_MODEL_OPTIONS_CONFIG_KEY = 'ai-model-options';
const AI_MODEL_OPTIONS_DEFAULTS = [
  { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
  { label: 'GPT-4o', value: 'gpt-4o' },
  { label: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash' },
  { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' },
  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20240620' },
];

const ENTITY_CONFIGS = [
  {
    id: 'ai-model-options',
    title: 'AI Model Options',
    configKey: AI_MODEL_OPTIONS_CONFIG_KEY,
  },
];

const EMPTY_ERRORS = ENTITY_CONFIGS.reduce((acc, { id }) => {
  acc[id] = [];
  return acc;
}, {});

const CODEMIRROR_LIFERAY_CSS_ID = 'liferay-codemirror-vendors-css';

function ensureLiferayCodeMirrorCss() {
  if (document.getElementById(CODEMIRROR_LIFERAY_CSS_ID)) {
    return;
  }

  const link = document.createElement('link');

  link.id = CODEMIRROR_LIFERAY_CSS_ID;
  link.rel = 'stylesheet';
  link.type = 'text/css';

  const contextPath = window.Liferay?.ThemeDisplay?.getPathContext
    ? window.Liferay.ThemeDisplay.getPathContext()
    : '';

  link.href = `${contextPath}/o/frontend-editor-ckeditor-web/ckeditor/plugins/codemirror/vendors/vendors.css`;

  document.head.appendChild(link);
}

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function AiConfigPanel() {
  const [issues, setIssues] = useState([]);
  const [errors, setErrors] = useState(EMPTY_ERRORS);

  const aiKeys = useMemo(() => [AI_CONFIG_KEY], []);
  const aiDefaults = useMemo(
    () => ({ [AI_CONFIG_KEY]: DEFAULTS[AI_CONFIG_KEY] }),
    []
  );

  const {
    loading: loadingAi,
    saving: savingAi,
    values: { [AI_CONFIG_KEY]: aiConfig },
    dirty: dirtyAi,
    onSave: onSaveAi,
    onCancel: onCancelAi,
    setValue: setAiValue,
  } = useObjectStorage({
    keys: aiKeys,
    defaults: aiDefaults,
  });

  const credentialKeys = useMemo(
    () => [AI_CREDENTIALS_KEY, AI_MEDIA_CREDENTIALS_KEY],
    []
  );
  const credentialDefaults = useMemo(
    () => ({
      [AI_CREDENTIALS_KEY]: DEFAULTS[AI_CREDENTIALS_KEY],
      [AI_MEDIA_CREDENTIALS_KEY]: DEFAULTS[AI_MEDIA_CREDENTIALS_KEY],
    }),
    []
  );

  const {
    loading: loadingKey,
    saving: savingKey,
    values: {
      [AI_CREDENTIALS_KEY]: aiCredentialsValue,
      [AI_MEDIA_CREDENTIALS_KEY]: aiMediaCredentialsValue,
    },
    dirty: dirtyKey,
    onSave: onSaveKey,
    onCancel: onCancelKey,
    setValue: setAiCredentialsValue,
  } = useObjectStorage({
    keys: credentialKeys,
    defaults: credentialDefaults,
    json: false,
  });

  const modelKeys = useMemo(() => ENTITY_CONFIGS.map((c) => c.configKey), []);
  const modelDefaults = useMemo(
    () =>
      ENTITY_CONFIGS.reduce(
        (acc, { configKey }) => ({
          ...acc,
          [configKey]: AI_MODEL_OPTIONS_DEFAULTS,
        }),
        {}
      ),
    []
  );

  const {
    loading: loadingAiModels,
    saving: savingAiModels,
    values: aiModelOptions,
    dirty: dirtyAiModels,
    onSave: onSaveAiModels,
    onCancel: onCancelAiModels,
    setValues: setAiModelOptionsValues,
  } = useObjectStorage({
    keys: modelKeys,
    defaults: modelDefaults,
  });

  const loading = loadingAi || loadingKey || loadingAiModels;
  const saving = savingAi || savingKey || savingAiModels;
  const dirty = dirtyAi || dirtyKey || dirtyAiModels;

  const onSave = useCallback(async () => {
    try {
      await Promise.all([
        onSaveAi({ silent: true }),
        onSaveKey({ silent: true }),
        onSaveAiModels({ silent: true }),
      ]);
      Liferay?.Util?.openToast?.({
        message: 'Configuration saved.',
        type: 'success',
      });
    } catch {
      Liferay?.Util?.openToast?.({
        message: 'Failed to save configuration.',
        type: 'danger',
      });
    }
  }, [onSaveAi, onSaveKey, onSaveAiModels]);

  const onCancel = useCallback(() => {
    onCancelAi();
    onCancelKey();
    onCancelAiModels();
    setErrors(EMPTY_ERRORS);
  }, [onCancelAi, onCancelKey, onCancelAiModels]);

  useForm({ dirty, onSave });

  useEffect(() => {
    ensureLiferayCodeMirrorCss();
  }, []);

  const onSchemaChange = (schemaId, configKey, value) => {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        throw new Error('Expected an array.');
      }
      parsed.forEach((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new Error(`Item ${index} is not an object.`);
        }
        if (typeof item.label !== 'string' || item.label.trim() === '') {
          throw new Error(`Item ${index} is missing a valid 'label' string.`);
        }
        if (typeof item.value !== 'string' || item.value.trim() === '') {
          throw new Error(`Item ${index} is missing a valid 'value' string.`);
        }
      });
      setErrors((prev) => ({ ...prev, [schemaId]: [] }));
      setAiModelOptionsValues((prev) => ({
        ...prev,
        [configKey]: parsed,
      }));
    } catch (error) {
      setErrors((prev) => ({ ...prev, [schemaId]: [error.message] }));
    }
  };

  const hasErrors = useMemo(
    () => Object.values(errors).some((e) => e.length > 0),
    [errors]
  );

  useEffect(() => {
    const found = [];
    if (!aiConfig.defaultModel) found.push('Default model cannot be empty.');
    if (aiConfig.temperature < 0 || aiConfig.temperature > 2)
      found.push('Temperature must be between 0 and 2.');
    if (
      !Number.isFinite(aiConfig.requestTimeoutMs) ||
      aiConfig.requestTimeoutMs < 1000
    )
      found.push('Request timeout must be at least 1000 ms.');
    setIssues(found);
  }, [aiConfig]);

  const updateAi = (key, value) =>
    setAiValue(AI_CONFIG_KEY, { ...aiConfig, [key]: value });

  const updateRetry = (k, val) =>
    setAiValue(AI_CONFIG_KEY, {
      ...aiConfig,
      retry: { ...aiConfig.retry, [k]: val },
    });

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">AI Configuration</h2>

        <div className="sheet-text">
          Manages <code>{AI_CREDENTIALS_KEY}</code> and{' '}
          <code>{AI_CONFIG_KEY}</code>.
        </div>
      </div>

      <AiSettingsPanel
        type="text"
        title="Core AI Generation (Text)"
        helpText="Used for Products, Accounts, and Order descriptions."
        keyValue={aiCredentialsValue || ''}
        setKeyValue={(value) =>
          setAiCredentialsValue(AI_CREDENTIALS_KEY, value)
        }
        providerValue={aiConfig.provider || 'openai'}
        setProviderValue={(value) => updateAi('provider', value)}
      />

      <AiSettingsPanel
        type="media"
        title="Media Generation (Images/PDFs)"
        helpText="Choose a specialized provider for product visuals, or inherit from Core AI."
        keyValue={aiMediaCredentialsValue || ''}
        setKeyValue={(value) =>
          setAiCredentialsValue(AI_MEDIA_CREDENTIALS_KEY, value)
        }
        providerValue={aiConfig.mediaProvider || 'inherit'}
        setProviderValue={(value) => updateAi('mediaProvider', value)}
      />

      {!!issues.length && (
        <ClayAlert displayType="warning" title="Please review" role="alert">
          <ul className="my-2">
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <ClayForm.Group>
          <label htmlFor="default-model">Default model</label>

          <ClayInput
            id="default-model"
            type="text"
            value={aiConfig.defaultModel}
            onChange={(e) => updateAi('defaultModel', e.target.value)}
          />
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="temperature">Temperature</label>

          <ClayInput
            id="temperature"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={aiConfig.temperature}
            onChange={(e) =>
              updateAi('temperature', parseFloat(e.target.value) || 0)
            }
          />

          <small className="form-text text-secondary">
            Controls randomness: 0 = deterministic, higher = more creative.
          </small>
        </ClayForm.Group>

        <MillisecondsInput
          id="request-timeout"
          label="Request timeout (ms)"
          value={aiConfig.requestTimeoutMs}
          min={1000}
          step={500}
          onChange={(e) =>
            updateAi('requestTimeoutMs', toInt(e.target.value, 60000))
          }
          helper="Maximum time to wait for an AI request before aborting."
        />

        <ClayForm.Group>
          <label>Retry settings</label>

          <div className="d-flex">
            <ClayInput
              placeholder="maxRetries"
              type="number"
              min={0}
              value={aiConfig.retry.maxRetries}
              onChange={(e) =>
                updateRetry('maxRetries', toInt(e.target.value, 2))
              }
              className="mr-2"
            />
          </div>

          <small className="form-text text-secondary">
            Number of retry attempts for transient failures.
          </small>
        </ClayForm.Group>

        <MillisecondsInput
          id="retry-base-delay"
          label="Retry base delay (ms)"
          value={aiConfig.retry.baseDelayMs}
          min={100}
          step={100}
          onChange={(e) =>
            updateRetry('baseDelayMs', toInt(e.target.value, 1000))
          }
          helper="Initial backoff delay before the first retry."
        />

        <MillisecondsInput
          id="retry-max-delay"
          label="Retry max delay (ms)"
          value={aiConfig.retry.maxDelayMs}
          min={500}
          step={100}
          onChange={(e) =>
            updateRetry('maxDelayMs', toInt(e.target.value, 8000))
          }
          helper="Maximum backoff delay between retries."
        />

        <ClayForm.Group>
          <label>Per-Model Configuration</label>

          <ClayTable>
            <ClayTable.Head>
              <ClayTable.Row>
                <ClayTable.Cell headingCell>Model</ClayTable.Cell>

                <ClayTable.Cell>Engine</ClayTable.Cell>

                <ClayTable.Cell>Max Tokens</ClayTable.Cell>
              </ClayTable.Row>
            </ClayTable.Head>

            <ClayTable.Body>
              {Object.keys(aiConfig.models).map((key) => (
                <ClayTable.Row key={key}>
                  <ClayTable.Cell>{key}</ClayTable.Cell>

                  <ClayTable.Cell>
                    <ClayInput
                      type="text"
                      value={aiConfig.models[key]}
                      onChange={(e) =>
                        setAiValue(AI_CONFIG_KEY, {
                          ...aiConfig,

                          models: { ...aiConfig.models, [key]: e.target.value },
                        })
                      }
                    />
                  </ClayTable.Cell>

                  <ClayTable.Cell>
                    <ClayInput
                      type="number"
                      min={500}
                      step={100}
                      value={aiConfig.maxTokens[key] ?? 4000}
                      onChange={(e) =>
                        setAiValue(AI_CONFIG_KEY, {
                          ...aiConfig,

                          maxTokens: {
                            ...aiConfig.maxTokens,

                            [key]: toInt(e.target.value, 4000),
                          },
                        })
                      }
                    />
                  </ClayTable.Cell>
                </ClayTable.Row>
              ))}
            </ClayTable.Body>
          </ClayTable>
        </ClayForm.Group>
      </div>

      <div className="sheet-section">
        <h3 className="sheet-subtitle">AI Model Options</h3>

        <div className="sheet-text">
          Define the available AI models for generation. Each model should have
          a &apos;label&apos; and &apos;value&apos;.
        </div>

        {ENTITY_CONFIGS.map(({ id, title, configKey }) => (
          <SchemaEditor
            key={id}
            title={title}
            configKey={configKey}
            value={JSON.stringify(aiModelOptions[configKey], null, 2)}
            onChange={(value) => onSchemaChange(id, configKey, value)}
            errors={errors[id]}
          />
        ))}
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={
              !dirty ||
              saving ||
              issues.some((m) => !m.startsWith('Warning:')) ||
              hasErrors
            }
            aria-label="Save AI configuration"
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />

            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-label="Cancel changes"
          >
            <ClayIcon symbol="restore" />

            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}
