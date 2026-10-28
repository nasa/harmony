// The admin dashboard page. All data comes from the dashboard API (/admin/dashboard/api/*), which
// reads only aggregate tables, and every view is scoped by the time range filter at the top.

import {
  chartCard, columnChart, h, legend, lineChart, niceDurationStep, sparkline, table,
} from './charts.js';
import {
  describeBucket, describeSpan, formatAgo, formatCompact, formatComputeTime, formatCount, formatDateTime,
  formatDuration, formatPercent, formatRange, formatRate, formatSize, formatTimeLabel,
} from './format.js';

const API = '/admin/dashboard/api';
// the version of the dashboard API's response formats this page is written against
const API_VERSION = '1';
const PRESETS = ['1h', '6h', '24h', '7d', '30d', '90d'];
const DEFAULT_PRESET = '24h';
const REFRESH_OPTIONS = [0, 30, 60, 300];
// stats older than this mean the cron job that updates them may not be running
const STALE_STATS_MS = 5 * 60000;
const DURATION_BUCKET_LABELS = ['< 1 s', '1–5 s', '5–15 s', '15 s–1 min', '1–5 min', '5–15 min', '15 min–1 h', '≥ 1 h'];

const root = document.getElementById('dashboard');

/**
 * Reads a color token from the dashboard's CSS custom properties
 * @param {string} name - the custom property name
 * @returns {string} the color
 */
function token(name) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

// Status colors are reserved for state and always appear with a label (legend, tooltip, table)
const STATUS_SERIES = [
  { key: 'successful', label: 'Successful', color: token('--viz-status-good') },
  { key: 'warning', label: 'Warning', color: token('--viz-status-warning') },
  { key: 'failed', label: 'Failed', color: token('--viz-status-critical') },
  { key: 'canceled', label: 'Canceled', color: token('--viz-neutral') },
];
const DURATION_SERIES = [
  { key: 'avgDurationMs', label: 'Average', color: token('--viz-series-1') },
  { key: 'p95DurationMs', label: 'p95', color: token('--viz-series-2') },
];
const HISTOGRAM_SERIES = [{ key: 'count', label: 'Work items', color: token('--viz-series-1') }];

const state = {
  range: { preset: DEFAULT_PRESET },
  refreshSeconds: 0,
  timer: null,
  controller: null,
  summary: null,
  users: null,
  runningJobs: null,
  showRunningJobs: false,
  serviceDetails: new Map(),
  userDetails: new Map(),
  serviceSort: { key: 'queued', dir: 'desc' },
  userSort: { key: 'computeMs', dir: 'desc' },
  serviceFilter: '',
  userFilter: '',
  userFilterTimer: null,
  userService: '',
  usersController: null,
  statusJobsController: null,
  hideIdle: true,
};

// -------------------------------------------------------------------------------------------------
// Data loading
// -------------------------------------------------------------------------------------------------

/**
 * Gets the query parameters for the selected time range
 * @returns {URLSearchParams} the parameters
 */
function rangeParams() {
  const params = new URLSearchParams();
  if (state.range.preset) {
    params.set('range', state.range.preset);
  } else {
    params.set('start', state.range.start.toISOString());
    params.set('end', state.range.end.toISOString());
  }
  return params;
}

/**
 * Gets the query parameters for the users table: the selected time range, filters, and sort. The
 * API sorts every user and returns the first ones, so the sort decides which users are shown.
 * @returns {URLSearchParams} the parameters
 */
function usersParams() {
  const params = rangeParams();
  const filter = state.userFilter.trim();
  if (filter) params.set('filter', filter);
  if (state.userService) params.set('service', state.userService);
  params.set('sort', state.userSort.key);
  params.set('dir', state.userSort.dir);
  return params;
}

/**
 * Fetches JSON from the dashboard API
 * @param {string} path - the path under the API root
 * @param {URLSearchParams} params - the query parameters
 * @param {AbortSignal} signal - aborts the request
 * @returns {Promise<object>} the response body
 */
async function fetchJson(path, params, signal) {
  const query = new URLSearchParams(params);
  query.set('version', API_VERSION);
  const response = await fetch(`${API}${path}?${query}`, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body.description || body.message || message;
    } catch {
      // keep the status text
    }
    throw new Error(message);
  }
  return response.json();
}

/**
 * Shows or clears the error banner
 * @param {string} message - the error, or an empty string to clear it
 */
function showError(message) {
  const el = document.getElementById('errorMessage');
  el.textContent = message ? `Could not load the dashboard: ${message}` : '';
  el.classList.toggle('d-none', !message);
}

/**
 * Reloads everything shown on the page for the selected range. While loading, the current views
 * stay in place at reduced opacity rather than being cleared.
 */
async function refresh() {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  root.classList.add('is-loading');
  const params = rangeParams();
  try {
    const [summary, users] = await Promise.all([
      fetchJson('/summary', params, controller.signal),
      fetchJson('/users', usersParams(), controller.signal),
    ]);
    state.summary = summary;
    state.users = users;
    showError('');
    renderAll();
    // refresh any expanded details too, so everything shown agrees on the range
    await Promise.all([
      ...[...state.serviceDetails.keys()].map((name) => loadServiceDetails(name, controller.signal)),
      ...[...state.userDetails.keys()].map((username) => loadUserDetails(username, controller.signal)),
      state.showRunningJobs ? loadRunningJobs(controller.signal) : null,
    ]);
  } catch (e) {
    if (e.name !== 'AbortError') showError(e.message);
  } finally {
    if (state.controller === controller) root.classList.remove('is-loading');
  }
}

/**
 * Loads (or reloads) the details of a service and renders them into its expanded row
 * @param {string} name - the service name
 * @param {AbortSignal} [signal] - aborts the request
 */
async function loadServiceDetails(name, signal) {
  try {
    const details = await fetchJson(`/services/${encodeURIComponent(name)}`, rangeParams(), signal);
    if (state.serviceDetails.has(name)) {
      state.serviceDetails.set(name, details);
      renderServiceDetails(name);
    }
  } catch (e) {
    if (e.name !== 'AbortError') renderDetailError(`service-detail-${cssId(name)}`, e.message);
  }
}

/**
 * Loads (or reloads) the details of a user and renders them into its expanded row
 * @param {string} username - the user
 * @param {AbortSignal} [signal] - aborts the request
 */
async function loadUserDetails(username, signal) {
  try {
    const details = await fetchJson(`/users/${encodeURIComponent(username)}`, rangeParams(), signal);
    if (state.userDetails.has(username)) {
      state.userDetails.set(username, details);
      renderUserDetails(username);
    }
  } catch (e) {
    if (e.name !== 'AbortError') renderDetailError(`user-detail-${cssId(username)}`, e.message);
  }
}

/**
 * Reloads the users table, e.g. after the user filter changes. The filter is applied by the API, so
 * it finds users beyond the top ones by compute time.
 */
async function loadUsers() {
  state.usersController?.abort();
  const controller = new AbortController();
  state.usersController = controller;
  try {
    state.users = await fetchJson('/users', usersParams(), controller.signal);
    renderUsers();
  } catch (e) {
    if (e.name !== 'AbortError') {
      document.getElementById('usersTable').replaceChildren(
        h('p', { className: 'text-danger small', textContent: `Could not load users: ${e.message}` }));
    }
  }
}

/**
 * Loads (or reloads) the longest running jobs
 * @param {AbortSignal} [signal] - aborts the request
 */
