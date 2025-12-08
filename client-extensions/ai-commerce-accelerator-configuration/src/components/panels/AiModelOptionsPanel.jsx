import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import Ajv from 'ajv';
import SchemaEditor from './SchemaEditor';
import { useForm, useObjectStorage } from '../../hooks';

const ENTITY_CONFIGS = [
  { id: 'ai-model-options', title: 'AI Model Options', configKey: 'ai-model-options' },
];

const { keys, defaults } = ENTITY_CONFIGS.reduce(
  (acc, { configKey }) => {
    acc.keys.push(configKey);
    acc.defaults[configKey] = [
      { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
      { label: 'GPT-4o', value: 'gpt-4o' },
      { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
    ];
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

export default function AiModelOptionsPanel() {
  const [errors, setErrors] = useState(EMPTY_ERRORS);

  const {
    loading,
    saving,
    values: aiModelOptions,
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
      // Custom validation for AI Model Options: array of { label: string, value: string }
      if (!Array.isArray(parsed)) {
        throw new Error('Expected an array.');
      }
      parsed.forEach((item, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new Error(`Item ${index} is not an object.`);
        }
        if (typeof item.label !== 'string' || item.label.trim() === '') {
          throw new Error(`Item ${index} is missing a valid 'label' string.`);
        }
        if (typeof item.value !== 'string' || item.value.trim() === '') {
          throw new Error(`Item ${index} is missing a valid 'value' string.`);
        }
      });

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
        <h2 className="sheet-title">AI Model Options</h2>
        <div className="sheet-text">
          Define the available AI models for generation. Each model should have a 'label' and 'value'.
        </div>
      </div>
      <div className="sheet-section">
        {ENTITY_CONFIGS.map(({ id, title, configKey }) => (
          <SchemaEditor
            key={id}
            title={title}
            configKey={configKey}
            value={JSON.stringify(aiModelOptions[configKey], null, 2)}
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
            aria-label="Save AI model options"
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
