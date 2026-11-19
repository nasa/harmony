// Helpers shared by the analytics page's Query and Dashboards tabs: calling the analytics API,
// remembering settings per user, confirming actions, and showing errors.

const API = '/admin/analytics/api';
const STORAGE_PREFIX = 'harmony.analytics';

export const $ = (id) => document.getElementById(id);

/**
 * An error from the analytics API, with the problems the service found in a query, if any
 */
export class ApiError extends Error {
  constructor(message, status, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Calls the analytics API
 *
 * @param {string} endpoint - e.g. schema, validate, query, queries/12 or dashboards
 * @param {object} [body] - the JSON body, which makes the request a POST unless method says otherwise
 * @param {string} [method] - the HTTP method, if not GET (no body) or POST (a body)
 * @returns {Promise<object|null>} the response, or null if there was none
 * @throws {ApiError} if the request fails
 */
export async function api(endpoint, body, method = body === undefined ? 'GET' : 'POST') {
  let response;
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    response = await fetch(`${API}/${endpoint}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // e.g. an expired session redirecting the request to the Earthdata Login page
    throw new ApiError('Could not reach Harmony. If your session has expired, reload the page to log in again.', 0);
  }
  if (response.status === 204) return null;
  let data = {};
  try {
    data = await response.json();
  } catch {
    // not JSON - reported by status below
  }
  if (!response.ok) {
    // The analytics service's errors have a message; harmony's own (e.g. a 403) a description
    throw new ApiError(data.message ?? data.description ?? `The request failed (HTTP ${response.status})`,
      response.status, data.errors ?? []);
  }
  return data;
}

/**
 * Gets the user the page was rendered for, from its data attributes
 *
 * @param {HTMLElement} page - the element with data-username and data-is-admin
 * @returns {{username: string, isAdmin: boolean}} the user
 */
export function pageUser(page) {
  return { username: page.dataset.username, isAdmin: page.dataset.isAdmin === 'true' };
}

/**
 * Gets functions to remember a user's settings in this browser, for the next time the page is
 * opened. Keys include the username, so people sharing a browser each get their own.
 *
 * @param {string} username - the user
 * @returns {{remembered: function(string): (string|null), remember: function(string, string): void}}
 *   remembered reads a setting (null if there is none, or storage is unavailable); remember saves one
 */
export function userStorage(username) {
  const key = (name) => `${STORAGE_PREFIX}.${username}.${name}`;
  return {
    remembered: (name) => {
      try {
        return localStorage.getItem(key(name));
      } catch {
        return null;
      }
    },
    remember: (name, value) => {
      try {
        localStorage.setItem(key(name), value);
      } catch {
        // storage may be unavailable (e.g. blocked), in which case the setting just isn't kept
      }
    },
  };
}

/**
 * Asks the user to choose between some actions, with the page's dialog (#confirmDialog)
 *
 * @param {string} message - the question
 * @param {Array<{value: string, label: string, className?: string}>} choices - a button for each
 *   action, in order; the last is focused first
 * @returns {Promise<string>} the chosen action's value, or '' if the dialog was closed without
 *   choosing (e.g. with Escape)
 */
export function chooseAction(message, choices) {
  const dialog = $('confirmDialog');
  $('confirmMessage').textContent = message;
  $('confirmActions').replaceChildren(...choices.map(({ value, label, className }) => {
    const button = document.createElement('button');
    button.type = 'submit';
    button.value = value;
    button.className = `btn btn-sm ${className ?? 'btn-outline-secondary'}`;
    button.textContent = label;
    return button;
  }));
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
    $('confirmActions').lastElementChild?.focus();
  });
}

/**
 * Asks the user to confirm something
 *
 * @param {string} message - the question
 * @param {string} okLabel - the label for the button that confirms
 * @returns {Promise<boolean>} whether they confirmed
 */
export async function confirmAction(message, okLabel) {
  const choice = await chooseAction(message, [
    { value: 'cancel', label: 'Cancel' },
    { value: 'ok', label: okLabel, className: 'btn-danger' },
  ]);
  return choice === 'ok';
}

/**
 * Shows an error in a box, listing the problems the service found in the query
 *
 * @param {HTMLElement} box - the element to show it in
 * @param {Error} error - the error
 * @param {function(number): void} [select] - shows a problem's position in the query; without it
 *   positions aren't offered
 */
export function renderError(box, error, select) {
  box.replaceChildren(error.message);
  const problems = error.errors ?? [];
  if (problems.length > 0) {
    const list = document.createElement('ul');
    list.className = 'query-error-list';
    for (const { message, position } of problems) {
      const item = document.createElement('li');
      if (position === null || position === undefined || !select) {
        item.textContent = message;
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = message;
        button.title = 'Show where this is in the query';
        button.addEventListener('click', () => select(position));
        item.append(button);
      }
      list.append(item);
    }
    box.append(list);
  }
  box.hidden = false;
}