async function loadRunningJobs(signal) {
  try {
    state.runningJobs = await fetchJson('/jobs/running', new URLSearchParams({ limit: '10' }), signal);
    renderRunningJobs();
  } catch (e) {
    if (e.name !== 'AbortError') {
      document.getElementById('runningJobs').replaceChildren(
        h('p', { className: 'text-danger small', textContent: `Could not load running jobs: ${e.message}` }));
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Shared view helpers
// -------------------------------------------------------------------------------------------------

/**
 * Makes a string safe to use in an element id
 * @param {string} value - the string
 * @returns {string} the id fragment
 */
function cssId(value) {
  return Array.from(value).map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : `_${c.charCodeAt(0).toString(16)}`)).join('');
}

/**
 * Renders an error message into an expanded detail row
 * @param {string} id - the id of the detail container
 * @param {string} message - the error
 */
function renderDetailError(id, message) {
  document.getElementById(id)?.replaceChildren(
    h('p', { className: 'text-danger small mb-0', textContent: `Could not load details: ${message}` }));
}

/**
 * Builds a delta indicator comparing a value with the previous period
 * @param {number|null} current - the current value
 * @param {number|null} previous - the previous period's value
 * @param {object} options - how to compare
 * @param {'up'|'down'|'none'} options.good - which direction is good ('none' when neither is)
 * @param {'percent'|'points'} [options.mode] - relative change, or the difference in percentage points
 * @returns {HTMLElement|null} the indicator, or null if there is nothing to compare
 */
function delta(current, previous, { good, mode = 'percent' }) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  let change;
  let text;
  if (mode === 'points') {
    change = (current - previous) * 100;
    if (Math.abs(change) < 0.05) return h('span', { className: 'kpi-delta neutral', textContent: 'No change' });
    text = `${Math.abs(change).toFixed(1)} pts`;
  } else {
    if (previous === 0) return null;
    change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return h('span', { className: 'kpi-delta neutral', textContent: 'No change' });
    text = `${Math.abs(change) >= 100 ? Math.round(Math.abs(change)) : Math.abs(change).toFixed(1)}%`;
  }
  const up = change > 0;
  let tone = 'neutral';
  if (good !== 'none') tone = (up === (good === 'up')) ? 'good' : 'bad';
  return h('span', { className: `kpi-delta ${tone}` },
    h('i', { className: `bi ${up ? 'bi-arrow-up' : 'bi-arrow-down'}`, 'aria-hidden': 'true' }),
    h('span', { className: 'visually-hidden', textContent: up ? 'Up ' : 'Down ' }),
    text);
}

/**
 * Builds a stat tile
 * @param {object} tile - the tile contents
 * @param {string} tile.label - the label
 * @param {string} [tile.info] - an explanation of the value, shown on hovering over the label
 * @param {string} tile.value - the formatted value
 * @param {string|(string|Node)[]} [tile.detail] - a secondary line
 * @param {HTMLElement|null} [tile.delta] - the delta indicator
 * @param {string} [tile.comparison] - what the delta compares with
 * @param {SVGElement} [tile.trend] - a sparkline
 * @returns {HTMLElement} the tile
 */
function statTile(tile) {
  return h('div', { className: 'kpi' },
    h('div', { className: 'kpi-label', title: tile.info },
      tile.label,
      tile.info ? h('i', { className: 'bi bi-info-circle kpi-info', 'aria-hidden': 'true' }) : null,
      tile.info ? h('span', { className: 'visually-hidden', textContent: `: ${tile.info}` }) : null),
    h('div', { className: 'kpi-value', textContent: tile.value }),
    tile.detail ? h('div', { className: 'kpi-detail' }, tile.detail) : null,
    tile.delta ? h('div', { className: 'kpi-delta-row', title: `Compared with the ${tile.comparison}` }, tile.delta,
      h('span', { className: 'visually-hidden', textContent: ` compared with the ${tile.comparison}` })) : null,
    tile.trend ? h('div', { className: 'kpi-trend' }, tile.trend) : null);
}

/**
 * Describes how backlog work items with no duration history are estimated, e.g. "1 h each"
 * @returns {string} the description
 */
function defaultEstimateText() {
  const ms = state.summary?.defaultBacklogEstimateMs;
  return ms ? `${formatDuration(ms)} each` : 'a default duration each';
}

/**
 * Describes the window the recent throughput is measured over, e.g. "last 15 minutes"
 * @returns {string} the description
 */
function throughputWindowText() {
  const ms = state.summary?.throughputWindowMs;
  return ms ? `last ${describeSpan(ms)}` : 'last few minutes';
}

/**
 * Builds the estimated compute time of a backlog - the work not started yet (ready work items).
 * Each job's work items are estimated with the duration fair queueing uses for the job and service:
 * its measured average (or its failures' average), else one seeded from the user's recent jobs for
 * the service, else a default. An asterisk marks estimates that include work items estimated with
 * the default.
 * @param {object} live - live work from the API
 * @returns {HTMLElement} the estimate
 */
function backlogCompute(live) {
  const defaults = live.backlogDefaultEstimateCount;
  const title = defaults > 0
    ? `${formatCount(defaults)} of the ${formatCount(live.ready)} work items not started yet have no duration `
      + `history, so are estimated at ${defaultEstimateText()}`
    : `The estimated compute time of the ${formatCount(live.ready)} work items not started yet`;
  return h('span', { title },
    formatComputeTime(live.backlogComputeEstimateMs),
    defaults > 0 ? h('span', { className: 'estimate-default', 'aria-hidden': 'true', textContent: '*' }) : null,
    defaults > 0 ? h('span', { className: 'visually-hidden', textContent: ` (${title})` }) : null);
}

/**
 * Builds the estimated wall clock time to clear a backlog at the recent compute throughput
 * @param {object} live - live work from the API
 * @returns {HTMLElement} the estimate
 */
function backlogClear(live) {
  if (live.backlogClearEstimateMs === null) {
    const title = `Nothing completed in the ${throughputWindowText()}, so there is no throughput to estimate from`;
    return h('span', { className: 'text-muted', title },
      'no throughput', h('span', { className: 'visually-hidden', textContent: ` (${title})` }));
  }
  if (live.backlogComputeEstimateMs === 0) return h('span', { textContent: '0' });
  const title = `At the throughput of the ${throughputWindowText()}: on average `
    + `${formatRate(live.recentComputeRate)} work items in progress at once`;
  return h('span', { title }, formatDuration(live.backlogClearEstimateMs));
}

/**
 * Formats the estimated time to clear a backlog as text
 * @param {object} live - live work from the API
 * @returns {string} the estimate
 */
function backlogClearText(live) {
  if (live.backlogClearEstimateMs === null) return 'no recent throughput';
  return live.backlogComputeEstimateMs === 0 ? '0' : formatDuration(live.backlogClearEstimateMs);
}

/**
 * Builds a success rate cell: the rate with a status icon (the icon's color is never the only cue -
 * the tooltip and value say the same)
 * @param {number|null} rate - the success rate
 * @returns {HTMLElement} the cell contents
 */
function successRateCell(rate) {
  if (rate === null || rate === undefined) return h('span', { className: 'text-muted', textContent: '—' });
  let level = 'critical';
  let icon = 'bi-x-octagon-fill';
  let label = 'Below 95%';
  if (rate >= 0.99) {
    level = 'good';
    icon = 'bi-check-circle-fill';
    label = '99% or above';
  } else if (rate >= 0.95) {
    level = 'warning';
    icon = 'bi-exclamation-triangle-fill';
    label = '95–99%';
  }
  return h('span', { className: 'rate', title: label },
    h('i', { className: `bi ${icon} status-icon status-${level}`, 'aria-hidden': 'true' }),
    formatPercent(rate),
    h('span', { className: 'visually-hidden', textContent: ` (${label})` }));
}

