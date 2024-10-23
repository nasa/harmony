/* eslint-disable no-continue */
import jobsTable from './jobs/jobs-table.js';
import toasts from './toasts.js';
import PubSub from '../pub-sub.js';

const labelLinks = document.querySelectorAll('#labels-list .label-li a');

/**
 *
 */
function getSelectedLabelValues() {
  return [].slice.call(document.querySelectorAll('.label-item.active')).map(
    (labelAnchor) => labelAnchor.getAttribute('data-value'),
  );
}

/**
 *
 */
function handleLabelClick(event) {
  event.preventDefault();
  const labelElement = event.target;
  labelElement.classList.toggle('active');
}

/**
 *
 */
function selectLabels(labelNames) {
  const labelNamesReversed = labelNames.reverse();
  const labelsListElement = document.getElementById('labels-list');
  for (const name of labelNamesReversed) {
    const labelElement = labelsListElement.querySelector(`a[name="${name}"]`).parentNode;
    const labelElementClone = labelElement.cloneNode(true);
    labelElementClone.setAttribute('title', `remove "${labelElementClone.innerText}" label from all selected jobs`);
    labelElementClone.classList.add('label-clone');
    const labelCloneAnchor = labelElementClone.firstChild;
    labelCloneAnchor.innerText = `✔️ ${labelCloneAnchor.innerText}`;
    document.getElementById('labels-list').prepend(labelElementClone);
    labelElement.style.display = 'none';
    labelElement.classList.add('label-promoted');
  }
}

/**
 *
 */
function deselectAllLabels() {
  const clonedLabels = document.getElementsByClassName('label-clone');
  while (clonedLabels[0]) {
    clonedLabels[0].parentNode.removeChild(clonedLabels[0]);
  }
}

/**
 *
 */
function filterLabelsList() {
  const searchValue = document.querySelector('#label-search').value.toLowerCase().trim();
  const labelItems = document.querySelectorAll('#labels-list .label-li');
  let visibleCount = 0;
  for (const labelItem of labelItems) {
    if (labelItem.classList.contains('label-promoted')) { // skip, stays hidden
      continue;
    }
    const labelName = labelItem.innerText.toLowerCase().trim();
    const isMatch = labelName.startsWith(searchValue);
    labelItem.style.display = isMatch ? '' : 'none';
    if (isMatch) visibleCount += 1;
  }
  document.getElementById('no-match-li').style.display = visibleCount === 0 ? '' : 'none';
}

/**
 *
 */
function showAllLabels() {
  const labelItems = document.querySelectorAll('#labels-list .label-li');
  for (const labelItem of labelItems) {
    labelItem.style.display = '';
  }
}

/**
 * Get the intersection of jobs' labels so that we know which labels
 * will be marked for potential deletion in the dropdown.
 */
function getLabelsForSelectedJobs() {
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
  console.log(Array.from(labelsSet));
  return Array.from(labelsSet);
}

/**
 *
 */
function setLabelLinksDisabled(selectedJobsCount) {
  for (const labelItemLink of labelLinks) {
    if (selectedJobsCount === 0) {
      labelItemLink.classList.add('disabled');
    } else {
      labelItemLink.classList.remove('disabled');
    }
  }
}

/**
 * Responds to a submit link click event
 * (hits relevant Harmony url, shows user the response).
 * @param {Event} event - the click event
 */
async function handleSubmitClick(event) {
  event.preventDefault();
  const jobIds = jobsTable.getJobIds();
  const postfix = jobIds.length === 1 ? '' : 's';
  toasts.showUpper(`Labeling ${jobIds.length} job${postfix}...`);
  // console.log(getSelectedLabelValues());
  // console.log(jobsTable.getJobIds());
  const res = await fetch('/labels', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId: jobIds, label: getSelectedLabelValues() }),
  });
  const isAre = jobIds.length > 1 ? 'have' : 'has';
  if (res.status === 201) {
    toasts.showUpper(`The selected job${postfix} ${isAre} been labeled.`);
  } else {
    toasts.showUpper('The update failed.');
  }
  PubSub.publish(
    'row-state-change',
  );
}

/**
 *
 */
function bindEventListeners() {
  const labelSearchElement = document.getElementById('label-search');
  labelSearchElement.addEventListener('keyup', () => {
    filterLabelsList();
  });
  document.querySelectorAll('.label-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      handleLabelClick(event);
    }, false);
  });
  const labelDropdown = document.getElementById('label-dropdown-a');
  labelDropdown.addEventListener('hidden.bs.dropdown', () => {
    deselectAllLabels();
    document.getElementById('label-search').value = '';
    showAllLabels();
    document.getElementById('no-match-li').style.display = 'none';
  });
  labelDropdown.addEventListener('show.bs.dropdown', () => {
    selectLabels(getLabelsForSelectedJobs());
    const selectedJobsCount = jobsTable.getJobIds().length;
    setLabelLinksDisabled(selectedJobsCount);
  });
}

/**
 *
 */
export default {

  /**
   *
   */
  init() {
    bindEventListeners();
  },
};
