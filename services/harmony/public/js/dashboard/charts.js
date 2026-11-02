// A small SVG chart kit for the admin dashboard: column (optionally stacked) charts, line charts,
// and sparklines, each with a legend, a hover/keyboard tooltip, and a table view of the same data.
// All text is inserted with textContent - series names and values come from the API.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Layout (px)
const PLOT_HEIGHT = 200;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 52 };
const END_LABEL_WIDTH = 72;
const MAX_BAR_WIDTH = 24;
const SURFACE_GAP = 2;
const BAR_RADIUS = 4;
const MIN_X_LABEL_SPACING = 72;

/**
 * Creates an HTML element
 * @param {string} tag - the tag name
 * @param {object} props - attributes (className, textContent, dataset, on* handlers, and others)
 * @param {...(Node|string|null|undefined|false)} children - the children
 * @returns {HTMLElement} the element
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  const isEmpty = (value) => value === undefined || value === null || value === false;
  for (const [key, value] of Object.entries(props).filter(([, v]) => !isEmpty(v))) {
    if (key === 'className') el.className = value;
    else if (key === 'textContent') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat().filter((c) => !isEmpty(c))) {
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/**
 * Creates an SVG element
 * @param {string} tag - the tag name
 * @param {object} attrs - the attributes
 * @returns {SVGElement} the element
 */
function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  return el;
}

/**
 * Rounds a step up to a "nice" number (1, 2, 2.5, or 5 times a power of 10)
 * @param {number} raw - the raw step
 * @returns {number} the nice step
 */
function niceStep(raw) {
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / exponent;
  let nice = 10;
  if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 2.5) nice = 2.5;
  else if (fraction <= 5) nice = 5;
  return nice * exponent;
}

// Clean steps for an axis of durations (ms): seconds, minutes, hours, and days
const DURATION_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1000, 2000, 5000, 10000, 15000, 30000,
  60000, 120000, 300000, 600000, 900000, 1800000,
  3600000, 7200000, 10800000, 21600000, 43200000, 86400000,
];

/**
 * Rounds a step of a duration axis up to a clean duration (e.g. 30 s, 5 min, 2 h)
 * @param {number} raw - the raw step in ms
 * @returns {number} the clean step
 */
export function niceDurationStep(raw) {
  return DURATION_STEPS.find((step) => step >= raw) ?? niceStep(raw);
}

/**
 * Gets clean y axis ticks from 0 up to at least the maximum value
 * @param {number} max - the maximum value
 * @param {function(number): number} stepFor - rounds a raw step up to a clean one
 * @param {number} target - the approximate number of intervals
 * @returns {number[]} the ticks
 */
function niceTicks(max, stepFor = niceStep, target = 4) {
  if (!(max > 0)) return [0, 1];
  const step = stepFor(max / target);
  const ticks = [];
  for (let v = 0; v < max + step / 2; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/**
 * Gets the path of a bar with rounded top corners and a square base
 * @param {number} x - the left edge
 * @param {number} yTop - the top edge
 * @param {number} width - the width
 * @param {number} yBottom - the bottom edge
 * @param {boolean} rounded - whether to round the top corners
 * @returns {string} the path
 */
function barPath(x, yTop, width, yBottom, rounded) {
  const r = rounded ? Math.min(BAR_RADIUS, width / 2, yBottom - yTop) : 0;
  return `M${x},${yBottom}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}`
    + `H${x + width - r}Q${x + width},${yTop} ${x + width},${yTop + r}V${yBottom}Z`;
}

// Every chart element re-renders when its width changes. A chart removed from the page (e.g. by
// re-rendering whatever contains it) stops being observed, so the observer doesn't retain it.
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const el = entry.target;
    if (!el.isConnected) {
      resizeObserver.unobserve(el);
    } else if (el._render && Math.abs(entry.contentRect.width - (el._renderedWidth ?? 0)) > 1) el._render();
  }
});

/**
 * Builds the shared frame of a chart: the svg, its plot area geometry, the y axis and gridlines,
 * and the x axis labels
 * @param {HTMLElement} container - the chart container
 * @param {object} options - the chart options (see columnChart/lineChart)
 * @param {number} yMax - the maximum value to show
 * @param {number} rightMargin - the right margin
 * @returns {object} the svg and geometry
 */
