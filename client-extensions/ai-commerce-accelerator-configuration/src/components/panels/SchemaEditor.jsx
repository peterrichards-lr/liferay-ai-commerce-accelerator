import React, { useCallback } from 'react';
import ClayLayout from '@clayui/layout';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import ClayAlert from '@clayui/alert';
import ImportExportButtons from '../common/ImportExportButtons';
import { useCodeMirrorRefresh } from '../../hooks';
import { defaultEditorOptions } from '../../utils/editor';

export default function SchemaEditor({
  title,
  configKey,
  value,
  onChange,
  editorDidMount,
  errors = [],
}) {
  const refreshOnLayout = useCodeMirrorRefresh();

  const onEditorDidMount = useCallback(
    (editor, editorValue, next) => {
      refreshOnLayout(editor);
      editorDidMount?.(editor, editorValue, next);
    },
    [editorDidMount, refreshOnLayout]
  );

  return (
    <ClayLayout.Sheet>
      <div className="sheet-header d-flex justify-content-between align-items-center">
        <div>
          <h2 className="sheet-title">{title}</h2>
          <div className="sheet-text">
            Configuration Key: <code>{configKey}</code>
          </div>
        </div>
        <ImportExportButtons
          filename={`${configKey || 'schema'}.json`}
          label={title}
          onImport={onChange}
          text={value}
        />
      </div>
      <div className="sheet-section">
        {errors.length > 0 && (
          <ClayAlert displayType="danger" title="Errors">
            <ul>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </ClayAlert>
        )}
        <CodeMirror
          editorDidMount={onEditorDidMount}
          value={value}
          options={{
            ...defaultEditorOptions,
            mode: { name: 'javascript', json: true },
          }}
          onBeforeChange={(editor, data, newValue) => {
            onChange(newValue);
          }}
        />
      </div>
    </ClayLayout.Sheet>
  );
}
