import ClayForm from '@clayui/form';
import React from 'react';

export default function PromptEditor({ title, value, onChange, placeholder }) {
  return (
    <ClayForm.Group className="mb-4">
      <label htmlFor={`prompt-text-${title}`} className="font-weight-semi-bold">
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
  );
}
