/* eslint-disable no-continue */
import jobsTable from './jobs/jobs-table.js';
import toasts from './toasts.js';
import PubSub from '../pub-sub.js';

let bsDropdown;
let labelLinks;
let labelDropdown;
let labelNavItem;

/**
 * Responds to a submit link click event by adding or removing
 * a label.
 * (hits relevant Harmony url, shows user the response).
 * @param {Event} event - the click event
 * @param {string} method - the HTTP method
 */
async function handleSubmitClick(event, method) {
  event.preventDefault();
  const labelName = event.target.getAttribute('data-value');
  const jobIds = jobsTable.getJobIds();
  const postfix = jobIds.length === 1 ? '' : 's';
  let action = method === 'PUT' ? 'Adding' : 'Removing';
  toasts.showUpper(`${action} label...`);
  const res = await fetch('/labels', {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId: jobIds, label: [labelName] }),
  });
  action = method === 'PUT' ? 'Added' : 'Removed';
  if (res.status === 201 || res.status === 204) {
    toasts.showUpper(`${action} "${labelName}" label for ${jobIds.length} job${postfix}.`);
    PubSub.publish(
      'row-state-change',
    );
  } else {
    toasts.showUpper('The update failed.');
  }
}

/**
 * Promotes the specified label items by inserting clones at the
 * top of the list and hiding the original label items.
 * @param {string[]} labelNames - the list of labels to promote
 */
function promoteLabels(labelNames) {
  const labelNamesReversed = labelNames.reverse();
  const labelsListElement = document.getElementById('labels-list');
  for (const name of labelNamesReversed) {
    const labelElement = labelsListElement.querySelector(`a[name="${name}"]`).parentNode;
    const labelElementClone = labelElement.cloneNode(true);
    labelElementClone.setAttribute('title', `remove "${labelElementClone.innerText}" label from all selected jobs`);
    labelElementClone.classList.add('label-clone');
    labelElementClone.addEventListener('click', (event) => {
      bsDropdown.hide();
      handleSubmitClick(event, 'DELETE');
    }, false);
    const labelCloneAnchor = labelElementClone.firstChild;
    labelCloneAnchor.innerText = `✔️ ${labelCloneAnchor.innerText}`;
    document.getElementById('labels-list').prepend(labelElementClone);
    labelElement.style.display = 'none';
    labelElement.classList.add('label-promoted');
  }
}

/**
 * Demotes any labels (back to their normal alphabetical position)
 * that were promoted to the top of the list.
 * In practice, this means deleting the promoted clone, and unhiding the
 * original label.
 */
function demoteLabels() {
  const clonedLabels = document.getElementsByClassName('label-clone');
  while (clonedLabels[0]) {
    clonedLabels[0].parentNode.removeChild(clonedLabels[0]);
  }
  Array.from(document.getElementsByClassName('label-promoted'))
    .forEach((el) => el.classList.remove('label-promoted'));
}

/**
 * Filters the list of label items based on user input.
 */
function filterLabelsList() {
  const searchValue = document.querySelector('#label-search').value.toLowerCase().trim();
  const labelItems = document.querySelectorAll('#labels-list .label-li');
  let visibleCount = 0;
  for (const labelItem of labelItems) {
    if (labelItem.classList.contains('label-promoted')) { // skip, stays hidden
      continue;
    }
    const labelName = labelItem.firstChild.getAttribute('data-value').toLowerCase().trim();
    const isMatch = labelName.startsWith(searchValue);
    labelItem.style.display = isMatch ? '' : 'none';
    if (isMatch) visibleCount += 1;
  }
  document.getElementById('no-match-li').style.display = visibleCount === 0 ? '' : 'none';
}

/**
 * Unhides all label items.
 */
function showAllLabels() {
  const labelItems = document.querySelectorAll('#labels-list .label-li');
  for (const labelItem of labelItems) {
    labelItem.style.display = '';
  }
}

