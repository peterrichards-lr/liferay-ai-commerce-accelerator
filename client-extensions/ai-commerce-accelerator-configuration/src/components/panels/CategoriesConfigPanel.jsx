import React, { useCallback, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import Ajv from 'ajv';

const CATEGORIES_CONFIG_KEY = 'ai-categories';
const DEFAULTS = {
  [CATEGORIES_CONFIG_KEY]: [
    "Electronics",
    "Clothing",
    "Home & Garden",
    "Sports",
    "Books",
    "Automotive",
    "Health & Beauty",
    "Toys & Games",
    "Food & Beverage",
    "Office Supplies"
  ],
};

const ajv = new Ajv();
const schema = {
  type: "array",
  items: {
    type: "string",
    minLength: 1
  },
  minItems: 1,
  uniqueItems: true
};
const validate = ajv.compile(schema);

export default function CategoriesConfigPanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [CATEGORIES_CONFIG_KEY]: categories },
    dirty,
    onSave,
    onCancel: onCancelHook,
    setValue,
  } = useObjectStorage({
    keys: [CATEGORIES_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  const onCancel = useCallback(() => {
    onCancelHook();
    setIssues([]);
  }, [onCancelHook]);

  useForm({ dirty, onSave });

  const onCategoriesChange = useCallback((e) => {
    const rawValue = e.target.value;
    try {
      const parsed = JSON.parse(rawValue);
      if (!validate(parsed)) {
        setIssues(validate.errors.map(err => `Validation Error: ${err.message} at ${err.instancePath}`));
      } else {
        setIssues([]);
      }
      setValue(CATEGORIES_CONFIG_KEY, parsed);
    } catch (error) {
      setIssues([`JSON Parse Error: ${error.message}`]);
      setValue(CATEGORIES_CONFIG_KEY, rawValue); // Store raw value to preserve user input
    }
  }, [setValue]);

  const hasErrors = useMemo(
    () => issues.length > 0 || (typeof categories === 'string' && categories.length > 0) || (Array.isArray(categories) && !validate(categories)),
    [issues, categories]
  );

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Categories Configuration</h2>
        <div className="sheet-text">
          Manages <code>{CATEGORIES_CONFIG_KEY}</code>.
        </div>
      </div>

      {!!issues.length && (
        <ClayAlert displayType="warning" title="Please review" role="alert">
          <ul className="my-2">
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <ClayForm.Group>
          <label htmlFor="categories-list" className="font-weight-semi-bold">
            Product Categories (JSON Array of Strings)
          </label>
          <ClayInput
            id="categories-list"
            component="textarea"
            rows={10}
            value={typeof categories === 'string' ? categories : JSON.stringify(categories, null, 2)}
            onChange={onCategoriesChange}
            aria-invalid={hasErrors}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
          <small className="form-text text-secondary">
            Enter an array of strings, where each string is a product category.
          </small>
        </ClayForm.Group>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || hasErrors}
            aria-label="Save categories configuration"
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-label="Cancel changes"
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}
