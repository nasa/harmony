function addDropdownClickListener() {
  const statusDropdown = document.getElementById('job-status-dropdown');
  statusDropdown.addEventListener('click', function(e) { 
    e.stopPropagation();
  }, false);
}

export default {

  /**
   * Handles job status dropdown logic.
   */
  async init() {
    addDropdownClickListener();
  }
}