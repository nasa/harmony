// The parameter fields of the analytics page's Query and Dashboards tabs. Timestamp and date
// parameters get the browser's date/time picker, with quick picks ("Start of today", "7 days ago"),
// and a pair of them named like a range ($start/$end, $from/$to, $created_start/$created_end) is
// shown as one range field with range presets ("Last 7 days", "Last month").
//
// Every value is kept as text in the form the analytics query service binds (see parameterValue in
// results.js) - timestamps as ISO 8601 UTC, e.g. 2026-11-01T00:00:00Z - so saved defaults don't
// depend on the picker. Times are UTC, the timezone queries run in.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const isTimestampType = (type) => /^TIMESTAMP/.test(type);
export const isDateType = (type) => type === 'DATE';
const isTimeType = (type) => isTimestampType(type) || isDateType(type);

/**
 * Parses a parameter's text as a time, treating a time without a timezone as UTC
 *
 * @param {string} text - e.g. 2026-11-01T00:00:00Z, 2026-11-01 00:00, or 2026-11-01
 * @returns {Date|null} the time, or null if the text isn't one
 */
function parseUtc(text) {
  let iso = text.trim().replace(' ', 'T');
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += 'Z';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converts a parameter's text to the value of its date or datetime-local input
 *
 * @param {string} text - the text
 * @param {string} type - the parameter's type
 * @returns {string} the input's value ('' if the text isn't a time)
 */
export function textToInput(text, type) {
  const date = text ? parseUtc(text) : null;
  if (!date) return '';
  const iso = date.toISOString();
  return isDateType(type) ? iso.slice(0, 10) : iso.slice(0, 19);
}

/**
 * Converts the value of a date or datetime-local input to a parameter's text
 *
 * @param {string} value - the input's value, e.g. 2026-11-01T08:30 or 2026-11-01
 * @param {string} type - the parameter's type
 * @returns {string} the text, e.g. 2026-11-01T08:30:00Z ('' for no value)
 */
export function inputToText(value, type) {
  if (!value) return '';
  if (isDateType(type)) return value;
  return `${value.length === 16 ? `${value}:00` : value}Z`;
}

/**
 * Formats a time as a parameter's text
 */
function timeText(ms, type) {
  const iso = new Date(ms).toISOString();
  return isDateType(type) ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

// Calendar boundaries in UTC
const startOfDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
const startOfMonth = (ms, monthsAhead = 0) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsAhead, 1);
};
const startOfYear = (ms, yearsAhead = 0) => Date.UTC(new Date(ms).getUTCFullYear() + yearsAhead, 0, 1);

// Quick picks for one time: [label, the time given now]
export const TIME_PRESETS = [
  ['Now', (now) => now],
  ['Start of today', (now) => startOfDay(now)],
  ['Start of yesterday', (now) => startOfDay(now) - DAY_MS],
  ['24 hours ago', (now) => now - 24 * HOUR_MS],
  ['7 days ago', (now) => now - 7 * DAY_MS],
  ['30 days ago', (now) => now - 30 * DAY_MS],
  ['Start of this month', (now) => startOfMonth(now)],
  ['Start of last month', (now) => startOfMonth(now, -1)],
  ['Start of this year', (now) => startOfYear(now)],
];

// Presets for a range: [label, [start, end] given now]. Calendar periods end at the start of the
// next one, for queries that use `>= $start AND < $end`.
export const RANGE_PRESETS = [
  ['Last 24 hours', (now) => [now - 24 * HOUR_MS, now]],
  ['Last 7 days', (now) => [now - 7 * DAY_MS, now]],
  ['Last 30 days', (now) => [now - 30 * DAY_MS, now]],
  ['Today', (now) => [startOfDay(now), startOfDay(now) + DAY_MS]],
  ['Yesterday', (now) => [startOfDay(now) - DAY_MS, startOfDay(now)]],
  ['This month', (now) => [startOfMonth(now), startOfMonth(now, 1)]],
  ['Last month', (now) => [startOfMonth(now, -1), startOfMonth(now)]],
  ['This year', (now) => [startOfYear(now), startOfYear(now, 1)]],
];

// The words that mark the start of a range, and the word for its end
const RANGE_WORDS = { start: 'end', from: 'to', begin: 'end', since: 'until', after: 'before' };

/**
 * Finds the pairs of time parameters that are the two ends of a range, by name: start/end,
 * from/to, begin/end, since/until or after/before, alone or as part of a name split by
 * underscores (created_start/created_end, start_time/end_time)
 *
 * @param {Array<{name: string, type: string}>} parameters - the parameters
 * @returns {Array<[object, object]>} the [start, end] pairs
 */
export function findRanges(parameters) {
  const times = parameters.filter((p) => isTimeType(p.type));
  const byName = new Map(times.map((p) => [p.name.toLowerCase(), p]));
  const used = new Set();
  const ranges = [];
  // The parameter that ends the range a name starts, if there is one: the name with one of its
  // words swapped for the matching end word
  const endFor = (start) => {
    const words = start.name.toLowerCase().split('_');
    return words
      .map((word, i) => RANGE_WORDS[word] && byName.get([...words.slice(0, i), RANGE_WORDS[word], ...words.slice(i + 1)].join('_')))
      .find((end) => end && end !== start && !used.has(end.name));
  };
  for (const start of times) {
    const end = !used.has(start.name) && endFor(start);
    if (end) {
      ranges.push([start, end]);
      used.add(start.name).add(end.name);
    }
  }
  return ranges;
}

