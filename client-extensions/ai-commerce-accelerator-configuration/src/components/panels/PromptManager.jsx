import { useState } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayModal, { useModal } from '@clayui/modal';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';

export default function PromptManager({ prompts = {}, onChange }) {
  const [localPrompts, setLocalPrompts] = useState(prompts);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState(null);
  const { observer, onClose } = useModal({ onClose: () => setEditingKey(null) });

  const addPrompt = () => {
    const key = prompt('Enter a new prompt key (e.g. "new-task")');
    if (!key || localPrompts[key]) return;
    const updated = { ...localPrompts, [key]: '' };
    setLocalPrompts(updated);
    onChange(updated);
  };

  const deletePrompt = (key) => {
    if (!confirm(`Delete prompt "${key}"?`)) return;
    const updated = { ...localPrompts };
    delete updated[key];
    setLocalPrompts(updated);
    onChange(updated);
  };

  const saveEdit = () => {
    if (!editingKey) return;
    if (!editValue.trim()) {
      setError('Prompt cannot be empty.');
      return;
    }
    const updated = { ...localPrompts, [editingKey]: editValue };
    setLocalPrompts(updated);
    onChange(updated);
    setEditingKey(null);
    setEditValue('');
    setError(null);
  };

  const openEdit = (key) => {
    setEditingKey(key);
    setEditValue(localPrompts[key]);
  };

  const keys = Object.keys(localPrompts);

  return (
    <div className="mt-4">
      <h4>Prompt Templates</h4>
      {keys.length === 0 && <p>No prompts defined.</p>}
      {keys.map((key) => (
        <div
          key={key}
          className="d-flex justify-content-between align-items-center mb-2 border-bottom pb-1"
        >
          <div className="flex-grow-1">
            <strong>{key}</strong>
            <div className="text-secondary text-truncate">
              {localPrompts[key].split('\n')[0] || 'Empty'}
            </div>
          </div>
          <div className="ml-2">
            <ClayButton
              displayType="secondary"
              size="sm"
              onClick={() => openEdit(key)}
              aria-label={`Edit prompt ${key}`}
            >
              <ClayIcon symbol="pencil" />
            </ClayButton>
            <ClayButton
              displayType="unstyled"
              className="ml-1 text-danger"
              size="sm"
              onClick={() => deletePrompt(key)}
              aria-label={`Delete prompt ${key}`}
            >
              <ClayIcon symbol="trash" />
            </ClayButton>
          </div>
        </div>
      ))}
      <ClayButton
        displayType="secondary"
        size="sm"
        onClick={addPrompt}
        aria-label="Add new prompt"
      >
        <ClayIcon symbol="plus" />
        <span className="ml-2">Add Prompt</span>
      </ClayButton>

      {editingKey && (
        <ClayModal observer={observer} size="lg" status="info">
          <ClayModal.Header>Edit Prompt: {editingKey}</ClayModal.Header>
          <ClayModal.Body>
            {error && <ClayAlert displayType="danger">{error}</ClayAlert>}
            <ClayForm.Group>
              <label htmlFor="prompt-text">Prompt Text</label>
              <ClayInput
                component="textarea"
                id="prompt-text"
                rows={12}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
              />
            </ClayForm.Group>
          </ClayModal.Body>
          <ClayModal.Footer
            last={
              <>
                <ClayButton onClick={saveEdit}>Save</ClayButton>
                <ClayButton displayType="secondary" onClick={onClose}>
                  Cancel
                </ClayButton>
              </>
            }
          />
        </ClayModal>
      )}
    </div>
  );
}