// The /admin/analytics page: write a read-only SQL query against the Iceberg analytics tables, fill
// in its parameters, run it, and see or download the results. Queries go through the harmony
// frontend to the analytics query service, which validates every query before running it.
import { chartProblem, isNumericType, renderChart, suggestChart } from './chart.js';
import { $, api, confirmAction, pageUser, renderError, userStorage } from './common.js';
import { createEditor } from './editor.js';
import { renderParameterFields } from './params.js';
import { download, parameterDefault, parameterValue, renderTable, toCsv } from './results.js';
import { defaultToText, filterSavedList, renderSavedList } from './saved.js';
import { initTimeHelp } from './timehelp.js';

const DEFAULT_ROW_LIMIT = 10;
const EXAMPLE_QUERY = `-- Jobs by status over the last 30 days
SELECT status, count(*) AS jobs
FROM jobs
WHERE created_at >= now() - INTERVAL 30 DAY
GROUP BY status
ORDER BY jobs DESC`;

const state = {
  // The latest validation result and the query it is for
  validation: null,
  validatedText: null,
  // Entered parameter values (as text), by name, kept while the parameters change
  parameterValues: new Map(),
  // The parameters the fields are for: the latest valid query's
  parameters: [],
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

const user = pageUser($('analytics'));

/**
 * Whether the user may change or delete a saved query (the API enforces the same rule)
 */
const canChange = (query) => user.isAdmin || query.owner === user.username;

// The user's last query and row limit, kept in this browser so a reload doesn't lose them
const { remembered, remember, forget } = userStorage(user.username);

// A new query that hasn't been saved is kept in the browser, so it isn't lost by going to another
// tab or reloading. A saved query isn't: it's reopened from its link, and the page otherwise starts
// with an empty editor.
const DRAFT_KEY = 'draft';

/**
 * Keeps the text of an unsaved new query, or forgets it once it's empty
 *
 * @param {string} text - the query
 */
function rememberDraft(text) {
  if (text.trim() === '') forget(DRAFT_KEY);
  else remember(DRAFT_KEY, text);
}

/**
 * Shows an error, listing the problems in the query with links to where they are
 *
 * @param {Error} error - the error
 * @param {object} editor - the editor, to select a problem's position
 */
function showError(error, editor) {
  renderError($('queryError'), error, (position) => editor.select(position));
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
  state.parameters = parameters;
  renderParameterFields($('parameterFields'), parameters, {
    text: state.parameterValues,
    onChange: (name, text) => state.parameterValues.set(name, text),
    idPrefix: 'parameter',
  });
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
  // Relative times (now-7d, now) are all resolved from the same moment
  const now = Date.now();
  for (const { name, type } of state.parameters) {
    try {
      values[name] = parameterValue(state.parameterValues.get(name) ?? '', type, now);
    } catch (e) {
      throw new Error(`$${name}: ${e.message}`);
    }
  }
  return values;
}

/**
 * Gets the parameter defaults to save with the query: like parameterValues, but with times kept as
 * written, so a relative time (now-7d) is saved as one
 *
 * @returns {object} the defaults by name
 * @throws {Error} if a value isn't valid for its type
 */
function parameterDefaults() {
  const defaults = {};
  for (const { name, type } of state.parameters) {
    try {
      defaults[name] = parameterDefault(state.parameterValues.get(name) ?? '', type);
    } catch (e) {
      throw new Error(`$${name}: ${e.message}`);
    }
  }
  return defaults;
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

  // A single number has no x; a donut's x is its slices; neither is split into series, and both
  // chart one value column (so the values are radio buttons rather than checkboxes)
  const oneValue = chart.type === 'stat' || chart.type === 'donut';
  $('chartXControl').hidden = chart.type === 'stat';
  $('chartXLabel').textContent = chart.type === 'donut' ? 'Slices by' : 'x axis';
  $('chartSeriesControl').hidden = oneValue;

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
  const valueColumns = columns.filter((c) => isNumericType(c.type) && (chart.type === 'stat' || c.name !== chart.x));
  $('chartYOptions').replaceChildren(...valueColumns.map((c) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = oneValue ? 'radio' : 'checkbox';
    box.name = 'chartY';
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
  const oneValue = type === 'stat' || type === 'donut';
  const wasOneValue = state.chart?.type === 'stat' || state.chart?.type === 'donut';
  if (!type) {
    state.chart = null;
  } else if (typeChanged && (!state.chart || oneValue || wasOneValue)) {
    // Start from a suggestion of this type for these columns (switching between columns and
    // lines keeps the settings, since they take the same ones)
    const suggested = state.result ? suggestChart(state.result.columns, type) : null;
    state.chart = { ...(suggested ?? { x: state.result?.columns[0]?.name ?? '', y: [], series: null }), type };
  } else {
    let y = [...$('chartYOptions').querySelectorAll('input:checked')].map((box) => box.value);
    const series = oneValue ? null : ($('chartSeries').value || null);
    // Splitting into series by a column charts one value column
    if ((series || oneValue) && y.length > 1) y = y.slice(0, 1);
    state.chart = { type, x: type === 'stat' ? null : $('chartX').value, y, series };
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
    rowLimit: $('rowLimit').value,
    shared: $('queryShared').checked,
  };
}

/**
 * Gets what to compare the current details with to tell whether a saved query has changed
 *
 * @param {object} query - the saved query
 */
function snapshotOf(query) {
  return {
    name: query.name,
    description: query.description,
    sql: query.sql,
    chart: JSON.stringify(query.chart ?? null),
    // As shown, which is the query's if it has one (see showQuery)
    rowLimit: $('rowLimit').value,
    // As shown, which is the query's if the user can change it, else private (see showQuery)
    shared: $('queryShared').checked,
  };
}

/**
 * Whether opening another query would lose changes: edits to the open saved query, or a new query
 * that has been written but not saved
 *
 * @param {object} editor - the editor
 */
function hasUnsavedChanges(editor) {
  const details = currentDetails(editor);
  if (!state.snapshot) return details.sql.trim() !== '';
  return ['name', 'description', 'sql', 'chart', 'rowLimit', 'shared'].some((key) => details[key] !== state.snapshot[key]);
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
  // A query saved with a row limit runs with it; otherwise the box keeps the user's own setting
  if (query?.rowLimit) $('rowLimit').value = query.rowLimit;
  // The box says whether saving shares the query: a new query, or a copy of someone else's, is
  // private unless the user ticks it
  $('queryShared').checked = !!query && canChange(query) && query.shared;
  state.snapshot = query ? snapshotOf(query) : null;
  state.chart = query?.chart ?? null;
  $('queryName').value = query?.name ?? '';
  $('queryDescription').value = query?.description ?? '';
  // The parameter fields are rebuilt, with the saved defaults, once the query has been validated
  $('parameterFields').replaceChildren();
  $('parameters').hidden = true;
  state.parameters = [];
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
    const query = await api(`queries/${encodeURIComponent(id)}`);
    // The user agreed to discard an unsaved query. (A link opened without asking keeps the draft,
    // for the next time the page is opened without one.)
    if (askFirst) forget(DRAFT_KEY);
    showQuery(query, editor);
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
  let limit;
  try {
    parameters = parameterDefaults();
    limit = rowLimit();
  } catch (e) {
    showError(e, editor);
    return;
  }
  const body = { ...details, chart: state.chart, parameters, rowLimit: limit };
  const inPlace = state.current && canChange(state.current) && !asNew;
  try {
    const saved = inPlace
      ? await api(`queries/${state.current.id}`, body, 'PUT')
      : await api('queries', body);
    state.current = saved;
    state.snapshot = snapshotOf(saved);
    forget(DRAFT_KEY);
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
      rememberDraft(editor.text());
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
  // Earlier versions remembered whatever was in the editor, including saved queries
  forget('query');
  const linkedId = new URLSearchParams(window.location.search).get('query');
  const editor = createEditor({
    parent: $('editor'),
    doc: linkedId ? '' : (remembered(DRAFT_KEY) ?? ''),
    example: EXAMPLE_QUERY,
    validate: (text) => api('validate', { sql: text }),
    onValidated,
    onRun: () => void run(editor),
    onChange: (text) => {
      if (!state.current) rememberDraft(text);
      updateSaveControls(editor);
    },
  });
  $('runQuery').addEventListener('click', () => void run(editor));
  initTimeHelp();
  $('rowLimit').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void run(editor);
  });
  // The user's row limit from last time, kept whenever it changes to a valid value
  const savedLimit = Number(remembered('rowLimit'));
  $('rowLimit').value = Number.isInteger(savedLimit) && savedLimit >= 1 ? savedLimit : DEFAULT_ROW_LIMIT;
  $('rowLimit').addEventListener('change', (e) => {
    const limit = Number(e.target.value);
    if (Number.isInteger(limit) && limit >= 1) remember('rowLimit', String(limit));
    updateSaveControls(editor);
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
  $('queryShared').addEventListener('change', () => updateSaveControls(editor));
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

  // A link to a saved query (?query=id) opens it; otherwise an unsaved draft from last time, if any
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
