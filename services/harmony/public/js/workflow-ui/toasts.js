/**
 * Holds the bootstrap toast objects.
 * There is a lower and upper toast (one is stacked above the other).
 */
const toastObj = {};

/**
 * Identifiers for the available toast elements.
 */
const upperToastId = 'upper-toast';
const lowerToastId = 'lower-toast';

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
   * Initialize the toasts.
   */
  init() {
    window.addEventListener('load', () => {
      for (const toastId of [upperToastId, lowerToastId]) {
        const toastEl = document.getElementById(toastId);
        toastObj[toastId] = new bootstrap.Toast(toastEl, { delay: 5000 });
      }
    });
  },

  /**
   * Set the text of the upper toast and show it.
   * @param {string} text - the text for the toast
   */
  showUpper(text) {
    if (Object.keys(toastObj).length) {
      setToastText(upperToastId, text);
      toastObj[upperToastId].show();
    }
  },

  /**
   * Set the text of the lower toast and show it.
   * @param {string} text - the text for the toast
   */
  showLower(text) {
    if (Object.keys(toastObj).length) {
      setToastText(lowerToastId, text);
      toastObj[lowerToastId].show();
    }
  },
};
