import { formatDates, initCopyHandler, trimForDisplay } from '../table.js';
import toasts from '../toasts.js';
import PubSub from '../../pub-sub.js';

/**
 * Bind a click handler to every retry button.
 * The handler does a POST to the retry url.
 * @param {string} selector - the selector to use in querySelectorAll to
 * retrieve the list of buttons that the click handler will be bound to
 */
 function bindRetryButtonClickHandler(selector) {
  const retryButtons = document.querySelectorAll(selector);
  Array.from(retryButtons).forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      toasts.showUpper('Triggering a retry...');
      const retryUrl = event.currentTarget.getAttribute('data-retry-url');
      const workItemIdStr = event.currentTarget.getAttribute('data-work-item-id');
      const res = await fetch(retryUrl, { method: 'POST' });
      const json = await res.json();
      if (json.message) {
        toasts.showUpper(json.message);
        PubSub.publish('row-state-change', [workItemIdStr]);
      } else {
        toasts.showUpper('The item could not be retried.');
      }
    });
  });
}

/**
 * Query Harmony for an up to date version of
 * a single HTML page of the work items table.
 * @param {object} params - parameters that define what will appear in the table rows
 * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
 * @returns Boolean indicating whether the job is still running
 */
async function load(params, checkJobStatus) {
  let tableUrl = `./${params.jobID}/work-items?page=${params.currentPage}&limit=${params.limit}&checkJobStatus=${checkJobStatus}`;
  tableUrl += `&tableFilter=${encodeURIComponent(params.tableFilter)}&disallowStatus=${params.disallowStatus}&disallowMessageCategory=${params.disallowMessageCategory}`;
  tableUrl += `&fromDateTime=${encodeURIComponent(params.fromDateTime)}&toDateTime=${encodeURIComponent(params.toDateTime)}`;
  tableUrl += `&tzOffsetMinutes=${params.tzOffsetMinutes}&dateKind=${params.dateKind}`;
  const res = await fetch(tableUrl);
  if (res.status === 200) {
    const template = await res.text();
    document.getElementById('workflow-items-table-container').innerHTML = template;
    bindRetryButtonClickHandler('tr button.retry-button');
    formatDates('.date-td');
    initCopyHandler('.copy-request');
    return true;
  }
  return false;
}

/**
 * Query Harmony for an up to date version of
 * a single HTML row of the work items table.
 * @param {string} workItemId - id of the item for the row that needs updating
 * @param {object} params - parameters that define what will appear in the table row
 */
 async function loadRow(workItemId, params) {
  let tableUrl = `./${params.jobID}/work-items/${workItemId}`;
  tableUrl += `?tableFilter=${encodeURIComponent(params.tableFilter)}&disallowStatus=${params.disallowStatus}`;
  const res = await fetch(tableUrl);
  if (res.status === 200) {
    const template = await res.text();
    const tmp = document.createElement('tbody');
    tmp.innerHTML = template;
    document.getElementById(`item-${workItemId}`).replaceWith(...tmp.childNodes); // add only the <tr>...</tr>
    bindRetryButtonClickHandler(`tr[id="item-${workItemId}"] button.retry-button`);
    formatDates(`tr[id="item-${workItemId}"] .date-td`);
  }
}

/**
 * Query the Harmony backend for an up to date version of
 * a single HTML page of the work items table, then publish the table loaded event.
 * @param {object} params - parameters that define what will appear in the table row
 * @param {boolean} checkJobStatus - set to true if should check whether the job is finished
 * @returns Boolean indicating whether the job is still running.
 */
async function loadAndNotify(params, checkJobStatus) {
  const stillRunning = await load(params, checkJobStatus);
  PubSub.publish('work-items-table-loaded');
  return stillRunning;
}

/**
 * Build the work items filter (for filtering by 'status').
 * @param {object[]} tableFilter - initial tags that will populate the input
 */
function initFilter(tableFilter) {
  const filterInput = document.querySelector('input[name="tableFilter"]');
  const allowedList = [
    { value: 'status: ready', dbValue: 'ready', field: 'status' },
    { value: 'status: successful', dbValue: 'successful', field: 'status' },
    { value: 'status: canceled', dbValue: 'canceled', field: 'status' },
    { value: 'status: running', dbValue: 'running', field: 'status' },
    { value: 'status: failed', dbValue: 'failed', field: 'status' },
    { value: 'status: queued', dbValue: 'queued', field: 'status' },
    { value: 'status: warning', dbValue: 'warning', field: 'status' },
  ];
  const allowedValues = allowedList.map((t) => t.value);
  allowedList.push({ value: 'message category: nodata', dbValue: 'nodata', field: 'message_category' });
  // eslint-disable-next-line no-new
  const tagInput = new Tagify(filterInput, {
    whitelist: allowedList,
    delimiters: null,
    validate(tag) {
      if (allowedValues.includes(tag.value)
        || /^message category: .{1,100}$/.test(tag.value)) {
        return true;
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
    templates: {
      tag(tagData) {
        return `<tag title="${tagData.dbValue}"
            contenteditable='false'
            spellcheck='false'
            tabIndex="${this.settings.a11y.focusableTags ? 0 : -1}"
            class="${this.settings.classNames.tag}"
            ${this.getAttributes(tagData)}>
          <x title='' class="${this.settings.classNames.tagX}" role='button' aria-label='remove tag'></x>
          <div>
              <span class="${this.settings.classNames.tagText}">${trimForDisplay(tagData.value.split(': ')[1], 20)}</span>
          </div>
        </tag>`;
      },
    },
  });
  const initialTags = JSON.parse(tableFilter);
  tagInput.addTags(initialTags);
}

/**
 * Utility for initializing and refreshing a single page of the work items table.
 * After calling init, work item information will be fetched periodically
 * so that the user can see updates in near real time.
 */
export default {

  /**
   * Update the work items table while the job is processing.
   * @param {object} params - Parameters that define what will appear in the table.
   * Params contains the follwing attributes:
   * jobId - id of the job that the work items are linked to.
   * currentPage - page number for the work items.
   * limit - limit on the number of work items in a page.
   * disallowStatus - whether to load the table with disallow status "on" or "off".
   * tableFilter - a list of filter objects (as a string).
   * fromDateTime - date time string that constrains by date
   * toDateTime - date time string that constrains by date
   * tzOffsetMinutes - offset from UTC
   * dateKind - updatedAt or createdAt
   */
  async init(params) {
    initFilter(params.tableFilter);
    PubSub.subscribe(
      'row-state-change',
      async (workItemId) => loadRow(workItemId, params),
    );
    PubSub.subscribe(
      'table-state-change',
      async () => loadAndNotify(params, false),
    );
    // do an initial table load immediately
    let jobIsRunning = await loadAndNotify(params, false);
    // reload the table every 5 seconds until the job is almost done
    const fiveSeconds = 5 * 1000;
    while (jobIsRunning) {
      await new Promise((res) => {
        setTimeout(res, fiveSeconds);
      });
      jobIsRunning = await loadAndNotify(params, true);
    }
    // reload the table one last time
    loadAndNotify(params, false);
  },
};
