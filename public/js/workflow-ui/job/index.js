import workItemsTable from "./work-items-table.js";
import navLinks from "../navLinks.js";
import toasts from "../toasts.js";

const workflowContainer = document.getElementById('workflow-items-table-container');
const page = workflowContainer.getAttribute('data-page');
const limit = workflowContainer.getAttribute('data-limit');
const jobId = workflowContainer.getAttribute('data-job-id');

workItemsTable.init(jobId, page, limit);
navLinks.init("links-container", jobId, toasts, workItemsTable);