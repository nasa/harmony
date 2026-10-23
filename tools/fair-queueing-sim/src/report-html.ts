import { Summary } from './metrics';
import { comparisonTables } from './report';
import { formatDuration } from './scenario';
import type { Sample } from './simulation';

//
// A self-contained HTML version of the comparison report. For each scenario and service it
// draws, per policy, a stacked area chart of how many pods were running each user's work over
// time - the most direct picture of how a policy shares a service - on a shared time axis so
// the policies can be compared side by side.
//

export interface ComparedRun {
  summary: Summary;
  samples: Sample[];
}

// categorical slots, in order (validated for adjacent-pair CVD separation in both modes)
const LIGHT_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const DARK_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_LIGHT = '#898781';
const OTHER_DARK = '#898781';
const MAX_SERIES = 8;
const MAX_POINTS = 360;
const TABLE_STEP_MS = 10 * 60_000;

interface ChartSpec {
  id: string;
  title: string;
  pods: number;
  xMaxMin: number;
  // minutes since the start, and busy pods per legend entry at each time
  t: number[];
  series: number[][];
}

/**
 * Escapes text for inclusion in HTML.
 *
 * @param text - the text
 * @returns the escaped text
 */
function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
}

/**
 * Picks the legend entries for a scenario: users in order of their first job, with any past the
 * eighth folded into "other".
 *
 * @param summary - any run's summary for the scenario
 * @returns the legend entry names and a function mapping a user to its entry index
 */
function legendFor(summary: Summary): { names: string[]; indexOf: (user: string) => number } {
  const users = summary.users.map((u) => u.user);
  if (users.length <= MAX_SERIES) {
    return { names: users, indexOf: (u) => users.indexOf(u) };
  }
  const kept = users.slice(0, MAX_SERIES - 1);
  return { names: [...kept, 'other'], indexOf: (u) => (kept.includes(u) ? kept.indexOf(u) : MAX_SERIES - 1) };
}

/**
 * Busy pods per legend entry at each sample for one service.
 *
 * @param samples - the run's samples
 * @param service - the service name
 * @param entries - number of legend entries
 * @param indexOf - maps a user to its legend entry
 * @returns sample times (ms) and values per entry
 */
function busySeries(
  samples: Sample[], service: string, entries: number, indexOf: (user: string) => number,
): { t: number[]; values: number[][] } {
  const t: number[] = [];
  const values: number[][] = Array.from({ length: entries }, () => []);
  for (const sample of samples) {
    const s = sample.services.find((x) => x.service === service);
    if (!s) continue;
    t.push(sample.t);
    const row = new Array(entries).fill(0);
    for (const [user, n] of Object.entries(s.busyByUser)) row[indexOf(user)] += n;
    row.forEach((v, i) => values[i].push(v));
  }
  return { t, values };
}

/**
 * Averages a series into at most MAX_POINTS buckets.
 *
 * @param t - sample times (ms)
 * @param values - values per entry
 * @returns bucket start times (minutes) and averaged values
 */
function downsample(t: number[], values: number[][]): { t: number[]; series: number[][] } {
  const size = Math.max(1, Math.ceil(t.length / MAX_POINTS));
  const outT: number[] = [];
  const series = values.map(() => []);
  for (let i = 0; i < t.length; i += size) {
    outT.push(Math.round((t[i] / 60_000) * 100) / 100);
    values.forEach((v, k) => {
      const chunk = v.slice(i, i + size);
      series[k].push(Math.round((chunk.reduce((a, b) => a + b, 0) / chunk.length) * 100) / 100);
    });
  }
  return { t: outT, series };
}

/**
 * Renders a static table of busy pods per user at regular intervals (the chart's table view).
 *
 * @param t - sample times (ms)
 * @param values - values per entry
 * @param names - legend entry names
 * @returns the HTML table
 */
