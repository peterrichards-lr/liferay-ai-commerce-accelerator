import React from 'react';

export default function FieldError({ errors }) {
  if (!errors || errors.length === 0) return null;
  return <div className="error-message">{errors[0]}</div>;
}
