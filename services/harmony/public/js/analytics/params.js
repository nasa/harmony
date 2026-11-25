// The parameter fields of the analytics page's Query and Dashboards tabs. A timestamp or date
// parameter takes either a relative time (now-7d, now/d - see reltime.js), resolved each time the
// query runs, or a fixed ISO 8601 time, which the calendar button picks with the browser's date
// picker. Quick picks fill in relative times ("Start of today", "7 days ago"), and a pair of time
// parameters named like a range ($start/$end, $from/$to, $created_start/$created_end) is one
// range field with range presets ("Last 7 days", "Last month").
//
// Every value is kept as the text the user entered (see parameterValue in results.js), so saved
// defaults keep relative times relative. Times are UTC, the timezone queries run in.

import { describeTime, isRelative, resolveRelative } from './reltime.js';

export const isTimestampType = (type) => /^TIMESTAMP/.test(type);
export const isDateType = (type) => type === 'DATE';
const isTimeType = (type) => isTimestampType(type) || isDateType(type);

/**
 * Parses a parameter's text as a time, treating a time without a timezone as UTC
 *
 * @param {string} text - e.g. 2026-11-01T00:00:00Z, 2026-11-01 00:00, or 2026-11-01
 * @returns {Date|null} the time, or null if the text isn't one
 */