/**
 * Builds a parameter's label: its name and type
 */
function fieldLabel(forId, name, type) {
  const label = document.createElement('label');
  label.htmlFor = forId;
  label.append(`$${name} `);
  const typeText = document.createElement('span');
  typeText.className = 'parameter-type';
  typeText.textContent = isTimeType(type) ? `${type} · UTC` : type;
  label.append(typeText);
  return label;
}

/**
 * Builds the input for one parameter
 *
 * @param {object} parameter - the parameter
 * @param {string} id - the input's id
 * @param {object} options - see renderParameterFields
 * @returns {HTMLElement} the input
 */
function parameterInput({ name, type }, id, { text, onChange }) {
  let input;
  if (type === 'BOOLEAN') {
    input = document.createElement('select');
    for (const [value, label] of [['', 'NULL'], ['true', 'true'], ['false', 'false']]) input.append(new Option(label, value));
    input.value = text.get(name) ?? '';
    input.addEventListener('change', () => onChange(name, input.value));
  } else if (isTimeType(type)) {
    input = document.createElement('input');
    input.type = isDateType(type) ? 'date' : 'datetime-local';
    if (!isDateType(type)) input.step = '1'; // to the second
    input.value = textToInput(text.get(name) ?? '', type);
    input.addEventListener('input', () => onChange(name, inputToText(input.value, type)));
  } else {
    input = document.createElement('input');
    input.type = 'text';
    if (type.endsWith('[]')) input.placeholder = 'a, b, c';
    input.value = text.get(name) ?? '';
    input.addEventListener('input', () => onChange(name, input.value));
  }
  input.className = 'form-control form-control-sm';
  input.id = id;
  input.dataset.parameter = name;
  return input;
}

/**
 * Builds a quick-pick menu, which applies a preset when one is chosen and then goes back to its
 * prompt
 *
 * @param {string} label - describes it, for screen readers
 * @param {Array<[string, function]>} presets - the presets
 * @param {function(function): void} apply - applies a chosen preset
 * @returns {HTMLSelectElement} the menu
 */
function quickPick(label, presets, apply) {
  const select = document.createElement('select');
  select.className = 'form-control form-control-sm parameter-quick-pick';
  select.setAttribute('aria-label', label);
  select.append(new Option('Quick pick…', ''));
  presets.forEach(([text], i) => select.append(new Option(text, String(i))));
  select.addEventListener('change', () => {
    if (select.value === '') return;
    apply(presets[Number(select.value)][1]);
    select.value = '';
  });
  return select;
}

/**
 * Shows a field for each parameter, keeping the text already entered, with date pickers and quick
 * picks for times and one field for each range
 *
 * @param {HTMLElement} container - the element to fill
 * @param {Array<{name: string, type: string}>} parameters - the parameters
 * @param {object} options - the options
 * @param {Map<string, string>} options.text - each parameter's text, by name
 * @param {function(string, string): void} options.onChange - called with a parameter's name and new
 *   text whenever it changes (it should update options.text)
 * @param {string} options.idPrefix - makes the inputs' ids unique on the page
 * @param {function(): number} [options.now] - the current time in ms, for the presets
 */
export function renderParameterFields(container, parameters, options) {
  const { idPrefix, onChange } = options;
  const now = options.now ?? Date.now;
  const ranges = findRanges(parameters);
  const inRange = new Map(ranges.flatMap(([start, end]) => [[start.name, [start, end]], [end.name, [start, end]]]));
  const fields = [];

  // A range's end is drawn with its start
  for (const parameter of parameters.filter((p) => inRange.get(p.name)?.[1] !== p)) {
    const range = inRange.get(parameter.name);
    const wrapper = document.createElement('div');
    if (range) {
      // One field for the range: both ends, and presets that set them together
      const [start, end] = range;
      wrapper.className = 'parameter-range';
      const ends = document.createElement('div');
      ends.className = 'parameter-range-ends';
      const inputs = [start, end].map((p) => parameterInput(p, `${idPrefix}-${p.name}`, options));
      [start, end].forEach((p, i) => {
        const part = document.createElement('div');
        part.append(fieldLabel(inputs[i].id, p.name, p.type), inputs[i]);
        ends.append(part);
      });
      const presets = quickPick(`Quick pick for $${start.name} and $${end.name}`, RANGE_PRESETS, (preset) => {
        preset(now()).forEach((ms, i) => {
          const p = [start, end][i];
          const text = timeText(ms, p.type);
          inputs[i].value = textToInput(text, p.type);
          onChange(p.name, text);
        });
      });
      wrapper.append(ends, presets);
    } else {
      const input = parameterInput(parameter, `${idPrefix}-${parameter.name}`, options);
      wrapper.append(fieldLabel(input.id, parameter.name, parameter.type));
      if (isTimeType(parameter.type)) {
        const row = document.createElement('div');
        row.className = 'parameter-time';
        row.append(input, quickPick(`Quick pick for $${parameter.name}`, TIME_PRESETS, (preset) => {
          const text = timeText(preset(now()), parameter.type);
          input.value = textToInput(text, parameter.type);
          onChange(parameter.name, text);
        }));
        wrapper.append(row);
      } else {
        wrapper.append(input);
      }
    }
    fields.push(wrapper);
  }
  container.replaceChildren(...fields);
}
