/**
 * Format all of the dates in the user's browser timezone.
 * @param {string} selector - the selector to use in querySelectorAll to
 * find elements that need their dates formatted
 */
function formatDates(selector) {
  const dateTds = document.querySelectorAll(selector);
  [...dateTds].forEach(
    (element) => {
      const time = parseInt(element.getAttribute('data-time'));
      const formattedDate = (new Date(time)).toLocaleString();
      element.textContent = formattedDate;
    }
  );
}

/**
 * Initialize all bootstrap tooltips with a given querySelector.
 */
function initTooltips(querySelector) {
  const tooltipTriggerList = [].slice.call(document.querySelectorAll(querySelector));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

/**
 * Utility for commonly used table logic.
 */
export {
  formatDates,
  initTooltips,
}