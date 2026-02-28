import React, { useMemo } from 'react';
import CheckboxField from '../ui/CheckboxField';
import FieldError from '../ui/FieldError';

export default function CategoriesSelector({
  availableCategories,
  selectedCategories,
  onToggleCategory,
  disabled,
  invalid,
  showNote,
}) {
  const ids = useMemo(
    () => availableCategories.map((c) => `dataGeneration_category-${c}`),
    [availableCategories]
  );

  return (
    <div className="categories-section">
      <span className="categories-title">Categories</span>
      {showNote && (
        <small className="categories-note">
          (Categories are used for both product and account generation)
        </small>
      )}
      <div className="categories-grid">
        {availableCategories.map((category, index) => (
          <div key={category} className="category-item">
            <CheckboxField
              id={ids[index]}
              checked={selectedCategories.includes(category)}
              onChange={(checked) => onToggleCategory(category, checked)}
              disabled={disabled}
              invalid={invalid}
              label={category}
              muted={disabled}
            />
          </div>
        ))}
        {invalid && <FieldError errors={invalid} />}
      </div>
    </div>
  );
}
