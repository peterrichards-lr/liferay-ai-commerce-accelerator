export const defaultEditorOptions = {
  lineNumbers: true,
  lineWrapping: true,
  foldGutter: true,
  gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
  autoCloseBrackets: true,
  matchBrackets: true,
};

// The bundle carries no CodeMirror core stylesheet of its own; the editors are
// styled entirely by the copy Liferay already ships with the CKEditor
// CodeMirror plugin. Every panel that hosts an editor has to ask for it,
// because a panel that does not gets an unstyled editor - and the shared
// element id means the first panel to ask covers the ones visited afterwards,
// which is what made this look like a rendering glitch rather than a missing
// stylesheet.
const CODEMIRROR_LIFERAY_CSS_ID = 'liferay-codemirror-vendors-css';

export function ensureLiferayCodeMirrorCss() {
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
