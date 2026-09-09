import ClayLayout from '@clayui/layout';
import React, { useCallback } from 'react';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/markdown/markdown';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import ImportExportButtons from '../common/ImportExportButtons';
import { useCodeMirrorRefresh } from '../../hooks';
import { defaultEditorOptions } from '../../utils/editor';

export default function PromptEditor({
  title,
  configKey,
  value,
  onChange,
  editorDidMount,
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
          accept=".md,.txt"
          filename={`${configKey || 'prompt'}.md`}
          label={title}
          mimeType="text/markdown;charset=utf-8"
          onImport={onChange}
          text={value}
        />
      </div>
      <div className="sheet-section">
        <CodeMirror
          editorDidMount={onEditorDidMount}
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
