const labelItems = document.querySelectorAll('#labels-list .label-li');
const labelDropdown = document.getElementById('label-dropdown-a');

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
function deselectAll() {
  document.querySelectorAll('.label-item').forEach((item) => {
    item.classList.remove('active');
  });
}

/**
 *
 */
function filterList() {
  const searchValue = document.querySelector('#label-search').value.toLowerCase().trim();
  for (const labelItem of labelItems) {
    const labelName = labelItem.innerText.toLowerCase().trim();
    labelItem.style.display = labelName.startsWith(searchValue) ? '' : 'none';
  }
}

/**
 *
 */
function bindEventListeners() {
  const labelSearchElement = document.getElementById('label-search');
  labelSearchElement.addEventListener('keyup', () => {
    filterList();
  });
  document.querySelectorAll('.label-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      handleLabelClick(event);
    }, false);
  });
  labelDropdown.addEventListener('hidden.bs.dropdown', () => {
    deselectAll();
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
