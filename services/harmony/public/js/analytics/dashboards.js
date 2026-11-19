// The Dashboards tab of the analytics page: layouts of saved queries, each shown as its chart or as
// a table. Viewing a dashboard runs every panel's query through the analytics query service, with
// one shared value for each parameter name (e.g. a single $start for every panel).
import { chartProblem, renderChart } from './chart.js';
import { $, api, chooseAction, confirmAction, pageUser, renderError, userStorage } from './common.js';
import { renderParameterFields } from './params.js';
import { parameterValue, renderTable } from './results.js';
import { defaultToText, filterSavedList, renderSavedList } from './saved.js';

// How many panel queries to run at once. The analytics query service runs two at a time by
// default (ANALYTICS_QUERY_MAX_CONCURRENT) and turns requests away once too many are waiting.
const MAX_PARALLEL_QUERIES = 2;
// A new panel's limit is null: it runs with its query's saved row limit
const NEW_PANEL = { width: 'half', limit: null };
// The rows a panel fetches when neither it nor its query sets a limit
const DEFAULT_ROW_LIMIT = 10;

/**
 * Gets how many rows a panel fetches: its own limit, else its query's saved row limit, else the
 * default
 *
 * @param {object} panel - the panel
 * @param {object|undefined} query - its saved query
 * @returns {number} the limit
 */
const limitFor = (panel, query) => panel.limit ?? query?.rowLimit ?? DEFAULT_ROW_LIMIT;

/**
 * Gets how a query is shown by default: as its chart if it has a saved one, otherwise as a table
 *
 * @param {object|undefined} query - the saved query
 * @returns {'chart'|'table'} the display
 */
const displayFor = (query) => (query?.chart ? 'chart' : 'table');

const page = $('analytics');
const user = pageUser(page);

// Which boxes the user has collapsed, kept in this browser
const { remembered, remember } = userStorage(user.username);

/**
 * Collapses or expands a box (a [data-collapse] toggle and the body it controls)
 *
 * @param {HTMLElement} toggle - the box's toggle button
 * @param {boolean} collapsed - whether to collapse it
 */
function setCollapsed(toggle, collapsed) {
  toggle.setAttribute('aria-expanded', String(!collapsed));
  $(toggle.getAttribute('aria-controls')).hidden = collapsed;
  remember(`collapsed.${toggle.dataset.collapse}`, String(collapsed));
}

/**
 * Expands a box, e.g. so a panel just added can be seen
 *
 * @param {string} name - the box's data-collapse name
 */
function expand(name) {
  setCollapsed(document.querySelector(`[data-collapse="${name}"]`), false);
}

/**
 * Whether the user may change or delete a dashboard (the API enforces the same rule)
 */
const canChange = (dashboard) => user.isAdmin || dashboard.owner === user.username;

/**
 * Reads a color token from the page's CSS custom properties, for the charts
 */
const token = (name) => getComputedStyle(page).getPropertyValue(name).trim();

const state = {
  dashboards: [],
  // Every saved query, by id
  queries: new Map(),
  // The open dashboard as saved, or null for a new one
  current: null,
  // The dashboard as shown (and being edited): name, description and panels
  draft: null,
  // The parameter fields' text, by parameter name
  parameterText: new Map(),
  // What the draft and parameters were when last opened or saved, to tell whether there are changes
  snapshot: null,
  editing: false,
  // Each query's parameters ([{name, type}]), from validating it, by query id
  queryParameters: new Map(),
  // Results already fetched, by query, parameters and limit; cleared by Refresh
  results: new Map(),
  // Increases with every refresh, so a refresh still running when another starts stops drawing
  refreshId: 0,
};

/**
 * Runs an async function on each item, at most `limit` at a time
 *
 * @param {Array} items - the items
 * @param {number} limit - how many to run at once
 * @param {function(*, number): Promise<void>} fn - the function
 */
