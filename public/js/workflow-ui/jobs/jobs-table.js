import { formatDates, initTooltips } from "../table.js";
import statusDropdown from "./status-dropdown.js";

export default {

  /**
   * Handles jobs table logic.
   */
  async init() {
    formatDates();
    initTooltips('[data-bs-toggle="tooltip"]');
    statusDropdown.init();
  }
}