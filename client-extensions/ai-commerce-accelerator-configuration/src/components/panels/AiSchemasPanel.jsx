import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import Ajv from 'ajv';
import SchemaEditor from './SchemaEditor';
import { useForm, useObjectStorage } from '../../hooks';

const ENTITY_CONFIGS = [
  { id: 'product', title: 'Product Schema', configKey: 'ai-schema-product' },
  { id: 'account', title: 'Account Schema', configKey: 'ai-schema-account' },
  { id: 'order', title: 'Order Schema', configKey: 'ai-schema-order' },
  { id: 'pdf', title: 'PDF Schema', configKey: 'ai-schema-pdf' },
  { id: 'pricing', title: 'Pricing Schema', configKey: 'ai-schema-pricing' },
  {
    id: 'warehouse',
    title: 'Warehouse Schema',
    configKey: 'ai-schema-warehouse',
  },
  { id: 'promo', title: 'Promotion Schema', configKey: 'ai-schema-promo' },
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

  const fileInputRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const handleCopyAll = useCallback(async () => {
    const payload = JSON.stringify(
      {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        schemas,
      },
      null,
      2
    );

    try {
      // Absent in insecure contexts; failing quietly is better than throwing
      // inside a click handler and leaving the panel unusable.
      await navigator?.clipboard?.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [schemas]);

  const handleExportAll = useCallback(() => {
    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      schemas,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aica-schemas.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [schemas]);

  const handleImportAll = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result || '{}');
          const imported = parsed.schemas || parsed;

          const accepted = {};
          const rejected = {};

          // Unlike prompts, which are free text, a schema that does not compile
          // would break generation for that entity. Validate each one and reject
          // it individually rather than importing the file wholesale.
          ENTITY_CONFIGS.forEach(({ id, configKey }) => {
            if (!(configKey in imported)) return;

            const value = imported[configKey];
            try {
              const candidate =
                typeof value === 'string' ? JSON.parse(value) : value;
              ajv.compile(candidate);
              accepted[configKey] = candidate;
              rejected[id] = [];
            } catch (error) {
              rejected[id] = [`Import rejected: ${error.message}`];
            }
          });

          if (Object.keys(accepted).length > 0) {
            setValues((prev) => ({ ...prev, ...accepted }));
          }
          setErrors((prev) => ({ ...prev, ...rejected }));
        } catch (error) {
          setErrors((prev) => ({
            ...prev,
            _file: [`Could not parse imported file: ${error.message}`],
          }));
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsText(file);
    },
    [setValues]
  );

  const hasErrors = useMemo(
    () => Object.values(errors).some((e) => e.length > 0),
    [errors]
  );

  return (
    <>
      <div className="sheet-header d-flex justify-content-between align-items-center">
        <div>
          <h2 className="sheet-title">AI Schemas</h2>
          <div className="sheet-text">
            Define the JSON schemas for the AI-generated data.
          </div>
        </div>
        <div className="btn-group">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json"
            onChange={handleImportAll}
          />
          <ClayButton
            displayType="secondary"
            onClick={() => fileInputRef.current?.click()}
            title="Import all schemas from JSON"
            className="mr-2"
            aria-label="Import all schemas"
          >
            <ClayIcon symbol="upload" />
            <span className="ml-2">Import All</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={handleCopyAll}
            title="Copy all schemas to the clipboard"
            className="mr-2"
            aria-label="Copy all schemas"
          >
            <ClayIcon symbol={copied ? 'check' : 'paste'} />
            <span className="ml-2">{copied ? 'Copied' : 'Copy All'}</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={handleExportAll}
            title="Export all schemas to JSON"
            aria-label="Export all schemas"
          >
            <ClayIcon symbol="download" />
            <span className="ml-2">Export All</span>
          </ClayButton>
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
