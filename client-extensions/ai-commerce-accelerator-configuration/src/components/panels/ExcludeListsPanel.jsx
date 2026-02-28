import React, { useCallback, useMemo, useState } from 'react';
import ClayForm from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import Ajv from 'ajv';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import 'codemirror/theme/material.css';
import { defaultEditorOptions } from '../../utils/editor';

const EXCLUDE_LISTS_CONFIG_KEY = 'ai-exclude-lists';
const DEFAULTS = {
  [EXCLUDE_LISTS_CONFIG_KEY]: {
    excludedAccounts: [{ name: 'Test Test' }],
    excludedProducts: [],
    excludedWarehouses: [],
  },
};

const ajv = new Ajv();
const schema = {
  type: 'object',
  properties: {
    excludedAccounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entityId: { type: 'string' },
          erc: { type: 'string' },
          name: { type: 'string' },
        },
        anyOf: [
          { required: ['entityId'] },
          { required: ['erc'] },
          { required: ['name'] },
        ],
      },
    },
    excludedProducts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entityId: { type: 'string' },
          erc: { type: 'string' },
          name: { type: 'string' },
        },
        anyOf: [
          { required: ['entityId'] },
          { required: ['erc'] },
          { required: ['name'] },
        ],
      },
    },
    excludedWarehouses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entityId: { type: 'string' },
          erc: { type: 'string' },
          name: { type: 'string' },
        },
        anyOf: [
          { required: ['entityId'] },
          { required: ['erc'] },
          { required: ['name'] },
        ],
      },
    },
  },
  required: ['excludedAccounts', 'excludedProducts', 'excludedWarehouses'],
};
const validate = ajv.compile(schema);

export default function ExcludeListsPanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [EXCLUDE_LISTS_CONFIG_KEY]: excludeLists },
    dirty,
    onSave,
    onCancel: onCancelHook,
    setValue,
  } = useObjectStorage({
    keys: [EXCLUDE_LISTS_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  const onCancel = useCallback(() => {
    onCancelHook();
    setIssues([]);
  }, [onCancelHook]);

  useForm({ dirty, onSave });

  const onExcludeListsChange = useCallback(
    (rawValue) => {
      try {
        const parsed = JSON.parse(rawValue);
        if (!validate(parsed)) {
          setIssues(
            validate.errors.map(
              (err) => `Validation Error: ${err.message} at ${err.instancePath}`
            )
          );
        } else {
          setIssues([]);
        }
        setValue(EXCLUDE_LISTS_CONFIG_KEY, parsed);
      } catch (error) {
        setIssues([`JSON Parse Error: ${error.message}`]);
        setValue(EXCLUDE_LISTS_CONFIG_KEY, rawValue); // Store raw value to preserve user input
      }
    },
    [setValue]
  );

  const hasErrors = useMemo(
    () =>
      issues.length > 0 ||
      (typeof excludeLists === 'string' && excludeLists.length > 0) ||
      (typeof excludeLists === 'object' &&
        !Array.isArray(excludeLists) &&
        excludeLists !== null &&
        !validate(excludeLists)),
    [issues, excludeLists]
  );

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Exclude Lists Configuration</h2>
        <div className="sheet-text">
          Manages <code>{EXCLUDE_LISTS_CONFIG_KEY}</code>.
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
          <label htmlFor="exclude-lists-json" className="font-weight-semi-bold">
            Exclude Lists (JSON Object)
          </label>
          <CodeMirror
            value={
              typeof excludeLists === 'string'
                ? excludeLists
                : JSON.stringify(excludeLists, null, 2)
            }
            options={{
              ...defaultEditorOptions,
              mode: { name: 'javascript', json: true },
            }}
            onBeforeChange={(editor, data, newValue) => {
              onExcludeListsChange(newValue);
            }}
          />
          <small className="form-text text-secondary">
            Enter a JSON object with 'excludedAccounts', 'excludedProducts', and
            'excludedWarehouses' arrays. Each array item should be an object
            with at least one of 'entityId', 'erc', or 'name'.
          </small>
        </ClayForm.Group>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || hasErrors}
            aria-label="Save exclude lists configuration"
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
