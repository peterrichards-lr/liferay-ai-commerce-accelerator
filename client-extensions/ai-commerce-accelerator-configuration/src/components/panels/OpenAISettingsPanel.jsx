import { useCallback, useMemo, useState } from 'react';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';

export default function OpenAISettingsPanel({
  keyValue,
  setKeyValue,
  title = 'OpenAI Settings',
  helpText = 'The Open AI key os stored as plain text. In production, prefer using environment variables or a secrets vault rather than storing keys in the database.',
}) {
  const [show, setShow] = useState(false);
  const issues = [];

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
        <ClayForm.Group>
          <label htmlFor="openai-key" className="font-weight-semi-bold">
            OpenAI API Key
          </label>
          <div className="d-flex align-items-start">
            {show ? (
              <ClayInput
                id="openai-key"
                component="textarea"
                rows={6}
                placeholder="Paste your key…"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                aria-invalid={!!issues.length}
                autoComplete="off"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
            ) : (
              <ClayInput
                id="openai-key-masked"
                component="textarea"
                rows={6}
                value={maskedMultiline}
                readOnly
                aria-label="Hidden OpenAI key (masked)"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
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
            The value is used by backend services to make requests to the OpenAI
            API.
          </small>
          {keyValue && !show && (
            <div className="text-secondary small mt-1" aria-hidden="true">
              Preview: <code>{masked}</code>
            </div>
          )}
        </ClayForm.Group>
      </div>
    </ClayLayout.SheetSection>
  );
}
