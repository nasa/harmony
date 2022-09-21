import workItemsTable from "./work-items-table.js";
import navLinks from "../nav-links.js";

// Retrieve the parameters (from the original page request) that will be used to poll for work items
const workflowContainer = document.getElementById('workflow-items-table-container');
const page = workflowContainer.getAttribute('data-page');
const limit = workflowContainer.getAttribute('data-limit');
const jobId = workflowContainer.getAttribute('data-job-id');
const disallowStatus = workflowContainer.getAttribute('data-disallow-status-checked') === 'checked' ? 'on' : '';
const tableFilter = workflowContainer.getAttribute('data-table-filter');

await navLinks.init("job-state-links-container", jobId);

workItemsTable.init(jobId, page, limit, disallowStatus, tableFilter);
