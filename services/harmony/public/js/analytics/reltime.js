// Relative times for timestamp and date parameters, so a saved query or dashboard can mean "the
// last 7 days" whenever it runs, not the 7 days before it was saved. The notation is Grafana's:
//
//   now          the current time
//   now-7d       7 days ago          (units: s m h d w M y; any number of + or - steps)
//   now/d        the start of today  (rounds down to the unit; w is the week starting Monday)
//   now-1M/M     the start of last month
//   now+1d/d     the start of tomorrow
//
// Steps apply left to right. Times are UTC, the timezone queries run in. A parameter keeps the
// expression as its text, and it is resolved to a time each time the query runs.

const UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, w: 7 * 24 * 60 * 60 * 1000 };
const RELATIVE = /^now((?:[+-]\d+[smhdwMy]|\/[smhdwMy])*)$/;
const STEP = /([+-])(\d+)([smhdwMy])|\/([smhdwMy])/g;

/**
 * Whether a parameter's text is a relative time
 *
 * @param {string} text - the text
 */
export function isRelative(text) {
  return RELATIVE.test(String(text ?? '').replace(/\s+/g, ''));
}

/**
 * Adds a number of units to a time (months and years by the calendar, in UTC)
 */
function add(ms, amount, unit) {
  if (unit === 'M' || unit === 'y') {
    const d = new Date(ms);
    const months = unit === 'M' ? amount : amount * 12;
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.getTime();
  }
  return ms + amount * UNITS[unit];
}

/**
 * Rounds a time down to the start of a unit, in UTC
 */
function roundDown(ms, unit) {
  const d = new Date(ms);
  switch (unit) {
    case 'y': return Date.UTC(d.getUTCFullYear(), 0, 1);
    case 'M': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    case 'w': {
      const day = Math.floor(ms / UNITS.d) * UNITS.d;
      const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
      return day - sinceMonday * UNITS.d;
    }
    default: return Math.floor(ms / UNITS[unit]) * UNITS[unit];
  }
}

/**
 * Resolves a relative time
 *
 * @param {string} text - e.g. now-7d or now-1M/M
 * @param {number} [now] - the current time in ms
 * @returns {number|null} the time in ms, or null if the text isn't a relative time
 */
export function resolveRelative(text, now = Date.now()) {
  const compact = String(text ?? '').replace(/\s+/g, '');
  const match = RELATIVE.exec(compact);
  if (!match) return null;
  let ms = now;
  for (const [, sign, amount, unit, roundUnit] of match[1].matchAll(STEP)) {
    ms = roundUnit ? roundDown(ms, roundUnit) : add(ms, (sign === '-' ? -1 : 1) * Number(amount), unit);
  }
  return ms;
}

/**
 * Formats a time for showing what a relative time currently means
 *
 * @param {number} ms - the time
 * @param {boolean} dateOnly - whether to leave out the time of day
 * @returns {string} e.g. "Nov 12, 2026, 3:05 PM UTC"
 */
export function describeTime(ms, dateOnly = false) {
  const date = new Date(ms);
  return dateOnly
    ? date.toLocaleDateString([], { timeZone: 'UTC', dateStyle: 'medium' })
    : `${date.toLocaleString([], { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`;
}

const UNIT_NAMES = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week', M: 'month', y: 'year' };
const count = (n, unit) => `${n} ${UNIT_NAMES[unit]}${n === 1 ? '' : 's'}`;

/**
 * Splits a relative time into its steps
 *
 * @param {string} text - e.g. now-1M/M
 * @returns {Array<{amount: number, unit: string}|{round: string}>|null} the steps (an amount is
 *   negative for -), or null if the text isn't a relative time
 */
function stepsOf(text) {
  const match = RELATIVE.exec(String(text ?? '').replace(/\s+/g, ''));
  if (!match) return null;
  return [...match[1].matchAll(STEP)].map(([, sign, amount, unit, round]) => (round
    ? { round }
    : { amount: (sign === '-' ? -1 : 1) * Number(amount), unit }));
}

/**
 * A relative time that is the start of a whole unit, as an offset in that unit from the current
 * one: now/d is 0 days, now-1M/M is -1 months
 *
 * @returns {{offset: number, unit: string}|null} the offset, or null if it isn't one
 */
function periodStart(steps) {
  if (steps?.length === 1 && steps[0].round) return { offset: 0, unit: steps[0].round };
  if (steps?.length === 2 && steps[0].unit && steps[0].unit === steps[1].round) {
    return { offset: steps[0].amount, unit: steps[1].round };
  }
  return null;
}

/**
 * Names a period by its offset from the current one: today, last week, the month 3 months ago
 */
function periodName(offset, unit) {
  if (unit === 'd' && offset === 0) return 'today';
  if (unit === 'd' && offset === -1) return 'yesterday';
  if (unit === 'd' && offset === 1) return 'tomorrow';
  const name = UNIT_NAMES[unit];
  if (offset === 0) return `this ${name}`;
  if (offset === -1) return `last ${name}`;
  if (offset === 1) return `next ${name}`;
  return offset < 0 ? `the ${name} ${count(-offset, unit)} ago` : `the ${name} in ${count(offset, unit)}`;
}

/**
 * Describes a relative time in words, for panel titles: now-7d is "7 days ago", now/d is "the
 * start of today", now-1M/M is "the start of last month"
 *
 * @param {string} text - the relative time
 * @returns {string|null} the words, or null if the text isn't a relative time. One too involved
 *   to put into words is returned as written.
 */
export function describeRelative(text) {
  const steps = stepsOf(text);
  if (!steps) return null;
  if (steps.length === 0) return 'now';
  const [first, second] = steps;
  if (steps.length === 1 && first.unit) {
    return first.amount < 0 ? `${count(-first.amount, first.unit)} ago` : `${count(first.amount, first.unit)} from now`;
  }
  const period = periodStart(steps);
  if (period) return `the start of ${periodName(period.offset, period.unit)}`;
  // e.g. now-7d/h: the start of the hour 7 days ago
  if (steps.length === 2 && first.unit && second.round) {
    const when = first.amount < 0 ? `${count(-first.amount, first.unit)} ago` : `${count(first.amount, first.unit)} from now`;
    return `the start of the ${UNIT_NAMES[second.round]} ${when}`;
  }
  return String(text).trim();
}

/**
 * Describes a range of two relative times in words, for panel titles: now-7d to now is "the last
 * 7 days", now-1M/M to now/M is "last month"
 *
 * @param {string} start - the start
 * @param {string} end - the end
 * @returns {string|null} the words, or null unless both are relative times that make a familiar range
 */
export function describeRelativeRange(start, end) {
  const s = stepsOf(start);
  const e = stepsOf(end);
  if (!s || !e) return null;
  // Up to now: the last 7 days, or this month so far
  if (e.length === 0) {
    if (s.length === 1 && s[0].unit && s[0].amount < 0) {
      const n = -s[0].amount;
      return `the last ${n === 1 ? UNIT_NAMES[s[0].unit] : count(n, s[0].unit)}`;
    }
    const period = periodStart(s);
    if (period?.offset === 0) return `${periodName(0, period.unit)} so far`;
    return null;
  }
  // Whole periods: last month, or the last 7 full days
  const from = periodStart(s);
  const to = periodStart(e);
  if (!from || !to || from.unit !== to.unit || to.offset <= from.offset) return null;
  if (to.offset - from.offset === 1) return periodName(from.offset, from.unit);
  if (to.offset === 0) return `the last ${count(-from.offset, from.unit).replace(/^(\d+) /, '$1 full ')}`;
  return null;
}
