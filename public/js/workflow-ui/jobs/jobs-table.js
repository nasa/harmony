import { formatDates, initTooltips } from "../table.js";

/**
 * Build the jobs filter with filter facets like 'status' and 'user'.
 * @param currentUser - the current Harmony user
 * @param isAdminRoute - whether the current page is /admin/...
 */
function initFilter(currentUser, isAdminRoute) {
  var filterInput = document.querySelector('input[name="jobsFilter"]');
  const allowedList = [
    { value: 'status: successful', dbValue: 'successful', field: 'status'},
    { value: 'status: canceled', dbValue: "canceled", field: 'status'},
    { value: 'status: running', dbValue: "running", field: 'status'},
    { value: 'status: failed', dbValue: "failed", field: 'status'},
    { value: 'status: accepted', dbValue: "accepted", field: 'status'},
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

export default {

  /**
   * Handles jobs table logic.
   * @param currentUser - the current Harmony user
   * @param isAdminRoute - whether the current page is /admin/...
   */
  async init(currentUser, isAdminRoute) {
    formatDates();
    initTooltips('[data-bs-toggle="tooltip"]');
    initFilter(currentUser, isAdminRoute);
  }
}