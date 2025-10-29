import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import ClayTable from '@clayui/table';
import { getKeyValue, persistConfigKey } from '../../utils/api';
import PromptManager from './PromptManager';
import SystemPromptsEditor from './SystemPromptsEditor';

const AI_CONFIG_KEY = 'ai-config';
const AI_PROMPTS_KEY = 'ai-prompts-config';

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
  const [promptConfig, setPromptConfig] = useState(DEFAULT_PROMPTS);
  const [lastSaved, setLastSaved] = useState({
    ai: DEFAULT_AI,
    prompts: DEFAULT_PROMPTS,
  });

  const dirty = useMemo(
    () =>
      JSON.stringify(aiConfig) !== JSON.stringify(lastSaved.ai) ||
      JSON.stringify(promptConfig) !== JSON.stringify(lastSaved.prompts),
    [aiConfig, promptConfig, lastSaved]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [rawAI, rawPrompts] = await Promise.all([
          getKeyValue(AI_CONFIG_KEY),
          getKeyValue(AI_PROMPTS_KEY),
        ]);

        const parsedAI = rawAI ? JSON.parse(rawAI) : {};
        const parsedPrompts = rawPrompts ? JSON.parse(rawPrompts) : {};

        const mergedAI = { ...DEFAULT_AI, ...parsedAI };
        const mergedPrompts = { ...DEFAULT_PROMPTS, ...parsedPrompts };

        if (!alive) return;
        setAiConfig(mergedAI);
        setPromptConfig(mergedPrompts);
        setLastSaved({ ai: mergedAI, prompts: mergedPrompts });
      } catch (e) {
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
      await Promise.all([
        persistConfigKey(AI_CONFIG_KEY, JSON.stringify(aiConfig)),
        persistConfigKey(AI_PROMPTS_KEY, JSON.stringify(promptConfig)),
      ]);
      setLastSaved({ ai: aiConfig, prompts: promptConfig });
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
  }, [saving, aiConfig, promptConfig]);

  const onCancel = useCallback(() => {
    setAiConfig(lastSaved.ai);
    setPromptConfig(lastSaved.prompts);
  }, [lastSaved]);

  const updateAi = (key, value) => setAiConfig((v) => ({ ...v, [key]: value }));
  const updateRetry = (k, val) =>
    setAiConfig((v) => ({ ...v, retry: { ...v.retry, [k]: val } }));
  const updatePromptConfig = (k, val) =>
    setPromptConfig((v) => ({ ...v, [k]: val }));

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">AI Configuration</h2>
        <div className="sheet-text">
          Manages <code>ai-config</code> and <code>ai-prompts-config</code>.
        </div>
      </div>

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

        <ClayForm.Group>
          <label htmlFor="request-timeout">Request timeout (ms)</label>
          <ClayInput
            id="request-timeout"
            type="number"
            min={1000}
            step={500}
            value={aiConfig.requestTimeoutMs}
            onChange={(e) =>
              updateAi('requestTimeoutMs', toInt(e.target.value, 60000))
            }
          />
        </ClayForm.Group>

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
            <ClayInput
              placeholder="baseDelayMs"
              type="number"
              min={100}
              value={aiConfig.retry.baseDelayMs}
              onChange={(e) =>
                updateRetry('baseDelayMs', toInt(e.target.value, 1000))
              }
              className="mr-2"
            />
            <ClayInput
              placeholder="maxDelayMs"
              type="number"
              min={500}
              value={aiConfig.retry.maxDelayMs}
              onChange={(e) =>
                updateRetry('maxDelayMs', toInt(e.target.value, 8000))
              }
            />
          </div>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="prompts-dir">Prompts directory</label>
          <ClayInput
            id="prompts-dir"
            type="text"
            value={promptConfig.promptsDir}
            onChange={(e) => updatePromptConfig('promptsDir', e.target.value)}
          />
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="prompt-ttl">Prompt cache TTL (ms)</label>
          <ClayInput
            id="prompt-ttl"
            type="number"
            min={1000}
            step={1000}
            value={promptConfig.promptCacheTTL}
            onChange={(e) =>
              updatePromptConfig(
                'promptCacheTTL',
                toInt(e.target.value, promptConfig.promptCacheTTL)
              )
            }
          />
        </ClayForm.Group>

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

        {/* Inline, per-task "system" messages in ai-config */}
        <SystemPromptsEditor
          value={aiConfig.systemPrompts || {}}
          onChange={(next) =>
            setAiConfig((v) => ({ ...v, systemPrompts: next }))
          }
        />

        {/* File-based prompt templates from ai-prompts-config */}
        <PromptManager
          promptsDir={promptConfig.promptsDir}
          promptCacheTTL={promptConfig.promptCacheTTL}
          onPromptsDirChange={(dir) => updatePromptConfig('promptsDir', dir)}
          onPromptCacheTTLChange={(ttl) =>
            updatePromptConfig('promptCacheTTL', toInt(ttl, 600000))
          }
          inlineFallbackPrompts={aiConfig.systemPrompts || {}}
        />
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