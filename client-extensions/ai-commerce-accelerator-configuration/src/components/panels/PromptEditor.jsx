import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import React, { useRef, useCallback } from 'react';
import { Controlled as CodeMirror } from 'react-codemirror2';
import 'codemirror/mode/markdown/markdown';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/brace-fold';
import { defaultEditorOptions } from '../../utils/editor';

export default function PromptEditor({ title, configKey, value, onChange }) {
  const fileInputRef = useRef(null);

  const handleExport = useCallback(() => {
    const blob = new Blob([value || ''], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${configKey || 'prompt'}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [value, configKey]);

  const handleImport = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        onChange(event.target?.result || '');
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsText(file);
    },
    [onChange]
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
        <div className="btn-group">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".md,.txt"
            onChange={handleImport}
          />
          <ClayButton
            displayType="secondary"
            small
            onClick={() => fileInputRef.current?.click()}
            title="Import Markdown file"
            className="mr-2"
            aria-label={`Import ${title}`}
          >
            <ClayIcon symbol="upload" />
            <span className="ml-1">Import</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            small
            onClick={handleExport}
            disabled={!value}
            title="Export Markdown file"
            aria-label={`Export ${title}`}
          >
            <ClayIcon symbol="download" />
            <span className="ml-1">Export</span>
          </ClayButton>
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
