// The /admin/analytics page: write a read-only SQL query against the Iceberg analytics tables, fill
// in its parameters, run it, and see or download the results. Queries go through the harmony
// frontend to the analytics query service, which validates every query before running it.
import { chartProblem, isNumericType, renderChart, suggestChart } from './chart.js';
import { createEditor } from './editor.js';
import { download, parameterValue, renderTable, toCsv } from './results.js';
import { defaultToText, filterSavedList, renderSavedList } from './saved.js';

const API = '/admin/analytics/api';
// Each user's last query and row limit are kept in this browser only (see remember), so a reload
// doesn't lose them
const STORAGE_PREFIX = 'harmony.analytics';
const DEFAULT_ROW_LIMIT = 10;
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
  // Every saved query, and the one that is open (null for an unsaved query)
  savedQueries: [],
  current: null,
  // The name, description, SQL and chart as last opened or saved, to tell whether there are changes
  snapshot: null,
  // How to chart the results (see chart.js), or null for no chart
  chart: null,
};

/**
 * Reads a color token from the page's CSS custom properties, for the charts
 *
 * @param {string} name - the custom property name
 * @returns {string} the color
 */
const token = (name) => getComputedStyle($('analytics')).getPropertyValue(name).trim();

const page = $('analytics');
const user = { username: page.dataset.username, isAdmin: page.dataset.isAdmin === 'true' };

/**
 * Whether the user may change or delete a saved query (the API enforces the same rule)
 */
const canChange = (query) => user.isAdmin || query.owner === user.username;

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
 * @param {string} endpoint - e.g. schema, validate, query, or queries/12
 * @param {object} [body] - the JSON body, which makes the request a POST unless method says otherwise
 * @param {string} [method] - the HTTP method, if not GET (no body) or POST (a body)
 * @returns {Promise<object|null>} the response, or null if there was none
 * @throws {ApiError} if the request fails
 */
async function api(endpoint, body, method = body === undefined ? 'GET' : 'POST') {
  let response;
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    response = await fetch(`${API}/${endpoint}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // e.g. an expired session redirecting the request to the Earthdata Login page
    throw new ApiError('Could not reach Harmony. If your session has expired, reload the page to log in again.', 0);
  }
  if (response.status === 204) return null;
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
 * Gets the storage key for one of the user's remembered settings. Keys include the username, so
 * people sharing a browser each get their own.
 *
 * @param {string} name - the setting, e.g. query or rowLimit
 */
const storageKey = (name) => `${STORAGE_PREFIX}.${user.username}.${name}`;

/**
 * Reads one of the user's remembered settings
 *
 * @param {string} name - the setting
 * @returns {string|null} its value, or null if there is none (or storage is unavailable)
 */
function remembered(name) {
  try {
    return localStorage.getItem(storageKey(name));
  } catch {
    return null;
  }
}

/**
 * Remembers one of the user's settings in this browser, for the next time the page is opened
 *
 * @param {string} name - the setting
 * @param {string} value - its value
 */
function remember(name, value) {
  try {
    localStorage.setItem(storageKey(name), value);
  } catch {
    // storage may be unavailable (e.g. blocked), in which case the setting just isn't kept
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
    if (schema.limits?.maxRows) {
      $('rowLimit').max = schema.limits.maxRows;
      $('rowLimit').title = `Up to ${schema.limits.maxRows.toLocaleString()} rows`;
    }
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
 * Draws the chart of the current result, or explains why it can't be drawn
 */
function drawChart() {
  const card = $('chartCard');
  const problemText = $('chartProblem');
  const { chart, result } = state;
  card.hidden = true;
  problemText.hidden = true;
  if (!chart || !result) return;
  const problem = chartProblem(chart, result.columns)
    ?? renderChart(card, result, chart, { title: $('queryName').value.trim() || 'Query results', color: token });
  if (problem) {
    problemText.textContent = `Can't chart this: ${problem}`;
    problemText.hidden = false;
  } else {
    card.hidden = false;
  }
}

