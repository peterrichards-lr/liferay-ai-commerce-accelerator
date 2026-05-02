import React, { useMemo } from 'react';
import CheckboxField from '../ui/CheckboxField';
import FieldError from '../ui/FieldError';
import ClayIcon from '@clayui/icon';

export default function CategoriesSelector({
  availableCategories,
  selectedCategories,
  onToggleCategory,
  disabled,
  invalid,
  connected,
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

  if (!connected) {
    return (
      <div
        className="text-muted font-italic mb-2"
        style={{ fontSize: '0.875rem' }}
      >
        <ClayIcon symbol="info-circle" className="mr-1" />
        Connect to Liferay to load available categories.
      </div>
    );
  }

  if (availableCategories.length === 0) {
    return (
      <div
        className="text-muted font-italic mb-2"
        style={{ fontSize: '0.875rem' }}
      >
        <ClayIcon symbol="exclamation-circle" className="mr-1" />
        No categories found in Liferay.
      </div>
    );
  }

  return (
    <div className="categories-section">
      <div className="categories-grid">
        {availableCategories.map((category, index) => {
          const key = getCategoryKey(category);
          const label = getCategoryLabel(category);

          return (
            <div key={key} className="category-item mb-2">
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
