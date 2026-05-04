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
    <label
      className={`aica-checkbox-container ${muted ? 'muted' : ''} ${disabled ? 'disabled' : ''}`}
      htmlFor={id}
    >
      <input
        className="aica-checkbox-input"
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className={`aica-checkmark ${invalid ? 'invalid' : ''}`}></span>
      <span className="aica-label-text">{label}</span>
    </label>
  );
}
