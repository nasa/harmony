import { formatDates, initTooltips } from "../table.js";

function initFilters() {
  var filterInput = document.querySelector('input[class="jobs-filter"]');
  new Tagify(filterInput, {
    whitelist: [
      "status: successful",
      "status: canceled",
      "status: running",
      "status: failed",
      "status: accepted"
    ],
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
    initFilters();
  }
}