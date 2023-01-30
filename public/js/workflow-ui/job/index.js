import workItemsTable from './work-items-table.js';
import navLinks from '../nav-links.js';

/**
 * Initialize the job page (which displays work items, job status, etc).
 */
async function init() {
  // Retrieve the parameters (from the original page request)
  // that will be used to poll for work items
  const params = {};
  ['page', 'limit', 'jobID', 'fromDateTime', 'toDateTime', 'tzOffsetMinutes'].forEach((name) => {
    params[name] = document.getElementsByName(name)[0].value;
  });
  params.tableFilter = document.getElementsByName('tableFilter')[0].getAttribute('data-value');
  params.disallowStatus = document.getElementsByName('disallowStatus')[0].checked ? 'on' : '';
  params.dateKind = document.getElementById('dateKindUpdated').checked ? 'updatedAt' : 'createdAt';

  // kick off job state change links logic if this user is allowed to change the job state
  const navLinksContainer = document.getElementById('job-state-links-container');
  const isAdminOrOwner = navLinksContainer.getAttribute('data-is-admin-or-owner') === 'true';
  if (isAdminOrOwner) {
    await navLinks.init('job-state-links-container', params.jobID);
  }

  workItemsTable.init(params);
}

init();
