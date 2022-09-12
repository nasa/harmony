import { formatDates } from "../table.js";
import toasts from "./toasts.js";

/**
 * Query the Harmony backend for an up to date version of 
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
    bindRetryButtonClickHandler();
    formatDates();
    return true;
  } else {
    return false;
  }
}

function bindRetryButtonClickHandler() {
  var retryButtons = document.querySelectorAll('button.retry-button');
  Array.from(retryButtons).forEach(btn => {
    btn.addEventListener('click', async function (event) {
      toasts.showUpper('Triggering a retry...');
      const retryUrl = event.currentTarget.getAttribute('data-retry-url');
      const res = await fetch(retryUrl, { method: 'POST' });
      const json = await res.json();
      if (json.message) {
        toasts.showUpper(json.message);
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
 * @param {object} broker - pubsub broker
 * @returns Boolean indicating whether the job is still running. 
 */
async function loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, checkJobStatus, broker) {
  const stillRunning = await load(jobId, page, limit, disallowStatus, tableFilter, checkJobStatus);
  broker.publish('work-items-table-loaded');
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
   * @param {object} broker - pubsub broker
   */
  async init(jobId, page, limit, disallowStatus, tableFilter, broker) {
    initFilter();
    broker.subscribe( // reload when the user changes the job's state
      'job-state-change',
      async function () {
        loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, false, broker);
      }
    );
    // do an initial table load immediately
    let jobIsRunning = await loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, false, broker);
    // reload the table every 5 seconds until the job is almost done
    const fiveSeconds = 5 * 1000;
    while (jobIsRunning) {
      await new Promise(res => setTimeout(res, fiveSeconds));
      jobIsRunning = await loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, true, broker);
    }
    // reload the table one last time
    loadAndNotify(jobId, page, limit, disallowStatus, tableFilter, false, broker)
  },
}