function chartFrame(container, options, yMax, rightMargin) {
  const width = Math.max(240, container.clientWidth);
  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom;
  const plotWidth = width - MARGIN.left - rightMargin;
  const baseline = MARGIN.top + PLOT_HEIGHT;
  const ticks = niceTicks(yMax, options.tickStep);
  const top = ticks[ticks.length - 1];
  const y = (v) => baseline - (v / top) * PLOT_HEIGHT;
  const n = options.count;
  const band = plotWidth / n;

  const svg = s('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, class: 'viz-svg', tabindex: 0, role: 'group',
    'aria-label': `${options.ariaLabel}. Use the left and right arrow keys to read values.`,
  });

  const grid = s('g', { class: 'viz-grid', 'aria-hidden': 'true' });
  for (const tick of ticks) {
    const ty = y(tick);
    if (tick > 0) grid.append(s('line', { x1: MARGIN.left, x2: MARGIN.left + plotWidth, y1: ty, y2: ty, class: 'viz-gridline' }));
    const label = s('text', { x: MARGIN.left - 8, y: ty, class: 'viz-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    label.textContent = options.formatTick ? options.formatTick(tick) : String(tick);
    grid.append(label);
  }
  grid.append(s('line', { x1: MARGIN.left, x2: MARGIN.left + plotWidth, y1: baseline, y2: baseline, class: 'viz-baseline' }));

  // label as many x positions as fit, evenly spaced
  const every = options.labelEvery ?? Math.max(1, Math.ceil(MIN_X_LABEL_SPACING / band));
  for (let i = 0; i < n; i += every) {
    const label = s('text', {
      x: MARGIN.left + (i + 0.5) * band, y: baseline + 18, class: 'viz-tick', 'text-anchor': 'middle',
    });
    label.textContent = options.xLabel(i);
    grid.append(label);
  }
  svg.append(grid);
  return { svg, width, plotWidth, band, baseline, y, n };
}

/**
 * Adds the hover and keyboard interaction shared by every chart: a wash or crosshair at the active
 * position and a tooltip listing every series' value there
 * @param {HTMLElement} container - the chart container
 * @param {object} frame - the chart frame
 * @param {object} options - the chart options
 * @param {function(number): void} onActive - draws the chart's own active state for an index (or -1)
 */
function addInteraction(container, frame, options, onActive) {
  const { svg, band, n } = frame;
  const tooltip = h('div', { className: 'viz-tooltip', role: 'status', 'aria-live': 'polite', hidden: true });
  container.append(tooltip);
  let active = -1;

  const show = (i, pointerX) => {
    active = i;
    onActive(i);
    if (i < 0) {
      tooltip.hidden = true;
      return;
    }
    const rows = [
      h('div', { className: 'viz-tooltip-title', textContent: options.tooltipTitle(i) }),
      ...options.series.map((ser) => {
        const value = options.valueAt(i, ser.key);
        return h('div', { className: 'viz-tooltip-row' },
          h('span', { className: 'viz-key-line', style: `background:${ser.color}` }),
          h('strong', { textContent: value === null || value === undefined ? '—' : options.formatValue(value) }),
          h('span', { className: 'viz-tooltip-label', textContent: ser.label }));
      }),
      options.tooltipFooter ? h('div', { className: 'viz-tooltip-footer', textContent: options.tooltipFooter(i) }) : null,
    ];
    tooltip.replaceChildren(...rows.filter(Boolean));
    tooltip.hidden = false;
    const x = pointerX ?? MARGIN.left + (i + 0.5) * band;
    const tooltipWidth = tooltip.offsetWidth;
    const left = x + 12 + tooltipWidth > frame.width ? x - 12 - tooltipWidth : x + 12;
    tooltip.style.left = `${Math.max(0, left)}px`;
    tooltip.style.top = `${MARGIN.top}px`;
  };

  // the whole plot height of each position is its hit target, never just the painted mark
  const hit = s('rect', {
    x: MARGIN.left, y: MARGIN.top, width: frame.plotWidth, height: PLOT_HEIGHT, fill: 'transparent', class: 'viz-hit',
  });
  hit.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.floor((px - MARGIN.left) / band)));
    if (i !== active) show(i, px);
  });
  hit.addEventListener('pointerleave', () => show(-1));
  svg.append(hit);

  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = active < 0
        ? (event.key === 'ArrowRight' ? 0 : n - 1)
        : Math.min(n - 1, Math.max(0, active + (event.key === 'ArrowRight' ? 1 : -1)));
      show(next);
    } else if (event.key === 'Escape') {
      show(-1);
    }
  });
  svg.addEventListener('blur', () => show(-1));
}

