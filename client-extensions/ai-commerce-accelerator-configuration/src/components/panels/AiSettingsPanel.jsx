import { useCallback, useMemo, useState } from 'react';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';

export default function AiSettingsPanel({
  keyValue,
  setKeyValue,
  providerValue,
  setProviderValue,
  type = 'text',
  title = 'AI Provider Settings',
  helpText = 'AI credentials are used by the microservice to generate mock data. In production, prefer environment variables over database storage.',
}) {
  const [show, setShow] = useState(false);
  const issues = [];

  const textProviders = [
    { label: 'OpenAI (GPT)', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'Anthropic Claude', value: 'anthropic' },
  ];

  const mediaProviders = [
    { label: 'Same as Core AI', value: 'inherit' },
    { label: 'OpenAI (DALL·E)', value: 'openai' },
    { label: 'Nano Banana', value: 'nanobanana' },
  ];

  const providers = type === 'media' ? mediaProviders : textProviders;

  const maskedMultiline = useMemo(
    () => (keyValue ? keyValue.replace(/[^\n]/g, '•') : ''),
    [keyValue]
  );

  const copySecret = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(keyValue);
      Liferay?.Util?.openToast?.({
        message: 'Key copied to clipboard.',
        type: 'success',
      });
    } catch {
      Liferay?.Util?.openToast?.({
        message: 'Could not copy key.',
        type: 'danger',
      });
    }
  }, [keyValue]);

  const masked = useMemo(
    () => (keyValue ? keyValue.replace(/.(?=.{4})/g, '•') : ''),
    [keyValue]
  );

  const onClear = useCallback(() => setKeyValue(''), [setKeyValue]);

  const isInherited = type === 'media' && providerValue === 'inherit';

  return (
    <ClayLayout.SheetSection className="mt-4">
      <div className="d-flex align-items-center mb-2">
        <h3 className="sheet-subtitle m-0">{title}</h3>
      </div>
      {helpText && <p className="text-secondary">{helpText}</p>}

      {!!issues.length && (
        <ClayAlert
          displayType="warning"
          title="Please review"
          role="alert"
          aria-live="assertive"
          className="mb-3"
        >
          <ul className="my-2">
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <ClayForm.Group className="mb-4">
          <label
            htmlFor={`ai-provider-${type}`}
            className="font-weight-semi-bold"
          >
            {type === 'media' ? 'Media Provider' : 'Core AI Provider'}
          </label>
          <ClaySelect
            id={`ai-provider-${type}`}
            value={providerValue || (type === 'media' ? 'inherit' : 'openai')}
            onChange={(e) => setProviderValue(e.target.value)}
          >
            {providers.map((p) => (
              <ClaySelect.Option
                key={p.value}
                label={p.label}
                value={p.value}
              />
            ))}
          </ClaySelect>
        </ClayForm.Group>

        {!isInherited && (
          <ClayForm.Group>
            <label htmlFor={`ai-key-${type}`} className="font-weight-semi-bold">
              API Key / Credentials
            </label>
            <div className="d-flex align-items-start">
              {show ? (
                <ClayInput
                  id={`ai-key-${type}`}
                  component="textarea"
                  rows={6}
                  placeholder="Paste your key here…"
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  aria-invalid={!!issues.length}
                  autoComplete="off"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                />
              ) : (
                <ClayInput
                  id={`ai-key-masked-${type}`}
                  component="textarea"
                  rows={6}
                  value={maskedMultiline}
                  readOnly
                  aria-label="Hidden API key (masked)"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                />
              )}

              <div className="ml-2 d-flex flex-column">
                <ClayButton
                  type="button"
                  displayType="secondary"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide key' : 'Show key'}
                  title={show ? 'Hide key' : 'Show key'}
                  className="mb-2"
                >
                  <ClayIcon symbol={show ? 'view' : 'hidden'} />
                </ClayButton>

                <ClayButton
                  type="button"
                  displayType="secondary"
                  onClick={copySecret}
                  disabled={!keyValue}
                  aria-label="Copy key"
                  title="Copy key"
                  className="mb-2"
                >
                  <ClayIcon symbol="copy" />
                </ClayButton>

                <ClayButton
                  type="button"
                  displayType="secondary"
                  onClick={onClear}
                  aria-label="Clear key"
                  title="Clear key"
                >
                  <ClayIcon symbol="times" />
                </ClayButton>
              </div>
            </div>
            <small className="form-text text-secondary">
              The key is stored in Liferay as plain text. Ensure the correct key
              format for the selected provider.
            </small>
            {keyValue && !show && (
              <div className="text-secondary small mt-1" aria-hidden="true">
                Preview: <code>{masked}</code>
              </div>
            )}
          </ClayForm.Group>
        )}
      </div>
    </ClayLayout.SheetSection>
  );
}
