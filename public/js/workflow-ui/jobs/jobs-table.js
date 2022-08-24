import { formatDates, initTooltips } from "../table.js";

/**
 * Build the jobs filter with filter facets like 'status' and 'user'.
 * @param currentUser - the current Harmony user
 * @param isAdminRoute - whether the current page is /admin/...
 */
function initFilter(currentUser, isAdminRoute) {
  var filterInput = document.querySelector('input[name="tableFilter"]');
  const allowedList = [
    { value: 'status: successful', dbValue: 'successful', field: 'status'},
    { value: 'status: canceled', dbValue: "canceled", field: 'status'},
    { value: 'status: running', dbValue: "running", field: 'status'},
    { value: 'status: running with errors', dbValue: "running_with_errors", field: 'status'},
    { value: 'status: complete with errors', dbValue: "complete_with_errors", field: 'status'},
    { value: 'status: failed', dbValue: "failed", field: 'status'},
    { value: 'status: accepted', dbValue: "accepted", field: 'status'},
    { value: 'status: paused', dbValue: "paused", field: 'status'},
    { value: 'status: previewing', dbValue: "previewing", field: 'status'},
  ];
  if (isAdminRoute) {
    allowedList.push({ value: `user: ${currentUser}`, dbValue: currentUser, field: 'user'});
  }
  const allowedValues = allowedList.map(t => t.value);
  new Tagify(filterInput, {
    whitelist: allowedList,
    validate: function (tag) {
      if (allowedValues.includes(tag.value)) {
        return true;
      }
      if (isAdminRoute) {
        // check if the tag loosely resembles a valid EDL username
        return /^user: [A-Za-z0-9\.\_]{4,30}$/.test(tag.value);
      }
      return false;
    },
    editTags: false,
    maxTags: 30,
    dropdown: {
      maxItems: 15,
      enabled: 0,
      closeOnSelect: true
    }
  })
}

/**
 * Handles jobs table logic (formatting, building filters, etc.).
 */
export default {

  /**
   * Initialize the jobs table.
   * @param currentUser - the current Harmony user
   * @param isAdminRoute - whether the current page is /admin/...
   */
  async init(currentUser, isAdminRoute) {
    formatDates();
    initTooltips('[data-bs-toggle="tooltip"]');
    initFilter(currentUser, isAdminRoute);
  }
}