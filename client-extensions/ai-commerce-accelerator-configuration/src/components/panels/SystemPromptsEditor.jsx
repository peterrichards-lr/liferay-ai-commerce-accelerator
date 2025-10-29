import { useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayAlert from '@clayui/alert';
import ClayLayout from '@clayui/layout';

const DEFAULT_KEYS = ['pdf', 'product', 'account', 'order', 'pricing'];

function normalizeMap(v) {
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(
    Object.entries(v).filter(([k]) => k && typeof k === 'string')
  );
}

export default function SystemPromptsEditor({
  value,
  onChange,
  title = 'Inline System Prompts',
  helpText = 'These are per-task “system” messages stored inside ai-config. They act as defaults even if file-based prompts are missing.',
}) {
  const initial = useMemo(() => normalizeMap(value), [value]);

  const [map, setMap] = useState(initial);
  const [selectedKey, setSelectedKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [renameKey, setRenameKey] = useState('');
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    if (Object.keys(initial).length === 0) {
      const seeded = Object.fromEntries(DEFAULT_KEYS.map((k) => [k, '']));
      setMap(seeded);
      setSelectedKey(DEFAULT_KEYS[0]);
      onChange?.(seeded);
    } else {
      setMap(initial);
      const first = Object.keys(initial)[0];
      setSelectedKey(first || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    const found = [];
    const keys = Object.keys(map);
    if (newKey && (keys.includes(newKey) || !newKey.trim())) {
      found.push('New key must be unique and non-empty.');
    }
    if (
      renameKey &&
      (!renameKey.trim() ||
        (keys.includes(renameKey) && renameKey !== selectedKey))
    ) {
      found.push('Rename must be a non-empty key not already in use.');
    }
    setIssues(found);
  }, [map, newKey, renameKey, selectedKey]);

  const keys = Object.keys(map);
  const currentText = selectedKey ? map[selectedKey] ?? '' : '';

  const setAndPropagate = (next) => {
    setMap(next);
    onChange?.(next);
  };

  const handleSelect = (e) => setSelectedKey(e.target.value);

  const handleTextChange = (e) => {
    const next = { ...map, [selectedKey]: e.target.value };
    setAndPropagate(next);
  };

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k || keys.includes(k)) return;
    const next = { ...map, [k]: '' };
    setNewKey('');
    setSelectedKey(k);
    setAndPropagate(next);
  };

  const handleDelete = () => {
    if (!selectedKey) return;
    const next = { ...map };
    delete next[selectedKey];
    const nxtKeys = Object.keys(next);
    setSelectedKey(nxtKeys[0] || '');
    setAndPropagate(next);
  };

  const handleRename = () => {
    const k = renameKey.trim();
    if (!selectedKey || !k || (k !== selectedKey && keys.includes(k))) return;
    if (k === selectedKey) return;
    const { [selectedKey]: text, ...rest } = map;
    const next = { ...rest, [k]: text };
    setSelectedKey(k);
    setRenameKey('');
    setAndPropagate(next);
  };

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
          className="mb-3"
        >
          <ul className="my-2">
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <ClayForm.Group className="mb-3">
        <label htmlFor="system-prompt-key" className="font-weight-semi-bold">
          Task
        </label>
        <ClaySelect
          id="system-prompt-key"
          value={selectedKey}
          onChange={handleSelect}
          aria-label="Select task to edit its system prompt"
        >
          {keys.length === 0 ? (
            <ClaySelect.Option label="(no prompts)" value="" />
          ) : (
            keys.map((k) => <ClaySelect.Option key={k} label={k} value={k} />)
          )}
        </ClaySelect>
        <small className="form-text text-secondary">
          Choose the task identifier (e.g., <code>product</code>,{' '}
          <code>pdf</code>) to edit its system message.
        </small>
      </ClayForm.Group>

      <ClayForm.Group className="mb-3">
        <label htmlFor="system-prompt-text" className="font-weight-semi-bold">
          System message for <code>{selectedKey || '(none)'}</code>
        </label>
        <textarea
          id="system-prompt-text"
          value={currentText}
          onChange={handleTextChange}
          placeholder="Write the system message that guides the model for this task."
          rows={8}
          disabled={!selectedKey}
          className="form-control"
          aria-label="System prompt text"
        />
      </ClayForm.Group>

      <div className="d-flex flex-wrap align-items-end mb-3">
        <ClayForm.Group className="mr-2 mb-2">
          <label htmlFor="new-key" className="font-weight-semi-bold">
            Add new key
          </label>
          <ClayInput
            id="new-key"
            type="text"
            placeholder="e.g., translation"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
        </ClayForm.Group>
        <ClayButton
          className="mb-2 mr-3"
          onClick={handleAdd}
          disabled={!newKey.trim() || keys.includes(newKey.trim())}
          aria-label="Add new system prompt key"
        >
          <ClayIcon symbol="plus" />
          <span className="ml-2">Add</span>
        </ClayButton>

        <ClayForm.Group className="mr-2 mb-2">
          <label htmlFor="rename-key" className="font-weight-semi-bold">
            Rename selected
          </label>
          <ClayInput
            id="rename-key"
            type="text"
            placeholder={
              selectedKey ? `Rename "${selectedKey}" to…` : 'Select a key first'
            }
            value={renameKey}
            onChange={(e) => setRenameKey(e.target.value)}
            disabled={!selectedKey}
          />
        </ClayForm.Group>
        <ClayButton
          className="mb-2 mr-3"
          displayType="secondary"
          onClick={handleRename}
          disabled={
            !selectedKey ||
            !renameKey.trim() ||
            (renameKey.trim() !== selectedKey &&
              keys.includes(renameKey.trim()))
          }
          aria-label="Rename current system prompt key"
        >
          <ClayIcon symbol="change" />
          <span className="ml-2">Rename</span>
        </ClayButton>

        <ClayButton
          className="mb-2"
          displayType="danger"
          onClick={handleDelete}
          disabled={!selectedKey}
          aria-label="Delete current system prompt key"
        >
          <ClayIcon symbol="trash" />
          <span className="ml-2">Delete</span>
        </ClayButton>
      </div>
    </ClayLayout.SheetSection>
  );
}