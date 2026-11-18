// The /admin/analytics page: write a read-only SQL query against the Iceberg analytics tables, fill
// in its parameters, run it, and see or download the results. Queries go through the harmony
// frontend to the analytics query service, which validates every query before running it.
import { createEditor } from './editor.js';
import { download, parameterValue, renderTable, toCsv } from './results.js';

const API = '/admin/analytics/api';
// The last query is kept in this browser only, so a reload doesn't lose it
const STORAGE_KEY = 'harmony.analytics.query';
const EXAMPLE_QUERY = `-- Jobs by status over the last 30 days
SELECT status, count(*) AS jobs
FROM jobs
WHERE created_at >= now() - INTERVAL 30 DAY
GROUP BY status
ORDER BY jobs DESC`;

const $ = (id) => document.getElementById(id);

const state = {
  // The latest validation result and the query it is for
  validation: null,
  validatedText: null,
  // Entered parameter values, by name, kept while the parameters change
  parameterValues: new Map(),
  result: null,
};

/**
 * An error from the analytics API, with the problems the service found in the query, if any
 */
class ApiError extends Error {
  constructor(message, status, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Calls the analytics API
 *
 * @param {string} endpoint - schema, validate, or query
 * @param {object} [body] - the JSON body, for a POST
 * @returns {Promise<object>} the response
 * @throws {ApiError} if the request fails
 */
async function api(endpoint, body) {
  let response;
  try {
    response = await fetch(`${API}/${endpoint}`, body === undefined
      ? { headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    // e.g. an expired session redirecting the request to the Earthdata Login page
    throw new ApiError('Could not reach Harmony. If your session has expired, reload the page to log in again.', 0);
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    // not JSON - reported by status below
  }
  if (!response.ok) {
    // The analytics service's errors have a message; harmony's own (e.g. a 403) a description
    throw new ApiError(data.message ?? data.description ?? `The request failed (HTTP ${response.status})`,
      response.status, data.errors ?? []);
  }
  return data;
}

/**
 * Reads the saved query, if there is one
 */
function savedQuery() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Saves the query
 */
function saveQuery(text) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // storage may be unavailable (e.g. blocked), in which case the query just isn't kept
  }
}

/**
 * Shows an error, listing the problems in the query with links to where they are
 *
 * @param {Error} error - the error
 * @param {object} editor - the editor, to select a problem's position
 */
function showError(error, editor) {
  const box = $('queryError');
  box.replaceChildren(error.message);
  const problems = error.errors ?? [];
  if (problems.length > 0) {
    const list = document.createElement('ul');
    list.className = 'query-error-list';
    for (const { message, position } of problems) {
      const item = document.createElement('li');
      if (position === null || position === undefined) {
        item.textContent = message;
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = message;
        button.title = 'Show where this is in the query';
        button.addEventListener('click', () => editor.select(position));
        item.append(button);
      }
      list.append(item);
    }
    box.append(list);
  }
  box.hidden = false;
}

/**
 * Hides the error
 */
function clearError() {
  $('queryError').hidden = true;
  $('queryError').replaceChildren();
}

/**
 * Shows the tables and columns, each name inserting itself into the query when selected
 *
 * @param {Array} tables - the tables
 * @param {object} editor - the editor
 */
function renderSchema(tables, editor) {
  const tree = $('schemaTree');
  const nameButton = (name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'insert-name';
    button.textContent = name;
    button.addEventListener('click', (e) => {
      e.preventDefault(); // inside a summary, a click would also toggle the details
      editor.insert(name);
    });
    return button;
  };
  tree.replaceChildren(...tables.map((table) => {
    const details = document.createElement('details');
    details.dataset.name = table.name;
    const summary = document.createElement('summary');
    summary.append(nameButton(table.name));
    const list = document.createElement('ul');
    for (const column of table.columns) {
      const item = document.createElement('li');
      item.dataset.name = column.name;
      const type = document.createElement('span');
      type.className = 'column-type';
      type.textContent = column.type;
      item.append(nameButton(column.name), type);
      list.append(item);
    }
    details.append(summary, list);
    return details;
  }));
}

/**
 * Shows only the tables and columns whose names contain the filter text, opening tables with
 * matching columns
 *
 * @param {string} text - the filter
 */
function filterSchema(text) {
  const needle = text.trim().toLowerCase();
  for (const details of $('schemaTree').querySelectorAll('details')) {
    const tableMatches = details.dataset.name.toLowerCase().includes(needle);
    let anyColumn = false;
    for (const item of details.querySelectorAll('li')) {
      const matches = !needle || tableMatches || item.dataset.name.toLowerCase().includes(needle);
      item.hidden = !matches;
      if (matches && !tableMatches && needle !== '') anyColumn = true;
    }
    details.hidden = !(tableMatches || anyColumn);
    if (needle) details.open = anyColumn;
  }
}

/**
 * Loads the tables, for the schema panel and completion
 *
 * @param {object} editor - the editor
 */
async function loadSchema(editor) {
  const status = $('schemaStatus');
  try {
    const schema = await api('schema');
    renderSchema(schema.tables, editor);
    editor.setTables(schema.tables);
    status.textContent = `${schema.tables.length} tables`;
    status.title = `Table list loaded ${new Date(schema.loadedAt).toLocaleString()}`;
    const warnings = $('schemaWarnings');
    warnings.replaceChildren(...schema.warnings.map((w) => {
      const p = document.createElement('div');
      p.textContent = w;
      return p;
    }));
    warnings.hidden = schema.warnings.length === 0;
  } catch (e) {
    status.textContent = 'The tables could not be loaded';
    showError(e, editor);
  }
}

/**
 * Shows a field for each of the query's parameters, keeping the values already entered
 *
 * @param {Array<{name: string, type: string}>} parameters - the parameters
 */
function renderParameters(parameters) {
  const fields = $('parameterFields');
  for (const input of fields.querySelectorAll('[data-parameter]')) {
    state.parameterValues.set(input.dataset.parameter, input.value);
  }
  fields.replaceChildren(...parameters.map(({ name, type }) => {
    const id = `parameter-${name}`;
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.htmlFor = id;
    label.append(`$${name} `);
    const typeText = document.createElement('span');
    typeText.className = 'parameter-type';
    typeText.textContent = type;
    label.append(typeText);

    let input;
    if (type === 'BOOLEAN') {
      input = document.createElement('select');
      input.className = 'form-control form-control-sm';
      for (const [value, text] of [['', 'NULL'], ['true', 'true'], ['false', 'false']]) {
        input.append(new Option(text, value));
      }
    } else {
      input = document.createElement('input');
      input.className = 'form-control form-control-sm';
      input.type = 'text';
      if (type.endsWith('[]')) input.placeholder = 'a, b, c';
      else if (type.startsWith('TIMESTAMP')) input.placeholder = '2026-11-01T00:00:00Z';
      else if (type === 'DATE') input.placeholder = '2026-11-01';
    }
    input.id = id;
    input.dataset.parameter = name;
    input.dataset.type = type;
    input.value = state.parameterValues.get(name) ?? '';
    wrapper.append(label, input);
    return wrapper;
  }));
  $('parameters').hidden = parameters.length === 0;
}

/**
 * Shows the result of validating the query
 *
 * @param {object|null} result - the validation result, or null if the query couldn't be checked
 * @param {string} text - the query it is for
 */
function onValidated(result, text) {
  const status = $('validationStatus');
  state.validation = result;
  state.validatedText = text;
  status.classList.remove('is-valid', 'is-invalid');
  if (!result) {
    status.textContent = '';
    return;
  }
  if (result.valid) {
    status.classList.add('is-valid');
    status.textContent = `✓ Valid: ${result.columns.length} column${result.columns.length === 1 ? '' : 's'}`;
    renderParameters(result.parameters);
  } else {
    status.classList.add('is-invalid');
    status.textContent = `✗ ${result.errors.map((e) => e.message).join('; ')}`;
  }
}

/**
 * Gets the parameter values from the form
 *
 * @returns {object} the values by name
 * @throws {Error} if a value isn't valid for its type
 */
function parameterValues() {
  const values = {};
  for (const input of $('parameterFields').querySelectorAll('[data-parameter]')) {
    values[input.dataset.parameter] = parameterValue(input.value, input.dataset.type);
  }
  return values;
}

/**
 * Runs the query and shows its result
 *
 * @param {object} editor - the editor
 */
async function run(editor) {
  const text = editor.text();
  if (text.trim() === '') return;
  const button = $('runQuery');
  clearError();
  button.disabled = true;
  $('resultsSummary').textContent = 'Running…';
  try {
    // Make sure the parameter fields are for this query
    if (state.validatedText !== text) {
      onValidated(await api('validate', { sql: text }), text);
    }
    const result = await api('query', { sql: text, params: parameterValues() });
    state.result = result;
    renderTable($('resultsTable'), result);
    $('resultsSummary').textContent = `${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? '' : 's'} in `
      + `${result.durationMs.toLocaleString()} ms`;
    const truncated = $('truncatedWarning');
    truncated.textContent = `Only the first ${result.rowCount.toLocaleString()} rows are shown (and downloaded). `
      + 'Add a LIMIT, filter, or aggregate to see the rest.';
    truncated.hidden = !result.truncated;
    $('results').hidden = false;
  } catch (e) {
    $('resultsSummary').textContent = '';
    showError(e, editor);
  } finally {
    button.disabled = false;
  }
}

/**
 * Sets up the page
 */
function init() {
  const editor = createEditor({
    parent: $('editor'),
    doc: savedQuery() ?? EXAMPLE_QUERY,
    validate: (text) => api('validate', { sql: text }),
    onValidated,
    onRun: () => void run(editor),
    onChange: saveQuery,
  });
  $('runQuery').addEventListener('click', () => void run(editor));
  $('parameters').addEventListener('submit', (e) => {
    e.preventDefault();
    void run(editor);
  });
  $('schemaFilter').addEventListener('input', (e) => filterSchema(e.target.value));
  $('downloadCsv').addEventListener('click', () => {
    if (state.result) download(toCsv(state.result), 'harmony-analytics.csv', 'text/csv');
  });
  void loadSchema(editor);
}

init();
