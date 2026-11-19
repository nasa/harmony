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
