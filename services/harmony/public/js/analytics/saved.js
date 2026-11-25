// The saved queries list on the analytics page, and converting between saved parameter defaults and
// the parameter form's text. All text is inserted with textContent - names and descriptions come
// from other users.

/**
 * Formats when a query was last changed, relative to now for recent changes
 *
 * @param {string} iso - the timestamp
 * @param {Date} [now] - the current time
 * @returns {string} e.g. "5 min ago", "yesterday", or a date
 */
export function changedAgo(iso, now = new Date()) {
  const then = new Date(iso);
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString();
}

/**
 * Converts a saved parameter default to the text its form field shows
 *
 * @param {*} value - the saved value
 * @returns {string} the text
 */
export function defaultToText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/**
 * Renders the saved queries list
 *
 * @param {HTMLElement} list - the list element
 * @param {Array<object>} queries - the saved queries
 * @param {object} options - the options
 * @param {number|null} options.currentId - the id of the open query, which is highlighted
 * @param {function(object): boolean} options.canChange - whether the user may delete a query
 * @param {function(object): void} options.onOpen - opens a query
 * @param {function(object): void} options.onDelete - deletes a query
 */
export function renderSavedList(list, queries, { currentId, canChange, onOpen, onDelete }) {
  list.replaceChildren(...queries.map((query) => {
    const item = document.createElement('li');
    item.dataset.search = `${query.name} ${query.description} ${query.owner}`.toLowerCase();
    if (query.id === currentId) item.classList.add('is-current');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open-query';
    open.title = query.description || query.name;
    const name = document.createElement('span');
    name.className = 'saved-name';
    name.textContent = query.name;
    const meta = document.createElement('span');
    meta.className = 'saved-meta';
    // Only saved queries can be private (only their owner sees them); dashboards have no `shared`
    meta.textContent = [query.owner, query.shared === false ? 'private' : null, changedAgo(query.updatedAt)]
      .filter(Boolean).join(' · ');
    open.append(name, meta);
    open.addEventListener('click', () => onOpen(query));
    item.append(open);

    if (canChange(query)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-query';
      remove.title = `Delete "${query.name}"`;
      remove.setAttribute('aria-label', `Delete saved query ${query.name}`);
      remove.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>';
      remove.addEventListener('click', () => onDelete(query));
      item.append(remove);
    }
    return item;
  }));
}

/**
 * Shows only the saved queries whose name, description or owner contains the filter text
 *
 * @param {HTMLElement} list - the list element
 * @param {string} text - the filter
 */
export function filterSavedList(list, text) {
  const needle = text.trim().toLowerCase();
  for (const item of list.children) {
    item.hidden = needle !== '' && !item.dataset.search.includes(needle);
  }
}
