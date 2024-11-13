/* eslint-disable no-param-reassign */
import { formatDates, initCopyHandler } from '../table.js';
import PubSub from '../../pub-sub.js';

// all of the currently selected job IDs
let jobIDs = [];
// each status for each currently selected job
let statuses = [];

/**
 * Build the jobs filter with filter facets like 'status' and 'user'.
  * @param {string} currentUser - the current Harmony user
  * @param {string[]} services - service names from services.yml
  * @param {string[]} providers - array of provider ids
  * @param {string[]} labels - known job labels
  * @param {boolean} isAdminRoute - whether the current page is /admin/...
  * @param {object[]} tableFilter - initial tags that will populate the input
 */
function initFilter(currentUser, services, providers, labels, isAdminRoute, tableFilter) {
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
  const providerList = providers.map((provider) => ({ value: `provider: ${provider}`, dbValue: provider, field: 'provider' }));
  allowedList.push(...providerList);
  const labelList = labels.map((label) => ({ value: `label: ${label}`, dbValue: label, field: 'label' }));
  allowedList.push(...labelList);
  if (isAdminRoute) {
    allowedList.push({ value: `user: ${currentUser}`, dbValue: currentUser, field: 'user' });
  }
  const allowedValues = allowedList.map((t) => t.value);
  const tagInput = new Tagify(filterInput, {
    whitelist: allowedList,
    validate(tag) {
      if (allowedValues.includes(tag.value)
        || /^provider: [A-Za-z0-9_]{1,100}$/.test(tag.value)
        || /^label: .{1,100}$/.test(tag.value)) {
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
 * Shows a visual counter for how many jobs have been selected via checkbox.
 * @param {number} count - the number to display
 */
function setJobCounterDisplay(count) {
  const jobCounterElement = document.getElementById('job-counter');
  jobCounterElement.textContent = count;
  const display = ` job${count === 1 ? '' : 's'}`;
  const jobCounterMessageElement = document.getElementById('job-counter-message');
  jobCounterMessageElement.textContent = display;
  if (count === 0) {
    jobCounterElement.classList.add('d-none');
    jobCounterMessageElement.classList.add('d-none');
  } else {
    jobCounterElement.classList.remove('d-none');
    jobCounterMessageElement.classList.remove('d-none');
  }
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
      const numSelectable = document.querySelectorAll('.select-job').length;
      const numSelected = jobIDs.length;
      const areAllJobsSelected = numSelectable === numSelected;
      document.getElementById('select-jobs').checked = areAllJobsSelected;
      setJobCounterDisplay(jobIDs.length);
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
    setJobCounterDisplay(jobIDs.length);
    PubSub.publish('job-selected');
  });
}

/**
 * Query Harmony for up to date version of particular HTML rows of the jobs table.
 * @param {object} params - parameters that define what will appear in the table row
 */
async function loadRows(params) {
  let tableUrl = './workflow-ui/jobs';
  tableUrl += `?tableFilter=${encodeURIComponent(params.tableFilter)}`
  + `&page=${params.currentPage}&limit=${params.limit}`
  + `&fromDateTime=${encodeURIComponent(params.fromDateTime)}&toDateTime=${encodeURIComponent(params.toDateTime)}`
  + `&tzOffsetMinutes=${params.tzOffsetMinutes}&dateKind=${params.dateKind}`
  + `&sortGranules=${params.sortGranules}`
  + `&disallowStatus=${params.disallowStatus}`
  + `&disallowService=${params.disallowService}`
  + `&disallowProvider=${params.disallowProvider}`;
  if (params.disallowUser) {
    tableUrl += `&disallowUser=${params.disallowUser}`;
  }
  const res = await fetch(tableUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobIDs }),
  });
  if (res.status === 200) {
    const htmlRes = await res.text();
    const tmp = document.createElement('div');
    tmp.innerHTML = `<div class="col-10" id="jobs-table-container">${htmlRes}</div>`;
    document.getElementById('jobs-table-container').replaceWith(...tmp.childNodes);
    initSelectHandler('.select-job');
    initSelectAllHandler();
    initCopyHandler('.copy-request');
    formatDates('.date-td');
    refreshSelected();
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
   * currentPage - page number for the jobs
   * limit - limit on the number of jobs in a page
   * disallowStatus - whether to load the table with disallow status "on" or "off".
   * disallowService - whether to load the table with disallow service "on" or "off".
   * disallowUser - whether to load the table with disallow user "on" or "off".
   * disallowProvider - whether to load the table with disallow provider "on" or "off".
   * currentUser - the current Harmony user
   * services - service names from services.yml
   * providers - unique provider ids from the jobs table
   * isAdminRoute - whether the current page is /admin/...
   * tableFilter - initial tags that will populate the input
   * fromDateTime - date time string that constrains by date
   * toDateTime - date time string that constrains by date
   * tzOffsetMinutes - offset from UTC
   * dateKind - updatedAt or createdAt
   * sortGranules - sort the rows ascending ('asc') or descending ('desc')
   */
  async init(params) {
    PubSub.subscribe(
      'row-state-change',
      async () => loadRows(params),
    );
    formatDates('.date-td');
    initFilter(params.currentUser, params.services, params.providers, params.labels, params.isAdminRoute, params.tableFilter);
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

  /**
   * Gets the status of the specified job.
   * @param {string} jobID - the job to retrieve status for
   * @returns the job status string
   */
  getJobStatus(jobID) {
    return document.querySelector(`#job-${jobID}`).getAttribute('data-status');
  },
};

export default jobsTable;
