import ClayForm from '@clayui/form';
import ClayLayout from '@clayui/layout';
import React from 'react';

export default function PromptEditor({
  title,
  configKey,
  value,
  onChange,
  placeholder,
}) {
  return (
    <ClayLayout.Sheet>
      <div className="sheet-header">
        <h2 className="sheet-title">{title}</h2>
        <div className="sheet-text">
          Configuration Key: <code>{configKey}</code>
        </div>
      </div>
      <ClayForm.Group className="mb-4">
        <label
          htmlFor={`prompt-text-${title}`}
          className="font-weight-semi-bold"
        >
          {title}
        </label>
        <textarea
          id={`prompt-text-${title}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || `Enter the system prompt for ${title}.`}
          rows={8}
          className="form-control"
          aria-label={`${title} prompt text`}
        />
      </ClayForm.Group>
    </ClayLayout.Sheet>
  );
}