/**
 * Renders a column chart, stacked when there are several series
 * @param {HTMLElement} container - the element to render into
 * @param {object} options - the chart options
 * @param {number} options.count - the number of columns
 * @param {{key: string, label: string, color: string}[]} options.series - the series, bottom first
 * @param {function(number, string): (number|null)} options.valueAt - gets a series' value at an index
 * @param {function(number): string} options.xLabel - gets the axis label for an index
 * @param {function(number): string} options.tooltipTitle - gets the tooltip title for an index
 * @param {function(number): string} options.formatValue - formats a value
 * @param {function(number): string} [options.formatTick] - formats a y axis tick
 * @param {function(number): number} [options.tickStep] - rounds a y axis step to a clean value
 * @param {number} [options.labelEvery] - label every nth x position (default: as many as fit)
 * @param {function(number): string} [options.tooltipFooter] - gets a tooltip footer for an index
 * @param {boolean} [options.labelMax] - whether to label the tallest column's value
 * @param {string} options.ariaLabel - describes the chart
 */
export function columnChart(container, options) {
  const render = () => {
    container.replaceChildren();
    const totals = Array.from({ length: options.count }, (_, i) => options.series
      .reduce((sum, ser) => sum + (options.valueAt(i, ser.key) ?? 0), 0));
    const frame = chartFrame(container, options, Math.max(...totals, 0), MARGIN.right);
    const { svg, band, baseline, y } = frame;
    const barWidth = Math.max(1, Math.min(MAX_BAR_WIDTH, band - SURFACE_GAP));

    const wash = s('rect', { y: MARGIN.top, width: band, height: PLOT_HEIGHT, class: 'viz-wash', visibility: 'hidden' });
    svg.append(wash);
    const marks = s('g', { 'aria-hidden': 'true' });
    for (let i = 0; i < options.count; i++) {
      const x = MARGIN.left + i * band + (band - barWidth) / 2;
      const segments = options.series
        .map((ser) => ({ ser, value: options.valueAt(i, ser.key) ?? 0 }))
        .filter((seg) => seg.value > 0);
      let bottom = baseline;
      segments.forEach((seg, index) => {
        const top = bottom - (baseline - y(seg.value));
        // a 2px surface gap separates each segment from the one below it
        const segmentBottom = index === 0 ? bottom : bottom - SURFACE_GAP;
        if (segmentBottom - top >= 0.5) {
          marks.append(s('path', {
            d: barPath(x, top, barWidth, segmentBottom, index === segments.length - 1), fill: seg.ser.color,
          }));
        }
        bottom = top;
      });
    }
    svg.append(marks);

    if (options.labelMax) {
      const max = Math.max(...totals);
      const i = totals.indexOf(max);
      if (max > 0) {
        const label = s('text', {
          x: MARGIN.left + (i + 0.5) * band, y: y(max) - 6, class: 'viz-direct-label', 'text-anchor': 'middle',
        });
        label.textContent = options.formatValue(max);
        svg.append(label);
      }
    }

    container.append(svg);
    addInteraction(container, frame, options, (i) => {
      wash.setAttribute('visibility', i < 0 ? 'hidden' : 'visible');
      if (i >= 0) wash.setAttribute('x', String(MARGIN.left + i * band));
    });
    container._renderedWidth = container.clientWidth;
  };
  container._render = render;
  resizeObserver.observe(container);
  render();
}

