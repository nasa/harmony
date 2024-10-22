import jobsTable from './jobs/jobs-table.js';

const labelItems = document.querySelectorAll('#labels-list .label-li');

/**
 *
 */
function getSelectedLabelsCount() {
  return document.querySelectorAll('.label-item.active').length;
}

/**
 *
 */
function setJobCounterDisplay(count) {
  const display = ` apply to ${count} job${count === 1 ? '' : 's'}`;
  document.getElementById('job-counter').textContent = count ? display : '';
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
  });
  labelDropdown.addEventListener('show.bs.dropdown', () => {
    selectLabels(getLabelsForSelectedJobs());
    setLabelCounterDisplay(getSelectedLabelsCount());
    setJobCounterDisplay(jobsTable.getJobIds().length);
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