async function eachLimited(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Shows an error above the dashboard
 */
function showError(error) {
  renderError($('dashboardError'), error);
}

/**
 * Hides the error
 */
function clearError() {
  $('dashboardError').hidden = true;
  $('dashboardError').replaceChildren();
}

/**
 * Puts the open dashboard's id in the page URL, so the URL is a link to it
 *
 * @param {number|null} id - the id, or null for an unsaved dashboard
 */
function setUrlDashboard(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('dashboard', id);
  else url.searchParams.delete('dashboard');
  window.history.replaceState(null, '', url);
}

/**
 * Gets what to compare with to tell whether the dashboard has changed since it was opened or saved
 */
function currentSnapshot() {
  if (!state.draft) return null;
  const { name, description, panels } = state.draft;
  return JSON.stringify({ name: name.trim(), description, panels, parameters: [...state.parameterText].sort() });
}

/**
 * Whether opening something else would lose changes to the dashboard
 */
function hasUnsavedChanges() {
  if (!state.draft) return false;
  if (!state.current && state.draft.name.trim() === '' && state.draft.panels.length === 0) return false;
  return currentSnapshot() !== state.snapshot;
}

/**
 * Asks before discarding unsaved changes, if there are any
 *
 * @returns {Promise<boolean>} whether to go ahead
 */
async function okToDiscard() {
  return !hasUnsavedChanges() || confirmAction('Discard the changes to this dashboard?', 'Discard');
}

/**
 * Shows the buttons and status that apply: Edit while viewing; Save (a copy, for someone else's
 * dashboard), Save as new and Done while editing
 */
function updateControls() {
  const { current, editing, draft } = state;
  const owns = current !== null && canChange(current);
  $('noDashboard').hidden = draft !== null;
  $('dashboardView').hidden = draft === null;
  $('dashboardName').readOnly = !editing;
  $('dashboardDescription').readOnly = !editing;
  $('dashboardDescription').hidden = !editing && !draft?.description;
  $('editDashboard').hidden = editing;
  $('saveDashboard').hidden = !editing;
  $('saveDashboardLabel').textContent = current && !owns ? 'Save a copy' : 'Save';
  $('saveDashboardAsNew').hidden = !(editing && owns);
  $('cancelEdit').hidden = !editing;
  $('copyDashboardLink').hidden = !current;
  $('panelEditor').hidden = !editing;
  let status = '';
  if (hasUnsavedChanges()) status = current ? 'Unsaved changes' : 'Not saved';
  else if (current && !owns) status = `By ${current.owner}`;
  $('dashboardStatus').textContent = status;
}

/**
 * Shows the dashboards list
 */
function renderList() {
  renderSavedList($('dashboardList'), state.dashboards, {
    currentId: state.current?.id ?? null,
    canChange,
    onOpen: (dashboard) => void openDashboard(dashboard.id),
    onDelete: (dashboard) => void deleteDashboard(dashboard),
  });
  filterSavedList($('dashboardList'), $('dashboardFilter').value);
  $('dashboardsEmpty').hidden = state.dashboards.length > 0;
}

/**
 * Loads the dashboards and saved queries
 */
async function loadLists() {
  try {
    const [{ dashboards }, { queries }] = await Promise.all([api('dashboards'), api('queries')]);
    state.dashboards = dashboards;
    state.queries = new Map(queries.map((q) => [q.id, q]));
    renderList();
  } catch (e) {
    showError(e);
  }
}

/**
 * Shows the parameter fields for the parameters of the panels' queries, one per name
 *
 * @param {Map<string, string>} types - each parameter's type, by name
 */
function showParameterFields(types) {
  renderParameterFields($('dashboardParameterFields'), [...types].map(([name, type]) => ({ name, type })), {
    text: state.parameterText,
    onChange: (name, text) => {
      state.parameterText.set(name, text);
      updateControls();
    },
    idPrefix: 'dashboard-parameter',
  });
  $('dashboardParameters').hidden = types.size === 0;
  $('parametersCount').textContent = ` (${types.size})`;
}

/**
 * Gets the parameter values for one query, from the shared fields
 *
 * @param {Array<{name: string, type: string}>} parameters - the query's parameters
 * @returns {object} the values by name
 * @throws {Error} if a value isn't valid for its type
 */
function valuesFor(parameters) {
  const values = {};
  for (const { name, type } of parameters) {
    try {
      values[name] = parameterValue(state.parameterText.get(name) ?? '', type);
    } catch (e) {
      throw new Error(`$${name}: ${e.message}`);
    }
  }
  return values;
}

/**
 * Builds an empty tile for a panel, with its title and a place for its contents
 *
 * @param {object} panel - the panel
 * @param {object|undefined} query - its saved query, if it still exists
 * @returns {{tile: HTMLElement, meta: HTMLElement, body: HTMLElement}} the tile and its parts
 */
function panelTile(panel, query) {
  const tile = document.createElement('article');
  tile.className = `dashboard-tile${panel.width === 'full' ? ' is-full' : ''}`;
  const header = document.createElement('div');
  header.className = 'dashboard-tile-header';
  const title = document.createElement('h3');
  title.className = 'dashboard-tile-title';
  if (query) {
    const link = document.createElement('a');
    link.href = `/admin/analytics?query=${query.id}`;
    link.textContent = query.name;
    link.title = query.description || 'Open on the Query tab';
    title.append(link);
  } else {
    title.textContent = `Saved query ${panel.queryId}`;
  }
  const meta = document.createElement('span');
  meta.className = 'dashboard-tile-meta';
  header.append(title, meta);
  const body = document.createElement('div');
  tile.append(header, body);
  return { tile, meta, body };
}

/**
 * Shows a message in a tile
 */
function tileMessage(body, text, isError = false) {
  const p = document.createElement('p');
  p.className = `dashboard-tile-message${isError ? ' is-error' : ''}`;
  p.textContent = text;
  body.replaceChildren(p);
}

/**
 * Shows a panel's result as its chart, or as a table
 *
 * @param {HTMLElement} body - the tile's body
 * @param {object} panel - the panel
 * @param {object} query - its saved query
 * @param {object} result - the query result
 */
function renderPanelResult(body, panel, query, result) {
  const table = () => {
    const wrap = document.createElement('div');
    wrap.className = 'results-table-wrap';
    const t = document.createElement('table');
    t.className = 'table table-sm results-table';
    renderTable(t, result);
    wrap.append(t);
    return wrap;
  };
  body.replaceChildren();
  if (panel.display === 'chart') {
    const problem = !query.chart
      ? 'This query has no saved chart (add one on the Query tab), so it is shown as a table.'
      : chartProblem(query.chart, result.columns);
    if (!problem) {
      const card = document.createElement('div');
      card.className = 'viz-card';
      body.append(card);
      // The tile's header shows the name, so the card's own title is hidden (see analytics.css), but
      // it still labels the chart for screen readers
      const drawProblem = renderChart(card, result, query.chart, { title: query.name, color: token });
      if (!drawProblem) return;
      body.replaceChildren();
      tileMessage(body, `Can't chart this: ${drawProblem}`);
    } else {
      tileMessage(body, problem.startsWith('This query') ? problem : `Can't chart this: ${problem}`);
    }
    body.append(table());
    return;
  }
  body.append(table());
}

/**
 * Validates each of the panels' queries, to learn their parameters
 *
 * @param {Array<object>} queries - the saved queries
 * @returns {Promise<Map<number, string>>} the problem with each query that isn't valid, by id
 */
async function learnParameters(queries) {
  const problems = new Map();
  await eachLimited(queries.filter((q) => !state.queryParameters.has(q.id)), MAX_PARALLEL_QUERIES, async (query) => {
    const validation = await api('validate', { sql: query.sql });
    if (validation.valid) {
      state.queryParameters.set(query.id, validation.parameters);
    } else {
      problems.set(query.id, validation.errors.map((e) => e.message).join('; '));
    }
  });
  return problems;
}

/**
 * Runs every panel's query and shows the results. Results already fetched for the same query,
 * parameters and limit are reused unless `force` is set.
 *
 * @param {boolean} [force] - whether to run every query again
 */
async function refresh(force = false) {
  const refreshId = ++state.refreshId;
  const stale = () => refreshId !== state.refreshId;
  if (force) {
    state.results.clear();
    state.queryParameters.clear();
  }
  clearError();
  const { panels } = state.draft;
  const grid = $('dashboardGrid');
  const tiles = panels.map((panel) => panelTile(panel, state.queries.get(panel.queryId)));
  grid.replaceChildren(...tiles.map((t) => t.tile));
  if (panels.length === 0) {
    $('dashboardParameters').hidden = true;
    $('refreshStatus').textContent = '';
    if (!state.editing) {
      const empty = document.createElement('p');
      empty.className = 'dashboard-empty';
      empty.textContent = 'This dashboard has no panels yet - select Edit to add some.';
      grid.replaceChildren(empty);
    }
    return;
  }

  const queries = [...new Set(panels.map((p) => p.queryId))].map((id) => state.queries.get(id)).filter(Boolean);
  let invalid;
  try {
    $('refreshStatus').textContent = 'Checking the queries…';
    invalid = await learnParameters(queries);
  } catch (e) {
    if (!stale()) showError(e);
    return;
  }
  if (stale()) return;

  // One field per parameter name, filled from the dashboard's values or else the first query's default
  const types = new Map();
  for (const query of queries) {
    for (const { name, type } of state.queryParameters.get(query.id) ?? []) {
      if (!types.has(name)) types.set(name, type);
      if (!state.parameterText.has(name) && query.parameters?.[name] !== undefined) {
        state.parameterText.set(name, defaultToText(query.parameters[name]));
      }
    }
  }
  showParameterFields(types);
  updateControls();

  let done = 0;
  $('refreshStatus').textContent = `Running ${panels.length} panel${panels.length === 1 ? '' : 's'}…`;
  await eachLimited(panels, MAX_PARALLEL_QUERIES, async (panel, i) => {
    const { meta, body } = tiles[i];
    const query = state.queries.get(panel.queryId);
    // Every panel counts towards "Ran n of N", however it ends, so the status reaches "Updated"
    try {
      if (!query) {
        tileMessage(body, `Saved query ${panel.queryId} no longer exists. Edit the dashboard to remove this panel.`, true);
        return;
      }
      if (invalid.has(query.id)) {
        tileMessage(body, `This query is no longer valid: ${invalid.get(query.id)}`, true);
        return;
      }
      tileMessage(body, 'Running…');
      const params = valuesFor(state.queryParameters.get(query.id) ?? []);
      const limit = limitFor(panel, query);
      const key = JSON.stringify([query.id, query.updatedAt, params, limit]);
      if (!state.results.has(key)) {
        state.results.set(key, await api('query', { sql: query.sql, params, limit }));
      }
      if (stale()) return;
      const result = state.results.get(key);
      meta.textContent = `${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? '' : 's'}`
        + `${result.truncated ? ` (limit ${limit.toLocaleString()})` : ''}`;
      meta.title = result.truncated ? 'The query has more rows than this panel\'s limit; edit the dashboard to raise it' : '';
      renderPanelResult(body, panel, query, result);
    } catch (e) {
      if (!stale()) tileMessage(body, e.message, true);
    } finally {
      done += 1;
      if (!stale()) {
        $('refreshStatus').textContent = done < panels.length
          ? `Ran ${done} of ${panels.length} panels…` : `Updated ${new Date().toLocaleTimeString()}`;
      }
    }
  });
}

/**
 * Shows the panel editor's rows, one per panel
 */
function renderPanelEditor() {
  const list = $('panelEditorList');
  const { panels } = state.draft;
  const queries = [...state.queries.values()].sort((a, b) => a.name.localeCompare(b.name));
  // Redraws reuse results already fetched, so only a new query or limit runs anything
  const changed = () => {
    renderPanelEditor();
    updateControls();
    void refresh();
  };
  const select = (label, value, options, onChange, className = '') => {
    const el = document.createElement('select');
    el.className = `form-control form-control-sm w-auto ${className}`;
    el.setAttribute('aria-label', label);
    for (const [v, text] of options) el.append(new Option(text, v, false, String(v) === String(value)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };
  const button = (icon, label, onClick, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline-secondary panel-move';
    b.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  };

  list.replaceChildren(...panels.map((panel, i) => {
    const row = document.createElement('tr');
    const cell = (...children) => {
      const td = document.createElement('td');
      td.append(...children);
      return td;
    };
    const queryOptions = queries.map((q) => [q.id, `${q.name} (${q.owner})`]);
    if (!state.queries.has(panel.queryId)) queryOptions.unshift([panel.queryId, `Deleted query ${panel.queryId}`]);
    const limit = document.createElement('input');
    limit.type = 'number';
    limit.min = '1';
    limit.step = '1';
    limit.className = 'form-control form-control-sm panel-limit';
    // Blank follows the query's row limit, which the placeholder shows
    const queryLimit = state.queries.get(panel.queryId)?.rowLimit ?? DEFAULT_ROW_LIMIT;
    limit.value = panel.limit ?? '';
    limit.placeholder = String(queryLimit);
    limit.title = `Leave blank to use the query's row limit (${queryLimit.toLocaleString()})`;
    limit.setAttribute('aria-label', `Panel ${i + 1} max rows (blank for the query's, ${queryLimit})`);
    limit.addEventListener('change', () => {
      const n = Number(limit.value);
      if (limit.value.trim() === '') {
        panel.limit = null;
        changed();
      } else if (Number.isInteger(n) && n >= 1) {
        panel.limit = n;
        changed();
      } else {
        limit.value = panel.limit ?? '';
      }
    });
    const query = state.queries.get(panel.queryId);
    const displaySelect = select(`Panel ${i + 1} display`, panel.display, [['chart', 'Chart'], ['table', 'Table']],
      (v) => { panel.display = v; changed(); });
    if (query && !query.chart) {
      // Nothing to chart: the query has no saved chart (add one on the Query tab)
      const chartOption = displaySelect.querySelector('option[value="chart"]');
      chartOption.disabled = true;
      chartOption.textContent = 'Chart (none saved)';
    }
    const number = cell(`${i + 1}.`);
    number.className = 'panel-number';
    const order = document.createElement('div');
    order.className = 'panel-order';
    order.append(
      button('bi-arrow-up', `Move panel ${i + 1} up`, () => { [panels[i - 1], panels[i]] = [panels[i], panels[i - 1]]; changed(); }, i === 0),
      button('bi-arrow-down', `Move panel ${i + 1} down`, () => { [panels[i], panels[i + 1]] = [panels[i + 1], panels[i]]; changed(); }, i === panels.length - 1),
      button('bi-x-lg', `Remove panel ${i + 1}`, () => { panels.splice(i, 1); changed(); }),
    );
    row.append(
      number,
      cell(select(`Panel ${i + 1} query`, panel.queryId, queryOptions, (v) => {
        panel.queryId = Number(v);
        panel.display = displayFor(state.queries.get(panel.queryId));
        changed();
      }, 'panel-query')),
      cell(displaySelect),
      cell(select(`Panel ${i + 1} width`, panel.width, [['half', 'Half'], ['full', 'Full']], (v) => { panel.width = v; changed(); })),
      cell(limit),
      cell(order),
    );
    return row;
  }));
  // The header row alone would just be headings over nothing
  $('panelEditorTable').hidden = panels.length === 0;
  $('panelEditorEmpty').hidden = panels.length > 0;
  $('panelsCount').textContent = ` (${panels.length})`;
  $('addPanel').disabled = state.queries.size === 0;
  $('addPanel').title = state.queries.size === 0 ? 'Save a query on the Query tab first' : '';
}

/**
 * Shows a dashboard, or a new empty one
 *
 * @param {object|null} dashboard - the saved dashboard, or null for a new one
 * @param {boolean} editing - whether to start in edit mode
 */
function showDashboard(dashboard, editing) {
  state.current = dashboard;
  state.editing = editing;
  state.draft = {
    name: dashboard?.name ?? '',
    description: dashboard?.description ?? '',
    // A panel saved as a chart of a query that has no saved chart is drawn as a table, so it is
    // shown as one (before the snapshot, so this alone isn't an unsaved change)
    panels: (dashboard?.panels ?? []).map((p) => {
      const query = state.queries.get(p.queryId);
      return { ...p, display: query && !query.chart ? 'table' : p.display };
    }),
  };
  state.parameterText = new Map(Object.entries(dashboard?.parameters ?? {}).map(([k, v]) => [k, defaultToText(v)]));
  state.snapshot = currentSnapshot();
  $('dashboardName').value = state.draft.name;
  $('dashboardDescription').value = state.draft.description;
  $('dashboardParameterFields').replaceChildren();
  setUrlDashboard(dashboard?.id ?? null);
  clearError();
  renderList();
  renderPanelEditor();
  updateControls();
  void refresh();
}

/**
 * Opens a saved dashboard
 *
 * @param {number|string} id - its id
 * @param {boolean} [askFirst] - whether to ask before losing unsaved changes
 */
async function openDashboard(id, askFirst = true) {
  if (askFirst && !(await okToDiscard())) return;
  try {
    showDashboard(await api(`dashboards/${encodeURIComponent(id)}`), false);
  } catch (e) {
    showError(e);
  }
}

/**
 * Saves the dashboard, with the parameter values entered as its own
 *
 * @param {boolean} asNew - whether to save a new dashboard even if the user owns the open one
 * @returns {Promise<boolean>} whether it was saved
 */
async function save(asNew) {
  clearError();
  const name = state.draft.name.trim();
  if (!name) {
    $('dashboardStatus').textContent = 'Give the dashboard a name to save it';
    $('dashboardName').focus();
    return false;
  }
  // Only the parameters the panels use now are kept
  const parameters = {};
  const types = new Map();
  for (const query of state.draft.panels.map((p) => state.queries.get(p.queryId)).filter(Boolean)) {
    for (const { name: p, type } of state.queryParameters.get(query.id) ?? []) types.set(p, type);
  }
  try {
    for (const [p, type] of types) parameters[p] = parameterValue(state.parameterText.get(p) ?? '', type);
  } catch (e) {
    showError(e);
    return false;
  }
  const body = { name, description: state.draft.description, panels: state.draft.panels, parameters };
  const inPlace = state.current && canChange(state.current) && !asNew;
  try {
    const saved = inPlace
      ? await api(`dashboards/${state.current.id}`, body, 'PUT')
      : await api('dashboards', body);
    state.current = saved;
    state.snapshot = currentSnapshot();
    setUrlDashboard(saved.id);
    await loadLists();
    updateControls();
    $('dashboardStatus').textContent = 'Saved';
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}

/**
 * Stops editing. With unsaved changes, asks whether to save them, discard them (back to the
 * dashboard as last saved, or closing a new one that was never saved), or keep editing.
 */
async function cancelEditing() {
  const stop = () => {
    state.editing = false;
    updateControls();
    void refresh();
  };
  if (!hasUnsavedChanges()) {
    stop();
    return;
  }
  const choice = await chooseAction('Save your changes to this dashboard?', [
    { value: 'keep', label: 'Keep editing' },
    { value: 'discard', label: 'Discard changes', className: 'btn-outline-danger' },
    { value: 'save', label: $('saveDashboardLabel').textContent, className: 'btn-primary' },
  ]);
  if (choice === 'save') {
    if (await save(false)) stop();
  } else if (choice === 'discard') {
    if (state.current) {
      showDashboard(state.current, false);
    } else {
      // A new dashboard that was never saved: there is nothing to go back to
      state.draft = null;
      state.snapshot = null;
      state.editing = false;
      $('dashboardGrid').replaceChildren();
      updateControls();
    }
  }
  // 'keep', or the dialog closed with Escape: carry on editing
}

/**
 * Deletes a dashboard, after asking
 *
 * @param {object} dashboard - the dashboard
 */
async function deleteDashboard(dashboard) {
  const message = `Delete the dashboard "${dashboard.name}"? Its saved queries are not deleted. This can't be undone.`;
  if (!(await confirmAction(message, 'Delete'))) return;
  try {
    await api(`dashboards/${dashboard.id}`, undefined, 'DELETE');
    if (state.current?.id === dashboard.id) {
      state.current = null;
      state.draft = null;
      state.snapshot = null;
      setUrlDashboard(null);
      $('dashboardGrid').replaceChildren();
    }
    await loadLists();
    updateControls();
  } catch (e) {
    showError(e);
  }
}

/**
 * Sets up the page
 */
async function init() {
  for (const toggle of document.querySelectorAll('[data-collapse]')) {
    setCollapsed(toggle, remembered(`collapsed.${toggle.dataset.collapse}`) === 'true');
    toggle.addEventListener('click', () => setCollapsed(toggle, toggle.getAttribute('aria-expanded') === 'true'));
  }
  $('dashboardName').addEventListener('input', (e) => {
    state.draft.name = e.target.value;
    updateControls();
  });
  $('dashboardDescription').addEventListener('input', (e) => {
    state.draft.description = e.target.value;
    updateControls();
  });
  $('dashboardDetails').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.editing) void save(false);
  });
  $('saveDashboardAsNew').addEventListener('click', () => void save(true));
  $('editDashboard').addEventListener('click', () => {
    state.editing = true;
    renderPanelEditor();
    updateControls();
    if (state.draft.panels.length === 0) void refresh();
  });
  $('cancelEdit').addEventListener('click', () => void cancelEditing());
  $('addPanel').addEventListener('click', () => {
    const first = [...state.queries.values()].sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!first) return;
    state.draft.panels.push({ queryId: first.id, display: displayFor(first), ...NEW_PANEL });
    expand('panels');
    renderPanelEditor();
    updateControls();
    void refresh();
  });
  $('newDashboard').addEventListener('click', async () => {
    if (!(await okToDiscard())) return;
    showDashboard(null, true);
    $('dashboardName').focus();
  });
  $('dashboardFilter').addEventListener('input', (e) => filterSavedList($('dashboardList'), e.target.value));
  // Enter in a parameter field applies the changes, rerunning only the panels they affect. (The box
  // has no submit button, without which a form with several fields isn't submitted by Enter.)
  $('dashboardParameters').addEventListener('submit', (e) => {
    e.preventDefault();
    void refresh();
  });
  $('dashboardParameters').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      void refresh();
    }
  });
  $('refreshDashboard').addEventListener('click', () => void refresh(true));
  $('copyDashboardLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      $('dashboardStatus').textContent = 'Link copied';
    } catch {
      $('dashboardStatus').textContent = 'Copy the link from the address bar';
    }
  });

  updateControls();
  await loadLists();
  // A link to a dashboard (?dashboard=id) opens it
  const linkedId = new URLSearchParams(window.location.search).get('dashboard');
  if (linkedId) await openDashboard(linkedId, false);
}

void init();
