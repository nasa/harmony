/**
 *
 */
function handleLabelClick(event) {
  event.preventDefault();
  const labelElement = event.target;
  labelElement.classList.toggle('active');
}

const labelItems = document.querySelectorAll('#labels-list .label-li');

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
