// Charts of query results on the analytics page, drawn with the admin dashboard's chart kit
// (public/js/dashboard/charts.js) so they look and behave the same: hover tooltips, a legend for
// more than one series, and a toggle to see the chart's data as a table.
//
// A chart is described by a spec, saved with a query:
//   { type: 'column' | 'line', x: column, y: [columns], series: column | null }
// Either several y columns are each a series ("wide" results), or one y column is split into a
// series per value of the series column ("long" results, e.g. GROUP BY day, service).
import { chartCard, columnChart, legend, lineChart, table } from '../dashboard/charts.js';
import { formatCompact } from '../dashboard/format.js';

// One series per categorical color slot (--viz-series-1 to 8); past that the smallest are folded
// into "Other", rather than generating more colors
export const MAX_SERIES = 8;
// More x positions than this aren't readable as columns or points
export const MAX_POINTS = 500;
export const CHART_TYPES = ['column', 'line'];

const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/;
const TEMPORAL_TYPE = /^(TIMESTAMP|DATE)/;
const DAY_MS = 24 * 60 * 60 * 1000;
// About how wide one character of an axis label is (the kit's tick labels are 11px)
const LABEL_CHAR_PX = 7;
const OTHER_KEY = '__other__';

export const isNumericType = (type) => NUMERIC_TYPE.test(type);
export const isTemporalType = (type) => TEMPORAL_TYPE.test(type);

/**
 * Formats a number for an axis tick, tooltip or the table view, keeping fractions (unlike the
 * dashboard's count formats, which round)
 *
 * @param {number|null} value - the value
 * @returns {string} the text
 */
export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return Math.abs(value) >= 10000 ? formatCompact(value) : value.toLocaleString([], { maximumFractionDigits: 2 });
}

/**
 * Formats a time for an axis label or tooltip, in UTC (the timezone the queries run in, so a
 * date_trunc('day', ...) bucket is labelled with its own day), with more detail for shorter ranges
 *
 * @param {Date} date - the time
 * @param {number} spanMs - the length of the range shown
 * @param {boolean} [full] - whether to include the date and time in full (for tooltips)
 * @returns {string} the text
 */
export function formatUtcTime(date, spanMs, full = false) {
  const utc = { timeZone: 'UTC' };
  if (full) {
    const hasTime = date.getUTCHours() + date.getUTCMinutes() + date.getUTCSeconds() > 0;
    return hasTime
      ? `${date.toLocaleString([], { ...utc, dateStyle: 'medium', timeStyle: 'short' })} UTC`
      : date.toLocaleDateString([], { ...utc, dateStyle: 'medium' });
  }
  if (spanMs <= DAY_MS) return date.toLocaleTimeString([], { ...utc, hour: 'numeric', minute: '2-digit' });
  if (spanMs <= 8 * DAY_MS) return date.toLocaleString([], { ...utc, weekday: 'short', hour: 'numeric' });
  return date.toLocaleDateString([], { ...utc, month: 'short', day: 'numeric' });
}

/**
 * Suggests a chart for a result: time (or the first text column) along x, and its numeric columns
 * as the series - or, for one numeric column and another text column, a series per text value
 *
 * @param {Array<{name: string, type: string}>} columns - the result's columns
 * @returns {object|null} a chart spec, or null if the result has no numeric column to chart
 */
export function suggestChart(columns) {
  const numeric = columns.filter((c) => isNumericType(c.type));
  const x = columns.find((c) => isTemporalType(c.type)) ?? columns.find((c) => !isNumericType(c.type));
  const y = numeric.filter((c) => c !== x);
  if (!x || y.length === 0) return null;
  const otherText = columns.find((c) => c !== x && !isNumericType(c.type) && !isTemporalType(c.type));
  const useSeries = y.length === 1 && otherText;
  return {
    type: isTemporalType(x.type) ? 'line' : 'column',
    x: x.name,
    y: useSeries ? [y[0].name] : y.slice(0, MAX_SERIES).map((c) => c.name),
    series: useSeries ? otherText.name : null,
  };
}

/**
 * Checks a chart spec against a result's columns
 *
 * @param {object} spec - the chart spec
 * @param {Array<{name: string, type: string}>} columns - the result's columns
 * @returns {string|null} what is wrong, or null if the chart can be drawn
 */
