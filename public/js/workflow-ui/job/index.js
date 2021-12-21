import workItemsTable from "./work-items-table.js";

const page = document.getElementById('workflow-items-table-container').getAttribute('data-page');
const limit = document.getElementById('workflow-items-table-container').getAttribute('data-limit');
const jobId = document.getElementById('workflow-items-table-container').getAttribute('data-job-id');

workItemsTable.init(jobId, page, limit);