/**
 * Shows the chart controls for the current result's columns, set to the current chart
 */
function renderChartControls() {
  const { chart, result } = state;
  const columns = result?.columns ?? [];
  $('chartType').value = chart?.type ?? '';
  $('chartAxisControls').hidden = !chart;
  if (!chart) return;

  const option = (value, text, selected) => {
    const o = new Option(text, value);
    o.selected = selected;
    return o;
  };
  $('chartX').replaceChildren(...columns.map((c) => option(c.name, c.name, c.name === chart.x)));
  $('chartSeries').replaceChildren(
    option('', 'none', !chart.series),
    ...columns.filter((c) => !isNumericType(c.type) && c.name !== chart.x)
      .map((c) => option(c.name, c.name, c.name === chart.series)),
  );
  $('chartYOptions').replaceChildren(...columns.filter((c) => isNumericType(c.type) && c.name !== chart.x).map((c) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = c.name;
    box.checked = chart.y.includes(c.name);
    label.append(box, c.name);
    return label;
  }));
}

/**
 * Updates the chart from its controls
 *
 * @param {object} editor - the editor
 * @param {boolean} typeChanged - whether the chart type was what changed
 */
function onChartControlsChanged(editor, typeChanged) {
  const type = $('chartType').value;
  if (!type) {
    state.chart = null;
  } else if (typeChanged && !state.chart) {
    // Start from a suggestion for these columns
    const suggested = state.result ? suggestChart(state.result.columns) : null;
    state.chart = { ...(suggested ?? { x: state.result?.columns[0]?.name ?? '', y: [], series: null }), type };
  } else {
    let y = [...$('chartYOptions').querySelectorAll('input:checked')].map((box) => box.value);
    const series = $('chartSeries').value || null;
    // Splitting into series by a column charts one value column
    if (series && y.length > 1) y = y.slice(0, 1);
    state.chart = { type, x: $('chartX').value, y, series };
  }
  renderChartControls();
  drawChart();
  updateSaveControls(editor);
}

/**
 * Gets the row limit from its box
 *
 * @returns {number} the limit
 * @throws {Error} if it isn't a whole number from 1 to the service's maximum
 */
function rowLimit() {
  const input = $('rowLimit');
  const limit = Number(input.value);
  const max = Number(input.max) || Infinity;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    input.focus();
    throw new Error(`The row limit must be a whole number from 1${Number.isFinite(max) ? ` to ${max.toLocaleString()}` : ''}`);
  }
  return limit;
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
    const limit = rowLimit();
    const result = await api('query', { sql: text, params: parameterValues(), limit });
    state.result = result;
    renderTable($('resultsTable'), result);
    renderChartControls();
    drawChart();
    $('resultsSummary').textContent = `${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? '' : 's'} in `
      + `${result.durationMs.toLocaleString()} ms`;
    const truncated = $('truncatedWarning');
    const max = Number($('rowLimit').max);
    truncated.textContent = `The query has more rows than the row limit, so only the first ${result.rowCount.toLocaleString()} `
      + 'are shown (and downloaded and charted). '
      + (limit < max ? `Raise the row limit (up to ${max.toLocaleString()}), or filter or aggregate the query to see the rest.`
        : 'Filter or aggregate the query to see the rest.');
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
 * Asks the user to confirm something
 *
 * @param {string} message - the question
 * @param {string} okLabel - the label for the button that confirms
 * @returns {Promise<boolean>} whether they confirmed
 */