/**
 * Builds a work item count that, when selected, opens a dialog listing the jobs with work items
 * that reached the status in the range (for the given service and/or user). A zero count is plain
 * text, as there is nothing to list.
 * @param {number} count - the number of work items
 * @param {string} status - the work item status
 * @param {{service?: string, user?: string}} [scope] - the service and/or user the count is for
 * @returns {HTMLElement|string} the count
 */
function statusCount(count, status, scope = {}) {
  const text = formatCount(count);
  if (!count) return text;
  return h('button', {
    type: 'button',
    className: 'btn-status-jobs',
    title: `Show the jobs with ${status} work items`,
    'aria-haspopup': 'dialog',
    onClick: (event) => {
      // the count may be in an expandable row, which would otherwise toggle
      event.stopPropagation();
      openStatusJobs(status, scope);
    },
  }, text, h('span', { className: 'visually-hidden', textContent: ` ${status} work items, show their jobs` }));
}

/**
 * Builds the legend of a work items by status chart, where selecting a status opens a dialog
 * listing the jobs with work items that reached that status in the range
 * @param {{service?: string, user?: string}} [scope] - the service and/or user the chart is for
 * @returns {HTMLElement} the legend
 */
function statusLegend(scope = {}) {
  return h('ul', { className: 'viz-legend', 'aria-label': 'Legend' },
    STATUS_SERIES.map((ser) => h('li', {},
      h('button', {
        type: 'button',
        className: 'btn-legend',
        title: `Show the jobs with ${ser.key} work items`,
        'aria-haspopup': 'dialog',
        onClick: () => openStatusJobs(ser.key, scope),
      },
      h('span', { className: 'viz-key-rect', style: `background:${ser.color}` }),
      ser.label))));
}

/**
 * Opens the dialog listing the jobs with the most work items that reached a status in the
 * selected range, optionally only for a service and/or user
 * @param {string} status - the work item status
 * @param {{service?: string, user?: string}} scope - the service and/or user
 */
async function openStatusJobs(status, scope) {
  const dialog = document.getElementById('statusJobsDialog');
  const label = STATUS_SERIES.find((ser) => ser.key === status)?.label ?? status;
  const range = state.summary?.range;
  document.getElementById('statusJobsTitle').textContent = `Jobs with ${label.toLowerCase()} work items`;
  document.getElementById('statusJobsScope').textContent = [
    scope.service ? `Service ${scope.service}` : null,
    scope.user ? `User ${scope.user}` : null,
    range ? formatRange(new Date(range.start), new Date(range.end)) : null,
  ].filter(Boolean).join(' · ');
  const body = document.getElementById('statusJobsBody');
  body.replaceChildren(h('p', { className: 'text-muted small mb-0', textContent: 'Loading…' }));
  if (!dialog.open) dialog.showModal();

  state.statusJobsController?.abort();
  const controller = new AbortController();
  state.statusJobsController = controller;
  const params = rangeParams();
  params.set('status', status);
  if (scope.service) params.set('service', scope.service);
  if (scope.user) params.set('user', scope.user);
  try {
    const data = await fetchJson('/jobs/by-work-item-status', params, controller.signal);
    body.replaceChildren(
      table(['Job', 'User', 'Job status', `${label} work items`, `Last ${label.toLowerCase()}`],
        data.jobs.map((j) => [
          h('a', { href: j.link, target: '_blank', rel: 'noopener', className: 'font-monospace small', title: `${j.jobID} - opens the job's ${status} work items in a new tab`, textContent: j.jobID }),
          j.username, j.jobStatus.replace(/_/g, ' '), formatCount(j.workItemCount),
          formatDateTime(new Date(j.lastUpdated))]),
        { caption: `Jobs with ${status} work items`, numeric: [3] }),
      h('p', { className: 'viz-subtitle mb-0' },
        data.hasMore ? `Showing the ${data.jobs.length} jobs with the most ${status} work items. ` : '',
        'Work items of finished jobs are deleted after a while, so jobs from early in a long range may be missing.'));
  } catch (e) {
    if (e.name !== 'AbortError') {
      body.replaceChildren(h('p', { className: 'text-danger small mb-0', textContent: `Could not load the jobs: ${e.message}` }));
    }
  }
}

/**
 * Gets a description of the comparison period, e.g. "previous 24 hours"
 * @param {object} range - the range from the API
 * @returns {string} the description
 */
function comparisonLabel(range) {
  return `previous ${describeSpan(new Date(range.end) - new Date(range.start))}`;
}

/**
 * Gets the length of a range from the API
 * @param {object} range - the range
 * @returns {number} its length in ms
 */
function spanOf(range) {
  return new Date(range.end) - new Date(range.start);
}

/**
 * Describes a time series bucket for a tooltip
 * @param {object} range - the range from the API
 * @param {string} t - the bucket start
 * @returns {string} the description
 */
