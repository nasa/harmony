import { formatDates, initTooltips } from "../table.js";

export default {

  /**
   * Handles jobs table logic.
   */
  async init() {
    formatDates();
    initTooltips('[data-bs-toggle="tooltip"]');
  }
}