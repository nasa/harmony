import jobsTable from './jobs-table.js';
import JobsStatusChangeLinks from './jobs-status-change-links.js';
import toasts from '../toasts.js';

const params = {};

const tableFilter = document.querySelector('input[name="tableFilter"]');
const isAdminRoute = tableFilter.getAttribute('data-is-admin-route') === 'true';
params.isAdminRoute = isAdminRoute;
params.tableFilter = tableFilter.getAttribute('data-value');
params.currentUser = tableFilter.getAttribute('data-current-user');
params.services = JSON.parse(tableFilter.getAttribute('data-services'));

params.disallowStatus = document.getElementsByName('disallowStatus')[0].checked ? 'on' : '';
params.disallowService = document.getElementsByName('disallowService')[0].checked ? 'on' : '';
if (isAdminRoute) {
    params.disallowUser = document.getElementsByName('disallowUser')[0].checked ? 'on' : '';
}
jobsTable.init(params);

const jobStatusLinks = new JobsStatusChangeLinks();
jobStatusLinks.init('job-state-links-container', 'job-selected');

toasts.init();