function bucketTitle(range, t) {
  const start = new Date(t);
  const end = new Date(start.getTime() + range.bucketMs);
  if (range.bucketMs >= 12 * 60 * 60000) return `${formatDateTime(start)} – ${formatDateTime(end)}`;
  return `${formatDateTime(start)} – ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Renders a card with a stacked column chart of work items by status over time
 * @param {HTMLElement} container - the card element
 * @param {object} data - an API response with range and series
 * @param {string} title - the card title
 * @param {{service?: string, user?: string}} [scope] - the service and/or user the data is for
 */
function renderCompletionsCard(container, data, title, scope = {}) {
  const { series, range } = data;
  chartCard(container, {
    title,
    subtitle: `Per ${describeBucket(range.bucketMs)} · select a status to see its jobs`,
    legend: statusLegend(scope),
    renderChart: (el) => columnChart(el, {
      count: series.length,
      series: STATUS_SERIES,
      valueAt: (i, key) => series[i][key],
      xLabel: (i) => formatTimeLabel(new Date(series[i].t), spanOf(range)),
      tooltipTitle: (i) => bucketTitle(range, series[i].t),
      tooltipFooter: (i) => `Total ${formatCount(STATUS_SERIES.reduce((sum, ser) => sum + series[i][ser.key], 0))}`,
      formatValue: formatCount,
      formatTick: formatCompact,
      ariaLabel: `${title}, stacked by status`,
    }),
    renderTable: () => table(
      ['Time', ...STATUS_SERIES.map((ser) => ser.label)],
      series.map((p) => [bucketTitle(range, p.t), ...STATUS_SERIES.map((ser) => formatCount(p[ser.key]))]),
      { caption: title, numeric: [1, 2, 3, 4] }),
  });
}

/**
 * Renders a card with a line chart of work item durations over time
 * @param {HTMLElement} container - the card element
 * @param {object} data - an API response with range and series
 * @param {string} title - the card title
 */
function renderDurationCard(container, data, title) {
  const { series, range } = data;
  chartCard(container, {
    title,
    subtitle: 'Average and estimated 95th percentile, excluding canceled work items',
    legend: legend(DURATION_SERIES, 'line'),
    renderChart: (el) => lineChart(el, {
      count: series.length,
      series: DURATION_SERIES,
      valueAt: (i, key) => series[i][key],
      xLabel: (i) => formatTimeLabel(new Date(series[i].t), spanOf(range)),
      tooltipTitle: (i) => bucketTitle(range, series[i].t),
      formatValue: formatDuration,
      formatTick: (v) => (v === 0 ? '0' : formatDuration(v)),
      tickStep: niceDurationStep,
      ariaLabel: title,
    }),
    renderTable: () => table(
      ['Time', ...DURATION_SERIES.map((ser) => ser.label)],
      series.map((p) => [bucketTitle(range, p.t), ...DURATION_SERIES.map((ser) => formatDuration(p[ser.key]))]),
      { caption: title, numeric: [1, 2] }),
  });
}

/**
 * Renders a card with a column chart of the work item duration distribution
 * @param {HTMLElement} container - the card element
 * @param {object[]} histogram - the histogram buckets from the API
 * @param {string} title - the card title
 */
function renderHistogramCard(container, histogram, title) {
  const total = histogram.reduce((sum, b) => sum + b.count, 0);
  const share = (count) => (total > 0 ? ` (${formatPercent(count / total, 1)})` : '');
  chartCard(container, {
    title,
    subtitle: 'Work items by duration, excluding canceled work items',
    renderChart: (el) => columnChart(el, {
      count: histogram.length,
      series: HISTOGRAM_SERIES,
      valueAt: (i) => histogram[i].count,
      xLabel: (i) => DURATION_BUCKET_LABELS[i],
      labelEvery: 1,
      tooltipTitle: (i) => DURATION_BUCKET_LABELS[i],
      tooltipFooter: (i) => (total > 0 ? `${formatPercent(histogram[i].count / total, 1)} of work items` : ''),
      formatValue: formatCount,
      formatTick: formatCompact,
      labelMax: true,
      ariaLabel: title,
    }),
    renderTable: () => table(['Duration', 'Work items'],
      histogram.map((b, i) => [DURATION_BUCKET_LABELS[i], `${formatCount(b.count)}${share(b.count)}`]),
      { caption: title, numeric: [1] }),
  });
}

/**
 * Builds a sortable table header cell
 * @param {object} column - the column definition
 * @param {object} sort - the table's current sort
 * @param {function(string): void} onSort - called with the column key when clicked
 * @returns {HTMLElement} the header cell
 */
function sortableHeader(column, sort, onSort) {
  if (column.sortable === false) {
    return h('th', { scope: 'col', className: column.numeric ? 'numeric' : undefined, title: column.title, textContent: column.label });
  }
  const active = sort.key === column.key;
  let icon = 'bi-arrow-down-up';
  if (active) icon = sort.dir === 'asc' ? 'bi-sort-up' : 'bi-sort-down';
  return h('th', {
    scope: 'col',
    className: column.numeric ? 'numeric' : undefined,
    title: column.title,
    'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
  }, h('button', { type: 'button', className: 'btn-sort', onClick: () => onSort(column.key) },
    column.label, h('i', { className: `bi ${icon} sort-icon`, 'aria-hidden': 'true' })));
}

/**
 * Updates a table's sort for a click on a column: a new column sorts descending for numbers
 * (ascending for text), and the same column toggles direction
 * @param {object} sort - the sort to update
 * @param {object} column - the clicked column
 */
function updateSort(sort, column) {
  if (sort.key === column.key) {
    sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sort.key = column.key;
    sort.dir = column.numeric ? 'desc' : 'asc';
  }
}

/**
 * Sorts rows by a column
 * @param {object[]} rows - the rows
 * @param {object[]} columns - the column definitions
 * @param {object} sort - the sort
 * @returns {object[]} the sorted rows
 */
function sortRows(rows, columns, sort) {
  const column = columns.find((c) => c.key === sort.key) ?? columns[0];
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = column.sortValue(a);
    const y = column.sortValue(b);
    if (typeof x === 'string') return x.localeCompare(y) * dir;
    return (x - y) * dir;
  });
}

/**
 * Builds a table with expandable rows: clicking a row (or its disclosure button) shows a detail row
 * @param {object} options - the table options
 * @param {object[]} options.columns - the column definitions (key, label, numeric, render, sortValue)
 * @param {object[]} options.rows - the rows
 * @param {object} options.sort - the current sort
 * @param {function(string): void} options.onSort - called when a column header is clicked
 * @param {function(object): string} options.keyOf - gets a row's key
 * @param {function(object): string} options.detailId - gets the id of a row's detail container
 * @param {function(string): boolean} options.isExpanded - whether a row is expanded
 * @param {function(object): void} options.onToggle - called when a row is toggled
 * @param {function(object): string} [options.rowClass] - gets extra classes for a row
 * @param {string} options.caption - the table's caption
 * @returns {HTMLElement} the table
 */
function expandableTable(options) {
  const { columns } = options;
  const bodyRows = [];
  for (const row of options.rows) {
    const key = options.keyOf(row);
    const expanded = options.isExpanded(key);
    const detailId = options.detailId(row);
    const toggle = h('button', {
      type: 'button',
      className: 'btn-disclosure',
      'aria-expanded': String(expanded),
      'aria-controls': detailId,
      'aria-label': `${expanded ? 'Hide' : 'Show'} details for ${key}`,
      onClick: (event) => {
        event.stopPropagation();
        options.onToggle(row);
      },
    }, h('i', { className: `bi ${expanded ? 'bi-chevron-down' : 'bi-chevron-right'}`, 'aria-hidden': 'true' }));
    bodyRows.push(h('tr', {
      className: `expandable ${options.rowClass ? options.rowClass(row) : ''} ${expanded ? 'expanded' : ''}`,
      onClick: () => options.onToggle(row),
    }, columns.map((column, i) => h('td', { className: column.numeric ? 'numeric' : undefined },
      i === 0 ? toggle : null, column.render(row)))));
    if (expanded) {
      bodyRows.push(h('tr', { className: 'detail-row' },
        h('td', { colspan: columns.length },
          h('div', { id: detailId, className: 'detail-panel' },
            h('p', { className: 'text-muted small mb-0', textContent: 'Loading…' })))));
    }
  }
  return h('div', { className: 'table-responsive' },
    h('table', { className: 'table table-sm table-hover dashboard-table' },
      h('caption', { className: 'visually-hidden', textContent: options.caption }),
      h('thead', {}, h('tr', {}, columns.map((c) => sortableHeader(c, options.sort, options.onSort)))),
      h('tbody', {}, bodyRows.length ? bodyRows
        : h('tr', {}, h('td', { colspan: columns.length, className: 'text-muted', textContent: 'No data for this range' })))));
}

// -------------------------------------------------------------------------------------------------
// Page sections
// -------------------------------------------------------------------------------------------------

/**
 * Renders the range description, update time, and stale stats warning
 */
function renderStatus() {
  const { summary } = state;
  const { range } = summary;
  const label = state.range.preset ? `Last ${describeSpan(spanOf(range))}` : 'Custom range';
  const ageMs = summary.statsAgeMs;
  document.getElementById('statusLine').replaceChildren(
    h('span', { className: 'fw-semibold', textContent: label }),
    ` · ${formatRange(new Date(range.start), new Date(range.end))}`,
    range.granularity === 'hour' ? ' · hourly data' : '',
    h('br'),
    `Changes are compared with the ${comparisonLabel(range)} · `,
    `Updated ${new Date(summary.generatedAt).toLocaleTimeString()}`,
    ageMs === null ? ' · stats have never been updated' : ` · stats as of ${formatAgo(ageMs)}`);
  const stale = document.getElementById('staleWarning');
  const isStale = ageMs === null || ageMs > STALE_STATS_MS;
  stale.classList.toggle('d-none', !isStale);
  stale.textContent = isStale
    ? `The dashboard stats ${ageMs === null ? 'have never been updated' : `were last updated ${formatAgo(ageMs)}`}. `
      + 'The cron service\'s work items stats job may not be running, so recent work is missing.'
    : '';
}

/**
 * Renders the KPI row
 */
function renderKpis() {
  const { summary } = state;
  const { totals, previousTotals, live, series } = summary;
  const comparison = comparisonLabel(summary.range);
  const spark = (values, label) => sparkline(values, label);
  const withData = series.filter((p) => p.successful + p.failed > 0);
  document.getElementById('kpis').replaceChildren(
    statTile({
      label: 'Work items completed',
      value: formatCompact(totals.total),
      detail: [statusCount(totals.counts.failed, 'failed'), ' failed · ',
        statusCount(totals.counts.canceled, 'canceled'), ' canceled'],
      delta: delta(totals.total, previousTotals.total, { good: 'none' }),
      comparison,
      trend: spark(series.map((p) => p.successful + p.failed + p.canceled + p.warning), 'Trend of work items completed'),
    }),
    statTile({
      label: 'Success rate',
      value: formatPercent(totals.successRate),
      detail: 'Successful ÷ (successful + failed)',
      delta: delta(totals.successRate, previousTotals.successRate, { good: 'up', mode: 'points' }),
      comparison,
      trend: spark(withData.map((p) => p.successful / (p.successful + p.failed)), 'Trend of the success rate'),
    }),
    statTile({
      label: 'Throughput',
      value: `${formatRate(totals.throughputPerMinute)}/min`,
      delta: delta(totals.throughputPerMinute, previousTotals.throughputPerMinute, { good: 'none' }),
      comparison,
    }),
    statTile({
      label: 'Average duration',
      value: formatDuration(totals.avgDurationMs),
      detail: `Median ${formatDuration(totals.p50DurationMs)}`,
      delta: delta(totals.avgDurationMs, previousTotals.avgDurationMs, { good: 'down' }),
      comparison,
      trend: spark(series.map((p) => p.avgDurationMs ?? 0), 'Trend of the average duration'),
    }),
    statTile({
      label: 'p95 duration',
      value: formatDuration(totals.p95DurationMs),
      detail: `Max ${formatDuration(totals.maxDurationMs)}`,
      delta: delta(totals.p95DurationMs, previousTotals.p95DurationMs, { good: 'down' }),
      comparison,
      trend: spark(series.map((p) => p.p95DurationMs ?? 0), 'Trend of the 95th percentile duration'),
    }),
    statTile({
      label: 'Queued now',
      value: formatCompact(live.ready + live.running),
      detail: `${formatCount(live.ready)} ready · ${formatCount(live.running)} running`
        + (live.oldestReadyWaitMs === null ? '' : ` · longest wait for new work for a job ${formatDuration(live.oldestReadyWaitMs)}`),
    }),
    statTile({
      label: 'Retries before success',
      info: 'Retry attempts made by work items that went on to succeed, and the share of those work items\' '
        + 'attempts that were retries. Retries of work items that ultimately failed are not included.',
      value: formatCompact(totals.successfulRetries),
      detail: [
        `${formatPercent(totals.successfulRetryRate)} of successful work items' attempts`,
        retryStatsLink(summary.range),
      ],
      delta: delta(totals.successfulRetries, previousTotals.successfulRetries, { good: 'down' }),
      comparison,
    }),
    statTile({
      label: 'Compute time',
      info: 'The summed duration of every work item completed in the range, excluding canceled work items',
      value: formatComputeTime(totals.computeMs),
      detail: 'Summed work item durations',
      delta: delta(totals.computeMs, previousTotals.computeMs, { good: 'none' }),
      comparison,
      trend: spark(series.map((p) => p.computeMs), 'Trend of the compute time'),
    }),
  );
}

