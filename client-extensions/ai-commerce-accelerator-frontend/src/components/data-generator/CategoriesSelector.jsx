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
  const getCategoryKey = (c) => (typeof c === 'string' ? c : c.key);
  const getCategoryLabel = (c) =>
    typeof c === 'string' ? c : c.title || c.name || c.key;

  const ids = useMemo(
    () =>
      availableCategories.map(
        (c) => `dataGeneration_category-${getCategoryKey(c)}`
      ),
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
        {availableCategories.map((category, index) => {
          const key = getCategoryKey(category);
          const label = getCategoryLabel(category);

          return (
            <div key={key} className="category-item">
              <CheckboxField
                id={ids[index]}
                checked={selectedCategories.includes(key)}
                onChange={(checked) => onToggleCategory(key, checked)}
                disabled={disabled}
                invalid={invalid}
                label={label}
                muted={disabled}
              />
            </div>
          );
        })}
        {invalid && <FieldError errors={invalid} />}
      </div>
    </div>
  );
}
