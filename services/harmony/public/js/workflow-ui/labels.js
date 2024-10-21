const labelItems = document.querySelectorAll('#labels-list .label-li');
const labelDropdown = document.getElementById('label-dropdown-a');

/**
 *
 */
function getLabelCount() {
  return document.querySelectorAll('.label-item.active').length;
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
  setLabelCounterDisplay(getLabelCount());
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
  setLabelCounterDisplay(getLabelCount());
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
function filterLabelsList() {
  const searchValue = document.querySelector('#label-search').value.toLowerCase().trim();
  for (const labelItem of labelItems) {
    const labelName = labelItem.innerText.toLowerCase().trim();
    labelItem.style.display = labelName.startsWith(searchValue) ? '' : 'none';
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
  labelDropdown.addEventListener('hidden.bs.dropdown', () => {
    deselectAllLabels();
    setLabelCounterDisplay(getLabelCount());
  });
  labelDropdown.addEventListener('show.bs.dropdown', () => {
    selectLabels(getLabelsForSelectedJobs());
    setLabelCounterDisplay(getLabelCount());
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
