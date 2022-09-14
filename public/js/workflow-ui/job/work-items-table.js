import { formatDates } from "../table.js";
import toasts from "../toasts.js";
import PubSub from "../../pub-sub.js";

/**
 * Query Harmony for an up to date version of 
 * a single HTML page of the work items table.
 * @param {string} jobId - id of the job that the work items are linked to
 * @param {number} page - page number for the work items
 * @param {number} limit - limit on the number of work items in a page
 * @param {string} disallowStatus - whether to load the table with disallow status "on" or "off"
 * @param {string} tableFilter - a list of filter objects (as a string)
 * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
 * @returns Boolean indicating whether the job is still running. 
 */
async function load(jobId, page, limit, disallowStatus, tableFilter, checkJobStatus) {
  let tableUrl = `./${jobId}/work-items?page=${page}&limit=${limit}&checkJobStatus=${checkJobStatus}`;
  tableUrl += `&tableFilter=${encodeURIComponent(tableFilter)}&disallowStatus=${disallowStatus}`;
  const res = await fetch(tableUrl);
  if (res.status === 200) {
    const template = await res.text();
    document.getElementById('workflow-items-table-container').innerHTML = template;
    bindRetryButtonClickHandler(jobId, 'tr button.retry-button');
    formatDates('.date-td');
    return true;
  } else {
    return false;
  }
}

/**
 * Query Harmony for an up to date version of 
 * a single HTML row of the work items table.
 * @param {string} workItemId - id of the item for the row that needs updating
 * @param {string} jobId - id of the job that the work items are linked to
 */
 async function loadRow(workItemId, jobId) {
  const tableUrl = `./${jobId}/work-items/${workItemId}`;
  const res = await fetch(tableUrl);
  if (res.status === 200) {
    const template = await res.text();
    const tmp = document.createElement('tbody');
    tmp.innerHTML = template;
    document.getElementById(`item-${workItemId}`).replaceWith(...tmp.childNodes);
    bindRetryButtonClickHandler(jobId, `tr[id="item-${workItemId}"] button.retry-button`);
    formatDates(`tr[id="item-${workItemId}"] .date-td`);
  } else {
    console.error(`Could not reload row for work item ${tableUrl}.`);
  }
}

/**
 * Bind a click handler to every retry button.
 * The handler does a POST to the retry url.
 * @param {string} jobId - id of the job that the work items are linked to
 * @param {string} selector - the selector to use in querySelectorAll to
 * retrieve the list of buttons that the click handler will be bound to
 */
function bindRetryButtonClickHandler(jobId, selector) {
  var retryButtons = document.querySelectorAll(selector);
  Array.from(retryButtons).forEach(btn => {
    btn.addEventListener('click', async function (event) {
      toasts.showUpper('Triggering a retry...');
      const retryUrl = event.currentTarget.getAttribute('data-retry-url');
      const workItemIdStr = event.currentTarget.getAttribute('data-work-item-id');
      const res = await fetch(retryUrl, { method: 'POST' });
      const json = await res.json();
      if (json.message) {
        toasts.showUpper(json.message);
        PubSub.publish('row-state-change', [workItemIdStr, jobId]);
      } else {
        toasts.showUpper('The item could not be retried.');
      }
    });
  });
}

/**
 * Query the Harmony backend for an up to date version of 
 * a single HTML page of the work items table, then publish the table loaded event.
 * @param {string} jobId - id of the job that the work items are linked to
 * @param {number} page - page number for the work items
 * @param {number} limit - limit on the number of work items in a page
 * @param {string} disallowStatus - whether to load the table with disallow status "on" or "off"
 * @param {string} tableFilter - a list of filter objects (as a string)
 * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
 * @returns Boolean indicating whether the job is still running. 
 */
async function loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, checkJobStatus) {
  const stillRunning = await load(jobId, page, limit, disallowStatus, tableFilter, checkJobStatus);
  PubSub.publish('work-items-table-loaded');
  return stillRunning;
}

/**
 * Build the work items filter (for filtering by 'status').
 */
function initFilter() {
  var filterInput = document.querySelector('input[name="tableFilter"]');
  const allowedList = [
    { value: 'status: ready', dbValue: 'ready', field: 'status' },
    { value: 'status: successful', dbValue: 'successful', field: 'status' },
    { value: 'status: canceled', dbValue: "canceled", field: 'status' },
    { value: 'status: running', dbValue: "running", field: 'status' },
    { value: 'status: failed', dbValue: "failed", field: 'status' },
  ];
  const allowedValues = allowedList.map(t => t.value);
  new Tagify(filterInput, {
    whitelist: allowedList,
    validate: function (tag) {
      if (allowedValues.includes(tag.value)) {
        return true;
      }
      return false;
    },
    editTags: false,
    maxTags: 30,
    dropdown: {
      maxItems: 15,
      enabled: 0,
      closeOnSelect: true
    }
  })
}

/**
 * Utility for initializing and refreshing a single page of the work items table.
 * After calling init, work item information will be fetched periodically
 * so that the user can see updates in near real time.
 */
export default {

  /**
   * Update the work items table while the job is processing.
   * @param {string} jobId - id of the job that the work items are linked to
   * @param {number} page - page number for the work items
   * @param {number} limit - limit on the number of work items in a page
   * @param {string} disallowStatus - whether to load the table with disallow status "on" or "off"
   * @param {string} tableFilter - a list of filter objects (as a string)
   */
  async init(jobId, page, limit, disallowStatus, tableFilter) {
    initFilter();
    PubSub.subscribe('row-state-change', loadRow);
    PubSub.subscribe( // reload when the user changes the job's state
      'table-state-change',
      async function () {
        loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, false);
      }
    );
    // do an initial table load immediately
    let jobIsRunning = await loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, false);
    // reload the table every 5 seconds until the job is almost done
    const fiveSeconds = 5 * 1000;
    while (jobIsRunning) {
      await new Promise(res => setTimeout(res, fiveSeconds));
      jobIsRunning = await loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, true);
    }
    // reload the table one last time
    loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, false)
  },
}