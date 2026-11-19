// The Dashboards tab of the analytics page: layouts of saved queries, each shown as its chart or as
// a table. Viewing a dashboard runs every panel's query through the analytics query service.
//
// Each parameter of a panel's query takes the panel's own value if it has one, else the
// dashboard's value for all panels, else the value saved with the query. The Parameters box shows
// either level, chosen with its "For" menu or by selecting a panel. Values changed while not
// editing apply until the page is reloaded; they're saved only by editing and saving the dashboard.
import { chartProblem, renderChart } from './chart.js';
import { $, api, chooseAction, confirmAction, pageUser, renderError, userStorage } from './common.js';
import { renderParameterFields } from './params.js';
import { parameterDefault, parameterValue, renderTable } from './results.js';
import { defaultToText, filterSavedList, renderSavedList } from './saved.js';
import { initTimeHelp } from './timehelp.js';
import { describeParameter, interpolateTitle, titleVariables } from './titles.js';

// How many panel queries to run at once. The analytics query service runs two at a time by
// default (ANALYTICS_QUERY_MAX_CONCURRENT) and turns requests away once too many are waiting.
const MAX_PARALLEL_QUERIES = 2;
/**
 * A new panel for a query: half width, titled with the query's name, and with the query's row
 * limit and parameter values
 */
const newPanel = (query) => ({
  queryId: query.id, title: '', display: query.chart ? 'chart' : 'table', width: 'half', limit: null, parameters: {},
});
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
  // The dashboard as shown (and being edited): name, description and panels. Each panel's
  // parameters are its own values, as written, by name.
  draft: null,
  // The dashboard's values for all panels, as written, by name
  allText: new Map(),
  // The panel whose parameters the Parameters box shows, or null for all panels
  selected: null,
  // As saved, for marking the values that have been changed: the values for all panels, and each
  // shown panel's saved version (none for a panel added since)
  savedAllText: new Map(),
  savedPanels: new WeakMap(),
  // The tiles drawn, with their panels
  tiles: [],
  // What the draft was when last opened or saved, to tell whether there are changes
  snapshot: null,
  editing: false,
  // Whether the dashboard has just been saved, to say so until it is edited again
  justSaved: false,
  // Each query's parameters ([{name, type}]), from validating it, by query id
  queryParameters: new Map(),
  // Results already fetched, by query, parameters and limit; cleared by Refresh
  results: new Map(),
  // Increases with every refresh, so a refresh still running when another starts stops drawing
  refreshId: 0,
  // The moment relative times (now-7d) are resolved from: set when the dashboard is opened or
  // refreshed, and kept while it is only redrawn (e.g. a panel moved), so results can be reused
  resolvedAt: null,
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
  const set = (entries) => entries.filter(([, text]) => text.trim() !== '').sort();
  return JSON.stringify({
    name: name.trim(),
    description,
    panels: panels.map((p) => ({ ...p, title: p.title.trim(), parameters: set(Object.entries(p.parameters)) })),
    all: set([...state.allText]),
  });
}

/**
 * Whether opening something else would lose changes to the dashboard. Only edits count: values
 * changed while viewing are meant to last only until the page is left.
 */
