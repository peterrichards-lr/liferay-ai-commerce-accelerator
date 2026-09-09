import PropTypes from 'prop-types';
import React, { useCallback, useRef } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';

/**
 * Import and Export for one configuration document.
 *
 * `PromptEditor` had this pair and the JSON panels did not, so a category list
 * or an exclude list could only be typed into the editor - which is the whole
 * difficulty when a dataset's configuration is meant to be handed to someone
 * else. Extracted rather than copied a third time; `AiPromptsPanel` and
 * `AiSchemasPanel` still hand-roll their own "Import All"/"Export All", which
 * work on a different thing (every document at once) and are left alone.
 *
 * The part that matters is `onImport`: the file is handed to the panel as text
 * and goes through the same change handler a keystroke does. So a malformed or
 * schema-invalid document is reported by the panel's own validator and blocks
 * Save exactly as typing it would, instead of arriving already accepted. An
 * import that could bypass validation would be a worse feature than no import.
 */
export default function ImportExportButtons({
  accept = '.json',
  filename,
  label,
  mimeType = 'application/json;charset=utf-8',
  onImport,
  text,
}) {
  const fileInputRef = useRef(null);

  const handleExport = useCallback(() => {
    const blob = new Blob([text || ''], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filename, mimeType, text]);

  const handleImport = useCallback(
    (event) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      const reader = new FileReader();

      reader.onload = (loaded) => {
        onImport(loaded.target?.result || '');

        // Cleared so choosing the same file twice fires a second change; a
        // failed import that the operator fixes and retries is the expected
        // path, not an unusual one.
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };

      reader.readAsText(file);
    },
    [onImport]
  );

  return (
    <div className="btn-group">
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept={accept}
        onChange={handleImport}
      />
      <ClayButton
        displayType="secondary"
        small
        onClick={() => fileInputRef.current?.click()}
        title={`Import ${filename}`}
        className="mr-2"
        aria-label={`Import ${label}`}
      >
        <ClayIcon symbol="upload" />
        <span className="ml-1">Import</span>
      </ClayButton>
      <ClayButton
        displayType="secondary"
        small
        onClick={handleExport}
        disabled={!text}
        title={`Export ${filename}`}
        aria-label={`Export ${label}`}
      >
        <ClayIcon symbol="download" />
        <span className="ml-1">Export</span>
      </ClayButton>
    </div>
  );
}

ImportExportButtons.propTypes = {
  accept: PropTypes.string,
  filename: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  mimeType: PropTypes.string,
  onImport: PropTypes.func.isRequired,
  text: PropTypes.string,
};
