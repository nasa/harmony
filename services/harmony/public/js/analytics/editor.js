// The SQL editor for the analytics page: DuckDB-flavoured SQL highlighting, completion of the
// analytics tables and columns, and errors from the analytics query service's validation.
import {
  basicSetup, Compartment, EditorSelection, EditorState, EditorView, indentWithTab, keymap, linter, lintGutter,
  placeholder, PostgreSQL, Prec, sql, SQLDialect,
} from '/js/vendor/codemirror.js';

// DuckDB keywords and types beyond PostgreSQL's, so they highlight and complete
const DUCKDB_KEYWORDS = 'anti asof columns exclude glob ilike pivot pivot_longer pivot_wider positional qualify '
  + 'rename replace sample semi summarize unpivot using';
const DUCKDB_TYPES = 'hugeint uhugeint ubigint uinteger usmallint utinyint tinyint list map struct union uuid varchar '
  + 'timestamptz blob';

const duckDb = SQLDialect.define({
  ...PostgreSQL.spec,
  keywords: `${PostgreSQL.spec.keywords} ${DUCKDB_KEYWORDS}`,
  types: `${PostgreSQL.spec.types} ${DUCKDB_TYPES}`,
  // $name is a query parameter in DuckDB, not the start of a dollar-quoted string
  doubleDollarQuotedStrings: false,
  specialVar: '$',
});

// How long typing must pause before the query is validated again
const VALIDATE_DELAY_MS = 600;

// Time expressions offered as completions, e.g. typing "last" offers "last 7 days", which inserts
// now() - INTERVAL 7 DAY. Times are UTC, the timezone queries run in.
const TIME_EXPRESSIONS = [
  ['now', 'now()', 'The current time'],
  ['today', "date_trunc('day', now())", 'The start of today'],
  ['yesterday', "date_trunc('day', now()) - INTERVAL 1 DAY", 'The start of yesterday'],
  ['last 24 hours', 'now() - INTERVAL 24 HOUR', '24 hours ago'],
  ['last 7 days', 'now() - INTERVAL 7 DAY', '7 days ago'],
  ['last 30 days', 'now() - INTERVAL 30 DAY', '30 days ago'],
  ['this month', "date_trunc('month', now())", 'The start of this month'],
  ['last month', "date_trunc('month', now()) - INTERVAL 1 MONTH", 'The start of last month'],
  ['this year', "date_trunc('year', now())", 'The start of this year'],
];

/**
 * Completes time expressions, and a timestamp literal for the start of today. They rank below the
 * schema and keyword completions, so they only lead when nothing else matches what was typed.
 *
 * @param {object} context - CodeMirror's completion context
 * @returns {object|null} the completions
 */
export function timeCompletions(context) {
  const word = context.matchBefore(/\w+/);
  if (!context.explicit && (!word || word.text.length < 2)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const options = [
    ...TIME_EXPRESSIONS.map(([label, apply, info]) => ({ label, apply, detail: apply, info, type: 'constant', boost: -20 })),
    {
      label: 'timestamptz', apply: `TIMESTAMPTZ '${today} 00:00:00+00'`, detail: `TIMESTAMPTZ '${today} 00:00:00+00'`,
      info: 'A timestamp literal (UTC), to edit', type: 'constant', boost: -20,
    },
  ];
  return { from: word ? word.from : context.pos, options, validFor: /^\w*$/ };
}

/**
 * Builds the completion namespace for the SQL language from the analytics tables: each table by its
 * own name (the editor's default schema) and fully qualified as catalog.iceberg.table
 *
 * @param {Array<{name: string, columns: Array<{name: string, type: string}>}>} tables - the tables
 * @returns {object} the namespace
 */
function completionSchema(tables) {
  const namespace = {};
  for (const table of tables) {
    namespace[table.name] = table.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type }));
  }
  return { ...namespace, iceberg: namespace, catalog: { iceberg: namespace } };
}

/**
 * Gets the range an error at a position should underline: the word (or quoted name) starting there,
 * or the first line when there is no position
 *
 * @param {string} text - the query
 * @param {number|null} position - where the error is, as a character offset
 * @returns {{from: number, to: number}} the range
 */
export function errorRange(text, position) {
  if (position === null || position === undefined || position < 0 || position >= text.length) {
    const lineEnd = text.indexOf('\n');
    return { from: 0, to: Math.max(1, lineEnd === -1 ? text.length : lineEnd) };
  }
  const match = /^("[^"]*"|'[^']*'|[\w$.]+)/.exec(text.slice(position));
  return { from: position, to: position + (match ? match[0].length : 1) };
}

/**
 * Creates the editor
 *
 * @param {object} options - the options
 * @param {HTMLElement} options.parent - the element to put the editor in
 * @param {string} options.doc - the initial query
 * @param {function(string): Promise<object>} options.validate - validates a query, resolving to the
 * service's validation result (or rejecting if it couldn't be checked)
 * @param {function(object|null, string): void} options.onValidated - called with each validation
 * result (null if the query couldn't be checked) and the query it is for
 * @param {function(): void} options.onRun - called when the user asks to run the query
 * @param {function(string): void} options.onChange - called with the query whenever it changes
 * @returns {{view: EditorView, setTables: function(Array): void, insert: function(string): void,
 *   select: function(number|null): void, text: function(): string, setText: function(string): void}}
 *   the editor and helpers
 */
export function createEditor({ parent, doc, validate, onValidated, onRun, onChange }) {
  const language = new Compartment();
  const sqlFor = (tables) => {
    const support = sql({ dialect: duckDb, schema: completionSchema(tables), upperCaseKeywords: true });
    // Alongside the language's own schema and keyword completions
    return [support, support.language.data.of({ autocomplete: timeCompletions })];
  };

  const validationLinter = linter(async (view) => {
    const text = view.state.doc.toString();
    if (text.trim() === '') {
      onValidated(null, text);
      return [];
    }
    let result;
    try {
      result = await validate(text);
    } catch {
      onValidated(null, text);
      return [];
    }
    // The query may have changed while it was being checked
    if (view.state.doc.toString() !== text) return [];
    onValidated(result, text);
    return (result.errors ?? []).map(({ message, position }) => ({
      ...errorRange(text, position), severity: 'error', message,
    }));
  }, { delay: VALIDATE_DELAY_MS });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        language.of(sqlFor([])),
        validationLinter,
        lintGutter(),
        placeholder('SELECT status, count(*) FROM jobs GROUP BY status'),
        // Ahead of the default keymap, where Mod-Enter inserts a blank line
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { onRun(); return true; } }])),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'SQL query' }),
      ],
    }),
  });

  return {
    view,
    text: () => view.state.doc.toString(),
    setText: (value) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }),
    setTables: (tables) => view.dispatch({ effects: language.reconfigure(sqlFor(tables)) }),
    insert: (value) => {
      view.dispatch(view.state.replaceSelection(value));
      view.focus();
    },
    select: (position) => {
      const { from, to } = errorRange(view.state.doc.toString(), position);
      view.dispatch({ selection: EditorSelection.range(from, to), scrollIntoView: true });
      view.focus();
    },
  };
}
