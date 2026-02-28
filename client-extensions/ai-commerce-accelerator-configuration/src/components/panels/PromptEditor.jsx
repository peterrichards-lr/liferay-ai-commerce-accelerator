import ClayLayout from '@clayui/layout';
import React from 'react';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/markdown/markdown';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import { defaultEditorOptions } from '../../utils/editor';

export default function PromptEditor({ title, configKey, value, onChange }) {
  return (
    <ClayLayout.Sheet>
      <div className="sheet-header">
        <h2 className="sheet-title">{title}</h2>
        <div className="sheet-text">
          Configuration Key: <code>{configKey}</code>
        </div>
      </div>
      <div className="sheet-section">
        <CodeMirror
          value={value}
          options={{
            ...defaultEditorOptions,
            mode: 'markdown',
          }}
          onBeforeChange={(editor, data, newValue) => {
            onChange(newValue);
          }}
        />
      </div>
    </ClayLayout.Sheet>
  );
}
