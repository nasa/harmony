function addDropdownClickListener() {
  const statusDropdown = document.getElementById('job-status-dropdown');
  statusDropdown.addEventListener('click', function(e) { 
    e.stopPropagation();
  }, false);
}

function addApplyClickListener() {
  const applyJobStatus = document.getElementById('apply-job-status');
  applyJobStatus.addEventListener('click', function() { 
    console.log('hi');
  }, false);
}

export default {

  /**
   * Handles job status dropdown logic.
   */
  async init() {
    addDropdownClickListener();
    addApplyClickListener();
  }
}