/**
 * Builds a link to the retry statistics page (/admin/retry-stats), which breaks down the successful
 * work items by how many retries they needed. That page covers the last N minutes, so there is
 * only a link for the preset ranges, which end now.
 * @param {object} range - the range from the API
 * @returns {HTMLElement|null} the link, or null for a custom range
 */
function retryStatsLink(range) {
  if (!state.range.preset) return null;
  const minutes = Math.round(spanOf(range) / 60000);
  return h('a', {
    className: 'd-block', href: `/admin/retry-stats?numMinutes=${minutes}`, target: '_blank', rel: 'noopener',
    textContent: 'Breakdown by retry count',
  });
}

/**
 * Renders the system wide charts and the current state card
 */
function renderCharts() {
  const { summary } = state;
  renderCompletionsCard(document.getElementById('completionsCard'), summary, 'Work items completed');
  renderDurationCard(document.getElementById('durationCard'), summary, 'Work item duration');
  renderHistogramCard(document.getElementById('histogramCard'), summary.histogram, 'Duration distribution');

  const { queues, live } = summary;
  const queueValue = (count) => (count < 0 ? 'unavailable' : formatCount(count));
  document.getElementById('nowCard').replaceChildren(
    h('div', { className: 'viz-card-header' },
      h('div', {}, h('h3', { className: 'viz-title', textContent: 'Right now' }),
        h('p', { className: 'viz-subtitle', textContent: 'Live work and system queue sizes' }))),
    h('dl', { className: 'now-list' },
      h('dt', { textContent: 'Ready work items' }), h('dd', { textContent: formatCount(live.ready) }),
      h('dt', { textContent: 'Est. backlog compute' }), h('dd', {}, backlogCompute(live)),
      h('dt', { textContent: 'Est. time to clear the backlog' }), h('dd', {}, backlogClear(live)),
      h('dt', { textContent: 'Running work items' }), h('dd', { textContent: formatCount(live.running) }),
      h('dt', { textContent: 'Longest wait for new work to be performed for a job' }), h('dd', { textContent: formatDuration(live.oldestReadyWaitMs) }),
      h('dt', { textContent: 'Small work item update queue' }), h('dd', { textContent: queueValue(queues.smallWorkItemUpdates) }),
      h('dt', { textContent: 'Large work item update queue' }), h('dd', { textContent: queueValue(queues.largeWorkItemUpdates) }),
      h('dt', { textContent: 'Work item scheduler queue' }), h('dd', { textContent: queueValue(queues.workItemScheduler) })));
}