function tableView(t: number[], values: number[][], names: string[]): string {
  const rows: string[] = [];
  let next = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < next) continue;
    next = t[i] + TABLE_STEP_MS;
    rows.push(`<tr><td>${esc(formatDuration(t[i]))}</td>${values.map((v) => `<td>${v[i]}</td>`).join('')}</tr>`);
  }
  return `<table class="data"><thead><tr><th>time</th>${names.map((n) => `<th>${esc(n)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table>`;
}

/**
 * Renders the HTML comparison report.
 *
 * @param scenarios - for each scenario, its runs (one per policy)
 * @returns the HTML document
 */
export function renderComparisonHtml(scenarios: ComparedRun[][]): string {
  const charts: ChartSpec[] = [];
  const sections: string[] = [];
  const policies = [...new Set(scenarios.flatMap((runs) => runs.map((r) => r.summary.policy)))];

  scenarios.forEach((runs, si) => {
    const first = runs[0].summary;
    const legend = legendFor(first);
    const xMaxMs = Math.max(...runs.map((r) => r.summary.endMs));
    const parts: string[] = [];
    parts.push(`<section><h2>${esc(first.scenario)}</h2>`);
    if (first.description) parts.push(`<p class="desc">${esc(first.description)}</p>`);
    parts.push('<ul class="legend" aria-label="Users">' + legend.names.map((n, i) => (
      `<li><span class="swatch" style="background: var(--s${i === MAX_SERIES - 1 && n === 'other' ? 'o' : i})"></span>${esc(n)}</li>`
    )).join('') + '</ul>');

    for (const svc of first.services) {
      parts.push(`<h3>${esc(svc.service)} <span class="muted">· ${svc.pods} pods · pods running each user's work</span></h3>`);
      parts.push(`<div class="multiples" style="--cols: ${runs.length}">`);
      const tables: string[] = [];
      for (const [ri, run] of runs.entries()) {
        const id = `c${si}-${svc.service.replace(/[^a-z0-9]/gi, '')}-${ri}`;
        const { t, values } = busySeries(run.samples, svc.service, legend.names.length, legend.indexOf);
        const ds = downsample(t, values);
        charts.push({
          id, title: run.summary.policy, pods: svc.pods, xMaxMin: xMaxMs / 60_000, t: ds.t, series: ds.series,
        });
        parts.push(`<figure><figcaption>${esc(run.summary.policy)}</figcaption><div class="chart" id="${id}" ` +
          `tabindex="0" role="img" aria-label="${esc(`${svc.service} pods per user over time, ${run.summary.policy}`)}"></div></figure>`);
        tables.push(`<h4>${esc(run.summary.policy)}</h4>${tableView(t, values, legend.names)}`);
      }
      parts.push('</div>');
      parts.push(`<details><summary>Table view</summary>${tables.join('')}</details>`);
    }

    const { tables, note } = comparisonTables(runs.map((r) => r.summary));
    for (const t of tables) {
      parts.push(`<table class="data"><caption>${esc(t.caption)}</caption><thead><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    }
    if (note) parts.push(`<p class="muted">${esc(note)}</p>`);
    parts.push('</section>');
    sections.push(parts.join('\n'));
  });

  const seriesVars = (colors: string[], other: string): string => (
    colors.map((c, i) => `--s${i}: ${c};`).join(' ') + ` --so: ${other};`
  );
  const dark = `color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); ${seriesVars(DARK_SERIES, OTHER_DARK)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fair Queueing Comparison</title>
<style>
:root {
  color-scheme: light; --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10); ${seriesVars(LIGHT_SERIES, OTHER_LIGHT)}
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }
:root[data-theme="dark"] { ${dark} }
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 0 0 4px; }
h3 { font-size: 14px; margin: 20px 0 8px; font-weight: 600; }
h4 { font-size: 13px; margin: 12px 0 4px; }
section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin: 20px 0; }
.desc, .muted { color: var(--ink-2); }
.muted { font-weight: 400; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none; padding: 0; margin: 12px 0 0; color: var(--ink-2); }
.legend li { display: flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.multiples { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 16px; }
@media (max-width: 720px) { .multiples { grid-template-columns: minmax(0, 1fr); } }
figure { margin: 0; min-width: 0; }
figcaption { color: var(--ink-2); font-weight: 600; margin-bottom: 4px; }
.chart { position: relative; width: 100%; outline: none; }
.chart:focus-visible { box-shadow: 0 0 0 2px var(--s0); border-radius: 4px; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.tooltip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); font-size: 12px; white-space: nowrap; z-index: 2; }
.tooltip .time { color: var(--ink-2); margin-bottom: 2px; }
.tooltip .row { display: flex; align-items: center; gap: 6px; }
.tooltip .key { width: 10px; height: 2px; border-radius: 1px; display: inline-block; }
.tooltip strong { min-width: 2.5em; text-align: right; font-variant-numeric: tabular-nums; }
.tooltip .name { color: var(--ink-2); }
details { margin: 8px 0 0; color: var(--ink-2); }
details summary { cursor: pointer; }
.table-wrap, details { overflow-x: auto; }
table.data { border-collapse: collapse; margin: 16px 0 0; font-size: 13px; font-variant-numeric: tabular-nums; }
table.data caption { text-align: left; font-weight: 600; color: var(--ink); padding-bottom: 4px; }
table.data th, table.data td { text-align: left; padding: 3px 12px 3px 0; border-bottom: 1px solid var(--grid); }
table.data th { color: var(--ink-2); font-weight: 600; }
section > table.data { display: block; overflow-x: auto; max-width: 100%; }
</style>
</head>
<body>
<main>
<h1>Fair queueing comparison</h1>
<p class="desc">Policies: ${policies.map(esc).join(', ')}. Generated by tools/fair-queueing-sim.</p>
${sections.join('\n')}
</main>
<script type="application/json" id="fq-data">${JSON.stringify(charts).replace(/</g, '\\u003c')}</script>
<script>
(() => {
  const charts = JSON.parse(document.getElementById('fq-data').textContent);
  const NS = 'http://www.w3.org/2000/svg';
  const H = 180, M = { l: 32, r: 8, t: 8, b: 22 };
  const el = (name, attrs) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const fmt = (min) => {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
  };
  const legendNames = (chart) => {
    const section = document.getElementById(chart.id).closest('section');
    return [...section.querySelectorAll('.legend li')].map((li) => li.textContent);
  };

  function draw(chart) {
    const host = document.getElementById(chart.id);
    host.textContent = '';
    const W = Math.max(240, host.clientWidth);
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const x = (min) => M.l + (min / chart.xMaxMin) * iw;
    const y = (v) => M.t + ih - (v / chart.pods) * ih;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H });

    // grid and y ticks
    for (const v of [0, Math.round(chart.pods / 2), chart.pods]) {
      svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), stroke: v === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
      const label = el('text', { x: M.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
      label.textContent = v;
      svg.appendChild(label);
    }
    // x ticks: hourly, or every 15 minutes for short runs
    const step = chart.xMaxMin > 180 ? Math.ceil(chart.xMaxMin / 360) * 60 : chart.xMaxMin > 60 ? 30 : 15;
    for (let m = 0; m <= chart.xMaxMin; m += step) {
      const label = el('text', { x: x(m), y: H - 6, 'text-anchor': m === 0 ? 'start' : 'middle' });
      label.textContent = fmt(m);
      svg.appendChild(label);
    }

    // stacked areas, bottom series first
    const n = chart.t.length;
    let lower = new Array(n).fill(0);
    chart.series.forEach((values, k) => {
      if (!values.some((v) => v > 0)) { return; }
      const upper = values.map((v, i) => lower[i] + v);
      const color = 'var(--s' + (k === 7 && legendNames(chart)[7] === 'other' ? 'o' : k) + ')';
      const top = upper.map((v, i) => x(chart.t[i]) + ',' + y(v));
      const bottom = lower.map((v, i) => x(chart.t[i]) + ',' + y(v)).reverse();
      svg.appendChild(el('polygon', { points: top.concat(bottom).join(' '), fill: color, 'fill-opacity': 0.22 }));
      svg.appendChild(el('polyline', { points: top.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
      lower = upper;
    });

    // hover layer: crosshair + tooltip listing every user at that time
    const cross = el('line', { y1: M.t, y2: M.t + ih, stroke: 'var(--muted)', 'stroke-width': 1, visibility: 'hidden' });
    svg.appendChild(cross);
    const hit = el('rect', { x: M.l, y: 0, width: iw, height: H, fill: 'transparent' });
    svg.appendChild(hit);
    host.appendChild(svg);
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.style.visibility = 'hidden';
    host.appendChild(tip);
    const names = legendNames(chart);

    let current = -1;
    const show = (i) => {
      if (i < 0 || i >= n) { return; }
      current = i;
      const px = x(chart.t[i]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = fmt(chart.t[i]);
      tip.appendChild(time);
      chart.series.forEach((values, k) => {
        if (!values.some((v) => v > 0)) { return; }
        const row = document.createElement('div');
        row.className = 'row';
        const key = document.createElement('span');
        key.className = 'key';
        key.style.background = 'var(--s' + (k === 7 && names[7] === 'other' ? 'o' : k) + ')';
        const value = document.createElement('strong');
        value.textContent = values[i];
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = names[k];
        row.append(key, value, name);
        tip.appendChild(row);
      });
      tip.style.visibility = 'visible';
      const left = px + 12 + tip.offsetWidth > W ? px - 12 - tip.offsetWidth : px + 12;
      tip.style.left = left + 'px';
      tip.style.top = M.t + 'px';
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.style.visibility = 'hidden'; };
    const nearest = (px) => {
      const min = ((px - M.l) / iw) * chart.xMaxMin;
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(chart.t[i] - min) < Math.abs(chart.t[best] - min)) best = i;
      return best;
    };
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      show(nearest(((e.clientX - r.left) / r.width) * W));
    });
    hit.addEventListener('pointerleave', hide);
    host.onkeydown = (e) => {
      if (e.key === 'ArrowRight') { show(Math.min(n - 1, current + 1)); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { show(Math.max(0, current - 1)); e.preventDefault(); }
      if (e.key === 'Escape') hide();
    };
    host.onfocus = () => show(current < 0 ? 0 : current);
    host.onblur = hide;
  }

  const drawAll = () => charts.forEach(draw);
  drawAll();
  let pending;
  window.addEventListener('resize', () => { clearTimeout(pending); pending = setTimeout(drawAll, 100); });
})();
</script>
</body>
</html>
`;
}
