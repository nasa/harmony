// The relative time help dialog: shows what each example means right now, and what a time typed
// into its try-it box works out to

import { $ } from './common.js';
import { describeTime, resolveRelative } from './reltime.js';

/**
 * Shows what the try-it box's text works out to
 *
 * @param {number} now - the time the dialog was opened, in ms
 */
function showTry(now) {
  const text = $('timeHelpTry').value.trim();
  const ms = resolveRelative(text, now);
  const result = $('timeHelpResult');
  result.classList.toggle('text-danger', text !== '' && ms === null);
  if (text === '') result.textContent = '';
  else if (ms === null) result.textContent = 'Not a relative time - it should look like now-7d or now-1M/M';
  else result.textContent = `→ ${describeTime(ms)} (${new Date(ms).toISOString()})`;
}

/**
 * Opens the dialog from the button that shows it
 */
export function initTimeHelp() {
  const dialog = $('timeHelpDialog');
  let now = Date.now();
  $('timeHelp').addEventListener('click', () => {
    // Every example is worked out from the same moment
    now = Date.now();
    for (const row of dialog.querySelectorAll('tr[data-expr]')) {
      row.querySelector('.help-now').textContent = describeTime(resolveRelative(row.dataset.expr, now));
    }
    showTry(now);
    dialog.showModal();
  });
  $('timeHelpTry').addEventListener('input', () => showTry(now));
  // Enter in the try-it box would submit the dialog's form and close it
  $('timeHelpTry').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  // Closes when the backdrop is clicked
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