const SERVICE_COLUMNS = [
  { key: 'name', label: 'Service', sortValue: (r) => r.name, render: (r) => h('span', { className: 'font-monospace', textContent: r.name }) },
  {
    key: 'queued',
    label: 'Queued',
    numeric: true,
    sortValue: (r) => r.live.ready + r.live.running,
    render: (r) => h('span', { title: `${formatCount(r.live.ready)} ready, ${formatCount(r.live.running)} running`, textContent: formatCount(r.live.ready + r.live.running) }),
  },
  { key: 'backlogCompute', label: 'Est. backlog compute', title: 'The estimated compute time of the service\'s work items not started yet', numeric: true, sortValue: (r) => r.live.backlogComputeEstimateMs, render: (r) => backlogCompute(r.live) },
  { key: 'backlogClear', label: 'Est. time to clear', title: 'The estimated time to clear the service\'s backlog at its recent throughput', numeric: true, sortValue: (r) => r.live.backlogClearEstimateMs ?? Number.MAX_SAFE_INTEGER, render: (r) => backlogClear(r.live) },
  { key: 'running', label: 'Running', numeric: true, sortValue: (r) => r.live.running, render: (r) => formatCount(r.live.running) },
  { key: 'wait', label: 'Longest wait', title: 'Longest wait for new work to be performed for a job', numeric: true, sortValue: (r) => r.live.oldestReadyWaitMs ?? -1, render: (r) => formatDuration(r.live.oldestReadyWaitMs) },
  { key: 'total', label: 'Completed', numeric: true, sortValue: (r) => r.total, render: (r) => formatCount(r.total) },
  { key: 'failed', label: 'Failed', numeric: true, sortValue: (r) => r.counts.failed, render: (r) => statusCount(r.counts.failed, 'failed', { service: r.name }) },
  { key: 'successRate', label: 'Success', numeric: true, sortValue: (r) => r.successRate ?? -1, render: (r) => successRateCell(r.successRate) },
  {
    key: 'successDelta',
    label: 'Change',
    numeric: true,
    sortValue: (r) => (r.successRate === null || r.previousSuccessRate === null ? -Infinity : r.successRate - r.previousSuccessRate),
    render: (r) => delta(r.successRate, r.previousSuccessRate, { good: 'up', mode: 'points' }) ?? '',
  },
  { key: 'throughput', label: 'Per min', numeric: true, sortValue: (r) => r.throughputPerMinute, render: (r) => formatRate(r.throughputPerMinute) },
  { key: 'avg', label: 'Avg', numeric: true, sortValue: (r) => r.avgDurationMs ?? -1, render: (r) => formatDuration(r.avgDurationMs) },
  { key: 'p95', label: 'p95', numeric: true, sortValue: (r) => r.p95DurationMs ?? -1, render: (r) => formatDuration(r.p95DurationMs) },
  { key: 'trend', label: 'Trend', sortable: false, render: (r) => sparkline(r.spark, `Trend of work items completed by ${r.name}`) },
];

/**
 * Renders the services table
 */
function renderServices() {
  const { services } = state.summary;
  const filter = state.serviceFilter.trim().toLowerCase();
  const matching = services.filter((svc) => !filter || svc.name.toLowerCase().includes(filter));
  const visible = matching.filter((svc) => !state.hideIdle || !svc.isIdle || state.serviceDetails.has(svc.name));
  const hiddenCount = matching.length - visible.length;
  document.getElementById('servicesHiddenCount').textContent = hiddenCount > 0
    ? `${hiddenCount} idle service${hiddenCount === 1 ? '' : 's'} hidden` : '';

  document.getElementById('servicesTable').replaceChildren(expandableTable({
    columns: SERVICE_COLUMNS,
    rows: sortRows(visible, SERVICE_COLUMNS, state.serviceSort),
    sort: state.serviceSort,
    onSort: (key) => {
      updateSort(state.serviceSort, SERVICE_COLUMNS.find((c) => c.key === key));
      renderServices();
    },
    keyOf: (r) => r.name,
    detailId: (r) => `service-detail-${cssId(r.name)}`,
    isExpanded: (name) => state.serviceDetails.has(name),
    onToggle: (r) => {
      if (state.serviceDetails.has(r.name)) {
        state.serviceDetails.delete(r.name);
        renderServices();
      } else {
        state.serviceDetails.set(r.name, null);
        renderServices();
        loadServiceDetails(r.name);
      }
    },
    rowClass: (r) => (r.isIdle ? 'idle' : ''),
    caption: 'Services',
  }));
  for (const name of state.serviceDetails.keys()) renderServiceDetails(name);
}

/**
 * Renders the details of an expanded service, if they have loaded
 * @param {string} name - the service name
 */
function renderServiceDetails(name) {
  const details = state.serviceDetails.get(name);
  const container = document.getElementById(`service-detail-${cssId(name)}`);
  if (!details || !container) return;
  const { totals, live } = details;
  const completions = h('div', { className: 'viz-card' });
  const durations = h('div', { className: 'viz-card' });
  const histogram = h('div', { className: 'viz-card' });
  container.replaceChildren(
    h('p', { className: 'detail-summary' },
      `${formatCount(totals.total)} completed · ${formatPercent(totals.successRate)} success · `
      + `avg ${formatDuration(totals.avgDurationMs)} · p95 ${formatDuration(totals.p95DurationMs)} · `
      + `${formatCount(totals.retries)} retry attempts · ${formatSize(totals.itemsSizeMb)} output · `
      + `compute ${formatComputeTime(totals.computeMs)} · now ${formatCount(live.ready)} ready `
      + `(est. ${formatComputeTime(live.backlogComputeEstimateMs)} compute, ${backlogClearText(live)} to clear), `
      + `${formatCount(live.running)} running`),
    h('div', { className: 'row g-3' },
      h('div', { className: 'col-xl-6' }, completions),
      h('div', { className: 'col-xl-6' }, durations),
      h('div', { className: 'col-xl-6' }, histogram),
      h('div', { className: 'col-xl-6' },
        h('h4', { className: 'detail-heading', textContent: 'By image' }),
        table(['Image', 'Completed', 'Success', 'Avg', 'p95'],
          details.images.map((img) => [
            h('span', { className: 'font-monospace small', textContent: img.image }), formatCount(img.total),
            successRateCell(img.successRate), formatDuration(img.avgDurationMs), formatDuration(img.p95DurationMs)]),
          { caption: `${name} by image`, numeric: [1, 2, 3, 4] }),
        h('h4', { className: 'detail-heading', textContent: 'Failures and warnings by message category' }),
        table(['Status', 'Category', 'Work items'],
          details.failureCategories.map((f) => [f.status, f.messageCategory ?? '(none)', formatCount(f.count)]),
          { caption: `${name} failures by category`, numeric: [2] })),
      h('div', { className: 'col-12' },
        h('h4', { className: 'detail-heading', textContent: 'Users' }),
        table(['User', 'Compute time', 'Completed', 'Failed', 'Success', 'Avg', 'Ready', 'Est. backlog compute', 'Est. time to clear', 'Running'],
          details.users.map((u) => [u.username, formatComputeTime(u.computeMs), formatCount(u.total),
            statusCount(u.counts.failed, 'failed', { service: name, user: u.username }), successRateCell(u.successRate), formatDuration(u.avgDurationMs),
            formatCount(u.live.ready), backlogCompute(u.live), backlogClear(u.live), formatCount(u.live.running)]),
          { caption: `${name} users`, numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9] }))));
  renderCompletionsCard(completions, details, 'Work items completed', { service: name });
  renderDurationCard(durations, details, 'Work item duration');
  renderHistogramCard(histogram, details.histogram, 'Duration distribution');
}

/**
 * Renders the finished jobs stats
 */