function hasUnsavedChanges() {
  if (!state.draft || !state.editing) return false;
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
  else if (state.justSaved) status = 'Saved';
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
 * Gets a panel's query's parameters ([] until the query has been validated)
 */
const parametersOf = (panel) => state.queryParameters.get(panel.queryId) ?? [];

/**
 * Converts a dashboard's saved panel to how it is shown and edited: its title and parameter values
 * as text
 */
const textPanel = (panel) => ({
  ...panel,
  title: panel.title ?? '',
  parameters: Object.fromEntries(Object.entries(panel.parameters ?? {}).map(([k, v]) => [k, defaultToText(v)])),
});

const LEVEL_NAMES = { panel: 'Panel', all: 'All panels', query: 'Query', none: 'Not set' };

/**
 * Gets the value one of a panel's parameters takes: the panel's own, else the dashboard's for all
 * panels, else the one saved with the query
 *
 * @param {object} panel - the panel (as shown, see textPanel)
 * @param {Map<string, string>} allText - the dashboard's values for all panels
 * @param {string} name - the parameter
 * @returns {{text: string, level: 'panel'|'all'|'query'|'none'}} the value as written ('' for
 *   NULL), and where it comes from
 */
function valueOf(panel, allText, name) {
  const own = panel.parameters[name] ?? '';
  if (own.trim() !== '') return { text: own, level: 'panel' };
  const all = allText.get(name) ?? '';
  if (all.trim() !== '') return { text: all, level: 'all' };
  const saved = state.queries.get(panel.queryId)?.parameters?.[name];
  if (saved !== undefined) return { text: defaultToText(saved), level: 'query' };
  return { text: '', level: 'none' };
}

/**
 * Gets the values to run a panel's query with
 *
 * @param {object} panel - the panel
 * @returns {object} the values by name
 * @throws {Error} if a value isn't valid for its type
 */
function valuesFor(panel) {
  const values = {};
  for (const { name, type } of parametersOf(panel)) {
    try {
      values[name] = parameterValue(valueOf(panel, state.allText, name).text, type, state.resolvedAt);
    } catch (e) {
      throw new Error(`$${name}: ${e.message}`);
    }
  }
  return values;
}

/**
 * Gets a panel's title: its own, with its parameter values filled in (see titles.js), or else its
 * query's name
 */
function titleOf(panel, query) {
  if (!panel.title.trim()) return query?.name ?? `Saved query ${panel.queryId}`;
  return interpolateTitle(panel.title.trim(), parametersOf(panel), (name) => valueOf(panel, state.allText, name).text);
}

/**
 * Selects the panel whose parameters the Parameters box shows (null for all panels)
 */
function selectPanel(panel) {
  state.selected = panel;
  for (const { tile, panel: p } of state.tiles) tile.classList.toggle('is-selected', p === panel);
  showParameterFields();
}

/**
 * Shows the parameter fields: for the selected panel, its query's parameters, empty unless the
 * panel sets its own value; for all panels, every name the panels' queries use
 */
function showParameterFields() {
  const { panels } = state.draft;
  if (state.selected && !panels.includes(state.selected)) state.selected = null;
  const { selected } = state;
  const withParameters = panels.filter((p) => parametersOf(p).length > 0);
  $('dashboardParameters').hidden = withParameters.length === 0;
  if (withParameters.length === 0) return;

  const scope = $('parameterScope');
  scope.replaceChildren(new Option('All panels', 'all'), ...withParameters.map((p) => {
    const i = panels.indexOf(p);
    return new Option(`Panel ${i + 1}: ${titleOf(p, state.queries.get(p.queryId))}`, String(i));
  }));
  scope.value = selected ? String(panels.indexOf(selected)) : 'all';

  let parameters;
  let text;
  const inherited = new Map();
  if (selected) {
    parameters = parametersOf(selected);
    text = new Map(Object.entries(selected.parameters));
    for (const { name } of parameters) {
      const { text: value, level } = valueOf({ ...selected, parameters: {} }, state.allText, name);
      inherited.set(name, { text: value, source: LEVEL_NAMES[level] });
    }
    $('parameterScopeHelp').textContent = 'Values for this panel only. Leave a field empty to use the value for all '
      + 'panels, or else the query\'s.';
  } else {
    const types = new Map();
    for (const p of withParameters) for (const { name, type } of parametersOf(p)) if (!types.has(name)) types.set(name, type);
    parameters = [...types].map(([name, type]) => ({ name, type }));
    text = state.allText;
    for (const { name } of parameters) {
      // An empty field leaves each panel its query's value: one value if they all agree
      const own = new Set(withParameters.filter((p) => parametersOf(p).some((q) => q.name === name))
        .map((p) => valueOf({ ...p, parameters: {} }, new Map(), name).text));
      inherited.set(name, own.size === 1 ? { text: [...own][0], source: 'Query' } : { text: null, source: 'Each query\'s own' });
    }
    $('parameterScopeHelp').textContent = 'Values for every panel that doesn\'t set its own. Leave a field empty to '
      + 'use each query\'s.';
  }
  renderParameterFields($('dashboardParameterFields'), parameters, {
    text,
    inherited,
    onChange: (name, value) => {
      if (selected) {
        if (value.trim() === '') delete selected.parameters[name];
        else selected.parameters[name] = value;
      } else {
        state.allText.set(name, value);
      }
      updateControls();
    },
    idPrefix: 'dashboard-parameter',
    now: () => state.resolvedAt ?? Date.now(),
  });
  $('parametersCount').textContent = selected ? ` (panel ${panels.indexOf(selected) + 1})` : ` (${parameters.length})`;
}

/**
 * Lists a panel's parameter values for its tile: all of them, for the tooltip, and the ones to point
 * out - those changed from the dashboard as saved, and those set for all panels
 *
 * @param {object} panel - the panel
 * @returns {{all: string[], marked: string[]}} the lines
 */
function tileParameters(panel) {
  const saved = state.savedPanels.get(panel);
  const all = [];
  const marked = [];
  for (const { name, type } of parametersOf(panel)) {
    const { text, level } = valueOf(panel, state.allText, name);
    const shown = text.trim() || 'NULL';
    all.push(`$${name} = ${shown} (${LEVEL_NAMES[level].toLowerCase()})`);
    const changed = saved && valueOf(saved, state.savedAllText, name).text !== text;
    if (changed || level === 'all') {
      const words = describeParameter(text, type);
      marked.push(`$${name}: ${shown}${words !== shown ? ` (${words})` : ''}, ${changed ? 'changed' : 'for all panels'}`);
    }
  }
  return { all, marked };
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
  tile.classList.toggle('is-selected', panel === state.selected);
  const header = document.createElement('div');
  header.className = 'dashboard-tile-header';
  const title = document.createElement('h3');
  title.className = 'dashboard-tile-title';
  const meta = document.createElement('span');
  meta.className = 'dashboard-tile-meta';
  // Selects the panel, to show its parameters (as does clicking anywhere else on the tile)
  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'btn btn-sm btn-link p-0 dashboard-tile-select';
  select.innerHTML = '<i class="bi bi-sliders" aria-hidden="true"></i>';
  select.addEventListener('click', () => {
    expand('parameters');
    selectPanel(panel);
  });
  header.append(title, meta, select);
  const parameters = document.createElement('p');
  parameters.className = 'dashboard-tile-parameters';
  const body = document.createElement('div');
  tile.append(header, parameters, body);
  tile.addEventListener('click', (e) => {
    if (!e.target.closest('a, button, input, select, summary')) selectPanel(panel);
  });

  // The header, again once the query's parameters are known
  const fillHeader = () => {
    const text = titleOf(panel, query);
    if (query) {
      const link = document.createElement('a');
      link.href = `/admin/analytics?query=${query.id}`;
      link.textContent = text;
      link.title = `Saved query: ${query.name}${query.description ? ` - ${query.description}` : ''}`;
      title.replaceChildren(link);
    } else {
      title.textContent = text;
    }
    const { all, marked } = tileParameters(panel);
    select.hidden = all.length === 0;
    select.title = ['Parameters (select to change):', ...all].join('\n');
    select.setAttribute('aria-label', `Panel parameters: ${all.join('; ')}`);
    parameters.textContent = marked.join(' · ');
    parameters.hidden = marked.length === 0;
  };
  fillHeader();
  return { tile, meta, body, fillHeader };
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
      const drawProblem = renderChart(card, result, query.chart, { title: titleOf(panel, query), color: token });
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
  if (force || state.resolvedAt === null) state.resolvedAt = Date.now();
  clearError();
  const { panels } = state.draft;
  const grid = $('dashboardGrid');
  const tiles = panels.map((panel) => panelTile(panel, state.queries.get(panel.queryId)));
  state.tiles = tiles.map((t, i) => ({ tile: t.tile, panel: panels[i], fillHeader: t.fillHeader }));
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
    const known = state.queryParameters.size;
    invalid = await learnParameters(queries);
    // The title hints list each query's parameters
    if (state.editing && state.queryParameters.size !== known && !stale()) renderPanelEditor();
  } catch (e) {
    if (!stale()) showError(e);
    return;
  }
  if (stale()) return;

  // Titles and values can be shown now the queries' parameters are known
  for (const t of tiles) t.fillHeader();
  showParameterFields();
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
      const params = valuesFor(panel);
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
    // Blank uses the query's name, which the placeholder shows
    const title = document.createElement('input');
    title.type = 'text';
    title.className = 'form-control form-control-sm panel-title';
    title.maxLength = 255;
    title.value = panel.title;
    title.placeholder = query?.name ?? 'Title';
    title.setAttribute('aria-label', `Panel ${i + 1} title (blank for the query's name)`);
    // Under the title: the variables it can use, and any it uses that its query doesn't have
    const hint = document.createElement('div');
    hint.className = 'panel-title-hint';
    hint.id = `panel-title-hint-${i}`;
    title.setAttribute('aria-describedby', `${hint.id} panelTitleHelp`);
    const showHint = () => {
      const parameters = parametersOf(panel);
      const missing = titleVariables(title.value, parameters);
      const available = parameters.map((p) => `$${p.name}`);
      if (titleVariables('$__range', parameters).length === 0) available.push('$__range');
      hint.classList.toggle('is-invalid', missing.length > 0);
      hint.textContent = [
        missing.length > 0 ? `Not filled in: ${missing.join(', ')}.` : '',
        available.length > 0 ? `Can use ${available.join(', ')}` : 'This query has no parameters to use.',
      ].filter(Boolean).join(' ');
    };
    showHint();
    title.addEventListener('input', () => {
      panel.title = title.value;
      showHint();
      state.tiles.find((t) => t.panel === panel)?.fillHeader();
      updateControls();
    });
    title.addEventListener('change', () => {
      panel.title = title.value;
      changed();
    });
    const number = cell(`${i + 1}.`);
    number.className = 'panel-number';
    const order = document.createElement('div');
    order.className = 'panel-order';
    if (parametersOf(panel).length > 0) {
      order.append(button('bi-sliders', `Panel ${i + 1} parameters`, () => {
        expand('parameters');
        selectPanel(panel);
      }));
    }
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
      cell(title, hint),
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
 * Records the dashboard as shown as the saved version: to tell whether there are unsaved changes,
 * and which values have been changed since
 */
function rememberSaved() {
  state.snapshot = currentSnapshot();
  state.savedAllText = new Map(state.allText);
  state.savedPanels = new WeakMap(state.draft.panels.map((p) => [p, { ...p, parameters: { ...p.parameters } }]));
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
  state.justSaved = false;
  state.resolvedAt = null;
  state.draft = {
    name: dashboard?.name ?? '',
    description: dashboard?.description ?? '',
    // A panel saved as a chart of a query that has no saved chart is drawn as a table, so it is
    // shown as one (before the snapshot, so this alone isn't an unsaved change)
    panels: (dashboard?.panels ?? []).map((p) => {
      const query = state.queries.get(p.queryId);
      return { ...textPanel(p), display: query && !query.chart ? 'table' : p.display };
    }),
  };
  state.allText = new Map(Object.entries(dashboard?.parameters ?? {}).map(([k, v]) => [k, defaultToText(v)]));
  state.selected = null;
  rememberSaved();
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
  // Only the values that are set, for parameters the panels' queries have now, are kept. Times are
  // kept as written, so a relative time (now-7d) is saved as one.
  const valuesToSave = (text, parameters, where) => {
    const values = {};
    for (const { name: p, type } of parameters) {
      const value = text.get(p) ?? '';
      if (value.trim() !== '') {
        try {
          values[p] = parameterDefault(value, type);
        } catch (e) {
          throw new Error(`${where} $${p}: ${e.message}`);
        }
      }
    }
    return values;
  };
  let panels;
  let parameters;
  try {
    panels = state.draft.panels.map((p, i) => ({
      ...p,
      title: p.title.trim() || null,
      parameters: valuesToSave(new Map(Object.entries(p.parameters)), parametersOf(p), `Panel ${i + 1}:`),
    }));
    const types = new Map(state.draft.panels.flatMap((p) => parametersOf(p).map((q) => [q.name, q])));
    parameters = valuesToSave(state.allText, [...types.values()], 'All panels:');
  } catch (e) {
    showError(e);
    return false;
  }
  const body = { name, description: state.draft.description, panels, parameters };
  const inPlace = state.current && canChange(state.current) && !asNew;
  try {
    const saved = inPlace
      ? await api(`dashboards/${state.current.id}`, body, 'PUT')
      : await api('dashboards', body);
    state.current = saved;
    rememberSaved();
    setUrlDashboard(saved.id);
    await loadLists();
    state.justSaved = true;
    updateControls();
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}

/**
 * Closes the editor, back to viewing the dashboard
 */
function stopEditing() {
  state.editing = false;
  updateControls();
  void refresh();
}

/**
 * Stops editing. With unsaved changes, asks whether to save them, discard them (back to the
 * dashboard as last saved, or closing a new one that was never saved), or keep editing.
 */
async function cancelEditing() {
  if (!hasUnsavedChanges()) {
    stopEditing();
    return;
  }
  const choice = await chooseAction('Save your changes to this dashboard?', [
    { value: 'keep', label: 'Keep editing' },
    { value: 'discard', label: 'Discard changes', className: 'btn-outline-danger' },
    { value: 'save', label: $('saveDashboardLabel').textContent, className: 'btn-primary' },
  ]);
  if (choice === 'save') {
    if (await save(false)) stopEditing();
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
  // Saving (in place, a copy, or as new) closes the editor; if it fails, editing carries on
  const saveAndClose = async (asNew) => {
    if (await save(asNew)) stopEditing();
  };
  $('dashboardDetails').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.editing) void saveAndClose(false);
  });
  $('saveDashboardAsNew').addEventListener('click', () => void saveAndClose(true));
  $('editDashboard').addEventListener('click', () => {
    state.editing = true;
    state.justSaved = false;
    renderPanelEditor();
    updateControls();
    if (state.draft.panels.length === 0) void refresh();
  });
  $('cancelEdit').addEventListener('click', () => void cancelEditing());
  $('addPanel').addEventListener('click', () => {
    const first = [...state.queries.values()].sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!first) return;
    state.draft.panels.push(newPanel(first));
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
  initTimeHelp();
  $('parameterScope').addEventListener('change', (e) => {
    selectPanel(e.target.value === 'all' ? null : state.draft.panels[Number(e.target.value)]);
  });
  // Enter in a parameter field applies the changes, rerunning only the panels they affect. (The box
  // has no submit button, without which a form with several fields isn't submitted by Enter.)
  // Relative times (now-7d) are still worked out from when the dashboard was opened or refreshed,
  // so every panel shares one "now" and the panels whose values didn't change aren't run again.
  const applyParameters = () => void refresh();
  $('dashboardParameters').addEventListener('submit', (e) => {
    e.preventDefault();
    applyParameters();
  });
  $('dashboardParameters').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      applyParameters();
    }
  });
  // Refresh first reloads the saved queries, so it shows any saved since the page was opened (e.g.
  // in another browser tab), with their SQL, chart, row limit and parameter values
  const reloadAndRefresh = async () => {
    await loadLists();
    if (!state.draft) return;
    if (state.editing) renderPanelEditor();
    await refresh(true);
  };
  $('refreshDashboard').addEventListener('click', () => void reloadAndRefresh());
  // Coming back with the Back button can show the page as it was, from the browser's cache
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void reloadAndRefresh();
  });
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
