// Dashboard parameter values used to be shared by every panel, and saving a dashboard copied in
// every value its queries had. Now each panel takes its query's saved values unless the panel or
// the dashboard sets its own, so those copies would override every panel. Clear them: the
// dashboard-wide values start empty.
exports.up = async function up(knex) {
  await knex('analytics_dashboards').update({ parameters: null });
};

// The copies can't be put back
exports.down = async function down() {};