export function chartProblem(spec, columns) {
  const byName = new Map(columns.map((c) => [c.name, c]));
  if (!CHART_TYPES.includes(spec.type)) return `Unknown chart type ${spec.type}`;
  if (!byName.has(spec.x)) return `The results have no column ${spec.x} for the x axis`;
  if (!Array.isArray(spec.y) || spec.y.length === 0) return 'Choose at least one column to chart';
  for (const name of spec.y) {
    if (!byName.has(name)) return `The results have no column ${name}`;
    if (!isNumericType(byName.get(name).type)) return `${name} isn't numeric, so it can't be charted`;
    if (name === spec.x) return `${name} can't be both the x axis and a series`;
  }
  if (spec.series) {
    if (!byName.has(spec.series)) return `The results have no column ${spec.series} to split series by`;
    if (spec.y.length > 1) return 'Splitting into series by a column needs exactly one charted column';
  } else if (spec.y.length > MAX_SERIES) {
    return `Chart at most ${MAX_SERIES} columns at once`;
  }
  return null;
}

/**
 * Arranges a result for charting: the x positions (in time order when x is a time), the series,
 * and each series' value at each position
 *
 * @param {{columns: Array, rows: Array<Array>}} result - the query result
 * @param {object} spec - a chart spec that chartProblem accepts
 * @returns {{positions: Array, temporal: boolean, series: Array<{key: string, label: string}>,
 *   values: Object<string, Array<number|null>>, folded: number, problem: string|null}} the data,
 *   with a problem if it can't be drawn readably
 */
export function chartData(result, spec) {
  const index = (name) => result.columns.findIndex((c) => c.name === name);
  const xIndex = index(spec.x);
  const temporal = isTemporalType(result.columns[xIndex].type);
  const xKey = (value) => (value === null ? 'NULL' : String(value));

  // Each distinct x value is one position, in the order the query returned them
  const positions = [];
  const positionOf = new Map();
  for (const row of result.rows) {
    const key = xKey(row[xIndex]);
    if (!positionOf.has(key)) {
      positionOf.set(key, positions.length);
      positions.push(row[xIndex]);
    }
  }
  let order = positions.map((_, i) => i);
  if (temporal) {
    const time = (v) => (v === null ? Infinity : new Date(v).getTime());
    order = order.sort((a, b) => time(positions[a]) - time(positions[b]));
  }

  // The raw series: one per y column, or one per value of the series column
  const raw = new Map(); // key -> { label, values (by position), total }
  const add = (key, label, position, value) => {
    if (!raw.has(key)) raw.set(key, { label, values: new Array(positions.length).fill(null), total: 0 });
    const s = raw.get(key);
    if (value === null || value === undefined) return;
    const n = Number(value);
    // Rows with the same x (and series) are summed
    s.values[position] = (s.values[position] ?? 0) + n;
    s.total += Math.abs(n);
  };
  if (spec.series) {
    const yIndex = index(spec.y[0]);
    const seriesIndex = index(spec.series);
    for (const row of result.rows) {
      const label = row[seriesIndex] === null ? 'NULL' : String(row[seriesIndex]);
      add(`s:${label}`, label, positionOf.get(xKey(row[xIndex])), row[yIndex]);
    }
  } else {
    for (const name of spec.y) {
      const yIndex = index(name);
      raw.set(`c:${name}`, { label: name, values: new Array(positions.length).fill(null), total: 0 });
      for (const row of result.rows) add(`c:${name}`, name, positionOf.get(xKey(row[xIndex])), row[yIndex]);
    }
  }

  // Keep the biggest series, folding the rest into "Other" (only series split by a column can be
  // too many - chartProblem limits the y columns)
  let entries = [...raw.entries()];
  let folded = 0;
  if (spec.series) {
    // The biggest are kept, but in name order, so a series' color (which follows its position)
    // doesn't change from run to run as the sizes shift
    entries.sort((a, b) => b[1].total - a[1].total);
    const keptCount = entries.length > MAX_SERIES ? MAX_SERIES - 1 : entries.length;
    const byName = (a, b) => a[1].label.localeCompare(b[1].label, [], { numeric: true });
    entries = [...entries.slice(0, keptCount).sort(byName), ...entries.slice(keptCount)];
  }
  if (entries.length > MAX_SERIES) {
    const kept = entries.slice(0, MAX_SERIES - 1);
    const rest = entries.slice(MAX_SERIES - 1);
    folded = rest.length;
    const otherValues = new Array(positions.length).fill(null);
    for (const [, s] of rest) {
      s.values.forEach((v, i) => { if (v !== null) otherValues[i] = (otherValues[i] ?? 0) + v; });
    }
    entries = [...kept, [OTHER_KEY, { label: `Other (${folded})`, values: otherValues }]];
  }

  const values = {};
  for (const [key, s] of entries) values[key] = order.map((i) => s.values[i]);
  return {
    positions: order.map((i) => positions[i]),
    temporal,
    series: entries.map(([key, s]) => ({ key, label: s.label })),
    values,
    folded,
    problem: positions.length > MAX_POINTS
      ? `There are ${positions.length.toLocaleString()} values of ${spec.x} - too many to chart. `
        + `Aggregate the query to at most ${MAX_POINTS} (e.g. with date_trunc or GROUP BY).`
      : null,
  };
}

