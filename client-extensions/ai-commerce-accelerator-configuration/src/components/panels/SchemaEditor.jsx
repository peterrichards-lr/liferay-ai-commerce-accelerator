import React from 'react';
import ClayLayout from '@clayui/layout';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import ClayAlert from '@clayui/alert';
import { defaultEditorOptions } from '../../utils/editor';

export default function SchemaEditor({
  title,
  configKey,
  value,
  onChange,
  editorDidMount,
  errors = [],
}) {
  return (
    <ClayLayout.Sheet>
      <div className="sheet-header">
        <h2 className="sheet-title">{title}</h2>
        <div className="sheet-text">
          Configuration Key: <code>{configKey}</code>
        </div>
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
          editorDidMount={editorDidMount}
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