/**
 * Renders a line chart on a single y axis
 * @param {HTMLElement} container - the element to render into
 * @param {object} options - the chart options (as for columnChart, without labelMax). Missing
 * values (null) leave a gap in the line.
 */
export function lineChart(container, options) {
  const render = () => {
    container.replaceChildren();
    let max = 0;
    for (let i = 0; i < options.count; i++) {
      for (const ser of options.series) max = Math.max(max, options.valueAt(i, ser.key) ?? 0);
    }
    const directLabels = options.series.length <= 4;
    const frame = chartFrame(container, options, max, directLabels ? END_LABEL_WIDTH : MARGIN.right);
    const { svg, band, y } = frame;
    const xAt = (i) => MARGIN.left + (i + 0.5) * band;

    const marks = s('g', { 'aria-hidden': 'true' });
    const ends = [];
    for (const ser of options.series) {
      let d = '';
      let last = null;
      let previousMissing = true;
      for (let i = 0; i < options.count; i++) {
        const value = options.valueAt(i, ser.key);
        if (value === null || value === undefined) {
          previousMissing = true;
        } else {
          d += `${previousMissing ? 'M' : 'L'}${xAt(i)},${y(value)}`;
          previousMissing = false;
          last = { i, value };
        }
      }
      marks.append(s('path', { d, class: 'viz-line', stroke: ser.color }));
      // a point with no neighbors draws no line, so give it a marker of its own
      for (let i = 0; i < options.count; i++) {
        const value = options.valueAt(i, ser.key);
        const missing = (j) => j < 0 || j >= options.count
          || options.valueAt(j, ser.key) === null || options.valueAt(j, ser.key) === undefined;
        if (value !== null && value !== undefined && missing(i - 1) && missing(i + 1)) {
          marks.append(s('circle', { cx: xAt(i), cy: y(value), r: 2.5, fill: ser.color }));
        }
      }
      if (last) {
        marks.append(s('circle', { cx: xAt(last.i), cy: y(last.value), r: 4, fill: ser.color, class: 'viz-dot' }));
        ends.push({ ser, y: y(last.value), x: xAt(last.i) });
      }
    }
    svg.append(marks);

    // direct end labels only when they don't collide - otherwise the legend carries identity
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    const collide = sorted.some((end, i) => i > 0 && end.y - sorted[i - 1].y < 14);
    if (directLabels && !collide) {
      for (const end of ends) {
        const label = s('text', { x: end.x + 8, y: end.y, class: 'viz-direct-label', 'dominant-baseline': 'middle' });
        label.textContent = end.ser.label;
        svg.append(label);
      }
    }

    const crosshair = s('line', { y1: MARGIN.top, y2: frame.baseline, class: 'viz-crosshair', visibility: 'hidden' });
    const dots = options.series.map((ser) => s('circle', { r: 4, fill: ser.color, class: 'viz-dot', visibility: 'hidden' }));
    svg.append(crosshair, ...dots);

    container.append(svg);
    addInteraction(container, frame, options, (i) => {
      crosshair.setAttribute('visibility', i < 0 ? 'hidden' : 'visible');
      if (i >= 0) {
        crosshair.setAttribute('x1', String(xAt(i)));
        crosshair.setAttribute('x2', String(xAt(i)));
      }
      options.series.forEach((ser, index) => {
        const value = i < 0 ? null : options.valueAt(i, ser.key);
        dots[index].setAttribute('visibility', value === null || value === undefined ? 'hidden' : 'visible');
        if (value !== null && value !== undefined) {
          dots[index].setAttribute('cx', String(xAt(i)));
          dots[index].setAttribute('cy', String(y(value)));
        }
      });
    });
    container._renderedWidth = container.clientWidth;
  };
  container._render = render;
  resizeObserver.observe(container);
  render();
}

/**
 * Creates a sparkline: the trend in the de-emphasis color with the latest value marked in the accent
 * @param {number[]} values - the values, oldest first
 * @param {string} ariaLabel - describes the trend
 * @returns {SVGElement} the sparkline
 */
