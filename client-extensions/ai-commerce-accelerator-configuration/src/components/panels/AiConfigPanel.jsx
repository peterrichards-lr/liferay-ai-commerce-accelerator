import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import ClayTable from '@clayui/table';
import { getKeyValue, persistConfigKey } from '../../utils/api';
import MillisecondsInput from '../common/MillisecondsInput';
import OpenAISettingsPanel from './OpenAISettingsPanel';
import PromptEditor from './PromptEditor';

const OPEN_AI_KEY_KEY = 'open-ai-key';
const AI_CONFIG_KEY = 'ai-config';
const AI_PROMPTS_KEY = 'ai-prompts-config';

const PROMPT_CONFIGS = [
  { id: 'product', title: 'Product Prompt' },
  { id: 'account', title: 'Account Prompt' },
  { id: 'order', title: 'Order Prompt' },
  { id: 'pricing', title: 'Pricing Prompt' },
  { id: 'pdf', title: 'PDF Content Prompt' },
];

const DEFAULT_AI = {
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
};

const DEFAULT_PROMPTS = {
  promptsDir: './prompts',
  promptCacheTTL: 600000,
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function AiConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState([]);

  const [aiConfig, setAiConfig] = useState(DEFAULT_AI);
  const [openAiKeyValue, setOpenAiKeyValue] = useState('');
  const [promptConfig, setPromptConfig] = useState(DEFAULT_PROMPTS);
  const [lastSaved, setLastSaved] = useState({
    openAiKeyValue: '',
    ai: DEFAULT_AI,
    prompts: DEFAULT_PROMPTS,
  });

  const dirty = useMemo(
    () =>
      openAiKeyValue !== lastSaved.openAiKeyValue ||
      JSON.stringify(aiConfig) !== JSON.stringify(lastSaved.ai) ||
      JSON.stringify(promptConfig) !== JSON.stringify(lastSaved.prompts),
    [openAiKeyValue, aiConfig, promptConfig, lastSaved]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [rawOpenAIKey, rawAI, rawPrompts] = await Promise.all([
          getKeyValue(OPEN_AI_KEY_KEY),
          getKeyValue(AI_CONFIG_KEY),
          getKeyValue(AI_PROMPTS_KEY),
        ]);

        const parsedAI = rawAI ? JSON.parse(rawAI) : {};
        const parsedPrompts = rawPrompts ? JSON.parse(rawPrompts) : {};

        const mergedAI = { ...DEFAULT_AI, ...parsedAI };
        const mergedPrompts = { ...DEFAULT_PROMPTS, ...parsedPrompts };

        if (!alive) return;
        setOpenAiKeyValue(rawOpenAIKey);
        setAiConfig(mergedAI);
        setPromptConfig(mergedPrompts);
        setLastSaved({
          openAiKeyValue: rawOpenAIKey,
          ai: mergedAI,
          prompts: mergedPrompts,
        });
      } catch (e) {
        console.error('Failed to load AI configuration.', e);
        Liferay?.Util?.openToast?.({
          message: 'Failed to load AI configuration.',
          type: 'danger',
        });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
    if (!promptConfig.promptsDir)
      found.push('Prompt directory must be specified.');
    if (
      !Number.isFinite(promptConfig.promptCacheTTL) ||
      promptConfig.promptCacheTTL < 1000
    )
      found.push('Prompt cache TTL must be at least 1000 ms.');
    setIssues(found);
  }, [aiConfig, promptConfig]);

      const onSave = useCallback(async () => {
      if (saving) return;
      setSaving(true);
      try {
        const results = await Promise.allSettled([
          persistConfigKey(OPEN_AI_KEY_KEY, openAiKeyValue.trim()),
          persistConfigKey(AI_CONFIG_KEY, JSON.stringify(aiConfig)),
          persistConfigKey(AI_PROMPTS_KEY, JSON.stringify(promptConfig)),
        ]);
  
        const failed = results.filter((r) => r.status === 'rejected');
  
        if (failed.length) {
          throw new Error(`${failed.length} save operations failed.`);
        }
  
        setLastSaved({
          openAiKeyValue: openAiKeyValue.trim(),
          ai: aiConfig,
          prompts: promptConfig,
        });
        Liferay?.Util?.openToast?.({
          message: 'AI configuration saved.',
          type: 'success',
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        Liferay?.Util?.openToast?.({
          message: 'Failed to save AI configuration.',
          type: 'danger',
        });
      } finally {
        setSaving(false);
      }
    }, [saving, openAiKeyValue, aiConfig, promptConfig]);
  const onCancel = useCallback(() => {
    setOpenAiKeyValue(lastSaved.openAiKeyValue);
    setAiConfig(lastSaved.ai);
    setPromptConfig(lastSaved.prompts);
  }, [lastSaved]);

  const updateAi = (key, value) => setAiConfig((v) => ({ ...v, [key]: value }));

  const updateSystemPrompt = (id, value) => {
    setAiConfig((current) => ({
      ...current,
      systemPrompts: {
        ...current.systemPrompts,
        [id]: value,
      },
    }));
  };

  const updateRetry = (k, val) =>
    setAiConfig((v) => ({ ...v, retry: { ...v.retry, [k]: val } }));
  const updatePromptConfig = (k, val) =>
    setPromptConfig((v) => ({ ...v, [k]: val }));

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">AI Configuration</h2>
        <div className="sheet-text">
          Manages <code>{OPEN_AI_KEY_KEY}</code>, <code>{AI_CONFIG_KEY}</code>{' '}
          and <code>{AI_PROMPTS_KEY}</code>.
        </div>
      </div>

      <OpenAISettingsPanel
        keyValue={openAiKeyValue || ''}
        setKeyValue={(value) => setOpenAiKeyValue(value)}
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
          <label htmlFor="prompts-dir">Prompts directory</label>
          <ClayInput
            id="prompts-dir"
            type="text"
            value={promptConfig.promptsDir}
            onChange={(e) => updatePromptConfig('promptsDir', e.target.value)}
          />
        </ClayForm.Group>

        <MillisecondsInput
          id="prompt-ttl"
          label="Prompt cache TTL (ms)"
          value={promptConfig.promptCacheTTL}
          min={1000}
          step={1000}
          onChange={(e) =>
            updatePromptConfig(
              'promptCacheTTL',
              toInt(e.target.value, promptConfig.promptCacheTTL)
            )
          }
          helper="Time-to-live for prompt template cache entries."
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
                        setAiConfig((v) => ({
                          ...v,
                          models: { ...v.models, [key]: e.target.value },
                        }))
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
                        setAiConfig((v) => ({
                          ...v,
                          maxTokens: {
                            ...v.maxTokens,
                            [key]: toInt(e.target.value, 4000),
                          },
                        }))
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
        <h3 className="sheet-subtitle">Inline System Prompts</h3>
        <p className="text-secondary">
          These are per-task “system” messages stored inside ai-config. They act
          as the primary source of truth for prompts, with files in the prompts
          directory serving as a fallback.
        </p>

        {PROMPT_CONFIGS.map(({ id, title }) => (
          <PromptEditor
            key={id}
            title={title}
            value={aiConfig.systemPrompts[id] || ''}
            onChange={(value) => updateSystemPrompt(id, value)}
          />
        ))}
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={
              !dirty || saving || issues.some((m) => !m.startsWith('Warning:'))
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
