/**
 * Holds the bootstrap toast object and the corresponding DOM element.
 * There is a lower and upper toast (one is stacked above the other).
 */
const toastObj = {};

/**
 * Identifiers for the available toast elements.
 */
const upperToastId = 'upper-toast';
const lowerToastId = 'lower-toast';

// bootstrap toasts need to be initialized
window.addEventListener('load', () => {
  for (const toastId of [upperToastId, lowerToastId]) {
    const toastEl = document.getElementById(toastId);
    toastObj[toastId] = new bootstrap.Toast(toastEl, { delay: 5000 });
  }
});

/**
 * For the given toast, set its text.
 * @param {string} toastId - the id of the toast
 * @param {string} text - the text for the toast
 */
function setToastText(toastId, text) {
  const toastEl = document.getElementById(toastId);
  const toastBodyEl = toastEl.querySelector('.toast-body');
  toastBodyEl.textContent = text;
}

/**
 * A utility object for showing toasts.
 * The corresponding toasts HTML partial must be included
 * in order to use this functionality.
 */
export default {

  /**
   * Set the text of the upper toast and show it.
   * @param {string} text 
   */
  showUpper(text) {
    setToastText(upperToastId, text);
    toastObj[upperToastId].show();
  },

  /**
   * Set the text of the lower toast and show it.
   * @param {string} text 
   */
  showLower(text) {
    setToastText(lowerToastId, text);
    toastObj[lowerToastId].show();
  }
}