export function parseUtc(text) {
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

// Quick picks for one time: [label, relative time]. They are relative (see reltime.js), so a query
// or dashboard saved with one keeps meaning the same period whenever it runs.
export const TIME_PRESETS = [
  ['Now', 'now'],
  ['Start of today', 'now/d'],
  ['Start of yesterday', 'now-1d/d'],
  ['24 hours ago', 'now-24h'],
  ['7 days ago', 'now-7d'],
  ['30 days ago', 'now-30d'],
  ['Start of this week', 'now/w'],
  ['Start of this month', 'now/M'],
  ['Start of last month', 'now-1M/M'],
  ['Start of this year', 'now/y'],
];

// Presets for a range: [label, [start, end]]. Calendar periods end at the start of the next one,
// for queries that use `>= $start AND < $end`.
export const RANGE_PRESETS = [
  ['Last 24 hours', ['now-24h', 'now']],
  ['Last 7 days', ['now-7d', 'now']],
  ['Last 30 days', ['now-30d', 'now']],
  ['Today', ['now/d', 'now+1d/d']],
  ['Yesterday', ['now-1d/d', 'now/d']],
  ['This week', ['now/w', 'now+1w/w']],
  ['This month', ['now/M', 'now+1M/M']],
  ['Last month', ['now-1M/M', 'now/M']],
  ['This year', ['now/y', 'now+1y/y']],
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
 * Describes what a time parameter's text means, for the note under its field
 *
 * @param {string} text - the text
 * @param {string} type - the parameter's type
 * @param {number} now - the current time in ms
 * @returns {{text: string, invalid: boolean}} the description, and whether the text isn't a time
 */
export function describeValue(text, type, now) {
  const value = String(text ?? '').trim();
  if (value === '') return { text: '', invalid: false };
  if (isRelative(value)) {
    return { text: `→ ${describeTime(resolveRelative(value, now), isDateType(type))} now`, invalid: false };
  }
  const date = parseUtc(value);
  if (date) return { text: `Fixed: ${describeTime(date.getTime(), isDateType(type))}`, invalid: false };
  return { text: 'Not a time - use e.g. now-7d, now/d, or 2026-11-01T00:00:00Z', invalid: true };
}

/**
 * Builds the input for one parameter
 *
 * @param {object} parameter - the parameter
 * @param {string} id - the input's id
 * @param {object} options - see renderParameterFields
 * @returns {{element: HTMLElement, input: HTMLElement, note: HTMLElement|null, set: function(string): void}}
 *   the element to show, its input (which the label is for), the note describing a time's value,
 *   and a function that sets the text (as if entered)
 */
function parameterInput({ name, type }, id, { text, onChange, now, inherited }) {
  // What an empty field stands for, if it takes its value from elsewhere
  const from = inherited?.get(name);
  let fromText = null;
  if (from) fromText = from.text === null ? from.source : `${from.source}: ${from.text.trim() || 'NULL'}`;
  if (type === 'BOOLEAN') {
    const select = document.createElement('select');
    for (const [value, label] of [['', fromText ?? 'NULL'], ['true', 'true'], ['false', 'false']]) select.append(new Option(label, value));
    select.className = 'form-control form-control-sm';
    select.id = id;
    select.value = text.get(name) ?? '';
    select.addEventListener('change', () => onChange(name, select.value));
    return { element: select, input: select, note: null, set: (v) => { select.value = v; } };
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm';
  input.id = id;
  input.dataset.parameter = name;
  input.value = text.get(name) ?? '';
  if (!isTimeType(type)) {
    if (fromText) input.placeholder = fromText;
    else if (type.endsWith('[]')) input.placeholder = 'a, b, c';
    input.addEventListener('input', () => onChange(name, input.value));
    return { element: input, input, note: null, set: (v) => { input.value = v; } };
  }

  // A time: a relative time or a fixed one, typed or picked from the calendar
  input.classList.add('parameter-time-text');
  input.placeholder = fromText ?? (isDateType(type) ? 'now/d or 2026-11-01' : 'now-7d or 2026-11-01T00:00:00Z');
  input.spellcheck = false;
  const note = document.createElement('div');
  note.className = 'parameter-time-note';
  note.id = `${id}-note`;
  input.setAttribute('aria-describedby', note.id);
  const update = () => {
    const inheriting = input.value.trim() === '' && Boolean(from?.text?.trim());
    const { text: description, invalid } = describeValue(inheriting ? from.text : input.value, type, now());
    note.textContent = inheriting ? `${from.source}: ${description}` : description;
    note.classList.toggle('is-invalid', invalid);
    input.setAttribute('aria-invalid', String(invalid));
  };
  const set = (value) => {
    input.value = value;
    onChange(name, value);
    update();
  };
  input.addEventListener('input', () => {
    onChange(name, input.value);
    update();
  });

  // The calendar button opens the browser's picker on a hidden date input, for a fixed time
  const picker = document.createElement('input');
  picker.type = isDateType(type) ? 'date' : 'datetime-local';
  if (!isDateType(type)) picker.step = '1'; // to the second
  picker.className = 'parameter-picker';
  picker.tabIndex = -1;
  picker.setAttribute('aria-hidden', 'true');
  picker.addEventListener('change', () => {
    const picked = inputToText(picker.value, type);
    if (picked) set(picked);
    picker.classList.remove('is-visible');
  });
  picker.addEventListener('blur', () => picker.classList.remove('is-visible'));
  const calendar = document.createElement('button');
  calendar.type = 'button';
  calendar.className = 'btn btn-sm btn-outline-secondary parameter-calendar';
  calendar.title = isDateType(type) ? 'Pick a fixed date' : 'Pick a fixed date and time';
  calendar.setAttribute('aria-label', `${calendar.title} for $${name}`);
  calendar.innerHTML = '<i class="bi bi-calendar3" aria-hidden="true"></i>';
  calendar.addEventListener('click', () => {
    // Start the calendar at what the field means now
    const current = input.value.trim();
    picker.value = isRelative(current)
      ? textToInput(new Date(resolveRelative(current, now())).toISOString(), type)
      : textToInput(current, type);
    try {
      picker.showPicker();
    } catch {
      // Browsers without showPicker show the date input itself instead
      picker.classList.add('is-visible');
      picker.focus();
    }
  });
  const pickerWrap = document.createElement('span');
  pickerWrap.className = 'parameter-picker-wrap';
  pickerWrap.append(calendar, picker);

  const box = document.createElement('div');
  box.className = 'parameter-time-input';
  box.append(input, pickerWrap);
  update();
  return { element: box, input, note, set };
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
 * @param {Map<string, {text: string, source: string}>} [options.inherited] - for fields whose
 *   empty value means "take it from elsewhere": that value as written (null if it varies), and
 *   where it's from (e.g. "Query"), shown in the empty field
 */
export function renderParameterFields(container, parameters, options) {
  const opts = { ...options, now: options.now ?? Date.now };
  const { idPrefix } = opts;
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
      const inputs = [start, end].map((p) => parameterInput(p, `${idPrefix}-${p.name}`, opts));
      [start, end].forEach((p, i) => {
        const part = document.createElement('div');
        part.append(fieldLabel(inputs[i].input.id, p.name, p.type), inputs[i].element, inputs[i].note);
        ends.append(part);
      });
      const presets = quickPick(`Quick pick for $${start.name} and $${end.name}`, RANGE_PRESETS, ([from, to]) => {
        inputs[0].set(from);
        inputs[1].set(to);
      });
      wrapper.append(ends, presets);
    } else {
      const field = parameterInput(parameter, `${idPrefix}-${parameter.name}`, opts);
      wrapper.append(fieldLabel(field.input.id, parameter.name, parameter.type));
      if (isTimeType(parameter.type)) {
        const row = document.createElement('div');
        row.className = 'parameter-time';
        row.append(field.element, quickPick(`Quick pick for $${parameter.name}`, TIME_PRESETS, (preset) => field.set(preset)));
        wrapper.append(row, field.note);
      } else {
        wrapper.append(field.element);
      }
    }
    fields.push(wrapper);
  }
  container.replaceChildren(...fields);
}
