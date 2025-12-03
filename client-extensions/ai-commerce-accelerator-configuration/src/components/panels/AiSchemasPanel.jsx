import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import Ajv from 'ajv';
import SchemaEditor from './SchemaEditor';
import { getKeyValue, persistConfigKey } from '../../utils/api';
import { useForm } from '../../hooks';

const ENTITY_CONFIGS = [
  { id: 'product', title: 'Product Schema', configKey: 'ai-schema-product' },
  { id: 'account', title: 'Account Schema', configKey: 'ai-schema-account' },
  { id: 'order', title: 'Order Schema', configKey: 'ai-schema-order' },
];

const EMPTY_SCHEMAS = ENTITY_CONFIGS.reduce((accumulator, { id }) => {
  accumulator[id] = {};
  return accumulator;
}, {});

const EMPTY_SCHEMA_TEXT = ENTITY_CONFIGS.reduce((accumulator, { id }) => {
  accumulator[id] = JSON.stringify(EMPTY_SCHEMAS[id], null, 2);
  return accumulator;
}, {});

const EMPTY_ERRORS = ENTITY_CONFIGS.reduce((accumulator, { id }) => {
  accumulator[id] = [];
  return accumulator;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemas, setSchemas] = useState(EMPTY_SCHEMAS);
  const [schemaText, setSchemaText] = useState(EMPTY_SCHEMA_TEXT);
  const [lastSavedSchemas, setLastSavedSchemas] = useState(EMPTY_SCHEMAS);
  const [lastSavedSchemaText, setLastSavedSchemaText] =
    useState(EMPTY_SCHEMA_TEXT);
  const [errors, setErrors] = useState(EMPTY_ERRORS);

  const dirty = useMemo(
    () => JSON.stringify(schemaText) !== JSON.stringify(lastSavedSchemaText),
    [schemaText, lastSavedSchemaText]
  );

  useEffect(() => {
    ensureLiferayCodeMirrorCss();
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const values = await Promise.all(
          ENTITY_CONFIGS.map(({ configKey }) => getKeyValue(configKey))
        );

        const newSchemas = {};
        ENTITY_CONFIGS.forEach(({ id }, index) => {
          const schemaString = values[index];
          newSchemas[id] = schemaString ? JSON.parse(schemaString) : {};
        });

        const newSchemaText = {};
        ENTITY_CONFIGS.forEach(({ id }) => {
          newSchemaText[id] = JSON.stringify(newSchemas[id], null, 2);
        });

        if (!alive) {
          return;
        }

        setSchemas(newSchemas);
        setSchemaText(newSchemaText);
        setLastSavedSchemas(newSchemas);
        setLastSavedSchemaText(newSchemaText);
      } catch (error) {
        console.error('Failed to load AI schemas.', error);
        Liferay?.Util?.openToast?.({
          message: 'Failed to load AI schemas.',
          type: 'danger',
        });
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const onSchemaChange = (schemaId, value) => {
    setSchemaText((previous) => ({
      ...previous,
      [schemaId]: value,
    }));

    try {
      const parsed = JSON.parse(value);
      ajv.compile(parsed);
      setErrors((previous) => ({ ...previous, [schemaId]: [] }));
      setSchemas((previous) => ({
        ...previous,
        [schemaId]: parsed,
      }));
    } catch (error) {
      setErrors((previous) => ({ ...previous, [schemaId]: [error.message] }));
    }
  };

  const onSave = useCallback(async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        ENTITY_CONFIGS.map(({ id, configKey }) =>
          persistConfigKey(configKey, JSON.stringify(schemas[id], null, 2))
        )
      );

      setLastSavedSchemas(schemas);
      setLastSavedSchemaText(schemaText);

      Liferay?.Util?.openToast?.({
        message: 'AI schemas saved.',
        type: 'success',
      });
    } catch (error) {
      console.error(error);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save AI schemas.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, schemas, schemaText]);

  useForm({ dirty, onSave });

  const onCancel = useCallback(() => {
    setSchemas(lastSavedSchemas);
    setSchemaText(lastSavedSchemaText);
    setErrors(EMPTY_ERRORS);
  }, [lastSavedSchemas, lastSavedSchemaText]);

  const hasErrors = useMemo(
    () => ENTITY_CONFIGS.some(({ id }) => errors[id]?.length > 0),
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
            value={schemaText[id]}
            onChange={(value) => onSchemaChange(id, value)}
            editorDidMount={() => {}}
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
