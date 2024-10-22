import jobsTable from './jobs/jobs-table.js';
import toasts from './toasts.js';

const submitLink = document.getElementById('submit-labels-a');
const labelItems = document.querySelectorAll('#labels-list .label-li');
const labelLinks = document.querySelectorAll('#labels-list .label-li a');

/**
 *
 */
function getSelectedLabelsCount() {
  return document.querySelectorAll('.label-item.active').length;
}

/**
 *
 */
function getSelectedLabelValues() {
  return [].slice.call(document.querySelectorAll('.label-item.active a')).map(
    (labelAnchor) => labelAnchor.getAttribute('data-value'),
  );
}

/**
 *
 */
function setJobCounterDisplay(count) {
  const display = ` apply to ${count} job${count === 1 ? '' : 's'}`;
  document.getElementById('job-counter').textContent = count ? display : '0 jobs selected';
}

/**
 *
 */
function setLabelCounterDisplay(count) {
  if (count === 0) {
    document.getElementById('label-counter').classList.add('d-none');
  } else {
    document.getElementById('label-counter').classList.remove('d-none');
    document.getElementById('label-counter').textContent = count;
  }
}

/**
 *
 */
function handleLabelClick(event) {
  event.preventDefault();
  const labelElement = event.target;
  labelElement.classList.toggle('active');
  setLabelCounterDisplay(getSelectedLabelsCount());
}

/**
 *
 */
function selectLabels(labelNames) {
  const labelsListElement = document.getElementById('labels-list');
  for (const name of labelNames) {
    const labelElement = labelsListElement.querySelector(`a[name="${name}"]`);
    labelElement.classList.add('active');
  }
  setLabelCounterDisplay(getSelectedLabelsCount());
}

/**
 *
 */
function deselectAllLabels() {
  document.querySelectorAll('.label-item').forEach((item) => {
    item.classList.remove('active');
  });
}

/**
 *
 */
function getVisibleLabelsCount() {
  const labelItemsArray = [].slice.call(labelItems);
  const displayShow = labelItemsArray.filter((el) => getComputedStyle(el).display !== 'none');
  return displayShow.length;
}

/**
 *
 */
function filterLabelsList() {
  const searchValue = document.querySelector('#label-search').value.toLowerCase().trim();
  let visibleCount = 0;
  for (const labelItem of labelItems) {
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
  for (const labelItem of labelItems) {
    labelItem.style.display = '';
  }
}

/**
 *
 */
function getLabelsForSelectedJobs() {
  const labelsSet = new Set();
  document.querySelectorAll('.select-job').forEach((jobEl) => {
    let labels = [];
    if (jobEl.checked) {
      const jobID = jobEl.getAttribute('data-id');
      const labelsString = document.querySelector(`#job-labels-display-${jobID}`).getAttribute('data-labels');
      if (labelsString !== '') {
        labels = labelsString.split(',');
        labels.forEach((item) => labelsSet.add(item));
      }
    }
  });
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
 *
 */
function setSubmitLinkDisabled(selectedJobsCount) {
  if (selectedJobsCount === 0) {
    submitLink.classList.add('disabled');
  } else {
    submitLink.classList.remove('disabled');
  }
}

/**
 * Responds to a submit link click event
 * (hits relevant Harmony url, shows user the response).
 * @param {Event} event - the click event
 */
function handleSubmitClick(event) {
  event.preventDefault();
  toasts.showUpper(`Labeling ${jobsTable.getJobIds().length} jobs...`);
  console.log(getSelectedLabelValues());
  console.log(jobsTable.getJobIds());
  // const link = event.target;
  // const stateChangeUrl = link.getAttribute('href');
  // const res = await fetch(stateChangeUrl);
  // const data = await res.json();
  // if (res.status === 200) {
  //   toasts.showUpper(`The job is now ${data.status}`);
  //   PubSub.publish('table-state-change');
  // } else if (data.description) {
  //   toasts.showUpper(data.description);
  // } else {
  //   toasts.showUpper('The update failed.');
  // }
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
    setLabelCounterDisplay(getSelectedLabelsCount());
    document.getElementById('label-search').value = '';
    showAllLabels();
    document.getElementById('no-match-li').style.display = 'none';
  });
  labelDropdown.addEventListener('show.bs.dropdown', () => {
    selectLabels(getLabelsForSelectedJobs());
    setLabelCounterDisplay(getSelectedLabelsCount());
    const selectedJobsCount = jobsTable.getJobIds().length;
    setJobCounterDisplay(selectedJobsCount);
    setLabelLinksDisabled(selectedJobsCount);
    setSubmitLinkDisabled(selectedJobsCount);
  });
  submitLink.addEventListener('click', (event) => {
    handleSubmitClick(event);
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
