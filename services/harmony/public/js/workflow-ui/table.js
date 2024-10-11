import toasts from './toasts.js';

/**
 * Format all of the dates in the user's browser timezone.
 * @param {string} selector - the selector to use in querySelectorAll to
 * find elements that need their dates formatted
 */
function formatDates(selector) {
  const dateTds = document.querySelectorAll(selector);
  [...dateTds].forEach(
    (element) => {
      const time = parseInt(element.getAttribute('data-time'), 10);
      const formattedDate = (new Date(time)).toLocaleString();
      // eslint-disable-next-line no-param-reassign
      element.textContent = formattedDate;
    },
  );
}

/**
 * Initialize all bootstrap tooltips with a given querySelector.
 * @param {string} querySelector - the selector for elements that have tooltips
 */
function initTooltips(querySelector) {
  const tooltipTriggerList = [].slice.call(document.querySelectorAll(querySelector));
  tooltipTriggerList.map((tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl));
}

/**
 * Fallback method for copying text to clipboard.
 * @param {string} text - the text to copy
 */
function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  // Avoid scrolling to bottom
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Method for copying the text to the clipboard.
 * @param {string} text - the text to copy
 */
async function copyTextToClipboard(text) {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Intitialize the copy click handler for all copy buttons.
 * @param {string} selector - defines which button(s) to bind the handler to
 */
async function initCopyHandler(selector) {
  // https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener('click', (event) => {
      copyTextToClipboard(event.target.getAttribute('data-text'));
      const isTruncated = event.target.getAttribute('data-truncated') === 'true';
      toasts.showUpper(
          `✅ Copied to clipboard${isTruncated ? '. WARNING: this request text was truncated due to length constraints.' : ''}`,
      );
    });
  });
}

/**
 * Utility for commonly used table logic.
 */
export {
  formatDates,
  initTooltips,
  initCopyHandler,
};
