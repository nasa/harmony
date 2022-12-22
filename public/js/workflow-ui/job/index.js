import workItemsTable from './work-items-table';
import navLinks from '../nav-links';

/**
 * Initialize the job page (which displays work items, job status, etc).
 */
async function init() {
  // Retrieve the parameters (from the original page request)
  // that will be used to poll for work items
  const workflowContainer = document.getElementById('workflow-items-table-container');
  const page = workflowContainer.getAttribute('data-page');
  const limit = workflowContainer.getAttribute('data-limit');
  const jobId = workflowContainer.getAttribute('data-job-id');
  const disallowStatus = workflowContainer.getAttribute('data-disallow-status-checked') === 'checked' ? 'on' : '';
  const tableFilter = workflowContainer.getAttribute('data-table-filter');

  // kick off job state change links logic if this user is allowed to change the job state
  const navLinksContainer = document.getElementById('job-state-links-container');
  const isAdminOrOwner = navLinksContainer.getAttribute('data-is-admin-or-owner') === 'true';
  if (isAdminOrOwner) {
    await navLinks.init('job-state-links-container', jobId);
  }

  workItemsTable.init({ jobId, page, limit, disallowStatus, tableFilter });
}

init();