/**
 * Get the intersection set of the labels of selected jobs so that
 * we know which labels will be promoted (to the top of the labels list)
 * and marked for potential removal from their associated jobs.
 */
function getLabelsIntersectionForSelectedJobs() {
  let labelsSet = new Set();
  let firstChecked = true;
  document.querySelectorAll('.select-job').forEach((jobEl) => {
    if (jobEl.checked) {
      const jobID = jobEl.getAttribute('data-id');
      const labelsString = document.querySelector(`#job-labels-display-${jobID}`).getAttribute('data-labels');
      const currentSet = new Set();
      const labels = labelsString === '' ? [] : labelsString.split(',');
      labels.forEach((item) => currentSet.add(item));
      if (firstChecked) { // init labelsSet
        labels.forEach((item) => labelsSet.add(item));
        firstChecked = false;
      } else {
        labelsSet = labelsSet.intersection(currentSet);
      }
    }
  });
  return Array.from(labelsSet);
}

/**
 * Disable all label anchor elements if no jobs are selected.
 * @param {number} selectedJobsCount - count of selected jobs
 * @param {Element[]} labelItemLinks - list of label link elements
 */
function setLabelLinksDisabled(selectedJobsCount, labelItemLinks) {
  if (selectedJobsCount === 0) {
    for (const labelItemLink of labelItemLinks) {
      labelItemLink.classList.add('disabled');
    }
  }
}

/**
 * Enable all label anchor elements.
 * @param {Element[]} labelItemLinks - list of label link elements
 */
function setLabelLinksEnabled(labelItemLinks) {
  for (const labelItemLink of labelItemLinks) {
    labelItemLink.classList.remove('disabled');
  }
}

/**
 * Hide/show labels dropdown based on the number of jobs selected.
 * @param {number} selectedJobsCount - count of selected jobs
 */
function toggleLabelNavVisibility(selectedJobsCount) {
  if (selectedJobsCount === 0) {
    labelNavItem.classList.add('d-none');
  } else {
    labelNavItem.classList.remove('d-none');
  }
}

/**
 * Bind event handlers to their respective elements.
 */
function bindEventListeners() {
  const labelSearchElement = document.getElementById('label-search');
  labelSearchElement.addEventListener('keyup', () => {
    filterLabelsList();
  });
  document.querySelectorAll('.label-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      bsDropdown.hide();
      handleSubmitClick(event, 'PUT');
    }, false);
  });
  labelDropdown.addEventListener('hidden.bs.dropdown', () => {
    demoteLabels();
    setLabelLinksEnabled(labelLinks);
    document.getElementById('label-search').value = '';
    showAllLabels();
    document.getElementById('no-match-li').style.display = 'none';
  });
  labelDropdown.addEventListener('show.bs.dropdown', () => {
    promoteLabels(getLabelsIntersectionForSelectedJobs());
    const selectedJobsCount = jobsTable.getJobIds().length;
    setLabelLinksDisabled(selectedJobsCount, labelLinks);
  });
}

/**
 * The labeling dropdown object allows users to
 * add and remove labels from selected jobs.
 */
export default {

  /**
   * Initializes the labeling interactivity associated with
   * the labels dropdown link.
   */
  init() {
    // the anchor elements that correspond to a label
    labelLinks = Array.from(document.querySelectorAll('#labels-list .label-li a'));
    // the dropdown that contains label list items
    labelDropdown = document.getElementById('label-dropdown-a');
    labelNavItem = document.getElementById('label-nav-item');
    if (labelDropdown) {
      bsDropdown = new bootstrap.Dropdown(labelDropdown);
    }
    bindEventListeners();
    PubSub.subscribe(
      'job-selected',
      () => this.toggleLabelNavVisibility(jobsTable.getJobIds().length),
    );
  },
  promoteLabels,
  demoteLabels,
  getLabelsIntersectionForSelectedJobs,
  setLabelLinksDisabled,
  setLabelLinksEnabled,
  filterLabelsList,
  showAllLabels,
  toggleLabelNavVisibility,
};
