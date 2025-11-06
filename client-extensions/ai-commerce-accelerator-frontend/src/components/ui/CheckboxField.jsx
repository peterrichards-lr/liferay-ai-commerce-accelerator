import React from 'react';

export default function CheckboxField({
  id,
  checked,
  onChange,
  disabled,
  invalid,
  label,
  muted,
}) {
  return (
    <div className="checkbox-wrapper">
      <input
        className={`checkbox-input ${invalid ? 'invalid' : ''}`}
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <label
        className={`checkbox-label ${muted ? 'muted' : ''} ${invalid ? 'error' : ''}`}
        htmlFor={id}
      >
        {label}
      </label>
    </div>
  );
}