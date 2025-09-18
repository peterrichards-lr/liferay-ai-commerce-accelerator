// OpenAISettingsPanel.jsx
import { useEffect, useState } from 'react';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayIcon from '@clayui/icon';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const OPEN_AI_KEY_KEY = 'open-ai-key';

export default function OpenAISettingsPanel() {
  const [currentKey, setCurrentKey] = useState('');
  const [lastSavedKey, setLastSavedKey] = useState('');
  const [issues, setIssues] = useState([]);
  const disabled = issues.length > 0;
  const dirty = currentKey !== lastSavedKey;

  useEffect(() => {
    const run = async () => {
      const found = [];
      setIssues(found);
      if (found.length === 0) {
        const key = await getKeyValue(OPEN_AI_KEY_KEY);
        setCurrentKey(key || '');
        setLastSavedKey(key || '');
      }
    };
    run();
  }, []);

  const onSave = async () => {
    try {
      await persistConfigKey(OPEN_AI_KEY_KEY, currentKey);
      setLastSavedKey(currentKey);
      Liferay.Util.openToast({
        message: 'Open AI key saved successfully.',
        type: 'success',
      });
    } catch (error) {
      if (error.hasOwnProperty('status')) {
        if (String(error.status) === '400') {
          let response = error.message.replace('HTTP 400 : ', '');
          try {
            response = JSON.parse(response);
          } catch {}
          Liferay.Util.openToast({
            message: response?.title || 'Failed to save Open AI key.',
            type: 'danger',
          });
          return;
        }
      }
      console.error(error);
      Liferay.Util.openToast({
        message: 'Failed to save Open AI key.',
        type: 'danger',
      });
    }
  };

  const onCancel = () => setCurrentKey(lastSavedKey);

  return (
    <div className="sheet sheet-lg">
      <div className="sheet-header">
        <h2 className="sheet-title">Open AI</h2>
        <div className="sheet-text">
          Configure the OpenAI API key used by the generator in live.
        </div>
      </div>

      {disabled && (
        <ClayAlert displayType="warning" title="Warning">
          {issues.length === 1 ? (
            issues[0]
          ) : (
            <ul className="mb-0">
              {issues.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </ClayAlert>
      )}

      <div className="sheet-section">
        <h3
          className="sheet-subtitle"
          style={{
            marginBottom: 0,
            padding: '0.75rem 1.25rem',
            paddingLeft: 0,
          }}
        >
          Open AI Key
        </h3>
        <div className="text-secondary small mb-3">
          Stored under <code>{OPEN_AI_KEY_KEY}</code> as plain text string.
        </div>
        <ClayForm.Group>
          <label htmlFor="openAiKey">Key</label>
          <br />
          <textarea
            id="openAiKey"
            type="text"
            value={currentKey}
            onChange={(e) => setCurrentKey(e.target.value)}
            disabled={disabled}
            style={{
              minHeight: 80,
              width: '100%',
              resize: 'vertical',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          />
        </ClayForm.Group>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={disabled || !dirty}
          >
            <ClayIcon symbol="disk" />
            <span className="ml-2">Save</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={disabled || !dirty}
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </div>
  );
}