/**
 * Renders a chart of a query result
 *
 * @param {HTMLElement} container - the element to render the chart card into
 * @param {{columns: Array, rows: Array<Array>}} result - the query result
 * @param {object} spec - a chart spec that chartProblem accepts
 * @param {object} options - the options
 * @param {string} options.title - the chart's title
 * @param {function(string): string} options.color - gets a color token's value, e.g. --viz-series-1
 * @returns {string|null} a problem that stopped the chart being drawn, or null
 */
export function renderChart(container, result, spec, { title, color }) {
  const data = chartData(result, spec);
  if (data.problem) return data.problem;

  const series = data.series.map((s, i) => ({
    ...s,
    // "Other" is the neutral color, so it doesn't read as one more series
    color: s.key === OTHER_KEY ? color('--viz-neutral') : color(`--viz-series-${i + 1}`),
  }));
  const times = data.temporal ? data.positions.map((p) => (p === null ? null : new Date(p))) : null;
  const finite = times?.filter((t) => t !== null && !Number.isNaN(t.getTime())) ?? [];
  const spanMs = finite.length > 1 ? finite[finite.length - 1] - finite[0] : DAY_MS * 30;
  // Category labels (unlike times, which the chart kit spaces out) are shortened to fit their share
  // of the plot, so long names don't run into each other; tooltips and the table show them in full
  const plotWidth = Math.max(200, (container.clientWidth || 800) - 80);
  const fitChars = Math.floor(plotWidth / data.positions.length / LABEL_CHAR_PX) - 1;
  const fit = (text) => (text.length <= fitChars ? text : `${text.slice(0, Math.max(1, fitChars - 1))}…`);
  const label = (i, full) => {
    if (!times || times[i] === null || Number.isNaN(times[i].getTime())) {
      const text = data.positions[i] === null ? 'NULL' : String(data.positions[i]);
      return full ? text : fit(text);
    }
    return formatUtcTime(times[i], spanMs, full);
  };
  const kind = spec.type === 'line' ? 'line' : 'bar';
  const draw = spec.type === 'line' ? lineChart : columnChart;
  const yName = spec.series ? spec.y[0] : spec.y.join(', ');

  chartCard(container, {
    title,
    subtitle: [
      spec.series ? `${yName} by ${spec.x}, a series per ${spec.series}` : `${yName} by ${spec.x}`,
      spec.type === 'column' && series.length > 1 ? 'stacked' : null,
      data.temporal ? 'times in UTC' : null,
      data.folded ? `the smallest ${data.folded} series are combined as Other` : null,
    ].filter(Boolean).join(' · '),
    // A legend for two or more series; a single series is named by the title
    legend: series.length > 1 ? legend(series, kind) : null,
    renderChart: (el) => draw(el, {
      count: data.positions.length,
      series,
      valueAt: (i, key) => data.values[key][i],
      xLabel: (i) => label(i, false),
      tooltipTitle: (i) => label(i, true),
      formatValue: formatNumber,
      formatTick: formatNumber,
      ariaLabel: `${title}: ${yName} by ${spec.x}`,
    }),
    renderTable: () => table(
      [spec.x, ...series.map((s) => s.label)],
      data.positions.map((_, i) => [label(i, true), ...series.map((s) => formatNumber(data.values[s.key][i]))]),
      { caption: title, numeric: series.map((_, i) => i + 1) },
    ),
  });
  return null;
}