function renderJobs() {
  const { jobs, previousJobs } = state.summary;
  const comparison = comparisonLabel(state.summary.range);
  const failedJobs = jobs.counts.failed;
  document.getElementById('jobKpis').replaceChildren(
    statTile({
      label: 'Jobs finished',
      value: formatCompact(jobs.total),
      detail: `${formatCount(jobs.counts.successful)} successful · ${formatCount(jobs.counts.complete_with_errors)} with errors`,
      delta: delta(jobs.total, previousJobs.total, { good: 'none' }),
      comparison,
    }),
    statTile({
      label: 'Jobs failed',
      value: formatCompact(failedJobs),
      detail: `${formatCount(jobs.counts.canceled)} canceled`,
      delta: delta(failedJobs, previousJobs.counts.failed, { good: 'down' }),
      comparison,
    }),
    statTile({
      label: 'Synchronous job duration',
      value: formatDuration(jobs.sync.avgDurationMs),
      detail: `${formatCount(jobs.sync.count)} jobs · max ${formatDuration(jobs.sync.maxDurationMs)}`,
      delta: delta(jobs.sync.avgDurationMs, previousJobs.sync.avgDurationMs, { good: 'down' }),
      comparison,
    }),
    statTile({
      label: 'Asynchronous job duration',
      value: formatDuration(jobs.async.avgDurationMs),
      detail: `${formatCount(jobs.async.count)} jobs · max ${formatDuration(jobs.async.maxDurationMs)}`,
      delta: delta(jobs.async.avgDurationMs, previousJobs.async.avgDurationMs, { good: 'down' }),
      comparison,
    }),
  );
}

/**
 * Renders the longest running jobs, if they have been requested
 */
function renderRunningJobs() {
  const container = document.getElementById('runningJobs');
  const data = state.runningJobs;
  if (!state.showRunningJobs || !data) return;
  container.replaceChildren(
    h('p', { className: 'small mb-2' },
      `${formatCount(data.runningCount)} jobs running · `,
      h('strong', { textContent: formatCount(data.stalledCount) }),
      ` not updated in the last ${formatDuration(data.stalledAfterMs)}`),
    table(['Job', 'User', 'Status', 'Progress', 'Granules', 'Service', 'Age', 'Last update'],
      data.jobs.map((j) => [
        h('a', { href: j.link, className: 'font-monospace small', title: j.jobID, textContent: j.jobID.slice(0, 8) }),
        j.username, j.status.replace(/_/g, ' '), `${j.progress}%`, formatCount(j.numInputGranules),
        j.serviceName ?? '—', formatDuration(j.ageMs), formatAgo(j.sinceUpdateMs)]),
      { caption: 'Longest running jobs', numeric: [3, 4, 6, 7] }));
}

// The users table's columns - sorted by the API, see USER_SORTS in dashboard-api.ts
const USER_COLUMNS = [
  { key: 'username', label: 'User', render: (r) => r.username },
  { key: 'computeMs', label: 'Compute time', numeric: true, render: (r) => formatComputeTime(r.computeMs) },
  { key: 'total', label: 'Work items', numeric: true, render: (r) => formatCount(r.total) },
  {
    key: 'failed',
    label: 'Failed',
    numeric: true,
    render: (r) => statusCount(r.counts.failed, 'failed', { user: r.username, service: state.userService || undefined }),
  },
  { key: 'successRate', label: 'Success', numeric: true, render: (r) => successRateCell(r.successRate) },
  {
    key: 'retries',
    label: 'Retries',
    title: 'Retry attempts by the user\'s work items, including work items that ultimately failed',
    numeric: true,
    render: (r) => formatCount(r.retries),
  },
  { key: 'jobs', label: 'Jobs', numeric: true, render: (r) => formatCount(r.jobs.total) },
  { key: 'sync', label: 'Avg sync job', numeric: true, render: (r) => formatDuration(r.jobs.sync.avgDurationMs) },
  { key: 'async', label: 'Avg async job', numeric: true, render: (r) => formatDuration(r.jobs.async.avgDurationMs) },
  { key: 'ready', label: 'Ready', numeric: true, render: (r) => formatCount(r.live.ready) },
  { key: 'backlogCompute', label: 'Est. backlog compute', title: 'The estimated compute time of the user\'s work items not started yet', numeric: true, render: (r) => backlogCompute(r.live) },
  { key: 'backlogClear', label: 'Est. time to clear', title: 'The estimated time to clear the user\'s backlog at their recent throughput', numeric: true, render: (r) => backlogClear(r.live) },
  { key: 'running', label: 'Running', numeric: true, render: (r) => formatCount(r.live.running) },
];

// The users table's job columns, which are hidden when the table is filtered to a service, as
// finished job stats aren't kept by service
const USER_JOB_COLUMN_KEYS = ['jobs', 'sync', 'async'];

/**
 * Gets the users table's columns for the current service filter
 * @returns {object[]} the columns
 */
function userColumns() {
  return state.userService ? USER_COLUMNS.filter((c) => !USER_JOB_COLUMN_KEYS.includes(c.key)) : USER_COLUMNS;
}

/**
 * Updates the users table's service filter options from the services in the summary, keeping the
 * selected service
 */
function renderUserServiceOptions() {
  const select = document.getElementById('userService');
  const names = new Set(state.summary.services.map((svc) => svc.name));
  if (state.userService) names.add(state.userService);
  select.replaceChildren(
    h('option', { value: '', textContent: 'All services' }),
    ...[...names].sort((a, b) => a.localeCompare(b)).map((name) => h('option', { value: name, textContent: name })));
  select.value = state.userService;
}

/**
 * Renders the users table. The rows are already sorted (and limited) by the API.
 */
function renderUsers() {
  const { users, totalUsers } = state.users;
  const columns = userColumns();
  const sortLabel = (columns.find((c) => c.key === state.userSort.key)?.label ?? 'compute time').toLowerCase();
  const scope = [
    state.userService ? ` of ${state.userService}` : '',
    state.userFilter.trim() ? ' matching the filter' : '',
  ].join('');
  document.getElementById('usersCount').textContent = totalUsers > users.length
    ? `Top ${users.length} of ${formatCount(totalUsers)} users${scope} by ${sortLabel}`
      + (state.userSort.dir === 'asc' ? ' (ascending)' : '')
    : `${formatCount(totalUsers)} user${totalUsers === 1 ? '' : 's'}${scope}`;
  document.getElementById('usersTable').replaceChildren(expandableTable({
    columns,
    rows: users,
    sort: state.userSort,
    onSort: (key) => {
      updateSort(state.userSort, columns.find((c) => c.key === key));
      loadUsers();
    },
    keyOf: (r) => r.username,
    detailId: (r) => `user-detail-${cssId(r.username)}`,
    isExpanded: (username) => state.userDetails.has(username),
    onToggle: (r) => {
      if (state.userDetails.has(r.username)) {
        state.userDetails.delete(r.username);
        renderUsers();
      } else {
        state.userDetails.set(r.username, null);
        renderUsers();
        loadUserDetails(r.username);
      }
    },
    caption: 'Users',
  }));
  for (const username of state.userDetails.keys()) renderUserDetails(username);
}

/**
 * Renders the details of an expanded user, if they have loaded
 * @param {string} username - the user
 */
