import React from 'react';
import ClayLayout from '@clayui/layout';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/javascript/javascript';
import ClayAlert from '@clayui/alert';

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
            mode: { name: 'javascript', json: true },
            lineNumbers: true,
          }}
          onBeforeChange={(editor, data, newValue) => {
            onChange(newValue);
          }}
        />
      </div>
    </ClayLayout.Sheet>
  );
}
