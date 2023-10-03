import jobsTable from './jobs-table.js';
import JobsStatusChangeLinks from './jobs-status-change-links.js';
import toasts from '../toasts.js';

const tableFilter = document.querySelector('input[name="tableFilter"]');
const tableFilterValue = tableFilter.getAttribute('data-value');
const currentUser = tableFilter.getAttribute('data-current-user');
const services = JSON.parse(tableFilter.getAttribute('data-services'));
const isAdminRoute = tableFilter.getAttribute('data-is-admin-route') === 'true';
jobsTable.init(currentUser, services, isAdminRoute, tableFilterValue);

const jobStatusLinks = new JobsStatusChangeLinks();
jobStatusLinks.init('job-state-links-container', 'job-selected');

toasts.init();
