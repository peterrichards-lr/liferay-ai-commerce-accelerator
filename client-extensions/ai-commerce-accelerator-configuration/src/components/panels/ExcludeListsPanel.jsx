import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import ImportExportButtons from '../common/ImportExportButtons';
import { useCodeMirrorRefresh, useForm, useObjectStorage } from '../../hooks';
import Ajv from 'ajv';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import 'codemirror/theme/material.css';
import {
  defaultEditorOptions,
  ensureLiferayCodeMirrorCss,
} from '../../utils/editor';

const EXCLUDE_LISTS_CONFIG_KEY = 'ai-exclude-lists';

/**
 * The exclusion keys the SDK reads, and the shape of an entry.
 *
 * These are declared by `@liferay/accelerator-sdk` - `EXCLUSION_KEYS` and
 * `excludeListsJsonSchema()` - and the microservice takes them from there
 * directly. This panel cannot: the SDK depends on `better-sqlite3`,
 * `node-stream-zip` and `ws`, so it does not bundle for a browser.
 *
 * So this is a copy, and a copy is what #951 is about: the key set used to be
 * stated in three places that had already drifted - this panel offered three
 * keys, the microservice defaulted to four, and the SDK read ten. Six keys were
 * read by the SDK and written by nobody, and `excludeLists[undefined]` resolves
 * to `[]`, which is indistinguishable from "nothing was excluded" on the path
 * that then deletes things.
 *
 * What keeps this honest is `tests/excludeListKeys.test.cjs` in the
 * microservice, which imports the SDK and fails when this list stops matching
 * it. Drift is now a failing build rather than a silent hole. If you add a key
 * here by hand and the SDK does not know it, that test says so too.
 */
const EXCLUSION_KEYS = [
  'excludedAccounts',
  'excludedAccountGroups',
  'excludedProducts',
  'excludedWarehouses',
  'excludedPriceLists',
  'excludedOrders',
  'excludedSpecifications',
  'excludedOptions',
  'excludedOptionCategories',
];

/**
 * One entry, in the four ways the SDK's single matcher compares it.
 *
 * `LiferayService._shouldExclude` is the only comparison - every caller routes
 * through it - so the shape does not vary by key:
 *
 *   entityId  matched against item.id and item.productId, string-coerced
 *   erc       matched against item.externalReferenceCode
 *   key       matched against item.key - how Liferay names options and
 *             specifications, and unmatchable until accelerator-sdk #258
 *   name      matched against item.name, item.title, and the values of a
 *             localised name object
 *
 * Two limits worth knowing, because both fail silently: `entityId` reaches
 * `id` and `productId` only - not `sku`, not `uuid` - and an entry naming
 * nothing the matcher reads excludes nothing at all.
 */
const ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    entityId: { type: 'string' },
    erc: { type: 'string' },
    key: { type: 'string' },
    name: { type: 'string' },
  },
  anyOf: [
    { required: ['entityId'] },
    { required: ['erc'] },
    { required: ['key'] },
    { required: ['name'] },
  ],
};

const DEFAULTS = {
  [EXCLUDE_LISTS_CONFIG_KEY]: {
    ...Object.fromEntries(EXCLUSION_KEYS.map((key) => [key, []])),
    // Liferay's own test account, which a delete run must not remove.
    excludedAccounts: [{ name: 'Test Test' }],
  },
};

const ajv = new Ajv();

// Generated rather than written out nine times. `required` is deliberately
// absent: an operator's saved object predates most of these keys, and
// demanding them would refuse a configuration they have no way to have
// written. The SDK's own excludeListsJsonSchema() makes the same choice.
const schema = {
  type: 'object',
  properties: Object.fromEntries(
    EXCLUSION_KEYS.map((key) => [key, { type: 'array', items: ENTRY_SCHEMA }])
  ),
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

  const refreshOnLayout = useCodeMirrorRefresh();

  useEffect(() => {
    ensureLiferayCodeMirrorCss();
  }, []);

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

  // What the editor shows is what Export writes: a document mid-edit, invalid
  // JSON and all, exports as the operator sees it rather than as a silently
  // repaired version of it.
  const editorText = useMemo(
    () =>
      typeof excludeLists === 'string'
        ? excludeLists
        : JSON.stringify(excludeLists, null, 2),
    [excludeLists]
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
      <div className="sheet-header d-flex justify-content-between align-items-center">
        <div>
          <h2 className="sheet-title">Exclude Lists Configuration</h2>
          <div className="sheet-text">
            Manages <code>{EXCLUDE_LISTS_CONFIG_KEY}</code>.
          </div>
        </div>
        <ImportExportButtons
          filename={`${EXCLUDE_LISTS_CONFIG_KEY}.json`}
          label="Exclude Lists Configuration"
          onImport={onExcludeListsChange}
          text={editorText}
        />
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
            editorDidMount={refreshOnLayout}
            value={editorText}
            options={{
              ...defaultEditorOptions,
              mode: { name: 'javascript', json: true },
            }}
            onBeforeChange={(editor, data, newValue) => {
              onExcludeListsChange(newValue);
            }}
          />
          <small className="form-text text-secondary">
            Enter a JSON object with &apos;excludedAccounts&apos;,
            &apos;excludedProducts&apos;, and &apos;excludedWarehouses&apos;
            arrays. Each array item should be an object with at least one of
            &apos;entityId&apos;, &apos;erc&apos;, or &apos;name&apos;.
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
