/* eslint-disable no-param-reassign */
import { formatDates } from '../table.js';
import toasts from '../toasts.js';

let jobIDs = [];

/**
 * Build the jobs filter with filter facets like 'status' and 'user'.
 * @param currentUser - the current Harmony user
 * @param services - service names from services.yml
 * @param isAdminRoute - whether the current page is /admin/...
 * @param tableFilter - initial tags that will populate the input
 */
function initFilter(currentUser, services, isAdminRoute, tableFilter) {
  const filterInput = document.querySelector('input[name="tableFilter"]');
  const allowedList = [
    { value: 'status: successful', dbValue: 'successful', field: 'status' },
    { value: 'status: canceled', dbValue: 'canceled', field: 'status' },
    { value: 'status: running', dbValue: 'running', field: 'status' },
    { value: 'status: running with errors', dbValue: 'running_with_errors', field: 'status' },
    { value: 'status: complete with errors', dbValue: 'complete_with_errors', field: 'status' },
    { value: 'status: failed', dbValue: 'failed', field: 'status' },
    { value: 'status: accepted', dbValue: 'accepted', field: 'status' },
    { value: 'status: paused', dbValue: 'paused', field: 'status' },
    { value: 'status: previewing', dbValue: 'previewing', field: 'status' },
  ];
  const serviceList = services.map((service) => ({ value: `service: ${service}`, dbValue: service, field: 'service' }));
  allowedList.push(...serviceList);
  if (isAdminRoute) {
    allowedList.push({ value: `user: ${currentUser}`, dbValue: currentUser, field: 'user' });
  }
  const allowedValues = allowedList.map((t) => t.value);
  const tagInput = new Tagify(filterInput, {
    whitelist: allowedList,
    validate(tag) {
      if (allowedValues.includes(tag.value)) {
        return true;
      }
      if (isAdminRoute) {
        // check if the tag loosely resembles a valid EDL username
        return /^user: [A-Za-z0-9._]{4,30}$/.test(tag.value);
      }
      return false;
    },
    editTags: false,
    maxTags: 30,
    dropdown: {
      maxItems: 15,
      enabled: 0,
      closeOnSelect: true,
    },
  });
  const initialTags = JSON.parse(tableFilter);
  tagInput.addTags(initialTags);
}

/**
 * Fallback method for copying text to clipboard.
 * @param text - the text to copy
 */
function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  // Avoid scrolling to bottom
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Method for copying the text to the clipboard.
 * @param text - the text to copy
 */
async function copyTextToClipboard(text) {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Intitialize the copy click handler for all copy buttons.
 */
async function initCopyHandler() {
  // https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
  document.querySelectorAll('.copy-request').forEach((el) => {
    el.addEventListener('click', (event) => {
      copyTextToClipboard(event.target.getAttribute('data-text'));
      const isTruncated = event.target.getAttribute('data-truncated') === 'true';
      toasts.showUpper(
          `✅ Copied to clipboard${isTruncated ? '. WARNING: this request text was truncated due to length constraints.' : ''}`,
      );
    });
  });
}

/**
 * Intitialize the select box click handler for all job rows.
 */
async function initSelectHandler() {
  document.querySelectorAll('.select-job').forEach((el) => {
    el.addEventListener('click', (event) => {
      const { target } = event;
      const jobID = target.getAttribute('data-id');
      const { checked } = target;
      if (checked) {
        jobIDs.push(jobID);
      } else {
        jobIDs.splice(jobIDs.indexOf(jobID), 1);
      }
      toasts.showUpper(jobIDs);
    });
  });
}

/**
 * Intitialize the select all box click handler.
 */
async function initSelectAllHandler() {
  const el = document.getElementById('select-jobs');
  el.addEventListener('click', (event) => {
    const { target } = event;
    const { checked } = target;
    jobIDs = [];
    document.querySelectorAll('.select-job').forEach((jobEl) => {
      if (checked) {
        const jobID = jobEl.getAttribute('data-id');
        jobIDs.push(jobID);
        jobEl.checked = true;
      } else {
        jobEl.checked = false;
      }
    });
    toasts.showUpper(jobIDs);
  });
}

/**
 * Handles jobs table logic (formatting, building filters, etc.).
 */
export default {

  /**
   * Initialize the jobs table.
   * @param currentUser - the current Harmony user
   * @param services - service names from services.yml
   * @param isAdminRoute - whether the current page is /admin/...
   * @param tableFilter - initial tags that will populate the input
   */
  async init(currentUser, services, isAdminRoute, tableFilter) {
    formatDates('.date-td');
    initFilter(currentUser, services, isAdminRoute, tableFilter);
    initCopyHandler();
    initSelectHandler();
    initSelectAllHandler();
  },
};
