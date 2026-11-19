// Dashboard panel titles, which can show the panel's parameter values, in the style of Grafana's
// variables:
//
//   $start or ${start}   the value in words: "7 days ago", "the start of today", "Nov 1, 2026"
//   ${start:raw}         the value as written: now-7d
//   $__range             the panel's time range in words: "the last 7 days", "last month",
//                        "Nov 1, 2026 to Nov 8, 2026". The range is the query's first pair of
//                        range parameters (e.g. $start and $end - see findRanges in params.js),
//                        or else a lone start parameter ($start, $since, $created_from, ...) up to now.
//
// So "Errors in $__range" stays true whatever the panel's range is set to. A name the panel's query
// has no parameter for is left as written (titleVariables lists those, for the panel editor).

import { findRanges, isDateType, parseUtc } from './params.js';
import { describeRelative, describeRelativeRange, describeTime } from './reltime.js';

const VARIABLE = /\$\{(\w+)(?::(raw))?\}|\$(\w+)/g;
const isTimeType = (type) => /^TIMESTAMP/.test(type) || isDateType(type);

/**
 * Describes one value in words
 *
 * @param {string} text - the value as written ('' for NULL)
 * @param {string} type - its parameter's type
 * @returns {string} the words
 */
export function describeParameter(text, type) {
  const value = String(text ?? '').trim();
  if (value === '') return 'NULL';
  if (!isTimeType(type)) return value;
  const relative = describeRelative(value);
  if (relative) return relative;
  const date = parseUtc(value);
  if (!date) return value;
  // A date, or a time at midnight, is shown as just the date
  const dateOnly = isDateType(type) || date.getTime() % (24 * 60 * 60 * 1000) === 0;
  return describeTime(date.getTime(), dateOnly);
}

/**
 * Describes a range in words: a familiar relative range by name ("the last 7 days"), otherwise
 * both ends ("Nov 1, 2026 to now")
 *
 * @param {string} start - the start as written
 * @param {string} end - the end as written
 * @param {string} type - the parameters' type
 * @returns {string} the words
 */
export function describeRange(start, end, type) {
  return describeRelativeRange(start, end) ?? `${describeParameter(start, type)} to ${describeParameter(end, type)}`;
}

// A time parameter named as the start of a range, alone or as part of a name split by underscores
const START_NAME = /(^|_)(start|from|begin|since|after)(_|$)/i;

/**
 * Finds a query's time range: its first pair of range parameters, or else a lone start parameter
 * (whose range runs up to now)
 *
 * @param {Array<{name: string, type: string}>} parameters - the query's parameters
 * @returns {[object, object|null]|null} the start and end parameters (null for up to now), or null
 */
function rangeOf(parameters) {
  const [pair] = findRanges(parameters);
  if (pair) return pair;
  const start = parameters.find((p) => isTimeType(p.type) && START_NAME.test(p.name));
  return start ? [start, null] : null;
}

/**
 * Fills in a panel title's variables
 *
 * @param {string} title - the title as written
 * @param {Array<{name: string, type: string}>} parameters - the panel's query's parameters
 * @param {function(string): string} textOf - gets a parameter's value for the panel, as written
 * @returns {string} the title
 */
export function interpolateTitle(title, parameters, textOf) {
  const types = new Map(parameters.map((p) => [p.name, p.type]));
  return title.replace(VARIABLE, (whole, braced, raw, bare) => {
    const name = braced ?? bare;
    if (name === '__range') {
      const range = rangeOf(parameters);
      if (!range) return whole;
      const [start, end] = range;
      if (end) return describeRange(textOf(start.name), textOf(end.name), start.type);
      // Up to now: "the last 7 days", or else "since Nov 1, 2026"
      return describeRelativeRange(textOf(start.name), 'now') ?? `since ${describeParameter(textOf(start.name), start.type)}`;
    }
    if (!types.has(name)) return whole;
    return raw ? (textOf(name).trim() || 'NULL') : describeParameter(textOf(name), types.get(name));
  });
}

/**
 * Checks a title's variables against a panel's query
 *
 * @param {string} title - the title as written
 * @param {Array<{name: string, type: string}>} parameters - the panel's query's parameters
 * @returns {string[]} the variables that can't be filled in, as written (e.g. "$end", "$__range")
 */
export function titleVariables(title, parameters) {
  const names = new Set(parameters.map((p) => p.name));
  const missing = [];
  for (const [whole, braced, , bare] of title.matchAll(VARIABLE)) {
    const name = braced ?? bare;
    const known = name === '__range' ? rangeOf(parameters) !== null : names.has(name);
    if (!known && !missing.includes(whole)) missing.push(whole);
  }
  return missing;
}
