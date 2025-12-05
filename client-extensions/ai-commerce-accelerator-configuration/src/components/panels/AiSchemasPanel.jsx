import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import Ajv from 'ajv';
import SchemaEditor from './SchemaEditor';
import { useForm, useObjectStorage } from '../../hooks';

const ENTITY_CONFIGS = [
  { id: 'product', title: 'Product Schema', configKey: 'ai-schema-product' },
  { id: 'account', title: 'Account Schema', configKey: 'ai-schema-account' },
  { id: 'order', title: 'Order Schema', configKey: 'ai-schema-order' },
];

const { keys, defaults } = ENTITY_CONFIGS.reduce(
  (acc, { configKey }) => {
    acc.keys.push(configKey);
    acc.defaults[configKey] = {};
    return acc;
  },
  { keys: [], defaults: {} }
);

const EMPTY_ERRORS = ENTITY_CONFIGS.reduce((acc, { id }) => {
  acc[id] = [];
  return acc;
}, {});

const ajv = new Ajv();

const CODEMIRROR_LIFERAY_CSS_ID = 'liferay-codemirror-vendors-css';

function ensureLiferayCodeMirrorCss() {
  if (document.getElementById(CODEMIRROR_LIFERAY_CSS_ID)) {
    return;
  }

  const link = document.createElement('link');

  link.id = CODEMIRROR_LIFERAY_CSS_ID;
  link.rel = 'stylesheet';
  link.type = 'text/css';

  const contextPath = window.Liferay?.ThemeDisplay?.getPathContext
    ? window.Liferay.ThemeDisplay.getPathContext()
    : '';

  link.href = `${contextPath}/o/frontend-editor-ckeditor-web/ckeditor/plugins/codemirror/vendors/vendors.css`;

  document.head.appendChild(link);
}

export default function AiSchemasPanel() {
  const [errors, setErrors] = useState(EMPTY_ERRORS);

  const {
    loading,
    saving,
    values: schemas,
    dirty,
    onSave,
    onCancel: onCancelHook,
    setValues,
  } = useObjectStorage({ keys, defaults });

  useEffect(() => {
    ensureLiferayCodeMirrorCss();
  }, []);

  const onCancel = useCallback(() => {
    onCancelHook();
    setErrors(EMPTY_ERRORS);
  }, [onCancelHook]);

  useForm({ dirty, onSave });

  const onSchemaChange = (schemaId, configKey, value) => {
    try {
      const parsed = JSON.parse(value);
      ajv.compile(parsed);

      setErrors((prev) => ({ ...prev, [schemaId]: [] }));

      setValues((prev) => ({
        ...prev,
        [configKey]: parsed,
      }));
    } catch (error) {
      setErrors((prev) => ({ ...prev, [schemaId]: [error.message] }));
    }
  };

  const hasErrors = useMemo(
    () => Object.values(errors).some((e) => e.length > 0),
    [errors]
  );

  return (
    <>
      <div className="sheet-header">
        <h2 className="sheet-title">AI Schemas</h2>
        <div className="sheet-text">
          Define the JSON schemas for the AI-generated data.
        </div>
      </div>
      <div className="sheet-section">
        {ENTITY_CONFIGS.map(({ id, title, configKey }) => (
          <SchemaEditor
            key={id}
            title={title}
            configKey={configKey}
            value={JSON.stringify(schemas[configKey], null, 2)}
            onChange={(value) => onSchemaChange(id, configKey, value)}
            errors={errors[id]}
          />
        ))}
      </div>
      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || hasErrors}
            aria-label="Save AI schemas"
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
    </>
  );
}
