// Rendering query results, exporting them as CSV, and turning parameter form values into the
// values the analytics query service binds. All text is inserted with textContent - values come
// from the database.
import { isRelative, resolveRelative } from './reltime.js';

const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/;
const INTEGER_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT)$/;
const TIME_TYPE = /^(TIMESTAMP|DATE$)/;

/**
 * Formats a result value for display and CSV
 *
 * @param {*} value - the value
 * @returns {string|null} the text, or null for NULL
 */
export function formatValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Renders a result into a table
 *
 * @param {HTMLTableElement} table - the table to fill
 * @param {{columns: Array<{name: string, type: string}>, rows: Array<Array<*>>}} result - the result
 */
export function renderTable(table, { columns, rows }) {
  const numeric = columns.map((c) => NUMERIC_TYPE.test(c.type));
  const head = document.createElement('thead');
  const headRow = head.insertRow();
  columns.forEach((column, i) => {
    const th = document.createElement('th');
    th.scope = 'col';
    if (numeric[i]) th.className = 'numeric';
    th.append(column.name);
    const type = document.createElement('span');
    type.className = 'column-type';
    type.textContent = column.type;
    th.append(type);
    headRow.append(th);
  });

  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = body.insertRow();
    row.forEach((value, i) => {
      const td = tr.insertCell();
      const text = formatValue(value);
      if (text === null) {
        td.className = 'null';
        td.textContent = 'NULL';
      } else {
        if (numeric[i]) td.className = 'numeric';
        td.textContent = text;
        td.title = text;
      }
    });
  }
  table.replaceChildren(head, body);
}

/**
 * Quotes a CSV field if it needs it
 *
 * @param {string|null} text - the field
 * @returns {string} the CSV field
 */
function csvField(text) {
  if (text === null) return '';
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Converts a result to CSV
 *
 * @param {{columns: Array<{name: string}>, rows: Array<Array<*>>}} result - the result
 * @returns {string} the CSV, with a header row
 */
export function toCsv({ columns, rows }) {
  const lines = [columns.map((c) => csvField(c.name)).join(',')];
  for (const row of rows) {
    lines.push(row.map((value) => csvField(formatValue(value))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Downloads text as a file
 *
 * @param {string} text - the contents
 * @param {string} filename - the file name
 * @param {string} type - the media type
 */
export function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Converts one parameter form value to the value the service binds, by the parameter's type
 *
 * @param {string} text - what was entered
 * @param {string} type - the parameter's DuckDB type, e.g. BIGINT or VARCHAR[]
 * @param {number} [now] - the current time in ms, for resolving relative times
 * @returns {*} the value (null when nothing was entered)
 * @throws {Error} if the value isn't valid for the type
 */
export function parameterValue(text, type, now = Date.now()) {
  if (type.endsWith('[]')) {
    if (text.trim() === '') return null;
    const elementType = type.slice(0, -2);
    return text.split(',').map((part) => parameterValue(part.trim(), elementType, now));
  }
  // A relative time (e.g. now-7d) is resolved now, so a saved query always means the latest period
  if (TIME_TYPE.test(type) && isRelative(text)) {
    const iso = new Date(resolveRelative(text, now)).toISOString();
    return type === 'DATE' ? iso.slice(0, 10) : iso;
  }
  if (type === 'BOOLEAN') {
    if (text === '') return null;
    return text === 'true';
  }
  if (NUMERIC_TYPE.test(type)) {
    if (text.trim() === '') return null;
    const n = Number(text);
    if (!Number.isFinite(n) || (INTEGER_TYPE.test(type) && !Number.isInteger(n))) {
      throw new Error(`"${text}" is not a valid ${type}`);
    }
    return n;
  }
  return text === '' ? null : text;
}

/**
 * Converts a parameter form value to the default saved with a query or dashboard. Like
 * parameterValue, except that times are kept as written: a relative time (now-7d) is saved as
 * such, so the saved query keeps meaning the latest period rather than the one when it was saved.
 *
 * @param {string} text - what was entered
 * @param {string} type - the parameter's DuckDB type
 * @returns {*} the value to save (null when nothing was entered)
 * @throws {Error} if the value isn't valid for the type
 */
export function parameterDefault(text, type) {
  const elementType = type.replace(/\[\]$/, '');
  if (!TIME_TYPE.test(elementType)) return parameterValue(text, type);
  if (text.trim() === '') return null;
  return type.endsWith('[]') ? text.split(',').map((part) => part.trim()) : text.trim();
}
