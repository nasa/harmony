import { formatDates, initTooltips } from "../table.js";

function initFilter() {
  var filterInput = document.querySelector('input[name="jobsFilter"]');
  new Tagify(filterInput, {
    whitelist: [
      { value: 'status: successful', dbValue: 'successful', field: 'status'},
      { value: 'status: canceled', dbValue: "canceled", field: 'status'},
      { value: 'status: running', dbValue: "running", field: 'status'},
      { value: 'status: failed', dbValue: "failed", field: 'status'},
      { value: 'status: accepted', dbValue: "accepted", field: 'status'},
    ],
    enforceWhitelist: true,
    editTags: false,
    maxTags: 20,
    dropdown: {
      maxItems: 20,
      enabled: 0,
      closeOnSelect: true
    }
  })
}

export default {

  /**
   * Handles jobs table logic.
   */
  async init() {
    formatDates();
    initTooltips('[data-bs-toggle="tooltip"]');
    initFilter();
  }
}