function confirmAction(message, okLabel) {
  const dialog = $('confirmDialog');
  $('confirmMessage').textContent = message;
  $('confirmOk').textContent = okLabel;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

/**
 * Asks before discarding unsaved changes, if there are any
 *
 * @param {object} editor - the editor
 * @returns {Promise<boolean>} whether to go ahead
 */
async function okToDiscard(editor) {
  return !hasUnsavedChanges(editor) || confirmAction('Discard the changes to the current query?', 'Discard');
}

/**
 * Gets the query's name, description and SQL as they are now
 *
 * @param {object} editor - the editor
 */
function currentDetails(editor) {
  return {
    name: $('queryName').value.trim(),
    description: $('queryDescription').value,
    sql: editor.text(),
    chart: JSON.stringify(state.chart),
  };
}

/**
 * Gets what to compare the current details with to tell whether a saved query has changed
 *
 * @param {object} query - the saved query
 */
function snapshotOf(query) {
  return { name: query.name, description: query.description, sql: query.sql, chart: JSON.stringify(query.chart ?? null) };
}

/**
 * Whether opening another query would lose changes: edits to the open saved query, or a new query
 * that has been written but not saved
 *
 * @param {object} editor - the editor
 */
function hasUnsavedChanges(editor) {
  const details = currentDetails(editor);
  if (!state.snapshot) return details.sql.trim() !== '' && details.sql !== EXAMPLE_QUERY;
  return ['name', 'description', 'sql', 'chart'].some((key) => details[key] !== state.snapshot[key]);
}

/**
 * Shows whether the query is saved, and the save buttons that apply to it: an owner saves their
 * query in place (or as a new one), anyone else saves a copy
 *
 * @param {object} editor - the editor
 */
function updateSaveControls(editor) {
  const { current } = state;
  const owns = current !== null && canChange(current);
  $('saveLabel').textContent = current && !owns ? 'Save a copy' : 'Save';
  $('saveAsNew').hidden = !owns;
  $('copyLink').hidden = !current;
  let status = '';
  if (hasUnsavedChanges(editor)) status = current ? 'Unsaved changes' : 'Not saved';
  else if (current) status = owns ? 'Saved' : `Saved by ${current.owner}`;
  $('saveStatus').textContent = status;
}

/**
 * Shows the saved queries
 *
 * @param {object} editor - the editor
 */
function renderSaved(editor) {
  renderSavedList($('savedList'), state.savedQueries, {
    currentId: state.current?.id ?? null,
    canChange,
    onOpen: (query) => void openQuery(query.id, editor),
    onDelete: (query) => void deleteQuery(query, editor),
  });
  filterSavedList($('savedList'), $('savedFilter').value);
  $('savedEmpty').hidden = state.savedQueries.length > 0;
}

/**
 * Loads the saved queries
 *
 * @param {object} editor - the editor
 */
async function loadSavedQueries(editor) {
  try {
    state.savedQueries = (await api('queries')).queries;
    renderSaved(editor);
  } catch (e) {
    showError(e, editor);
  }
}

/**
 * Puts the open saved query's id in the page URL, so the URL is a link to it
 *
 * @param {number|null} id - the id, or null for an unsaved query
 */
function setUrlQuery(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('query', id);
  else url.searchParams.delete('query');
  window.history.replaceState(null, '', url);
}

/**
 * Shows a saved query, or a new empty one
 *
 * @param {object|null} query - the saved query, or null for a new one
 * @param {object} editor - the editor
 */
function showQuery(query, editor) {
  state.current = query;
  state.snapshot = query ? snapshotOf(query) : null;
  state.chart = query?.chart ?? null;
  $('queryName').value = query?.name ?? '';
  $('queryDescription').value = query?.description ?? '';
  // The parameter fields are rebuilt, with the saved defaults, once the query has been validated
  $('parameterFields').replaceChildren();
  $('parameters').hidden = true;
  state.parameterValues = new Map(Object.entries(query?.parameters ?? {}).map(([k, v]) => [k, defaultToText(v)]));
  editor.setText(query?.sql ?? '');
  setUrlQuery(query?.id ?? null);
  state.result = null;
  $('results').hidden = true;
  clearError();
  renderSaved(editor);
  updateSaveControls(editor);
}

/**
 * Opens a saved query
 *
 * @param {number|string} id - its id
 * @param {object} editor - the editor
 * @param {boolean} [askFirst] - whether to ask before losing unsaved changes
 */
async function openQuery(id, editor, askFirst = true) {
  if (askFirst && !(await okToDiscard(editor))) return;
  try {
    showQuery(await api(`queries/${encodeURIComponent(id)}`), editor);
  } catch (e) {
    showError(e, editor);
  }
}

/**
 * Saves the query, with the parameter values entered as its defaults
 *
 * @param {object} editor - the editor
 * @param {boolean} asNew - whether to save a new query even if the user owns the open one
 */
async function save(editor, asNew) {
  clearError();
  const details = currentDetails(editor);
  if (!details.name) {
    $('saveStatus').textContent = 'Give the query a name to save it';
    $('queryName').focus();
    return;
  }
  let parameters;
  try {
    parameters = parameterValues();
  } catch (e) {
    showError(e, editor);
    return;
  }
  const body = { ...details, chart: state.chart, parameters };
  const inPlace = state.current && canChange(state.current) && !asNew;
  try {
    const saved = inPlace
      ? await api(`queries/${state.current.id}`, body, 'PUT')
      : await api('queries', body);
    state.current = saved;
    state.snapshot = snapshotOf(saved);
    setUrlQuery(saved.id);
    await loadSavedQueries(editor);
    updateSaveControls(editor);
  } catch (e) {
    showError(e, editor);
  }
}

/**
 * Deletes a saved query, after asking
 *
 * @param {object} query - the query
 * @param {object} editor - the editor
 */
async function deleteQuery(query, editor) {
  if (!(await confirmAction(`Delete the saved query "${query.name}"? This can't be undone.`, 'Delete'))) return;
  try {
    await api(`queries/${query.id}`, undefined, 'DELETE');
    if (state.current?.id === query.id) {
      // Keep what's in the editor, now as an unsaved query
      state.current = null;
      state.snapshot = null;
      setUrlQuery(null);
    }
    await loadSavedQueries(editor);
    updateSaveControls(editor);
  } catch (e) {
    showError(e, editor);
  }
}

/**
 * Sets up the page
 */
function init() {
  const editor = createEditor({
    parent: $('editor'),
    doc: remembered('query') ?? EXAMPLE_QUERY,
    validate: (text) => api('validate', { sql: text }),
    onValidated,
    onRun: () => void run(editor),
    onChange: (text) => {
      remember('query', text);
      updateSaveControls(editor);
    },
  });
  $('runQuery').addEventListener('click', () => void run(editor));
  $('rowLimit').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void run(editor);
  });
  // The user's row limit from last time, kept whenever it changes to a valid value
  const savedLimit = Number(remembered('rowLimit'));
  $('rowLimit').value = Number.isInteger(savedLimit) && savedLimit >= 1 ? savedLimit : DEFAULT_ROW_LIMIT;
  $('rowLimit').addEventListener('change', (e) => {
    const limit = Number(e.target.value);
    if (Number.isInteger(limit) && limit >= 1) remember('rowLimit', String(limit));
  });

  $('queryDetails').addEventListener('submit', (e) => {
    e.preventDefault();
    void save(editor, false);
  });
  $('saveAsNew').addEventListener('click', () => void save(editor, true));
  $('chartControls').addEventListener('change', (e) => onChartControlsChanged(editor, e.target.id === 'chartType'));
  $('chartControls').addEventListener('submit', (e) => e.preventDefault());
  $('queryName').addEventListener('input', () => updateSaveControls(editor));
  $('queryDescription').addEventListener('input', () => updateSaveControls(editor));
  $('newQuery').addEventListener('click', async () => {
    if (!(await okToDiscard(editor))) return;
    showQuery(null, editor);
    editor.view.focus();
  });
  $('savedFilter').addEventListener('input', (e) => filterSavedList($('savedList'), e.target.value));
  $('copyLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      $('saveStatus').textContent = 'Link copied';
    } catch {
      $('saveStatus').textContent = 'Copy the link from the address bar';
    }
  });

  // A link to a saved query (?query=id) opens it; otherwise the query from last time is shown
  const linkedId = new URLSearchParams(window.location.search).get('query');
  if (linkedId) void openQuery(linkedId, editor, false);
  void loadSavedQueries(editor);
  updateSaveControls(editor);
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
