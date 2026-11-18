// The parts of CodeMirror the /admin/analytics page uses (public/js/analytics), bundled into
// public/js/vendor/codemirror.js by bin/build-codemirror-bundle. Everything is bundled into one file
// so there is exactly one copy of @codemirror/state, which CodeMirror requires.
export { acceptCompletion, autocompletion } from '@codemirror/autocomplete';
export { indentWithTab } from '@codemirror/commands';
export { PostgreSQL, sql, SQLDialect } from '@codemirror/lang-sql';
export { forceLinting, linter, lintGutter } from '@codemirror/lint';
export { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state';
export { EditorView, keymap, placeholder } from '@codemirror/view';
export { basicSetup } from 'codemirror';
