/* eslint-disable no-param-reassign */
import { formatDates } from '../table.js';
import toasts from '../toasts.js';
import PubSub from '../../pub-sub.js';

// all of the currently selected job IDs
let jobIDs = [];
// each status for each currently selected job
let statuses = [];

/**
 * Build the jobs filter with filter facets like 'status' and 'user'.
  * @param {string} currentUser - the current Harmony user
  * @param {string[]} services - service names from services.yml
  * @param {boolean} isAdminRoute - whether the current page is /admin/...
  * @param {object[]} tableFilter - initial tags that will populate the input
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
 * @param {string} text - the text to copy
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
 * @param {string} text - the text to copy
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
 * @param {string} selector - defines which button(s) to bind the handler to
 */
async function initCopyHandler(selector) {
  // https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
  document.querySelectorAll(selector).forEach((el) => {
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
 * Repopulate the job IDs and statuses arrays which
 * track which jobs are selected.
 */
function refreshSelected() {
  jobIDs = [];
  statuses = [];
  document.querySelectorAll('.select-job').forEach((el) => {
    const jobID = el.getAttribute('data-id');
    const status = el.getAttribute('data-status');
    const { checked } = el;
    if (checked) {
      jobIDs.push(jobID);
      statuses.push(status);
    }
  });
  PubSub.publish('job-selected');
}

/**
 * Intitialize the select box click handler for all job rows.
 * @param {string} selector - defines which box(es) to bind the handler to
 */
function initSelectHandler(selector) {
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener('click', (event) => {
      const { target } = event;
      const jobID = target.getAttribute('data-id');
      const status = target.getAttribute('data-status');
      const { checked } = target;
      if (checked) {
        jobIDs.push(jobID);
        statuses.push(status);
      } else {
        jobIDs.splice(jobIDs.indexOf(jobID), 1);
        statuses.splice(statuses.indexOf(status), 1);
      }
      PubSub.publish('job-selected');
    });
  });
}

/**
 * Intitialize the select all box click handler.
 */
function initSelectAllHandler() {
  const el = document.getElementById('select-jobs');
  if (!el) {
    return;
  }
  el.addEventListener('click', (event) => {
    const { target } = event;
    const { checked } = target;
    jobIDs = [];
    statuses = [];
    document.querySelectorAll('.select-job').forEach((jobEl) => {
      if (checked) {
        const jobID = jobEl.getAttribute('data-id');
        const status = jobEl.getAttribute('data-status');
        jobIDs.push(jobID);
        statuses.push(status);
        jobEl.checked = true;
      } else {
        jobEl.checked = false;
      }
    });
    PubSub.publish('job-selected');
  });
}

/**
 * Query Harmony for up to date version of a HTML rows of the jobs table.
 * @param {object} params - parameters that define what will appear in the table row
 */
async function loadRows(params) {
  let tableUrl = './workflow-ui/jobs';
  tableUrl += `?tableFilter=${encodeURIComponent(params.tableFilter)}&disallowStatus=${params.disallowStatus}`;
  const res = await fetch(tableUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobIDs }),
  });
  if (res.status === 200) {
    // loop through json map of html rows (job id => row)
    const rowsJson = await res.json();
    for (const jobID of jobIDs) {
      const rowHtml = rowsJson[jobID] || '<span></span>';
      const tmp = document.createElement('tbody');
      tmp.innerHTML = rowHtml;
      document.getElementById(`copy-${jobID}`).remove();
      document.getElementById(`job-${jobID}`).replaceWith(...tmp.childNodes); // add only the <tr>...</tr>
      initSelectHandler(`tr[id="job-${jobID}"] .select-job`);
      initCopyHandler(`th[id="copy-${jobID}"] .copy-request`);
      formatDates(`tr[id="job-${jobID}"] .date-td`);
    }
    refreshSelected();
    if (!document.querySelectorAll('.select-job').length) {
      document.getElementById('select-jobs').remove();
    }
  }
}

/**
 * Handles jobs table logic (formatting, building filters, etc.).
 */
const jobsTable = {

  /**
   * Initialize the jobs table.
   * @param {object} params - Parameters that define what will appear in the table.
   * Params contains the follwing attributes:
   * disallowStatus - whether to load the table with disallow status "on" or "off".
   * currentUser - the current Harmony user
   * services - service names from services.yml
   * isAdminRoute - whether the current page is /admin/...
   * tableFilter - initial tags that will populate the input
   */
  async init(params) {
    PubSub.subscribe(
      'row-state-change',
      async () => loadRows(params),
    );
    formatDates('.date-td');
    initFilter(params.currentUser, params.services, params.isAdminRoute, params.tableFilter);
    initCopyHandler('.copy-request');
    initSelectHandler('.select-job');
    initSelectAllHandler();
  },

  /**
   * Get the statuses for each currently selected job.
   * @returns an array of statuses
   */
  getJobStatuses() {
    return statuses;
  },

 /**
   * Get the ID for each currently selected job.
   * @returns an array of job IDs.
   */
  getJobIds() {
    return jobIDs;
  },
};

export default jobsTable;
