import jobsTable from './jobs-table.js';

const tableFilter = document.querySelector('input[name="tableFilter"]');
const tableFilterValue = tableFilter.getAttribute('data-value');
const currentUser = tableFilter.getAttribute('data-current-user');
const isAdminRoute = tableFilter.getAttribute('data-is-admin-route') === 'true';
jobsTable.init(currentUser, isAdminRoute, tableFilterValue);
