import jobsTable from "./jobs-table.js";

const jobsFilter = document.querySelector('input[name="jobsFilter"]')
const currentUser = jobsFilter.getAttribute('data-current-user');
const isAdminRoute = jobsFilter.getAttribute('data-is-admin-route') === 'true';
jobsTable.init(currentUser, isAdminRoute);