function renderUserDetails(username) {
  const details = state.userDetails.get(username);
  const container = document.getElementById(`user-detail-${cssId(username)}`);
  if (!details || !container) return;
  const { totals, jobs, live } = details;
  const completions = h('div', { className: 'viz-card' });
  container.replaceChildren(
    h('p', { className: 'detail-summary' },
      `${formatCount(totals.total)} work items · compute ${formatComputeTime(totals.computeMs)} · `
      + `${formatPercent(totals.successRate)} success · ${formatCount(jobs.total)} jobs finished `
      + `(${formatCount(jobs.counts.failed)} failed) · avg sync job ${formatDuration(jobs.sync.avgDurationMs)} · `
      + `avg async job ${formatDuration(jobs.async.avgDurationMs)} · now ${formatCount(live.ready)} ready `
      + `(est. ${formatComputeTime(live.backlogComputeEstimateMs)} compute, ${backlogClearText(live)} to clear), `
      + `${formatCount(live.running)} running · `,
      h('a', { href: details.jobsLink, textContent: 'View jobs in the workflow UI' })),
    h('div', { className: 'row g-3' },
      h('div', { className: 'col-xl-6' }, completions),
      h('div', { className: 'col-xl-6' },
        h('h4', { className: 'detail-heading', textContent: 'By service' }),
        table(['Service', 'Compute time', 'Completed', 'Failed', 'Success', 'Avg', 'Ready', 'Est. backlog compute', 'Est. time to clear', 'Running'],
          details.services.map((svc) => [
            h('span', { className: 'font-monospace small', textContent: svc.name }), formatComputeTime(svc.computeMs),
            formatCount(svc.total), statusCount(svc.counts.failed, 'failed', { service: svc.name, user: username }),
            successRateCell(svc.successRate),
            formatDuration(svc.avgDurationMs), formatCount(svc.live.ready), backlogCompute(svc.live),
            backlogClear(svc.live), formatCount(svc.live.running)]),
          { caption: `${username} by service`, numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9] }))));
  renderCompletionsCard(completions, details, 'Work items completed', { user: username });
}

/**
 * Renders every section from the loaded data
 */
function renderAll() {
  renderStatus();
  renderKpis();
  renderCharts();
  renderServices();
  renderJobs();
  renderRunningJobs();
  renderUserServiceOptions();
  renderUsers();
}

// -------------------------------------------------------------------------------------------------
// Filters and controls
// -------------------------------------------------------------------------------------------------

/**
 * Converts a Date to the value of a datetime-local input, in the viewer's time zone
 * @param {Date} date - the date
 * @returns {string} the input value
 */
function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Updates the range and refresh controls, and the page URL, from the current state
 */
function syncControls() {
  for (const button of document.querySelectorAll('#rangePresets [data-range]')) {
    const selected = button.dataset.range === (state.range.preset ?? 'custom');
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const custom = document.getElementById('customRange');
  custom.hidden = Boolean(state.range.preset) && custom.dataset.open !== 'true';
  document.getElementById('autoRefresh').value = String(state.refreshSeconds);

  const params = rangeParams();
  if (state.range.preset === DEFAULT_PRESET) params.delete('range');
  if (state.refreshSeconds) params.set('refresh', String(state.refreshSeconds));
  const qs = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

/**
 * Restarts the auto refresh timer for the current setting
 */
function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = null;
  if (state.refreshSeconds > 0) {
    state.timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, state.refreshSeconds * 1000);
  }
}

/**
 * Selects a time range and reloads the page's data
 * @param {object} range - a preset ({ preset }) or custom ({ start, end }) range
 */
function selectRange(range) {
  state.range = range;
  syncControls();
  refresh();
}

/**
 * Reads the initial state from the page URL
 */
function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const start = params.get('start');
  if (start) {
    const end = params.get('end');
    state.range = { start: new Date(start), end: end ? new Date(end) : new Date() };
  } else {
    const preset = params.get('range');
    state.range = { preset: PRESETS.includes(preset) ? preset : DEFAULT_PRESET };
  }
  const refreshSeconds = Number(params.get('refresh'));
  state.refreshSeconds = REFRESH_OPTIONS.includes(refreshSeconds) ? refreshSeconds : 0;
}

/**
 * Wires up the filter controls
 */
function initControls() {
  const presets = document.getElementById('rangePresets');
  for (const preset of PRESETS) {
    presets.append(h('button', {
      type: 'button', className: 'btn btn-outline-primary', dataset: { range: preset }, textContent: preset,
      onClick: () => {
        document.getElementById('customRange').dataset.open = 'false';
        selectRange({ preset });
      },
    }));
  }
  presets.append(h('button', {
    type: 'button',
    className: 'btn btn-outline-primary',
    dataset: { range: 'custom' },
    textContent: 'Custom…',
    onClick: () => {
      const form = document.getElementById('customRange');
      form.dataset.open = 'true';
      const end = state.range.end ?? new Date();
      const start = state.range.start ?? new Date(end.getTime() - 24 * 60 * 60000);
      form.elements.start.value = toLocalInput(start);
      form.elements.end.value = toLocalInput(end);
      syncControls();
      form.elements.start.focus();
    },
  }));

  document.getElementById('customRange').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const start = new Date(form.elements.start.value);
    const end = new Date(form.elements.end.value);
    const message = form.querySelector('.form-message');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      message.textContent = 'Choose both a start and end time.';
    } else if (start >= end) {
      message.textContent = 'The start must be before the end.';
    } else {
      message.textContent = '';
      selectRange({ start, end });
    }
  });

  const autoRefresh = document.getElementById('autoRefresh');
  for (const seconds of REFRESH_OPTIONS) {
    autoRefresh.append(h('option', { value: String(seconds), textContent: seconds === 0 ? 'Off' : `Every ${formatDuration(seconds * 1000)}` }));
  }
  autoRefresh.addEventListener('change', () => {
    state.refreshSeconds = Number(autoRefresh.value);
    syncControls();
    scheduleRefresh();
  });
  document.getElementById('refreshNow').addEventListener('click', () => refresh());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.refreshSeconds > 0) refresh();
  });

  document.getElementById('serviceFilter').addEventListener('input', (event) => {
    state.serviceFilter = event.target.value;
    if (state.summary) renderServices();
  });
  document.getElementById('userFilter').addEventListener('input', (event) => {
    state.userFilter = event.target.value;
    // wait for a pause in typing before asking the API
    clearTimeout(state.userFilterTimer);
    state.userFilterTimer = setTimeout(() => {
      if (state.users) loadUsers();
    }, 300);
  });
  document.getElementById('userService').addEventListener('change', (event) => {
    state.userService = event.target.value;
    // the job columns are hidden with a service, so they can't stay the sort
    if (state.userService && USER_JOB_COLUMN_KEYS.includes(state.userSort.key)) {
      state.userSort = { key: 'computeMs', dir: 'desc' };
    }
    if (state.users) loadUsers();
  });
  const hideIdle = document.getElementById('hideIdle');
  hideIdle.checked = state.hideIdle;
  hideIdle.addEventListener('change', () => {
    state.hideIdle = hideIdle.checked;
    if (state.summary) renderServices();
  });

  const statusJobsDialog = document.getElementById('statusJobsDialog');
  document.getElementById('statusJobsClose').addEventListener('click', () => statusJobsDialog.close());
  // a click on the backdrop (outside the dialog's content) closes it
  statusJobsDialog.addEventListener('click', (event) => {
    if (event.target === statusJobsDialog) statusJobsDialog.close();
  });
  statusJobsDialog.addEventListener('close', () => state.statusJobsController?.abort());

  const runningJobsButton = document.getElementById('showRunningJobs');
  runningJobsButton.addEventListener('click', () => {
    state.showRunningJobs = !state.showRunningJobs;
    runningJobsButton.setAttribute('aria-expanded', String(state.showRunningJobs));
    runningJobsButton.textContent = state.showRunningJobs ? 'Hide running jobs' : 'Show longest running jobs';
    const container = document.getElementById('runningJobs');
    container.hidden = !state.showRunningJobs;
    if (state.showRunningJobs) {
      container.replaceChildren(h('p', { className: 'text-muted small', textContent: 'Loading…' }));
      loadRunningJobs();
    }
  });
}

readUrl();
initControls();
syncControls();
scheduleRefresh();
refresh();