export function sparkline(values, ariaLabel) {
  const width = 96;
  const height = 24;
  const pad = 3;
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'viz-spark', role: 'img', 'aria-label': ariaLabel });
  if (values.length === 0) return svg;
  const max = Math.max(...values, 0);
  const step = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const yAt = (v) => (max > 0 ? height - pad - (v / max) * (height - 2 * pad) : height - pad);
  const points = values.map((v, i) => `${pad + i * step},${yAt(v)}`).join(' ');
  svg.append(s('polyline', { points, class: 'viz-spark-line' }));
  const lastIndex = values.length - 1;
  svg.append(s('circle', { cx: pad + lastIndex * step, cy: yAt(values[lastIndex]), r: 2.5, class: 'viz-spark-dot' }));
  return svg;
}

/**
 * Builds a legend for a chart's series. Bars get a rect swatch, lines a line key.
 * @param {{label: string, color: string}[]} series - the series
 * @param {'bar'|'line'} kind - the kind of mark
 * @returns {HTMLElement} the legend
 */
export function legend(series, kind) {
  return h('ul', { className: 'viz-legend', 'aria-label': 'Legend' },
    series.map((ser) => h('li', {},
      h('span', { className: kind === 'line' ? 'viz-key-line' : 'viz-key-rect', style: `background:${ser.color}` }),
      ser.label)));
}

/**
 * Builds a simple table
 * @param {string[]} columns - the column headings
 * @param {(string|Node)[][]} rows - the cells of each row
 * @param {object} options - options
 * @param {string} [options.caption] - the table's caption
 * @param {number[]} [options.numeric] - the indexes of numeric columns (right aligned)
 * @returns {HTMLElement} the table
 */
export function table(columns, rows, options = {}) {
  const numeric = new Set(options.numeric ?? []);
  return h('div', { className: 'table-responsive' },
    h('table', { className: 'table table-sm viz-table' },
      options.caption ? h('caption', { className: 'visually-hidden', textContent: options.caption }) : null,
      h('thead', {}, h('tr', {}, columns.map((c, i) => h('th', { scope: 'col', className: numeric.has(i) ? 'numeric' : undefined, textContent: c })))),
      h('tbody', {}, rows.length === 0
        ? h('tr', {}, h('td', { colspan: columns.length, className: 'text-muted', textContent: 'No data' }))
        : rows.map((row) => h('tr', {}, row.map((cell, i) => h('td', { className: numeric.has(i) ? 'numeric' : undefined }, cell)))))));
}

/**
 * Renders a chart card: a title, a legend, the chart, and a toggle to show the same data as a table
 * @param {HTMLElement} container - the element to render the card into
 * @param {object} options - the card options
 * @param {string} options.title - the title
 * @param {string} [options.subtitle] - the subtitle
 * @param {HTMLElement} [options.legend] - the legend
 * @param {function(HTMLElement): void} options.renderChart - renders the chart into an element
 * @param {function(): HTMLElement} options.renderTable - builds the table view
 */
export function chartCard(container, options) {
  const showTable = container.dataset.view === 'table';
  const body = h('div', { className: 'viz-body' });
  const toggle = h('button', {
    type: 'button',
    className: 'btn btn-sm btn-outline-secondary viz-toggle',
    'aria-pressed': String(showTable),
    textContent: showTable ? 'Chart' : 'Table',
    onClick: () => {
      container.dataset.view = container.dataset.view === 'table' ? 'chart' : 'table';
      chartCard(container, options);
    },
  });
  const children = [
    h('div', { className: 'viz-card-header' },
      h('div', {},
        h('h3', { className: 'viz-title', textContent: options.title }),
        options.subtitle ? h('p', { className: 'viz-subtitle', textContent: options.subtitle }) : null),
      toggle),
    showTable ? null : options.legend,
    body,
  ];
  for (const old of container.querySelectorAll('.viz-chart')) resizeObserver.unobserve(old);
  container.replaceChildren(...children.filter(Boolean));
  if (showTable) {
    body.append(options.renderTable());
  } else {
    const chartEl = h('div', { className: 'viz-chart' });
    body.append(chartEl);
    options.renderChart(chartEl);
  }
}
